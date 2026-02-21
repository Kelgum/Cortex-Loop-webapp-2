import { PHASE_CHART, TIMELINE_ZONE, PHASE_SMOOTH_PASSES } from './constants';
import { AppState, PhaseState, DividerState, BiometricState } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY, sleep } from './utils';
import { SUBSTANCE_DB, getActiveSubstances, resolveSubstance } from './substances';
import { smoothPhaseValues, phasePointsToPath, phasePointsToFillPath, buildProgressiveMorphPoints, interpolatePointsAtTime, phaseBandPath } from './curve-utils';
import { getEffectSubGroup } from './divider';
import { placePeakDescriptors } from './phase-chart';
import { DebugLog } from './debug-panel';

// ============================================
// Dependency injection for circular references
// ============================================

let _updateStepButtonsFn: any;
let _startTimelineScanLineFn: any;
let _stopTimelineScanLineFn: any;
let _showBiometricTriggerFn: any;
let _renderBiometricStripsFn: any;

export function injectLxDeps(d: any) {
    if (d.updateStepButtons) _updateStepButtonsFn = d.updateStepButtons;
    if (d.startTimelineScanLine) _startTimelineScanLineFn = d.startTimelineScanLine;
    if (d.stopTimelineScanLine) _stopTimelineScanLineFn = d.stopTimelineScanLine;
    if (d.showBiometricTrigger) _showBiometricTriggerFn = d.showBiometricTrigger;
    if (d.renderBiometricStrips) _renderBiometricStripsFn = d.renderBiometricStrips;
}

// ============================================
// Module-level state
// ============================================

export let _morphDragState: any = null;

// ============================================
// Pharmacokinetic Model
// ============================================

/**
 * Compute the effect value of a single substance dose at a given time.
 * Uses a piecewise model: ramp up → peak → plateau → exponential decay → optional rebound.
 */
export function substanceEffectAt(minutesSinceDose: any, pharma: any) {
    if (minutesSinceDose < 0) return 0;
    const { onset, peak, duration, halfLife, strength, rebound } = pharma;

    let effect = 0;
    if (minutesSinceDose <= onset) {
        // Ramp-up phase (ease-in)
        const t = minutesSinceDose / onset;
        effect = strength * t * t;
    } else if (minutesSinceDose <= peak) {
        // Rising to peak (ease-out)
        const t = (minutesSinceDose - onset) / (peak - onset);
        effect = strength * (0.7 + 0.3 * (1 - (1 - t) * (1 - t)));
    } else if (minutesSinceDose <= duration * 0.6) {
        // Plateau near peak
        const decay = (minutesSinceDose - peak) / (duration * 0.6 - peak);
        effect = strength * (1 - decay * 0.15);
    } else if (minutesSinceDose <= duration) {
        // Exponential decay
        const elapsed = minutesSinceDose - duration * 0.6;
        effect = strength * 0.85 * Math.pow(0.5, elapsed / halfLife);
    } else {
        // Post-duration: continued decay + rebound dip
        const elapsedAtDuration = duration - duration * 0.6;
        const valueAtDuration = strength * 0.85 * Math.pow(0.5, elapsedAtDuration / halfLife);
        const elapsed = minutesSinceDose - duration;
        const residual = valueAtDuration * Math.pow(0.5, elapsed / halfLife);
        const reboundDip = rebound * Math.exp(-elapsed / (halfLife * 0.5));
        effect = residual - reboundDip;
    }

    return effect;
}

// ============================================
// 20c. Lx OVERLAY COMPUTATION
// ============================================

export function validateInterventions(interventions: any, curvesData: any) {
    if (!Array.isArray(interventions)) return [];
    const active = getActiveSubstances();
    return interventions.filter((iv: any) => {
        if (!iv.key || iv.timeMinutes == null) return false;
        // Resolve substance from active set or full DB
        const sub = active[iv.key] || SUBSTANCE_DB[iv.key];
        if (!sub) return false;
        iv.substance = sub;
        iv.timeMinutes = Math.max(PHASE_CHART.startMin, Math.min(PHASE_CHART.endMin, iv.timeMinutes));

        // Resolve primary target curve for connector line drawing
        // Multi-vector: find the impact key with the highest absolute vector
        if (curvesData && iv.impacts && typeof iv.impacts === 'object') {
            let bestKey: any = null, bestAbs = 0;
            for (const [effectKey, vec] of Object.entries(iv.impacts) as [string, any][]) {
                if (Math.abs(vec) > bestAbs) {
                    bestAbs = Math.abs(vec);
                    bestKey = effectKey;
                }
            }
            if (bestKey) {
                const idx = curvesData.findIndex((c: any) =>
                    c.effect && matchImpactToCurve({ [bestKey]: 1 }, c.effect) !== 0);
                iv.targetCurveIdx = idx >= 0 ? idx : null;
            }
        }
        // Legacy fallback: single targetEffect string
        if (iv.targetCurveIdx == null && curvesData && iv.targetEffect) {
            const idx = curvesData.findIndex((c: any) =>
                c.effect && matchImpactToCurve({ [iv.targetEffect]: 1 }, c.effect) !== 0);
            iv.targetCurveIdx = idx >= 0 ? idx : null;
        }
        if (iv.targetCurveIdx == null && curvesData) {
            iv.targetCurveIdx = mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
        }

        return true;
    });
}

export function mapSubstanceToEffectAxis(substanceKey: any, curvesData: any) {
    const sub = resolveSubstance(substanceKey, {});
    if (!sub) return [0];

    const cls = sub.class || 'unknown';

    // Map substance class to curve indices based on polarity and effect type
    const mapping: number[] = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const polarity = curve.polarity || 'higher_is_better';

        // Stimulants & nootropics → positive effects (higher_is_better)
        if (['Stimulant', 'Nootropic'].includes(cls) && polarity === 'higher_is_better') {
            mapping.push(i);
        }
        // Adaptogens → both positive effects and negative effect reduction
        else if (cls === 'Adaptogen') {
            mapping.push(i);
        }
        // Sleep/Depressants → sedation or negative effect reduction
        else if (cls === 'Depressant/Sleep' && (polarity === 'higher_is_worse' || curve.effect?.toLowerCase().includes('sleep'))) {
            mapping.push(i);
        }
        // Minerals/Vitamins → general support, affects all
        else if (['Mineral/Electrolyte', 'Vitamin/Amino'].includes(cls)) {
            mapping.push(i);
        }
    }

    return mapping.length > 0 ? mapping : [0];
}

/**
 * Fuzzy-match an impact key from the LLM to a curve effect name.
 * Handles exact match, substring containment, and word overlap.
 * Returns the impact value if matched, 0 otherwise.
 */
export function matchImpactToCurve(impacts: any, curveName: any) {
    if (!impacts || typeof impacts !== 'object') return 0;
    const cn = curveName.toLowerCase().trim();
    const cnWords = cn.split(/\s+/);

    // Pass 1: exact match
    for (const [key, vec] of Object.entries(impacts) as [string, any][]) {
        if (key.toLowerCase().trim() === cn) return vec;
    }
    // Pass 2: substring containment (either direction)
    for (const [key, vec] of Object.entries(impacts) as [string, any][]) {
        const kn = key.toLowerCase().trim();
        if (cn.includes(kn) || kn.includes(cn)) return vec;
    }
    // Pass 3: any significant word overlap (ignore short words)
    for (const [key, vec] of Object.entries(impacts) as [string, any][]) {
        const kWords = key.toLowerCase().trim().split(/\s+/);
        const overlap = kWords.filter((w: any) => w.length > 3 && cnWords.some((cw: any) => cw.length > 3 && (cw.includes(w) || w.includes(cw))));
        if (overlap.length > 0) return vec;
    }
    return 0;
}

