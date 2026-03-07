simulator — Simulation Runner
==============================

``rappture2web.simulator`` manages tool execution, run history, and UQ
orchestration.

run_simulation()
----------------

.. code-block:: python

   from rappture2web.simulator import run_simulation

   result = await run_simulation(
       tool_xml_path='/path/to/tool.xml',
       input_values={'input.number(x)': '5'},
       server_url='http://localhost:8000',  # for library mode
       use_library_mode=False,
       history=history,        # RunHistory instance
       use_cache=True,
       timeout=300,
       log_callback=my_log_fn, # async callable(text)
   )

Returns a dict:

.. code-block:: python

   {
       'status': 'success',     # or 'error'
       'outputs': {...},        # parsed output data
       'log': '...',            # stdout + stderr
       'run_xml': '/path/to/run.xml',
       'run_id': 'abc123',
       'run_num': 1,
       'cached': False,
   }

run_uq_simulation()
--------------------

.. code-block:: python

   from rappture2web.simulator import run_uq_simulation

   result = await run_uq_simulation(
       tool_xml_path='/path/to/tool.xml',
       input_values={'input.integer(npts)': '200'},
       uq_inputs={
           'input.number(amplitude)': {
               'type': 'uniform', 'min': 0.5, 'max': 5.0, 'units': ''
           },
           'input.number(frequency)': {
               'type': 'gaussian', 'mean': 1.0, 'std': 0.2,
               'min': 0.1, 'max': 3.0, 'units': 'Hz'
           },
       },
       history=history,
       log_callback=my_log_fn,
       inputs_override_callback=my_override_fn,  # for library mode
   )

The UQ simulation:

1. Generates Smolyak collocation points via PUQ
2. Runs the tool once per collocation point
3. Injects results into HDF5 and runs PUQ analyze
4. Parses the resulting ``run_uq.xml``

RunHistory
----------

.. code-block:: python

   from rappture2web.simulator import RunHistory

   history = RunHistory(cache_dir='/path/to/cache')
   history.load_from_disk()  # restore previous runs

   # Find a cached result
   cached = history.find_cached(input_values)

   # Add a new run
   run = history.add(
       input_values=inputs,
       outputs=outputs,
       log=log_text,
       status='success',
   )

   # Query runs
   all_runs = history.runs
   run = history.get_by_id('abc123')
   run = history.get_by_num(1)

   # Manage runs
   history.update_run('abc123', label='My Experiment')
   history.delete('abc123')
   history.reorder(['id3', 'id1', 'id2'])
