"""rappture2web port of the 'choice' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

stats = rx['input.choice(stats).current'].value
rx['output.string(out).about.label'] = 'Selected carrier statistics'
rx['output.string(out).current'] = 'Carrier Statistics: %s' % stats

rx.close()
