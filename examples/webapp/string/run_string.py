"""rappture2web port of the 'string' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

title = rx['input.(title).current'].value
indeck = rx['input.(indeck).current'].value

rx['output.string(outt).about.label'] = 'Echo of title'
rx['output.string(outt).current'] = title
rx['output.string(outi).about.label'] = 'Echo of input'
rx['output.string(outi).current'] = indeck

rx.close()
