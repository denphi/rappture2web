"""rappture2web port of the 'integer' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

n = rx['input.(points).current'].value
rx['output.integer(outn).about.label'] = 'Echo of points'
rx['output.integer(outn).current'] = n

rx.close()
