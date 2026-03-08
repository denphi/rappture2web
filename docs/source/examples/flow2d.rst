2D Flow Field Example
=====================

Location: ``examples/webapp/flow2d/``

Simulates 2D lid-driven cavity flow and visualizes the velocity field as
colored arrows.

Inputs
------

- **Grid Size** -- N x N grid resolution
- **Kinematic Viscosity** -- fluid viscosity (affects Reynolds number)
- **Lid Velocity** -- speed of the moving lid

Key concepts
------------

**Vector field output** (3-component per point):

.. code-block:: python

   # Interleaved vx, vy, vz values
   vec_text = "\n".join(
       f"{vx[k]} {vy[k]} 0.0" for k in range(npoints)
   )
   rx['output.field(velocity).component.mesh'] = 'output.mesh(grid)'
   rx['output.field(velocity).component.values'] = vec_text
   rx['output.field(velocity).component.extents'] = '3'

- ``extents=3`` tells the renderer this is a 3-component vector field.
- The webapp renders vector fields as colored arrows.
- Use ``about.group`` to overlay vector and scalar fields on the same view.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/flow2d/
