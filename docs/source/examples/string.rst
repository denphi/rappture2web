String Input Example
====================

Location: ``examples/rappture2/string/``

This example demonstrates the ``<string>`` input type for both single-line
and multi-line text entry. The ``<size>`` element controls textarea
dimensions.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/string/tool.xml
   :language: xml

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   title = rx['input.(title).current'].value
   indeck = rx['input.(indeck).current'].value

   rx['output.string(outt).about.label'] = 'Echo of title'
   rx['output.string(outt).current'] = title
   rx['output.string(outi).about.label'] = 'Echo of input'
   rx['output.string(outi).current'] = indeck

   rx.close()

Key concepts
------------

- ``<size>40x10</size>`` creates a multi-line textarea (40 cols x 10 rows).
- Without ``<size>``, the string renders as a single-line input.
- ``<separator/>`` draws a horizontal divider between inputs.
- ``<hints>`` provides a help tooltip for the input.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/string/
