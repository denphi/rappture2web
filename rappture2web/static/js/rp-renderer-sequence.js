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
                for (const [oid, odata] of frameEntries) {
                    const renderer = rappture.outputRenderers[odata.type];
                    if (renderer) {
                        const rendered = renderer.call(rappture.outputRenderers, oid, odata);
                        if (rendered) {
                            const hdr = rendered.querySelector('.rp-output-header');
                            if (hdr) hdr.style.display = 'none';
                            rendered.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;border:none;border-radius:0;margin:0;';
                            plotDiv.appendChild(rendered);
                            _frameCache[oid] = { rendered, type: odata.type };
                        }
                    }
                }
            } else {
                // Subsequent frames: update Plotly plots in-place via getTraces, rebuild non-Plotly outputs
                for (const [oid, odata] of frameEntries) {
                    const cached = _frameCache[oid];
                    if (!cached) continue;
                    const reg = rappture._rendererRegistry[odata.type];
                    if (reg && reg.getTraces) {
                        // Lazy-find the plotly div (may not have existed at cache time)
                        if (!cached.plotlyDiv) {
                            cached.plotlyDiv = cached.rendered.querySelector('.js-plotly-plot');
                        }
                        if (cached.plotlyDiv && cached.plotlyDiv._fullLayout) {
                            Plotly.react(cached.plotlyDiv, reg.getTraces(odata), cached.plotlyDiv.layout);
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
                                _frameCache[oid] = { rendered, type: odata.type };
                            }
                        }
                    }
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

        const framesRow = document.createElement('div');
        framesRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start';
        body.appendChild(framesRow);

        // Per-source cache: array of { cell, plotlyDivs: {oid: plotlyDiv} }
        const _cmpCache = [];

        const renderSeqCompareFrame = (frameIdx) => {
            slider.value = frameIdx;
            cPrev.disabled = frameIdx === 0;
            cNext.disabled = frameIdx === maxFrames - 1;
            lbl.textContent = indexLabel + ' ' + (frameIdx + 1) + ' / ' + maxFrames;

            sources.forEach(({ run, data }, si) => {
                const elems = data.elements || [];
                const el = elems[Math.min(frameIdx, elems.length - 1)];
                if (!el) return;
                const runColor = run._color || '#3b82f6';
                const runName = run.label || `Run ${run.run_num || '?'}`;
                const cmpEntries = rappture._mergeGroupedOutputs(Object.entries(el.outputs || {}));

                if (!_cmpCache[si]) {
                    // First render: full DOM build, cache rendered items
                    const cell = document.createElement('div');
                    cell.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:200px;flex:1';
                    const runLbl = document.createElement('div');
                    runLbl.style.cssText = `font-size:12px;font-weight:600;color:${runColor};background:${runColor}22;border:1px solid ${runColor};border-radius:3px;padding:2px 8px`;
                    runLbl.textContent = runName;
                    cell.appendChild(runLbl);
                    const frameDiv = document.createElement('div');
                    frameDiv.style.cssText = 'width:100%';
                    const renderedItems = {};
                    for (const [oid, odata] of cmpEntries) {
                        const renderer = rappture.outputRenderers[odata.type];
                        if (renderer) {
                            const rendered = renderer.call(rappture.outputRenderers, oid, odata);
                            if (rendered) {
                                const inner = rendered.querySelector('.rp-output-body');
                                const node = inner || rendered;
                                frameDiv.appendChild(node);
                                renderedItems[oid] = { node, type: odata.type };
                            }
                        }
                    }
                    cell.appendChild(frameDiv);
                    framesRow.appendChild(cell);
                    _cmpCache[si] = { cell, renderedItems };
                } else {
                    // Subsequent frames: update Plotly in-place via getTraces (lazy plotly div lookup)
                    const cached = _cmpCache[si];
                    for (const [oid, odata] of cmpEntries) {
                        const item = cached.renderedItems[oid];
                        if (!item) continue;
                        const reg = rappture._rendererRegistry[odata.type];
                        if (reg && reg.getTraces) {
                            if (!item.plotlyDiv) {
                                item.plotlyDiv = item.node.querySelector('.js-plotly-plot');
                            }
                            if (item.plotlyDiv && item.plotlyDiv._fullLayout) {
                                Plotly.react(item.plotlyDiv, reg.getTraces(odata), item.plotlyDiv.layout);
                            }
                        }
                    }
                }
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
        return { elem: item, label: seqLabel };
    },
});