export function computeLxOverlay(interventions: any, curvesData: any) {
    const lxCurves = curvesData.map((curve: any) => {
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const polarity = curve.polarity || 'higher_is_better';

        // Compute max desired gap for scaling
        let maxDesiredGap = 0;
        const len = Math.min(blSmoothed.length, dsSmoothed.length);
        for (let j = 0; j < len; j++) {
            maxDesiredGap = Math.max(maxDesiredGap, Math.abs(dsSmoothed[j].value - blSmoothed[j].value));
        }
        if (maxDesiredGap < 1) maxDesiredGap = 1;

        return { baseline: blSmoothed, desired: dsSmoothed, polarity, maxDesiredGap, points: [] as any[] };
    });

    // Build a map of curve effect names → curve indices for multi-vector lookup
    const effectNameToIdx: any = {};
    curvesData.forEach((c: any, i: number) => {
        if (c.effect) effectNameToIdx[c.effect.toLowerCase()] = i;
    });

    // Compute raw pharmacokinetic contribution per curve using multi-vector impacts
    for (let ci = 0; ci < curvesData.length; ci++) {
        const lx = lxCurves[ci];
        const curveName = (curvesData[ci].effect || '').toLowerCase();
        const points: any[] = [];
        let maxRawEffect = 0;

        // Diagnostic: log which interventions match this curve
        const matchLog = interventions.map((iv: any) => {
            if (!iv.impacts || typeof iv.impacts !== 'object') return null;
            const val = matchImpactToCurve(iv.impacts, curveName);
            if (val === 0) return null;
            return `${iv.key}(${JSON.stringify(iv.impacts)}) → ${val}`;
        }).filter(Boolean);
        if (matchLog.length > 0) {
            console.log(`[Lx] Curve "${curveName}" matched:`, matchLog);
        } else {
            console.warn(`[Lx] Curve "${curveName}" — NO interventions matched. Impacts:`,
                interventions.map((iv: any) => ({ key: iv.key, impacts: iv.impacts })));
        }

        for (let j = 0; j < lx.baseline.length; j++) {
            const hourVal = lx.baseline[j].hour;
            const sampleMin = hourVal * 60;
            let rawEffect = 0;

            for (const iv of interventions) {
                const sub = iv.substance;
                if (!sub || !sub.pharma) continue;

                // Multi-vector: check impacts dictionary with fuzzy matching
                if (iv.impacts && typeof iv.impacts === 'object') {
                    const impactValue = matchImpactToCurve(iv.impacts, curveName);
                    if (impactValue === 0) continue;

                    const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
                    const scaledWave = baseWave * (iv.doseMultiplier || 1.0);
                    rawEffect += scaledWave * impactValue;
                } else {
                    // Legacy fallback: single targetEffect
                    const targetIdx = iv.targetCurveIdx != null
                        ? iv.targetCurveIdx
                        : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
                    if (targetIdx !== ci) continue;

                    const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
                    rawEffect += baseWave * (iv.doseMultiplier || 1.0);
                }
            }

            maxRawEffect = Math.max(maxRawEffect, Math.abs(rawEffect));
            points.push({ hour: hourVal, rawEffect });
        }

        // Normalize and apply to baseline
        const scaleFactor = maxRawEffect > 0 ? lx.maxDesiredGap / maxRawEffect : 0;

        lx.points = points.map((p: any, j: number) => {
            const baseVal = lx.baseline[j].value;
            const scaledEffect = p.rawEffect * scaleFactor;
            // Impact vectors from the LLM already encode direction (positive=up, negative=down),
            // so we always ADD — no polarity flip needed.
            const value = baseVal + scaledEffect;
            return { hour: p.hour, value: Math.max(0, Math.min(100, value)) };
        });
    }

    return lxCurves;
}

/**
 * Compute incremental Lx curve snapshots — one per substance "step" (grouped by dose time).
 * Uses a GLOBAL scale factor from the full intervention set so the Y-axis scale stays consistent.
 * Returns: [ { lxCurves: [...], step: [intervention, ...] }, ... ]
 */
export function computeIncrementalLxOverlay(interventions: any, curvesData: any) {
    // 1. Sort by time
    const sorted = [...interventions].sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);

    // 2. Each intervention is its own step (no grouping)
    const steps = sorted.map((iv: any) => [iv]);

    // 3. Pre-compute per-curve data: smoothed baseline/desired, maxDesiredGap
    const curveInfo = curvesData.map((curve: any) => {
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const polarity = curve.polarity || 'higher_is_better';
        let maxDesiredGap = 0;
        const len = Math.min(blSmoothed.length, dsSmoothed.length);
        for (let j = 0; j < len; j++) {
            maxDesiredGap = Math.max(maxDesiredGap, Math.abs(dsSmoothed[j].value - blSmoothed[j].value));
        }
        if (maxDesiredGap < 1) maxDesiredGap = 1;
        return { blSmoothed, dsSmoothed, polarity, maxDesiredGap };
    });

    // Build effect name → curve index map for multi-vector lookup
    const effectNameToIdx: any = {};
    curvesData.forEach((c: any, i: number) => {
        if (c.effect) effectNameToIdx[c.effect.toLowerCase()] = i;
    });

    // Helper: compute raw multi-vector effect for a single intervention on a given curve
    function ivRawEffect(iv: any, curveIdx: number, sampleMin: number) {
        const sub = iv.substance;
        if (!sub || !sub.pharma) return 0;
        const curveName = (curvesData[curveIdx].effect || '');

        if (iv.impacts && typeof iv.impacts === 'object') {
            const impactValue = matchImpactToCurve(iv.impacts, curveName);
            if (impactValue === 0) return 0;
            const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
            return baseWave * (iv.doseMultiplier || 1.0) * impactValue;
        } else {
            // Legacy fallback: single targetEffect
            const targetIdx = iv.targetCurveIdx != null
                ? iv.targetCurveIdx
                : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
            if (targetIdx !== curveIdx) return 0;
            const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
            return baseWave * (iv.doseMultiplier || 1.0);
        }
    }

    // 4. Compute GLOBAL scale factor using ALL interventions
    const globalScaleFactors = curveInfo.map((ci: any, curveIdx: number) => {
        let maxRawEffect = 0;
        for (let j = 0; j < ci.blSmoothed.length; j++) {
            const sampleMin = ci.blSmoothed[j].hour * 60;
            let rawEffect = 0;
            for (const iv of sorted) {
                rawEffect += ivRawEffect(iv, curveIdx, sampleMin);
            }
            maxRawEffect = Math.max(maxRawEffect, Math.abs(rawEffect));
        }
        return maxRawEffect > 0 ? ci.maxDesiredGap / maxRawEffect : 0;
    });

    // 5. For each step, compute cumulative curves
    const snapshots: any[] = [];
    for (let k = 0; k < steps.length; k++) {
        const activeInterventions = steps.slice(0, k + 1).flat();

        const lxCurves = curveInfo.map((ci: any, curveIdx: number) => {
            const points = ci.blSmoothed.map((bp: any, j: number) => {
                const sampleMin = bp.hour * 60;
                let rawEffect = 0;
                for (const iv of activeInterventions) {
                    rawEffect += ivRawEffect(iv, curveIdx, sampleMin);
                }
                const scaledEffect = rawEffect * globalScaleFactors[curveIdx];
                // Impact vectors already encode direction — always ADD.
                const value = bp.value + scaledEffect;
                return { hour: bp.hour, value: Math.max(0, Math.min(100, value)) };
            });
            return {
                baseline: ci.blSmoothed,
                desired: ci.dsSmoothed,
                polarity: ci.polarity,
                maxDesiredGap: ci.maxDesiredGap,
                points,
            };
        });

        snapshots.push({ lxCurves, step: steps[k] });
    }

    return snapshots;
}

