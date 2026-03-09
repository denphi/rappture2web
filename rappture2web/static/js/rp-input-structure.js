/**
 * Render input <structure> previews and dynamic parameters.
 */
(function () {
    const NS = "http://www.w3.org/2000/svg";

    function mk(tag, attrs) {
        const el = document.createElementNS(NS, tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v !== undefined && v !== null) el.setAttribute(k, String(v));
        });
        return el;
    }

    function mkHtml(tag, attrs) {
        const el = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === 'class' || k === 'className') el.className = v;
            else if (v !== undefined && v !== null) el.setAttribute(k, String(v));
        });
        return el;
    }

    function num(v, dflt) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : dflt;
    }

    function renderStructurePreview(rootEl, data, requestedActiveLabel) {
        // Build param-id → box info map from fields + components so we can show box cues on inputs
        const paramBoxInfo = {};
        const namedColorsFull = { green: "#00cc44", white: "#ffffff", red: "#dd2222", purple: "#9966cc", blue: "#3366cc", yellow: "#ffdd44", orange: "#ff8822", gray: "#aaaaaa", black: "#222222" };
        const matColors = { GaAs: "#ccaaff", AlGaAs: "#ffffff", AlAs: "#aaddff", InAs: "#ffaaaa", InP: "#aaffaa", Si: "#dddddd", Ge: "#ffddaa", SiGe: "#ddffdd" };
        const compsArr = (data && data.components) || [];
        const fieldsArr = (data && data.fields) || [];
        const boxByIdx = {};
        compsArr.forEach((c, i) => { if (c.type === 'box') boxByIdx[`box${i}`] = c; });
        fieldsArr.forEach(f => {
            if (!f.constant || !f.domain) return;
            const box = boxByIdx[f.domain];
            if (!box) return;
            const color = namedColorsFull[box.color] || box.color || matColors[box.material] || "#aaaadd";
            const boxLabel = box.label || f.domain;
            if (!paramBoxInfo[f.constant]) paramBoxInfo[f.constant] = { color, label: boxLabel };
        });

        // Render Parameters — use the same HTML structure as number.html / string.html templates
        const paramsWrap = rootEl.querySelector(".rp-structure-parameters");
        if (paramsWrap) {
            if (data && data.parameters && data.parameters.length > 0) {
                paramsWrap.innerHTML = "";
                data.parameters.forEach((p, pIdx) => {
                    const idStr = p.id ? `(${p.id})` : '';
                    const rawPath = data.xmlPath ? `${data.xmlPath}.${p.tag}${idStr}` : '';
                    const inputId = 'inp-' + rawPath.replace(/[.()\:]/g, '_');
                    const val = (p.current !== null && p.current !== undefined) ? p.current : (p.default || "");
                    // Extract leading numeric portion (handles "1e-10s", "10nm", "2e15/cm3")
                    const numVal = (val.match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/) || [''])[0];

                    // Determine input type — always use text to preserve scientific notation display
                    const isNumeric = (p.tag === 'number' || p.tag === 'integer');
                    const isChoice = p.tag === 'choice';
                    const typeClass = isNumeric ? `rp-${p.tag}` : (isChoice ? 'rp-choice' : `rp-string`);
                    const inputClass = isNumeric ? 'rp-input rp-input-number' : 'rp-input';
                    const inputType = 'text';

                    const widgetDiv = mkHtml("div", { class: `rp-widget ${typeClass}`, "data-type": p.tag, "data-path": rawPath, "data-units": p.units || '' });

                    const isInteger = p.tag === 'integer';
                    const minVal = p.min ? (p.min.match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/) || [''])[0] : undefined;
                    const maxVal = p.max ? (p.max.match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/) || [''])[0] : undefined;

                    // Label — matches <label class="rp-label" for="...">Label [units]</label>
                    if (p.label || p.id) {
                        const ttData = { desc: p.description || '', units: p.units || '', min: minVal || '', max: maxVal || '' };
                        const lbl = mkHtml("label", {
                            class: "rp-label",
                            for: inputId,
                            "data-rp-tooltip": JSON.stringify(ttData),
                            title: p.description || ''
                        });
                        lbl.textContent = p.label || p.id;
                        if (p.units) {
                            const un = mkHtml("span", { class: "rp-units", "aria-label": `units: ${p.units}` });
                            un.textContent = `[${p.units}]`;
                            lbl.appendChild(document.createTextNode(' '));
                            lbl.appendChild(un);
                        }
                        // Box cue badge: colored dot + box name for params shared across boxes
                        const boxInfo = p.id && paramBoxInfo[p.id];
                        if (boxInfo) {
                            const badge = mkHtml("span", { style: `display:inline-flex;align-items:center;gap:3px;margin-left:6px;font-size:0.78em;color:#555;font-weight:normal;vertical-align:middle;` });
                            const dot = mkHtml("span", { style: `display:inline-block;width:9px;height:9px;border-radius:50%;background:${boxInfo.color};border:1px solid #888;flex-shrink:0;` });
                            badge.appendChild(dot);
                            badge.appendChild(document.createTextNode(boxInfo.label));
                            lbl.appendChild(badge);
                        }
                        widgetDiv.appendChild(lbl);
                    }

                    // Controls wrapper — matches <div class="rp-number-controls">
                    const controls = mkHtml("div", { class: isNumeric ? "rp-number-controls" : "" });

                    const toSci = v => {
                        if (!isNumeric || isInteger) return String(v);
                        const abs = Math.abs(v);
                        if (abs === 0) return '0';
                        if (abs >= 0.01 && abs < 1e4) return String(parseFloat(v.toPrecision(6)));
                        return v.toExponential(3).replace(/\.?0+e/, 'e');
                    };

                    let inputEl;
                    if (isChoice && p.options && p.options.length > 0) {
                        inputEl = mkHtml("select", { id: inputId, class: inputClass, name: rawPath });
                        p.options.forEach(opt => {
                            const o = mkHtml("option", { value: opt.value });
                            o.textContent = opt.label || opt.value;
                            if (opt.value === val || opt.label === val) o.selected = true;
                            inputEl.appendChild(o);
                        });
                        // If nothing matched, select by default
                        if (!inputEl.value && p.options.length > 0) inputEl.options[0].selected = true;
                    } else {
                        const displayVal = isNumeric && numVal !== '' ? toSci(parseFloat(numVal)) : (isNumeric ? numVal : val);
                        inputEl = mkHtml("input", {
                            type: inputType,
                            id: inputId,
                            class: inputClass,
                            name: rawPath,
                            value: displayVal
                        });
                    }

                    // On change: update data.parameters and re-render the preview
                    inputEl.addEventListener('change', () => {
                        let newVal = inputEl.value;
                        if (isNumeric) {
                            let rawNum = (newVal.match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/) || [''])[0];
                            if (rawNum !== '') {
                                let v = isInteger ? Math.round(parseFloat(rawNum)) : parseFloat(rawNum);
                                if (!isNaN(v)) {
                                    if (minVal !== undefined && minVal !== '' && v < parseFloat(minVal)) v = parseFloat(minVal);
                                    if (maxVal !== undefined && maxVal !== '' && v > parseFloat(maxVal)) v = parseFloat(maxVal);
                                    rawNum = isInteger ? String(v) : toSci(v);
                                    inputEl.value = rawNum;
                                }
                            }
                            newVal = rawNum + (p.units ? p.units : '');
                        }
                        data.parameters[pIdx].current = newVal;
                        try {
                            rootEl.setAttribute('data-structure', JSON.stringify(data));
                            // Preserve the active tab across re-render
                            const activeLabel = rootEl.dataset.activeField || '';
                            renderStructurePreview(rootEl, data, activeLabel);
                        } catch (e) { console.warn('Structure re-render failed', e); }
                    });

                    controls.appendChild(inputEl);
                    widgetDiv.appendChild(controls);
                    paramsWrap.appendChild(widgetDiv);
                });
            } else {
                paramsWrap.innerHTML = "";
            }
        }

        const host = rootEl.querySelector(".rp-drawing-preview");
        if (!host) return;
        host.innerHTML = "";
        // Always clear old legend — even if we return early (e.g. icon-only layout)
        const _oldLegend = rootEl.querySelector(".rp-structure-legend");
        if (_oldLegend) _oldLegend.remove();

        const comps = (data && data.components) || [];
        if (!comps.length) {
            host.style.display = "none";
            return;
        }
        host.style.display = "";
        host.style.color = "";

        let minX = Infinity, maxX = -Infinity;
        let containsBox = false;

        comps.forEach((c) => {
            if (c.type === "box") {
                containsBox = true;
                const a = num(c.corner0, 0);
                const b = num(c.corner1, 0);
                minX = Math.min(minX, a, b);
                maxX = Math.max(maxX, a, b);
            }
        });

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
            minX = 0;
            maxX = 1;
        }

        const padX = containsBox ? (maxX - minX) * 0.18 : 0;
        const x0 = minX - padX;
        const w = (maxX - minX) + 2 * padX;
        const svgHeight = w * 0.2;

        // Check if this is an icon-only layout (all boxes have icons, no colored boxes)
        const iconBoxes = comps.filter(c => c.type === 'box' && c.icon);
        const allIcons = iconBoxes.length > 0 && iconBoxes.length === comps.filter(c => c.type === 'box').length;

        if (allIcons) {
            // Render icons directly as <img> elements — they fill the full preview
            host.style.display = 'flex';
            host.style.flexDirection = 'row';
            host.style.gap = '4px';
            host.style.alignItems = 'stretch';
            host.style.background = 'transparent';
            host.style.border = '1px solid #cbd5e1';
            host.style.borderRadius = '4px';
            host.style.overflow = 'hidden';
            iconBoxes.forEach(c => {
                let src = c.icon.trim();
                if (!src.startsWith('http') && !src.startsWith('data:')) {
                    src = 'data:image/gif;base64,' + src.replace(/\s+/g, '');
                }
                const img = mkHtml('img', {
                    src,
                    alt: c.label || 'structure',
                    style: 'max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;'
                });
                host.appendChild(img);
            });
            return;
        }

        // ── Pre-compute fields before SVG creation ──────────────────────────────
        const fields = (data && data.fields) || [];
        const boxByName = {};
        comps.forEach((c, idx) => { if (c.type === 'box') boxByName[`box${idx}`] = c; });
        // parseFloat directly handles scientific notation like "2e15/cm3" correctly
        const paramVal = {};
        (data.parameters || []).forEach(p => {
            if (!p.id) return;
            const raw = (p.current !== null && p.current !== undefined) ? p.current : (p.default || '');
            const v = parseFloat(raw);
            if (!isNaN(v)) paramVal[p.id] = v;
        });
        // Fallback: read values from already-rendered DOM inputs (server-rendered case).
        // Input name is like "input.structure(sid).number(Na)" → id = "Na"
        const paramsDiv = rootEl.querySelector('.rp-structure-parameters');
        if (paramsDiv) {
            paramsDiv.querySelectorAll('input[name]').forEach(inp => {
                const m = inp.name.match(/\(([^)]+)\)$/);
                if (m) {
                    const id = m[1];
                    const v = parseFloat(inp.value);
                    if (!isNaN(v) && paramVal[id] === undefined) paramVal[id] = v;
                }
            });
        }
        const fieldGroups = {};
        fields.forEach(f => {
            const k = f.label || 'Field';
            if (!fieldGroups[k]) fieldGroups[k] = [];
            fieldGroups[k].push(f);
        });
        // Reverse so last field in XML appears as the first (active) tab
        const groupKeys = Object.keys(fieldGroups).reverse();
        const chartSvgH = fields.length > 0 ? svgHeight * 2.2 : 0;
        const totalSvgH = svgHeight + chartSvgH;

        // When fields are present extend the host to show the chart area
        if (fields.length > 0) {
            host.style.height = 'auto';
            host.style.minHeight = '';
        }
        // Add vertical padding so top/bottom labels aren't clipped
        const padY = svgHeight * 0.12;
        const svg = mk("svg", {
            viewBox: `${x0} ${-padY} ${w} ${totalSvgH + 2 * padY}`,
            width: "100%",
            preserveAspectRatio: "xMidYMid meet"
        });

        // Fill background
        svg.appendChild(mk("rect", { x: x0, y: 0, width: w, height: svgHeight, fill: "transparent" }));

        // Render components
        comps.forEach((c) => {
            if (c.type === "box") {
                const a = num(c.corner0, 0);
                const b = num(c.corner1, 0);
                const x = Math.min(a, b);
                const ww = Math.abs(b - a);

                // Named color map + material-based fallback palette (matches classic Rappture)
                const colorMap = {
                    "green": "#00cc44", "white": "#ffffff", "red": "#dd2222",
                    "purple": "#9966cc", "blue": "#3366cc", "yellow": "#ffdd44",
                    "orange": "#ff8822", "gray": "#aaaaaa", "black": "#222222"
                };
                // Material → color (classic Rappture palette)
                const materialColorMap = {
                    "GaAs": "#ccaaff", "AlGaAs": "#ffffff", "AlAs": "#aaddff",
                    "InAs": "#ffaaaa", "InP": "#aaffaa", "Si": "#dddddd",
                    "Ge": "#ffddaa", "SiGe": "#ddffdd"
                };
                const color = colorMap[c.color] || c.color ||
                    materialColorMap[c.material] || "#aaaadd";

                if (c.icon) {
                    const img = mk("image", {
                        x, y: svgHeight * 0.1, width: ww, height: svgHeight * 0.8,
                        preserveAspectRatio: "xMidYMid slice"
                    });
                    let href = c.icon.trim();
                    if (!href.startsWith("http") && !href.startsWith("data:")) {
                        href = "data:image/gif;base64," + href;
                    }
                    img.setAttributeNS("http://www.w3.org/1999/xlink", "href", href);
                    svg.appendChild(img);
                } else {
                    const blockY = svgHeight * 0.4;
                    const blockH = svgHeight * 0.3;
                    const slantX = w * 0.04;
                    const slantY = -svgHeight * 0.15;
                    const sw = w * 0.003;

                    // Front face
                    svg.appendChild(mk("rect", { x, y: blockY, width: ww, height: blockH, fill: color, stroke: "#000", "stroke-width": sw }));
                    // Top face
                    const pts = `${x},${blockY} ${x + ww},${blockY} ${x + ww + slantX},${blockY + slantY} ${x + slantX},${blockY + slantY}`;
                    svg.appendChild(mk("polygon", { points: pts, fill: color, stroke: "#000", "stroke-width": sw }));
                    // Right side face (last box)
                    if (x + ww >= maxX - 0.001) {
                        const sp = `${x + ww},${blockY} ${x + ww + slantX},${blockY + slantY} ${x + ww + slantX},${blockY + blockH + slantY} ${x + ww},${blockY + blockH}`;
                        svg.appendChild(mk("polygon", { points: sp, fill: color, stroke: "#000", "stroke-width": sw }));
                    }
                }

                // Box label above the shape
                if (c.label) {
                    const t = mk("text", {
                        x: x + ww / 2, y: svgHeight * 0.2, fill: "#000",
                        "font-size": w * 0.022, "text-anchor": "middle", "font-family": "sans-serif"
                    });
                    t.textContent = c.label;
                    svg.appendChild(t);
                }
            } else if (c.type === "molecule") {
                const cx = x0 + w / 2;
                const t = mk("text", {
                    x: cx, y: svgHeight / 2, fill: "#0f172a", "font-size": w * 0.08,
                    "text-anchor": "middle", "dominant-baseline": "middle"
                });
                t.textContent = c.formula || c.label || "Molecule";
                svg.appendChild(t);
            }
        });

        host.appendChild(svg);

        // ── Legend: unique colored swatches below the preview ─────────────────
        // Remove old legend from previous render
        const oldLegend = rootEl.querySelector(".rp-structure-legend");
        if (oldLegend) oldLegend.remove();

        const seen = new Set();
        const legendItems = comps.filter(c => {
            if (c.type !== 'box' || c.icon) return false;
            const key = (c.material || c.label || '').trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        if (legendItems.length) {
            const legend = mkHtml("div", { class: "rp-structure-legend", style: "display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:4px;" });
            const colorMap2 = {
                "green": "#00cc44", "white": "#ffffff", "red": "#dd2222",
                "purple": "#9966cc", "blue": "#3366cc", "yellow": "#ffdd44",
                "orange": "#ff8822", "gray": "#aaaaaa", "black": "#222222"
            };
            const matColorMap2 = {
                "GaAs": "#ccaaff", "AlGaAs": "#ffffff", "AlAs": "#aaddff",
                "InAs": "#ffaaaa", "InP": "#aaffaa", "Si": "#dddddd",
                "Ge": "#ffddaa", "SiGe": "#ddffdd"
            };
            legendItems.forEach(c => {
                const fc = colorMap2[c.color] || c.color || matColorMap2[c.material] || "#aaaadd";
                const item = mkHtml("span", { style: "display:flex;align-items:center;gap:4px;font-size:12px;" });
                const swatch = mkHtml("span", { style: `display:inline-block;width:12px;height:12px;border:1px solid #888;background:${fc};flex-shrink:0;` });
                item.appendChild(swatch);
                const txt = document.createTextNode(c.material || c.label);
                item.appendChild(txt);
                legend.appendChild(item);
            });
            host.after(legend);
        }

        // ── In-SVG positional fields chart ──────────────────────────────────────
        if (fields.length > 0 && groupKeys.length > 0) {
            const namedColors = { green: "#00cc44", white: "#ccc", red: "#dd2222", purple: "#9966cc", blue: "#3366cc", black: "#000" };
            const cPadT = svgHeight * 0.1;
            const cPadB = svgHeight * 0.15;
            // Chart plot area spans minX→maxX; Y-axis labels use the existing padX strip
            const chartTop = svgHeight + cPadT;
            const chartBottom = totalSvgH - cPadB;
            const chartH_svg = chartBottom - chartTop;
            const chartPlotW = maxX - minX;

            svg.appendChild(mk("rect", { x: minX, y: chartTop, width: chartPlotW, height: chartH_svg, fill: "#fff", stroke: "#ccc", "stroke-width": w * 0.002 }));

            comps.forEach(c => {
                if (c.type !== 'box') return;
                const bx = num(c.corner0, minX);
                if (bx > minX) {
                    svg.appendChild(mk("line", { x1: bx, y1: chartTop, x2: bx, y2: chartBottom, stroke: "#ccc", "stroke-width": w * 0.002, "stroke-dasharray": `${w * 0.01},${w * 0.01}` }));
                }
            });

            // Compute initial active index before building chart groups so SVG display is correct
            const initialIdx = (requestedActiveLabel && groupKeys.includes(requestedActiveLabel))
                ? groupKeys.indexOf(requestedActiveLabel)
                : 0;

            const chartGroups = [];
            groupKeys.forEach((label, gi) => {
                const flds = fieldGroups[label];
                const isLog = flds.some(f => (f.scale || '').toLowerCase() === 'log');
                const units = flds[0] ? flds[0].units || '' : '';
                const vals = flds.map(f => (f.constant in paramVal) ? paramVal[f.constant] : 0);
                const positiveVals = vals.filter(v => v > 0);
                let minY, maxY;
                if (isLog && positiveVals.length) {
                    minY = Math.max(Math.min(...positiveVals) * 0.01, 1e-30);
                    maxY = Math.max(...positiveVals) * 100;
                } else {
                    const allVals = vals.length ? vals : [0];
                    minY = Math.min(0, ...allVals);
                    maxY = Math.max(...allVals) * 1.5 || 1;
                    if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
                }

                const toY = v => {
                    const frac = isLog && v > 0
                        ? (Math.log10(v) - Math.log10(minY)) / (Math.log10(maxY) - Math.log10(minY))
                        : (v - minY) / (maxY - minY);
                    return chartTop + chartH_svg * (1 - Math.max(0, Math.min(1, frac)));
                };

                const g = document.createElementNS(NS, "g");
                g.setAttribute("display", gi === initialIdx ? "inline" : "none");

                const ticks = [];
                if (isLog && minY > 0) {
                    const lo = Math.floor(Math.log10(minY));
                    const hi = Math.ceil(Math.log10(maxY));
                    for (let e = lo; e <= hi; e++) ticks.push(Math.pow(10, e));
                } else {
                    for (let i = 0; i <= 4; i++) ticks.push(minY + (maxY - minY) * i / 4);
                }

                const fs = w * 0.0245;
                ticks.forEach(tv => {
                    const ty = toY(tv);
                    if (ty < chartTop - 1 || ty > chartBottom + 1) return;
                    g.appendChild(mk("line", { x1: minX, y1: ty, x2: maxX, y2: ty, stroke: "#eee", "stroke-width": w * 0.002 }));
                    const lt = mk("text", { x: minX - w * 0.02, y: ty + fs * 0.35, "text-anchor": "end", "font-size": fs, "font-family": "sans-serif", fill: "#555" });
                    lt.textContent = (tv >= 1e4 || (tv > 0 && tv < 0.01)) ? tv.toExponential(0) : parseFloat(tv.toPrecision(3));
                    g.appendChild(lt);
                });

                const ylbl = mk("text", {
                    x: 0, y: 0,
                    transform: `translate(${x0 + fs},${chartTop + chartH_svg / 2}) rotate(-90)`,
                    "text-anchor": "middle", "font-size": fs, "font-family": "sans-serif", fill: "#555"
                });
                ylbl.textContent = label + (units ? ` (${units})` : '');
                g.appendChild(ylbl);

                // Track placed labels as [{cx, y}] to detect overlap in both axes
                const placedLabels = [];
                const minLabelGapY = fs * 1.1;
                const minLabelGapX = w * 0.08;
                flds.forEach(f => {
                    const box = boxByName[f.domain];
                    if (!box) return;
                    const xA = Math.min(num(box.corner0, minX), num(box.corner1, minX));
                    const xB = Math.max(num(box.corner0, minX), num(box.corner1, minX));
                    const val = (f.constant in paramVal) ? paramVal[f.constant] : 0;
                    if (val === undefined) return;
                    const ly = toY(val);
                    const lc = namedColors[f.color] || f.color || "#333";
                    g.appendChild(mk("line", { x1: xA, y1: ly, x2: xB, y2: ly, stroke: lc, "stroke-width": w * 0.004 }));
                    const lv = (val >= 1e4 || (val > 0 && val < 0.01)) ? val.toExponential(2) : val.toPrecision(3);
                    const cx = (xA + xB) / 2;
                    // Find a Y that doesn't collide with already-placed labels
                    let labelY = ly - fs * 0.4;
                    let attempts = 0;
                    while (attempts < 20) {
                        const conflict = placedLabels.some(p =>
                            Math.abs(p.cx - cx) < minLabelGapX && Math.abs(p.y - labelY) < minLabelGapY
                        );
                        if (!conflict) break;
                        labelY -= minLabelGapY;
                        attempts++;
                    }
                    placedLabels.push({ cx, y: labelY });
                    const lt2 = mk("text", { x: cx, y: labelY, "text-anchor": "middle", "font-size": fs * 0.85, fill: lc, "font-family": "sans-serif" });
                    lt2.textContent = lv + units;
                    g.appendChild(lt2);
                });

                svg.appendChild(g);
                chartGroups.push(g);
            });

            // Build a map from field label → set of parameter IDs used by that field
            const fieldParamIds = {};
            groupKeys.forEach(label => {
                fieldParamIds[label] = new Set(fieldGroups[label].map(f => f.constant).filter(Boolean));
            });

            // Show/hide parameter inputs based on the active field tab
            const applyParamVisibility = (activeLabel) => {
                const paramsDiv = rootEl.querySelector('.rp-structure-parameters');
                if (!paramsDiv) return;
                const activeIds = fieldParamIds[activeLabel] || new Set();
                paramsDiv.querySelectorAll(':scope > .rp-widget').forEach(w => {
                    const path = w.dataset.path || '';
                    const m = path.match(/\(([^)]+)\)$/);
                    const id = m ? m[1] : '';
                    w.style.display = (activeIds.size === 0 || activeIds.has(id)) ? '' : 'none';
                });
            };

            const initialLabel = groupKeys[initialIdx] || '';
            if (initialLabel) {
                rootEl.dataset.activeField = initialLabel;
                applyParamVisibility(initialLabel);
            }

            // Only render tab buttons if there are multiple field groups to switch between
            if (groupKeys.length > 1) {
                const oldFP = rootEl.querySelector(".rp-structure-fields-panel");
                if (oldFP) oldFP.remove();
                const fp = mkHtml("div", { class: "rp-structure-fields-panel" });
                const tabRow = mkHtml("div", { style: "display:flex;gap:2px;margin-top:2px;" });
                const tabBtns = [];
                groupKeys.forEach((label, gi) => {
                    const btn = mkHtml("button", { type: "button" });
                    btn.textContent = label;
                    Object.assign(btn.style, { padding: "2px 10px", fontSize: "11px", border: "1px solid #ccc", borderTop: "none", background: gi === initialIdx ? "#fff" : "#f0f0f0", cursor: "pointer" });
                    btn.addEventListener("click", () => {
                        chartGroups.forEach((g, j) => g.setAttribute("display", j === gi ? "inline" : "none"));
                        tabBtns.forEach((b, j) => b.style.background = j === gi ? "#fff" : "#f0f0f0");
                        rootEl.dataset.activeField = label;
                        applyParamVisibility(label);
                    });
                    tabBtns.push(btn);
                    tabRow.appendChild(btn);
                });
                fp.appendChild(tabRow);
                rootEl.appendChild(fp);
            } else {
                const oldFP = rootEl.querySelector(".rp-structure-fields-panel");
                if (oldFP) oldFP.remove();
            }
        }

    }

    function boot() {
        document.querySelectorAll(".rp-structure-input").forEach((el) => {
            el.addEventListener('rp-structure:update', (e) => {
                try { renderStructurePreview(el, e.detail); } catch (err) { console.warn("Failed to render structure update", err); }
            });
            try {
                const raw = JSON.parse(el.getAttribute("data-structure") || "{}");
                renderStructurePreview(el, raw);
            } catch (e) { console.warn("Failed to parse structure data", e); }
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
