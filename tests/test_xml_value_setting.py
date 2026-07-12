"""Tests for simulator XML helpers: _set_xml_value, parse_rappture_path, _walk_path,
_append_units_if_needed, _resolve_choice_value, _set_structure_param,
_fill_defaults_in_tree, build_driver_xml_string.
"""
from __future__ import annotations

from xml.etree import ElementTree as ET

import pytest

from rappture2web.simulator import (
    _append_units_if_needed,
    _fill_defaults_in_tree,
    _resolve_choice_value,
    _set_xml_value,
    _walk_path,
    build_driver_xml_string,
)
from rappture2web.xml_parser import parse_rappture_path as _parse_path


# ── _parse_path ───────────────────────────────────────────────────────────────

def test_parse_path_simple():
    assert _parse_path("input") == [("input", "")]


def test_parse_path_with_id():
    assert _parse_path("input.number(temperature)") == [
        ("input", ""), ("number", "temperature")
    ]


def test_parse_path_nested():
    assert _parse_path("input.group(g1).number(t)") == [
        ("input", ""), ("group", "g1"), ("number", "t")
    ]


def test_parse_path_empty_segments_ignored():
    # double-dot should not produce empty tag
    parts = _parse_path("input..number(t)")
    assert all(tag for tag, _ in parts)


def test_parse_path_empty_string():
    assert _parse_path("") == []


# ── _walk_path ────────────────────────────────────────────────────────────────

def _make_tree(xml: str) -> ET.Element:
    return ET.fromstring(xml)


def test_walk_path_finds_element():
    root = _make_tree("<run><input><number id='t'/></input></run>")
    elem = _walk_path(root, [("input", ""), ("number", "t")])
    assert elem is not None
    assert elem.tag == "number"


def test_walk_path_returns_none_on_missing():
    root = _make_tree("<run><input/></run>")
    assert _walk_path(root, [("input", ""), ("number", "t")]) is None


def test_walk_path_creates_missing_with_flag():
    root = _make_tree("<run><input/></run>")
    elem = _walk_path(root, [("input", ""), ("number", "t")], create_missing=True)
    assert elem is not None
    assert elem.tag == "number"
    assert elem.get("id") == "t"


# ── _append_units_if_needed ───────────────────────────────────────────────────

def _number_elem(units: str = "") -> ET.Element:
    e = ET.fromstring(f"<number><units>{units}</units></number>")
    return e


def test_append_units_bare_number():
    e = _number_elem("eV")
    assert _append_units_if_needed(e, "5") == "5eV"


def test_append_units_already_has_units():
    e = _number_elem("eV")
    assert _append_units_if_needed(e, "5eV") == "5eV"


def test_append_units_removes_space():
    e = _number_elem("nm")
    result = _append_units_if_needed(e, "3 nm")
    assert " " not in result
    assert result == "3nm"


def test_append_units_no_units_elem():
    e = ET.fromstring("<number/>")
    assert _append_units_if_needed(e, "42") == "42"


def test_append_units_non_number_elem():
    e = ET.fromstring("<string/>")
    assert _append_units_if_needed(e, "hello") == "hello"


def test_append_units_scientific_notation():
    e = _number_elem("/cm3")
    assert _append_units_if_needed(e, "2e+15") == "2e+15/cm3"


# ── _resolve_choice_value ─────────────────────────────────────────────────────

def _choice_elem() -> ET.Element:
    return ET.fromstring("""
    <choice>
      <option><about><label>Silicon</label></about><value>si</value></option>
      <option><about><label>Germanium</label></about><value>ge</value></option>
    </choice>
    """)


def test_resolve_choice_by_label():
    e = _choice_elem()
    assert _resolve_choice_value(e, "Silicon") == "si"


def test_resolve_choice_by_value_passthrough():
    e = _choice_elem()
    assert _resolve_choice_value(e, "si") == "si"


def test_resolve_choice_unknown():
    e = _choice_elem()
    assert _resolve_choice_value(e, "Gallium") == "Gallium"


# ── _set_xml_value ────────────────────────────────────────────────────────────

def _driver_xml() -> ET.Element:
    return ET.fromstring("""
    <run>
      <input>
        <number id="temperature"><units>K</units><default>300</default></number>
        <choice id="material">
          <option><about><label>Silicon</label></about><value>si</value></option>
        </choice>
      </input>
    </run>
    """)


