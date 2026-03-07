#!/usr/bin/env python
"""
Once submit has finished with the jobs, this function is called to have PUQ
process the results.
"""
from __future__ import print_function
import sys
import os
import numpy as np
import h5py
import re
import puq
from puq.jpickle import unpickle
import Rappture
import StringIO
from scipy.spatial import ConvexHull
# geometry library
from shapely.geometry import Polygon
from shapely.ops import unary_union

# Redirect stdout and stderr to files for debugging.
# Append to the files created in get_params.py
sys.stdout = open("uq_debug.out", 'a')
sys.stderr = open("uq_debug.err", 'a')


# Restore the state of a PUQ session from a HDF5 file.
def load_from_hdf5(name):
    h5 = h5py.File(name, 'r+')
    sw = unpickle(h5['private/sweep'].value)
    sw.fname = os.path.splitext(name)[0]
    h5.close()

    sw.psweep._sweep = sw

    if hasattr(sw.psweep, 'reinit'):
        sw.psweep.reinit()
    return sw


# Plots probability curves
def plot_pdf_curve(io, h5, xvals, vname, percent):
    print('plot_pdf_curve %s %s' % (vname, percent))
    # compute upper and lower percentiles
    pm = (100 - percent)/200.0
    pp = 1 - pm

    label = None

    # collect data into an array
    xarr = np.empty(len(xvals[vname]))
    yp = np.empty(len(xvals[vname]))
    ym = np.empty(len(xvals[vname]))

    for vindex in sorted(xvals[vname].keys()):
        if label is None:
            label = h5['/output/data/%s[%d]' % (vname, vindex)].attrs['label']
        xarr[vindex] = xvals[vname][vindex]
        yp[vindex] = pcurves[vname][vindex].ppf(pp)
        ym[vindex] = pcurves[vname][vindex].ppf(pm)

    curve = io['output.curve(curve_pdf-%s-%s)' % (vname, percent)]
    if percent == 0:
        curve['about.label'] = "mean"
    else:
        curve['about.label'] = "middle %s%%" % percent
    curve['about.group'] = label
    curve['about.uqtype'] = 'Probability'

    pts = ""
    for x, y in zip(xarr, yp):
        pts += "%s %s " % (x, y)
    if percent == 0:
        pts += '\n'
    else:
        for x, y in reversed(zip(xarr, ym)):
            pts += "%s %s " % (x, y)
        pts += "%s %s\n" % (xarr[0], yp[0])

    curve['component.xy'] = pts


def add_pts(f1, percent):
    # compute upper and lower percentiles
    pm = (100 - percent) / 200.0
    pp = 1 - pm
    prob = np.linspace(pm, pp, 31)
    x, y = f1.eval(prob)
    return np.array(zip(x, y))


def plot_pdf_acurve(io, h5, acurves, vname, percent):
    """
    This function plots the probability curves for parametric
    PDFs.
    """
    print('plot_pdf_acurve %s %s' % (vname, percent))

    label = None
    prev_pts = None  # last set of points

    poly = []
    for vindex in sorted(acurves[vname].keys()):
        if label is None:
            label = h5['/output/data/%s[%d]' % (vname, vindex)].attrs['label']
        f1 = unpickle(h5['/output/data/%s[%d]' % (vname, vindex)].attrs['curve'])
        bpts = add_pts(f1, percent)

        # first data set? Just remember it.
        if prev_pts is None:
            prev_pts = bpts
            continue

        pts = np.array((prev_pts, bpts)).ravel().reshape(-1, 2)
        hull = ConvexHull(pts, qhull_options='Pp')
        p1 = Polygon([hull.points[v] for v in hull.vertices])
        poly.append(p1)
        prev_pts = bpts

    u = unary_union(poly)

    curve = io['output.curve(curve_pdf-%s-%s)' % (vname, percent)]
    if percent == 0:
        curve['about.label'] = "mean"
    else:
        curve['about.label'] = "middle %s%%" % percent
    curve['about.group'] = label
    curve['about.uqtype'] = 'Probability'
    curve['component.xy'] = np.array(u.exterior.xy)


def plot_pdf(io, v, pdf, desc):
    print("plot_pdf %s desc=%s" % (v, desc))
    p = io['output.curve(pdf-%s)' % v]
    p['about.label'] = desc
    p['about.uqtype'] = "PDF"
    p['yaxis.label'] = 'Probability'

    pts = "%s 0\n" % pdf.x[0]
    for x, y in zip(pdf.x, pdf.y):
        pts += "%s %s\n" % (x, y)
    pts += "%s 0\n" % pdf.x[-1]
    p['component.xy'] = pts


def write_responses(io, h5):
    uqtype = h5.attrs['UQtype']
    for v in h5[uqtype]:
        print("write_responses", v)
        if '[' in v:
            # It is a curve. Ignore.
            continue
        try:
            desc = h5['%s/%s' % (uqtype, v)].attrs['description']
        except:
            desc = ''
        try:
            label = h5['%s/%s' % (uqtype, v)].attrs['label']
        except:
            label = ''

        rsp = h5['/%s/%s/response' % (uqtype, v)].value
        rout = io['output.response(%s)' % v]
        rout['value'] = rsp
        rout['about.description'] = desc
        rout['about.label'] = label
        rout['about.uqtype'] = 'Response'

        rs = unpickle(rsp)
        rout['variables'] = ' '.join([str(p.name) for p in rs.params])
        labels = ' '.join([repr(str(p.label)) for p in rs.params])
        rout['labels'] = labels.replace("'", '"')

        if type(rs) == puq.response.ResponseFunc:
            rout['equation'] = rs.eqn
            rout['rmse'] = "{:6.3g}".format(rs.rmse()[1])

        rout['data'] = rs.data


