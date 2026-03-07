#!/usr/bin/env python
"""
This script takes some uq parameters from the command line
and starts up a PUQ session using them.  The RapptureHost()
class will not actually execute any jobs.  Job parameters
are instead saved to a CSV file named params[pid].csv.
PUQ status is saved into an hdf5 file, as usual.
"""

from __future__ import print_function
import sys
import os
from puq import NormalParameter, UniformParameter, Sweep, RapptureHost, Smolyak
import numpy as np
from puq.jpickle import unpickle

# Redirect stdout and stderr to files for debugging.
sys.stdout = open("uq_debug.out", 'w')
sys.stderr = open("uq_debug.err", 'w')

print(sys.argv)
pid, varlist, uq_type, args = sys.argv[1:]

dfile = "driver%s.xml" % pid
cvsname = "params%s.csv" % pid
hname = "puq_%s.hdf5" % pid

varlist = unpickle(varlist)
print("varlist=", varlist)

v = {}
units = {}
for p in varlist:
    name, _units, dist = p
    name = str(name)
    units[name] = str(_units)
    if dist[0] == u'gaussian':
        try:
            kwargs = dist[3]
        except:
            kwargs = {}
        v[name] = NormalParameter(name, name, mean=dist[1], dev=dist[2], **kwargs)
        print(v[name])
    elif dist[0] == u'uniform':
        v[name] = UniformParameter(name, name, min=dist[1], max=dist[2])
    else:
        print("ERROR: Unknown distribution type: %s" % dist[0])
        sys.exit(1)
if uq_type == "smolyak":
    uq = Smolyak(v.values(), args)
else:
    print("ERROR: Unknown UQ type: %s" % uq_type)
    os.chdir('..')
    sys.exit(1)

# save parameter values to CSV file
with open(cvsname, 'w') as f:
    print(','.join(['@@'+str(p.name) for p in uq.params]), file=f)
    for i in range(len(uq.params[0].values)):
        print(','.join(['%.16g%s' % (p.values[i], units[p.name]) for p in uq.params]), file=f)

# This just saves PUQ state into HDF5 file, so later we can have PUQ analyze
# the results and it knows about the input parameters, UQ method, etc.
host = RapptureHost('puq', dfile)
sw = Sweep(uq, host, None)
host.psweep = sw.psweep
sw.run(hname, overwrite=True)

print("Finished with get_params.py\n")
