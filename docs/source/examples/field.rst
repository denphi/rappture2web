Field Output Example
====================

Location: ``examples/webapp/field/``

Demonstrates 2D and 3D scalar fields. The 2D field renders as a heatmap;
the 3D field renders as isosurfaces or a point cloud depending on the
mesh type.

Inputs
------

- **Formula** -- a mathematical expression in x, y, z (e.g. ``x*y*z``)
- **3D Rendering** -- uniform grid (isosurface) or unstructured mesh

How to create a 2D field
-------------------------

A field requires two parts: a **mesh** definition and **field values**.

1. Define the mesh:

.. code-block:: python

   m2d = rx['output.mesh(m2d)']
   m2d['dim'] = 2
   m2d['units'] = 'um'
   m2d['hide'] = 'yes'
   m2d['grid.xaxis.min'] = 0
   m2d['grid.xaxis.max'] = 4
   m2d['grid.xaxis.numpoints'] = 5
   m2d['grid.yaxis.min'] = 0
   m2d['grid.yaxis.max'] = 4
   m2d['grid.yaxis.numpoints'] = 5

2. Write field values on the mesh:

.. code-block:: python

   f2d = rx['output.field(f2d)']
   f2d['about.label'] = '2D Field'
   f2d['component.mesh'] = 'output.mesh(m2d)'
   f2d['component.values'] = numpy_2d_array

3D uniform grid mesh
--------------------

.. code-block:: python

   m3d = rx['output.mesh(m3d)']
   m3d['dim'] = 3
   m3d['grid.xaxis.numpoints'] = 5
   m3d['grid.yaxis.numpoints'] = 5
   m3d['grid.zaxis.numpoints'] = 2

3D unstructured mesh (point cloud)
-----------------------------------

.. code-block:: python

   m3d['unstructured.points'] = "x1 y1 z1\nx2 y2 z2\n..."

The heatmap viewer supports colorscale selection, zoom/pan, heightmap view,
and download as PNG/SVG.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/field/
