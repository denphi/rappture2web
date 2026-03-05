"""Simulation runner: executes tool command, manages run history and cache."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from xml.etree import ElementTree as ET

from .xml_parser import parse_run_xml


# ─── Rappture binary detection ────────────────────────────────────────────────

def _find_rappture_binary() -> str | None:
    """Return the path to the 'rappture' executable, or None if not found."""
    return shutil.which("rappture")


# ─── Driver XML helpers ───────────────────────────────────────────────────────

def create_driver_xml(tool_xml_path: str, input_values: dict) -> str:
    """Create a driver.xml from tool.xml with user input values filled in.

    Returns the path to the created driver file.
    """
    tree = ET.parse(tool_xml_path)
    root = tree.getroot()

    for path, value in input_values.items():
        _set_xml_value(root, path, str(value))

    tool_dir = str(Path(tool_xml_path).parent)
    job_id = uuid.uuid4().hex[:8]
    driver_path = os.path.join(tool_dir, f"driver_{job_id}.xml")
    tree.write(driver_path, encoding="unicode", xml_declaration=True)
    return driver_path


def _set_xml_value(root, rappture_path: str, value: str):
    """Navigate the XML tree by Rappture path and set a <current> value."""
    parts = _parse_path(rappture_path)
    elem = root
    for tag, elem_id in parts:
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
            found = ET.SubElement(elem, tag)
            if elem_id:
                found.set("id", elem_id)
        elem = found
    current = elem.find("current")
    if current is None:
        current = ET.SubElement(elem, "current")
    # For number elements, ensure units are appended so Rappture::Units::convert works.
    # The web UI strips units from the display value; we restore them here.
    if elem.tag == "number":
        units_elem = elem.find("units")
        if units_elem is not None and units_elem.text:
            units = units_elem.text.strip()
            v = value.strip()
            # Append units only if the value is a bare number (ends with digit or '.')
            if v and (v[-1].isdigit() or v[-1] == '.'):
                value = f"{v} {units}"
    current.text = value


def _parse_path(path: str) -> list[tuple[str, str]]:
    """'input.number(temperature)' → [('input',''), ('number','temperature')]"""
    parts = []
    for seg in path.split("."):
        if "(" in seg and seg.endswith(")"):
            tag = seg[: seg.index("(")]
            eid = seg[seg.index("(") + 1: -1]
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

    # ── Cache check ──────────────────────────────────────────────────────────
    if use_cache and history is not None:
        cached_run = history.find_cached(input_values)
        if cached_run is not None:
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

    if use_library_mode and server_url:
        # Pass server URL as argv[1]
        command = command.replace("@driver", server_url)
    else:
        # Classic mode: create driver.xml, run tool script directly
        driver_path = create_driver_xml(tool_xml_path, input_values)
        command = command.replace("@driver", driver_path)

    exec_command = command

    # ── Execute ──────────────────────────────────────────────────────────────
    try:
        process = await asyncio.create_subprocess_shell(
            exec_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=tool_dir,
        )

        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []

        async def _read_stream(stream, chunks):
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                chunks.append(text)
                if log_callback is not None:
                    await log_callback(text)

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
            return {
                "status": "error",
                "log": f"Simulation timed out after {timeout}s",
                "outputs": {},
                "cached": False,
            }

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
                run_xml_path = driver_path  # tool may have modified driver in place

            if run_xml_path and os.path.exists(run_xml_path):
                try:
                    outputs = parse_run_xml(run_xml_path)
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