// ============================================
// 20d. Lx RENDERING
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
                d: fillD, fill: color, class: 'phase-lx-fill', opacity: '0',
            });
            sub.appendChild(fillPath);
            fillPath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });
        }

        // Stroke path
        const strokeD = phasePointsToPath(lx.points, false);
        if (strokeD) {
            const strokePath = svgEl('path', {
                d: strokeD, stroke: color, class: 'phase-lx-path', opacity: '0',
            });
            sub.appendChild(strokePath);
            strokePath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });
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
    const progress = Math.max(0, Math.min(1, (playheadHour - startHour) / hourRange));
    const halfBlend = blendWidth / 2;

    // Move playhead visual
    const playheadX = phaseChartX(playheadHour * 60);
    phLine.setAttribute('x', playheadX.toFixed(1));
    phGlow.setAttribute('x', (playheadX - 8).toFixed(1));

    // Morph each curve's stroke
    for (const cd of curveAnimData) {
        if (!cd.strokeEl) continue;
        const morphedPts = buildProgressiveMorphPoints(
            cd.desiredPts, cd.lxSmoothed, playheadHour, blendWidth);
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

    // Update dots + connector lines to track morphed curve positions
    const dots = document.querySelectorAll('.timeline-curve-dot');
    const connectors = document.querySelectorAll('.timeline-connector');

    dots.forEach((dot: any) => {
        const ci = parseInt(dot.getAttribute('data-curve-idx'));
        const tH = parseFloat(dot.getAttribute('data-time-h'));
        const cd = curveAnimData[ci];
        if (!cd) return;
        let t;
        if (tH <= playheadHour - halfBlend) t = 1;
        else if (tH >= playheadHour + halfBlend) t = 0;
        else { const x = (playheadHour + halfBlend - tH) / blendWidth; t = x * x * (3 - 2 * x); }
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
        else { const x = (playheadHour + halfBlend - tH) / blendWidth; t = x * x * (3 - 2 * x); }
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
        width: '30', height: String(PHASE_CHART.plotH),
        fill: 'transparent', cursor: 'col-resize',
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
        x: (endX - 8).toFixed(1), y: String(PHASE_CHART.padT),
        width: '18', height: String(PHASE_CHART.plotH),
        fill: 'rgba(245, 200, 80, 0.04)', rx: '9', 'pointer-events': 'none',
    });
    playheadGroup.appendChild(phGlow);
    const phLine = svgEl('rect', {
        x: endX.toFixed(1), y: String(PHASE_CHART.padT),
        width: '2', height: String(PHASE_CHART.plotH),
        fill: 'rgba(245, 200, 80, 0.7)', rx: '0.75', 'pointer-events': 'none',
    });
    playheadGroup.appendChild(phLine);

    const tooltipOverlay = document.getElementById('phase-tooltip-overlay')!;
    svg.insertBefore(playheadGroup, tooltipOverlay);

    const state = {
        curveAnimData, blendWidth: 1.5,
        phLine, phGlow, arrows, arrowGroup,
        svg, playheadGroup,
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
            x: String(PHASE_CHART.padL - 8), y: String(PHASE_CHART.padT),
            width: '18', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.06)', rx: '9', 'pointer-events': 'none',
        });
        playheadGroup.appendChild(phGlow);
        const phLine = svgEl('rect', {
            x: String(PHASE_CHART.padL), y: String(PHASE_CHART.padT),
            width: '1.5', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.55)', rx: '0.75', 'pointer-events': 'none',
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
            curveAnimData, blendWidth: BLEND_WIDTH,
            phLine, phGlow, arrows, arrowGroup,
            svg, playheadGroup,
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

// ============================================
// 20d2. DESIRED CURVE TRANSMUTATION & SUBSTANCE TIMELINE
// ============================================

/**
 * After timeline re-render, re-render biometric strips if they exist.
 * This preserves strip visibility when renderSubstanceTimeline() resets the viewBox.
 */
export function preserveBiometricStrips() {
    const channels = BiometricState.channels;
    if (!channels || channels.length === 0) return;
    const bioGroup = document.getElementById('phase-biometric-strips');
    if (!bioGroup || bioGroup.children.length === 0) return;

    // Clear old bio clip-paths from defs
    const svg = document.getElementById('phase-chart-svg');
    if (svg) svg.querySelectorAll('defs [id^="bio-clip-"]').forEach(el => el.remove());

    // Re-render at correct position (instant = true, no clip animation)
    _renderBiometricStripsFn?.(channels, true);
}

/** Toggle desired curves to dashed/dim when Lx takes over */
export function transmuteDesiredCurves(transmute: any) {
    const desiredGroup = document.getElementById('phase-desired-curves') as HTMLElement | null;
    const arrowGroup = document.getElementById('phase-mission-arrows') as HTMLElement | null;
    if (!desiredGroup || !arrowGroup) return;

    if (transmute) {
        const isLight = document.body.classList.contains('light-mode');
        desiredGroup.querySelectorAll('.phase-desired-path').forEach((p: any) => {
            p.setAttribute('stroke-dasharray', '6 4');
        });
        // Move peak descriptors to overlay so they aren't dimmed by the group filter
        const overlay = document.getElementById('phase-tooltip-overlay')!;
        desiredGroup.querySelectorAll('.peak-descriptor').forEach((pd: any) => {
            pd.setAttribute('data-origin', 'phase-desired-curves');
            overlay.appendChild(pd);
        });
        desiredGroup.style.transition = 'filter 600ms ease';
        desiredGroup.style.filter = isLight
            ? 'opacity(0.35) saturate(0.5)'
            : 'brightness(0.45) saturate(0.5)';
        arrowGroup.style.transition = 'filter 600ms ease';
        arrowGroup.style.filter = isLight
            ? 'opacity(0.2) saturate(0.2)'
            : 'brightness(0.25) saturate(0.2)';
    } else {
        desiredGroup.querySelectorAll('.phase-desired-path').forEach((p: any) => {
            p.removeAttribute('stroke-dasharray');
        });
        // Move peak descriptors back from overlay to their correct sub-group (or parent)
        const overlay = document.getElementById('phase-tooltip-overlay')!;
        overlay.querySelectorAll('.peak-descriptor[data-origin="phase-desired-curves"]').forEach((pd: any) => {
            pd.removeAttribute('data-origin');
            const ei = pd.getAttribute('data-effect-idx');
            const sub = ei != null ? desiredGroup.querySelector(`#phase-desired-curves-e${ei}`) : null;
            (sub || desiredGroup).appendChild(pd);
        });
        desiredGroup.style.transition = 'filter 400ms ease';
        desiredGroup.style.filter = '';
        arrowGroup.style.transition = 'filter 400ms ease';
        arrowGroup.style.filter = '';
    }
}

/** Allocate swim lanes — pixel-space tight packing, no overlap */
export function allocateTimelineLanes(interventions: any) {
    const sorted = [...interventions].sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const pxGap = 3;
    const lanes: any[] = []; // each lane = array of { pxL, pxR }

    return sorted.map((iv: any) => {
        const sub = iv.substance;
        const dur = (sub && sub.pharma) ? sub.pharma.duration : 240;
        const startMin = iv.timeMinutes;
        const endMin = startMin + dur;

        const pxL = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const pxR = pxL + Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - pxL), plotRight - pxL);

        // Find first lane with no pixel overlap
        let laneIdx = 0;
        for (; laneIdx < lanes.length; laneIdx++) {
            const overlaps = lanes[laneIdx].some((o: any) => pxL < o.pxR + pxGap && pxR > o.pxL - pxGap);
            if (!overlaps) break;
        }
        if (!lanes[laneIdx]) lanes[laneIdx] = [];
        lanes[laneIdx].push({ pxL, pxR });

        return { iv, laneIdx, startMin, endMin, dur };
    });
}

