"""Parse Rappture tool.xml files into Python data structures."""

import base64
import copy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from xml.etree import ElementTree as ET


# Input widget types that contain child widgets
CONTAINER_TYPES = {"group", "phase"}

# Input widget types that are leaf inputs
INPUT_TYPES = {
    "number", "integer", "boolean", "string", "choice", "multichoice",
    "image", "note", "periodicelement", "loader", "drawing", "structure",
}

# Output element types
OUTPUT_TYPES = {
    "curve", "histogram", "field", "image", "string", "number", "integer",
    "boolean", "table", "log", "sequence", "structure", "mesh", "group",
}

# Special non-widget elements
SPECIAL_ELEMENTS = {"separator"}


@dataclass
class ToolInfo:
    """Tool metadata from <tool> section."""
    title: str = ""
    about: str = ""
    command: str = ""


@dataclass
class WidgetNode:
    """A node in the input/output widget tree."""
    type: str = ""
    id: str = ""
    path: str = ""  # Rappture path like input.number(temperature)
    label: str = ""
    description: str = ""
    hints: str = ""
    icon: str = ""
    enable: str = ""
    default: str = ""
    color: str = ""
    children: list = field(default_factory=list)
    attrs: dict = field(default_factory=dict)  # Type-specific attributes


@dataclass
class OptionDef:
    """A choice option."""
    label: str = ""
    description: str = ""
    value: str = ""


@dataclass
class PresetDef:
    """A number preset."""
    label: str = ""
    value: str = ""


@dataclass
class OutputNode:
    """A node in the output tree."""
    type: str = ""
    id: str = ""
    path: str = ""
    label: str = ""
    description: str = ""
    children: list = field(default_factory=list)
    attrs: dict = field(default_factory=dict)


@dataclass
class ToolDef:
    """Complete parsed tool definition."""
    tool: ToolInfo = field(default_factory=ToolInfo)
    inputs: list = field(default_factory=list)  # List of WidgetNode
    outputs: list = field(default_factory=list)  # List of OutputNode
    xml_path: str = ""  # Path to the tool.xml file
    tool_dir: str = ""  # Directory containing tool.xml


def _get_text(elem, tag, default=""):
    """Get text content of a child element, or default."""
    child = elem.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return default


def _get_about(elem):
    """Extract <about> section fields."""
    about = elem.find("about")
    if about is None:
        return {}, ""
    result = {
        "label": _get_text(about, "label"),
        "description": _get_text(about, "description"),
        "hints": _get_text(about, "hints"),
        "icon": _get_text(about, "icon"),
        "enable": _get_text(about, "enable"),
        "color": _get_text(about, "color"),
    }
    # Some elements put enable at the top level too
    layout_text = _get_text(about, "layout")
    return result, layout_text


def parse_number(elem, node):
    """Parse number-specific attributes."""
    node.attrs["units"] = _get_text(elem, "units")
    node.attrs["min"] = _get_text(elem, "min")
    node.attrs["max"] = _get_text(elem, "max")
    node.attrs["color"] = _get_text(elem, "color") or node.color

    # Parse presets
    presets = []
    for preset_elem in elem.findall("preset"):
        p = PresetDef(
            value=_get_text(preset_elem, "value"),
            label=_get_text(preset_elem, "label"),
        )
        presets.append(p)
    node.attrs["presets"] = presets


def parse_integer(elem, node):
    """Parse integer-specific attributes."""
    node.attrs["min"] = _get_text(elem, "min")
    node.attrs["max"] = _get_text(elem, "max")


def parse_string(elem, node):
    """Parse string-specific attributes."""
    size = _get_text(elem, "size")
    node.attrs["size"] = size
    if size and "x" in size.lower():
        parts = size.lower().split("x")
        node.attrs["width"] = parts[0]
        node.attrs["height"] = parts[1]
        node.attrs["multiline"] = True
    else:
        node.attrs["multiline"] = False


