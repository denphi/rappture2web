/**
 * Rappture2Web curve & histogram renderers.
 * Handles: curve, histogram (both single-run and compare).
 *
 * Registered via rappture._registerRenderer.
 * Uses rappture._rpUtils for sidecar panels, theme, and downloads.
 */

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Clamp an array of numbers for log-scale axes: replace any value <= 0
 * with a small positive epsilon so Plotly's log axis doesn't break.
 */
function _clampForLog(arr) {
    if (!arr) return arr;
    const eps = 1e-300;
    return arr.map(v => (typeof v === 'number' && v <= 0) ? eps : v);
}

/**
 * Apply log-scale clamping to trace x/y arrays based on axis scale flags.
 */
function _sanitizeTracesForLog(traces, xIsLog, yIsLog) {
    if (!xIsLog && !yIsLog) return traces;
    return traces.map(t => ({
        ...t,
        ...(xIsLog ? { x: _clampForLog(t.x) } : {}),
        ...(yIsLog ? { y: _clampForLog(t.y) } : {}),
    }));
}

// ── curve ──────────────────────────────────────────────────────────────────

rappture._registerRenderer('curve', {
    // Build traces from data without creating any DOM — used by sequence renderer for frame updates
    getTraces(data, overrideLabel) {
        const _dashMap = { solid: 'solid', dashed: 'dash', dotted: 'dot', dash: 'dash', dot: 'dot' };
        const label = overrideLabel || (data.about && data.about.label) || data.label || '';
        const runColor = data._runColor || null;
        const runLabel = data._runLabel || null;
        const _curveType = (data.curve_type || (data.about && data.about.type) || 'line').toLowerCase();
        if (_curveType === 'mixed' && data._members) {
            return data._members.map((m) => {
                const ct = (m.curve_type || 'line').toLowerCase();
                const pt = ct === 'bar' ? 'bar' : 'scatter';
                const pm = ct === 'scatter' ? 'markers' : 'lines';
                const tLabel = runLabel ? `${runLabel}: ${m.label}` : m.label;
                const st = (m.trace && m.trace.style) || {};
                const traceColor = st.color || null;
                const dash = _dashMap[st.linestyle] || undefined;
                const lw = st.linewidth ? parseFloat(st.linewidth) : 2;
                return {
                    x: m.trace.x, y: m.trace.y, type: pt, mode: pm, name: tLabel,
                    ...(pt !== 'bar' ? { line: { width: lw, ...(traceColor ? { color: traceColor } : {}), ...(dash ? { dash } : {}) } } : {}),
                    ...(traceColor ? { marker: { color: traceColor } } : {}),
                };
            });
        }
        const _plotlyType = (_curveType === 'bar') ? 'bar' : 'scatter';
        const _plotlyMode = (_curveType === 'scatter') ? 'markers' : 'lines';
        return (data.traces || []).map((trace) => {
            const st = trace.style || {};
            const traceColor = st.color || runColor;
            const dash = _dashMap[st.linestyle] || undefined;
            const lw = st.linewidth ? parseFloat(st.linewidth) : 2;
            return {
                x: trace.x, y: trace.y, type: _plotlyType, mode: _plotlyMode,
                name: runLabel ? `${runLabel}${trace.label ? ': ' + trace.label : ''}` : (trace.label || label),
                ...(_plotlyType !== 'bar' ? { line: { width: lw, ...(traceColor ? { color: traceColor } : {}), ...(dash ? { dash } : {}) } } : {}),
                ...(traceColor ? { marker: { color: traceColor } } : {}),
            };
        });
    },

    render(id, data) {
        const label = (data.about && data.about.label) || data.label || id;
        const sid = id.replace(/[^a-z0-9_-]/gi, '_');
        const item = rappture.createOutputItem(label, 'plot');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');
        const U = rappture._rpUtils;

        const plotDiv = document.createElement('div');
        plotDiv.className = 'rp-output-plot';
        plotDiv.id = 'plot-' + id;

        // ── Initial axis labels from data ─────────────────────────────
        const xLabel0 = data.xaxis ? data.xaxis.label || '' : '';
        const xUnits0 = data.xaxis ? data.xaxis.units || '' : '';
        const yLabel0 = data.yaxis ? data.yaxis.label || '' : '';
        const yUnits0 = data.yaxis ? data.yaxis.units || '' : '';
        const xTitle0 = xLabel0 + (xUnits0 ? ` [${xUnits0}]` : '');
        const yTitle0 = yLabel0 + (yUnits0 ? ` [${yUnits0}]` : '');

        const runColor = data._runColor || null;
        const runLabel = data._runLabel || null;

        // Resolve curve type: curve_type (from xml_parser) or about.type (from rp_library)
        const _curveType = (data.curve_type || (data.about && data.about.type) || 'line').toLowerCase();
        const _isMixed = _curveType === 'mixed';

        // Axis range limits and scale flags
        const xMin = data.xaxis && data.xaxis.min ? parseFloat(data.xaxis.min) : undefined;
        const xMax = data.xaxis && data.xaxis.max ? parseFloat(data.xaxis.max) : undefined;
        const yMin = data.yaxis && data.yaxis.min ? parseFloat(data.yaxis.min) : undefined;
        const yMax = data.yaxis && data.yaxis.max ? parseFloat(data.yaxis.max) : undefined;
        const xIsLogRequested = data.xaxis && (data.xaxis.scale === 'log');
        const yIsLogRequested = data.yaxis && (data.yaxis.log === 'log' || data.yaxis.scale === 'log');

        // Build raw traces first to check for non-positive values, then sanitize for log axes
        const rawTraces = rappture._rendererRegistry['curve'].getTraces(data, label);
        const xHasNonPos = rawTraces.some(t => t.x && t.x.some(v => typeof v === 'number' && v <= 0));
        const yHasNonPos = rawTraces.some(t => t.y && t.y.some(v => typeof v === 'number' && v <= 0));
        // If data has non-positive values, disable log regardless of what the data requests
        const xIsLog = xIsLogRequested && !xHasNonPos;
        const yIsLog = yIsLogRequested && !yHasNonPos;
        const traces = _sanitizeTracesForLog(rawTraces, xIsLog, yIsLog);

        const layout = {
            title: { text: '', font: { size: 14 } },
            xaxis: {
                title: { text: xTitle0 },
                type: xIsLog ? 'log' : 'linear',
                showgrid: true, zeroline: true,
                ...(xMin !== undefined && xMax !== undefined ? { range: [xMin, xMax] } : {}),
            },
            yaxis: {
                title: { text: yTitle0 },
                type: yIsLog ? 'log' : 'linear',
                showgrid: true, zeroline: true,
                ...(yMin !== undefined && yMax !== undefined ? { range: [yMin, yMax] } : {}),
            },
            margin: { t: 36, r: 16, b: 60, l: 70 },
            showlegend: traces.length > 1,
            legend: { x: 1, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.7)', bordercolor: 'rgba(0,0,0,0.1)', borderwidth: 1 },
            template: _rpPlotlyTemplates['plotly'],
            autosize: true,
        };

        // ── Right-side control panel ──────────────────────────────────
        const panelHtml = `
          <div class="rp-panel-section">
            <div class="rp-panel-title">Title</div>
            <label>Plot title<input type="text" id="plt-title-${sid}" value="" placeholder="(none)"
              style="${U.inputStyle}"></label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">X Axis</div>
            <label>Label<input type="text" id="plt-xl-${sid}" value="${xLabel0}"
              style="${U.inputStyle}"></label>
            <label>Units<input type="text" id="plt-xu-${sid}" value="${xUnits0}"
              style="${U.inputStyle}"></label>
            <label style="flex-direction:row;align-items:center;gap:6px;margin-top:2px">
              <input type="checkbox" id="plt-xlog-${sid}" ${xIsLog ? 'checked' : ''}> Log scale
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="plt-xgrid-${sid}" checked> Grid
            </label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">Y Axis</div>
            <label>Label<input type="text" id="plt-yl-${sid}" value="${yLabel0}"
              style="${U.inputStyle}"></label>
            <label>Units<input type="text" id="plt-yu-${sid}" value="${yUnits0}"
              style="${U.inputStyle}"></label>
            <label style="flex-direction:row;align-items:center;gap:6px;margin-top:2px">
              <input type="checkbox" id="plt-ylog-${sid}" ${yIsLog ? 'checked' : ''}> Log scale
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="plt-ygrid-${sid}" checked> Grid
            </label>
            ${data._seqLockYId ? `<label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="${data._seqLockYId}"> Lock Y axis
            </label>` : ''}
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">Display</div>
            ${_isMixed ? `` : _curveType === 'bar' ? `
            <label>Bar gap<input type="range" id="plt-bargap-${sid}" min="0" max="0.8" value="0.1" step="0.05"></label>
            ` : _curveType === 'scatter' ? `
            <label>Marker size<input type="range" id="plt-mkrsize-${sid}" min="2" max="20" value="6" step="1"></label>
            ` : `
            <label>Line width<input type="range" id="plt-lw-${sid}" min="1" max="8" value="2" step="0.5"></label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="plt-mkr-${sid}"> Markers
            </label>
            `}
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="plt-leg-${sid}" ${traces.length > 1 ? 'checked' : ''}> Legend
            </label>
            <label>Legend pos<select id="plt-legpos-${sid}" style="${U.inputStyle}">
              <option value="inside-tr" selected>Inside top-right</option>
              <option value="inside-tl">Inside top-left</option>
              <option value="inside-br">Inside bottom-right</option>
              <option value="inside-bl">Inside bottom-left</option>
              <option value="outside-r">Outside right (mid)</option>
              <option value="outside-rt">Outside right (top)</option>
              <option value="outside-rb">Outside right (bot)</option>
              <option value="outside-l">Outside left (mid)</option>
              <option value="outside-lt">Outside left (top)</option>
              <option value="outside-lb">Outside left (bot)</option>
            </select></label>
          </div>
          ${U.themeSectionHtml('plt', sid)}
          ${U.downloadSectionHtml('plt', sid)}`;

        const { outerWrap, cp } = U.createSidecar(plotDiv, panelHtml, { maxHeight: 'none' });
        body.appendChild(outerWrap);

        // Helper: apply current panel state to Plotly
        const _legendPos = {
            'inside-tr':  { x: 1,    y: 1,    xanchor: 'right',  yanchor: 'top' },
            'inside-tl':  { x: 0,    y: 1,    xanchor: 'left',   yanchor: 'top' },
            'inside-br':  { x: 1,    y: 0,    xanchor: 'right',  yanchor: 'bottom' },
            'inside-bl':  { x: 0,    y: 0,    xanchor: 'left',   yanchor: 'bottom' },
            'outside-r':  { x: 1.02, y: 0.5,  xanchor: 'left',   yanchor: 'middle' },
            'outside-rt': { x: 1.02, y: 1,    xanchor: 'left',   yanchor: 'top' },
            'outside-rb': { x: 1.02, y: 0,    xanchor: 'left',   yanchor: 'bottom' },
            'outside-l':  { x: -0.02,y: 0.5,  xanchor: 'right',  yanchor: 'middle' },
            'outside-lt': { x: -0.02,y: 1,    xanchor: 'right',  yanchor: 'top' },
            'outside-lb': { x: -0.02,y: 0,    xanchor: 'right',  yanchor: 'bottom' },
        };
        const _outsideKeys = new Set(['outside-r','outside-rt','outside-rb','outside-l','outside-lt','outside-lb']);
        const applyLayout = () => {
            const xl = cp.querySelector(`#plt-xl-${sid}`);
            const xu = cp.querySelector(`#plt-xu-${sid}`);
            const yl = cp.querySelector(`#plt-yl-${sid}`);
            const yu = cp.querySelector(`#plt-yu-${sid}`);
            const posKey = cp.querySelector(`#plt-legpos-${sid}`).value;
            const lp = _legendPos[posKey] || _legendPos['inside-tr'];
            const isOutside = _outsideKeys.has(posKey);
            const isOutsideLeft = posKey.startsWith('outside-l');
            const patch = {
                'title.text':         cp.querySelector(`#plt-title-${sid}`).value,
                'xaxis.title.text':   U.axTitle(xl, xu),
                'xaxis.type':         cp.querySelector(`#plt-xlog-${sid}`).checked ? 'log' : 'linear',
                'xaxis.showgrid':     cp.querySelector(`#plt-xgrid-${sid}`).checked,
                'yaxis.title.text':   U.axTitle(yl, yu),
                'yaxis.type':         cp.querySelector(`#plt-ylog-${sid}`).checked ? 'log' : 'linear',
                'yaxis.showgrid':     cp.querySelector(`#plt-ygrid-${sid}`).checked,
                'showlegend':         cp.querySelector(`#plt-leg-${sid}`).checked,
                'legend.x':           lp.x,
                'legend.y':           lp.y,
                'legend.xanchor':     lp.xanchor,
                'legend.yanchor':     lp.yanchor,
                'legend.bgcolor':     isOutside ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,0.7)',
                'margin.r':           isOutside && !isOutsideLeft ? 120 : 16,
                'margin.l':           isOutsideLeft ? 120 : 70,
            };
            Plotly.relayout(plotDiv, patch);
            // Sync structural changes into _rpBaseLayout so theme changes don't revert them
            if (plotDiv._rpBaseLayout) {
                const b = plotDiv._rpBaseLayout;
                b.xaxis = { ...b.xaxis, title: { text: patch['xaxis.title.text'] }, type: patch['xaxis.type'], showgrid: patch['xaxis.showgrid'] };
                b.yaxis = { ...b.yaxis, title: { text: patch['yaxis.title.text'] }, type: patch['yaxis.type'], showgrid: patch['yaxis.showgrid'] };
                b.showlegend = patch['showlegend'];
                b.margin = { ...b.margin, r: patch['margin.r'], l: patch['margin.l'] };
            }
        };

        const applyTraces = () => {
            if (_isMixed) {
                // mixed: no single control
            } else if (_curveType === 'bar') {
                const gap = parseFloat(cp.querySelector(`#plt-bargap-${sid}`).value);
                Plotly.relayout(plotDiv, { bargap: gap });
            } else if (_curveType === 'scatter') {
                const sz = parseFloat(cp.querySelector(`#plt-mkrsize-${sid}`).value);
                Plotly.restyle(plotDiv, { 'marker.size': sz });
            } else {
                const lw  = parseFloat(cp.querySelector(`#plt-lw-${sid}`).value);
                const mkr = cp.querySelector(`#plt-mkr-${sid}`).checked;
                Plotly.restyle(plotDiv, {
                    'line.width': lw,
                    mode: mkr ? 'lines+markers' : 'lines',
                });
            }
        };

        // Render plot then wire up controls
        const plotLabel = label.replace(/[^a-z0-9]/gi, '_');
        _whenVisible(outerWrap, () => {
            U.storeBaseLayout(plotDiv, layout);
            Plotly.newPlot(plotDiv, traces, layout, { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));
            // Disable log scale checkboxes if data contains non-positive values
            const xlogChk = cp.querySelector(`#plt-xlog-${sid}`);
            const ylogChk = cp.querySelector(`#plt-ylog-${sid}`);
            if (xHasNonPos) { xlogChk.disabled = true; xlogChk.checked = false; xlogChk.title = 'Log scale unavailable: data contains zero or negative values'; xlogChk.parentElement.style.opacity = '0.45'; }
            if (yHasNonPos) { ylogChk.disabled = true; ylogChk.checked = false; ylogChk.title = 'Log scale unavailable: data contains zero or negative values'; ylogChk.parentElement.style.opacity = '0.45'; }
            cp.querySelectorAll('input[type=text], input[type=checkbox]').forEach(el => {
                el.addEventListener('input', applyLayout);
            });
            cp.querySelector(`#plt-legpos-${sid}`).addEventListener('change', applyLayout);
            if (!_isMixed) {
                if (_curveType === 'bar') {
                    cp.querySelector(`#plt-bargap-${sid}`).addEventListener('input', applyTraces);
                } else if (_curveType === 'scatter') {
                    cp.querySelector(`#plt-mkrsize-${sid}`).addEventListener('input', applyTraces);
                } else {
                    cp.querySelector(`#plt-lw-${sid}`).addEventListener('input', applyTraces);
                    cp.querySelector(`#plt-mkr-${sid}`).addEventListener('change', applyTraces);
                }
            }
            U.wireThemeToggle(cp, plotDiv, 'plt', sid);
            U.wireDownloadButtons(cp, plotDiv, plotLabel, 'plt', sid);
            U.wireDownloadData(cp, data, plotLabel, 'plt', sid);
        }, 50);

        return item;
    },

    compare(sources, id) {
        const firstData = sources[0].data;
        const label = (firstData.about && firstData.about.label) || firstData.label || id;
        const sid = id.replace(/[^a-z0-9_-]/gi, '_');
        const item = rappture.createOutputItem(label, 'plot');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');
        const U = rappture._rpUtils;

        const plotDiv = document.createElement('div');
        plotDiv.className = 'rp-output-plot';
        plotDiv.id = 'plot-' + sid;

        const traces = [];
        sources.forEach(({ run, data }, si) => {
            const isTop = si === 0;
            const color = run._color || null;
            const _ct = (data.curve_type || (data.about && data.about.type) || 'line').toLowerCase();
            const _isMixedCmp = _ct === 'mixed';
            if (_isMixedCmp && data._members) {
                data._members.forEach(m => {
                    const mct = (m.curve_type || 'line').toLowerCase();
                    const mpt = mct === 'bar' ? 'bar' : 'scatter';
                    const mpm = mct === 'scatter' ? 'markers' : 'lines';
                    traces.push({
                        x: m.trace.x, y: m.trace.y,
                        type: mpt, mode: mpm,
                        name: `${run.label}: ${m.label}`,
                        line: mpt !== 'bar' ? { width: isTop ? 3 : 1.5, color } : undefined,
                        marker: { color },
                        opacity: isTop ? 1 : 0.75,
                    });
                });
            } else {
                const type = firstData.type;
                const _pt = (type === 'histogram' || _ct === 'bar') ? 'bar' : 'scatter';
                const _pm = (_ct === 'scatter') ? 'markers' : 'lines';
                (data.traces || []).forEach(t => {
                    traces.push({
                        x: t.x, y: t.y,
                        type: _pt,
                        mode: _pm,
                        name: `${run.label}${t.label ? ': ' + t.label : ''}`,
                        line: _pt !== 'bar' ? { width: isTop ? 3 : 1.5, color } : undefined,
                        marker: { color },
                        opacity: isTop ? 1 : 0.75,
                    });
                });
            }
        });

        const xLabel = firstData.xaxis ? firstData.xaxis.label || '' : '';
        const xUnits = firstData.xaxis ? firstData.xaxis.units || '' : '';
        const yLabel = firstData.yaxis ? firstData.yaxis.label || '' : '';
        const yUnits = firstData.yaxis ? firstData.yaxis.units || '' : '';
        const cXmin = firstData.xaxis && firstData.xaxis.min ? parseFloat(firstData.xaxis.min) : undefined;
        const cXmax = firstData.xaxis && firstData.xaxis.max ? parseFloat(firstData.xaxis.max) : undefined;
        const cYmin = firstData.yaxis && firstData.yaxis.min ? parseFloat(firstData.yaxis.min) : undefined;
        const cYmax = firstData.yaxis && firstData.yaxis.max ? parseFloat(firstData.yaxis.max) : undefined;
        const cXlog = firstData.xaxis && (firstData.xaxis.scale === 'log');
        const cYlog = firstData.yaxis && (firstData.yaxis.log === 'log' || firstData.yaxis.scale === 'log');

        const xHasNonPos = traces.some(t => t.x && t.x.some(v => typeof v === 'number' && v <= 0));
        const yHasNonPos = traces.some(t => t.y && t.y.some(v => typeof v === 'number' && v <= 0));
        const safeTraces = _sanitizeTracesForLog(traces, cXlog && !xHasNonPos, cYlog && !yHasNonPos);

        const layout = {
            title: { text: '', font: { size: 14 } },
            xaxis: {
                title: { text: xLabel + (xUnits ? ` [${xUnits}]` : '') }, showgrid: true,
                type: cXlog && !xHasNonPos ? 'log' : 'linear',
                ...(cXmin !== undefined && cXmax !== undefined ? { range: [cXmin, cXmax] } : {}),
            },
            yaxis: {
                title: { text: yLabel + (yUnits ? ` [${yUnits}]` : '') }, showgrid: true,
                type: cYlog && !yHasNonPos ? 'log' : 'linear',
                ...(cYmin !== undefined && cYmax !== undefined ? { range: [cYmin, cYmax] } : {}),
            },
            margin: { t: 36, r: 16, b: 60, l: 70 },
            showlegend: true,
            legend: { x: 1, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.7)', bordercolor: 'rgba(0,0,0,0.1)', borderwidth: 1 },
            template: _rpPlotlyTemplates['plotly'],
            autosize: true,
        };

        const panelHtml = `
          <div class="rp-panel-section">
            <div class="rp-panel-title">Title</div>
            <label>Plot title<input type="text" id="plt-title-${sid}" value="" placeholder="(none)"
              style="${U.inputStyle}"></label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">X Axis</div>
            <label>Label<input type="text" id="plt-xl-${sid}" value="${xLabel}"
              style="${U.inputStyle}"></label>
            <label>Units<input type="text" id="plt-xu-${sid}" value="${xUnits}"
              style="${U.inputStyle}"></label>
            <label style="flex-direction:row;align-items:center;gap:6px;margin-top:2px">
              <input type="checkbox" id="plt-xlog-${sid}" ${cXlog && !xHasNonPos ? 'checked' : ''}> Log scale
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="plt-xgrid-${sid}" checked> Grid
            </label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">Y Axis</div>
            <label>Label<input type="text" id="plt-yl-${sid}" value="${yLabel}"
              style="${U.inputStyle}"></label>
            <label>Units<input type="text" id="plt-yu-${sid}" value="${yUnits}"
              style="${U.inputStyle}"></label>
            <label style="flex-direction:row;align-items:center;gap:6px;margin-top:2px">
              <input type="checkbox" id="plt-ylog-${sid}" ${cYlog && !yHasNonPos ? 'checked' : ''}> Log scale
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="plt-ygrid-${sid}" checked> Grid
            </label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">Display</div>
            <label>Line width<input type="range" id="plt-lw-${sid}" min="1" max="8" value="2" step="0.5"></label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="plt-leg-${sid}" checked> Legend
            </label>
            <label>Legend pos<select id="plt-legpos-${sid}" style="${U.inputStyle}">
              <option value="inside-tr" selected>Inside top-right</option>
              <option value="inside-tl">Inside top-left</option>
              <option value="inside-br">Inside bottom-right</option>
              <option value="inside-bl">Inside bottom-left</option>
              <option value="outside-r">Outside right (mid)</option>
              <option value="outside-rt">Outside right (top)</option>
              <option value="outside-rb">Outside right (bot)</option>
              <option value="outside-l">Outside left (mid)</option>
              <option value="outside-lt">Outside left (top)</option>
              <option value="outside-lb">Outside left (bot)</option>
            </select></label>
          </div>
          ${U.themeSectionHtml('plt', sid)}
          ${U.downloadSectionHtml('plt', sid)}`;

        const { outerWrap, cp } = U.createSidecar(plotDiv, panelHtml, { maxHeight: 'none' });
        body.appendChild(outerWrap);

        const _legendPos = {
            'inside-tr':  { x: 1,     y: 1,    xanchor: 'right',  yanchor: 'top' },
            'inside-tl':  { x: 0,     y: 1,    xanchor: 'left',   yanchor: 'top' },
            'inside-br':  { x: 1,     y: 0,    xanchor: 'right',  yanchor: 'bottom' },
            'inside-bl':  { x: 0,     y: 0,    xanchor: 'left',   yanchor: 'bottom' },
            'outside-r':  { x: 1.02,  y: 0.5,  xanchor: 'left',   yanchor: 'middle' },
            'outside-rt': { x: 1.02,  y: 1,    xanchor: 'left',   yanchor: 'top' },
            'outside-rb': { x: 1.02,  y: 0,    xanchor: 'left',   yanchor: 'bottom' },
            'outside-l':  { x: -0.02, y: 0.5,  xanchor: 'right',  yanchor: 'middle' },
            'outside-lt': { x: -0.02, y: 1,    xanchor: 'right',  yanchor: 'top' },
            'outside-lb': { x: -0.02, y: 0,    xanchor: 'right',  yanchor: 'bottom' },
        };
        const _outsideKeys = new Set(['outside-r','outside-rt','outside-rb','outside-l','outside-lt','outside-lb']);
        const applyLayout = () => {
            const xl = cp.querySelector(`#plt-xl-${sid}`);
            const xu = cp.querySelector(`#plt-xu-${sid}`);
            const yl = cp.querySelector(`#plt-yl-${sid}`);
            const yu = cp.querySelector(`#plt-yu-${sid}`);
            const posKey = cp.querySelector(`#plt-legpos-${sid}`).value;
            const lp = _legendPos[posKey] || _legendPos['inside-tr'];
            const isOutside = _outsideKeys.has(posKey);
            const isOutsideLeft = posKey.startsWith('outside-l');
            Plotly.relayout(plotDiv, {
                'title.text':       cp.querySelector(`#plt-title-${sid}`).value,
                'xaxis.title.text': U.axTitle(xl, xu),
                'xaxis.type':       cp.querySelector(`#plt-xlog-${sid}`).checked ? 'log' : 'linear',
                'xaxis.showgrid':   cp.querySelector(`#plt-xgrid-${sid}`).checked,
                'yaxis.title.text': U.axTitle(yl, yu),
                'yaxis.type':       cp.querySelector(`#plt-ylog-${sid}`).checked ? 'log' : 'linear',
                'yaxis.showgrid':   cp.querySelector(`#plt-ygrid-${sid}`).checked,
                'showlegend':       cp.querySelector(`#plt-leg-${sid}`).checked,
                'legend.x':         lp.x,
                'legend.y':         lp.y,
                'legend.xanchor':   lp.xanchor,
                'legend.yanchor':   lp.yanchor,
                'legend.bgcolor':   isOutside ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,0.7)',
                'margin.r':         isOutside && !isOutsideLeft ? 120 : 16,
                'margin.l':         isOutsideLeft ? 120 : 70,
            });
        };
        const applyTraces = () => {
            const lw = parseFloat(cp.querySelector(`#plt-lw-${sid}`).value);
            Plotly.restyle(plotDiv, { 'line.width': lw });
        };

        const plotLabel = label.replace(/[^a-z0-9]/gi, '_');
        _whenVisible(outerWrap, () => {
            U.storeBaseLayout(plotDiv, layout);
            Plotly.newPlot(plotDiv, safeTraces, layout, { responsive: true })
                .then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));
            const xlogChk = cp.querySelector(`#plt-xlog-${sid}`);
            const ylogChk = cp.querySelector(`#plt-ylog-${sid}`);
            if (xHasNonPos) { xlogChk.disabled = true; xlogChk.checked = false; xlogChk.title = 'Log scale unavailable: data contains zero or negative values'; xlogChk.parentElement.style.opacity = '0.45'; }
            if (yHasNonPos) { ylogChk.disabled = true; ylogChk.checked = false; ylogChk.title = 'Log scale unavailable: data contains zero or negative values'; ylogChk.parentElement.style.opacity = '0.45'; }
            cp.querySelectorAll('input[type=text], input[type=checkbox]').forEach(el => el.addEventListener('input', applyLayout));
            cp.querySelector(`#plt-legpos-${sid}`).addEventListener('change', applyLayout);
            cp.querySelector(`#plt-lw-${sid}`).addEventListener('input', applyTraces);
            U.wireThemeToggle(cp, plotDiv, 'plt', sid);
            U.wireDownloadButtons(cp, plotDiv, plotLabel, 'plt', sid);
        }, 50);

        return { elem: item, label };
    },
});

