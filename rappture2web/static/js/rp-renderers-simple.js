/**
 * Rappture2Web simple output renderers.
 * Handles: number, integer, boolean, string, image, log, group, field_group, mesh.
 *
 * Each renderer is registered via rappture._registerRenderer with both
 * render (single-run) and compare (multi-run) functions.
 */

// ── number ──────────────────────────────────────────────────────────────────

rappture._registerRenderer('number', {
    render(id, data) {
        const label = (data.about && data.about.label) || data.label || id;
        const item = rappture.createOutputItem(label, 'number');
        item.querySelector('.rp-output-body').innerHTML =
            `<span class="rp-output-value">${data.current || ''}</span>` +
            (data.units ? `<span class="rp-output-units">${data.units}</span>` : '');
        return item;
    },
    compare(sources, id) {
        const firstData = sources[0].data;
        const label = (firstData.about && firstData.about.label) || firstData.label || id;
        const item = rappture.createOutputItem(label, 'number');
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
        table.innerHTML = sources.map(({ run, data }, si) =>
            `<tr style="${si === 0 ? 'font-weight:700;background:#eff6ff' : ''}">` +
            `<td style="padding:4px 8px;color:var(--rp-text-muted)">${run.label}</td>` +
            `<td style="padding:4px 8px;font-variant-numeric:tabular-nums">${data.current || ''}</td>` +
            `<td style="padding:4px 8px;color:var(--rp-text-muted)">${data.units || ''}</td></tr>`
        ).join('');
        item.querySelector('.rp-output-body').appendChild(table);
        return { elem: item, label };
    },
});

// ── integer (alias to number) ───────────────────────────────────────────────

rappture._registerRenderer('integer', {
    render(id, data) { return rappture._rendererRegistry.number.render.call(rappture, id, data); },
    compare(sources, id) { return rappture._rendererRegistry.number.compare.call(rappture, sources, id); },
});

// ── boolean ─────────────────────────────────────────────────────────────────

rappture._registerRenderer('boolean', {
    render(id, data) {
        const label = (data.about && data.about.label) || data.label || id;
        const item = rappture.createOutputItem(label, 'boolean');
        const val = (data.current || '').toLowerCase();
        item.querySelector('.rp-output-body').textContent =
            ['yes', 'on', 'true', '1'].includes(val) ? 'Yes' : 'No';
        return item;
    },
    compare(sources, id) {
        const firstData = sources[0].data;
        const label = (firstData.about && firstData.about.label) || firstData.label || id;
        const item = rappture.createOutputItem(label, 'boolean');
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
        table.innerHTML = sources.map(({ run, data }, si) => {
            const val = (data.current || '').toString().toLowerCase();
            const isTrue = ['yes', 'on', 'true', '1'].includes(val);
            return `<tr style="${si === 0 ? 'font-weight:700;background:#eff6ff' : ''}">` +
                `<td style="padding:4px 8px;color:var(--rp-text-muted)">${run.label}</td>` +
                `<td style="padding:4px 8px">${isTrue ? '\u2713 Yes' : '\u2717 No'}</td></tr>`;
        }).join('');
        item.querySelector('.rp-output-body').appendChild(table);
        return { elem: item, label };
    },
});

// ── string ──────────────────────────────────────────────────────────────────

rappture._registerRenderer('string', {
    render(id, data) {
        const label = (data.about && data.about.label) || data.label || id;
        const item = rappture.createOutputItem(label, 'string');
        item.querySelector('.rp-output-body').textContent = data.current || '';
        return item;
    },
    compare(sources, id) {
        const firstData = sources[0].data;
        const label = (firstData.about && firstData.about.label) || firstData.label || id;
        const item = rappture.createOutputItem(label, 'string');
        const body = item.querySelector('.rp-output-body');
        sources.forEach(({ run, data }, si) => {
            const hdr = document.createElement('div');
            hdr.style.cssText = `font-size:12px;font-weight:${si === 0 ? '700' : '400'};color:var(--rp-text-muted);margin:${si > 0 ? '8px' : '0'} 0 2px`;
            hdr.textContent = run.label;
            const pre = document.createElement('pre');
            pre.style.cssText = 'font-size:12px;white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;padding:6px 8px;margin:0';
            pre.textContent = data.current || '';
            body.appendChild(hdr);
            body.appendChild(pre);
        });
        return { elem: item, label };
    },
});

// ── image ───────────────────────────────────────────────────────────────────

rappture._registerRenderer('image', {
    render(id, data) {
        const label = (data.about && data.about.label) || data.label || id;
        const item = rappture.createOutputItem(label, 'image');
        const body = item.querySelector('.rp-output-body');
        if (data.current) {
            const img = document.createElement('img');
            let src = data.current.trim();
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
    compare(sources, id) {
        const firstData = sources[0].data;
        const label = (firstData.about && firstData.about.label) || firstData.label || id;
        const item = rappture.createOutputItem(label, 'image');
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
        return { elem: item, label };
    },
});

// ── log ─────────────────────────────────────────────────────────────────────

rappture._registerRenderer('log', {
    render(id, data) {
        const item = rappture.createOutputItem('Log', 'log');
        item.querySelector('.rp-output-body').textContent = data.content || '';
        return item;
    },
    compare(sources, id) {
        const firstData = sources[0].data;
        const logLabel = firstData.label || 'Log';
        const item = rappture.createOutputItem(logLabel, 'log');
        const body = item.querySelector('.rp-output-body');
        body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px;white-space:normal;font-family:inherit;font-size:inherit';
        sources.forEach(({ run, data }, si) => {
            const runName = run.label || run.run_num || `Run ${si + 1}`;
            const runColor = run._color || 'var(--rp-text-muted)';
            const hdr = document.createElement('div');
            hdr.style.cssText = `font-size:12px;font-weight:${si === 0 ? '700' : '400'};color:${runColor};margin:0 0 2px;font-family:var(--rp-font);white-space:normal`;
            hdr.textContent = runName;
            const pre = document.createElement('pre');
            pre.style.cssText = 'font-size:12px;white-space:pre-wrap;background:#0d1117;color:#cdd6f4;border:1px solid #334155;border-radius:3px;padding:6px 8px;margin:0;max-height:300px;overflow-y:auto;font-family:monospace';
            pre.textContent = data.content || '';
            body.appendChild(hdr);
            body.appendChild(pre);
        });
        return { elem: item, label: logLabel };
    },
});

// ── group ───────────────────────────────────────────────────────────────────

rappture._registerRenderer('group', {
    render(id, data) {
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
});

// ── field_group ─────────────────────────────────────────────────────────────

rappture._registerRenderer('field_group', {
    render(id, data) {
        const members = data._members || [];
        if (members.length === 0) return null;
        if (members.length === 1) {
            return rappture.outputRenderers.field.call(rappture, members[0].id, members[0].field);
        }
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
            const elem = rappture.outputRenderers.field.call(rappture, m.id, m.field);
            if (elem) content.appendChild(elem);
        };

        sel.addEventListener('change', () => renderMember(parseInt(sel.value)));
        renderMember(0);
        return wrapper;
    },
});

// ── mesh (delegates to field) ───────────────────────────────────────────────

rappture._registerRenderer('mesh', {
    render(id, data) {
        return rappture.outputRenderers.field.call(rappture, id, {
            label: data.label || id,
            components: [{ mesh: data, values: [] }],
        });
    },
});
