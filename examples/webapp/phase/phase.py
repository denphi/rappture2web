"""rappture2web port of the 'phase' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

s1 = rx['input.phase(one).(first).current'].value
s2 = rx['input.phase(two).(second).current'].value

rx['output.log'] = 'first = %s\nsecond= %s' % (s1, s2)

rx.close()
