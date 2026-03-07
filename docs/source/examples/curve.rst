Curve Output Example
====================

Location: ``examples/webapp/curve/``

This example demonstrates all curve variants: single, grouped, scatter, bar,
log-scale, and mixed element types.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/curve/

Key concepts
------------

**Single curve**:

.. code-block:: python

   rx['output.curve(result).about.label'] = 'My Curve'
   rx['output.curve(result).xaxis.label'] = 'Time'
   rx['output.curve(result).xaxis.units'] = 's'
   rx['output.curve(result).yaxis.label'] = 'Voltage'
   rx['output.curve(result).component.xy'] = (x_array, y_array)

**Grouped curves** (overlaid on one plot):

.. code-block:: python

   for i, factor in enumerate([1, 2, 3]):
       c = rx[f'output.curve(c{i})']
       c['about.group'] = 'Comparison'
       c['about.label'] = f'Factor {factor}'
       c['component.xy'] = (x, y * factor)

**Scatter plot**:

.. code-block:: python

   rx['output.curve(scatter).about.type'] = 'scatter'
   rx['output.curve(scatter).component.xy'] = (x, y)

**Bar chart**:

.. code-block:: python

   rx['output.curve(bars).about.type'] = 'bar'
   rx['output.curve(bars).component.xy'] = (categories, values)

**Logarithmic Y axis**:

.. code-block:: python

   rx['output.curve(log).yaxis.log'] = 'log'

**Axis limits**:

.. code-block:: python

   rx['output.curve(c).xaxis.min'] = '0.5'
   rx['output.curve(c).xaxis.max'] = '9.5'
