"""Parse Rappture tool.xml files into Python data structures."""

import base64
import copy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from xml.etree import ElementTree as ET


# Input widget types that contain child widgets
CONTAINER_TYPES = {"group", "phase", "structure"}

# Input widget types that are leaf inputs
INPUT_TYPES = {
    "number", "integer", "boolean", "string", "choice", "multichoice",
    "image", "note", "periodicelement", "loader", "drawing",
}

# Output element types
OUTPUT_TYPES = {
    "curve", "histogram", "field", "image", "string", "number", "integer",
    "boolean", "table", "log", "sequence", "structure", "mesh", "group",
    "mapviewer", "drawing",
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
    current: str = ""
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
    # Description may be inside <about> or as a sibling of <about>
    description = _get_text(about, "description") or _get_text(elem, "description")
    result = {
        "label": _get_text(about, "label"),
        "description": description,
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


def _parse_float_list(text):
    """Parse a whitespace-delimited list of numbers (units allowed)."""
    import re as _re
    vals = []
    for tok in (text or "").split():
        m = _re.match(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", tok.strip())
        if not m:
            continue
        try:
            vals.append(float(m.group(0)))
        except ValueError:
            pass
    return vals


def parse_drawing_input(elem, node):
    """Parse input <drawing> (2D canvas primitives/hotspots)."""
    bg = elem.find("background")
    node.attrs["background"] = {
        "color": _get_text(bg, "color") if bg is not None else "",
        "coordinates": _get_text(bg, "coordinates") if bg is not None else "",
        "aspect": _get_text(bg, "aspect") if bg is not None else "",
        "width": _get_text(bg, "width") if bg is not None else "",
        "height": _get_text(bg, "height") if bg is not None else "",
    }

    subs = {}
    subs_elem = elem.find("substitutions")
    if subs_elem is not None:
        for child in list(subs_elem):
            subs[child.tag] = (child.text or "").strip()
    node.attrs["substitutions"] = subs

    components = []
    comps_elem = elem.find("components")
    if comps_elem is not None:
        for c in list(comps_elem):
            item = {
                "type": c.tag,
                "coords": _parse_float_list(_get_text(c, "coords")),
                "xcoords": _parse_float_list(_get_text(c, "xcoords")),
                "ycoords": _parse_float_list(_get_text(c, "ycoords")),
                "outline": _get_text(c, "outline"),
                "fill": _get_text(c, "fill"),
                "color": _get_text(c, "color"),
                "linewidth": _get_text(c, "linewidth"),
                "arrow": _get_text(c, "arrow"),
                "font": _get_text(c, "font"),
                "anchor": _get_text(c, "anchor"),
                "text": _get_text(c, "text"),
                "hotspot": _get_text(c, "hotspot"),
                "width": _get_text(c, "width"),
                "height": _get_text(c, "height"),
                "contents": _get_text(c, "contents"),
                "dash": _get_text(c, "dash"),
                "controls": [(_c.text or "").strip() for _c in c.findall("controls") if (_c.text or "").strip()],
            }
            components.append(item)
    node.attrs["components"] = components


def parse_structure_input(elem, node, parent_path):
    """Parse input <structure> to extract nested parameters, components, and fields."""
    node.attrs["units"] = _get_text(elem, "units")
    
    components = []
    fields = []
    has_parameters = False

    dflt = elem.find("default")
    if dflt is not None:
        node.attrs["units"] = _get_text(dflt, "units") or node.attrs.get("units", "")

        # Parse <parameters>
        params_elem = dflt.find("parameters")
        if params_elem is not None:
            has_parameters = True
            node.children = _parse_input_children(params_elem, node.path)

        # Parse <components>
        comps = dflt.find("components")
        if comps is not None:
            for child in list(comps):
                if child.tag == "box":
                    about = child.find("about")
                    corners = [_get_text(child, "corner")]
                    for c in child.findall("corner")[1:]:
                        corners.append((c.text or "").strip())
                    
                    c0 = _parse_float_list(corners[0]) if len(corners) > 0 else []
                    c1 = _parse_float_list(corners[1]) if len(corners) > 1 else []
                    
                    box_data = {
                        "type": "box",
                        "label": _get_text(about, "label") if about is not None else "",
                        "color": _get_text(about, "color") if about is not None else "",
                        "icon": _get_text(about, "icon") if about is not None else "",
                        "material": _get_text(child, "material"),
                        "corner0": c0[0] if c0 else 0.0,
                        "corner1": c1[0] if c1 else 0.0,
                        "c0_raw": corners[0] if len(corners) > 0 else "",
                        "c1_raw": corners[1] if len(corners) > 1 else "",
                    }
                    components.append(box_data)
                elif child.tag == "molecule":
                    about = child.find("about")
                    atoms = []
                    for atom in child.findall("atom"):
                        atoms.append({
                            "id": atom.get("id", ""),
                            "symbol": _get_text(atom, "symbol"),
                            "xyz": _parse_float_list(_get_text(atom, "xyz"))
                        })
                    mol_data = {
                        "type": "molecule",
                        "label": _get_text(about, "label") if about is not None else "",
                        "emblems": _get_text(about, "emblems") if about is not None else "",
                        "formula": _get_text(child, "formula"),
                        "atoms": atoms
                    }
                    components.append(mol_data)

        # Parse <fields>
        fields_elem = dflt.find("fields")
        if fields_elem is not None:
            for field in fields_elem.findall("field"):
                about = field.find("about")
                comp = field.find("component")
                
                fields.append({
                    "id": field.get("id", ""),
                    "label": _get_text(about, "label") if about is not None else "",
                    "color": _get_text(about, "color") if about is not None else "",
                    "scale": _get_text(about, "scale") if about is not None else "",
                    "units": _get_text(field, "units"),
                    "constant": _get_text(comp, "constant") if comp is not None else "",
                    "domain": _get_text(comp, "domain") if comp is not None else ""
                })

    # Override with <current> parameters if they exist
    curr = elem.find("current")
    if curr is not None:
        curr_params = curr.find("parameters")
        if curr_params is not None and has_parameters:
            for curr_child in list(curr_params):
                child_id = curr_child.get("id", "")
                if child_id:
                    # Find matching child in node.children
                    for child_node in node.children:
                        if child_node.id == child_id:
                            # Update current value
                            current_val = _get_text(curr_child, "current")
                            if current_val:
                                child_node.current = current_val
                            break

    node.attrs["components"] = components
    node.attrs["fields"] = fields
    # Expose parameters in attrs so JS can read current values directly
    # from data-structure JSON without relying on DOM input fallback.
    node.attrs["parameters"] = [
        {
            "id": child.id,
            "tag": child.type,
            "label": child.label,
            "units": child.attrs.get("units", ""),
            "min": child.attrs.get("min", ""),
            "max": child.attrs.get("max", ""),
            "current": child.current,
            "default": child.default,
        }
        for child in node.children
        if child.type in ("number", "integer", "string")
    ]



def parse_group(elem, node, parent_path):
    """Parse group and its children recursively."""
    about_info, layout = _get_about(elem)
    node.attrs["layout"] = layout

    # A group renders as tabs when:
    #   1. layout is not explicitly "vertical"
    #   2. ALL direct element children (ignoring <about>) are <group> elements
    #   3. Every child group has a label
    #   4. There are at least 2 child groups (single group = no need for tabs)
    # If the group contains anything besides groups (number, choice, etc.) it
    # falls back to vertical layout per the Rappture spec.
    is_vertical = (layout.lower() == "vertical") if layout else False
    non_about_children = [c for c in elem if c.tag != "about"]
    all_children_are_groups = bool(non_about_children) and all(c.tag == "group" for c in non_about_children)
    all_have_labels = all(
        bool(_get_text(c.find("about"), "label")) if c.find("about") is not None else False
        for c in non_about_children
    )
    node.attrs["is_tabbed"] = (
        not is_vertical and all_children_are_groups and all_have_labels
        and len(non_about_children) > 1
    )

    # Parse children
    node.children = _parse_input_children(elem, node.path)


def parse_phase(elem, node, parent_path):
    """Parse phase (tab page) and its children."""
    node.children = _parse_input_children(elem, node.path)
    # If all direct children are labeled groups, render them as tabs inside the phase
    non_about = [c for c in elem if c.tag != "about"]
    all_groups = bool(non_about) and all(c.tag == "group" for c in non_about)
    all_labeled = all(
        bool(_get_text(c.find("about"), "label")) if c.find("about") is not None else False
        for c in non_about
    )
    node.attrs["is_tabbed"] = all_groups and all_labeled and len(non_about) > 1


# Map of type to parser function
TYPE_PARSERS = {
    "number": parse_number,
    "integer": parse_integer,
    "boolean": lambda e, n: None,  # No special attrs
    "string": parse_string,
    "choice": parse_choice,
    "multichoice": parse_multichoice,
    "loader": parse_loader,
    "drawing": parse_drawing_input,
    "structure": None,  # Handled specially to pass parent_path
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
        current=_get_text(elem, "current"),
    )

    # Parse type-specific attributes
    if tag in TYPE_PARSERS:
        if tag == "structure":
            parse_structure_input(elem, node, parent_path)
        else:
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
    elif tag == "drawing":
        node.attrs["about"] = {
            "label": about_info.get("label", ""),
            "description": about_info.get("description", ""),
            "camera": _get_text(elem.find("about"), "camera") if elem.find("about") is not None else "",
        }
        # Parse axis labels/units
        for ax in ("xaxis", "yaxis", "zaxis"):
            ax_elem = elem.find(ax)
            node.attrs[ax] = {
                "label": _get_text(ax_elem, "label") if ax_elem is not None else "",
                "units": _get_text(ax_elem, "units") if ax_elem is not None else "",
            }
        # Parse component children
        molecules = []
        for mol_elem in elem.findall("molecule"):
            mol_id = mol_elem.get("id", "")
            mol_about = mol_elem.find("about")
            molecules.append({
                "id": mol_id,
                "label": _get_text(mol_about, "label") if mol_about is not None else "",
                "style": _get_text(mol_about, "style") if mol_about is not None else "",
                "pdb": (_get_text(mol_elem, "pdb") or "").strip(),
                "vtk": (_get_text(mol_elem, "vtk") or "").strip(),
            })
        node.attrs["molecules"] = molecules

        polydata = []
        for pd_tag in ("polydata", "polygon"):
            for pd_elem in elem.findall(pd_tag):
                pd_id = pd_elem.get("id", "")
                pd_about = pd_elem.find("about")
                polydata.append({
                    "id": pd_id,
                    "label": _get_text(pd_about, "label") if pd_about is not None else "",
                    "style": _get_text(pd_about, "style") if pd_about is not None else "",
                    "vtk": (_get_text(pd_elem, "vtk") or "").strip(),
                })
        node.attrs["polydata"] = polydata

        glyphs = []
        for gl_elem in elem.findall("glyphs"):
            gl_id = gl_elem.get("id", "")
            gl_about = gl_elem.find("about")
            glyphs.append({
                "id": gl_id,
                "label": _get_text(gl_about, "label") if gl_about is not None else "",
                "shape": _get_text(gl_about, "shape") if gl_about is not None else "",
                "style": _get_text(gl_about, "style") if gl_about is not None else "",
                "vtk": (_get_text(gl_elem, "vtk") or "").strip(),
            })
        node.attrs["glyphs"] = glyphs
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
                raw = child.text.strip()
                if raw.startswith("@@RP-ENC:"):
                    raw = _decode_rp_enc(raw).decode("utf-8", errors="replace")
                node.attrs["content"] = raw
            children.append(node)
    return children


def parse_tool_xml(xml_path: str, base_path: str = "") -> ToolDef:  # base_path kept for API compat
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
    _resolve_note_contents(tool_def.inputs, xml_path.parent, base_path=base_path)

    return tool_def


def _encode_tool_files_relpath(target: Path, tool_dir: Path) -> str:
    """Encode a resolved target path into a /tool-files-safe relative path.

    Parent traversals are encoded as "__up__" so browsers don't normalize
    "/tool-files/../..." into "/...".
    """
    import os

    rel = Path(os.path.relpath(str(target.resolve()), str(tool_dir.resolve()))).as_posix()
    encoded_parts = []
    for part in rel.split("/"):
        if part in ("", "."):
            continue
        encoded_parts.append("__up__" if part == ".." else part)
    return "/".join(encoded_parts)


def _resolve_note_contents(widgets, tool_dir: Path, base_path: str = ""):
    """Resolve file:// references in note widget contents and inline images."""
    import re
    tool_dir = tool_dir.resolve()
    for w in widgets:
        if w.type == "note":
            contents = w.attrs.get("contents", "")
            if contents and contents.startswith("file://"):
                fname = contents[7:].strip()
                fpath = tool_dir / fname
                if fpath.exists():
                    html = fpath.read_text(errors="replace")
                    # Rewrite relative src/href paths to go through /tool-files/.
                    # Resolve path references relative to the note HTML file.
                    bp = base_path.rstrip("/")

                    def _rewrite_attr(match):
                        attr = match.group("attr")
                        quote = match.group("quote")
                        raw = match.group("value").strip()
                        lower = raw.lower()
                        if (
                            lower.startswith("data:")
                            or lower.startswith("http://")
                            or lower.startswith("https://")
                            or lower.startswith("//")
                            or lower.startswith("mailto:")
                            or lower.startswith("javascript:")
                            or raw.startswith("#")
                            or raw.startswith("/")
                        ):
                            return match.group(0)

                        # Keep query/fragment while resolving filesystem path.
                        suffix = ""
                        for sep in ("?", "#"):
                            idx = raw.find(sep)
                            if idx != -1:
                                suffix = raw[idx:]
                                raw = raw[:idx]
                                break

                        resolved = (fpath.parent / raw).resolve()
                        encoded_rel = _encode_tool_files_relpath(resolved, tool_dir)
                        return f'{attr}={quote}{bp}/tool-files/{encoded_rel}{suffix}{quote}'

                    html = re.sub(
                        r'(?P<attr>src|href)\s*=\s*(?P<quote>["\'])(?P<value>[^"\']+)(?P=quote)',
                        _rewrite_attr,
                        html,
                        flags=re.IGNORECASE,
                    )
                    w.attrs["contents"] = "html://" + html
        # Recurse into group/phase children
        if hasattr(w, "children") and w.children:
            _resolve_note_contents(w.children, tool_dir, base_path=base_path)
        if hasattr(w, "attrs") and "tabs" in w.attrs:
            for tab in w.attrs["tabs"]:
                _resolve_note_contents(tab.get("widgets", []), tool_dir, base_path=base_path)


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
            raw_log = child.text.strip() if child.text else ""
            if raw_log.startswith("@@RP-ENC:"):
                raw_log = _decode_rp_enc(raw_log).decode("utf-8", errors="replace")
            outputs["log"] = {
                "type": "log",
                "content": raw_log,
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
            outputs[elem_id] = _parse_sequence_output(child, mesh_registry=mesh_registry)
        elif tag == "mapviewer":
            outputs[elem_id] = _parse_mapviewer_output(child)
        elif tag == "drawing":
            outputs[elem_id] = _parse_drawing_output(child)
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
    _style_text = (_get_text(about, "style") or _get_text(about, "color") or "") if about is not None else ""
    curve_style = _parse_rappture_style(_style_text)

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
            style_text = _get_text(comp, "style") or ""
            style = _parse_rappture_style(style_text) or curve_style
            traces.append({
                "x": x_vals,
                "y": y_vals,
                "label": trace_label,
                "style": style,
            })

    # If no component wrapper, try direct xy
    if not traces:
        xy_elem = elem.find("component/xy")
        if xy_elem is None:
            xy_elem = elem.find("xy")
        if xy_elem is not None and xy_elem.text:
            x_vals, y_vals = _parse_xy_text(xy_elem.text)
            traces.append({"x": x_vals, "y": y_vals, "label": label, "style": curve_style})

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
    """Parse a <table> output element into structured columns + rows."""
    about = elem.find("about")
    label = _get_text(about, "label") if about is not None else ""

    # Parse column definitions
    columns = []
    for col in elem.findall("column"):
        col_about = col.find("about")
        col_label = _get_text(col_about, "label") if col_about is not None else col.get("id", "")
        columns.append({
            "id": col.get("id", col_label),
            "label": col_label,
            "units": _get_text(col, "units") or "",
        })

    # Parse whitespace-delimited data rows
    data_text = _get_text(elem, "data") or ""
    rows = []
    for line in data_text.strip().splitlines():
        parts = line.split()
        if parts:
            rows.append(parts)

    # Detect energy column: any column whose units are an energy unit
    _ENERGY_UNITS = {"ev", "mev", "kev", "j", "kj", "kcal", "hartree", "ry", "rydberg", "cm-1", "thz"}
    energy_col_idx = None
    label_col_idx = None
    for i, col in enumerate(columns):
        u = col["units"].lower().replace(" ", "")
        if u in _ENERGY_UNITS:
            energy_col_idx = i
        elif not col["units"]:
            label_col_idx = i

    return {
        "type": "table",
        "label": label,
        "columns": columns,
        "rows": rows,
        "energy_col": energy_col_idx,
        "label_col": label_col_idx,
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


def _interpolate_to_grid(points, values, grid_n=20):
    """Interpolate unstructured 3D scalar data onto a uniform NxNxN grid.

    Returns a dict with flat x/y/z/value arrays ready for Plotly isosurface,
    or None if scipy is not available or interpolation fails.
    """
    try:
        import numpy as np
        from scipy.interpolate import griddata
    except ImportError:
        return None

    pts = np.array(points, dtype=float)
    vals = np.array(values, dtype=float)

    xmin, xmax = pts[:, 0].min(), pts[:, 0].max()
    ymin, ymax = pts[:, 1].min(), pts[:, 1].max()
    zmin, zmax = pts[:, 2].min(), pts[:, 2].max()

    # Avoid degenerate axes
    if xmax == xmin: xmax = xmin + 1.0
    if ymax == ymin: ymax = ymin + 1.0
    if zmax == zmin: zmax = zmin + 1.0

    xi = np.linspace(xmin, xmax, grid_n)
    yi = np.linspace(ymin, ymax, grid_n)
    zi = np.linspace(zmin, zmax, grid_n)

    gx, gy, gz = np.meshgrid(xi, yi, zi, indexing='ij')
    grid_pts = np.column_stack([gx.ravel(), gy.ravel(), gz.ravel()])

    try:
        vi = griddata(pts, vals, grid_pts, method='linear', fill_value=float('nan'))
        # Fill NaN holes with nearest-neighbour so isosurface has no gaps
        nan_mask = np.isnan(vi)
        if nan_mask.any():
            vi_nn = griddata(pts, vals, grid_pts[nan_mask], method='nearest')
            vi[nan_mask] = vi_nn
    except Exception:
        return None

    return {
        "x": gx.ravel().tolist(),
        "y": gy.ravel().tolist(),
        "z": gz.ravel().tolist(),
        "value": vi.tolist(),
        "nx": grid_n, "ny": grid_n, "nz": grid_n,
    }


def _decode_rp_enc(text):
    """Decode a @@RP-ENC:zb64 or @@RP-ENC:b64 encoded string to bytes."""
    import zlib as _zlib
    text = text.strip()
    if text.startswith("@@RP-ENC:zb64"):
        raw = base64.b64decode(text[len("@@RP-ENC:zb64"):].strip())
        return _zlib.decompress(raw, 47)  # wbits=47 → auto-detect zlib/gzip
    elif text.startswith("@@RP-ENC:b64"):
        return base64.b64decode(text[len("@@RP-ENC:b64"):].strip())
    return text.encode()


def _parse_vtk_legacy(vtk_bytes):
    """Parse VTK legacy ASCII STRUCTURED_POINTS into grid_data dict.

    Returns dict with keys: nx, ny, nz, dx, dy, dz, ox, oy, oz, values (flat list), len.
    Returns None if format is unsupported.
    """
    try:
        text = vtk_bytes.decode("utf-8", errors="replace")
        lines = text.splitlines()
        dims = spacing = origin = None
        scalar_name = None
        values = []
        reading_scalars = False
        for line in lines:
            ls = line.strip()
            if ls.upper().startswith("DIMENSIONS"):
                parts = ls.split()
                dims = (int(parts[1]), int(parts[2]), int(parts[3]))
            elif ls.upper().startswith("SPACING"):
                parts = ls.split()
                spacing = (float(parts[1]), float(parts[2]), float(parts[3]))
            elif ls.upper().startswith("ORIGIN"):
                parts = ls.split()
                origin = (float(parts[1]), float(parts[2]), float(parts[3]))
            elif ls.upper().startswith("SCALARS"):
                parts = ls.split()
                scalar_name = parts[1] if len(parts) > 1 else "scalar"
                reading_scalars = False  # wait for LOOKUP_TABLE
            elif ls.upper().startswith("LOOKUP_TABLE"):
                reading_scalars = True
            elif reading_scalars and ls:
                for tok in ls.split():
                    try:
                        values.append(float(tok))
                    except ValueError:
                        pass
        if dims is None or spacing is None or origin is None or not values:
            return None
        nx, ny, nz = dims
        return {
            "nx": nx, "ny": ny, "nz": nz,
            "dx": spacing[0], "dy": spacing[1], "dz": spacing[2],
            "ox": origin[0], "oy": origin[1], "oz": origin[2],
            "values": values,
            "len": len(values),
            "scalar_name": scalar_name or "scalar",
        }
    except Exception:
        return None


def _parse_field_output(elem, mesh_registry=None):
    """Parse a <field> output element, resolving mesh references."""
    import re as _re2
    about = elem.find("about")
    label = _get_text(about, "label") if about is not None else ""
    group = _get_text(about, "group") if about is not None else ""

    components = []
    for comp in elem.findall("component"):
        comp_id = comp.get("id", "")
        vtk_text = _get_text(comp, "vtk")
        style_text = _get_text(comp, "style") or ""

        # Handle VTK-encoded components (@@RP-ENC:zb64 or raw VTK text)
        if vtk_text:
            vtk_bytes = _decode_rp_enc(vtk_text) if vtk_text.strip().startswith("@@RP-ENC") else vtk_text.encode()
            vtk_grid = _parse_vtk_legacy(vtk_bytes)
            if vtk_grid:
                components.append({
                    "comp_id": comp_id,
                    "mesh_ref": None,
                    "mesh": None,
                    "values": [],  # values are in grid_data to avoid duplication
                    "extents": 1,
                    "flow": None,
                    "grid_data": vtk_grid,
                    "style": style_text,
                    "vtk_type": "structured_points",
                })
            continue

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

        # For unstructured 3D scalar fields, pre-interpolate onto a uniform grid
        # so the JS isosurface renderer (Plotly) gets a proper volumetric dataset.
        grid_data = None
        if (mesh_data and mesh_data.get("mesh_type") == "unstructured"
                and mesh_data.get("dim", 3) == 3
                and extents == 1
                and len(values) == len(mesh_data.get("points", []))):
            grid_data = _interpolate_to_grid(mesh_data["points"], values)

        components.append({
            "mesh_ref": mesh_ref,
            "mesh": mesh_data,
            "values": values,
            "extents": extents,
            "flow": flow,
            "grid_data": grid_data,
        })

    return {
        "type": "field",
        "label": label or group,
        "group": group,
        "components": components,
    }


def _parse_mapviewer_output(elem):
    """Parse a <mapviewer> output element.

    Supports layers of type: scatter (lat/lon points), choropleth (country/region fills),
    and lines (great-circle or path lines).

    XML structure example:
        <mapviewer id="map">
          <about><label>My Map</label></about>
          <projection>natural earth</projection>  <!-- optional Plotly geo projection -->
          <layer id="cities" type="scatter">
            <about><label>Cities</label></about>
            <color>#e74c3c</color>
            <size>8</size>
            <data>
              <!-- lat lon text -->
              40.71 -74.01 New York
              51.51 -0.13 London
              35.69 139.69 Tokyo
            </data>
          </layer>
          <layer id="countries" type="choropleth">
            <about><label>Population</label></about>
            <colorscale>Viridis</colorscale>
            <data>
              <!-- iso3 value -->
              USA 331000000
              CHN 1411000000
              IND 1380000000
            </data>
          </layer>
        </mapviewer>
    """
    about = elem.find("about")
    label = _get_text(about, "label") if about is not None else ""
    projection = _get_text(elem, "projection") or "natural earth"
    scope = _get_text(elem, "scope") or "world"

    layers = []
    for layer in elem.findall("layer"):
        layer_id = layer.get("id", "layer")
        # type can be an XML attribute or a child text element
        layer_type = layer.get("type") or _get_text(layer, "type") or "scatter"
        layer_about = layer.find("about")
        layer_label = _get_text(layer_about, "label") if layer_about is not None else layer_id
        color = _get_text(layer, "color") or None
        size = _get_text(layer, "size") or "6"
        colorscale = _get_text(layer, "colorscale") or "Viridis"
        opacity = _get_text(layer, "opacity") or "1"
        data_text = _get_text(layer, "data") or ""

        parsed = {"id": layer_id, "type": layer_type, "label": layer_label,
                  "color": color, "size": size, "colorscale": colorscale, "opacity": opacity}

        if layer_type == "scatter":
            lats, lons, texts = [], [], []
            for line in data_text.strip().splitlines():
                parts = line.strip().split(None, 2)
                if len(parts) >= 2:
                    try:
                        lats.append(float(parts[0]))
                        lons.append(float(parts[1]))
                        texts.append(parts[2] if len(parts) > 2 else "")
                    except ValueError:
                        pass
            parsed["lats"] = lats
            parsed["lons"] = lons
            parsed["texts"] = texts

        elif layer_type == "choropleth":
            locations, values = [], []
            for line in data_text.strip().splitlines():
                parts = line.strip().split(None, 1)
                if len(parts) == 2:
                    try:
                        locations.append(parts[0])
                        values.append(float(parts[1]))
                    except ValueError:
                        pass
            parsed["locations"] = locations
            parsed["values"] = values

        elif layer_type == "line":
            # Each line: lat_start lon_start lat_end lon_end [label]
            segments = []
            for line in data_text.strip().splitlines():
                parts = line.strip().split(None, 4)
                if len(parts) >= 4:
                    try:
                        segments.append({
                            "lat0": float(parts[0]), "lon0": float(parts[1]),
                            "lat1": float(parts[2]), "lon1": float(parts[3]),
                            "label": parts[4] if len(parts) > 4 else "",
                        })
                    except ValueError:
                        pass
            parsed["segments"] = segments

        elif layer_type == "heatmap":
            # Each line: lat lon value [text]
            lats, lons, values, texts = [], [], [], []
            for line in data_text.strip().splitlines():
                parts = line.strip().split(None, 3)
                if len(parts) >= 3:
                    try:
                        lats.append(float(parts[0]))
                        lons.append(float(parts[1]))
                        values.append(float(parts[2]))
                        texts.append(parts[3] if len(parts) > 3 else "")
                    except ValueError:
                        pass
            parsed["lats"] = lats
            parsed["lons"] = lons
            parsed["values"] = values
            parsed["texts"] = texts

        layers.append(parsed)

    return {
        "type": "mapviewer",
        "label": label,
        "projection": projection,
        "scope": scope,
        "layers": layers,
    }


def _parse_drawing_output(elem):
    """Parse a <drawing> output element with molecule/polydata/glyph components."""
    about = elem.find("about")

    def _decode_payload(text):
        raw = (text or "").strip()
        if not raw:
            return ""
        if raw.startswith("@@RP-ENC:"):
            return _decode_rp_enc(raw).decode("utf-8", errors="replace")
        return raw

    molecules = []
    for mol in elem.findall("molecule"):
        mol_about = mol.find("about")
        molecules.append({
            "id": mol.get("id", ""),
            "label": _get_text(mol_about, "label") if mol_about is not None else "",
            "style": _get_text(mol_about, "style") if mol_about is not None else "",
            "pdb": _decode_payload(_get_text(mol, "pdb")),
            "vtk": _decode_payload(_get_text(mol, "vtk")),
        })

    polydata = []
    for pd_tag in ("polydata", "polygon"):
        for pd in elem.findall(pd_tag):
            pd_about = pd.find("about")
            polydata.append({
                "id": pd.get("id", ""),
                "label": _get_text(pd_about, "label") if pd_about is not None else "",
                "style": _get_text(pd_about, "style") if pd_about is not None else "",
                "vtk": _decode_payload(_get_text(pd, "vtk")),
            })

    glyphs = []
    for gl in elem.findall("glyphs"):
        gl_about = gl.find("about")
        glyphs.append({
            "id": gl.get("id", ""),
            "label": _get_text(gl_about, "label") if gl_about is not None else "",
            "shape": _get_text(gl_about, "shape") if gl_about is not None else "",
            "style": _get_text(gl_about, "style") if gl_about is not None else "",
            "vtk": _decode_payload(_get_text(gl, "vtk")),
        })

    axes = {}
    for axis in ("xaxis", "yaxis", "zaxis"):
        ax = elem.find(axis)
        axes[axis] = {
            "label": _get_text(ax, "label") if ax is not None else "",
            "units": _get_text(ax, "units") if ax is not None else "",
        }

    return {
        "type": "drawing",
        "label": _get_text(about, "label") if about is not None else "",
        "description": _get_text(about, "description") if about is not None else "",
        "camera": _get_text(about, "camera") if about is not None else "",
        "molecules": molecules,
        "polydata": polydata,
        "glyphs": glyphs,
        **axes,
    }


def _parse_sequence_output(elem, mesh_registry=None):
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
                    el_outputs[gc_id] = _parse_field_output(gc, mesh_registry=mesh_registry)
                elif gc.tag == "image":
                    el_outputs[gc_id] = _parse_image_output(gc)
        elements.append({"index": idx, "outputs": el_outputs})

    index_elem = elem.find("index")
    index_label = _get_text(index_elem, "label") if index_elem is not None else "Frame"

    return {
        "type": "sequence",
        "label": _get_text(about, "label") if about is not None else "",
        "index_label": index_label,
        "elements": elements,
    }


def _parse_rappture_style(style_text):
    """Parse a Rappture style string like '-color red -linestyle dashed -linewidth 2'.
    Returns a dict with keys: color, linestyle, linewidth, symbol, fill, opacity.
    """
    result = {}
    if not style_text:
        return result
    import re
    tokens = re.split(r'\s+', style_text.strip())
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.startswith('-') and i + 1 < len(tokens):
            key = tok[1:]
            val = tokens[i + 1]
            result[key] = val
            i += 2
        else:
            i += 1
    return result


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
