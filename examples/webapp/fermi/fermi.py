#!/usr/bin/env python3
"""
Fermi-Dirac Distribution — rappture2web example.

This script is a drop-in replacement for the original Rappture TCL/Tk version.
The only change from a classic Rappture script is the import:

    # Old:  import Rappture
    # New:
    import rappture2web.rp_library as Rappture

Everything else is identical API.  sys.argv[1] receives the server URL
(when launched via rappture2web --library-mode) or a driver.xml path
(classic mode — the library detects which one automatically).
"""

import sys
import math
import rappture2web.rp_library as Rappture

# ── Open tool handle ─────────────────────────────────────────────────────────
rx = Rappture.PyXml(sys.argv[1])

# ── Read inputs ──────────────────────────────────────────────────────────────
T_str    = rx['input.(temperature).current'].value
Ef_str   = rx['input.(Ef).current'].value
er_str   = rx['input.(erange).current'].value
npts_str = rx['input.(npoints).current'].value

# Convert to floats (strip units)
T    = float(Rappture.Units.convert(T_str,  units='off'))   # K
Ef   = float(Rappture.Units.convert(Ef_str, units='off'))   # eV
er   = float(Rappture.Units.convert(er_str, units='off'))   # eV
npts = int(float(npts_str))

# ── Compute Fermi-Dirac distribution ─────────────────────────────────────────
kB_eV = 8.617333e-5   # Boltzmann constant in eV/K
kT    = kB_eV * T

E_min = Ef - er
E_max = Ef + er
step  = (E_max - E_min) / max(npts - 1, 1)

E_vals = [E_min + i * step for i in range(npts)]
f_vals = []
for E in E_vals:
    try:
        f = 1.0 / (1.0 + math.exp((E - Ef) / kT))
    except OverflowError:
        f = 0.0 if (E - Ef) > 0 else 1.0
    f_vals.append(f)

# ── Write outputs (stream live to browser) ───────────────────────────────────

# Main Fermi-Dirac curve
fd = rx['output.curve(fermi)']
fd['about.label']     = 'Fermi-Dirac Distribution'
fd['xaxis.label']     = 'Energy'
fd['xaxis.units']     = 'eV'
fd['yaxis.label']     = 'f(E) — Occupation Probability'
fd['component.xy']    = (E_vals, f_vals)

# Derivative df/dE (density of states weight)
dfdE_vals = []
for E in E_vals:
    try:
        ex = math.exp((E - Ef) / kT)
        dfdE = -ex / (kT * (1.0 + ex) ** 2)
    except OverflowError:
        dfdE = 0.0
    dfdE_vals.append(dfdE)

deriv = rx['output.curve(deriv)']
deriv['about.label']  = 'df/dE (Energy Derivative)'
deriv['xaxis.label']  = 'Energy'
deriv['xaxis.units']  = 'eV'
deriv['yaxis.label']  = 'df/dE [1/eV]'
deriv['component.xy'] = (E_vals, dfdE_vals)

# Summary numbers
rx['output.number(kT).about.label'] = 'Thermal Energy kT'
rx['output.number(kT).units']       = 'eV'
rx['output.number(kT).current']     = f'{kT:.6f}eV'

rx['output.number(T).about.label']  = 'Temperature'
rx['output.number(T).units']        = 'K'
rx['output.number(T).current']      = f'{T:.1f}K'

# ── Done ─────────────────────────────────────────────────────────────────────
rx.close()
