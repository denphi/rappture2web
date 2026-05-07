#!/usr/bin/env python3
"""
3D Gaussian scalar field — rappture2web example.

Outputs an unstructured point cloud with scalar values that are
rendered in the browser as a coloured Three.js point cloud.
"""

import sys
import math
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

# ── Read inputs ──────────────────────────────────────────────────────────────
sigma = float(Rappture.Units.convert(rx['input.(sigma).current'].value, units='off'))
npts  = int(float(rx['input.(npts).current'].value))
cx    = float(Rappture.Units.convert(rx['input.(cx).current'].value, units='off'))
cy    = float(Rappture.Units.convert(rx['input.(cy).current'].value, units='off'))
cz    = float(Rappture.Units.convert(rx['input.(cz).current'].value, units='off'))

# ── Build regular grid ────────────────────────────────────────────────────────
lo, hi = -2.0, 2.0
step = (hi - lo) / (npts - 1)

points = []
values = []

for i in range(npts):
    x = lo + i * step
    for j in range(npts):
        y = lo + j * step
        for k in range(npts):
            z = lo + k * step
            r2 = (x - cx)**2 + (y - cy)**2 + (z - cz)**2
            f = math.exp(-r2 / (sigma**2))
            points.append((x, y, z))
            values.append(f)

# ── Write mesh ───────────────────────────────────────────────────────────────
pts_text = "\n".join(f"{x} {y} {z}" for x, y, z in points)
rx['output.mesh(grid).about.label'] = 'Regular Grid'
rx['output.mesh(grid).dim']         = '3'
rx['output.mesh(grid).units']       = 'm'
rx['output.mesh(grid).hide']        = 'yes'
rx['output.mesh(grid).unstructured.points'] = pts_text

# ── Write field ───────────────────────────────────────────────────────────────
vals_text = "\n".join(str(v) for v in values)
rx['output.field(gaussian).about.label']     = 'Gaussian Field'
rx['output.field(gaussian).about.group']     = 'f(x,y,z)'
rx['output.field(gaussian).component.mesh']  = 'output.mesh(grid)'
rx['output.field(gaussian).component.values'] = vals_text

# ── Done ──────────────────────────────────────────────────────────────────────
rx.close()