/** Linear interpolation of Lx curve value at any minute (legacy wrapper) */
export function interpolateLxValue(lxCurve: any, timeMinutes: any) {
    return interpolatePointsAtTime(lxCurve.points, timeMinutes / 60);
}

/** Render FCP-style substance timeline below the chart */
export function renderSubstanceTimeline(interventions: any, lxCurves: any, curvesData: any) {
    const group = document.getElementById('phase-substance-timeline')!;
    group.innerHTML = '';
    if (!interventions || interventions.length === 0) return;

    const svg = document.getElementById('phase-chart-svg')!;
    const defs = svg.querySelector('defs')!;

    // Clean up old timeline clip-paths and gradients
    defs.querySelectorAll('[id^="tl-clip-"], [id^="tl-grad-"]').forEach(el => el.remove());

    // Thin separator line
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(TIMELINE_ZONE.separatorY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(TIMELINE_ZONE.separatorY),
        class: 'timeline-separator',
    }));

    const allocated = allocateTimelineLanes(interventions);

    // Compute layout
    const laneCount = allocated.reduce((max: number, a: any) => Math.max(max, a.laneIdx + 1), 0);
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const neededH = TIMELINE_ZONE.top + laneCount * laneStep + TIMELINE_ZONE.bottomPad;
    const finalH = Math.max(500, neededH);
    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${finalH}`);

    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const plotLeft = PHASE_CHART.padL;

    // Alternating track backgrounds (FCP-style lane stripes)
    const tlTheme = chartTheme();
    const laneStripeFill = document.body.classList.contains('light-mode')
        ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)';
    for (let i = 0; i < laneCount; i++) {
        const y = TIMELINE_ZONE.top + i * laneStep;
        if (i % 2 === 1) {
            group.appendChild(svgEl('rect', {
                x: String(plotLeft), y: y.toFixed(1),
                width: String(PHASE_CHART.plotW), height: String(TIMELINE_ZONE.laneH),
                fill: laneStripeFill, 'pointer-events': 'none',
            }));
        }
    }

    // Render connector lines + bars
    const plotTop = PHASE_CHART.padT;
    const plotBot = PHASE_CHART.padT + PHASE_CHART.plotH;

    allocated.forEach((item: any, idx: number) => {
        const { iv, laneIdx, startMin, endMin } = item;
        const sub = iv.substance;
        const color = sub ? sub.color : 'rgba(245,180,60,0.7)';

        const x1 = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const barW = Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - x1), plotRight - x1);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const h = TIMELINE_ZONE.laneH;
        const rx = TIMELINE_ZONE.pillRx;

        const pillG = svgEl('g', {
            class: 'timeline-pill-group', opacity: '0',
            'data-substance-key': iv.key,
            'data-time-minutes': String(iv.timeMinutes),
        });

        // SVG tooltip (hover title)
        if (sub) {
            const ttConf = (sub.dataConfidence || '').toLowerCase();
            const ttWarn = (ttConf === 'estimated' || ttConf === 'medium') ? `\n\u26A0\uFE0F ${sub.dataNote || 'Clinical estimation'}` : '';
            const titleEl = svgEl('title');
            titleEl.textContent = `${sub.name} — ${sub.class || ''}\nDose: ${iv.dose || sub.standardDose || ''}${ttWarn}`;
            pillG.appendChild(titleEl);
        }

        // Connector line from bar up to the targeted curve
        const targetIdx = iv.targetCurveIdx != null ? iv.targetCurveIdx : 0;
        const hasLxData = lxCurves && lxCurves[targetIdx];
        const curveColor = (curvesData && curvesData[targetIdx] && curvesData[targetIdx].color) || color;

        // Place dot/connector at DESIRED curve position initially (curves haven't morphed yet)
        const timeH = iv.timeMinutes / 60;
        let connectorTopY = plotBot; // fallback: bottom of chart
        if (hasLxData) {
            const desiredVal = interpolatePointsAtTime(lxCurves[targetIdx].desired, timeH);
            connectorTopY = phaseChartY(desiredVal);
        }

        // Dashed connector line from bar to curve
        pillG.appendChild(svgEl('line', {
            x1: x1.toFixed(1), y1: connectorTopY.toFixed(1),
            x2: x1.toFixed(1), y2: String(y),
            stroke: curveColor, 'stroke-opacity': '0.25', 'stroke-width': '0.75',
            'stroke-dasharray': '2 3',
            class: 'timeline-connector', 'pointer-events': 'none',
            'data-curve-idx': String(targetIdx),
            'data-time-h': timeH.toFixed(4),
        }));

        // Dot on curve at administration point
        if (hasLxData) {
            pillG.appendChild(svgEl('circle', {
                cx: x1.toFixed(1), cy: connectorTopY.toFixed(1), r: '3',
                fill: curveColor, 'fill-opacity': '0.65',
                stroke: curveColor, 'stroke-opacity': '0.9', 'stroke-width': '0.5',
                class: 'timeline-curve-dot', 'pointer-events': 'none',
                'data-curve-idx': String(targetIdx),
                'data-time-h': timeH.toFixed(4),
            }));
        }

        // Clip-path to contain label inside bar
        const clipId = `tl-clip-${idx}`;
        const clip = svgEl('clipPath', { id: clipId });
        clip.appendChild(svgEl('rect', {
            x: x1.toFixed(1), y: y.toFixed(1),
            width: barW.toFixed(1), height: String(h),
            rx: String(rx), ry: String(rx),
        }));
        defs.appendChild(clip);

        // Solid colored bar with border
        pillG.appendChild(svgEl('rect', {
            x: x1.toFixed(1), y: y.toFixed(1),
            width: barW.toFixed(1), height: String(h),
            rx: String(rx), ry: String(rx),
            fill: color, 'fill-opacity': '0.22',
            stroke: color, 'stroke-opacity': '0.45', 'stroke-width': '0.75',
            class: 'timeline-bar',
        }));

        // Clipped label inside bar
        const contentG = svgEl('g', { 'clip-path': `url(#${clipId})` });
        const name = sub ? sub.name : iv.key;
        const dose = iv.dose || (sub ? sub.standardDose : '') || '';
        const conf = sub ? (sub.dataConfidence || '') : '';
        const warnIcon = (conf.toLowerCase() === 'estimated' || conf.toLowerCase() === 'medium') ? ' \u26A0\uFE0F' : '';
        const label = svgEl('text', {
            x: (x1 + 5).toFixed(1),
            y: (y + h / 2 + 3).toFixed(1),
            class: 'timeline-bar-label',
        });
        label.textContent = dose ? `${name} ${dose}${warnIcon}` : `${name}${warnIcon}`;
        contentG.appendChild(label);
        pillG.appendChild(contentG);

        group.appendChild(pillG);
    });
}

