Phase Input Example
===================

Location: ``examples/webapp/phase/``

This example demonstrates the ``<phase>`` input type. A phase represents
a whole page in the interface, enabling multi-step wizard-style workflows.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>phase (rappture2web)</title>
     <command>python3 @tool/phase.py @driver</command>
   </tool>
   <input>
     <phase id="one">
       <about><label>First Page</label></about>
       <string id="first">
         <about><label>First input</label></about>
         <default>one</default>
       </string>
     </phase>

     <phase id="two">
       <about><label>Second Page</label></about>
       <string id="second">
         <about><label>Second input</label></about>
         <default>two</default>
       </string>
     </phase>
   </input>
   </run>

Key concepts
------------

- Each ``<phase>`` creates a separate page/tab in the input panel.
- Phases are useful for complex tools with many inputs that benefit from
  a guided, multi-step workflow.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/phase/