def test_set_xml_value_number():
    root = _driver_xml()
    _set_xml_value(root, "input.number(temperature)", "500")
    cur = root.find("input/number[@id='temperature']/current")
    assert cur is not None
    assert cur.text == "500K"


def test_set_xml_value_creates_current():
    root = _driver_xml()
    _set_xml_value(root, "input.number(temperature)", "400")
    cur = root.find("input/number[@id='temperature']/current")
    assert cur is not None


def test_set_xml_value_empty_path_noop():
    root = _driver_xml()
    _set_xml_value(root, "", "500")  # should not raise


def test_set_xml_value_raw_xml_replacement():
    root = ET.fromstring("""
    <run><input>
      <structure id="s"><label>S</label></structure>
    </input></run>
    """)
    new_xml = "<structure id='s'><label>replaced</label></structure>"
    _set_xml_value(root, "input.structure(s)", f"@@RP-XML:{new_xml}")
    struct = root.find("input/structure[@id='s']")
    assert struct is not None
    assert struct.find("label").text == "replaced"


# ── _fill_defaults_in_tree ────────────────────────────────────────────────────

def test_fill_defaults_empty_current():
    root = ET.fromstring("""
    <run><input>
      <number id="t"><units>K</units><default>300</default><current></current></number>
    </input></run>
    """)
    _fill_defaults_in_tree(root)
    cur = root.find("input/number[@id='t']/current")
    assert cur.text == "300K"


def test_fill_defaults_keeps_existing():
    root = ET.fromstring("""
    <run><input>
      <number id="t"><units>K</units><default>300</default><current>500K</current></number>
    </input></run>
    """)
    _fill_defaults_in_tree(root)
    cur = root.find("input/number[@id='t']/current")
    assert cur.text == "500K"


def test_fill_defaults_zero_current_replaced():
    """A literal zero <current> should be treated as unset and replaced with default."""
    root = ET.fromstring("""
    <run><input>
      <number id="t"><units>K</units><default>300</default><current>0</current></number>
    </input></run>
    """)
    _fill_defaults_in_tree(root)
    cur = root.find("input/number[@id='t']/current")
    assert cur.text == "300K"


def test_fill_defaults_nonzero_current_kept():
    root = ET.fromstring("""
    <run><input>
      <number id="t"><units>K</units><default>300</default><current>0.565nm</current></number>
    </input></run>
    """)
    _fill_defaults_in_tree(root)
    cur = root.find("input/number[@id='t']/current")
    assert cur.text == "0.565nm"


def test_fill_defaults_creates_current_when_missing():
    root = ET.fromstring("""
    <run><input>
      <number id="t"><units>eV</units><default>1.5</default></number>
    </input></run>
    """)
    _fill_defaults_in_tree(root)
    cur = root.find("input/number[@id='t']/current")
    assert cur is not None
    assert cur.text == "1.5eV"


def test_fill_defaults_choice_label_resolved():
    root = ET.fromstring("""
    <run><input>
      <choice id="m">
        <option><about><label>Silicon</label></about><value>si</value></option>
        <default>Silicon</default>
        <current></current>
      </choice>
    </input></run>
    """)
    _fill_defaults_in_tree(root)
    cur = root.find("input/choice[@id='m']/current")
    assert cur.text == "si"


# ── build_driver_xml_string ───────────────────────────────────────────────────

_TOOL_XML = """\
<?xml version="1.0"?>
<run>
  <tool><command>python @driver</command></tool>
  <input>
    <number id="temperature"><units>K</units><default>300</default></number>
    <choice id="material">
      <option><about><label>Silicon</label></about><value>si</value></option>
    </choice>
  </input>
</run>
"""


def test_build_driver_xml_string_returns_xml(tmp_path):
    tool_xml = tmp_path / "tool.xml"
    tool_xml.write_text(_TOOL_XML, encoding="utf-8")
    xml_str = build_driver_xml_string(str(tool_xml), {"input.number(temperature)": "500"})
    assert "<?xml" in xml_str
    assert "500K" in xml_str


def test_build_driver_xml_string_default_filled(tmp_path):
    tool_xml = tmp_path / "tool.xml"
    tool_xml.write_text(_TOOL_XML, encoding="utf-8")
    xml_str = build_driver_xml_string(str(tool_xml), {})
    # Temperature default should be 300K
    assert "300K" in xml_str
