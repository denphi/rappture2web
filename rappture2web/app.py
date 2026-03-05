"""FastAPI web application for Rappture tools."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import uuid
from pathlib import Path

import mimetypes

from fastapi import FastAPI, File, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .xml_parser import ToolDef, parse_tool_xml
from .simulator import RunHistory, run_simulation
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
    "run_id": None,
    "run_num": None,
    "cached": False,
}

# Active WebSocket connections for live streaming
_ws_clients: list[WebSocket] = []

# Server's own URL (set by CLI for library mode)
_server_url: str = ""
_use_library_mode: bool = False
_use_cache: bool = True
_base_path: str = ""
_nanohub_support_url: str = ""
_nanohub_terminate_url: str = ""

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
             nanohub_support_url: str = "",
             nanohub_terminate_url: str = ""):
    """Configure the tool and start-up options."""
    global _tool_def, _tool_xml_path, _history, _server_url
    global _use_library_mode, _use_cache, _base_path
    global _nanohub_support_url, _nanohub_terminate_url

    _tool_xml_path = str(Path(xml_path).resolve())

    _use_library_mode = use_library_mode
    _use_cache = use_cache
    _base_path = base_path.rstrip("/")
    _nanohub_support_url = (nanohub_support_url or "").strip()
    _nanohub_terminate_url = (nanohub_terminate_url or "").strip()

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
    tool_dir = Path(_tool_xml_path).parent
    target = (tool_dir / file_path).resolve()
    # Security: ensure the resolved path stays within tool_dir
    try:
        target.relative_to(tool_dir.resolve())
    except ValueError:
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
        "nanohub_support_url": _nanohub_support_url,
        "nanohub_terminate_url": _nanohub_terminate_url,
    })


# ─── Simulate (browser → server) ─────────────────────────────────────────────

@app.post("/simulate")
async def simulate(request: Request):
    """Trigger a simulation from the browser Simulate button."""
    global _session

    if _tool_def is None:
        return JSONResponse({"status": "error", "log": "No tool loaded"}, status_code=400)

    data = await request.json()
    input_values = data.get("inputs", {})
    job_id = uuid.uuid4().hex[:8]

    _session = {
        "job_id": job_id,
        "status": "running",
        "inputs": input_values,
        "outputs": {},
        "log": "",
        "run_id": None,
        "run_num": None,
        "cached": False,
    }
    await _broadcast({"type": "status", "status": "running", "job_id": job_id})

    async def _stream_log(text: str):
        _session["log"] += text
        await _broadcast({"type": "log", "text": text})

    result = await run_simulation(
        tool_xml_path=_tool_xml_path,
        input_values=input_values,
        server_url=_server_url,
        use_library_mode=_use_library_mode,
        history=_history,
        use_cache=_use_cache,
        log_callback=_stream_log,
    )

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
        "run_id": result.get("run_id"),
        "run_num": result.get("run_num"),
        "cached": result.get("cached", False),
    })

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
        "run_id": None,
        "run_num": None,
        "cached": False,
    }
    await _broadcast({"type": "status", "status": "running", "job_id": job_id})
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


@app.post("/api/simulate/done")
async def api_simulate_done(request: Request):
    """Called by rp_library when the simulation completes."""
    data = await request.json()
    status = data.get("status", "success")
    _session["status"] = status

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
        "outputs": _session["outputs"],
        "log": _session["log"],
    })


# ─── Loader examples endpoint ────────────────────────────────────────────────

def _loader_search_dir(tool_dir: Path, pattern: str) -> Path:
    """Return the directory to search for loader examples.

    If the pattern contains a path prefix (e.g. 'examples/*.xml'), use that
    subdirectory.  If an 'examples/' subdir exists, prefer it.  Otherwise
    fall back to tool_dir itself.
    """
    from pathlib import PurePosixPath
    parent = str(PurePosixPath(pattern).parent)
    if parent and parent != ".":
        candidate = tool_dir / parent
        if candidate.is_dir():
            return candidate
    if (tool_dir / "examples").is_dir():
        return tool_dir / "examples"
    return tool_dir


@app.get("/api/loader-examples")
async def api_loader_examples(pattern: str = "*.xml"):
    """Return list of example XML files for loader widgets."""
    if _tool_xml_path is None:
        return JSONResponse([])
    tool_dir = Path(_tool_xml_path).parent
    search_dir = _loader_search_dir(tool_dir, pattern)
    from xml.etree import ElementTree as ET
    glob_pattern = Path(pattern).name  # just the filename glob part
    results = []
    for fpath in sorted(search_dir.glob(glob_pattern)):
        if fpath.name == "tool.xml":
            continue
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
        results.append({"filename": fpath.name, "label": label})
    return JSONResponse(results)


@app.get("/api/loader-examples/{filename}")
async def api_loader_example_file(filename: str, pattern: str = "*.xml"):
    """Return the content of a specific example XML file."""
    if _tool_xml_path is None:
        return JSONResponse({"error": "No tool loaded"}, status_code=404)
    tool_dir = Path(_tool_xml_path).parent
    search_dir = _loader_search_dir(tool_dir, pattern)
    fpath = (search_dir / filename).resolve()
    # Safety: ensure file is within tool_dir
    if not str(fpath).startswith(str(tool_dir.resolve())):
        return JSONResponse({"error": "Invalid path"}, status_code=403)
    if not fpath.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse({"content": fpath.read_text()})


# ─── Run history endpoints ────────────────────────────────────────────────────

@app.get("/api/runs")
async def api_get_runs():
    """Return list of all past runs (excluding raw outputs for brevity)."""
    summary = []
    for run in _history.runs:
        summary.append({
            "run_id": run["run_id"],
            "run_num": run["run_num"],
            "label": run["label"],
            "timestamp": run["timestamp"],
            "status": run["status"],
            "cached": False,
            "inputs": run["inputs"],
            "source": run.get("source", "simulated"),
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

    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        outputs = parse_run_xml(tmp_path)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to parse XML: {exc}"}, status_code=400)
    finally:
        os.unlink(tmp_path)

    run_record = _history.add(
        input_values={},
        outputs=outputs,
        log="",
        status="success",
    )
    label = Path(file.filename).stem if file.filename else "uploaded"
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
