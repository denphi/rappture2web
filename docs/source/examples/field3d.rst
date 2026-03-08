3D Scalar Field Example
=======================

Location: ``examples/webapp/field3d/``

Computes a 3D Gaussian scalar field ``f(x,y,z) = exp(-r^2/sigma^2)`` on a
regular grid and visualizes it as a colored point cloud.

Inputs
------

- **Gaussian Width** -- standard deviation of the blob
- **Grid Points per Axis** -- resolution (total points = npts^3)
- **Center X/Y/Z** -- position of the Gaussian center

Script highlights
-----------------

.. code-block:: python

   # Build unstructured 3D mesh
   pts_text = "\n".join(f"{x} {y} {z}" for x, y, z in points)
   rx['output.mesh(grid).dim'] = '3'
   rx['output.mesh(grid).units'] = 'm'
   rx['output.mesh(grid).hide'] = 'yes'
   rx['output.mesh(grid).unstructured.points'] = pts_text

   # Write scalar field values
   vals_text = "\n".join(str(v) for v in values)
   rx['output.field(gaussian).component.mesh'] = 'output.mesh(grid)'
   rx['output.field(gaussian).component.values'] = vals_text

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/field3d/