/** Instantly show all timeline pills (used after re-render outside initial sequential flow) */
export function revealTimelinePillsInstant() {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;
    group.querySelectorAll('.timeline-pill-group').forEach((pill: any) => {
        pill.setAttribute('opacity', '1');
    });
}

/** Progressive left→right reveal for timeline pills */
export function animateTimelineReveal(duration: any) {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;
    const pills = group.querySelectorAll('.timeline-pill-group');
    if (pills.length === 0) return;

    pills.forEach((pill: any) => {
        // Get the x position of the bar (first rect child)
        const bar = pill.querySelector('rect');
        if (!bar) return;
        const xPos = parseFloat(bar.getAttribute('x') || '0');
        const xNorm = (xPos - PHASE_CHART.padL) / PHASE_CHART.plotW;
        const delay = Math.max(0, xNorm) * duration * 0.8;

        pill.setAttribute('opacity', '0');
        pill.style.transition = '';
        setTimeout(() => {
            pill.animate(
                [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
                { duration: 400, fill: 'forwards', easing: 'ease-out' }
            );
        }, delay);
    });
}

// ============================================
// 20d3. SEQUENTIAL SUBSTANCE LAYERING
// ============================================

/**
 * Animate the sequential Lx reveal — one substance (step) at a time.
 * Each step: substance label → timeline pill → playhead sweep → pause.
 * The "active" curve progressively modifies from baseline toward desired.
 */
export async function animateSequentialLxReveal(snapshots: any, interventions: any, curvesData: any) {
    const svg = document.getElementById('phase-chart-svg')!;
    const baseGroup = document.getElementById('phase-baseline-curves')!;
    const desiredGroup = document.getElementById('phase-desired-curves')!;
    const arrowGroup = document.getElementById('phase-mission-arrows')!;
    const timelineGroup = document.getElementById('phase-substance-timeline')!;
    const lxGroup = document.getElementById('phase-lx-curves')!;

    // Dim desired curves to ghost AUC reference
    transmuteDesiredCurves(true);
    await sleep(400);

    // Clear any previous Lx curves and AUC bands
    lxGroup.innerHTML = '';
    const bandsGroup = document.getElementById('phase-lx-bands')!;
    bandsGroup.innerHTML = '';

    // Prepare the timeline zone (separator + lane backgrounds) but NO pills yet
    timelineGroup.innerHTML = '';
    const defs = svg.querySelector('defs')!;
    defs.querySelectorAll('[id^="tl-clip-"], [id^="tl-grad-"]').forEach(el => el.remove());

    timelineGroup.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(TIMELINE_ZONE.separatorY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(TIMELINE_ZONE.separatorY),
        class: 'timeline-separator',
    }));

    const allocated = allocateTimelineLanes(interventions);
    const laneCount = allocated.reduce((max: number, a: any) => Math.max(max, a.laneIdx + 1), 0);
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const neededH = TIMELINE_ZONE.top + laneCount * laneStep + TIMELINE_ZONE.bottomPad;
    const finalH = Math.max(500, neededH);
    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${finalH}`);

    for (let i = 0; i < laneCount; i++) {
        const y = TIMELINE_ZONE.top + i * laneStep;
        if (i % 2 === 1) {
            timelineGroup.appendChild(svgEl('rect', {
                x: String(PHASE_CHART.padL), y: y.toFixed(1),
                width: String(PHASE_CHART.plotW), height: String(TIMELINE_ZONE.laneH),
                fill: 'rgba(255,255,255,0.02)', 'pointer-events': 'none',
            }));
        }
    }

    // Fade arrows out
    Array.from(arrowGroup.children).forEach((a: any) => {
        a.animate([{ opacity: parseFloat(a.getAttribute('opacity') || '0.7') }, { opacity: 0 }], {
            duration: 600, fill: 'forwards',
        });
    });

    // Create NEW Lx stroke + fill paths in the lxGroup, starting at baseline position.
    const lxStrokes: any[] = [];
    const lxFills: any[] = [];
    const baselinePts = curvesData.map((c: any) => smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES));
    for (let ci = 0; ci < curvesData.length; ci++) {
        const curve = curvesData[ci];
        const initD = phasePointsToPath(baselinePts[ci], true);
        const initFillD = phasePointsToFillPath(baselinePts[ci], true);
        const lxFill = svgEl('path', {
            d: initFillD, fill: curve.color, 'fill-opacity': '0',
            class: 'phase-lx-fill',
        });
        lxGroup.appendChild(lxFill);
        lxFills.push(lxFill);
        const lxStroke = svgEl('path', {
            d: initD, fill: 'none', stroke: curve.color,
            'stroke-width': '2.2', 'stroke-opacity': '0.9',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            class: 'phase-lx-path',
        });
        lxGroup.appendChild(lxStroke);
        lxStrokes.push(lxStroke);
    }

    // Dim baseline strokes to ghost reference (keep dashed)
    const baselineStrokesAll = baseGroup.querySelectorAll('.phase-baseline-path');
    baselineStrokesAll.forEach((s: any) => {
        if (!s) return;
        s.style.transition = 'stroke-opacity 400ms ease';
        s.setAttribute('stroke-opacity', '0.25');
    });

    // Fade out desired fills so only the Lx fills are visible as the area reference
    desiredGroup.querySelectorAll('.phase-desired-fill').forEach((f: any) => {
        f.animate([{ fillOpacity: parseFloat(f.getAttribute('fill-opacity') || '0.08') }, { fillOpacity: 0 }], {
            duration: 600, fill: 'forwards',
        });
    });

    // Also fade out baseline fills (the Lx fills replace them)
    baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)').forEach((f: any) => {
        f.animate([{ fillOpacity: parseFloat(f.getAttribute('fill-opacity') || '0.04') }, { fillOpacity: 0 }], {
            duration: 600, fill: 'forwards',
        });
    });

    // Track current smoothed points per curve (Lx strokes start at baseline)
    let currentPts = baselinePts.map((pts: any) => pts.map((p: any) => ({ ...p })));

    // Fade baseline peak descriptors
    baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
        el.style.transition = 'opacity 300ms ease';
        el.style.opacity = '0';
    });

    const finalLxCurves = snapshots[snapshots.length - 1].lxCurves;
    const plotBot = PHASE_CHART.padT + PHASE_CHART.plotH;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;

    // Helper: render a single substance's timeline pill
    function renderSinglePill(iv: any) {
        const alloc = allocated.find((a: any) => a.iv === iv);
        if (!alloc) return null;
        const { laneIdx, startMin, endMin } = alloc;
        const sub = iv.substance;
        const color = sub ? sub.color : 'rgba(245,180,60,0.7)';

        const x1 = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const barW = Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - x1), plotRight - x1);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const h = TIMELINE_ZONE.laneH;
        const rx = TIMELINE_ZONE.pillRx;

        const pillG = svgEl('g', {
            class: 'timeline-pill-group', opacity: '0',
            'data-substance-key': iv.key,
            'data-time-minutes': String(iv.timeMinutes),
        });

        // SVG tooltip (hover title)
        if (sub) {
            const ttConf = (sub.dataConfidence || '').toLowerCase();
            const ttWarn = (ttConf === 'estimated' || ttConf === 'medium') ? `\n\u26A0\uFE0F ${sub.dataNote || 'Clinical estimation'}` : '';
            const titleEl = svgEl('title');
            titleEl.textContent = `${sub.name} — ${sub.class || ''}\nDose: ${iv.dose || sub.standardDose || ''}${ttWarn}`;
            pillG.appendChild(titleEl);
        }

        const targetIdx = iv.targetCurveIdx != null ? iv.targetCurveIdx : 0;
        const hasLxData = finalLxCurves && finalLxCurves[targetIdx];
        const curveColor = (curvesData && curvesData[targetIdx] && curvesData[targetIdx].color) || color;
        const timeH = iv.timeMinutes / 60;
        let connectorTopY = plotBot;
        if (hasLxData) {
            const desiredVal = interpolatePointsAtTime(finalLxCurves[targetIdx].desired, timeH);
            connectorTopY = phaseChartY(desiredVal);
        }

        pillG.appendChild(svgEl('line', {
            x1: x1.toFixed(1), y1: connectorTopY.toFixed(1),
            x2: x1.toFixed(1), y2: String(y),
            stroke: curveColor, 'stroke-opacity': '0.25', 'stroke-width': '0.75',
            'stroke-dasharray': '2 3',
            class: 'timeline-connector', 'pointer-events': 'none',
            'data-curve-idx': String(targetIdx), 'data-time-h': timeH.toFixed(3),
        }));

        pillG.appendChild(svgEl('circle', {
            cx: x1.toFixed(1), cy: connectorTopY.toFixed(1), r: '2.5',
            fill: curveColor, 'fill-opacity': '0.6',
            class: 'timeline-curve-dot', 'pointer-events': 'none',
            'data-curve-idx': String(targetIdx), 'data-time-h': timeH.toFixed(3),
        }));

        pillG.appendChild(svgEl('rect', {
            x: x1.toFixed(1), y: y.toFixed(1),
            width: barW.toFixed(1), height: String(h),
            rx: String(rx), fill: color, 'fill-opacity': '0.18',
            stroke: color, 'stroke-opacity': '0.35', 'stroke-width': '0.75',
        }));

        const conf = sub ? (sub.dataConfidence || '') : '';
        const warnIcon = (conf.toLowerCase() === 'estimated' || conf.toLowerCase() === 'medium') ? ' \u26A0\uFE0F' : '';
        const labelText = `${sub?.name || iv.key}  ${iv.dose || (sub?.standardDose || '')}${warnIcon}`;
        pillG.appendChild(svgEl('text', {
            x: (x1 + 6).toFixed(1),
            y: (y + h / 2 + 3.5).toFixed(1),
            class: 'timeline-bar-label',
            fill: color, 'font-size': '9',
        })).textContent = labelText;

        timelineGroup.appendChild(pillG);
        return pillG;
    }

    // Iterate through each step — one substance at a time
    for (let k = 0; k < snapshots.length; k++) {
        const snapshot = snapshots[k];
        const step = snapshot.step;
        const targetPts = snapshot.lxCurves.map((lx: any) =>
            (lx.points || []).map((p: any) => ({ ...p }))
        );

        // 1. Show substance label
        const labelNames = step.map((iv: any) => {
            const name = iv.substance?.name || iv.key;
            return `${name} · ${iv.dose || ''}`;
        }).join('  +  ');

        const labelEl = svgEl('text', {
            x: (PHASE_CHART.padL + PHASE_CHART.plotW / 2).toFixed(1),
            y: (PHASE_CHART.padT + 22).toFixed(1),
            class: 'substance-step-label',
            opacity: '0',
            'letter-spacing': '0.06em',
        });
        labelEl.textContent = labelNames;
        svg.appendChild(labelEl);

        labelEl.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 200, fill: 'forwards',
        });

        // 3. Render and reveal this substance's timeline pill
        for (let pi = 0; pi < step.length; pi++) {
            const pill = renderSinglePill(step[pi]);
            if (pill) {
                setTimeout(() => {
                    pill.animate([
                        { opacity: 0, transform: 'translateY(4px)' },
                        { opacity: 1, transform: 'translateY(0)' },
                    ], { duration: 300, fill: 'forwards', easing: 'ease-out' });
                }, pi * 100);
            }
        }

        await sleep(350);

        // 4. Playhead sweep — morph curves with slow-mo near onset→peak
        const BASE_SWEEP = Math.max(1200, 2500 - k * 250);
        const BLEND_WIDTH = 1.5;
        const startHour = PHASE_CHART.startHour;
        const endHour = PHASE_CHART.endHour;
        const hourRange = endHour - startHour;

        // --- Time-warp: build speed multiplier LUT (1 = normal, >1 = slow-mo) ---
        const WARP_SAMPLES = 256;
        const warpMult = new Float64Array(WARP_SAMPLES); // speed multiplier per sample
        warpMult.fill(1);
        const SLOWMO_FACTOR = 8;
        const SIGMA_ENTRY = 0.06; // tight entry
        const SIGMA_EXIT = 0.10;  // gradual exit
        for (const iv of step) {
            const pharma = iv.substance?.pharma;
            if (!pharma) continue;
            const onsetHour = (iv.timeMinutes + pharma.onset) / 60;
            const peakHour = (iv.timeMinutes + pharma.peak) / 60;
            const focusHour = (onsetHour + peakHour) / 2;
            const focusNorm = (focusHour - startHour) / hourRange;
            for (let i = 0; i < WARP_SAMPLES; i++) {
                const n = i / (WARP_SAMPLES - 1);
                const d = n - focusNorm;
                const sigma = d < 0 ? SIGMA_ENTRY : SIGMA_EXIT;
                const g = Math.exp(-(d * d) / (2 * sigma * sigma));
                warpMult[i] = Math.max(warpMult[i], 1 + (SLOWMO_FACTOR - 1) * g);
            }
        }
        // Integrate to get cumulative "warp time" and total
        const warpCum = new Float64Array(WARP_SAMPLES);
        warpCum[0] = 0;
        for (let i = 1; i < WARP_SAMPLES; i++) {
            warpCum[i] = warpCum[i - 1] + warpMult[i - 1];
        }
        const warpTotal = warpCum[WARP_SAMPLES - 1] + warpMult[WARP_SAMPLES - 1];
        const sweepDuration = BASE_SWEEP * (warpTotal / WARP_SAMPLES);

        // Map wall-clock fraction [0,1] → warped hour position
        function warpedHour(wallT: number): number {
            const targetCum = wallT * warpTotal;
            let lo = 0, hi = WARP_SAMPLES - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (warpCum[mid + 1] <= targetCum) lo = mid + 1; else hi = mid;
            }
            const segStart = warpCum[lo];
            const segLen = warpMult[lo];
            const frac = segLen > 0 ? (targetCum - segStart) / segLen : 0;
            const norm = (lo + frac) / (WARP_SAMPLES - 1);
            return startHour + hourRange * norm;
        }

        // Slow-mo intensity at a given hour (0 = normal, 1 = peak slowmo)
        function slowmoIntensity(hour: number): number {
            const norm = (hour - startHour) / hourRange;
            const idx = Math.min(WARP_SAMPLES - 1, Math.max(0, Math.round(norm * (WARP_SAMPLES - 1))));
            return Math.min(1, (warpMult[idx] - 1) / (SLOWMO_FACTOR - 1));
        }

        // --- Playhead visuals ---
        const playheadGroup = svgEl('g', { class: 'sequential-playhead' });
        const phGlow = svgEl('rect', {
            x: String(PHASE_CHART.padL - 8), y: String(PHASE_CHART.padT),
            width: '18', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.06)', rx: '9', 'pointer-events': 'none',
        });
        playheadGroup.appendChild(phGlow);
        const phLine = svgEl('rect', {
            x: String(PHASE_CHART.padL), y: String(PHASE_CHART.padT),
            width: '1.5', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.55)', rx: '0.75', 'pointer-events': 'none',
        });
        playheadGroup.appendChild(phLine);

        // --- Push chevron ---
        const chevronGroup = svgEl('g', { 'pointer-events': 'none', opacity: '0' });
        const chevArrow = svgEl('path', {
            d: 'M -8 -10 L 0 2 L 8 -10',
            fill: 'none', 'stroke-width': '2.5',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            stroke: 'rgba(245, 200, 80, 0.8)', 'pointer-events': 'none',
        });
        chevronGroup.appendChild(chevArrow);
        const chevArrowInner = svgEl('path', {
            d: 'M -4.5 -5.5 L 0 1 L 4.5 -5.5',
            fill: 'none', 'stroke-width': '1.5',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            stroke: 'rgba(255, 255, 255, 0.6)', 'pointer-events': 'none',
        });
        chevronGroup.appendChild(chevArrowInner);
        playheadGroup.appendChild(chevronGroup);

        svg.appendChild(playheadGroup);

        const sourcePts = currentPts.map((pts: any) => pts.map((p: any) => ({ ...p })));

        // 4a. Pre-create AUC band paths clipped to the playhead position
        const bandClipId = `lx-band-clip-${k}`;
        const bandClip = svgEl('clipPath', { id: bandClipId });
        const bandClipRect = svgEl('rect', {
            x: String(PHASE_CHART.padL), y: '0',
            width: '0', height: '1200',
        });
        bandClip.appendChild(bandClipRect);
        defs.appendChild(bandClip);

        const stepBands: Element[] = [];
        for (let ci = 0; ci < curvesData.length; ci++) {
            const bandD = phaseBandPath(targetPts[ci], sourcePts[ci]);
            if (!bandD) continue;
            const substanceColor = step[0].substance?.color || curvesData[ci].color;
            const band = svgEl('path', {
                d: bandD,
                fill: substanceColor,
                'fill-opacity': '0.18',
                class: 'lx-auc-band',
                'clip-path': `url(#${bandClipId})`,
                'data-substance-key': step[0].key,
                'data-step-idx': String(k),
                'data-curve-idx': String(ci),
            });
            bandsGroup.appendChild(band);
            stepBands.push(band);
        }

        // Chevron tracking state (lerped for smooth motion)
        let chevY = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
        let chevOpacity = 0;

        await new Promise<void>(resolveSweep => {
            const sweepStart = performance.now();

            (function tick(now: number) {
                const rawT = Math.min(1, (now - sweepStart) / sweepDuration);
                const playheadHour = warpedHour(rawT);
                const smo = slowmoIntensity(playheadHour);

                const playheadX = phaseChartX(playheadHour * 60);

                // Playhead intensification during slow-mo
                const lineW = 1.5 + smo * 1.5;
                const lineOp = 0.55 + smo * 0.35;
                const glowOp = 0.06 + smo * 0.10;
                phLine.setAttribute('x', (playheadX - lineW / 2).toFixed(1));
                phLine.setAttribute('width', lineW.toFixed(2));
                phLine.setAttribute('fill', `rgba(245, 200, 80, ${lineOp.toFixed(2)})`);
                phGlow.setAttribute('x', (playheadX - 9).toFixed(1));
                phGlow.setAttribute('fill', `rgba(245, 200, 80, ${glowOp.toFixed(2)})`);

                // Wipe-reveal the AUC band in sync with the playhead
                bandClipRect.setAttribute('width', (playheadX - PHASE_CHART.padL).toFixed(1));

                // Morph Lx STROKES + FILLS
                for (let ci = 0; ci < curvesData.length; ci++) {
                    const morphed = buildProgressiveMorphPoints(
                        sourcePts[ci], targetPts[ci], playheadHour, BLEND_WIDTH
                    );
                    const strokeD = phasePointsToPath(morphed, true);
                    if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                    if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
                }

                // --- Push chevron: find curve with biggest delta at playhead ---
                let bestDelta = 0;
                let bestTargetY = chevY;
                let bestPushDown = false;
                let bestColor = 'rgba(245, 200, 80, 0.8)';
                for (let ci = 0; ci < curvesData.length; ci++) {
                    if (!sourcePts[ci] || !targetPts[ci]) continue;
                    const srcVal = interpolatePointsAtTime(sourcePts[ci], playheadHour);
                    const tgtVal = interpolatePointsAtTime(targetPts[ci], playheadHour);
                    const delta = Math.abs(tgtVal - srcVal);
                    if (delta > bestDelta) {
                        bestDelta = delta;
                        bestTargetY = phaseChartY(tgtVal);
                        bestPushDown = tgtVal < srcVal;
                        bestColor = curvesData[ci].color || bestColor;
                    }
                }

                // Chevron sizing: scales with delta, extra boost in slow-mo
                const baseScale = Math.min(2.2, 0.7 + bestDelta / 15);
                const chevScale = baseScale + smo * 0.5;
                const pushOffset = (10 + bestDelta * 0.25) * chevScale;
                const targetChevY = bestPushDown
                    ? bestTargetY + pushOffset
                    : bestTargetY - pushOffset;

                // Lerp chevron Y for smooth tracking
                chevY += (targetChevY - chevY) * 0.25;

                // Brightness ramps with delta intensity (dramatizes the effect)
                const intensity = Math.min(1, bestDelta / 12);
                const targetOp = bestDelta > 0.5 ? 0.3 + intensity * 0.7 : 0;
                chevOpacity += (targetOp - chevOpacity) * 0.2;
                chevronGroup.setAttribute('opacity', chevOpacity.toFixed(3));

                // Outer stroke brightens with intensity
                const outerOp = (0.4 + intensity * 0.6).toFixed(2);
                const outerW = (2.0 + intensity * 1.5).toFixed(1);
                chevArrow.setAttribute('stroke', bestColor);
                chevArrow.setAttribute('stroke-opacity', outerOp);
                chevArrow.setAttribute('stroke-width', outerW);
                // Inner bright core — visible at higher intensity
                const innerOp = (intensity * 0.8).toFixed(2);
                chevArrowInner.setAttribute('stroke-opacity', innerOp);

                // Position & orient chevron
                const flipY = bestPushDown ? -1 : 1;
                chevronGroup.setAttribute('transform',
                    `translate(${playheadX.toFixed(1)}, ${chevY.toFixed(1)}) scale(${chevScale.toFixed(2)}, ${(flipY * chevScale).toFixed(2)})`);

                if (rawT < 1) {
                    requestAnimationFrame(tick);
                } else {
                    for (let ci = 0; ci < curvesData.length; ci++) {
                        const strokeD = phasePointsToPath(targetPts[ci], true);
                        if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                        if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(targetPts[ci], true));
                    }
                    resolveSweep();
                }
            })(performance.now());
        });

        playheadGroup.remove();

        // Remove clip so band is fully visible and interactive
        stepBands.forEach(b => b.removeAttribute('clip-path'));
        bandClip.remove();

        currentPts = targetPts;

        // 5. Fade out substance label
        labelEl.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 200, fill: 'forwards',
        });
        setTimeout(() => labelEl.remove(), 250);

        // 6. Pause between steps (skip for last)
        if (k < snapshots.length - 1) {
            await sleep(400);
        }
    }

    // After all steps: update dots/connectors to final positions
    const dots = document.querySelectorAll('.timeline-curve-dot');
    const connectors = document.querySelectorAll('.timeline-connector');

    dots.forEach((dot: any) => {
        const ci = parseInt(dot.getAttribute('data-curve-idx'));
        const tH = parseFloat(dot.getAttribute('data-time-h'));
        const lxPts = finalLxCurves[ci]?.points || [];
        const val = interpolatePointsAtTime(lxPts, tH);
        dot.setAttribute('cy', phaseChartY(val).toFixed(1));
    });

    connectors.forEach((conn: any) => {
        const ci = parseInt(conn.getAttribute('data-curve-idx'));
        const tH = parseFloat(conn.getAttribute('data-time-h'));
        const lxPts = finalLxCurves[ci]?.points || [];
        const val = interpolatePointsAtTime(lxPts, tH);
        conn.setAttribute('y1', phaseChartY(val).toFixed(1));
    });

    // Re-place peak descriptors at final Lx positions
    baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
    const lxCurvesForLabels = curvesData.map((c: any, i: number) => ({
        ...c,
        desired: finalLxCurves[i].points,
    }));
    placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);

    // Attach bidirectional hover between AUC bands and timeline pills
    attachBandHoverListeners();
}

