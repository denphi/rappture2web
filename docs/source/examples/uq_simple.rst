UQ Simple Example
=================

Location: ``examples/webapp/uq_simple/``

A minimal example demonstrating Uncertainty Quantification on a simple
cosine wave.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/uq_simple/

How to use
----------

1. Open the tool in the browser
2. Next to **Amplitude** and **Frequency**, you'll see a dropdown that says
   ``exact``
3. Change one or both to ``uniform`` or ``gaussian``
4. Fill in the distribution parameters (min/max for uniform; mean/std for
   gaussian)
5. Click **Simulate**

The tool will run multiple times at Smolyak collocation points and produce
UQ output:

- PDF curves showing the probability distribution of scalar outputs
- Probability bands on curve outputs
- Sensitivity analysis showing which inputs matter most

tool.xml
--------

.. code-block:: xml

   <tool>
     <title>UQ Simple Curve</title>
     <command>python3 @tool/uq_simple.py @driver</command>
     <uq>true</uq>      <!-- enables UQ controls -->
   </tool>
   <input>
     <number id="amplitude">
       <about><label>Amplitude</label></about>
       <min>0.1</min>
       <max>10</max>
       <default>2</default>
     </number>
     <number id="frequency">
       <about><label>Frequency</label></about>
       <units>Hz</units>
       <min>0.1Hz</min>
       <max>10Hz</max>
       <default>1Hz</default>
     </number>
     <integer id="points">
       <about><label>Number of points</label></about>
       <uq>false</uq>    <!-- not a UQ parameter -->
       <default>200</default>
     </integer>
   </input>

Script (unchanged for UQ)
-------------------------

.. code-block:: python

   import sys
   import numpy as np
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])

   amplitude = float(rx['input.(amplitude).current'].value)
   freq_str = rx['input.(frequency).current'].value
   frequency = float(Rappture.Units.convert(freq_str, units='off'))
   npts = int(rx['input.(points).current'].value)

   x = np.linspace(0, 10, npts)
   y = amplitude * np.cos(2 * np.pi * frequency * x)

   rx['output.curve(wave).component.xy'] = (x, y)
   rx['output.number(peak).current'] = str(float(np.max(np.abs(y))))
   rx.close()

Note that the script is **identical** for exact and UQ runs.  rappture2web
handles the UQ orchestration (multiple runs, analysis) automatically.
