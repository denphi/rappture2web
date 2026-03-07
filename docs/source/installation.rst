Installation
============

Requirements
------------

- Python 3.7 or later
- ``pip`` package manager

Install from PyPI
-----------------

.. code-block:: bash

   pip install rappture2web

Install from source
-------------------

.. code-block:: bash

   git clone https://github.com/your-org/rappture2web.git
   cd rappture2web
   pip install -e .

Dependencies
------------

rappture2web installs the following dependencies automatically:

- **FastAPI** (0.95–0.103) — web framework
- **uvicorn** — ASGI server
- **websockets** — real-time streaming
- **Jinja2** — HTML templating
- **python-multipart** — file upload support
- **lxml** — XML parsing

Optional: for tool scripts that use ``numpy``, install it separately:

.. code-block:: bash

   pip install numpy

NanoHUB deployment
------------------

On NanoHUB, ``rappture2web`` is typically installed in a conda environment.
The server is started automatically by the hub middleware and connects to the
Rappture environment via ``/etc/environ.sh``.

No additional configuration is needed — the CLI auto-detects the NanoHUB
environment and adjusts PATH handling accordingly.