// ============================================
// 20d4. AUC BAND ↔ TIMELINE PILL HOVER WIRING
// ============================================

function clearBandHoverClasses() {
    document.querySelectorAll('.lx-auc-band.band-dim, .lx-auc-band.band-highlight').forEach((el) => {
        el.classList.remove('band-dim', 'band-highlight');
    });
    document.querySelectorAll('.timeline-pill-group.pill-dim, .timeline-pill-group.pill-highlight').forEach((el) => {
        el.classList.remove('pill-dim', 'pill-highlight');
    });
}

export function attachBandHoverListeners() {
    const bands = document.querySelectorAll('.lx-auc-band');
    const pills = document.querySelectorAll('.timeline-pill-group');

    bands.forEach((band) => {
        band.addEventListener('mouseenter', () => {
            const key = band.getAttribute('data-substance-key');
            bands.forEach((b) => {
                if (b.getAttribute('data-substance-key') === key) {
                    b.classList.add('band-highlight');
                } else {
                    b.classList.add('band-dim');
                }
            });
            pills.forEach((p) => {
                if (p.getAttribute('data-substance-key') === key) {
                    p.classList.add('pill-highlight');
                } else {
                    p.classList.add('pill-dim');
                }
            });
        });
        band.addEventListener('mouseleave', clearBandHoverClasses);
    });

    pills.forEach((pill) => {
        pill.addEventListener('mouseenter', () => {
            const key = pill.getAttribute('data-substance-key');
            bands.forEach((b) => {
                if (b.getAttribute('data-substance-key') === key) {
                    b.classList.add('band-highlight');
                } else {
                    b.classList.add('band-dim');
                }
            });
            pills.forEach((p) => {
                if (p.getAttribute('data-substance-key') === key) {
                    p.classList.add('pill-highlight');
                } else {
                    p.classList.add('pill-dim');
                }
            });
        });
        pill.addEventListener('mouseleave', clearBandHoverClasses);
    });
}

