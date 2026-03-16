// ============================================
// Lx SVG RENDERING — curves, playhead, morph animations
// ============================================

import { PHASE_CHART } from './constants';
import { svgEl, phaseChartX, phaseChartY, sleep, clamp } from './utils';
import {
    phasePointsToPath,
    phasePointsToFillPath,
    buildProgressiveMorphPoints,
    interpolatePointsAtTime,
} from './curve-utils';
import { getEffectSubGroup } from './divider';
import { placePeakDescriptors } from './phase-chart';
import { renderSubstanceTimeline, animateTimelineReveal } from './substance-timeline';
import { isTurboActive } from './state';

// ============================================
// Module-level state
// ============================================

export let _morphDragState: any = null;

// ============================================
// Lx curve rendering
// ============================================

export function renderLxCurves(lxCurves: any, curvesData: any) {
    const group = document.getElementById('phase-lx-curves')!;
    group.innerHTML = '';

    for (let i = 0; i < lxCurves.length; i++) {
        const lx = lxCurves[i];
        const color = curvesData[i].color;

        if (lx.points.length < 2) continue;

        const sub = getEffectSubGroup(group, i);

        // Area fill
        const fillD = phasePointsToFillPath(lx.points, false);
        if (fillD) {
            const fillPath = svgEl('path', {
                d: fillD,
                fill: color,
                class: 'phase-lx-fill',
                opacity: '0',
            });
            sub.appendChild(fillPath);
            if (isTurboActive()) fillPath.setAttribute('opacity', '1');
            else fillPath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });
        }

        // Stroke path
        const strokeD = phasePointsToPath(lx.points, false);
        if (strokeD) {
            const strokePath = svgEl('path', {
                d: strokeD,
                stroke: color,
                class: 'phase-lx-path',
                opacity: '0',
            });
            sub.appendChild(strokePath);
            if (isTurboActive()) strokePath.setAttribute('opacity', '1');
            else strokePath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });
        }
    }
}

/** Convert SVG-space X to hour value (inverse of phaseChartX) */
export function svgXToHour(svgX: any) {
    const norm = (svgX - PHASE_CHART.padL) / PHASE_CHART.plotW;
    return PHASE_CHART.startHour + norm * (PHASE_CHART.endHour - PHASE_CHART.startHour);
}

