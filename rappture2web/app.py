"""FastAPI web application for Rappture tools."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import uuid
from pathlib import Path

try:
    import psutil as _psutil
except ImportError:
    _psutil = None

import mimetypes

from fastapi import FastAPI, File, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .xml_parser import ToolDef, parse_tool_xml
from .simulator import RunHistory, run_simulation, run_uq_simulation, build_driver_xml_string
from .encoding import to_data_uri, is_encoded

# ─── Global state ────────────────────────────────────────────────────────────

_tool_def: ToolDef | None = None
_tool_xml_path: str = ""

# Run history (in-memory + optional disk cache)
_history = RunHistory()

# Current simulation session (reset on each Simulate click)
_session: dict = {
    "job_id": None,
    "status": "idle",     # idle | running | done | error
    "inputs": {},
    "outputs": {},
    "log": "",
    "progress": {"percent": None, "message": ""},
    "run_id": None,
    "run_num": None,
    "cached": False,
}

# Active WebSocket connections for live streaming
_ws_clients: list[WebSocket] = []

# Currently running subprocess (set by simulator, used by /stop)
_running_process: asyncio.subprocess.Process | None = None

# Server's own URL (set by CLI for library mode)
_server_url: str = ""
_use_library_mode: bool = False
_use_cache: bool = True
_base_path: str = ""
_is_nanohub: bool = False
_nanohub_support_url: str = ""
_nanohub_terminate_url: str = ""
_nanohub_about_url: str = ""
_nanohub_questions_url: str = ""
_timeout: int | None = None
_cache_url: str = ""
_cache_write_url: str = ""

APP_DIR = Path(__file__).parent

app = FastAPI(title="Rappture2Web")
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")

templates = Jinja2Templates(directory=str(APP_DIR / "templates"))
templates.env.globals["to_data_uri"] = to_data_uri
templates.env.globals["is_encoded"] = is_encoded


def _strip_units(value: str) -> str:
    """Strip trailing unit suffix from a Rappture value string.

    '300K' → '300', '2eV' → '2', '-5eV' → '-5', '300' → '300'.
    """
    import re
    if not value:
        return value
    m = re.match(r'^([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)', value.strip())
    return m.group(1) if m else value


templates.env.filters["strip_units"] = _strip_units


# ─── Setup helpers ────────────────────────────────────────────────────────────

def set_tool(xml_path: str, cache_dir: str | None = None,
             server_url: str = "", use_library_mode: bool = False,
             use_cache: bool = True, base_path: str = "",
             is_nanohub: bool = False,
             nanohub_support_url: str = "",
             nanohub_terminate_url: str = "",
             nanohub_about_url: str = "",
             nanohub_questions_url: str = "",
             timeout: int | None = None,
             cache_url: str = "",
             cache_write_url: str = ""):
    """Configure the tool and start-up options."""
    global _tool_def, _tool_xml_path, _history, _server_url
    global _use_library_mode, _use_cache, _base_path
    global _is_nanohub
    global _nanohub_support_url, _nanohub_terminate_url
    global _nanohub_about_url, _nanohub_questions_url
    global _timeout, _cache_url, _cache_write_url

    _tool_xml_path = str(Path(xml_path).resolve())

    _use_library_mode = use_library_mode
    _use_cache = use_cache
    _base_path = base_path.rstrip("/")
    _is_nanohub = bool(is_nanohub)
    _nanohub_support_url = (nanohub_support_url or "").strip()
    _nanohub_terminate_url = (nanohub_terminate_url or "").strip()
    _nanohub_about_url = (nanohub_about_url or "").strip()
    _nanohub_questions_url = (nanohub_questions_url or "").strip()
    _timeout = timeout
    _cache_url = cache_url.strip()
    _cache_write_url = cache_write_url.strip() or _cache_url

    _tool_def = parse_tool_xml(_tool_xml_path, base_path=_base_path)
    _server_url = server_url

    _history = RunHistory(cache_dir=cache_dir)
    if cache_dir:
        _history.load_from_disk()


# ─── Broadcast helpers ────────────────────────────────────────────────────────

async def _broadcast(message: dict):
    dead = []
    for ws in _ws_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.remove(ws)


def _build_inputs_report(input_values: dict) -> dict:
    """Build a table output summarising the inputs used for a simulation run.

    Uses _tool_def to map Rappture paths to human-readable labels.
    Returns a dict in the rappture2web table format.
    """
    # Build path → label map from tool definition
    label_map: dict[str, str] = {}
    if _tool_def is not None:
        def _collect(nodes):
            for node in nodes:
                if node.path and node.label:
                    label_map[node.path] = node.label
                if node.children:
                    _collect(node.children)
        _collect(_tool_def.inputs)

    rows = []
    for path, value in sorted(input_values.items()):
        # Skip very long values (e.g. uploaded XML blobs)
        str_val = str(value) if value is not None else ""
        if len(str_val) > 500:
            str_val = str_val[:497] + "..."
        label = label_map.get(path, path)
        rows.append([label, str_val])

    return {
        "type": "table",
        "label": "Simulation Inputs",
        "about": {"label": "Simulation Inputs"},
        "columns": [
            {"label": "Parameter", "units": ""},
            {"label": "Value", "units": ""},
        ],
        "rows": rows,
    }


def _build_driver_xml_output(input_values: dict) -> dict | None:
    """Build a string output containing the driver XML for the given inputs."""
    if not _tool_xml_path:
        return None
    try:
        xml_str = build_driver_xml_string(_tool_xml_path, input_values)
        return {
            "type": "string",
            "label": "Driver XML",
            "about": {"label": "Driver XML"},
            "current": xml_str,
        }
    except Exception:
        return None


def _serialize(obj):
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _serialize(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, list):
        return [_serialize(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    return obj


# ─── Tool static files ───────────────────────────────────────────────────────

@app.get("/tool-files/{file_path:path}")
async def tool_static_file(file_path: str):
    """Serve static files from the tool directory (e.g. images in note HTML)."""
    if not _tool_xml_path:
        return Response(status_code=404)
    tool_dir = Path(_tool_xml_path).parent.resolve()
    # "__up__" keeps browser URL normalization from collapsing "/tool-files/../..."
    # while still mapping to a parent-relative filesystem path.
    raw_parts = [p for p in file_path.split("/") if p not in ("", ".")]
    up_count = sum(1 for p in raw_parts if p == "__up__")
    if up_count > 1:
        return Response(status_code=403)
    rel_parts = [".." if p == "__up__" else p for p in raw_parts]
    rel_path = "/".join(rel_parts)
    target = (tool_dir / rel_path).resolve()

    allowed_roots = [tool_dir]
    if up_count:
        allowed_roots.append(tool_dir.parent.resolve())

    allowed = False
    for root in allowed_roots:
        try:
            target.relative_to(root)
            allowed = True
            break
        except ValueError:
            continue
    if not allowed:
        return Response(status_code=403)
    if not target.exists() or not target.is_file():
        return Response(status_code=404)
    return FileResponse(str(target))


# ─── Page ────────────────────────────────────────────────────────────────────

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    if _tool_def is None:
        return HTMLResponse("<h1>No tool loaded</h1>")
    return templates.TemplateResponse("tool.html", {
        "request": request,
        "tool": _tool_def.tool,
        "inputs": _tool_def.inputs,
        "outputs": _tool_def.outputs,
        "tool_xml_path": _tool_xml_path,
        "base_path": _base_path,
        "is_nanohub": _is_nanohub,
        "nanohub_support_url": _nanohub_support_url,
        "nanohub_terminate_url": _nanohub_terminate_url,
        "nanohub_about_url": _nanohub_about_url,
        "nanohub_questions_url": _nanohub_questions_url,
    })


# ─── Simulate (browser → server) ─────────────────────────────────────────────

@app.post("/simulate")
async def simulate(request: Request):
    """Trigger a simulation from the browser Simulate button."""
    global _session, _running_process

    if _tool_def is None:
        return JSONResponse({"status": "error", "log": "No tool loaded"}, status_code=400)

    data = await request.json()
    input_values = data.get("inputs", {})
    uq_inputs = data.get("uq_inputs", {})  # UQ distribution specs keyed by Rappture path
    job_id = uuid.uuid4().hex[:8]

    _session = {
        "job_id": job_id,
        "status": "running",
        "inputs": input_values,
        "outputs": {},
        "log": "",
        "progress": {"percent": 0, "message": "Simulation started"},
        "run_id": None,
        "run_num": None,
        "cached": False,
    }
    _running_process = None
    await _broadcast({"type": "status", "status": "running", "job_id": job_id})
    await _broadcast({"type": "progress", "percent": 0, "message": "Simulation started"})

    async def _stream_log(text: str):
        _session["log"] += text
        await _broadcast({"type": "log", "text": text})

    async def _stream_output(oid: str, odata: dict):
        _session["outputs"][oid] = odata
        await _broadcast({"type": "output", "id": oid, "data": odata})

    async def _stream_progress(percent: float, message: str):
        _session["progress"] = {"percent": percent, "message": message}
        await _broadcast({"type": "progress", "percent": percent, "message": message})

    async def _stream_status(message: str):
        await _broadcast({"type": "status", "status": message})

    def _on_process(proc):
        global _running_process
        _running_process = proc

    try:
        if uq_inputs:
            # UQ mode: run with PUQ
            def _override_inputs(new_inputs: dict):
                """Update session inputs for each collocation point run (library mode)."""
                _session["inputs"] = new_inputs

            result = await run_uq_simulation(
                tool_xml_path=_tool_xml_path,
                input_values=input_values,
                uq_inputs=uq_inputs,
                server_url=_server_url,
                use_library_mode=_use_library_mode,
                history=_history,
                log_callback=_stream_log,
                process_callback=_on_process,
                inputs_override_callback=_override_inputs,
            )
        else:
            result = await run_simulation(
                tool_xml_path=_tool_xml_path,
                input_values=input_values,
                server_url=_server_url,
                use_library_mode=_use_library_mode,
                history=_history,
                use_cache=_use_cache,
                cache_url=_cache_url,
                cache_write_url=_cache_write_url,
                log_callback=_stream_log,
                process_callback=_on_process,
                output_callback=_stream_output,
                progress_callback=_stream_progress,
                status_callback=_stream_status,
                timeout=_timeout,
            )
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        print(tb)
        _running_process = None
        _session.update({"status": "error", "log": tb})
        await _broadcast({"type": "status", "status": "error", "log": tb})
        return JSONResponse({"status": "error", "log": tb}, status_code=500)
    _running_process = None

    # In library mode, api_simulate_done already recorded the run with real
    # outputs. Pull run_id/run_num from _session (set by api_simulate_done).
    if _use_library_mode and not result.get("cached"):
        result["outputs"] = _session.get("outputs", {})
        result["log"] = _session.get("log", "")
        result["run_id"] = _session.get("run_id")
        result["run_num"] = _session.get("run_num")

    _session.update({
        "status": result["status"],
        "outputs": result.get("outputs", {}),
        "log": result.get("log", ""),
        "progress": {"percent": 100, "message": "Complete"} if result["status"] == "success"
                    else _session.get("progress", {"percent": None, "message": ""}),
        "run_id": result.get("run_id"),
        "run_num": result.get("run_num"),
        "cached": result.get("cached", False),
    })

    # Inject inputs report and driver XML (only for non-library, non-cached runs —
    # library mode injects them in api_simulate_done; cached runs already have them).
    if not _use_library_mode and not result.get("cached") and result["status"] == "success":
        report = _build_inputs_report(input_values)
        result.setdefault("outputs", {})["__inputs__"] = report
        _session["outputs"]["__inputs__"] = report
        driver_out = _build_driver_xml_output(input_values)
        if driver_out:
            result["outputs"]["__driver_xml__"] = driver_out
            _session["outputs"]["__driver_xml__"] = driver_out

    # In library mode, api_simulate_done already broadcast the done message
    # with the correct outputs.  For cache hits and classic mode, broadcast now.
    if not _use_library_mode or result.get("cached"):
        await _broadcast({
            "type": "done",
            "status": result["status"],
            "outputs": result.get("outputs", {}),
            "log": result.get("log", ""),
            "run_id": result.get("run_id"),
            "run_num": result.get("run_num"),
            "cached": result.get("cached", False),
        })

    return JSONResponse(result)


# ─── Remote cache service endpoints ──────────────────────────────────────────

@app.post("/cache/request")
async def cache_request(request: Request):
    """Check cache for a matching driver XML. Returns run.xml on hit (200) or 404."""
    if _history is None:
        return Response(status_code=404)
    driver_xml = (await request.body()).decode("utf-8", errors="replace")
    if not driver_xml.strip():
        return Response(status_code=400)
    # Parse driver XML to extract input values for cache lookup
    try:
        from .simulator import create_driver_xml as _cdx  # noqa: F401 — just ensure import
        from xml.etree import ElementTree as ET
        from .xml_parser import parse_run_xml
        root = ET.fromstring(driver_xml)
        # Extract current values from driver XML as a flat dict keyed by Rappture path
        input_values: dict = {}
        def _walk(elem, parts):
            for child in elem:
                if child.tag in ("about", "default"):
                    continue
                cid = child.get("id")
                seg = f"{child.tag}({cid})" if cid else child.tag
                path = ".".join([*parts, seg])
                cur = child.find("current")
                if cur is not None and len(cur) == 0:
                    input_values[path] = (cur.text or "").strip()
                _walk(child, [*parts, seg])
        inp = root.find("input")
        if inp is not None:
            _walk(inp, ["input"])
        cached_run = _history.find_cached(input_values)
        if cached_run is None or cached_run.get("status") == "error":
            return Response(status_code=404)
        run_xml_path = cached_run.get("run_xml")
        if run_xml_path and os.path.exists(run_xml_path):
            with open(run_xml_path) as f:
                content = f.read()
            return Response(content=content, media_type="application/xml")
        return Response(status_code=404)
    except Exception:
        return Response(status_code=404)


@app.post("/cache/store")
async def cache_store(request: Request):
    """Receive a run.xml from a legacy tool and store it in run history."""
    if _history is None or _tool_xml_path is None:
        return Response(status_code=503)
    run_xml_content = (await request.body()).decode("utf-8", errors="replace")
    if not run_xml_content.strip():
        return Response(status_code=400)
    try:
        import tempfile
        from .xml_parser import parse_run_xml
        tool_dir = str(Path(_tool_xml_path).parent)
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".xml", dir=tool_dir, delete=False
        )
        tmp.write(run_xml_content)
        tmp.close()
        outputs = parse_run_xml(tmp.name)
        # Re-extract inputs from run.xml <input> section for the cache key
        from xml.etree import ElementTree as ET
        root = ET.fromstring(run_xml_content)
        input_values: dict = {}
        def _walk(elem, parts):
            for child in elem:
                if child.tag in ("about", "default"):
                    continue
                cid = child.get("id")
                seg = f"{child.tag}({cid})" if cid else child.tag
                path = ".".join([*parts, seg])
                cur = child.find("current")
                if cur is not None and len(cur) == 0:
                    input_values[path] = (cur.text or "").strip()
                _walk(child, [*parts, seg])
        inp = root.find("input")
        if inp is not None:
            _walk(inp, ["input"])
        _history.add(
            input_values=input_values,
            outputs=outputs,
            log="Cached from legacy tool run.\n",
            status="success",
            run_xml=tmp.name,
        )
        return JSONResponse({"status": "stored"})
    except Exception as exc:
        return JSONResponse({"status": "error", "detail": str(exc)}, status_code=500)


# ─── Stop (browser → server) ──────────────────────────────────────────────────

@app.post("/stop")
async def stop_simulation():
    """Kill the currently running simulation process."""
    global _running_process, _session
    proc = _running_process
    if proc is not None:
        try:
            proc.kill()
        except Exception:
            pass
        _running_process = None
    if _session.get("status") == "running":
        _session["status"] = "stopped"
        await _broadcast({"type": "status", "status": "stopped"})
        await _broadcast({"type": "done", "status": "stopped", "outputs": {}, "log": _session.get("log", ""),
                          "run_id": None, "run_num": None, "cached": False})
    return JSONResponse({"status": "stopped"})


# ─── Process stats ────────────────────────────────────────────────────────────

_cpu_last_usage: float | None = None
_cpu_last_time: float | None = None


def _read_container_cpu() -> float | None:
    """Read CPU usage from cgroups, returning a percentage since last call."""
    global _cpu_last_usage, _cpu_last_time
    import time as _time
    now = _time.monotonic()
    usage = None
    # cgroups v2
    try:
        stat = Path("/sys/fs/cgroup/cpu.stat").read_text()
        usage_us = next(
            (int(l.split()[1]) for l in stat.splitlines() if l.startswith("usage_usec")), None
        )
        if usage_us is not None:
            usage = usage_us / 1e6  # convert to seconds
    except (FileNotFoundError, ValueError):
        pass
    # cgroups v1
    if usage is None:
        try:
            usage = int(Path("/sys/fs/cgroup/cpuacct/cpuacct.usage").read_text().strip()) / 1e9
        except (FileNotFoundError, ValueError):
            pass
    if usage is None:
        return _psutil.cpu_percent() if _psutil else None
    if _cpu_last_usage is not None and _cpu_last_time is not None:
        elapsed = now - _cpu_last_time
        cpu_seconds = usage - _cpu_last_usage
        pct = round((cpu_seconds / elapsed) * 100, 1) if elapsed > 0 else 0.0
    else:
        pct = None
    _cpu_last_usage = usage
    _cpu_last_time = now
    return pct


def _read_container_mem_mb() -> float | None:
    """Read memory usage from cgroups (works inside Docker containers).
    Falls back to psutil virtual_memory if cgroups are not available."""
    # cgroups v2
    try:
        current = int(Path("/sys/fs/cgroup/memory.current").read_text().strip())
        stat = Path("/sys/fs/cgroup/memory.stat").read_text()
        inactive_file = next(
            (int(l.split()[1]) for l in stat.splitlines() if l.startswith("inactive_file")), 0
        )
        return round((current - inactive_file) / 1024 / 1024, 1)
    except (FileNotFoundError, ValueError):
        pass
    # cgroups v1
    try:
        usage = int(Path("/sys/fs/cgroup/memory/memory.usage_in_bytes").read_text().strip())
        stat = Path("/sys/fs/cgroup/memory/memory.stat").read_text()
        inactive_file = next(
            (int(l.split()[1]) for l in stat.splitlines() if l.startswith("total_inactive_file")), 0
        )
        return round((usage - inactive_file) / 1024 / 1024, 1)
    except (FileNotFoundError, ValueError):
        pass
    # fallback
    if _psutil is not None:
        mem = _psutil.virtual_memory()
        return round((mem.total - mem.available) / 1024 / 1024, 1)
    return None


@app.get("/stats")
async def get_stats():
    """Return CPU and memory usage — process stats when running, system stats otherwise."""
    if _psutil is None:
        return JSONResponse({"cpu": None, "mem_mb": None})
    try:
        cpu = _read_container_cpu()
        mem_mb = _read_container_mem_mb()
        return JSONResponse({"cpu": cpu, "mem_mb": mem_mb})
    except Exception:
        return JSONResponse({"cpu": None, "mem_mb": None})


# ─── Library mode API (used by rp_library in the tool script) ─────────────────

@app.post("/api/simulate/start")
async def api_simulate_start(request: Request):
    """Called by rp_library at the start of a run to obtain a job_id."""
    global _session
    data = await request.json()
    input_values = data.get("inputs", {})
    job_id = uuid.uuid4().hex[:8]

    _session = {
        "job_id": job_id,
        "status": "running",
        "inputs": input_values,
        "outputs": {},
        "log": "",
        "progress": {"percent": 0, "message": "Simulation started"},
        "run_id": None,
        "run_num": None,
        "cached": False,
    }
    await _broadcast({"type": "status", "status": "running", "job_id": job_id})
    await _broadcast({"type": "progress", "percent": 0, "message": "Simulation started"})
    return JSONResponse({"job_id": job_id})


@app.get("/api/inputs")
async def api_get_inputs():
    """Return current input values for the running tool script."""
    return JSONResponse(_session["inputs"])


@app.post("/api/output")
async def api_post_output(request: Request):
    """Receive and broadcast one output item from the tool script."""
    data = await request.json()
    output_id = data.get("id") or data.get("type", "output")
    _session["outputs"][output_id] = data
    await _broadcast({"type": "output", "id": output_id, "data": data})
    return JSONResponse({"ok": True})


@app.post("/api/log")
async def api_post_log(request: Request):
    """Append a log chunk from the tool script."""
    data = await request.json()
    text = data.get("text", "")
    _session["log"] += text
    await _broadcast({"type": "log", "text": text})
    return JSONResponse({"ok": True})


@app.post("/api/progress")
async def api_post_progress(request: Request):
    """Receive and broadcast simulation progress updates."""
    data = await request.json()
    percent_raw = data.get("percent", data.get("pct", 0))
    message = str(data.get("message", "")).strip()
    try:
        percent = float(percent_raw)
    except (TypeError, ValueError):
        percent = 0.0
    percent = max(0.0, min(100.0, percent))

    _session["progress"] = {"percent": percent, "message": message}
    if _session.get("status") != "running":
        _session["status"] = "running"

    await _broadcast({
        "type": "progress",
        "percent": percent,
        "message": message,
    })
    return JSONResponse({"ok": True})


@app.post("/api/simulate/done")
async def api_simulate_done(request: Request):
    """Called by rp_library when the simulation completes."""
    data = await request.json()
    status = data.get("status", "success")
    _session["status"] = status
    if status == "success":
        _session["progress"] = {"percent": 100.0, "message": "Complete"}

    # Inject inputs report and driver XML into outputs
    _session["outputs"]["__inputs__"] = _build_inputs_report(_session["inputs"])
    driver_out = _build_driver_xml_output(_session["inputs"])
    if driver_out:
        _session["outputs"]["__driver_xml__"] = driver_out

    # Record in history
    run_record = _history.add(
        input_values=_session["inputs"],
        outputs=_session["outputs"],
        log=_session["log"],
        status=status,
    )
    _session["run_id"] = run_record["run_id"]
    _session["run_num"] = run_record["run_num"]

    await _broadcast({
        "type": "done",
        "status": status,
        "outputs": _session["outputs"],
        "log": _session["log"],
        "run_id": run_record["run_id"],
        "run_num": run_record["run_num"],
        "cached": False,
    })
    return JSONResponse({"ok": True})


@app.get("/api/outputs")
async def api_get_outputs():
    """Return current session outputs (polling fallback)."""
    return JSONResponse({
        "status": _session["status"],
        "progress": _session.get("progress", {"percent": None, "message": ""}),
        "outputs": _session["outputs"],
        "log": _session["log"],
    })


# ─── Loader examples endpoint ────────────────────────────────────────────────

def _resolve_loader_examples(tool_dir: Path, pattern: str):
    """Glob for loader example files relative to tool_dir.

    Supports recursive patterns like 'examples/**/*.xml' or simple globs
    like '*.xml' or 'examples/asd*.xml'.  Returns a list of Path objects;
    each path is absolute but guaranteed to be under tool_dir.

    Search order:
      1. tool_dir / pattern  (treat pattern as relative glob from tool root)
      2. tool_dir / "examples" / pattern_name  (legacy flat examples/ dir)
      3. tool_dir / pattern_name  (fallback flat search in tool_dir)
    """
    tool_dir = tool_dir.resolve()
    results = []
    seen: set[Path] = set()

    def _add(p: Path):
        rp = p.resolve()
        if rp in seen or not str(rp).startswith(str(tool_dir)):
            return
        if rp.name == "tool.xml" or not rp.is_file():
            return
        seen.add(rp)
        results.append(rp)

    # 1. Glob from tool_dir using the full pattern (handles subdirs and **)
    #    If the pattern has no path separator, restrict to examples/ to avoid
    #    picking up files (e.g. tool.xml, driver.xml) sitting in tool_dir root.
    if "/" not in pattern and "\\" not in pattern:
        ex_dir = tool_dir / "examples"
        if ex_dir.is_dir():
            for p in sorted(ex_dir.glob("**/" + pattern)):
                _add(p)
        # Fallback: glob from tool_dir only if examples/ found nothing
        if not results:
            for p in sorted(tool_dir.glob(pattern)):
                _add(p)
    else:
        if not pattern.startswith("examples/"):
            pattern = "examples/" + pattern
        for p in sorted(tool_dir.glob(pattern)):
            _add(p)

    return results


@app.get("/api/loader-examples")
async def api_loader_examples(pattern: str = "*.xml"):
    """Return list of example XML files for loader widgets."""
    if _tool_xml_path is None:
        return JSONResponse([])
    tool_dir = Path(_tool_xml_path).parent
    from xml.etree import ElementTree as ET
    results = []
    for fpath in _resolve_loader_examples(tool_dir, pattern):
        # Use path relative to tool_dir as the filename key so subdirs are preserved
        try:
            rel = fpath.relative_to(tool_dir.resolve())
        except ValueError:
            rel = Path(fpath.name)
        label = fpath.stem
        try:
            tree = ET.parse(fpath)
            root = tree.getroot()
            about = root.find(".//about")
            if about is not None:
                lbl = about.findtext("label")
                if lbl:
                    label = lbl.strip()
        except Exception:
            pass
        results.append({"filename": str(rel), "label": label})
    return JSONResponse(results)


@app.get("/api/loader-examples/{filename:path}")
async def api_loader_example_file(filename: str, pattern: str = "*.xml"):
    """Return the content of a specific example XML file."""
    if _tool_xml_path is None:
        return JSONResponse({"error": "No tool loaded"}, status_code=404)
    tool_dir = Path(_tool_xml_path).parent.resolve()
    # filename may be a relative path like 'examples/asd/example1.xml'
    fpath = (tool_dir / filename).resolve()
    # Safety: ensure file is within tool_dir
    if not str(fpath).startswith(str(tool_dir)):
        return JSONResponse({"error": "Invalid path"}, status_code=403)
    if not fpath.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)
    content = fpath.read_text()
    label = fpath.stem
    try:
        from xml.etree import ElementTree as ET
        root = ET.fromstring(content)
        about = root.find(".//about")
        if about is not None:
            lbl = about.findtext("label")
            if lbl:
                label = lbl.strip()
    except Exception:
        pass
    return JSONResponse({"content": content, "label": label})


# ─── Run history endpoints ────────────────────────────────────────────────────

@app.get("/api/runs")
async def api_get_runs():
    """Return list of all past runs (excluding raw outputs for brevity)."""
    summary = []
    for run in _history.runs:
        xml_path = run.get("run_xml")
        summary.append({
            "run_id": run["run_id"],
            "run_num": run["run_num"],
            "label": run["label"],
            "timestamp": run["timestamp"],
            "status": run["status"],
            "cached": False,
            "inputs": run["inputs"],
            "source": run.get("source", "simulated"),
            "has_xml": bool(xml_path and os.path.isfile(xml_path)),
        })
    return JSONResponse(summary)


@app.get("/api/runs/{run_id}")
async def api_get_run(run_id: str):
    """Return full data for a specific past run."""
    run = _history.get_by_id(run_id)
    if run is None:
        return JSONResponse({"error": "Run not found"}, status_code=404)
    return JSONResponse(run)


@app.delete("/api/runs/{run_id}")
async def api_delete_run(run_id: str):
    """Delete a run from history."""
    if _history.delete(run_id):
        return JSONResponse({"ok": True})
    return JSONResponse({"error": "Run not found"}, status_code=404)


@app.patch("/api/runs/{run_id}")
async def api_rename_run(run_id: str, request: Request):
    """Rename a run label."""
    data = await request.json()
    label = data.get("label", "").strip()
    if not label:
        return JSONResponse({"error": "Label cannot be empty"}, status_code=400)
    run = _history.get_by_id(run_id)
    if run is None:
        return JSONResponse({"error": "Run not found"}, status_code=404)
    _history.update_run(run_id, label=label)
    return JSONResponse({"ok": True})


@app.post("/api/runs/{run_id}/reload")
async def api_reload_run(run_id: str):
    """Re-parse the run XML and update cached outputs."""
    from .xml_parser import parse_run_xml
    run = _history.get_by_id(run_id)
    if run is None:
        return JSONResponse({"error": "Run not found"}, status_code=404)
    xml_path = run.get("run_xml")
    if not xml_path or not os.path.isfile(xml_path):
        return JSONResponse({"error": "Run XML file not found"}, status_code=404)
    try:
        outputs = parse_run_xml(xml_path)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to parse XML: {exc}"}, status_code=400)
    _history.update_run(run_id, outputs=outputs)
    return JSONResponse({"ok": True})


@app.post("/api/runs/reload-all")
async def api_reload_all_runs():
    """Re-parse run XMLs for all runs that have a run_xml path."""
    from .xml_parser import parse_run_xml
    reloaded, skipped = 0, 0
    for run in _history.runs:
        xml_path = run.get("run_xml")
        if not xml_path or not os.path.isfile(xml_path):
            skipped += 1
            continue
        try:
            outputs = parse_run_xml(xml_path)
            _history.update_run(run["run_id"], outputs=outputs)
            reloaded += 1
        except Exception:
            skipped += 1
    return JSONResponse({"ok": True, "reloaded": reloaded, "skipped": skipped})


@app.post("/api/runs/reorder")
async def api_reorder_runs(request: Request):
    """Reorder runs. Body: {run_ids: [id, id, ...]} — first = top."""
    data = await request.json()
    run_ids = data.get("run_ids", [])
    _history.reorder(run_ids)
    return JSONResponse({"ok": True})


# ─── Upload run XML ───────────────────────────────────────────────────────────

@app.post("/api/upload-run")
async def api_upload_run(file: UploadFile = File(...)):
    """Accept an uploaded run.xml, parse its outputs, and add to history."""
    import tempfile
    from .xml_parser import parse_run_xml

    if _is_nanohub:
        return JSONResponse({"error": "Upload XML is disabled on nanoHUB"}, status_code=403)

    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        outputs = parse_run_xml(tmp_path)
    except Exception as exc:
        os.unlink(tmp_path)
        return JSONResponse({"error": f"Failed to parse XML: {exc}"}, status_code=400)

    # Persist the XML so it can be re-parsed on reload; store in cache_dir if available
    label = Path(file.filename).stem if file.filename else "uploaded"
    saved_xml_path = None
    if _history._cache_dir:
        os.makedirs(_history._cache_dir, exist_ok=True)
        saved_xml_path = os.path.join(_history._cache_dir, f"upload_{label}_{os.path.basename(tmp_path)}")
        try:
            os.rename(tmp_path, saved_xml_path)
        except OSError:
            os.unlink(tmp_path)
            saved_xml_path = None
    else:
        os.unlink(tmp_path)

    run_record = _history.add(
        input_values={},
        outputs=outputs,
        log="",
        status="success",
        run_xml=saved_xml_path,
    )
    _history.update_run(run_record["run_id"], label=label, source="upload")

    await _broadcast({
        "type": "done",
        "status": "success",
        "outputs": outputs,
        "log": "",
        "run_id": run_record["run_id"],
        "run_num": run_record["run_num"],
        "cached": False,
        "source": "upload",
    })
    return JSONResponse({"ok": True, "run_id": run_record["run_id"], "run_num": run_record["run_num"]})


# ─── Tool metadata ────────────────────────────────────────────────────────────

@app.get("/api/tool")
async def get_tool_info():
    if _tool_def is None:
        return JSONResponse({"error": "No tool loaded"}, status_code=400)
    return JSONResponse(_serialize({"tool": _tool_def.tool, "inputs": _tool_def.inputs}))


# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.append(ws)
    # Send current state on connect
    await ws.send_json({
        "type": "state",
        "status": _session["status"],
        "progress": _session.get("progress", {"percent": None, "message": ""}),
        "outputs": _session["outputs"],
        "log": _session["log"],
        "runs": [
            {"run_id": r["run_id"], "run_num": r["run_num"],
             "label": r["label"], "status": r["status"],
             "source": r.get("source", "simulated")}
            for r in _history.runs
        ],
    })
    try:
        while True:
            await ws.receive_text()  # keep alive; client pings
    except WebSocketDisconnect:
        if ws in _ws_clients:
            _ws_clients.remove(ws)
