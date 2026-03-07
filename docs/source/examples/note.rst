Note Input Example
==================

Location: ``examples/webapp/note/``

This example demonstrates the ``<note>`` input type -- read-only HTML
content displayed within the input panel.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>note (rappture2web)</title>
     <command>python3 @tool/note.py @driver</command>
   </tool>
   <input>
     <note>
       <contents>file://bysize.html</contents>
     </note>
     <number id="diameter">
       <about>
         <label>Particle diameter d</label>
         <description>Diameter of sphere-shaped nanoparticles.</description>
       </about>
       <units>nm</units>
       <min>2nm</min>
       <max>20nm</max>
       <default>5nm</default>
     </number>
   </input>
   </run>

Key concepts
------------

- ``<contents>file://bysize.html</contents>`` loads HTML from an external
  file relative to the tool directory.
- Notes can also contain inline HTML directly.
- Notes are non-interactive and are not sent as inputs to the simulation.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/note/
