Contributing
============

Development setup
-----------------

.. code-block:: bash

   git clone https://github.com/your-org/rappture2web.git
   cd rappture2web
   pip install -e ".[dev]"

Running tests
-------------

.. code-block:: bash

   pytest

Code structure
--------------

.. code-block:: text

   rappture2web/
   ├── __init__.py
   ├── _version.py         # version string
   ├── app.py              # FastAPI application
   ├── cli.py              # command-line entry point
   ├── encoding.py         # data URI encoding helpers
   ├── rp_library.py       # drop-in Rappture Python library
   ├── simulator.py        # simulation runner (classic + UQ)
   ├── xml_parser.py       # tool.xml / run.xml parser
   ├── puq/                # PUQ helper scripts (Python 2)
   │   ├── get_params.py
   │   ├── inject_results.py
   │   ├── analyze.py
   │   └── get_response.py
   ├── static/
   │   ├── css/rappture.css
   │   └── js/
   │       ├── rappture.js         # main UI logic
   │       ├── rp-renderer-*.js    # output renderers
   │       ├── plotly-*.min.js     # Plotly library
   │       └── three.*.min.js     # Three.js library
   └── templates/
       ├── base.html
       ├── tool.html
       └── widgets/               # input widget templates
           ├── number.html
           ├── integer.html
           ├── choice.html
           └── ...

Building documentation
----------------------

.. code-block:: bash

   pip install sphinx sphinx-rtd-theme
   cd docs
   make html
   open build/html/index.html
