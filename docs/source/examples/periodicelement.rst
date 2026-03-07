Periodic Element Example
========================

Location: ``examples/webapp/periodicelement/``

This example demonstrates the ``<periodicelement>`` input type -- an
interactive periodic table picker.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>periodicelement (rappture2web)</title>
     <command>python3 @tool/periodicelement.py @driver</command>
   </tool>
   <input>
     <periodicelement id="first">
       <about>
         <label>First Element</label>
         <description>Select the first element.</description>
       </about>
       <default>As</default>
       <returnvalue>name</returnvalue>
     </periodicelement>
     <periodicelement id="second">
       <about><label>Second Element</label></about>
       <default>Oxygen</default>
       <returnvalue>name symbol number weight</returnvalue>
     </periodicelement>
     <periodicelement id="third">
       <about><label>Third Element</label></about>
       <default>Carbon</default>
       <returnvalue>weight</returnvalue>
       <active>other-non-metal</active>
     </periodicelement>
   </input>
   </run>

Key concepts
------------

- ``<returnvalue>`` controls what data the script receives:
  ``name``, ``symbol``, ``number``, ``weight``, or any combination.
- ``<active>`` restricts which element categories can be selected
  (e.g., ``other-non-metal``).
- Default can be an element symbol (``As``) or full name (``Oxygen``).

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/periodicelement/
