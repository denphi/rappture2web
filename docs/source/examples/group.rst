Group Input Example
===================

Location: ``examples/rappture2/group/``

This example demonstrates the ``<group>`` input type for organizing inputs
into collapsible sections. A group of groups renders as a tabbed interface.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/group/tool.xml
   :language: xml

Key concepts
------------

- **Tabs**: A group of groups (``tabs > models + ambient``) renders as
  a tabbed interface.
- **Horizontal layout**: ``<layout>horizontal</layout>`` arranges child
  inputs side by side.
- **Sentence layout**: ``<layout>sentence:Location = (${lat},${long})</layout>``
  renders inputs inline within a sentence template.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/group/
