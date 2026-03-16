/**
 * Curve Sculptor — Interactive Lx curve dragging with real-time substance matching.
 * Investor demo feature: drag the Lx curves, substances re-match in real time.
 *
 * Matching is spatially-aware and effect-typed:
 *   - Dragging the curve UP at hour H means "I need more effect here"
 *   - We find substances whose class matches the active curve's effect type
 *   - Substances are placed so their peak aligns with the drag region
 *   - The strip updates in real time as you drag
 *
 * Exports: activateCurveSculptor, deactivateCurveSculptor, isSculptorActive, refreshSculptorRxFilter
 * Depends on: constants, utils, curve-utils, lx-system (barrel), substances
 */

import { PHASE_CHART, EFFECT_TYPES } from './constants';
import { phaseChartX, phaseChartY, clamp } from './utils';
import { phasePointsToPath, phasePointsToFillPath } from './curve-utils';
import { substanceEffectAt, renderSubstanceTimeline, revealTimelinePillsInstant } from './lx-system';
import { getActiveSubstances } from './substances';

// ============================================
// Constants
// ============================================

const DRAG_FALLOFF_WEIGHTS = [1, 0.78, 0.48, 0.22, 0.05];
const UPDATE_THROTTLE_MS = 80; // faster for real-time feel
const DELTA_THRESHOLD = 4; // minimum delta to spawn a substance at a time slot

// ============================================
// Module state
// ============================================

interface SculptorState {
    active: boolean;
    originalLxCurves: any[] | null;
    curvesData: any[] | null;
    originalInterventions: any[] | null;
    /** Working copy of curve points — mutated during drag. */
    sculptedCurves: any[][] | null;
    /** Which curve index is currently being dragged. */
    activeCurveIdx: number | null;
    dragDotIdx: number | null;
    dragOriginalValues: number[] | null;
    updateTimer: ReturnType<typeof setTimeout> | null;
    cleanupFns: (() => void)[];
}

const state: SculptorState = {
    active: false,
    originalLxCurves: null,
    curvesData: null,
    originalInterventions: null,
    sculptedCurves: null,
    activeCurveIdx: null,
    dragDotIdx: null,
    dragOriginalValues: null,
    updateTimer: null,
    cleanupFns: [],
};

// ============================================
// Public API
// ============================================

export function isSculptorActive(): boolean {
    return state.active;
}

export function activateCurveSculptor(lxCurves: any[], curvesData: any[], currentInterventions: any[]): void {
    if (state.active) return;

    state.active = true;
    state.originalLxCurves = lxCurves;
    state.curvesData = curvesData;
    state.originalInterventions = currentInterventions;

    // Deep-copy the Lx curve points as working copies
    state.sculptedCurves = lxCurves.map((lx: any) => (lx.points || []).map((p: any) => ({ ...p })));

    // Add sculptor-mode class to body for CSS cursor/glow
    document.body.classList.add('curve-sculptor-active');

    // Attach drag listeners
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (svg) {
        const onDown = (e: PointerEvent) => onSculptorDown(e, svg);
        const onMove = (e: PointerEvent) => onSculptorMove(e, svg);
        const onUp = () => onSculptorUp();

        svg.addEventListener('pointerdown', onDown);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);

        state.cleanupFns.push(() => {
            svg.removeEventListener('pointerdown', onDown);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        });
    }
}

export function deactivateCurveSculptor(): void {
    if (!state.active) return;
    state.active = false;

    if (state.updateTimer != null) {
        clearTimeout(state.updateTimer);
        state.updateTimer = null;
    }

    // Cleanup listeners
    for (const fn of state.cleanupFns) fn();
    state.cleanupFns = [];

    document.body.classList.remove('curve-sculptor-active');

    // Restore original Lx curve rendering
    if (state.originalLxCurves && state.curvesData) {
        renderLxPathsFromPoints(
            state.originalLxCurves.map((lx: any) => lx.points || []),
            state.curvesData,
        );
        // Restore original substance timeline
        if (state.originalInterventions) {
            renderSubstanceTimeline(state.originalInterventions, state.originalLxCurves, state.curvesData);
            revealTimelinePillsInstant();
        }
    }

    state.originalLxCurves = null;
    state.curvesData = null;
    state.originalInterventions = null;
    state.sculptedCurves = null;
    state.activeCurveIdx = null;
    state.dragDotIdx = null;
    state.dragOriginalValues = null;
}

/** Re-run matching when Rx mode changes while sculptor is active. */
export function refreshSculptorRxFilter(): void {
    if (!state.active) return;
    scheduleSubstanceMatch();
}

// ============================================
// Coordinate helpers (adapted from baseline-editor)
// ============================================

