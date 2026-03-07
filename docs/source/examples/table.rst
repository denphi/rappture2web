Table Output Example
====================

Location: ``examples/webapp/table/``

This example demonstrates the ``<table>`` output type. It computes energy
levels for a particle in a 1D quantum box and displays them in a table.

Inputs
------

- **Box size** (nm) -- size of the 1D quantum well
- **Effective mass** -- electron mass relative to m0

Script
------

.. code-block:: python

   import sys
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   # ... physics calculations ...

   # Build table rows as space-separated columns
   rows = []
   for n in range(1, 21):
       E = n * n * h * h / (8.0 * m_kg * L * L * J2eV)
       rows.append('%s %.3g' % (label, E))

   # Set table metadata and data
   rx['output.table.about.label'] = 'Energy Levels'
   rx['output.table.column(labels).label'] = 'Name'
   rx['output.table.column(energies).label'] = 'Energy'
   rx['output.table.column(energies).units'] = 'eV'
   rx['output.table.data'] = '\n'.join(rows) + '\n'

   rx.close()

Key concepts
------------

- Define columns with ``column(id).label`` and optional ``column(id).units``.
- Provide data as newline-separated rows with space-separated values.
- Column order matches the order of ``column(...)`` definitions.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/table/
