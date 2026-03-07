Run History
===========

rappture2web maintains a history of simulation runs, similar to the Rappture
ResultSet/Analyzer concept.

Viewing past runs
-----------------

The **Run History** panel at the bottom of the sidebar shows all previous runs.
Click on any run to display its outputs.

Features:

- **Compare mode**: select multiple runs to overlay their curve outputs on the
  same plot
- **Rename runs**: click the run label to rename it
- **Delete runs**: select runs and click Delete
- **Reorder runs**: drag and drop to reorder
- **Upload run.xml**: import results from a file (not available on NanoHUB)

Caching
-------

By default, rappture2web caches results.  If you click Simulate with the same
inputs as a previous run, the cached result is returned instantly.

Disable caching:

.. code-block:: bash

   rappture2web /path/to/tool/ --no-cache

REST API
--------

Run history is also accessible via the REST API:

.. code-block:: text

   GET  /api/runs              — list all runs
   GET  /api/runs/{run_id}     — get full run data
   DELETE /api/runs/{run_id}   — delete a run
   PATCH /api/runs/{run_id}    — rename a run
   POST /api/runs/reorder      — reorder runs
   POST /api/upload-run         — upload a run.xml file
