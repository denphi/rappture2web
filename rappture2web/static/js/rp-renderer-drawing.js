/**
 * Rappture drawing/molecule renderer.
 * Handles <drawing> output elements containing <molecule> with PDB or VTK POLYDATA data.
 * Uses Three.js (already loaded) for 3D rendering.
 */
(function () {

    // ── Element colors (CPK) by atomic number ────────────────────────────────
    const ELEMENT_COLORS = {
        1:  0xffffff, // H
        2:  0xd9ffff, // He
        6:  0x909090, // C
        7:  0x3050f8, // N
        8:  0xff0d0d, // O
        9:  0x90e050, // F
        14: 0xf0c8a0, // Si
        15: 0xff8000, // P
        16: 0xffff30, // S
        17: 0x1ff01f, // Cl
        32: 0x668f8f, // Ge
        31: 0xc28f8f, // Ga
        33: 0xbd80e3, // As
        34: 0xffa100, // Se
    };
    // Element symbol → atomic number (subset used by crystal viewer)
    const SYMBOL_Z = {
        H:2, He:2, Li:3, Be:4, B:5, C:6, N:7, O:8, F:9, Ne:10,
        Na:11, Mg:12, Al:13, Si:14, P:15, S:16, Cl:17, Ar:18,
        K:19, Ca:20, Sc:21, Ti:22, V:23, Cr:24, Mn:25, Fe:26, Co:27,
        Ni:28, Cu:29, Zn:30, Ga:31, Ge:32, As:33, Se:34, Br:35, Kr:36,
        Rb:37, Sr:38, Y:39, Zr:40, Nb:41, Mo:42, Tc:43, Ru:44, Rh:45,
        Pd:46, Ag:47, Cd:48, In:49, Sn:50, Sb:51, Te:52, I:53, Xe:54,
        Cs:55, Ba:56, La:57, Hf:72, Ta:73, W:74, Re:75, Os:76, Ir:77,
        Pt:78, Au:79, Hg:80, Tl:81, Pb:82, Bi:83,
        // Pseudoatoms used by crystal viewer for lattice vectors
        Yb:70, Zr:40,
    };
    function elementColor(z) {
        return ELEMENT_COLORS[z] !== undefined ? ELEMENT_COLORS[z] : 0xaaaaaa;
    }

    // ── PDB parser ────────────────────────────────────────────────────────────
    function parsePDB(text) {
        const atoms = [];   // {index, symbol, x, y, z}
        const bonds = [];   // [i, j]  (0-based atom indices)
        const lines = text.split('\n');
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

    // ── VTK POLYDATA parser ───────────────────────────────────────────────────
    function parseVTKPolydata(text) {
        const points = [];  // flat [x,y,z, ...]
        const lines = [];   // [[i,j], ...]  (line segments)
        const verts = [];   // [i, ...]  (isolated points)
        const scalars = []; // per-point scalar (element number)

        const toks = text.split(/\s+/).filter(Boolean);
        let i = 0;
        const next = () => toks[i++];
        const nextF = () => parseFloat(next());
        const nextI = () => parseInt(next(), 10);

        while (i < toks.length) {
            const kw = next();
            if (kw === 'POINTS') {
                const n = nextI(); next(); // skip type
                for (let k = 0; k < n * 3; k++) points.push(nextF());
            } else if (kw === 'VERTICES') {
                const n = nextI(); nextI(); // skip total
                for (let k = 0; k < n; k++) {
                    const cnt = nextI();
                    for (let j = 0; j < cnt; j++) verts.push(nextI());
                }
            } else if (kw === 'LINES') {
                const n = nextI(); nextI();
                for (let k = 0; k < n; k++) {
                    const cnt = nextI();
                    const seg = [];
                    for (let j = 0; j < cnt; j++) seg.push(nextI());
                    for (let j = 0; j < seg.length - 1; j++) lines.push([seg[j], seg[j+1]]);
                }
            } else if (kw === 'SCALARS') {
                next(); next(); // name, type
                // skip LOOKUP_TABLE line
                const lt = next();
                if (lt === 'LOOKUP_TABLE') next();
                const nPts = points.length / 3;
                for (let k = 0; k < nPts; k++) scalars.push(nextF());
            } else if (kw === 'FIELD') {
                next(); // FieldData
                const nArrays = nextI();
                for (let a = 0; a < nArrays; a++) {
                    next(); // array name
                    const nComp = nextI();
                    const nTuples = nextI();
                    next(); // type
                    const total = nComp * nTuples;
                    for (let k = 0; k < total; k++) next();
                }
            }
            // skip unknown keywords
        }
        return { points, lines, verts, scalars };
    }

    // ── Build Three.js scene from parsed data ─────────────────────────────────
    function buildSceneFromPDB(parsed) {
        const group = new THREE.Group();
        const serialToIdx = {};
        parsed.atoms.forEach((a, idx) => { serialToIdx[a.serial] = idx; });

        // Atoms as spheres
        parsed.atoms.forEach(a => {
            const z = SYMBOL_Z[a.symbol] || 6;
            const color = elementColor(z);
            const radius = a.symbol === 'He' ? 0.15 : 0.35; // He = lattice corner marker
            const geo = new THREE.SphereGeometry(radius, 12, 8);
            const mat = new THREE.MeshPhongMaterial({ color });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(a.x, a.y, a.z);
            group.add(mesh);
        });

        // Bonds as cylinders
        parsed.bonds.forEach(([fromSerial, toSerial]) => {
            const ai = parsed.atoms[serialToIdx[fromSerial]];
            const bi = parsed.atoms[serialToIdx[toSerial]];
            if (!ai || !bi) return;
            const av = new THREE.Vector3(ai.x, ai.y, ai.z);
            const bv = new THREE.Vector3(bi.x, bi.y, bi.z);
            _addBond(group, av, bv, 0x888888);
        });

        return group;
    }

    function buildSceneFromVTK(parsed) {
        const group = new THREE.Group();
        const nPts = parsed.points.length / 3;

        function pt(i) {
            return new THREE.Vector3(parsed.points[i*3], parsed.points[i*3+1], parsed.points[i*3+2]);
        }

        // Points as small spheres colored by element scalar
        parsed.verts.forEach(i => {
            const z = parsed.scalars[i] || 6;
            const color = elementColor(z);
            const geo = new THREE.SphereGeometry(0.2, 8, 6);
            const mat = new THREE.MeshPhongMaterial({ color });
            const mesh = new THREE.Mesh(geo, mat);
            const p = pt(i);
            mesh.position.copy(p);
            group.add(mesh);
        });

        // If no explicit VERTICES, render all points
        if (parsed.verts.length === 0) {
            for (let i = 0; i < nPts; i++) {
                const z = parsed.scalars[i] || 6;
                const geo = new THREE.SphereGeometry(0.2, 8, 6);
                const mat = new THREE.MeshPhongMaterial({ color: elementColor(z) });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(pt(i));
                group.add(mesh);
            }
        }

        // Lines as cylinders
        parsed.lines.forEach(([a, b]) => {
            _addBond(group, pt(a), pt(b), 0x666666);
        });

        return group;
    }

    function _addBond(group, av, bv, color) {
        const dir = new THREE.Vector3().subVectors(bv, av);
        const length = dir.length();
        if (length < 0.01) return;
        const mid = new THREE.Vector3().addVectors(av, bv).multiplyScalar(0.5);
        const geo = new THREE.CylinderGeometry(0.08, 0.08, length, 6);
        const mat = new THREE.MeshPhongMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(mid);
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.normalize()
        );
        group.add(mesh);
    }

    // ── Main render function ──────────────────────────────────────────────────
    function renderDrawing(id, data) {
        const label = data.label || data.about?.label || id;
        const item = rappture.createOutputItem(label, 'drawing');
        const body = item.querySelector('.rp-output-body');

        const molecules = data.molecules || [];
        if (!molecules.length) {
            body.textContent = '(no molecule data)';
            return item;
        }

        // If multiple molecules, show them in sub-tabs
        let container;
        if (molecules.length > 1) {
            const tabBar = document.createElement('div');
            tabBar.className = 'rp-output-tabs rp-drawing-tabs';
            tabBar.style.cssText = 'font-size:12px;margin-bottom:4px';
            const panels = document.createElement('div');
            body.appendChild(tabBar);
            body.appendChild(panels);

            molecules.forEach((mol, idx) => {
                const btn = document.createElement('button');
                btn.className = 'rp-output-tab-btn' + (idx === 0 ? ' active' : '');
                btn.textContent = mol.id || ('View ' + (idx + 1));
                btn.style.cssText = 'font-size:11px;padding:2px 8px';
                const panel = document.createElement('div');
                panel.className = 'rp-output-panel' + (idx === 0 ? ' active' : '');
                btn.addEventListener('click', () => {
                    tabBar.querySelectorAll('.rp-output-tab-btn').forEach(b => b.classList.remove('active'));
                    panels.querySelectorAll('.rp-output-panel').forEach(p => p.classList.remove('active'));
                    btn.classList.add('active');
                    panel.classList.add('active');
                    const r = panel._rpRenderer;
                    if (r) r.resize();
                });
                tabBar.appendChild(btn);
                panels.appendChild(panel);
                _buildMoleculeView(panel, mol);
            });
        } else {
            _buildMoleculeView(body, molecules[0]);
        }

        return item;
    }

    function _buildMoleculeView(container, mol) {
        const canvas = document.createElement('div');
        canvas.style.cssText = 'width:100%;height:380px;position:relative;background:#1a1a2e;border-radius:4px;overflow:hidden';
        container.appendChild(canvas);

        // Axis info
        const axes = document.createElement('div');
        axes.style.cssText = 'font-size:10px;color:#888;margin-top:2px';
        container.appendChild(axes);

        // Defer Three.js init until visible
        rappture._whenVisible(canvas, () => {
            _initThreeViewer(canvas, mol);
        });
        container._rpRenderer = { resize: () => {
            const r = canvas._rpResize;
            if (r) r();
        }};
    }

    function _initThreeViewer(container, mol) {
        const W = container.clientWidth || 400;
        const H = container.clientHeight || 380;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(W, H);
        renderer.setClearColor(0x1a1a2e);
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 1000);

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dlight = new THREE.DirectionalLight(0xffffff, 0.8);
        dlight.position.set(5, 10, 7);
        scene.add(dlight);

        // Build geometry
        let group;
        if (mol.pdb) {
            group = buildSceneFromPDB(parsePDB(mol.pdb));
        } else if (mol.vtk) {
            group = buildSceneFromVTK(parseVTKPolydata(mol.vtk));
        } else {
            return;
        }
        scene.add(group);

        // Center and fit camera
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        group.position.sub(center);
        camera.position.set(0, 0, size * 1.2);
        camera.near = size * 0.001;
        camera.far = size * 10;
        camera.updateProjectionMatrix();

        // OrbitControls
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;

        // Animate
        let animId;
        function animate() {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        // Resize handler
        container._rpResize = () => {
            const nW = container.clientWidth;
            const nH = container.clientHeight;
            if (nW > 0 && nH > 0) {
                camera.aspect = nW / nH;
                camera.updateProjectionMatrix();
                renderer.setSize(nW, nH);
            }
        };
        const ro = new ResizeObserver(container._rpResize);
        ro.observe(container);

        // Cleanup on removal
        const observer = new MutationObserver(() => {
            if (!document.contains(container)) {
                cancelAnimationFrame(animId);
                renderer.dispose();
                ro.disconnect();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ── Register ──────────────────────────────────────────────────────────────
    rappture._registerRenderer('drawing', {
        render(id, data) { return renderDrawing(id, data); },
        compare(sources, id) {
            // Simple side-by-side for compare: just render first source
            const src = sources[0];
            return renderDrawing(id, src ? src.data : {});
        },
    });

})();
