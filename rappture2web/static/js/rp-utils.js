/**
 * Rappture2Web shared utilities.
 * Provides reusable helpers for renderers: sidecar panels, Plotly init,
 * theme toggling, download buttons, axis helpers, and more.
 *
 * Loaded after rappture.js core — attaches to the global `rappture` object.
 */

// ── Global helpers (already defined in rappture.js, will be removed from there later) ──

if (typeof _whenVisible === 'undefined') {
    /**
     * Run `fn` once `el` has non-zero dimensions.
     * If already visible, runs immediately (inside requestAnimationFrame).
     * Otherwise waits for IntersectionObserver to fire when el becomes visible.
     */
    window._whenVisible = function(el, fn) {
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
    };
}

if (typeof _plotResizeObserver === 'undefined') {
    /**
     * Create a ResizeObserver that ignores the first N callbacks (Plotly init reflow)
     * then resizes plotDiv height to match el on subsequent changes.
     */
    window._plotResizeObserver = function(el, plotDiv, skip) {
        let _skip = skip || 1;
        return new ResizeObserver(() => {
            if (_skip > 0) { _skip--; return; }
            const nh = el.clientHeight;
            if (nh > 50) { plotDiv.style.height = nh + 'px'; Plotly.relayout(plotDiv, { height: nh }); }
        });
    };
}

// ── Built-in Plotly theme templates ──────────────────────────────────────────
// Plotly.js does not expose named templates as strings; we define them here.

window._rpPlotlyTemplates = {
    plotly: {
        layout: {
            colorway: ['#636efa','#EF553B','#00cc96','#ab63fa','#FFA15A','#19d3f3','#FF6692','#B6E880','#FF97FF','#FECB52'],
            paper_bgcolor: 'white',
            plot_bgcolor: '#E5ECF6',
            font: { color: '#2a3f5f' },
            xaxis: { gridcolor: 'white', linecolor: 'white', zerolinecolor: 'white', zerolinewidth: 2 },
            yaxis: { gridcolor: 'white', linecolor: 'white', zerolinecolor: 'white', zerolinewidth: 2 },
            scene: {
                xaxis: { backgroundcolor: '#E5ECF6', gridcolor: 'white', gridwidth: 2, linecolor: 'white', showbackground: true, zerolinecolor: 'white' },
                yaxis: { backgroundcolor: '#E5ECF6', gridcolor: 'white', gridwidth: 2, linecolor: 'white', showbackground: true, zerolinecolor: 'white' },
                zaxis: { backgroundcolor: '#E5ECF6', gridcolor: 'white', gridwidth: 2, linecolor: 'white', showbackground: true, zerolinecolor: 'white' },
            },
        },
    },
    plotly_white: {
        layout: {
            colorway: ['#636efa','#EF553B','#00cc96','#ab63fa','#FFA15A','#19d3f3','#FF6692','#B6E880','#FF97FF','#FECB52'],
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            font: { color: '#2a3f5f' },
            xaxis: { gridcolor: '#EBF0F8', linecolor: '#EBF0F8', zerolinecolor: '#EBF0F8' },
            yaxis: { gridcolor: '#EBF0F8', linecolor: '#EBF0F8', zerolinecolor: '#EBF0F8' },
            scene: {
                xaxis: { backgroundcolor: 'white', gridcolor: '#DFE8F3', linecolor: '#EBF0F8', showbackground: true, zerolinecolor: 'white' },
                yaxis: { backgroundcolor: 'white', gridcolor: '#DFE8F3', linecolor: '#EBF0F8', showbackground: true, zerolinecolor: 'white' },
                zaxis: { backgroundcolor: 'white', gridcolor: '#DFE8F3', linecolor: '#EBF0F8', showbackground: true, zerolinecolor: 'white' },
            },
        },
    },
    plotly_dark: {
        layout: {
            colorway: ['#636efa','#EF553B','#00cc96','#ab63fa','#FFA15A','#19d3f3','#FF6692','#B6E880','#FF97FF','#FECB52'],
            paper_bgcolor: '#111111',
            plot_bgcolor: '#111111',
            font: { color: '#f2f5fa' },
            xaxis: { gridcolor: '#283442', linecolor: '#506784', zerolinecolor: '#283442' },
            yaxis: { gridcolor: '#283442', linecolor: '#506784', zerolinecolor: '#283442' },
            scene: {
                xaxis: { backgroundcolor: '#111111', gridcolor: '#506784', linecolor: '#506784', showbackground: true, zerolinecolor: '#C8D4E3' },
                yaxis: { backgroundcolor: '#111111', gridcolor: '#506784', linecolor: '#506784', showbackground: true, zerolinecolor: '#C8D4E3' },
                zaxis: { backgroundcolor: '#111111', gridcolor: '#506784', linecolor: '#506784', showbackground: true, zerolinecolor: '#C8D4E3' },
            },
        },
    },
    simple_white: {
        layout: {
            colorway: ['#636efa','#EF553B','#00cc96','#ab63fa','#FFA15A','#19d3f3','#FF6692','#B6E880','#FF97FF','#FECB52'],
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            font: { color: 'black' },
            xaxis: { showgrid: false, linecolor: 'black', ticks: 'outside', mirror: true, showline: true },
            yaxis: { showgrid: false, linecolor: 'black', ticks: 'outside', mirror: true, showline: true },
        },
    },
    ggplot2: {
        layout: {
            colorway: ['#F8766D','#A3A500','#00BF7D','#00B0F6','#E76BF4'],
            paper_bgcolor: 'white',
            plot_bgcolor: '#EBEBEB',
            font: { color: '#2D2D2D' },
            xaxis: { gridcolor: 'white', linecolor: 'white', ticks: '' },
            yaxis: { gridcolor: 'white', linecolor: 'white', ticks: '' },
        },
    },
    seaborn: {
        layout: {
            colorway: ['#4C72B0','#DD8452','#55A868','#C44E52','#8172B3','#937860','#DA8BC3','#8C8C8C','#CCB974','#64B5CD'],
            paper_bgcolor: 'white',
            plot_bgcolor: '#EAEAF2',
            font: { color: '#2D3436' },
            xaxis: { gridcolor: 'white', linecolor: 'white' },
            yaxis: { gridcolor: 'white', linecolor: 'white' },
        },
    },
    none: { layout: {} },
};

