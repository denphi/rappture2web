Number Input Example
====================

Location: ``examples/rappture2/number/``

This example demonstrates the ``<number>`` input type with units, min/max
bounds, presets, and a color bar.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/number/tool.xml
   :language: xml

script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   T_str = rx['input.(temperature).current'].value
   T = float(Rappture.Units.convert(T_str, to='K', units='off'))

   # Use the temperature in your calculation...
   rx['output.number(T).about.label'] = 'Temperature'
   rx['output.number(T).units'] = 'K'
   rx['output.number(T).current'] = f'{T:.1f}K'
   rx.close()

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/number/
