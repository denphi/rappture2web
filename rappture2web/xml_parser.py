"""Parse Rappture tool.xml files into Python data structures."""

from __future__ import annotations

import base64
import copy
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)

# Bundled XSD shipped with the package
_BUNDLED_XSD = Path(__file__).parent / "contract.xsd"

# XSI namespace used for schemaLocation attributes
_XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

# Cache compiled XSD schemas keyed by absolute path + mtime so a server
# parsing many tool.xml files (or one file repeatedly on hot-reload) does
# not recompile the schema on every call.
_SCHEMA_CACHE: dict[tuple[str, int], object] = {}

# Surface lxml-missing exactly once per process so the user sees a clear
# warning instead of silently losing schema validation.
_LXML_WARNED = False


def _load_schema(xsd_path: Path):
    """Return a compiled lxml XMLSchema for *xsd_path*, or None if lxml missing."""
    global _LXML_WARNED
    try:
        from lxml import etree
    except ImportError:
        if not _LXML_WARNED:
            logger.warning(
                "lxml is not installed; tool.xml schema validation is disabled. "
                "Install lxml to enable contract enforcement."
            )
            _LXML_WARNED = True
        return None

    try:
        mtime = xsd_path.stat().st_mtime_ns
    except OSError:
        mtime = 0
    key = (str(xsd_path), mtime)
    cached = _SCHEMA_CACHE.get(key)
    if cached is not None:
        return cached
    with xsd_path.open("rb") as f:
        schema = etree.XMLSchema(etree.parse(f))
    _SCHEMA_CACHE[key] = schema
    return schema


def _validate_against_schema(xml_path: Path, xsd_path: Path) -> None:
    """Validate *xml_path* against *xsd_path* using lxml.

    Raises ValueError listing all validation errors if the document is invalid.
    Silently skips (with a one-time warning) when lxml is not installed.
    """
    schema = _load_schema(xsd_path)
    if schema is None:
        return
    from lxml import etree
    doc = etree.parse(str(xml_path))
    if not schema.validate(doc):
        errors = "\n".join(str(e) for e in schema.error_log)
        raise ValueError(
            f"Schema validation failed for {xml_path}:\n{errors}"
        )


def strip_units(value: str) -> str:
    """Strip trailing unit suffix from a Rappture value string.

    '300K' → '300', '2eV' → '2', '-5eV' → '-5', '2e15/cm3' → '2e15'.
    Returns the original string unchanged if no numeric prefix is found.
    """
    if not value:
        return value
    m = re.match(r'^([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)', value.strip())
    return m.group(1) if m else value


