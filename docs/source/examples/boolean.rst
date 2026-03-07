Boolean Input Example
=====================

Location: ``examples/webapp/boolean/``

This example demonstrates the ``<boolean>`` input type. Booleans accept
logical true/false values. Rappture recognizes several equivalent default
formats: ``on``/``off``, ``yes``/``no``, ``true``/``false``, ``1``/``0``.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>boolean (rappture2web)</title>
     <command>python3 @tool/boolean.py @driver</command>
   </tool>
   <input>
     <boolean id="iimodel">
       <about>
         <label>Impact Ionization Model</label>
         <description>Enable/disable impact ionization effects.</description>
       </about>
       <default>on</default>
     </boolean>
     <boolean id="iimodel1">
       <about><label>Model 1</label></about>
       <default>yes</default>
     </boolean>
     <boolean id="iimodel2">
       <about><label>Model 2</label></about>
       <default>true</default>
     </boolean>
     <boolean id="iimodel3">
       <about><label>Model 3</label></about>
       <default>1</default>
     </boolean>
   </input>
   </run>

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   for eid, out_eid in [('iimodel', 'outb'), ('iimodel1', 'outb1'),
                        ('iimodel2', 'outb2'), ('iimodel3', 'outb3')]:
       val = rx['input.(%s).current' % eid].value
       rx['output.boolean(%s).about.label' % out_eid] = 'Echo of %s' % eid
       rx['output.boolean(%s).current' % out_eid] = val

   rx.close()

Key concepts
------------

- All four default formats (``on``, ``yes``, ``true``, ``1``) are treated
  identically by the framework.
- Boolean outputs echo the same format back.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/boolean/
