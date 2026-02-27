"""rappture2web port of the 'curve' zoo example."""
import sys
import numpy as np
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

npts = int(rx['input.(points).current'].value)
deg2rad = 0.017453292519943295

# ── Single curve ──────────────────────────────────────────────────────────────
xmin, xmax = 0.01, 10.0
x = np.linspace(xmin, xmax, npts)
y = np.cos(x) / (1 + x)

single = rx['output.curve(single)']
single['about.label'] = 'Single Curve'
single['about.description'] = 'This is an example of a single curve.'
single['xaxis.label'] = 'Time'
single['xaxis.units'] = 's'
single['yaxis.label'] = 'Voltage v(11)'
single['yaxis.units'] = 'V'
single['component.xy'] = (x, y)

# ── Axis-limited curve (same data, restricted viewport) ───────────────────────
xminl = xmin + (xmax - xmin) / 4.0
xmaxl = xmax - (xmax - xmin) / 4.0
yminl = np.cos(xminl) / (1 + xminl)
ymaxl = np.cos(xmaxl) / (1 + xmaxl)

limited = rx['output.curve(limited)']
limited['about.label'] = 'Axis limits curve'
limited['about.description'] = 'Single curve with x and y axis limits applied.'
limited['xaxis.label'] = 'Time'
limited['xaxis.units'] = 's'
limited['xaxis.min'] = xminl
limited['xaxis.max'] = xmaxl
limited['yaxis.label'] = 'Voltage v(11)'
limited['yaxis.units'] = 'V'
limited['yaxis.min'] = yminl
limited['yaxis.max'] = ymaxl
limited['component.xy'] = (x, y)

# ── Multiple curves on the same plot (grouped, log Y) ────────────────────────
for factor in [1, 2]:
    curve = rx['output.curve(multi%s)' % factor]
    curve['about.group'] = 'Multiple curve'
    curve['about.label'] = 'Factor a=%s' % factor
    curve['xaxis.label'] = 'Frequency'
    curve['xaxis.units'] = 'Hz'
    curve['yaxis.label'] = 'Current'
    curve['yaxis.units'] = 'uA'
    curve['yaxis.log'] = 'log'
    y2 = np.power(2.0, factor * x) / x
    curve['component.xy'] = (x, y2)

# ── Scatter curve ─────────────────────────────────────────────────────────────
scatter = rx['output.curve(scatter)']
scatter['about.label'] = 'Scatter curve'
scatter['about.type'] = 'scatter'
scatter['xaxis.label'] = 'Time'
scatter['xaxis.units'] = 's'
scatter['yaxis.label'] = 'Voltage v(11)'
scatter['yaxis.units'] = 'V'
scatter['component.xy'] = (x, np.cos(x) / (1 + x))

# ── Bar chart ─────────────────────────────────────────────────────────────────
x_bar = np.arange(0, npts)
bars = rx['output.curve(bars)']
bars['about.label'] = 'Bar chart'
bars['about.type'] = 'bar'
bars['xaxis.label'] = 'Time'
bars['xaxis.units'] = 's'
bars['yaxis.label'] = 'Voltage v(11)'
bars['yaxis.units'] = 'V'
bars['component.xy'] = (x_bar, np.sin(x_bar) / (1 + x_bar))

# ── Mixed element types on the same plot (grouped) ───────────────────────────
x_deg = np.arange(0, 361, 30)

line = rx['output.curve(line)']
line['about.group'] = 'Mixed element types'
line['about.label'] = 'Sine'
line['about.type'] = 'line'
line['xaxis.label'] = 'Degrees'
line['component.xy'] = (x_deg, np.sin(x_deg * deg2rad))

bar = rx['output.curve(bar)']
bar['about.group'] = 'Mixed element types'
bar['about.label'] = 'Cosine'
bar['about.type'] = 'bar'
bar['xaxis.label'] = 'Degrees'
bar['component.xy'] = (x_deg, np.cos(x_deg * deg2rad))

x_pt = np.arange(0, 361, 10)
point = rx['output.curve(point)']
point['about.group'] = 'Mixed element types'
point['about.label'] = 'Random'
point['about.type'] = 'scatter'
point['xaxis.label'] = 'Degrees'
point['component.xy'] = (x_pt, np.random.rand(len(x_pt)) * 2.0 - 1)

rx.close()
