"""rappture2web port of the 'number' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

temp = rx['input.(temperature).current'].value
vsweep = rx['input.(vsweep).current'].value

rx['output.number(temperature).about.label'] = 'Ambient temperature'
rx['output.number(temperature).units'] = 'K'
rx['output.number(temperature).current'] = temp

rx['output.number(vsweep).about.label'] = 'Voltage Sweep'
rx['output.number(vsweep).units'] = 'V'
rx['output.number(vsweep).current'] = vsweep

rx.close()
