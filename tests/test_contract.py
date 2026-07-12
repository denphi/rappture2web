"""Tests for the Rappture 2.0 <tool><contract> block.

These tests cover the layered enforcement strategy:

1. The XSD shape (ContractInput/OutputSectionType, WidgetIdType pattern)
2. The Python semantic validator (_validate_contract_semantics):
   missing label/description/default, duplicate singleton children,
   min/max/default consistency, choice default ∈ options.
3. The contract↔runtime cross-validator (_validate_contract_vs_runtime):
   undeclared runtime widgets, missing runtime widgets, type mismatches,
   structure↔drawing aliasing on outputs.
4. The shared runtime output checker (check_output_against_contract,
   missing_contract_outputs).
5. The Rappture-2.x version gate.
"""
from __future__ import annotations

import pytest

from rappture2web.xml_parser import (
    check_output_against_contract,
    missing_contract_outputs,
    parse_tool_xml,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _write_tool(tmp_path, xml: str, name: str = "tool.xml"):
    p = tmp_path / name
    p.write_text(xml.strip(), encoding="utf-8")
    return p


def _minimal_run(contract_body: str = "", input_body: str = "",
                 output_body: str = "", tool_extra: str = "") -> str:
    """Build a minimal <run> document around the given inner XML."""
    contract_xml = f"<contract>{contract_body}</contract>" if contract_body else ""
    input_xml = f"<input>{input_body}</input>" if input_body else ""
    output_xml = f"<output>{output_body}</output>" if output_body else ""
    return f"""
<run>
  <tool>
    <title>T</title>
    {tool_extra}
    {contract_xml}
  </tool>
  {input_xml}
  {output_xml}
</run>
""".strip()


# ─── 1. Minimal happy path ────────────────────────────────────────────────────

def test_minimal_valid_contract_parses(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>Temp</label><description>Lattice temperature</description></about>
              <default>300</default>
              <units>K</units>
              <min>0</min>
              <max>1000</max>
            </number>
          </input>
          <output>
            <curve id="iv">
              <about><label>IV</label><description>I-V characteristic</description></about>
            </curve>
          </output>
        """,
        input_body="""
          <number id="t">
            <about><label>Temp</label></about>
            <default>300</default>
            <units>K</units>
          </number>
        """,
    )
    p = _write_tool(tmp_path, xml)
    tool = parse_tool_xml(str(p))
    assert "t" in tool.contract["inputs"]
    assert tool.contract["inputs"]["t"]["units"] == "K"
    assert "iv" in tool.contract["outputs"]


# ─── 2. Semantic validator: missing label/description/default ────────────────

def test_contract_missing_label_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><description>no label</description></about>
              <default>1</default>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="missing <about><label>"):
        parse_tool_xml(str(p))


def test_contract_missing_description_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label></about>
              <default>1</default>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="missing <about><description>"):
        parse_tool_xml(str(p))


def test_contract_missing_default_rejected_for_number(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
            </number>
          </input>
        """,
        input_body='<number id="t"/>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="missing <default>"):
        parse_tool_xml(str(p))


# ─── 3. Duplicate singleton children ─────────────────────────────────────────

def test_contract_duplicate_default_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>1</default>
              <default>2</default>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="<default> appears 2 times"):
        parse_tool_xml(str(p))


def test_contract_duplicate_about_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <about><label>T2</label><description>d2</description></about>
              <default>1</default>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="<about> appears 2 times"):
        parse_tool_xml(str(p))


# ─── 4. Numeric consistency: min/max/default ─────────────────────────────────

def test_contract_min_greater_than_max_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>5</default>
              <min>10</min>
              <max>1</max>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>5</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match=r"<min>=10.*is greater than <max>=1"):
        parse_tool_xml(str(p))


def test_contract_default_below_min_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>-1</default>
              <min>0</min>
              <max>100</max>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>-1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match=r"<default>=-1.*below <min>=0"):
        parse_tool_xml(str(p))


def test_contract_default_above_max_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>500</default>
              <min>0</min>
              <max>100</max>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>500</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match=r"<default>=500.*above <max>=100"):
        parse_tool_xml(str(p))


def test_contract_default_with_unit_suffix_accepted(tmp_path):
    """A default like '300K' must be parsed as 300 for range checking."""
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>300K</default>
              <units>K</units>
              <min>0K</min>
              <max>1000K</max>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>300K</default><units>K</units></number>',
    )
    p = _write_tool(tmp_path, xml)
    parse_tool_xml(str(p))  # must not raise


