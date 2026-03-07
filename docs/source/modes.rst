Operating Modes
===============

rappture2web supports two operating modes for running tool simulations.

Classic mode (default)
----------------------

In classic mode:

1. User fills in inputs and clicks **Simulate**
2. rappture2web creates a ``driver.xml`` with the input values
3. The tool command runs as a subprocess: ``python script.py driver.xml``
4. The script reads ``driver.xml``, computes, and writes ``run.xml``
5. rappture2web parses ``run.xml`` and displays the outputs

This mode is compatible with **any** Rappture tool — including tools written
in TCL, Fortran, C, or Python 2 — because it uses the standard Rappture file
I/O protocol.

.. code-block:: bash

   rappture2web /path/to/tool/

Library mode
------------

In library mode:

1. The tool script receives the **server URL** as ``sys.argv[1]``
2. ``rp_library`` reads inputs via ``GET /api/inputs``
3. Each ``rx['output...'] = value`` call streams the output to the browser in
   real time via ``POST /api/output``
4. ``rx.close()`` signals completion

This mode requires the tool script to use ``rappture2web.rp_library``:

.. code-block:: python

   import rappture2web.rp_library as Rappture

Enable with:

.. code-block:: bash

   rappture2web /path/to/tool/ --library-mode

Advantages of library mode:

- **Live streaming**: outputs appear in the browser as they are computed
- **Progress updates**: ``Rappture.Utils.progress(pct, msg)`` shows in the UI
- **No file I/O**: no driver.xml or run.xml on disk

Choosing a mode
---------------

.. list-table::
   :header-rows: 1
   :widths: 30 35 35

   * - Criterion
     - Classic mode
     - Library mode
   * - Tool language
     - Any (TCL, Python 2/3, C, Fortran)
     - Python 3 only
   * - Output streaming
     - After completion
     - Real-time
   * - Progress bar
     - Not supported
     - Supported
   * - NanoHUB compatibility
     - Full (uses native Rappture)
     - Requires ``rappture2web.rp_library``
   * - UQ support
     - Yes
     - Yes
