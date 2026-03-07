Group Input Example
===================

Location: ``examples/webapp/group/``

This example demonstrates the ``<group>`` input type for organizing inputs
into collapsible sections. A group of groups renders as a tabbed interface.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>group (rappture2web)</title>
     <command>python3 @tool/group.py @driver</command>
   </tool>
   <input>
     <group id="tabs">
       <group id="models">
         <about><label>Models</label></about>
         <boolean id="recomb">
           <about><label>Recombination Model</label></about>
           <default>on</default>
         </boolean>
         <group id="tau">
           <about>
             <label>Minority carrier lifetimes</label>
             <layout>horizontal</layout>
           </about>
           <number id="taun">
             <about><label>For electrons</label></about>
             <default>1e-6</default>
           </number>
           <number id="taup">
             <about><label>For holes</label></about>
             <default>1e-6</default>
           </number>
         </group>
       </group>
       <group id="ambient">
         <about><label>Ambient</label></about>
         <number id="temp">
           <about><label>Temperature</label></about>
           <units>K</units>
           <default>300K</default>
         </number>
         <group id="loc">
           <about>
             <layout>sentence:Location = (${lat},${long})</layout>
           </about>
           <number id="lat">
             <about><label>Latitude</label></about>
             <default>40.42</default>
           </number>
           <number id="long">
             <about><label>Longitude</label></about>
             <default>-86.91</default>
           </number>
         </group>
       </group>
     </group>
   </input>
   </run>

Key concepts
------------

- **Tabs**: A group of groups (``tabs > models + ambient``) renders as
  a tabbed interface.
- **Horizontal layout**: ``<layout>horizontal</layout>`` arranges child
  inputs side by side.
- **Sentence layout**: ``<layout>sentence:Location = (${lat},${long})</layout>``
  renders inputs inline within a sentence template.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/group/
