from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from rappture2web.app import app, set_tool
from rappture2web.xml_parser import parse_tool_xml


def _write_tool_with_note(tool_dir: Path) -> Path:
    tool_xml = tool_dir / "tool.xml"
    tool_xml.write_text(
        """<run>
  <tool><title>Note Paths</title></tool>
  <input>
    <note id="intro">
      <contents>file://note.html</contents>
    </note>
  </input>
</run>
""",
        encoding="utf-8",
    )
    return tool_xml


def test_note_relative_parent_image_rewrite(tmp_path):
    root = tmp_path / "workspace"
    tool_dir = root / "tool"
    images_dir = root / "images"
    tool_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)

    (tool_dir / "note.html").write_text(
        '<html><body><img src="../images/intro_page_picture.png"></body></html>',
        encoding="utf-8",
    )
    tool_xml = _write_tool_with_note(tool_dir)

    parsed = parse_tool_xml(str(tool_xml), base_path="/base")
    note = parsed.inputs[0]
    html = note.attrs.get("contents", "")

    assert html.startswith("html://")
    assert "/base/tool-files/__up__/images/intro_page_picture.png" in html
    assert "/tool-files/../images/" not in html


def test_tool_files_route_serves_encoded_parent_asset(tmp_path):
    root = tmp_path / "workspace"
    tool_dir = root / "tool"
    images_dir = root / "images"
    tool_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)

    (tool_dir / "note.html").write_text(
        '<html><body><img src="../images/intro_page_picture.png"></body></html>',
        encoding="utf-8",
    )
    img = images_dir / "intro_page_picture.png"
    img.write_bytes(b"fakepng")
    tool_xml = _write_tool_with_note(tool_dir)

    set_tool(str(tool_xml))
    client = TestClient(app)
    resp = client.get("/tool-files/__up__/images/intro_page_picture.png")
    assert resp.status_code == 200
    assert resp.content == b"fakepng"
