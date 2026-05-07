"""rappture2web port of the 'multichoice' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

choice = rx['input.multichoice(countries).current'].value
rx['output.string(outs).about.label'] = 'Echo of multichoice'
rx['output.string(outs).current'] = 'Selected countries: %s' % choice

rx.close()
