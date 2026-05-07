"""rappture2web port of the 'number2' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

outstr = ''
for num in range(1, 4):
    val = rx['input.(input%d).current' % num].value
    outstr += 'input%d = %s\n' % (num, val)
rx['output.string(out).current'] = outstr

rx.close()