// ── histogram ──────────────────────────────────────────────────────────────

rappture._registerRenderer('histogram', {
    getTraces(data) {
        const runColor = data._runColor || null;
        const runLabel = data._runLabel || null;
        return (data.traces || []).map((t, i) => ({
            x: t.x, y: t.y, type: 'bar',
            name: runLabel ? `${runLabel}${t.label ? ': ' + t.label : ''}` : (t.label || ('Series ' + (i + 1))),
            marker: { color: runColor },
        }));
    },

    render(id, data) {
        const label = (data.about && data.about.label) || data.label || id;
        const sid = id.replace(/[^a-z0-9_-]/gi, '_');
        const item = rappture.createOutputItem(label, 'plot');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');
        const U = rappture._rpUtils;

        const plotDiv = document.createElement('div');
        plotDiv.className = 'rp-output-plot';
        plotDiv.id = 'hist-' + id;

        const xLabel0 = data.xaxis ? data.xaxis.label || '' : '';
        const xUnits0 = data.xaxis ? data.xaxis.units || '' : '';
        const yLabel0 = data.yaxis ? data.yaxis.label || '' : '';
        const yUnits0 = data.yaxis ? data.yaxis.units || '' : '';
        const xTitle0 = xLabel0 + (xUnits0 ? ` [${xUnits0}]` : '');
        const yTitle0 = yLabel0 + (yUnits0 ? ` [${yUnits0}]` : '');

        const traces = rappture._rendererRegistry['histogram'].getTraces(data);

        const layout = {
            title: { text: '', font: { size: 14 } },
            xaxis: { title: xTitle0, showgrid: true },
            yaxis: { title: yTitle0, showgrid: true },
            margin: { t: 36, r: 16, b: 60, l: 70 },
            bargap: 0.05,
            showlegend: traces.length > 1,
            legend: { x: 1, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.7)', bordercolor: 'rgba(0,0,0,0.1)', borderwidth: 1 },
            template: _rpPlotlyTemplates['plotly'],
            autosize: true,
        };

        const panelHtml = `
          <div class="rp-panel-section">
            <div class="rp-panel-title">Title</div>
            <label>Plot title<input type="text" id="ht-title-${sid}" value="" placeholder="(none)"
              style="${U.inputStyle}"></label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">X Axis</div>
            <label>Label<input type="text" id="ht-xl-${sid}" value="${xLabel0}"
              style="${U.inputStyle}"></label>
            <label>Units<input type="text" id="ht-xu-${sid}" value="${xUnits0}"
              style="${U.inputStyle}"></label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="ht-xgrid-${sid}" checked> Grid
            </label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">Y Axis</div>
            <label>Label<input type="text" id="ht-yl-${sid}" value="${yLabel0}"
              style="${U.inputStyle}"></label>
            <label>Units<input type="text" id="ht-yu-${sid}" value="${yUnits0}"
              style="${U.inputStyle}"></label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="ht-ygrid-${sid}" checked> Grid
            </label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">Display</div>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="ht-leg-${sid}" ${traces.length > 1 ? 'checked' : ''}> Legend
            </label>
            <label>Legend pos<select id="ht-legpos-${sid}" style="${U.inputStyle}">
              <option value="inside-tr" selected>Inside top-right</option>
              <option value="inside-tl">Inside top-left</option>
              <option value="inside-br">Inside bottom-right</option>
              <option value="inside-bl">Inside bottom-left</option>
              <option value="outside-r">Outside right (mid)</option>
              <option value="outside-rt">Outside right (top)</option>
              <option value="outside-rb">Outside right (bot)</option>
              <option value="outside-l">Outside left (mid)</option>
              <option value="outside-lt">Outside left (top)</option>
              <option value="outside-lb">Outside left (bot)</option>
            </select></label>
          </div>
          ${U.themeSectionHtml('ht', sid)}
          ${U.downloadSectionHtml('ht', sid)}`;

        const { outerWrap, cp } = U.createSidecar(plotDiv, panelHtml);
        body.appendChild(outerWrap);

        const htLabel = label.replace(/[^a-z0-9]/gi, '_');
        const _htLegendPos = {
            'inside-tr':  { x: 1,    y: 1,    xanchor: 'right',  yanchor: 'top' },
            'inside-tl':  { x: 0,    y: 1,    xanchor: 'left',   yanchor: 'top' },
            'inside-br':  { x: 1,    y: 0,    xanchor: 'right',  yanchor: 'bottom' },
            'inside-bl':  { x: 0,    y: 0,    xanchor: 'left',   yanchor: 'bottom' },
            'outside-r':  { x: 1.02, y: 0.5,  xanchor: 'left',   yanchor: 'middle' },
            'outside-rt': { x: 1.02, y: 1,    xanchor: 'left',   yanchor: 'top' },
            'outside-rb': { x: 1.02, y: 0,    xanchor: 'left',   yanchor: 'bottom' },
            'outside-l':  { x: -0.02,y: 0.5,  xanchor: 'right',  yanchor: 'middle' },
            'outside-lt': { x: -0.02,y: 1,    xanchor: 'right',  yanchor: 'top' },
            'outside-lb': { x: -0.02,y: 0,    xanchor: 'right',  yanchor: 'bottom' },
        };
        const _htOutsideKeys = new Set(['outside-r','outside-rt','outside-rb','outside-l','outside-lt','outside-lb']);
        const applyLayout = () => {
            const xl = cp.querySelector(`#ht-xl-${sid}`);
            const xu = cp.querySelector(`#ht-xu-${sid}`);
            const yl = cp.querySelector(`#ht-yl-${sid}`);
            const yu = cp.querySelector(`#ht-yu-${sid}`);
            const posKey = cp.querySelector(`#ht-legpos-${sid}`).value;
            const lp = _htLegendPos[posKey] || _htLegendPos['inside-tr'];
            const isOutside = _htOutsideKeys.has(posKey);
            const isOutsideLeft = posKey.startsWith('outside-l');
            Plotly.relayout(plotDiv, {
                'title.text':     cp.querySelector(`#ht-title-${sid}`).value,
                'xaxis.title':    U.axTitle(xl, xu),
                'xaxis.showgrid': cp.querySelector(`#ht-xgrid-${sid}`).checked,
                'yaxis.title':    U.axTitle(yl, yu),
                'yaxis.showgrid': cp.querySelector(`#ht-ygrid-${sid}`).checked,
                'showlegend':     cp.querySelector(`#ht-leg-${sid}`).checked,
                'legend.x':       lp.x,
                'legend.y':       lp.y,
                'legend.xanchor': lp.xanchor,
                'legend.yanchor': lp.yanchor,
                'legend.bgcolor': isOutside ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,0.7)',
                'margin.r':       isOutside && !isOutsideLeft ? 120 : 16,
                'margin.l':       isOutsideLeft ? 120 : 70,
            });
        };

        _whenVisible(outerWrap, () => {
            U.storeBaseLayout(plotDiv, layout);
            Plotly.newPlot(plotDiv, traces, layout, { responsive: true }).then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));
            cp.querySelectorAll('input[type=text], input[type=checkbox]').forEach(el => {
                el.addEventListener('input', applyLayout);
            });
            cp.querySelector(`#ht-legpos-${sid}`).addEventListener('change', applyLayout);
            U.wireThemeToggle(cp, plotDiv, 'ht', sid);
            U.wireDownloadButtons(cp, plotDiv, htLabel, 'ht', sid);
            U.wireDownloadData(cp, data, htLabel, 'ht', sid);
        }, 50);
        return item;
    },

    compare(sources, id) {
        // Reuse curve's compare — histogram traces are handled by the same logic
        return rappture._rendererRegistry.curve.compare.call(rappture, sources, id);
    },
});
