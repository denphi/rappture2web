"""rappture2web port of the 'field' zoo example."""
import sys
import numpy as np
import rappture2web.rp_library as Rappture

try:
    import sympy
    from sympy.abc import _clash
    from sympy.utilities.lambdify import lambdify
    _HAS_SYMPY = True
except ImportError:
    _HAS_SYMPY = False

rx = Rappture.PyXml(sys.argv[1])

formula_str = rx['input.string(formula).current'].value

if _HAS_SYMPY:
    try:
        formula_sym = sympy.sympify(formula_str, _clash)
        formula = lambdify(sorted(formula_sym.free_symbols, key=str), formula_sym,
                           modules=['numpy', 'mpmath', 'sympy'])
    except Exception:
        formula = lambda x, y, z=None: x * y
else:
    # Fallback: eval-based (safe only for demo inputs)
    def formula(x, y, z=None):
        try:
            return eval(formula_str, {'x': x, 'y': y, 'z': z or 0,
                                      'np': np, '__builtins__': {}})
        except Exception:
            return x * y

xmin, xmax = 0, 4
ymin, ymax = 0, 4
num_steps = 5

# 2D mesh + field
m2d = rx['output.mesh(m2d)']
m2d['about.label'] = '2D Mesh'
m2d['dim'] = 2
m2d['units'] = 'um'
m2d['hide'] = 'yes'
m2d['grid.xaxis.min'] = xmin
m2d['grid.xaxis.max'] = xmax
m2d['grid.xaxis.numpoints'] = num_steps
m2d['grid.yaxis.min'] = ymin
m2d['grid.yaxis.max'] = ymax
m2d['grid.yaxis.numpoints'] = num_steps

f2d = rx['output.field(f2d)']
f2d['about.label'] = '2D Field'
f2d['component.mesh'] = 'output.mesh(m2d)'

x = np.linspace(xmin, xmax, num_steps)
y = np.linspace(ymin, ymax, num_steps)
xx, yy = np.meshgrid(x, y, indexing='ij')
pts = formula(xx, yy, 1)
f2d['component.values'] = pts

vizmethod = rx['input.choice(3D).current'].value

if vizmethod == 'grid':
    m3d = rx['output.mesh(m3d)']
    m3d['about.label'] = '3D Uniform Mesh'
    m3d['dim'] = 3
    m3d['units'] = 'um'
    m3d['hide'] = 'yes'
    m3d['grid.xaxis.min'] = xmin
    m3d['grid.xaxis.max'] = xmax
    m3d['grid.xaxis.numpoints'] = 5
    m3d['grid.yaxis.min'] = ymin
    m3d['grid.yaxis.max'] = ymax
    m3d['grid.yaxis.numpoints'] = 5
    m3d['grid.zaxis.min'] = 0.0
    m3d['grid.zaxis.max'] = 1.0
    m3d['grid.zaxis.numpoints'] = 2

    f3d = rx['output.field(f3d)']
    f3d['about.label'] = '3D Field'
    f3d['component.mesh'] = 'output.mesh(m3d)'
    xx3, yy3, zz3 = np.mgrid[xmin:xmax:5j, ymin:ymax:5j, 0:1:2j]
    f3d['component.values'] = formula(xx3, yy3, zz3)

elif vizmethod == 'unstructured':
    # Build an unstructured 3D tetrahedral mesh
    n = 5
    x1 = np.linspace(xmin, xmax, n)
    y1 = np.linspace(ymin, ymax, n)
    z1 = np.linspace(0.0, 1.0, n)
    gx, gy, gz = np.meshgrid(x1, y1, z1, indexing='ij')
    pts = np.column_stack([gx.ravel(), gy.ravel(), gz.ravel()])
    vals = formula(pts[:, 0], pts[:, 1], pts[:, 2])

    m3d = rx['output.mesh(m3d)']
    m3d['about.label'] = '3D Unstructured Mesh'
    m3d['dim'] = 3
    m3d['units'] = 'um'
    m3d['hide'] = 'yes'
    points_str = '\n'.join(f'{p[0]} {p[1]} {p[2]}' for p in pts)
    m3d['unstructured.points'] = points_str

    f3d = rx['output.field(f3d)']
    f3d['about.label'] = '3D Field'
    f3d['component.mesh'] = 'output.mesh(m3d)'
    f3d['component.values'] = vals

rx.close()