/** Shared: update all morph visuals (curves, dots, connectors, fills, arrows) at a given playhead hour */
export function updateMorphAtPlayhead(playheadHour: any, state: any) {
    const { curveAnimData, blendWidth, phLine, phGlow, arrows, arrowGroup } = state;
    const startHour = PHASE_CHART.startHour;
    const endHour = PHASE_CHART.endHour;
    const hourRange = endHour - startHour;
    const progress = clamp((playheadHour - startHour) / hourRange, 0, 1);
    const halfBlend = blendWidth / 2;

    // Move playhead visual
    const playheadX = phaseChartX(playheadHour * 60);
    phLine.setAttribute('x', playheadX.toFixed(1));
    phGlow.setAttribute('x', (playheadX - 8).toFixed(1));

    // Morph each curve's stroke
    for (const cd of curveAnimData) {
        if (!cd.strokeEl) continue;
        const morphedPts = buildProgressiveMorphPoints(cd.desiredPts, cd.lxSmoothed, playheadHour, blendWidth);
        cd.strokeEl.setAttribute('d', phasePointsToPath(morphedPts, true));
    }

    // Ghost fills progressively
    const fillOp = 0.08 + (0.03 - 0.08) * progress;
    for (const cd of curveAnimData) {
        if (cd.fillEl) cd.fillEl.setAttribute('fill-opacity', fillOp.toFixed(4));
    }

    // Fade arrows
    const arrowOp = Math.max(0, 0.7 * (1 - progress * 1.5));
    for (const arrow of arrows) {
        arrow.setAttribute('opacity', arrowOp.toFixed(3));
    }
    if (progress >= 1) arrowGroup.style.opacity = '0';
    else arrowGroup.style.opacity = '';

    // Update dots + connector lines to track morphed curve positions (cached on state)
    if (!state._cachedDots) state._cachedDots = document.querySelectorAll('.timeline-curve-dot');
    if (!state._cachedConnectors) state._cachedConnectors = document.querySelectorAll('.timeline-connector');
    const dots = state._cachedDots;
    const connectors = state._cachedConnectors;

    dots.forEach((dot: any) => {
        const ci = parseInt(dot.getAttribute('data-curve-idx'));
        const tH = parseFloat(dot.getAttribute('data-time-h'));
        const cd = curveAnimData[ci];
        if (!cd) return;
        let t;
        if (tH <= playheadHour - halfBlend) t = 1;
        else if (tH >= playheadHour + halfBlend) t = 0;
        else {
            const x = (playheadHour + halfBlend - tH) / blendWidth;
            t = x * x * (3 - 2 * x);
        }
        const dv = interpolatePointsAtTime(cd.desiredPts, tH);
        const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
        dot.setAttribute('cy', phaseChartY(dv + (lv - dv) * t).toFixed(1));
    });

    connectors.forEach((conn: any) => {
        const ci = parseInt(conn.getAttribute('data-curve-idx'));
        const tH = parseFloat(conn.getAttribute('data-time-h'));
        const cd = curveAnimData[ci];
        if (!cd) return;
        let t;
        if (tH <= playheadHour - halfBlend) t = 1;
        else if (tH >= playheadHour + halfBlend) t = 0;
        else {
            const x = (playheadHour + halfBlend - tH) / blendWidth;
            t = x * x * (3 - 2 * x);
        }
        const dv = interpolatePointsAtTime(cd.desiredPts, tH);
        const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
        conn.setAttribute('y1', phaseChartY(dv + (lv - dv) * t).toFixed(1));
    });
}

/** Set up drag interaction on the morph playhead for before/after comparison */
export function setupPlayheadDrag(state: any) {
    const { svg, playheadGroup, phLine, phGlow } = state;

    // Add a wider invisible drag handle for comfortable grabbing
    const phHandle = svgEl('rect', {
        x: String(parseFloat(phLine.getAttribute('x')) - 14),
        y: String(PHASE_CHART.padT),
        width: '30',
        height: String(PHASE_CHART.plotH),
        fill: 'transparent',
        cursor: 'col-resize',
        class: 'morph-playhead-handle',
    });
    playheadGroup.appendChild(phHandle);

    // Transition playhead to persistent drag style: brighter, thicker
    phLine.setAttribute('fill', 'rgba(245, 200, 80, 0.7)');
    phLine.setAttribute('width', '2');
    phGlow.setAttribute('fill', 'rgba(245, 200, 80, 0.04)');

    let dragging = false;
    const ctm = () => svg.getScreenCTM();

    function onDown(e: any) {
        e.preventDefault();
        dragging = true;
        phLine.setAttribute('fill', 'rgba(245, 200, 80, 0.9)');
        phHandle.setAttribute('cursor', 'col-resize');
    }

    function onMove(e: any) {
        if (!dragging) return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const m = ctm();
        if (!m) return;
        const svgX = (clientX - m.e) / m.a;
        const hour = Math.max(PHASE_CHART.startHour, Math.min(PHASE_CHART.endHour, svgXToHour(svgX)));
        // Update handle position to track playhead
        phHandle.setAttribute('x', String(phaseChartX(hour * 60) - 14));
        updateMorphAtPlayhead(hour, state);
    }

    function onUp() {
        if (!dragging) return;
        dragging = false;
        phLine.setAttribute('fill', 'rgba(245, 200, 80, 0.7)');
        phHandle.setAttribute('cursor', 'col-resize');
    }

    phHandle.addEventListener('mousedown', onDown);
    phHandle.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    // Store cleanup refs
    state.dragCleanup = () => {
        phHandle.removeEventListener('mousedown', onDown);
        phHandle.removeEventListener('touchstart', onDown);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchend', onUp);
    };
}