function clientYToSvgY(svg: SVGSVGElement, clientY: number): number | null {
    const rect = svg.getBoundingClientRect();
    if (!rect.height) return null;
    const vb = svg.viewBox?.baseVal;
    const viewY = vb ? vb.y : 0;
    const viewH = vb && vb.height > 0 ? vb.height : PHASE_CHART.viewH;
    return viewY + ((clientY - rect.top) / rect.height) * viewH;
}

function clientXToSvgX(svg: SVGSVGElement, clientX: number): number | null {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return null;
    const vb = svg.viewBox?.baseVal;
    const viewX = vb ? vb.x : 0;
    const viewW = vb && vb.width > 0 ? vb.width : PHASE_CHART.viewW;
    return viewX + ((clientX - rect.left) / rect.width) * viewW;
}

function svgYToValue(svgY: number): number {
    const t = (svgY - PHASE_CHART.padT) / PHASE_CHART.plotH;
    return clamp((1 - t) * PHASE_CHART.maxEffect, 0, 100);
}

// ============================================
// Drag interaction
// ============================================

function findNearestCurvePoint(svgX: number, svgY: number): { curveIdx: number; dotIdx: number } | null {
    const curves = state.sculptedCurves;
    if (!curves) return null;

    let bestDist = 50; // max pixel distance to activate
    let bestCurve = -1;
    let bestDot = -1;

    for (let ci = 0; ci < curves.length; ci++) {
        const pts = curves[ci];
        for (let di = 0; di < pts.length; di++) {
            const px = phaseChartX(pts[di].hour * 60);
            const py = phaseChartY(pts[di].value);
            const dist = Math.sqrt((svgX - px) ** 2 + (svgY - py) ** 2);
            if (dist < bestDist) {
                bestDist = dist;
                bestCurve = ci;
                bestDot = di;
            }
        }
    }

    return bestCurve >= 0 ? { curveIdx: bestCurve, dotIdx: bestDot } : null;
}

function onSculptorDown(e: PointerEvent, svg: SVGSVGElement): void {
    const svgX = clientXToSvgX(svg, e.clientX);
    const svgY = clientYToSvgY(svg, e.clientY);
    if (svgX == null || svgY == null) return;

    // Only activate within the plot area
    if (
        svgX < PHASE_CHART.padL ||
        svgX > PHASE_CHART.padL + PHASE_CHART.plotW ||
        svgY < PHASE_CHART.padT ||
        svgY > PHASE_CHART.padT + PHASE_CHART.plotH
    ) {
        return;
    }

    const hit = findNearestCurvePoint(svgX, svgY);
    if (!hit) return;

    e.preventDefault();
    state.activeCurveIdx = hit.curveIdx;
    state.dragDotIdx = hit.dotIdx;

    // Snapshot original values for this curve
    const pts = state.sculptedCurves![hit.curveIdx];
    state.dragOriginalValues = pts.map((p: any) => p.value);

    document.body.style.userSelect = 'none';
}

function onSculptorMove(e: PointerEvent, svg: SVGSVGElement): void {
    if (state.activeCurveIdx == null || state.dragDotIdx == null) return;
    e.preventDefault();

    const svgY = clientYToSvgY(svg, e.clientY);
    if (svgY == null) return;

    const newValue = svgYToValue(svgY);
    const pts = state.sculptedCurves![state.activeCurveIdx];
    const originals = state.dragOriginalValues!;

    // Also track X to allow moving along the curve
    const svgX = clientXToSvgX(svg, e.clientX);
    if (svgX != null) {
        let closestIdx = state.dragDotIdx;
        let closestDist = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const px = phaseChartX(pts[i].hour * 60);
            const d = Math.abs(svgX - px);
            if (d < closestDist) {
                closestDist = d;
                closestIdx = i;
            }
        }
        state.dragDotIdx = closestIdx;
    }

    // Apply local drag smoothing with falloff
    applyLocalDragSmoothing(pts, originals, state.dragDotIdx, newValue);

    // Update SVG paths immediately
    renderLxPathsFromPoints(state.sculptedCurves!, state.curvesData!);

    // Throttle substance matching
    scheduleSubstanceMatch();
}

function onSculptorUp(): void {
    if (state.activeCurveIdx == null) return;

    state.activeCurveIdx = null;
    state.dragDotIdx = null;
    state.dragOriginalValues = null;
    document.body.style.userSelect = '';

    // Fire one final match synchronously
    runSubstanceMatch();
}

// ============================================
// Drag smoothing (adapted from baseline-editor)
// ============================================

