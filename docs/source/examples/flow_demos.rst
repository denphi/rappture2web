Flow Visualization Demos
========================

Three additional flow visualization examples demonstrate different data
formats and grid types.

flow_demo1 -- 3D Wire Flow
--------------------------

Location: ``examples/webapp/flow_demo1/``

3D vector flow field from a Jwire simulation on a 126 x 30 x 22 regular grid.
Visualizes the velocity field as colored arrows.

.. code-block:: bash

   rappture2web examples/webapp/flow_demo1/

flow_demo2 -- 2D Half-Plane Flow
---------------------------------

Location: ``examples/webapp/flow_demo2/``

2D vector flow field on a 305 x 109 regular grid.

.. code-block:: bash

   rappture2web examples/webapp/flow_demo2/

flow_demo3 -- 3D DX Vector Field
----------------------------------

Location: ``examples/webapp/flow_demo3/``

3D vector flow field from an OpenDX structured grid (121 x 25 x 23).
Demonstrates loading DX-format data with particle injection planes.

.. code-block:: bash

   rappture2web examples/webapp/flow_demo3/
