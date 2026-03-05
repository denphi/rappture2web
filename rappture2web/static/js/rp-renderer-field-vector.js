/**
 * rp-renderer-field-vector.js
 *
 * Registers the 'field_vector' renderer for vector and flow fields,
 * using Three.js for 3D rendering with Gaussian splat volume,
 * arrow glyphs, streamlines, and animated particle injection planes.
 */
(function () {
    'use strict';

    const _mkAxis = rappture._rpUtils.mkAxis;

    rappture._registerRenderer('field_vector', {
        render(id, data) {
            const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'field');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            if (!window.THREE) {
                body.innerHTML = '<p style="padding:14px;color:var(--rp-text-muted)">Three.js not loaded.</p>';
                return item;
            }

            // Helper: expand a grid mesh (axes) into explicit point list
            const _gridToPoints = (mesh) => {
                const axes = mesh.axes || {};
                const xs = _mkAxis(axes.x), ys = _mkAxis(axes.y), zs = _mkAxis(axes.z);
                const pts = [];
                if (axes.z) {
                    for (let ix = 0; ix < xs.length; ix++)
                        for (let iy = 0; iy < ys.length; iy++)
                            for (let iz = 0; iz < zs.length; iz++)
                                pts.push([xs[ix], ys[iy], zs[iz]]);
                } else {
                    for (let ix = 0; ix < xs.length; ix++)
                        for (let iy = 0; iy < ys.length; iy++)
                            pts.push([xs[ix], ys[iy], 0]);
                }
                return pts;
            };

            // Collect points + values from all components
            const allPts = [], allVals = [];
            let isVector = false;
            let flowMeta = null;
            for (const comp of (data.components || [])) {
                const mesh = comp.mesh;
                const vals = comp.values || [];
                const extents = comp.extents || 1;
                if (!mesh) continue;
                const pts = (mesh.points && mesh.points.length)
                    ? mesh.points
                    : (mesh.mesh_type === 'grid' ? _gridToPoints(mesh) : null);
                if (!pts || pts.length === 0) continue;
                if (extents > 1) isVector = true;
                if (comp.flow && !flowMeta) flowMeta = comp.flow;
                pts.forEach((pt, i) => {
                    allPts.push(pt);
                    allVals.push(vals[i] !== undefined ? vals[i] : (extents > 1 ? [0,0,0] : 0));
                });
            }
            const isFlow = isVector && flowMeta !== null;
            const sid = id.replace(/[^a-z0-9_-]/gi, '_');

            console.log('[field_vector] allPts:', allPts.length, 'isVector:', isVector, 'flowMeta:', JSON.stringify(flowMeta));

            if (allPts.length === 0) {
                body.innerHTML = '<p style="padding:14px;color:var(--rp-text-muted)">No point data.</p>';
                return item;
            }

            // Subsample for display when there are many points
            const MAX_DISPLAY = 20000;
            let dispPts = allPts, dispVals = allVals;
            if (allPts.length > MAX_DISPLAY) {
                const dStride = Math.ceil(allPts.length / MAX_DISPLAY);
                dispPts = []; dispVals = [];
                for (let i = 0; i < allPts.length; i += dStride) {
                    dispPts.push(allPts[i]);
                    dispVals.push(allVals[i]);
                }
            }

            const magnitudes = dispVals.map(v =>
                isVector ? Math.sqrt(v[0]**2 + (v[1]||0)**2 + (v[2]||0)**2) : v
            );
            const vMin = Math.min(...magnitudes), vMax = Math.max(...magnitudes);

            // Colour map (cool-warm: blue→cyan→green→yellow→red)
            const colorMap = (t) => {
                const stops = [
                    [0,     0,   0, 139],
                    [0.25,  0,   0, 255],
                    [0.5,   0, 255, 255],
                    [0.625, 0, 255,   0],
                    [0.75, 255, 255,   0],
                    [1.0,  255,   0,   0],
                ];
                let i = 0;
                while (i < stops.length - 2 && t > stops[i+1][0]) i++;
                const lo = stops[i], hi = stops[i+1];
                const f = Math.max(0, Math.min(1, (t - lo[0]) / (hi[0] - lo[0] || 1)));
                return [
                    (lo[1] + f * (hi[1] - lo[1])) / 255,
                    (lo[2] + f * (hi[2] - lo[2])) / 255,
                    (lo[3] + f * (hi[3] - lo[3])) / 255,
                ];
            };

            // ── DOM structure ──────────────────────────────────────────────
            const wrap = document.createElement('div');
            wrap.className = 'rp-3d-wrap';

            const innerRow = document.createElement('div');
            innerRow.className = 'rp-3d-inner-row';

            const canvasWrap = document.createElement('div');
            canvasWrap.className = 'rp-3d-canvas-wrap';
            const canvas = document.createElement('canvas');
            canvas.setAttribute('aria-label', '3D field visualization');
            canvas.setAttribute('role', 'img');
            canvasWrap.appendChild(canvas);
            innerRow.appendChild(canvasWrap);
            wrap.appendChild(innerRow);

            const colorbarDiv = document.createElement('div');
            colorbarDiv.className = 'rp-3d-colorbar';
            colorbarDiv.innerHTML = `<span id="cb-lo-${sid}">${vMin.toFixed(4)}</span>
                <div class="rp-3d-colorbar-gradient"></div>
                <span id="cb-hi-${sid}">${vMax.toFixed(4)}</span>`;
            wrap.appendChild(colorbarDiv);

            const flowVolumeActive = isVector && (!flowMeta || flowMeta.volume !== false);
            const flowArrowsActive = isVector && flowMeta && flowMeta.arrows;
            const flowStreamsActive = isVector && flowMeta && flowMeta.streams;
            const hasParticles = isFlow && flowMeta.particles && flowMeta.particles.length > 0;
            const particlePlaneBtns = hasParticles
                ? flowMeta.particles.filter(p => !p.hide).map(p =>
                    `<button class="rp-3d-btn active" id="par-${sid}-${p.id}">${p.label || p.id}</button>`
                  ).join('')
                : '';
            const panel = document.createElement('div');
            panel.className = 'rp-3d-panel';
            panel.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Display</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn${flowVolumeActive ? ' active' : ''}" id="pts-${sid}">Volume</button>
                  <button class="rp-3d-btn${flowArrowsActive ? ' active' : ''}" id="arr-${sid}">Arrows</button>
                  <button class="rp-3d-btn${flowStreamsActive ? ' active' : ''}" id="stm-${sid}">Streams</button>
                  <button class="rp-3d-btn" id="cton-${sid}">Contours</button>
                </div>
                <label>Opacity<input type="range" min="0" max="100" value="80" id="op-${sid}"></label>
                <label>Glow<input type="range" min="0" max="100" value="30" id="glow-${sid}"></label>
                <label>Size<input type="range" min="5" max="300" value="100" id="thin-${sid}"></label>
                <label>Contour #<input type="range" min="1" max="20" value="5" step="1" id="ct-${sid}"></label>
              </div>
              <div class="rp-panel-section" id="flow-sec-${sid}" style="display:${hasParticles ? 'flex' : 'none'}">
                <div class="rp-panel-title">Flow</div>
                <div class="rp-panel-btns">
                  ${particlePlaneBtns}
                  <button class="rp-3d-btn" id="par-rst-${sid}" title="Re-seed all particles"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:3px"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5V1l3 2.5L8 6V4.5A3.5 3.5 0 1 0 11.5 8h2z"/></svg>Reset</button>
                  <button class="rp-3d-btn active" id="par-pause-${sid}" title="Pause/resume particle animation"><svg class="rp-flow-pause-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:3px"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg><svg class="rp-flow-play-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:3px;display:none"><polygon points="3,2 13,8 3,14"/></svg><span class="rp-flow-pause-label">Pause</span></button>
                </div>
                <label>Count<input type="range" min="2" max="80" value="40" step="1" id="pc-${sid}"></label>
                <label>Speed<input type="range" min="0" max="500" value="100" step="10" id="spd-${sid}"></label>
                <label>Part. size<input type="range" min="1" max="30" value="6" step="1" id="ps-${sid}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Scale</div>
                <label>Min<input type="number" id="sc-lo-${sid}" value="${vMin.toFixed(4)}" step="any"></label>
                <label>Max<input type="number" id="sc-hi-${sid}" value="${vMax.toFixed(4)}" step="any"></label>
                <div class="rp-panel-btns" style="margin-top:4px">
                  <button class="rp-3d-btn" id="sc-rst-${sid}">Reset</button>
                </div>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Camera</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn" id="fit-${sid}">⤢ Fit</button>
                  <button class="rp-3d-btn" id="vxy-${sid}">XY</button>
                  <button class="rp-3d-btn" id="vxz-${sid}">XZ</button>
                  <button class="rp-3d-btn" id="vyz-${sid}">YZ</button>
                  <button class="rp-3d-btn" id="v3d-${sid}">3D</button>
                  <button class="rp-3d-btn" id="ar-${sid}">⟳ Auto</button>
                </div>
              </div>`;
            const flowPanelWrap = document.createElement('div');
            flowPanelWrap.className = 'rp-3d-panel-wrap';
            const flowPanelTab = document.createElement('div');
            flowPanelTab.className = 'rp-3d-panel-tab';
            flowPanelTab.title = 'Toggle control panel';
            flowPanelTab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';
            flowPanelWrap.appendChild(flowPanelTab);
            flowPanelWrap.appendChild(panel);
            innerRow.appendChild(flowPanelWrap);
            flowPanelTab.addEventListener('click', () => {
                flowPanelWrap.classList.toggle('collapsed');
            });

            body.appendChild(wrap);

            // ── Three.js scene ─────────────────────────────────────────────
            let _threeInit = false;
            const _initThree = (w, H) => {
                if (_threeInit) return;
                _threeInit = true;
                canvas.width = w; canvas.height = H;

                const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
                renderer.setSize(w, H);
                renderer.setPixelRatio(window.devicePixelRatio);
                renderer.setClearColor(0x1e293b, 1);

                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(45, w / H, 0.001, 10000);

                let cx = 0, cy = 0, cz = 0;
                allPts.forEach(p => { cx += p[0]; cy += p[1]; cz += (p[2] || 0); });
                cx /= allPts.length; cy /= allPts.length; cz /= allPts.length;
                let maxR = 0;
                allPts.forEach(p => {
                    const r = Math.sqrt((p[0]-cx)**2 + (p[1]-cy)**2 + ((p[2]||0)-cz)**2);
                    if (r > maxR) maxR = r;
                });
                if (maxR === 0) maxR = 1;
                const fitDist = maxR * 2.5;

                const controls = new THREE.OrbitControls(camera, canvas);
                controls.target.set(0, 0, 0);
                controls.enableDamping = true;
                controls.dampingFactor = 0.08;

                const setCameraView = (dir) => {
                    const d = fitDist;
                    if (dir === 'xy') camera.position.set(0, 0, d);
                    else if (dir === 'xz') camera.position.set(0, -d, 0);
                    else if (dir === 'yz') camera.position.set(d, 0, 0);
                    else camera.position.set(d * 0.7, d * 0.5, d * 0.7);
                    camera.lookAt(0, 0, 0);
                    controls.target.set(0, 0, 0);
                    controls.update();
                };
                setCameraView('3d');

                let scLo = vMin, scHi = vMax;
                const toT = (v) => {
                    const r = scHi - scLo || 1;
                    return Math.max(0, Math.min(1, (v - scLo) / r));
                };

                // ── Point cloud ──────────────────────────────────────────
                const ptPositions = new Float32Array(dispPts.length * 3);
                const ptColors    = new Float32Array(dispPts.length * 3);
                const ptAlphas    = new Float32Array(dispPts.length);
                dispPts.forEach((pt, i) => {
                    ptPositions[i*3]   = pt[0] - cx;
                    ptPositions[i*3+1] = pt[1] - cy;
                    ptPositions[i*3+2] = (pt[2] || 0) - cz;
                });
                const ptGeom = new THREE.BufferGeometry();
                ptGeom.setAttribute('position', new THREE.BufferAttribute(ptPositions, 3));
                const colorAttr = new THREE.BufferAttribute(ptColors, 3);
                const alphaAttr = new THREE.BufferAttribute(ptAlphas, 1);
                ptGeom.setAttribute('color', colorAttr);
                ptGeom.setAttribute('alpha', alphaAttr);

                const ptSize = maxR / Math.cbrt(dispPts.length) * 4.5;

                const ptUniforms = {
                    uPointSize: { value: ptSize },
                    uGlow:      { value: 0.3 },
                    uThin:      { value: 1.0 },
                    uOpacity:   { value: 0.8 },
                };
                const vertShader = `
                    attribute float alpha;
                    uniform float uPointSize;
                    uniform float uThin;
                    varying vec3 vColor;
                    varying float vAlpha;
                    void main() {
                        vColor = color;
                        vAlpha = alpha;
                        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                        float fovScale = projectionMatrix[1][1];
                        float screenH = 600.0;
                        gl_PointSize = uPointSize * uThin * fovScale * screenH / (-mvPos.z * 2.0);
                        gl_Position = projectionMatrix * mvPos;
                    }`;
                const fragShader = `
                    uniform float uGlow;
                    uniform float uOpacity;
                    varying vec3 vColor;
                    varying float vAlpha;
                    void main() {
                        vec2 uv = gl_PointCoord - 0.5;
                        float r2 = dot(uv, uv);
                        if (r2 > 0.25) discard;
                        float sigma2 = mix(0.08, 0.01, uGlow);
                        float gauss = exp(-r2 / sigma2);
                        float a = vAlpha * uOpacity * gauss;
                        gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0));
                    }`;
                const ptMat = new THREE.ShaderMaterial({
                    uniforms: ptUniforms,
                    vertexShader: vertShader, fragmentShader: fragShader,
                    vertexColors: true, transparent: true, depthWrite: false,
                });
                const ptCloud = new THREE.Points(ptGeom, ptMat);
                ptCloud.renderOrder = 1;
                scene.add(ptCloud);

                let curOpacity = 0.8;
                const refreshPointCloud = () => {
                    for (let i = 0; i < dispPts.length; i++) {
                        const t = toT(magnitudes[i]);
                        const [r, g, b] = colorMap(t);
                        ptColors[i*3] = r; ptColors[i*3+1] = g; ptColors[i*3+2] = b;
                        ptAlphas[i] = t * t;
                    }
                    colorAttr.needsUpdate = true;
                    alphaAttr.needsUpdate = true;
                    ptUniforms.uOpacity.value = curOpacity;
                    const loEl = wrap.querySelector(`#cb-lo-${sid}`);
                    const hiEl = wrap.querySelector(`#cb-hi-${sid}`);
                    if (loEl) loEl.textContent = scLo.toFixed(4);
                    if (hiEl) hiEl.textContent = scHi.toFixed(4);
                };
                refreshPointCloud();

                // ── Iso-surface contours ─────────────────────────────────
                let contourGroup = new THREE.Group();
                contourGroup.visible = false;
                scene.add(contourGroup);

                let curNContours = 5;
                const rebuildContours = () => {
                    while (contourGroup.children.length) contourGroup.remove(contourGroup.children[0]);
                    if (!contourGroup.visible || curNContours === 0) return;
                    const range = scHi - scLo || 1;
                    const halfBand = range / (curNContours + 1) * 0.6;
                    for (let li = 0; li < curNContours; li++) {
                        const isoVal = scLo + (li + 1) / (curNContours + 1) * range;
                        const isoPos = [], isoCol = [], isoAlp = [];
                        dispPts.forEach((pt, i) => {
                            if (Math.abs(magnitudes[i] - isoVal) <= halfBand) {
                                isoPos.push(pt[0]-cx, pt[1]-cy, (pt[2]||0)-cz);
                                const t = toT(magnitudes[i]);
                                const [r, g, b] = colorMap(t);
                                isoCol.push(r, g, b);
                                isoAlp.push(1.0);
                            }
                        });
                        if (isoPos.length === 0) continue;
                        const isoGeom = new THREE.BufferGeometry();
                        isoGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(isoPos), 3));
                        isoGeom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(isoCol), 3));
                        isoGeom.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(isoAlp), 1));
                        const isoMat = new THREE.ShaderMaterial({
                            uniforms: ptUniforms,
                            vertexShader: vertShader,
                            fragmentShader: fragShader,
                            vertexColors: true, transparent: true,
                            depthWrite: false,
                        });
                        contourGroup.add(new THREE.Points(isoGeom, isoMat));
                    }
                };

                // ── Arrow glyphs ─────────────────────────────────────────
                let arrowGroup = new THREE.Group();
                arrowGroup.visible = isVector;
                scene.add(arrowGroup);

                const rebuildArrows = () => {
                    while (arrowGroup.children.length) arrowGroup.remove(arrowGroup.children[0]);
                    if (!arrowGroup.visible || !isVector) return;
                    const maxMag = vMax || 1;
                    const arrowLen = maxR * 0.12;
                    const stride = Math.max(1, Math.floor(dispPts.length / 600));
                    for (let i = 0; i < dispPts.length; i += stride) {
                        const v = dispVals[i];
                        const mag = magnitudes[i];
                        if (mag < 1e-10) continue;
                        const dir = new THREE.Vector3(v[0]/mag, (v[1]||0)/mag, (v[2]||0)/mag);
                        const origin = new THREE.Vector3(
                            dispPts[i][0]-cx, dispPts[i][1]-cy, (dispPts[i][2]||0)-cz
                        );
                        const t = toT(mag);
                        const [r, g, b] = colorMap(t);
                        const color = new THREE.Color(r, g, b);
                        const len = arrowLen * (mag / maxMag);
                        const arrow = new THREE.ArrowHelper(dir, origin, len, color, len*0.4, len*0.2);
                        arrowGroup.add(arrow);
                    }
                };
                rebuildArrows();

                if (flowMeta) {
                    ptCloud.visible = flowMeta.volume !== false;
                    arrowGroup.visible = !!flowMeta.arrows;
                }

                // ── Bounding boxes ───────────────────────────────────────
                const boxGroup = new THREE.Group();
                scene.add(boxGroup);
                if (flowMeta && flowMeta.boxes) {
                    const cssColors = {
                        cyan:'#00ffff', magenta:'#ff00ff', violet:'#ee82ee',
                        lightgreen:'#90ee90', khaki:'#f0e68c', white:'#ffffff',
                        red:'#ff0000', blue:'#0000ff', green:'#00ff00',
                    };
                    for (const box of flowMeta.boxes) {
                        if (box.hide) continue;
                        const c1 = box.corner1, c2 = box.corner2;
                        const bx = (c1[0]+c2[0])/2-cx, by = (c1[1]+c2[1])/2-cy, bz = (c1[2]||0+c2[2]||0)/2-cz;
                        const sw = Math.abs(c2[0]-c1[0]), sh = Math.abs(c2[1]-c1[1]), sd = Math.abs((c2[2]||0)-(c1[2]||0));
                        const geom = new THREE.BoxGeometry(sw, sh, sd || 1);
                        const hexStr = cssColors[box.color] || box.color || '#ffffff';
                        const edges = new THREE.EdgesGeometry(geom);
                        const mat = new THREE.LineBasicMaterial({ color: hexStr, linewidth: box.linewidth || 1 });
                        const wireframe = new THREE.LineSegments(edges, mat);
                        wireframe.position.set(bx, by, bz);
                        boxGroup.add(wireframe);
                    }
                }

                // ── Streams plane ────────────────────────────────────────
                const streamGroup = new THREE.Group();
                streamGroup.visible = !!(flowMeta && flowMeta.streams);
                scene.add(streamGroup);

                const rebuildStreams = () => {
                    while (streamGroup.children.length) streamGroup.remove(streamGroup.children[0]);
                    if (!streamGroup.visible || !isVector) return;
                    const axis   = flowMeta ? (flowMeta.axis || 'z') : 'z';
                    const posStr = flowMeta ? (flowMeta.position || '50%') : '50%';
                    const posVal = parseFloat(posStr) / 100;

                    let xArr = allPts.map(p=>p[0]), yArr = allPts.map(p=>p[1]), zArr = allPts.map(p=>(p[2]||0));
                    const xLo = Math.min(...xArr), xHi = Math.max(...xArr);
                    const yLo = Math.min(...yArr), yHi = Math.max(...yArr);
                    const zLo = Math.min(...zArr), zHi = Math.max(...zArr);
                    const sliceVal = axis === 'x' ? xLo + posVal*(xHi-xLo)
                                   : axis === 'y' ? yLo + posVal*(yHi-yLo)
                                   : zLo + posVal*(zHi-zLo);
                    const tol = Math.max((xHi-xLo),(yHi-yLo),(zHi-zLo)) / 20;

                    const positions = [];
                    const colors = [];
                    for (let i = 0; i < dispPts.length; i++) {
                        const p = dispPts[i];
                        const coord = axis === 'x' ? p[0] : axis === 'y' ? p[1] : (p[2]||0);
                        if (Math.abs(coord - sliceVal) > tol) continue;
                        const v = dispVals[i];
                        const mag = magnitudes[i];
                        if (mag < 1e-12) continue;
                        const scale = (maxR * 0.06) * (mag / (vMax||1));
                        const ox = p[0]-cx, oy = p[1]-cy, oz = (p[2]||0)-cz;
                        const vx = v[0]/mag*scale, vy = (v[1]||0)/mag*scale, vz = (v[2]||0)/mag*scale;
                        positions.push(ox, oy, oz, ox+vx, oy+vy, oz+vz);
                        const [r,g,b] = colorMap(toT(mag));
                        colors.push(r,g,b, r,g,b);
                    }
                    if (positions.length === 0) return;
                    const geom = new THREE.BufferGeometry();
                    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
                    geom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(colors), 3));
                    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
                    streamGroup.add(new THREE.LineSegments(geom, mat));
                };
                rebuildStreams();

                // ── Particle injection planes ────────────────────────────
                const particleGroups = [];
                let getVelocity = () => [0, 0, 0];
                let xLo2 = 0, xHi2 = 1, yLo2 = 0, yHi2 = 1, zLo2 = 0, zHi2 = 1;
                const cssColorToHex = (s) => {
                    const map = { lightgreen:0x90ee90, khaki:0xf0e68c, yellow:0xffff00,
                                  pink:0xffc0cb, white:0xffffff, cyan:0x00ffff,
                                  red:0xff0000, blue:0x0000ff, green:0x00ff00 };
                    if (map[s]) return map[s];
                    if (s.startsWith('#')) return parseInt(s.slice(1), 16);
                    return 0xffffff;
                };
                let curNGrid = 40;
                let curSpeed = 1.0;

                if (isVector && flowMeta && flowMeta.particles) {
                    console.log('[particles] building for', flowMeta.particles.length, 'planes, pts=', allPts.length);
                    const xArr2 = allPts.map(p=>p[0]), yArr2 = allPts.map(p=>p[1]), zArr2 = allPts.map(p=>(p[2]||0));
                    xLo2 = Math.min(...xArr2); xHi2 = Math.max(...xArr2);
                    yLo2 = Math.min(...yArr2); yHi2 = Math.max(...yArr2);
                    zLo2 = Math.min(...zArr2); zHi2 = Math.max(...zArr2);

                    const VG = 30;
                    const voxVx = (xHi2 - xLo2) / VG || 1;
                    const voxVy = (yHi2 - yLo2) / VG || 1;
                    const voxVz = (zHi2 - zLo2) / VG || 1;
                    const voxMap = new Map();
                    for (let ii = 0; ii < allPts.length; ii++) {
                        const ix = Math.min(VG-1, Math.floor((allPts[ii][0]-xLo2)/voxVx));
                        const iy = Math.min(VG-1, Math.floor((allPts[ii][1]-yLo2)/voxVy));
                        const iz = Math.min(VG-1, Math.floor(((allPts[ii][2]||0)-zLo2)/voxVz));
                        const key = ix*VG*VG + iy*VG + iz;
                        const v = allVals[ii];
                        if (!voxMap.has(key)) voxMap.set(key, [v[0]||0, v[1]||0, v[2]||0, 1]);
                        else { const e=voxMap.get(key); e[0]+=v[0]||0; e[1]+=v[1]||0; e[2]+=v[2]||0; e[3]++; }
                    }
                    voxMap.forEach((e) => { e[0]/=e[3]; e[1]/=e[3]; e[2]/=e[3]; });

                    getVelocity = (px, py, pz) => {
                        const ix0 = Math.min(VG-1, Math.max(0, Math.floor((px-xLo2)/voxVx)));
                        const iy0 = Math.min(VG-1, Math.max(0, Math.floor((py-yLo2)/voxVy)));
                        const iz0 = Math.min(VG-1, Math.max(0, Math.floor((pz-zLo2)/voxVz)));
                        for (let dz=-1; dz<=1; dz++) for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
                            const key = (ix0+dx)*VG*VG + (iy0+dy)*VG + (iz0+dz);
                            if (voxMap.has(key)) { const e=voxMap.get(key); return [e[0],e[1],e[2]]; }
                        }
                        return [0,0,0];
                    };

                    const makePlaneSeeds = (axis, posV, nG) => {
                        const s = [];
                        for (let ia = 0; ia < nG; ia++) {
                            for (let ib = 0; ib < nG; ib++) {
                                const ta = ia / (nG - 1), tb = ib / (nG - 1);
                                if (axis === 'x')
                                    s.push([xLo2+posV*(xHi2-xLo2), yLo2+ta*(yHi2-yLo2), zLo2+tb*(zHi2-zLo2)]);
                                else if (axis === 'y')
                                    s.push([xLo2+ta*(xHi2-xLo2), yLo2+posV*(yHi2-yLo2), zLo2+tb*(zHi2-zLo2)]);
                                else
                                    s.push([xLo2+ta*(xHi2-xLo2), yLo2+tb*(yHi2-yLo2), zLo2+posV*(zHi2-zLo2)]);
                            }
                        }
                        return s;
                    };

                    for (const pdef of flowMeta.particles) {
                        if (pdef.hide) continue;
                        const axis = pdef.axis || 'x';
                        const posV = parseFloat(pdef.position || '50%') / 100;
                        const seeds = makePlaneSeeds(axis, posV, curNGrid);
                        const nPart = seeds.length;
                        const pPositions = new Float32Array(nPart * 3);
                        const pGeom = new THREE.BufferGeometry();
                        pGeom.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
                        const pMat = new THREE.PointsMaterial({
                            size: 1.5 * (pdef.size || 2),
                            color: cssColorToHex(pdef.color || 'white'),
                            transparent: true, opacity: 0.85,
                            sizeAttenuation: false,
                        });
                        const pts3 = new THREE.Points(pGeom, pMat);
                        scene.add(pts3);

                        const domainLen0 = Math.max(xHi2-xLo2, yHi2-yLo2, zHi2-zLo2) || 1;
                        const scale0 = domainLen0 / ((vMax || 1) * 8);
                        const dtPre = 0.1;
                        for (let s = 0; s < seeds.length; s++) {
                            let [px, py, pz] = seeds[s];
                            const nSteps = Math.floor(Math.random() * 80);
                            for (let k = 0; k < nSteps; k++) {
                                const v0 = getVelocity(px, py, pz);
                                px += v0[0]*scale0*dtPre; py += (v0[1]||0)*scale0*dtPre; pz += (v0[2]||0)*scale0*dtPre;
                                if (px<xLo2||px>xHi2||py<yLo2||py>yHi2||pz<zLo2||pz>zHi2) {
                                    if (axis === 'x') { px=xLo2+posV*(xHi2-xLo2); py=yLo2+Math.random()*(yHi2-yLo2); pz=zLo2+Math.random()*(zHi2-zLo2); }
                                    else if (axis === 'y') { px=xLo2+Math.random()*(xHi2-xLo2); py=yLo2+posV*(yHi2-yLo2); pz=zLo2+Math.random()*(zHi2-zLo2); }
                                    else { px=xLo2+Math.random()*(xHi2-xLo2); py=yLo2+Math.random()*(yHi2-yLo2); pz=zLo2+posV*(zHi2-zLo2); }
                                }
                            }
                            seeds[s] = [px, py, pz];
                            pPositions[s*3]   = px - cx;
                            pPositions[s*3+1] = py - cy;
                            pPositions[s*3+2] = pz - cz;
                        }

                        particleGroups.push({ pid: pdef.id, pts3, pMat, pPositions, pGeom,
                                              seeds: seeds.map(s=>[...s]),
                                              initialSeeds: makePlaneSeeds(axis, posV, curNGrid),
                                              axis, posV,
                                              xLo:xLo2, xHi:xHi2, yLo:yLo2, yHi:yHi2, zLo:zLo2, zHi:zHi2,
                                              makePlaneSeeds });
                    }
                }

                const rebuildParticles = (nG) => {
                    curNGrid = nG;
                    for (const pg of particleGroups) {
                        const newSeeds = pg.makePlaneSeeds(pg.axis, pg.posV, nG);
                        const nPart = newSeeds.length;
                        const newPos = new Float32Array(nPart * 3);
                        for (let s = 0; s < newSeeds.length; s++) {
                            newPos[s*3]   = newSeeds[s][0] - cx;
                            newPos[s*3+1] = newSeeds[s][1] - cy;
                            newPos[s*3+2] = newSeeds[s][2] - cz;
                        }
                        pg.pGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
                        pg.pGeom.attributes.position.needsUpdate = true;
                        pg.seeds = newSeeds.map(s => [...s]);
                        pg.initialSeeds = newSeeds.map(s => [...s]);
                        pg.pPositions = newPos;
                    }
                };

                const advectParticles = (dt) => {
                    const domainLen = Math.max(xHi2-xLo2, yHi2-yLo2, zHi2-zLo2) || 1;
                    const vRefMax = vMax || 1;
                    const scale = (domainLen / (vRefMax * 8)) * curSpeed;
                    for (const pg of particleGroups) {
                        const { pPositions, pGeom, seeds,
                                xLo, xHi, yLo, yHi, zLo, zHi, axis, posV } = pg;
                        for (let s = 0; s < seeds.length; s++) {
                            let [px, py, pz] = seeds[s];
                            const v = getVelocity(px, py, pz);
                            px += v[0] * scale * dt;
                            py += (v[1]||0) * scale * dt;
                            pz += (v[2]||0) * scale * dt;
                            if (px < xLo || px > xHi || py < yLo || py > yHi || pz < zLo || pz > zHi) {
                                if (axis === 'x') { px=xLo+posV*(xHi-xLo); py=yLo+Math.random()*(yHi-yLo); pz=zLo+Math.random()*(zHi-zLo); }
                                else if (axis === 'y') { px=xLo+Math.random()*(xHi-xLo); py=yLo+posV*(yHi-yLo); pz=zLo+Math.random()*(zHi-zLo); }
                                else { px=xLo+Math.random()*(xHi-xLo); py=yLo+Math.random()*(yHi-yLo); pz=zLo+posV*(zHi-zLo); }
                            }
                            seeds[s] = [px, py, pz];
                            pPositions[s*3]   = px-cx;
                            pPositions[s*3+1] = py-cy;
                            pPositions[s*3+2] = pz-cz;
                        }
                        pGeom.attributes.position.needsUpdate = true;
                    }
                };

                // ── Toolbar wiring ────────────────────────────────────────
                const ptsBtn = panel.querySelector(`#pts-${sid}`);
                ptsBtn.addEventListener('click', () => {
                    ptCloud.visible = !ptCloud.visible;
                    ptsBtn.classList.toggle('active', ptCloud.visible);
                });

                const ctonBtn = panel.querySelector(`#cton-${sid}`);
                ctonBtn.addEventListener('click', () => {
                    contourGroup.visible = !contourGroup.visible;
                    ctonBtn.classList.toggle('active', contourGroup.visible);
                    rebuildContours();
                });

                panel.querySelector(`#op-${sid}`).addEventListener('input', (e) => {
                    curOpacity = e.target.value / 100;
                    ptUniforms.uOpacity.value = curOpacity;
                });

                panel.querySelector(`#glow-${sid}`).addEventListener('input', (e) => {
                    ptUniforms.uGlow.value = e.target.value / 100;
                });

                panel.querySelector(`#thin-${sid}`).addEventListener('input', (e) => {
                    ptUniforms.uThin.value = e.target.value / 100;
                });

                panel.querySelector(`#ct-${sid}`).addEventListener('input', (e) => {
                    curNContours = parseInt(e.target.value);
                    rebuildContours();
                });

                let autoRotate = false;
                const arBtn = panel.querySelector(`#ar-${sid}`);
                arBtn.addEventListener('click', () => {
                    autoRotate = !autoRotate;
                    controls.autoRotate = autoRotate;
                    arBtn.classList.toggle('active', autoRotate);
                });

                panel.querySelector(`#ps-${sid}`).addEventListener('input', (e) => {
                    const s = parseInt(e.target.value);
                    for (const pg of particleGroups) {
                        pg.pMat.size = s;
                        pg.pMat.needsUpdate = true;
                    }
                });

                panel.querySelector(`#pc-${sid}`).addEventListener('change', (e) => {
                    rebuildParticles(parseInt(e.target.value));
                });

                panel.querySelector(`#spd-${sid}`).addEventListener('input', (e) => {
                    curSpeed = e.target.value / 100;
                });

                const arrBtn = panel.querySelector(`#arr-${sid}`);
                arrBtn.addEventListener('click', () => {
                    arrowGroup.visible = !arrowGroup.visible;
                    arrBtn.classList.toggle('active', arrowGroup.visible);
                    rebuildArrows();
                });
                if (!isVector) arrBtn.style.display = 'none';

                const stmBtn = panel.querySelector(`#stm-${sid}`);
                stmBtn.addEventListener('click', () => {
                    streamGroup.visible = !streamGroup.visible;
                    stmBtn.classList.toggle('active', streamGroup.visible);
                    rebuildStreams();
                });
                if (!isFlow) stmBtn.style.display = 'none';

                for (const pg of particleGroups) {
                    const btn = panel.querySelector(`#par-${sid}-${pg.pid}`);
                    if (!btn) continue;
                    btn.addEventListener('click', () => {
                        pg.pts3.visible = !pg.pts3.visible;
                        btn.classList.toggle('active', pg.pts3.visible);
                    });
                }
                const parRstBtn = panel.querySelector(`#par-rst-${sid}`);
                if (parRstBtn) {
                    parRstBtn.addEventListener('click', () => {
                        for (const pg of particleGroups) {
                            pg.seeds.forEach((_s, i) => { pg.seeds[i] = [...pg.initialSeeds[i]]; });
                            for (let s = 0; s < pg.seeds.length; s++) {
                                const [px, py, pz] = pg.seeds[s];
                                pg.pPositions[s*3]   = px - cx;
                                pg.pPositions[s*3+1] = py - cy;
                                pg.pPositions[s*3+2] = pz - cz;
                            }
                            pg.pGeom.attributes.position.needsUpdate = true;
                        }
                    });
                }

                const scLoIn = panel.querySelector(`#sc-lo-${sid}`);
                const scHiIn = panel.querySelector(`#sc-hi-${sid}`);
                const applyScale = () => {
                    const lo = parseFloat(scLoIn.value), hi = parseFloat(scHiIn.value);
                    if (isNaN(lo) || isNaN(hi) || lo >= hi) return;
                    scLo = lo; scHi = hi;
                    refreshPointCloud();
                    rebuildContours();
                    rebuildArrows();
                };
                scLoIn.addEventListener('change', applyScale);
                scHiIn.addEventListener('change', applyScale);

                panel.querySelector(`#sc-rst-${sid}`).addEventListener('click', () => {
                    scLo = vMin; scHi = vMax;
                    scLoIn.value = vMin.toFixed(4);
                    scHiIn.value = vMax.toFixed(4);
                    refreshPointCloud();
                    rebuildContours();
                    rebuildArrows();
                });

                panel.querySelector(`#fit-${sid}`).addEventListener('click', () => setCameraView('3d'));
                panel.querySelector(`#vxy-${sid}`).addEventListener('click', () => setCameraView('xy'));
                panel.querySelector(`#vxz-${sid}`).addEventListener('click', () => setCameraView('xz'));
                panel.querySelector(`#vyz-${sid}`).addEventListener('click', () => setCameraView('yz'));
                panel.querySelector(`#v3d-${sid}`).addEventListener('click', () => setCameraView('3d'));

                const ro = new ResizeObserver(() => {
                    const nw = canvasWrap.clientWidth || canvas.clientWidth;
                    const nh = canvasWrap.clientHeight || canvas.clientHeight;
                    if (!nw || !nh) return;
                    renderer.setSize(nw, nh);
                    camera.aspect = nw / nh;
                    camera.updateProjectionMatrix();
                });
                ro.observe(canvasWrap);

                let particlesPaused = false;
                const pauseBtn = panel.querySelector(`#par-pause-${sid}`);
                if (pauseBtn) {
                    pauseBtn.addEventListener('click', () => {
                        particlesPaused = !particlesPaused;
                        pauseBtn.querySelector('.rp-flow-pause-icon').style.display = particlesPaused ? 'none' : '';
                        pauseBtn.querySelector('.rp-flow-play-icon').style.display = particlesPaused ? '' : 'none';
                        pauseBtn.querySelector('.rp-flow-pause-label').textContent = particlesPaused ? 'Play' : 'Pause';
                        pauseBtn.classList.toggle('active', !particlesPaused);
                    });
                }

                // ── Animate ───────────────────────────────────────────────
                let lastTime = performance.now();
                const animate = () => {
                    requestAnimationFrame(animate);
                    const now = performance.now();
                    const dt = Math.min((now - lastTime) / 1000, 0.1);
                    lastTime = now;
                    if (particleGroups.length > 0 && !particlesPaused) advectParticles(dt);
                    controls.update();
                    renderer.render(scene, camera);
                };
                animate();
            }; // end _initThree

            const _tryInit = () => {
                const nw = canvasWrap.clientWidth;
                const nh = canvasWrap.clientHeight;
                if (nw > 0 && nh > 0) {
                    _initThree(nw, nh);
                    return true;
                }
                return false;
            };
            if (!_tryInit()) {
                const _visObs = new IntersectionObserver((entries) => {
                    if (entries[0].isIntersecting) {
                        _visObs.disconnect();
                        requestAnimationFrame(() => _tryInit());
                    }
                }, { threshold: 0 });
                _visObs.observe(canvasWrap);
            }

            return item;
        },
    });

})();
