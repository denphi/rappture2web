xml_parser — Tool XML Parser
============================

``rappture2web.xml_parser`` parses Rappture ``tool.xml`` files into Python
data structures for rendering.

Data classes
------------

**ToolInfo**
   Tool metadata from the ``<tool>`` section:

   - ``title`` — tool title
   - ``about`` — description text
   - ``command`` — execution command template
   - ``uq_enabled`` — True if ``<uq>true</uq>`` is set

**WidgetNode**
   An input widget:

   - ``type`` — widget type (number, integer, choice, etc.)
   - ``id`` — element id
   - ``path`` — Rappture path (e.g. ``input.number(temperature)``)
   - ``label``, ``description``, ``hints``
   - ``default``, ``current``
   - ``enable`` — conditional enable expression
   - ``children`` — child widgets (for groups, phases, structures)
   - ``attrs`` — type-specific attributes (units, min, max, options, presets, uq_enabled)

**OutputNode**
   An output element with the same base fields plus type-specific attrs.

**ToolDef**
   Complete parsed tool:

   - ``tool`` — ToolInfo
   - ``inputs`` — list of WidgetNode
   - ``outputs`` — list of OutputNode

Functions
---------

.. code-block:: python

   from rappture2web.xml_parser import parse_tool_xml, parse_run_xml

   # Parse a tool definition
   tool_def = parse_tool_xml('/path/to/tool.xml')
   print(tool_def.tool.title)
   print(tool_def.tool.uq_enabled)
   for inp in tool_def.inputs:
       print(inp.type, inp.id, inp.label)

   # Parse a run.xml output file
   outputs = parse_run_xml('/path/to/run.xml')
   # Returns a dict of output_id → output_data