function applyLocalDragSmoothing(
    points: any[],
    originalValues: number[],
    centerIdx: number,
    centerTarget: number,
): void {
    const centerOriginal = originalValues[centerIdx];
    const delta = centerTarget - centerOriginal;
    const radius = DRAG_FALLOFF_WEIGHTS.length - 1;
    for (let i = 0; i < points.length; i++) {
        const dist = Math.abs(i - centerIdx);
        const weight = dist <= radius ? DRAG_FALLOFF_WEIGHTS[dist] : 0;
        const next = originalValues[i] + delta * weight;
        points[i].value = clamp(next, 0, 100);
    }
}

// ============================================
// SVG path update
// ============================================

function renderLxPathsFromPoints(allCurvePoints: any[][], curvesData: any[]): void {
    const group = document.getElementById('phase-lx-curves');
    if (!group) return;

    const strokePaths = group.querySelectorAll('.phase-lx-path');
    const fillPaths = group.querySelectorAll('.phase-lx-fill');

    for (let i = 0; i < allCurvePoints.length; i++) {
        const pts = allCurvePoints[i];
        if (pts.length < 2) continue;

        const strokeD = phasePointsToPath(pts, false);
        const fillD = phasePointsToFillPath(pts, false);

        if (strokePaths[i] && strokeD) {
            strokePaths[i].setAttribute('d', strokeD);
        }
        if (fillPaths[i] && fillD) {
            fillPaths[i].setAttribute('d', fillD);
        }
    }
}

// ============================================
// Effect-aware, spatially-aware substance matching
// ============================================

function scheduleSubstanceMatch(): void {
    if (state.updateTimer != null) return;
    state.updateTimer = setTimeout(() => {
        state.updateTimer = null;
        if (state.active) runSubstanceMatch();
    }, UPDATE_THROTTLE_MS);
}

/** Build set of substance classes that match a given effect name. */
function getEffectClasses(effectName: string): Set<string> {
    const classes = new Set<string>();
    if (!effectName) return classes;

    const lower = effectName.toLowerCase();
    for (const [etName, etDef] of Object.entries(EFFECT_TYPES) as [string, any][]) {
        if (
            lower.includes(etName.toLowerCase()) ||
            etName.toLowerCase().includes(lower) ||
            // Partial word match
            etName
                .toLowerCase()
                .split(/\s+/)
                .some((w: string) => w.length > 3 && lower.includes(w))
        ) {
            for (const cls of etDef.classes || []) {
                classes.add(cls);
            }
        }
    }

    // Fallback: if nothing matched, return all classes (don't filter)
    if (classes.size === 0) {
        for (const etDef of Object.values(EFFECT_TYPES) as any[]) {
            for (const cls of etDef.classes || []) {
                classes.add(cls);
            }
        }
    }
    return classes;
}

