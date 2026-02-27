"""rappture2web port of the 'periodicelement' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

e1 = rx['input.periodicelement(first).current'].value
e2 = rx['input.periodicelement(second).current'].value
e3 = rx['input.periodicelement(third).current'].value

rx['output.string(out).about.label'] = 'Selected elements'
rx['output.string(out).current'] = (
    'First element: %s\nSecond element: %s\nThird element: %s' % (e1, e2, e3)
)

rx.close()
