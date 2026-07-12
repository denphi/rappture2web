"""Fixtures for the visual/layout test suite (TODO.md §9).

Serves an example tool with uvicorn in a background thread and drives it
with Playwright Chromium at MCP-iframe-like viewport sizes.

Run with:
    .venv/bin/pytest tests/visual/ -v

Screenshots are written to tests/visual/screenshots/ for visual inspection
(the directory is gitignored).
"""
from __future__ import annotations

import socket
import threading
import time
from pathlib import Path

import pytest
import uvicorn

REPO_ROOT = Path(__file__).resolve().parents[2]
# The group example exercises tabs, nested groups, and several leaf widgets —
# a good stress test for the sidebar at narrow widths.
TOOL_XML = REPO_ROOT / "examples" / "rappture2" / "group" / "tool.xml"
SCREENSHOT_DIR = Path(__file__).parent / "screenshots"
CURVE_RUN_XML = REPO_ROOT / "examples" / "zoo" / "curve" / "test" / "defaults.xml"
FIELD_RUN_XML = REPO_ROOT / "examples" / "zoo" / "field" / "test" / "defaults.xml"
CRYSTAL_RUN_XML = REPO_ROOT / "examples" / "3D" / "run1772755170142000.xml"

# Viewport matrix from TODO.md §9 — small MCP-like frames up to a desktop
# reference size.
VIEWPORTS = [
    {"width": 360, "height": 640},
    {"width": 420, "height": 600},
    {"width": 500, "height": 500},
    {"width": 768, "height": 500},
    {"width": 1024, "height": 768},
]


def viewport_id(vp: dict) -> str:
    return f"{vp['width']}x{vp['height']}"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def server_url():
    """Run the rappture2web app with the example tool in a background thread."""
    from rappture2web.app import app, set_tool

    set_tool(str(TOOL_XML))
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 15
    while not server.started:
        if time.time() > deadline:
            raise RuntimeError("uvicorn server did not start within 15s")
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="session", autouse=True)
def _screenshot_dir() -> Path:
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    return SCREENSHOT_DIR


def load_tool_page(page, server_url: str):
    """Navigate to the tool page and wait until the layout is settled."""
    page.goto(server_url, wait_until="networkidle")
    page.wait_for_selector(".rp-layout", state="visible")
    # If a loader init overlay appeared, wait for it to be removed before
    # measuring anything (it is removed on transitionend after init).
    overlay = page.locator("#rp-init-overlay")
    if overlay.count():
        overlay.wait_for(state="detached", timeout=5000)
