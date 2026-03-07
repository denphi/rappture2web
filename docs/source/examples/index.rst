Examples
========

rappture2web ships with a comprehensive set of examples in the
``examples/webapp/`` directory.  Each example is a self-contained tool
that uses ``rappture2web.rp_library`` and can be run directly:

.. code-block:: bash

   rappture2web examples/webapp/curve/

Available examples
------------------

**Basic input/output types:**

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Example
     - Description
   * - ``number/``
     - Number input with units, presets, and color bar
   * - ``number2/``
     - Number input with multiple presets
   * - ``integer/``
     - Integer input with min/max bounds
   * - ``integer2/``
     - Integer input demonstration
   * - ``boolean/``
     - Boolean checkbox input
   * - ``string/``
     - String text input (single-line and multiline)
   * - ``choice/``
     - Dropdown choice input
   * - ``multichoice/``
     - Multiple selection checkboxes
   * - ``periodicelement/``
     - Interactive periodic table picker
   * - ``image/``
     - Image upload input with loader
   * - ``note/``
     - Read-only HTML note
   * - ``group/``
     - Grouped inputs
   * - ``phase/``
     - Phase-based (tabbed) workflow
   * - ``enable/``
     - Conditional enable/disable of inputs

**Output types:**

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Example
     - Description
   * - ``curve/``
     - XY curves: single, grouped, scatter, bar, log scale
   * - ``histogram/``
     - Bar histogram output
   * - ``field/``
     - 2D heatmap field on a regular grid
   * - ``field3d/``
     - 3D scalar field visualization
   * - ``flow2d/``
     - 2D vector flow field
   * - ``flow_demo1/``
     - Flow visualization demo 1
   * - ``flow_demo2/``
     - Flow visualization demo 2
   * - ``flow_demo3/``
     - Flow visualization demo 3
   * - ``table/``
     - Data table output
   * - ``sequence/``
     - Animated sequence of frames
   * - ``log/``
     - Simulation log output
   * - ``mapviewer/``
     - Geographic map with scatter layer

**Complete applications:**

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Example
     - Description
   * - ``fermi/``
     - Fermi-Dirac distribution calculator
   * - ``uq_simple/``
     - Simple UQ demonstration
   * - ``uq_projectile/``
     - Projectile motion with UQ support
