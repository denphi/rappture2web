"""rappture2web port of the 'histogram' zoo example."""
import sys
import numpy as np
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

num_points = int(rx['input.(points).current'].value)
x = np.linspace(1, 10, num_points)

# single histogram
hist = rx['output.histogram(single)']
hist['about.label'] = 'Single histogram'
hist['xaxis.label'] = 'Time'
hist['xaxis.units'] = 's'
hist['yaxis.label'] = 'Voltage v(11)'
hist['yaxis.units'] = 'V'
hist['component.xy'] = (x, np.cos(x) / (1 + x))

# multiple histograms
for factor in [1, 2]:
    hist = rx['output.histogram(multi%s)' % factor]
    hist['about.group'] = 'Multiple histogram'
    hist['about.label'] = 'Factor a=%s' % factor
    hist['xaxis.label'] = 'Frequency'
    hist['xaxis.units'] = 'Hz'
    hist['yaxis.label'] = 'Current'
    hist['yaxis.units'] = 'uA'
    hist['component.xy'] = (x, np.power(2.0, factor * x) / x)

rx.close()
