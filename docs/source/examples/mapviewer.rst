MapViewer Output Example
========================

Location: ``examples/webapp/mapviewer/``

This example demonstrates the ``<mapviewer>`` output type -- geographic
maps with scatter, choropleth, or heatmap layers.

The example computes land use change parameters for sub-Saharan Africa,
displaying cultivation probability on a map.

Inputs
------

- **Market access increase** (%) -- profitability shock percentage
- **SSA sub-region** -- dropdown to filter by region
- **Land cover type** -- filter by baseline land cover

Key concepts
------------

**Setting up a map output:**

.. code-block:: python

   mv = rx['output.mapviewer(probmap)']
   mv['about.label'] = 'Cultivation Probability'

**Adding scatter points:**

.. code-block:: python

   mv['layer(points).type'] = 'scatter'
   mv['layer(points).data'] = data_string

**Adding a heatmap layer:**

.. code-block:: python

   mv['layer(heat).type'] = 'heatmap'
   mv['layer(heat).data'] = heatmap_data

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/mapviewer/
