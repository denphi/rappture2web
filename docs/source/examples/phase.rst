Phase Input Example
===================

Location: ``examples/rappture2/phase/``

This example demonstrates the ``<phase>`` input type. A phase represents
a whole page in the interface, enabling multi-step wizard-style workflows.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/phase/tool.xml
   :language: xml

Key concepts
------------

- Each ``<phase>`` creates a separate page/tab in the input panel.
- Phases are useful for complex tools with many inputs that benefit from
  a guided, multi-step workflow.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/phase/
