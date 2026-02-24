import { PHASE_CHART, PHASE_SMOOTH_PASSES, WORD_CLOUD_PALETTE } from './constants';
import { AppState } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY } from './utils';
import { smoothPhaseValues, interpolatePointsAtTime } from './curve-utils';
import { getYAxisLabelPosition } from './phase-chart';

// ---- Module-level state (mutable, exported with setters) ----
export let _wordCloudPositions: any[] = [];
export let _orbitalRingsState: any = null;
let _wordCloudFloatId: number | null = null;

export function setWordCloudPositions(v: any[]): void {
    _wordCloudPositions = v;
}

export function setOrbitalRingsState(v: any): void {
    _orbitalRingsState = v;
}

// ---- Word Cloud Float Animation ----

export function startWordCloudFloat(): void {
    stopWordCloudFloat();
    const t0 = performance.now();
    const rampDur = 0.7;
    function tick() {
        const now = performance.now();
        const t = (now - t0) / 1000;
        for (const pos of _wordCloudPositions) {
            if (now < (pos.arrivedAt ?? 0)) continue;
            const elapsed = (now - pos.arrivedAt) / 1000;
            const ramp = elapsed < rampDur ? 1 - Math.pow(1 - elapsed / rampDur, 2) : 1;
            const phase = pos.x * 0.037 + pos.y * 0.029;
            const dx = Math.sin(t * 0.5 + phase) * 3.5 * ramp;
            const dy = Math.cos(t * 0.4 + phase * 1.3) * 2.5 * ramp;
            pos.el.setAttribute('x', (pos.x + dx).toFixed(1));
            pos.el.setAttribute('y', (pos.y + dy).toFixed(1));
        }
        _wordCloudFloatId = requestAnimationFrame(tick);
    }
    _wordCloudFloatId = requestAnimationFrame(tick);
}

export function stopWordCloudFloat(): void {
    if (_wordCloudFloatId) {
        cancelAnimationFrame(_wordCloudFloatId);
        _wordCloudFloatId = null;
    }
}

// ---- Orbital Rings — encircle word cloud, morph into baseline curves ----

