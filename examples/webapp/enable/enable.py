"""rappture2web port of the 'enable' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

model = rx['input.(model).current'].value

if model == 'dd':
    result = 'Drift-Diffusion:\n'
    recomb = rx['input.(dd).(recomb).current'].value
    result += '  Recombination model: %s\n' % recomb
    if recomb:
        taun = rx['input.(dd).(taun).current'].value
        taup = rx['input.(dd).(taup).current'].value
        result += '  TauN: %s\n' % taun
        result += '  TauP: %s\n' % taup
elif model == 'bte':
    result = 'Boltzmann Transport Equation:\n'
    temp = rx['input.(bte).(temp).current'].value
    result += '  Temperature: %s\n' % temp
    secret = rx['input.(bte).(secret).current'].value
    result += '  Hidden number: %s\n' % secret
elif model == 'negf':
    result = 'NEGF Analysis:\n'
    tbe = rx['input.(negf).(tbe).current'].value
    result += '  Tight-binding energy: %s\n' % tbe
    tau = rx['input.(negf).(tau).current'].value
    result += '  High-energy lifetime: %s\n' % tau
else:
    result = 'Unknown model: %s\n' % model

rx['output.log'] = result

rx.close()
