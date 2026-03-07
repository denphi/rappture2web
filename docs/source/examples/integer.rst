Integer Input Example
=====================

Location: ``examples/webapp/integer/``

This example demonstrates the ``<integer>`` input type with min/max bounds.
Integers are whole numbers with no units.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>integer (rappture2web)</title>
     <command>python3 @tool/integer.py @driver</command>
   </tool>
   <input>
     <integer id="points">
       <about>
         <label>Grid points</label>
         <description>Number of nodes used in the simulation mesh.</description>
       </about>
       <min>10</min>
       <max>1000</max>
       <default>100</default>
     </integer>
   </input>
   </run>

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

   rappture2web examples/webapp/integer/
