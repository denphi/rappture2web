"""rappture2web port of the 'group' zoo example."""
import sys
import rappture2web.rp_library as Rappture

rx = Rappture.PyXml(sys.argv[1])

re = rx['input.group.(models).(recomb).current'].value
tn = rx['input.group.(models).(tau).(taun).current'].value
tp = rx['input.group.(models).(tau).(taup).current'].value
temp = rx['input.group.(ambient).(temp).current'].value
lat = rx['input.group.(ambient).(loc).(lat).current'].value
lon = rx['input.group.(ambient).(loc).(long).current'].value

rx['output.log'] = """Models:
  Recombination: %s
  taun = %s
  taup = %s

Ambient:
  tempK = %s
  lat, long = (%s, %s)
""" % (re, tn, tp, temp, lat, lon)

rx.close()
