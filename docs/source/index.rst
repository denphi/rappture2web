rappture2web documentation
==========================

**rappture2web** turns `Rappture <https://nanohub.org/infrastructure/rappture/>`_
tool XML definitions into interactive web applications — no desktop GUI required.

It reads a ``tool.xml`` file, renders the input form in a browser, runs the
simulation backend, and displays the output visualizations (curves, fields,
tables, maps, and more) in real time over WebSocket.

.. toctree::
   :maxdepth: 2
   :caption: Getting Started

   installation
   quickstart
   tool_xml

.. toctree::
   :maxdepth: 2
   :caption: User Guide

   modes
   input_types
   output_types
   uq
   run_history

.. toctree::
   :maxdepth: 2
   :caption: Examples

   examples/index
   examples/number
   examples/curve
   examples/fermi
   examples/field
   examples/uq_simple
   examples/uq_projectile

.. toctree::
   :maxdepth: 2
   :caption: API Reference

   api/rp_library
   api/xml_parser
   api/simulator
   api/app

.. toctree::
   :maxdepth: 1
   :caption: Development

   contributing
   changelog
