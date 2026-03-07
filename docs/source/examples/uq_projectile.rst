UQ Projectile Example
=====================

Location: ``examples/webapp/uq_projectile/``

A multi-input physics example with UQ support.  Demonstrates how
uncertainty in launch parameters (velocity, angle, gravity) propagates
to trajectory predictions.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/uq_projectile/

Inputs
------

All inputs support UQ except "Number of time steps":

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - Input
     - UQ
     - Description
   * - Initial Height (m)
     - Yes
     - Starting height above ground
   * - Initial Velocity (m/s)
     - Yes
     - Launch speed
   * - Launch Angle (degrees)
     - Yes
     - Angle above horizontal
   * - Gravity (m/s^2)
     - Yes
     - Gravitational acceleration
   * - Number of time steps
     - **No**
     - Points for plotting (``<uq>false</uq>``)

Try this
--------

1. Set **Initial Velocity** to ``gaussian``, mean=100, std=10
2. Set **Launch Angle** to ``uniform``, min=40, max=50
3. Leave other inputs as exact values
4. Click **Simulate**

The UQ analysis will show:

- How the trajectory uncertainty band widens over time
- Which parameter (velocity or angle) has more influence on the range
- The PDF of the total distance traveled

Key pattern: multi-output UQ
-----------------------------

The script writes both **curve** and **number** outputs:

.. code-block:: python

   # Curves: trajectory and height-vs-time
   rx['output.curve(path).component.xy'] = (distance, height)
   rx['output.curve(height_vs_time).component.xy'] = (time, height)

   # Scalars: PUQ fits response surfaces for these
   rx['output.number(distance).current'] = f'{total_distance:.2f}m'
   rx['output.number(maxheight).current'] = f'{max_height:.2f}m'

PUQ generates PDFs for the scalar outputs and probability bands for the
curve outputs automatically.
