Number Input Example
====================

Location: ``examples/webapp/number/``

This example demonstrates the ``<number>`` input type with units, min/max
bounds, presets, and a color bar.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>number (rappture2web)</title>
     <command>python3 @tool/number.py @driver</command>
   </tool>
   <input>
     <number id="temperature">
       <about>
         <label>Ambient temperature</label>
         <description>Temperature of the environment.</description>
       </about>
       <units>K</units>
       <min>50K</min>
       <max>1000K</max>
       <default>300K</default>
       <color>purple</color>
       <preset>
         <value>300K</value>
         <label>Room temperature</label>
       </preset>
       <preset>
         <value>77K</value>
         <label>Liquid nitrogen</label>
       </preset>
     </number>
   </input>
   </run>

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

   rappture2web examples/webapp/number/