def parse_choice(elem, node):
    """Parse choice-specific attributes."""
    options = []
    for opt_elem in elem.findall("option"):
        opt_about = opt_elem.find("about")
        opt = OptionDef(
            label=_get_text(opt_about, "label") if opt_about is not None else "",
            description=_get_text(opt_about, "description") if opt_about is not None else "",
            value=_get_text(opt_elem, "value"),
        )
        # If no value, use label as value
        if not opt.value:
            opt.value = opt.label
        options.append(opt)
    node.attrs["options"] = options


def parse_multichoice(elem, node):
    """Parse multichoice - same structure as choice."""
    parse_choice(elem, node)


def parse_loader(elem, node):
    """Parse loader-specific attributes."""
    node.attrs["example"] = _get_text(elem, "example")
    node.attrs["loader_default"] = _get_text(elem, "default")
    upload_targets = []
    upload_elem = elem.find("upload")
    if upload_elem is not None:
        for to_elem in upload_elem.findall("to"):
            if to_elem.text:
                upload_targets.append(to_elem.text.strip())
    node.attrs["upload_targets"] = upload_targets

    download_sources = []
    download_elem = elem.find("download")
    if download_elem is not None:
        for from_elem in download_elem.findall("from"):
            if from_elem.text:
                download_sources.append(from_elem.text.strip())
    node.attrs["download_sources"] = download_sources


def parse_group(elem, node, parent_path):
    """Parse group and its children recursively."""
    about_info, layout = _get_about(elem)
    node.attrs["layout"] = layout

    # Check if this is a group-of-groups (renders as tabs)
    child_groups = [c for c in elem if c.tag == "group"]
    node.attrs["is_tabbed"] = len(child_groups) > 1

    # Parse children
    node.children = _parse_input_children(elem, node.path)


def parse_phase(elem, node, parent_path):
    """Parse phase (tab page) and its children."""
    node.children = _parse_input_children(elem, node.path)


# Map of type to parser function
TYPE_PARSERS = {
    "number": parse_number,
    "integer": parse_integer,
    "boolean": lambda e, n: None,  # No special attrs
    "string": parse_string,
    "choice": parse_choice,
    "multichoice": parse_multichoice,
    "loader": parse_loader,
    "image": lambda e, n: None,
    "note": lambda e, n: n.attrs.update({"contents": _get_text(e, "contents")}),
    "periodicelement": lambda e, n: n.attrs.update({
        "returnvalue": _get_text(e, "returnvalue") or "symbol",
        "active": _get_text(e, "active"),
        "inactive": _get_text(e, "inactive"),
    }),
}


def _parse_input_element(elem, parent_path):
    """Parse a single input element into a WidgetNode."""
    tag = elem.tag

    if tag == "separator":
        return WidgetNode(type="separator", path=parent_path + ".separator")

    elem_id = elem.get("id", "")
    if elem_id:
        path = f"{parent_path}.{tag}({elem_id})"
    else:
        path = f"{parent_path}.{tag}"

    about_info, layout = _get_about(elem)

    node = WidgetNode(
        type=tag,
        id=elem_id,
        path=path,
        label=about_info.get("label", ""),
        description=about_info.get("description", ""),
        hints=about_info.get("hints", ""),
        icon=about_info.get("icon", ""),
        enable=about_info.get("enable", ""),
        color=about_info.get("color", ""),
        default=_get_text(elem, "default"),
    )

    # Parse type-specific attributes
    if tag in TYPE_PARSERS:
        TYPE_PARSERS[tag](elem, node)
    elif tag == "group":
        parse_group(elem, node, parent_path)
    elif tag == "phase":
        parse_phase(elem, node, parent_path)

    return node


def _parse_input_children(parent_elem, parent_path):
    """Parse all input children of a parent element."""
    children = []
    all_types = INPUT_TYPES | CONTAINER_TYPES | SPECIAL_ELEMENTS
    for child in parent_elem:
        if child.tag in all_types:
            node = _parse_input_element(child, parent_path)
            children.append(node)
    return children


