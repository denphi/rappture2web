#!/usr/bin/env python3
"""
2D Half-Plane Flow Demo — rappture2web webapp example.

Ports the original TCL demo2 (flow/demo2/) to Python.
Reads 2D velocity data (vx, vy) from the sibling data file and outputs
a vector field on a 305×109 planar grid (z=0).
"""

import sys
import os
import math
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

stride = max(1, int(float(rx['input.(dummy).current'].value or '5')))

# ── Grid definition (from original TCL demo2) ────────────────────────────────
NX, NY = 305, 109
x_min, x_max = -0.5, 152.0
y_min, y_max = -22.0, 21.6

dx = (x_max - x_min) / (NX - 1)
dy = (y_max - y_min) / (NY - 1)

# ── Load raw vector data (2-component: vx vy per point) ──────────────────────
data_file = os.path.join(os.path.dirname(__file__),
                         '..', '..', 'flow', 'demo2', 'data-2dflow.tcl')
data_file = os.path.normpath(data_file)

raw_vecs = []
with open(data_file) as f:
    in_block = False
    for line in f:
        line = line.strip()
        if line.startswith('set values {'):
            in_block = True
            continue
        if in_block:
            if line == '}':
                break
            cols = line.split()
            if len(cols) >= 2:
                try:
                    raw_vecs.append([float(cols[0]), float(cols[1]), 0.0])
                except ValueError:
                    pass

# ── Build point list (x-major ordering: fastest index = x) ───────────────────
points = []
vecs = []
idx = 0
for ky in range(NY):
    for kx in range(NX):
        if idx < len(raw_vecs):
            if (kx % stride == 0) and (ky % stride == 0):
                x = x_min + kx * dx
                y = y_min + ky * dy
                points.append((x, y, 0.0))
                vecs.append(raw_vecs[idx])
        idx += 1

# ── Write mesh ────────────────────────────────────────────────────────────────
pts_text = "\n".join(f"{x} {y} {z}" for x, y, z in points)
rx['output.mesh(grid).about.label']           = '2D Flow Grid'
rx['output.mesh(grid).dim']                  = '3'
rx['output.mesh(grid).units']                = 'm'
rx['output.mesh(grid).hide']                 = 'yes'
rx['output.mesh(grid).unstructured.points']  = pts_text

# ── Write vector field ────────────────────────────────────────────────────────
vec_text = "\n".join(f"{v[0]} {v[1]} {v[2]}" for v in vecs)
rx['output.field(velocity).about.label']      = '2D Flow Velocity'
rx['output.field(velocity).about.group']      = 'Flow'
rx['output.field(velocity).component.mesh']   = 'output.mesh(grid)'
rx['output.field(velocity).component.values'] = vec_text
rx['output.field(velocity).component.extents']= '3'

# ── Flow metadata ─────────────────────────────────────────────────────────────
rx['output.field(velocity).component.flow.label']              = 'Velocity'
rx['output.field(velocity).component.flow.arrows']             = 'yes'
rx['output.field(velocity).component.flow.outline']            = 'yes'
rx['output.field(velocity).component.flow.streams']            = 'yes'
rx['output.field(velocity).component.flow.particles(p1).axis']     = 'x'
rx['output.field(velocity).component.flow.particles(p1).position'] = '30%'
rx['output.field(velocity).component.flow.particles(p1).color']    = 'cyan'
rx['output.field(velocity).component.flow.particles(p1).size']     = '2'
rx['output.field(velocity).component.flow.particles(p2).axis']     = 'x'
rx['output.field(velocity).component.flow.particles(p2).position'] = '70%'
rx['output.field(velocity).component.flow.particles(p2).color']    = 'yellow'
rx['output.field(velocity).component.flow.particles(p2).size']     = '2'

# ── Write scalar magnitude ────────────────────────────────────────────────────
mag_text = "\n".join(
    str(math.sqrt(v[0]**2 + v[1]**2)) for v in vecs
)
rx['output.field(magnitude).about.label']      = 'Velocity Magnitude'
rx['output.field(magnitude).about.group']      = 'Flow'
rx['output.field(magnitude).component.mesh']   = 'output.mesh(grid)'
rx['output.field(magnitude).component.values'] = mag_text

rx.close()
