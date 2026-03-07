Image Example
=============

Location: ``examples/webapp/image/``

This example demonstrates the ``<image>`` input type with a ``<loader>``
and a rotation angle. The input image is rotated by the specified angle.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>image (rappture2web)</title>
     <command>python3 @tool/image.py @driver</command>
   </tool>
   <input>
     <loader>
       <about><label>Image</label></about>
       <example>*.xml</example>
       <default>nanohub.xml</default>
     </loader>
     <image>
       <about>
         <label>Image</label>
         <description>Input image that gets rotated.</description>
         <diffs>ignore</diffs>
       </about>
     </image>
     <number id="angle">
       <about>
         <label>Rotate</label>
         <description>Rotation angle in degrees.</description>
       </about>
       <units>deg</units>
       <min>0deg</min>
       <max>360deg</max>
       <default>45deg</default>
     </number>
   </input>
   </run>

Key concepts
------------

- ``<loader>`` provides a dropdown of example input files (``*.xml``).
- ``<image>`` renders an image preview in the input panel.
- ``<diffs>ignore`` tells the compare mode to skip this input.
- Image outputs use base64-encoded PNG/JPEG data.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/image/
