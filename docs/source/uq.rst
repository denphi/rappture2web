Uncertainty Quantification (UQ)
===============================

rappture2web supports Uncertainty Quantification (UQ) for numeric inputs,
powered by PUQ.

Enabling UQ
-----------

Add ``<uq>true</uq>`` to the ``<tool>`` section of ``tool.xml``:

.. code-block:: xml

   <tool>
     <title>My UQ Tool</title>
     <command>python3 @tool/script.py @driver</command>
     <uq>true</uq>
   </tool>

When UQ is enabled, each ``<number>`` and ``<integer>`` input shows a dropdown
next to the value field with three options:

- **exact** — use a single value (default behavior)
- **uniform** — sample from a uniform distribution between min and max
- **gaussian** — sample from a Gaussian distribution with specified mean and
  standard deviation

Opting out individual inputs
----------------------------

Some inputs (like "number of grid points") should not participate in UQ.
Add ``<uq>false</uq>`` to exclude an input:

.. code-block:: xml

   <integer id="npoints">
     <about><label>Grid points</label></about>
     <uq>false</uq>
     <default>200</default>
   </integer>

Distribution types
------------------

Uniform distribution
~~~~~~~~~~~~~~~~~~~~

Specify a minimum and maximum value.  PUQ samples collocation points
uniformly across this range.

.. list-table::
   :widths: 20 80

   * - **min**
     - Lower bound of the distribution
   * - **max**
     - Upper bound of the distribution

Gaussian distribution
~~~~~~~~~~~~~~~~~~~~~

Specify a mean and standard deviation.  Optionally set min/max bounds
to truncate the distribution.

.. list-table::
   :widths: 20 80

   * - **mean**
     - Center of the distribution
   * - **std**
     - Standard deviation
   * - **min** (optional)
     - Lower truncation bound (defaults to mean - 3*std)
   * - **max** (optional)
     - Upper truncation bound (defaults to mean + 3*std)

How it works
------------

When the user clicks **Simulate** with one or more inputs set to a
distribution, rappture2web executes the following steps:

1. **Generate collocation points** — PUQ's Smolyak sparse grid method
   determines the minimal set of parameter combinations needed to fit a
   polynomial response surface.

2. **Run the tool** — The tool script is executed once for each collocation
   point, with the UQ parameters set to their sampled values.  Non-UQ inputs
   keep their exact values.

3. **Fit response surfaces** — PUQ analyzes all run results and fits a
   surrogate model (polynomial chaos expansion) for each output.

4. **Generate UQ outputs** — From the response surfaces, PUQ produces:

   - **PDF curves** — probability density function for each scalar output
   - **Probability bands** — 50% and 95% confidence intervals for curve outputs
   - **Sensitivity analysis** — relative importance of each UQ input parameter
   - **Response surfaces** — 1D or 2D visualizations of how outputs depend on
     inputs

These UQ outputs are displayed alongside the standard tool outputs in the
browser.

PUQ integration
---------------

rappture2web ships with the PUQ helper scripts:

- ``get_params.py`` — generates Smolyak collocation points
- ``inject_results.py`` — loads run results into the PUQ HDF5 file
- ``analyze.py`` — fits response surfaces and produces ``run_uq.xml``
- ``get_response.py`` — generates response surface plots

On NanoHUB, these scripts run under Python 2 with the PUQ library.
The PUQ executable is expected at ``/apps/rappture/current/bin/puq`` or
can be overridden with the ``RAPPTURE2WEB_PUQ_SH`` environment variable.

Library mode UQ
---------------

UQ works in library mode too.  For each collocation point run, the server
updates ``/api/inputs`` with the sampled parameter values, so
``rp_library`` reads the correct values for each run.

The tool script does not need any changes — it simply reads inputs and writes
outputs as usual.

Example
-------

See :doc:`examples/uq_simple` and :doc:`examples/uq_projectile` for complete
working examples.

.. code-block:: xml

   <?xml version="1.0"?>
   <run>
   <tool>
     <title>UQ Example</title>
     <command>python3 @tool/script.py @driver</command>
     <uq>true</uq>
   </tool>
   <input>
     <number id="amplitude">
       <about><label>Amplitude</label></about>
       <min>0.1</min>
       <max>10</max>
       <default>2</default>
     </number>
     <integer id="npts">
       <about><label>Points</label></about>
       <uq>false</uq>
       <default>200</default>
     </integer>
   </input>
   </run>