/** Remove draggable playhead and clean up event listeners */
export function cleanupMorphDrag() {
    if (!_morphDragState) return;
    if (_morphDragState.dragCleanup) _morphDragState.dragCleanup();
    const ph = document.getElementById('morph-playhead');
    if (ph) ph.remove();
    _morphDragState = null;
}

/** Show a draggable playhead at the right edge (for step-forward re-entry to phase 2) */
export function showDraggablePlayhead(lxCurves: any, curvesData: any) {
    cleanupMorphDrag();

    const desiredGroup = document.getElementById('phase-desired-curves')!;
    const arrowGroup = document.getElementById('phase-mission-arrows')!;
    const svg = document.getElementById('phase-chart-svg')!;

    const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
    const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');
    const arrows = Array.from(arrowGroup.children);

    const curveAnimData = lxCurves.map((lx: any, i: number) => ({
        desiredPts: lx.desired,
        // lx.points is already produced from a smoothed baseline; avoid re-smoothing
        // here because it can attenuate early-step peaks below baseline.
        lxSmoothed: (lx.points || []).map((p: any) => ({ ...p })),
        strokeEl: strokePaths[i] || null,
        fillEl: fillPaths[i] || null,
    }));

    const endX = phaseChartX(PHASE_CHART.endHour * 60);
    const playheadGroup = svgEl('g', { id: 'morph-playhead' });
    const phGlow = svgEl('rect', {
        x: (endX - 8).toFixed(1),
        y: String(PHASE_CHART.padT),
        width: '18',
        height: String(PHASE_CHART.plotH),
        fill: 'rgba(245, 200, 80, 0.04)',
        rx: '9',
        'pointer-events': 'none',
    });
    playheadGroup.appendChild(phGlow);
    const phLine = svgEl('rect', {
        x: endX.toFixed(1),
        y: String(PHASE_CHART.padT),
        width: '2',
        height: String(PHASE_CHART.plotH),
        fill: 'rgba(245, 200, 80, 0.7)',
        rx: '0.75',
        'pointer-events': 'none',
    });
    playheadGroup.appendChild(phLine);

    const tooltipOverlay = document.getElementById('phase-tooltip-overlay')!;
    svg.insertBefore(playheadGroup, tooltipOverlay);

    const state = {
        curveAnimData,
        blendWidth: 1.5,
        phLine,
        phGlow,
        arrows,
        arrowGroup,
        svg,
        playheadGroup,
    };

    _morphDragState = state;
    setupPlayheadDrag(state);
}

/** Cinematic playhead sweep: morphs desired strokes → Lx positions left-to-right,
 *  then leaves a draggable before/after comparison playhead */
