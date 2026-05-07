Note Input Example
==================

Location: ``examples/rappture2/note/``

This example demonstrates the ``<note>`` input type -- read-only HTML
content displayed within the input panel.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/note/tool.xml
   :language: xml

Key concepts
------------

- ``<contents>file://bysize.html</contents>`` loads HTML from an external
  file relative to the tool directory.
- Notes can also contain inline HTML directly.
- Notes are non-interactive and are not sent as inputs to the simulation.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/note/
