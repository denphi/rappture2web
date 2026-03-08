Examples
========

rappture2web ships with a comprehensive set of examples in the
``examples/webapp/`` directory.  Each example is a self-contained tool
that uses ``rappture2web.rp_library`` and can be run directly:

.. code-block:: bash

   rappture2web examples/webapp/curve/

Available examples
------------------

**Basic input types:**

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Example
     - Description
   * - :doc:`number`
     - Number input with units, presets, and color bar
   * - ``number2/``
     - Number input with color ranges
   * - :doc:`integer`
     - Integer input with min/max bounds
   * - ``integer2/``
     - Integer input with color ranges
   * - :doc:`boolean`
     - Boolean checkbox input (on/yes/true/1 formats)
   * - :doc:`string`
     - String text input (single-line and multiline)
   * - :doc:`choice`
     - Dropdown choice input
   * - :doc:`multichoice`
     - Multiple selection checkboxes
   * - :doc:`periodicelement`
     - Interactive periodic table picker
   * - :doc:`image`
     - Image upload input with loader
   * - :doc:`note`
     - Read-only HTML note

**Layout and organization:**

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Example
     - Description
   * - :doc:`group`
     - Grouped inputs with tabs, horizontal, and sentence layouts
   * - :doc:`phase`
     - Phase-based (multi-page) workflow
   * - :doc:`enable`
     - Conditional enable/disable of inputs

**Output types:**

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Example
     - Description
   * - :doc:`curve`
     - XY curves: single, grouped, scatter, bar, log scale
   * - :doc:`histogram`
     - Bar histogram output (single and grouped)
   * - :doc:`field`
     - 2D heatmap and 3D isosurface fields
   * - :doc:`field3d`
     - 3D scalar field visualization (point cloud)
   * - :doc:`flow2d`
     - 2D vector flow field (lid-driven cavity)
   * - :doc:`flow_demos`
     - 3D flow visualization demos (3 examples)
   * - :doc:`table`
     - Data table output
   * - :doc:`sequence`
     - Animated sequence of image frames
   * - :doc:`log`
     - Simulation log text output
   * - :doc:`mapviewer`
     - Geographic map with heatmap/scatter layers

**Complete applications:**

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Example
     - Description
   * - :doc:`fermi`
     - Fermi-Dirac distribution calculator
   * - :doc:`uq_simple`
     - Simple UQ demonstration (cosine wave)
   * - :doc:`uq_projectile`
     - Projectile motion with UQ support

.. toctree::
   :maxdepth: 1
   :hidden:

   number
   integer
   boolean
   string
   choice
   multichoice
   periodicelement
   image
   note
   group
   phase
   enable
   curve
   histogram
   field
   field3d
   flow2d
   flow_demos
   table
   sequence
   log
   mapviewer
   fermi
   uq_simple
   uq_projectile
