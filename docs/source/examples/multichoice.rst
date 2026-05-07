MultiChoice Input Example
=========================

Location: ``examples/rappture2/multichoice/``

This example demonstrates the ``<multichoice>`` input type -- a checkbox
list where multiple options can be selected simultaneously.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/multichoice/tool.xml
   :language: xml

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   choice = rx['input.multichoice(countries).current'].value
   rx['output.string(outs).about.label'] = 'Echo of multichoice'
   rx['output.string(outs).current'] = 'Selected countries: %s' % choice

   rx.close()

Key concepts
------------

- Multiple selections are returned as a comma-separated string of values.
- Like ``<choice>``, each option can have a ``<value>`` that differs from
  its ``<label>``.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/multichoice/