def _parse_output_element(elem, parent_path):
    """Parse a single output element."""
    tag = elem.tag
    elem_id = elem.get("id", "")
    if elem_id:
        path = f"{parent_path}.{tag}({elem_id})"
    else:
        path = f"{parent_path}.{tag}"

    about_info, _ = _get_about(elem)

    node = OutputNode(
        type=tag,
        id=elem_id,
        path=path,
        label=about_info.get("label", ""),
        description=about_info.get("description", ""),
    )

    # Type-specific output parsing
    if tag == "curve":
        node.attrs["xaxis"] = {
            "label": _get_text(elem.find("xaxis"), "label") if elem.find("xaxis") is not None else "",
            "description": _get_text(elem.find("xaxis"), "description") if elem.find("xaxis") is not None else "",
            "units": _get_text(elem.find("xaxis"), "units") if elem.find("xaxis") is not None else "",
            "scale": _get_text(elem.find("xaxis"), "scale") if elem.find("xaxis") is not None else "",
        }
        node.attrs["yaxis"] = {
            "label": _get_text(elem.find("yaxis"), "label") if elem.find("yaxis") is not None else "",
            "description": _get_text(elem.find("yaxis"), "description") if elem.find("yaxis") is not None else "",
            "units": _get_text(elem.find("yaxis"), "units") if elem.find("yaxis") is not None else "",
            "scale": _get_text(elem.find("yaxis"), "scale") if elem.find("yaxis") is not None else "",
        }
        # Extract XY data if present (for pre-populated outputs)
        xy_data = _get_text(elem, "component/xy") if elem.find("component") is not None else ""
        node.attrs["xy"] = xy_data
    elif tag == "histogram":
        node.attrs["xaxis"] = {
            "label": _get_text(elem.find("xaxis"), "label") if elem.find("xaxis") is not None else "",
            "units": _get_text(elem.find("xaxis"), "units") if elem.find("xaxis") is not None else "",
        }
        node.attrs["yaxis"] = {
            "label": _get_text(elem.find("yaxis"), "label") if elem.find("yaxis") is not None else "",
            "units": _get_text(elem.find("yaxis"), "units") if elem.find("yaxis") is not None else "",
        }
    elif tag == "number":
        node.attrs["units"] = _get_text(elem, "units")
        node.attrs["current"] = _get_text(elem, "current")
    elif tag == "string":
        node.attrs["current"] = _get_text(elem, "current")
    elif tag == "image":
        node.attrs["current"] = _get_text(elem, "current")
    elif tag == "field":
        node.attrs["about"] = about_info
    elif tag == "group":
        # Output groups can overlay plots
        node.children = [
            _parse_output_element(child, path)
            for child in elem if child.tag in OUTPUT_TYPES
        ]

    return node


def _parse_output_children(parent_elem, parent_path):
    """Parse all output children."""
    children = []
    for child in parent_elem:
        if child.tag in OUTPUT_TYPES:
            node = _parse_output_element(child, parent_path)
            children.append(node)
        elif child.tag == "log":
            # <log> is a special case - it's just text
            node = OutputNode(
                type="log",
                path=f"{parent_path}.log",
                label="Log",
            )
            if child.text:
                node.attrs["content"] = child.text.strip()
            children.append(node)
    return children


def parse_tool_xml(xml_path: str) -> ToolDef:
    """Parse a Rappture tool.xml file into a ToolDef structure.

    Args:
        xml_path: Path to the tool.xml file.

    Returns:
        ToolDef with parsed tool definition.
    """
    xml_path = Path(xml_path).resolve()
    tree = ET.parse(str(xml_path))
    root = tree.getroot()

    if root.tag != "run":
        raise ValueError(f"Expected <run> root element, got <{root.tag}>")

    tool_def = ToolDef(
        xml_path=str(xml_path),
        tool_dir=str(xml_path.parent),
    )

    # Parse <tool> section
    tool_elem = root.find("tool")
    if tool_elem is not None:
        tool_def.tool = ToolInfo(
            title=_get_text(tool_elem, "title"),
            about=_get_text(tool_elem, "about"),
            command=_get_text(tool_elem, "command"),
        )

    # Parse <input> section
    input_elem = root.find("input")
    if input_elem is not None:
        tool_def.inputs = _parse_input_children(input_elem, "input")

    # Parse <output> section
    output_elem = root.find("output")
    if output_elem is not None:
        tool_def.outputs = _parse_output_children(output_elem, "output")

    # Resolve file:// references in note widgets
    _resolve_note_contents(tool_def.inputs, xml_path.parent)

    return tool_def


