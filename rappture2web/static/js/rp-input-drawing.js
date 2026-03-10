/**
 * Render input <drawing> (2D) and <structure> previews.
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

    function num(v, dflt) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : dflt;
    }

    function parseBgBounds(bg, components) {
        // if explicit width/height provided use that as the drawing extents
        if (bg && (bg.width || bg.height)) {
            const hasW = bg.width !== undefined && bg.width !== null && bg.width !== "";
            const hasH = bg.height !== undefined && bg.height !== null && bg.height !== "";
            const w = hasW ? num(bg.width, 1) : null;
            const h = hasH ? num(bg.height, 1) : null;
            if (hasW && hasH) {
                return { x0: 0, y0: 0, x1: w, y1: h };
            } else if (hasW) {
                // width-only case: make viewBox square so height scales with width
                return { x0: 0, y0: 0, x1: w, y1: w };
            } else {
                // height-only: make drawing square so normalized coords fill area
                return { x0: 0, y0: 0, x1: h, y1: h };
            }
        }
        const fromBg = (bg && bg.coordinates) ? String(bg.coordinates).trim().split(/\s+/).map(Number).filter(Number.isFinite) : [];
        if (fromBg.length >= 4) {
            return { x0: fromBg[0], y0: fromBg[1], x1: fromBg[2], y1: fromBg[3] };
        }
        const vals = [];
        (components || []).forEach((c) => {
            const coords = c.coords || [];
            if ((c.type || "").toLowerCase() === "picture" && coords.length >= 4) {
                // For picture, coords are [x, y, width, height], so add the corners
                const x = coords[0], y = coords[1], width = coords[2], height = coords[3];
                vals.push(x, y, x + width, y, x + width, y + height, x, y + height);
            } else {
                coords.forEach((x) => vals.push(x));
            }
        });
        if (vals.length >= 4) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i + 1 < vals.length; i += 2) {
                const x = vals[i];
                const y = vals[i + 1];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
                return { x0: minX, y0: minY, x1: maxX, y1: maxY };
            }
        }
        return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }

    function setTextAnchor(textEl, anchor) {
        const a = (anchor || "c").toLowerCase();
        if (a.includes("w")) textEl.setAttribute("text-anchor", "end");
        else if (a.includes("e")) textEl.setAttribute("text-anchor", "start");
        else textEl.setAttribute("text-anchor", "middle");
        if (a.includes("n")) textEl.setAttribute("dominant-baseline", "hanging");
        else if (a.includes("s")) textEl.setAttribute("dominant-baseline", "text-after-edge");
        else textEl.setAttribute("dominant-baseline", "middle");
    }

    function applySubstitutions(text, subs, form) {
        if (!text || !subs) return text;
        let result = text;
        subs.forEach(v => {
            const path = v.path;
            const widget = form.querySelector(`.rp-widget[data-path="${path}"]`);
            let value = "";
            if (widget) {
                if (widget.dataset.type === 'loader') {
                    const sel = widget.querySelector('.rp-loader-select');
                    if (sel) value = sel.options[sel.selectedIndex]?.value || widget.dataset.loaderDefault || '';
                } else {
                    const inp = widget.querySelector('input:not([type="file"]), select, textarea');
                    if (inp) value = inp.value;
                }
            }
            v.maps.forEach(map => {
                if (value === map.from) {
                    result = result.replace('${' + v.name + '}', map.to);
                }
            });
        });
        // Resolve file:// references
        if (result.startsWith("file://")) {
            let fname = result.slice(7).trim();
            // convert leading parent traversals to __up__ tokens, matching backend
            const parts = fname.split("/").filter(p => p !== "" && p !== ".");
            const encoded = parts
                .map(p => (p === ".." ? "__up__" : p))
                .join("/");
            result = `/tool-files/${encoded}`;
        }
        return result;
    }

    function renderDrawingPreview(rootEl, data) {
        const host = rootEl.querySelector(".rp-drawing-preview");
        if (!host) return;
        host.innerHTML = "";

        const components = (data && data.components) || [];
        const bg = (data && data.background) || {};
        const b = parseBgBounds(bg, components);
        const minX = Math.min(b.x0, b.x1);
        const minY = Math.min(b.y0, b.y1);
        const w = Math.max(1e-9, Math.abs(b.x1 - b.x0));
        const h = Math.max(1e-9, Math.abs(b.y1 - b.y0));

        const preserve = "xMidYMid meet";
        const svgAttrs = {
            viewBox: `${minX} ${minY} ${w} ${h}`,
            preserveAspectRatio: preserve,
            width: "100%",
            height: "100%",
            style: `background:${bg.color || "#ffffff"}`,
        };
        const svg = mk("svg", svgAttrs);

        components.forEach((c) => {
            const lw = num(c.linewidth, 1);
            const stroke = c.outline || c.color || "black";
            const fill = c.fill || "none";
            let coords = (c.coords || []).slice();
            // if all coordinates are small (<=1) treat them as normalized fractions
            if (coords.length && Math.max(...coords.map(Math.abs)) <= 1) {
                coords = coords.map((v, i) => (i % 2 === 0 ? v * w : v * h));
            }
            switch ((c.type || "").toLowerCase()) {
                case "rectangle": {
                    if (coords.length < 4) break;
                    const x0 = coords[0], y0 = coords[1], x1 = coords[2], y1 = coords[3];
                    const x = Math.min(x0, x1), y = Math.min(y0, y1);
                    svg.appendChild(mk("rect", {
                        x, y, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0),
                        stroke, "stroke-width": lw, fill,
                    }));
                    break;
                }
                case "oval": {
                    if (coords.length < 4) break;
                    const x0 = coords[0], y0 = coords[1], x1 = coords[2], y1 = coords[3];
                    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
                    svg.appendChild(mk("ellipse", {
                        cx, cy, rx: Math.abs(x1 - x0) / 2, ry: Math.abs(y1 - y0) / 2,
                        stroke, "stroke-width": lw, fill,
                    }));
                    break;
                }
                case "line": {
                    if (coords.length < 4) break;
                    const pts = [];
                    for (let i = 0; i + 1 < coords.length; i += 2) pts.push(`${coords[i]},${coords[i + 1]}`);
                    svg.appendChild(mk("polyline", {
                        points: pts.join(" "),
                        stroke: c.color || "black",
                        "stroke-width": lw,
                        fill: "none",
                    }));
                    break;
                }
                case "polygon": {
                    if (coords.length < 6) break;
                    const pts = [];
                    for (let i = 0; i + 1 < coords.length; i += 2) pts.push(`${coords[i]},${coords[i + 1]}`);
                    svg.appendChild(mk("polygon", {
                        points: pts.join(" "),
                        stroke,
                        "stroke-width": lw,
                        fill,
                    }));
                    break;
                }
                case "text": {
                    if (coords.length < 2) break;
                    const t = mk("text", {
                        x: coords[0], y: coords[1],
                        fill: c.color || "black",
                        "font-size": "10",
                    });
                    setTextAnchor(t, c.anchor || "c");
                    t.textContent = c.text || "";
                    svg.appendChild(t);
                    break;
                }
                case "grid": {
                    const gx = c.xcoords || [];
                    const gy = c.ycoords || [];
                    gx.forEach((x) => svg.appendChild(mk("line", {
                        x1: x, y1: minY, x2: x, y2: minY + h,
                        stroke: c.color || "#94a3b8", "stroke-width": lw,
                    })));
                    gy.forEach((y) => svg.appendChild(mk("line", {
                        x1: minX, y1: y, x2: minX + w, y2: y,
                        stroke: c.color || "#94a3b8", "stroke-width": lw,
                    })));
                    break;
                }
                case "hotspot": {
                    if (coords.length < 2) break;
                    svg.appendChild(mk("circle", {
                        cx: coords[0], cy: coords[1],
                        r: Math.max(w, h) * 0.01,
                        fill: c.color || "#2563eb",
                    }));
                    break;
                }
                case "picture": {
                    if (coords.length < 4) break;
                    const href = applySubstitutions(c.contents || "", data.substitutions, rootEl.closest('form'));
                    const img = mk("image", {
                        x: coords[0], y: coords[1], width: coords[2] - coords[0], height: coords[3] - coords[1],
                        href: href,
                    });
                    svg.appendChild(img);
                    // Load image to get natural size and adjust viewBox and image size
                    const imgObj = new Image();
                    imgObj.src = href;
                    imgObj.onload = () => {
                        const nw = imgObj.naturalWidth;
                        const nh = imgObj.naturalHeight;
                        const aspect = nw / nh;
                        // Set viewBox to image's natural dimensions
                        svg.setAttribute('viewBox', `0 0 ${nw} ${nh}`);
                        // Set image to natural size
                        img.setAttribute('width', nw);
                        img.setAttribute('height', nh);
                        // Make container responsive: fit height, constrain width to aspect
                        host.style.width = '100%';
                        host.style.height = '100%';
                        svg.style.maxWidth = `100%`;
                        svg.style.maxHeight = `450px`;
                    };
                    break;
                }
                default:
                    break;
            }
        });

        host.appendChild(svg);
    }

    function boot() {
        document.querySelectorAll(".rp-drawing-input").forEach((el) => {
            try { renderDrawingPreview(el, JSON.parse(el.getAttribute("data-drawing") || "{}")); } catch (_) { }
        });
        const form = document.querySelector('form');
        if (form) {
            // redraw when any input changes to handle substitutions
            form.addEventListener('change', () => {
                document.querySelectorAll(".rp-drawing-input").forEach((el) => {
                    try { renderDrawingPreview(el, JSON.parse(el.getAttribute("data-drawing") || "{}")); } catch (_) { }
                });
            });
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();