// ============================================
// 20e. Lx ORCHESTRATION
// ============================================

export function showLxButton() {
    const btn = document.getElementById('phase-lx-btn')!;
    btn.classList.remove('hidden');
    requestAnimationFrame(() => btn.classList.add('visible'));
}

export function hideLxButton() {
    const btn = document.getElementById('phase-lx-btn')!;
    btn.classList.remove('visible');
    setTimeout(() => btn.classList.add('hidden'), 500);
}

export async function handleLxPhase(curvesData: any) {
    // Show Lx button after 500ms delay
    await sleep(500);
    showLxButton();
    PhaseState.phase = 'lx-ready';

    // Wait for user to click Lx
    await new Promise<void>(resolve => {
        document.getElementById('phase-lx-btn')!.addEventListener('click', async () => {
            hideLxButton();

            // Start timeline scan line while waiting for intervention model
            _startTimelineScanLineFn?.(3);

            // Await intervention result (likely already cached from background call)
            let interventionData = PhaseState.interventionResult;
            if (!interventionData && PhaseState.interventionPromise) {
                interventionData = await PhaseState.interventionPromise;
            }

            // Stop scan line — LLM has returned
            _stopTimelineScanLineFn?.();

            if (!interventionData) {
                console.error('[Lx] No intervention data — model call failed or no API key.');
                resolve();
                return;
            }

            PhaseState.interventionResult = interventionData;

            // Validate interventions
            const interventions = validateInterventions(interventionData.interventions || [], curvesData);
            if (interventions.length === 0) {
                resolve();
                return;
            }

            // Compute pharmacokinetic overlay
            const lxCurves = computeLxOverlay(interventions, curvesData);
            PhaseState.lxCurves = lxCurves;

            // Render with playhead morph reveal
            await animateLxReveal(lxCurves, curvesData, interventions);

            PhaseState.phase = 'lx-rendered';
            PhaseState.maxPhaseReached = 2;
            PhaseState.viewingPhase = 2;
            _updateStepButtonsFn?.();

            // Show biometric trigger after Lx completes
            await sleep(600);
            _showBiometricTriggerFn?.();

            resolve();
        }, { once: true });
    });
}
