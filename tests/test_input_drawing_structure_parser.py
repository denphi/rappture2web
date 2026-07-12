from __future__ import annotations

from rappture2web.xml_parser import parse_tool_xml


def test_parse_tool_xml_input_drawing_components(tmp_path):
    xml = """
<run>
  <tool><title>T</title></tool>
  <input>
    <drawing id="d1">
      <about><label>Sketch</label></about>
      <background><color>white</color><coordinates>0 0 1 1</coordinates></background>
      <components>
        <rectangle><coords>0.1 0.2 0.9 0.8</coords><outline>black</outline><fill>red</fill><linewidth>2</linewidth></rectangle>
        <line><coords>0.1 0.1 0.9 0.9</coords><color>blue</color><linewidth>1</linewidth></line>
        <text><coords>0.5 0.5</coords><text>Hello</text><anchor>c</anchor></text>
      </components>
    </drawing>
  </input>
</run>
""".strip()
    p = tmp_path / "tool.xml"
    p.write_text(xml, encoding="utf-8")
    tool = parse_tool_xml(str(p))
    w = tool.inputs[0]
    assert w.type == "drawing"
    assert w.label == "Sketch"
    assert w.attrs["background"]["coordinates"] == "0 0 1 1"
    assert len(w.attrs["components"]) == 3
    assert w.attrs["components"][0]["type"] == "rectangle"
    assert w.attrs["components"][0]["coords"] == [0.1, 0.2, 0.9, 0.8]


def test_parse_tool_xml_input_structure_components(tmp_path):
    xml = """
<run>
  <tool><title>T</title></tool>
  <input>
    <structure id="s1">
      <default>
        <components>
          <box>
            <about><label>P</label><color>purple</color></about>
            <corner>0um</corner>
            <corner>1um</corner>
          </box>
          <box>
            <about><label>N</label><color>green</color></about>
            <corner>1um</corner>
            <corner>2um</corner>
          </box>
        </components>
      </default>
    </structure>
  </input>
</run>
""".strip()
    p = tmp_path / "tool2.xml"
    p.write_text(xml, encoding="utf-8")
    tool = parse_tool_xml(str(p))
    w = tool.inputs[0]
    assert w.type == "structure"
    assert len(w.attrs["components"]) == 2
    assert w.attrs["components"][0]["label"] == "P"
    assert w.attrs["components"][0]["corner0"] == 0.0
    assert w.attrs["components"][1]["corner1"] == 2.0
