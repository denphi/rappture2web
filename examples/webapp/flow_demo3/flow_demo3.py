#!/usr/bin/env python3
"""
3D DX Vector Field Demo — rappture2web webapp example.

Ports the original TCL demo3 (flow/demo3/) to Python.
Reads an OpenDX structured-grid vector field from data-dx.tcl and
outputs it on an unstructured point mesh.

DX grid: 121×25×23 = 69,575 points.
"""

import sys
import os
import math
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

stride = max(1, int(float(rx['input.(dummy).current'].value or '3')))

# ── Locate data file ──────────────────────────────────────────────────────────
data_file = os.path.normpath(os.path.join(
    os.path.dirname(__file__), '..', '..', 'flow', 'demo3', 'data-dx.tcl'))

# ── Parse OpenDX header from the TCL wrapper ──────────────────────────────────
# Format:
#   set dx {
#   object 1 class gridpositions counts NX NY NZ
#   origin ox oy oz
#   delta  dx 0  0
#   delta  0  dy 0
#   delta  0  0  dz
#   ...
#   object 3 class array ... items N data follows
#   vx vy vz
#   ...
#   }

NX = NY = NZ = 0
ox = oy = oz = 0.0
ddx = ddy = ddz = 0.0
raw_vecs = []

with open(data_file) as f:
    in_data = False
    delta_count = 0
    for line in f:
        s = line.strip()
        if not s or s == 'set dx {' or s == '}':
            in_data = False if s == '}' else in_data
            continue

        if in_data:
            cols = s.split()
            if len(cols) >= 3:
                try:
                    raw_vecs.append([float(cols[0]), float(cols[1]), float(cols[2])])
                except ValueError:
                    pass
            continue

        cols = s.split()
        if len(cols) >= 6 and cols[0] == 'object' and cols[2] == 'class' and cols[3] == 'gridpositions':
            # object 1 class gridpositions counts NX NY NZ
            NX, NY, NZ = int(cols[5]), int(cols[6]), int(cols[7])
        elif cols[0] == 'origin' and len(cols) >= 4:
            ox, oy, oz = float(cols[1]), float(cols[2]), float(cols[3])
        elif cols[0] == 'delta' and len(cols) >= 4:
            delta_count += 1
            if delta_count == 1:
                ddx = float(cols[1])   # x-spacing (first delta row)
            elif delta_count == 2:
                ddy = float(cols[2])   # y-spacing (second delta row)
            elif delta_count == 3:
                ddz = float(cols[3])   # z-spacing (third delta row)
        elif 'data follows' in s:
            in_data = True

# ── Fallback to header values if parsing failed ───────────────────────────────
if NX == 0:
    NX, NY, NZ = 121, 25, 23
    ox, oy, oz = 0.0, -1.5, -1.0
    ddx = 0.247933884
    ddy = 0.18
    ddz = 0.195652174

# ── Build subsampled point + vector lists ─────────────────────────────────────
# DX ordering for regular grids: z fastest, then y, then x
# (opposite of Rappture unirect3d; confirmed by "counts NX NY NZ" + delta order)
points = []
vecs = []
idx = 0
for kx in range(NX):
    for ky in range(NY):
        for kz in range(NZ):
            if idx < len(raw_vecs):
                if (kx % stride == 0) and (ky % stride == 0) and (kz % stride == 0):
                    x = ox + kx * ddx
                    y = oy + ky * ddy
                    z = oz + kz * ddz
                    points.append((x, y, z))
                    vecs.append(raw_vecs[idx])
            idx += 1

# ── Write mesh ────────────────────────────────────────────────────────────────
pts_text = "\n".join(f"{x} {y} {z}" for x, y, z in points)
rx['output.mesh(grid).about.label']          = 'DX Flow Grid'
rx['output.mesh(grid).dim']                  = '3'
rx['output.mesh(grid).units']                = 'm'
rx['output.mesh(grid).hide']                 = 'yes'
rx['output.mesh(grid).unstructured.points']  = pts_text

# ── Write vector field ────────────────────────────────────────────────────────
vec_text = "\n".join(f"{v[0]} {v[1]} {v[2]}" for v in vecs)
rx['output.field(velocity).about.label']       = 'SiO2 Flow Velocity'
rx['output.field(velocity).about.group']       = 'Flow'
rx['output.field(velocity).component.mesh']    = 'output.mesh(grid)'
rx['output.field(velocity).component.values']  = vec_text
rx['output.field(velocity).component.extents'] = '3'

# ── Flow metadata (matches original demo3.tcl) ────────────────────────────────
rx['output.field(velocity).component.flow.label']                   = 'SiO2'
rx['output.field(velocity).component.flow.axis']                     = 'z'
rx['output.field(velocity).component.flow.position']                 = '0%'
rx['output.field(velocity).component.flow.volume']                   = 'yes'
rx['output.field(velocity).component.flow.streams']                  = 'no'
rx['output.field(velocity).component.flow.outline']                  = 'no'
rx['output.field(velocity).component.flow.arrows']                   = 'yes'
rx['output.field(velocity).component.flow.particles(left).axis']     = 'x'
rx['output.field(velocity).component.flow.particles(left).color']    = 'lightgreen'
rx['output.field(velocity).component.flow.particles(left).position'] = '10%'
rx['output.field(velocity).component.flow.particles(left).size']     = '2'
rx['output.field(velocity).component.flow.particles(right).axis']    = 'x'
rx['output.field(velocity).component.flow.particles(right).color']   = 'khaki'
rx['output.field(velocity).component.flow.particles(right).position']= '90%'
rx['output.field(velocity).component.flow.particles(right).size']    = '2'

# ── Write scalar magnitude ────────────────────────────────────────────────────
mag_text = "\n".join(
    str(math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)) for v in vecs
)
rx['output.field(magnitude).about.label']      = 'Velocity Magnitude'
rx['output.field(magnitude).about.group']      = 'Flow'
rx['output.field(magnitude).component.mesh']   = 'output.mesh(grid)'
rx['output.field(magnitude).component.values'] = mag_text

rx.close()