export function startOrbitalRings(cx: number, cy: number): any {
    const group = document.getElementById('phase-word-cloud');
    if (!group) return null;

    const NPTS = 72;
    const singleRing = AppState.maxEffects === 1;
    const pad = 12;
    const wobbleMax = 1.08;
    const maxRy = (cy - PHASE_CHART.padT) / wobbleMax;
    const RX1 = PHASE_CHART.plotW / 2 - pad;
    const RY1 = Math.min(PHASE_CHART.plotH / 2 - pad, maxRy);
    const RX2 = RX1 + 14;
    const RY2 = Math.min(RY1 + 8, maxRy);
    const bandStep = 10;
    const ghostPhases = [0, 0.6, 1.2, 1.8, 2.4];

    const ot = chartTheme();
    const ghostLayers: Element[] = [];

    function createRingPath(color: string, strokeWidth: string, opacity: string, filter?: string): SVGPathElement {
        const attrs: Record<string, string> = {
            fill: 'none', stroke: color,
            'stroke-width': strokeWidth, 'stroke-linecap': 'round',
            class: 'orbital-ring', opacity: '0',
        };
        if (filter) attrs.filter = filter;
        return svgEl('path', attrs) as SVGPathElement;
    }

    for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const rx = RX1 + i * bandStep;
        const ry = RY1 + i * (bandStep * 0.5);
        const phase = ghostPhases[i + 2];
        const ghost = createRingPath(ot.orbitalRing1, '6', '0.18', 'url(#orbital-ghost)');
        group.insertBefore(ghost, group.firstChild);
        ghost.animate([{ opacity: 0 }, { opacity: 0.18 }], { duration: 800, fill: 'forwards', delay: 40 * Math.abs(i) });
        ghostLayers.push(ghost);
    }
    const ring1 = createRingPath(ot.orbitalRing1, '2.5', '0');
    group.insertBefore(ring1, group.firstChild);
    ring1.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: 800, fill: 'forwards' });

    let ring2: Element | null = null;
    if (!singleRing) {
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue;
            const rx = RX2 + i * bandStep;
            const ry = RY2 + i * (bandStep * 0.5);
            const phase = ghostPhases[i + 2] + Math.PI * 0.3;
            const ghost = createRingPath(ot.orbitalRing2, '6', '0.18', 'url(#orbital-ghost)');
            group.insertBefore(ghost, group.firstChild);
            ghost.animate([{ opacity: 0 }, { opacity: 0.18 }], { duration: 800, fill: 'forwards', delay: 120 + 40 * Math.abs(i) });
            ghostLayers.push(ghost);
        }
        ring2 = createRingPath(ot.orbitalRing2, '2.5', '0');
        group.insertBefore(ring2, group.firstChild);
        ring2.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: 800, fill: 'forwards', delay: 120 });
    }

    let running = true;
    let animId: number;

    function computeD(t: number, rx: number, ry: number, phase: number): string {
        const breathe = 1 + 0.018 * Math.sin(t * 1.2 + phase);
        let d = '';
        for (let i = 0; i <= NPTS; i++) {
            const angle = (i / NPTS) * Math.PI * 2;
            const wobble = 1 + 0.035 * Math.sin(angle * 2 + t * 0.8 + phase)
                             + 0.022 * Math.sin(angle * 3 + t * 1.3 + phase * 0.7);
            const px = cx + rx * breathe * wobble * Math.cos(angle);
            const py = cy + ry * breathe * wobble * Math.sin(angle);
            d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
        }
        return d + 'Z';
    }

    const layerSpecs: { rx: number; ry: number; phase: number }[] = [];
    for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        layerSpecs.push({
            rx: RX1 + i * bandStep,
            ry: RY1 + i * (bandStep * 0.5),
            phase: ghostPhases[i + 2],
        });
    }
    if (!singleRing) {
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue;
            layerSpecs.push({
                rx: RX2 + i * bandStep,
                ry: RY2 + i * (bandStep * 0.5),
                phase: ghostPhases[i + 2] + Math.PI * 0.3,
            });
        }
    }

    const t0 = performance.now();
    function tick() {
        if (!running) return;
        const t = (performance.now() - t0) / 1000;
        ghostLayers.forEach((el, idx) => {
            const s = layerSpecs[idx];
            if (s) el.setAttribute('d', computeD(t, s.rx, s.ry, s.phase));
        });
        ring1.setAttribute('d', computeD(t, RX1, RY1, 0));
        if (ring2) ring2.setAttribute('d', computeD(t, RX2, RY2, Math.PI));
        animId = requestAnimationFrame(tick);
    }
    tick();

    _orbitalRingsState = {
        ring1, ring2, singleRing, cx, cy, NPTS, RX1, RY1, RX2, RY2, ghostLayers,
        stop() { running = false; if (animId) cancelAnimationFrame(animId); },
        getLastT() { return (performance.now() - t0) / 1000; },
    };
    return _orbitalRingsState;
}

export function stopOrbitalRings(): void {
    if (_orbitalRingsState) {
        _orbitalRingsState.stop();
    }
}

/**
 * Morph orbital ring(s) into baseline curve(s).
 * Each ring "breaks apart" — the circle unfurls into a curve shape.
 * Top half of ring maps to the curve, bottom half collapses up to merge.
 */
