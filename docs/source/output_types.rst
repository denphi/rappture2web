Output Types
============

rappture2web renders all standard Rappture output types in the browser.

Curve
-----

XY line plots with legend, zoom, download (SVG/PNG/JSON).

.. code-block:: xml

   <curve id="result">
     <about>
       <label>My Curve</label>
       <description>A plot of voltage vs. time.</description>
     </about>
     <xaxis>
       <label>Time</label>
       <units>s</units>
     </xaxis>
     <yaxis>
       <label>Voltage</label>
       <units>V</units>
       <log>log</log>       <!-- optional: logarithmic Y axis -->
     </yaxis>
   </curve>

Writing curve data in Python:

.. code-block:: python

   # Using tuple of arrays (preferred)
   rx['output.curve(result).component.xy'] = (x_array, y_array)

   # Using string format
   xy = "\\n".join(f"{x} {y}" for x, y in zip(xs, ys))
   rx['output.curve(result).component.xy'] = xy

**Grouped curves**: set ``about.group`` to the same string on multiple curves
to overlay them on one plot.

**Chart types**: set ``about.type`` to ``scatter``, ``bar``, or ``line``
(default) to change the visualization.

Histogram
---------

Bar histograms:

.. code-block:: python

   rx['output.histogram(h).about.label'] = 'Distribution'
   rx['output.histogram(h).xaxis.label'] = 'Value'
   rx['output.histogram(h).yaxis.label'] = 'Count'
   rx['output.histogram(h).component.xy'] = '"bin1" 5\n"bin2" 12\n"bin3" 3'

Field
-----

2D heatmaps, 3D scalar fields, and VTK structured/unstructured data.

**2D field with regular grid**:

.. code-block:: python

   import numpy as np
   nx, ny = 50, 50
   x = np.linspace(0, 1, nx)
   y = np.linspace(0, 1, ny)

   # Mesh definition
   rx['output.mesh(m2d).dim'] = '2'
   rx['output.mesh(m2d).grid.xaxis.numpoints'] = str(nx)
   rx['output.mesh(m2d).grid.xaxis.min'] = '0'
   rx['output.mesh(m2d).grid.xaxis.max'] = '1'
   rx['output.mesh(m2d).grid.yaxis.numpoints'] = str(ny)
   rx['output.mesh(m2d).grid.yaxis.min'] = '0'
   rx['output.mesh(m2d).grid.yaxis.max'] = '1'

   # Field values (Fortran-order: column-major)
   X, Y = np.meshgrid(x, y)
   Z = np.sin(X * 6) * np.cos(Y * 6)
   rx['output.field(f).about.label'] = 'My Field'
   rx['output.field(f).component.mesh'] = 'output.mesh(m2d)'
   rx['output.field(f).component.values'] = ' '.join(map(str, Z.ravel('F')))

**3D field**: set ``dim`` to ``3`` and add a ``zaxis`` definition.

**VTK**: the field can reference a VTK file instead:

.. code-block:: python

   rx['output.field(vtk).about.label'] = 'VTK Data'
   rx['output.field(vtk).component.vtk'] = vtk_string

Table
-----

Tabular data:

.. code-block:: python

   rx['output.table(t).about.label'] = 'Results'
   rx['output.table(t).column(x).label'] = 'X'
   rx['output.table(t).column(y).label'] = 'Y'
   for xi, yi in zip(x_vals, y_vals):
       rx['output.table(t).data'] += f'{xi} {yi}\\n'

Sequence
--------

Animated frame sequences containing curves, fields, or images:

.. code-block:: python

   for i, frame_data in enumerate(frames):
       rx[f'output.sequence(s).element({i}).index'] = str(i)
       rx[f'output.sequence(s).element({i}).curve(c).component.xy'] = frame_data

Image
-----

PNG or JPEG image output:

.. code-block:: python

   import base64
   with open('result.png', 'rb') as f:
       b64 = base64.b64encode(f.read()).decode()
   rx['output.image(img).current'] = b64

Number / Integer / String / Boolean
------------------------------------

Scalar output values:

.. code-block:: python

   rx['output.number(result).about.label'] = 'Energy'
   rx['output.number(result).units'] = 'eV'
   rx['output.number(result).current'] = '1.234eV'

   rx['output.string(msg).about.label'] = 'Status'
   rx['output.string(msg).current'] = 'Converged'

Log
---

Simulation log output:

.. code-block:: python

   rx['output.log'] = 'Step 1: initialized\\nStep 2: converged\\n'

Mapviewer
---------

Geographic maps with scatter, choropleth, and heatmap layers:

.. code-block:: python

   mv = rx['output.mapviewer(map)']
   mv['about.label'] = 'Global Temperature'
   mv['projection'] = 'natural earth'
   mv['layer(temp).about.label'] = 'Temperature'
   mv['layer(temp).type'] = 'scatter'
   mv['layer(temp).data'] = json.dumps({
       'lats': [40.7, 34.0, 51.5],
       'lons': [-74.0, -118.2, -0.1],
       'values': [15.2, 20.1, 11.3],
   })
