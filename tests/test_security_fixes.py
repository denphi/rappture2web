"""Tests for security and robustness fixes:

  - Note HTML sanitization (XSS) and file:// path traversal containment
  - PUQ CSV header validation
  - _kill_and_wait reaping of subprocess timeouts
  - /simulate concurrency lock + sanitized error responses
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from rappture2web.xml_parser import _sanitize_note_html, parse_tool_xml


# ─── Note HTML sanitization ──────────────────────────────────────────────────

def _write_note_tool(tool_dir: Path, note_html: str) -> Path:
    (tool_dir / "note.html").write_text(note_html, encoding="utf-8")
    tool_xml = tool_dir / "tool.xml"
    tool_xml.write_text(
        """<run>
  <tool><title>T</title></tool>
  <input>
    <note id="n"><contents>file://note.html</contents></note>
  </input>
</run>""",
        encoding="utf-8",
    )
    return tool_xml


def test_sanitizer_drops_script_tags():
    s = _sanitize_note_html('<p>hi</p><script>alert(1)</script>')
    assert "<script" not in s
    assert "alert(1)" not in s  # script body suppressed
    assert "<p>hi</p>" in s


def test_sanitizer_drops_iframe():
    s = _sanitize_note_html('<iframe src="http://evil"></iframe>after')
    assert "<iframe" not in s
    assert "after" in s


def test_sanitizer_drops_event_handlers():
    s = _sanitize_note_html('<a href="https://ok" onclick="alert(1)">x</a>')
    assert "onclick" not in s
    assert 'href="https://ok"' in s


def test_sanitizer_drops_javascript_urls():
    s = _sanitize_note_html('<a href="javascript:alert(1)">x</a>')
    assert "javascript:" not in s
    # The <a> tag survives but without the href attribute.
    assert "<a>" in s or "<a >" in s


def test_sanitizer_drops_data_html_urls():
    s = _sanitize_note_html('<a href="data:text/html,<script>1</script>">x</a>')
    assert "data:text/html" not in s


def test_sanitizer_preserves_safe_markup():
    src = (
        '<h2>Title</h2>'
        '<p>Body with <strong>bold</strong> and <em>italic</em>.</p>'
        '<ul><li>a</li><li>b</li></ul>'
        '<a href="https://example.org">link</a>'
        '<img src="img.png" alt="alt">'
    )
    s = _sanitize_note_html(src)
    for needle in (
        "<h2>", "<strong>", "<em>", "<ul>", "<li>", "<a", "<img",
        'href="https://example.org"', 'src="img.png"',
    ):
        assert needle in s, f"missing: {needle!r} in {s!r}"


def test_sanitizer_strips_unknown_attributes():
    s = _sanitize_note_html('<p data-evil="x" id="ok">hi</p>')
    assert "data-evil" not in s
    assert 'id="ok"' in s


def test_note_file_xss_payload_neutralised(tmp_path):
    tool_dir = tmp_path / "tool"
    tool_dir.mkdir()
    tool_xml = _write_note_tool(
        tool_dir,
        '<p>safe</p><script>alert(1)</script><img src=x onerror="alert(1)">',
    )
    tool = parse_tool_xml(str(tool_xml))
    contents = tool.inputs[0].attrs["contents"]
    assert contents.startswith("html://")
    body = contents[len("html://"):]
    assert "<script" not in body
    assert "onerror" not in body
    assert "<p>safe</p>" in body


# ─── Note file:// path traversal ─────────────────────────────────────────────

def test_note_file_traversal_rejected(tmp_path):
    workspace = tmp_path / "workspace"
    tool_dir = workspace / "tool"
    secret_dir = workspace / "secret"
    tool_dir.mkdir(parents=True)
    secret_dir.mkdir(parents=True)
    (secret_dir / "evil.html").write_text("<p>SHOULD NOT BE READ</p>", encoding="utf-8")

    tool_xml = tool_dir / "tool.xml"
    tool_xml.write_text(
        """<run>
  <tool><title>T</title></tool>
  <input>
    <note id="n"><contents>file://../secret/evil.html</contents></note>
  </input>
