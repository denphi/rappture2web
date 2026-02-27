"""rappture2web port of the 'integer2' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

n = []
for i in range(1, 4):
    n.append(rx['input.(input%d).current' % i].value)

outstr = ''
for i in range(1, 4):
    outstr += 'input%d = %s\n' % (i, n[i - 1])

rx['output.string(out).current'] = outstr

rx.close()
