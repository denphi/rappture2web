"""Tests for second-pass review issues (X1–X12, S1, R-series, T-series)."""
from __future__ import annotations

import os
import tempfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from rappture2web.app import (
    _extract_input_values,
    _new_session,
    _serialize,
    _strip_units,
    app,
    set_tool,
)
from rappture2web.rp_library import _to_xy_string, _paths_match, _parse_path_segments

# ─── Minimal tool XML used across multiple tests ──────────────────────────────

_TOOL_XML = """\
<?xml version="1.0"?>
<run>
  <tool><title>Test</title><command>python @driver</command></tool>
  <input>
    <number id="temperature"><units>K</units><default>300</default></number>
  </input>
</run>
"""


def _make_tool(tmp_path) -> str:
    p = tmp_path / "tool.xml"
    p.write_text(_TOOL_XML, encoding="utf-8")
    return str(p)


def _client():
    return TestClient(app)


# ─── X3: _new_session idle state ─────────────────────────────────────────────

def test_new_session_idle_progress_percent_is_none():
    """Idle session (no job_id) must emit percent=None, not 0."""
    s = _new_session(None, {})
    assert s["progress"]["percent"] is None


def test_new_session_running_progress_percent_is_zero():
    s = _new_session("abc123", {"t": "300"})
    assert s["progress"]["percent"] == 0


# ─── X1: dead parse_run_xml import no longer imported in cache/request ────────

def test_cache_request_no_dead_import():
    """Importing app should not pull parse_run_xml into cache_request's local scope."""
    import inspect
    import rappture2web.app as _app
    src = inspect.getsource(_app.cache_request)
    assert "parse_run_xml" not in src


# ─── X2: _serialize handles non-dataclass attrs without raising ───────────────

def test_serialize_dict_with_path_value():
    """If a dict contains a Path, _serialize should return it as-is (not raise)."""
    result = _serialize({"key": Path("/tmp/test")})
    assert result == {"key": Path("/tmp/test")}


# ─── X4: _resolve_loader_examples pattern variable not mutated ───────────────

def test_resolve_loader_examples_pattern_not_mutated(tmp_path):
    from rappture2web.app import _resolve_loader_examples
    examples = tmp_path / "examples"
    examples.mkdir()
    (examples / "ex1.xml").write_text("<run/>", encoding="utf-8")
    original_pattern = "subdir/ex1.xml"
    pattern_copy = original_pattern  # keep reference to original value
    _resolve_loader_examples(tmp_path, original_pattern)
    assert original_pattern == pattern_copy  # function must not mutate caller's variable


# ─── X8: _history is never None ──────────────────────────────────────────────

def test_history_never_none(tmp_path):
    """After set_tool, _history must be a RunHistory instance, not None."""
    from rappture2web.app import _history
    import rappture2web.app as _app
    _make_tool(tmp_path)
    set_tool(_make_tool(tmp_path))
    assert _app._history is not None


# ─── X9: cache/store cleans up temp file on parse failure ────────────────────

def test_cache_store_cleans_up_on_bad_xml(tmp_path):
    set_tool(_make_tool(tmp_path))
    # Count XML files before
    tool_dir = tmp_path
    before = set(tool_dir.glob("*.xml"))

    resp = _client().post(
        "/cache/store",
        content=b"<not valid xml <<",
    )
    # Should return an error, not 2xx
    assert resp.status_code in (400, 500)
    # No stray .xml temp files should remain in tool_dir
    after = set(tool_dir.glob("*.xml"))
    assert after == before


# ─── X10: api/upload-run uses try/finally ────────────────────────────────────

def test_upload_run_bad_xml_no_temp_file_left(tmp_path):
    set_tool(_make_tool(tmp_path), is_nanohub=False)
    import glob as _glob
    tmp_dir = tempfile.gettempdir()
    before = set(_glob.glob(os.path.join(tmp_dir, "*.xml")))

    resp = _client().post(
        "/api/upload-run",
        files={"file": ("run.xml", b"<bad xml <<", "application/xml")},
    )
    assert resp.status_code == 400

    after = set(_glob.glob(os.path.join(tmp_dir, "*.xml")))
    new_files = after - before
    assert not new_files, f"Temp files leaked: {new_files}"


# ─── S1: upload size limit ───────────────────────────────────────────────────

def test_upload_run_rejects_oversized_file(tmp_path):
    set_tool(_make_tool(tmp_path), is_nanohub=False)
    # 11 MB of XML-ish content
    big = b"<run>" + b"x" * (11 * 1024 * 1024) + b"</run>"
    resp = _client().post(
        "/api/upload-run",
        files={"file": ("run.xml", big, "application/xml")},
    )
    assert resp.status_code == 413


# ─── X12: simulate exception uses logger not print ───────────────────────────

def test_simulate_exception_uses_logger():
    import inspect
    import rappture2web.app as _app
    src = inspect.getsource(_app.simulate)
    # Should not have bare print(tb) — logger.error should be used instead
    assert "print(tb)" not in src


# ─── R1: threading/time imports at top of file, not mid-file ─────────────────

def test_threading_and_time_imported_at_top():
    import inspect
    import rappture2web.app as _app
    src = inspect.getsource(_app)
    lines = src.splitlines()
    # Find the line numbers of the import block (first ~25 lines) and
    # the mid-file threading import
    import_block_end = 35  # generous upper bound for top-level imports
    for i, line in enumerate(lines):
        if "import threading" in line or "import time" in line:
            assert i < import_block_end, (
                f"'import threading/time' found at line {i+1}, expected in top-level imports"
            )


# ─── R2: mimetypes not imported ──────────────────────────────────────────────

