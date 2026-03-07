Choice Input Example
====================

Location: ``examples/webapp/choice/``

This example demonstrates the ``<choice>`` input type -- a dropdown selector
for mutually exclusive options.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>choice (rappture2web)</title>
     <command>python3 @tool/choice.py @driver</command>
   </tool>
   <input>
     <choice id="stats">
       <about>
         <label>Carrier Statistics</label>
         <description>Model for carrier statistics in bandgap narrowing.</description>
       </about>
       <option>
         <about>
           <label>Boltzmann</label>
           <description>From the Boltzmann transport equation</description>
         </about>
         <value>bte</value>
       </option>
       <option>
         <about>
           <label>Fermi</label>
           <description>Fermi-Dirac statistics</description>
         </about>
       </option>
       <option>
         <about>
           <label>2D Gas</label>
           <description>Includes confinement at material interface</description>
         </about>
         <value>2deg</value>
       </option>
       <default>Boltzmann</default>
     </choice>
   </input>
   </run>

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   stats = rx['input.choice(stats).current'].value
   rx['output.string(out).about.label'] = 'Selected carrier statistics'
   rx['output.string(out).current'] = 'Carrier Statistics: %s' % stats

   rx.close()

Key concepts
------------

- Each ``<option>`` has an optional ``<value>`` child. If omitted, the
  label text is used as the value.
- ``<default>`` matches against the option label, not the value.
- The script receives the **value** (e.g. ``bte``), not the label.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/choice/
