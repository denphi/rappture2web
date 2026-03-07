Field Output Example
====================

Location: ``examples/webapp/field/``

Demonstrates a 2D scalar field rendered as a heatmap with a colorscale.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/field/

How to create a 2D field
-------------------------

A field requires two parts: a **mesh** definition and **field values**.

1. Define the mesh:

.. code-block:: python

   nx, ny = 50, 50
   rx['output.mesh(m2d).dim'] = '2'
   rx['output.mesh(m2d).hide'] = 'yes'  # hide mesh in output tabs

   rx['output.mesh(m2d).grid.xaxis.numpoints'] = str(nx)
   rx['output.mesh(m2d).grid.xaxis.min'] = '0'
   rx['output.mesh(m2d).grid.xaxis.max'] = '1'
   rx['output.mesh(m2d).grid.xaxis.label'] = 'X'

   rx['output.mesh(m2d).grid.yaxis.numpoints'] = str(ny)
   rx['output.mesh(m2d).grid.yaxis.min'] = '0'
   rx['output.mesh(m2d).grid.yaxis.max'] = '1'
   rx['output.mesh(m2d).grid.yaxis.label'] = 'Y'

2. Compute and write field values:

.. code-block:: python

   import numpy as np
   x = np.linspace(0, 1, nx)
   y = np.linspace(0, 1, ny)
   X, Y = np.meshgrid(x, y)
   Z = np.sin(X * 6) * np.cos(Y * 6)

   rx['output.field(f).about.label'] = 'My Field'
   rx['output.field(f).component.mesh'] = 'output.mesh(m2d)'
   # Values in Fortran (column-major) order
   rx['output.field(f).component.values'] = ' '.join(map(str, Z.ravel('F')))

The heatmap viewer supports:

- **Colorscale selection** (Viridis, Plasma, etc.)
- **Zoom and pan**
- **Heightmap view** (about.view = 'heightmap')
- **Download** as PNG or SVG