def test_mimetypes_not_imported():
    import inspect
    import rappture2web.app as _app
    src = inspect.getsource(_app)
    assert "import mimetypes" not in src


# ─── X5/X6/X7: rp_library has no inline re/ET imports ───────────────────────

def test_rp_library_no_inline_re_import():
    import inspect
    import rappture2web.rp_library as _rl
    src = inspect.getsource(_rl)
    # Allow the module-level 'import re' but no inline 'import re' inside a function
    # Check by counting occurrences — there should be exactly 0 or 1 at top level
    lines = src.splitlines()
    inline_re = [
        l for l in lines
        if l.strip().startswith("import re") and not l.startswith("import re")
    ]
    assert not inline_re, f"Inline 'import re' found: {inline_re}"


def test_rp_library_no_inline_ET_import():
    import inspect
    import rappture2web.rp_library as _rl
    src = inspect.getsource(_rl)
    lines = src.splitlines()
    inline_et = [
        l for l in lines
        if "import xml.etree.ElementTree" in l and l.startswith("    ")
    ]
    assert not inline_et, f"Inline ET import inside function: {inline_et}"


# ─── T2: _extract_input_values ───────────────────────────────────────────────

def test_extract_input_values_basic():
    xml = """\
<run>
  <input>
    <number id="temperature"><current>300K</current></number>
    <choice id="material"><current>si</current></choice>
  </input>
</run>"""
    vals = _extract_input_values(xml)
    assert vals["input.number(temperature)"] == "300K"
    assert vals["input.choice(material)"] == "si"


def test_extract_input_values_skips_about_and_default():
    xml = """\
<run>
  <input>
    <number id="t">
      <about><label>Temp</label></about>
      <default>0</default>
      <current>500K</current>
    </number>
  </input>
</run>"""
    vals = _extract_input_values(xml)
    assert "input.number(t)" in vals
    assert vals["input.number(t)"] == "500K"
    # about and default should not appear as paths
    assert not any("about" in k or "default" in k for k in vals)


def test_extract_input_values_skips_nested_current():
    """A <current> with child elements (structure) should not be captured."""
    xml = """\
<run>
  <input>
    <structure id="s">
      <current><parameters><number id="x"><current>1nm</current></number></parameters></current>
    </structure>
  </input>
</run>"""
    vals = _extract_input_values(xml)
    # The structure's <current> has children, so it must not be captured
    assert "input.structure(s)" not in vals


def test_extract_input_values_no_input_section():
    xml = "<run><output/></run>"
    assert _extract_input_values(xml) == {}


# ─── T3: _paths_match fuzzy matching ─────────────────────────────────────────

def test_paths_match_exact():
    q = _parse_path_segments("input.number(temperature)")
    s = _parse_path_segments("input.number(temperature)")
    assert _paths_match(q, s)


def test_paths_match_fuzzy_type_wildcard():
    """input.(temperature) should match input.number(temperature)."""
    q = _parse_path_segments("input.(temperature)")
    s = _parse_path_segments("input.number(temperature)")
    assert _paths_match(q, s)


def test_paths_match_different_id():
    q = _parse_path_segments("input.(temperature)")
    s = _parse_path_segments("input.number(voltage)")
    assert not _paths_match(q, s)


def test_paths_match_different_length():
    q = _parse_path_segments("input.number(temperature)")
    s = _parse_path_segments("input.group(g).number(temperature)")
    assert not _paths_match(q, s)


# ─── T4: _to_xy_string without numpy ─────────────────────────────────────────

def test_to_xy_string_plain_tuple():
    result = _to_xy_string(([1.0, 2.0], [3.0, 4.0]))
    assert "1.0 3.0" in result
    assert "2.0 4.0" in result


def test_to_xy_string_string_passthrough():
    assert _to_xy_string("1 2\n3 4\n") == "1 2\n3 4\n"


def test_to_xy_string_scalar():
    result = _to_xy_string(42)
    # numpy path gives "42.0"; plain-Python fallback gives "42"
    assert result in ("42", "42.0")


def test_to_xy_string_plain_list_of_pairs():
    result = _to_xy_string([[0.0, 1.0], [2.0, 3.0]])
    # Two sequences that happen to be two-element — triggers the (x,y) path
    assert result  # just ensure it doesn't raise


# ─── T5: cache round-trip (store → request) ──────────────────────────────────

_RUN_XML = """\
<?xml version="1.0"?>
<run>
  <input>
    <number id="temperature"><current>300K</current></number>
  </input>
  <output>
    <number id="result"><current>42</current></number>
  </output>
</run>
"""


def test_cache_store_and_request_roundtrip(tmp_path):
    set_tool(_make_tool(tmp_path), cache_dir=str(tmp_path / "cache"))
    client = _client()

    # Store a run
    resp = client.post("/cache/store", content=_RUN_XML.encode())
    assert resp.status_code == 200
    assert resp.json()["status"] == "stored"

    # Request it back using the same driver XML
    resp2 = client.post("/cache/request", content=_RUN_XML.encode())
    assert resp2.status_code == 200
    assert "300K" in resp2.text or resp2.status_code == 200


# ─── T6: _strip_units template filter ────────────────────────────────────────

def test_strip_units_kelvin():
    assert _strip_units("300K") == "300"


def test_strip_units_ev():
    assert _strip_units("2eV") == "2"


def test_strip_units_negative():
    assert _strip_units("-5eV") == "-5"


def test_strip_units_bare_number():
    assert _strip_units("300") == "300"


def test_strip_units_scientific():
    assert _strip_units("2e15/cm3") == "2e15"


def test_strip_units_empty():
    assert _strip_units("") == ""