def _resolve_note_contents(widgets, tool_dir: Path):
    """Resolve file:// references in note widget contents and inline images."""
    import re
    for w in widgets:
        if w.type == "note":
            contents = w.attrs.get("contents", "")
            if contents and contents.startswith("file://"):
                fname = contents[7:].strip()
                fpath = tool_dir / fname
                if fpath.exists():
                    html = fpath.read_text(errors="replace")
                    # Inline relative <img src="..."> as base64 data URIs
                    def _inline_img(m):
                        src = m.group(1)
                        if src.startswith("data:") or src.startswith("http"):
                            return m.group(0)
                        img_path = fpath.parent / src
                        if img_path.exists():
                            mime = "image/gif" if src.endswith(".gif") else "image/png" if src.endswith(".png") else "image/jpeg"
                            b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
                            return f'src="data:{mime};base64,{b64}"'
                        return m.group(0)
                    html = re.sub(r'src="([^"]+)"', _inline_img, html)
                    w.attrs["contents"] = "html://" + html
        # Recurse into group/phase children
        if hasattr(w, "children") and w.children:
            _resolve_note_contents(w.children, tool_dir)
        if hasattr(w, "attrs") and "tabs" in w.attrs:
            for tab in w.attrs["tabs"]:
                _resolve_note_contents(tab.get("widgets", []), tool_dir)


