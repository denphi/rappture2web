/**
 * rp-renderer-field-vtk.js
 *
 * Registers the 'field_vtk' renderer for VTK STRUCTURED_POINTS fields
 * rendered as Plotly volume/isosurface plots.
 */
(function () {
    'use strict';

    const inputStyle = rappture._rpUtils.inputStyle;

    rappture._registerRenderer('field_vtk', {
        render(id, data) {
            const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'field');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            const firstComp = (data.components || [])[0];

            // Expand ALL VTK components into separate coordinate arrays
            const vtkComps = (data.components || []).filter(c => c.vtk_type === 'structured_points' && c.grid_data);

            const expandVtk = (gd) => {
                const { nx, ny, nz, dx, dy, dz, ox, oy, oz } = gd;
                const total = nx * ny * nz;
                const px = new Float32Array(total);
                const py = new Float32Array(total);
                const pz = new Float32Array(total);
                const pv = new Float32Array(total);
                let k = 0;
                for (let iz = 0; iz < nz; iz++)
                    for (let iy = 0; iy < ny; iy++)
                        for (let ix = 0; ix < nx; ix++, k++) {
                            px[k] = ox + ix * dx;
                            py[k] = oy + iy * dy;
                            pz[k] = oz + iz * dz;
                            pv[k] = gd.values[k] ?? 0;
                        }
                let vmin = Infinity, vmax = -Infinity;
                for (let i = 0; i < pv.length; i++) { if (pv[i] < vmin) vmin = pv[i]; if (pv[i] > vmax) vmax = pv[i]; }
                return { px, py, pz, pv, vmin, vmax, scalar: gd.scalar_name || '' };
            };

            // Pre-expand all components
            const expanded = vtkComps.map(c => ({ ...expandVtk(c.grid_data), comp_id: c.comp_id, style: c.style || '' }));
            const main = expanded[0];
            const vmin = main.vmin, vmax = main.vmax;

            // Parse style string "-color X -opacity Y -levels N"
            const parseStyle = (styleStr) => {
                const m = (key) => { const r = new RegExp(`-${key}\\s+(\\S+)`); const m2 = r.exec(styleStr); return m2 ? m2[1] : null; };
                return { color: m('color'), opacity: parseFloat(m('opacity') || '0.2'), levels: parseInt(m('levels') || '3') };
            };

            const sid = id.replace(/[^a-z0-9_-]/gi, '_');
            const fldLabelVtk = (data.label && data.label !== id ? data.label : '')
                || main.scalar || id;
            const colorscales = ['Viridis','Plasma','Inferno','Magma','Cividis','RdBu','Spectral','Jet','Hot','Blues'];

            const cp = document.createElement('div');
            cp.className = 'rp-3d-panel';
            cp.style.maxHeight = 'none';
            cp.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Title</div>
                <label>Plot<input type="text" id="fld3v-ttl-${sid}" value="${fldLabelVtk}" placeholder="(none)" style="${inputStyle}"></label>
                <label>Colorbar<input type="text" id="fld3v-cbtl-${sid}" value="${main.scalar || ''}" placeholder="(none)" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Render Mode</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn active" id="fld3v-iso-${sid}">Isosurfaces</button>
                  <button class="rp-3d-btn" id="fld3v-vol-${sid}">Volume</button>
                </div>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Axes</div>
                <label>X Label<input type="text" id="fld3v-xl-${sid}" value="X" style="${inputStyle}"></label>
                <label>Y Label<input type="text" id="fld3v-yl-${sid}" value="Y" style="${inputStyle}"></label>
                <label>Z Label<input type="text" id="fld3v-zl-${sid}" value="Z" style="${inputStyle}"></label>
                <label style="margin-top:4px">Aspect
                  <select id="fld3v-asp-${sid}" style="${inputStyle}">
                    <option value="data" selected>Data (proportional)</option>
                    <option value="cube">Cube</option>
                    <option value="auto">Auto</option>
                  </select>
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Field: ${main.scalar || 'wf'}</div>
                <label>Surfaces<input type="range" id="fld3v-ns-${sid}" min="1" max="20" step="1" value="10"><span id="fld3v-ns-v-${sid}">10</span></label>
                <label>Opacity<input type="range" id="fld3v-op-${sid}" min="0.05" max="1" step="0.05" value="0.6"><span id="fld3v-op-v-${sid}">0.6</span></label>
                <label>Value Min<input type="number" id="fld3v-lo-${sid}" value="${vmin.toFixed(4)}" step="any" style="${inputStyle}"></label>
                <label>Value Max<input type="number" id="fld3v-hi-${sid}" value="${vmax.toFixed(4)}" step="any" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Color Scale</div>
                <select id="fld3v-cs-${sid}" style="${inputStyle}">${colorscales.map(c=>`<option${c==='Viridis'?' selected':''}>${c}</option>`).join('')}</select>
                <label style="margin-top:4px;flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-rev-${sid}"> Reverse</label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Display</div>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-leg-${sid}" checked> Legend</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-xgrid-${sid}" checked> X Grid</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-ygrid-${sid}" checked> Y Grid</label>
                <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-zgrid-${sid}" checked> Z Grid</label>
              </div>
              ${rappture._rpUtils.displaySectionHtml('fld3v', sid, {mt:50,mb:20,ml:20,mr:20})}
              <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn" id="fld3v-svg-${sid}">SVG</button>
                  <button class="rp-3d-btn" id="fld3v-png-${sid}">PNG</button>
                  <button class="rp-3d-btn" id="fld3v-dl-json-${sid}">JSON</button>
                </div>
              </div>`;

            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';

            // Collapsible sidecar
            const panelWrap = document.createElement('div');
            panelWrap.className = 'rp-3d-panel-wrap';

            const tab = document.createElement('div');
            tab.className = 'rp-3d-panel-tab';
            tab.title = 'Toggle control panel';
            tab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';

            panelWrap.appendChild(tab);
            panelWrap.appendChild(cp);

            const outerWrap = document.createElement('div');
            outerWrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;align-items:stretch;';
            outerWrap.appendChild(plotDiv);
            outerWrap.appendChild(panelWrap);
            body.appendChild(outerWrap);

            tab.addEventListener('click', () => {
                panelWrap.classList.toggle('collapsed');
                setTimeout(() => Plotly.relayout(plotDiv, { autosize: true }), 220);
            });

            let _vtkMode = 'iso'; // 'iso' | 'vol'

            _whenVisible(outerWrap, () => {
                const _getLayout = () => {
                    const themeName = cp.querySelector(`#fld3v-theme-${sid}`).value || 'plotly';
                    const theme = _rpPlotlyTemplates[themeName] || {};
                    const asp     = cp.querySelector(`#fld3v-asp-${sid}`).value;
                    const showleg = cp.querySelector(`#fld3v-leg-${sid}`).checked;
                    const xgrid   = cp.querySelector(`#fld3v-xgrid-${sid}`).checked;
                    const ygrid   = cp.querySelector(`#fld3v-ygrid-${sid}`).checked;
                    const zgrid   = cp.querySelector(`#fld3v-zgrid-${sid}`).checked;
                    const ttl     = cp.querySelector(`#fld3v-ttl-${sid}`).value;
                    const xl      = cp.querySelector(`#fld3v-xl-${sid}`).value;
                    const yl      = cp.querySelector(`#fld3v-yl-${sid}`).value;
                    const zl      = cp.querySelector(`#fld3v-zl-${sid}`).value;
                    const fs      = parseFloat((cp.querySelector(`#fld3v-fontsize-${sid}`) || {}).value) || 12;
                    const mt      = parseInt((cp.querySelector(`#fld3v-mt-${sid}`) || {}).value) || 50;
                    const mb      = parseInt((cp.querySelector(`#fld3v-mb-${sid}`) || {}).value) || 20;
                    const ml      = parseInt((cp.querySelector(`#fld3v-ml-${sid}`) || {}).value) || 20;
                    const mr      = parseInt((cp.querySelector(`#fld3v-mr-${sid}`) || {}).value) || 20;
                    const cam     = plotDiv._fullLayout && plotDiv._fullLayout.scene
                        ? plotDiv._fullLayout.scene.camera : null;
                    return {
                        scene: {
                            xaxis: { title: xl, showgrid: xgrid },
                            yaxis: { title: yl, showgrid: ygrid },
                            zaxis: { title: zl, showgrid: zgrid },
                            aspectmode: asp,
                            ...(cam ? { camera: cam } : {}),
                        },
                        title: { text: ttl },
                        showlegend: showleg,
                        legend: { x: 0, y: 1, font: { size: fs } },
                        margin: { t: mt, r: mr, b: mb, l: ml },
                        template: theme,
                        font: { size: fs },
                        autosize: true,
                    };
                };

                const _mkTracesVtk = (cs, rev, op, ns, lo, hi) => {
                    const caps = _vtkMode === 'vol'
                        ? { x: { show: true }, y: { show: true }, z: { show: true } }
                        : { x: { show: false }, y: { show: false }, z: { show: false } };
                    const cbtl = cp.querySelector(`#fld3v-cbtl-${sid}`).value;
                    const traces = [{
                        type: 'volume',
                        name: main.scalar || 'wf',
                        x: Array.from(main.px), y: Array.from(main.py), z: Array.from(main.pz),
                        value: Array.from(main.pv),
                        isomin: lo, isomax: hi, opacity: op,
                        surface: { count: ns }, colorscale: cs, reversescale: rev,
                        colorbar: { title: { text: cbtl } },
                        showscale: true, showlegend: true, caps,
                    }];
                    expanded.slice(1).forEach((c) => {
                        const sty = parseStyle(c.style);
                        traces.push({
                            type: 'volume',
                            name: c.comp_id || 'overlay',
                            x: Array.from(c.px), y: Array.from(c.py), z: Array.from(c.pz),
                            value: Array.from(c.pv),
                            isomin: c.vmin + (c.vmax - c.vmin) * 0.3, isomax: c.vmax,
                            opacity: sty.opacity,
                            surface: { count: sty.levels || 3 },
                            colorscale: [[0,'rgba(0,200,0,0)'],[1,'rgba(0,200,0,1)']],
                            showscale: false, showlegend: true,
                            caps: { x: { show: false }, y: { show: false }, z: { show: false } },
                        });
                    });
                    return traces;
                };

                const applyVtk = () => {
                    const cs  = cp.querySelector(`#fld3v-cs-${sid}`).value;
                    const rev = cp.querySelector(`#fld3v-rev-${sid}`).checked;
                    const op  = parseFloat(cp.querySelector(`#fld3v-op-${sid}`).value);
                    const ns  = parseInt(cp.querySelector(`#fld3v-ns-${sid}`).value);
                    const lo  = parseFloat(cp.querySelector(`#fld3v-lo-${sid}`).value);
                    const hi  = parseFloat(cp.querySelector(`#fld3v-hi-${sid}`).value);
                    cp.querySelector(`#fld3v-ns-v-${sid}`).textContent = ns;
                    cp.querySelector(`#fld3v-op-v-${sid}`).textContent = op.toFixed(2);
                    Plotly.react(plotDiv, _mkTracesVtk(cs, rev, op, ns, lo, hi), _getLayout());
                };

                Plotly.newPlot(plotDiv,
                    _mkTracesVtk('Viridis', false, 0.6, 10, vmin, vmax),
                    _getLayout(), { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));

                // Render mode toggle
                const isoBtn = cp.querySelector(`#fld3v-iso-${sid}`);
                const volBtn = cp.querySelector(`#fld3v-vol-${sid}`);
                isoBtn.addEventListener('click', () => {
                    _vtkMode = 'iso';
                    isoBtn.classList.add('active'); volBtn.classList.remove('active');
                    applyVtk();
                });
                volBtn.addEventListener('click', () => {
                    _vtkMode = 'vol';
                    volBtn.classList.add('active'); isoBtn.classList.remove('active');
                    applyVtk();
                });

                cp.querySelectorAll('input[type=range], input[type=number]').forEach(el =>
                    el.addEventListener('input', applyVtk));
                cp.querySelectorAll('input[type=text]').forEach(el =>
                    el.addEventListener('input', applyVtk));
                cp.querySelectorAll('select, input[type=checkbox]').forEach(el =>
                    el.addEventListener('change', applyVtk));

                const fname = fldLabelVtk.replace(/[^a-z0-9]/gi, '_');
                cp.querySelector(`#fld3v-svg-${sid}`).addEventListener('click', () =>
                    Plotly.downloadImage(plotDiv, { format: 'svg', filename: fname }));
                cp.querySelector(`#fld3v-png-${sid}`).addEventListener('click', () =>
                    Plotly.downloadImage(plotDiv, { format: 'png', filename: fname }));
                rappture._rpUtils.wireDownloadData(cp, data, fname, 'fld3v', sid);
            });

            return item;
        },
    });

})();
