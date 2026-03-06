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
        const fromBg = (bg && bg.coordinates) ? String(bg.coordinates).trim().split(/\s+/).map(Number).filter(Number.isFinite) : [];
        if (fromBg.length >= 4) {
            return { x0: fromBg[0], y0: fromBg[1], x1: fromBg[2], y1: fromBg[3] };
        }
        const vals = [];
        (components || []).forEach((c) => {
            (c.coords || []).forEach((x) => vals.push(x));
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

        const svg = mk("svg", {
            viewBox: `${minX} ${minY} ${w} ${h}`,
            preserveAspectRatio: "xMidYMid meet",
            width: "100%",
            height: "100%",
            style: `background:${bg.color || "#ffffff"}`,
        });

        components.forEach((c) => {
            const lw = num(c.linewidth, 1);
            const stroke = c.outline || c.color || "black";
            const fill = c.fill || "none";
            const coords = c.coords || [];
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
                default:
                    break;
            }
        });

        host.appendChild(svg);
    }

    function renderStructurePreview(rootEl, data) {
        const host = rootEl.querySelector(".rp-drawing-preview");
        if (!host) return;
        host.innerHTML = "";
        const comps = (data && data.components) || [];
        if (!comps.length) {
            host.textContent = "(no structure components)";
            return;
        }
        let minX = Infinity, maxX = -Infinity;
        comps.forEach((c) => {
            const a = num(c.corner0, 0);
            const b = num(c.corner1, 0);
            minX = Math.min(minX, a, b);
            maxX = Math.max(maxX, a, b);
        });
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
            minX = 0;
            maxX = 1;
        }
        const pad = (maxX - minX) * 0.04;
        const x0 = minX - pad;
        const w = (maxX - minX) + 2 * pad;
        const svg = mk("svg", { viewBox: `${x0} 0 ${w} 1`, width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet" });
        svg.appendChild(mk("rect", { x: x0, y: 0, width: w, height: 1, fill: "#ffffff" }));
        comps.forEach((c) => {
            const a = num(c.corner0, 0);
            const b = num(c.corner1, 0);
            const x = Math.min(a, b);
            const ww = Math.abs(b - a);
            const color = c.color || "#e2e8f0";
            svg.appendChild(mk("rect", { x, y: 0.2, width: ww, height: 0.6, fill: color, stroke: "#0f172a", "stroke-width": 0.003 }));
            if (c.label) {
                const t = mk("text", { x: x + ww / 2, y: 0.5, fill: "#0f172a", "font-size": "0.08", "text-anchor": "middle", "dominant-baseline": "middle" });
                t.textContent = c.label;
                svg.appendChild(t);
            }
        });
        host.appendChild(svg);
    }

    function boot() {
        document.querySelectorAll(".rp-drawing-input").forEach((el) => {
            try { renderDrawingPreview(el, JSON.parse(el.getAttribute("data-drawing") || "{}")); } catch (_) {}
        });
        document.querySelectorAll(".rp-structure-input").forEach((el) => {
            try { renderStructurePreview(el, JSON.parse(el.getAttribute("data-structure") || "{}")); } catch (_) {}
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();

