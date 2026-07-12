"""Tests for path traversal safety in tool-files and loader-examples endpoints."""
from __future__ import annotations

from fastapi.testclient import TestClient

from rappture2web.app import app, set_tool

_MINIMAL_TOOL_XML = """\
<?xml version="1.0"?>
<run>
  <tool><title>Test</title></tool>
  <input/>
</run>
"""


def _setup(tmp_path) -> tuple:
    tool_dir = tmp_path / "tool"
    tool_dir.mkdir()
    tool_xml = tool_dir / "tool.xml"
    tool_xml.write_text(_MINIMAL_TOOL_XML, encoding="utf-8")

    # Asset file inside the tool dir
    (tool_dir / "image.png").write_bytes(b"\x89PNG")

    # Sensitive file in a sibling directory (should NOT be accessible)
    sibling = tmp_path / "secrets"
    sibling.mkdir()
    (sibling / "secret.txt").write_text("private", encoding="utf-8")

    set_tool(str(tool_xml))
    return tool_dir, sibling


def _client():
    return TestClient(app)


# ── /tool-files/<path> ────────────────────────────────────────────────────────

def test_tool_files_serves_asset(tmp_path):
    tool_dir, _ = _setup(tmp_path)
    resp = _client().get("/tool-files/image.png")
    assert resp.status_code == 200


def test_tool_files_rejects_absolute_path_escape(tmp_path):
    _setup(tmp_path)
    resp = _client().get("/tool-files/../secrets/secret.txt")
    # FastAPI / uvicorn normalises the path, but the final resolved file
    # must still be refused with 403 or 404.
    assert resp.status_code in (400, 403, 404)


def test_tool_files_rejects_double_up(tmp_path):
    _setup(tmp_path)
    resp = _client().get("/tool-files/__up__/__up__/secrets/secret.txt")
    assert resp.status_code in (403, 404)


def test_tool_files_missing_file(tmp_path):
    _setup(tmp_path)
    resp = _client().get("/tool-files/nonexistent.png")
    assert resp.status_code == 404


# ── /api/loader-examples and /api/loader-examples/<path> ─────────────────────

def test_loader_examples_list(tmp_path):
    tool_dir, _ = _setup(tmp_path)
    examples_dir = tool_dir / "examples"
    examples_dir.mkdir()
    (examples_dir / "ex1.xml").write_text("<run/>", encoding="utf-8")
    set_tool(str(tool_dir / "tool.xml"))

    resp = _client().get("/api/loader-examples")
    assert resp.status_code == 200
    files = [item["filename"] for item in resp.json()]
    assert any("ex1.xml" in f for f in files)


def test_loader_examples_file_served(tmp_path):
    tool_dir, _ = _setup(tmp_path)
    examples_dir = tool_dir / "examples"
    examples_dir.mkdir()
    (examples_dir / "ex1.xml").write_text("<run><about><label>Ex1</label></about></run>", encoding="utf-8")
    set_tool(str(tool_dir / "tool.xml"))

    resp = _client().get("/api/loader-examples/examples/ex1.xml")
    assert resp.status_code == 200
    assert "Ex1" in resp.json()["label"]


def test_loader_examples_path_traversal_rejected(tmp_path):
    tool_dir, sibling = _setup(tmp_path)
    set_tool(str(tool_dir / "tool.xml"))

    # Attempt to read the secret file via path traversal
    resp = _client().get("/api/loader-examples/../secrets/secret.txt")
    assert resp.status_code in (400, 403, 404)


def test_loader_examples_startswith_sibling_attack(tmp_path):
    """Ensure str.startswith attack is blocked: /tmp/tool-evil/ starts with /tmp/tool."""
    evil_dir = tmp_path / "tool-evil"
    evil_dir.mkdir()
    (evil_dir / "secret.txt").write_text("evil", encoding="utf-8")

    tool_dir, _ = _setup(tmp_path)
    set_tool(str(tool_dir / "tool.xml"))

    # This path, after join+resolve, would be outside tool_dir
    resp = _client().get("/api/loader-examples/../tool-evil/secret.txt")
    assert resp.status_code in (400, 403, 404)