def write_params(h5, out):
    params = map(str, h5['/input/params'].keys())
    print('#' * 80, file=out)
    print('INPUT PARAMETERS', file=out)

    for pname in params:
        print('-' * 80, file=out)
        p = puq.unpickle(h5['/input/params/' + pname].value)
        cname = p.__class__.__name__[:-9]
        pdf_str = '%s [%s - %s] mean=%s dev=%s mode=%s' % (cname, p.pdf.range[0], p.pdf.range[1], p.pdf.mean, p.pdf.dev, p.pdf.mode)

        print("Name:", p.name, file=out)
        try:
            print("Label:", p.label, file=out)
        except:
            pass
        print("Desc:", p.description, file=out)
        print('Value:', pdf_str, file=out)
    print('#' * 80, file=out)
    print(file=out)


def write_summary(io, h5):
    outstr = StringIO.StringIO()
    write_params(h5, outstr)
    uqtype = h5.attrs['UQtype']
    for v in h5[uqtype]:
        if '[' in v:
            # It is a curve. Ignore.
            continue
        desc = h5['%s/%s' % (uqtype, v)].attrs['description']
        print("QoI: %s (%s)" % (v, desc), file=outstr)
        rs = unpickle(h5['/%s/%s/response' % (uqtype, v)].value)
        if type(rs) == puq.response.ResponseFunc:
            print("\nv=%s\n" % rs.eqn, file=outstr)
            print("SURROGATE MODEL ERROR:{:6.3g}%".format(rs.rmse()[1]), file=outstr)
        sens = puq.unpickle(h5['/%s/%s/sensitivity' % (uqtype, v)].value)
        max_name_len = max(map(len, [p[0] for p in sens]))
        print("\nSENSITIVITY:", file=outstr)
        print("Var%s     u*          dev" % (' '*(max_name_len)), file=outstr)
        print('-'*(28+max_name_len), file=outstr)
        for item in sens:
            pad = ' '*(max_name_len - len(item[0]))
            print("{}{}  {:10.4g}  {:10.4g}".format(pad, item[0],
                item[1]['ustar'], item[1]['std']), file=outstr)
        print('-'*(28+max_name_len), file=outstr)
        print(file=outstr)
    iostr = io['output.string(UQ Summary)']
    iostr['about.label'] = 'UQ Summary'
    iostr['current'] = outstr.getvalue()
    outstr.close()


def write_sensitivity(io, h5):
    # If more than one variable, display sensitivity.
    # Curves have indexed variables, so skip them.
    if len(h5['/input/params']) > 1 and ['[' in x for x in h5[uqtype]].count(False):
        for v in h5[uqtype]:
            if '[' in v:
                # curve. skip it.
                continue
            desc = h5['/output/data/%s' % v].attrs['label']
            sens = unpickle(h5['/%s/%s/sensitivity' % (uqtype, v)].value)

            hist = io['output.histogram(sens-%s)' % v]
            hist['about.label'] = desc
            hist['about.uqtype'] = 'Sensitivity'
            hist['about.type'] = 'scatter'
            hist['xaxis.label'] = 'Parameters'
            hist['yaxis.label'] = 'Sensitivity'
            pts = ''
            for name in sens:
                n = name[0]
                try:
                    n = h5['/input/params/%s' % n].attrs['label']
                except:
                    pass
                pts += "\"%s\" %s\n" % (n, name[1]['ustar'])
            hist['component.xy'] = pts

sw = load_from_hdf5(sys.argv[1])
sw.analyze()

h5 = h5py.File(sys.argv[1], 'r+')
io = Rappture.PyXml('run_uq.xml')

# curves built from pdfs
pcurves = {}
xvals = {}
acurves = {}

reg1 = re.compile('([ \da-zA-Z_]+)\[([ \d]+)\]')

uqtype = h5.attrs['UQtype']
for v in h5[uqtype]:
    print('v=', v)
    rsp = h5['/%s/%s/response' % (uqtype, v)].value
    rs = unpickle(rsp)
    pdf = rs.pdf(fit=False)
    odata = h5['/output/data/%s' % v]

    # For curves built from pdfs, just put them in a dict for now
    if 'x' in odata.attrs:
        matches = reg1.findall(v)
        vname, vindex = matches[0]
        print('CURVE: vname=%s   vindex=%s' % (vname, vindex))
        vindex = int(vindex)
        if vname not in pcurves:
            pcurves[vname] = {}
            xvals[vname] = {}
        xvals[vname][vindex] = odata.attrs['x']
        pcurves[vname][vindex] = pdf
    elif 'curve' in odata.attrs:
        matches = reg1.findall(v)
        vname, vindex = matches[0]
        print('ACURVE: %s - %s' % (vname, vindex))
        if vname not in acurves:
            acurves[vname] = {}
        acurves[vname][int(vindex)] = pdf
    else:
        desc = h5['/output/data/%s' % v].attrs['label']
        plot_pdf(io, v, pdf, desc)

# now do probability curves
for vname in xvals:
    plot_pdf_curve(io, h5, xvals, vname, 95)
    plot_pdf_curve(io, h5, xvals, vname, 50)

for vname in acurves:
    try:
        plot_pdf_acurve(io, h5, acurves, vname, 95)
    except:
        pass
    try:
        plot_pdf_acurve(io, h5, acurves, vname, 50)
    except:
        pass

write_sensitivity(io, h5)
write_responses(io, h5)
write_summary(io, h5)

io.close()
h5.close()
