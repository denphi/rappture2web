/**
 * Rappture2Web sequence renderer.
 * Handles: sequence (frame player for time-series outputs).
 * Both single-run and compare modes.
 *
 * Registered via rappture._registerRenderer.
 * Uses rappture._rpUtils.icons for player SVG icons.
 */

rappture._registerRenderer('sequence', {
    render(id, data) {
        const item = rappture.createOutputItem((data.about && data.about.label) || data.label || id, 'sequence');
        item.classList.add('rp-output-plot-item');
        const body = item.querySelector('.rp-output-body');
        body.style.cssText = 'display:flex;flex-direction:column;padding:8px;gap:0;';
        if (!data.elements || data.elements.length === 0) {
            body.textContent = 'No sequence data';
            return item;
        }

        const n = data.elements.length;
        const indexLabel = data.index_label || 'Frame';
        const icons = rappture._rpUtils.icons;

        const controls = document.createElement('div');
        controls.className = 'rp-seq-controls';
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button'; prevBtn.className = 'rp-seq-btn'; prevBtn.innerHTML = icons.prev;
        prevBtn.title = 'Previous frame';
        const lbl = document.createElement('span');
        lbl.className = 'rp-seq-label';
        lbl.textContent = indexLabel + ' 1 / ' + n;
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button'; nextBtn.className = 'rp-seq-btn'; nextBtn.innerHTML = icons.next;
        nextBtn.title = 'Next frame';
        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'rp-seq-slider-wrap';
        const slider = document.createElement('input');
        slider.type = 'range'; slider.className = 'rp-seq-slider';
        slider.min = 0; slider.max = n - 1; slider.value = 0;
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

        const playBtn = document.createElement('button');
        playBtn.type = 'button'; playBtn.className = 'rp-seq-btn rp-seq-play'; playBtn.innerHTML = icons.play; playBtn.title = 'Play';
        const pauseBtn = document.createElement('button');
        pauseBtn.type = 'button'; pauseBtn.className = 'rp-seq-btn rp-seq-pause'; pauseBtn.innerHTML = icons.pause; pauseBtn.title = 'Pause'; pauseBtn.style.display = 'none';
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button'; resetBtn.className = 'rp-seq-btn rp-seq-reset'; resetBtn.innerHTML = icons.reset; resetBtn.title = 'Reset';

        // Lock Y-axis checkbox id — the actual checkbox is injected into the curve's
        // Y Axis panel section via data._seqLockYId; we look it up after first render.
        const lockYId = 'rp-seq-locky-' + id.replace(/[^a-z0-9]/gi, '_');
        let lockYChk = null; // resolved after first frame renders

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
        plotDiv.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';

        body.appendChild(controls);
        body.appendChild(plotDiv);

        let _seqTimer = null;
        const _seqStop = () => {
            if (_seqTimer) { clearInterval(_seqTimer); _seqTimer = null; }
            playBtn.style.display = ''; pauseBtn.style.display = 'none';
        };

        // Cache of rendered output items keyed by output id, so we reuse DOM across frames
        // and only update data. Map: oid -> { item, plotlyDiv }
        const _frameCache = {};

        // Compute global y-range across all frames keyed by entry position index.
        // Using position (not oid) because grouped curve oids like __grp__Name can vary.
        // Map: entryIndex -> [globalYMin, globalYMax]
        const _globalYRange = {};
        for (const el of data.elements) {
            const entries = rappture._mergeGroupedOutputs(Object.entries(el.outputs || {}));
            entries.forEach(([, odata], idx) => {
                const reg = rappture._rendererRegistry[odata.type];
                if (!reg || !reg.getTraces) return;
                for (const t of reg.getTraces(odata)) {
                    if (!t.y) continue;
                    for (const v of t.y) {
                        if (typeof v !== 'number' || !isFinite(v)) continue;
                        if (!_globalYRange[idx]) _globalYRange[idx] = [v, v];
                        if (v < _globalYRange[idx][0]) _globalYRange[idx][0] = v;
                        if (v > _globalYRange[idx][1]) _globalYRange[idx][1] = v;
                    }
                }
            });
        }

        const renderFrame = (idx) => {
            slider.value = idx;
            const el = data.elements[idx];
            prevBtn.disabled = idx === 0;
            nextBtn.disabled = idx === n - 1;
            lbl.textContent = indexLabel + ': ' + (el.index !== undefined ? el.index : idx);

            const frameEntries = rappture._mergeGroupedOutputs(Object.entries(el.outputs || {}));

            // On first frame, do a full render and cache items
            if (Object.keys(_frameCache).length === 0) {
                // First render: build DOM and cache rendered items
                plotDiv.querySelectorAll('canvas').forEach(c => {
                    if (c._rpRenderer) { try { c._rpRenderer.dispose(); } catch(e) {} }
                });
                plotDiv.innerHTML = '';
                frameEntries.forEach(([oid, odata], entryIdx) => {
                    const renderer = rappture.outputRenderers[odata.type];
                    if (!renderer) return;
                    // Inject Lock Y checkbox id into curve data so it renders in the Y Axis panel
                    if ((odata.type === 'curve' || odata.type === 'histogram') && !lockYChk) {
                        odata._seqLockYId = lockYId;
                    }
                    const rendered = renderer.call(rappture.outputRenderers, oid, odata);
                    if (!rendered) return;
                    // Resolve lockYChk from the rendered curve panel
                    if (!lockYChk) {
                        const chk = rendered.querySelector('#' + lockYId);
                        if (chk) {
                            lockYChk = chk;
                            lockYChk.addEventListener('change', () => {
                                const cur = parseInt(slider.value);
                                if (cur === 0) {
                                    for (const cached of Object.values(_frameCache)) {
                                        if (!cached.plotlyDiv || !cached.plotlyDiv._fullLayout) continue;
                                        const yr = _globalYRange[cached.entryIdx];
                                        if (lockYChk.checked && yr) {
                                            Plotly.relayout(cached.plotlyDiv, { 'yaxis.range': yr, 'yaxis.autorange': false });
                                        } else {
                                            Plotly.relayout(cached.plotlyDiv, { 'yaxis.autorange': true });
                                        }
                                    }
                                } else {
                                    renderFrame(cur);
                                }
                            });
                        }
                    }
                    const hdr = rendered.querySelector('.rp-output-header');
                    if (hdr) hdr.style.display = 'none';
                    rendered.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;border:none;border-radius:0;margin:0;';
                    plotDiv.appendChild(rendered);
                    _frameCache[oid] = { rendered, type: odata.type, entryIdx };
                    // Apply locked y-range once Plotly has initialized (poll since _whenVisible
                    // inside the renderer delays Plotly.newPlot until the element is visible).
                    const yr = _globalYRange[entryIdx];
                    if (yr) {
                        let _pollCount = 0;
                        const _poll = () => {
                            const pd = rendered.querySelector('.js-plotly-plot');
                            if (pd && pd._fullLayout) {
                                _frameCache[oid].plotlyDiv = pd;
                                if (lockYChk && lockYChk.checked) {
                                    Plotly.relayout(pd, { 'yaxis.range': yr, 'yaxis.autorange': false });
                                }
                            } else if (_pollCount++ < 40) {
                                setTimeout(_poll, 50);
                            }
                        };
                        setTimeout(_poll, 50);
                    }
                });
            } else {
                // Subsequent frames: update Plotly plots in-place via getTraces, rebuild non-Plotly outputs
                frameEntries.forEach(([oid, odata], entryIdx) => {
                    const cached = _frameCache[oid];
                    if (!cached) return;
                    const reg = rappture._rendererRegistry[odata.type];
                    if (reg && reg.getTraces) {
                        // Lazy-find the plotly div (may not have existed at cache time)
                        if (!cached.plotlyDiv) {
                            cached.plotlyDiv = cached.rendered.querySelector('.js-plotly-plot');
                        }
                        if (cached.plotlyDiv && cached.plotlyDiv._fullLayout) {
                            const yr = _globalYRange[entryIdx];
                            const newTraces = reg.getTraces(odata);
                            // Delete existing traces then add new ones, preserving layout entirely
                            const nExisting = cached.plotlyDiv.data.length;
                            const deleteIdxs = Array.from({ length: nExisting }, (_, i) => i);
                            Plotly.deleteTraces(cached.plotlyDiv, deleteIdxs);
                            Plotly.addTraces(cached.plotlyDiv, newTraces);
                            // Apply y-axis lock as a separate relayout
                            if (lockYChk && lockYChk.checked && yr) {
                                Plotly.relayout(cached.plotlyDiv, { 'yaxis.range': yr, 'yaxis.autorange': false });
                            } else {
                                Plotly.relayout(cached.plotlyDiv, { 'yaxis.autorange': true });
                            }
                        }
                    } else {
                        // Non-Plotly output: replace content
                        const renderer = rappture.outputRenderers[odata.type];
                        if (renderer) {
                            const rendered = renderer.call(rappture.outputRenderers, oid, odata);
                            if (rendered) {
                                const hdr = rendered.querySelector('.rp-output-header');
                                if (hdr) hdr.style.display = 'none';
                                rendered.style.cssText = cached.rendered.style.cssText;
                                cached.rendered.replaceWith(rendered);
                                _frameCache[oid] = { rendered, type: odata.type, entryIdx };
                            }
                        }
                    }
                });
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

    compare(sources, id) {
        const firstData = sources[0].data;
        const seqLabel = (firstData.about && firstData.about.label) || firstData.label || id;
        const item = rappture.createOutputItem(seqLabel, 'sequence');
        const body = item.querySelector('.rp-output-body');
        const icons = rappture._rpUtils.icons;

        const maxFrames = Math.max(...sources.map(s => (s.data.elements || []).length));
        if (maxFrames === 0) { body.textContent = 'No sequence data'; return { elem: item, label: seqLabel }; }

        const indexLabel = firstData.index_label || 'Frame';
        const controls = document.createElement('div');
        controls.className = 'rp-seq-controls';
        const cPrev = document.createElement('button');
        cPrev.type = 'button'; cPrev.className = 'rp-seq-btn'; cPrev.innerHTML = icons.prev; cPrev.title = 'Previous frame';
        const lbl = document.createElement('span');
        lbl.className = 'rp-seq-label';
        lbl.textContent = indexLabel + ' 1 / ' + maxFrames;
        const cNext = document.createElement('button');
        cNext.type = 'button'; cNext.className = 'rp-seq-btn'; cNext.innerHTML = icons.next; cNext.title = 'Next frame';
        const cPlay = document.createElement('button');
        cPlay.type = 'button'; cPlay.className = 'rp-seq-btn rp-seq-play'; cPlay.innerHTML = icons.play; cPlay.title = 'Play';
        const cPause = document.createElement('button');
        cPause.type = 'button'; cPause.className = 'rp-seq-btn rp-seq-pause'; cPause.innerHTML = icons.pause; cPause.title = 'Pause'; cPause.style.display = 'none';
        const cReset = document.createElement('button');
        cReset.type = 'button'; cReset.className = 'rp-seq-btn rp-seq-reset'; cReset.innerHTML = icons.reset; cReset.title = 'Reset';
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

        const framesHost = document.createElement('div');
        framesHost.style.cssText = 'display:flex;flex-direction:column;gap:10px;min-height:0;';
        body.appendChild(framesHost);

        const renderSeqCompareFrame = (frameIdx) => {
            slider.value = frameIdx;
            cPrev.disabled = frameIdx === 0;
            cNext.disabled = frameIdx === maxFrames - 1;
            lbl.textContent = indexLabel + ' ' + (frameIdx + 1) + ' / ' + maxFrames;
            framesHost.innerHTML = '';

            // Build ordered output groups for this frame and collect per-run sources.
            const order = [];
            const byOutput = new Map(); // key -> { oid, sources: [{run, data}, ...] }
            sources.forEach(({ run, data }) => {
                const elems = data.elements || [];
                const el = elems[Math.min(frameIdx, elems.length - 1)];
                if (!el) return;
                const cmpEntries = rappture._mergeGroupedOutputs(Object.entries(el.outputs || {}));
                for (let entryIdx = 0; entryIdx < cmpEntries.length; entryIdx++) {
                    const [oid, odata] = cmpEntries[entryIdx];
                    const t = String((odata && odata.type) || '');
                    // For field outputs, group by label (or per-frame position fallback)
                    // so runs with different generated field ids still overlay together.
                    const key = (t === 'field' || t.startsWith('field_'))
                        ? (odata && odata.label ? `__fieldlbl__${odata.label}` : `__fieldpos__${entryIdx}`)
                        : oid;
                    if (!byOutput.has(key)) {
                        byOutput.set(key, { oid, sources: [] });
                        order.push(key);
                    }
                    byOutput.get(key).sources.push({ run, data: odata });
                }
            });

            for (const key of order) {
                const group = byOutput.get(key);
                if (!group) continue;
                const oid = group.oid;
                const oidSources = group.sources || [];
                if (oidSources.length === 0) continue;
                const first = oidSources[0].data;
                const type = first.type;
                let rendered = null;

                const regEntry = rappture._rendererRegistry[type];
                if (regEntry && typeof regEntry.compare === 'function' && oidSources.length > 1) {
                    const compared = regEntry.compare.call(rappture, oidSources, oid);
                    rendered = compared && (compared.elem || compared);
                }
                // Field subtypes (field_2d/field_3d/...) do not define compare handlers.
                // Route them through the main 'field' compare so runs overlay in one plot
                // with selected run colors and first-run emphasis.
                if (!rendered && oidSources.length > 1 && type.startsWith('field_')) {
                    const fieldSources = oidSources.map(s => ({
                        run: s.run,
                        data: { ...s.data, type: 'field' },
                    }));
                    const fieldReg = rappture._rendererRegistry.field;
                    if (fieldReg && typeof fieldReg.compare === 'function') {
                        const compared = fieldReg.compare.call(rappture, fieldSources, oid);
                        rendered = compared && (compared.elem || compared);
                    }
                }
                if (!rendered) {
                    const renderer = rappture.outputRenderers[type];
                    if (renderer) {
                        rendered = renderer.call(rappture.outputRenderers, oid, first);
                    }
                }
                if (!rendered) continue;

                const hdr = rendered.querySelector('.rp-output-header');
                if (hdr) hdr.style.display = 'none';
                rendered.style.cssText = 'width:100%;display:flex;flex-direction:column;border:none;border-radius:0;margin:0;';
                framesHost.appendChild(rendered);
            }

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
        return { elem: item, label: seqLabel };
    },
});
