Fermi-Dirac Example
===================

Location: ``examples/webapp/fermi/``

A complete scientific tool: computes the Fermi-Dirac distribution function
and its derivative for a given temperature and Fermi energy.

This is the rappture2web equivalent of the classic Rappture Fermi-Dirac
example.

Running
-------

.. code-block:: bash

   rappture2web examples/webapp/fermi/

Inputs
------

- **Temperature** (K) — with presets for room temperature and liquid nitrogen
- **Fermi Energy** (eV) — with presets for common semiconductor values
- **Energy Range** (eV) — range around the Fermi level
- **Number of Points** — resolution of the output curves

Outputs
-------

- **Fermi-Dirac Distribution** — curve: f(E) vs. E
- **df/dE** — curve: energy derivative
- **Thermal Energy kT** — scalar number
- **Temperature** — scalar number

Key code patterns
-----------------

Reading inputs with unit conversion:

.. code-block:: python

   T_str = rx['input.(temperature).current'].value
   T = float(Rappture.Units.convert(T_str, to='K', units='off'))

Writing a curve output:

.. code-block:: python

   fd = rx['output.curve(fermi)']
   fd['about.label'] = 'Fermi-Dirac Distribution'
   fd['xaxis.label'] = 'Energy'
   fd['xaxis.units'] = 'eV'
   fd['component.xy'] = (E_vals, f_vals)

Writing a scalar number output:

.. code-block:: python

   rx['output.number(kT).about.label'] = 'Thermal Energy kT'
   rx['output.number(kT).units'] = 'eV'
   rx['output.number(kT).current'] = f'{kT:.6f}eV'
