#!/usr/bin/env python
"""
Inject run XML results into a PUQ HDF5 file.

Usage:
    python inject_results.py <puq_hdf5> <run0.xml> [<run1.xml> ...]

This script is called by rappture2web after running all collocation-point
simulations.  It loads each run.xml, extracts the output values, and writes
them into the HDF5 file so that analyze.py can fit the response surfaces.
"""
from __future__ import print_function
import sys
import os
import h5py
import puq
from puq.jpickle import unpickle

# Redirect stdout/stderr for debugging
sys.stdout = open('inject.out', 'w')
sys.stderr = open('inject.err', 'w')

print('inject_results.py', sys.argv)

hdf5_path = sys.argv[1]
run_xmls  = sys.argv[2:]

# Load the PUQ sweep from the HDF5 file
h5 = h5py.File(hdf5_path, 'r+')
sw = unpickle(h5['private/sweep'].value)
h5.close()

sw.fname = os.path.splitext(hdf5_path)[0]
sw.psweep._sweep = sw
if hasattr(sw.psweep, 'reinit'):
    sw.psweep.reinit()

print('Loaded sweep:', sw)
print('psweep:', sw.psweep)

# Inject each run XML as a result
for i, xml_path in enumerate(run_xmls):
    if not os.path.exists(xml_path):
        print('WARNING: run XML not found:', xml_path)
        continue
    print('Injecting run %d: %s' % (i, xml_path))
    try:
        sw.psweep.add_result(i, xml_path)
    except Exception as e:
        print('ERROR injecting run %d: %s' % (i, e))

print('inject_results.py finished')
