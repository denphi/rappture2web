#!/usr/bin/env python3
"""
3D Wire Flow Demo — rappture2web webapp example.

Ports the original TCL demo1 (flow/demo1/) to Python.
Reads velocity data from the sibling data file and outputs a vector
field on an unstructured point mesh derived from the 126×30×22
unirect3d grid.
"""

import sys
import os
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

# ── Grid definition (from original TCL demo1) ────────────────────────────────
NX, NY, NZ = 126, 30, 22
x_min, x_max = 0.0, 6300.0
y_min, y_max = 0.0, 1500.0
z_min, z_max = 0.0, 1519.05

dx = (x_max - x_min) / (NX - 1)
dy = (y_max - y_min) / (NY - 1)
dz = (z_max - z_min) / (NZ - 1)

# ── Load raw vector data ──────────────────────────────────────────────────────
data_file = os.path.join(os.path.dirname(__file__),
                         '..', '..', 'flow', 'demo1', 'data-demo1.tcl')
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
            if len(cols) >= 3:
                try:
                    raw_vecs.append([float(cols[0]), float(cols[1]), float(cols[2])])
                except ValueError:
                    pass

# ── Build full point list (all 126×30×22 = 83160 points) ─────────────────────
# Rappture unirect3d ordering: fastest index = x, then y, then z
# Send the full grid — the browser subsamples for display; full data needed for
# accurate particle advection via the voxel-hash velocity lookup.
points = []
vecs = []
idx = 0
for kz in range(NZ):
    for ky in range(NY):
        for kx in range(NX):
            if idx < len(raw_vecs):
                x = x_min + kx * dx
                y = y_min + ky * dy
                z = z_min + kz * dz
                points.append((x, y, z))
                vecs.append(raw_vecs[idx])
            idx += 1

# ── Write mesh ────────────────────────────────────────────────────────────────
pts_text = "\n".join(f"{x} {y} {z}" for x, y, z in points)
rx['output.mesh(grid).about.label']           = 'Wire Flow Grid'
rx['output.mesh(grid).dim']                  = '3'
rx['output.mesh(grid).units']                = 'm'
rx['output.mesh(grid).hide']                 = 'yes'
rx['output.mesh(grid).unstructured.points']  = pts_text

# ── Write vector field ────────────────────────────────────────────────────────
vec_text = "\n".join(f"{v[0]} {v[1]} {v[2]}" for v in vecs)
rx['output.field(velocity).about.label']      = 'Jwire Flow Velocity'
rx['output.field(velocity).about.group']      = 'Flow'
rx['output.field(velocity).component.mesh']   = 'output.mesh(grid)'
rx['output.field(velocity).component.values'] = vec_text
rx['output.field(velocity).component.extents']= '3'

# ── Flow metadata (matches original demo1.tcl) ────────────────────────────────
rx['output.field(velocity).component.flow.label']                        = 'Flow 1'
rx['output.field(velocity).component.flow.axis']                         = 'z'
rx['output.field(velocity).component.flow.position']                     = '0%'
rx['output.field(velocity).component.flow.volume']                       = 'yes'
rx['output.field(velocity).component.flow.streams']                      = 'no'
rx['output.field(velocity).component.flow.outline']                      = 'no'
rx['output.field(velocity).component.flow.arrows']                       = 'no'
rx['output.field(velocity).component.flow.particles(left).label']        = 'Left particle flow'
rx['output.field(velocity).component.flow.particles(left).axis']         = 'x'
rx['output.field(velocity).component.flow.particles(left).color']        = 'lightgreen'
rx['output.field(velocity).component.flow.particles(left).position']     = '10%'
rx['output.field(velocity).component.flow.particles(left).size']         = '2'
rx['output.field(velocity).component.flow.particles(right).label']       = 'Right particle flow'
rx['output.field(velocity).component.flow.particles(right).axis']        = 'x'
rx['output.field(velocity).component.flow.particles(right).color']       = 'khaki'
rx['output.field(velocity).component.flow.particles(right).position']    = '90%'
rx['output.field(velocity).component.flow.particles(right).size']        = '2'
rx['output.field(velocity).component.flow.box(one).label']               = 'Region 1'
rx['output.field(velocity).component.flow.box(one).color']               = 'cyan'
rx['output.field(velocity).component.flow.box(one).hide']                = 'yes'
rx['output.field(velocity).component.flow.box(one).corner1']             = '0 -100 -100'
rx['output.field(velocity).component.flow.box(one).corner2']             = '3000 400 400'
rx['output.field(velocity).component.flow.box(two).label']               = 'Region 2'
rx['output.field(velocity).component.flow.box(two).color']               = 'violet'
rx['output.field(velocity).component.flow.box(two).hide']                = 'yes'
rx['output.field(velocity).component.flow.box(two).corner1']             = '1000 -150 -100'
rx['output.field(velocity).component.flow.box(two).corner2']             = '3000 3000 3000'
rx['output.field(velocity).component.flow.box(three).label']             = 'Region 3'
rx['output.field(velocity).component.flow.box(three).color']             = 'magenta'
rx['output.field(velocity).component.flow.box(three).hide']              = 'yes'
rx['output.field(velocity).component.flow.box(three).corner1']           = '1000 -150 -100'
rx['output.field(velocity).component.flow.box(three).corner2']           = '2000 450 450'

rx.close()
