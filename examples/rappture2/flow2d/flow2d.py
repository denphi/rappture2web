#!/usr/bin/env python3
"""
2D Lid-Driven Cavity Flow — rappture2web example.

Uses a simple stream-function / vorticity solver on an N×N grid
and outputs:
  - output.field(velocity)  : vector field (vx, vy, 0) per point
  - output.field(magnitude) : scalar field |v| per point
Both share the same uniform mesh.
"""

import sys
import math
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

# ── Read inputs ───────────────────────────────────────────────────────────────
N      = int(float(rx['input.(npts).current'].value))
nu     = float(Rappture.Units.convert(rx['input.(viscosity).current'].value, units='off'))
U_lid  = float(Rappture.Units.convert(rx['input.(lid_vel).current'].value,   units='off'))

# ── Grid setup ────────────────────────────────────────────────────────────────
# Unit square cavity [0,1]x[0,1]
dx = 1.0 / (N - 1)
dy = dx
dt = 0.25 * dx * dx / nu        # diffusion stability limit
nsteps = max(200, int(2.0 / dt)) # run long enough to reach quasi-steady state

# ── Stream-function / vorticity formulation ───────────────────────────────────
# psi = stream function, omega = vorticity
psi   = [[0.0]*N for _ in range(N)]
omega = [[0.0]*N for _ in range(N)]

for step in range(nsteps):
    # ── Vorticity transport ──────────────────────────────────────────────────
    new_omega = [row[:] for row in omega]
    for j in range(1, N-1):
        for i in range(1, N-1):
            dpsi_dx  = (psi[j][i+1] - psi[j][i-1]) / (2*dx)
            dpsi_dy  = (psi[j+1][i] - psi[j-1][i]) / (2*dy)
            dom_dx   = (omega[j][i+1] - omega[j][i-1]) / (2*dx)
            dom_dy   = (omega[j+1][i] - omega[j-1][i]) / (2*dy)
            lap_om   = (omega[j][i+1] + omega[j][i-1] +
                        omega[j+1][i] + omega[j-1][i] - 4*omega[j][i]) / (dx*dx)
            # convection + diffusion
            new_omega[j][i] = omega[j][i] + dt * (
                -dpsi_dy * dom_dx + dpsi_dx * dom_dy + nu * lap_om
            )
    omega = new_omega

    # ── Poisson: -lap(psi) = omega  (Gauss-Seidel) ──────────────────────────
    for _ in range(20):
        for j in range(1, N-1):
            for i in range(1, N-1):
                psi[j][i] = 0.25 * (
                    psi[j][i+1] + psi[j][i-1] +
                    psi[j+1][i] + psi[j-1][i] +
                    dx*dx * omega[j][i]
                )

    # ── Boundary vorticity (lid-driven cavity) ───────────────────────────────
    for i in range(N):
        # top lid (j=N-1): u=U_lid, v=0
        omega[N-1][i] = -2.0 * psi[N-2][i] / (dy*dy) - 2.0 * U_lid / dy
        # bottom (j=0): u=v=0
        omega[0][i]   = -2.0 * psi[1][i]   / (dy*dy)
        # left (i=0)
        omega[j][0]   = -2.0 * psi[j][1]   / (dx*dx)
        # right (i=N-1)
        omega[j][N-1] = -2.0 * psi[j][N-2] / (dx*dx)

# ── Extract velocity field from stream function ───────────────────────────────
# u =  d(psi)/dy,  v = -d(psi)/dx
points = []
vx_list, vy_list, mag_list = [], [], []

for j in range(N):
    for i in range(N):
        x = i * dx
        y = j * dy
        points.append((x, y, 0.0))

        # Central differences (clamp boundaries)
        if 1 <= j <= N-2:
            u =  (psi[j+1][i] - psi[j-1][i]) / (2*dy)
        elif j == N-1:
            u = U_lid
        else:
            u = 0.0

        if 1 <= i <= N-2:
            v = -(psi[j][i+1] - psi[j][i-1]) / (2*dx)
        else:
            v = 0.0

        vx_list.append(u)
        vy_list.append(v)
        mag_list.append(math.sqrt(u*u + v*v))

# ── Write mesh ────────────────────────────────────────────────────────────────
pts_text = "\n".join(f"{x} {y} {z}" for x, y, z in points)
rx['output.mesh(grid).about.label']        = 'Cavity Grid'
rx['output.mesh(grid).dim']               = '3'
rx['output.mesh(grid).units']             = 'm'
rx['output.mesh(grid).hide']              = 'yes'
rx['output.mesh(grid).unstructured.points'] = pts_text

# ── Write vector field (vx, vy, 0 interleaved — extents=3) ───────────────────
# Rappture convention: values stored as "vx1 vy1 vz1\nvx2 vy2 vz2\n..."
vec_text = "\n".join(
    f"{vx_list[k]} {vy_list[k]} 0.0"
    for k in range(len(points))
)
rx['output.field(velocity).about.label']      = 'Velocity Field'
rx['output.field(velocity).about.group']      = 'Flow'
rx['output.field(velocity).component.mesh']   = 'output.mesh(grid)'
rx['output.field(velocity).component.values'] = vec_text
rx['output.field(velocity).component.extents']= '3'

# ── Write scalar magnitude field ──────────────────────────────────────────────
mag_text = "\n".join(str(v) for v in mag_list)
rx['output.field(magnitude).about.label']      = 'Velocity Magnitude'
rx['output.field(magnitude).about.group']      = 'Flow'
rx['output.field(magnitude).component.mesh']   = 'output.mesh(grid)'
rx['output.field(magnitude).component.values'] = mag_text

# ── Done ──────────────────────────────────────────────────────────────────────
rx.close()
