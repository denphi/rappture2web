/**
 * Rappture2Web client-side logic.
 * Handles form collection, simulation, enable/disable conditions,
 * WebSocket live output streaming, and run history browsing.
 */

/**
 * Run `fn` once `el` has non-zero dimensions.
 * If already visible, runs immediately (inside requestAnimationFrame).
 * Otherwise waits for IntersectionObserver to fire when el becomes visible.
 */
function _whenVisible(el, fn) {
    const tryRun = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w > 0 && h > 0) { fn(); return true; }
        return false;
    };
    if (!tryRun()) {
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                io.disconnect();
                requestAnimationFrame(() => tryRun());
            }
        }, { threshold: 0 });
        io.observe(el);
    }
}

/**
 * Create a ResizeObserver that ignores the first N callbacks (Plotly init reflow)
 * then resizes plotDiv height to match el on subsequent changes.
 */
function _plotResizeObserver(el, plotDiv, skip) {
    let _skip = skip || 1;
    return new ResizeObserver(() => {
        if (_skip > 0) { _skip--; return; }
        const nh = el.clientHeight;
        if (nh > 50) { plotDiv.style.height = nh + 'px'; Plotly.relayout(plotDiv, { height: nh }); }
    });
}

/**
 * Guard Plotly resize calls for hidden/not-yet-mounted elements.
 * Plotly throws "Resize must be passed a displayed plot div element."
 * in these cases; swallow that path and keep UI noise-free.
 */
function _patchPlotlyResizeGuard() {
    if (!window.Plotly || !Plotly.Plots || typeof Plotly.Plots.resize !== 'function') return;
    if (Plotly.Plots._rpResizePatched) return;
    const origResize = Plotly.Plots.resize.bind(Plotly.Plots);
    Plotly.Plots.resize = function(plotDiv) {
        if (!plotDiv || !plotDiv.isConnected) return Promise.resolve();
        const rect = plotDiv.getBoundingClientRect ? plotDiv.getBoundingClientRect() : { width: 0, height: 0 };
        const style = window.getComputedStyle ? window.getComputedStyle(plotDiv) : null;
        if (rect.width <= 0 || rect.height <= 0 || (style && style.display === 'none')) {
            return Promise.resolve();
        }
        try {
            const out = origResize(plotDiv);
            if (out && typeof out.then === 'function') return out.catch(() => {});
            return Promise.resolve(out);
        } catch {
            return Promise.resolve();
        }
    };
    Plotly.Plots._rpResizePatched = true;
}

_patchPlotlyResizeGuard();

