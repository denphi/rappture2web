Sequence Output Example
=======================

Location: ``examples/webapp/sequence/``

This example demonstrates the ``<sequence>`` output type -- an animated
series of frames (images or curves) with playback controls.

tool.xml
--------

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>sequence (rappture2web)</title>
     <command>python3 @tool/sequence.py @driver</command>
   </tool>
   <input>
     <loader>
       <about><label>Image</label></about>
       <example>*.xml</example>
       <default>nanohub.xml</default>
     </loader>
     <image>
       <about><diffs>ignore</diffs></about>
       <resize>height=200</resize>
     </image>
     <integer id="nframes">
       <about>
         <label>Number of frames</label>
         <description>Number of frames in the output sequence.</description>
       </about>
       <min>2</min>
       <max>50</max>
       <default>4</default>
     </integer>
   </input>
   </run>

Key concepts
------------

- ``<image><resize>height=200</resize></image>`` constrains the input
  image preview size.
- Sequence frames can contain images, curves, or fields.
- The webapp renders a slider and play/pause controls for animation.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/sequence/
