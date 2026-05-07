Integer Input Example
=====================

Location: ``examples/rappture2/integer/``

This example demonstrates the ``<integer>`` input type with min/max bounds.
Integers are whole numbers with no units.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/integer/tool.xml
   :language: xml

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   n = rx['input.(points).current'].value
   rx['output.integer(outn).about.label'] = 'Echo of points'
   rx['output.integer(outn).current'] = n

   rx.close()

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/integer/
