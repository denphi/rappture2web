"""
rappture2web.rp_library
=======================

A drop-in replacement for the classic Rappture Python library that talks to
the rappture2web web server instead of reading/writing driver.xml files.

Compatibility targets:
  - Rappture.library(server_url)          → RpLibrary
  - Rappture.PyXml(server_url)            → RpNode (PyXml-style dict interface)
  - lib.get(path)                         → current value string
  - lib.put(path, value, append=False)    → post output to server
  - lib.result(status=0)                  → notify server simulation is done
  - rx['input.(temp).current'].value      → get value
  - rx['output.curve(f).xaxis.label'] = 'Energy'  → post output to server

The server_url is passed instead of a driver.xml path.  To keep backward
compatibility with scripts that receive the server URL as sys.argv[1], the
library auto-detects whether argv[1] is a URL or a file path.

Usage in a tool script (identical API to old Rappture):

    import sys
    import rappture2web.rp_library as Rappture

    rx = Rappture.PyXml(sys.argv[1])          # argv[1] = server URL
    temp = rx['input.(temperature).current'].value
    rx['output.number(t).about.label'] = 'Temperature'
    rx['output.number(t).current'] = temp
    rx.close()                                 # signals done

Or library-style:

    import sys
    import rappture2web.rp_library as Rappture

    lib = Rappture.library(sys.argv[1])
    T = lib.get('input.(temperature).current')
    lib.put('output.curve(f12).about.label', 'Fermi-Dirac Factor')
    lib.put('output.curve(f12).component.xy', xy_data, append=True)
    Rappture.result(lib)
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# ─── URL / file detection ──────────────────────────────────────────────────────

def _is_url(s: str) -> bool:
    """Return True if s looks like an http/https URL."""
    return s.startswith("http://") or s.startswith("https://")

# ─── Output path parser ───────────────────────────────────────────────────────

def _parse_path_segments(path: str) -> list[tuple[str, str]]:
    """Split 'a.b(id).c' into [('a',''), ('b','id'), ('c','')]."""
    parts = []
    for seg in path.split("."):
        if "(" in seg and seg.endswith(")"):
            tag = seg[:seg.index("(")]
            eid = seg[seg.index("(") + 1:-1]
            parts.append((tag, eid))
        else:
            parts.append((seg, ""))
    return parts


def _path_section(path: str) -> str:
    """Return the top-level section of a path: 'input', 'output', etc."""
    return path.split(".")[0]


def _to_xy_string(value) -> str:
    """Convert a value to the string format Rappture uses for XY data.

    Accepts:
      - str / numeric → str()
      - (x_arr, y_arr) tuple or list of two sequences → "x1 y1\\nx2 y2\\n..."
      - 2-row ndarray (2×N) → same
      - N×2 ndarray → same
    """
    if isinstance(value, str):
        return value

    try:
        import numpy as np
        arr = np.asarray(value, dtype=float)
        if arr.ndim == 2 and arr.shape[0] == 2:   # (2, N) — each row is an axis
            rows = zip(arr[0], arr[1])
            return "\n".join(f"{x} {y}" for x, y in rows) + "\n"
        elif arr.ndim == 2 and arr.shape[1] == 2:  # (N, 2) — each row is (x, y)
            return "\n".join(f"{row[0]} {row[1]}" for row in arr) + "\n"
        # All other shapes (scalar, 1-D, 2-D non-XY, 3-D, ...): flatten to space-separated
        return " ".join(str(v) for v in arr.ravel())
    except (ImportError, TypeError, ValueError):
        pass

    # Plain Python list/tuple of two sequences: (x_list, y_list)
    if isinstance(value, (list, tuple)) and len(value) == 2:
        x_seq, y_seq = value
        try:
            return "\n".join(f"{x} {y}" for x, y in zip(x_seq, y_seq)) + "\n"
        except TypeError:
            pass

    return str(value)


# ─── Output accumulator ───────────────────────────────────────────────────────

class _OutputStore:
    """Accumulates output put() calls and flushes them to the server (or XML file).

    Output data is grouped by (section, type, id) and flushed either
    immediately or on result() depending on the 'streaming' flag.
    """

    def __init__(self, server_url: str, streaming: bool = True):
        self._url = server_url.rstrip("/")
        self._is_file = not _is_url(server_url)
        self._file_path = server_url if self._is_file else None
        self._streaming = streaming
        # Nested dict: outputs[output_id] = { type, id, label, ... }
        self._outputs: dict[str, dict] = {}
        # Track append accumulation for xy data
        self._xy_buffers: dict[str, str] = {}
        # Accumulated log text
        self._log_lines: list[str] = []

    def put(self, path: str, value, append: bool = False):
        """Store an output value and optionally stream it to the server."""
        section = _path_section(path)
        if section != "output":
            return  # Not an output, ignore (inputs are read-only)

        # Normalise value to string (handles numpy arrays, tuples, lists)
        value = _to_xy_string(value)

        parts = _parse_path_segments(path)
        # parts[0] = ('output', '')
        # parts[1] = (type, id)   e.g. ('curve', 'f12')
        # parts[2:] = property path  e.g. [('about',''), ('label','')]

        if len(parts) < 2:
            return

        out_type, out_id = parts[1]
        if not out_id:
            out_id = out_type  # e.g. <log> has no id

        prop_path = ".".join(
            f"{tag}({eid})" if eid else tag
            for tag, eid in parts[2:]
        )

        # Get or create output record
        rec = self._outputs.setdefault(out_id, {"type": out_type, "id": out_id})

        self._apply_property(rec, prop_path, value, append)

        # Mesh and field records are always flushed at done() time so that
        # cross-references between records can be resolved correctly.
        # In file mode nothing is streamed — everything is written at done().
        if self._streaming and not self._is_file and out_type not in ("mesh", "field"):
            self._post_output(rec)

    def _apply_property(self, rec: dict, prop_path: str, value: str, append: bool):
        """Set a property deep inside a record dict using dot-path."""
        if not prop_path:
            return

        # Special handling for xy data (xy gets appended as text)
        if prop_path == "component.xy":
            buf_key = rec.get("id", "") + ".xy"
            if append:
                self._xy_buffers[buf_key] = self._xy_buffers.get(buf_key, "") + value
            else:
                self._xy_buffers[buf_key] = value
            rec.setdefault("traces", [])
            # Parse all xy text into a trace
            xy_text = self._xy_buffers[buf_key]
            x_vals, y_vals = [], []
            for line in xy_text.strip().split("\n"):
                cols = line.strip().split()
                if len(cols) >= 2:
                    try:
                        x_vals.append(float(cols[0]))
                        y_vals.append(float(cols[1]))
                    except ValueError:
                        pass
            # Replace first trace
            if rec["traces"]:
                rec["traces"][0] = {"x": x_vals, "y": y_vals, "label": ""}
            else:
                rec["traces"].append({"x": x_vals, "y": y_vals, "label": ""})
            return

        # Map dot-path to nested dicts
        parts = [p for p in prop_path.split(".") if p]
        node = rec
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        last = parts[-1]

        if append and last in node and isinstance(node[last], str):
            node[last] = node[last] + str(value)
        else:
            node[last] = str(value) if value is not None else ""

    def log(self, text: str):
        """Send a log message to the server (or accumulate for XML in file mode)."""
        if self._is_file:
            self._log_lines.append(text)
            return
        self._http_post("/api/log", {"text": text})

    def _normalize_record(self, rec: dict) -> dict:
        """Normalize a record into the structure the JS renderer expects."""
        out_type = rec.get("type", "")

        if out_type == "mesh":
            # Parse dim to int
            dim = int(rec.get("dim", 3))
            normalized = dict(rec)
            normalized["dim"] = dim
            # Parse unstructured.points text → [[x,y,z], ...]
            unstructured = rec.get("unstructured", {})
            pts_text = unstructured.get("points", "") if isinstance(unstructured, dict) else ""
            if pts_text:
                points = []
                for line in pts_text.strip().splitlines():
                    coords = line.split()
                    if len(coords) >= dim:
                        try:
                            points.append([float(c) for c in coords[:dim]])
                        except ValueError:
                            pass
                normalized["points"] = points
                normalized["mesh_type"] = "unstructured"
            return normalized

        if out_type == "field":
            normalized = dict(rec)
            # Build components list from component dict
            comp = rec.get("component", {})
            if isinstance(comp, dict):
                mesh_ref = comp.get("mesh", "")
                values_text = comp.get("values", "")
                extents = int(comp.get("extents", "1") or "1")

                # Parse values: scalar (1 token/line) or vector (extents tokens/line)
                values = []
                if values_text:
                    if extents > 1:
                        # Vector: each line has extents components → list of lists
                        for line in values_text.strip().splitlines():
                            cols = line.split()
                            if len(cols) >= extents:
                                try:
                                    values.append([float(c) for c in cols[:extents]])
                                except ValueError:
                                    pass
                    else:
                        for v in values_text.strip().split():
                            try:
                                values.append(float(v))
                            except ValueError:
                                pass

                # Resolve mesh reference from sibling outputs
                mesh_data = None
                if mesh_ref:
                    import re
                    m = re.search(r'\(([^)]+)\)', mesh_ref)
                    mesh_key = m.group(1) if m else mesh_ref.split(".")[-1]
                    raw_mesh = self._outputs.get(mesh_key)
                    if raw_mesh:
                        mesh_data = self._normalize_record(raw_mesh)
                # Parse <flow> metadata from component dict
                flow_raw = comp.get("flow", {})
                flow = None
                if isinstance(flow_raw, dict) and flow_raw:
                    def _str(d, k, default=""):
                        v = d.get(k, default)
                        return v if isinstance(v, str) else default

                    # Particles: stored as particles(id) → dict
                    particles = []
                    for k, v in flow_raw.items():
                        if k.startswith("particles(") and isinstance(v, dict):
                            pid = k[len("particles("):-1]
                            particles.append({
                                "id":       pid,
                                "label":    _str(v, "label", pid),
                                "axis":     _str(v, "axis", "x"),
                                "position": _str(v, "position", "50%"),
                                "color":    _str(v, "color", "white"),
                                "size":     float(v.get("size", "2") or "2"),
                                "hide":     _str(v, "hide", "no").lower() == "yes",
                            })

                    # Boxes: stored as box(id) → dict
                    boxes = []
                    for k, v in flow_raw.items():
                        if k.startswith("box(") and isinstance(v, dict):
                            bid = k[len("box("):-1]
                            c1 = v.get("corner(1)", "0 0 0")
                            c2 = v.get("corner(2)", "1 1 1")
                            def _parse_corner(s):
                                try:
                                    return [float(x) for x in str(s).split()]
                                except Exception:
                                    return [0, 0, 0]
                            boxes.append({
                                "id":        bid,
                                "label":     _str(v, "label", bid),
                                "color":     _str(v, "color", "white"),
                                "linewidth": float(v.get("linewidth", "1") or "1"),
                                "hide":      _str(v, "hide", "no").lower() == "yes",
                                "corner1":   _parse_corner(c1),
                                "corner2":   _parse_corner(c2),
                            })

                    flow = {
                        "label":       _str(flow_raw, "label", ""),
                        "description": _str(flow_raw, "description", ""),
                        "axis":        _str(flow_raw, "axis", "z"),
                        "position":    _str(flow_raw, "position", "50%"),
                        "streams":     _str(flow_raw, "streams", "no").lower() == "yes",
                        "arrows":      _str(flow_raw, "arrows", "no").lower() == "yes",
                        "volume":      _str(flow_raw, "volume", "yes").lower() != "no",
                        "outline":     _str(flow_raw, "outline", "no").lower() == "yes",
                        "particles":   particles,
                        "boxes":       boxes,
                    }

                normalized["components"] = [{"mesh": mesh_data, "values": values, "extents": extents, "flow": flow}]
                # Copy label from about.label if present
                about = rec.get("about", {})
                if isinstance(about, dict) and "label" in about:
                    normalized["label"] = about["label"]
                about_group = about.get("group", "") if isinstance(about, dict) else ""
                if about_group:
                    normalized["group"] = about_group
            return normalized

        return rec

    def _post_output(self, rec: dict):
        """Push one output record to the server."""
        self._http_post("/api/output", self._normalize_record(rec))

    def flush_all(self):
        """Push all pending outputs (used in non-streaming mode)."""
        for rec in self._outputs.values():
            self._http_post("/api/output", self._normalize_record(rec))

    def done(self, status: int = 0):
        """Signal simulation completion to the server (or write run XML)."""
        if self._is_file:
            self._write_xml_outputs()
            return
        if not self._streaming:
            self.flush_all()
        else:
            # Flush mesh and field records (deferred until all puts are done)
            for rec in self._outputs.values():
                if rec.get("type") in ("mesh", "field"):
                    self._http_post("/api/output", self._normalize_record(rec))
        self._http_post("/api/simulate/done", {
            "status": "success" if status == 0 else "error"
        })

    def _write_xml_outputs(self):
        """Write accumulated raw outputs back into the driver XML file."""
        try:
            import xml.etree.ElementTree as ET
            ET.register_namespace("", "")
            tree = ET.parse(self._file_path)
            root = tree.getroot()
            output_elem = root.find("output")
            if output_elem is None:
                output_elem = ET.SubElement(root, "output")

            def _set_path(parent, parts, value):
                """Recursively set a value at parts path under parent."""
                if not parts:
                    parent.text = str(value)
                    return
                tag, eid = parts[0]
                if eid:
                    child = parent.find(f"{tag}[@id='{eid}']")
                    if child is None:
                        child = ET.SubElement(parent, tag)
                        child.set("id", eid)
                else:
                    child = parent.find(tag)
                    if child is None:
                        child = ET.SubElement(parent, tag)
                _set_path(child, parts[1:], value)

            import re as _re
            _ID_RE = _re.compile(r'^([A-Za-z_][A-Za-z0-9_.-]*)\(([^)]+)\)$')

            def _find_or_create(parent, key):
                """Find or create a child element.

                Keys like 'particles(p1)' become <particles id="p1">;
                plain keys become the literal tag name.
                """
                m = _ID_RE.match(key)
                if m:
                    tag, eid = m.group(1), m.group(2)
                    child = parent.find(f"{tag}[@id='{eid}']")
                    if child is None:
                        child = ET.SubElement(parent, tag)
                        child.set("id", eid)
                else:
                    child = parent.find(key)
                    if child is None:
                        child = ET.SubElement(parent, key)
                return child

            for out_id, rec in self._outputs.items():
                out_type = rec.get("type", "generic")
                # Walk every leaf key in the flat rec dict and write to XML
                def _write_rec(elem, d, skip=()):
                    for k, v in d.items():
                        if k in skip:
                            continue
                        if k == "traces" and isinstance(v, list):
                            # Write each trace as <component><xy>x1 y1\n...</xy></component>
                            for trace in v:
                                xs = trace.get("x", [])
                                ys = trace.get("y", [])
                                if xs and ys:
                                    comp = ET.SubElement(elem, "component")
                                    xy_el = ET.SubElement(comp, "xy")
                                    xy_el.text = "\n".join(
                                        f"{x} {y}" for x, y in zip(xs, ys)
                                    ) + "\n"
                        elif isinstance(v, dict):
                            child = _find_or_create(elem, k)
                            _write_rec(child, v)
                        elif not isinstance(v, (list, tuple)):
                            child = _find_or_create(elem, k)
                            child.text = str(v)

                # Find or create the output element for this id
                out_el = output_elem.find(f"{out_type}[@id='{out_id}']")
                if out_el is None:
                    out_el = ET.SubElement(output_elem, out_type)
                    out_el.set("id", out_id)
                _write_rec(out_el, rec, skip=("type", "id"))

            # Write accumulated log lines as <output><log>...</log>
            if self._log_lines:
                log_el = output_elem.find("log")
                if log_el is None:
                    log_el = ET.SubElement(output_elem, "log")
                log_el.text = "\n".join(self._log_lines)

            tree.write(self._file_path, encoding="unicode", xml_declaration=True)
        except Exception as exc:
            print(f"[rp_library] Warning: failed to write XML outputs: {exc}", file=sys.stderr)

    def _http_post(self, endpoint: str, data: dict):
        """POST JSON data to the server, ignoring errors."""
        url = self._url + endpoint
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.read()
        except Exception as exc:
            print(f"[rp_library] Warning: POST {endpoint} failed: {exc}", file=sys.stderr)
            return None


# ─── Input reader ─────────────────────────────────────────────────────────────

class _InputStore:
    """Reads input values from the server or a driver XML file."""

    def __init__(self, server_url: str):
        self._url = server_url.rstrip("/")
        self._is_file = not _is_url(server_url)
        self._file_path = server_url if self._is_file else None
        self._values: dict[str, str] | None = None

    def _ensure_loaded(self):
        if self._values is not None:
            return
        if self._is_file:
            self._values = self._load_from_xml()
        else:
            try:
                req = urllib.request.Request(self._url + "/api/inputs")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    self._values = json.loads(resp.read())
            except Exception as exc:
                print(f"[rp_library] Warning: GET /api/inputs failed: {exc}", file=sys.stderr)
                self._values = {}

    def _load_from_xml(self) -> dict:
        """Parse driver XML and return {path: current_value} for all inputs."""
        try:
            import xml.etree.ElementTree as ET
            tree = ET.parse(self._file_path)
            root = tree.getroot()
            values = {}
            input_elem = root.find("input")
            if input_elem is None:
                return values
            def _walk(elem, prefix):
                tag = elem.tag
                eid = elem.get("id", "")
                if eid:
                    path = f"{prefix}.{tag}({eid})"
                else:
                    path = f"{prefix}.{tag}"
                current = elem.find("current")
                if current is not None and current.text:
                    values[path] = current.text.strip()
                else:
                    default = elem.find("default")
                    if default is not None and default.text:
                        values[path] = default.text.strip()
                for child in elem:
                    if child.tag not in ("about", "units", "min", "max",
                                         "default", "current", "preset"):
                        _walk(child, path)
            for child in input_elem:
                _walk(child, "input")
            return values
        except Exception as exc:
            print(f"[rp_library] Warning: failed to parse XML inputs: {exc}", file=sys.stderr)
            return {}

    def get(self, path: str) -> str:
        """Get a current value by Rappture path.

        Handles:
          input.number(temperature).current  -> exact key lookup
          input.(temperature).current        -> fuzzy lookup ignoring type
        """
        self._ensure_loaded()

        # Try exact match first
        if path in self._values:
            return self._values[path]

        # Strip .current suffix for lookup (values stored at parent path)
        if path.endswith(".current"):
            base = path[: -len(".current")]
        else:
            base = path

        # Exact match without .current
        if base in self._values:
            return self._values[base]

        # Fuzzy: input.(id) -> find any key that matches the id
        # e.g. 'input.(temperature).current' should match 'input.number(temperature)'
        parts = _parse_path_segments(base)
        if parts and parts[0][0] == "input":
            for stored_path, val in self._values.items():
                stored_parts = _parse_path_segments(stored_path.split(".current")[0])
                if _paths_match(parts, stored_parts):
                    return val

        return ""


def _paths_match(query: list[tuple[str, str]], stored: list[tuple[str, str]]) -> bool:
    """Check if a query path matches a stored path, ignoring type tags.

    query:  [('input',''), ('','temperature')]  (from input.(temperature))
    stored: [('input',''), ('number','temperature')]
    """
    if len(query) != len(stored):
        return False
    for (qt, qid), (st, sid) in zip(query, stored):
        # If query tag is empty (bare id shorthand like (temp)), skip tag check
        if qt and qt != st:
            return False
        if qid and qid != sid:
            return False
    return True


# ─── library class (classic API) ─────────────────────────────────────────────

class RpLibrary:
    """Mimics Rappture.library() — path-based get/put interface."""

    def __init__(self, server_url: str):
        self._url = server_url.rstrip("/")
        self._inputs = _InputStore(server_url)
        self._outputs = _OutputStore(server_url, streaming=True)

    def get(self, path: str) -> str:
        """Read a value by Rappture path (inputs only)."""
        return self._inputs.get(path)

    def put(self, path: str, value, append: bool = False, **kwargs):
        """Write a value by Rappture path.

        For output paths: sends data to the web server.
        For tool.* paths: silently ignored (metadata).
        For log: forwarded to /api/log.
        """
        value = _to_xy_string(value) if value is not None else ""

        if path == "output.log" or path.startswith("output.log."):
            self._outputs.log(value)
        elif path.startswith("output."):
            # Handle append kwarg from old API
            _append = append or kwargs.get("append") is True or kwargs.get("append") == "yes"
            self._outputs.put(path, value, append=_append)
        elif path.startswith("tool."):
            pass  # metadata like tool.version.rappture.language, ignore
        # input.* writes are silently ignored (inputs are read-only)

    def result(self, status: int = 0):
        """Notify server that the simulation is done."""
        self._outputs.done(status)

    def xml(self) -> str:
        """Return a placeholder XML string (not used in web mode)."""
        return "<run/>"

    def element(self, path: str):
        """Compatibility stub."""
        return _ElementStub(self, path)

    def children(self, path: str, type: str = "") -> list[str]:
        """Compatibility stub — returns empty list."""
        return []

    def copy(self, dest: str, src: str):
        """Copy a value from src path to dest path."""
        val = self.get(src)
        if val:
            self.put(dest, val)


class _ElementStub:
    """Minimal element stub for library.element() compatibility."""
    def __init__(self, lib: RpLibrary, path: str):
        self._lib = lib
        self._path = path

    def xml(self) -> str:
        return f"<{self._path}/>"


# ─── PyXml-style Node interface ───────────────────────────────────────────────

class RpNode:
    """Mimics Rappture.PyXml() — dict-style access node.

    rx = Rappture.PyXml(server_url)
    temp = rx['input.(temperature).current'].value
    rx['output.number(t).current'] = '300K'
    rx.close()
    """

    def __init__(self, lib: RpLibrary, path: str):
        self._lib = lib
        self._path = path

    # ── dict-like read / write ──

    def __getitem__(self, subpath: str) -> "RpNode":
        full = f"{self._path}.{subpath}" if self._path else subpath
        return RpNode(self._lib, full)

    def __setitem__(self, subpath: str, val):
        full = f"{self._path}.{subpath}" if self._path else subpath
        self._lib.put(full, val)

    # ── value property ──

    @property
    def value(self) -> str:
        return self._lib.get(self._path)

    @property
    def name(self) -> str:
        return self._path

    # ── helpers ──

    def get(self, subpath: str) -> str:
        return self[subpath].value

    def put(self, subpath: str, val, **kwargs):
        full = f"{self._path}.{subpath}" if self._path else subpath
        self._lib.put(full, val, **kwargs)

    def copy(self, dest: str, src: str):
        self._lib.copy(dest, src)

    def xml(self) -> str:
        return self._lib.xml()

    def close(self, status: int = 0):
        """Signal simulation done (replaces rx.close() / Rappture.result())."""
        self._lib.result(status)

    def __str__(self) -> str:
        return f"RpNode('{self._path}')"


# ─── Module-level factory functions (drop-in for `import Rappture`) ───────────

def library(server_url: str) -> RpLibrary:
    """Create a library handle connected to the rappture2web server.

    Usage:
        import rappture2web.rp_library as Rappture
        lib = Rappture.library(sys.argv[1])
    """
    return RpLibrary(server_url)


def PyXml(server_url: str) -> RpNode:
    """Create a PyXml-style node handle connected to the rappture2web server.

    Usage:
        import rappture2web.rp_library as Rappture
        rx = Rappture.PyXml(sys.argv[1])
    """
    lib = RpLibrary(server_url)
    return RpNode(lib, "")


def result(lib: RpLibrary, status: int = 0):
    """Signal simulation done (classic Rappture.result(driver) pattern)."""
    lib.result(status)


# ─── Units stub (for scripts that use Rappture.Units.convert) ────────────────

class _UnitConverter:
    """Minimal unit converter stub.

    For full unit support, integrate with pint or astropy.units.
    For now: strips units suffix and returns the numeric string.
    """

    def convert(self, value: str, **kwargs) -> float | str:
        """Strip unit suffix and return numeric value.

        Args:
            value:   e.g. '300K', '10eV', '4V'
            to:      target unit keyword arg (ignored in stub)
            units:   'off' → return float, else return numeric string
        """
        import re
        target_units = kwargs.get("units", "with")
        m = re.match(r"^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*(.*)$", str(value).strip())
        if m:
            num_str = m.group(1)
            if target_units == "off":
                try:
                    return float(num_str)
                except ValueError:
                    return num_str
            return num_str
        return value


class _Units:
    def __init__(self):
        self._converter = _UnitConverter()

    def convert(self, value: str, **kwargs) -> float | str:
        return self._converter.convert(value, **kwargs)


Units = _Units()


# ─── Encoding helpers (for scripts that use Rappture.encoding) ───────────────

class _Encoding:
    RPENC_B64 = 2
    RPENC_ZB64 = 3

    @staticmethod
    def encode(data: bytes, encoding: int = 3) -> str:
        from .encoding import encode
        return encode(data, encoding)

    @staticmethod
    def decode(data: str) -> bytes:
        from .encoding import decode
        return decode(data)


encoding = _Encoding()
