/**
 * rp-renderer-field-3d.js
 *
 * Registers the 'field_3d' renderer for 3D scalar grid fields rendered as
 * Plotly volume plots.
 */
(function () {
    'use strict';

    const _mkAxis = rappture._rpUtils.mkAxis;
    const inputStyle = rappture._rpUtils.inputStyle;

    rappture._registerRenderer('field_3d', {
        render(id, data) {
            const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'field');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            const firstComp = (data.components || [])[0];
            const firstMesh = firstComp && firstComp.mesh;

            const axes = firstMesh.axes;
            const xs = _mkAxis(axes.x), ys = _mkAxis(axes.y), zs = _mkAxis(axes.z);
            const vals = firstComp.values || [];
            const nx = xs.length, ny = ys.length, nz = zs.length;

            // Expand flat x-major values into per-point x/y/z/value arrays
            const px = [], py = [], pz = [], pv = [];
            for (let ix = 0; ix < nx; ix++)
                for (let iy = 0; iy < ny; iy++)
                    for (let iz = 0; iz < nz; iz++) {
                        px.push(xs[ix]); py.push(ys[iy]); pz.push(zs[iz]);
                        pv.push(vals[ix * ny * nz + iy * nz + iz] ?? 0);
                    }

            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';
            plotDiv.id = 'fld3d-' + id;
            const sid = id.replace(/[^a-z0-9_-]/gi, '_');

            const units = firstMesh.units || '';
            const mkLbl = (ax) => ax + (units ? ` [${units}]` : '');

            let _vmin3d = Infinity, _vmax3d = -Infinity;
            for (let i = 0; i < pv.length; i++) { if (pv[i] < _vmin3d) _vmin3d = pv[i]; if (pv[i] > _vmax3d) _vmax3d = pv[i]; }

            const traces = [{
                type: 'volume',
                x: px, y: py, z: pz, value: pv,
                isomin: _vmin3d, isomax: _vmax3d,
                opacity: 0.2,
                surface: { count: 8 },
                colorscale: 'Viridis',
                reversescale: false,
                showscale: true,
                caps: { x: { show: false }, y: { show: false }, z: { show: false } },
            }];

            const layout = {
                scene: {
                    xaxis: { title: mkLbl('X') },
                    yaxis: { title: mkLbl('Y') },
                    zaxis: { title: mkLbl('Z') },
                },
                margin: { t: 50, r: 20, b: 20, l: 20 },
                template: _rpPlotlyTemplates['plotly'],
                autosize: true,
            };

            const cp = document.createElement('div');
            cp.className = 'rp-3d-panel';
            cp.style.maxHeight = 'none';
            cp.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Title</div>
                <label>Plot title<input type="text" id="fld3-ttl-${sid}" value="" placeholder="(none)" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Axes</div>
                <label>X label<input type="text" id="fld3-xl-${sid}" value="${mkLbl('X')}" style="${inputStyle}"></label>
                <label>Y label<input type="text" id="fld3-yl-${sid}" value="${mkLbl('Y')}" style="${inputStyle}"></label>
                <label>Z label<input type="text" id="fld3-zl-${sid}" value="${mkLbl('Z')}" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Volume</div>
                <label>Opacity<input type="range" id="fld3-op-${sid}" min="0.01" max="1" step="0.01" value="0.2"></label>
                <label>Surfaces<input type="range" id="fld3-ns-${sid}" min="2" max="20" step="1" value="8"></label>
                <label>Min value<input type="number" id="fld3-lo-${sid}" value="${_vmin3d.toFixed(4)}" step="any" style="${inputStyle}"></label>
                <label>Max value<input type="number" id="fld3-hi-${sid}" value="${_vmax3d.toFixed(4)}" step="any" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Color scale</div>
                <select id="fld3-cs-${sid}" style="${inputStyle}">
                  <option value="Viridis" selected>Viridis</option>
                  <option value="Plasma">Plasma</option>
                  <option value="RdBu">RdBu</option>
                  <option value="Hot">Hot</option>
                  <option value="Jet">Jet</option>
                  <option value="Greys">Greys</option>
                  <option value="YlOrRd">YlOrRd</option>
                  <option value="Bluered">Bluered</option>
                </select>
                <label style="flex-direction:row;align-items:center;gap:6px;margin-top:4px">
                  <input type="checkbox" id="fld3-rev-${sid}"> Reverse
                </label>
              </div>
              ${rappture._rpUtils.displaySectionHtml('fld3', sid, {mt:50,mb:20,ml:20,mr:20})}
              <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn" id="fld3-png-${sid}">PNG</button>
                </div>
              </div>`;

            const fld3PanelWrap = document.createElement('div');
            fld3PanelWrap.className = 'rp-3d-panel-wrap';
            const fld3Tab = document.createElement('div');
            fld3Tab.className = 'rp-3d-panel-tab';
            fld3Tab.title = 'Toggle control panel';
            fld3Tab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';
            fld3PanelWrap.appendChild(fld3Tab);
            fld3PanelWrap.appendChild(cp);
            const outerWrap = document.createElement('div');
            outerWrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;align-items:stretch;';
            outerWrap.appendChild(plotDiv);
            outerWrap.appendChild(fld3PanelWrap);
            body.appendChild(outerWrap);
            fld3Tab.addEventListener('click', () => {
                fld3PanelWrap.classList.toggle('collapsed');
                setTimeout(() => Plotly.relayout(plotDiv, { autosize: true }), 220);
            });

            const _fld3Key = 'rp2w:fld3:' + window.location.pathname + ':' + id;
            const _fld3Save = () => {
                const s = {};
                ['fld3-ttl','fld3-xl','fld3-yl','fld3-zl','fld3-cs'].forEach(k => {
                    const el = cp.querySelector(`#${k}-${sid}`); if (el) s[k] = el.value;
                });
                ['fld3-op','fld3-ns','fld3-lo','fld3-hi'].forEach(k => {
                    const el = cp.querySelector(`#${k}-${sid}`); if (el) s[k] = el.value;
                });
                const rev = cp.querySelector(`#fld3-rev-${sid}`); if (rev) s['fld3-rev'] = rev.checked;
                try { localStorage.setItem(_fld3Key, JSON.stringify(s)); } catch(e) {}
            };
            const _fld3Load = () => {
                try {
                    const s = JSON.parse(localStorage.getItem(_fld3Key) || 'null');
                    if (!s) return;
                    ['fld3-ttl','fld3-xl','fld3-yl','fld3-zl','fld3-cs','fld3-op','fld3-ns','fld3-lo','fld3-hi'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${sid}`); if (el && s[k] !== undefined) el.value = s[k];
                    });
                    const rev = cp.querySelector(`#fld3-rev-${sid}`);
                    if (rev && s['fld3-rev'] !== undefined) rev.checked = s['fld3-rev'];
                } catch(e) {}
            };
            _fld3Load();

            _whenVisible(outerWrap, () => {
                rappture._rpUtils.storeBaseLayout(plotDiv, layout);
                Plotly.newPlot(plotDiv, traces, layout, { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));

                const applyOpts = () => {
                    const cs = cp.querySelector(`#fld3-cs-${sid}`).value;
                    const rev = cp.querySelector(`#fld3-rev-${sid}`).checked;
                    const op = parseFloat(cp.querySelector(`#fld3-op-${sid}`).value);
                    const ns = parseInt(cp.querySelector(`#fld3-ns-${sid}`).value);
                    const lo = parseFloat(cp.querySelector(`#fld3-lo-${sid}`).value);
                    const hi = parseFloat(cp.querySelector(`#fld3-hi-${sid}`).value);
                    const fs    = parseFloat((cp.querySelector(`#fld3-fontsize-${sid}`) || {}).value) || 12;
                    const mt    = parseInt((cp.querySelector(`#fld3-mt-${sid}`) || {}).value) || 50;
                    const mb    = parseInt((cp.querySelector(`#fld3-mb-${sid}`) || {}).value) || 20;
                    const ml    = parseInt((cp.querySelector(`#fld3-ml-${sid}`) || {}).value) || 20;
                    const mr    = parseInt((cp.querySelector(`#fld3-mr-${sid}`) || {}).value) || 20;
                    const themeName = (cp.querySelector(`#fld3-theme-${sid}`) || {}).value || 'plotly';
                    const template = _rpPlotlyTemplates[themeName] || {};
                    _fld3Save();
                    Plotly.react(plotDiv, [{
                        type: 'volume',
                        x: px, y: py, z: pz, value: pv,
                        isomin: lo, isomax: hi,
                        opacity: op,
                        surface: { count: ns },
                        colorscale: cs, reversescale: rev,
                        showscale: true,
                        caps: { x: { show: false }, y: { show: false }, z: { show: false } },
                    }], {
                        ...plotDiv._fullLayout ? {
                            scene: {
                                xaxis: { title: cp.querySelector(`#fld3-xl-${sid}`).value },
                                yaxis: { title: cp.querySelector(`#fld3-yl-${sid}`).value },
                                zaxis: { title: cp.querySelector(`#fld3-zl-${sid}`).value },
                                camera: plotDiv._fullLayout.scene.camera,
                            },
                            'title.text': cp.querySelector(`#fld3-ttl-${sid}`).value,
                        } : {},
                        margin: { t: mt, r: mr, b: mb, l: ml },
                        template,
                        font: { size: fs },
                        autosize: true,
                    });
                };

                cp.querySelectorAll('input, select').forEach(el =>
                    el.addEventListener(el.type === 'range' || el.type === 'number' ? 'input' : 'change', applyOpts)
                );
                cp.querySelectorAll('input[type=text]').forEach(el =>
                    el.addEventListener('input', applyOpts)
                );

                applyOpts();

                const fldLabel = ((data.about && data.about.label) || data.label || id).replace(/[^a-z0-9]/gi, '_');
                cp.querySelector(`#fld3-png-${sid}`).addEventListener('click', () =>
                    Plotly.downloadImage(plotDiv, { format: 'png', filename: fldLabel }));
            });

            return item;
        },
    });

})();
