/**
 * rp-renderer-field.js
 *
 * Registers the 'field' dispatcher that classifies field data and delegates
 * to sub-type renderers (field_2d, field_3d, field_vtk, field_unstructured,
 * field_vector). Also registers the 'field_2d' renderer (2D scalar grid
 * heatmap) and the field compare handler.
 */
(function () {
    'use strict';

    const _mkAxis = rappture._rpUtils.mkAxis;
    const inputStyle = rappture._rpUtils.inputStyle;

    // ── field dispatcher ────────────────────────────────────────────────────
    rappture._registerRenderer('field', {
        render(id, data) {
            const subtype = rappture._classifyField(data);
            const key = 'field_' + subtype;
            const entry = rappture._rendererRegistry[key];
            if (entry && typeof entry.render === 'function') {
                return entry.render.call(rappture, id, data);
            }
            // Fallback: show unknown subtype message
            const item = rappture.createOutputItem(
                (data.about && data.about.label) || data.label || id, 'field');
            item.querySelector('.rp-output-body').innerHTML =
                '<p style="padding:14px;color:var(--rp-text-muted)">Unknown field sub-type: ' + subtype + '</p>';
            return item;
        },

        compare(sources, id) {
            if (sources.length <= 1) return null;

            const firstData = sources[0].data;
            const outerLabel = (firstData.about && firstData.about.label) || firstData.label || id;
            const item = rappture.createOutputItem(outerLabel, 'field');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            const _cmpMkAxis = _mkAxis;

            // Detect field type from first source
            const _fm = (firstData.components && firstData.components[0] && firstData.components[0].mesh) || null;
            const _fc = (firstData.components && firstData.components[0]) || null;
            const _is2D = _fm && _fm.mesh_type === 'grid' && _fm.axes && _fm.axes.x && _fm.axes.y && !_fm.axes.z && (_fc && (_fc.extents || 1) === 1);
            const _is3DGrid = _fm && _fm.mesh_type === 'grid' && _fm.axes && _fm.axes.x && _fm.axes.y && _fm.axes.z && (_fc && (_fc.extents || 1) === 1);
            const _is3DUnstr = _fm && _fm.mesh_type === 'unstructured' && _fm.points && _fm.points.length > 0 && (_fc && (_fc.extents || 1) === 1) && _fm.points[0] && _fm.points[0].length === 3;

            const colorscales = ['Viridis','Plasma','Inferno','Magma','Cividis','RdBu','Spectral','Jet','Hot','Blues'];
            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';
            plotDiv.id = 'fldcmp-' + id;
            const sid = id.replace(/[^a-z0-9_-]/gi, '_');

            const cp = document.createElement('div');
            cp.className = 'rp-3d-panel';
            cp.style.maxHeight = 'none';

            const fldcmpPanelWrap = document.createElement('div');
            fldcmpPanelWrap.className = 'rp-3d-panel-wrap';
            const fldcmpTab = document.createElement('div');
            fldcmpTab.className = 'rp-3d-panel-tab';
            fldcmpTab.title = 'Toggle control panel';
            fldcmpTab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';
            fldcmpPanelWrap.appendChild(fldcmpTab);
            fldcmpPanelWrap.appendChild(cp);
            const outerWrap = document.createElement('div');
            outerWrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;align-items:stretch;';
            outerWrap.appendChild(plotDiv);
            outerWrap.appendChild(fldcmpPanelWrap);
            body.appendChild(outerWrap);
            fldcmpTab.addEventListener('click', () => {
                fldcmpPanelWrap.classList.toggle('collapsed');
                setTimeout(() => { if (window.Plotly) Plotly.relayout(plotDiv, { autosize: true }); }, 220);
            });

            // Helper: build a solid single-color Plotly colorscale from a hex color
            const _solidCs = (hex) => [[0, hex], [1, hex]];

            if (_is2D) {
                // Subplot per run, shared colorscale/contour controls
                const units = _fm.units || '';
                const xLbl0 = `X${units ? ' ['+units+']' : ''}`;
                const yLbl0 = `Y${units ? ' ['+units+']' : ''}`;
                cp.innerHTML = `
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Title</div>
                    <label>Plot<input type="text" id="fldcmp-ttl-${sid}" value="" placeholder="(none)" style="${inputStyle}"></label>
                    <label>Colorbar<input type="text" id="fldcmp-cbtl-${sid}" value="" placeholder="(none)" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">X Axis</div>
                    <label>Label<input type="text" id="fldcmp-xl-${sid}" value="${xLbl0}" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Y Axis</div>
                    <label>Label<input type="text" id="fldcmp-yl-${sid}" value="${yLbl0}" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Color scale</div>
                    <select id="fldcmp-cs-${sid}" style="${inputStyle}">${colorscales.map(c=>`<option${c==='Viridis'?' selected':''}>${c}</option>`).join('')}</select>
                    <label style="flex-direction:row;align-items:center;gap:6px;margin-top:4px"><input type="checkbox" id="fldcmp-rev-${sid}"> Reverse</label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Display</div>
                    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fldcmp-sm-${sid}" checked> Interpolate</label>
                    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fldcmp-ct-${sid}" checked> Contours</label>
                    <label>Contour #<input type="range" id="fldcmp-nc-${sid}" min="3" max="30" value="10" step="1"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Download</div>
                    <button class="rp-3d-btn" id="fldcmp-png-${sid}">PNG</button>
                  </div>`;

                // Build subplot grid
                const n = sources.length;
                const traces = [];
                const annotations = [];
                sources.forEach(({ run, data }, si) => {
                    const mesh = data.components && data.components[0] && data.components[0].mesh;
                    const comp = data.components && data.components[0];
                    if (!mesh || !comp) return;
                    const xs = _cmpMkAxis(mesh.axes.x), ys = _cmpMkAxis(mesh.axes.y);
                    const vals = comp.values || [];
                    const nx = xs.length, ny = ys.length;
                    const zRows = [];
                    for (let iy = 0; iy < ny; iy++) {
                        const row = [];
                        for (let ix = 0; ix < nx; ix++)
                            row.push(vals[ix * ny + iy] !== undefined ? vals[ix * ny + iy] : null);
                        zRows.push(row);
                    }
                    const axSuffix = si === 0 ? '' : (si + 1);
                    const isFirst = si === 0;
                    traces.push({
                        x: xs, y: ys, z: zRows, type: 'heatmap',
                        colorscale: 'Viridis', reversescale: false,
                        showscale: si === n - 1, zsmooth: 'best',
                        xaxis: 'x' + axSuffix, yaxis: 'y' + axSuffix,
                        showlegend: false,
                        name: run.label,
                    });
                    traces.push({
                        x: xs, y: ys, z: zRows, type: 'contour',
                        showscale: false, contours: { coloring: 'none' }, ncontours: 10,
                        line: { color: 'white', width: 1 }, opacity: 0.6,
                        xaxis: 'x' + axSuffix, yaxis: 'y' + axSuffix,
                        showlegend: false,
                    });
                    // Label annotation colored by run color, bold for first run
                    const runColor = run._color || '#666';
                    annotations.push({
                        text: run.label,
                        showarrow: false,
                        x: (si + 0.5) / n, y: 1.04, xref: 'paper', yref: 'paper',
                        xanchor: 'center', yanchor: 'bottom',
                        font: { size: isFirst ? 13 : 11, color: runColor,
                                family: isFirst ? 'sans-serif' : undefined },
                        bgcolor: runColor + '22',
                        bordercolor: runColor,
                        borderwidth: isFirst ? 2 : 1,
                        borderpad: 4,
                    });
                });
                const layout = { annotations, margin: { t: 70, r: 20, b: 60, l: 60 },
                    template: _rpPlotlyTemplates['plotly'], autosize: true };
                sources.forEach((_, si) => {
                    const axSuffix = si === 0 ? '' : (si + 1);
                    const domain = [si / sources.length + 0.01, (si + 1) / sources.length - 0.01];
                    layout['xaxis' + axSuffix] = { domain, title: xLbl0, showgrid: true };
                    layout['yaxis' + axSuffix] = { title: yLbl0, showgrid: true, scaleanchor: 'x' + axSuffix, anchor: 'x' + axSuffix };
                });

                _whenVisible(outerWrap, () => {
                    Plotly.newPlot(plotDiv, traces, layout, { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));
                    const applyCmp2 = () => {
                        const cs = cp.querySelector(`#fldcmp-cs-${sid}`).value;
                        const rev = cp.querySelector(`#fldcmp-rev-${sid}`).checked;
                        const smooth = cp.querySelector(`#fldcmp-sm-${sid}`).checked;
                        const showCt = cp.querySelector(`#fldcmp-ct-${sid}`).checked;
                        const nc = parseInt(cp.querySelector(`#fldcmp-nc-${sid}`).value);
                        const xl = cp.querySelector(`#fldcmp-xl-${sid}`).value;
                        const yl = cp.querySelector(`#fldcmp-yl-${sid}`).value;
                        const ttl = cp.querySelector(`#fldcmp-ttl-${sid}`).value;
                        const cbtl = cp.querySelector(`#fldcmp-cbtl-${sid}`).value;
                        const heatIdxs = [], ctIdxs = [];
                        traces.forEach((t, i) => { if (t.type === 'heatmap') heatIdxs.push(i); else ctIdxs.push(i); });
                        Plotly.restyle(plotDiv, { colorscale: cs, reversescale: rev,
                            zsmooth: smooth ? 'best' : false, 'colorbar.title': cbtl }, heatIdxs);
                        Plotly.restyle(plotDiv, { visible: showCt, ncontours: nc }, ctIdxs);
                        const upd = { 'title.text': ttl };
                        sources.forEach((_, si) => {
                            const axSuffix = si === 0 ? '' : (si + 1);
                            upd[`xaxis${axSuffix}.title`] = xl;
                            upd[`yaxis${axSuffix}.title`] = yl;
                        });
                        Plotly.relayout(plotDiv, upd);
                    };
                    cp.querySelectorAll('input, select').forEach(el =>
                        el.addEventListener(el.type === 'range' ? 'input' : 'change', applyCmp2));
                    cp.querySelectorAll('input[type=text]').forEach(el => el.addEventListener('input', applyCmp2));
                    cp.querySelector(`#fldcmp-png-${sid}`).addEventListener('click', () =>
                        Plotly.downloadImage(plotDiv, { format: 'png', filename: outerLabel.replace(/[^a-z0-9]/gi,'_') }));
                });

            } else if (_is3DGrid || _is3DUnstr) {
                // Overlay all runs as separate traces using run colors, shared control panel
                const traceType = _is3DGrid ? 'volume' : 'isosurface';
                const units = _fm.units || '';
                const mkLbl = ax => ax + (units ? ` [${units}]` : '');
                cp.innerHTML = `
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Title</div>
                    <label>Plot<input type="text" id="fldcmp-ttl-${sid}" value="" placeholder="(none)" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Axes</div>
                    <label>X<input type="text" id="fldcmp-xl-${sid}" value="${mkLbl('X')}" style="${inputStyle}"></label>
                    <label>Y<input type="text" id="fldcmp-yl-${sid}" value="${mkLbl('Y')}" style="${inputStyle}"></label>
                    <label>Z<input type="text" id="fldcmp-zl-${sid}" value="${mkLbl('Z')}" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Volume</div>
                    <label>Opacity<input type="range" id="fldcmp-op-${sid}" min="0.05" max="1" step="0.05" value="0.3"></label>
                    <label>Surfaces<input type="range" id="fldcmp-ns-${sid}" min="1" max="20" step="1" value="5"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Download</div>
                    <button class="rp-3d-btn" id="fldcmp-png-${sid}">PNG</button>
                  </div>`;

                // Build one trace per run
                const allPxs = [], allPys = [], allPzs = [], allPvs = [];
                sources.forEach(({ data }) => {
                    const comp = data.components && data.components[0];
                    const mesh = comp && comp.mesh;
                    if (!mesh || !comp) { allPxs.push([]); allPys.push([]); allPzs.push([]); allPvs.push([]); return; }
                    const mtype = mesh.mesh_type;
                    if (mtype === 'grid' && mesh.axes && mesh.axes.x && mesh.axes.y && mesh.axes.z) {
                        const xs = _cmpMkAxis(mesh.axes.x), ys = _cmpMkAxis(mesh.axes.y), zs = _cmpMkAxis(mesh.axes.z);
                        const vals = comp.values || [];
                        const nx = xs.length, ny = ys.length, nz = zs.length;
                        const px=[], py=[], pz=[], pv=[];
                        for (let ix=0;ix<nx;ix++) for (let iy=0;iy<ny;iy++) for (let iz=0;iz<nz;iz++) {
                            px.push(xs[ix]); py.push(ys[iy]); pz.push(zs[iz]);
                            pv.push(vals[ix*ny*nz+iy*nz+iz] ?? 0);
                        }
                        allPxs.push(px); allPys.push(py); allPzs.push(pz); allPvs.push(pv);
                    } else if (mtype === 'unstructured' && mesh.points && mesh.points.length) {
                        const pts = mesh.points;
                        const uvals = comp.values || [];
                        allPxs.push(pts.map(p=>p[0])); allPys.push(pts.map(p=>p[1]));
                        allPzs.push(pts.map(p=>p[2])); allPvs.push(pts.map((_,i)=>uvals[i]??0));
                    } else {
                        allPxs.push([]); allPys.push([]); allPzs.push([]); allPvs.push([]);
                    }
                });

                const buildTraces = (op, ns) => sources.map(({run}, si) => {
                    const col = run._color || '#888';
                    const isFirst = si === 0;
                    return {
                        type: traceType,
                        x: allPxs[si], y: allPys[si], z: allPzs[si], value: allPvs[si],
                        isomin: allPvs[si].length ? Math.min(...allPvs[si]) : 0,
                        isomax: allPvs[si].length ? Math.max(...allPvs[si]) : 1,
                        opacity: isFirst ? Math.min(op * 1.4, 1) : op,
                        surface: { count: ns },
                        colorscale: _solidCs(col),
                        reversescale: false,
                        showscale: false,
                        name: run.label,
                        caps: { x:{show:false}, y:{show:false}, z:{show:false} },
                    };
                });

                // Dummy scatter3d traces for legend
                const buildLegendTraces = () => sources.map(({run}) => ({
                    type: 'scatter3d', mode: 'markers',
                    x: [null], y: [null], z: [null],
                    name: run.label,
                    marker: { color: run._color || '#888', size: 8 },
                    showlegend: true,
                }));

                const layout3 = {
                    scene: { xaxis:{title:mkLbl('X')}, yaxis:{title:mkLbl('Y')}, zaxis:{title:mkLbl('Z')} },
                    margin: {t:50,r:20,b:20,l:20}, template:'plotly_white', autosize:true,
                    showlegend: true,
                    legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top',
                              bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#ccc', borderwidth: 1,
                              font: { size: 11 } },
                };

                _whenVisible(outerWrap, () => {
                    Plotly.newPlot(plotDiv, [...buildTraces(0.3, 5), ...buildLegendTraces()], layout3, { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));
                    const applyCmp3 = () => {
                        const op = parseFloat(cp.querySelector(`#fldcmp-op-${sid}`).value);
                        const ns = parseInt(cp.querySelector(`#fldcmp-ns-${sid}`).value);
                        const ttl = cp.querySelector(`#fldcmp-ttl-${sid}`).value;
                        const cam = plotDiv._fullLayout && plotDiv._fullLayout.scene ? plotDiv._fullLayout.scene.camera : undefined;
                        Plotly.react(plotDiv, [...buildTraces(op, ns), ...buildLegendTraces()], {
                            ...layout3,
                            title: { text: ttl },
                            scene: {
                                xaxis: { title: cp.querySelector(`#fldcmp-xl-${sid}`).value },
                                yaxis: { title: cp.querySelector(`#fldcmp-yl-${sid}`).value },
                                zaxis: { title: cp.querySelector(`#fldcmp-zl-${sid}`).value },
                                ...(cam ? { camera: cam } : {}),
                            },
                        });
                    };
                    cp.querySelectorAll('input, select').forEach(el =>
                        el.addEventListener(el.type === 'range' ? 'input' : 'change', applyCmp3));
                    cp.querySelectorAll('input[type=text]').forEach(el => el.addEventListener('input', applyCmp3));
                    cp.querySelector(`#fldcmp-png-${sid}`).addEventListener('click', () =>
                        Plotly.downloadImage(plotDiv, { format: 'png', filename: outerLabel.replace(/[^a-z0-9]/gi,'_') }));
                });

            } else {
                // Fallback: stacked sub-renders
                body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px;overflow:auto';
                outerWrap.remove();
                const renderer = rappture.outputRenderers['field'];
                if (renderer) sources.forEach(({ run, data }) => {
                    const hdr = document.createElement('div');
                    hdr.style.cssText = 'font-size:12px;font-weight:700;color:var(--rp-text-muted);padding:2px 0';
                    hdr.textContent = run.label;
                    body.appendChild(hdr);
                    const subElem = renderer.call(rappture, id + '__' + run.run_id, data);
                    if (subElem) body.appendChild(subElem);
                });
            }
            return { elem: item, label: outerLabel };
        },
    });

    // ── field_2d: 2D scalar grid → Plotly heatmap ───────────────────────────
    rappture._registerRenderer('field_2d', {
        render(id, data) {
            const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'field');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            const firstComp = (data.components || [])[0];
            const firstMesh = firstComp && firstComp.mesh;

            const axes = firstMesh.axes;
            const xs = _mkAxis(axes.x);
            const ys = _mkAxis(axes.y);
            const vals = firstComp.values || [];
            const nx = xs.length, ny = ys.length;
            const zRows = [];
            for (let iy = 0; iy < ny; iy++) {
                const row = [];
                for (let ix = 0; ix < nx; ix++) {
                    row.push(vals[ix * ny + iy] !== undefined ? vals[ix * ny + iy] : null);
                }
                zRows.push(row);
            }

            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';
            plotDiv.id = 'fld2d-' + id;
            const sid = id.replace(/[^a-z0-9_-]/gi, '_');

            const units = firstMesh.units || '';
            const xLabel = `X${units ? ' [' + units + ']' : ''}`;
            const yLabel = `Y${units ? ' [' + units + ']' : ''}`;

            const traces = [
                { x: xs, y: ys, z: zRows, type: 'heatmap', colorscale: 'Viridis',
                  showscale: true, zsmooth: 'best' },
                { x: xs, y: ys, z: zRows, type: 'contour', showscale: false,
                  contours: { coloring: 'none' }, ncontours: 10,
                  line: { color: 'white', width: 1 }, opacity: 0.6 },
            ];
            const layout = {
                xaxis: { title: xLabel, showgrid: true, range: [xs[0], xs[xs.length - 1]] },
                yaxis: { title: yLabel, showgrid: true, scaleanchor: 'x',
                         range: [ys[0], ys[ys.length - 1]] },
                margin: { t: 50, r: 20, b: 60, l: 60 },
                template: _rpPlotlyTemplates['plotly'],
                autosize: true,
            };

            const xMin0 = xs[0], xMax0 = xs[xs.length - 1];
            const yMin0 = ys[0], yMax0 = ys[ys.length - 1];
            const xLabel0 = firstMesh.units ? `X [${firstMesh.units}]` : 'X';
            const yLabel0 = firstMesh.units ? `Y [${firstMesh.units}]` : 'Y';

            const cp = document.createElement('div');
            cp.className = 'rp-3d-panel';
            cp.style.maxHeight = 'none';
            cp.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Title</div>
                <label>Plot title<input type="text" id="fld2-ttl-${sid}" value="" placeholder="(none)" style="${inputStyle}"></label>
                <label>Colorbar title<input type="text" id="fld2-cbtl-${sid}" value="" placeholder="(none)" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">X Axis</div>
                <label>Label<input type="text" id="fld2-xl-${sid}" value="${xLabel0}" style="${inputStyle}"></label>
                <label>Min<input type="number" id="fld2-xlo-${sid}" value="${xMin0}" step="any" style="${inputStyle}"></label>
                <label>Max<input type="number" id="fld2-xhi-${sid}" value="${xMax0}" step="any" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Y Axis</div>
                <label>Label<input type="text" id="fld2-yl-${sid}" value="${yLabel0}" style="${inputStyle}"></label>
                <label>Min<input type="number" id="fld2-ylo-${sid}" value="${yMin0}" step="any" style="${inputStyle}"></label>
                <label>Max<input type="number" id="fld2-yhi-${sid}" value="${yMax0}" step="any" style="${inputStyle}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Color scale</div>
                <select id="fld2-cs-${sid}" style="${inputStyle}">
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
                  <input type="checkbox" id="fld2-rev-${sid}"> Reverse
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Display</div>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="fld2-sm-${sid}" checked> Interpolate
                </label>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="fld2-ct-${sid}" checked> Contours
                </label>
                <label>Contour #<input type="range" id="fld2-nc-${sid}" min="3" max="30" value="10" step="1"></label>
              </div>
              ${rappture._rpUtils.displaySectionHtml('fld2', sid, {mt:50,mb:60,ml:60,mr:20})}
              <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn" id="fld2-svg-${sid}">SVG</button>
                  <button class="rp-3d-btn" id="fld2-png-${sid}">PNG</button>
                  <button class="rp-3d-btn" id="fld2-dl-json-${sid}">JSON</button>
                </div>
              </div>`;

            const fld2PanelWrap = document.createElement('div');
            fld2PanelWrap.className = 'rp-3d-panel-wrap';
            const fld2Tab = document.createElement('div');
            fld2Tab.className = 'rp-3d-panel-tab';
            fld2Tab.title = 'Toggle control panel';
            fld2Tab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';
            fld2PanelWrap.appendChild(fld2Tab);
            fld2PanelWrap.appendChild(cp);
            const outerWrap = document.createElement('div');
            outerWrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;align-items:stretch;';
            outerWrap.appendChild(plotDiv);
            outerWrap.appendChild(fld2PanelWrap);
            body.appendChild(outerWrap);
            fld2Tab.addEventListener('click', () => {
                fld2PanelWrap.classList.toggle('collapsed');
                setTimeout(() => Plotly.relayout(plotDiv, { autosize: true }), 220);
            });

            const _fld2Key = 'rp2w:fld2:' + window.location.pathname + ':' + id;
            const _fld2Save = () => {
                const s = {};
                ['fld2-ttl','fld2-cbtl','fld2-xl','fld2-yl','fld2-xlo','fld2-xhi','fld2-ylo','fld2-yhi','fld2-cs','fld2-nc'].forEach(k => {
                    const el = cp.querySelector(`#${k}-${sid}`);
                    if (el) s[k] = el.type === 'checkbox' ? el.checked : el.value;
                });
                ['fld2-rev','fld2-sm','fld2-ct'].forEach(k => {
                    const el = cp.querySelector(`#${k}-${sid}`);
                    if (el) s[k] = el.checked;
                });
                try { localStorage.setItem(_fld2Key, JSON.stringify(s)); } catch(e) {}
            };
            const _fld2Load = () => {
                try {
                    const s = JSON.parse(localStorage.getItem(_fld2Key) || 'null');
                    if (!s) return;
                    ['fld2-ttl','fld2-cbtl','fld2-xl','fld2-yl','fld2-xlo','fld2-xhi','fld2-ylo','fld2-yhi','fld2-cs','fld2-nc'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${sid}`);
                        if (el && s[k] !== undefined) el.value = s[k];
                    });
                    ['fld2-rev','fld2-sm','fld2-ct'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${sid}`);
                        if (el && s[k] !== undefined) el.checked = s[k];
                    });
                } catch(e) {}
            };
            _fld2Load();

            _whenVisible(outerWrap, () => {
                rappture._rpUtils.storeBaseLayout(plotDiv, layout);
                Plotly.newPlot(plotDiv, traces, layout, { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));

                const applyLayout = () => {
                    const cs = cp.querySelector(`#fld2-cs-${sid}`).value;
                    const rev = cp.querySelector(`#fld2-rev-${sid}`).checked;
                    Plotly.relayout(plotDiv, {
                        'title.text': cp.querySelector(`#fld2-ttl-${sid}`).value,
                        'xaxis.title': cp.querySelector(`#fld2-xl-${sid}`).value,
                        'xaxis.range': [
                            parseFloat(cp.querySelector(`#fld2-xlo-${sid}`).value),
                            parseFloat(cp.querySelector(`#fld2-xhi-${sid}`).value),
                        ],
                        'yaxis.title': cp.querySelector(`#fld2-yl-${sid}`).value,
                        'yaxis.range': [
                            parseFloat(cp.querySelector(`#fld2-ylo-${sid}`).value),
                            parseFloat(cp.querySelector(`#fld2-yhi-${sid}`).value),
                        ],
                    });
                    const showCt = cp.querySelector(`#fld2-ct-${sid}`).checked;
                    const nc = parseInt(cp.querySelector(`#fld2-nc-${sid}`).value);
                    const smooth = cp.querySelector(`#fld2-sm-${sid}`).checked;
                    const cbTitle = cp.querySelector(`#fld2-cbtl-${sid}`).value;
                    Plotly.restyle(plotDiv, {
                        colorscale: cs, reversescale: rev,
                        zsmooth: smooth ? 'best' : false,
                        'colorbar.title': cbTitle,
                    }, [0]);
                    Plotly.restyle(plotDiv, { visible: showCt, ncontours: nc }, [1]);
                    _fld2Save();
                };

                cp.querySelectorAll('input, select').forEach(el =>
                    el.addEventListener(el.type === 'range' || el.type === 'number' ? 'input' : 'change', applyLayout)
                );
                cp.querySelectorAll('input[type=text]').forEach(el =>
                    el.addEventListener('input', applyLayout)
                );

                // Apply restored state to the plot immediately
                applyLayout();

                rappture._rpUtils.wireDisplayControls(cp, plotDiv, 'fld2', sid, false);

                const fldLabel = ((data.about && data.about.label) || data.label || id).replace(/[^a-z0-9]/gi, '_');
                cp.querySelector(`#fld2-svg-${sid}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, fldLabel, 'svg'));
                cp.querySelector(`#fld2-png-${sid}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, fldLabel, 'png'));
                rappture._rpUtils.wireDownloadData(cp, data, fldLabel, 'fld2', sid);
            });

            return item;
        },
    });

})();
