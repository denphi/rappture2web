app — FastAPI Web Application
==============================

``rappture2web.app`` is the FastAPI application that serves the tool UI and
handles simulation requests.

Setup
-----

.. code-block:: python

   from rappture2web.app import app, set_tool

   set_tool(
       xml_path='/path/to/tool.xml',
       cache_dir='/path/to/cache',
       server_url='http://localhost:8000',
       use_library_mode=False,
       use_cache=True,
       base_path='',
   )

REST API endpoints
------------------

Page
~~~~

``GET /``
   Returns the tool HTML page.

Simulation
~~~~~~~~~~

``POST /simulate``
   Trigger a simulation.  Request body:

   .. code-block:: json

      {
        "inputs": {
          "input.number(x)": "5",
          "input.choice(method)": "fermi"
        },
        "uq_inputs": {
          "input.number(amplitude)": {
            "type": "uniform",
            "min": 0.5,
            "max": 5.0,
            "units": ""
          }
        }
      }

   The ``uq_inputs`` field is optional.  When present, a UQ simulation is
   performed instead of a single run.

``POST /stop``
   Kill the currently running simulation.

Library mode API
~~~~~~~~~~~~~~~~

These endpoints are used by ``rp_library`` in library mode:

``POST /api/simulate/start``
   Called at the start of a run.

``GET /api/inputs``
   Returns current input values.

``POST /api/output``
   Receives one output item.

``POST /api/log``
   Appends a log message.

``POST /api/progress``
   Updates progress percentage and message.

``POST /api/simulate/done``
   Called when the simulation completes.

Run history
~~~~~~~~~~~

``GET /api/runs``
   List all past runs.

``GET /api/runs/{run_id}``
   Get full data for a specific run.

``DELETE /api/runs/{run_id}``
   Delete a run.

``PATCH /api/runs/{run_id}``
   Rename a run.  Body: ``{"label": "new name"}``

``POST /api/runs/reorder``
   Reorder runs.  Body: ``{"run_ids": ["id1", "id2", ...]}``

``POST /api/upload-run``
   Upload a ``run.xml`` file.

Loader
~~~~~~

``GET /api/loader-examples?pattern=*.xml``
   List available example files for loader widgets.

``GET /api/loader-examples/{filename}?pattern=*.xml``
   Get the content of a specific example file.

WebSocket
~~~~~~~~~

``WS /ws``
   Real-time updates.  Messages are JSON objects with a ``type`` field:

   - ``state`` — sent on connect with current session state
   - ``status`` — simulation status change (running, stopped)
   - ``progress`` — progress update (percent, message)
   - ``log`` — log text chunk
   - ``output`` — streamed output item (library mode)
   - ``done`` — simulation complete with outputs
