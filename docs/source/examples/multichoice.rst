MultiChoice Input Example
=========================

Location: ``examples/webapp/multichoice/``

This example demonstrates the ``<multichoice>`` input type -- a checkbox
list where multiple options can be selected simultaneously.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>multichoice (rappture2web)</title>
     <command>python3 @tool/multichoice.py @driver</command>
   </tool>
   <input>
     <multichoice id="countries">
       <about>
         <label>African Countries</label>
         <description>Choose the countries to analyze.</description>
       </about>
       <option>
         <about><label>South Africa</label></about>
         <value>ZAF</value>
       </option>
       <option>
         <about><label>Zimbabwe</label></about>
         <value>ZWE</value>
       </option>
       <option>
         <about><label>Swaziland</label></about>
         <value>SWZ</value>
       </option>
       <default>Zimbabwe</default>
     </multichoice>
   </input>
   </run>

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   choice = rx['input.multichoice(countries).current'].value
   rx['output.string(outs).about.label'] = 'Echo of multichoice'
   rx['output.string(outs).current'] = 'Selected countries: %s' % choice

   rx.close()

Key concepts
------------

- Multiple selections are returned as a comma-separated string of values.
- Like ``<choice>``, each option can have a ``<value>`` that differs from
  its ``<label>``.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/multichoice/
