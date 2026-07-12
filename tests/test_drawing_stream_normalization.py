from __future__ import annotations

from rappture2web.rp_library import _OutputStore


def test_output_store_normalizes_drawing_components():
    store = _OutputStore("driver.xml", streaming=True)

    rec = {
        "type": "drawing",
        "id": "d1",
        "about": {
            "label": "Scene",
            "description": "Desc",
            "camera": "-qw 1 -qx 0 -qy 0 -qz 0",
        },
        "xaxis": {"label": "X", "units": "A"},
        "yaxis": {"label": "Y", "units": "A"},
        "zaxis": {"label": "Z", "units": "A"},
        "molecule(m1)": {"vtk": "vtk-m1"},
        "polydata(p1)": {
            "about": {"label": "Mesh", "style": "-constcolor blue"},
            "vtk": "vtk-p1",
        },
        "glyphs(g1)": {
            "about": {"label": "Glyph", "shape": "sphere", "style": "-gscale 2"},
            "vtk": "vtk-g1",
        },
    }

    out = store._normalize_record(rec)
    assert out["type"] == "drawing"
    assert out["label"] == "Scene"
    assert out["description"] == "Desc"
    assert out["camera"] == "-qw 1 -qx 0 -qy 0 -qz 0"
    assert len(out["molecules"]) == 1
    assert out["molecules"][0]["id"] == "m1"
    assert out["molecules"][0]["vtk"] == "vtk-m1"
    assert len(out["polydata"]) == 1
    assert out["polydata"][0]["id"] == "p1"
    assert out["polydata"][0]["label"] == "Mesh"
    assert out["polydata"][0]["style"] == "-constcolor blue"
    assert len(out["glyphs"]) == 1
    assert out["glyphs"][0]["id"] == "g1"
    assert out["glyphs"][0]["shape"] == "sphere"
    assert out["glyphs"][0]["style"] == "-gscale 2"


def test_output_store_normalizes_drawing_polygon_as_polydata():
    store = _OutputStore("driver.xml", streaming=True)

    rec = {
        "type": "drawing",
        "id": "d2",
        "about": {"label": "Plane Scene"},
        "polygon(plane1)": {
            "about": {"label": "Plane 1", "style": "-color red -opacity 0.85"},
            "vtk": "vtk-plane",
        },
    }

    out = store._normalize_record(rec)
    assert out["type"] == "drawing"
    assert len(out["polydata"]) == 1
    assert out["polydata"][0]["id"] == "plane1"
    assert out["polydata"][0]["label"] == "Plane 1"
    assert out["polydata"][0]["style"] == "-color red -opacity 0.85"
    assert out["polydata"][0]["vtk"] == "vtk-plane"