export function animatePlayheadMorph(lxCurves: any, curvesData: any) {
    return new Promise<void>(resolve => {
        cleanupMorphDrag(); // Clear any prior drag state

        const desiredGroup = document.getElementById('phase-desired-curves')!;
        const arrowGroup = document.getElementById('phase-mission-arrows')!;
        const svg = document.getElementById('phase-chart-svg')!;

        const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
        const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');
        const arrows = Array.from(arrowGroup.children);

        const curveAnimData = lxCurves.map((lx: any, i: number) => ({
            desiredPts: lx.desired,
            lxSmoothed: (lx.points || []).map((p: any) => ({ ...p })),
            strokeEl: strokePaths[i] || null,
            fillEl: fillPaths[i] || null,
        }));

        // Create playhead element
        const playheadGroup = svgEl('g', { id: 'morph-playhead' });
        const phGlow = svgEl('rect', {
            x: String(PHASE_CHART.padL - 8),
            y: String(PHASE_CHART.padT),
            width: '18',
            height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.06)',
            rx: '9',
            'pointer-events': 'none',
        });
        playheadGroup.appendChild(phGlow);
        const phLine = svgEl('rect', {
            x: String(PHASE_CHART.padL),
            y: String(PHASE_CHART.padT),
            width: '1.5',
            height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.55)',
            rx: '0.75',
            'pointer-events': 'none',
        });
        playheadGroup.appendChild(phLine);

        const tooltipOverlay = document.getElementById('phase-tooltip-overlay')!;
        svg.insertBefore(playheadGroup, tooltipOverlay);

        const BLEND_WIDTH = 1.5;
        const startHour = PHASE_CHART.startHour;
        const endHour = PHASE_CHART.endHour;
        const hourRange = endHour - startHour;
        const SWEEP_DURATION = 4500; // Slow cinematic sweep

        const state = {
            curveAnimData,
            blendWidth: BLEND_WIDTH,
            phLine,
            phGlow,
            arrows,
            arrowGroup,
            svg,
            playheadGroup,
        };

        const startTime = performance.now();

        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / SWEEP_DURATION);
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
            const playheadHour = startHour + hourRange * ease;

            updateMorphAtPlayhead(playheadHour, state);

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                // Final state: fully morphed to Lx
                updateMorphAtPlayhead(endHour, state);

                // Keep playhead and make it draggable (before/after comparison)
                _morphDragState = state;
                setupPlayheadDrag(state);

                resolve();
            }
        })(performance.now());
    });
}

/** Quick morph desired→Lx (no playhead) — for step-forward navigation */
export function quickMorphDesiredToLx(lxCurves: any, curvesData: any, durationMs: any) {
    return new Promise<void>(resolve => {
        const desiredGroup = document.getElementById('phase-desired-curves')!;
        const arrowGroup = document.getElementById('phase-mission-arrows')!;
        const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
        const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');

        const perCurve = lxCurves.map((lx: any, i: number) => ({
            desiredPts: lx.desired,
            lxSmoothed: (lx.points || []).map((p: any) => ({ ...p })),
            strokeEl: strokePaths[i] || null,
            fillEl: fillPaths[i] || null,
        }));

        const dots = document.querySelectorAll('.timeline-curve-dot');
        const connectors = document.querySelectorAll('.timeline-connector');

        const startTime = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / durationMs);
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

            for (const pc of perCurve) {
                if (!pc.strokeEl) continue;
                const morphed = pc.desiredPts.map((dp: any, j: number) => ({
                    hour: dp.hour,
                    value: dp.value + (pc.lxSmoothed[j].value - dp.value) * ease,
                }));
                pc.strokeEl.setAttribute('d', phasePointsToPath(morphed, true));
            }

            const fillOp = 0.08 + (0.03 - 0.08) * ease;
            for (const pc of perCurve) {
                if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', fillOp.toFixed(4));
            }

            const arrowOp = Math.max(0, 0.7 * (1 - ease * 1.5));
            Array.from(arrowGroup.children).forEach((a: any) => a.setAttribute('opacity', arrowOp.toFixed(3)));

            // Animate dots + connectors
            dots.forEach((dot: any) => {
                const ci = parseInt(dot.getAttribute('data-curve-idx'));
                const tH = parseFloat(dot.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                dot.setAttribute('cy', phaseChartY(dv + (lv - dv) * ease).toFixed(1));
            });
            connectors.forEach((conn: any) => {
                const ci = parseInt(conn.getAttribute('data-curve-idx'));
                const tH = parseFloat(conn.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                conn.setAttribute('y1', phaseChartY(dv + (lv - dv) * ease).toFixed(1));
            });

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                for (const pc of perCurve) {
                    if (pc.strokeEl) pc.strokeEl.setAttribute('d', phasePointsToPath(pc.lxSmoothed, true));
                    if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', '0.03');
                }
                arrowGroup.style.opacity = '0';
                resolve();
            }
        })(performance.now());
    });
}

