Periodic Element Example
========================

Location: ``examples/rappture2/periodicelement/``

This example demonstrates the ``<periodicelement>`` input type -- an
interactive periodic table picker.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/periodicelement/tool.xml
   :language: xml

Key concepts
------------

- ``<returnvalue>`` controls what data the script receives:
  ``name``, ``symbol``, ``number``, ``weight``, or any combination.
- ``<active>`` restricts which element categories can be selected
  (e.g., ``other-non-metal``).
- Default can be an element symbol (``As``) or full name (``Oxygen``).

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/periodicelement/