def parse_run_xml(xml_path: str) -> dict:
    """Parse a run.xml (simulation result) file and extract outputs.

    Returns a dict with output data suitable for JSON serialization.
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()

    outputs = {}

    output_elem = root.find("output")
    if output_elem is None:
        return outputs

    # First pass: collect mesh definitions (fields reference them by id)
    mesh_registry = {}
    for child in output_elem:
        if child.tag == "mesh":
            mesh_id = child.get("id", "mesh")
            mesh_registry[mesh_id] = _parse_mesh_element(child)

    # Second pass: parse all outputs
    for child in output_elem:
        elem_id = child.get("id", child.tag)
        tag = child.tag

        if tag == "curve":
            outputs[elem_id] = _parse_curve_output(child)
        elif tag == "histogram":
            outputs[elem_id] = _parse_histogram_output(child)
        elif tag == "number":
            outputs[elem_id] = _parse_number_output(child)
        elif tag == "string":
            outputs[elem_id] = _parse_string_output(child)
        elif tag == "image":
            outputs[elem_id] = _parse_image_output(child)
        elif tag == "log":
            outputs["log"] = {
                "type": "log",
                "content": child.text.strip() if child.text else "",
            }
        elif tag == "table":
            outputs[elem_id] = _parse_table_output(child)
        elif tag == "boolean":
            outputs[elem_id] = {
                "type": "boolean",
                "label": _get_text(child.find("about"), "label") if child.find("about") is not None else "",
                "current": _get_text(child, "current"),
            }
        elif tag == "integer":
            outputs[elem_id] = {
                "type": "integer",
                "label": _get_text(child.find("about"), "label") if child.find("about") is not None else "",
                "current": _get_text(child, "current"),
                "units": _get_text(child, "units"),
            }
        elif tag == "mesh":
            # Only show mesh if not hidden
            mesh_data = mesh_registry.get(elem_id, _parse_mesh_element(child))
            if not mesh_data.get("hide"):
                outputs[elem_id] = {"type": "mesh", **mesh_data}
        elif tag == "field":
            outputs[elem_id] = _parse_field_output(child, mesh_registry)
        elif tag == "sequence":
            outputs[elem_id] = _parse_sequence_output(child)
        elif tag == "group":
            # Output groups contain overlaid items
            group_outputs = {}
            for gc in child:
                gc_id = gc.get("id", gc.tag)
                if gc.tag == "curve":
                    group_outputs[gc_id] = _parse_curve_output(gc)
            outputs[elem_id] = {
                "type": "group",
                "label": _get_text(child.find("about"), "label") if child.find("about") is not None else "",
                "children": group_outputs,
            }

    return outputs


def _parse_curve_output(elem):
    """Parse a <curve> output element into Plotly-compatible data."""
    about = elem.find("about")
    label = _get_text(about, "label") if about is not None else ""
    curve_type = _get_text(about, "type") if about is not None else ""   # line/scatter/bar
    group = _get_text(about, "group") if about is not None else ""

    xaxis_elem = elem.find("xaxis")
    yaxis_elem = elem.find("yaxis")

    xaxis = {}
    if xaxis_elem is not None:
        xaxis = {
            "label": _get_text(xaxis_elem, "label"),
            "units": _get_text(xaxis_elem, "units"),
            "scale": _get_text(xaxis_elem, "scale"),
            "min": _get_text(xaxis_elem, "min"),
            "max": _get_text(xaxis_elem, "max"),
        }
    yaxis = {}
    if yaxis_elem is not None:
        yaxis = {
            "label": _get_text(yaxis_elem, "label"),
            "units": _get_text(yaxis_elem, "units"),
            "scale": _get_text(yaxis_elem, "scale"),
            "log": _get_text(yaxis_elem, "log"),
            "min": _get_text(yaxis_elem, "min"),
            "max": _get_text(yaxis_elem, "max"),
        }

    # Parse XY data from component(s)
    traces = []
    for comp in elem.findall("component"):
        xy_elem = comp.find("xy")
        if xy_elem is not None and xy_elem.text:
            x_vals, y_vals = _parse_xy_text(xy_elem.text)
            trace_label = _get_text(comp.find("about"), "label") if comp.find("about") is not None else ""
            traces.append({
                "x": x_vals,
                "y": y_vals,
                "label": trace_label,
            })

    # If no component wrapper, try direct xy
    if not traces:
        xy_elem = elem.find("component/xy")
        if xy_elem is None:
            xy_elem = elem.find("xy")
        if xy_elem is not None and xy_elem.text:
            x_vals, y_vals = _parse_xy_text(xy_elem.text)
            traces.append({"x": x_vals, "y": y_vals, "label": label})

    return {
        "type": "curve",
        "label": label,
        "curve_type": curve_type,   # line / scatter / bar (empty = line)
        "group": group,
        "xaxis": xaxis,
        "yaxis": yaxis,
        "traces": traces,
    }


def _parse_histogram_output(elem):
    """Parse a <histogram> output element."""
    result = _parse_curve_output(elem)
    result["type"] = "histogram"
    return result


def _parse_number_output(elem):
    """Parse a <number> output element."""
    about = elem.find("about")
    return {
        "type": "number",
        "label": _get_text(about, "label") if about is not None else "",
        "units": _get_text(elem, "units"),
        "current": _get_text(elem, "current"),
    }


def _parse_string_output(elem):
    """Parse a <string> output element."""
    about = elem.find("about")
    return {
        "type": "string",
        "label": _get_text(about, "label") if about is not None else "",
        "current": _get_text(elem, "current"),
    }


def _parse_image_output(elem):
    """Parse an <image> output element."""
    import zlib as _zlib
    about = elem.find("about")
    current = _get_text(elem, "current")
    # Decode Rappture encoding to a data URI so the browser can display it directly
    data_uri = ""
    if current:
        s = current.strip()
        try:
            if s.startswith("@@RP-ENC:zb64"):
                payload = s[len("@@RP-ENC:zb64"):].strip()
                raw = _zlib.decompress(base64.b64decode(payload))
                data_uri = "data:image/*;base64," + base64.b64encode(raw).decode("ascii")
            elif s.startswith("@@RP-ENC:b64"):
                payload = s[len("@@RP-ENC:b64"):].strip()
                data_uri = "data:image/*;base64," + payload.replace('\n', '')
            else:
                # assume raw base64 (no encoding marker)
                data_uri = "data:image/*;base64," + s.replace('\n', '').replace(' ', '')
        except Exception:
            data_uri = ""
    return {
        "type": "image",
        "label": _get_text(about, "label") if about is not None else "",
        "current": data_uri,
    }


def _parse_table_output(elem):
    """Parse a <table> output element."""
    about = elem.find("about")
    # Tables can have column definitions and data
    return {
        "type": "table",
        "label": _get_text(about, "label") if about is not None else "",
        "data": elem.text.strip() if elem.text else "",
    }


def _parse_mesh_element(elem):
    """Parse a <mesh> element into a dict with points and optional cells."""
    about = elem.find("about")
    dim = int(float(_get_text(elem, "dim") or "3"))
    units = _get_text(elem, "units")
    hide = _get_text(elem, "hide") == "yes"

    result = {
        "dim": dim,
        "units": units,
        "hide": hide,
        "label": _get_text(about, "label") if about is not None else "",
    }

    unstructured = elem.find("unstructured")
    if unstructured is not None:
        pts_text = _get_text(unstructured, "points")
        points = []
        for line in pts_text.strip().splitlines():
            coords = line.split()
            if len(coords) >= dim:
                points.append([float(c) for c in coords[:dim]])
        result["mesh_type"] = "unstructured"
        result["points"] = points

        # Optional connectivity
        cells_text = _get_text(unstructured, "cells") or _get_text(unstructured, "triangles")
        if cells_text and cells_text.strip():
            cells = []
            for line in cells_text.strip().splitlines():
                idxs = [int(x) for x in line.split()]
                if idxs:
                    cells.append(idxs)
            result["cells"] = cells

    grid = elem.find("grid")
    if grid is not None:
        result["mesh_type"] = "grid"
        axes = {}
        for axis_tag in ("xaxis", "yaxis", "zaxis"):
            ax = grid.find(axis_tag)
            if ax is not None:
                numpts = int(float(_get_text(ax, "numpoints") or "0"))
                lo = float(_get_text(ax, "min") or "0")
                hi = float(_get_text(ax, "max") or "1")
                axes[axis_tag[0]] = {"min": lo, "max": hi, "numpoints": numpts}
                coords_text = ax.text.strip() if ax.text else ""
                if coords_text:
                    axes[axis_tag[0]]["coords"] = [float(v) for v in coords_text.split()]
        result["axes"] = axes

    return result


def _parse_field_output(elem, mesh_registry=None):
    """Parse a <field> output element, resolving mesh references."""
    import re as _re2
    about = elem.find("about")
    label = _get_text(about, "label") if about is not None else ""
    group = _get_text(about, "group") if about is not None else ""

    components = []
    for comp in elem.findall("component"):
        mesh_ref = _get_text(comp, "mesh")
        values_text = _get_text(comp, "values")
        extents = int(float(_get_text(comp, "extents") or "1"))

        # Parse values respecting extents (scalar or vector per line).
        # Handles both "one value per line" and "all values space-separated".
        values = []
        if values_text:
            all_tokens = values_text.split()
            if extents > 1:
                # Group tokens into vectors of length extents
                for i in range(0, len(all_tokens) - extents + 1, extents):
                    try:
                        values.append([float(t) for t in all_tokens[i:i + extents]])
                    except ValueError:
                        pass
            else:
                for t in all_tokens:
                    try:
                        values.append(float(t))
                    except ValueError:
                        pass

        mesh_data = None
        if mesh_ref and mesh_registry:
            # mesh_ref like "output.mesh(m0)" → key "m0"
            m = _re2.search(r'\(([^)]+)\)', mesh_ref)
            mesh_key = m.group(1) if m else mesh_ref.split(".")[-1]
            mesh_data = mesh_registry.get(mesh_key)

        # Parse <flow> sub-element for flow metadata
        flow_elem = comp.find("flow")
        flow = None
        if flow_elem is not None:
            particles = []
            for p in flow_elem.findall("particles"):
                pid = p.get("id", "p")
                particles.append({
                    "id":       pid,
                    "label":    _get_text(p, "label") or pid,
                    "axis":     _get_text(p, "axis") or "x",
                    "position": _get_text(p, "position") or "50%",
                    "color":    _get_text(p, "color") or "white",
                    "size":     _get_text(p, "size") or "1",
                    "hide":     (_get_text(p, "hide") or "no").lower() == "yes",
                })
            boxes = []
            for b in flow_elem.findall("box"):
                bid = b.get("id", "b")
                def _parse_corner(text):
                    try:
                        return [float(x) for x in (text or "0 0 0").split()]
                    except Exception:
                        return [0, 0, 0]
                boxes.append({
                    "id":        bid,
                    "label":     _get_text(b, "label") or bid,
                    "color":     _get_text(b, "color") or "white",
                    "linewidth": _get_text(b, "linewidth") or "1",
                    "hide":      (_get_text(b, "hide") or "no").lower() == "yes",
                    "corner1":   _parse_corner(_get_text(b, "corner1")),
                    "corner2":   _parse_corner(_get_text(b, "corner2")),
                })
            flow = {
                "label":       _get_text(flow_elem, "label") or "",
                "axis":        _get_text(flow_elem, "axis") or "z",
                "position":    _get_text(flow_elem, "position") or "50%",
                "streams":     (_get_text(flow_elem, "streams") or "no").lower() == "yes",
                "arrows":      (_get_text(flow_elem, "arrows") or "no").lower() == "yes",
                "volume":      (_get_text(flow_elem, "volume") or "yes").lower() != "no",
                "outline":     (_get_text(flow_elem, "outline") or "no").lower() == "yes",
                "particles":   particles,
                "boxes":       boxes,
            }

        components.append({
            "mesh_ref": mesh_ref,
            "mesh": mesh_data,
            "values": values,
            "extents": extents,
            "flow": flow,
        })

    return {
        "type": "field",
        "label": label or group,
        "group": group,
        "components": components,
    }


def _parse_sequence_output(elem):
    """Parse a <sequence> output element."""
    about = elem.find("about")
    # Sequences contain multiple elements at different indices
    elements = []
    for child in elem.findall("element"):
        idx = _get_text(child, "index")
        # Each element can contain curves, fields, etc.
        el_outputs = {}
        for gc in child:
            if gc.tag in OUTPUT_TYPES:
                gc_id = gc.get("id", gc.tag)
                if gc.tag == "curve":
                    el_outputs[gc_id] = _parse_curve_output(gc)
                elif gc.tag == "field":
                    el_outputs[gc_id] = _parse_field_output(gc)
        elements.append({"index": idx, "outputs": el_outputs})

    return {
        "type": "sequence",
        "label": _get_text(about, "label") if about is not None else "",
        "elements": elements,
    }


def _parse_xy_text(text):
    """Parse XY text data into separate x and y lists.

    Format: "x1 y1\nx2 y2\n..." or "x1 y1 x2 y2 ..."
    """
    x_vals = []
    y_vals = []
    lines = text.strip().split("\n")
    for line in lines:
        parts = line.strip().split()
        if len(parts) >= 2:
            try:
                x_vals.append(float(parts[0]))
                y_vals.append(float(parts[1]))
            except ValueError:
                continue
    return x_vals, y_vals


def collect_all_inputs(nodes, result=None):
    """Flatten the input tree into a dict of path -> WidgetNode for easy lookup."""
    if result is None:
        result = {}
    for node in nodes:
        if node.type not in ("separator",):
            result[node.path] = node
        if node.children:
            collect_all_inputs(node.children, result)
    return result
