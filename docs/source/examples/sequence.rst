Sequence Output Example
=======================

Location: ``examples/rappture2/sequence/``

This example demonstrates the ``<sequence>`` output type -- an animated
series of frames (images or curves) with playback controls.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/sequence/tool.xml
   :language: xml

Key concepts
------------

- ``<image><resize>height=200</resize></image>`` constrains the input
  image preview size.
- Sequence frames can contain images, curves, or fields.
- rappture2web renders a slider and play/pause controls for animation.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/sequence/
