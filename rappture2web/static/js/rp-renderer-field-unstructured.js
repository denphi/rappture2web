/**
 * rp-renderer-field-unstructured.js
 *
 * Registers the 'field_unstructured' renderer for 3D unstructured scalar
 * fields, rendered as Plotly isosurface or volume plots.
 */
(function () {
    'use strict';

    const inputStyle = rappture._rpUtils.inputStyle;

    rappture._registerRenderer('field_unstructured', {
        render(id, data) {
            const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'field');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            const firstComp = (data.components || [])[0];
            const firstMesh = firstComp && firstComp.mesh;

            // Use pre-interpolated uniform grid if available (scipy griddata on server),
            // otherwise fall back to raw scattered points (isosurface may look sparse).
            const gd = firstComp.grid_data;
            const pts = firstMesh.points;
            const vals = firstComp.values || [];
            const px = gd ? gd.x : pts.map(p => p[0]);
            const py = gd ? gd.y : pts.map(p => p[1]);
            const pz = gd ? gd.z : pts.map(p => p[2]);
            const pv = gd ? gd.value : pts.map((_, i) => vals[i] ?? 0);

            let vmin = Infinity, vmax = -Infinity;
            for (let i = 0; i < pv.length; i++) {
                const v = pv[i]; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
            }
            console.log('[rp field_unstructured] id=%s gd=%s pts=%d vmin=%s vmax=%s', id, !!gd, px.length, vmin, vmax);

            const fldLabel3u = ((data.about && data.about.label) || data.label || id);
            const units3u = firstMesh.units || '';
            const mkLbl3u = (ax) => ax + (units3u ? ` [${units3u}]` : '');

            const colorscales = ['Viridis','Plasma','Inferno','Magma','Cividis','RdBu','Spectral','Jet','Hot','Blues'];
            const sid = id.replace(/[^a-z0-9_-]/gi, '_');

            const cp = document.createElement('div');
            cp.className = 'rp-3d-panel';
            cp.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Title</div>
                <label>Plot<input type="text" id="fld3u-ttl-${sid}" value="${fldLabel3u}" style="width:100%;margin-top:2px"></label>
                <label>X Axis<input type="text" id="fld3u-xl-${sid}" value="${mkLbl3u('X')}" style="width:100%;margin-top:2px"></label>
                <label>Y Axis<input type="text" id="fld3u-yl-${sid}" value="${mkLbl3u('Y')}" style="width:100%;margin-top:2px"></label>
                <label>Z Axis<input type="text" id="fld3u-zl-${sid}" value="${mkLbl3u('Z')}" style="width:100%;margin-top:2px"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Isosurfaces</div>
                <label>Surfaces<input type="range" id="fld3u-ns-${sid}" min="1" max="20" step="1" value="10"><span id="fld3u-ns-v-${sid}">10</span></label>
                <label>Opacity<input type="range" id="fld3u-op-${sid}" min="0.05" max="1" step="0.05" value="0.6"><span id="fld3u-op-v-${sid}">0.6</span></label>
                <label>Value Min<input type="number" id="fld3u-lo-${sid}" value="${vmin.toFixed(4)}" step="any"></label>
                <label>Value Max<input type="number" id="fld3u-hi-${sid}" value="${vmax.toFixed(4)}" step="any"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Color Scale</div>
                <select id="fld3u-cs-${sid}">${colorscales.map(c=>`<option${c==='Viridis'?' selected':''}>${c}</option>`).join('')}</select>
                <label style="margin-top:4px"><input type="checkbox" id="fld3u-rev-${sid}"> Reverse</label>
              </div>
              ${rappture._rpUtils.displaySectionHtml('fld3u', sid, {mt:50,mb:20,ml:20,mr:20})}
              <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <button class="rp-3d-btn" id="fld3u-png-${sid}">PNG</button>
                <button class="rp-3d-btn" id="fld3u-dl-json-${sid}">JSON</button>
              </div>`;

            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';
            plotDiv.id = 'fld3u-' + id;

            const fld3uPanelWrap = document.createElement('div');
            fld3uPanelWrap.className = 'rp-3d-panel-wrap';
            const fld3uTab = document.createElement('div');
            fld3uTab.className = 'rp-3d-panel-tab';
            fld3uTab.title = 'Toggle control panel';
            fld3uTab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';
            fld3uPanelWrap.appendChild(fld3uTab);
            fld3uPanelWrap.appendChild(cp);
            const outerWrap = document.createElement('div');
            outerWrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;align-items:stretch;';
            outerWrap.appendChild(plotDiv);
            outerWrap.appendChild(fld3uPanelWrap);
            body.appendChild(outerWrap);
            fld3uTab.addEventListener('click', () => {
                fld3uPanelWrap.classList.toggle('collapsed');
                setTimeout(() => Plotly.relayout(plotDiv, { autosize: true }), 220);
            });

            const _fld3uKey = 'rp2w:fld3u:' + window.location.pathname + ':' + id;
            const _fld3uSave = () => {
                const s = {};
                ['fld3u-ttl','fld3u-xl','fld3u-yl','fld3u-zl','fld3u-cs','fld3u-op','fld3u-ns','fld3u-lo','fld3u-hi'].forEach(k => {
                    const el = cp.querySelector(`#${k}-${sid}`); if (el) s[k] = el.value;
                });
                const rev = cp.querySelector(`#fld3u-rev-${sid}`); if (rev) s['fld3u-rev'] = rev.checked;
                try { localStorage.setItem(_fld3uKey, JSON.stringify(s)); } catch(e) {}
            };
            const _fld3uLoad = () => {
                try {
                    const s = JSON.parse(localStorage.getItem(_fld3uKey) || 'null');
                    if (!s) return;
                    ['fld3u-ttl','fld3u-xl','fld3u-yl','fld3u-zl','fld3u-cs','fld3u-op','fld3u-ns','fld3u-lo','fld3u-hi'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${sid}`); if (el && s[k] !== undefined) el.value = s[k];
                    });
                    const rev = cp.querySelector(`#fld3u-rev-${sid}`);
                    if (rev && s['fld3u-rev'] !== undefined) rev.checked = s['fld3u-rev'];
                } catch(e) {}
            };

            const _mkTraces3u = (cs, rev, op, ns, lo, hi) => {
                if (!gd) {
                    return [{
                        type: 'isosurface',
                        x: px, y: py, z: pz, value: pv,
                        isomin: lo, isomax: hi, opacity: op,
                        surface: { count: ns }, colorscale: cs, reversescale: rev,
                        showscale: true,
                        caps: { x: { show: false }, y: { show: false }, z: { show: false } },
                    }];
                }
                return [{
                    type: 'volume',
                    x: px, y: py, z: pz, value: pv,
                    isomin: lo, isomax: hi,
                    opacity: op,
                    surface: { count: ns },
                    colorscale: cs, reversescale: rev,
                    showscale: true,
                    caps: { x: { show: false }, y: { show: false }, z: { show: false } },
                }];
            };

            const _mkLayout3u = (xl, yl, zl, ttl, cam) => ({
                scene: {
                    xaxis: { title: xl },
                    yaxis: { title: yl },
                    zaxis: { title: zl },
                    ...(cam ? { camera: cam } : {}),
                },
                title: { text: ttl },
                margin: { t: 50, r: 20, b: 20, l: 20 },
                template: _rpPlotlyTemplates['plotly'], autosize: true,
            });

            _fld3uLoad();
            const _initCs  = cp.querySelector(`#fld3u-cs-${sid}`).value || 'Viridis';
            const _initRev = cp.querySelector(`#fld3u-rev-${sid}`).checked;
            const _initOp  = parseFloat(cp.querySelector(`#fld3u-op-${sid}`).value) || 0.6;
            const _initNs  = parseInt(cp.querySelector(`#fld3u-ns-${sid}`).value) || 10;
            const _initLo  = parseFloat(cp.querySelector(`#fld3u-lo-${sid}`).value);
            const _initHi  = parseFloat(cp.querySelector(`#fld3u-hi-${sid}`).value);

            _whenVisible(outerWrap, () => {
                const _initLayout3u = _mkLayout3u(mkLbl3u('X'), mkLbl3u('Y'), mkLbl3u('Z'), fldLabel3u, null);
                rappture._rpUtils.storeBaseLayout(plotDiv, _initLayout3u);
                Plotly.newPlot(plotDiv,
                    _mkTraces3u(_initCs, _initRev, _initOp, _initNs,
                        isFinite(_initLo) ? _initLo : vmin,
                        isFinite(_initHi) ? _initHi : vmax),
                    _initLayout3u,
                    { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));

                const applyOpts3u = () => {
                    const cs  = cp.querySelector(`#fld3u-cs-${sid}`).value;
                    const rev = cp.querySelector(`#fld3u-rev-${sid}`).checked;
                    const op  = parseFloat(cp.querySelector(`#fld3u-op-${sid}`).value);
                    const ns  = parseInt(cp.querySelector(`#fld3u-ns-${sid}`).value);
                    const lo  = parseFloat(cp.querySelector(`#fld3u-lo-${sid}`).value);
                    const hi  = parseFloat(cp.querySelector(`#fld3u-hi-${sid}`).value);
                    cp.querySelector(`#fld3u-ns-v-${sid}`).textContent = ns;
                    cp.querySelector(`#fld3u-op-v-${sid}`).textContent = op;
                    _fld3uSave();
                    const cam = plotDiv._fullLayout && plotDiv._fullLayout.scene
                        ? plotDiv._fullLayout.scene.camera : null;
                    Plotly.react(plotDiv, _mkTraces3u(cs, rev, op, ns, lo, hi),
                        _mkLayout3u(
                            cp.querySelector(`#fld3u-xl-${sid}`).value,
                            cp.querySelector(`#fld3u-yl-${sid}`).value,
                            cp.querySelector(`#fld3u-zl-${sid}`).value,
                            cp.querySelector(`#fld3u-ttl-${sid}`).value,
                            cam));
                };

                cp.querySelectorAll('input, select').forEach(el =>
                    el.addEventListener(el.type === 'range' || el.type === 'number' ? 'input' : 'change', applyOpts3u)
                );
                cp.querySelectorAll('input[type=text]').forEach(el =>
                    el.addEventListener('input', applyOpts3u)
                );

                rappture._rpUtils.wireDisplayControls(cp, plotDiv, 'fld3u', sid, true);

                cp.querySelector(`#fld3u-png-${sid}`).addEventListener('click', () =>
                    Plotly.downloadImage(plotDiv, { format: 'png', filename: fldLabel3u.replace(/[^a-z0-9]/gi, '_') }));
                rappture._rpUtils.wireDownloadData(cp, data, fldLabel3u.replace(/[^a-z0-9]/gi, '_'), 'fld3u', sid);
            });

            return item;
        },
    });

})();
