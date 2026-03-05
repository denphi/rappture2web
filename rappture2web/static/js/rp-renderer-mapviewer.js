/**
 * Rappture2Web mapviewer renderer.
 * Handles: mapviewer (geographic map with scatter, choropleth, and line layers).
 * Both single-run and compare modes.
 *
 * Registered via rappture._registerRenderer.
 * Uses Plotly geo / scattergeo / choropleth traces.
 */

rappture._registerRenderer('mapviewer', {
    render(id, data) {
        const label = (data.about && data.about.label) || data.label || id;
        const sid = id.replace(/[^a-z0-9_-]/gi, '_');
        const item = rappture.createOutputItem(label, 'mapviewer');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');
        const U = rappture._rpUtils;

        const plotDiv = document.createElement('div');
        plotDiv.className = 'rp-output-plot';
        plotDiv.id = 'map-' + sid;

        const layers = data.layers || [];
        const projection = data.projection || 'natural earth';
        const scope = data.scope || 'world';

        const traces = rappture._rendererRegistry['mapviewer'].getTraces(data);

        const _geoScope = (sc) => sc === 'world' ? {} : { scope: sc };

        const layout = {
            geo: Object.assign({
                projection: { type: projection },
                showland: true,
                landcolor: '#e8efe8',
                showocean: true,
                oceancolor: '#c8dff0',
                showlakes: true,
                lakecolor: '#c8dff0',
                showrivers: false,
                showcountries: true,
                countrycolor: '#aaaaaa',
                showcoastlines: true,
                coastlinecolor: '#888888',
                showframe: true,
                framecolor: '#888888',
            }, _geoScope(scope)),
            margin: { t: 10, r: 10, b: 10, l: 10 },
            showlegend: layers.length > 1,
            legend: { x: 0, y: 1, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.8)', bordercolor: 'rgba(0,0,0,0.1)', borderwidth: 1 },
            template: _rpPlotlyTemplates['plotly_white'],
            autosize: true,
        };

        // Build panel HTML
        const projections = [
            'natural earth', 'mercator', 'orthographic', 'azimuthal equal area',
            'azimuthal equidistant', 'conic equal area', 'conic conformal',
            'equirectangular', 'gnomonic', 'stereographic', 'mollweide',
            'hammer', 'transverse mercator', 'robinson',
        ];
        const projOpts = projections.map(p =>
            `<option value="${p}"${p === projection ? ' selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`
        ).join('');

        const scopes = ['world', 'africa', 'asia', 'europe', 'north america', 'south america'];
        const scopeOpts = scopes.map(s =>
            `<option value="${s}"${s === scope ? ' selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join('');

        const panelHtml = `
          <div class="rp-panel-section">
            <div class="rp-panel-title">Map</div>
            <label>Projection<select id="mp-proj-${sid}" style="${U.inputStyle}">${projOpts}</select></label>
            <label>Scope<select id="mp-scope-${sid}" style="${U.inputStyle}">${scopeOpts}</select></label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="mp-land-${sid}" checked> Land
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="mp-ocean-${sid}" checked> Ocean
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="mp-countries-${sid}" checked> Countries
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="mp-coast-${sid}" checked> Coastlines
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="mp-rivers-${sid}"> Rivers
            </label>
          </div>
          <div class="rp-panel-section">
            <div class="rp-panel-title">Display</div>
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" id="mp-leg-${sid}" ${layers.length > 1 ? 'checked' : ''}> Legend
            </label>
            <label>Legend pos<select id="mp-legpos-${sid}" style="${U.inputStyle}">
              <option value="inside-tl" selected>Inside top-left</option>
              <option value="inside-tr">Inside top-right</option>
              <option value="inside-bl">Inside bottom-left</option>
              <option value="inside-br">Inside bottom-right</option>
            </select></label>
          </div>
          ${U.themeSectionHtml('mp', sid)}
          ${U.downloadSectionHtml('mp', sid)}`;

        const { outerWrap, cp } = U.createSidecar(plotDiv, panelHtml, { maxHeight: 'none' });
        body.appendChild(outerWrap);

        const _legPos = {
            'inside-tl': { x: 0,  y: 1,  xanchor: 'left',  yanchor: 'top' },
            'inside-tr': { x: 1,  y: 1,  xanchor: 'right', yanchor: 'top' },
            'inside-bl': { x: 0,  y: 0,  xanchor: 'left',  yanchor: 'bottom' },
            'inside-br': { x: 1,  y: 0,  xanchor: 'right', yanchor: 'bottom' },
        };

        const applyLayout = () => {
            const posKey = cp.querySelector(`#mp-legpos-${sid}`).value;
            const lp = _legPos[posKey] || _legPos['inside-tl'];
            const sc = cp.querySelector(`#mp-scope-${sid}`).value;
            const geoUpdate = {
                'geo.projection.type':  cp.querySelector(`#mp-proj-${sid}`).value,
                'geo.showland':         cp.querySelector(`#mp-land-${sid}`).checked,
                'geo.showocean':        cp.querySelector(`#mp-ocean-${sid}`).checked,
                'geo.showcountries':    cp.querySelector(`#mp-countries-${sid}`).checked,
                'geo.showcoastlines':   cp.querySelector(`#mp-coast-${sid}`).checked,
                'geo.showrivers':       cp.querySelector(`#mp-rivers-${sid}`).checked,
                'showlegend':           cp.querySelector(`#mp-leg-${sid}`).checked,
                'legend.x':             lp.x,
                'legend.y':             lp.y,
                'legend.xanchor':       lp.xanchor,
                'legend.yanchor':       lp.yanchor,
            };
            geoUpdate['geo.scope'] = (sc === 'world') ? 'world' : sc;
            Plotly.relayout(plotDiv, geoUpdate);
        };

        const mapLabel = label.replace(/[^a-z0-9]/gi, '_');
        _whenVisible(outerWrap, () => {
            U.storeBaseLayout(plotDiv, layout);
            Plotly.newPlot(plotDiv, traces, layout, { responsive: true })
                .then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)));
            cp.querySelectorAll('input[type=checkbox]').forEach(el => {
                el.addEventListener('change', applyLayout);
            });
            cp.querySelectorAll('select').forEach(el => {
                if (el.id !== `mp-legpos-${sid}`) el.addEventListener('change', applyLayout);
            });
            cp.querySelector(`#mp-legpos-${sid}`).addEventListener('change', applyLayout);
            U.wireThemeToggle(cp, plotDiv, 'mp', sid);
            U.wireDownloadButtons(cp, plotDiv, mapLabel, 'mp', sid);
            U.wireDownloadData(cp, data, mapLabel, 'mp', sid);
        }, 50);

        return item;
    },

    getTraces(data) {
        const layers = data.layers || [];
        const traces = [];

        for (const layer of layers) {
            if (layer.type === 'scatter') {
                traces.push({
                    type: 'scattergeo',
                    lat: layer.lats || [],
                    lon: layer.lons || [],
                    text: layer.texts || [],
                    name: layer.label || layer.id,
                    mode: 'markers',
                    marker: {
                        size: parseFloat(layer.size) || 6,
                        color: layer.color || null,
                        line: { width: 1, color: 'white' },
                    },
                    hoverinfo: 'text+lat+lon',
                });
            } else if (layer.type === 'choropleth') {
                traces.push({
                    type: 'choropleth',
                    locations: layer.locations || [],
                    z: layer.values || [],
                    name: layer.label || layer.id,
                    colorscale: layer.colorscale || 'Viridis',
                    autocolorscale: false,
                    reversescale: false,
                    marker: { line: { color: '#aaa', width: 0.5 } },
                    colorbar: { title: layer.label || '', thickness: 15, len: 0.6 },
                });
            } else if (layer.type === 'heatmap') {
                const vals = layer.values || [];
                let vmin = Infinity, vmax = -Infinity;
                for (const v of vals) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
                if (!isFinite(vmin)) { vmin = 0; vmax = 1; }
                if (vmin === vmax) { vmin -= 0.001; vmax += 0.001; }
                traces.push({
                    type: 'scattergeo',
                    lat: layer.lats || [],
                    lon: layer.lons || [],
                    text: (layer.texts || []).map((t, i) =>
                        (t ? t + '<br>' : '') + 'P=' + (vals[i] !== undefined ? vals[i].toFixed(3) : '')
                    ),
                    name: layer.label || layer.id,
                    mode: 'markers',
                    marker: {
                        size: parseFloat(layer.size) || 8,
                        color: vals,
                        colorscale: layer.colorscale || 'YlOrRd',
                        cmin: vmin,
                        cmax: vmax,
                        showscale: true,
                        colorbar: { title: layer.label || '', thickness: 15, len: 0.6 },
                        opacity: parseFloat(layer.opacity) || 0.85,
                        line: { width: 0 },
                    },
                    hoverinfo: 'text+lat+lon',
                });
            } else if (layer.type === 'line') {
                // Each segment becomes a separate trace to allow hover; group under same legendgroup
                const segs = layer.segments || [];
                segs.forEach((seg, i) => {
                    traces.push({
                        type: 'scattergeo',
                        lat: [seg.lat0, seg.lat1],
                        lon: [seg.lon0, seg.lon1],
                        text: [seg.label || '', seg.label || ''],
                        name: i === 0 ? (layer.label || layer.id) : '',
                        legendgroup: layer.id,
                        showlegend: i === 0,
                        mode: 'lines',
                        line: {
                            width: parseFloat(layer.size) || 2,
                            color: layer.color || null,
                        },
                        hoverinfo: 'text',
                    });
                });
            }
        }

        return traces;
    },

    compare(sources, id) {
        const firstData = sources[0].data;
        const label = (firstData.about && firstData.about.label) || firstData.label || id;
        const item = rappture.createOutputItem(label, 'mapviewer');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');

        const plotDiv = document.createElement('div');
        plotDiv.className = 'rp-output-plot';
        body.appendChild(plotDiv);

        // Merge all sources into one map, tagging each trace with its run label
        const allTraces = [];
        sources.forEach(({ run, data }) => {
            const runLabel = run.label || `Run ${run.run_num || '?'}`;
            const runColor = run._color || null;
            const reg = rappture._rendererRegistry['mapviewer'];
            const traces = reg.getTraces(data);
            traces.forEach(t => {
                t.name = `${runLabel}: ${t.name || ''}`;
                if (t.type === 'scattergeo' && runColor) {
                    t.marker = Object.assign({}, t.marker || {}, { color: runColor });
                    if (t.mode === 'lines') t.line = Object.assign({}, t.line || {}, { color: runColor });
                }
                allTraces.push(t);
            });
        });

        const layout = {
            geo: {
                projection: { type: firstData.projection || 'natural earth' },
                showland: true, landcolor: '#e8efe8',
                showocean: true, oceancolor: '#c8dff0',
                showlakes: true, lakecolor: '#c8dff0',
                showcountries: true, countrycolor: '#aaaaaa',
                showcoastlines: true, coastlinecolor: '#888888',
            },
            margin: { t: 10, r: 10, b: 10, l: 10 },
            showlegend: true,
            template: _rpPlotlyTemplates['plotly_white'],
            autosize: true,
        };

        _whenVisible(plotDiv, () =>
            Plotly.newPlot(plotDiv, allTraces, layout, { responsive: true })
                .then(() => requestAnimationFrame(() => Plotly.Plots.resize(plotDiv)))
        );

        return { elem: item, label };
    },
});
