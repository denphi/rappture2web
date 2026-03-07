rp_library — Rappture Python Library
=====================================

``rappture2web.rp_library`` is a drop-in replacement for the classic Rappture
Python library.  It provides the same API but talks to the rappture2web server
instead of reading/writing XML files.

Quick start
-----------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   # Works with both server URL (library mode) and file path (classic mode)
   rx = Rappture.PyXml(sys.argv[1])

   # Read inputs
   T = rx['input.(temperature).current'].value

   # Write outputs
   rx['output.curve(result).about.label'] = 'My Result'
   rx['output.curve(result).component.xy'] = (x_array, y_array)

   # Done
   rx.close()

PyXml interface
---------------

.. code-block:: python

   rx = Rappture.PyXml(path_or_url)

Creates a tool handle. ``path_or_url`` is automatically detected:

- If it starts with ``http://`` or ``https://``, library mode is used
- Otherwise, it's treated as a file path (classic XML mode)

**Reading values**:

.. code-block:: python

   node = rx['input.(param_id).current']
   value = node.value      # string value
   text  = str(node)       # same as .value

**Writing values**:

.. code-block:: python

   rx['output.curve(id).about.label'] = 'Label'
   rx['output.curve(id).component.xy'] = (x_list, y_list)

**Closing**:

.. code-block:: python

   rx.close()       # signals simulation complete

library() interface
-------------------

.. code-block:: python

   lib = Rappture.library(path_or_url)

   # Read
   value = lib.get('input.(temperature).current')

   # Write
   lib.put('output.curve(f).about.label', 'My Curve')
   lib.put('output.curve(f).component.xy', xy_data, append=True)

   # Done
   Rappture.result(lib)

Units conversion
----------------

.. code-block:: python

   # Convert "300K" to bare number
   val = Rappture.Units.convert("300K", units="off")  # "300"

   # Convert between units
   val = Rappture.Units.convert("300K", to="C", units="off")

   # Strip units only
   val = Rappture.Units.convert("5eV", units="off")  # "5"

Progress reporting
------------------

.. code-block:: python

   Rappture.Utils.progress(50, "Halfway done...")
   Rappture.Utils.progress(100, "Complete")

In library mode, this updates the progress bar in the browser.

XY data formats
---------------

The ``component.xy`` property accepts multiple formats:

.. code-block:: python

   # Tuple of two sequences
   rx['output.curve(c).component.xy'] = (x_list, y_list)

   # Numpy 2xN array (each row is an axis)
   rx['output.curve(c).component.xy'] = np.array([x, y])

   # Numpy Nx2 array (each row is a point)
   rx['output.curve(c).component.xy'] = np.column_stack([x, y])

   # String format
   rx['output.curve(c).component.xy'] = "0 0\n1 1\n2 4\n"

Append mode
-----------

.. code-block:: python

   # Build XY data incrementally
   for x, y in data_points:
       lib.put('output.curve(c).component.xy', f'{x} {y}\n', append=True)