/** Reverse morph Lx→desired — for step-backward navigation */
export function quickMorphLxToDesired(lxCurves: any, curvesData: any, durationMs: any) {
    return new Promise<void>(resolve => {
        cleanupMorphDrag(); // Remove draggable playhead if present

        const desiredGroup = document.getElementById('phase-desired-curves')!;
        const arrowGroup = document.getElementById('phase-mission-arrows')!;
        const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
        const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');

        const perCurve = lxCurves.map((lx: any, i: number) => ({
            desiredPts: lx.desired,
            lxSmoothed: (lx.points || []).map((p: any) => ({ ...p })),
            strokeEl: strokePaths[i] || null,
            fillEl: fillPaths[i] || null,
        }));

        const dots = document.querySelectorAll('.timeline-curve-dot');
        const connectors = document.querySelectorAll('.timeline-connector');

        arrowGroup.style.opacity = '';
        const startTime = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / durationMs);
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

            for (const pc of perCurve) {
                if (!pc.strokeEl) continue;
                const morphed = pc.lxSmoothed.map((lp: any, j: number) => ({
                    hour: lp.hour,
                    value: lp.value + (pc.desiredPts[j].value - lp.value) * ease,
                }));
                pc.strokeEl.setAttribute('d', phasePointsToPath(morphed, true));
            }

            const fillOp = 0.03 + (0.08 - 0.03) * ease;
            for (const pc of perCurve) {
                if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', fillOp.toFixed(4));
            }

            const arrowOp = Math.min(0.7, 0.7 * ease);
            Array.from(arrowGroup.children).forEach((a: any) => a.setAttribute('opacity', arrowOp.toFixed(3)));

            // Animate dots + connectors back to desired positions
            dots.forEach((dot: any) => {
                const ci = parseInt(dot.getAttribute('data-curve-idx'));
                const tH = parseFloat(dot.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                dot.setAttribute('cy', phaseChartY(lv + (dv - lv) * ease).toFixed(1));
            });
            connectors.forEach((conn: any) => {
                const ci = parseInt(conn.getAttribute('data-curve-idx'));
                const tH = parseFloat(conn.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                conn.setAttribute('y1', phaseChartY(lv + (dv - lv) * ease).toFixed(1));
            });

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                for (const pc of perCurve) {
                    if (pc.strokeEl) pc.strokeEl.setAttribute('d', phasePointsToPath(pc.desiredPts, true));
                    if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', '0.08');
                }
                Array.from(arrowGroup.children).forEach((a: any) => a.setAttribute('opacity', '0.7'));
                arrowGroup.style.opacity = '';
                resolve();
            }
        })(performance.now());
    });
}

export async function animateLxReveal(lxCurves: any, curvesData: any, interventions: any) {
    // 1. Render substance timeline first (pills + connectors + dots at Lx target positions)
    renderSubstanceTimeline(interventions, lxCurves, curvesData);

    // 2. Stagger-reveal timeline pills
    animateTimelineReveal(800);
    await sleep(800);

    // 3. Brief pause — visual tension (dots at targets, strokes still at desired)
    await sleep(300);

    // 4. Playhead sweep morphs desired strokes → Lx positions
    await animatePlayheadMorph(lxCurves, curvesData);

    // 5. Fade old peak descriptors, re-place at Lx peak positions
    const desiredGroup = document.getElementById('phase-desired-curves')!;
    desiredGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
        el.style.transition = 'opacity 400ms ease';
        el.style.opacity = '0';
    });
    await sleep(450);
    // Re-place descriptors using Lx positions
    const lxCurvesForLabels = curvesData.map((c: any, i: number) => ({
        ...c,
        desired: lxCurves[i].points,
    }));
    placePeakDescriptors(desiredGroup, lxCurvesForLabels, 'desired', 0);
}