def test_contract_integer_with_fractional_default_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <integer id="n">
              <about><label>N</label><description>d</description></about>
              <default>5.5</default>
              <min>1</min>
              <max>10</max>
            </integer>
          </input>
        """,
        input_body='<integer id="n"><default>5.5</default></integer>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match=r"<default>=5\.5.*not an integer"):
        parse_tool_xml(str(p))


# ─── 5. Choice / multichoice default validation ──────────────────────────────

_CHOICE_RUNTIME_BODY = """
  <choice id="model">
    <about><label>Model</label></about>
    <option><about><label>A</label></about><value>a</value></option>
    <option><about><label>B</label></about><value>b</value></option>
    <default>{default}</default>
  </choice>
"""


def test_contract_choice_default_outside_options_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <choice id="model">
              <about><label>Model</label><description>d</description></about>
              <option><about><label>A</label></about><value>a</value></option>
              <option><about><label>B</label></about><value>b</value></option>
              <default>z</default>
            </choice>
          </input>
        """,
        input_body=_CHOICE_RUNTIME_BODY.format(default="z"),
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="not one of the declared <option> values"):
        parse_tool_xml(str(p))


def test_contract_choice_default_matches_option_value(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <choice id="model">
              <about><label>Model</label><description>d</description></about>
              <option><about><label>A</label></about><value>a</value></option>
              <option><about><label>B</label></about><value>b</value></option>
              <default>a</default>
            </choice>
          </input>
        """,
        input_body=_CHOICE_RUNTIME_BODY.format(default="a"),
    )
    p = _write_tool(tmp_path, xml)
    tool = parse_tool_xml(str(p))
    assert tool.contract["inputs"]["model"]["default"] == "a"


def test_contract_choice_default_matches_option_label(tmp_path):
    """When <value> is omitted Rappture treats <label> as the value."""
    xml = _minimal_run(
        contract_body="""
          <input>
            <choice id="model">
              <about><label>Model</label><description>d</description></about>
              <option><about><label>Alpha</label></about></option>
              <option><about><label>Beta</label></about></option>
              <default>Alpha</default>
            </choice>
          </input>
        """,
        input_body="""
          <choice id="model">
            <about><label>Model</label></about>
            <option><about><label>Alpha</label></about></option>
            <option><about><label>Beta</label></about></option>
            <default>Alpha</default>
          </choice>
        """,
    )
    p = _write_tool(tmp_path, xml)
    parse_tool_xml(str(p))


def test_contract_choice_with_no_options_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <choice id="model">
              <about><label>Model</label><description>d</description></about>
              <default>a</default>
            </choice>
          </input>
        """,
        input_body="""
          <choice id="model">
            <about><label>Model</label></about>
            <default>a</default>
          </choice>
        """,
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="declares no <option>"):
        parse_tool_xml(str(p))


def test_contract_multichoice_default_subset_validated(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <multichoice id="flags">
              <about><label>Flags</label><description>d</description></about>
              <option><about><label>A</label></about><value>a</value></option>
              <option><about><label>B</label></about><value>b</value></option>
              <option><about><label>C</label></about><value>c</value></option>
              <default>a,b,z</default>
            </multichoice>
          </input>
        """,
        input_body="""
          <multichoice id="flags">
            <about><label>Flags</label></about>
            <option><about><label>A</label></about><value>a</value></option>
            <option><about><label>B</label></about><value>b</value></option>
            <option><about><label>C</label></about><value>c</value></option>
            <default>a,b,z</default>
          </multichoice>
        """,
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match=r"not in <option> set: z"):
        parse_tool_xml(str(p))


# ─── 6. Runtime/contract cross-validation ────────────────────────────────────

def test_runtime_widget_not_in_contract_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>1</default>
            </number>
          </input>
        """,
        input_body="""
          <number id="t"><default>1</default></number>
          <number id="extra"><default>1</default></number>
        """,
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="'extra'.*not declared in the contract"):
        parse_tool_xml(str(p))


def test_contract_widget_missing_from_runtime_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>1</default>
            </number>
            <number id="missing">
              <about><label>M</label><description>d</description></about>
              <default>1</default>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="'missing' is missing from the runtime"):
        parse_tool_xml(str(p))


def test_runtime_units_conflict_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>1</default>
              <units>K</units>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>1</default><units>eV</units></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="units='K'.*runtime units='eV'"):
        parse_tool_xml(str(p))