const rappture = {

    // ── Base path (set by server for reverse-proxy support) ──────────────────
    _bp: (typeof window._rpBasePath === 'string' ? window._rpBasePath : ''),

    // ── Renderer registry ────────────────────────────────────────────────────

    /**
     * Registry of output renderers keyed by Rappture output type.
     * Each entry: { render(id, data) => HTMLElement, compare?(sources, id) => {elem, label} }
     */
    _rendererRegistry: {},

    /**
     * Register a renderer for a Rappture output type.
     * Also installs into outputRenderers for backward compatibility.
     * @param {string} type - Output type name (e.g. 'curve', 'field_2d')
     * @param {Object} def - {render(id, data), compare?(sources, id)}
     */
    _registerRenderer(type, def) {
        this._rendererRegistry[type] = def;
        this.outputRenderers[type] = function(id, data) {
            return def.render.call(rappture, id, data);
        };
    },

    /**
     * Merge grouped outputs (curves/histograms sharing a group name into a single
     * mixed-type curve; fields sharing a group into a field_group).
     * @param {Array} entries - Array of [id, output] pairs
     * @returns {Array} merged entries in insertion order
     */
    _mergeGroupedOutputs(entries) {
        const groupedMap = {};
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
        return mergedEntries;
    },

    /**
     * Classify a field output into a sub-type for dispatch.
     * @param {Object} data - Field output data
     * @returns {string} One of: '2d', '3d', 'vtk', 'unstructured', 'vector'
     */
    _classifyField(data) {
        const firstComp = (data.components || [])[0];
        const firstMesh = firstComp && firstComp.mesh;

        // VTK structured points
        if (firstComp && firstComp.vtk_type === 'structured_points'
            && firstComp.grid_data && firstComp.grid_data.nx) {
            return 'vtk';
        }

        if (firstMesh && firstMesh.mesh_type === 'grid' && firstMesh.axes) {
            const hasZ = !!(firstMesh.axes.z);
            const isScalar = (firstComp.extents || 1) === 1;

            // 2D scalar grid
            if (firstMesh.axes.x && firstMesh.axes.y && !hasZ && isScalar) {
                return '2d';
            }
            // 3D scalar grid
            if (firstMesh.axes.x && firstMesh.axes.y && hasZ && isScalar) {
                return '3d';
            }
        }

        // 3D unstructured scalar
        if (firstMesh && firstMesh.mesh_type === 'unstructured'
            && firstMesh.points && firstMesh.points.length > 0
            && (firstComp.extents || 1) === 1
            && firstMesh.points[0] && firstMesh.points[0].length === 3) {
            return 'unstructured';
        }

        // Vector/flow fields and anything else handled by Three.js
        return 'vector';
    },

    // ── WebSocket ────────────────────────────────────────────────────────────

    ws: null,
    wsReconnectDelay: 2000,
    _preferFirstOutputOnNextRender: false,

    connectWebSocket() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${location.host}${this._bp}/ws`;
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
                if (msg.status === 'running') {
                    this._setRunning(true);
                    const p = (msg.progress && msg.progress.percent !== null) ? msg.progress.percent : null;
                    const m = (msg.progress && msg.progress.message) ? msg.progress.message : '';
                    this._renderProgressStatus(p, m);
                }
                if (msg.outputs && Object.keys(msg.outputs).length) {
                    this.renderOutputs(msg.outputs, msg.log || '');
                }
                break;

            case 'status':
                this._setRunning(msg.status === 'running');
                this._setStatus(msg.status === 'running' ? 'Simulation running...' : msg.status);
                break;

            case 'progress':
                this._renderProgressStatus(msg.percent, msg.message || '');
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
                this._preferFirstOutputOnNextRender = true;
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
        fetch(this._bp + '/api/loader-examples/' + encodeURIComponent(filename) + '?pattern=' + encodeURIComponent(pattern))
            .then(r => r.json())
            .then(data => { if (data.content) this._applyExampleXml(data.content, targets); })
            .catch(() => {});
    },

    initLoaders() {
        document.querySelectorAll('.rp-loader').forEach(widget => {
            const sel = widget.querySelector('.rp-loader-select');
            if (!sel || sel.dataset.rpInit === '1') return;
            sel.dataset.rpInit = '1';
            const defaultFile = widget.dataset.loaderDefault || '';
            const pattern = widget.dataset.example || '*.xml';
            fetch(this._bp + '/api/loader-examples?pattern=' + encodeURIComponent(pattern))
                .then(r => r.json())
                .then(examples => {
                    examples.forEach(ex => {
                        const opt = document.createElement('option');
                        opt.value = ex.filename;
                        opt.textContent = ex.label;
                        if (ex.filename === defaultFile) opt.selected = true;
                        sel.appendChild(opt);
                    });
                    if (sel.value) this.loadExampleByName(sel);
                })
                .catch(() => {});
        });
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
        const uploadInput = document.getElementById('rp-upload-run-input');
        if (!uploadInput) return;
        uploadInput.value = '';
        uploadInput.click();
    },

    async uploadRunFile(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        this._setStatus('Uploading ' + file.name + '...');
        const fd = new FormData();
        fd.append('file', file);
        try {
            const resp = await fetch(this._bp + '/api/upload-run', { method: 'POST', body: fd });
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
            const response = await fetch(this._bp + '/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs }),
            });
            const result = await response.json();

            const cached = result.cached ? ' (cached)' : '';
            const runLabel = result.run_num ? ` Run #${result.run_num}` : '';
            this._setStatus(`Complete${runLabel}${cached}`, result.status === 'success' ? 'success' : 'error');
            this._preferFirstOutputOnNextRender = true;
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
    _resultsResizeObserver: null,
    _resultsResizeRaf: 0,
    _resultsResizeTarget: null,

    _resizeOutputPanel(panel) {
        if (!panel) return;
        panel.querySelectorAll('.rp-output-plot').forEach(plotDiv => {
            if (window.Plotly) Plotly.Plots.resize(plotDiv);
        });
        panel.querySelectorAll('canvas').forEach(c => {
            c.dispatchEvent(new Event('resize'));
            const wrap = c.parentElement;
            if (wrap) wrap.dispatchEvent(new Event('resize'));
        });
    },

    _queueActiveOutputResize() {
        if (this._resultsResizeRaf) return;
        this._resultsResizeRaf = requestAnimationFrame(() => {
            this._resultsResizeRaf = 0;
            const activePanel = document.querySelector('#rp-results .rp-output-panel.active');
            this._resizeOutputPanel(activePanel);
        });
    },

    _watchResultsResize() {
        const container = document.getElementById('rp-results');
        if (!container || typeof ResizeObserver === 'undefined') return;
        if (this._resultsResizeObserver && this._resultsResizeTarget === container) return;

        if (this._resultsResizeObserver) {
            this._resultsResizeObserver.disconnect();
            this._resultsResizeObserver = null;
        }

        this._resultsResizeTarget = container;
        let lastW = 0;
        let lastH = 0;
        this._resultsResizeObserver = new ResizeObserver(entries => {
            const rect = entries && entries[0] && entries[0].contentRect;
            if (!rect) {
                this._queueActiveOutputResize();
                return;
            }
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);
            if (w === lastW && h === lastH) return;
            lastW = w;
            lastH = h;
            this._queueActiveOutputResize();
        });
        this._resultsResizeObserver.observe(container);
        this._queueActiveOutputResize();
    },

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
        const mergedEntries = rappture._mergeGroupedOutputs(entries);

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

        // Remember the currently active label so we can restore it after re-render
        const prevSel = container.querySelector('.rp-output-selector');
        const prevActiveLabel = prevSel ? prevSel.value : null;

        container.innerHTML = '';

        // Selector bar
        const bar = document.createElement('div');
        bar.className = 'rp-output-tabs';

        const lbl = document.createElement('label');
        lbl.className = 'rp-sr-only';
        lbl.setAttribute('for', 'rp-output-selector');
        lbl.textContent = 'Select output';
        bar.appendChild(lbl);

        const sel = document.createElement('select');
        sel.className = 'rp-output-selector';
        sel.id = 'rp-output-selector';
        sel.setAttribute('aria-label', 'Select output to display');
        bar.appendChild(sel);

        // Panel wrapper
        const panelWrap = document.createElement('div');
        panelWrap.className = 'rp-output-panels';

        // Determine which index should be active
        let activeIdx = 0;
        if (this._preferFirstOutputOnNextRender) {
            const firstNonLogIdx = ids.findIndex(id => id !== '__log__');
            activeIdx = firstNonLogIdx >= 0 ? firstNonLogIdx : 0;
            this._preferFirstOutputOnNextRender = false;
        } else {
            activeIdx = prevActiveLabel
                ? Math.max(0, ids.findIndex(id => panels[id].label === prevActiveLabel))
                : 0;
        }

        const _switchTo = (idx) => {
            panelWrap.querySelectorAll('.rp-output-panel').forEach(p => p.classList.remove('active'));
            const activePanelId = 'rp-panel-' + ids[idx];
            const activePanel = document.getElementById(activePanelId);
            if (activePanel) {
                activePanel.classList.add('active');
                this._queueActiveOutputResize();
            }
        };

        ids.forEach((id, i) => {
            const { elem, label } = panels[id];
            const panelId = 'rp-panel-' + id;

            const opt = document.createElement('option');
            opt.value = label;
            opt.textContent = label;
            if (i === activeIdx) opt.selected = true;
            sel.appendChild(opt);

            const panel = document.createElement('div');
            panel.className = 'rp-output-panel' + (i === activeIdx ? ' active' : '');
            panel.id = panelId;
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', label);
            panel.appendChild(elem);
            panelWrap.appendChild(panel);
        });

        sel.addEventListener('change', () => {
            const idx = sel.selectedIndex;
            _switchTo(idx);
        });

        container.appendChild(bar);
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

        let bar = container.querySelector('.rp-output-tabs');
        let sel = container.querySelector('.rp-output-selector');
        let panelWrap = container.querySelector('.rp-output-panels');

        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'rp-output-tabs';

            const lbl = document.createElement('label');
            lbl.className = 'rp-sr-only';
            lbl.setAttribute('for', 'rp-output-selector');
            lbl.textContent = 'Select output';
            bar.appendChild(lbl);

            sel = document.createElement('select');
            sel.className = 'rp-output-selector';
            sel.id = 'rp-output-selector';
            sel.setAttribute('aria-label', 'Select output to display');
            bar.appendChild(sel);

            panelWrap = document.createElement('div');
            panelWrap.className = 'rp-output-panels';
            container.appendChild(bar);
            container.appendChild(panelWrap);

            sel.addEventListener('change', () => {
                const panelId = sel.options[sel.selectedIndex].dataset.panel;
                panelWrap.querySelectorAll('.rp-output-panel').forEach(p => p.classList.remove('active'));
                const activePanel = document.getElementById(panelId);
                if (activePanel) {
                    activePanel.classList.add('active');
                    this._queueActiveOutputResize();
                }
            });
        }

        const isFirst = sel.options.length === 0;
        const label = labelText || id;
        const panelId = 'rp-panel-' + id;

        const opt = document.createElement('option');
        opt.value = label;
        opt.textContent = label;
        opt.dataset.panel = panelId;
        if (isFirst) opt.selected = true;
        sel.appendChild(opt);

        const panel = document.createElement('div');
        panel.className = 'rp-output-panel' + (isFirst ? ' active' : '');
        panel.id = panelId;
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', label);
        panel.appendChild(elem);
        panelWrap.appendChild(panel);
    },

    /** Append log text — creates or updates a "Log" tab during streaming. */
    _appendLog(text) {
        // Parse Rappture protocol lines before displaying
        for (const line of text.split('\n')) {
            const progMatch = line.match(/^=RAPPTURE-PROGRESS=>(\d+)\s*(.*)/);
            if (progMatch) {
                const pct = progMatch[1];
                const msg = progMatch[2].trim();
                this._setStatus(`${pct}%${msg ? ' — ' + msg : ''}`);
            }
            const errMatch = line.match(/^=RAPPTURE-ERROR=>(.*)/);
            if (errMatch) {
                this._setStatus('Error: ' + errMatch[1].trim(), 'error');
            }
        }

        const container = document.getElementById('rp-results');
        const placeholder = container.querySelector('.rp-results-placeholder');
        if (placeholder) placeholder.remove();

        let logBody = document.getElementById('rp-live-log-pre');
        if (!logBody) {
            // Build log output through the same selector + panel path as all outputs.
            this._renderSingleOutputTab('__log__', { type: 'log', label: 'Log', content: text }, 'Log');
            const logPanel = document.getElementById('rp-panel-__log__');
            logBody = logPanel ? logPanel.querySelector('.rp-output-body') : null;
            if (logBody) logBody.id = 'rp-live-log-pre';
            return;
        }

        if (logBody) {
            logBody.textContent += text;
            logBody.scrollTop = logBody.scrollHeight;
        }
    },

    // ── Output renderers (populated by _registerRenderer) ────────────────────
    // All renderers are registered via _registerRenderer in separate files.

    outputRenderers: {
        _placeholder(id, data) {
            // Never called — kept so outputRenderers is not empty during parse.
            void id; void data; return null;
        },

        // ── DEAD CODE REMOVED ─────────────────────────────────────────────────
        // Old monolithic field() renderer (lines 724-2516) was removed.
        // All field sub-renderers now live in rp-renderer-field*.js files
        // and register themselves via rappture._registerRenderer().
        //
        // The following comment preserves the original mkAxis local fn signature
        // so git blame can trace it back here if needed.
        // const _mkAxis = (ax) => { ... }
        // ─────────────────────────────────────────────────────────────────────

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
            const resp = await fetch(this._bp + '/api/runs');
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
            upBtn.setAttribute('aria-label', `Move ${run.label} up`);
            upBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><polygon points="8,3 14,13 2,13"/></svg>';
            upBtn.disabled = isTop;
            upBtn.addEventListener('click', () => this._moveRun(idx, -1));

            const downBtn = document.createElement('button');
            downBtn.className = 'rp-run-reorder-btn';
            downBtn.title = 'Move down';
            downBtn.setAttribute('aria-label', `Move ${run.label} down`);
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
            delBtn.setAttribute('aria-label', `Delete ${run.label}`);
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
                await fetch(`${this._bp}/api/runs/${run.run_id}`, {
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
            await fetch(this._bp + '/api/runs/reorder', {
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
        swatch.setAttribute('aria-label', `Set color for ${run.label}`);
        swatch.setAttribute('aria-haspopup', 'dialog');
        swatch.setAttribute('aria-expanded', 'false');

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
        hexInput.setAttribute('aria-label', `Custom color hex code for ${run.label}`);
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
            document.querySelectorAll('.rp-color-popup').forEach(p => {
                p.style.display = 'none';
                const parent = p.closest('.rp-color-wrap');
                const parentSwatch = parent && parent.querySelector('.rp-run-color');
                if (parentSwatch) parentSwatch.setAttribute('aria-expanded', 'false');
            });
            popup.style.display = isOpen ? 'none' : 'block';
            swatch.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        });

        popup.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                popup.style.display = 'none';
                swatch.setAttribute('aria-expanded', 'false');
                swatch.focus();
            }
        });
        document.addEventListener('click', () => {
            popup.style.display = 'none';
            swatch.setAttribute('aria-expanded', 'false');
        }, { capture: true, passive: true });

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
                    const resp = await fetch(`${this._bp}/api/runs/${run.run_id}`);
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
            await fetch(`${this._bp}/api/runs/${runId}`, { method: 'DELETE' });
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

            // Try registry compare first
            const regEntry = this._rendererRegistry[type];
            if (regEntry && typeof regEntry.compare === 'function') {
                const result = regEntry.compare.call(this, sources, id);
                if (result) { panels[id] = result; continue; }
            }

            // Fallback: single-run render for unregistered types
            const renderer = this.outputRenderers[type];
            if (renderer) {
                const elem = renderer.call(this, id, firstData);
                if (elem) panels[id] = { elem, label: (firstData.about && firstData.about.label) || firstData.label || id };
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
                    td.setAttribute('role', 'gridcell');
                    td.setAttribute('aria-label', `${name}, atomic number ${num}`);
                    if (!disabled) {
                        td.setAttribute('tabindex', '0');
                        td.addEventListener('click', () => this._peSelect(widget, el, returnvalue));
                        td.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                this._peSelect(widget, el, returnvalue);
                                tableWrap.style.display = 'none';
                                selectedRow.setAttribute('aria-expanded', 'false');
                                selectedRow.focus();
                            }
                        });
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

        const _peClose = () => {
            tableWrap.style.display = 'none';
            const arrow = widget.querySelector('.rp-pe-arrow');
            if (arrow) arrow.classList.remove('rp-pe-arrow-open');
            selectedRow.setAttribute('aria-expanded', 'false');
        };

        selectedRow.setAttribute('aria-expanded', 'false');
        selectedRow.addEventListener('click', (e) => {
            const isOpen = tableWrap.style.display !== 'none';
            // Close all other open tables first
            document.querySelectorAll('.rp-pe-table-wrap').forEach(w => { w.style.display = 'none'; });
            document.querySelectorAll('.rp-pe-arrow').forEach(a => { a.classList.remove('rp-pe-arrow-open'); });
            document.querySelectorAll('.rp-pe-selected-row').forEach(b => b.setAttribute('aria-expanded', 'false'));
            if (!isOpen) {
                tableWrap.style.display = '';
                widget.querySelector('.rp-pe-arrow').classList.add('rp-pe-arrow-open');
                selectedRow.setAttribute('aria-expanded', 'true');
                // Focus first enabled cell
                const firstCell = tableWrap.querySelector('.rp-pe-cell:not(.rp-pe-disabled):not(.rp-pe-empty)');
                if (firstCell) setTimeout(() => firstCell.focus(), 50);
            }
            e.stopPropagation();
        });

        // Close on Escape key
        tableWrap.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                _peClose();
                selectedRow.focus();
            }
        });

        // Close when clicking outside
        document.addEventListener('click', _peClose);

        // Close and update when an element is selected
        table.addEventListener('click', _peClose);
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

    _syncTabState(tabs, activeTab) {
        tabs.forEach(t => {
            const isActive = t === activeTab;
            t.setAttribute('aria-selected', isActive ? 'true' : 'false');
            t.setAttribute('tabindex', isActive ? '0' : '-1');
        });
    },

    _activateTabFromKeyboard(tablist, fromTab, direction) {
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
        if (!tabs.length) return;
        const currIdx = tabs.indexOf(fromTab);
        let idx = currIdx;
        if (direction === 'first') idx = 0;
        else if (direction === 'last') idx = tabs.length - 1;
        else idx = (currIdx + direction + tabs.length) % tabs.length;
        const nextTab = tabs[idx];
        if (!nextTab) return;
        nextTab.focus();
        nextTab.click();
    },

    initTabAccessibility() {
        document.querySelectorAll('[role="tablist"]').forEach(tablist => {
            const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
            if (!tabs.length) return;
            const selected = tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0];
            this._syncTabState(tabs, selected);

            tabs.forEach(tab => {
                tab.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        this._activateTabFromKeyboard(tablist, tab, 1);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        this._activateTabFromKeyboard(tablist, tab, -1);
                    } else if (e.key === 'Home') {
                        e.preventDefault();
                        this._activateTabFromKeyboard(tablist, tab, 'first');
                    } else if (e.key === 'End') {
                        e.preventDefault();
                        this._activateTabFromKeyboard(tablist, tab, 'last');
                    } else if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        tab.click();
                    }
                });
                tab.addEventListener('focus', () => {
                    tabs.forEach(t => t.setAttribute('tabindex', t === tab ? '0' : '-1'));
                });
            });
        });
    },

    switchPhase(path) {
        // Hide all panels, deactivate all tabs
        document.querySelectorAll('.rp-phase-panel').forEach(p => { p.hidden = true; });
        document.querySelectorAll('.rp-phase-tab').forEach(t => {
            t.classList.remove('rp-phase-tab-active');
            t.setAttribute('aria-selected', 'false');
            t.setAttribute('tabindex', '-1');
        });
        // Show selected panel and activate its tab
        const panelId = 'phase-panel-' + path.replace(/[.()\s]/g, '_');
        const panel = document.getElementById(panelId);
        if (panel) panel.hidden = false;
        const tab = document.querySelector(`.rp-phase-tab[data-phase="${path}"]`);
        if (tab) {
            tab.classList.add('rp-phase-tab-active');
            tab.setAttribute('aria-selected', 'true');
            tab.setAttribute('tabindex', '0');
        }
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
        const container = btn.closest('.rp-group-tabbed, .rp-phase');
        if (!container) return;
        const tabs = container.querySelectorAll('.rp-tab-btn');
        tabs.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
            b.setAttribute('tabindex', '-1');
        });
        container.querySelectorAll('.rp-tab-panel').forEach(p => {
            p.classList.remove('active');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');
        // panelId may contain raw path chars; normalize to match element id
        const safeId = panelId.replace(/\./g,'_').replace(/\(/g,'_').replace(/\)/g,'_').replace(/:/g,'_');
        const panel = document.getElementById(safeId);
        if (panel) {
            panel.classList.add('active');
        }
    },

    // ── Enable conditions ────────────────────────────────────────────────────

    initEnableConditions() {
        const widgets = document.querySelectorAll('[data-enable]');
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

    // Split expr on a top-level operator (not inside parentheses)
    _splitTopLevel(expr, op) {
        const parts = [];
        let depth = 0, start = 0;
        for (let i = 0; i < expr.length; i++) {
            if (expr[i] === '(') depth++;
            else if (expr[i] === ')') depth--;
            else if (depth === 0 && expr.startsWith(op, i)) {
                parts.push(expr.slice(start, i).trim());
                i += op.length - 1;
                start = i + 1;
            }
        }
        parts.push(expr.slice(start).trim());
        return parts.length > 1 ? parts : null;
    },

    evaluateEnable(expr) {
        expr = expr.trim();
        // Strip outer parentheses
        while (expr.startsWith('(') && expr.endsWith(')')) {
            let depth = 0, matched = true;
            for (let i = 0; i < expr.length - 1; i++) {
                if (expr[i] === '(') depth++;
                else if (expr[i] === ')') depth--;
                if (depth === 0) { matched = false; break; }
            }
            if (!matched) break;
            expr = expr.slice(1, -1).trim();
        }

        if (['yes', 'on', 'true', '1'].includes(expr)) return true;
        if (['no', 'off', 'false', '0'].includes(expr)) return false;

        // Handle || (OR) — split at top level and short-circuit
        const orParts = this._splitTopLevel(expr, '||');
        if (orParts) return orParts.some(p => this.evaluateEnable(p));

        // Handle && (AND) — split at top level and short-circuit
        const andParts = this._splitTopLevel(expr, '&&');
        if (andParts) return andParts.every(p => this.evaluateEnable(p));

        // Single comparison: path op value
        const compMatch = expr.match(/^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
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
        // Escape characters special in CSS attribute selectors
        const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        let widget = document.querySelector(`.rp-widget[data-path="${esc(cleanPath)}"]`)
            || document.querySelector(`.rp-widget[data-path="input.${esc(cleanPath)}"]`);
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

    _renderProgressStatus(percent, message = '') {
        const hasPct = Number.isFinite(percent);
        if (hasPct) {
            const pct = Math.max(0, Math.min(100, Math.round(percent)));
            this._setStatus(`${pct}%${message ? ' — ' + message : ''}`);
            return;
        }
        this._setStatus(message || 'Simulation running...');
    },
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    rappture.initEnableConditions();
    rappture.initColorInputs();
    rappture.initTabAccessibility();
    rappture.initLoaders();
    rappture._watchResultsResize();
    rappture.connectWebSocket();
    rappture._fetchRunHistory();
    document.querySelectorAll('.rp-periodicelement').forEach(w => rappture.initPeriodicElement(w));
});
