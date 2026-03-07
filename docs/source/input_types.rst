Input Types
===========

rappture2web supports all standard Rappture input widget types.

Number
------

A floating-point input with optional units, min/max bounds, color bar, and presets.

.. code-block:: xml

   <number id="temperature">
     <about>
       <label>Temperature</label>
       <description>Ambient temperature in the device region.</description>
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
   </number>

Reading in Python:

.. code-block:: python

   T_str = rx['input.(temperature).current'].value  # "300K"
   T = float(Rappture.Units.convert(T_str, to='K', units='off'))  # 300.0

Integer
-------

An integer input with optional min/max bounds.

.. code-block:: xml

   <integer id="npoints">
     <about><label>Number of points</label></about>
     <min>10</min>
     <max>10000</max>
     <default>200</default>
   </integer>

Boolean
-------

A checkbox that produces ``yes`` or ``no``.

.. code-block:: xml

   <boolean id="verbose">
     <about><label>Verbose output</label></about>
     <default>no</default>
   </boolean>

String
------

A text input.  Add ``<size>`` with a ``WxH`` format for multiline:

.. code-block:: xml

   <string id="notes">
     <about><label>Notes</label></about>
     <size>40x5</size>
     <default>Enter notes here</default>
   </string>

Choice
------

A dropdown select:

.. code-block:: xml

   <choice id="method">
     <about><label>Method</label></about>
     <default>fermi</default>
     <option>
       <about><label>Fermi-Dirac</label></about>
       <value>fermi</value>
     </option>
     <option>
       <about><label>Boltzmann</label></about>
       <value>boltzmann</value>
     </option>
   </choice>

Multichoice
-----------

Multiple checkboxes for selecting several options:

.. code-block:: xml

   <multichoice id="layers">
     <about><label>Active layers</label></about>
     <option>
       <about><label>Oxide</label></about>
       <value>oxide</value>
     </option>
     <option>
       <about><label>Substrate</label></about>
       <value>substrate</value>
     </option>
   </multichoice>

Loader
------

Loads example XML files that pre-populate other inputs:

.. code-block:: xml

   <loader id="examples">
     <about><label>Load example</label></about>
     <example>examples/*.xml</example>
   </loader>

Group
-----

Groups child inputs under a labeled section:

.. code-block:: xml

   <group id="advanced">
     <about><label>Advanced Settings</label></about>
     <number id="tol">
       <about><label>Tolerance</label></about>
       <default>1e-6</default>
     </number>
   </group>

Phase
-----

Creates tab pages for multi-step workflows:

.. code-block:: xml

   <phase id="setup">
     <about><label>Setup</label></about>
     <number id="param1">...</number>
   </phase>
   <phase id="run">
     <about><label>Run</label></about>
     <number id="param2">...</number>
   </phase>

Note
----

Read-only HTML or text content, often loaded from a file:

.. code-block:: xml

   <note>
     <contents>file://description.html</contents>
   </note>

Structure
---------

A 3D molecular/crystal structure viewer with associated parameters:

.. code-block:: xml

   <structure id="material">
     <about><label>Device structure</label></about>
     <default>
       <components>
         <molecule>...</molecule>
       </components>
       <parameters>
         <number id="thickness">
           <about><label>Thickness</label></about>
           <units>nm</units>
           <default>2nm</default>
         </number>
       </parameters>
     </default>
   </structure>

Periodic Element
----------------

An interactive periodic table for selecting chemical elements.

Drawing
-------

A 2D canvas with interactive hotspots for adjusting parameters visually.

Separator
---------

A horizontal line between inputs for visual grouping:

.. code-block:: xml

   <separator/>
