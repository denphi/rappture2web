"""rappture2web port of the 'note' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

diameter = rx['input.number(diameter).current'].value
rx['output.string(out).about.label'] = 'Particle diameter'
rx['output.string(out).current'] = 'Particle diameter: %s' % diameter

rx.close()
