Quick Start
===========

Running a tool
--------------

.. code-block:: bash

   # Point to a directory containing tool.xml
   rappture2web /path/to/tool/

   # Or specify tool.xml directly
   rappture2web /path/to/tool/tool.xml

   # Custom port
   rappture2web /path/to/tool/ --port 9000

Open ``http://localhost:8000`` in your browser to see the tool UI.

Command-line options
--------------------

.. code-block:: text

   rappture2web [OPTIONS] TOOL_PATH

   Options:
     --port PORT           Server port (default: 8000)
     --host HOST           Bind address (default: 0.0.0.0)
     --library-mode        Use rp_library API instead of driver.xml
     --no-cache            Disable result caching
     --base-path PATH      URL prefix (e.g. /tools/fermi)

Creating a minimal tool
-----------------------

1. Create a directory with ``tool.xml`` and a Python script:

   .. code-block:: text

      my_tool/
      ├── tool.xml
      └── my_tool.py

2. Define the tool XML:

   .. code-block:: xml

      <?xml version="1.0"?>
      <run>
      <tool>
        <title>My First Tool</title>
        <about>A simple example tool.</about>
        <command>python3 @tool/my_tool.py @driver</command>
      </tool>
      <input>
        <number id="x">
          <about><label>Input X</label></about>
          <default>5</default>
          <min>0</min>
          <max>100</max>
        </number>
      </input>
      <output>
        <number id="result">
          <about><label>Result</label></about>
        </number>
      </output>
      </run>

3. Write the tool script:

   .. code-block:: python

      import sys
      import rappture2web.rp_library as Rappture

      rx = Rappture.PyXml(sys.argv[1])

      x = float(rx['input.(x).current'].value)
      result = x * x

      rx['output.number(result).about.label'] = 'X Squared'
      rx['output.number(result).current'] = str(result)
      rx.close()

4. Run it:

   .. code-block:: bash

      rappture2web my_tool/

Classic vs. library mode
------------------------

**Classic mode** (default): rappture2web creates a ``driver.xml`` with user
inputs, runs the tool command, then parses the resulting ``run.xml``.  The tool
script uses the standard Rappture library (TCL or Python 2) to read the driver
and write outputs.

**Library mode** (``--library-mode``): the tool script receives the server URL
as ``sys.argv[1]`` instead of a file path.  ``rp_library`` reads inputs from
and streams outputs to the web server in real time via HTTP.

Use library mode when:

- You want live-streaming output updates in the browser
- Your tool script is Python 3
- You don't need the classic Rappture TCL library
