Histogram Output Example
========================

Location: ``examples/webapp/histogram/``

This example demonstrates the ``<histogram>`` output type for bar charts,
including single and grouped histograms.

Script
------

.. code-block:: python

   import sys
   import numpy as np
   import rappture2web.rp_library as Rappture

   rx = Rappture.PyXml(sys.argv[1])
   num_points = int(rx['input.(points).current'].value)
   x = np.linspace(1, 10, num_points)

   # Single histogram
   hist = rx['output.histogram(single)']
   hist['about.label'] = 'Single histogram'
   hist['xaxis.label'] = 'Time'
   hist['xaxis.units'] = 's'
   hist['yaxis.label'] = 'Voltage v(11)'
   hist['yaxis.units'] = 'V'
   hist['component.xy'] = (x, np.cos(x) / (1 + x))

   # Grouped histograms (overlaid on same axes)
   for factor in [1, 2]:
       hist = rx['output.histogram(multi%s)' % factor]
       hist['about.group'] = 'Multiple histogram'
       hist['about.label'] = 'Factor a=%s' % factor
       hist['xaxis.label'] = 'Frequency'
       hist['yaxis.label'] = 'Current'
       hist['component.xy'] = (x, np.power(2.0, factor * x) / x)

   rx.close()

Key concepts
------------

- Set ``about.group`` to the same name on multiple histograms to overlay
  them on a single plot.
- Axis labels and units are configured the same way as curves.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/histogram/
