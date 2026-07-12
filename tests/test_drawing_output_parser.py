from __future__ import annotations

import base64
import zlib

from rappture2web.xml_parser import parse_run_xml


def test_parse_run_xml_drawing_output_decodes_molecule_payloads(tmp_path):
    pdb_text = "ATOM      1  C   MOL     1      0.000   0.000   0.000"
    vtk_text = "# vtk DataFile Version 3.0\nvtk output\nASCII\nDATASET POLYDATA"

    pdb_enc = "@@RP-ENC:zb64 " + base64.b64encode(zlib.compress(pdb_text.encode("utf-8"))).decode("ascii")
    vtk_enc = "@@RP-ENC:b64 " + base64.b64encode(vtk_text.encode("utf-8")).decode("ascii")

    run_xml = f"""
<run>
  <output>
    <drawing id="crystal">
      <about><label>Crystal</label></about>
      <xaxis><label>X</label><units>nm</units></xaxis>
      <yaxis><label>Y</label><units>nm</units></yaxis>
      <zaxis><label>Z</label><units>nm</units></zaxis>
      <molecule id="mol1">
        <pdb>{pdb_enc}</pdb>
      </molecule>
      <molecule id="mol2">
        <vtk>{vtk_enc}</vtk>
      </molecule>
    </drawing>
  </output>
</run>
""".strip()

    xml_path = tmp_path / "run.xml"
    xml_path.write_text(run_xml, encoding="utf-8")

    outputs = parse_run_xml(str(xml_path))

    assert "crystal" in outputs
    drawing = outputs["crystal"]
    assert drawing["type"] == "drawing"
    assert drawing["label"] == "Crystal"
    assert drawing["xaxis"] == {"label": "X", "units": "nm"}
    assert drawing["yaxis"] == {"label": "Y", "units": "nm"}
    assert drawing["zaxis"] == {"label": "Z", "units": "nm"}
    assert len(drawing["molecules"]) == 2
    assert drawing["molecules"][0]["id"] == "mol1"
    assert drawing["molecules"][0]["pdb"] == pdb_text
    assert drawing["molecules"][1]["id"] == "mol2"
    assert drawing["molecules"][1]["vtk"] == vtk_text


def test_parse_run_xml_drawing_output_polydata_glyphs_and_camera(tmp_path):
    poly_vtk = "# vtk DataFile Version 3.0\nvtk output\nASCII\nDATASET POLYDATA\nPOINTS 1 float\n0 0 0"
    gl_vtk = "# vtk DataFile Version 3.0\nvtk output\nASCII\nDATASET POLYDATA\nPOINTS 1 float\n1 2 3"

    run_xml = f"""
<run>
  <output>
    <drawing id="d1">
      <about>
        <label>Scene</label>
        <description>Demo drawing</description>
        <camera>-qw 1 -qx 0 -qy 0 -qz 0 -xpan 0.1 -ypan -0.2 -zoom 1.5</camera>
      </about>
      <polydata id="pd1">
        <about>
          <label>Mesh</label>
          <style>-constcolor blue -opacity 0.4</style>
        </about>
        <vtk>{poly_vtk}</vtk>
      </polydata>
      <glyphs id="g1">
        <about>
          <label>Points</label>
          <shape>sphere</shape>
          <style>-gscale 2 -orientglyphs on</style>
        </about>
        <vtk>{gl_vtk}</vtk>
      </glyphs>
    </drawing>
  </output>
</run>
""".strip()

    xml_path = tmp_path / "run2.xml"
    xml_path.write_text(run_xml, encoding="utf-8")
    outputs = parse_run_xml(str(xml_path))
    drawing = outputs["d1"]

    assert drawing["type"] == "drawing"
    assert drawing["label"] == "Scene"
    assert drawing["description"] == "Demo drawing"
    assert "-zoom 1.5" in drawing["camera"]
    assert len(drawing["polydata"]) == 1
    assert drawing["polydata"][0]["id"] == "pd1"
    assert drawing["polydata"][0]["label"] == "Mesh"
    assert drawing["polydata"][0]["style"] == "-constcolor blue -opacity 0.4"
    assert drawing["polydata"][0]["vtk"] == poly_vtk
    assert len(drawing["glyphs"]) == 1
    assert drawing["glyphs"][0]["id"] == "g1"
    assert drawing["glyphs"][0]["label"] == "Points"
    assert drawing["glyphs"][0]["shape"] == "sphere"
    assert drawing["glyphs"][0]["style"] == "-gscale 2 -orientglyphs on"
    assert drawing["glyphs"][0]["vtk"] == gl_vtk


def test_parse_run_xml_drawing_output_polygon_is_treated_as_polydata(tmp_path):
    plane_vtk = "# vtk DataFile Version 3.0\nvtk output\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0 1 0 0 0 1 0 1 1 0"

    run_xml = f"""
<run>
  <output>
    <drawing id="plane_case">
      <about><label>Plane Case</label></about>
      <polygon id="plane1">
        <about>
          <label>Plane 1</label>
          <style>-color green -opacity 0.85</style>
        </about>
        <vtk>{plane_vtk}</vtk>
      </polygon>
    </drawing>
  </output>
</run>
""".strip()

    xml_path = tmp_path / "run_polygon.xml"
    xml_path.write_text(run_xml, encoding="utf-8")
    outputs = parse_run_xml(str(xml_path))
    drawing = outputs["plane_case"]

    assert drawing["type"] == "drawing"
    assert len(drawing["polydata"]) == 1
    assert drawing["polydata"][0]["id"] == "plane1"
    assert drawing["polydata"][0]["label"] == "Plane 1"
    assert drawing["polydata"][0]["style"] == "-color green -opacity 0.85"
    assert drawing["polydata"][0]["vtk"] == plane_vtk
