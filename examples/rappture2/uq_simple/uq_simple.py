"""UQ Simple Curve — rappture2web example with UQ support.

Demonstrates a simple tool that works with both exact values and
UQ distributions.  When the user selects a uniform or gaussian
distribution for 'amplitude' or 'frequency', rappture2web runs
this script multiple times at PUQ collocation points and then
fits a response surface.
"""
import sys
import numpy as np
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

# Read inputs
amplitude = float(rx['input.(amplitude).current'].value)
freq_str = rx['input.(frequency).current'].value
frequency = float(Rappture.Units.convert(freq_str, units='off'))
npts = int(rx['input.(points).current'].value)

# Compute
x = np.linspace(0, 10, npts)
y = amplitude * np.cos(2 * np.pi * frequency * x)
peak = float(np.max(np.abs(y)))

# Write outputs
wave = rx['output.curve(wave)']
wave['about.label'] = 'Output Wave'
wave['xaxis.label'] = 'Time'
wave['xaxis.units'] = 's'
wave['yaxis.label'] = 'Amplitude'
wave['component.xy'] = (x, y)

rx['output.number(peak).about.label'] = 'Peak Value'
rx['output.number(peak).current'] = str(peak)

rx.close()
