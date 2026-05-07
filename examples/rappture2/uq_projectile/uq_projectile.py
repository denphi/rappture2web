"""Projectile Motion with UQ — rappture2web example.

Works identically with exact values or as part of a UQ sweep.
When rappture2web runs in UQ mode, this script is called once per
collocation point with different input values.
"""
import sys
import numpy as np
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

# Read inputs
h0_str = rx['input.(height).current'].value
h0 = float(Rappture.Units.convert(h0_str, to='m', units='off'))

v0_str = rx['input.(velocity).current'].value
v0 = float(Rappture.Units.convert(v0_str, to='m/s', units='off'))

angle_str = rx['input.(angle).current'].value
angle = float(Rappture.Units.convert(angle_str, units='off'))

g_str = rx['input.(g).current'].value
g = float(Rappture.Units.convert(g_str, to='m/s2', units='off'))

npts = int(rx['input.(npts).current'].value)

# Physics
vx = v0 * np.cos(np.radians(angle))
vy = v0 * np.sin(np.radians(angle))

# Time to peak
t_peak = vy / g
max_height = h0 + vy * t_peak - 0.5 * g * t_peak**2

# Time to fall from peak to ground
t_fall = np.sqrt(2 * max_height / g)
t_total = t_peak + t_fall
distance = vx * t_total

Rappture.Utils.progress(50, "Computing trajectory...")

# Trajectory arrays
t = np.linspace(0, t_total, npts)
d = vx * t
h = h0 + vy * t - 0.5 * g * t**2
h = np.maximum(h, 0)  # clamp to ground

# Write outputs
rx['output.curve(path).about.label'] = 'Trajectory'
rx['output.curve(path).xaxis.label'] = 'Distance'
rx['output.curve(path).xaxis.units'] = 'm'
rx['output.curve(path).yaxis.label'] = 'Height'
rx['output.curve(path).yaxis.units'] = 'm'
rx['output.curve(path).component.xy'] = (d, h)

rx['output.curve(height_vs_time).about.label'] = 'Height vs Time'
rx['output.curve(height_vs_time).xaxis.label'] = 'Time'
rx['output.curve(height_vs_time).xaxis.units'] = 's'
rx['output.curve(height_vs_time).yaxis.label'] = 'Height'
rx['output.curve(height_vs_time).yaxis.units'] = 'm'
rx['output.curve(height_vs_time).component.xy'] = (t, h)

rx['output.number(distance).about.label'] = 'Total Distance'
rx['output.number(distance).units'] = 'm'
rx['output.number(distance).current'] = f'{distance:.2f}m'

rx['output.number(maxheight).about.label'] = 'Maximum Height'
rx['output.number(maxheight).units'] = 'm'
rx['output.number(maxheight).current'] = f'{max_height:.2f}m'

Rappture.Utils.progress(100, "Done")
rx.close()
