Boolean Input Example
=====================

Location: ``examples/rappture2/boolean/``

This example demonstrates the ``<boolean>`` input type. Booleans accept
logical true/false values. Rappture recognizes several equivalent default
formats: ``on``/``off``, ``yes``/``no``, ``true``/``false``, ``1``/``0``.

tool.xml
--------

.. literalinclude:: ../../../examples/rappture2/boolean/tool.xml
   :language: xml

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   for eid, out_eid in [('iimodel', 'outb'), ('iimodel1', 'outb1'),
                        ('iimodel2', 'outb2'), ('iimodel3', 'outb3')]:
       val = rx['input.(%s).current' % eid].value
       rx['output.boolean(%s).about.label' % out_eid] = 'Echo of %s' % eid
       rx['output.boolean(%s).current' % out_eid] = val

   rx.close()

Key concepts
------------

- All four default formats (``on``, ``yes``, ``true``, ``1``) are treated
  identically by the framework.
- Boolean outputs echo the same format back.

Running
-------

.. code-block:: bash

   rappture2web examples/rappture2/boolean/
