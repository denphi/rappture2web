"""rappture2web port of the 'table' zoo example (particle in a box energy levels)."""
import sys
import random
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

L_str = rx['input.number(L).current'].value
emass_str = rx['input.number(emass).current'].value

# Strip units and convert
import re
def strip_units(s):
    m = re.match(r'^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)', str(s).strip())
    return float(m.group(1)) if m else 0.0

L = strip_units(L_str) * 1e-9   # nm → m
emass = strip_units(emass_str)
m_kg = emass * 9.11e-31          # kg

h = 4.13566743e-15   # eV·s
J2eV = 6.241506363e17

nhomo = random.randint(1, 20)

rows = []
for n in range(1, 21):
    E = n * n * h * h / (8.0 * m_kg * L * L * J2eV)
    label = 'HOMO' if n == nhomo else str(n)
    rows.append('%s %.3g' % (label, E))

rx['output.table.about.label'] = 'Energy Levels'
rx['output.table.column(labels).label'] = 'Name'
rx['output.table.column(energies).label'] = 'Energy'
rx['output.table.column(energies).units'] = 'eV'
rx['output.table.data'] = '\n'.join(rows) + '\n'

rx.close()
