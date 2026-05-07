Choice Input Example
====================

Location: ``examples/rappture2/choice/``

This example demonstrates the ``<choice>`` input type -- a dropdown selector
for mutually exclusive options.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/choice/tool.xml
   :language: xml

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   stats = rx['input.choice(stats).current'].value
   rx['output.string(out).about.label'] = 'Selected carrier statistics'
   rx['output.string(out).current'] = 'Carrier Statistics: %s' % stats

   rx.close()

Key concepts
------------

- Each ``<option>`` has an optional ``<value>`` child. If omitted, the
  label text is used as the value.
- ``<default>`` matches against the option label, not the value.
- The script receives the **value** (e.g. ``bte``), not the label.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/choice/
