/**
 * Rappture2Web table renderer.
 * Handles: table (energy level viewer + plain HTML table).
 * Both single-run and compare modes.
 *
 * Registered via rappture._registerRenderer.
 */

rappture._registerRenderer('table', {
    render(id, data) {
        const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'table');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');

        const rows = data.rows || [];
        const eIdx = data.energy_col;
        const lIdx = data.label_col;
        const cols = data.columns || [];

        // ── Energy level viewer (Plotly) ───────────────────────────────
        if (eIdx != null && rows.length > 0) {
            const eUnits = cols[eIdx] ? cols[eIdx].units : 'eV';

            // Helper: parse one dataset into sorted levels + HOMO/LUMO indices
            const _parseLevels = (r) => {
                const lvls = r.map(row => ({
                    value: parseFloat(row[eIdx]),
                    label: lIdx != null ? (row[lIdx] || '') : '',
                })).filter(l => isFinite(l.value));
                lvls.sort((a, b) => a.value - b.value);
                const hi = lvls.findIndex(l =>
                    l.label.toLowerCase() === 'homo' || l.label.toLowerCase() === 'ground state');
                const li = hi >= 0 ? hi + 1 : -1;
                return { lvls, hi, li };
            };

            const { lvls: levels, hi: homoIdx, li: lumoIdx } = _parseLevels(rows);

            // Zoom range: a bit above/below HOMO-LUMO gap (or first 3 levels)
            const zLo = homoIdx >= 0 ? levels[homoIdx].value : levels[0].value;
            const zHi = lumoIdx > 0 && lumoIdx < levels.length ? levels[lumoIdx].value : (levels[1] ? levels[1].value : levels[0].value);
            const zPad = (zHi - zLo) * 0.8 + 0.1;
            const zoomRange = [zLo - zPad, zHi + zPad];

            const plotDiv = document.createElement('div');
            body.style.cssText = 'padding:0;display:flex;flex-direction:column';
            body.appendChild(plotDiv);

            // ── Build traces for one run's levels ──────────────────────
            const _makeTraces = (lvls, hi, li, color, runLabel, xSuffix, ySuffix, zoomOnly) => {
                const xa = 'x' + xSuffix;
                const ya = 'y' + ySuffix;
                const traces = [];
                const normalColor = color || '#60a5fa';
                const homoColor  = color || '#f59e0b';
                const lumoColor  = color || '#34d399';

                // Gap shading on both panels
                if (hi >= 0 && li > 0 && li < lvls.length) {
                    traces.push({
                        type: 'scatter', mode: 'lines',
                        x: [0, 1, 1, 0, 0], y: [lvls[hi].value, lvls[hi].value, lvls[li].value, lvls[li].value, lvls[hi].value],
                        xaxis: xa, yaxis: ya,
                        fill: 'toself', fillcolor: 'rgba(37,99,235,0.1)',
                        line: { color: 'transparent', width: 0 },
                        hoverinfo: 'skip', showlegend: false,
                    });
                }

                // Normal levels (overview only)
                if (!zoomOnly) {
                    const normals = lvls.filter((_, i) => i !== hi && i !== li);
                    if (normals.length) {
                        const tips = normals.flatMap(l => {
                            const t = `${runLabel ? runLabel + ' ' : ''}${l.label ? l.label + ': ' : ''}${l.value} ${eUnits}<extra></extra>`;
                            return [t, t, null];
                        });
                        traces.push({
                            type: 'scatter', mode: 'lines',
                            x: normals.flatMap(() => [0.05, 0.75, null]),
                            y: normals.flatMap(l => [l.value, l.value, null]),
                            xaxis: xa, yaxis: ya,
                            line: { color: normalColor, width: 1.5 },
                            hovertemplate: tips,
                            showlegend: false,
                        });
                    }
                }

                // HOMO
                if (hi >= 0 && hi < lvls.length) {
                    const h = lvls[hi];
                    const tip = `${runLabel ? runLabel + ' ' : ''}HOMO: ${h.value} ${eUnits}<extra></extra>`;
                    traces.push({
                        type: 'scatter', mode: 'lines',
                        x: [0.05, 0.75, null], y: [h.value, h.value, null],
                        xaxis: xa, yaxis: ya,
                        line: { color: homoColor, width: 2.5 },
                        hovertemplate: [tip, tip, null],
                        showlegend: false,
                    });
                }

                // LUMO
                if (li > 0 && li < lvls.length) {
                    const l = lvls[li];
                    const tip = `${runLabel ? runLabel + ' ' : ''}LUMO: ${l.value} ${eUnits}<extra></extra>`;
                    traces.push({
                        type: 'scatter', mode: 'lines',
                        x: [0.05, 0.75, null], y: [l.value, l.value, null],
                        xaxis: xa, yaxis: ya,
                        line: { color: lumoColor, width: 2.5 },
                        hovertemplate: [tip, tip, null],
                        showlegend: false,
                    });
                }

                return traces;
            };

            // ── Annotations for HOMO/LUMO labels ──────────────────────
            const _makeAnnotations = (lvls, hi, li, color, xSuffix, ySuffix) => {
                const xa = 'x' + xSuffix;
                const ya = 'y' + ySuffix;
                const anns = [];
                const homoColor = color || '#f59e0b';
                const lumoColor = color || '#34d399';
                if (hi >= 0 && hi < lvls.length) {
                    anns.push({
                        x: 0.77, y: lvls[hi].value, xref: xa, yref: ya,
                        text: `<b>HOMO</b> ${lvls[hi].value} ${eUnits}`,
                        showarrow: false, xanchor: 'left',
                        font: { size: 10, color: homoColor },
                    });
                }
                if (li > 0 && li < lvls.length) {
                    anns.push({
                        x: 0.77, y: lvls[li].value, xref: xa, yref: ya,
                        text: `<b>LUMO</b> ${lvls[li].value} ${eUnits}`,
                        showarrow: false, xanchor: 'left',
                        font: { size: 10, color: lumoColor },
                    });
                }
                if (hi >= 0 && li > 0 && li < lvls.length) {
                    const gap = lvls[li].value - lvls[hi].value;
                    const midE = (lvls[hi].value + lvls[li].value) / 2;
                    anns.push({
                        x: 0.4, y: midE, xref: xa, yref: ya,
                        text: `Eg=${gap.toPrecision(3)} ${eUnits}`,
                        showarrow: false, xanchor: 'center',
                        font: { size: 9, color: '#93c5fd' },
                        bgcolor: 'rgba(248,250,252,0.85)', borderpad: 2,
                    });
                }
                return anns;
            };

            const allTraces = [];
            const allAnnotations = [];

            // Overview (left): all levels on yaxis
            allTraces.push(..._makeTraces(levels, homoIdx, lumoIdx, null, '', '', '', false));
            // Zoom (right): HOMO+LUMO only on yaxis2
            allTraces.push(..._makeTraces(levels, homoIdx, lumoIdx, null, '', '2', '2', true));
            allAnnotations.push(..._makeAnnotations(levels, homoIdx, lumoIdx, null, '', ''));
            allAnnotations.push(..._makeAnnotations(levels, homoIdx, lumoIdx, null, '2', '2'));

            Plotly.newPlot(plotDiv, allTraces, {
                paper_bgcolor: 'transparent',
                margin: { l: 55, r: 8, t: 30, b: 40 },
                grid: { rows: 1, columns: 2, pattern: 'independent', columnwidth: [0.5, 0.5] },
                xaxis:  { visible: false, range: [0, 1], fixedrange: true, domain: [0, 0.48] },
                xaxis2: { visible: false, range: [0, 1], fixedrange: true, domain: [0.52, 1] },
                yaxis: {
                    title: { text: `Energy (${eUnits})`, font: { size: 11 } },
                    tickfont: { size: 10 }, gridcolor: '#e2e8f0',
                },
                yaxis2: {
                    range: zoomRange, tickfont: { size: 10 }, gridcolor: '#e2e8f0',
                    anchor: 'x2',
                },
                annotations: [
                    { text: 'All levels', x: 0.24, xref: 'paper', y: 1.04, yref: 'paper',
                      showarrow: false, font: { size: 11, color: '#64748b' }, xanchor: 'center' },
                    { text: 'HOMO / LUMO zoom', x: 0.76, xref: 'paper', y: 1.04, yref: 'paper',
                      showarrow: false, font: { size: 11, color: '#64748b' }, xanchor: 'center' },
                    ...allAnnotations,
                ],
                hovermode: 'closest', showlegend: false,
            }, { responsive: true, displayModeBar: true, displaylogo: false,
                 modeBarButtonsToRemove: ['select2d', 'lasso2d'] })
                .then(() => Plotly.Plots.resize(plotDiv));

            // Store helpers on the item for compare rendering
            item._rpEnergyMeta = { eUnits, _parseLevels, _makeTraces, _makeAnnotations };

        } else {
            // ── Plain HTML table fallback ──────────────────────────────
            const tbl = document.createElement('table');
            tbl.className = 'rp-data-table';
            if (cols.length > 0) {
                const thead = document.createElement('thead');
                thead.innerHTML = '<tr>' + cols.map(c =>
                    `<th>${c.label}${c.units ? ' (' + c.units + ')' : ''}</th>`
                ).join('') + '</tr>';
                tbl.appendChild(thead);
            }
            const tbody = document.createElement('tbody');
            rows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = r.map(cell => `<td>${cell}</td>`).join('');
                tbody.appendChild(tr);
            });
            tbl.appendChild(tbody);
            body.appendChild(tbl);
        }

        return item;
    },

    compare(sources, id) {
        const firstData = sources[0].data;
        const tblLabel = (firstData.about && firstData.about.label) || firstData.label || id;
        const item = rappture.createOutputItem(tblLabel, 'table');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');
        const eUnits = (firstData.columns && firstData.columns[firstData.energy_col]) ? firstData.columns[firstData.energy_col].units : 'eV';

        const _parseLvls = (rows, eidx, lidx) => {
            const lvls = rows.map(r => ({
                value: parseFloat(r[eidx]),
                label: lidx != null ? (r[lidx] || '') : '',
            })).filter(l => isFinite(l.value));
            lvls.sort((a, b) => a.value - b.value);
            const hi = lvls.findIndex(l => l.label.toLowerCase() === 'homo' || l.label.toLowerCase() === 'ground state');
            return { lvls, hi, li: hi >= 0 ? hi + 1 : -1 };
        };

        // Compute shared zoom range across all runs
        let zLoAll = Infinity, zHiAll = -Infinity;
        sources.forEach(({ data: d }) => {
            const { lvls, hi, li } = _parseLvls(d.rows || [], d.energy_col, d.label_col);
            if (hi >= 0) zLoAll = Math.min(zLoAll, lvls[hi].value);
            if (li > 0 && li < lvls.length) zHiAll = Math.max(zHiAll, lvls[li].value);
        });
        if (!isFinite(zLoAll)) { zLoAll = 0; zHiAll = 1; }
        const zPadAll = (zHiAll - zLoAll) * 0.8 + 0.1;
        const zoomRange = [zLoAll - zPadAll, zHiAll + zPadAll];

        const RUN_COLORS = ['#3b82f6','#f59e0b','#34d399','#f87171','#a78bfa','#fb923c','#38bdf8','#4ade80'];
        const allTraces = [];
        const allAnnotations = [
            { text: 'All levels', x: 0.24, xref: 'paper', y: 1.04, yref: 'paper',
              showarrow: false, font: { size: 11, color: '#64748b' }, xanchor: 'center' },
            { text: 'HOMO / LUMO zoom', x: 0.76, xref: 'paper', y: 1.04, yref: 'paper',
              showarrow: false, font: { size: 11, color: '#64748b' }, xanchor: 'center' },
        ];

        sources.forEach(({ run, data: d }, si) => {
            const color = run._color || RUN_COLORS[si % RUN_COLORS.length];
            const { lvls, hi, li } = _parseLvls(d.rows || [], d.energy_col, d.label_col);
            const runLabel = run.label || `Run ${si + 1}`;

            // Overview traces (xaxis='x')
            const normals = lvls.filter((_, i) => i !== hi && i !== li);
            if (normals.length) {
                allTraces.push({
                    type: 'scatter', mode: 'lines',
                    x: normals.flatMap(() => [0.05, 0.75, null]),
                    y: normals.flatMap(l => [l.value, l.value, null]),
                    xaxis: 'x', yaxis: 'y',
                    line: { color, width: 1.5 },
                    hovertemplate: normals.flatMap(l => {
                        const t = `${runLabel} ${l.label ? l.label+': ' : ''}${l.value} ${eUnits}<extra></extra>`;
                        return [t, t, null];
                    }),
                    name: runLabel, legendgroup: runLabel, showlegend: si === 0 || true,
                });
            }
            if (hi >= 0) allTraces.push({
                type: 'scatter', mode: 'lines',
                x: [0.05, 0.75, null], y: [lvls[hi].value, lvls[hi].value, null],
                xaxis: 'x', yaxis: 'y', line: { color, width: 2.5 },
                hovertemplate: [`${runLabel} HOMO: ${lvls[hi].value} ${eUnits}<extra></extra>`, `${runLabel} HOMO: ${lvls[hi].value} ${eUnits}<extra></extra>`, null],
                name: runLabel + ' HOMO', legendgroup: runLabel, showlegend: false,
            });
            if (li > 0 && li < lvls.length) allTraces.push({
                type: 'scatter', mode: 'lines',
                x: [0.05, 0.75, null], y: [lvls[li].value, lvls[li].value, null],
                xaxis: 'x', yaxis: 'y', line: { color, width: 2.5, dash: 'dash' },
                hovertemplate: [`${runLabel} LUMO: ${lvls[li].value} ${eUnits}<extra></extra>`, `${runLabel} LUMO: ${lvls[li].value} ${eUnits}<extra></extra>`, null],
                name: runLabel + ' LUMO', legendgroup: runLabel, showlegend: false,
            });

            // Zoom traces (xaxis='x2')
            if (hi >= 0) allTraces.push({
                type: 'scatter', mode: 'lines',
                x: [0.05, 0.75, null], y: [lvls[hi].value, lvls[hi].value, null],
                xaxis: 'x2', yaxis: 'y',
                line: { color, width: 2.5 },
                hovertemplate: [`${runLabel} HOMO: ${lvls[hi].value} ${eUnits}<extra></extra>`, `${runLabel} HOMO: ${lvls[hi].value} ${eUnits}<extra></extra>`, null],
                name: runLabel, legendgroup: runLabel, showlegend: si >= 0,
            });
            if (li > 0 && li < lvls.length) allTraces.push({
                type: 'scatter', mode: 'lines',
                x: [0.05, 0.75, null], y: [lvls[li].value, lvls[li].value, null],
                xaxis: 'x2', yaxis: 'y',
                line: { color, width: 2.5, dash: 'dash' },
                hovertemplate: [`${runLabel} LUMO: ${lvls[li].value} ${eUnits}<extra></extra>`, `${runLabel} LUMO: ${lvls[li].value} ${eUnits}<extra></extra>`, null],
                name: runLabel + ' LUMO', legendgroup: runLabel, showlegend: false,
            });

            // HOMO/LUMO labels on zoom panel (first run only)
            if (si === 0) {
                if (hi >= 0) allAnnotations.push({
                    x: 0.77, y: lvls[hi].value, xref: 'x2', yref: 'y',
                    text: `<b>HOMO</b>`, showarrow: false, xanchor: 'left',
                    font: { size: 10, color },
                });
                if (li > 0 && li < lvls.length) allAnnotations.push({
                    x: 0.77, y: lvls[li].value, xref: 'x2', yref: 'y',
                    text: `<b>LUMO</b>`, showarrow: false, xanchor: 'left',
                    font: { size: 10, color },
                });
            }
        });

        const plotDiv = document.createElement('div');
        body.style.cssText = 'padding:0;display:flex;flex-direction:column';
        body.appendChild(plotDiv);

        // Legend entries: one per run
        sources.forEach(({ run }, si) => {
            const color = run._color || RUN_COLORS[si % RUN_COLORS.length];
            allTraces.push({
                type: 'scatter', mode: 'lines',
                x: [null], y: [null],
                xaxis: 'x', yaxis: 'y',
                line: { color, width: 2.5 },
                name: run.label || `Run ${si + 1}`,
                showlegend: true,
            });
        });

        // Update all zoom traces to use yaxis2
        allTraces.forEach(t => { if (t.xaxis === 'x2') t.yaxis = 'y2'; });
        allAnnotations.forEach(a => { if (a.xref === 'x2') a.yref = 'y2'; });

        Plotly.newPlot(plotDiv, allTraces, {
            paper_bgcolor: 'transparent',
            margin: { l: 55, r: 8, t: 30, b: 40 },
            grid: { rows: 1, columns: 2, pattern: 'independent', columnwidth: [0.5, 0.5] },
            xaxis:  { visible: false, range: [0, 1], fixedrange: true, domain: [0, 0.48] },
            xaxis2: { visible: false, range: [0, 1], fixedrange: true, domain: [0.52, 1] },
            yaxis: {
                title: { text: `Energy (${eUnits})`, font: { size: 11 } },
                tickfont: { size: 10 }, gridcolor: '#e2e8f0',
            },
            yaxis2: {
                range: zoomRange, tickfont: { size: 10 }, gridcolor: '#e2e8f0',
                anchor: 'x2', overlaying: undefined,
            },
            annotations: allAnnotations,
            hovermode: 'closest', showlegend: true,
            legend: { orientation: 'h', y: -0.12 },
        }, { responsive: true, displayModeBar: true, displaylogo: false,
             modeBarButtonsToRemove: ['select2d', 'lasso2d'] })
            .then(() => Plotly.Plots.resize(plotDiv));

        return { elem: item, label: tblLabel };
    },
});
