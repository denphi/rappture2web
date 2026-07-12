from __future__ import annotations

from fastapi.testclient import TestClient

from rappture2web.app import app, set_tool


def test_upload_run_disabled_on_nanohub(tmp_path):
    tool_xml = tmp_path / "tool.xml"
    tool_xml.write_text(
        "<run><tool><title>T</title></tool><input/></run>",
        encoding="utf-8",
    )
    set_tool(str(tool_xml), is_nanohub=True)
    client = TestClient(app)
    resp = client.post(
        "/api/upload-run",
        files={"file": ("run.xml", b"<run><output></output></run>", "application/xml")},
    )
    assert resp.status_code == 403
    assert "disabled on nanoHUB" in resp.json().get("error", "")
