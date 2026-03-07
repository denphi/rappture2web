Enable/Disable Example
======================

Location: ``examples/webapp/enable/``

This example demonstrates the ``<enable>`` attribute for conditionally
showing or hiding inputs based on other input values.

tool.xml (simplified)
---------------------

.. code-block:: xml

   <input>
     <choice id="model">
       <about><label>Model</label></about>
       <option><about><label>Drift-Diffusion</label></about><value>dd</value></option>
       <option><about><label>Boltzmann Transport</label></about><value>bte</value></option>
       <option><about><label>Quantum NEGF</label></about><value>negf</value></option>
       <default>Drift-Diffusion</default>
     </choice>

     <!-- Shown only when model == "dd" -->
     <group id="dd">
       <about>
         <label>Drift-Diffusion Options</label>
         <enable>input.choice(model) == "dd"</enable>
       </about>
       <boolean id="recomb">
         <about><label>Recombination Model</label></about>
         <default>off</default>
       </boolean>
       <!-- Shown only when recomb is on -->
       <number id="taun">
         <about>
           <label>Electron Lifetime</label>
           <enable>input.group(dd).boolean(recomb)</enable>
         </about>
         <default>1e-6</default>
       </number>
     </group>

     <!-- Shown only when model == "bte" -->
     <group id="bte">
       <about>
         <label>BTE Options</label>
         <enable>input.choice(model) == "bte"</enable>
       </about>
       <number id="temp">
         <about><label>Temperature</label></about>
         <units>K</units>
         <default>300K</default>
       </number>
       <!-- Always hidden -->
       <integer id="secret">
         <about>
           <label>Secret number</label>
           <enable>no</enable>
         </about>
         <default>7</default>
       </integer>
     </group>

     <!-- Value-based enable with unit comparison -->
     <group id="negf">
       <about>
         <label>Quantum Options</label>
         <enable>input.choice(model) == "negf"</enable>
       </about>
       <number id="tbe">
         <about><label>Tight-binding Energy</label></about>
         <units>eV</units>
         <default>3.12eV</default>
       </number>
       <number id="tau">
         <about>
           <label>High-energy lifetime</label>
           <enable>input.(negf).(tbe):eV &gt;= 3</enable>
         </about>
         <units>ns</units>
         <default>10ns</default>
       </number>
     </group>
   </input>

Enable expression syntax
------------------------

.. list-table::
   :header-rows: 1
   :widths: 50 50

   * - Expression
     - Meaning
   * - ``input.choice(model) == "dd"``
     - Exact value match
   * - ``input.group(dd).boolean(recomb)``
     - Boolean is true/on
   * - ``input.(negf).(tbe):eV >= 3``
     - Numeric comparison with unit
   * - ``no``
     - Always disabled/hidden

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/enable/
