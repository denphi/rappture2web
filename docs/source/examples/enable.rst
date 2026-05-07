Enable/Disable Example
======================

Location: ``examples/rappture2/enable/``

This example demonstrates the ``<enable>`` attribute for conditionally
showing or hiding inputs based on other input values.

tool.xml
---------------------

.. literalinclude:: ../../../examples/rappture2/enable/tool.xml
   :language: xml

Enable expression syntax
------------------------

.. list-table::
   :header-rows: 1
   :widths: 50 50

   * - Expression
     - Meaning
   * - ``input.choice(model) == "dd"``
     - Exact value match
   * - ``input.group(dd).boolean(recomb)``
     - Boolean is true/on
   * - ``input.(negf).(tbe):eV >= 3``
     - Numeric comparison with unit
   * - ``no``
     - Always disabled/hidden

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/enable/