// ── Namespaced utilities ─────────────────────────────────────────────────────

rappture._rpUtils = {

    /** Standard inline style for panel text/number inputs. */
    inputStyle: 'width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:2px 4px;font-size:12px',

    /** Standard colorscale <option> HTML for select elements. */
    colorscaleOptionsHtml: [
        'Viridis', 'Plasma', 'Inferno', 'Magma', 'Cividis',
        'RdBu', 'Spectral', 'Jet', 'Hot', 'Blues',
        'Greys', 'YlOrRd', 'Bluered',
    ].map(c => `<option${c === 'Viridis' ? ' selected' : ''}>${c}</option>`).join(''),

    /** SVG icon constants for sequence player controls. */
    icons: {
        reset:  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="2" width="2" height="12"/><polygon points="4,8 14,2 14,14"/></svg>',
        prev:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="9,2 1,8 9,14"/><polygon points="15,2 7,8 15,14"/></svg>',
        next:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="7,2 15,8 7,14"/><polygon points="1,2 9,8 1,14"/></svg>',
        play:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><polygon points="3,2 13,8 3,14"/></svg>',
        pause:  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>',
    },

    /**
     * Build axis coordinate array from mesh axis definition.
     * @param {Object} ax - {coords?, numpoints?, min?, max?}
     * @returns {number[]}
     */
    mkAxis(ax) {
        if (!ax) return [0];
        if (ax.coords && ax.coords.length) return ax.coords;
        const n = Math.max(ax.numpoints || 1, 1);
        const lo = ax.min !== undefined ? ax.min : 0;
        const hi = ax.max !== undefined ? ax.max : 1;
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(lo + (hi - lo) * i / Math.max(n - 1, 1));
        return pts;
    },

    /**
     * Build axis title string from label + units input elements.
     * @param {HTMLInputElement} labelEl
     * @param {HTMLInputElement} unitsEl
     * @returns {string}
     */
    axTitle(labelEl, unitsEl) {
        const l = labelEl.value.trim(), u = unitsEl.value.trim();
        return l + (u ? ` [${u}]` : '');
    },

    /**
     * Create a collapsible sidecar panel wrapper around a plot/canvas div.
     * Returns the assembled DOM structure ready to append to a body element.
     *
     * @param {HTMLElement} plotDiv - The plot/canvas container (left side)
     * @param {string} panelInnerHtml - HTML content for the rp-3d-panel
     * @param {Object} [opts] - Options
     * @param {string} [opts.maxHeight] - CSS max-height for panel ('none' for no limit)
     * @param {string} [opts.wrapCss] - Override CSS for the outer wrapper
     * @param {boolean} [opts.noPlotlyResize] - Skip Plotly.relayout on toggle (for Three.js)
     * @returns {{outerWrap: HTMLElement, panelWrap: HTMLElement, cp: HTMLElement, sideTab: HTMLElement}}
     */
    createSidecar(plotDiv, panelInnerHtml, opts) {
        opts = opts || {};
        const cp = document.createElement('div');
        cp.className = 'rp-3d-panel';
        if (opts.maxHeight !== undefined) cp.style.maxHeight = opts.maxHeight;
        cp.innerHTML = panelInnerHtml;

        const panelWrap = document.createElement('div');
        panelWrap.className = 'rp-3d-panel-wrap';

        const sideTab = document.createElement('div');
        sideTab.className = 'rp-3d-panel-tab';
        sideTab.title = 'Toggle control panel';
        sideTab.innerHTML = '<span class="rp-tab-chevron">&#8250;</span>';

        panelWrap.appendChild(sideTab);
        panelWrap.appendChild(cp);

        const outerWrap = document.createElement('div');
        outerWrap.style.cssText = opts.wrapCss || 'display:flex;flex:1;min-width:0;min-height:0;align-items:stretch;';
        outerWrap.appendChild(plotDiv);
        outerWrap.appendChild(panelWrap);

        sideTab.addEventListener('click', () => {
            panelWrap.classList.toggle('collapsed');
            if (!opts.noPlotlyResize && window.Plotly) {
                setTimeout(() => Plotly.relayout(plotDiv, { autosize: true }), 220);
            }
        });

        return { outerWrap, panelWrap, cp, sideTab };
    },

    /**
     * Apply dark or light theme to a 2D Plotly chart.
     * @param {HTMLElement} plotDiv
     * @param {boolean} isDark
     */
    applyPlotlyTheme(plotDiv, isDark) {
        Plotly.relayout(plotDiv, { template: isDark ? 'plotly_dark' : 'plotly_white' });
    },

    /**
     * Apply dark or light theme to a 3D Plotly scene chart.
     * @param {HTMLElement} plotDiv
     * @param {boolean} isDark
     */
    applyPlotly3dTheme(plotDiv, isDark) {
        Plotly.relayout(plotDiv, { template: isDark ? 'plotly_dark' : 'plotly_white' });
    },

    /**
     * Wire SVG, EPS, and PNG download buttons for a Plotly chart.
     * Expects buttons with IDs: `${prefix}-dl-svg-${sid}`, `${prefix}-dl-eps-${sid}`, `${prefix}-dl-png-${sid}`.
     * Missing buttons are silently skipped.
     *
     * @param {HTMLElement} cp - Control panel element containing the buttons
     * @param {HTMLElement} plotDiv - Plotly chart div
     * @param {string} fileLabel - Base filename for downloads (sanitized)
     * @param {string} prefix - ID prefix (e.g. 'plt', 'ht', 'fld2')
     * @param {string} sid - Sanitized ID suffix
     */
    wireDownloadButtons(cp, plotDiv, fileLabel, prefix, sid) {
        const svgBtn = cp.querySelector(`#${prefix}-dl-svg-${sid}`) || cp.querySelector(`#${prefix}-svg-${sid}`);
        const epsBtn = cp.querySelector(`#${prefix}-dl-eps-${sid}`);
        const pngBtn = cp.querySelector(`#${prefix}-dl-png-${sid}`) || cp.querySelector(`#${prefix}-png-${sid}`);

        if (svgBtn) svgBtn.addEventListener('click', () =>
            rappture._downloadPlot(plotDiv, fileLabel, 'svg'));
        if (epsBtn) epsBtn.addEventListener('click', () =>
            rappture._downloadPlot(plotDiv, fileLabel, 'eps'));
        if (pngBtn) pngBtn.addEventListener('click', () =>
            rappture._downloadPlot(plotDiv, fileLabel, 'png'));
    },

    /**
     * Wire a JSON data download button.
     * Expects a button with ID `${prefix}-dl-json-${sid}`.
     * @param {HTMLElement} cp - Control panel element
     * @param {Object} data - The raw data object for this output item
     * @param {string} fileLabel - Base filename for download
     * @param {string} prefix - ID prefix
     * @param {string} sid - Sanitized ID suffix
     */
    wireDownloadData(cp, data, fileLabel, prefix, sid) {
        const btn = cp.querySelector(`#${prefix}-dl-json-${sid}`);
        if (!btn) return;
        btn.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (fileLabel || 'data') + '.json';
            a.click();
            URL.revokeObjectURL(url);
        });
    },

    /**
     * Initialize a Plotly chart when its container becomes visible.
     * Handles the common _whenVisible + newPlot + resize pattern.
     *
     * @param {HTMLElement} container - Element to watch for visibility
     * @param {HTMLElement} plotDiv - Plotly chart div
     * @param {Array} traces - Plotly traces
     * @param {Object} layout - Plotly layout
     * @param {Function} [afterPlotFn] - Called after Plotly.newPlot resolves and resizes
     */
    initPlotly(container, plotDiv, traces, layout, afterPlotFn) {
        _whenVisible(container, () => {
            this.storeBaseLayout(plotDiv, layout);
            Plotly.newPlot(plotDiv, traces, layout, { responsive: true })
                .then(() => {
                    requestAnimationFrame(() => Plotly.Plots.resize(plotDiv));
                    if (afterPlotFn) afterPlotFn();
                });
        });
    },

    /**
     * Generate a standard theme section for a Plotly panel.
     * @param {string} prefix - ID prefix
     * @param {string} sid - Sanitized ID suffix
     * @returns {string} HTML string
     */
    themeSectionHtml(prefix, sid) {
        return this.displaySectionHtml(prefix, sid);
    },

    /**
     * Generate a Display section with theme, font size, and margin controls.
     * @param {string} prefix - ID prefix
     * @param {string} sid - Sanitized ID suffix
     * @param {Object} [defaults] - Default values: {mt, mb, ml, mr, fs}
     * @returns {string} HTML string
     */
    displaySectionHtml(prefix, sid, defaults) {
        const d = Object.assign({ mt: 36, mb: 60, ml: 70, mr: 16, fs: 12 }, defaults);
        const iS = this.inputStyle;
        const iSn = iS + ';width:100%';
        return `
            <div class="rp-panel-section">
                <div class="rp-panel-title">Display</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;align-items:end">
                    <label style="grid-column:1/3">Theme
                        <select id="${prefix}-theme-${sid}" style="${iS}">
                            <option value="plotly" selected>Default</option>
                            <option value="plotly_white">White</option>
                            <option value="plotly_dark">Dark</option>
                            <option value="ggplot2">ggplot2</option>
                            <option value="seaborn">Seaborn</option>
                            <option value="simple_white">Simple White</option>
                        </select>
                    </label>
                    <label>Font<input type="number" id="${prefix}-fontsize-${sid}" value="${d.fs}" min="6" max="32" step="1" style="${iSn}"></label>
                    <label></label>
                    <label>Margin T<input type="number" id="${prefix}-mt-${sid}" value="${d.mt}" min="0" max="200" step="1" style="${iSn}"></label>
                    <label>Margin B<input type="number" id="${prefix}-mb-${sid}" value="${d.mb}" min="0" max="200" step="1" style="${iSn}"></label>
                    <label>Margin L<input type="number" id="${prefix}-ml-${sid}" value="${d.ml}" min="0" max="200" step="1" style="${iSn}"></label>
                    <label>Margin R<input type="number" id="${prefix}-mr-${sid}" value="${d.mr}" min="0" max="200" step="1" style="${iSn}"></label>
                </div>
            </div>`;
    },

    /**
     * Generate a standard download section for a Plotly panel.
     * @param {string} prefix - ID prefix
     * @param {string} sid - Sanitized ID suffix
     * @param {string[]} [formats] - Formats to include (default: ['svg','eps','png'])
     * @returns {string} HTML string
     */
    downloadSectionHtml(prefix, sid, formats) {
        formats = formats || ['svg', 'eps', 'png', 'json'];
        const btns = formats.map(f =>
            `<button class="rp-3d-btn" id="${prefix}-dl-${f}-${sid}">${f.toUpperCase()}</button>`
        ).join('');
        return `
            <div class="rp-panel-section">
                <div class="rp-panel-title">Download</div>
                <div class="rp-panel-btns">${btns}</div>
            </div>`;
    },

    /**
     * Wire a theme select to a 2D Plotly chart.
     * @param {HTMLElement} cp - Control panel
     * @param {HTMLElement} plotDiv - Plotly chart div
     * @param {string} prefix - ID prefix
     * @param {string} sid - Sanitized ID suffix
     */
    wireThemeToggle(cp, plotDiv, prefix, sid) {
        this.wireDisplayControls(cp, plotDiv, prefix, sid, false);
    },

    /**
     * Wire a theme select to a 3D Plotly scene chart.
     * @param {HTMLElement} cp - Control panel
     * @param {HTMLElement} plotDiv - Plotly chart div
     * @param {string} prefix - ID prefix
     * @param {string} sid - Sanitized ID suffix
     */
    wireThemeToggle3d(cp, plotDiv, prefix, sid) {
        this.wireDisplayControls(cp, plotDiv, prefix, sid, true);
    },

    /**
     * Store the structural layout (no template-expanded colors) for later use by wireDisplayControls.
     * Call this right after Plotly.newPlot with the same layout object you passed in.
     * @param {HTMLElement} plotDiv
     * @param {Object} layout - The original layout object (before Plotly processes it)
     */
    storeBaseLayout(plotDiv, layout) {
        // Strip template/color keys that Plotly expands; keep only structural props
        const skip = new Set(['template', 'paper_bgcolor', 'plot_bgcolor', 'font',
            'colorway', 'colorscale', 'hoverlabel', 'modebar']);
        const base = {};
        for (const k of Object.keys(layout)) {
            if (!skip.has(k)) base[k] = layout[k];
        }
        plotDiv._rpBaseLayout = base;
    },

    /**
     * Wire theme, font size, and margin controls from the Display section.
     * @param {HTMLElement} cp - Control panel
     * @param {HTMLElement} plotDiv - Plotly chart div
     * @param {string} prefix - ID prefix
     * @param {string} sid - Sanitized ID suffix
     * @param {boolean} is3d - true for 3D scene charts
     */
    wireDisplayControls(cp, plotDiv, prefix, sid, is3d) {
        const $ = id => cp.querySelector(`#${id}`);
        const themeEl    = $(`${prefix}-theme-${sid}`);
        const fontsizeEl = $(`${prefix}-fontsize-${sid}`);
        const mtEl = $(`${prefix}-mt-${sid}`);
        const mbEl = $(`${prefix}-mb-${sid}`);
        const mlEl = $(`${prefix}-ml-${sid}`);
        const mrEl = $(`${prefix}-mr-${sid}`);

        const apply = () => {
            const themeName = themeEl ? themeEl.value : 'plotly';
            const fs    = fontsizeEl ? parseFloat(fontsizeEl.value) || 12 : 12;
            const mt    = mtEl ? parseInt(mtEl.value) : undefined;
            const mb    = mbEl ? parseInt(mbEl.value) : undefined;
            const ml    = mlEl ? parseInt(mlEl.value) : undefined;
            const mr    = mrEl ? parseInt(mrEl.value) : undefined;

            if (!plotDiv._fullLayout) return;
            // Resolve named template to object — Plotly.js requires a template object, not a string
            const template = _rpPlotlyTemplates[themeName] || {};
            // Use the stored structural layout to avoid inheriting expanded colors from old template
            const base = plotDiv._rpBaseLayout || {};
            const updatedLayout = Object.assign({}, base, {
                template,
                font: { size: fs },
            });
            if (mt !== undefined) updatedLayout.margin = { t: mt, b: mb, l: ml, r: mr };
            Plotly.react(plotDiv, plotDiv.data, updatedLayout);
        };

        [themeEl, fontsizeEl, mtEl, mbEl, mlEl, mrEl].forEach(el => {
            if (el) el.addEventListener('change', apply);
            if (el && (el.type === 'number' || el.type === 'range')) el.addEventListener('input', apply);
        });
    },

    /**
     * Save/load panel state to localStorage.
     * @param {string} storageKey - localStorage key
     * @param {HTMLElement} cp - Control panel
     * @param {string} sid - Sanitized ID suffix
     * @param {string[]} valueFields - Field IDs to save as .value
     * @param {string[]} checkboxFields - Field IDs to save as .checked
     * @returns {{ save: Function, load: Function }}
     */
    panelState(storageKey, cp, sid, valueFields, checkboxFields) {
        return {
            save() {
                const s = {};
                (valueFields || []).forEach(k => {
                    const el = cp.querySelector(`#${k}-${sid}`);
                    if (el) s[k] = el.value;
                });
                (checkboxFields || []).forEach(k => {
                    const el = cp.querySelector(`#${k}-${sid}`);
                    if (el) s[k] = el.checked;
                });
                try { localStorage.setItem(storageKey, JSON.stringify(s)); } catch (e) {}
            },
            load() {
                try {
                    const s = JSON.parse(localStorage.getItem(storageKey) || 'null');
                    if (!s) return;
                    (valueFields || []).forEach(k => {
                        const el = cp.querySelector(`#${k}-${sid}`);
                        if (el && s[k] !== undefined) el.value = s[k];
                    });
                    (checkboxFields || []).forEach(k => {
                        const el = cp.querySelector(`#${k}-${sid}`);
                        if (el && s[k] !== undefined) el.checked = s[k];
                    });
                } catch (e) {}
            },
        };
    },
};
