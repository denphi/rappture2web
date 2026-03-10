"""Simulation runner: executes tool command, manages run history and cache."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from xml.etree import ElementTree as ET

from .xml_parser import parse_run_xml


# ─── PUQ helpers ──────────────────────────────────────────────────────────────

# Path to the puq.sh wrapper installed on NanoHUB.
# Overridable via RAPPTURE2WEB_PUQ_SH env var for testing.
_NANOHUB_PUQ_SH = "/apps/rappture/current/bin/puq"

# Fallback: puq scripts shipped alongside this package
_PKG_PUQ_DIR = Path(__file__).parent / "puq"


def _find_puq_sh() -> str | None:
    """Return path to the puq shell wrapper, or None if not available."""
    override = os.environ.get("RAPPTURE2WEB_PUQ_SH", "").strip()
    if override:
        return override
    if os.path.isfile(_NANOHUB_PUQ_SH):
        return _NANOHUB_PUQ_SH
    return None


def _jpickle_dumps(obj) -> str:
    """Serialize obj to PUQ jpickle format (simple JSON wrapping)."""
    # PUQ's jpickle format for plain lists/tuples/strings/numbers is just JSON.
    return json.dumps(obj)


def _strip_units_value(value: str) -> float:
    """Extract the numeric part from a Rappture value string like '300K' → 300.0."""
    import re
    if not value:
        return 0.0
    m = re.match(r'^([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)', value.strip())
    return float(m.group(1)) if m else 0.0


# ─── Rappture binary detection ────────────────────────────────────────────────

def _find_rappture_binary() -> str | None:
    """Return the path to the 'rappture' executable, or None if not found."""
    return shutil.which("rappture")


def _get_rappture_env_file() -> str | None:
    """Return path to rappture.env if available, else None."""
    candidates = []

    # 1. RAPPTURE_PATH env var (most reliable on NanoHub)
    rapp_path = os.environ.get("RAPPTURE_PATH", "").strip()
    if rapp_path:
        candidates.append(os.path.join(rapp_path, "bin"))

    # 2. Directory of the rappture binary found via PATH
    rappture_bin = _find_rappture_binary()
    if rappture_bin:
        candidates.append(os.path.dirname(os.path.abspath(rappture_bin)))

    for d in candidates:
        env_file = os.path.join(d, "rappture.env")
        if os.path.isfile(env_file):
            return env_file
    return None


# ─── Driver XML helpers ───────────────────────────────────────────────────────

def create_driver_xml(tool_xml_path: str, input_values: dict) -> str:
    """Create a driver.xml from tool.xml with user input values filled in.

    Returns the path to the created driver file.
    """
    tree = ET.parse(tool_xml_path)
    root = tree.getroot()

    for path, value in input_values.items():
        _set_xml_value(root, path, str(value))

    # Apply loader default examples for any <loader> whose target <structure>
    # has not already been set by input_values (i.e. user didn't supply it).
    _apply_loader_defaults(root, tool_xml_path, input_values)

    # Ensure any <current> that is still empty/missing gets its <default> value
    # (handles disabled widgets like workf that collectInputs skips).
    _fill_defaults_in_tree(root)

    # Prefer $RESULTSDIR (writable on nanoHUB), then tool dir, then temp.
    results_dir = os.environ.get("RESULTSDIR", "").strip()
    tool_dir = str(Path(tool_xml_path).parent)
    for candidate_dir in ([results_dir] if results_dir else []) + [tool_dir]:
        driver_path = os.path.join(candidate_dir, "driver.xml")
        try:
            tree.write(driver_path, encoding="unicode", xml_declaration=True)
            return driver_path
        except (PermissionError, OSError):
            continue
    import tempfile
    tmp = tempfile.NamedTemporaryFile(
        prefix="driver_", suffix=".xml", delete=False, mode="w"
    )
    tmp.close()
    driver_path = tmp.name
    tree.write(driver_path, encoding="unicode", xml_declaration=True)
    return driver_path


def _apply_loader_defaults(root, tool_xml_path: str, input_values: dict) -> None:
    """For each <loader> in the input tree, if its default example file exists
    and the corresponding <structure> target has not been supplied by the user,
    load the example XML and replace the <structure> element wholesale.

    This mirrors what the frontend does when a loader is pre-selected: it calls
    _applyExampleXml which sends '@@RP-XML:<structure>...</structure>' for the
    structure path.  Without this, driver.xml is missing all structure parameters
    (geometry, doping, etc.) that the binary tool reads at runtime.
    """
    import glob as _glob
    from pathlib import Path as _Path

    input_elem = root.find("input")
    if input_elem is None:
        return

    tool_dir = _Path(tool_xml_path).parent

    # Build the set of structure paths already set by the user
    user_structure_paths = {p for p in input_values if "structure" in p.lower()}

    for loader_elem in input_elem.iter("loader"):
        default_el = loader_elem.find("default")
        if default_el is None or not (default_el.text or "").strip():
            continue
        default_file = default_el.text.strip()

        # Find where the loader's <current> should go and what path it maps to.
        # Also find the sibling <structure> element the loader will populate.
        # We need to locate the example file on disk.
        example_elem = loader_elem.find("example")
        pattern = (example_elem.text.strip() if example_elem is not None and example_elem.text else "*.xml")

        # Resolve example file: try as relative path from tool_dir first (handles
        # subdirectory cases like 'examples/asd/example1.xml'), then fall back to
        # searching the pattern-derived or default examples/ directory.
        example_path = None
        candidate_direct = tool_dir / default_file
        if candidate_direct.exists():
            example_path = candidate_direct
        else:
            # Derive search dir from pattern parent
            pattern_parent = str(_Path(pattern).parent)
            if pattern_parent and pattern_parent != ".":
                search_dir = tool_dir / pattern_parent
                if not search_dir.is_dir():
                    search_dir = tool_dir
            elif (tool_dir / "examples").is_dir():
                search_dir = tool_dir / "examples"
            else:
                search_dir = tool_dir
            candidate = search_dir / _Path(default_file).name
            if candidate.exists():
                example_path = candidate

        if example_path is None or not example_path.exists():
            continue

        # Parse the example XML
        try:
            ex_tree = ET.parse(str(example_path))
        except Exception:
            continue
        ex_root = ex_tree.getroot()

        # Find all <structure> elements inside the example's <input>
        ex_input = ex_root.find("input")
        if ex_input is None:
            # The file itself may be just a run fragment starting with input's children
            ex_input = ex_root

        # Walk the example input and find structure elements; apply each to driver
        # if not already supplied by the user.
        for ex_struct in ex_input.iter("structure"):
            # Build the Rappture path for this structure element by walking up.
            # We'll find the matching structure in root by the same id.
            struct_id = ex_struct.get("id")

            # Search for this structure in the driver root by id
            for driver_struct in root.iter("structure"):
                if struct_id and driver_struct.get("id") != struct_id:
                    continue
                # Check if user already provided this structure
                # (Approximate: build path for driver_struct and check)
                already_set = any("structure" in p for p in user_structure_paths)
                if already_set:
                    break

                # Replace the driver structure with the example structure wholesale
                parent = _find_parent(root, driver_struct)
                if parent is None:
                    break
                idx = list(parent).index(driver_struct)
                parent.remove(driver_struct)
                # Deep copy the example structure element
                import copy as _copy
                new_struct = _copy.deepcopy(ex_struct)
                parent.insert(idx, new_struct)
                break


def _find_parent(root, target):
    """Return the parent element of target in the tree rooted at root."""
    for elem in root.iter():
        for child in elem:
            if child is target:
                return elem
    return None


def _fill_defaults_in_tree(root) -> None:
    """For input elements with a <default> but empty/missing <current>, fill in
    the default value.  Only operates on the <input> subtree and skips elements
    inside <structure> blocks (those are managed by _set_structure_param).
    """
    VALUE_TAGS = {"number", "integer", "string", "boolean", "choice", "loader"}
    # Only process the <input> section, not <output> or <tool>
    input_elem = root.find("input")
    if input_elem is None:
        return
    # Collect ancestor tags to skip elements inside <structure>
    for elem in input_elem.iter():
        if elem.tag not in VALUE_TAGS:
            continue
        # Skip elements that live inside a <structure> — handled separately
        # (We detect this by checking if the parent chain contains 'structure')
        # We can't easily check ancestor here, so use a conservative check:
        # if there is no <default> as a direct child, skip.
        default_el = elem.find("default")
        if default_el is None or not (default_el.text or "").strip():
            continue  # no default to fall back to
        current_el = elem.find("current")
        if current_el is None:
            current_el = ET.SubElement(elem, "current")
        # Only fill in if truly empty AND has no child elements
        # (a <current> with children belongs to a structure block)
        if len(current_el) > 0:
            continue
        current_text = (current_el.text or "").strip()
        # For number elements, treat a zero value (with or without units) as an
        # uninitialized placeholder when the default is a non-zero numeric value.
        # Rappture tool.xml often uses <current>0</current> as a "not yet set"
        # sentinel. The JS frontend appends units before submitting (e.g. "0nm"),
        # so we must match both "0" and "0<units>" forms.
        if current_text and elem.tag == "number":
            import re as _re
            # Match bare zero or zero-with-units: "0", "0nm", "0.0nm", "0.0e0nm", etc.
            # Extract the leading numeric part (int/float/sci) and check it is exactly zero.
            # "0.565nm" must NOT match because its numeric part is 0.565, not 0.
            m_num = _re.match(r'^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*\S*$', current_text)
            if m_num:
                try:
                    num_val = float(m_num.group(1))
                except ValueError:
                    num_val = None
                if num_val == 0.0:
                    default_text = default_el.text.strip()
                    # Check if default is numerically non-zero
                    m_def = _re.match(r'[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?', default_text)
                    if m_def and float(m_def.group(0)) != 0.0:
                        current_text = ""  # treat as unset; fall through to use default
        if current_text:
            continue
        value = default_el.text.strip()
        # For number elements, append units if the default is a bare number
        if elem.tag == "number":
            value = _append_units_if_needed(elem, value)
        # For choice elements, the <default> may be a label; resolve to the
        # corresponding <value> so the binary receives the internal value.
        elif elem.tag == "choice":
            value = _resolve_choice_value(elem, value)
        current_el.text = value

    # Second pass: for each <structure>, mirror its flat direct-child parameters
    # (choice, number, integer, string, boolean) into <current><parameters> so
    # that the Rappture Tcl library can read them via structure.current.parameters.(id).current
    FLAT_PARAM_TAGS = {"number", "integer", "string", "boolean", "choice"}
    for struct_elem in input_elem.iter("structure"):
        flat_children = [c for c in struct_elem if c.tag in FLAT_PARAM_TAGS and c.get("id")]
        if not flat_children:
            continue
        for child in flat_children:
            child_id = child.get("id")
            cur_el = child.find("current")
            val = (cur_el.text or "").strip() if cur_el is not None else ""
            if not val:
                dflt_el = child.find("default")
                val = (dflt_el.text or "").strip() if dflt_el is not None else ""
            if not val:
                continue
            _set_structure_param(struct_elem, child.tag, child_id, val)


def _set_xml_value(root, rappture_path: str, value: str):
    """Navigate the XML tree by Rappture path and set a <current> value.

    Special handling for structure sub-parameters: Rappture reads them from
    <structure><current><parameters><number id="..."><current>...</current>.
    When the path ends in a number/integer inside a <structure>, this function
    writes the value into the canonical Rappture location (current.parameters)
    and copies unit/label metadata from any flat sibling definition so that
    Rappture::Units::convert receives a properly unit-tagged value.

    When value starts with '@@RP-XML:', replace the target element wholesale
    with the provided XML (used by loader to replace <structure> elements).
    """
    if not rappture_path or not rappture_path.strip():
        return
    parts = _parse_path(rappture_path)
    if not parts:
        return

    # Raw XML replacement (e.g. structure loaded from example file)
    if value.startswith('@@RP-XML:'):
        raw_xml = value[len('@@RP-XML:'):]
        try:
            new_elem = ET.fromstring(raw_xml)
        except Exception:
            return
        parent = _walk_path(root, parts[:-1])
        if parent is None:
            return
        tag, eid = parts[-1]
        for i, child in enumerate(list(parent)):
            if child.tag == tag and (not eid or child.get('id') == eid):
                parent.remove(child)
                parent.insert(i, new_elem)
                return
        parent.append(new_elem)
        return

    # Detect if this path targets a sub-parameter inside a structure.
    # Pattern: [..., ('structure', sid), ('number'|'integer'|'choice'|..., pid)]
    STRUCT_PARAM_TAGS = {"number", "integer", "choice", "string", "boolean"}
    if len(parts) >= 2 and parts[-1][0] in STRUCT_PARAM_TAGS:
        # Walk to the structure element
        struct_elem = _walk_path(root, parts[:-1])
        if struct_elem is not None and struct_elem.tag == "structure":
            _set_structure_param(struct_elem, parts[-1][0], parts[-1][1], value)
            return

    # Default: navigate directly and set <current>
    elem = _walk_path(root, parts, create_missing=True)
    if elem is None:
        return
    current = elem.find("current")
    if current is None:
        current = ET.SubElement(elem, "current")
    value = _append_units_if_needed(elem, value)
    current.text = value


def _walk_path(root, parts, create_missing=False):
    """Walk an XML tree following parsed path parts; return the final element."""
    elem = root
    for tag, elem_id in parts:
        if not tag:  # guard against empty tags that would create malformed XML
            return None
        found = None
        for child in elem:
            if child.tag == tag:
                if elem_id and child.get("id") == elem_id:
                    found = child
                    break
                elif not elem_id:
                    found = child
                    break
        if found is None:
            if not create_missing:
                return None
            found = ET.SubElement(elem, tag)
            if elem_id:
                found.set("id", elem_id)
        elem = found
    return elem


def _resolve_choice_value(elem, label_or_value: str) -> str:
    """For a <choice> element, resolve a label to its corresponding <value>.

    Rappture tool.xml often stores the display label in <default> rather than
    the internal value.  This function looks up the matching <option> and
    returns the <value> text if found, otherwise returns label_or_value as-is.
    """
    candidate = label_or_value.strip()
    for option in elem.findall("option"):
        val_el = option.find("value")
        if val_el is not None and val_el.text and val_el.text.strip() == candidate:
            return candidate  # already a value
        about = option.find("about")
        if about is not None:
            lbl_el = about.find("label")
            if lbl_el is not None and lbl_el.text and lbl_el.text.strip() == candidate:
                if val_el is not None and val_el.text:
                    return val_el.text.strip()
    return candidate


def _append_units_if_needed(elem, value: str) -> str:
    """Append units to a bare numeric value for a <number> element.

    If the value already contains units, strip any space between number and
    units so Rappture::Units::convert receives e.g. '2e15/cm3' not '2e15 /cm3'.
    """
    if elem.tag != "number":
        return value
    v = value.strip()
    if not v:
        return value
    import re
    # Match a pure number (int, float, scientific notation)
    pure_num = re.fullmatch(r'[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?', v)
    if pure_num:
        # Bare number — append units from sibling <units> element if present
        units_elem = elem.find("units")
        if units_elem is not None and units_elem.text:
            units = units_elem.text.strip()
            if units:
                return f"{v}{units}"
        return v
    # Value has embedded units — remove any space between number and units
    # e.g. '2e+15 /cm3' → '2e+15/cm3', '3 um' → '3um'
    v = re.sub(r'([0-9])\s+([^0-9\s])', r'\1\2', v)
    return v


def _set_structure_param(struct_elem, param_tag: str, param_id: str, value: str):
    """Write a parameter value into <structure><current><parameters>.

    The Rappture TCL library reads structure sub-parameters from:
      structure.current.parameters.(param_id).current

    This function ensures that path exists and writes the value there,
    copying units/label/min/max/about from the flat sibling definition
    (which may exist as a direct child of <structure> from a prior loader)
    so that Rappture::Units::convert receives a unit-tagged value.
    """
    # --- Locate or build <current><parameters> inside the structure ---
    current_elem = struct_elem.find("current")
    if current_elem is None:
        current_elem = ET.SubElement(struct_elem, "current")
    # Clear legacy flat text from <current> — Rappture reads params from
    # <current><parameters>, not from the text node.
    current_elem.text = None

    params_elem = current_elem.find("parameters")
    if params_elem is None:
        params_elem = ET.SubElement(current_elem, "parameters")

    # --- Locate or create the param element inside <parameters> ---
    param_elem = None
    if param_id:
        for child in params_elem:
            if child.tag == param_tag and child.get("id") == param_id:
                param_elem = child
                break
    if param_elem is None:
        param_elem = ET.SubElement(params_elem, param_tag)
        if param_id:
            param_elem.set("id", param_id)

        # Copy metadata (about/label/units/min/max/default) from either:
        #  a) flat sibling definition (direct child of <structure>), or
        #  b) <default><parameters> definition (pntoy-style)
        source_elem = None
        if param_id:
            # a) flat sibling
            for child in struct_elem:
                if child.tag == param_tag and child.get("id") == param_id:
                    source_elem = child
                    break
            # b) <default><parameters>
            if source_elem is None:
                dflt = struct_elem.find("default")
                if dflt is not None:
                    dflt_params = dflt.find("parameters")
                    if dflt_params is not None:
                        for child in dflt_params:
                            if child.tag == param_tag and child.get("id") == param_id:
                                source_elem = child
                                break
        if source_elem is not None:
            for meta_tag in ("about", "units", "min", "max", "default", "color"):
                meta = source_elem.find(meta_tag)
                if meta is not None:
                    import copy
                    param_elem.append(copy.deepcopy(meta))

    # --- Write the <current> value ---
    # If the value already contains units (e.g. "2 nm" from the frontend),
    # use it as-is; otherwise try to append units from the <units> child.
    cur = param_elem.find("current")
    if cur is None:
        cur = ET.SubElement(param_elem, "current")
    v = value.strip()
    cur.text = _append_units_if_needed(param_elem, v)


def _parse_path(path: str) -> list[tuple[str, str]]:
    """'input.number(temperature)' → [('input',''), ('number','temperature')]"""
    parts = []
    for seg in path.split("."):
        if not seg:  # skip empty segments (e.g. from double-dots)
            continue
        if "(" in seg and seg.endswith(")"):
            tag = seg[: seg.index("(")]
            eid = seg[seg.index("(") + 1: -1]
            if tag:  # only add if tag is non-empty
                parts.append((tag, eid))
        else:
            parts.append((seg, ""))
    return parts


# ─── Run history and cache ────────────────────────────────────────────────────

class RunHistory:
    """Stores past simulation runs in memory and optionally on disk.

    Mimics the original Rappture ResultSet/Analyzer concept of keeping
    multiple numbered runs (#1, #2, ...) so the UI can browse them.
    """

    def __init__(self, cache_dir: str | None = None):
        self._runs: list[dict] = []   # ordered list, newest last
        self._cache_dir = cache_dir

    @property
    def runs(self) -> list[dict]:
        return self._runs

    def _input_hash(self, input_values: dict) -> str:
        """Stable hash of input values — used as cache key."""
        canonical = json.dumps(input_values, sort_keys=True)
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]

    def find_cached(self, input_values: dict) -> dict | None:
        """Return a previous run with identical inputs, or None."""
        h = self._input_hash(input_values)
        for run in reversed(self._runs):
            if run.get("input_hash") == h:
                return run
        return None

    def add(self, input_values: dict, outputs: dict, log: str,
            status: str = "success", run_xml: str | None = None) -> dict:
        """Record a new run and return it."""
        run_num = len(self._runs) + 1
        run = {
            "run_id": uuid.uuid4().hex[:8],
            "run_num": run_num,
            "label": f"#{run_num}",
            "timestamp": time.time(),
            "input_hash": self._input_hash(input_values),
            "inputs": dict(input_values),
            "outputs": outputs,
            "log": log,
            "status": status,
            "run_xml": run_xml,
        }
        self._runs.append(run)

        # Persist to disk if cache_dir configured
        if self._cache_dir:
            self._save_run(run)

        return run

    def _save_run(self, run: dict):
        os.makedirs(self._cache_dir, exist_ok=True)
        fname = os.path.join(self._cache_dir, f"run_{run['run_id']}.json")
        try:
            with open(fname, "w") as f:
                json.dump(run, f)
        except OSError:
            pass

    def load_from_disk(self):
        """Load previously saved runs from cache_dir."""
        if not self._cache_dir or not os.path.isdir(self._cache_dir):
            return
        files = sorted(Path(self._cache_dir).glob("run_*.json"))
        for fpath in files:
            try:
                with open(fpath) as f:
                    run = json.load(f)
                self._runs.append(run)
            except (OSError, json.JSONDecodeError):
                pass
        # Re-number (preserve custom labels)
        for i, run in enumerate(self._runs):
            run["run_num"] = i + 1

    def get_by_id(self, run_id: str) -> dict | None:
        for run in self._runs:
            if run["run_id"] == run_id:
                return run
        return None

    def update_run(self, run_id: str, **kwargs):
        """Patch fields on an existing run and re-persist to disk."""
        run = self.get_by_id(run_id)
        if run is None:
            return
        run.update(kwargs)
        if self._cache_dir:
            self._save_run(run)

    def delete(self, run_id: str) -> bool:
        """Remove a run from memory and disk. Returns True if found."""
        run = self.get_by_id(run_id)
        if run is None:
            return False
        self._runs.remove(run)
        # Re-number remaining runs (preserve custom labels)
        for i, r in enumerate(self._runs):
            r["run_num"] = i + 1
        # Remove from disk
        if self._cache_dir:
            fname = os.path.join(self._cache_dir, f"run_{run_id}.json")
            try:
                os.remove(fname)
            except OSError:
                pass
        return True

    def reorder(self, run_ids: list[str]):
        """Reorder runs to match run_ids order (first = top). Unknown ids ignored."""
        id_to_run = {r["run_id"]: r for r in self._runs}
        ordered = [id_to_run[rid] for rid in run_ids if rid in id_to_run]
        # Append any runs not in run_ids at the end
        ordered += [r for r in self._runs if r["run_id"] not in set(run_ids)]
        self._runs = ordered

    def get_by_num(self, run_num: int) -> dict | None:
        idx = run_num - 1
        if 0 <= idx < len(self._runs):
            return self._runs[idx]
        return None


# ─── UQ simulation entry point ───────────────────────────────────────────────

async def run_uq_simulation(
    tool_xml_path: str,
    input_values: dict,
    uq_inputs: dict,
    server_url: str = "",
    use_library_mode: bool = False,
    history: RunHistory | None = None,
    timeout: int = 600,
    log_callback=None,
    process_callback=None,
    inputs_override_callback=None,
) -> dict:
    """Run a UQ simulation using PUQ (Smolyak sparse grid).

    Args:
        tool_xml_path: Path to tool.xml.
        input_values: Exact input values for inputs NOT participating in UQ.
        uq_inputs: Dict keyed by Rappture path. Each value is a dict:
            { "type": "uniform", "min": <float>, "max": <float> }
            { "type": "gaussian", "mean": <float>, "std": <float>,
              "min": <float>, "max": <float> }
        server_url: URL for library mode.
        use_library_mode: If True, use rp_library mode for each run.
        history: RunHistory for storing result.
        timeout: Per-run timeout in seconds.
        log_callback: Async callable(text) for streaming log.

    Returns:
        dict with keys: status, outputs, log, run_id, run_num, cached
    """
    tool_xml_path = str(Path(tool_xml_path).resolve())
    tool_dir = str(Path(tool_xml_path).parent)
    results_dir = os.environ.get("RESULTSDIR", "").strip()
    if results_dir:
        try:
            os.makedirs(results_dir, exist_ok=True)
        except OSError:
            results_dir = ""
    work_dir = results_dir if (results_dir and os.path.isdir(results_dir)) else tool_dir

    puq_sh = _find_puq_sh()
    if puq_sh is None:
        return {
            "status": "error",
            "log": "PUQ not available (puq.sh not found). "
                   "Set RAPPTURE2WEB_PUQ_SH to the puq script path.",
            "outputs": {},
            "cached": False,
        }

    pid = uuid.uuid4().hex[:8]
    uq_work_dir = os.path.join(work_dir, f"uq_{pid}")
    os.makedirs(uq_work_dir, exist_ok=True)

    log_lines: list[str] = []

    async def _log(text: str):
        log_lines.append(text)
        if log_callback:
            await log_callback(text)

    try:
        # ── 1. Build varlist for get_params.py ─────────────────────────────────
        # varlist: list of [name, units, [dist_type, param1, ...]]
        # name must be a valid Python identifier (use path-derived name)
        varlist = []
        uq_param_names = {}  # path → sanitized name
        for path, spec in uq_inputs.items():
            # Sanitize name: use the id part of the path e.g. input.number(temp) → temp
            import re as _re
            m = _re.search(r'\(([^)]+)\)', path)
            name = m.group(1) if m else _re.sub(r'\W+', '_', path)
            uq_param_names[path] = name

            units = spec.get("units", "")
            dist_type = spec.get("type", "uniform")
            if dist_type == "uniform":
                mn = float(spec.get("min", 0))
                mx = float(spec.get("max", 1))
                varlist.append([name, units, ["uniform", mn, mx]])
            elif dist_type == "gaussian":
                mean = float(spec.get("mean", 0))
                std = float(spec.get("std", 1))
                mn = float(spec.get("min", mean - 3 * std))
                mx = float(spec.get("max", mean + 3 * std))
                # PUQ NormalParameter accepts mean, dev, min, max
                varlist.append([name, units, ["gaussian", mean, std,
                                              {"min": mn, "max": mx}]])

        varlist_json = _jpickle_dumps(varlist)
        uq_type = "smolyak"
        # smolyak_level can be set per-input spec (use first found) or default 1
        smolyak_level = str(next(
            (s.get("smolyak_level") for s in uq_inputs.values() if s.get("smolyak_level")),
            1
        ))

        # ── 2. Run get_params.py ───────────────────────────────────────────────
        await _log(f"[UQ] Running get_params with {len(varlist)} UQ parameters...\n")

        get_params_script = str(_PKG_PUQ_DIR / "get_params.py")

        # Build wrapper to set up rappture env for Python 2 PUQ
        rapp_env_file = _get_rappture_env_file()
        wrapper_get = os.path.join(uq_work_dir, ".uq_get_params.sh")
        with open(wrapper_get, "w") as wf:
            wf.write("#!/bin/sh\n")
            if os.path.isfile("/etc/environ.sh"):
                wf.write('. /etc/environ.sh\n')
                wf.write('use -e -r rappture\n')
            elif rapp_env_file:
                wf.write('. "{}"\n'.format(rapp_env_file))
            wf.write('PATH=$(echo "$PATH" | tr ":" "\\n" | grep -v anaconda | tr "\\n" ":" | sed "s/:$//")\n')
            wf.write('export PATH\n')
            wf.write(f'cd "{uq_work_dir}"\n')
            wf.write(
                f'python "{get_params_script}" '
                f'{pid} \'{varlist_json}\' '
                f'{uq_type} {smolyak_level}\n'
            )
        os.chmod(wrapper_get, 0o755)

        proc = await asyncio.create_subprocess_shell(
            wrapper_get,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=uq_work_dir,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            return {"status": "error", "log": "get_params.py timed out", "outputs": {}, "cached": False}
        if proc.returncode != 0:
            msg = err.decode("utf-8", errors="replace")
            await _log(f"[UQ] get_params failed:\n{msg}\n")
            return {"status": "error", "log": "".join(log_lines), "outputs": {}, "cached": False}

        # ── 3. Read collocation points CSV ─────────────────────────────────────
        csv_path = os.path.join(uq_work_dir, f"params{pid}.csv")
        if not os.path.exists(csv_path):
            await _log("[UQ] ERROR: params CSV not generated\n")
            return {"status": "error", "log": "".join(log_lines), "outputs": {}, "cached": False}

        with open(csv_path, newline="") as f:
            reader = csv.DictReader(f)
            collocation_rows = list(reader)

        await _log(f"[UQ] {len(collocation_rows)} collocation points to evaluate\n")

        # ── 4. Run tool for each collocation point ─────────────────────────────
        tree = ET.parse(tool_xml_path)
        root = tree.getroot()
        command_elem = root.find("tool/command")
        if command_elem is None or not command_elem.text:
            return {"status": "error", "log": "No <command> in tool.xml", "outputs": {}, "cached": False}

        base_command = command_elem.text.strip().replace("@tool", tool_dir)

        # Normalise python → python3 when python is not available
        if shutil.which("python") is None and shutil.which("python3") is not None:
            import re as _re2
            base_command = _re2.sub(r'\bpython\b', 'python3', base_command)

        run_xmls: list[str] = []  # paths to run.xml files for each collocation point

        for i, row in enumerate(collocation_rows):
            await _log(f"[UQ] Run {i + 1}/{len(collocation_rows)}\n")

            # Merge base input_values with collocation point values
            run_inputs = dict(input_values)
            for path, name in uq_param_names.items():
                col_key = f"@@{name}"
                if col_key in row:
                    val_str = row[col_key].strip()
                    run_inputs[path] = val_str

            # For library mode: update session inputs so /api/inputs returns
            # the collocation point values for this run.
            if inputs_override_callback is not None:
                inputs_override_callback(run_inputs)

            if use_library_mode and server_url:
                run_cmd = base_command.replace("@driver", server_url)
                run_driver = None
            else:
                run_driver = create_driver_xml(tool_xml_path, run_inputs)
                run_cmd = base_command.replace("@driver", run_driver)

            run_wrapper = os.path.join(uq_work_dir, f".uq_run_{i}.sh")
            with open(run_wrapper, "w") as wf:
                wf.write("#!/bin/sh\n")
                if os.path.isfile("/etc/environ.sh"):
                    wf.write('. /etc/environ.sh\n')
                    wf.write('use -e -r rappture\n')
                elif rapp_env_file:
                    wf.write('. "{}"\n'.format(rapp_env_file))
                wf.write('PATH=$(echo "$PATH" | tr ":" "\\n" | grep -v anaconda | tr "\\n" ":" | sed "s/:$//")\n')
                wf.write('export PATH\n')
                wf.write(f'cd "{work_dir}"\n')
                wf.write(run_cmd + "\n")
            os.chmod(run_wrapper, 0o755)

            proc_run = await asyncio.create_subprocess_shell(
                run_wrapper,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=work_dir,
                env=dict(os.environ),
            )
            if process_callback:
                process_callback(proc_run)
            try:
                r_out, r_err = await asyncio.wait_for(proc_run.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc_run.kill()
                await _log(f"[UQ] Run {i + 1} timed out\n")
                return {"status": "error", "log": "".join(log_lines), "outputs": {}, "cached": False}

            stdout_text = r_out.decode("utf-8", errors="replace")
            stderr_text = r_err.decode("utf-8", errors="replace")
            await _log(stdout_text)
            if stderr_text:
                await _log(stderr_text)

            # Find the run.xml written by this run
            run_xml_path = None
            for line in stdout_text.split("\n"):
                if "=RAPPTURE-RUN=>" in line:
                    run_xml_path = line.split("=RAPPTURE-RUN=>")[-1].strip()
                    if not os.path.isabs(run_xml_path):
                        run_xml_path = os.path.join(tool_dir, run_xml_path)
                    break
            if run_xml_path is None or not os.path.exists(run_xml_path):
                candidate = os.path.join(work_dir, "run.xml")
                if os.path.exists(candidate):
                    run_xml_path = candidate
            if run_xml_path is None or not os.path.exists(run_xml_path):
                run_xml_path = run_driver  # fallback

            # Copy run.xml to uq_work_dir with indexed name
            indexed_run_xml = os.path.join(uq_work_dir, f"run{i}.xml")
            if run_xml_path and os.path.exists(run_xml_path):
                import shutil as _sh
                _sh.copy(run_xml_path, indexed_run_xml)
            run_xmls.append(indexed_run_xml)

            # Clean up driver xml
            if run_driver and os.path.exists(run_driver):
                try:
                    os.remove(run_driver)
                except OSError:
                    pass

        # ── 5. Inject results + run analyze.py ───────────────────────────────
        await _log("[UQ] Injecting results into PUQ HDF5 and analyzing...\n")

        hdf5_path = os.path.join(uq_work_dir, f"puq_{pid}.hdf5")
        inject_script = str(_PKG_PUQ_DIR / "inject_results.py")
        analyze_script = str(_PKG_PUQ_DIR / "analyze.py")
        run_xmls_args = " ".join(f'"{p}"' for p in run_xmls)

        analyze_wrapper = os.path.join(uq_work_dir, ".uq_analyze.sh")
        with open(analyze_wrapper, "w") as wf:
            wf.write("#!/bin/sh\n")
            if os.path.isfile("/etc/environ.sh"):
                wf.write('. /etc/environ.sh\n')
                wf.write('use -e -r rappture\n')
            elif rapp_env_file:
                wf.write('. "{}"\n'.format(rapp_env_file))
            wf.write('PATH=$(echo "$PATH" | tr ":" "\\n" | grep -v anaconda | tr "\\n" ":" | sed "s/:$//")\n')
            wf.write('export PATH\n')
            wf.write(f'cd "{uq_work_dir}"\n')
            # Step 1: inject run results into HDF5
            wf.write(f'python "{inject_script}" "{hdf5_path}" {run_xmls_args} || exit 1\n')
            # Step 2: fit response surfaces and write run_uq.xml
            wf.write(f'python "{analyze_script}" "{hdf5_path}"\n')
        os.chmod(analyze_wrapper, 0o755)

        proc_analyze = await asyncio.create_subprocess_shell(
            analyze_wrapper,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=uq_work_dir,
        )
        try:
            a_out, a_err = await asyncio.wait_for(proc_analyze.communicate(), timeout=300)
        except asyncio.TimeoutError:
            proc_analyze.kill()
            await _log("[UQ] analyze.py timed out\n")
            return {"status": "error", "log": "".join(log_lines), "outputs": {}, "cached": False}

        await _log(a_out.decode("utf-8", errors="replace"))
        if a_err:
            await _log(a_err.decode("utf-8", errors="replace"))

        # ── 6. Parse run_uq.xml ───────────────────────────────────────────────
        run_uq_xml = os.path.join(uq_work_dir, "run_uq.xml")
        outputs = {}
        if os.path.exists(run_uq_xml):
            try:
                outputs = parse_run_xml(run_uq_xml)
                outputs["__uq__"] = {"type": "uq_flag", "value": True}
            except Exception as exc:
                await _log(f"[UQ] Error parsing run_uq.xml: {exc}\n")
        else:
            await _log("[UQ] WARNING: run_uq.xml not generated\n")

        log = "".join(log_lines)
        run_record = None
        if history is not None:
            run_record = history.add(
                input_values={"__uq_inputs__": uq_inputs, **input_values},
                outputs=outputs,
                log=log,
                status="success",
                run_xml=run_uq_xml,
            )

        return {
            "status": "success",
            "outputs": outputs,
            "log": log,
            "run_xml": run_uq_xml,
            "run_id": run_record["run_id"] if run_record else None,
            "run_num": run_record["run_num"] if run_record else None,
            "cached": False,
            "uq": True,
        }

    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        return {
            "status": "error",
            "log": "".join(log_lines) + f"\n{tb}",
            "outputs": {},
            "cached": False,
        }
    finally:
        # Clean up wrapper scripts
        for fname in Path(uq_work_dir).glob(".uq_*.sh"):
            try:
                fname.unlink()
            except OSError:
                pass


# ─── Main simulation entry point ─────────────────────────────────────────────

async def run_simulation(
    tool_xml_path: str,
    input_values: dict,
    server_url: str = "",
    use_library_mode: bool = False,
    history: RunHistory | None = None,
    use_cache: bool = True,
    timeout: int = 300,
    log_callback=None,
    process_callback=None,
    output_callback=None,
    progress_callback=None,
) -> dict:
    """Run a Rappture simulation.

    Two modes:
      - library_mode=True: pass server_url as argv[1]; the tool script uses
        rp_library to read inputs and stream outputs directly to the server.
      - library_mode=False (default): create driver.xml, run command, parse
        run.xml when done (classic mode).

    Args:
        tool_xml_path: Path to tool.xml.
        input_values: User input values keyed by Rappture path.
        server_url: URL of the running rappture2web server (for library mode).
        use_library_mode: If True, pass server_url to the command instead of driver.xml.
        history: RunHistory instance for caching.
        use_cache: If True, return cached run when inputs match.
        timeout: Max execution time in seconds.

    Returns:
        dict with keys: status, outputs, log, run_xml, run_id, cached
    """
    tool_xml_path = str(Path(tool_xml_path).resolve())
    tool_dir = str(Path(tool_xml_path).parent)
    results_dir = os.environ.get("RESULTSDIR", "").strip()
    if results_dir:
        try:
            os.makedirs(results_dir, exist_ok=True)
        except OSError:
            results_dir = ""
    work_dir = results_dir if (results_dir and os.path.isdir(results_dir)) else tool_dir

    # ── Cache check ──────────────────────────────────────────────────────────
    if use_cache and history is not None:
        cached_run = history.find_cached(input_values)
        if cached_run is not None and cached_run.get("status") != "error":
            return {
                "status": cached_run["status"],
                "outputs": cached_run["outputs"],
                "log": cached_run["log"],
                "run_xml": cached_run.get("run_xml"),
                "run_id": cached_run["run_id"],
                "run_num": cached_run["run_num"],
                "cached": True,
            }

    # ── Get command ──────────────────────────────────────────────────────────
    tree = ET.parse(tool_xml_path)
    root = tree.getroot()
    command_elem = root.find("tool/command")
    if command_elem is None or not command_elem.text:
        return {"status": "error", "log": "No <command> in tool.xml", "outputs": {}, "cached": False}

    command = command_elem.text.strip()
    command = command.replace("@tool", tool_dir)

    # Normalise python → python3 when python is not available
    if shutil.which("python") is None and shutil.which("python3") is not None:
        import re as _re
        command = _re.sub(r'\bpython\b', 'python3', command)

    driver_path = None
    wrapper_path = None

    if use_library_mode and server_url:
        # Pass server URL as argv[1]
        command = command.replace("@driver", server_url)
    else:
        # Classic mode: create driver.xml, run tool script directly
        driver_path = create_driver_xml(tool_xml_path, input_values)
        command = command.replace("@driver", driver_path)

    # On NanoHub, wrap with `submit --local` so that invoke_app/Rappture::exec
    # get the proper session context (SESSION, SESSIONDIR, HUBNAME, etc.).
    # Without this wrapper, sub-tools called via invoke_app fail because the
    # NanoHub middleware environment is not set up.
    # Build subprocess environment: inherit current env.
    proc_env = dict(os.environ)

    rapp_env_file = _get_rappture_env_file()
    if not use_library_mode:
        # Write a per-run wrapper script in work_dir so that:
        #  1. .submit.log (if submit is used) writes to work_dir (writable)
        #  2. rappture env is sourced so 'package require Rappture' works
        os.makedirs(work_dir, exist_ok=True)
        wrapper_path = os.path.join(work_dir, ".r2w_run_{}.sh".format(uuid.uuid4().hex[:8]))
        # Compute the tool's ../bin directory so scripts like run_main_*.sh
        # that live there are on PATH (tool.xml is in rappture/ or the tool
        # root; bin/ is a sibling of that directory).
        tool_bin_dir = os.path.normpath(
            os.path.join(os.path.dirname(os.path.abspath(tool_xml_path)), "..", "bin")
        )
        with open(wrapper_path, "w") as wf:
            wf.write("#!/bin/sh\n")
            if os.path.isfile("/etc/environ.sh"):
                wf.write('. /etc/environ.sh\n')
                wf.write('use -e -r rappture\n')
            elif rapp_env_file:
                wf.write('. "{}"\n'.format(rapp_env_file))
            # Remove any anaconda/conda paths from PATH so that 'python'
            # resolves to the system python2, not a conda python3.
            wf.write('PATH=$(echo "$PATH" | tr ":" "\\n" | grep -v anaconda | tr "\\n" ":" | sed "s/:$//")\n')
            # Prepend the tool's bin/ directory so that sibling scripts like
            # run_main_<tool>.sh are found without needing an absolute path.
            if os.path.isdir(tool_bin_dir):
                wf.write('PATH="{}:$PATH"\n'.format(tool_bin_dir))
            wf.write('export PATH\n')
            wf.write("cd \"{}\"\n".format(work_dir))
            wf.write(command + "\n")
        os.chmod(wrapper_path, 0o755)
        exec_command = 'cd "{}" && {}'.format(work_dir, wrapper_path)
    else:
        exec_command = command

    try:
        process = await asyncio.create_subprocess_shell(
            exec_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=work_dir,
            env=proc_env,
        )
        if process_callback is not None:
            process_callback(process)

        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []

        async def _read_stream(stream, chunks):
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                chunks.append(text)
                # Parse Rappture progress markers emitted to stdout
                stripped = text.strip()
                if "=RAPPTURE-PROGRESS=>" in stripped and progress_callback is not None:
                    try:
                        payload = stripped.split("=RAPPTURE-PROGRESS=>")[-1].strip()
                        # Format: "{percent} {message}" e.g. "42 Computing..."
                        parts = payload.split(None, 1)
                        pct = float(parts[0])
                        msg = parts[1].strip() if len(parts) > 1 else ""
                        await progress_callback(pct, msg)
                    except Exception:
                        pass
                elif log_callback is not None:
                    await log_callback(text)

        # Poll run.xml in the background to stream outputs incrementally
        _poll_done = asyncio.Event()
        _last_mtime: list[float] = [0.0]
        _streamed_outputs: set[str] = set()

        async def _poll_run_xml():
            candidates = [
                os.path.join(work_dir, "run.xml"),
                driver_path or "",
            ]
            while not _poll_done.is_set():
                await asyncio.sleep(3)
                for candidate in candidates:
                    if not candidate or not os.path.exists(candidate):
                        continue
                    try:
                        mtime = os.path.getmtime(candidate)
                    except OSError:
                        continue
                    if mtime <= _last_mtime[0]:
                        continue
                    _last_mtime[0] = mtime
                    if output_callback is None:
                        break
                    try:
                        partial_outputs = parse_run_xml(candidate)
                    except Exception:
                        break
                    for oid, odata in partial_outputs.items():
                        if oid in _streamed_outputs:
                            continue
                        _streamed_outputs.add(oid)
                        await output_callback(oid, odata)
                    break

        poll_task = asyncio.ensure_future(_poll_run_xml()) if (not use_library_mode) else None

        try:
            await asyncio.wait_for(
                asyncio.gather(
                    _read_stream(process.stdout, stdout_chunks),
                    _read_stream(process.stderr, stderr_chunks),
                ),
                timeout=timeout,
            )
            await process.wait()
        except asyncio.TimeoutError:
            process.kill()
            _poll_done.set()
            if poll_task:
                poll_task.cancel()
            return {
                "status": "error",
                "log": f"Simulation timed out after {timeout}s",
                "outputs": {},
                "cached": False,
            }
        finally:
            _poll_done.set()
            if poll_task:
                poll_task.cancel()

        stdout_text = "".join(stdout_chunks)
        stderr_text = "".join(stderr_chunks)

        # ── Parse output (classic and native rappture modes) ──────────────────
        outputs = {}
        run_xml_path = None

        if not use_library_mode:
            # Native rappture writes the run XML path to stdout as =RAPPTURE-RUN=>
            # Classic mode: the tool script writes driver.xml in place or emits the path
            for line in stdout_text.split("\n"):
                if "=RAPPTURE-RUN=>" in line:
                    run_xml_path = line.split("=RAPPTURE-RUN=>")[-1].strip()
                    if not os.path.isabs(run_xml_path):
                        run_xml_path = os.path.join(tool_dir, run_xml_path)
                    break

            if run_xml_path is None or not os.path.exists(run_xml_path):
                # Check RESULTSDIR for run.xml written by Rappture
                candidate = os.path.join(work_dir, "run.xml")
                if os.path.exists(candidate):
                    run_xml_path = candidate
                else:
                    run_xml_path = driver_path  # tool may have modified driver in place

            if run_xml_path and os.path.exists(run_xml_path):
                try:
                    outputs = parse_run_xml(run_xml_path)
                    # Some Rappture tools write logs only into <output><log>.
                    # Merge that content so the UI/run history log is not empty.
                    log_output = outputs.get("log", {})
                    xml_log = ""
                    if isinstance(log_output, dict):
                        xml_log = str(log_output.get("content", "") or "")
                    if xml_log.strip() and xml_log not in stdout_text:
                        if stdout_text and not stdout_text.endswith("\n"):
                            stdout_text += "\n"
                        stdout_text += xml_log
                        if not stdout_text.endswith("\n"):
                            stdout_text += "\n"
                        if log_callback is not None:
                            await log_callback(xml_log if xml_log.endswith("\n") else xml_log + "\n")
                except Exception as exc:
                    stderr_text += f"\nError parsing run.xml: {exc}"

        log = stdout_text
        if stderr_text:
            log += "\n--- stderr ---\n" + stderr_text

        status = "success" if process.returncode == 0 else "error"

        # ── Save to history ──────────────────────────────────────────────────
        # In library mode, api_simulate_done already records the run with
        # the actual outputs — skip adding here to avoid duplicates.
        run_record = None
        if history is not None and not use_library_mode:
            # Inject driver XML to outputs so it's visible to the user
            if driver_path and os.path.exists(driver_path):
                try:
                    with open(driver_path, 'r', encoding='utf-8') as f:
                        outputs["__driver_xml__"] = {
                            "type": "string",
                            "label": "Driver XML",
                            "current": f.read(),
                            "about": {"label": "Driver XML"}
                        }
                except Exception:
                    pass
            
            run_record = history.add(
                input_values=input_values,
                outputs=outputs,
                log=log,
                status=status,
                run_xml=run_xml_path,
            )

        return {
            "status": status,
            "returncode": process.returncode,
            "outputs": outputs,
            "log": log,
            "run_xml": run_xml_path,
            "run_id": run_record["run_id"] if run_record else None,
            "run_num": run_record["run_num"] if run_record else None,
            "cached": False,
        }

    finally:
        if driver_path and os.path.exists(driver_path):
            try:
                os.remove(driver_path)
            except OSError:
                pass
        if wrapper_path and os.path.exists(wrapper_path):
            try:
                os.remove(wrapper_path)
            except OSError:
                pass
