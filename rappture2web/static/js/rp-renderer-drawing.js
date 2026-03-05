/**
 * Rappture drawing renderer.
 * Supports <drawing> outputs with molecule/polydata/glyphs components.
 */
(function () {
    function whenVisible(el, fn) {
        if (typeof _whenVisible === 'function') return _whenVisible(el, fn);
        if (typeof rappture !== 'undefined' && typeof rappture._whenVisible === 'function') return rappture._whenVisible(el, fn);
        requestAnimationFrame(fn);
    }

    const ELEMENT_COLORS = {
        1: 0xffffff, 2: 0xd9ffff, 6: 0x909090, 7: 0x3050f8, 8: 0xff0d0d,
        9: 0x90e050, 14: 0xf0c8a0, 15: 0xff8000, 16: 0xffff30, 17: 0x1ff01f,
        30: 0x66ccff, // Zn -> light blue
        31: 0xc28f8f, 32: 0x668f8f, 33: 0xbd80e3, 34: 0xffa100,
        54: 0x2060ff, // Xe -> blue
        70: 0x22cc66, // Yb -> green
    };

    const SYMBOL_Z = {
        H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
        Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18,
        K: 19, Ca: 20, Sc: 21, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26, Co: 27,
        Ni: 28, Cu: 29, Zn: 30, Ga: 31, Ge: 32, As: 33, Se: 34, Br: 35, Kr: 36,
        Rb: 37, Sr: 38, Y: 39, Zr: 40, Nb: 41, Mo: 42, Tc: 43, Ru: 44, Rh: 45,
        Pd: 46, Ag: 47, Cd: 48, In: 49, Sn: 50, Sb: 51, Te: 52, I: 53, Xe: 54,
        Cs: 55, Ba: 56, La: 57, Hf: 72, Ta: 73, W: 74, Re: 75, Os: 76, Ir: 77,
        Pt: 78, Au: 79, Hg: 80, Tl: 81, Pb: 82, Bi: 83,
        Yb: 70,
    };

    const RADII = {
        atomic: { 1: 0.53, 2: 0.31, 14: 1.11, 30: 1.35, 54: 1.08, 70: 1.94 },
        covalent: { 1: 0.31, 2: 0.28, 14: 1.11, 30: 1.22, 54: 1.40, 70: 1.87 },
        vdw: { 1: 1.20, 2: 1.40, 14: 2.10, 30: 1.39, 54: 2.16, 70: 2.20 },
    };

    function elementColor(z) {
        return ELEMENT_COLORS[z] !== undefined ? ELEMENT_COLORS[z] : 0xaaaaaa;
    }

    function parseStyle(styleText) {
        const out = {};
        if (!styleText || typeof styleText !== 'string') return out;
        const toks = styleText.trim().split(/\s+/).filter(Boolean);
        for (let i = 0; i < toks.length; i++) {
            const t = toks[i];
            if (!t.startsWith('-')) continue;
            const k = t.slice(1).toLowerCase();
            const v = (i + 1 < toks.length && !toks[i + 1].startsWith('-')) ? toks[++i] : 'on';
            out[k] = v;
        }
        return out;
    }

    function toBool(v, dflt) {
        if (v === undefined || v === null || v === '') return dflt;
        const s = String(v).toLowerCase();
        if (['on', 'yes', 'true', '1'].includes(s)) return true;
        if (['off', 'no', 'false', '0'].includes(s)) return false;
        return dflt;
    }

    function toNum(v, dflt) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : dflt;
    }

    function toColor(val, dflt) {
        const c = new THREE.Color();
        try {
            c.set(val || dflt || '#aaaaaa');
            return c;
        } catch {
            c.set(dflt || '#aaaaaa');
            return c;
        }
    }

    function parseCameraSpec(text) {
        const spec = {};
        if (!text || typeof text !== 'string') return spec;
        const toks = text.trim().split(/\s+/).filter(Boolean);
        for (let i = 0; i < toks.length - 1; i += 2) {
            const k = toks[i];
            const v = toks[i + 1];
            if (k === '-qw' || k === '-qx' || k === '-qy' || k === '-qz' || k === '-xpan' || k === '-ypan' || k === '-zoom') {
                spec[k.slice(1)] = toNum(v, 0);
            }
        }
        if (!Number.isFinite(spec.zoom) || spec.zoom <= 0) spec.zoom = 1.0;
        if (!Number.isFinite(spec.xpan)) spec.xpan = 0.0;
        if (!Number.isFinite(spec.ypan)) spec.ypan = 0.0;
        return spec;
    }

    function parsePDB(text) {
        const atoms = [];
        const bonds = [];
        const lines = (text || '').split('\n');
        for (const line of lines) {
            const rec = line.substring(0, 6).trim();
            if (rec === 'ATOM' || rec === 'HETATM') {
                const symbol = (line.substring(76, 78).trim() || line.substring(12, 16).trim()).replace(/[^A-Za-z]/g, '');
                const x = parseFloat(line.substring(30, 38));
                const y = parseFloat(line.substring(38, 46));
                const z = parseFloat(line.substring(46, 54));
                const serial = parseInt(line.substring(6, 11).trim(), 10);
                atoms.push({ serial, symbol, x, y, z });
            } else if (rec === 'CONECT') {
                const parts = line.substring(6).trim().split(/\s+/).map(Number);
                const from = parts[0];
                for (let k = 1; k < parts.length; k++) {
                    const to = parts[k];
                    if (to && to > from) bonds.push([from, to]);
                }
            }
        }
        return { atoms, bonds };
    }

    function parseVTKPolydata(text) {
        const points = [];
        const lines = [];
        const verts = [];
        const polygons = [];
        const scalars = [];
        const vectors = [];

        const toks = (text || '').split(/\s+/).filter(Boolean);
        let i = 0;
        const next = () => toks[i++];
        const nextF = () => parseFloat(next());
        const nextI = () => parseInt(next(), 10);

        while (i < toks.length) {
            const kw = next();
            if (kw === 'POINTS') {
                const n = nextI();
                next();
                for (let k = 0; k < n * 3; k++) points.push(nextF());
            } else if (kw === 'VERTICES') {
                const n = nextI();
                nextI();
                for (let k = 0; k < n; k++) {
                    const cnt = nextI();
                    for (let j = 0; j < cnt; j++) verts.push(nextI());
                }
            } else if (kw === 'LINES') {
                const n = nextI();
                nextI();
                for (let k = 0; k < n; k++) {
                    const cnt = nextI();
                    const seg = [];
                    for (let j = 0; j < cnt; j++) seg.push(nextI());
                    for (let j = 0; j < seg.length - 1; j++) lines.push([seg[j], seg[j + 1]]);
                }
            } else if (kw === 'POLYGONS') {
                const n = nextI();
                nextI();
                for (let k = 0; k < n; k++) {
                    const cnt = nextI();
                    const poly = [];
                    for (let j = 0; j < cnt; j++) poly.push(nextI());
                    if (poly.length >= 3) {
                        for (let j = 1; j < poly.length - 1; j++) polygons.push([poly[0], poly[j], poly[j + 1]]);
                    }
                }
            } else if (kw === 'SCALARS') {
                next();
                next();
                const lt = next();
                if (lt === 'LOOKUP_TABLE') next();
                const nPts = points.length / 3;
                for (let k = 0; k < nPts; k++) scalars.push(nextF());
            } else if (kw === 'VECTORS') {
                next();
                next();
                const nPts = points.length / 3;
                for (let k = 0; k < nPts; k++) vectors.push([nextF(), nextF(), nextF()]);
            } else if (kw === 'FIELD') {
                next();
                const nArrays = nextI();
                for (let a = 0; a < nArrays; a++) {
                    const arrName = next();
                    const nComp = nextI();
                    const nTuples = nextI();
                    next();
                    const total = nComp * nTuples;
                    const vals = [];
                    for (let k = 0; k < total; k++) vals.push(nextF());
                    if (nComp === 1 && arrName.toLowerCase() === 'element' && scalars.length === 0) {
                        for (let k = 0; k < nTuples; k++) scalars.push(vals[k]);
                    }
                    if (nComp === 3 && vectors.length === 0) {
                        for (let k = 0; k < nTuples; k++) vectors.push([vals[k * 3], vals[k * 3 + 1], vals[k * 3 + 2]]);
                    }
                }
            }
        }

        return { points, lines, verts, polygons, scalars, vectors };
    }

    function scalarColor(v, vmin, vmax) {
        if (!Number.isFinite(v) || !Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) {
            return new THREE.Color('#3b82f6');
        }
        const t = Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin)));
        return new THREE.Color().setHSL((1 - t) * 0.65, 0.8, 0.5);
    }

    function markMaterial(mat, opacity) {
        if (!mat) return;
        mat.userData = mat.userData || {};
        mat.userData.baseOpacity = Math.max(0, Math.min(1, opacity));
    }

    function atomRadiusFor(z, mode) {
        if (mode === 'constant') return 0.8;
        const table = RADII[mode] || RADII.covalent;
        if (table[z] !== undefined) return table[z];
        return mode === 'vdw' ? 1.8 : (mode === 'atomic' ? 1.0 : 1.1);
    }

    function sampleColormap(name, t) {
        const maps = {
            BCGYR: ['#0b3cde', '#11b5ff', '#14b85a', '#f5d90a', '#e53935'],
            BGYOR: ['#0b3cde', '#11b5ff', '#14b85a', '#f59e0b', '#ef4444'],
            blue_to_brown: ['#2166ac', '#4393c3', '#92c5de', '#d1b58f', '#8c510a'],
            viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
        };
        const arr = maps[name] || maps.viridis;
        const tt = Math.max(0, Math.min(0.999999, t));
        const seg = 1 / (arr.length - 1);
        const i = Math.floor(tt / seg);
        const f = (tt - i * seg) / seg;
        const c0 = new THREE.Color(arr[i]);
        const c1 = new THREE.Color(arr[Math.min(i + 1, arr.length - 1)]);
        return c0.lerp(c1, f);
    }

    function makeTextSprite(text, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(15,23,42,0.80)';
        ctx.fillRect(22, 16, 212, 64);
        ctx.strokeStyle = 'rgba(148,163,184,0.9)';
        ctx.strokeRect(22, 16, 212, 64);
        ctx.fillStyle = color || '#f8fafc';
        ctx.fillText(text, 128, 49);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const spr = new THREE.Sprite(mat);
        spr.scale.set(0.9, 0.34, 1);
        return spr;
    }

    function moleculeColor(z, mode, atomsZ) {
        if (mode === 'elementDefault') return new THREE.Color(elementColor(z));
        const minZ = Math.min(...atomsZ);
        const maxZ = Math.max(...atomsZ);
        const t = (maxZ > minZ) ? (z - minZ) / (maxZ - minZ) : 0.5;
        return sampleColormap(mode, t);
    }

    function _addBondCylinder(group, av, bv, color, radius, opacity, quality) {
        const dir = new THREE.Vector3().subVectors(bv, av);
        const length = dir.length();
        if (length < 1e-6) return;
        const mid = new THREE.Vector3().addVectors(av, bv).multiplyScalar(0.5);
        const seg = Math.max(8, Math.min(64, Math.round(quality * 8)));
        const geo = new THREE.CylinderGeometry(radius, radius, length, seg);
        const mat = new THREE.MeshPhongMaterial({ color, transparent: opacity < 1, opacity });
        markMaterial(mat, opacity);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(mid);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        group.add(mesh);
    }

    function _addBondLine(group, av, bv, color, opacity) {
        const geo = new THREE.BufferGeometry().setFromPoints([av, bv]);
        const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
        markMaterial(mat, opacity);
        group.add(new THREE.Line(geo, mat));
    }

    function buildMoleculeGroup(mol, opts) {
        const style = parseStyle(mol.style);
        const group = new THREE.Group();
        group.userData.componentType = 'molecule';

        const showMolecule = opts.showMolecule;
        const showOutline = opts.showOutline;
        const showAtomLabels = opts.showAtomLabels;
        const showEdges = opts.showEdges;
        const representation = (opts.representation || 'ballandstick').toLowerCase();
        const radiusMode = (opts.atomRadii || 'covalent').toLowerCase();
        const colorMode = opts.colormap || 'elementDefault';
        const atomScale = Math.max(0.05, opts.atomScale);
        const bondScale = Math.max(0.05, opts.bondScale);
        const quality = Math.max(0.2, opts.quality);
        const opacity = Math.max(0.05, Math.min(1, opts.opacity));

        if (!showMolecule) {
            group.visible = false;
            return group;
        }

        const parsed = mol.pdb ? parsePDB(mol.pdb) : parseVTKPolydata(mol.vtk);
        let atoms = [];
        let bonds = [];

        if (mol.pdb) {
            atoms = parsed.atoms.map(a => ({
                serial: a.serial,
                pos: new THREE.Vector3(a.x, a.y, a.z),
                z: SYMBOL_Z[a.symbol] || 6,
                symbol: a.symbol || 'X',
            }));
            const serialToIdx = {};
            atoms.forEach((a, idx) => { serialToIdx[a.serial] = idx; });
            bonds = parsed.bonds
                .map(([a, b]) => [serialToIdx[a], serialToIdx[b]])
                .filter(([ia, ib]) => ia !== undefined && ib !== undefined);
        } else {
            const p = parsed.points;
            for (let i = 0; i < p.length / 3; i++) {
                atoms.push({
                    pos: new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]),
                    z: parsed.scalars[i] || 6,
                    symbol: 'A' + i,
                });
            }
            bonds = parsed.lines.slice();
        }

        const atomsZ = atoms.map(a => a.z);

        let showAtoms = true;
        let showBonds = true;
        let bondStyle = 'cylinder';

        if (representation === 'spheres') { showAtoms = true; showBonds = false; }
        else if (representation === 'sticks') { showAtoms = false; showBonds = true; bondStyle = 'cylinder'; }
        else if (representation === 'rods') { showAtoms = false; showBonds = true; bondStyle = 'cylinder'; }
        else if (representation === 'wireframe') { showAtoms = false; showBonds = true; bondStyle = 'line'; }
        else if (representation === 'spacefilling') { showAtoms = true; showBonds = false; }
        // default ballandstick

        const sphereSeg = Math.max(8, Math.min(64, Math.round(quality * 10)));

        if (showAtoms) {
            atoms.forEach(a => {
                const baseR = atomRadiusFor(a.z, radiusMode);
                let scaleFactor = 0.28;
                if (representation === 'spacefilling') scaleFactor = 0.48;
                if (representation === 'spheres') scaleFactor = 0.34;
                if (radiusMode === 'constant') scaleFactor = 0.22;
                if (a.symbol === 'He') scaleFactor *= 0.5;
                const r = Math.max(0.03, baseR * scaleFactor * atomScale);

                const color = moleculeColor(a.z, colorMode, atomsZ);
                const geo = new THREE.SphereGeometry(r, sphereSeg, Math.max(6, Math.round(sphereSeg * 0.75)));
                const mat = new THREE.MeshPhongMaterial({ color, transparent: opacity < 1, opacity, wireframe: !!showEdges });
                markMaterial(mat, opacity);
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(a.pos);
                group.add(mesh);

                if (showAtomLabels) {
                    const spr = makeTextSprite(a.symbol, '#e2e8f0');
                    spr.position.copy(a.pos).add(new THREE.Vector3(0, r * 2.2, 0));
                    group.add(spr);
                }
            });
        }

        if (showBonds) {
            bonds.forEach(([ia, ib]) => {
                const a = atoms[ia];
                const b = atoms[ib];
                if (!a || !b) return;
                const c = new THREE.Color('#9ca3af');
                if (bondStyle === 'line') {
                    _addBondLine(group, a.pos, b.pos, c, opacity);
                } else {
                    const base = representation === 'rods' ? 0.18 : 0.10;
                    _addBondCylinder(group, a.pos, b.pos, c, base * bondScale, opacity, quality);
                }
            });
        }

        if (showOutline) {
            const helper = new THREE.BoxHelper(group, 0x60a5fa);
            helper.userData.componentType = 'molecule_outline';
            group.add(helper);
        }

        return group;
    }

    function buildPolydataGroup(pd) {
        const style = parseStyle(pd.style);
        const vtk = parseVTKPolydata(pd.vtk);
        const group = new THREE.Group();
        group.userData.componentType = 'polydata';
        const pts = vtk.points;
        const polys = vtk.polygons;

        const color = toColor(style.constcolor || style.edgecolor || 'blue', 'blue');
        const opacity = Math.max(0, Math.min(1, toNum(style.opacity, 1.0)));
        const wireframe = toBool(style.wireframe, false);
        const edges = toBool(style.edges, false);
        const visible = toBool(style.visible, true);
        if (!visible) return group;

        if (polys.length > 0) {
            const pos = new Float32Array(pts);
            const idx = [];
            polys.forEach(t => { idx.push(t[0], t[1], t[2]); });
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mat = new THREE.MeshPhongMaterial({ color, transparent: opacity < 1, opacity, wireframe, side: THREE.DoubleSide });
            markMaterial(mat, opacity);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.userData.isPolyMesh = true;
            group.add(mesh);
            if (edges) {
                const egeo = new THREE.EdgesGeometry(geo);
                const emat = new THREE.LineBasicMaterial({ color: toColor(style.edgecolor || style.constcolor, '#222222') });
                markMaterial(emat, 1);
                group.add(new THREE.LineSegments(egeo, emat));
            }
        }

        if (vtk.lines.length > 0) {
            const lineMat = new THREE.LineBasicMaterial({ color: toColor(style.edgecolor || style.constcolor, '#1f2937'), transparent: opacity < 1, opacity });
            markMaterial(lineMat, opacity);
            vtk.lines.forEach(([a, b]) => {
                const pa = new THREE.Vector3(pts[a * 3], pts[a * 3 + 1], pts[a * 3 + 2]);
                const pb = new THREE.Vector3(pts[b * 3], pts[b * 3 + 1], pts[b * 3 + 2]);
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), lineMat));
            });
        }

        return group;
    }

    function glyphGeometry(shape, quality) {
        const q = Math.max(0.1, Math.min(10, quality || 1));
        const seg = Math.max(6, Math.round(10 * q));
        switch ((shape || 'sphere').toLowerCase()) {
            case 'arrow':
            case 'cone': return new THREE.ConeGeometry(0.25, 0.9, seg);
            case 'cube': return new THREE.BoxGeometry(0.6, 0.6, 0.6);
            case 'cylinder': return new THREE.CylinderGeometry(0.22, 0.22, 0.9, seg);
            case 'dodecahedron': return new THREE.DodecahedronGeometry(0.35);
            case 'icosahedron': return new THREE.IcosahedronGeometry(0.35);
            case 'octahedron': return new THREE.OctahedronGeometry(0.35);
            case 'tetrahedron': return new THREE.TetrahedronGeometry(0.35);
            case 'line': return new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6);
            case 'point': return new THREE.SphereGeometry(0.1, 6, 4);
            default: return new THREE.SphereGeometry(0.3, seg, Math.max(6, Math.round(seg * 0.75)));
        }
    }

    function buildGlyphsGroup(gl) {
        const style = parseStyle(gl.style);
        const vtk = parseVTKPolydata(gl.vtk);
        const group = new THREE.Group();
        group.userData.componentType = 'glyphs';
        const pts = vtk.points;
        const scalars = vtk.scalars;
        const vectors = vtk.vectors;
        const nPts = pts.length / 3;

        const shape = style.shape || gl.shape || 'sphere';
        const geom = glyphGeometry(shape, toNum(style.quality, 1));
        const opacity = Math.max(0, Math.min(1, toNum(style.opacity, 1.0)));
        const gscale = Math.max(0.001, toNum(style.gscale, 1.0));
        const orient = toBool(style.orientglyphs, false);
        const visible = toBool(style.visible, true);
        const wireframe = toBool(style.wireframe, false);
        const edges = toBool(style.edges, false);
        if (!visible) return group;

        let vmin = Infinity;
        let vmax = -Infinity;
        scalars.forEach(v => { if (Number.isFinite(v)) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; } });

        for (let i = 0; i < nPts; i++) {
            const p = new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
            let color;
            if (style.constcolor) color = toColor(style.constcolor, '#3b82f6');
            else if (i < scalars.length) color = scalarColor(scalars[i], vmin, vmax);
            else color = toColor('#3b82f6', '#3b82f6');

            const mat = new THREE.MeshPhongMaterial({ color, transparent: opacity < 1, opacity, wireframe });
            markMaterial(mat, opacity);
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.copy(p);
            mesh.scale.setScalar(gscale);
            mesh.userData.isGlyphMesh = true;
            mesh.userData.baseScale = gscale;

            if (orient && i < vectors.length) {
                const v = vectors[i];
                const vv = new THREE.Vector3(v[0], v[1], v[2]);
                if (vv.length() > 1e-8) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vv.normalize());
            }

            group.add(mesh);

            if (edges && !wireframe) {
                const eg = new THREE.EdgesGeometry(geom);
                const em = new THREE.LineBasicMaterial({ color: toColor(style.edgecolor || '#111111', '#111111') });
                markMaterial(em, 1);
                const e = new THREE.LineSegments(eg, em);
                e.position.copy(p);
                e.quaternion.copy(mesh.quaternion);
                e.scale.copy(mesh.scale);
                group.add(e);
            }
        }

        return group;
    }

    function applyCameraSpec(camera, controls, spec, size) {
        if (!spec) return;
        const base = new THREE.Vector3(0, 0, size * 1.2 / (spec.zoom || 1));
        if (Number.isFinite(spec.qw) && Number.isFinite(spec.qx) && Number.isFinite(spec.qy) && Number.isFinite(spec.qz)) {
            const q = new THREE.Quaternion(spec.qx, spec.qy, spec.qz, spec.qw).normalize();
            base.applyQuaternion(q);
        }
        camera.position.copy(base);
        const panScale = Math.max(1, size) * 0.25;
        controls.target.set((spec.xpan || 0) * panScale, (spec.ypan || 0) * panScale, 0);
        camera.lookAt(controls.target);
    }

    function formatAxis(ax, fallback) {
        if (!ax) return fallback;
        const lbl = ax.label || fallback;
        const u = ax.units ? ` (${ax.units})` : '';
        return `${lbl}${u}`;
    }

    function downloadJson(obj, filename) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function renderDrawing(id, data) {
        const label = data.label || data.about?.label || id;
        const item = rappture.createOutputItem(label, 'drawing');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');
        const head = item.querySelector('.rp-output-header');

        const description = data.description || data.about?.description || '';
        if (description && head) head.title = description;

        const hasContent = (data.molecules || []).length || (data.polydata || []).length || (data.glyphs || []).length;
        if (!hasContent) {
            body.textContent = '(no drawing components)';
            return item;
        }

        const sid = id.replace(/[^a-z0-9_-]/gi, '_');

        const plotWrap = document.createElement('div');
        plotWrap.className = 'rp-3d-wrap';
        plotWrap.style.minHeight = '0';

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'rp-3d-canvas-wrap';
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-label', '3D drawing visualization');
        canvasWrap.appendChild(canvas);
        plotWrap.appendChild(canvasWrap);

        const info = document.createElement('div');
        info.style.cssText = 'position:absolute;left:8px;bottom:8px;background:rgba(15,23,42,0.75);color:#cbd5e1;padding:3px 6px;border-radius:4px;font-size:11px;pointer-events:none';
        info.textContent = `${formatAxis(data.xaxis, 'X')} | ${formatAxis(data.yaxis, 'Y')} | ${formatAxis(data.zaxis, 'Z')}`;
        canvasWrap.appendChild(info);

        const panelHtml = `
            <div class="rp-panel-section">
                <div class="rp-panel-title">Components</div>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-poly-${sid}" checked> Show Polydata</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-gly-${sid}" checked> Show Glyphs</label>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Molecule</div>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mol-show-${sid}" checked> Show Molecule</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mol-outline-${sid}"> Show Outline</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mol-labels-${sid}"> Show Atom Labels</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mol-edges-${sid}"> Show Edges</label>
                <label>Molecule Representation
                    <select id="drw-mol-repr-${sid}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px">
                        <option value="ballandstick" selected>Ball and Sticks</option>
                        <option value="spheres">Spheres</option>
                        <option value="sticks">Sticks</option>
                        <option value="rods">Rods</option>
                        <option value="wireframe">Wireframe</option>
                        <option value="spacefilling">Space Filling</option>
                    </select>
                </label>
                <label>Atom Raddi
                    <select id="drw-mol-radii-${sid}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px">
                        <option value="atomic">Atomic</option>
                        <option value="covalent" selected>Covalent</option>
                        <option value="vdw">VDW</option>
                        <option value="constant">Constant</option>
                    </select>
                </label>
                <label>Colormap
                    <select id="drw-mol-cmap-${sid}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px">
                        <option value="elementDefault" selected>elementDefault</option>
                        <option value="BCGYR">BCGYR</option>
                        <option value="BGYOR">BGYOR</option>
                        <option value="blue_to_brown">blue to brown</option>
                        <option value="viridis">viridis</option>
                    </select>
                </label>
                <label>Atom Scale<input type="range" id="drw-mol-asc-${sid}" min="0.2" max="3" step="0.1" value="1"></label>
                <label>Bond Scale<input type="range" id="drw-mol-bsc-${sid}" min="0.2" max="3" step="0.1" value="1"></label>
                <label>Quality<input type="range" id="drw-mol-qual-${sid}" min="0.5" max="6" step="0.25" value="1.5"></label>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Render</div>
                <label>Opacity<input type="range" id="drw-op-${sid}" min="0.05" max="1" step="0.05" value="1"></label>
                <label>Glyph Scale<input type="range" id="drw-gs-${sid}" min="0.1" max="4" step="0.1" value="1"></label>
                <label>Light<input type="range" id="drw-light-${sid}" min="0" max="2" step="0.05" value="0.85"></label>
                <label>Background<input type="color" id="drw-bg-${sid}" value="#1a1a2e" style="width:100%;padding:0;height:28px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px"></label>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Camera</div>
                <div class="rp-panel-btns">
                    <button class="rp-3d-btn" id="drw-fit-${sid}">Fit</button>
                    <button class="rp-3d-btn" id="drw-xy-${sid}">XY</button>
                    <button class="rp-3d-btn" id="drw-xz-${sid}">XZ</button>
                    <button class="rp-3d-btn" id="drw-yz-${sid}">YZ</button>
                    <button class="rp-3d-btn" id="drw-3d-${sid}">3D</button>
                    <button class="rp-3d-btn" id="drw-auto-${sid}">Auto Rotate</button>
                </div>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <div class="rp-panel-btns">
                    <button class="rp-3d-btn" id="drw-png-${sid}">PNG</button>
                    <button class="rp-3d-btn" id="drw-json-${sid}">JSON</button>
                </div>
            </div>`;

        const side = (rappture._rpUtils && rappture._rpUtils.createSidecar)
            ? rappture._rpUtils.createSidecar(plotWrap, panelHtml, { noPlotlyResize: true, maxHeight: 'none' })
            : (() => {
                const cp = document.createElement('div');
                cp.className = 'rp-3d-panel';
                cp.innerHTML = panelHtml;
                const panelWrap = document.createElement('div');
                panelWrap.className = 'rp-3d-panel-wrap';
                const sideTab = document.createElement('div');
                sideTab.className = 'rp-3d-panel-tab';
                sideTab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';
                panelWrap.appendChild(sideTab);
                panelWrap.appendChild(cp);
                const outerWrap = document.createElement('div');
                outerWrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;align-items:stretch;';
                outerWrap.appendChild(plotWrap);
                outerWrap.appendChild(panelWrap);
                sideTab.addEventListener('click', () => panelWrap.classList.toggle('collapsed'));
                return { outerWrap, panelWrap, cp, sideTab };
            })();

        body.appendChild(side.outerWrap);
        whenVisible(side.outerWrap, () => _initThreeViewer(canvas, side.cp, data, sid));
        item._rpRenderer = { resize() { if (canvas._rpResize) canvas._rpResize(); } };

        return item;
    }

    function _initThreeViewer(canvas, cp, data, sid) {
        const getSize = () => ({ w: Math.max(canvas.clientWidth || 1, 1), h: Math.max(canvas.clientHeight || 1, 1) });
        const { w: W, h: H } = getSize();

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(W, H, false);
        renderer.setClearColor(0x1a1a2e);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 5000);
        const ambient = new THREE.AmbientLight(0xffffff, 0.52);
        const dlight = new THREE.DirectionalLight(0xffffff, 0.85);
        dlight.position.set(5, 10, 8);
        scene.add(ambient);
        scene.add(dlight);

        const root = new THREE.Group();
        root.userData.componentType = 'root';
        scene.add(root);

        const polyRoot = new THREE.Group();
        polyRoot.userData.componentType = 'polydata';
        (data.polydata || []).forEach(p => polyRoot.add(buildPolydataGroup(p)));
        root.add(polyRoot);

        const glyphRoot = new THREE.Group();
        glyphRoot.userData.componentType = 'glyphs';
        (data.glyphs || []).forEach(g => glyphRoot.add(buildGlyphsGroup(g)));
        root.add(glyphRoot);

        const moleculeRoot = new THREE.Group();
        moleculeRoot.userData.componentType = 'molecule_root';
        root.add(moleculeRoot);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.autoRotate = false;
        controls.autoRotateSpeed = 1.5;

        const q = (sel) => cp.querySelector(sel);

        const ui = {
            showMolecule: true,
            showOutline: false,
            showAtomLabels: false,
            showEdges: false,
            representation: 'ballandstick',
            atomRadii: 'covalent',
            colormap: 'elementDefault',
            atomScale: 1,
            bondScale: 1,
            quality: 1.5,
            opacity: 1,
        };

        const rebuildMolecules = () => {
            while (moleculeRoot.children.length) moleculeRoot.remove(moleculeRoot.children[0]);
            (data.molecules || []).forEach(m => moleculeRoot.add(buildMoleculeGroup(m, ui)));
        };

        rebuildMolecules();

        const fitBounds = () => {
            const box = new THREE.Box3().setFromObject(root);
            const center = box.getCenter(new THREE.Vector3());
            const size = Math.max(1e-3, box.getSize(new THREE.Vector3()).length());
            root.position.set(-center.x, -center.y, -center.z);
            camera.position.set(0, 0, size * 1.25);
            camera.near = Math.max(1e-5, size * 0.0005);
            camera.far = Math.max(10, size * 20);
            camera.updateProjectionMatrix();
            controls.target.set(0, 0, 0);
            controls.update();
            return size;
        };

        let fitSize = fitBounds();
        const cameraSpec = parseCameraSpec(data.camera || data.about?.camera || '');
        applyCameraSpec(camera, controls, cameraSpec, fitSize);

        const setView = (kind) => {
            const d = fitSize * 1.25;
            if (kind === 'xy') camera.position.set(0, 0, d);
            else if (kind === 'xz') camera.position.set(0, -d, 0);
            else if (kind === 'yz') camera.position.set(d, 0, 0);
            else camera.position.set(d * 0.8, d * 0.55, d * 0.8);
            controls.target.set(0, 0, 0);
            camera.lookAt(controls.target);
            controls.update();
        };

        const applyGlobalOpacity = (v) => {
            root.traverse(obj => {
                const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
                mats.forEach(m => {
                    const base = (m.userData && Number.isFinite(m.userData.baseOpacity)) ? m.userData.baseOpacity : 1;
                    m.opacity = Math.max(0, Math.min(1, base * v));
                    m.transparent = m.opacity < 1;
                    m.needsUpdate = true;
                });
            });
        };

        const applyGlyphScale = (factor) => {
            glyphRoot.traverse(obj => {
                if (!obj.isMesh || !(obj.userData && obj.userData.isGlyphMesh)) return;
                const b = obj.userData.baseScale || 1;
                obj.scale.setScalar(b * factor);
            });
        };

        const polyCb = q(`#drw-poly-${sid}`);
        const glyCb = q(`#drw-gly-${sid}`);
        const molShow = q(`#drw-mol-show-${sid}`);
        const molOutline = q(`#drw-mol-outline-${sid}`);
        const molLabels = q(`#drw-mol-labels-${sid}`);
        const molEdges = q(`#drw-mol-edges-${sid}`);
        const molRepr = q(`#drw-mol-repr-${sid}`);
        const molRadii = q(`#drw-mol-radii-${sid}`);
        const molCmap = q(`#drw-mol-cmap-${sid}`);
        const molAsc = q(`#drw-mol-asc-${sid}`);
        const molBsc = q(`#drw-mol-bsc-${sid}`);
        const molQual = q(`#drw-mol-qual-${sid}`);

        const op = q(`#drw-op-${sid}`);
        const gs = q(`#drw-gs-${sid}`);
        const li = q(`#drw-light-${sid}`);
        const bg = q(`#drw-bg-${sid}`);
        const fitBtn = q(`#drw-fit-${sid}`);
        const xyBtn = q(`#drw-xy-${sid}`);
        const xzBtn = q(`#drw-xz-${sid}`);
        const yzBtn = q(`#drw-yz-${sid}`);
        const v3dBtn = q(`#drw-3d-${sid}`);
        const autoBtn = q(`#drw-auto-${sid}`);
        const pngBtn = q(`#drw-png-${sid}`);
        const jsonBtn = q(`#drw-json-${sid}`);

        const pullMolUi = () => {
            ui.showMolecule = !!(molShow && molShow.checked);
            ui.showOutline = !!(molOutline && molOutline.checked);
            ui.showAtomLabels = !!(molLabels && molLabels.checked);
            ui.showEdges = !!(molEdges && molEdges.checked);
            ui.representation = (molRepr && molRepr.value) || 'ballandstick';
            ui.atomRadii = (molRadii && molRadii.value) || 'covalent';
            ui.colormap = (molCmap && molCmap.value) || 'elementDefault';
            ui.atomScale = toNum(molAsc && molAsc.value, 1);
            ui.bondScale = toNum(molBsc && molBsc.value, 1);
            ui.quality = toNum(molQual && molQual.value, 1.5);
            ui.opacity = toNum(op && op.value, 1);
        };

        const refreshMolecules = () => {
            pullMolUi();
            rebuildMolecules();
            applyGlobalOpacity(toNum(op && op.value, 1));
        };

        if (polyCb) polyCb.addEventListener('change', () => { polyRoot.visible = polyCb.checked; });
        if (glyCb) glyCb.addEventListener('change', () => { glyphRoot.visible = glyCb.checked; });

        [molShow, molOutline, molLabels, molEdges, molRepr, molRadii, molCmap].forEach(el => {
            if (el) el.addEventListener('change', refreshMolecules);
        });
        [molAsc, molBsc, molQual].forEach(el => {
            if (el) el.addEventListener('input', refreshMolecules);
        });

        if (op) op.addEventListener('input', () => {
            ui.opacity = toNum(op.value, 1);
            applyGlobalOpacity(ui.opacity);
        });

        if (gs) gs.addEventListener('input', () => applyGlyphScale(toNum(gs.value, 1)));
        if (li) li.addEventListener('input', () => { dlight.intensity = toNum(li.value, 0.85); });
        if (bg) bg.addEventListener('input', () => { renderer.setClearColor(toColor(bg.value, '#1a1a2e')); });

        if (fitBtn) fitBtn.addEventListener('click', () => { fitSize = fitBounds(); });
        if (xyBtn) xyBtn.addEventListener('click', () => setView('xy'));
        if (xzBtn) xzBtn.addEventListener('click', () => setView('xz'));
        if (yzBtn) yzBtn.addEventListener('click', () => setView('yz'));
        if (v3dBtn) v3dBtn.addEventListener('click', () => setView('3d'));
        if (autoBtn) autoBtn.addEventListener('click', () => {
            controls.autoRotate = !controls.autoRotate;
            autoBtn.classList.toggle('active', controls.autoRotate);
        });

        if (pngBtn) {
            pngBtn.addEventListener('click', () => {
                const dataUrl = renderer.domElement.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = ((data.label || sid || 'drawing').replace(/[^a-z0-9_-]/gi, '_')) + '.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
        }

        if (jsonBtn) {
            jsonBtn.addEventListener('click', () => {
                const name = ((data.label || sid || 'drawing').replace(/[^a-z0-9_-]/gi, '_')) + '.json';
                downloadJson(data, name);
            });
        }

        refreshMolecules();
        applyGlyphScale(toNum(gs && gs.value, 1));

        let animId = 0;
        function animate() {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        canvas._rpResize = () => {
            const { w, h } = getSize();
            if (w > 0 && h > 0) {
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h, false);
            }
        };

        const ro = new ResizeObserver(canvas._rpResize);
        ro.observe(canvas);

        const observer = new MutationObserver(() => {
            if (!document.contains(canvas)) {
                cancelAnimationFrame(animId);
                ro.disconnect();
                observer.disconnect();
                renderer.dispose();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    rappture._registerRenderer('drawing', {
        render(id, data) {
            return renderDrawing(id, data);
        },
        compare(sources, id) {
            const src = sources[0];
            return renderDrawing(id, src ? src.data : {});
        },
    });
})();