export async function morphRingsToCurves(curvesData: any[]): Promise<void> {
    if (!_orbitalRingsState) return;
    const rings = _orbitalRingsState;
    rings.stop();
    (rings.ghostLayers || []).forEach((el: Element) => el.remove());

    const lastT = rings.getLastT();
    const N = 50;
    const duration = 1400;

    function sampleRing(rx: number, ry: number, phase: number): { x: number; y: number }[] {
        const breathe = 1 + 0.012 * Math.sin(lastT * 1.2 + phase);
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < N; i++) {
            const frac = i / (N - 1);
            const angle = Math.PI * (1 - frac);
            const wobble = 1 + 0.025 * Math.sin(angle * 2 + lastT * 0.8 + phase)
                             + 0.015 * Math.sin(angle * 3 + lastT * 1.3);
            pts.push({
                x: rings.cx + rx * breathe * wobble * Math.cos(angle),
                y: rings.cy + ry * breathe * wobble * Math.sin(angle),
            });
        }
        for (let i = 0; i < N; i++) {
            const frac = i / (N - 1);
            const angle = -Math.PI * frac;
            const wobble = 1 + 0.025 * Math.sin(angle * 2 + lastT * 0.8 + phase)
                             + 0.015 * Math.sin(angle * 3 + lastT * 1.3);
            pts.push({
                x: rings.cx + rx * breathe * wobble * Math.cos(angle),
                y: rings.cy + ry * breathe * wobble * Math.sin(angle),
            });
        }
        return pts;
    }

    // Sample target baseline curve positions (top half maps forward, bottom half maps reversed)
    function sampleCurveTarget(curveIdx: number): { x: number; y: number }[] | null {
        const baseline = curvesData[curveIdx]?.baseline;
        if (!baseline) return null;
        const smoothed = smoothPhaseValues(baseline, PHASE_SMOOTH_PASSES);
        const forward: { x: number; y: number }[] = [];
        for (let i = 0; i < N; i++) {
            const frac = i / (N - 1);
            const hour = PHASE_CHART.startHour + frac * (PHASE_CHART.endHour - PHASE_CHART.startHour);
            const value = interpolatePointsAtTime(smoothed, hour);
            forward.push({ x: phaseChartX(hour * 60), y: phaseChartY(value) });
        }
        // Bottom half collapses onto the curve (same points, reversed order)
        const reversed: { x: number; y: number }[] = [];
        for (let i = N - 1; i >= 0; i--) {
            reversed.push({ x: forward[i].x, y: forward[i].y });
        }
        return [...forward, ...reversed]; // 2*N points
    }

    const src1 = sampleRing(rings.RX1, rings.RY1, 0);
    const tgt1 = sampleCurveTarget(0);

    let src2: { x: number; y: number }[] | null = null;
    let tgt2: { x: number; y: number }[] | null = null;
    if (rings.ring2) {
        src2 = sampleRing(rings.RX2, rings.RY2, Math.PI);
        tgt2 = curvesData.length > 1 ? sampleCurveTarget(1) : sampleCurveTarget(0);
    }

    if (!tgt1) {
        rings.ring1.remove();
        if (rings.ring2) rings.ring2.remove();
        (rings.ghostLayers || []).forEach((el: Element) => el.remove());
        _orbitalRingsState = null;
        return;
    }

    const color1 = curvesData[0].color;
    const color2 = curvesData.length > 1 ? curvesData[1].color : color1;

    function hexToRgb(hex: string): [number, number, number] {
        const h = hex.replace('#', '');
        return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
    }
    function rgbaToRgb(rgba: string): [number, number, number] {
        const m = rgba.match(/[\d.]+/g);
        return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
    }
    function lerpColor(fromRgb: number[], toRgb: number[], t: number): string {
        const r = Math.round(fromRgb[0] + (toRgb[0] - fromRgb[0]) * t);
        const g = Math.round(fromRgb[1] + (toRgb[1] - fromRgb[1]) * t);
        const b = Math.round(fromRgb[2] + (toRgb[2] - fromRgb[2]) * t);
        return `rgb(${r},${g},${b})`;
    }

    const ot = chartTheme();
    const ringRgb1 = rgbaToRgb(ot.orbitalRing1);
    const ringRgb2 = rgbaToRgb(ot.orbitalRing2);
    const curveRgb1 = hexToRgb(color1);
    const curveRgb2 = hexToRgb(color2);

    await new Promise<void>(resolve => {
        const start = performance.now();

        function tick(now: number) {
            const rawP = Math.min(1, (now - start) / duration);
            // Smooth ease-in-out
            const p = rawP < 0.5 ? 2 * rawP * rawP : 1 - Math.pow(-2 * rawP + 2, 2) / 2;

            function buildMorphPath(src: { x: number; y: number }[], tgt: { x: number; y: number }[]): string {
                let d = '';
                for (let i = 0; i < src.length; i++) {
                    const x = src[i].x + (tgt[i].x - src[i].x) * p;
                    const y = src[i].y + (tgt[i].y - src[i].y) * p;
                    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
                }
                return d;
            }

            // Transition opacity and width
            const strokeOp = 0.28 + p * 0.35;
            const strokeW = 1.2 + p * 0.6;

            rings.ring1.setAttribute('d', buildMorphPath(src1, tgt1!));
            rings.ring1.setAttribute('stroke', lerpColor(ringRgb1, curveRgb1, p));
            rings.ring1.setAttribute('stroke-opacity', strokeOp.toFixed(2));
            rings.ring1.setAttribute('stroke-width', strokeW.toFixed(1));

            if (rings.ring2 && src2 && tgt2) {
                rings.ring2.setAttribute('d', buildMorphPath(src2, tgt2));
                rings.ring2.setAttribute('stroke', lerpColor(ringRgb2, curveRgb2, p));
                rings.ring2.setAttribute('stroke-opacity', strokeOp.toFixed(2));
                rings.ring2.setAttribute('stroke-width', strokeW.toFixed(1));
            }

            if (rawP < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(tick);
    });

    // Don't remove rings here — caller removes after baseline curves are rendered
    // to prevent a flicker gap between ring disappearance and curve appearance.
}

export function renderWordCloud(effects: any[]): Promise<void> {
    return new Promise(resolve => {
        const group = document.getElementById('phase-word-cloud')!;
        group.innerHTML = '';
        _wordCloudPositions = [];

        if (!effects || effects.length === 0) { resolve(); return; }

        const cx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        const cy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;

        const singleRing = AppState.maxEffects === 1;
        const cloudRx = PHASE_CHART.plotW / 2 - 20;
        const cloudRy = PHASE_CHART.plotH / 2 - 20;

        const sorted = [...effects].sort((a: any, b: any) => b.relevance - a.relevance);
        const maxRel = sorted[0].relevance || 100;
        const n = sorted.length;
        const maxSize = 42;
        const minSize = 10;
        const primaryCount = Math.min(8, Math.max(1, n - 10));

        const measured: any[] = [];
        for (let i = 0; i < n; i++) {
            const eff = sorted[i];
            const relFrac = eff.relevance / maxRel;
            const isPrimary = i < primaryCount;
            const fontSize = n <= 1 ? maxSize : maxSize - (maxSize - minSize) * (i / (n - 1));
            const fontWeight = isPrimary ? (relFrac > 0.55 ? '700' : '600') : '500';
            const letterSpacing = isPrimary ? (relFrac > 0.55 ? '-0.04em' : '-0.02em') : '0';
            const color = WORD_CLOUD_PALETTE[i % WORD_CLOUD_PALETTE.length];
            const opacity = isPrimary ? (0.82 + relFrac * 0.18) : (0.32 + relFrac * 0.18);

            const textEl = svgEl('text', {
                x: '0', y: '0',
                fill: color,
                'font-size': fontSize.toFixed(1),
                'font-weight': fontWeight,
                'letter-spacing': letterSpacing,
                class: 'word-cloud-word',
                opacity: '0',
                'data-effect-name': eff.name,
                'data-relevance': String(eff.relevance),
                'data-target-opacity': opacity.toFixed(2),
            });
            textEl.textContent = eff.name;
            group.appendChild(textEl);

            const bbox = (textEl as any).getBBox();
            measured.push({ eff, fontSize, color, opacity, textEl, w: bbox.width, h: bbox.height });
        }

        const placed: { x: number; y: number; w: number; h: number }[] = [];
        const PAD = 2;
        const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

        for (let i = 0; i < measured.length; i++) {
            const m = measured[i];
            let bestX = cx, bestY = cy;

            if (i === 0) {
                bestX = cx;
                bestY = cy;
            } else {
                let found = false;
                for (let rNorm = 0.05; rNorm <= 1; rNorm += 0.04) {
                    const angSteps = Math.min(48, Math.max(16, Math.floor(24 * rNorm)));
                    for (let ai = 0; ai < angSteps; ai++) {
                        const angle = i * GOLDEN_ANGLE + (ai / angSteps) * Math.PI * 2;
                        const tx = cx + cloudRx * rNorm * Math.cos(angle);
                        const ty = cy + cloudRy * rNorm * Math.sin(angle);

                        if ((tx - cx) ** 2 / (cloudRx ** 2) + (ty - cy) ** 2 / (cloudRy ** 2) > 1) continue;

                        const collides = placed.some(p =>
                            tx - m.w / 2 - PAD < p.x + p.w / 2 &&
                            tx + m.w / 2 + PAD > p.x - p.w / 2 &&
                            ty - m.h / 2 - PAD < p.y + p.h / 2 &&
                            ty + m.h / 2 + PAD > p.y - p.h / 2
                        );
                        if (!collides) {
                            bestX = tx;
                            bestY = ty;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
                if (!found) {
                    const fallbackAngle = i * GOLDEN_ANGLE;
                    bestX = cx + cloudRx * 0.6 * Math.cos(fallbackAngle);
                    bestY = cy + cloudRy * 0.6 * Math.sin(fallbackAngle);
                }
            }

            placed.push({ x: bestX, y: bestY, w: m.w, h: m.h });

            m.textEl.setAttribute('x', bestX.toFixed(1));
            m.textEl.setAttribute('y', bestY.toFixed(1));
            m.textEl.setAttribute('data-cx', bestX.toFixed(1));
            m.textEl.setAttribute('data-cy', bestY.toFixed(1));

            _wordCloudPositions.push({
                el: m.textEl, x: bestX, y: bestY, w: m.w, h: m.h,
                name: m.eff.name, relevance: m.eff.relevance,
            });
        }

        // Phase 3: Words spring from center to position with stagger, wobble starts as each arrives
        const totalEntranceDur = 20000; // 20 seconds
        const slideDur = 500;
        const words = group.querySelectorAll('.word-cloud-word');
        const stagger = words.length > 0 ? (totalEntranceDur - slideDur) / words.length : 0;
        const startTime = performance.now();

        _wordCloudPositions.forEach((pos, idx) => {
            pos.arrivedAt = startTime + idx * stagger + slideDur;
        });
        startWordCloudFloat();

        words.forEach((word, idx) => {

            const targetOp = parseFloat(word.getAttribute('data-target-opacity')!);
            const finalX = parseFloat(word.getAttribute('x')!);
            const finalY = parseFloat(word.getAttribute('y')!);

            word.setAttribute('x', cx.toFixed(1));
            word.setAttribute('y', cy.toFixed(1));

            setTimeout(() => {
                const t0 = performance.now();
                (function slide() {
                    const t = Math.min(1, (performance.now() - t0) / slideDur);
                    const c1 = 1.70158;
                    const c3 = c1 + 1;
                    const ease = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

                    word.setAttribute('x', (cx + (finalX - cx) * ease).toFixed(1));
                    word.setAttribute('y', (cy + (finalY - cy) * ease).toFixed(1));
                    word.setAttribute('opacity', (targetOp * Math.min(1, t * 2.5)).toFixed(2));

                    if (t < 1) requestAnimationFrame(slide);
                })();
            }, idx * stagger);
        });

        setTimeout(resolve, totalEntranceDur);
    });
}

export function dismissWordCloud(mainEffectNames: string[], mainColors: string[]): Promise<void> {
    return new Promise(resolve => {
        const group = document.getElementById('phase-word-cloud')!;
        const words = Array.from(group.querySelectorAll('.word-cloud-word'));

        stopWordCloudFloat();

        if (words.length === 0) { resolve(); return; }

        // Fuzzy match: find the best cloud word for each main effect
        const winners: { wordIdx: number; mainIdx: number }[] = [];
        const claimed = new Set<number>();

        for (let mi = 0; mi < mainEffectNames.length && mi < AppState.maxEffects; mi++) {
            const target = mainEffectNames[mi].toLowerCase().trim();
            let bestIdx = -1;
            let bestScore = 0;

            for (let wi = 0; wi < _wordCloudPositions.length; wi++) {
                if (claimed.has(wi)) continue;
                const wName = _wordCloudPositions[wi].name.toLowerCase().trim();

                // Exact match
                if (wName === target) { bestIdx = wi; bestScore = 100; break; }
                // Includes match
                if (wName.includes(target) || target.includes(wName)) {
                    const score = 80;
                    if (score > bestScore) { bestScore = score; bestIdx = wi; }
                    continue;
                }
                // Partial word overlap
                const wWords = wName.split(/\s+/);
                const tWords = target.split(/\s+/);
                const overlap = wWords.filter((w: string) => tWords.some((t: string) => t.includes(w) || w.includes(t))).length;
                if (overlap > 0) {
                    const score = 50 + overlap * 15;
                    if (score > bestScore) { bestScore = score; bestIdx = wi; }
                }
            }

            // If no match found, take highest-relevance unclaimed word
            if (bestIdx === -1) {
                let maxRel = -1;
                for (let wi = 0; wi < _wordCloudPositions.length; wi++) {
                    if (claimed.has(wi)) continue;
                    if (_wordCloudPositions[wi].relevance > maxRel) {
                        maxRel = _wordCloudPositions[wi].relevance;
                        bestIdx = wi;
                    }
                }
            }

            if (bestIdx >= 0) {
                claimed.add(bestIdx);
                winners.push({ wordIdx: bestIdx, mainIdx: mi });
            }
        }

        const cx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        const cy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
        const flyDuration = 650;
        const flyDelay = 80;

        for (const w of winners) {
            const pos = _wordCloudPositions[w.wordIdx];
            const el = pos.el;
            const mainName = mainEffectNames[w.mainIdx];
            const isLeft = w.mainIdx === 0;
            const target = getYAxisLabelPosition(isLeft ? 'left' : 'right');

            el.setAttribute('text-anchor', target.anchor);
            el.setAttribute('dominant-baseline', target.baseline);
            el.setAttribute('font-weight', '500');
            el.setAttribute('letter-spacing', '0.04em');

            const curX = parseFloat(el.getAttribute('x')!);
            const curY = parseFloat(el.getAttribute('y')!);
            const bbox = (el as SVGTextElement).getBBox();
            const startX = isLeft ? curX - bbox.width / 2 : curX + bbox.width / 2;
            const startY = curY + bbox.height * 0.25;

            const needsCrossfade = pos.name.toLowerCase().trim() !== mainName.toLowerCase().trim();
            if (needsCrossfade) {
                const edgeX = isLeft ? curX - bbox.width / 2 : curX + bbox.width / 2;
                el.animate([{ opacity: parseFloat(el.getAttribute('opacity') || '0.8') }, { opacity: 0 }], {
                    duration: 120, fill: 'forwards',
                });
                setTimeout(() => {
                    el.textContent = mainName;
                    el.setAttribute('font-size', '11');
                    el.setAttribute('fill', mainColors[w.mainIdx] || WORD_CLOUD_PALETTE[0]);
                    el.setAttribute('x', edgeX.toFixed(1));
                    el.setAttribute('y', startY.toFixed(1));
                    el.animate([{ opacity: 0 }, { opacity: 0.9 }], {
                        duration: 120, fill: 'forwards',
                    });
                }, 120);
            } else {
                el.setAttribute('x', startX.toFixed(1));
                el.setAttribute('y', startY.toFixed(1));
            }

            const startFontSize = parseFloat(el.getAttribute('font-size'));
            const targetFontSize = 11;
            const flyStartDelay = needsCrossfade ? 260 : flyDelay;
            const startTime = performance.now();

            (function animateFly() {
                const elapsed = performance.now() - startTime;
                if (elapsed < flyStartDelay) { requestAnimationFrame(animateFly); return; }
                const rawT = Math.min(1, (elapsed - flyStartDelay) / flyDuration);
                const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

                el.setAttribute('x', (startX + (target.x - startX) * ease).toFixed(1));
                el.setAttribute('y', (startY + (target.y - startY) * ease).toFixed(1));
                el.setAttribute('font-size', (startFontSize + (targetFontSize - startFontSize) * ease).toFixed(1));

                if (rawT >= 1) {
                    el.animate([{ opacity: 0.9 }, { opacity: 0 }], {
                        duration: 100, fill: 'forwards',
                    });
                } else {
                    requestAnimationFrame(animateFly);
                }
            })();
        }

        const burstDuration = 480;
        const burstRamp = 0.15;
        const burstDelay = 50;
        words.forEach(word => {
            const isWinner = winners.some(w => _wordCloudPositions[w.wordIdx].el === word);
            if (isWinner) return;

            const curX = parseFloat(word.getAttribute('x')!);
            const curY = parseFloat(word.getAttribute('y')!);
            let dx = curX - cx;
            let dy = curY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const burstDist = 220 + Math.random() * 80;
            dx = (dx / dist) * burstDist;
            dy = (dy / dist) * burstDist;

            const t0 = performance.now();
            (function burst() {
                const elapsed = performance.now() - t0;
                if (elapsed < burstDelay) { requestAnimationFrame(burst); return; }
                const rawT = Math.min(1, (elapsed - burstDelay) / burstDuration);
                const ramp = rawT < burstRamp ? (rawT / burstRamp) * (rawT / burstRamp) : 1;
                const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
                const combined = ramp * ease;

                word.setAttribute('x', (curX + dx * combined).toFixed(1));
                word.setAttribute('y', (curY + dy * combined).toFixed(1));
                word.setAttribute('opacity', Math.max(0, 1 - rawT * 1.8).toFixed(2));

                if (rawT < 1) requestAnimationFrame(burst);
            })();
        });

        const totalTime = Math.max(flyDuration + flyDelay + 100, burstDelay + burstDuration);
        setTimeout(() => {
            // Remove only word-cloud words — preserve orbital rings (still morphing)
            group.querySelectorAll('.word-cloud-word').forEach(el => el.remove());
            _wordCloudPositions = [];
            resolve();
        }, totalTime + 50);
    });
}
