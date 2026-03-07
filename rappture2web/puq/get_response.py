#!/usr/bin/env python
"""
Sample a response function (surrogate model).  Because so much of
the Rappture internals expect objects to have an associated xml
object and path, we will return the plot in an xml file.
"""

from __future__ import print_function
import sys
import numpy as np
import puq
from puq.jpickle import unpickle
import xml.etree.ElementTree as xml


from itertools import product
# Redirect stdout and stderr to files for debugging.
# Append to the files created in get_params.py
sys.stdout = open("response.out", 'w')
sys.stderr = open("response.err", 'w')


# variable names to labels
def subs_names(varl, h5):
    varlist = []
    for v in varl:
        try:
            lab = h5['/input/params/%s' % v[0]].attrs['label']
        except:
            lab = str(v[0])
        varlist.append(lab)
    return varlist


def plot_resp1(dout, resp, name, rlabel):
    print('plot_resp1', name, rlabel)

    numpoints = 100

    resp = unpickle(resp)
    var = None

    for index, p in enumerate(resp.params):
        if p.name == name:
            var = p
            break

    if var is None:
        print("plot_resp1 error: name %s not recognized" % name)
        return

    data = resp.data
    print('data=', repr(data))
    for ind, p in enumerate(resp.params):
        if ind == index:
            continue
        m = p.pdf.mean
        means = np.isclose(m, data[:, ind], rtol=1e-6, atol=1e-12)
        data = data[means]

    print("vars=", resp.vars)
    print("data=", repr(data))

    curve = xml.SubElement(dout, 'curve', {'id': 'response'})
    about = xml.SubElement(curve, 'about')
    xml.SubElement(about, 'label').text = rlabel
    xml.SubElement(about, 'group').text = rlabel

    xaxis = xml.SubElement(curve, 'xaxis')
    xml.SubElement(xaxis, 'label').text = var.label

    yaxis = xml.SubElement(curve, 'yaxis')
    xml.SubElement(yaxis, 'label').text = rlabel

    x = np.linspace(*var.pdf.range, num=numpoints)

    allpts = np.empty((numpoints, len(resp.params)))
    for i, v in enumerate(resp.params):
        if v.name == var.name:
            allpts[:, i] = x
        else:
            allpts[:, i] = np.mean(v.pdf.mean)

    pts = resp.evala(allpts)
    xy = '\n'.join([' '.join(map(repr, a)) for a in zip(x, pts)])
    comp = xml.SubElement(curve, 'component')
    xml.SubElement(comp, 'xy').text = xy

    # scatter plot sampled data on response surface
    curve = xml.SubElement(dout, 'curve', {'id': 'scatter'})
    about = xml.SubElement(curve, 'about')
    xml.SubElement(about, 'label').text = 'Data Points'
    xml.SubElement(about, 'group').text = rlabel
    xml.SubElement(about, 'type').text = 'scatter'
    comp = xml.SubElement(curve, 'component')
    xy = '\n'.join([' '.join(map(repr, a)) for a in zip(data[:, index], data[:, -1])])
    xml.SubElement(comp, 'xy').text = xy


def plot_resp2(dout, resp, name1, name2, rlabel):
    print("plot_resp2", name1, name2, rlabel)
    numpoints = 50

    resp = unpickle(resp)
    for p in resp.params:
        if p.name == name1:
            v1 = p
        elif p.name == name2:
            v2 = p

    x = np.linspace(*v1.pdf.range, num=numpoints)
    y = np.linspace(*v2.pdf.range, num=numpoints)
    pts = np.array([(b, a) for a, b in product(y, x)])
    allpts = np.empty((numpoints**2, len(resp.vars)))
    for i, v in enumerate(resp.vars):
        if v[0] == v1.name:
            allpts[:, i] = pts[:, 0]
        elif v[0] == v2.name:
            allpts[:, i] = pts[:, 1]
        else:
            allpts[:, i] = np.mean(v[1])
    pts = np.array(resp.evala(allpts))
    print('plot_resp2 returns array of', pts.shape)

    # mesh
    mesh = xml.SubElement(dout, 'mesh', {'id': 'm2d'})
    about = xml.SubElement(mesh, 'about')
    label = xml.SubElement(about, 'label')
    label.text = '2D Mesh'
    xml.SubElement(mesh, 'dim').text = '2'
    xml.SubElement(mesh, 'hide').text = 'yes'
    grid = xml.SubElement(mesh, 'grid')
    xaxis = xml.SubElement(grid, 'xaxis')
    xml.SubElement(xaxis, 'numpoints').text = str(numpoints)
    xml.SubElement(xaxis, 'min').text = str(v1.pdf.range[0])
    xml.SubElement(xaxis, 'max').text = str(v1.pdf.range[1])
    yaxis = xml.SubElement(grid, 'yaxis')
    xml.SubElement(yaxis, 'numpoints').text = str(numpoints)
    xml.SubElement(yaxis, 'min').text = str(v2.pdf.range[0])
    xml.SubElement(yaxis, 'max').text = str(v2.pdf.range[1])

    # field
    field = xml.SubElement(dout, 'field', {'id': 'f2d'})
    about = xml.SubElement(field, 'about')
    xml.SubElement(xml.SubElement(about, 'xaxis'), 'label').text = v1.label
    xml.SubElement(xml.SubElement(about, 'yaxis'), 'label').text = v2.label

    xml.SubElement(about, 'label').text = rlabel
    comp = xml.SubElement(field, 'component')
    xml.SubElement(comp, 'mesh').text = 'output.mesh(m2d)'
    xml.SubElement(about, 'view').text = 'heightmap'
    pts = ' '.join(map(str, pts.ravel('F').tolist()))
    xml.SubElement(comp, 'values').text = pts


if __name__ == "__main__":
    print("get_response %s" % sys.argv[3:])

    if len(sys.argv[1:]) == 5:
        fname, resp, var1, var2, label = sys.argv[1:]

        droot = xml.Element('run')
        dtree = xml.ElementTree(droot)
        dout = xml.SubElement(droot, 'output')

        if var1 == var2:
            plot_resp1(dout, resp, var1, label)
        else:
            plot_resp2(dout, resp, var1, var2, label)

        with open(fname, 'w') as f:
            f.write("<?xml version=\"1.0\"?>\n")
            dtree.write(f)
    else:
        print('ERROR: Expected 5 args. Got', sys.argv)
