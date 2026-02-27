"""rappture2web port of the 'boolean' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

for eid, out_eid in [('iimodel', 'outb'), ('iimodel1', 'outb1'),
                     ('iimodel2', 'outb2'), ('iimodel3', 'outb3')]:
    val = rx['input.(%s).current' % eid].value
    rx['output.boolean(%s).about.label' % out_eid] = 'Echo of boolean value %s' % eid
    rx['output.boolean(%s).current' % out_eid] = val

rx.close()