</run>""",
        encoding="utf-8",
    )
    tool = parse_tool_xml(str(tool_xml))
    contents = tool.inputs[0].attrs.get("contents", "")
    # The original file:// reference should remain unchanged because the
    # resolver refused to read across the tool_dir boundary.
    assert contents == "file://../secret/evil.html"
    assert "SHOULD NOT BE READ" not in contents


def test_note_file_within_tool_dir_still_loads(tmp_path):
    tool_dir = tmp_path / "tool"
    tool_dir.mkdir()
    (tool_dir / "note.html").write_text("<p>hi</p>", encoding="utf-8")
    tool_xml = tool_dir / "tool.xml"
    tool_xml.write_text(
        """<run>
  <tool><title>T</title></tool>
  <input>
    <note id="n"><contents>file://note.html</contents></note>
  </input>
</run>""",
        encoding="utf-8",
    )
    tool = parse_tool_xml(str(tool_xml))
    contents = tool.inputs[0].attrs["contents"]
    assert contents.startswith("html://")
    assert "<p>hi</p>" in contents


# ─── _kill_and_wait ──────────────────────────────────────────────────────────

def test_kill_and_wait_reaps_running_subprocess():
    """A killed asyncio subprocess should have its returncode populated after _kill_and_wait."""
    from rappture2web.simulator import _kill_and_wait

    async def _run():
        proc = await asyncio.create_subprocess_shell(
            "sleep 30",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert proc.returncode is None
        await _kill_and_wait(proc, "sleeper")
        # After kill+wait the process has been reaped: returncode is set.
        assert proc.returncode is not None
        return proc.returncode

    rc = asyncio.get_event_loop().run_until_complete(_run()) if False else asyncio.run(_run())
    assert rc != 0  # killed → negative or non-zero


def test_kill_and_wait_handles_already_exited_process():
    """If the process exited before kill, _kill_and_wait must not raise."""
    from rappture2web.simulator import _kill_and_wait

    async def _run():
        proc = await asyncio.create_subprocess_shell(
            "true",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.wait()  # finished
        await _kill_and_wait(proc, "already done")  # must not raise
        return proc.returncode

    rc = asyncio.run(_run())
    assert rc == 0


# ─── /simulate concurrency lock + sanitized error ────────────────────────────

def test_simulate_rejects_overlapping_request(tmp_path):
    """A second /simulate request while one is running should return 409."""
    from fastapi.testclient import TestClient

    # Use a tool whose <command> sleeps long enough to overlap.
    tool_xml = tmp_path / "tool.xml"
    tool_xml.write_text(
        """<run>
  <tool>
    <title>Slow</title>
    <command>sleep 2</command>
  </tool>
  <input>
    <number id="x"><default>1</default></number>
  </input>
</run>""",
        encoding="utf-8",
    )

    from rappture2web.app import app, set_tool
    set_tool(str(tool_xml), cache_dir=str(tmp_path / "cache"), use_cache=False)
    client = TestClient(app)

    import threading
    results: dict = {}

    def _fire(key):
        results[key] = client.post("/simulate", json={"inputs": {}})

    t1 = threading.Thread(target=_fire, args=("first",))
    t1.start()
    # Tiny pause so the first request acquires the lock before the second arrives.
    import time
    time.sleep(0.2)
    second = client.post("/simulate", json={"inputs": {}})
    t1.join(timeout=10)

    # The second request must have been rejected with 409 while the first
    # was still holding the lock.
    assert second.status_code == 409
    body = second.json()
    assert "already running" in body.get("log", "").lower()


def test_simulate_error_response_does_not_leak_traceback(tmp_path):
    """When a tool run fails, the response and broadcast must contain a
    short summary, not a multi-line Python traceback."""
    from fastapi.testclient import TestClient

    # Tool with no <command> field → run_simulation returns an error result;
    # but more cleanly, point command to a missing binary so the wrapper exits
    # nonzero.  Easiest: use a command that exits 1.
    tool_xml = tmp_path / "tool.xml"
    tool_xml.write_text(
        """<run>
  <tool>
    <title>Boom</title>
    <command>this_binary_definitely_does_not_exist_12345 @driver</command>
  </tool>
  <input>
    <number id="x"><default>1</default></number>
  </input>
</run>""",
        encoding="utf-8",
    )

    from rappture2web.app import app, set_tool
    set_tool(str(tool_xml), cache_dir=str(tmp_path / "cache"), use_cache=False)
    client = TestClient(app)

    resp = client.post("/simulate", json={"inputs": {}})
    body = resp.json()
    log = body.get("log", "")
    # Regardless of the exit path the response must not include a Python
    # traceback dump.  Tracebacks contain phrases like "Traceback (most
    # recent call last)" — that's what we're guarding against in the
    # /simulate handler's error path.
    assert "Traceback (most recent call last)" not in log
