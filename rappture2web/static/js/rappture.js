/**
 * Rappture2Web client-side logic.
 * Handles form collection, simulation, enable/disable conditions,
 * WebSocket live output streaming, and run history browsing.
 */
const rappture = {

    // ── WebSocket ────────────────────────────────────────────────────────────

    ws: null,
    wsReconnectDelay: 2000,

    connectWebSocket() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${location.host}/ws`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.debug('[rp] WebSocket connected');
            this._wsPing();
        };

        this.ws.onmessage = (evt) => {
            let msg;
            try { msg = JSON.parse(evt.data); } catch { return; }
            this._handleWsMessage(msg);
        };

        this.ws.onclose = () => {
            console.debug('[rp] WebSocket closed, reconnecting...');
            setTimeout(() => this.connectWebSocket(), this.wsReconnectDelay);
        };

        this.ws.onerror = (e) => {
            console.warn('[rp] WebSocket error', e);
        };
    },

    _wsPing() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('ping');
            setTimeout(() => this._wsPing(), 30000);
        }
    },

    _handleWsMessage(msg) {
        switch (msg.type) {
            case 'state':
                // Initial state on connect
                if (msg.runs) { this._runs = msg.runs.slice().reverse(); this._renderRunHistory(); }
                if (msg.status === 'running') this._setRunning(true);
                if (msg.outputs && Object.keys(msg.outputs).length) {
                    this.renderOutputs(msg.outputs, msg.log || '');
                }
                break;

            case 'status':
                this._setRunning(msg.status === 'running');
                this._setStatus(msg.status === 'running' ? 'Simulation running...' : msg.status);
                break;

            case 'output':
                // Incremental output: render / update one output item
                this._renderSingleOutput(msg.id, msg.data);
                break;

            case 'log':
                this._appendLog(msg.text);
                break;

            case 'done':
                this._setRunning(false);
                const cached = msg.cached ? ' (cached)' : '';
                const runLabel = msg.run_num ? ` Run #${msg.run_num}` : '';
                this._setStatus(`Complete${runLabel}${cached}`, msg.status === 'success' ? 'success' : 'error');
                // Refresh run history and auto-select newest run
                this._fetchRunHistory(true);
                break;
        }
    },

    // ── Form collection ──────────────────────────────────────────────────────

    async collectInputs() {
        const inputs = {};
        const imagePromises = [];
        document.querySelectorAll('.rp-widget[data-path]').forEach(widget => {
            const path = widget.dataset.path;
            const type = widget.dataset.type;
            if (!type || type === 'group' || type === 'note' || type === 'separator') return;

            let value = null;
            if (type === 'boolean') {
                const cb = widget.querySelector('input[type="checkbox"]');
                value = cb && cb.checked ? 'yes' : 'no';
            } else if (type === 'multichoice') {
                const checked = widget.querySelectorAll('input[type="checkbox"]:checked');
                value = Array.from(checked).map(c => c.value).join(',');
            } else if (type === 'image') {
                // Read from hidden field (populated by loader)
                const hidden = widget.querySelector('.rp-image-data');
                if (hidden && hidden.value) inputs[path] = hidden.value;
                return;
            } else {
                const input = widget.querySelector('input:not([type="file"]), select, textarea');
                if (input) value = input.value;
            }

            if (value !== null) inputs[path] = value;
        });
        await Promise.all(imagePromises);
        return inputs;
    },

    previewImage(fileInput, previewId) {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            const src = e.target.result;
            const preview = document.getElementById('img-preview-' + previewId);
            if (preview) {
                preview.innerHTML = `<img src="${src}" alt="preview" style="max-width:100%;max-height:200px">`;
            }
            // Store b64 in hidden field
            const widget = fileInput.closest('.rp-widget');
            const hidden = widget && widget.querySelector('.rp-image-data');
            if (hidden) hidden.value = '@@RP-ENC:b64\n' + src.split(',')[1];
        };
        reader.readAsDataURL(file);
    },

    /** Parse XML text and apply input values to widgets. */
    _applyExampleXml(xmlText, targets) {
        let doc;
        try { doc = new DOMParser().parseFromString(xmlText, 'text/xml'); } catch { return; }

        const valueMap = {};
        const extractValues = (elem, pathParts) => {
            for (const child of elem.children) {
                const id = child.getAttribute('id');
                const seg = id ? `${child.tagName}(${id})` : child.tagName;
                const childPath = [...pathParts, seg].join('.');
                const cur = child.querySelector(':scope > current');
                if (cur) valueMap[childPath] = cur.textContent;
                extractValues(child, [...pathParts, seg]);
            }
        };
        const inputElem = doc.querySelector('run > input') || doc.querySelector('input');
        if (inputElem) extractValues(inputElem, ['input']);

        for (const [xmlPath, value] of Object.entries(valueMap)) {
            if (targets && !targets.includes(xmlPath)) continue;
            const w = document.querySelector(`.rp-widget[data-path="${xmlPath}"]`);
            if (!w) continue;
            const t = w.dataset.type;
            if (t === 'boolean') {
                const cb = w.querySelector('input[type="checkbox"]');
                if (cb) { cb.checked = ['yes','on','true','1'].includes(value.toLowerCase()); cb.dispatchEvent(new Event('change', {bubbles:true})); }
            } else if (t === 'image') {
                const hidden = w.querySelector('.rp-image-data');
                if (hidden) {
                    hidden.value = value;
                    // Update preview
                    const preview = w.querySelector('.rp-image-display');
                    if (preview) {
                        let src = value.trim();
                        if (src.startsWith('@@RP-ENC:b64')) src = 'data:image/*;base64,' + src.replace(/^@@RP-ENC:b64\s*/, '').trim();
                        else if (!src.startsWith('data:')) src = 'data:image/*;base64,' + src.replace(/\s/g, '');
                        preview.innerHTML = `<img src="${src}" alt="preview" style="max-width:100%;max-height:200px;display:block">`;
                    }
                }
            } else {
                const inp = w.querySelector('input:not([type="file"]), select, textarea');
                if (inp) { inp.value = value; inp.dispatchEvent(new Event('change', {bubbles:true})); }
            }
        }
    },

    /** Load a bundled example XML by filename from the server. */
    loadExampleByName(selectElem) {
        const filename = selectElem.value;
        if (!filename) return;
        const widget = selectElem.closest('.rp-widget');
        const targetsAttr = widget && widget.dataset.uploadTargets;
        const targets = targetsAttr ? targetsAttr.split(',').filter(Boolean) : null;
        const pattern = (widget && widget.dataset.example) || '*.xml';
        fetch('/api/loader-examples/' + encodeURIComponent(filename) + '?pattern=' + encodeURIComponent(pattern))
            .then(r => r.json())
            .then(data => { if (data.content) this._applyExampleXml(data.content, targets); })
            .catch(() => {});
    },

    /** Load an uploaded XML file and populate input widgets from it. */
    loadExample(fileInput) {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const widget = fileInput.closest('.rp-widget');
        const targetsAttr = widget && widget.dataset.uploadTargets;
        const targets = targetsAttr ? targetsAttr.split(',').filter(Boolean) : null;
        const reader = new FileReader();
        reader.onload = e => this._applyExampleXml(e.target.result, targets);
        reader.readAsText(file);
    },

    // ── Upload run XML ────────────────────────────────────────────────────────

    triggerUploadRun() {
        document.getElementById('rp-upload-run-input').value = '';
        document.getElementById('rp-upload-run-input').click();
    },

    async uploadRunFile(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        this._setStatus('Uploading ' + file.name + '...');
        const fd = new FormData();
        fd.append('file', file);
        try {
            const resp = await fetch('/api/upload-run', { method: 'POST', body: fd });
            const data = await resp.json();
            if (!resp.ok || data.error) {
                this._setStatus('Upload failed: ' + (data.error || resp.statusText));
            } else {
                this._setStatus('');
            }
        } catch (e) {
            this._setStatus('Upload error: ' + e.message);
        }
    },

    // ── Simulate ─────────────────────────────────────────────────────────────

    async simulate() {
        this._setRunning(true);
        this._setStatus('Simulation running...');
        this._streamedOutputs = {};

        // Clear results area, show running indicator
        const container = document.getElementById('rp-results');
        container.innerHTML = '<div class="rp-results-placeholder"><p>Simulation running...</p></div>';

        const inputs = await this.collectInputs();

        try {
            const response = await fetch('/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs }),
            });
            const result = await response.json();

            const cached = result.cached ? ' (cached)' : '';
            const runLabel = result.run_num ? ` Run #${result.run_num}` : '';
            this._setStatus(`Complete${runLabel}${cached}`, result.status === 'success' ? 'success' : 'error');
            this._fetchRunHistory(true);

        } catch (err) {
            this._setStatus('Request failed: ' + err.message, 'error');
        } finally {
            this._setRunning(false);
        }
    },

    // ── Output rendering ─────────────────────────────────────────────────────

    // Accumulated outputs during streaming (library mode)
    _streamedOutputs: {},

    /** Render all outputs at once (classic mode / run replay). */
    renderOutputs(outputs, log) {
        const container = document.getElementById('rp-results');

        // Build ordered list: real outputs first, then log if non-empty
        const entries = Object.entries(outputs || {});
        if (log && log.trim()) {
            entries.push(['__log__', { type: 'log', label: 'Log', content: log }]);
        }

        if (entries.length === 0) {
            container.innerHTML = '<div class="rp-results-placeholder"><p>No outputs returned.</p></div>';
            return;
        }

        // ── Group curves/histograms/fields that share about.group into one tab ──
        // Preserve insertion order: group tab appears where the first member appears.
        const groupedMap = {};   // groupName -> merged data object
        const mergedEntries = [];
        for (const [id, output] of entries) {
            if ((output.type === 'curve' || output.type === 'histogram') && output.group) {
                const grpName = output.group;
                if (!groupedMap[grpName]) {
                    groupedMap[grpName] = {
                        type: 'curve',
                        label: grpName,
                        curve_type: 'mixed',
                        group: grpName,
                        xaxis: output.xaxis || {},
                        yaxis: output.yaxis || {},
                        _members: [],
                        _runColor: output._runColor,
                        _runLabel: output._runLabel,
                    };
                    mergedEntries.push(['__grp__' + grpName, groupedMap[grpName]]);
                }
                const ct = (output.curve_type || '').toLowerCase() || (output.type === 'histogram' ? 'bar' : 'line');
                (output.traces || []).forEach(trace => {
                    groupedMap[grpName]._members.push({
                        label: output.label || id,
                        curve_type: ct,
                        trace,
                    });
                });
            } else if (output.type === 'field' && output.group) {
                // Group fields by group name into one tab; members selectable via dropdown
                const grpName = output.group;
                if (!groupedMap[grpName]) {
                    groupedMap[grpName] = {
                        type: 'field_group',
                        label: grpName,
                        group: grpName,
                        _members: [],
                    };
                    mergedEntries.push(['__fgrp__' + grpName, groupedMap[grpName]]);
                }
                groupedMap[grpName]._members.push({ id, label: output.label || id, field: output });
            } else {
                mergedEntries.push([id, output]);
            }
        }

        // Build rendered panels (keyed by id)
        const panels = {};
        for (const [id, output] of mergedEntries) {
            const renderer = this.outputRenderers[output.type];
            const elem = renderer
                ? renderer.call(this, id, output)
                : this.renderGenericOutput(id, output);
            if (elem) panels[id] = { elem, label: (output.about && output.about.label) || output.label || id };
        }

        this._renderTabLayout(container, panels);
    },

    /** Build a tab bar + panel layout in container from {id: {elem, label}} map. */
    _renderTabLayout(container, panels) {
        const ids = Object.keys(panels);
        if (ids.length === 0) return;

        // Remember the currently active tab label so we can restore it after re-render
        const prevActiveBtn = container.querySelector('.rp-output-tab-btn.active');
        const prevActiveLabel = prevActiveBtn ? prevActiveBtn.textContent : null;

        container.innerHTML = '';

        // Tab bar
        const tabBar = document.createElement('div');
        tabBar.className = 'rp-output-tabs';

        // Panel wrapper
        const panelWrap = document.createElement('div');
        panelWrap.className = 'rp-output-panels';

        // Determine which index should be active: match by label, else first
        const activeIdx = prevActiveLabel
            ? Math.max(0, ids.findIndex(id => panels[id].label === prevActiveLabel))
            : 0;

        ids.forEach((id, i) => {
            const { elem, label } = panels[id];
            const isActive = i === activeIdx;

            // Tab button
            const btn = document.createElement('button');
            btn.className = 'rp-output-tab-btn' + (isActive ? ' active' : '');
            btn.textContent = label;
            btn.dataset.target = 'rp-panel-' + id;
            btn.addEventListener('click', () => {
                tabBar.querySelectorAll('.rp-output-tab-btn').forEach(b => b.classList.remove('active'));
                panelWrap.querySelectorAll('.rp-output-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('rp-panel-' + id).classList.add('active');
                // Trigger Plotly resize in case it was hidden during render
                const plotDiv = elem.querySelector('.rp-output-plot');
                if (plotDiv && window.Plotly) Plotly.Plots.resize(plotDiv);
            });
            tabBar.appendChild(btn);

            // Panel div
            const panel = document.createElement('div');
            panel.className = 'rp-output-panel' + (isActive ? ' active' : '');
            panel.id = 'rp-panel-' + id;
            panel.appendChild(elem);
            panelWrap.appendChild(panel);
        });

        container.appendChild(tabBar);
        container.appendChild(panelWrap);
    },

    /** Render or update a single output item (library mode streaming). */
    _renderSingleOutput(id, data) {
        // Accumulate
        this._streamedOutputs[id] = data;

        // ── Grouped curve: add trace to existing group panel ─────────────
        const grpRaw = data.group || (data.about && data.about.group);
        if ((data.type === 'curve' || data.type === 'histogram') && grpRaw) {
            const grpPanelId = '__grp__' + grpRaw;
            const existingGrpPanel = document.getElementById('rp-panel-' + grpPanelId);
            if (existingGrpPanel) {
                // Append trace(s) to the existing Plotly plot in this group panel
                const plotDiv = existingGrpPanel.querySelector('.rp-output-plot');
                if (plotDiv && window.Plotly) {
                    const ct = (data.curve_type || (data.about && data.about.type) || 'line').toLowerCase();
                    const pt = ct === 'bar' ? 'bar' : 'scatter';
                    const pm = ct === 'scatter' ? 'markers' : 'lines';
                    const lbl = data.label || id;
                    (data.traces || []).forEach(trace => {
                        Plotly.addTraces(plotDiv, {
                            x: trace.x, y: trace.y,
                            type: pt, mode: pm, name: lbl,
                            line: pt !== 'bar' ? { width: 2 } : undefined,
                        });
                    });
                }
                return;
            }
            // First curve in this group: create merged data and render as new tab
            const merged = {
                type: 'curve', label: grpRaw, curve_type: 'mixed', group: grpRaw,
                xaxis: data.xaxis || {}, yaxis: data.yaxis || {},
                _members: (data.traces || []).map(trace => ({
                    label: data.label || id,
                    curve_type: (data.curve_type || (data.about && data.about.type) || 'line').toLowerCase(),
                    trace,
                })),
            };
            this._renderSingleOutputTab(grpPanelId, merged, grpRaw);
            return;
        }

        const container = document.getElementById('rp-results');
        const placeholder = container.querySelector('.rp-results-placeholder');
        if (placeholder) placeholder.remove();

        // Check if tab for this id already exists
        const existingPanel = document.getElementById('rp-panel-' + id);
        if (existingPanel) {
            // Update the panel content in place
            const renderer = this.outputRenderers[data.type];
            if (renderer) {
                const newElem = renderer.call(this, id, data);
                if (newElem) existingPanel.innerHTML = '';
                if (newElem) existingPanel.appendChild(newElem);
            }
            return;
        }

        // New output: add a new tab + panel
        const renderer = this.outputRenderers[data.type];
        if (!renderer) return;
        const elem = renderer.call(this, id, data);
        if (!elem) return;

        this._renderSingleOutputTab(id, data, data.label || id, elem);
    },

    /** Create a new streaming tab+panel for an already-rendered elem (or render from data). */
    _renderSingleOutputTab(id, data, labelText, elem) {
        const container = document.getElementById('rp-results');
        const placeholder = container.querySelector('.rp-results-placeholder');
        if (placeholder) placeholder.remove();

        if (!elem) {
            const renderer = this.outputRenderers[data.type];
            if (!renderer) return;
            elem = renderer.call(this, id, data);
            if (!elem) return;
        }

        let tabBar = container.querySelector('.rp-output-tabs');
        let panelWrap = container.querySelector('.rp-output-panels');

        if (!tabBar) {
            tabBar = document.createElement('div');
            tabBar.className = 'rp-output-tabs';
            panelWrap = document.createElement('div');
            panelWrap.className = 'rp-output-panels';
            container.appendChild(tabBar);
            container.appendChild(panelWrap);
        }

        const isFirst = tabBar.children.length === 0;
        const label = labelText || id;

        const btn = document.createElement('button');
        btn.className = 'rp-output-tab-btn' + (isFirst ? ' active' : '');
        btn.textContent = label;
        btn.dataset.target = 'rp-panel-' + id;
        btn.addEventListener('click', () => {
            tabBar.querySelectorAll('.rp-output-tab-btn').forEach(b => b.classList.remove('active'));
            panelWrap.querySelectorAll('.rp-output-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('rp-panel-' + id).classList.add('active');
            const plotDiv = elem.querySelector('.rp-output-plot');
            if (plotDiv && window.Plotly) Plotly.Plots.resize(plotDiv);
        });
        tabBar.appendChild(btn);

        const panel = document.createElement('div');
        panel.className = 'rp-output-panel' + (isFirst ? ' active' : '');
        panel.id = 'rp-panel-' + id;
        panel.appendChild(elem);
        panelWrap.appendChild(panel);
    },

    /** Append log text — creates or updates a "Log" tab during streaming. */
    _appendLog(text) {
        const container = document.getElementById('rp-results');
        const placeholder = container.querySelector('.rp-results-placeholder');
        if (placeholder) placeholder.remove();

        let logPanel = document.getElementById('rp-panel-__log__');
        if (!logPanel) {
            // Create the Log tab via the same streaming path
            const pre = document.createElement('pre');
            pre.id = 'rp-live-log-pre';
            pre.style.cssText = 'font-size:13px;white-space:pre-wrap;background:#1e293b;color:#e2e8f0;padding:14px;border-radius:4px;max-height:400px;overflow-y:auto;margin:0';
            pre.textContent = text;

            let tabBar = container.querySelector('.rp-output-tabs');
            let panelWrap = container.querySelector('.rp-output-panels');
            if (!tabBar) {
                tabBar = document.createElement('div');
                tabBar.className = 'rp-output-tabs';
                panelWrap = document.createElement('div');
                panelWrap.className = 'rp-output-panels';
                container.appendChild(tabBar);
                container.appendChild(panelWrap);
            }

            const isFirst = tabBar.children.length === 0;
            const btn = document.createElement('button');
            btn.className = 'rp-output-tab-btn' + (isFirst ? ' active' : '');
            btn.textContent = 'Log';
            btn.addEventListener('click', () => {
                tabBar.querySelectorAll('.rp-output-tab-btn').forEach(b => b.classList.remove('active'));
                panelWrap.querySelectorAll('.rp-output-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('rp-panel-__log__').classList.add('active');
            });
            tabBar.appendChild(btn);

            logPanel = document.createElement('div');
            logPanel.className = 'rp-output-panel' + (isFirst ? ' active' : '');
            logPanel.id = 'rp-panel-__log__';
            logPanel.appendChild(pre);
            panelWrap.appendChild(logPanel);
        } else {
            const pre = document.getElementById('rp-live-log-pre');
            if (pre) {
                pre.textContent += text;
                pre.scrollTop = pre.scrollHeight;
            }
        }
    },

    // ── Output renderers ─────────────────────────────────────────────────────

    outputRenderers: {
        field_group(id, data) {
            // Multiple fields sharing a group: render with a dropdown to select which field to show
            const members = data._members || [];
            if (members.length === 0) return null;
            if (members.length === 1) {
                // Only one member — render directly
                return this.outputRenderers.field.call(this, members[0].id, members[0].field);
            }
            // Multiple members: wrap in a container with a selector
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0';

            const bar = document.createElement('div');
            bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--rp-bg-alt,#f8fafc);border-bottom:1px solid var(--rp-border)';
            bar.innerHTML = '<span style="font-size:12px;color:var(--rp-text-muted)">Field:</span>';

            const sel = document.createElement('select');
            sel.style.cssText = 'font-size:12px;padding:2px 6px;border-radius:3px;border:1px solid var(--rp-border)';
            members.forEach((m, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = m.label || m.id;
                sel.appendChild(opt);
            });
            bar.appendChild(sel);
            wrapper.appendChild(bar);

            const content = document.createElement('div');
            content.style.cssText = 'flex:1;min-height:0;overflow:auto';
            wrapper.appendChild(content);

            const renderMember = (idx) => {
                content.innerHTML = '';
                const m = members[idx];
                const elem = this.outputRenderers.field.call(this, m.id, m.field);
                if (elem) content.appendChild(elem);
            };

            sel.addEventListener('change', () => renderMember(parseInt(sel.value)));
            renderMember(0);
            return wrapper;
        },

        curve(id, data) {
            const label = (data.about && data.about.label) || data.label || id;
            const item = rappture.createOutputItem(label, 'plot');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';
            plotDiv.id = 'plot-' + id;
            body.appendChild(plotDiv);

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

            // Build traces: grouped (mixed) or single type
            let traces;
            if (_isMixed && data._members) {
                traces = data._members.map((m) => {
                    const ct = (m.curve_type || 'line').toLowerCase();
                    const pt = ct === 'bar' ? 'bar' : 'scatter';
                    const pm = ct === 'scatter' ? 'markers' : 'lines';
                    const tLabel = runLabel ? `${runLabel}: ${m.label}` : m.label;
                    return {
                        x: m.trace.x, y: m.trace.y,
                        type: pt, mode: pm, name: tLabel,
                        line: pt !== 'bar' ? { width: 2 } : undefined,
                    };
                });
            } else {
                const _plotlyType = (_curveType === 'bar') ? 'bar' : 'scatter';
                const _plotlyMode = (_curveType === 'scatter') ? 'markers' : 'lines';
                traces = (data.traces || []).map((trace) => ({
                    x: trace.x, y: trace.y,
                    type: _plotlyType,
                    mode: _plotlyMode,
                    name: runLabel ? `${runLabel}${trace.label ? ': ' + trace.label : ''}` : (trace.label || label),
                    line: _plotlyType !== 'bar' ? { width: 2, color: runColor } : undefined,
                    marker: { color: runColor },
                }));
            }

            // Axis range limits
            const xMin = data.xaxis && data.xaxis.min ? parseFloat(data.xaxis.min) : undefined;
            const xMax = data.xaxis && data.xaxis.max ? parseFloat(data.xaxis.max) : undefined;
            const yMin = data.yaxis && data.yaxis.min ? parseFloat(data.yaxis.min) : undefined;
            const yMax = data.yaxis && data.yaxis.max ? parseFloat(data.yaxis.max) : undefined;
            // Log scale: yaxis.log == 'log' (Rappture convention) or yaxis.scale == 'log'
            const xIsLog = data.xaxis && (data.xaxis.scale === 'log');
            const yIsLog = data.yaxis && (data.yaxis.log === 'log' || data.yaxis.scale === 'log');

            const layout = {
                title: { text: '', font: { size: 14 } },
                xaxis: {
                    title: xTitle0,
                    type: xIsLog ? 'log' : 'linear',
                    showgrid: true, zeroline: true,
                    ...(xMin !== undefined && xMax !== undefined ? { range: [xMin, xMax] } : {}),
                },
                yaxis: {
                    title: yTitle0,
                    type: yIsLog ? 'log' : 'linear',
                    showgrid: true, zeroline: true,
                    ...(yMin !== undefined && yMax !== undefined ? { range: [yMin, yMax] } : {}),
                },
                margin: { t: 36, r: 16, b: 60, l: 70 },
                showlegend: traces.length > 1,
                paper_bgcolor: 'white',
                plot_bgcolor: '#f8fafc',
                autosize: true,
            };

            // ── Right-side control panel ──────────────────────────────────
            const cp = document.createElement('div');
            cp.className = 'rp-3d-panel';
            cp.style.maxHeight = 'none';
            cp.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Title</div>
                <label>Plot title<input type="text" id="plt-title-${id}" value="" placeholder="(none)"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">X Axis</div>
                <label>Label<input type="text" id="plt-xl-${id}" value="${xLabel0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label>Units<input type="text" id="plt-xu-${id}" value="${xUnits0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label style="flex-direction:row;align-items:center;gap:6px;margin-top:2px">
                  <input type="checkbox" id="plt-xlog-${id}" ${data.xaxis && data.xaxis.scale === 'log' ? 'checked' : ''}> Log scale
                </label>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="plt-xgrid-${id}" checked> Grid
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Y Axis</div>
                <label>Label<input type="text" id="plt-yl-${id}" value="${yLabel0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label>Units<input type="text" id="plt-yu-${id}" value="${yUnits0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label style="flex-direction:row;align-items:center;gap:6px;margin-top:2px">
                  <input type="checkbox" id="plt-ylog-${id}" ${yIsLog ? 'checked' : ''}> Log scale
                </label>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="plt-ygrid-${id}" checked> Grid
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Display</div>
                ${_isMixed ? `` : _curveType === 'bar' ? `
                <label>Bar gap<input type="range" id="plt-bargap-${id}" min="0" max="0.8" value="0.1" step="0.05"></label>
                ` : _curveType === 'scatter' ? `
                <label>Marker size<input type="range" id="plt-mkrsize-${id}" min="2" max="20" value="6" step="1"></label>
                ` : `
                <label>Line width<input type="range" id="plt-lw-${id}" min="1" max="8" value="2" step="0.5"></label>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="plt-mkr-${id}"> Markers
                </label>
                `}
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="plt-leg-${id}" ${traces.length > 1 ? 'checked' : ''}> Legend
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Theme</div>
                <select id="plt-theme-${id}" style="width:100%;font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #334155;background:#1e293b;color:#e2e8f0">
                  <option value="light" selected>Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn" id="plt-dl-svg-${id}">SVG</button>
                  <button class="rp-3d-btn" id="plt-dl-eps-${id}">EPS</button>
                  <button class="rp-3d-btn" id="plt-dl-png-${id}">PNG</button>
                </div>
              </div>`;
            body.appendChild(cp);

            // Helper: rebuild axis title from label + units fields
            const axTitle = (lEl, uEl) => {
                const l = lEl.value.trim(), u = uEl.value.trim();
                return l + (u ? ` [${u}]` : '');
            };

            // Helper: apply current panel state to Plotly
            const applyLayout = () => {
                const xl = cp.querySelector(`#plt-xl-${id}`);
                const xu = cp.querySelector(`#plt-xu-${id}`);
                const yl = cp.querySelector(`#plt-yl-${id}`);
                const yu = cp.querySelector(`#plt-yu-${id}`);
                Plotly.relayout(plotDiv, {
                    'title.text':         cp.querySelector(`#plt-title-${id}`).value,
                    'xaxis.title':        axTitle(xl, xu),
                    'xaxis.type':         cp.querySelector(`#plt-xlog-${id}`).checked ? 'log' : 'linear',
                    'xaxis.showgrid':     cp.querySelector(`#plt-xgrid-${id}`).checked,
                    'yaxis.title':        axTitle(yl, yu),
                    'yaxis.type':         cp.querySelector(`#plt-ylog-${id}`).checked ? 'log' : 'linear',
                    'yaxis.showgrid':     cp.querySelector(`#plt-ygrid-${id}`).checked,
                    'showlegend':         cp.querySelector(`#plt-leg-${id}`).checked,
                });
            };

            const applyTraces = () => {
                if (_isMixed) {
                    // mixed: no single control; nothing to do
                } else if (_curveType === 'bar') {
                    const gap = parseFloat(cp.querySelector(`#plt-bargap-${id}`).value);
                    Plotly.relayout(plotDiv, { bargap: gap });
                } else if (_curveType === 'scatter') {
                    const sz = parseFloat(cp.querySelector(`#plt-mkrsize-${id}`).value);
                    Plotly.restyle(plotDiv, { 'marker.size': sz });
                } else {
                    const lw  = parseFloat(cp.querySelector(`#plt-lw-${id}`).value);
                    const mkr = cp.querySelector(`#plt-mkr-${id}`).checked;
                    Plotly.restyle(plotDiv, {
                        'line.width': lw,
                        mode: mkr ? 'lines+markers' : 'lines',
                    });
                }
            };

            // Render plot then wire up controls
            const plotLabel = label.replace(/[^a-z0-9]/gi, '_');
            setTimeout(() => {
                Plotly.newPlot(plotDiv, traces, layout, { responsive: true });
                // Wire controls after plot exists
                cp.querySelectorAll('input[type=text], input[type=checkbox]').forEach(el => {
                    el.addEventListener('input', applyLayout);
                });
                if (!_isMixed) {
                    if (_curveType === 'bar') {
                        cp.querySelector(`#plt-bargap-${id}`).addEventListener('input', applyTraces);
                    } else if (_curveType === 'scatter') {
                        cp.querySelector(`#plt-mkrsize-${id}`).addEventListener('input', applyTraces);
                    } else {
                        cp.querySelector(`#plt-lw-${id}`).addEventListener('input', applyTraces);
                        cp.querySelector(`#plt-mkr-${id}`).addEventListener('change', applyTraces);
                    }
                }
                // Theme
                const _applyTheme = () => {
                    const dark = cp.querySelector(`#plt-theme-${id}`).value === 'dark';
                    Plotly.relayout(plotDiv, {
                        paper_bgcolor: dark ? '#1a1a2e' : 'white',
                        plot_bgcolor:  dark ? '#16213e' : '#f8fafc',
                        'xaxis.color': dark ? '#ccd6f6' : '#444',
                        'yaxis.color': dark ? '#ccd6f6' : '#444',
                        'xaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                        'yaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                        font: { color: dark ? '#ccd6f6' : '#444' },
                    });
                };
                cp.querySelector(`#plt-theme-${id}`).addEventListener('change', _applyTheme);
                // Download buttons
                cp.querySelector(`#plt-dl-svg-${id}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, plotLabel, 'svg'));
                cp.querySelector(`#plt-dl-eps-${id}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, plotLabel, 'eps'));
                cp.querySelector(`#plt-dl-png-${id}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, plotLabel, 'png'));
            }, 50);

            return item;
        },

        histogram(id, data) {
            const label = (data.about && data.about.label) || data.label || id;
            const item = rappture.createOutputItem(label, 'plot');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';
            plotDiv.id = 'hist-' + id;
            body.appendChild(plotDiv);

            const xLabel0 = data.xaxis ? data.xaxis.label || '' : '';
            const xUnits0 = data.xaxis ? data.xaxis.units || '' : '';
            const yLabel0 = data.yaxis ? data.yaxis.label || '' : '';
            const yUnits0 = data.yaxis ? data.yaxis.units || '' : '';
            const xTitle0 = xLabel0 + (xUnits0 ? ` [${xUnits0}]` : '');
            const yTitle0 = yLabel0 + (yUnits0 ? ` [${yUnits0}]` : '');

            const runColor = data._runColor || null;
            const runLabel = data._runLabel || null;
            const traces = (data.traces || []).map((t, i) => ({
                x: t.x, y: t.y, type: 'bar',
                name: runLabel ? `${runLabel}${t.label ? ': ' + t.label : ''}` : (t.label || ('Series ' + (i + 1))),
                marker: { color: runColor },
            }));

            const layout = {
                title: { text: '', font: { size: 14 } },
                xaxis: { title: xTitle0, showgrid: true },
                yaxis: { title: yTitle0, showgrid: true },
                margin: { t: 36, r: 16, b: 60, l: 70 },
                bargap: 0.05,
                showlegend: traces.length > 1,
                paper_bgcolor: 'white',
                plot_bgcolor: '#f8fafc',
                autosize: true,
            };

            // Right-side control panel
            const cp = document.createElement('div');
            cp.className = 'rp-3d-panel';
            cp.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Title</div>
                <label>Plot title<input type="text" id="ht-title-${id}" value="" placeholder="(none)"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">X Axis</div>
                <label>Label<input type="text" id="ht-xl-${id}" value="${xLabel0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label>Units<input type="text" id="ht-xu-${id}" value="${xUnits0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="ht-xgrid-${id}" checked> Grid
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Y Axis</div>
                <label>Label<input type="text" id="ht-yl-${id}" value="${yLabel0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label>Units<input type="text" id="ht-yu-${id}" value="${yUnits0}"
                  style="width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px"></label>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="ht-ygrid-${id}" checked> Grid
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Display</div>
                <label style="flex-direction:row;align-items:center;gap:6px">
                  <input type="checkbox" id="ht-leg-${id}" ${traces.length > 1 ? 'checked' : ''}> Legend
                </label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Theme</div>
                <select id="ht-theme-${id}" style="width:100%;font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #334155;background:#1e293b;color:#e2e8f0">
                  <option value="light" selected>Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn" id="ht-dl-svg-${id}">SVG</button>
                  <button class="rp-3d-btn" id="ht-dl-eps-${id}">EPS</button>
                  <button class="rp-3d-btn" id="ht-dl-png-${id}">PNG</button>
                </div>
              </div>`;
            body.appendChild(cp);

            const htLabel = label.replace(/[^a-z0-9]/gi, '_');
            const axTitle = (lEl, uEl) => {
                const l = lEl.value.trim(), u = uEl.value.trim();
                return l + (u ? ` [${u}]` : '');
            };
            const applyLayout = () => {
                const xl = cp.querySelector(`#ht-xl-${id}`);
                const xu = cp.querySelector(`#ht-xu-${id}`);
                const yl = cp.querySelector(`#ht-yl-${id}`);
                const yu = cp.querySelector(`#ht-yu-${id}`);
                Plotly.relayout(plotDiv, {
                    'title.text':     cp.querySelector(`#ht-title-${id}`).value,
                    'xaxis.title':    axTitle(xl, xu),
                    'xaxis.showgrid': cp.querySelector(`#ht-xgrid-${id}`).checked,
                    'yaxis.title':    axTitle(yl, yu),
                    'yaxis.showgrid': cp.querySelector(`#ht-ygrid-${id}`).checked,
                    'showlegend':     cp.querySelector(`#ht-leg-${id}`).checked,
                });
            };

            setTimeout(() => {
                Plotly.newPlot(plotDiv, traces, layout, { responsive: true });
                cp.querySelectorAll('input[type=text], input[type=checkbox]').forEach(el => {
                    el.addEventListener('input', applyLayout);
                });
                const _applyHtTheme = () => {
                    const dark = cp.querySelector(`#ht-theme-${id}`).value === 'dark';
                    Plotly.relayout(plotDiv, {
                        paper_bgcolor: dark ? '#1a1a2e' : 'white',
                        plot_bgcolor:  dark ? '#16213e' : '#f8fafc',
                        'xaxis.color': dark ? '#ccd6f6' : '#444',
                        'yaxis.color': dark ? '#ccd6f6' : '#444',
                        'xaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                        'yaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                        font: { color: dark ? '#ccd6f6' : '#444' },
                    });
                };
                cp.querySelector(`#ht-theme-${id}`).addEventListener('change', _applyHtTheme);
                cp.querySelector(`#ht-dl-svg-${id}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, htLabel, 'svg'));
                cp.querySelector(`#ht-dl-eps-${id}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, htLabel, 'eps'));
                cp.querySelector(`#ht-dl-png-${id}`).addEventListener('click', () =>
                    rappture._downloadPlot(plotDiv, htLabel, 'png'));
            }, 50);
            return item;
        },

        number(id, data) {
            const label = (data.about && data.about.label) || data.label || id;
            const item = rappture.createOutputItem(label, 'number');
            item.querySelector('.rp-output-body').innerHTML =
                `<span class="rp-output-value">${data.current || ''}</span>` +
                (data.units ? `<span class="rp-output-units">${data.units}</span>` : '');
            return item;
        },

        integer(id, data) { return rappture.outputRenderers.number(id, data); },

        boolean(id, data) {
            const label = (data.about && data.about.label) || data.label || id;
            const item = rappture.createOutputItem(label, 'boolean');
            const val = (data.current || '').toLowerCase();
            item.querySelector('.rp-output-body').textContent =
                ['yes', 'on', 'true', '1'].includes(val) ? 'Yes' : 'No';
            return item;
        },

        string(id, data) {
            const label = (data.about && data.about.label) || data.label || id;
            const item = rappture.createOutputItem(label, 'string');
            item.querySelector('.rp-output-body').textContent = data.current || '';
            return item;
        },

        image(id, data) {
            const label = (data.about && data.about.label) || data.label || id;
            const item = rappture.createOutputItem(label, 'image');
            const body = item.querySelector('.rp-output-body');
            if (data.current) {
                const img = document.createElement('img');
                let src = data.current.trim();
                // Server decodes to data URI; handle legacy b64 strings from old cache
                if (src.startsWith('@@RP-ENC:b64')) {
                    src = 'data:image/png;base64,' + src.replace(/^@@RP-ENC:b64\s*/, '').trim();
                } else if (src.startsWith('@@RP-ENC:zb64')) {
                    body.textContent = '(Re-run simulation to display image)';
                    return item;
                } else if (!src.startsWith('data:')) {
                    src = 'data:image/png;base64,' + src;
                }
                img.src = src;
                img.alt = label;
                img.style.cssText = 'max-width:100%;display:block';
                body.appendChild(img);
            }
            return item;
        },

        log(id, data) {
            const item = rappture.createOutputItem('Log', 'log');
            item.querySelector('.rp-output-body').textContent = data.content || '';
            return item;
        },

        table(id, data) {
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
                plotDiv.style.cssText = 'width:100%;height:420px';
                body.style.cssText = 'padding:0;display:flex;flex-direction:column';
                body.appendChild(plotDiv);

                // ── Build traces for one run's levels ──────────────────────
                // xSuffix/ySuffix: '' for overview, '2' for zoom
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

                    // Normal levels (overview only — zoom shows HOMO/LUMO only)
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

        group(id, data) {
            const wrapper = document.createElement('div');
            if (data.children) {
                for (const [cid, cdata] of Object.entries(data.children)) {
                    const renderer = rappture.outputRenderers[cdata.type];
                    if (renderer) {
                        const el = renderer.call(rappture, cid, cdata);
                        if (el) wrapper.appendChild(el);
                    }
                }
            }
            return wrapper;
        },

        sequence(id, data) {
            const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'sequence');
            const body = item.querySelector('.rp-output-body');
            if (!data.elements || data.elements.length === 0) {
                body.textContent = 'No sequence data';
                return item;
            }

            const n = data.elements.length;
            const indexLabel = data.index_label || 'Frame';

            // SVG icons for sequence controls
            const _svgReset  = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="2" width="2" height="12"/><polygon points="4,8 14,2 14,14"/></svg>';
            const _svgPrev   = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="9,2 1,8 9,14"/><polygon points="15,2 7,8 15,14"/></svg>';
            const _svgNext   = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="7,2 15,8 7,14"/><polygon points="1,2 9,8 1,14"/></svg>';
            const _svgPlay   = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="3,2 13,8 3,14"/></svg>';
            const _svgPause  = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>';

            const controls = document.createElement('div');
            controls.className = 'rp-seq-controls';
            // Prev button
            const prevBtn = document.createElement('button');
            prevBtn.type = 'button'; prevBtn.className = 'rp-seq-btn'; prevBtn.innerHTML = _svgPrev;
            prevBtn.title = 'Previous frame';
            // Label
            const lbl = document.createElement('span');
            lbl.className = 'rp-seq-label';
            lbl.textContent = indexLabel + ' 1 / ' + n;
            // Next button
            const nextBtn = document.createElement('button');
            nextBtn.type = 'button'; nextBtn.className = 'rp-seq-btn'; nextBtn.innerHTML = _svgNext;
            nextBtn.title = 'Next frame';
            // Slider row
            const sliderWrap = document.createElement('div');
            sliderWrap.className = 'rp-seq-slider-wrap';
            const slider = document.createElement('input');
            slider.type = 'range'; slider.className = 'rp-seq-slider';
            slider.min = 0; slider.max = n - 1; slider.value = 0;
            // Tick marks
            const datalist = document.createElement('datalist');
            datalist.id = 'rp-seq-ticks-' + id.replace(/[^a-z0-9]/gi, '_');
            for (let i = 0; i < n; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.label = data.elements[i].index !== undefined ? String(data.elements[i].index) : String(i);
                datalist.appendChild(opt);
            }
            slider.setAttribute('list', datalist.id);
            sliderWrap.appendChild(datalist);
            sliderWrap.appendChild(slider);

            // Play / Pause / Reset buttons
            const playBtn = document.createElement('button');
            playBtn.type = 'button'; playBtn.className = 'rp-seq-btn rp-seq-play'; playBtn.innerHTML = _svgPlay; playBtn.title = 'Play';
            const pauseBtn = document.createElement('button');
            pauseBtn.type = 'button'; pauseBtn.className = 'rp-seq-btn rp-seq-pause'; pauseBtn.innerHTML = _svgPause; pauseBtn.title = 'Pause'; pauseBtn.style.display = 'none';
            const resetBtn = document.createElement('button');
            resetBtn.type = 'button'; resetBtn.className = 'rp-seq-btn rp-seq-reset'; resetBtn.innerHTML = _svgReset; resetBtn.title = 'Reset';

            const topRow = document.createElement('div');
            topRow.className = 'rp-seq-top-row';
            topRow.appendChild(resetBtn);
            topRow.appendChild(prevBtn);
            topRow.appendChild(lbl);
            topRow.appendChild(nextBtn);
            topRow.appendChild(playBtn);
            topRow.appendChild(pauseBtn);
            controls.appendChild(topRow);
            controls.appendChild(sliderWrap);

            const plotDiv = document.createElement('div');
            plotDiv.className = 'rp-output-plot';

            body.appendChild(controls);
            body.appendChild(plotDiv);

            let _seqTimer = null;
            const _seqStop = () => {
                if (_seqTimer) { clearInterval(_seqTimer); _seqTimer = null; }
                playBtn.style.display = ''; pauseBtn.style.display = 'none';
            };

            const renderFrame = (idx) => {
                slider.value = idx;
                const el = data.elements[idx];
                prevBtn.disabled = idx === 0;
                nextBtn.disabled = idx === n - 1;
                lbl.textContent = indexLabel + ': ' + (el.index !== undefined ? el.index : idx);
                // Destroy any Three.js viewers in previous frame before clearing
                plotDiv.querySelectorAll('canvas').forEach(c => {
                    if (c._rpRenderer) { try { c._rpRenderer.dispose(); } catch(e) {} }
                });
                plotDiv.innerHTML = '';
                for (const [oid, odata] of Object.entries(el.outputs || {})) {
                    const renderer = rappture.outputRenderers[odata.type];
                    if (renderer) {
                        const rendered = renderer.call(rappture.outputRenderers, oid, odata);
                        if (rendered) {
                            // Strip the outer output-item wrapper — just use the body content
                            const inner = rendered.querySelector('.rp-output-body');
                            if (inner) {
                                plotDiv.appendChild(inner);
                            } else {
                                plotDiv.appendChild(rendered);
                            }
                        }
                        break; // render first output per frame
                    }
                }
                if (idx === n - 1) _seqStop();
            };

            slider.addEventListener('input', () => { _seqStop(); renderFrame(parseInt(slider.value)); });
            prevBtn.addEventListener('click', () => { _seqStop(); const v = Math.max(0, parseInt(slider.value) - 1); renderFrame(v); });
            nextBtn.addEventListener('click', () => { _seqStop(); const v = Math.min(n - 1, parseInt(slider.value) + 1); renderFrame(v); });
            resetBtn.addEventListener('click', () => { _seqStop(); renderFrame(0); });
            playBtn.addEventListener('click', () => {
                let cur = parseInt(slider.value);
                if (cur >= n - 1) cur = 0;
                renderFrame(cur);
                playBtn.style.display = 'none'; pauseBtn.style.display = '';
                _seqTimer = setInterval(() => {
                    cur = parseInt(slider.value) + 1;
                    if (cur >= n) { _seqStop(); return; }
                    renderFrame(cur);
                }, 600);
            });
            pauseBtn.addEventListener('click', _seqStop);
            requestAnimationFrame(() => renderFrame(0));
            return item;
        },

        field(id, data) {
            const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'field');
            item.classList.add('rp-output-plot-item');
            const body = item.querySelector('.rp-output-body');

            // ── Helper: build axis coordinate array from mesh axes def ────
            const _mkAxis = (ax) => {
                if (!ax) return [0];
                if (ax.coords && ax.coords.length) return ax.coords;
                const n = Math.max(ax.numpoints || 1, 1);
                const lo = ax.min !== undefined ? ax.min : 0;
                const hi = ax.max !== undefined ? ax.max : 1;
                const pts = [];
                for (let i = 0; i < n; i++) pts.push(lo + (hi - lo) * i / Math.max(n - 1, 1));
                return pts;
            };

            // ── 2-D scalar grid → Plotly heatmap ─────────────────────────
            const firstComp = (data.components || [])[0];
            const firstMesh = firstComp && firstComp.mesh;
            const is2DGrid = firstMesh && firstMesh.mesh_type === 'grid'
                && firstMesh.axes && firstMesh.axes.x && firstMesh.axes.y && !firstMesh.axes.z
                && (firstComp.extents || 1) === 1;

            if (is2DGrid) {
                const axes = firstMesh.axes;
                const xs = _mkAxis(axes.x);
                const ys = _mkAxis(axes.y);
                const vals = firstComp.values || [];
                // vals stored x-major (ix outer, iy inner) matching numpy mgrid indexing
                // Plotly heatmap z[yi][xi]: row=y, col=x
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
                    paper_bgcolor: 'white', plot_bgcolor: '#f8fafc',
                    autosize: true,
                };

                const inputStyle = 'width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px';
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
                    <label>Plot title<input type="text" id="fld2-ttl-${id}" value="" placeholder="(none)" style="${inputStyle}"></label>
                    <label>Colorbar title<input type="text" id="fld2-cbtl-${id}" value="" placeholder="(none)" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">X Axis</div>
                    <label>Label<input type="text" id="fld2-xl-${id}" value="${xLabel0}" style="${inputStyle}"></label>
                    <label>Min<input type="number" id="fld2-xlo-${id}" value="${xMin0}" step="any" style="${inputStyle}"></label>
                    <label>Max<input type="number" id="fld2-xhi-${id}" value="${xMax0}" step="any" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Y Axis</div>
                    <label>Label<input type="text" id="fld2-yl-${id}" value="${yLabel0}" style="${inputStyle}"></label>
                    <label>Min<input type="number" id="fld2-ylo-${id}" value="${yMin0}" step="any" style="${inputStyle}"></label>
                    <label>Max<input type="number" id="fld2-yhi-${id}" value="${yMax0}" step="any" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Color scale</div>
                    <select id="fld2-cs-${id}" style="${inputStyle}">
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
                      <input type="checkbox" id="fld2-rev-${id}"> Reverse
                    </label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Display</div>
                    <label style="flex-direction:row;align-items:center;gap:6px">
                      <input type="checkbox" id="fld2-sm-${id}" checked> Interpolate
                    </label>
                    <label style="flex-direction:row;align-items:center;gap:6px">
                      <input type="checkbox" id="fld2-ct-${id}" checked> Contours
                    </label>
                    <label>Contour #<input type="range" id="fld2-nc-${id}" min="3" max="30" value="10" step="1"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Theme</div>
                    <select id="fld2-theme-${id}" style="width:100%;font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #334155;background:#1e293b;color:#e2e8f0">
                      <option value="light" selected>Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Download</div>
                    <div class="rp-panel-btns">
                      <button class="rp-3d-btn" id="fld2-svg-${id}">SVG</button>
                      <button class="rp-3d-btn" id="fld2-png-${id}">PNG</button>
                    </div>
                  </div>`;

                const outerWrap = document.createElement('div');
                outerWrap.style.cssText = 'display:flex;width:100%;height:100%;min-height:0';
                outerWrap.appendChild(plotDiv);
                outerWrap.appendChild(cp);
                body.appendChild(outerWrap);

                const _fld2Key = 'rp2w:fld2:' + window.location.pathname + ':' + id;
                const _fld2Save = () => {
                    const s = {};
                    ['fld2-ttl','fld2-cbtl','fld2-xl','fld2-yl','fld2-xlo','fld2-xhi','fld2-ylo','fld2-yhi','fld2-cs','fld2-nc'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${id}`);
                        if (el) s[k] = el.type === 'checkbox' ? el.checked : el.value;
                    });
                    ['fld2-rev','fld2-sm','fld2-ct'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${id}`);
                        if (el) s[k] = el.checked;
                    });
                    try { localStorage.setItem(_fld2Key, JSON.stringify(s)); } catch(e) {}
                };
                const _fld2Load = () => {
                    try {
                        const s = JSON.parse(localStorage.getItem(_fld2Key) || 'null');
                        if (!s) return;
                        ['fld2-ttl','fld2-cbtl','fld2-xl','fld2-yl','fld2-xlo','fld2-xhi','fld2-ylo','fld2-yhi','fld2-cs','fld2-nc'].forEach(k => {
                            const el = cp.querySelector(`#${k}-${id}`);
                            if (el && s[k] !== undefined) el.value = s[k];
                        });
                        ['fld2-rev','fld2-sm','fld2-ct'].forEach(k => {
                            const el = cp.querySelector(`#${k}-${id}`);
                            if (el && s[k] !== undefined) el.checked = s[k];
                        });
                    } catch(e) {}
                };
                _fld2Load();

                setTimeout(() => {
                    Plotly.newPlot(plotDiv, traces, layout, { responsive: true });

                    const applyLayout = () => {
                        const cs = cp.querySelector(`#fld2-cs-${id}`).value;
                        const rev = cp.querySelector(`#fld2-rev-${id}`).checked;
                        Plotly.relayout(plotDiv, {
                            'title.text': cp.querySelector(`#fld2-ttl-${id}`).value,
                            'xaxis.title': cp.querySelector(`#fld2-xl-${id}`).value,
                            'xaxis.range': [
                                parseFloat(cp.querySelector(`#fld2-xlo-${id}`).value),
                                parseFloat(cp.querySelector(`#fld2-xhi-${id}`).value),
                            ],
                            'yaxis.title': cp.querySelector(`#fld2-yl-${id}`).value,
                            'yaxis.range': [
                                parseFloat(cp.querySelector(`#fld2-ylo-${id}`).value),
                                parseFloat(cp.querySelector(`#fld2-yhi-${id}`).value),
                            ],
                        });
                        const showCt = cp.querySelector(`#fld2-ct-${id}`).checked;
                        const nc = parseInt(cp.querySelector(`#fld2-nc-${id}`).value);
                        const smooth = cp.querySelector(`#fld2-sm-${id}`).checked;
                        const cbTitle = cp.querySelector(`#fld2-cbtl-${id}`).value;
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

                    const _applyFld2Theme = () => {
                        const dark = cp.querySelector(`#fld2-theme-${id}`).value === 'dark';
                        Plotly.relayout(plotDiv, {
                            paper_bgcolor: dark ? '#1a1a2e' : 'white',
                            plot_bgcolor:  dark ? '#16213e' : '#f8fafc',
                            'xaxis.color': dark ? '#ccd6f6' : '#444',
                            'yaxis.color': dark ? '#ccd6f6' : '#444',
                            'xaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                            'yaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                            font: { color: dark ? '#ccd6f6' : '#444' },
                        });
                    };
                    cp.querySelector(`#fld2-theme-${id}`).addEventListener('change', _applyFld2Theme);

                    const fldLabel = ((data.about && data.about.label) || data.label || id).replace(/[^a-z0-9]/gi, '_');
                    cp.querySelector(`#fld2-svg-${id}`).addEventListener('click', () =>
                        rappture._downloadPlot(plotDiv, fldLabel, 'svg'));
                    cp.querySelector(`#fld2-png-${id}`).addEventListener('click', () =>
                        rappture._downloadPlot(plotDiv, fldLabel, 'png'));
                }, 50);

                return item;
            }

            // ── 3D scalar grid → Plotly volume ───────────────────────────
            const is3DGrid = firstMesh && firstMesh.mesh_type === 'grid'
                && firstMesh.axes && firstMesh.axes.x && firstMesh.axes.y && firstMesh.axes.z
                && (firstComp.extents || 1) === 1;

            if (is3DGrid) {
                const axes = firstMesh.axes;
                const xs = _mkAxis(axes.x), ys = _mkAxis(axes.y), zs = _mkAxis(axes.z);
                const vals = firstComp.values || [];
                const nx = xs.length, ny = ys.length, nz = zs.length;

                // Expand flat x-major values into per-point x/y/z/value arrays
                // numpy mgrid order: [ix, iy, iz] → flat index = ix*(ny*nz) + iy*nz + iz
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
                plotDiv.style.cssText = 'flex:1;min-height:400px;min-width:0';

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
                    paper_bgcolor: 'white',
                    autosize: true,
                };

                const inputStyle = 'width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px';
                const cp = document.createElement('div');
                cp.className = 'rp-3d-panel';
                cp.style.maxHeight = 'none';
                cp.innerHTML = `
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Title</div>
                    <label>Plot title<input type="text" id="fld3-ttl-${id}" value="" placeholder="(none)" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Axes</div>
                    <label>X label<input type="text" id="fld3-xl-${id}" value="${mkLbl('X')}" style="${inputStyle}"></label>
                    <label>Y label<input type="text" id="fld3-yl-${id}" value="${mkLbl('Y')}" style="${inputStyle}"></label>
                    <label>Z label<input type="text" id="fld3-zl-${id}" value="${mkLbl('Z')}" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Volume</div>
                    <label>Opacity<input type="range" id="fld3-op-${id}" min="0.01" max="1" step="0.01" value="0.2"></label>
                    <label>Surfaces<input type="range" id="fld3-ns-${id}" min="2" max="20" step="1" value="8"></label>
                    <label>Min value<input type="number" id="fld3-lo-${id}" value="${_vmin3d.toFixed(4)}" step="any" style="${inputStyle}"></label>
                    <label>Max value<input type="number" id="fld3-hi-${id}" value="${_vmax3d.toFixed(4)}" step="any" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Color scale</div>
                    <select id="fld3-cs-${id}" style="${inputStyle}">
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
                      <input type="checkbox" id="fld3-rev-${id}"> Reverse
                    </label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Download</div>
                    <div class="rp-panel-btns">
                      <button class="rp-3d-btn" id="fld3-png-${id}">PNG</button>
                    </div>
                  </div>`;

                const outerWrap = document.createElement('div');
                outerWrap.style.cssText = 'display:flex;width:100%;height:100%;min-height:0';
                outerWrap.appendChild(plotDiv);
                outerWrap.appendChild(cp);
                body.appendChild(outerWrap);

                const _fld3Key = 'rp2w:fld3:' + window.location.pathname + ':' + id;
                const _fld3Save = () => {
                    const s = {};
                    ['fld3-ttl','fld3-xl','fld3-yl','fld3-zl','fld3-cs'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${id}`); if (el) s[k] = el.value;
                    });
                    ['fld3-op','fld3-ns','fld3-lo','fld3-hi'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${id}`); if (el) s[k] = el.value;
                    });
                    const rev = cp.querySelector(`#fld3-rev-${id}`); if (rev) s['fld3-rev'] = rev.checked;
                    try { localStorage.setItem(_fld3Key, JSON.stringify(s)); } catch(e) {}
                };
                const _fld3Load = () => {
                    try {
                        const s = JSON.parse(localStorage.getItem(_fld3Key) || 'null');
                        if (!s) return;
                        ['fld3-ttl','fld3-xl','fld3-yl','fld3-zl','fld3-cs','fld3-op','fld3-ns','fld3-lo','fld3-hi'].forEach(k => {
                            const el = cp.querySelector(`#${k}-${id}`); if (el && s[k] !== undefined) el.value = s[k];
                        });
                        const rev = cp.querySelector(`#fld3-rev-${id}`);
                        if (rev && s['fld3-rev'] !== undefined) rev.checked = s['fld3-rev'];
                    } catch(e) {}
                };
                _fld3Load();

                setTimeout(() => {
                    Plotly.newPlot(plotDiv, traces, layout, { responsive: true });

                    const applyOpts = () => {
                        const cs = cp.querySelector(`#fld3-cs-${id}`).value;
                        const rev = cp.querySelector(`#fld3-rev-${id}`).checked;
                        const op = parseFloat(cp.querySelector(`#fld3-op-${id}`).value);
                        const ns = parseInt(cp.querySelector(`#fld3-ns-${id}`).value);
                        const lo = parseFloat(cp.querySelector(`#fld3-lo-${id}`).value);
                        const hi = parseFloat(cp.querySelector(`#fld3-hi-${id}`).value);
                        _fld3Save();
                        // surface.count is a nested object — use react to rebuild the trace
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
                                    xaxis: { title: cp.querySelector(`#fld3-xl-${id}`).value },
                                    yaxis: { title: cp.querySelector(`#fld3-yl-${id}`).value },
                                    zaxis: { title: cp.querySelector(`#fld3-zl-${id}`).value },
                                    camera: plotDiv._fullLayout.scene.camera,
                                },
                                'title.text': cp.querySelector(`#fld3-ttl-${id}`).value,
                            } : {},
                            margin: { t: 50, r: 20, b: 20, l: 20 },
                            paper_bgcolor: 'white', autosize: true,
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
                    cp.querySelector(`#fld3-png-${id}`).addEventListener('click', () =>
                        Plotly.downloadImage(plotDiv, { format: 'png', filename: fldLabel }));
                }, 50);

                return item;
            }

            // ── VTK STRUCTURED_POINTS → Plotly volume ────────────────────
            const isVtkStructured = firstComp && firstComp.vtk_type === 'structured_points'
                && firstComp.grid_data && firstComp.grid_data.nx;

            if (isVtkStructured) {
                // Expand ALL VTK components (e.g. wf + shape) into separate coordinate arrays
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
                const main = expanded[0];  // primary field (wf)
                const vmin = main.vmin, vmax = main.vmax;

                // Parse style string "-color X -opacity Y -levels N"
                const parseStyle = (styleStr) => {
                    const m = (key) => { const r = new RegExp(`-${key}\\s+(\\S+)`); const m2 = r.exec(styleStr); return m2 ? m2[1] : null; };
                    return { color: m('color'), opacity: parseFloat(m('opacity') || '0.2'), levels: parseInt(m('levels') || '3') };
                };

                // Title: prefer label from about, fall back to scalar name, never use raw id
                const fldLabelVtk = (data.label && data.label !== id ? data.label : '')
                    || main.scalar || id;
                const colorscales = ['Viridis','Plasma','Inferno','Magma','Cividis','RdBu','Spectral','Jet','Hot','Blues'];
                const inputStyle = 'width:100%;font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #334155;background:#1e293b;color:#e2e8f0';

                // (toggle handled by sidecar tab below)

                const cp = document.createElement('div');
                cp.className = 'rp-3d-panel';
                cp.style.maxHeight = '520px';
                cp.innerHTML = `
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Title</div>
                    <label>Plot<input type="text" id="fld3v-ttl-${id}" value="${fldLabelVtk}" placeholder="(none)" style="${inputStyle}"></label>
                    <label>Colorbar<input type="text" id="fld3v-cbtl-${id}" value="${main.scalar || ''}" placeholder="(none)" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Render Mode</div>
                    <div class="rp-panel-btns">
                      <button class="rp-3d-btn active" id="fld3v-iso-${id}">Isosurfaces</button>
                      <button class="rp-3d-btn" id="fld3v-vol-${id}">Volume</button>
                    </div>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Axes</div>
                    <label>X Label<input type="text" id="fld3v-xl-${id}" value="X" style="${inputStyle}"></label>
                    <label>Y Label<input type="text" id="fld3v-yl-${id}" value="Y" style="${inputStyle}"></label>
                    <label>Z Label<input type="text" id="fld3v-zl-${id}" value="Z" style="${inputStyle}"></label>
                    <label style="margin-top:4px">Aspect
                      <select id="fld3v-asp-${id}" style="${inputStyle}">
                        <option value="data" selected>Data (proportional)</option>
                        <option value="cube">Cube</option>
                        <option value="auto">Auto</option>
                      </select>
                    </label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Field: ${main.scalar || 'wf'}</div>
                    <label>Surfaces<input type="range" id="fld3v-ns-${id}" min="1" max="20" step="1" value="10"><span id="fld3v-ns-v-${id}">10</span></label>
                    <label>Opacity<input type="range" id="fld3v-op-${id}" min="0.05" max="1" step="0.05" value="0.6"><span id="fld3v-op-v-${id}">0.6</span></label>
                    <label>Value Min<input type="number" id="fld3v-lo-${id}" value="${vmin.toFixed(4)}" step="any" style="${inputStyle}"></label>
                    <label>Value Max<input type="number" id="fld3v-hi-${id}" value="${vmax.toFixed(4)}" step="any" style="${inputStyle}"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Color Scale</div>
                    <select id="fld3v-cs-${id}" style="${inputStyle}">${colorscales.map(c=>`<option${c==='Viridis'?' selected':''}>${c}</option>`).join('')}</select>
                    <label style="margin-top:4px;flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-rev-${id}"> Reverse</label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Display</div>
                    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-leg-${id}" checked> Legend</label>
                    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-xgrid-${id}" checked> X Grid</label>
                    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-ygrid-${id}" checked> Y Grid</label>
                    <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fld3v-zgrid-${id}" checked> Z Grid</label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Theme</div>
                    <select id="fld3v-theme-${id}" style="${inputStyle}">
                      <option value="light" selected>Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Download</div>
                    <div class="rp-panel-btns">
                      <button class="rp-3d-btn" id="fld3v-svg-${id}">SVG</button>
                      <button class="rp-3d-btn" id="fld3v-png-${id}">PNG</button>
                    </div>
                  </div>`;

                const plotDiv = document.createElement('div');
                plotDiv.className = 'rp-output-plot';
                plotDiv.style.cssText = 'flex:1;min-height:400px;min-width:0';

                // ── Collapsible sidecar ───────────────────────────────────
                const panelWrap = document.createElement('div');
                panelWrap.className = 'rp-3d-panel-wrap';

                const tab = document.createElement('div');
                tab.className = 'rp-3d-panel-tab';
                tab.title = 'Toggle control panel';
                tab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';

                panelWrap.appendChild(tab);
                panelWrap.appendChild(cp);

                const outerWrap = document.createElement('div');
                outerWrap.style.cssText = 'display:flex;width:100%;min-height:400px;align-items:stretch';
                outerWrap.appendChild(plotDiv);
                outerWrap.appendChild(panelWrap);
                body.appendChild(outerWrap);

                tab.addEventListener('click', () => {
                    panelWrap.classList.toggle('collapsed');
                    setTimeout(() => Plotly.relayout(plotDiv, { autosize: true }), 220);
                });

                let _vtkMode = 'iso'; // 'iso' | 'vol'

                setTimeout(() => {
                    const _getLayout = () => {
                        const dark = cp.querySelector(`#fld3v-theme-${id}`).value === 'dark';
                        const asp  = cp.querySelector(`#fld3v-asp-${id}`).value;
                        const showleg = cp.querySelector(`#fld3v-leg-${id}`).checked;
                        const xgrid = cp.querySelector(`#fld3v-xgrid-${id}`).checked;
                        const ygrid = cp.querySelector(`#fld3v-ygrid-${id}`).checked;
                        const zgrid = cp.querySelector(`#fld3v-zgrid-${id}`).checked;
                        const ttl   = cp.querySelector(`#fld3v-ttl-${id}`).value;
                        const xl    = cp.querySelector(`#fld3v-xl-${id}`).value;
                        const yl    = cp.querySelector(`#fld3v-yl-${id}`).value;
                        const zl    = cp.querySelector(`#fld3v-zl-${id}`).value;
                        const axColor = dark ? '#ccd6f6' : '#444';
                        const gridColor = dark ? '#2a2a4e' : '#e0e0e0';
                        const cam = plotDiv._fullLayout && plotDiv._fullLayout.scene
                            ? plotDiv._fullLayout.scene.camera : null;
                        return {
                            scene: {
                                xaxis: { title: xl, color: axColor, showgrid: xgrid, gridcolor: gridColor },
                                yaxis: { title: yl, color: axColor, showgrid: ygrid, gridcolor: gridColor },
                                zaxis: { title: zl, color: axColor, showgrid: zgrid, gridcolor: gridColor },
                                bgcolor: dark ? '#16213e' : '#f8fafc',
                                aspectmode: asp,
                                ...(cam ? { camera: cam } : {}),
                            },
                            title: { text: ttl, font: { color: dark ? '#ccd6f6' : '#333' } },
                            showlegend: showleg,
                            legend: { x: 0, y: 1, bgcolor: dark ? 'rgba(26,26,46,0.8)' : 'rgba(255,255,255,0.8)', font: { size: 10, color: dark ? '#ccd6f6' : '#333' } },
                            margin: { t: 50, r: 20, b: 20, l: 20 },
                            paper_bgcolor: dark ? '#1a1a2e' : 'white',
                            font: { color: dark ? '#ccd6f6' : '#333' },
                            autosize: true,
                        };
                    };

                    const _mkTracesVtk = (cs, rev, op, ns, lo, hi) => {
                        const caps = _vtkMode === 'vol'
                            ? { x: { show: true }, y: { show: true }, z: { show: true } }
                            : { x: { show: false }, y: { show: false }, z: { show: false } };
                        const cbtl = cp.querySelector(`#fld3v-cbtl-${id}`).value;
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
                        const cs  = cp.querySelector(`#fld3v-cs-${id}`).value;
                        const rev = cp.querySelector(`#fld3v-rev-${id}`).checked;
                        const op  = parseFloat(cp.querySelector(`#fld3v-op-${id}`).value);
                        const ns  = parseInt(cp.querySelector(`#fld3v-ns-${id}`).value);
                        const lo  = parseFloat(cp.querySelector(`#fld3v-lo-${id}`).value);
                        const hi  = parseFloat(cp.querySelector(`#fld3v-hi-${id}`).value);
                        cp.querySelector(`#fld3v-ns-v-${id}`).textContent = ns;
                        cp.querySelector(`#fld3v-op-v-${id}`).textContent = op.toFixed(2);
                        Plotly.react(plotDiv, _mkTracesVtk(cs, rev, op, ns, lo, hi), _getLayout());
                    };

                    Plotly.newPlot(plotDiv,
                        _mkTracesVtk('Viridis', false, 0.6, 10, vmin, vmax),
                        _getLayout(), { responsive: true });

                    // Render mode toggle
                    const isoBtn = cp.querySelector(`#fld3v-iso-${id}`);
                    const volBtn = cp.querySelector(`#fld3v-vol-${id}`);
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
                    cp.querySelector(`#fld3v-svg-${id}`).addEventListener('click', () =>
                        Plotly.downloadImage(plotDiv, { format: 'svg', filename: fname }));
                    cp.querySelector(`#fld3v-png-${id}`).addEventListener('click', () =>
                        Plotly.downloadImage(plotDiv, { format: 'png', filename: fname }));
                }, 50);

                return item;
            }

            // ── 3D unstructured scalar field → Plotly isosurface ─────────
            const is3DUnstructuredScalar = firstMesh && firstMesh.mesh_type === 'unstructured'
                && firstMesh.points && firstMesh.points.length > 0
                && (firstComp.extents || 1) === 1
                && firstMesh.points[0] && firstMesh.points[0].length === 3;

            if (is3DUnstructuredScalar) {
                // Use pre-interpolated uniform grid if available (scipy griddata on server),
                // otherwise fall back to raw scattered points (isosurface may look sparse).
                const gd = firstComp.grid_data;
                const pts = firstMesh.points;
                const vals = firstComp.values || [];
                const px = gd ? gd.x : pts.map(p => p[0]);
                const py = gd ? gd.y : pts.map(p => p[1]);
                const pz = gd ? gd.z : pts.map(p => p[2]);
                const pv = gd ? gd.value : pts.map((_, i) => vals[i] ?? 0);
                // Use reduce instead of spread to avoid JS argument-count limit on large arrays
                let vmin = Infinity, vmax = -Infinity;
                for (let i = 0; i < pv.length; i++) {
                    const v = pv[i]; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
                }
                console.log('[rp field] id=%s gd=%s pts=%d vmin=%s vmax=%s', id, !!gd, px.length, vmin, vmax);

                const fldLabel3u = ((data.about && data.about.label) || data.label || id);
                const units3u = firstMesh.units || '';
                const mkLbl3u = (ax) => ax + (units3u ? ` [${units3u}]` : '');

                const colorscales = ['Viridis','Plasma','Inferno','Magma','Cividis','RdBu','Spectral','Jet','Hot','Blues'];
                const cp = document.createElement('div');
                cp.className = 'rp-3d-panel';
                cp.innerHTML = `
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Title</div>
                    <label>Plot<input type="text" id="fld3u-ttl-${id}" value="${fldLabel3u}" style="width:100%;margin-top:2px"></label>
                    <label>X Axis<input type="text" id="fld3u-xl-${id}" value="${mkLbl3u('X')}" style="width:100%;margin-top:2px"></label>
                    <label>Y Axis<input type="text" id="fld3u-yl-${id}" value="${mkLbl3u('Y')}" style="width:100%;margin-top:2px"></label>
                    <label>Z Axis<input type="text" id="fld3u-zl-${id}" value="${mkLbl3u('Z')}" style="width:100%;margin-top:2px"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Isosurfaces</div>
                    <label>Surfaces<input type="range" id="fld3u-ns-${id}" min="1" max="20" step="1" value="10"><span id="fld3u-ns-v-${id}">10</span></label>
                    <label>Opacity<input type="range" id="fld3u-op-${id}" min="0.05" max="1" step="0.05" value="0.6"><span id="fld3u-op-v-${id}">0.6</span></label>
                    <label>Value Min<input type="number" id="fld3u-lo-${id}" value="${vmin.toFixed(4)}" step="any"></label>
                    <label>Value Max<input type="number" id="fld3u-hi-${id}" value="${vmax.toFixed(4)}" step="any"></label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Color Scale</div>
                    <select id="fld3u-cs-${id}">${colorscales.map(c=>`<option${c==='Viridis'?' selected':''}>${c}</option>`).join('')}</select>
                    <label style="margin-top:4px"><input type="checkbox" id="fld3u-rev-${id}"> Reverse</label>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Theme</div>
                    <select id="fld3u-theme-${id}" style="width:100%;font-size:11px;padding:2px 4px;border-radius:3px;border:1px solid #334155;background:#1e293b;color:#e2e8f0">
                      <option value="light" selected>Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>
                  <div class="rp-panel-section">
                    <div class="rp-panel-title">Download</div>
                    <button class="rp-3d-btn" id="fld3u-png-${id}">PNG</button>
                  </div>`;

                const plotDiv = document.createElement('div');
                plotDiv.className = 'rp-output-plot';
                plotDiv.id = 'fld3u-' + id;
                plotDiv.style.cssText = 'flex:1;min-height:400px;min-width:0';

                const outerWrap = document.createElement('div');
                outerWrap.style.cssText = 'display:flex;width:100%;height:100%;min-height:0';
                outerWrap.appendChild(plotDiv);
                outerWrap.appendChild(cp);
                body.appendChild(outerWrap);

                const _fld3uKey = 'rp2w:fld3u:' + window.location.pathname + ':' + id;
                const _fld3uSave = () => {
                    const s = {};
                    ['fld3u-ttl','fld3u-xl','fld3u-yl','fld3u-zl','fld3u-cs','fld3u-op','fld3u-ns','fld3u-lo','fld3u-hi'].forEach(k => {
                        const el = cp.querySelector(`#${k}-${id}`); if (el) s[k] = el.value;
                    });
                    const rev = cp.querySelector(`#fld3u-rev-${id}`); if (rev) s['fld3u-rev'] = rev.checked;
                    try { localStorage.setItem(_fld3uKey, JSON.stringify(s)); } catch(e) {}
                };
                const _fld3uLoad = () => {
                    try {
                        const s = JSON.parse(localStorage.getItem(_fld3uKey) || 'null');
                        if (!s) return;
                        ['fld3u-ttl','fld3u-xl','fld3u-yl','fld3u-zl','fld3u-cs','fld3u-op','fld3u-ns','fld3u-lo','fld3u-hi'].forEach(k => {
                            const el = cp.querySelector(`#${k}-${id}`); if (el && s[k] !== undefined) el.value = s[k];
                        });
                        const rev = cp.querySelector(`#fld3u-rev-${id}`);
                        if (rev && s['fld3u-rev'] !== undefined) rev.checked = s['fld3u-rev'];
                    } catch(e) {}
                };

                // Build stacked surface slices (one per Z level) — matches Rappture's
                // semi-transparent planar slab rendering style.
                const _mkTraces3u = (cs, rev, op, ns, lo, hi) => {
                    if (!gd) {
                        // No grid data: fall back to isosurface on raw points
                        return [{
                            type: 'isosurface',
                            x: px, y: py, z: pz, value: pv,
                            isomin: lo, isomax: hi, opacity: op,
                            surface: { count: ns }, colorscale: cs, reversescale: rev,
                            showscale: true,
                            caps: { x: { show: false }, y: { show: false }, z: { show: false } },
                        }];
                    }
                    // Render as Plotly volume with isosurfaces — matches Rappture's 3D contour style
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
                    paper_bgcolor: 'white', autosize: true,
                });

                // Read saved panel state and derive initial render params
                _fld3uLoad();
                const _initCs  = cp.querySelector(`#fld3u-cs-${id}`).value || 'Viridis';
                const _initRev = cp.querySelector(`#fld3u-rev-${id}`).checked;
                const _initOp  = parseFloat(cp.querySelector(`#fld3u-op-${id}`).value) || 0.6;
                const _initNs  = parseInt(cp.querySelector(`#fld3u-ns-${id}`).value) || 10;
                const _initLo  = parseFloat(cp.querySelector(`#fld3u-lo-${id}`).value);
                const _initHi  = parseFloat(cp.querySelector(`#fld3u-hi-${id}`).value);

                setTimeout(() => {
                    Plotly.newPlot(plotDiv,
                        _mkTraces3u(_initCs, _initRev, _initOp, _initNs,
                            isFinite(_initLo) ? _initLo : vmin,
                            isFinite(_initHi) ? _initHi : vmax),
                        _mkLayout3u(mkLbl3u('X'), mkLbl3u('Y'), mkLbl3u('Z'), fldLabel3u, null),
                        { responsive: true });

                    const applyOpts3u = () => {
                        const cs  = cp.querySelector(`#fld3u-cs-${id}`).value;
                        const rev = cp.querySelector(`#fld3u-rev-${id}`).checked;
                        const op  = parseFloat(cp.querySelector(`#fld3u-op-${id}`).value);
                        const ns  = parseInt(cp.querySelector(`#fld3u-ns-${id}`).value);
                        const lo  = parseFloat(cp.querySelector(`#fld3u-lo-${id}`).value);
                        const hi  = parseFloat(cp.querySelector(`#fld3u-hi-${id}`).value);
                        cp.querySelector(`#fld3u-ns-v-${id}`).textContent = ns;
                        cp.querySelector(`#fld3u-op-v-${id}`).textContent = op;
                        _fld3uSave();
                        const cam = plotDiv._fullLayout && plotDiv._fullLayout.scene
                            ? plotDiv._fullLayout.scene.camera : null;
                        Plotly.react(plotDiv, _mkTraces3u(cs, rev, op, ns, lo, hi),
                            _mkLayout3u(
                                cp.querySelector(`#fld3u-xl-${id}`).value,
                                cp.querySelector(`#fld3u-yl-${id}`).value,
                                cp.querySelector(`#fld3u-zl-${id}`).value,
                                cp.querySelector(`#fld3u-ttl-${id}`).value,
                                cam));
                    };

                    cp.querySelectorAll('input, select').forEach(el =>
                        el.addEventListener(el.type === 'range' || el.type === 'number' ? 'input' : 'change', applyOpts3u)
                    );
                    cp.querySelectorAll('input[type=text]').forEach(el =>
                        el.addEventListener('input', applyOpts3u)
                    );

                    const _applyFld3uTheme = () => {
                        const dark = cp.querySelector(`#fld3u-theme-${id}`).value === 'dark';
                        Plotly.relayout(plotDiv, {
                            paper_bgcolor: dark ? '#1a1a2e' : 'white',
                            plot_bgcolor:  dark ? '#16213e' : '#f8fafc',
                            'scene.bgcolor': dark ? '#16213e' : '#f8fafc',
                            'scene.xaxis.color': dark ? '#ccd6f6' : '#444',
                            'scene.yaxis.color': dark ? '#ccd6f6' : '#444',
                            'scene.zaxis.color': dark ? '#ccd6f6' : '#444',
                            'scene.xaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                            'scene.yaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                            'scene.zaxis.gridcolor': dark ? '#2a2a4e' : '#e0e0e0',
                            font: { color: dark ? '#ccd6f6' : '#444' },
                        });
                    };
                    cp.querySelector(`#fld3u-theme-${id}`).addEventListener('change', _applyFld3uTheme);

                    cp.querySelector(`#fld3u-png-${id}`).addEventListener('click', () =>
                        Plotly.downloadImage(plotDiv, { format: 'png', filename: fldLabel3u.replace(/[^a-z0-9]/gi, '_') }));
                }, 50);

                return item;
            }

            // ── Unstructured / vector fields → Three.js ──────────────────
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
                    // 3D: iterate x, y, z (match numpy mgrid indexing)
                    for (let ix = 0; ix < xs.length; ix++)
                        for (let iy = 0; iy < ys.length; iy++)
                            for (let iz = 0; iz < zs.length; iz++)
                                pts.push([xs[ix], ys[iy], zs[iz]]);
                } else {
                    // 2D: iterate x, y
                    for (let ix = 0; ix < xs.length; ix++)
                        for (let iy = 0; iy < ys.length; iy++)
                            pts.push([xs[ix], ys[iy], 0]);
                }
                return pts;
            };

            // Collect points + values from all components
            // isVector=true when extents>1: allVals[i] = [vx,vy,vz], scalar = magnitude
            const allPts = [], allVals = [];
            let isVector = false;
            // Collect flow metadata from first component that has it
            let flowMeta = null;
            for (const comp of (data.components || [])) {
                const mesh = comp.mesh;
                const vals = comp.values || [];
                const extents = comp.extents || 1;
                if (!mesh) continue;
                // Resolve points: explicit unstructured points or expand grid axes
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
            // isFlow: true when vector field with flow metadata
            const isFlow = isVector && flowMeta !== null; // used for conditional visibility below

            console.log('[field] allPts:', allPts.length, 'isVector:', isVector, 'flowMeta:', JSON.stringify(flowMeta));

            if (allPts.length === 0) {
                body.innerHTML = '<p style="padding:14px;color:var(--rp-text-muted)">No point data.</p>';
                return item;
            }

            // Subsample for display when there are many points (keep all for voxel hash).
            // Target ≤20000 display points — more points → smoother Gaussian volume.
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

            // For colouring use magnitudes (display subset)
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
            // Outer container: stacks [canvas+panel row] above [colorbar row]
            const wrap = document.createElement('div');
            wrap.className = 'rp-3d-wrap';

            // Inner row: canvas left, control panel right
            const innerRow = document.createElement('div');
            innerRow.className = 'rp-3d-inner-row';

            const canvasWrap = document.createElement('div');
            canvasWrap.className = 'rp-3d-canvas-wrap';
            const canvas = document.createElement('canvas');
            canvasWrap.appendChild(canvas);
            innerRow.appendChild(canvasWrap);
            wrap.appendChild(innerRow);

            // Colorbar below canvas+panel
            const colorbarDiv = document.createElement('div');
            colorbarDiv.className = 'rp-3d-colorbar';
            colorbarDiv.innerHTML = `<span id="cb-lo-${id}">${vMin.toFixed(4)}</span>
                <div class="rp-3d-colorbar-gradient"></div>
                <span id="cb-hi-${id}">${vMax.toFixed(4)}</span>`;
            wrap.appendChild(colorbarDiv);

            // Right-side control panel
            const flowVolumeActive = isVector && (!flowMeta || flowMeta.volume !== false);
            const flowArrowsActive = isVector && flowMeta && flowMeta.arrows;
            const flowStreamsActive = isVector && flowMeta && flowMeta.streams;
            const hasParticles = isFlow && flowMeta.particles && flowMeta.particles.length > 0;
            const particlePlaneBtns = hasParticles
                ? flowMeta.particles.filter(p => !p.hide).map(p =>
                    `<button class="rp-3d-btn active" id="par-${id}-${p.id}">${p.label || p.id}</button>`
                  ).join('')
                : '';
            const panel = document.createElement('div');
            panel.className = 'rp-3d-panel';
            panel.innerHTML = `
              <div class="rp-panel-section">
                <div class="rp-panel-title">Display</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn${flowVolumeActive ? ' active' : ''}" id="pts-${id}">Volume</button>
                  <button class="rp-3d-btn${flowArrowsActive ? ' active' : ''}" id="arr-${id}">Arrows</button>
                  <button class="rp-3d-btn${flowStreamsActive ? ' active' : ''}" id="stm-${id}">Streams</button>
                  <button class="rp-3d-btn" id="cton-${id}">Contours</button>
                </div>
                <label>Opacity<input type="range" min="0" max="100" value="80" id="op-${id}"></label>
                <label>Glow<input type="range" min="0" max="100" value="30" id="glow-${id}"></label>
                <label>Size<input type="range" min="5" max="300" value="100" id="thin-${id}"></label>
                <label>Contour #<input type="range" min="1" max="20" value="5" step="1" id="ct-${id}"></label>
              </div>
              <div class="rp-panel-section" id="flow-sec-${id}" style="display:${hasParticles ? 'flex' : 'none'}">
                <div class="rp-panel-title">Flow</div>
                <div class="rp-panel-btns">
                  ${particlePlaneBtns}
                  <button class="rp-3d-btn" id="par-rst-${id}" title="Re-seed all particles"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:3px"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5V1l3 2.5L8 6V4.5A3.5 3.5 0 1 0 11.5 8h2z"/></svg>Reset</button>
                  <button class="rp-3d-btn active" id="par-pause-${id}" title="Pause/resume particle animation"><svg class="rp-flow-pause-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:3px"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg><svg class="rp-flow-play-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:3px;display:none"><polygon points="3,2 13,8 3,14"/></svg><span class="rp-flow-pause-label">Pause</span></button>
                </div>
                <label>Count<input type="range" min="2" max="80" value="40" step="1" id="pc-${id}"></label>
                <label>Speed<input type="range" min="0" max="500" value="100" step="10" id="spd-${id}"></label>
                <label>Part. size<input type="range" min="1" max="30" value="6" step="1" id="ps-${id}"></label>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Scale</div>
                <label>Min<input type="number" id="sc-lo-${id}" value="${vMin.toFixed(4)}" step="any"></label>
                <label>Max<input type="number" id="sc-hi-${id}" value="${vMax.toFixed(4)}" step="any"></label>
                <div class="rp-panel-btns" style="margin-top:4px">
                  <button class="rp-3d-btn" id="sc-rst-${id}">Reset</button>
                </div>
              </div>
              <div class="rp-panel-section">
                <div class="rp-panel-title">Camera</div>
                <div class="rp-panel-btns">
                  <button class="rp-3d-btn" id="fit-${id}">⤢ Fit</button>
                  <button class="rp-3d-btn" id="vxy-${id}">XY</button>
                  <button class="rp-3d-btn" id="vxz-${id}">XZ</button>
                  <button class="rp-3d-btn" id="vyz-${id}">YZ</button>
                  <button class="rp-3d-btn" id="v3d-${id}">3D</button>
                  <button class="rp-3d-btn" id="ar-${id}">⟳ Auto</button>
                </div>
              </div>`;
            innerRow.appendChild(panel);

            body.appendChild(wrap);

            // ── Three.js scene ─────────────────────────────────────────────
            requestAnimationFrame(() => {
                const H = 420;
                const w = canvas.clientWidth || 600;
                canvas.width = w; canvas.height = H;

                const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
                renderer.setSize(w, H);
                renderer.setPixelRatio(window.devicePixelRatio);
                renderer.setClearColor(0x1e293b, 1);

                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(45, w / H, 0.001, 10000);

                // Bounding box centre
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

                // ── Shared scale state (can be narrowed by user) ──────────
                let scLo = vMin, scHi = vMax;

                // Map a raw value to [0,1] within current scale range
                const toT = (v) => {
                    const r = scHi - scLo || 1;
                    return Math.max(0, Math.min(1, (v - scLo) / r));
                };

                // ── Point cloud (ShaderMaterial for per-vertex alpha) ─────
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

                // ptSize in world units: target each splat to cover ~1/12 of domain
                // so neighbouring splats overlap and fill the volume visually.
                // Each splat covers ~2.5× its grid spacing so neighbours overlap smoothly
                const ptSize = maxR / Math.cbrt(dispPts.length) * 4.5;

                const ptUniforms = {
                    uPointSize: { value: ptSize },
                    uGlow:      { value: 0.3 },   // Gaussian sharpness: 0=wide soft, 1=tight
                    uThin:      { value: 1.0 },   // overall size scale (Thin slider)
                    uOpacity:   { value: 0.8 },   // global opacity
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
                        // World-space size → screen pixels via projection
                        float fovScale = projectionMatrix[1][1]; // cot(fov/2)
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
                        // Gaussian splat: wide (sigma²=0.08) to tight (sigma²=0.01)
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

                // Rebuild colours + alpha using current scale range.
                // Per-vertex alpha encodes normalized magnitude (Gaussian density).
                // Global opacity and Glow sharpness are uniforms updated live.
                let curOpacity = 0.8;
                const refreshPointCloud = () => {
                    for (let i = 0; i < dispPts.length; i++) {
                        const t = toT(magnitudes[i]);
                        const [r, g, b] = colorMap(t);
                        ptColors[i*3] = r; ptColors[i*3+1] = g; ptColors[i*3+2] = b;
                        // Quadratic transfer function: low values nearly invisible, high values opaque
                        ptAlphas[i] = t * t; // range [0, 1], weighted toward high values
                    }
                    colorAttr.needsUpdate = true;
                    alphaAttr.needsUpdate = true;
                    ptUniforms.uOpacity.value = curOpacity;
                    const loEl = wrap.querySelector(`#cb-lo-${id}`);
                    const hiEl = wrap.querySelector(`#cb-hi-${id}`);
                    if (loEl) loEl.textContent = scLo.toFixed(4);
                    if (hiEl) hiEl.textContent = scHi.toFixed(4);
                };
                refreshPointCloud();

                // ── Iso-surface contours ──────────────────────────────────
                // Rendered as full-opacity Gaussian splats (same shader as volume)
                // filtered to points near each iso-value, blending into the volume.
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
                                isoAlp.push(1.0); // full opacity for iso-surface
                            }
                        });
                        if (isoPos.length === 0) continue;
                        const isoGeom = new THREE.BufferGeometry();
                        isoGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(isoPos), 3));
                        isoGeom.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(isoCol), 3));
                        isoGeom.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(isoAlp), 1));
                        // Reuse the same shader as the volume — same uniforms object so
                        // Opacity/Glow/Size sliders affect contours automatically.
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

                // ── Arrow glyphs (vector fields only) ────────────────────
                let arrowGroup = new THREE.Group();
                arrowGroup.visible = isVector; // on by default for vector fields
                scene.add(arrowGroup);

                const rebuildArrows = () => {
                    while (arrowGroup.children.length) arrowGroup.remove(arrowGroup.children[0]);
                    if (!arrowGroup.visible || !isVector) return;
                    const maxMag = vMax || 1;
                    const arrowLen = maxR * 0.12;
                    // Subsample: draw at most 600 arrows evenly from display set
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

                // Apply initial flow arrow/volume state from metadata
                if (flowMeta) {
                    ptCloud.visible = flowMeta.volume !== false;
                    arrowGroup.visible = !!flowMeta.arrows;
                }

                // ── Bounding boxes ────────────────────────────────────────
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

                // ── Streams plane (dense arrow lines along a slice) ───────
                const streamGroup = new THREE.Group();
                streamGroup.visible = !!(flowMeta && flowMeta.streams);
                scene.add(streamGroup);

                const rebuildStreams = () => {
                    while (streamGroup.children.length) streamGroup.remove(streamGroup.children[0]);
                    if (!streamGroup.visible || !isVector) return;
                    const axis   = flowMeta ? (flowMeta.axis || 'z') : 'z';
                    const posStr = flowMeta ? (flowMeta.position || '50%') : '50%';
                    const posVal = parseFloat(posStr) / 100;

                    // Determine slice plane bounds
                    let xArr = allPts.map(p=>p[0]), yArr = allPts.map(p=>p[1]), zArr = allPts.map(p=>(p[2]||0));
                    const xLo = Math.min(...xArr), xHi = Math.max(...xArr);
                    const yLo = Math.min(...yArr), yHi = Math.max(...yArr);
                    const zLo = Math.min(...zArr), zHi = Math.max(...zArr);
                    const sliceVal = axis === 'x' ? xLo + posVal*(xHi-xLo)
                                   : axis === 'y' ? yLo + posVal*(yHi-yLo)
                                   : zLo + posVal*(zHi-zLo);
                    const tol = Math.max((xHi-xLo),(yHi-yLo),(zHi-zLo)) / 20;

                    // Draw short line segments for each vector near the slice (use display set)
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

                // ── Particle injection planes (animated) ──────────────────
                const particleGroups = [];
                let getVelocity = () => [0, 0, 0]; // overwritten below when flow data present
                let xLo2 = 0, xHi2 = 1, yLo2 = 0, yHi2 = 1, zLo2 = 0, zHi2 = 1; // domain bounds for advection
                const cssColorToHex = (s) => {
                    const map = { lightgreen:0x90ee90, khaki:0xf0e68c, yellow:0xffff00,
                                  pink:0xffc0cb, white:0xffffff, cyan:0x00ffff,
                                  red:0xff0000, blue:0x0000ff, green:0x00ff00 };
                    if (map[s]) return map[s];
                    if (s.startsWith('#')) return parseInt(s.slice(1), 16);
                    return 0xffffff;
                };
                let curNGrid = 40;   // particle grid divisions per axis (N×N per plane)
                let curSpeed = 1.0; // animation speed multiplier

                if (isVector && flowMeta && flowMeta.particles) {
                    console.log('[particles] building for', flowMeta.particles.length, 'planes, pts=', allPts.length);
                    const xArr2 = allPts.map(p=>p[0]), yArr2 = allPts.map(p=>p[1]), zArr2 = allPts.map(p=>(p[2]||0));
                    xLo2 = Math.min(...xArr2); xHi2 = Math.max(...xArr2);
                    yLo2 = Math.min(...yArr2); yHi2 = Math.max(...yArr2);
                    zLo2 = Math.min(...zArr2); zHi2 = Math.max(...zArr2);

                    // ── Build voxel hash for O(1) velocity lookup ─────────
                    // Divide domain into ~30 cells per axis and store the
                    // average velocity for each occupied cell.
                    const VG = 30; // voxel grid resolution per axis
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
                    // Average the accumulated velocities
                    voxMap.forEach((e) => { e[0]/=e[3]; e[1]/=e[3]; e[2]/=e[3]; });

                    getVelocity = (px, py, pz) => {
                        // Clamp to domain then look up voxel; search 1-cell neighbourhood
                        const ix0 = Math.min(VG-1, Math.max(0, Math.floor((px-xLo2)/voxVx)));
                        const iy0 = Math.min(VG-1, Math.max(0, Math.floor((py-yLo2)/voxVy)));
                        const iz0 = Math.min(VG-1, Math.max(0, Math.floor((pz-zLo2)/voxVz)));
                        // Try exact cell first, then immediate neighbours
                        for (let dz=-1; dz<=1; dz++) for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
                            const key = (ix0+dx)*VG*VG + (iy0+dy)*VG + (iz0+dz);
                            if (voxMap.has(key)) { const e=voxMap.get(key); return [e[0],e[1],e[2]]; }
                        }
                        return [0,0,0];
                    };

                    // Build a uniform grid of seed positions for an injection plane
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
                            size: 1.5 * (pdef.size || 2),  // screen pixels, sizeAttenuation:false
                            color: cssColorToHex(pdef.color || 'white'),
                            transparent: true, opacity: 0.85,
                            sizeAttenuation: false,
                        });
                        const pts3 = new THREE.Points(pGeom, pMat);
                        scene.add(pts3);

                        // Pre-advect each seed by a random time offset so particles
                        // are distributed along their streamlines from the start.
                        // Use same scaling as advectParticles: domain / (vMax * 8s).
                        const domainLen0 = Math.max(xHi2-xLo2, yHi2-yLo2, zHi2-zLo2) || 1;
                        const scale0 = domainLen0 / ((vMax || 1) * 8);
                        const dtPre = 0.1; // pre-advection pseudo time step
                        for (let s = 0; s < seeds.length; s++) {
                            let [px, py, pz] = seeds[s];
                            const nSteps = Math.floor(Math.random() * 80);
                            for (let k = 0; k < nSteps; k++) {
                                const v0 = getVelocity(px, py, pz);
                                px += v0[0]*scale0*dtPre; py += (v0[1]||0)*scale0*dtPre; pz += (v0[2]||0)*scale0*dtPre;
                                // Reset to injection plane only when particle exits domain boundary
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

                // Rebuild all particle planes with new grid density
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
                        // Update mutable references
                        pg.seeds = newSeeds.map(s => [...s]);
                        pg.initialSeeds = newSeeds.map(s => [...s]);
                        // pPositions reference in advect loop comes from pg — update it
                        pg.pPositions = newPos;
                    }
                };


                const advectParticles = (dt) => {
                    // Scale raw velocity so the fastest particle crosses the domain in ~8s.
                    // vRefMax is the max velocity magnitude across the field (from display sample).
                    const domainLen = Math.max(xHi2-xLo2, yHi2-yLo2, zHi2-zLo2) || 1;
                    const vRefMax = vMax || 1;
                    const scale = (domainLen / (vRefMax * 8)) * curSpeed;
                    for (const pg of particleGroups) {
                        const { pPositions, pGeom, seeds,
                                xLo, xHi, yLo, yHi, zLo, zHi, axis, posV } = pg;
                        for (let s = 0; s < seeds.length; s++) {
                            let [px, py, pz] = seeds[s];
                            const v = getVelocity(px, py, pz);
                            // Use actual velocity × scale × dt
                            px += v[0] * scale * dt;
                            py += (v[1]||0) * scale * dt;
                            pz += (v[2]||0) * scale * dt;
                            // Reset to injection plane only when particle exits the domain boundary.
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
                // Volume (point cloud) on/off
                const ptsBtn = panel.querySelector(`#pts-${id}`);
                ptsBtn.addEventListener('click', () => {
                    ptCloud.visible = !ptCloud.visible;
                    ptsBtn.classList.toggle('active', ptCloud.visible);
                });

                // Contours on/off
                const ctonBtn = panel.querySelector(`#cton-${id}`);
                ctonBtn.addEventListener('click', () => {
                    contourGroup.visible = !contourGroup.visible;
                    ctonBtn.classList.toggle('active', contourGroup.visible);
                    rebuildContours();
                });

                // Opacity slider — updates uniform directly for live feedback
                panel.querySelector(`#op-${id}`).addEventListener('input', (e) => {
                    curOpacity = e.target.value / 100;
                    ptUniforms.uOpacity.value = curOpacity;
                });

                // Glow slider
                panel.querySelector(`#glow-${id}`).addEventListener('input', (e) => {
                    ptUniforms.uGlow.value = e.target.value / 100;
                });

                // Thin slider (point size multiplier)
                // Contours share ptUniforms so they update automatically.
                panel.querySelector(`#thin-${id}`).addEventListener('input', (e) => {
                    ptUniforms.uThin.value = e.target.value / 100;
                });

                // Contour count slider
                panel.querySelector(`#ct-${id}`).addEventListener('input', (e) => {
                    curNContours = parseInt(e.target.value);
                    rebuildContours();
                });

                // Auto-rotate
                let autoRotate = false;
                const arBtn = panel.querySelector(`#ar-${id}`);
                arBtn.addEventListener('click', () => {
                    autoRotate = !autoRotate;
                    controls.autoRotate = autoRotate;
                    arBtn.classList.toggle('active', autoRotate);
                });

                // Particle size slider
                panel.querySelector(`#ps-${id}`).addEventListener('input', (e) => {
                    const s = parseInt(e.target.value);
                    for (const pg of particleGroups) {
                        pg.pMat.size = s;  // screen pixels
                        pg.pMat.needsUpdate = true;
                    }
                });

                // Particle count slider — rebuilds injection planes
                panel.querySelector(`#pc-${id}`).addEventListener('change', (e) => {
                    rebuildParticles(parseInt(e.target.value));
                });

                // Speed slider
                panel.querySelector(`#spd-${id}`).addEventListener('input', (e) => {
                    curSpeed = e.target.value / 100;
                });

                // Arrows on/off
                const arrBtn = panel.querySelector(`#arr-${id}`);
                arrBtn.addEventListener('click', () => {
                    arrowGroup.visible = !arrowGroup.visible;
                    arrBtn.classList.toggle('active', arrowGroup.visible);
                    rebuildArrows();
                });
                if (!isVector) arrBtn.style.display = 'none';

                // Streams on/off
                const stmBtn = panel.querySelector(`#stm-${id}`);
                stmBtn.addEventListener('click', () => {
                    streamGroup.visible = !streamGroup.visible;
                    stmBtn.classList.toggle('active', streamGroup.visible);
                    rebuildStreams();
                });
                if (!isFlow) stmBtn.style.display = 'none';

                // Per-particle-plane toggle buttons + Reset
                for (const pg of particleGroups) {
                    const btn = panel.querySelector(`#par-${id}-${pg.pid}`);
                    if (!btn) continue;
                    btn.addEventListener('click', () => {
                        pg.pts3.visible = !pg.pts3.visible;
                        btn.classList.toggle('active', pg.pts3.visible);
                    });
                }
                // Reset: re-seed all planes back to their injection positions
                const parRstBtn = panel.querySelector(`#par-rst-${id}`);
                if (parRstBtn) {
                    parRstBtn.addEventListener('click', () => {
                        for (const pg of particleGroups) {
                            // Restore seeds to initial positions
                            pg.seeds.forEach((_s, i) => { pg.seeds[i] = [...pg.initialSeeds[i]]; });
                            // Update geometry positions
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

                // Scale min/max inputs
                const scLoIn = panel.querySelector(`#sc-lo-${id}`);
                const scHiIn = panel.querySelector(`#sc-hi-${id}`);
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

                // Reset scale
                panel.querySelector(`#sc-rst-${id}`).addEventListener('click', () => {
                    scLo = vMin; scHi = vMax;
                    scLoIn.value = vMin.toFixed(4);
                    scHiIn.value = vMax.toFixed(4);
                    refreshPointCloud();
                    rebuildContours();
                    rebuildArrows();
                });

                // Camera presets
                panel.querySelector(`#fit-${id}`).addEventListener('click', () => setCameraView('3d'));
                panel.querySelector(`#vxy-${id}`).addEventListener('click', () => setCameraView('xy'));
                panel.querySelector(`#vxz-${id}`).addEventListener('click', () => setCameraView('xz'));
                panel.querySelector(`#vyz-${id}`).addEventListener('click', () => setCameraView('yz'));
                panel.querySelector(`#v3d-${id}`).addEventListener('click', () => setCameraView('3d'));

                // ── Resize ────────────────────────────────────────────────
                const ro = new ResizeObserver(() => {
                    const nw = canvas.clientWidth;
                    renderer.setSize(nw, H);
                    camera.aspect = nw / H;
                    camera.updateProjectionMatrix();
                });
                ro.observe(canvas);

                // Pause/resume particle animation
                let particlesPaused = false;
                const pauseBtn = panel.querySelector(`#par-pause-${id}`);
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
                    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
                    lastTime = now;
                    if (particleGroups.length > 0 && !particlesPaused) advectParticles(dt);
                    controls.update();
                    renderer.render(scene, camera);
                };
                animate();
            });

            return item;
        },

        mesh(id, data) {
            // Standalone mesh (not hidden) — render as point cloud without scalar colouring
            return rappture.outputRenderers.field(id, {
                label: data.label || id,
                components: [{ mesh: data, values: [] }],
            });
        },
    },

    createOutputItem(label, type) {
        const item = document.createElement('div');
        item.className = 'rp-output-item rp-output-' + type;
        item.innerHTML = `<div class="rp-output-header">${label}</div><div class="rp-output-body"></div>`;
        return item;
    },

    renderGenericOutput(id, output) {
        const item = this.createOutputItem(output.label || id, 'generic');
        const pre = document.createElement('pre');
        pre.style.cssText = 'font-size:12px;overflow:auto';
        pre.textContent = JSON.stringify(output, null, 2);
        item.querySelector('.rp-output-body').appendChild(pre);
        return item;
    },

    // ── Run history ──────────────────────────────────────────────────────────

    // In-memory ordered run list (mirrors server, newest first = index 0 = "top")
    _runs: [],
    _toolKey: '',   // set by tool.html via rappture._toolKey = "..."

    /** Download a Plotly chart as SVG, EPS, or PNG. */
    async _downloadPlot(plotDiv, filename, format) {
        if (format === 'png') {
            Plotly.downloadImage(plotDiv, { format: 'png', filename, width: 1200, height: 800 });
            return;
        }
        // Get SVG string from Plotly
        const svgStr = await Plotly.toImage(plotDiv, { format: 'svg', width: 1200, height: 800 });
        // svgStr is a data URL: "data:image/svg+xml,..."
        const svgData = decodeURIComponent(svgStr.split(',', 2)[1]);

        if (format === 'svg') {
            this._triggerDownload(svgData, filename + '.svg', 'image/svg+xml');
            return;
        }

        if (format === 'eps') {
            // Wrap SVG in a minimal EPS envelope (SVG-in-EPS / Level 3 PostScript)
            const w = 1200, h = 800;
            const eps = [
                '%!PS-Adobe-3.0 EPSF-3.0',
                `%%BoundingBox: 0 0 ${w} ${h}`,
                `%%HiResBoundingBox: 0 0 ${w} ${h}`,
                '%%LanguageLevel: 3',
                '%%Pages: 1',
                '%%EndComments',
                '%%BeginProlog',
                '%%EndProlog',
                '%%Page: 1 1',
                `${w} ${h} scale`,
                '/DeviceRGB setcolorspace',
                `<<`,
                `  /ImageType 1`,
                `  /Width ${w} /Height ${h}`,
                `  /BitsPerComponent 8`,
                `  /Decode [0 1 0 1 0 1]`,
                `>>`,
                '% SVG embedded as comment for reference; actual EPS uses rasterized path.',
                '% For vector EPS, open the SVG in Inkscape and export as EPS.',
                `% SVG data follows:`,
                svgData.split('\n').map(l => '% ' + l).join('\n'),
                'showpage',
                '%%EOF',
            ].join('\n');
            this._triggerDownload(eps, filename + '.eps', 'application/postscript');
        }
    },

    _triggerDownload(text, filename, mimeType) {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    _lsKey() { return 'rp2w:' + window.location.href; },

    _saveUIState() {
        try {
            const state = {};
            this._runs.forEach(r => {
                state[r.run_id] = { color: r._color, checked: !!r._checked };
            });
            localStorage.setItem(this._lsKey(), JSON.stringify(state));
        } catch {}
    },

    _loadUIState() {
        try {
            const raw = localStorage.getItem(this._lsKey());
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    },

    _runColorPalette: [
        '#2563eb','#dc2626','#16a34a','#d97706','#7c3aed',
        '#0891b2','#db2777','#65a30d','#ea580c','#4f46e5',
    ],
    _colorIdx: 0,

    _assignRunColor(run) {
        if (!run._color) {
            run._color = this._runColorPalette[this._colorIdx % this._runColorPalette.length];
            this._colorIdx++;
        }
    },

    async _fetchRunHistory(selectNewest = false) {
        try {
            const resp = await fetch('/api/runs');
            const runs = await resp.json();
            // Server returns oldest-first; we display newest-first (index 0 = top)
            const saved = this._loadUIState();
            const prevMap = {};
            this._runs.forEach(r => { prevMap[r.run_id] = r; });
            this._runs = runs.slice().reverse();
            this._runs.forEach((r, i) => {
                const prev = prevMap[r.run_id];
                // Priority: in-memory (current session) > localStorage > defaults
                r._color = (prev && prev._color) || (saved[r.run_id] && saved[r.run_id].color) || null;
                r._checked = prev ? prev._checked : (saved[r.run_id] ? saved[r.run_id].checked : false);
                // Do not carry over cached outputs — always re-fetch from server to
                // ensure grid_data and other computed fields are up to date.
                // r.outputs is intentionally not restored here.
                this._assignRunColor(r);
                if (selectNewest) r._checked = (i === 0);
            });
            this._renderRunHistory();
            this._saveUIState();
            const anyChecked = this._runs.some(r => r._checked);
            if (anyChecked) this._renderCheckedRuns();
        } catch {}
    },

    _renderRunHistory() {
        const panel = document.getElementById('rp-run-history');
        if (!panel) return;
        const selectAll = document.getElementById('rp-select-all');

        if (!this._runs || this._runs.length === 0) {
            panel.innerHTML = '<span class="rp-run-empty">No runs yet</span>';
            if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
            return;
        }

        panel.innerHTML = '';
        this._runs.forEach((run, idx) => {
            const isTop = idx === 0;
            const inputTip = Object.entries(run.inputs || {})
                .map(([k, v]) => k.split('(').pop().replace(')', '') + '=' + v)
                .join(', ');

            const row = document.createElement('div');
            row.className = 'rp-run-row' + (isTop ? ' rp-run-top' : '');
            row.dataset.runId = run.run_id;
            row.draggable = true;

            // Checkbox
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'rp-run-check';
            cb.value = run.run_id;
            cb.checked = !!run._checked;
            cb.title = inputTip;
            cb.addEventListener('change', () => {
                run._checked = cb.checked;
                this._syncSelectAll();
                this._saveUIState();
                this._renderCheckedRuns();
            });

            // Color swatch (custom popup, no OS picker)
            const colorPicker = this._makeColorSwatch(run, () => {
                this._saveUIState();
                if (run._checked) this._renderCheckedRuns();
            });

            // Up / Down reorder buttons
            const upBtn = document.createElement('button');
            upBtn.className = 'rp-run-reorder-btn';
            upBtn.title = 'Move up';
            upBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><polygon points="8,3 14,13 2,13"/></svg>';
            upBtn.disabled = isTop;
            upBtn.addEventListener('click', () => this._moveRun(idx, -1));

            const downBtn = document.createElement('button');
            downBtn.className = 'rp-run-reorder-btn';
            downBtn.title = 'Move down';
            downBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><polygon points="8,13 14,3 2,3"/></svg>';
            downBtn.disabled = idx === this._runs.length - 1;
            downBtn.addEventListener('click', () => this._moveRun(idx, 1));

            // Label (double-click to rename)
            const labelSpan = document.createElement('span');
            labelSpan.className = 'rp-run-label' + (isTop ? ' rp-run-label-top' : '');
            labelSpan.textContent = run.label;
            labelSpan.title = 'Double-click to rename';
            labelSpan.addEventListener('dblclick', () => this._startRename(run, labelSpan));

            // Status badge
            const statusSpan = document.createElement('span');
            statusSpan.className = 'rp-run-status';
            statusSpan.textContent = run.status === 'success' ? '' : run.status;

            // Upload badge
            const uploadBadge = document.createElement('span');
            uploadBadge.className = 'rp-run-upload-badge';
            uploadBadge.style.display = run.source === 'upload' ? '' : 'none';
            uploadBadge.title = 'Uploaded run — cannot be compared with simulated runs';
            uploadBadge.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M8 2L4 7h3v5h2V7h3z"/><rect x="2" y="13" width="12" height="1.5" rx="0.75"/></svg>';

            // Delete
            const delBtn = document.createElement('button');
            delBtn.className = 'rp-run-delete';
            delBtn.title = 'Delete run';
            delBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="2"/><line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" stroke-width="2"/></svg>';
            delBtn.addEventListener('click', () => this.deleteRun(run.run_id));

            row.appendChild(cb);
            row.appendChild(colorPicker);
            row.appendChild(upBtn);
            row.appendChild(downBtn);
            row.appendChild(labelSpan);
            row.appendChild(statusSpan);
            row.appendChild(uploadBadge);
            row.appendChild(delBtn);
            panel.appendChild(row);

            // Drag-and-drop reorder
            row.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', run.run_id);
                row.classList.add('rp-run-dragging');
            });
            row.addEventListener('dragend', () => row.classList.remove('rp-run-dragging'));
            row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('rp-run-drag-over'); });
            row.addEventListener('dragleave', () => row.classList.remove('rp-run-drag-over'));
            row.addEventListener('drop', e => {
                e.preventDefault();
                row.classList.remove('rp-run-drag-over');
                const fromId = e.dataTransfer.getData('text/plain');
                const toId = run.run_id;
                if (fromId !== toId) this._dragReorder(fromId, toId);
            });
        });

        this._syncSelectAll();
    },

    _startRename(run, labelSpan) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rp-run-rename-input';
        input.value = run.label;
        labelSpan.replaceWith(input);
        input.focus();
        input.select();

        const commit = async () => {
            const newLabel = input.value.trim() || run.label;
            run.label = newLabel;
            const span = document.createElement('span');
            const idx = this._runs.indexOf(run);
            span.className = 'rp-run-label' + (idx === 0 ? ' rp-run-label-top' : '');
            span.textContent = newLabel;
            span.title = 'Double-click to rename';
            span.addEventListener('dblclick', () => this._startRename(run, span));
            input.replaceWith(span);
            try {
                await fetch(`/api/runs/${run.run_id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label: newLabel }),
                });
            } catch {}
            if (run._checked) this._renderCheckedRuns();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') { input.value = run.label; input.blur(); }
        });
    },

    _moveRun(idx, delta) {
        const newIdx = idx + delta;
        if (newIdx < 0 || newIdx >= this._runs.length) return;
        [this._runs[idx], this._runs[newIdx]] = [this._runs[newIdx], this._runs[idx]];
        this._renderRunHistory();
        this._saveUIState();
        this._renderCheckedRuns();
        this._pushReorder();
    },

    _dragReorder(fromId, toId) {
        const fromIdx = this._runs.findIndex(r => r.run_id === fromId);
        const toIdx = this._runs.findIndex(r => r.run_id === toId);
        if (fromIdx < 0 || toIdx < 0) return;
        const [moved] = this._runs.splice(fromIdx, 1);
        this._runs.splice(toIdx, 0, moved);
        this._renderRunHistory();
        this._renderCheckedRuns();
        this._pushReorder();
    },

    async _pushReorder() {
        try {
            await fetch('/api/runs/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Send newest-first list; server stores as-is
                body: JSON.stringify({ run_ids: this._runs.map(r => r.run_id) }),
            });
        } catch {}
    },

    /** Build a small color-swatch button with a custom inline popup picker. */
    _makeColorSwatch(run, onChange) {
        const PALETTE = [
            '#2563eb','#dc2626','#16a34a','#d97706','#7c3aed',
            '#0891b2','#db2777','#65a30d','#ea580c','#4f46e5',
            '#0f172a','#475569','#9ca3af','#fbbf24','#34d399',
        ];

        const wrap = document.createElement('div');
        wrap.className = 'rp-color-wrap';

        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'rp-run-color';
        swatch.style.background = run._color;
        swatch.title = 'Set run color';

        const popup = document.createElement('div');
        popup.className = 'rp-color-popup';
        popup.style.display = 'none';

        // Palette grid
        const grid = document.createElement('div');
        grid.className = 'rp-color-grid';
        PALETTE.forEach(hex => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'rp-color-dot';
            dot.style.background = hex;
            dot.title = hex;
            if (hex === run._color) dot.classList.add('active');
            dot.addEventListener('click', () => {
                run._color = hex;
                swatch.style.background = hex;
                hexInput.value = hex;
                popup.querySelectorAll('.rp-color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                onChange();
            });
            grid.appendChild(dot);
        });
        popup.appendChild(grid);

        // Hex input
        const hexRow = document.createElement('div');
        hexRow.className = 'rp-color-hex-row';
        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.className = 'rp-color-hex-input';
        hexInput.value = run._color;
        hexInput.maxLength = 7;
        hexInput.placeholder = '#rrggbb';
        hexInput.addEventListener('input', () => {
            const v = hexInput.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                run._color = v;
                swatch.style.background = v;
                popup.querySelectorAll('.rp-color-dot').forEach(d => d.classList.remove('active'));
                onChange();
            }
        });
        hexRow.appendChild(hexInput);
        popup.appendChild(hexRow);

        swatch.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = popup.style.display !== 'none';
            // Close any other open popups
            document.querySelectorAll('.rp-color-popup').forEach(p => { p.style.display = 'none'; });
            popup.style.display = isOpen ? 'none' : 'block';
        });

        document.addEventListener('click', () => { popup.style.display = 'none'; }, { capture: true, passive: true });

        wrap.appendChild(swatch);
        wrap.appendChild(popup);
        return wrap;
    },

    _syncSelectAll() {
        const selectAll = document.getElementById('rp-select-all');
        if (!selectAll) return;
        const checked = this._runs.filter(r => r._checked);
        selectAll.checked = this._runs.length > 0 && checked.length === this._runs.length;
        selectAll.indeterminate = checked.length > 0 && checked.length < this._runs.length;
    },

    toggleSelectAll(checkbox) {
        this._runs.forEach(r => { r._checked = checkbox.checked; });
        this._renderRunHistory();
        this._saveUIState();
        this._renderCheckedRuns();
    },

    /** Re-render results area showing all checked runs overlaid. */
    async _renderCheckedRuns() {
        const checked = this._runs.filter(r => r._checked);
        if (checked.length === 0) {
            document.getElementById('rp-results').innerHTML =
                '<div class="rp-results-placeholder"><p>Select runs above to view results.</p></div>';
            return;
        }
        // Fetch full run data for any run that only has summary info (no outputs)
        for (const run of checked) {
            if (!run.outputs) {
                try {
                    const resp = await fetch(`/api/runs/${run.run_id}`);
                    const full = await resp.json();
                    Object.assign(run, full);
                } catch {}
            }
        }
        if (checked.length === 1) {
            const run = checked[0];
            // Tag each output with the run's color and label so renderers can use them
            const coloredOutputs = {};
            for (const [k, v] of Object.entries(run.outputs || {})) {
                coloredOutputs[k] = { ...v, _runColor: run._color, _runLabel: run.label };
            }
            this.renderOutputs(coloredOutputs, run.log || '');
            return;
        }
        // Multiple: check for mixed uploaded/simulated sources
        const hasUploaded = checked.some(r => r.source === 'upload');
        const hasSimulated = checked.some(r => r.source !== 'upload');
        if (hasUploaded && hasSimulated) {
            document.getElementById('rp-results').innerHTML =
                '<div class="rp-results-placeholder rp-results-warn">' +
                '<p><strong>Cannot compare uploaded and simulated runs.</strong></p>' +
                '<p>Uploaded runs may be from a different tool configuration. ' +
                'Select only simulated runs or only uploaded runs to compare.</p>' +
                '</div>';
            return;
        }
        // Multiple: overlay on same plots (top run = first = highlighted)
        this._renderCompare(checked);
    },

    async deleteRun(runId) {
        try {
            await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
            const idx = this._runs.findIndex(r => r.run_id === runId);
            if (idx >= 0) this._runs.splice(idx, 1);
            this._renderRunHistory();
            this._renderCheckedRuns();
        } catch (err) {
            this._setStatus('Failed to delete run: ' + err.message, 'error');
        }
    },

    /** Render multiple runs overlaid. runs[0] = top run (highlighted). */
    _renderCompare(runs) {
        if (!runs || runs.length === 0) return;
        const container = document.getElementById('rp-results');

        // Apply same grouping as renderOutputs: merge grouped curves per run
        const _mergeGrouped = (outputs) => {
            const groupedMap = {};
            const processedIds = new Set();
            const merged = {};
            for (const [id, output] of Object.entries(outputs || {})) {
                if ((output.type === 'curve' || output.type === 'histogram') && output.group) {
                    const grp = output.group;
                    if (!groupedMap[grp]) {
                        groupedMap[grp] = {
                            type: 'curve', label: grp, curve_type: 'mixed', group: grp,
                            xaxis: output.xaxis || {}, yaxis: output.yaxis || {},
                            _members: [],
                        };
                    }
                    const ct = (output.curve_type || '').toLowerCase() || (output.type === 'histogram' ? 'bar' : 'line');
                    (output.traces || []).forEach(trace => {
                        groupedMap[grp]._members.push({ label: output.label || id, curve_type: ct, trace });
                    });
                    processedIds.add(id);
                }
            }
            for (const [id, output] of Object.entries(outputs || {})) {
                if (!processedIds.has(id)) merged[id] = output;
            }
            for (const [grp, data] of Object.entries(groupedMap)) {
                merged['__grp__' + grp] = data;
            }
            return merged;
        };

        const allIds = new Set();
        runs.forEach(r => Object.keys(_mergeGrouped(r.outputs || {})).forEach(id => allIds.add(id)));
        // Include log if any run has one (stored as run.log string, not in outputs)
        if (runs.some(r => r.log && r.log.trim())) allIds.add('__log__');

        const panels = {};
        for (const id of allIds) {
            const sources = id === '__log__'
                ? runs.filter(r => r.log && r.log.trim()).map(r => ({ run: r, data: { type: 'log', label: 'Log', content: r.log } }))
                : runs.map(r => ({ run: r, data: _mergeGrouped(r.outputs || {})[id] })).filter(s => s.data);
            if (sources.length === 0) continue;

            const firstData = sources[0].data;
            const type = firstData.type;

            if (type === 'curve' || type === 'histogram') {
                const item = this.createOutputItem(
                    (firstData.about && firstData.about.label) || firstData.label || id, 'plot');
                item.classList.add('rp-output-plot-item');
                const body = item.querySelector('.rp-output-body');

                const plotDiv = document.createElement('div');
                plotDiv.className = 'rp-output-plot';
                body.appendChild(plotDiv);

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
                const cYlog = firstData.yaxis && (firstData.yaxis.log === 'log' || firstData.yaxis.scale === 'log');
                const layout = {
                    xaxis: {
                        title: xLabel + (xUnits ? ` [${xUnits}]` : ''), showgrid: true,
                        ...(cXmin !== undefined && cXmax !== undefined ? { range: [cXmin, cXmax] } : {}),
                    },
                    yaxis: {
                        title: yLabel + (yUnits ? ` [${yUnits}]` : ''), showgrid: true,
                        type: cYlog ? 'log' : 'linear',
                        ...(cYmin !== undefined && cYmax !== undefined ? { range: [cYmin, cYmax] } : {}),
                    },
                    margin: { t: 36, r: 16, b: 60, l: 70 },
                    showlegend: true,
                    paper_bgcolor: 'white',
                    plot_bgcolor: '#f8fafc',
                    autosize: true,
                };
                setTimeout(() => Plotly.newPlot(plotDiv, traces, layout, { responsive: true }), 50);
                panels[id] = { elem: item, label: (firstData.about && firstData.about.label) || firstData.label || id };

            } else if (type === 'number' || type === 'integer') {
                const item = this.createOutputItem(
                    (firstData.about && firstData.about.label) || firstData.label || id, 'number');
                const table = document.createElement('table');
                table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
                table.innerHTML = sources.map(({ run, data }, si) =>
                    `<tr style="${si === 0 ? 'font-weight:700;background:#eff6ff' : ''}">` +
                    `<td style="padding:4px 8px;color:var(--rp-text-muted)">${run.label}</td>` +
                    `<td style="padding:4px 8px;font-variant-numeric:tabular-nums">${data.current || ''}</td>` +
                    `<td style="padding:4px 8px;color:var(--rp-text-muted)">${data.units || ''}</td></tr>`
                ).join('');
                item.querySelector('.rp-output-body').appendChild(table);
                panels[id] = { elem: item, label: (firstData.about && firstData.about.label) || firstData.label || id };

            } else if (type === 'boolean') {
                const item = this.createOutputItem(
                    (firstData.about && firstData.about.label) || firstData.label || id, 'boolean');
                const table = document.createElement('table');
                table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
                table.innerHTML = sources.map(({ run, data }, si) => {
                    const val = (data.current || '').toString().toLowerCase();
                    const isTrue = ['yes', 'on', 'true', '1'].includes(val);
                    return `<tr style="${si === 0 ? 'font-weight:700;background:#eff6ff' : ''}">` +
                        `<td style="padding:4px 8px;color:var(--rp-text-muted)">${run.label}</td>` +
                        `<td style="padding:4px 8px">${isTrue ? '✓ Yes' : '✗ No'}</td></tr>`;
                }).join('');
                item.querySelector('.rp-output-body').appendChild(table);
                panels[id] = { elem: item, label: (firstData.about && firstData.about.label) || firstData.label || id };

            } else if (type === 'image') {
                const imgLabel = (firstData.about && firstData.about.label) || firstData.label || id;
                const item = this.createOutputItem(imgLabel, 'image');
                const body = item.querySelector('.rp-output-body');
                body.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;padding:8px;align-items:flex-start';
                sources.forEach(({ run, data }, si) => {
                    const cell = document.createElement('div');
                    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
                    const runName = run.label || (run.run_num ? `#${run.run_num}` : `Run ${si + 1}`);
                    const runColor = run._color || '#3b82f6';
                    const lbl = document.createElement('div');
                    lbl.style.cssText = `font-size:12px;font-weight:${si === 0 ? '700' : '500'};color:${runColor};background:${runColor}22;border:1px solid ${runColor};border-radius:3px;padding:2px 8px`;
                    lbl.textContent = runName;
                    const img = document.createElement('img');
                    img.alt = lbl.textContent;
                    img.style.cssText = `max-width:300px;max-height:300px;border:${si === 0 ? 3 : 2}px solid ${runColor}`;
                    let src = (data.current || '').trim();
                    if (src.startsWith('@@RP-ENC:b64')) src = 'data:image/*;base64,' + src.replace(/^@@RP-ENC:b64\s*/, '').replace(/\s/g, '');
                    else if (src && !src.startsWith('data:')) src = 'data:image/*;base64,' + src.replace(/\s/g, '');
                    if (src) img.src = src;
                    cell.appendChild(lbl);
                    cell.appendChild(img);
                    body.appendChild(cell);
                });
                panels[id] = { elem: item, label: imgLabel };

            } else if (type === 'string') {
                const item = this.createOutputItem(
                    (firstData.about && firstData.about.label) || firstData.label || id, 'string');
                const body = item.querySelector('.rp-output-body');
                sources.forEach(({ run, data }, si) => {
                    const hdr = document.createElement('div');
                    hdr.style.cssText = `font-size:11px;font-weight:${si === 0 ? '700' : '400'};color:var(--rp-text-muted);margin:${si > 0 ? '8px' : '0'} 0 2px`;
                    hdr.textContent = run.label;
                    const pre = document.createElement('pre');
                    pre.style.cssText = 'font-size:12px;white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;padding:6px 8px;margin:0';
                    pre.textContent = data.current || '';
                    body.appendChild(hdr);
                    body.appendChild(pre);
                });
                panels[id] = { elem: item, label: (firstData.about && firstData.about.label) || firstData.label || id };

            } else if (type === 'log') {
                const logLabel = firstData.label || 'Log';
                const item = this.createOutputItem(logLabel, 'log');
                const body = item.querySelector('.rp-output-body');
                body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px;white-space:normal;font-family:inherit;font-size:inherit';
                sources.forEach(({ run, data }, si) => {
                    const runName = run.label || run.run_num || `Run ${si + 1}`;
                    const runColor = run._color || 'var(--rp-text-muted)';
                    const hdr = document.createElement('div');
                    hdr.style.cssText = `font-size:11px;font-weight:${si === 0 ? '700' : '400'};color:${runColor};margin:0 0 2px;font-family:var(--rp-font);white-space:normal`;
                    hdr.textContent = runName;
                    const pre = document.createElement('pre');
                    pre.style.cssText = 'font-size:12px;white-space:pre-wrap;background:#0d1117;color:#cdd6f4;border:1px solid #334155;border-radius:3px;padding:6px 8px;margin:0;max-height:300px;overflow-y:auto;font-family:monospace';
                    pre.textContent = data.content || '';
                    body.appendChild(hdr);
                    body.appendChild(pre);
                });
                panels[id] = { elem: item, label: logLabel };

            } else if (type === 'field' && sources.length > 1) {
                // ── Multi-run field compare ──────────────────────────────
                const outerLabel = (firstData.about && firstData.about.label) || firstData.label || id;
                const item = this.createOutputItem(outerLabel, 'field');
                item.classList.add('rp-output-plot-item');
                const body = item.querySelector('.rp-output-body');

                const _cmpMkAxis = (ax) => {
                    if (!ax) return [0];
                    if (ax.coords && ax.coords.length) return ax.coords;
                    const n = Math.max(ax.numpoints || 1, 1);
                    const lo = ax.min !== undefined ? ax.min : 0;
                    const hi = ax.max !== undefined ? ax.max : 1;
                    const pts = [];
                    for (let i = 0; i < n; i++) pts.push(lo + (hi - lo) * i / Math.max(n - 1, 1));
                    return pts;
                };

                // Detect field type from first source
                const _fm = (firstData.components && firstData.components[0] && firstData.components[0].mesh) || null;
                const _fc = (firstData.components && firstData.components[0]) || null;
                const _is2D = _fm && _fm.mesh_type === 'grid' && _fm.axes && _fm.axes.x && _fm.axes.y && !_fm.axes.z && (_fc && (_fc.extents || 1) === 1);
                const _is3DGrid = _fm && _fm.mesh_type === 'grid' && _fm.axes && _fm.axes.x && _fm.axes.y && _fm.axes.z && (_fc && (_fc.extents || 1) === 1);
                const _is3DUnstr = _fm && _fm.mesh_type === 'unstructured' && _fm.points && _fm.points.length > 0 && (_fc && (_fc.extents || 1) === 1) && _fm.points[0] && _fm.points[0].length === 3;

                const colorscales = ['Viridis','Plasma','Inferno','Magma','Cividis','RdBu','Spectral','Jet','Hot','Blues'];
                const inputStyle = 'width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:11px';
                const plotDiv = document.createElement('div');
                plotDiv.className = 'rp-output-plot';
                plotDiv.id = 'fldcmp-' + id;
                plotDiv.style.cssText = 'flex:1;min-height:400px;min-width:0';

                const cp = document.createElement('div');
                cp.className = 'rp-3d-panel';
                cp.style.maxHeight = 'none';

                const outerWrap = document.createElement('div');
                outerWrap.style.cssText = 'display:flex;width:100%;height:100%;min-height:0';
                outerWrap.appendChild(plotDiv);
                outerWrap.appendChild(cp);
                body.appendChild(outerWrap);

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
                        <label>Plot<input type="text" id="fldcmp-ttl-${id}" value="" placeholder="(none)" style="${inputStyle}"></label>
                        <label>Colorbar<input type="text" id="fldcmp-cbtl-${id}" value="" placeholder="(none)" style="${inputStyle}"></label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">X Axis</div>
                        <label>Label<input type="text" id="fldcmp-xl-${id}" value="${xLbl0}" style="${inputStyle}"></label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Y Axis</div>
                        <label>Label<input type="text" id="fldcmp-yl-${id}" value="${yLbl0}" style="${inputStyle}"></label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Color scale</div>
                        <select id="fldcmp-cs-${id}" style="${inputStyle}">${colorscales.map(c=>`<option${c==='Viridis'?' selected':''}>${c}</option>`).join('')}</select>
                        <label style="flex-direction:row;align-items:center;gap:6px;margin-top:4px"><input type="checkbox" id="fldcmp-rev-${id}"> Reverse</label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Display</div>
                        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fldcmp-sm-${id}" checked> Interpolate</label>
                        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="fldcmp-ct-${id}" checked> Contours</label>
                        <label>Contour #<input type="range" id="fldcmp-nc-${id}" min="3" max="30" value="10" step="1"></label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Download</div>
                        <button class="rp-3d-btn" id="fldcmp-png-${id}">PNG</button>
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
                        paper_bgcolor: 'white', plot_bgcolor: '#f8fafc', autosize: true };
                    sources.forEach((_, si) => {
                        const axSuffix = si === 0 ? '' : (si + 1);
                        const domain = [si / sources.length + 0.01, (si + 1) / sources.length - 0.01];
                        layout['xaxis' + axSuffix] = { domain, title: xLbl0, showgrid: true };
                        layout['yaxis' + axSuffix] = { title: yLbl0, showgrid: true, scaleanchor: 'x' + axSuffix, anchor: 'x' + axSuffix };
                    });

                    setTimeout(() => {
                        Plotly.newPlot(plotDiv, traces, layout, { responsive: true });
                        const applyCmp2 = () => {
                            const cs = cp.querySelector(`#fldcmp-cs-${id}`).value;
                            const rev = cp.querySelector(`#fldcmp-rev-${id}`).checked;
                            const smooth = cp.querySelector(`#fldcmp-sm-${id}`).checked;
                            const showCt = cp.querySelector(`#fldcmp-ct-${id}`).checked;
                            const nc = parseInt(cp.querySelector(`#fldcmp-nc-${id}`).value);
                            const xl = cp.querySelector(`#fldcmp-xl-${id}`).value;
                            const yl = cp.querySelector(`#fldcmp-yl-${id}`).value;
                            const ttl = cp.querySelector(`#fldcmp-ttl-${id}`).value;
                            const cbtl = cp.querySelector(`#fldcmp-cbtl-${id}`).value;
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
                        cp.querySelector(`#fldcmp-png-${id}`).addEventListener('click', () =>
                            Plotly.downloadImage(plotDiv, { format: 'png', filename: outerLabel.replace(/[^a-z0-9]/gi,'_') }));
                    }, 50);

                } else if (_is3DGrid || _is3DUnstr) {
                    // Overlay all runs as separate traces using run colors, shared control panel
                    const traceType = _is3DGrid ? 'volume' : 'isosurface';
                    const units = _fm.units || '';
                    const mkLbl = ax => ax + (units ? ` [${units}]` : '');
                    cp.innerHTML = `
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Title</div>
                        <label>Plot<input type="text" id="fldcmp-ttl-${id}" value="" placeholder="(none)" style="${inputStyle}"></label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Axes</div>
                        <label>X<input type="text" id="fldcmp-xl-${id}" value="${mkLbl('X')}" style="${inputStyle}"></label>
                        <label>Y<input type="text" id="fldcmp-yl-${id}" value="${mkLbl('Y')}" style="${inputStyle}"></label>
                        <label>Z<input type="text" id="fldcmp-zl-${id}" value="${mkLbl('Z')}" style="${inputStyle}"></label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Volume</div>
                        <label>Opacity<input type="range" id="fldcmp-op-${id}" min="0.05" max="1" step="0.05" value="0.3"></label>
                        <label>Surfaces<input type="range" id="fldcmp-ns-${id}" min="1" max="20" step="1" value="5"></label>
                      </div>
                      <div class="rp-panel-section">
                        <div class="rp-panel-title">Download</div>
                        <button class="rp-3d-btn" id="fldcmp-png-${id}">PNG</button>
                      </div>`;

                    // Build one trace per run — each run may have grid or unstructured mesh
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

                    // Dummy scatter3d traces for legend (volume/isosurface don't appear in legend)
                    const buildLegendTraces = () => sources.map(({run}) => ({
                        type: 'scatter3d', mode: 'markers',
                        x: [null], y: [null], z: [null],
                        name: run.label,
                        marker: { color: run._color || '#888', size: 8 },
                        showlegend: true,
                    }));

                    const layout3 = {
                        scene: { xaxis:{title:mkLbl('X')}, yaxis:{title:mkLbl('Y')}, zaxis:{title:mkLbl('Z')} },
                        margin: {t:50,r:20,b:20,l:20}, paper_bgcolor:'white', autosize:true,
                        showlegend: true,
                        legend: { x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top',
                                  bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#ccc', borderwidth: 1,
                                  font: { size: 11 } },
                    };

                    setTimeout(() => {
                        Plotly.newPlot(plotDiv, [...buildTraces(0.3, 5), ...buildLegendTraces()], layout3, { responsive: true });
                        const applyCmp3 = () => {
                            const op = parseFloat(cp.querySelector(`#fldcmp-op-${id}`).value);
                            const ns = parseInt(cp.querySelector(`#fldcmp-ns-${id}`).value);
                            const ttl = cp.querySelector(`#fldcmp-ttl-${id}`).value;
                            const cam = plotDiv._fullLayout && plotDiv._fullLayout.scene ? plotDiv._fullLayout.scene.camera : undefined;
                            Plotly.react(plotDiv, [...buildTraces(op, ns), ...buildLegendTraces()], {
                                ...layout3,
                                title: { text: ttl },
                                scene: {
                                    xaxis: { title: cp.querySelector(`#fldcmp-xl-${id}`).value },
                                    yaxis: { title: cp.querySelector(`#fldcmp-yl-${id}`).value },
                                    zaxis: { title: cp.querySelector(`#fldcmp-zl-${id}`).value },
                                    ...(cam ? { camera: cam } : {}),
                                },
                            });
                        };
                        cp.querySelectorAll('input, select').forEach(el =>
                            el.addEventListener(el.type === 'range' ? 'input' : 'change', applyCmp3));
                        cp.querySelectorAll('input[type=text]').forEach(el => el.addEventListener('input', applyCmp3));
                        cp.querySelector(`#fldcmp-png-${id}`).addEventListener('click', () =>
                            Plotly.downloadImage(plotDiv, { format: 'png', filename: outerLabel.replace(/[^a-z0-9]/gi,'_') }));
                    }, 50);

                } else {
                    // Fallback: stacked sub-renders
                    body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px;overflow:auto';
                    outerWrap.remove();
                    const renderer = this.outputRenderers[type];
                    if (renderer) sources.forEach(({ run, data }) => {
                        const hdr = document.createElement('div');
                        hdr.style.cssText = 'font-size:11px;font-weight:700;color:var(--rp-text-muted);padding:2px 0';
                        hdr.textContent = run.label;
                        body.appendChild(hdr);
                        const subElem = renderer.call(this, id + '__' + run.run_id, data);
                        if (subElem) body.appendChild(subElem);
                    });
                }
                panels[id] = { elem: item, label: outerLabel };

            } else if (type === 'table') {
                // ── Multi-run energy level compare ────────────────────────
                const tblLabel = (firstData.about && firstData.about.label) || firstData.label || id;
                const item = this.createOutputItem(tblLabel, 'table');
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

                    // Zoom traces (xaxis='x2') — only HOMO + LUMO
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

                    // HOMO/LUMO labels on zoom panel (first run only to avoid clutter)
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
                plotDiv.style.cssText = 'width:100%;height:420px';
                body.style.cssText = 'padding:0;display:flex;flex-direction:column';
                body.appendChild(plotDiv);

                // Legend entries: one per run (solid line)
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

                panels[id] = { elem: item, label: tblLabel };

            } else if (type === 'sequence') {
                // ── Multi-run sequence compare ────────────────────────────
                const seqLabel = (firstData.about && firstData.about.label) || firstData.label || id;
                const item = this.createOutputItem(seqLabel, 'sequence');
                const body = item.querySelector('.rp-output-body');

                // Use the max frame count across all runs
                const maxFrames = Math.max(...sources.map(s => (s.data.elements || []).length));
                if (maxFrames === 0) { body.textContent = 'No sequence data'; panels[id] = { elem: item, label: seqLabel }; continue; }

                const indexLabel = firstData.index_label || 'Frame';
                const controls = document.createElement('div');
                controls.className = 'rp-seq-controls';
                const _svgReset2  = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="2" width="2" height="12"/><polygon points="4,8 14,2 14,14"/></svg>';
                const _svgPrev2   = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="9,2 1,8 9,14"/><polygon points="15,2 7,8 15,14"/></svg>';
                const _svgNext2   = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="7,2 15,8 7,14"/><polygon points="1,2 9,8 1,14"/></svg>';
                const _svgPlay2   = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="3,2 13,8 3,14"/></svg>';
                const _svgPause2  = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>';
                const cPrev = document.createElement('button');
                cPrev.type = 'button'; cPrev.className = 'rp-seq-btn'; cPrev.innerHTML = _svgPrev2; cPrev.title = 'Previous frame';
                const lbl = document.createElement('span');
                lbl.className = 'rp-seq-label';
                lbl.textContent = indexLabel + ' 1 / ' + maxFrames;
                const cNext = document.createElement('button');
                cNext.type = 'button'; cNext.className = 'rp-seq-btn'; cNext.innerHTML = _svgNext2; cNext.title = 'Next frame';
                const cPlay = document.createElement('button');
                cPlay.type = 'button'; cPlay.className = 'rp-seq-btn rp-seq-play'; cPlay.innerHTML = _svgPlay2; cPlay.title = 'Play';
                const cPause = document.createElement('button');
                cPause.type = 'button'; cPause.className = 'rp-seq-btn rp-seq-pause'; cPause.innerHTML = _svgPause2; cPause.title = 'Pause'; cPause.style.display = 'none';
                const cReset = document.createElement('button');
                cReset.type = 'button'; cReset.className = 'rp-seq-btn rp-seq-reset'; cReset.innerHTML = _svgReset2; cReset.title = 'Reset';
                const cTopRow = document.createElement('div');
                cTopRow.className = 'rp-seq-top-row';
                cTopRow.appendChild(cReset); cTopRow.appendChild(cPrev); cTopRow.appendChild(lbl); cTopRow.appendChild(cNext); cTopRow.appendChild(cPlay); cTopRow.appendChild(cPause);
                const cSliderWrap = document.createElement('div');
                cSliderWrap.className = 'rp-seq-slider-wrap';
                const slider = document.createElement('input');
                slider.type = 'range'; slider.className = 'rp-seq-slider';
                slider.min = 0; slider.max = maxFrames - 1; slider.value = 0;
                cSliderWrap.appendChild(slider);
                controls.appendChild(cTopRow);
                controls.appendChild(cSliderWrap);
                body.appendChild(controls);

                let _cTimer = null;
                const _cStop = () => {
                    if (_cTimer) { clearInterval(_cTimer); _cTimer = null; }
                    cPlay.style.display = ''; cPause.style.display = 'none';
                };

                // Container for side-by-side run frames
                const framesRow = document.createElement('div');
                framesRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start';
                body.appendChild(framesRow);

                const renderSeqCompareFrame = (frameIdx) => {
                    framesRow.innerHTML = '';
                    slider.value = frameIdx;
                    cPrev.disabled = frameIdx === 0;
                    cNext.disabled = frameIdx === maxFrames - 1;
                    lbl.textContent = indexLabel + ' ' + (frameIdx + 1) + ' / ' + maxFrames;
                    sources.forEach(({ run, data }) => {
                        const elems = data.elements || [];
                        const el = elems[Math.min(frameIdx, elems.length - 1)];
                        if (!el) return;
                        const runColor = run._color || '#3b82f6';
                        const runName = run.label || `Run ${run.run_num || '?'}`;
                        const cell = document.createElement('div');
                        cell.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:200px;flex:1';
                        const runLbl = document.createElement('div');
                        runLbl.style.cssText = `font-size:11px;font-weight:600;color:${runColor};background:${runColor}22;border:1px solid ${runColor};border-radius:3px;padding:2px 8px`;
                        runLbl.textContent = runName;
                        cell.appendChild(runLbl);
                        const frameDiv = document.createElement('div');
                        frameDiv.style.cssText = 'width:100%';
                        for (const [oid, odata] of Object.entries(el.outputs || {})) {
                            const renderer = rappture.outputRenderers[odata.type];
                            if (renderer) {
                                const rendered = renderer.call(rappture.outputRenderers, oid, odata);
                                if (rendered) {
                                    const inner = rendered.querySelector('.rp-output-body');
                                    frameDiv.appendChild(inner || rendered);
                                }
                                break;
                            }
                        }
                        cell.appendChild(frameDiv);
                        framesRow.appendChild(cell);
                    });
                    if (frameIdx >= maxFrames - 1) _cStop();
                };

                slider.addEventListener('input', () => { _cStop(); renderSeqCompareFrame(parseInt(slider.value)); });
                cPrev.addEventListener('click', () => { _cStop(); renderSeqCompareFrame(Math.max(0, parseInt(slider.value) - 1)); });
                cNext.addEventListener('click', () => { _cStop(); renderSeqCompareFrame(Math.min(maxFrames - 1, parseInt(slider.value) + 1)); });
                cReset.addEventListener('click', () => { _cStop(); renderSeqCompareFrame(0); });
                cPlay.addEventListener('click', () => {
                    let cur = parseInt(slider.value);
                    if (cur >= maxFrames - 1) cur = 0;
                    renderSeqCompareFrame(cur);
                    cPlay.style.display = 'none'; cPause.style.display = '';
                    _cTimer = setInterval(() => {
                        cur = parseInt(slider.value) + 1;
                        if (cur >= maxFrames) { _cStop(); return; }
                        renderSeqCompareFrame(cur);
                    }, 600);
                });
                cPause.addEventListener('click', _cStop);
                requestAnimationFrame(() => renderSeqCompareFrame(0));
                panels[id] = { elem: item, label: seqLabel };

            } else {
                const renderer = this.outputRenderers[type];
                if (renderer) {
                    const elem = renderer.call(this, id, firstData);
                    if (elem) panels[id] = { elem, label: (firstData.about && firstData.about.label) || firstData.label || id };
                }
            }
        }

        this._renderTabLayout(container, panels);
    },

    // ── Color-coded inputs ───────────────────────────────────────────────────

    /** Convert a wavelength in nm (400-700) to an RGB hex string. */
    _wavelengthToHex(nm) {
        let r, g, b;
        if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; g = 0; b = 1; }
        else if (nm < 490)         { r = 0; g = (nm - 440) / 50; b = 1; }
        else if (nm < 510)         { r = 0; g = 1; b = -(nm - 510) / 20; }
        else if (nm < 580)         { r = (nm - 510) / 70; g = 1; b = 0; }
        else if (nm < 645)         { r = 1; g = -(nm - 645) / 65; b = 0; }
        else if (nm <= 780)        { r = 1; g = 0; b = 0; }
        else                       { r = 0; g = 0; b = 0; }
        const factor = (nm < 420) ? 0.3 + 0.7 * (nm - 380) / 40 :
                       (nm > 700) ? 0.3 + 0.7 * (780 - nm) / 80 : 1.0;
        const toHex = v => Math.round(Math.pow(Math.max(0, v) * factor, 0.8) * 255).toString(16).padStart(2, '0');
        return '#' + toHex(r) + toHex(g) + toHex(b);
    },

    /** Parse a Rappture color spec like "10 red 20 blue" or "0 400nm 20 700nm"
     *  into [{val, r, g, b}, ...] stops. */
    _parseColorSpec(spec) {
        const parts = spec.trim().split(/\s+/);
        const stops = [];
        for (let i = 0; i + 1 < parts.length; i += 2) {
            const val = parseFloat(parts[i]);
            let colorStr = parts[i + 1];
            let hex;
            const nmMatch = colorStr.match(/^(\d+(?:\.\d+)?)nm$/i);
            if (nmMatch) {
                hex = this._wavelengthToHex(parseFloat(nmMatch[1]));
            } else {
                // Use a temporary element to resolve CSS color names
                const tmp = document.createElement('div');
                tmp.style.color = colorStr;
                document.body.appendChild(tmp);
                const rgb = getComputedStyle(tmp).color;
                document.body.removeChild(tmp);
                const m = rgb.match(/\d+/g);
                if (m) hex = '#' + m.slice(0,3).map(v => parseInt(v).toString(16).padStart(2,'0')).join('');
                else hex = '#888888';
            }
            const r = parseInt(hex.slice(1,3), 16);
            const g = parseInt(hex.slice(3,5), 16);
            const b = parseInt(hex.slice(5,7), 16);
            stops.push({ val, r, g, b });
        }
        return stops;
    },

    /** Interpolate color stops at a given value, return hex string. */
    _interpolateColor(stops, val) {
        if (!stops.length) return null;
        if (val <= stops[0].val) return `rgb(${stops[0].r},${stops[0].g},${stops[0].b})`;
        if (val >= stops[stops.length-1].val) { const s = stops[stops.length-1]; return `rgb(${s.r},${s.g},${s.b})`; }
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i+1];
            if (val >= a.val && val <= b.val) {
                const t = (val - a.val) / (b.val - a.val);
                return `rgb(${Math.round(a.r + t*(b.r-a.r))},${Math.round(a.g + t*(b.g-a.g))},${Math.round(a.b + t*(b.b-a.b))})`;
            }
        }
        return null;
    },

    /** Update the left border color of an input based on its color spec,
     *  and render the gradient bar showing the full range. */
    updateInputColor(input) {
        const widget = input.closest('.rp-widget');
        const spec = widget && widget.dataset.color;
        if (!spec) return;
        const stops = this._parseColorSpec(spec);
        if (!stops.length) return;

        // Current-value indicator: colored left border
        const color = this._interpolateColor(stops, parseFloat(input.value));
        if (color) {
            input.style.borderLeft = `6px solid ${color}`;
            input.style.paddingLeft = '4px';
        }

        // Gradient bar: build CSS gradient from stops, sized to fill min→max
        const bar = widget.querySelector('.rp-color-bar');
        if (bar) {
            const min = parseFloat(input.min ?? stops[0].val);
            const max = parseFloat(input.max ?? stops[stops.length-1].val);
            const range = max - min || 1;
            const gradientStops = stops.map(s => {
                const pct = ((s.val - min) / range * 100).toFixed(1);
                return `rgb(${s.r},${s.g},${s.b}) ${pct}%`;
            }).join(', ');
            bar.style.background = `linear-gradient(to right, ${gradientStops})`;

            // Marker showing current value position
            const val = Math.min(Math.max(parseFloat(input.value), min), max);
            const pct = ((val - min) / range * 100).toFixed(1);
            bar.style.position = 'relative';
            let marker = bar.querySelector('.rp-color-marker');
            if (!marker) {
                marker = document.createElement('div');
                marker.className = 'rp-color-marker';
                marker.style.cssText = 'position:absolute;top:-2px;width:3px;height:10px;background:#fff;border:1px solid #333;border-radius:1px;transform:translateX(-50%);pointer-events:none';
                bar.appendChild(marker);
            }
            marker.style.left = pct + '%';
        }
    },

    /** Initialize color-coded inputs on page load. */
    initColorInputs() {
        document.querySelectorAll('.rp-widget[data-color]').forEach(widget => {
            const input = widget.querySelector('input[type="number"]');
            if (input) this.updateInputColor(input);
        });
    },

    // ── Periodic Element ─────────────────────────────────────────────────────

    _ELEMENTS: [
      // symbol, name, number, weight, category, period, group
      ['H','Hydrogen',1,1.008,'other-non-metal',1,1],
      ['He','Helium',2,4.003,'noble-gas',1,18],
      ['Li','Lithium',3,6.941,'alkali-metal',2,1],
      ['Be','Beryllium',4,9.012,'alkaline-earth-metal',2,2],
      ['B','Boron',5,10.811,'metalloid',2,13],
      ['C','Carbon',6,12.011,'other-non-metal',2,14],
      ['N','Nitrogen',7,14.007,'other-non-metal',2,15],
      ['O','Oxygen',8,15.999,'other-non-metal',2,16],
      ['F','Fluorine',9,18.998,'halogen',2,17],
      ['Ne','Neon',10,20.180,'noble-gas',2,18],
      ['Na','Sodium',11,22.990,'alkali-metal',3,1],
      ['Mg','Magnesium',12,24.305,'alkaline-earth-metal',3,2],
      ['Al','Aluminum',13,26.982,'post-transition-metal',3,13],
      ['Si','Silicon',14,28.086,'metalloid',3,14],
      ['P','Phosphorus',15,30.974,'other-non-metal',3,15],
      ['S','Sulfur',16,32.065,'other-non-metal',3,16],
      ['Cl','Chlorine',17,35.453,'halogen',3,17],
      ['Ar','Argon',18,39.948,'noble-gas',3,18],
      ['K','Potassium',19,39.098,'alkali-metal',4,1],
      ['Ca','Calcium',20,40.078,'alkaline-earth-metal',4,2],
      ['Sc','Scandium',21,44.956,'transition-metal',4,3],
      ['Ti','Titanium',22,47.867,'transition-metal',4,4],
      ['V','Vanadium',23,50.942,'transition-metal',4,5],
      ['Cr','Chromium',24,51.996,'transition-metal',4,6],
      ['Mn','Manganese',25,54.938,'transition-metal',4,7],
      ['Fe','Iron',26,55.845,'transition-metal',4,8],
      ['Co','Cobalt',27,58.933,'transition-metal',4,9],
      ['Ni','Nickel',28,58.693,'transition-metal',4,10],
      ['Cu','Copper',29,63.546,'transition-metal',4,11],
      ['Zn','Zinc',30,65.38,'transition-metal',4,12],
      ['Ga','Gallium',31,69.723,'post-transition-metal',4,13],
      ['Ge','Germanium',32,72.640,'metalloid',4,14],
      ['As','Arsenic',33,74.922,'metalloid',4,15],
      ['Se','Selenium',34,78.960,'other-non-metal',4,16],
      ['Br','Bromine',35,79.904,'halogen',4,17],
      ['Kr','Krypton',36,83.798,'noble-gas',4,18],
      ['Rb','Rubidium',37,85.468,'alkali-metal',5,1],
      ['Sr','Strontium',38,87.620,'alkaline-earth-metal',5,2],
      ['Y','Yttrium',39,88.906,'transition-metal',5,3],
      ['Zr','Zirconium',40,91.224,'transition-metal',5,4],
      ['Nb','Niobium',41,92.906,'transition-metal',5,5],
      ['Mo','Molybdenum',42,95.960,'transition-metal',5,6],
      ['Tc','Technetium',43,98,'transition-metal',5,7],
      ['Ru','Ruthenium',44,101.07,'transition-metal',5,8],
      ['Rh','Rhodium',45,102.906,'transition-metal',5,9],
      ['Pd','Palladium',46,106.42,'transition-metal',5,10],
      ['Ag','Silver',47,107.868,'transition-metal',5,11],
      ['Cd','Cadmium',48,112.411,'transition-metal',5,12],
      ['In','Indium',49,114.818,'post-transition-metal',5,13],
      ['Sn','Tin',50,118.710,'post-transition-metal',5,14],
      ['Sb','Antimony',51,121.760,'metalloid',5,15],
      ['Te','Tellurium',52,127.600,'metalloid',5,16],
      ['I','Iodine',53,126.904,'halogen',5,17],
      ['Xe','Xenon',54,131.293,'noble-gas',5,18],
      ['Cs','Cesium',55,132.905,'alkali-metal',6,1],
      ['Ba','Barium',56,137.327,'alkaline-earth-metal',6,2],
      ['La','Lanthanum',57,138.905,'lanthanide',6,3],
      ['Ce','Cerium',58,140.116,'lanthanide',8,4],
      ['Pr','Praseodymium',59,140.908,'lanthanide',8,5],
      ['Nd','Neodymium',60,144.242,'lanthanide',8,6],
      ['Pm','Promethium',61,145,'lanthanide',8,7],
      ['Sm','Samarium',62,150.360,'lanthanide',8,8],
      ['Eu','Europium',63,151.964,'lanthanide',8,9],
      ['Gd','Gadolinium',64,157.250,'lanthanide',8,10],
      ['Tb','Terbium',65,158.925,'lanthanide',8,11],
      ['Dy','Dysprosium',66,162.500,'lanthanide',8,12],
      ['Ho','Holmium',67,164.930,'lanthanide',8,13],
      ['Er','Erbium',68,167.259,'lanthanide',8,14],
      ['Tm','Thulium',69,168.934,'lanthanide',8,15],
      ['Yb','Ytterbium',70,173.045,'lanthanide',8,16],
      ['Lu','Lutetium',71,174.967,'lanthanide',8,17],
      ['Hf','Hafnium',72,178.490,'transition-metal',6,4],
      ['Ta','Tantalum',73,180.948,'transition-metal',6,5],
      ['W','Tungsten',74,183.840,'transition-metal',6,6],
      ['Re','Rhenium',75,186.207,'transition-metal',6,7],
      ['Os','Osmium',76,190.230,'transition-metal',6,8],
      ['Ir','Iridium',77,192.217,'transition-metal',6,9],
      ['Pt','Platinum',78,195.084,'transition-metal',6,10],
      ['Au','Gold',79,196.967,'transition-metal',6,11],
      ['Hg','Mercury',80,200.592,'transition-metal',6,12],
      ['Tl','Thallium',81,204.383,'post-transition-metal',6,13],
      ['Pb','Lead',82,207.200,'post-transition-metal',6,14],
      ['Bi','Bismuth',83,208.980,'post-transition-metal',6,15],
      ['Po','Polonium',84,209,'metalloid',6,16],
      ['At','Astatine',85,210,'halogen',6,17],
      ['Rn','Radon',86,222,'noble-gas',6,18],
      ['Fr','Francium',87,223,'alkali-metal',7,1],
      ['Ra','Radium',88,226,'alkaline-earth-metal',7,2],
      ['Ac','Actinium',89,227,'actinide',7,3],
      ['Th','Thorium',90,232.038,'actinide',9,4],
      ['Pa','Protactinium',91,231.036,'actinide',9,5],
      ['U','Uranium',92,238.029,'actinide',9,6],
      ['Np','Neptunium',93,237,'actinide',9,7],
      ['Pu','Plutonium',94,244,'actinide',9,8],
      ['Am','Americium',95,243,'actinide',9,9],
      ['Cm','Curium',96,247,'actinide',9,10],
      ['Bk','Berkelium',97,247,'actinide',9,11],
      ['Cf','Californium',98,251,'actinide',9,12],
      ['Es','Einsteinium',99,252,'actinide',9,13],
      ['Fm','Fermium',100,257,'actinide',9,14],
      ['Md','Mendelevium',101,258,'actinide',9,15],
      ['No','Nobelium',102,259,'actinide',9,16],
      ['Lr','Lawrencium',103,262,'actinide',9,17],
      ['Rf','Rutherfordium',104,267,'transition-metal',7,4],
      ['Db','Dubnium',105,270,'transition-metal',7,5],
      ['Sg','Seaborgium',106,271,'transition-metal',7,6],
      ['Bh','Bohrium',107,270,'transition-metal',7,7],
      ['Hs','Hassium',108,277,'transition-metal',7,8],
      ['Mt','Meitnerium',109,278,'transition-metal',7,9],
      ['Ds','Darmstadtium',110,281,'transition-metal',7,10],
      ['Rg','Roentgenium',111,282,'transition-metal',7,11],
      ['Cn','Copernicium',112,285,'transition-metal',7,12],
      ['Nh','Nihonium',113,286,'post-transition-metal',7,13],
      ['Fl','Flerovium',114,289,'post-transition-metal',7,14],
      ['Mc','Moscovium',115,290,'post-transition-metal',7,15],
      ['Lv','Livermorium',116,293,'post-transition-metal',7,16],
      ['Ts','Tennessine',117,294,'halogen',7,17],
      ['Og','Oganesson',118,294,'noble-gas',7,18],
    ],

    _PE_COLORS: {
      'alkali-metal':          '#ff6666',
      'alkaline-earth-metal':  '#ffdead',
      'transition-metal':      '#ffc0c0',
      'post-transition-metal': '#cccccc',
      'metalloid':             '#cccc99',
      'other-non-metal':       '#a0ffa0',
      'halogen':               '#ffff99',
      'noble-gas':             '#c0ffff',
      'lanthanide':            '#ffbfff',
      'actinide':              '#ff99cc',
    },

    _peFormatValue(el, returnvalue) {
        const parts = returnvalue.trim().split(/\s+/);
        if (parts.length === 1) {
            switch (parts[0]) {
                case 'symbol':  return el[0];
                case 'name':    return el[1];
                case 'number':  return String(el[2]);
                case 'weight':  return String(el[3]);
                case 'all':     return `${el[0]} ${el[1]} ${el[2]} ${el[3]}`;
                default:        return el[0];
            }
        }
        // multiple keywords: space-separated list of values
        return parts.map(p => {
            switch (p) {
                case 'symbol':  return el[0];
                case 'name':    return el[1];
                case 'number':  return String(el[2]);
                case 'weight':  return String(el[3]);
                default:        return '';
            }
        }).filter(Boolean).join(' ');
    },

    _peFindElement(val) {
        if (!val) return null;
        const v = val.trim().toLowerCase();
        return this._ELEMENTS.find(e =>
            e[0].toLowerCase() === v || e[1].toLowerCase() === v ||
            String(e[2]) === v
        ) || null;
    },

    initPeriodicElement(widget) {
        const returnvalue = widget.dataset.returnvalue || 'symbol';
        const activeStr   = (widget.dataset.active   || '').trim();
        const inactiveStr = (widget.dataset.inactive || '').trim();
        const activeSet   = activeStr   ? new Set(activeStr.split(/\s+/))   : null;
        const inactiveSet = inactiveStr ? new Set(inactiveStr.split(/\s+/)) : null;

        const table    = widget.querySelector('.rp-pe-table');
        const hiddenIn = widget.querySelector('.rp-pe-value');
        const swatchEl = widget.querySelector('.rp-pe-swatch');
        const nameEl   = widget.querySelector('.rp-pe-selected-name');

        // Build grid: period rows 1-7 + gap row + lanthanides(8) + actinides(9)
        const grid = {};
        this._ELEMENTS.forEach(el => {
            const [sym, name, num, wt, cat, period, grp] = el;
            if (!grid[period]) grid[period] = {};
            grid[period][grp] = el;
        });

        const rows = [1,2,3,4,5,6,7,null,8,9];
        const tbody = document.createElement('tbody');
        rows.forEach(period => {
            const tr = document.createElement('tr');
            if (period === null) {
                // Gap row
                const td = document.createElement('td');
                td.colSpan = 18;
                td.style.height = '4px';
                tr.appendChild(td);
                tbody.appendChild(tr);
                return;
            }
            for (let g = 1; g <= 18; g++) {
                const td = document.createElement('td');
                const el = grid[period] && grid[period][g];
                if (el) {
                    const [sym, name, num, wt, cat] = el;
                    const color = this._PE_COLORS[cat] || '#eee';
                    let disabled = false;
                    if (activeSet   && !activeSet.has(cat)   && !activeSet.has(sym))   disabled = true;
                    if (inactiveSet && (inactiveSet.has(cat) || inactiveSet.has(sym))) disabled = true;
                    td.className = 'rp-pe-cell' + (disabled ? ' rp-pe-disabled' : '');
                    td.style.background = disabled ? '#333' : color;
                    td.title = `${name} (${num})`;
                    td.textContent = sym;
                    td.dataset.sym = sym;
                    if (!disabled) {
                        td.addEventListener('click', () => this._peSelect(widget, el, returnvalue));
                    }
                } else {
                    td.className = 'rp-pe-cell rp-pe-empty';
                    // lanthanide/actinide placeholder label
                    if (g === 3 && (period === 6 || period === 7)) {
                        td.textContent = period === 6 ? '57-71' : '89-103';
                        td.style.fontSize = '7px';
                        td.style.color = '#888';
                    }
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        // Set initial selection from hidden input
        const initVal = hiddenIn.value;
        if (initVal) {
            const el = this._peFindElement(initVal);
            if (el) this._peSelect(widget, el, returnvalue, true);
        }

        // Toggle table visibility on click of selected row
        const tableWrap = widget.querySelector('.rp-pe-table-wrap');
        const selectedRow = widget.querySelector('.rp-pe-selected-row');
        selectedRow.addEventListener('click', (e) => {
            const isOpen = tableWrap.style.display !== 'none';
            // Close all other open tables first
            document.querySelectorAll('.rp-pe-table-wrap').forEach(w => { w.style.display = 'none'; });
            document.querySelectorAll('.rp-pe-arrow').forEach(a => { a.classList.remove('rp-pe-arrow-open'); });
            if (!isOpen) {
                tableWrap.style.display = '';
                widget.querySelector('.rp-pe-arrow').classList.add('rp-pe-arrow-open');
            }
            e.stopPropagation();
        });

        // Close when clicking outside
        document.addEventListener('click', () => {
            tableWrap.style.display = 'none';
            const arrow = widget.querySelector('.rp-pe-arrow');
            if (arrow) arrow.classList.remove('rp-pe-arrow-open');
        });

        // Close and update when an element is selected
        table.addEventListener('click', () => {
            tableWrap.style.display = 'none';
            const arrow = widget.querySelector('.rp-pe-arrow');
            if (arrow) arrow.classList.remove('rp-pe-arrow-open');
        });
    },

    _peSelect(widget, el, returnvalue, silent) {
        const hiddenIn = widget.querySelector('.rp-pe-value');
        const swatchEl = widget.querySelector('.rp-pe-swatch');
        const nameEl   = widget.querySelector('.rp-pe-selected-name');
        const color    = this._PE_COLORS[el[4]] || '#eee';

        // Highlight selected cell
        widget.querySelectorAll('.rp-pe-cell.rp-pe-selected').forEach(c => c.classList.remove('rp-pe-selected'));
        const cell = widget.querySelector(`.rp-pe-cell[data-sym="${el[0]}"]`);
        if (cell) cell.classList.add('rp-pe-selected');

        swatchEl.style.background = color;
        nameEl.textContent = `${el[1]} (${el[0]}, ${el[2]})`;
        hiddenIn.value = this._peFormatValue(el, returnvalue);
        if (!silent) hiddenIn.dispatchEvent(new Event('change', { bubbles: true }));
    },

    // ── Phase tabs ───────────────────────────────────────────────────────────

    switchPhase(path) {
        // Hide all panels, deactivate all tabs
        document.querySelectorAll('.rp-phase-panel').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.rp-phase-tab').forEach(t => t.classList.remove('rp-phase-tab-active'));
        // Show selected panel and activate its tab
        const panelId = 'phase-panel-' + path.replace(/[.()\s]/g, '_');
        const panel = document.getElementById(panelId);
        if (panel) panel.style.display = '';
        const tab = document.querySelector(`.rp-phase-tab[data-phase="${path}"]`);
        if (tab) tab.classList.add('rp-phase-tab-active');
    },

    // ── Preset / tab helpers ─────────────────────────────────────────────────

    applyPreset(selectElem, path) {
        if (!selectElem.value) return;
        const widget = document.querySelector(`.rp-widget[data-path="${path}"]`);
        if (widget) {
            const input = widget.querySelector('input[type="number"]');
            if (input) {
                input.value = selectElem.value;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        selectElem.selectedIndex = 0;
    },

    switchTab(btn, panelId) {
        const container = btn.closest('.rp-group-tabbed');
        if (!container) return;
        container.querySelectorAll('.rp-tab-btn').forEach(b => b.classList.remove('active'));
        container.querySelectorAll('.rp-tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
    },

    // ── Enable conditions ────────────────────────────────────────────────────

    initEnableConditions() {
        const widgets = document.querySelectorAll('.rp-widget[data-enable]');
        if (!widgets.length) return;

        const conditions = [];
        widgets.forEach(w => {
            const expr = w.dataset.enable;
            if (expr) conditions.push({ element: w, expression: expr });
        });

        const evaluate = () => {
            conditions.forEach(cond => {
                const enabled = this.evaluateEnable(cond.expression);
                cond.element.hidden = !enabled;
                cond.element.classList.toggle('rp-disabled', !enabled);
            });
        };

        document.querySelectorAll('.rp-input').forEach(input => {
            input.addEventListener('change', evaluate);
            input.addEventListener('input', evaluate);
        });

        evaluate();
    },

    evaluateEnable(expr) {
        expr = expr.trim();
        if (['yes', 'on', 'true', '1'].includes(expr)) return true;
        if (['no', 'off', 'false', '0'].includes(expr)) return false;

        // Comparison: path op value
        const compMatch = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
        if (compMatch) {
            const actual = this.getInputValue(compMatch[1].trim());
            if (actual === null) return false;
            const expected = compMatch[3].trim().replace(/^["']|["']$/g, '');
            switch (compMatch[2]) {
                case '==': return actual === expected;
                case '!=': return actual !== expected;
                case '>=': return parseFloat(actual) >= parseFloat(expected);
                case '<=': return parseFloat(actual) <= parseFloat(expected);
                case '>':  return parseFloat(actual) > parseFloat(expected);
                case '<':  return parseFloat(actual) < parseFloat(expected);
            }
        }

        // Boolean path reference
        const val = this.getInputValue(expr);
        if (val !== null) return ['yes', 'on', 'true', '1'].includes(val.toLowerCase());
        return true;
    },

    getInputValue(path) {
        const cleanPath = path.replace(/:[\w]+/g, '');
        let widget = document.querySelector(`.rp-widget[data-path="${cleanPath}"]`)
            || document.querySelector(`.rp-widget[data-path="input.${cleanPath}"]`);
        if (!widget) return null;

        const type = widget.dataset.type;
        if (type === 'boolean') {
            const cb = widget.querySelector('input[type="checkbox"]');
            return cb && cb.checked ? 'yes' : 'no';
        }
        const input = widget.querySelector('input, select, textarea');
        return input ? input.value : null;
    },

    // ── Status helpers ───────────────────────────────────────────────────────

    _setRunning(running) {
        const btn = document.getElementById('rp-simulate-btn');
        if (!btn) return;
        btn.disabled = running;
        btn.classList.toggle('running', running);
        btn.textContent = running ? 'Running...' : 'Simulate';
    },

    _setStatus(text, cls = '') {
        const el = document.getElementById('rp-status');
        if (!el) return;
        el.textContent = text;
        el.className = 'rp-status' + (cls ? ' ' + cls : '');
    },
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    rappture.initEnableConditions();
    rappture.initColorInputs();
    rappture.connectWebSocket();
    rappture._fetchRunHistory();
    document.querySelectorAll('.rp-periodicelement').forEach(w => rappture.initPeriodicElement(w));
});
