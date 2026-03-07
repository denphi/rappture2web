tool.xml Reference
==================

Every Rappture tool is defined by a ``tool.xml`` file.  This page documents
the XML structure that rappture2web understands.

Root structure
--------------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
     <tool>...</tool>
     <input>...</input>
     <output>...</output>
   </run>

The ``<tool>`` section
----------------------

.. code-block:: xml

   <tool>
     <title>My Tool</title>
     <about>Description shown at the top of the page.</about>
     <command>python3 @tool/script.py @driver</command>
     <uq>true</uq>    <!-- optional: enable UQ controls -->
   </tool>

``@tool``
   Replaced with the directory containing ``tool.xml``.

``@driver``
   Replaced with the path to the generated ``driver.xml`` (classic mode) or the
   server URL (library mode).

``<uq>true</uq>``
   Enables Uncertainty Quantification controls on numeric inputs.
   See :doc:`uq`.

The ``<input>`` section
-----------------------

Inputs are rendered as form controls in the sidebar.  Supported types:

.. list-table::
   :header-rows: 1
   :widths: 20 80

   * - Type
     - Description
   * - ``<number>``
     - Floating-point number with optional units, min/max, presets
   * - ``<integer>``
     - Integer with optional min/max
   * - ``<boolean>``
     - Checkbox (yes/no)
   * - ``<string>``
     - Text input; multiline if ``<size>`` specifies rows
   * - ``<choice>``
     - Dropdown select from ``<option>`` elements
   * - ``<multichoice>``
     - Multiple-select checkboxes
   * - ``<loader>``
     - Example file loader with ``<example>`` patterns
   * - ``<periodicelement>``
     - Periodic table element picker
   * - ``<image>``
     - Image upload input
   * - ``<note>``
     - Read-only HTML or text; supports ``file://`` references
   * - ``<drawing>``
     - Interactive 2D canvas with hotspots
   * - ``<group>``
     - Container that groups child inputs
   * - ``<phase>``
     - Tab container for multi-step workflows
   * - ``<structure>``
     - 3D molecular/crystal structure viewer with parameters
   * - ``<separator>``
     - Visual horizontal rule between inputs

Number input
~~~~~~~~~~~~

.. code-block:: xml

   <number id="temperature">
     <about>
       <label>Temperature</label>
       <description>Ambient temperature.</description>
       <icon>BASE64-ENCODED-GIF</icon>
     </about>
     <units>K</units>
     <min>50K</min>
     <max>1000K</max>
     <default>300K</default>
     <current>300K</current>
     <color>purple</color>
     <uq>false</uq>   <!-- opt out of UQ when tool has uq=true -->
     <preset>
       <value>300K</value>
       <label>Room temperature</label>
     </preset>
     <preset>
       <value>77K</value>
       <label>Liquid nitrogen</label>
     </preset>
   </number>

Choice input
~~~~~~~~~~~~

.. code-block:: xml

   <choice id="method">
     <about><label>Method</label></about>
     <default>fermi</default>
     <option>
       <about><label>Fermi-Dirac</label></about>
       <value>fermi</value>
     </option>
     <option>
       <about><label>Boltzmann</label></about>
       <value>boltzmann</value>
     </option>
   </choice>

Conditional enable/disable
~~~~~~~~~~~~~~~~~~~~~~~~~~

Inputs can be conditionally enabled based on other input values:

.. code-block:: xml

   <number id="detail">
     <about>
       <label>Detail Level</label>
       <enable>input.choice(method) == "fermi"</enable>
     </about>
     <default>5</default>
   </number>

The ``<output>`` section
------------------------

See :doc:`output_types` for a complete reference of output types.