def test_runtime_input_and_output_errors_reported_together(tmp_path):
    """Errors across input and output checks must surface in a single raise."""
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>1</default>
            </number>
          </input>
          <output>
            <curve id="iv">
              <about><label>IV</label><description>d</description></about>
            </curve>
          </output>
        """,
        input_body="""
          <number id="t"><default>1</default></number>
          <number id="undeclared"><default>1</default></number>
        """,
        output_body="""
          <curve id="iv"><about><label>IV</label></about></curve>
          <curve id="rogue"><about><label>R</label></about></curve>
        """,
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError) as exc:
        parse_tool_xml(str(p))
    msg = str(exc.value)
    assert "'undeclared'" in msg
    assert "'rogue'" in msg


def test_runtime_output_type_mismatch_rejected(tmp_path):
    xml = _minimal_run(
        contract_body="""
          <output>
            <curve id="iv">
              <about><label>IV</label><description>d</description></about>
            </curve>
          </output>
        """,
        output_body='<image id="iv"><about><label>IV</label></about></image>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="contract type 'curve' but runtime type 'image'"):
        parse_tool_xml(str(p))


def test_runtime_output_structure_drawing_alias_accepted(tmp_path):
    """A contract declaring 'structure' must accept runtime 'drawing' (aliased)."""
    xml = _minimal_run(
        contract_body="""
          <output>
            <structure id="dev">
              <about><label>Device</label><description>d</description></about>
            </structure>
          </output>
        """,
        output_body='<drawing id="dev"><about><label>Device</label></about></drawing>',
    )
    p = _write_tool(tmp_path, xml)
    parse_tool_xml(str(p))  # must not raise


# ─── 7. WidgetIdType pattern (XSD enforced via bundled schema) ───────────────

def test_contract_widget_id_with_leading_digit_rejected(tmp_path):
    pytest.importorskip("lxml")
    xml = _minimal_run(
        contract_body="""
          <input>
            <number id="1bad">
              <about><label>T</label><description>d</description></about>
              <default>1</default>
            </number>
          </input>
        """,
        input_body='<number id="1bad"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="Schema validation failed"):
        parse_tool_xml(str(p))


# ─── 8. Shared runtime helpers ───────────────────────────────────────────────

def test_check_output_against_contract_passthrough_for_no_contract():
    assert check_output_against_contract({}, "x", "curve") == ""
    assert check_output_against_contract({"outputs": {}}, "x", "curve") == ""


def test_check_output_against_contract_ignores_sentinels():
    contract = {"outputs": {"iv": {"type": "curve"}}}
    assert check_output_against_contract(contract, "__inputs__", "log") == ""
    assert check_output_against_contract(contract, "__driver_xml__", "string") == ""


def test_check_output_against_contract_rejects_undeclared():
    contract = {"outputs": {"iv": {"type": "curve"}}}
    err = check_output_against_contract(contract, "extra", "curve")
    assert "not declared" in err


def test_check_output_against_contract_rejects_type_mismatch():
    contract = {"outputs": {"iv": {"type": "curve"}}}
    err = check_output_against_contract(contract, "iv", "image")
    assert "type 'curve'" in err
    assert "image" in err


def test_check_output_against_contract_accepts_structure_drawing_alias():
    contract = {"outputs": {"dev": {"type": "structure"}}}
    assert check_output_against_contract(contract, "dev", "drawing") == ""


def test_missing_contract_outputs_skips_sentinels():
    contract = {"outputs": {"iv": {"type": "curve"}, "log1": {"type": "log"}}}
    produced = ["__inputs__", "iv"]
    assert missing_contract_outputs(contract, produced) == ["log1"]


def test_missing_contract_outputs_empty_for_no_contract():
    assert missing_contract_outputs({}, ["x"]) == []
    assert missing_contract_outputs({"outputs": {}}, ["x"]) == []


# ─── 9. Version gate (Rappture 2.x requires a contract) ──────────────────────

def test_v2_tool_without_contract_rejected(tmp_path):
    xml = _minimal_run(
        tool_extra="<version>2.0</version>",
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    with pytest.raises(ValueError, match="version '2.0'.*must include a contract"):
        parse_tool_xml(str(p))


def test_v1_tool_without_contract_accepted(tmp_path):
    """Pre-2.0 tools remain valid without a contract."""
    xml = _minimal_run(
        tool_extra="<version>1.5</version>",
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    tool = parse_tool_xml(str(p))
    assert tool.contract == {}


def test_v2_tool_with_contract_accepted(tmp_path):
    xml = _minimal_run(
        tool_extra="<version>2.0</version>",
        contract_body="""
          <input>
            <number id="t">
              <about><label>T</label><description>d</description></about>
              <default>1</default>
            </number>
          </input>
        """,
        input_body='<number id="t"><default>1</default></number>',
    )
    p = _write_tool(tmp_path, xml)
    tool = parse_tool_xml(str(p))
    assert "t" in tool.contract["inputs"]
