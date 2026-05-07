Image Example
=============

Location: ``examples/rappture2/image/``

This example demonstrates the ``<image>`` input type with a ``<loader>``
and a rotation angle. The input image is rotated by the specified angle.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/image/tool.xml
   :language: xml

Key concepts
------------

- ``<loader>`` provides a dropdown of example input files (``*.xml``).
- ``<image>`` renders an image preview in the input panel.
- ``<diffs>ignore`` tells the compare mode to skip this input.
- Image outputs use base64-encoded PNG/JPEG data.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/image/