function runSubstanceMatch(): void {
    const sculptedCurves = state.sculptedCurves;
    const curvesData = state.curvesData;
    if (!sculptedCurves || !curvesData) return;

    const activePool = getActiveSubstances();
    const allInterventions: any[] = [];

    // Process each curve independently based on its effect type
    for (let ci = 0; ci < sculptedCurves.length; ci++) {
        const pts = sculptedCurves[ci];
        const baselinePts = curvesData[ci]?.baseline || [];
        const effectName = curvesData[ci]?.effect || '';
        const curveColor = curvesData[ci]?.color || '#6ee7ff';
        const validClasses = getEffectClasses(effectName);

        // Build candidate pool: substances matching this effect, sorted by strength
        const candidates: { key: string; sub: any; pharma: any }[] = [];
        for (const [key, sub] of Object.entries(activePool) as [string, any][]) {
            const pharma = sub.pharma;
            if (!pharma) continue;
            const cls = sub.class || 'unknown';
            if (!validClasses.has(cls)) continue;
            candidates.push({ key, sub, pharma });
        }
        // Sort strongest first so the most impressive substances get placed first
        candidates.sort((a, b) => (b.pharma.strength || 50) - (a.pharma.strength || 50));
        if (candidates.length === 0) continue;

        // Sample the remaining delta (need) at each hour — this gets subtracted
        // as we place substances greedily
        const startH = PHASE_CHART.startHour;
        const endH = PHASE_CHART.endHour;
        const needSamples: number[] = [];
        for (let h = startH; h <= endH; h++) {
            const sv = interpolateAtHour(pts, h);
            const bv = interpolateAtHour(baselinePts, h);
            needSamples.push(Math.max(0, sv - bv));
        }

        // Check if there's any meaningful need
        const totalNeed = needSamples.reduce((s, v) => s + v, 0);
        if (totalNeed < DELTA_THRESHOLD * 2) continue;

        // Greedy tiling: repeatedly find the time slot with the most remaining need,
        // pick the best substance to cover it, subtract its contribution, repeat
        const usedKeys = new Set<string>();
        let candidateIdx = 0;
        const maxSubstances = 15; // cap for sanity
        let placed = 0;

        while (placed < maxSubstances && candidateIdx < candidates.length) {
            // Find the hour with the maximum remaining need
            let maxNeed = DELTA_THRESHOLD;
            let maxNeedH = -1;
            for (let h = 0; h < needSamples.length; h++) {
                if (needSamples[h] > maxNeed) {
                    maxNeed = needSamples[h];
                    maxNeedH = h;
                }
            }
            if (maxNeedH < 0) break; // all need is satisfied

            const peakHour = startH + maxNeedH;

            // Find the best unused candidate for this time slot
            let bestIdx = -1;
            let bestScore = 0;
            let bestDoseMin = 0;

            for (let ci2 = candidateIdx; ci2 < candidates.length; ci2++) {
                const c = candidates[ci2];
                if (usedKeys.has(c.key)) continue;

                // Dose time: position the substance so its peak aligns with the need peak
                const peakMin = (c.pharma.onset || 30) + ((c.pharma.peak || 60) - (c.pharma.onset || 30)) / 2;
                const doseTimeMin = peakHour * 60 - peakMin;

                if (doseTimeMin < PHASE_CHART.startMin || doseTimeMin > PHASE_CHART.endMin) continue;

                // Score: coverage of remaining need weighted by substance strength
                let coverage = 0;
                const doseTimeH = doseTimeMin / 60;
                for (let h = 0; h < needSamples.length; h++) {
                    if (needSamples[h] <= 0) continue;
                    const minutesSinceDose = (startH + h - doseTimeH) * 60;
                    if (minutesSinceDose < 0) continue;
                    const effect = substanceEffectAt(minutesSinceDose, c.pharma);
                    coverage += effect * needSamples[h];
                }

                if (coverage > bestScore) {
                    bestScore = coverage;
                    bestIdx = ci2;
                    bestDoseMin = doseTimeMin;
                }
            }

            if (bestIdx < 0) break; // no candidate can cover remaining need

            const chosen = candidates[bestIdx];
            usedKeys.add(chosen.key);

            // Subtract this substance's contribution from the remaining need
            const doseTimeH = bestDoseMin / 60;
            for (let h = 0; h < needSamples.length; h++) {
                const minutesSinceDose = (startH + h - doseTimeH) * 60;
                if (minutesSinceDose < 0) continue;
                const effect = substanceEffectAt(minutesSinceDose, chosen.pharma);
                // Scale subtraction: assume each substance covers ~30 effect units at peak
                const contribution = effect * 30 * ((chosen.pharma.strength || 50) / 100);
                needSamples[h] = Math.max(0, needSamples[h] - contribution);
            }

            const timeMinutes = Math.max(
                PHASE_CHART.startMin,
                Math.min(PHASE_CHART.endMin - 60, Math.round(bestDoseMin)),
            );

            allInterventions.push({
                key: chosen.key,
                substance: chosen.sub,
                name: chosen.sub.name || chosen.key,
                dose: chosen.sub.standardDose || '',
                doseMultiplier: 1,
                timeMinutes,
                targetCurveIdx: ci,
                color: chosen.sub.color || curveColor,
                impacts: {},
                _syntheticScore: bestScore,
            });

            placed++;
            // If same candidate was first in sort order, advance the quick-skip pointer
            if (bestIdx === candidateIdx) candidateIdx++;
        }
    }

    // Build synthetic lxCurves from sculpted points
    const syntheticLxCurves = sculptedCurves.map((pts: any, ci: number) => ({
        points: pts,
        desired: curvesData[ci]?.desired || [],
        baseline: curvesData[ci]?.baseline || [],
    }));

    // Re-render timeline and reveal immediately
    renderSubstanceTimeline(allInterventions, syntheticLxCurves, curvesData);
    revealTimelinePillsInstant();
}

// ============================================
// Interpolation helper
// ============================================

function interpolateAtHour(points: any[], hour: number): number {
    if (!points || points.length === 0) return 0;

    if (hour <= points[0].hour) return points[0].value;
    if (hour >= points[points.length - 1].hour) return points[points.length - 1].value;

    for (let i = 0; i < points.length - 1; i++) {
        if (hour >= points[i].hour && hour <= points[i + 1].hour) {
            const t = (hour - points[i].hour) / (points[i + 1].hour - points[i].hour);
            return points[i].value + t * (points[i + 1].value - points[i].value);
        }
    }

    return points[points.length - 1].value;
}
