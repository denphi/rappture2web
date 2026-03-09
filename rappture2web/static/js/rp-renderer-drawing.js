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

    // CPK/Jmol element colors (standard chemistry coloring)
    const ELEMENT_COLORS = {
        1:  0xffffff, // H  - white
        2:  0xd9ffff, // He - light cyan
        3:  0xcc80ff, // Li - violet
        4:  0xc2ff00, // Be - lime
        5:  0xffb5b5, // B  - salmon
        6:  0x909090, // C  - gray
        7:  0x3050f8, // N  - blue
        8:  0xff0d0d, // O  - red
        9:  0x90e050, // F  - green
        10: 0xb3e3f5, // Ne - light blue
        11: 0xab5cf2, // Na - purple
        12: 0x8aff00, // Mg - bright green
        13: 0xbfa6a6, // Al - pinkish gray
        14: 0xf0c8a0, // Si - tan
        15: 0xff8000, // P  - orange
        16: 0xffff30, // S  - yellow
        17: 0x1ff01f, // Cl - green
        18: 0x80d1e3, // Ar - cyan
        19: 0x8f40d4, // K  - purple
        20: 0x3dff00, // Ca - bright green
        21: 0xe6e6e6, // Sc - light gray
        22: 0xbfc2c7, // Ti - steel
        23: 0xa6a6ab, // V  - gray
        24: 0x8a99c7, // Cr - steel blue
        25: 0x9c7ac7, // Mn - violet
        26: 0xe06633, // Fe - orange-red
        27: 0xf090a0, // Co - pink
        28: 0x50d050, // Ni - green
        29: 0xc88033, // Cu - copper
        30: 0x7d80b0, // Zn - blue-gray
        31: 0xc28f8f, // Ga
        32: 0x668f8f, // Ge
        33: 0xbd80e3, // As - violet
        34: 0xffa100, // Se - orange
        35: 0xa62929, // Br - dark red
        36: 0x5cb8d1, // Kr - teal
        37: 0x702eb0, // Rb - purple
        38: 0x00ff00, // Sr - green
        39: 0x94ffff, // Y  - cyan
        40: 0x94e0e0, // Zr - teal
        41: 0x73c2c9, // Nb
        42: 0x54b5b5, // Mo - teal
        47: 0xc0c0c0, // Ag - silver
        48: 0xffd98f, // Cd - light gold
        53: 0x940094, // I  - purple
        54: 0x2060ff, // Xe - blue
        56: 0x00c900, // Ba - green
        79: 0xffd123, // Au - gold
        80: 0xb8b8d0, // Hg - steel blue-gray
        82: 0x575961, // Pb - dark gray
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
        atomic: {
            1: 0.53, 2: 0.31, 3: 1.67, 4: 1.12, 5: 0.87, 6: 0.67, 7: 0.56, 8: 0.48, 9: 0.42, 10: 0.38,
            11: 1.90, 12: 1.45, 13: 1.18, 14: 1.11, 15: 0.98, 16: 0.88, 17: 0.79, 18: 0.71,
            19: 2.43, 20: 1.94, 26: 1.56, 27: 1.25, 28: 1.24, 29: 1.28, 30: 1.35, 35: 1.20, 53: 1.40,
            54: 1.08, 70: 1.94,
        },
        covalent: {
            1: 0.31, 2: 0.28, 3: 1.28, 4: 0.96, 5: 0.84, 6: 0.77, 7: 0.75, 8: 0.73, 9: 0.71, 10: 0.69,
            11: 1.66, 12: 1.41, 13: 1.21, 14: 1.11, 15: 1.07, 16: 1.05, 17: 1.02, 18: 1.06,
            19: 2.03, 20: 1.76, 26: 1.32, 27: 1.26, 28: 1.24, 29: 1.32, 30: 1.22, 35: 1.20, 53: 1.39,
            54: 1.40, 70: 1.87,
        },
        vdw: {
            1: 1.20, 2: 1.40, 3: 1.82, 4: 1.53, 5: 1.92, 6: 1.70, 7: 1.55, 8: 1.52, 9: 1.47, 10: 1.54,
            11: 2.27, 12: 1.73, 13: 1.84, 14: 2.10, 15: 1.80, 16: 1.80, 17: 1.75, 18: 1.88,
            19: 2.75, 20: 2.31, 26: 1.63, 27: 1.40, 28: 1.63, 29: 1.40, 30: 1.39, 35: 1.85, 53: 1.98,
            54: 2.16, 70: 2.20,
        },
    };

    // Auto-detect bonds using covalent radii: bond if distance < (r1 + r2) * tolerance
    function detectBonds(atoms, tolerance) {
        const tol = tolerance || 1.3;
        const bonds = [];
        const cov = RADII.covalent;
        for (let i = 0; i < atoms.length; i++) {
            const ri = (cov[atoms[i].z] || 0.77) * tol;
            for (let j = i + 1; j < atoms.length; j++) {
                // Skip H-H bonds (common in polymers — produces noise)
                if (atoms[i].z === 1 && atoms[j].z === 1) continue;
                const rj = (cov[atoms[j].z] || 0.77) * tol;
                const dx = atoms[i].pos.x - atoms[j].pos.x;
                const dy = atoms[i].pos.y - atoms[j].pos.y;
                const dz = atoms[i].pos.z - atoms[j].pos.z;
                const dist2 = dx * dx + dy * dy + dz * dz;
                const thresh = ri + rj;
                if (dist2 < thresh * thresh && dist2 > 0.01) bonds.push([i, j]);
            }
        }
        return bonds;
    }

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

    function getTemplate(name) {
        if (typeof _rpPlotlyTemplates === 'undefined') return {};
        return _rpPlotlyTemplates[name] || _rpPlotlyTemplates.plotly || {};
    }

    function templateSceneBg(name) {
        const t = getTemplate(name);
        return t.layout?.scene?.xaxis?.backgroundcolor
            || t.layout?.plot_bgcolor
            || t.layout?.paper_bgcolor
            || '#E5ECF6';
    }

    function templateFontColor(name) {
        const t = getTemplate(name);
        return t.layout?.font?.color || '#2a3f5f';
    }

    function isDarkColor(colorValue) {
        const c = toColor(colorValue, '#E5ECF6');
        const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        return luma < 0.45;
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

    function _triNormal(a, b, c) {
        const ab = new THREE.Vector3().subVectors(b, a);
        const ac = new THREE.Vector3().subVectors(c, a);
        const n = new THREE.Vector3().crossVectors(ab, ac);
        const len = n.length();
        return len > 1e-12 ? n.multiplyScalar(1 / len) : null;
    }

    function _isPlanarPointSet(pts, indices) {
        if (!indices || indices.length < 3) return false;
        let i0 = -1, i1 = -1, i2 = -1, n = null;
        for (let i = 0; i < indices.length - 2 && !n; i++) {
            const a = indices[i], b = indices[i + 1], c = indices[i + 2];
            const pa = new THREE.Vector3(pts[a * 3], pts[a * 3 + 1], pts[a * 3 + 2]);
            const pb = new THREE.Vector3(pts[b * 3], pts[b * 3 + 1], pts[b * 3 + 2]);
            const pc = new THREE.Vector3(pts[c * 3], pts[c * 3 + 1], pts[c * 3 + 2]);
            n = _triNormal(pa, pb, pc);
            if (n) { i0 = a; i1 = b; i2 = c; }
        }
        if (!n || i0 < 0 || i1 < 0 || i2 < 0) return false;
        const p0 = new THREE.Vector3(pts[i0 * 3], pts[i0 * 3 + 1], pts[i0 * 3 + 2]);
        const tol = 1e-5;
        for (const idx of indices) {
            const p = new THREE.Vector3(pts[idx * 3], pts[idx * 3 + 1], pts[idx * 3 + 2]);
            const d = Math.abs(new THREE.Vector3().subVectors(p, p0).dot(n));
            if (d > tol) return false;
        }
        return true;
    }

    function _triangulatePlanarVertexLoop(pts, uniqueIdx) {
        if (!uniqueIdx || uniqueIdx.length < 3) return [];
        const p0 = new THREE.Vector3(pts[uniqueIdx[0] * 3], pts[uniqueIdx[0] * 3 + 1], pts[uniqueIdx[0] * 3 + 2]);
        let normal = null;
        for (let i = 1; i < uniqueIdx.length - 1 && !normal; i++) {
            const p1 = new THREE.Vector3(pts[uniqueIdx[i] * 3], pts[uniqueIdx[i] * 3 + 1], pts[uniqueIdx[i] * 3 + 2]);
            const p2 = new THREE.Vector3(pts[uniqueIdx[i + 1] * 3], pts[uniqueIdx[i + 1] * 3 + 1], pts[uniqueIdx[i + 1] * 3 + 2]);
            normal = _triNormal(p0, p1, p2);
        }
        if (!normal) return [];

        const absN = new THREE.Vector3(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
        let ax0 = 0, ax1 = 1;
        if (absN.x >= absN.y && absN.x >= absN.z) { ax0 = 1; ax1 = 2; }
        else if (absN.y >= absN.x && absN.y >= absN.z) { ax0 = 0; ax1 = 2; }
        else { ax0 = 0; ax1 = 1; }

        let c0 = 0, c1 = 0;
        const rec = uniqueIdx.map((idx) => {
            const x = pts[idx * 3 + ax0];
            const y = pts[idx * 3 + ax1];
            c0 += x;
            c1 += y;
            return { idx, x, y };
        });
        c0 /= rec.length;
        c1 /= rec.length;
        rec.forEach(r => { r.ang = Math.atan2(r.y - c1, r.x - c0); });
        rec.sort((a, b) => a.ang - b.ang);

        const tri = [];
        for (let i = 1; i < rec.length - 1; i++) {
            tri.push(rec[0].idx, rec[i].idx, rec[i + 1].idx);
        }
        return tri;
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

    function makeTextSprite(text, color, opts) {
        opts = opts || {};
        const fontPx = Math.max(10, toNum(opts.fontPx, 44));
        const sx = toNum(opts.scaleX, 0.9);
        const sy = toNum(opts.scaleY, 0.34);
        const noBackground = !!opts.noBackground;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `bold ${fontPx}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!noBackground) {
            ctx.fillStyle = 'rgba(15,23,42,0.80)';
            ctx.fillRect(22, 16, 212, 64);
            ctx.strokeStyle = 'rgba(148,163,184,0.9)';
            ctx.strokeRect(22, 16, 212, 64);
        }
        ctx.fillStyle = color || '#f8fafc';
        ctx.fillText(text, 128, 49);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const spr = new THREE.Sprite(mat);
        spr.scale.set(sx, sy, 1);
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
        const autoBonds = opts.autoBonds !== false; // default true
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
            // Auto-detect bonds when none are defined in CONECT records
            if (bonds.length === 0 && autoBonds) bonds = detectBonds(atoms);
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
        atoms.forEach(a => { a.color = moleculeColor(a.z, colorMode, atomsZ); });

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

                const color = a.color || moleculeColor(a.z, colorMode, atomsZ);
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
                const ac = (a.color && a.color.clone) ? a.color.clone() : moleculeColor(a.z, colorMode, atomsZ);
                const bc = (b.color && b.color.clone) ? b.color.clone() : moleculeColor(b.z, colorMode, atomsZ);
                const sameColor = ac.getHex() === bc.getHex();
                const mid = new THREE.Vector3().addVectors(a.pos, b.pos).multiplyScalar(0.5);
                if (bondStyle === 'line') {
                    if (sameColor) {
                        _addBondLine(group, a.pos, b.pos, ac, opacity);
                    } else {
                        _addBondLine(group, a.pos, mid, ac, opacity);
                        _addBondLine(group, mid, b.pos, bc, opacity);
                    }
                } else {
                    const base = representation === 'rods' ? 0.18 : 0.10;
                    if (sameColor) {
                        _addBondCylinder(group, a.pos, b.pos, ac, base * bondScale, opacity, quality);
                    } else {
                        _addBondCylinder(group, a.pos, mid, ac, base * bondScale, opacity, quality);
                        _addBondCylinder(group, mid, b.pos, bc, base * bondScale, opacity, quality);
                    }
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

    function buildPolydataGroup(pd, opts) {
        opts = opts || {};
        const style = parseStyle(pd.style);
        const vtk = parseVTKPolydata(pd.vtk);
        const group = new THREE.Group();
        group.userData.componentType = 'polydata';
        const pts = vtk.points;
        const polys = vtk.polygons;
        const scalars = vtk.scalars;

        const showMesh = opts.showMesh !== undefined ? !!opts.showMesh : toBool(style.visible, true);
        const showOutline = opts.showOutline !== undefined ? !!opts.showOutline : toBool(style.outline, false);
        const wireframe = opts.wireframe !== undefined ? !!opts.wireframe : toBool(style.wireframe, false);
        const lighting = opts.lighting !== undefined ? !!opts.lighting : toBool(style.lighting, true);
        const edges = opts.edges !== undefined ? !!opts.edges : toBool(style.edges, false);
        const opacity = Math.max(0, Math.min(1, toNum(opts.opacity, toNum(style.opacity, 1.0))));
        const cmap = (opts.colormap || 'style');
        if (!showMesh) return group;

        const meshColorToken = style.constcolor || style.color || style.edgecolor || 'blue';
        const edgeColor = toColor(style.edgecolor || meshColorToken, '#222222');
        const cmapLookup = { bcgyr: 'BCGYR', bgyor: 'BGYOR', blue_to_brown: 'blue_to_brown', viridis: 'viridis' };
        const cmapResolved = cmapLookup[String(cmap).toLowerCase()] || null;
        const canMapByScalar = !!cmapResolved && scalars.length === (pts.length / 3);
        const MatCtor = lighting ? THREE.MeshPhongMaterial : THREE.MeshBasicMaterial;

        if (polys.length > 0) {
            const pos = new Float32Array(pts);
            let idx = [];
            polys.forEach(t => { idx.push(t[0], t[1], t[2]); });
            const uniq = Array.from(new Set(idx));
            if (uniq.length >= 3 && _isPlanarPointSet(pts, uniq)) {
                const cleanTri = _triangulatePlanarVertexLoop(pts, uniq);
                if (cleanTri.length >= 3) idx = cleanTri;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            let mat;
            if (canMapByScalar) {
                let vmin = Infinity;
                let vmax = -Infinity;
                scalars.forEach(v => {
                    if (!Number.isFinite(v)) return;
                    if (v < vmin) vmin = v;
                    if (v > vmax) vmax = v;
                });
                const cols = new Float32Array((pts.length / 3) * 3);
                for (let i = 0; i < pts.length / 3; i++) {
                    const v = scalars[i];
                    const t = (Number.isFinite(v) && vmax > vmin) ? (v - vmin) / (vmax - vmin) : 0.5;
                    const c = sampleColormap(cmapResolved, t);
                    cols[i * 3] = c.r;
                    cols[i * 3 + 1] = c.g;
                    cols[i * 3 + 2] = c.b;
                }
                geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
                mat = new MatCtor({
                    vertexColors: true,
                    transparent: opacity < 1,
                    opacity,
                    wireframe,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    depthTest: true,
                });
            } else {
                const colorToken = cmapResolved ? sampleColormap(cmapResolved, 0.65).getStyle() : meshColorToken;
                mat = new MatCtor({
                    color: toColor(colorToken, 'blue'),
                    transparent: opacity < 1,
                    opacity,
                    wireframe,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    depthTest: true,
                });
            }
            markMaterial(mat, opacity);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.userData.isPolyMesh = true;
            group.add(mesh);
            if (edges) {
                const egeo = new THREE.EdgesGeometry(geo);
                const emat = new THREE.LineBasicMaterial({ color: edgeColor, depthWrite: false, depthTest: true });
                markMaterial(emat, 1);
                const emesh = new THREE.LineSegments(egeo, emat);
                group.add(emesh);
            }
        }

        if (vtk.lines.length > 0) {
            const lineMat = new THREE.LineBasicMaterial({
                color: edgeColor,
                transparent: opacity < 1,
                opacity,
                depthWrite: false,
                depthTest: true,
            });
            markMaterial(lineMat, opacity);
            vtk.lines.forEach(([a, b]) => {
                const pa = new THREE.Vector3(pts[a * 3], pts[a * 3 + 1], pts[a * 3 + 2]);
                const pb = new THREE.Vector3(pts[b * 3], pts[b * 3 + 1], pts[b * 3 + 2]);
                const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), lineMat);
                group.add(ln);
            });
        }

        if (showOutline) {
            const helper = new THREE.BoxHelper(group, edgeColor.getHex());
            helper.userData.componentType = 'mesh_outline';
            group.add(helper);
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
        info.id = `drw-info-${sid}`;
        info.style.cssText = 'position:absolute;left:8px;bottom:8px;background:rgba(229,236,246,0.85);color:#2a3f5f;padding:3px 6px;border-radius:4px;font-size:11px;pointer-events:none;border:1px solid rgba(148,163,184,0.35)';
        info.textContent = `${formatAxis(data.xaxis, 'X')} | ${formatAxis(data.yaxis, 'Y')} | ${formatAxis(data.zaxis, 'Z')}`;
        canvasWrap.appendChild(info);

        const panelHtml = `
            <div class="rp-panel-section">
                <div class="rp-panel-title">Components</div>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mesh-show-${sid}" checked> Show Mesh</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-gly-${sid}" checked> Show Glyphs</label>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Mesh</div>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mesh-outline-${sid}"> Show outline</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mesh-wire-${sid}"> Show wireframe</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mesh-light-${sid}" checked> Enable lighting</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mesh-edges-${sid}"> Show edges</label>
                <label>Opacity<input type="range" id="drw-mesh-op-${sid}" min="0.05" max="1" step="0.05" value="0.85"></label>
                <label>Color map
                    <select id="drw-mesh-cmap-${sid}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px">
                        <option value="style" selected>style/default</option>
                        <option value="BCGYR">BCGYR</option>
                        <option value="BGYOR">BGYOR</option>
                        <option value="blue_to_brown">blue to brown</option>
                        <option value="viridis">viridis</option>
                    </select>
                </label>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Molecule</div>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mol-show-${sid}" checked> Show Molecule</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-mol-autobind-${sid}" checked> Auto-detect bonds</label>
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
                <label>Atom Scale<input type="range" id="drw-mol-asc-${sid}" min="0.05" max="3" step="0.05" value="1.5"></label>
                <label>Bond Scale<input type="range" id="drw-mol-bsc-${sid}" min="0.01" max="3" step="0.005" value="1.5"></label>
                <label>Quality<input type="range" id="drw-mol-qual-${sid}" min="0.5" max="6" step="0.1" value="1"></label>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Render</div>
                <label>Template
                    <select id="drw-theme-${sid}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px">
                        <option value="plotly" selected>plotly</option>
                        <option value="plotly_white">plotly_white</option>
                        <option value="plotly_dark">plotly_dark</option>
                    </select>
                </label>
                <label>Opacity<input type="range" id="drw-op-${sid}" min="0.05" max="1" step="0.05" value="1"></label>
                <label>Glyph Scale<input type="range" id="drw-gs-${sid}" min="0.1" max="4" step="0.1" value="1"></label>
                <label>Light<input type="range" id="drw-light-${sid}" min="0" max="2" step="0.05" value="0.85"></label>
            </div>
            <div class="rp-panel-section">
                <div class="rp-panel-title">Axes</div>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-ax-on-${sid}" checked> Axes</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-ax-labels-${sid}" checked> Axis labels</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-ax-minor-${sid}" checked> Minor Ticks</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-ax-gridx-${sid}"> Grid X</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-ax-gridy-${sid}"> Grid Y</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="drw-ax-gridz-${sid}"> Grid Z</label>
                <label>Mode
                    <select id="drw-ax-mode-${sid}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px">
                        <option value="static" selected>static</option>
                        <option value="closest">closest</option>
                        <option value="farthest">farthest</option>
                        <option value="outer">outer</option>
                    </select>
                </label>
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
                <label>PNG Scale
                    <select id="drw-png-scale-${sid}" style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px">
                        <option value="1">1X</option>
                        <option value="2" selected>2X</option>
                        <option value="4">4X</option>
                        <option value="10">10X</option>
                    </select>
                </label>
                <div class="rp-panel-btns">
                    <button class="rp-3d-btn" id="drw-png-${sid}">PNG (Hi-Res)</button>
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
        renderer.setClearColor(toColor(templateSceneBg('plotly'), '#E5ECF6'));

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
        root.add(polyRoot);

        const glyphRoot = new THREE.Group();
        glyphRoot.userData.componentType = 'glyphs';
        (data.glyphs || []).forEach(g => glyphRoot.add(buildGlyphsGroup(g)));
        root.add(glyphRoot);

        const moleculeRoot = new THREE.Group();
        moleculeRoot.userData.componentType = 'molecule_root';
        root.add(moleculeRoot);
        const axisRoot = new THREE.Group();
        axisRoot.userData.componentType = 'axis_overlay';
        scene.add(axisRoot);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.autoRotate = false;
        controls.autoRotateSpeed = 1.5;

        const q = (sel) => cp.querySelector(sel);
        const info = canvas.parentElement ? canvas.parentElement.querySelector(`#drw-info-${sid}`) : null;

        const applyTemplate = (themeName) => {
            const bg = templateSceneBg(themeName || 'plotly');
            const fg = templateFontColor(themeName || 'plotly');
            const dark = isDarkColor(bg);
            renderer.setClearColor(toColor(bg, '#E5ECF6'));
            if (info) {
                info.style.color = fg;
                info.style.background = dark ? 'rgba(15,23,42,0.72)' : 'rgba(229,236,246,0.85)';
                info.style.borderColor = dark ? 'rgba(148,163,184,0.5)' : 'rgba(148,163,184,0.35)';
            }
        };

        const ui = {
            showMolecule: true,
            showOutline: false,
            showAtomLabels: false,
            showEdges: false,
            autoBonds: true,
            representation: 'ballandstick',
            atomRadii: 'covalent',
            colormap: 'elementDefault',
            atomScale: 1.5,
            bondScale: 1.5,
            quality: 1,
            opacity: 1,
        };
        const axisUi = {
            enabled: true,
            labels: true,
            minorTicks: true,
            gridX: false,
            gridY: false,
            gridZ: false,
            mode: 'static',
        };
        const meshUi = {
            showMesh: true,
            showOutline: false,
            wireframe: false,
            lighting: true,
            edges: false,
            opacity: 0.85,
            colormap: 'style',
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

        const clearGroup = (g) => {
            while (g.children.length) {
                const ch = g.children[0];
                g.remove(ch);
                if (ch.geometry) ch.geometry.dispose();
                if (ch.material) {
                    const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                    mats.forEach(m => m && m.dispose && m.dispose());
                }
            }
        };

        const rebuildPolydata = () => {
            clearGroup(polyRoot);
            (data.polydata || []).forEach(p => polyRoot.add(buildPolydataGroup(p, meshUi)));
        };
        rebuildPolydata();

        const boxCorners = (box) => {
            const { min, max } = box;
            return [
                new THREE.Vector3(min.x, min.y, min.z),
                new THREE.Vector3(max.x, min.y, min.z),
                new THREE.Vector3(min.x, max.y, min.z),
                new THREE.Vector3(max.x, max.y, min.z),
                new THREE.Vector3(min.x, min.y, max.z),
                new THREE.Vector3(max.x, min.y, max.z),
                new THREE.Vector3(min.x, max.y, max.z),
                new THREE.Vector3(max.x, max.y, max.z),
            ];
        };

        const chooseAxisOrigin = (box, mode) => {
            const corners = boxCorners(box);
            if (mode === 'static') return corners[0].clone();
            let pick = corners[0];
            let best = mode === 'closest' ? Infinity : -Infinity;
            corners.forEach(c => {
                const d = c.distanceTo(camera.position);
                if ((mode === 'closest' && d < best) || ((mode === 'farthest' || mode === 'outer') && d > best)) {
                    best = d;
                    pick = c;
                }
            });
            if (mode === 'outer') {
                const size = box.getSize(new THREE.Vector3());
                const n = new THREE.Vector3().subVectors(pick, box.getCenter(new THREE.Vector3())).normalize();
                const off = Math.max(size.x, size.y, size.z) * 0.08;
                return pick.clone().addScaledVector(n, off);
            }
            return pick.clone();
        };

        const axisBaseColor = { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 };

        const axisLabelText = {
            x: formatAxis(data.xaxis, 'X'),
            y: formatAxis(data.yaxis, 'Y'),
            z: formatAxis(data.zaxis, 'Z'),
        };

        const addAxisSegment = (a, b, color, width) => {
            const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
            const mat = new THREE.LineBasicMaterial({ color, linewidth: width || 1 });
            axisRoot.add(new THREE.Line(geo, mat));
        };

        const addAxisTicks = (origin, dir, len, tickDir, color, startVal, endVal) => {
            const n = 10;
            const tickLen = len * 0.015;
            for (let i = 1; i < n; i++) {
                const p = origin.clone().addScaledVector(dir, (len * i) / n);
                const a = p.clone().addScaledVector(tickDir, -tickLen);
                const b = p.clone().addScaledVector(tickDir, tickLen);
                addAxisSegment(a, b, color, 1);
                const val = startVal + ((endVal - startVal) * i) / n;
                const label = Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(2).replace(/\.?0+$/, '');
                const tickColor = `#${new THREE.Color(color).getHexString()}`;
                const s = makeTextSprite(label, tickColor, { fontPx: 34, scaleX: 1.2, scaleY: 0.48, noBackground: true });
                s.position.copy(p).addScaledVector(tickDir, tickLen * 5.2);
                axisRoot.add(s);
            }
        };

        const addAxisGrid = (box, axisName, color) => {
            const n = 10;
            const c = toColor(color, '#64748b');
            const mat = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.32 });
            const min = box.min;
            const max = box.max;
            const lines = [];
            if (axisName === 'x') {
                const x = min.x;
                for (let i = 0; i <= n; i++) {
                    const y = min.y + ((max.y - min.y) * i) / n;
                    lines.push([new THREE.Vector3(x, y, min.z), new THREE.Vector3(x, y, max.z)]);
                }
                for (let i = 0; i <= n; i++) {
                    const z = min.z + ((max.z - min.z) * i) / n;
                    lines.push([new THREE.Vector3(x, min.y, z), new THREE.Vector3(x, max.y, z)]);
                }
            } else if (axisName === 'y') {
                const y = min.y;
                for (let i = 0; i <= n; i++) {
                    const x = min.x + ((max.x - min.x) * i) / n;
                    lines.push([new THREE.Vector3(x, y, min.z), new THREE.Vector3(x, y, max.z)]);
                }
                for (let i = 0; i <= n; i++) {
                    const z = min.z + ((max.z - min.z) * i) / n;
                    lines.push([new THREE.Vector3(min.x, y, z), new THREE.Vector3(max.x, y, z)]);
                }
            } else {
                const z = min.z;
                for (let i = 0; i <= n; i++) {
                    const x = min.x + ((max.x - min.x) * i) / n;
                    lines.push([new THREE.Vector3(x, min.y, z), new THREE.Vector3(x, max.y, z)]);
                }
                for (let i = 0; i <= n; i++) {
                    const y = min.y + ((max.y - min.y) * i) / n;
                    lines.push([new THREE.Vector3(min.x, y, z), new THREE.Vector3(max.x, y, z)]);
                }
            }
            lines.forEach(([a, b]) => {
                const g = new THREE.BufferGeometry().setFromPoints([a, b]);
                axisRoot.add(new THREE.Line(g, mat));
            });
        };

        const renderAxes = () => {
            clearGroup(axisRoot);
            if (!axisUi.enabled) return;
            const box = new THREE.Box3().setFromObject(root);
            if (box.isEmpty()) return;

            const min = box.min;
            const max = box.max;
            const sx = Math.max(1e-6, max.x - min.x);
            const sy = Math.max(1e-6, max.y - min.y);
            const sz = Math.max(1e-6, max.z - min.z);
            const origin = chooseAxisOrigin(box, axisUi.mode);

            const dirX = new THREE.Vector3(Math.abs(origin.x - max.x) < 1e-6 ? -1 : 1, 0, 0);
            const dirY = new THREE.Vector3(0, Math.abs(origin.y - max.y) < 1e-6 ? -1 : 1, 0);
            const dirZ = new THREE.Vector3(0, 0, Math.abs(origin.z - max.z) < 1e-6 ? -1 : 1);

            const xEnd = origin.clone().addScaledVector(dirX, sx);
            const yEnd = origin.clone().addScaledVector(dirY, sy);
            const zEnd = origin.clone().addScaledVector(dirZ, sz);

            addAxisSegment(origin, xEnd, axisBaseColor.x, 2);
            addAxisSegment(origin, yEnd, axisBaseColor.y, 2);
            addAxisSegment(origin, zEnd, axisBaseColor.z, 2);

            if (axisUi.minorTicks) {
                addAxisTicks(origin, dirX, sx, dirY, axisBaseColor.x, origin.x, xEnd.x);
                addAxisTicks(origin, dirY, sy, dirZ, axisBaseColor.y, origin.y, yEnd.y);
                addAxisTicks(origin, dirZ, sz, dirX, axisBaseColor.z, origin.z, zEnd.z);
            }

            if (axisUi.labels) {
                const off = Math.max(sx, sy, sz) * 0.04;
                const lx = makeTextSprite(axisLabelText.x, '#fca5a5', { fontPx: 44, scaleX: 1.8, scaleY: 0.68 });
                const ly = makeTextSprite(axisLabelText.y, '#86efac', { fontPx: 44, scaleX: 1.8, scaleY: 0.68 });
                const lz = makeTextSprite(axisLabelText.z, '#93c5fd', { fontPx: 44, scaleX: 1.8, scaleY: 0.68 });
                lx.position.copy(xEnd).addScaledVector(dirX, off);
                ly.position.copy(yEnd).addScaledVector(dirY, off);
                lz.position.copy(zEnd).addScaledVector(dirZ, off);
                axisRoot.add(lx);
                axisRoot.add(ly);
                axisRoot.add(lz);
            }

            if (axisUi.gridX) addAxisGrid(box, 'x', '#64748b');
            if (axisUi.gridY) addAxisGrid(box, 'y', '#64748b');
            if (axisUi.gridZ) addAxisGrid(box, 'z', '#64748b');
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

        const meshShow = q(`#drw-mesh-show-${sid}`);
        const meshOutline = q(`#drw-mesh-outline-${sid}`);
        const meshWire = q(`#drw-mesh-wire-${sid}`);
        const meshLight = q(`#drw-mesh-light-${sid}`);
        const meshEdges = q(`#drw-mesh-edges-${sid}`);
        const meshOp = q(`#drw-mesh-op-${sid}`);
        const meshCmap = q(`#drw-mesh-cmap-${sid}`);
        const glyCb = q(`#drw-gly-${sid}`);
        const molShow = q(`#drw-mol-show-${sid}`);
        const molAutoBond = q(`#drw-mol-autobind-${sid}`);
        const molOutline = q(`#drw-mol-outline-${sid}`);
        const molLabels = q(`#drw-mol-labels-${sid}`);
        const molEdges = q(`#drw-mol-edges-${sid}`);
        const molRepr = q(`#drw-mol-repr-${sid}`);
        const molRadii = q(`#drw-mol-radii-${sid}`);
        const molCmap = q(`#drw-mol-cmap-${sid}`);
        const molAsc = q(`#drw-mol-asc-${sid}`);
        const molBsc = q(`#drw-mol-bsc-${sid}`);
        const molQual = q(`#drw-mol-qual-${sid}`);

        const axOn = q(`#drw-ax-on-${sid}`);
        const axLabels = q(`#drw-ax-labels-${sid}`);
        const axMinor = q(`#drw-ax-minor-${sid}`);
        const axGridX = q(`#drw-ax-gridx-${sid}`);
        const axGridY = q(`#drw-ax-gridy-${sid}`);
        const axGridZ = q(`#drw-ax-gridz-${sid}`);
        const axMode = q(`#drw-ax-mode-${sid}`);

        const op = q(`#drw-op-${sid}`);
        const gs = q(`#drw-gs-${sid}`);
        const li = q(`#drw-light-${sid}`);
        const theme = q(`#drw-theme-${sid}`);
        const fitBtn = q(`#drw-fit-${sid}`);
        const xyBtn = q(`#drw-xy-${sid}`);
        const xzBtn = q(`#drw-xz-${sid}`);
        const yzBtn = q(`#drw-yz-${sid}`);
        const v3dBtn = q(`#drw-3d-${sid}`);
        const autoBtn = q(`#drw-auto-${sid}`);
        const pngBtn = q(`#drw-png-${sid}`);
        const pngScale = q(`#drw-png-scale-${sid}`);
        const jsonBtn = q(`#drw-json-${sid}`);

        const pullMolUi = () => {
            ui.showMolecule = !!(molShow && molShow.checked);
            ui.autoBonds = molAutoBond ? molAutoBond.checked : true;
            ui.showOutline = !!(molOutline && molOutline.checked);
            ui.showAtomLabels = !!(molLabels && molLabels.checked);
            ui.showEdges = !!(molEdges && molEdges.checked);
            ui.representation = (molRepr && molRepr.value) || 'ballandstick';
            ui.atomRadii = (molRadii && molRadii.value) || 'covalent';
            ui.colormap = (molCmap && molCmap.value) || 'elementDefault';
            ui.atomScale = toNum(molAsc && molAsc.value, 1.5);
            ui.bondScale = toNum(molBsc && molBsc.value, 1.5);
            ui.quality = toNum(molQual && molQual.value, 1);
            ui.opacity = toNum(op && op.value, 1);
        };
        const pullMeshUi = () => {
            meshUi.showMesh = !!(meshShow && meshShow.checked);
            meshUi.showOutline = !!(meshOutline && meshOutline.checked);
            meshUi.wireframe = !!(meshWire && meshWire.checked);
            meshUi.lighting = !!(meshLight && meshLight.checked);
            meshUi.edges = !!(meshEdges && meshEdges.checked);
            meshUi.opacity = toNum(meshOp && meshOp.value, 0.85);
            meshUi.colormap = (meshCmap && meshCmap.value) || 'style';
        };
        const pullAxisUi = () => {
            axisUi.enabled = !!(axOn && axOn.checked);
            axisUi.labels = !!(axLabels && axLabels.checked);
            axisUi.minorTicks = !!(axMinor && axMinor.checked);
            axisUi.gridX = !!(axGridX && axGridX.checked);
            axisUi.gridY = !!(axGridY && axGridY.checked);
            axisUi.gridZ = !!(axGridZ && axGridZ.checked);
            axisUi.mode = (axMode && axMode.value) || 'static';
        };

        const refreshMolecules = () => {
            pullMolUi();
            rebuildMolecules();
            applyGlobalOpacity(toNum(op && op.value, 1));
            renderAxes();
        };
        const refreshMesh = () => {
            pullMeshUi();
            rebuildPolydata();
            applyGlobalOpacity(toNum(op && op.value, 1));
            renderAxes();
        };

        if (meshShow) meshShow.addEventListener('change', refreshMesh);
        if (glyCb) glyCb.addEventListener('change', () => { glyphRoot.visible = glyCb.checked; renderAxes(); });

        [molShow, molOutline, molLabels, molEdges, molRepr, molRadii, molCmap].forEach(el => {
            if (el) el.addEventListener('change', refreshMolecules);
        });
        [molAsc, molBsc, molQual].forEach(el => {
            if (el) el.addEventListener('input', refreshMolecules);
        });
        [meshOutline, meshWire, meshLight, meshEdges, meshCmap].forEach(el => {
            if (el) el.addEventListener('change', refreshMesh);
        });
        if (meshOp) meshOp.addEventListener('input', refreshMesh);

        [axOn, axLabels, axMinor, axGridX, axGridY, axGridZ, axMode].forEach(el => {
            if (!el) return;
            const ev = (el.tagName === 'SELECT') ? 'change' : 'change';
            el.addEventListener(ev, () => {
                pullAxisUi();
                renderAxes();
            });
        });

        if (op) op.addEventListener('input', () => {
            ui.opacity = toNum(op.value, 1);
            applyGlobalOpacity(ui.opacity);
        });

        if (gs) gs.addEventListener('input', () => applyGlyphScale(toNum(gs.value, 1)));
        if (li) li.addEventListener('input', () => { dlight.intensity = toNum(li.value, 0.85); });
        if (theme) theme.addEventListener('change', () => applyTemplate(theme.value || 'plotly'));

        if (fitBtn) fitBtn.addEventListener('click', () => { fitSize = fitBounds(); renderAxes(); });
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
                const scale = Math.max(1, Math.min(12, toNum(pngScale && pngScale.value, 2)));
                const cssW = Math.max(1, canvas.clientWidth || 1);
                const cssH = Math.max(1, canvas.clientHeight || 1);
                const baseDpr = window.devicePixelRatio || 1;

                // Re-render at higher pixel ratio, capture PNG, then restore.
                renderer.setPixelRatio(baseDpr * scale);
                renderer.setSize(cssW, cssH, false);
                camera.aspect = cssW / cssH;
                camera.updateProjectionMatrix();
                controls.update();
                renderer.render(scene, camera);
                const dataUrl = renderer.domElement.toDataURL('image/png');
                renderer.setPixelRatio(baseDpr);
                renderer.setSize(cssW, cssH, false);
                camera.aspect = cssW / cssH;
                camera.updateProjectionMatrix();
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
        pullMeshUi();
        rebuildPolydata();
        pullAxisUi();
        applyTemplate((theme && theme.value) || 'plotly');
        renderAxes();
        applyGlyphScale(toNum(gs && gs.value, 1));

        let animId = 0;
        function animate() {
            animId = requestAnimationFrame(animate);
            controls.update();
            if (axisUi.enabled && axisUi.mode !== 'static') renderAxes();
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