def parse_rappture_path(path: str) -> list[tuple[str, str]]:
    """Split a Rappture path into (tag, id) segments.

    'input.number(temperature)' → [('input',''), ('number','temperature')]
    '(temperature)' → [('','temperature')]  (bare-id wildcard for fuzzy matching)
    Empty segments (from double dots) are skipped.
    """
    parts = []
    for seg in path.split("."):
        if not seg:
            continue
        if "(" in seg and seg.endswith(")"):
            tag = seg[: seg.index("(")]
            eid = seg[seg.index("(") + 1: -1]
            parts.append((tag, eid))  # tag may be '' for bare-id wildcard
        else:
            parts.append((seg, ""))
    return parts


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
    uq_enabled: bool = False   # True if <tool><uq>true</uq></tool>
    cache_enabled: bool = True  # False if <tool><cache>no</cache></tool>


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
    inputs: list = field(default_factory=list)   # List of WidgetNode
    outputs: list = field(default_factory=list)  # List of OutputNode
    contract: dict = field(default_factory=dict) # Parsed contract block (inputs/outputs)
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

    # UQ: <uq>false</uq> opts this input out of UQ even when tool has uq=true
    uq_text = _get_text(elem, "uq", "").lower()
    node.attrs["uq_enabled"] = uq_text not in ("false", "no", "0")

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
    uq_text = _get_text(elem, "uq", "").lower()
    node.attrs["uq_enabled"] = uq_text not in ("false", "no", "0")


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
    examples = [e.text.strip() for e in elem.findall("example") if e.text and e.text.strip()]
    node.attrs["examples"] = examples
    node.attrs["example"] = examples[0] if examples else ""
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

    subs = []
    subs_elem = elem.find("substitutions")
    if subs_elem is not None:
        for child in list(subs_elem):
            if child.tag == "variable":
                var = {
                    "name": _get_text(child, "name"),
                    "path": _get_text(child, "path"),
                    "maps": []
                }
                for map_elem in child.findall("map"):
                    var["maps"].append({
                        "from": _get_text(map_elem, "from"),
                        "to": _get_text(map_elem, "to")
                    })
                subs.append(var)
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
    """Parse input <structure> to extract nested parameters, components, and fields.

    Handles three XML layouts that occur in real Rappture tools:
      1. <structure><default><parameters>  — fully-defined parameters in default
      2. <structure><number id="...">...   — flat direct children (mosfet.xml style)
      3. <structure><current><parameters>  — loader-initialized canonical form
    """
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
                field_label = _get_text(about, "label") if about is not None else ""
                field_color = _get_text(about, "color") if about is not None else ""
                field_scale = _get_text(about, "scale") if about is not None else ""
                field_units = _get_text(field, "units")
                field_id = field.get("id", "")
                for comp in field.findall("component"):
                    fields.append({
                        "id": field_id,
                        "label": field_label,
                        "color": field_color,
                        "scale": field_scale,
                        "units": field_units,
                        "constant": _get_text(comp, "constant"),
                        "domain": _get_text(comp, "domain")
                    })

    # ── Flat direct-child pattern (mosfet.xml style) ─────────────────────────
    # <structure> may have number/integer elements as direct children that carry
    # full metadata (units, min, max, about) — use them when no <default><parameters>.
    if not has_parameters:
        flat_params = [
            c for c in elem
            if c.tag in ("number", "integer", "string", "choice", "boolean") and c.get("id")
        ]
        if flat_params:
            has_parameters = True
            node.children = _parse_input_children(elem, node.path)

    # ── <current><parameters> pattern (nmos.xml / loader style) ─────────────
    # This is the canonical Rappture location; it overrides current values and
    # can also supply components/fields if not already populated.
    curr = elem.find("current")
    if curr is not None:
        # Extract components/fields from <current> if not yet set
        if not components:
            comps = curr.find("components")
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

        if not fields:
            fields_elem = curr.find("fields")
            if fields_elem is not None:
                for field in fields_elem.findall("field"):
                    about = field.find("about")
                    field_label = _get_text(about, "label") if about is not None else ""
                    field_color = _get_text(about, "color") if about is not None else ""
                    field_scale = _get_text(about, "scale") if about is not None else ""
                    field_units = _get_text(field, "units")
                    field_id = field.get("id", "")
                    for comp in field.findall("component"):
                        fields.append({
                            "id": field_id,
                            "label": field_label,
                            "color": field_color,
                            "scale": field_scale,
                            "units": field_units,
                            "constant": _get_text(comp, "constant"),
                            "domain": _get_text(comp, "domain")
                        })

        curr_params = curr.find("parameters")
        if curr_params is not None:
            if not has_parameters:
                # Fully defined under <current><parameters> (loader-initialized)
                has_parameters = True
                node.children = _parse_input_children(curr_params, node.path)
            else:
                # Merge: update current values from <current><parameters>
                for curr_child in list(curr_params):
                    child_id = curr_child.get("id", "")
                    if not child_id:
                        continue
                    for child_node in node.children:
                        if child_node.id == child_id:
                            current_val = _get_text(curr_child, "current")
                            if current_val:
                                child_node.current = current_val
                            # Pick up units if not already set from flat sibling
                            if not child_node.attrs.get("units"):
                                u = _get_text(curr_child, "units")
                                if u:
                                    child_node.attrs["units"] = u
                            break

    node.attrs["components"] = components
    node.attrs["fields"] = fields
    node.attrs["xmlPath"] = node.path
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

    # For number elements: if <current> is a zero placeholder (bare "0" or
    # "0<units>") but <default> is a non-zero value, use the default so the
    # UI shows the correct initial value instead of the tool.xml sentinel.
    if tag == "number" and node.current and node.default:
        import re as _re
        m_num = _re.match(r'^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*\S*$', node.current.strip())
        if m_num:
            try:
                cur_val = float(m_num.group(1))
            except ValueError:
                cur_val = None
            if cur_val == 0.0:
                m_def = _re.match(r'[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?', node.default.strip())
                if m_def and float(m_def.group(0)) != 0.0:
                    node.current = node.default

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
    elif tag == "structure":
        # Map structure output to drawing format so the drawing renderer handles it
        parsed = _parse_structure_output(elem)
        node.type = "drawing"
        node.attrs["about"] = {
            "label": parsed.get("label", ""),
            "description": parsed.get("description", ""),
            "camera": parsed.get("camera", ""),
        }
        node.attrs["molecules"] = parsed.get("molecules", [])
        node.attrs["polydata"] = parsed.get("polydata", [])
        node.attrs["glyphs"] = parsed.get("glyphs", [])
        for ax in ("xaxis", "yaxis", "zaxis"):
            node.attrs[ax] = parsed.get(ax, {"label": "", "units": ""})
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

    If the root <run> element carries an xsi:noNamespaceSchemaLocation attribute
    the document is validated against that XSD before parsing.  If no schema
    location is declared but the tool contains a <contract> block, the bundled
    contract.xsd is used instead.  Validation failures raise ValueError.

    Args:
        xml_path: Path to the tool.xml file.

    Returns:
        ToolDef with parsed tool definition.
    """
    xml_path = Path(xml_path).resolve()

    # ── Schema validation ─────────────────────────────────────────────────────
    # Parse with stdlib ET first (cheap) to inspect the root attributes.
    tree = ET.parse(str(xml_path))
    root = tree.getroot()

    if root.tag != "run":
        raise ValueError(f"Expected <run> root element, got <{root.tag}>")

    schema_loc = root.get(f"{{{_XSI_NS}}}noNamespaceSchemaLocation")
    has_contract = root.find("tool/contract") is not None

    # A tool is considered "new-format" when either:
    #   - it declares a schema via xsi:noNamespaceSchemaLocation, or
    #   - its <tool><version> starts with "2." (Rappture 2.x)
    # Either marker requires a <contract> block so v2 tools cannot silently
    # bypass enforcement.
    version_text = ""
    tool_node = root.find("tool")
    if tool_node is not None:
        version_node = tool_node.find("version")
        if version_node is not None:
            version_text = (version_node.text or "").strip()
            # Inline form: <version>2.0</version> wins.  If the tool uses a
            # nested <version><application><revision>... pattern look for an
            # explicit "schema" child carrying the schema version.
            schema_node = version_node.find("schema")
            if schema_node is not None and (schema_node.text or "").strip():
                version_text = schema_node.text.strip()
    is_v2 = version_text.startswith("2.")
    is_new_format = bool(schema_loc) or is_v2

    if is_new_format and not has_contract:
        marker = (
            f"schema {schema_loc!r}" if schema_loc else f"version {version_text!r}"
        )
        raise ValueError(
            f"{xml_path.name}: tool declares {marker} but is missing "
            f"<tool><contract>.  Rappture 2.x tools must include a contract."
        )

    if schema_loc:
        xsd_path = (xml_path.parent / schema_loc).resolve()
        if not xsd_path.exists():
            raise ValueError(
                f"Declared schema not found: {xsd_path} (from {schema_loc!r})"
            )
        logger.debug("Validating %s against declared schema %s", xml_path.name, xsd_path)
        _validate_against_schema(xml_path, xsd_path)
    elif has_contract and _BUNDLED_XSD.exists():
        logger.debug("Validating %s against bundled contract.xsd", xml_path.name)
        _validate_against_schema(xml_path, _BUNDLED_XSD)

    # ── Build ToolDef ─────────────────────────────────────────────────────────
    tool_def = ToolDef(
        xml_path=str(xml_path),
        tool_dir=str(xml_path.parent),
    )

    # Parse <tool> section
    tool_elem = root.find("tool")
    if tool_elem is not None:
        uq_text = _get_text(tool_elem, "uq", "").lower()
        cache_text = _get_text(tool_elem, "cache", "").lower()
        tool_def.tool = ToolInfo(
            title=_get_text(tool_elem, "title"),
            about=_get_text(tool_elem, "about"),
            command=_get_text(tool_elem, "command"),
            uq_enabled=(uq_text in ("true", "yes", "1")),
            cache_enabled=(cache_text not in ("false", "no", "0")),
        )
        # Parse <contract> block if present.  Structural errors (duplicate
        # singletons, missing id) and semantic errors (label/default/range
        # rules) are collected together and surfaced in a single ValueError.
        contract_elem = tool_elem.find("contract")
        if contract_elem is not None:
            contract_errors: list[str] = []
            tool_def.contract = _parse_contract(contract_elem, contract_errors)
            _validate_contract_semantics(tool_def.contract, xml_path, contract_errors)
            if contract_errors:
                raise ValueError(
                    f"Contract semantic errors in {xml_path}:\n"
                    + "\n".join(f"  - {e}" for e in contract_errors)
                )

    # Parse <input> section
    input_elem = root.find("input")
    if input_elem is not None:
        tool_def.inputs = _parse_input_children(input_elem, "input")

    # Parse <output> section
    output_elem = root.find("output")
    if output_elem is not None:
        tool_def.outputs = _parse_output_children(output_elem, "output")

    # Cross-check runtime widget IDs against the contract (when present)
    if tool_def.contract:
        _validate_contract_vs_runtime(tool_def, xml_path)

    # Resolve file:// references in note widgets
    _resolve_note_contents(tool_def.inputs, xml_path.parent, base_path=base_path)

    return tool_def


# ── Contract widget-type taxonomy ────────────────────────────────────────────
# Used by the validator and by runtime output checks.  Keep in sync with the
# XSD's ContractInput/OutputSectionType elements.

# Input widget types that must appear in <tool><contract><input>.
_CONTRACT_INPUT_TYPES = {
    "number", "integer", "boolean", "string", "choice",
    "multichoice", "periodicelement", "file",
}

# Runtime <input> widget types that carry data and must be declared.
_DATA_INPUT_TYPES = set(_CONTRACT_INPUT_TYPES)
# Runtime <input> widget types that are purely UI layout — not contract-bound.
_UI_INPUT_TYPES = {
    "group", "phase", "note", "separator", "loader", "image", "drawing",
    "structure",
}

# Output widget types that may appear in <tool><contract><output>.
_CONTRACT_OUTPUT_TYPES = {
    "number", "integer", "string", "boolean", "curve", "histogram", "field",
    "image", "table", "structure", "drawing", "log", "sequence", "mesh",
    "mapviewer",
}

# Types that the runtime parser normalises into other types.  When checking
# runtime-produced output against the contract, the contract may legally
# declare either side of the pair.
_OUTPUT_TYPE_ALIASES: dict[str, set[str]] = {
    "drawing":   {"drawing", "structure"},
    "structure": {"drawing", "structure"},
}

# Singleton children that must not appear more than once inside a contract
# widget.  <option> and <preset> are intentionally absent — they may repeat.
_CONTRACT_SINGLETON_CHILDREN = {
    "about", "default", "units", "min", "max", "accept", "returnvalue",
    "active", "inactive",
}


def _output_types_match(declared: str, actual: str) -> bool:
    """Return True when *actual* is acceptable for a contract that declares *declared*."""
    if not declared or not actual:
        return True
    if declared == actual:
        return True
    aliases = _OUTPUT_TYPE_ALIASES.get(declared)
    if aliases and actual in aliases:
        return True
    return False


def _parse_contract(contract_elem, errors: list[str]) -> dict:
    """Return a lightweight dict representation of <contract><input>/<output>.

    Duplicate singleton children (e.g. two <default> tags) are recorded into
    *errors* but parsing continues so the validator can produce all messages
    in one pass.
    """
    result: dict = {"inputs": {}, "outputs": {}}

    def _check_singletons(parent, parent_id, kind):
        seen: dict[str, int] = {}
        for c in parent:
            if c.tag in _CONTRACT_SINGLETON_CHILDREN:
                seen[c.tag] = seen.get(c.tag, 0) + 1
        for tag, count in seen.items():
            if count > 1:
                errors.append(
                    f"contract {kind} '{parent_id}': <{tag}> appears {count} times "
                    f"(must appear at most once)"
                )

    def _parse_options(child) -> list[dict]:
        opts: list[dict] = []
        for opt in child.findall("option"):
            about = opt.find("about")
            label = _get_text(about, "label") if about is not None else ""
            value = _get_text(opt, "value")
            if not value:
                value = label
            opts.append({
                "id": opt.get("id", ""),
                "label": label,
                "value": value,
            })
        return opts

    input_elem = contract_elem.find("input")
    if input_elem is not None:
        for child in input_elem:
            widget_id = child.get("id")
            if not widget_id:
                errors.append(
                    f"contract input <{child.tag}>: missing required 'id' attribute"
                )
                continue
            if widget_id in result["inputs"]:
                errors.append(
                    f"contract input '{widget_id}': duplicate id"
                )
                continue
            _check_singletons(child, widget_id, "input")
            about = child.find("about")
            entry = {
                "type":        child.tag,
                "label":       _get_text(about, "label")       if about is not None else "",
                "description": _get_text(about, "description") if about is not None else "",
                "default":     _get_text(child, "default"),
                "units":       _get_text(child, "units"),
                "min":         _get_text(child, "min"),
                "max":         _get_text(child, "max"),
            }
            if child.tag in ("choice", "multichoice"):
                entry["options"] = _parse_options(child)
            result["inputs"][widget_id] = entry

    output_elem = contract_elem.find("output")
    if output_elem is not None:
        for child in output_elem:
            widget_id = child.get("id")
            if not widget_id:
                errors.append(
                    f"contract output <{child.tag}>: missing required 'id' attribute"
                )
                continue
            if widget_id in result["outputs"]:
                errors.append(
                    f"contract output '{widget_id}': duplicate id"
                )
                continue
            _check_singletons(child, widget_id, "output")
            about = child.find("about")
            result["outputs"][widget_id] = {
                "type":        child.tag,
                "label":       _get_text(about, "label")       if about is not None else "",
                "description": _get_text(about, "description") if about is not None else "",
                "units":       _get_text(child, "units"),
            }

    return result


_NUMERIC_TYPES = {"number", "integer"}


def _parse_numeric(value: str):
    """Parse a Rappture numeric string (optionally suffixed with units).

    Returns (value, units_suffix) or (None, '') if no leading number is found.
    """
    if value is None:
        return None, ""
    s = str(value).strip()
    if not s:
        return None, ""
    m = re.match(r'^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$', s)
    if not m:
        return None, ""
    try:
        num = float(m.group(1))
    except ValueError:
        return None, ""
    suffix = (m.group(2) or "").strip()
    return num, suffix


def _validate_contract_semantics(contract: dict, xml_path: Path, errors: list[str]) -> None:
    """Append semantic errors for the parsed contract dict to *errors*.

    Enforces what the XSD cannot express:
      - required <about><label>/<description> on every entry
      - required <default> for input types that need one
      - numeric <default>/<min>/<max> consistency (min ≤ default ≤ max)
      - <default> for choice/multichoice must be a declared <option> value or label
    """
    # Types whose default value is semantically required for the tool to run.
    # boolean is excluded because its falsy default ("off") reads as empty string.
    _REQUIRES_DEFAULT = {"number", "integer", "string", "choice", "multichoice",
                         "periodicelement", "file"}

    for widget_id, entry in contract.get("inputs", {}).items():
        wtype = entry.get("type", "")
        if not entry.get("label"):
            errors.append(f"contract input '{widget_id}': missing <about><label>")
        if not entry.get("description"):
            errors.append(f"contract input '{widget_id}': missing <about><description>")
        if wtype in _REQUIRES_DEFAULT and entry.get("default", "") == "":
            # 'file' default is conventionally optional in classic Rappture; treat
            # the contract requirement uniformly because the contract is meant to
            # be authoritative.  Callers that need a fileless default can omit
            # the widget from the contract entirely.
            errors.append(f"contract input '{widget_id}': missing <default>")

        # ── Numeric consistency ─────────────────────────────────────────────
        # Numeric comparisons only run when all relevant values share the
        # same unit suffix (or are all unitless).  Cross-unit comparisons
        # would require a unit-conversion table and produce false positives;
        # the contract leaves unit-aware bounds checking to the runtime.
        if wtype in _NUMERIC_TYPES:
            def _np(field_name):
                return _parse_numeric(entry.get(field_name, ""))

            min_n, min_u = _np("min")
            max_n, max_u = _np("max")
            def_n, def_u = _np("default")

            if (min_n is not None and max_n is not None
                    and min_u == max_u and min_n > max_n):
                errors.append(
                    f"contract input '{widget_id}': <min>={entry['min']} is greater "
                    f"than <max>={entry['max']}"
                )
            if (def_n is not None and min_n is not None
                    and def_u == min_u and def_n < min_n):
                errors.append(
                    f"contract input '{widget_id}': <default>={entry['default']} "
                    f"is below <min>={entry['min']}"
                )
            if (def_n is not None and max_n is not None
                    and def_u == max_u and def_n > max_n):
                errors.append(
                    f"contract input '{widget_id}': <default>={entry['default']} "
                    f"is above <max>={entry['max']}"
                )
            if wtype == "integer":
                # Integer entries should have integer-valued numerics.  Accept
                # things like "5" or "5.0"; reject "5.5".
                for field_name in ("default", "min", "max"):
                    raw = entry.get(field_name, "")
                    n, _ = _parse_numeric(raw)
                    if n is not None and float(int(n)) != n:
                        errors.append(
                            f"contract input '{widget_id}': <{field_name}>={raw} "
                            f"is not an integer"
                        )

        # ── Choice / multichoice: default must match an option ──────────────
        if wtype in ("choice", "multichoice"):
            options = entry.get("options", []) or []
            allowed: set[str] = set()
            for opt in options:
                if opt.get("value"):
                    allowed.add(opt["value"])
                if opt.get("label"):
                    allowed.add(opt["label"])
            if not options:
                errors.append(
                    f"contract input '{widget_id}': <{wtype}> declares no <option>s"
                )
            default = entry.get("default", "")
            if default and options:
                if wtype == "multichoice":
                    # multichoice default may be a comma-separated list
                    picked = [v.strip() for v in default.split(",") if v.strip()]
                    bad = [v for v in picked if v not in allowed]
                    if bad:
                        errors.append(
                            f"contract input '{widget_id}': <default>='{default}' "
                            f"contains value(s) not in <option> set: {', '.join(bad)}"
                        )
                else:
                    if default not in allowed:
                        errors.append(
                            f"contract input '{widget_id}': <default>='{default}' "
                            f"is not one of the declared <option> values"
                        )

    for widget_id, entry in contract.get("outputs", {}).items():
        wtype = entry.get("type", "")
        if wtype and wtype not in _CONTRACT_OUTPUT_TYPES:
            errors.append(
                f"contract output '{widget_id}': unknown type '<{wtype}>'"
            )
        if not entry.get("label"):
            errors.append(f"contract output '{widget_id}': missing <about><label>")
        if not entry.get("description"):
            errors.append(f"contract output '{widget_id}': missing <about><description>")


def _validate_contract_vs_runtime(tool_def, xml_path: Path) -> None:
    """Check that runtime <input>/<output> declarations match the contract.

    All errors discovered across input and output checks are accumulated and
    surfaced in a single ValueError so tool authors don't have to fix issues
    one at a time.
    """
    contract_inputs: dict = tool_def.contract.get("inputs", {})
    contract_outputs: dict = tool_def.contract.get("outputs", {})

    errors: list[str] = []

    # ── Inputs ──────────────────────────────────────────────────────────────
    if contract_inputs:
        def _collect_widgets(widgets) -> dict:
            result: dict = {}
            for w in widgets:
                wid = getattr(w, "id", None)
                if wid:
                    result[wid] = w
                if hasattr(w, "children"):
                    result.update(_collect_widgets(w.children))
            return result

        runtime_map = _collect_widgets(tool_def.inputs)
        contract_ids = set(contract_inputs.keys())

        for wid, w in runtime_map.items():
            if w.type in _DATA_INPUT_TYPES and wid not in contract_ids:
                errors.append(
                    f"input '{wid}' (type '{w.type}') is present in <input> "
                    f"but not declared in the contract"
                )
            elif w.type not in _DATA_INPUT_TYPES and w.type not in _UI_INPUT_TYPES:
                logger.debug(
                    "%s: unknown runtime input type '%s' for id '%s'",
                    xml_path.name, w.type, wid,
                )

        runtime_ids = set(runtime_map.keys())
        for cid in sorted(contract_ids - runtime_ids):
            errors.append(
                f"contract input '{cid}' is missing from the runtime <input> section"
            )

        for wid, centry in contract_inputs.items():
            w = runtime_map.get(wid)
            if w is None:
                continue  # already reported above
            if w.type != centry["type"]:
                errors.append(
                    f"input '{wid}': contract type '{centry['type']}' "
                    f"but runtime type '{w.type}'"
                )
                continue
            for field_name in ("units", "min", "max"):
                c_val = centry.get(field_name, "")
                r_val = w.attrs.get(field_name, "") if hasattr(w, "attrs") else ""
                if c_val and r_val and c_val != r_val:
                    errors.append(
                        f"input '{wid}': contract {field_name}='{c_val}' "
                        f"conflicts with runtime {field_name}='{r_val}'"
                    )

    # ── Outputs ─────────────────────────────────────────────────────────────
    if contract_outputs:
        runtime_outputs = {
            getattr(o, "id", ""): o for o in tool_def.outputs if getattr(o, "id", "")
        }
        contract_out_ids = set(contract_outputs.keys())

        for oid, o in runtime_outputs.items():
            if oid not in contract_out_ids:
                # Runtime output present but not declared in contract.  This is
                # only an error when the type is one the contract covers; pure
                # UI types (e.g. group) are allowed without a contract entry.
                if o.type in _CONTRACT_OUTPUT_TYPES:
                    errors.append(
                        f"output '{oid}' (type '{o.type}') is present in <output> "
                        f"but not declared in the contract"
                    )

        for oid, centry in contract_outputs.items():
            o = runtime_outputs.get(oid)
            if o is None:
                # Missing runtime <output> is allowed: many tools omit pre-decl
                # of outputs and emit them dynamically.  The runtime checks
                # (check_output_against_contract) enforce production-time rules.
                continue
            if not _output_types_match(centry.get("type", ""), o.type):
                errors.append(
                    f"output '{oid}': contract type '{centry['type']}' "
                    f"but runtime type '{o.type}'"
                )

    if errors:
        raise ValueError(
            f"Contract/runtime conflicts in {xml_path.name}:\n"
            + "\n".join(f"  - {e}" for e in errors)
        )


def check_output_against_contract(contract: dict, output_id: str,
                                  output_type: str) -> str:
    """Shared runtime check used by both library and classic modes.

    Returns an empty string if the produced output is consistent with the
    contract, otherwise a single human-readable error string.  Internal
    sentinel ids (those starting with "__") and tools without a contract
    are always accepted.
    """
    if not contract or not output_id:
        return ""
    if output_id.startswith("__"):
        return ""
    outputs = contract.get("outputs", {}) or {}
    if not outputs:
        return ""
    if output_id not in outputs:
        return (
            f"Output '{output_id}' (type={output_type!r}) is not declared "
            f"in the tool contract."
        )
    declared = outputs[output_id].get("type", "")
    if output_type and declared and not _output_types_match(declared, output_type):
        return (
            f"Output '{output_id}': contract declares type '{declared}' "
            f"but got '{output_type}'."
        )
    return ""


def missing_contract_outputs(contract: dict, produced_ids) -> list[str]:
    """Return sorted list of contract output ids not present in *produced_ids*."""
    if not contract:
        return []
    outputs = contract.get("outputs", {}) or {}
    if not outputs:
        return []
    produced = {pid for pid in produced_ids if pid and not pid.startswith("__")}
    return sorted(set(outputs.keys()) - produced)


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


# Conservative HTML allowlist used for <note> file:// content.  We deliberately
# omit <script>, <iframe>, <object>, <embed>, <form>, <input>, <button>, and
# all event-handler attributes.  Extend cautiously — every added tag/attribute
# is a potential XSS vector.
_NOTE_ALLOWED_TAGS = frozenset({
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup",
    "dd", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "ol", "p", "pre", "q",
    "samp", "section", "small", "span", "strong", "sub", "sup", "table",
    "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "var",
})
_NOTE_ALLOWED_ATTRS_PER_TAG: dict = {
    "a":   {"href", "title", "rel", "target"},
    "img": {"src", "alt", "title", "width", "height"},
    "td":  {"colspan", "rowspan", "align"},
    "th":  {"colspan", "rowspan", "align", "scope"},
    "col": {"span", "width"},
}
# Attributes allowed on any allowed tag.
_NOTE_GLOBAL_ATTRS = frozenset({"id", "class", "title", "lang", "dir"})


def _is_safe_url(raw: str) -> bool:
    """Return True when *raw* is a URL the note sanitizer should keep."""
    lower = raw.strip().lower()
    # Reject anything that could execute script in any browser.
    if lower.startswith(("javascript:", "vbscript:", "data:text/html")):
        return False
    return True


def _sanitize_note_html(html: str) -> str:
    """Strip disallowed tags/attributes from a note HTML fragment.

    Implemented on top of html.parser so we don't add a runtime dep.  This is
    a coarse-grained filter: dangerous tags are dropped (their text content
    is preserved); disallowed attributes are stripped silently.
    """
    from html.parser import HTMLParser
    from html import escape

    out: list[str] = []
    # Tags we drop entirely (including text) — script/style content must not
    # leak into the output even as text, since the parser preserves CDATA-
    # like behaviour for them.
    SUPPRESS_CONTENT = {"script", "style"}

    class _Sanitizer(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self._suppress_depth = 0

        def _allowed_attrs(self, tag: str):
            return _NOTE_ALLOWED_ATTRS_PER_TAG.get(tag, set()) | _NOTE_GLOBAL_ATTRS

        def handle_starttag(self, tag, attrs):
            if tag in SUPPRESS_CONTENT:
                self._suppress_depth += 1
                return
            if tag not in _NOTE_ALLOWED_TAGS:
                return
            allowed = self._allowed_attrs(tag)
            pieces = [f"<{tag}"]
            for name, value in attrs:
                if name is None or name.lower() not in allowed:
                    continue
                if name.lower().startswith("on"):
                    continue  # event handlers
                if value is None:
                    pieces.append(f" {name}")
                    continue
                if name.lower() in ("href", "src") and not _is_safe_url(value):
                    continue
                pieces.append(f' {name}="{escape(value, quote=True)}"')
            pieces.append(">")
            out.append("".join(pieces))

        def handle_endtag(self, tag):
            if tag in SUPPRESS_CONTENT:
                if self._suppress_depth > 0:
                    self._suppress_depth -= 1
                return
            if tag in _NOTE_ALLOWED_TAGS:
                out.append(f"</{tag}>")

        def handle_startendtag(self, tag, attrs):
            self.handle_starttag(tag, attrs)
            if tag not in SUPPRESS_CONTENT and tag in _NOTE_ALLOWED_TAGS:
                out.append(f"</{tag}>")

        def handle_data(self, data):
            if self._suppress_depth > 0:
                return
            out.append(escape(data, quote=False))

        def handle_entityref(self, name):
            if self._suppress_depth > 0:
                return
            out.append(f"&{name};")

        def handle_charref(self, name):
            if self._suppress_depth > 0:
                return
            out.append(f"&#{name};")

    parser = _Sanitizer()
    parser.feed(html)
    parser.close()
    return "".join(out)


def _resolve_note_contents(widgets, tool_dir: Path, base_path: str = ""):
    """Resolve file:// references in note widget contents and inline images.

    Two protections layered here:

      - Path traversal: the resolved file path must stay within *tool_dir*.
        A note referencing file://../../etc/passwd is silently ignored.
      - HTML sanitization: the loaded HTML is run through _sanitize_note_html
        so a malicious or compromised note file cannot inject <script>,
        event handlers, or javascript: URLs into the rendered page.
    """
    import re
    tool_dir = tool_dir.resolve()
    for w in widgets:
        if w.type == "note":
            contents = w.attrs.get("contents", "")
            if contents and contents.startswith("file://"):
                fname = contents[7:].strip()
                # Resolve and confine the target to tool_dir.  Reject any
                # path that escapes via "..", absolute paths, or symlinks.
                try:
                    fpath = (tool_dir / fname).resolve()
                except (OSError, RuntimeError):
                    continue
                try:
                    fpath.relative_to(tool_dir)
                except ValueError:
                    logger.warning(
                        "note file:// reference escapes tool_dir: %s", fname
                    )
                    continue
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
                    html = _sanitize_note_html(html)
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
    _log_counter = 0  # for <log> elements that have no id
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
            # <log> uses mixed content: the text may split across child.text
            # and the .tail of sub-elements (e.g. text after </about>).
            # Collect all text parts to reconstruct the full log content.
            parts = []
            if child.text:
                parts.append(child.text)
            for sub in child:
                # Ignore the <about> element's own content (it's metadata),
                # but DO capture text that appears after </about> (its .tail).
                if sub.tail:
                    parts.append(sub.tail)
            raw_log = "".join(parts)
            # trim only a single leading/trailing newline that often comes from
            # XML indentation; do not strip spaces since they may be meaningful
            if raw_log.startswith("\n"):
                raw_log = raw_log[1:]
            if raw_log.endswith("\n"):
                raw_log = raw_log[:-1]

            if raw_log.startswith("@@RP-ENC:"):
                raw_log = _decode_rp_enc(raw_log).decode("utf-8", errors="replace")
            # Determine key: use explicit id when present; otherwise generate
            # a unique key so that multiple id-less <log> elements don't
            # overwrite each other.  First id-less log → "log"; subsequent
            # ones → "log_2", "log_3", …
            explicit_id = child.get("id", "").strip()
            if explicit_id:
                log_key = explicit_id
                # avoid name collision with previous logs
                if log_key in outputs:
                    suffix = 2
                    while f"{log_key}_{suffix}" in outputs:
                        suffix += 1
                    log_key = f"{log_key}_{suffix}"
            else:
                _log_counter += 1
                log_key = "log" if _log_counter == 1 else f"log_{_log_counter}"
            about_elem = child.find("about")
            log_label = (
                _get_text(about_elem, "label") if about_elem is not None else ""
            ) or log_key
            outputs[log_key] = {
                "type": "log",
                "label": log_label,
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
        elif tag == "structure":
            outputs[elem_id] = _parse_structure_output(child)
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
    try:
        dim = int(float(_get_text(elem, "dim") or "3"))
    except (ValueError, OverflowError):
        dim = 3
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
                try:
                    points.append([float(c) for c in coords[:dim]])
                except ValueError:
                    logger.warning("Skipping malformed mesh point: %r", line)
        result["mesh_type"] = "unstructured"
        result["points"] = points

        # Optional connectivity
        cells_text = _get_text(unstructured, "cells") or _get_text(unstructured, "triangles")
        if cells_text and cells_text.strip():
            cells = []
            for line in cells_text.strip().splitlines():
                try:
                    idxs = [int(x) for x in line.split()]
                except ValueError:
                    logger.warning("Skipping malformed mesh cell: %r", line)
                    continue
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
                try:
                    numpts = int(float(_get_text(ax, "numpoints") or "0"))
                    lo = float(_get_text(ax, "min") or "0")
                    hi = float(_get_text(ax, "max") or "1")
                except (ValueError, OverflowError):
                    numpts, lo, hi = 0, 0.0, 1.0
                axes[axis_tag[0]] = {"min": lo, "max": hi, "numpoints": numpts}
                coords_text = ax.text.strip() if ax.text else ""
                if coords_text:
                    try:
                        axes[axis_tag[0]]["coords"] = [float(v) for v in coords_text.split()]
                    except ValueError:
                        logger.warning("Skipping malformed axis coords in %s", axis_tag)
        result["axes"] = axes

    return result


def _interpolate_to_grid(points, values, grid_n=20):
    """Interpolate unstructured 3D scalar data onto a uniform NxNxN grid.

    Returns a dict with flat x/y/z/value arrays ready for Plotly isosurface,
    or None if scipy is not available or interpolation fails.
    """
    if len(points) < 4:
        return None
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


def _parse_structure_output(elem):
    """Parse an output <structure> element (molecule/PDB data) into drawing format."""
    about = elem.find("about")

    def _decode_payload(text):
        raw = (text or "").strip()
        if not raw:
            return ""
        if raw.startswith("@@RP-ENC:"):
            return _decode_rp_enc(raw).decode("utf-8", errors="replace")
        return raw

    molecules = []
    components = elem.find("components")
    mol_elems = components.findall("molecule") if components is not None else elem.findall("molecule")
    for mol in mol_elems:
        mol_about = mol.find("about")
        molecules.append({
            "id": mol.get("id", ""),
            "label": _get_text(mol_about, "label") if mol_about is not None else "",
            "style": _get_text(mol_about, "style") if mol_about is not None else "",
            "pdb": _decode_payload(_get_text(mol, "pdb")),
            "vtk": _decode_payload(_get_text(mol, "vtk")),
        })

    return {
        "type": "drawing",
        "label": _get_text(about, "label") if about is not None else "",
        "description": _get_text(about, "description") if about is not None else "",
        "camera": _get_text(about, "camera") if about is not None else "",
        "molecules": molecules,
        "polydata": [],
        "glyphs": [],
        "xaxis": {"label": "", "units": _get_text(elem, "units") or ""},
        "yaxis": {"label": "", "units": ""},
        "zaxis": {"label": "", "units": ""},
    }


def _parse_sequence_output(elem, mesh_registry=None):
    """Parse a <sequence> output element."""
    about = elem.find("about")
    seq_label = _get_text(about, "label") if about is not None else (elem.get("id", "sequence"))
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
                    parsed = _parse_curve_output(gc)
                    # Force all curves in a sequence element onto one shared plot
                    # by overriding the group to the sequence label.
                    parsed["group"] = seq_label
                    el_outputs[gc_id] = parsed
                elif gc.tag == "field":
                    el_outputs[gc_id] = _parse_field_output(gc, mesh_registry=mesh_registry)
                elif gc.tag == "image":
                    el_outputs[gc_id] = _parse_image_output(gc)
                elif gc.tag == "structure":
                    el_outputs[gc_id] = _parse_structure_output(gc)
                elif gc.tag == "drawing":
                    el_outputs[gc_id] = _parse_drawing_output(gc)
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
