/**
 * Baseline Editor — Interactive scrubber for editing baseline curves via drag, with odometer-style level indicators.
 * Exports: activateBaselineEditor, cleanupBaselineEditor, getLevelData
 * Depends on: constants (PHASE_CHART, DESCRIPTOR_LEVELS), state (DividerState), utils, curve-utils, divider
 */
import { PHASE_CHART, PHASE_SMOOTH_PASSES, DESCRIPTOR_LEVELS } from './constants';
import { DividerState } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY, isLightMode, clamp } from './utils';
import {
    smoothPhaseValues,
    phasePointsToPath,
    phasePointsToFillPath,
    nearestLevel,
    interpolatePointsAtTime,
} from './curve-utils';
import { getEffectSubGroup } from './divider';

// ---- Module State ----

interface OdometerLevel {
    step: number;
    intensity_percent: number;
    label: string;
    full_context: string;
}

const DRAG_FALLOFF_WEIGHTS = [1, 0.78, 0.48, 0.22, 0.05];
const SCRUBBER_HOVER_MAX_DIST_PX = 40;
const SCRUBBER_HOVER_REARM_MS = 120;
const SCRUBBER_TIMESTAMP_TO_LABEL_PADDING_PX = 18;
const SCRUBBER_RELEASE_RETURN_HYSTERESIS_PX = 12;
const PEAK_LABEL_RETURN_DURATION_MS = 820;
const PEAK_LABEL_FONT_SIZE = 11;
const PEAK_LABEL_FONT_SIZE_ENLARGED = 14;
const PEAK_LABEL_AVOID_RADIUS_PX = 40;
const PEAK_LABEL_AVOID_MAX_OFFSET_Y = 16;
const PEAK_LABEL_MAGNET_RETURN_MS = 120;
const PEAK_LABEL_MAGNET_EPSILON = 0.1;

interface PeakLabelMagnetMotion {
    curveIdx: number;
    offsetY: number;
    targetOffsetY: number;
    offsetX: number;
    targetOffsetX: number;
    rafId: number | null;
    lastFrameMs: number;
}

interface ScrubberDrag {
    curveIdx: number;
    dotIdx: number;
    startSvgY: number;
    originalValue: number;
    originalBaseline: number[];
}

interface CurveRelaxation {
    fromPts: any[];
    toPts: any[];
    startMs: number;
    durationMs: number;
    rafId: number | null;
}

interface BaselineEditorState {
    active: boolean;
    // Peak label drag
    dragCurveIdx: number | null;
    dragDotIdx: number | null;
    dragStartSvgY: number | null;
    dragOriginalValue: number | null;
    dragOriginalBaseline: number[] | null;

    // Interactive universal scrubber
    activeScrubberCurveIdx: number | null;
    activeScrubberDotIdx: number | null;
    activeScrubberAnchorX: number | null;
    activeScrubberAnchorY: number | null;
    scrubberDrag: ScrubberDrag | null;

    suppressHover: boolean;
    hoverDebounceTimer: ReturnType<typeof setTimeout> | null;
    curveRelaxations: Map<number, CurveRelaxation>;
    hoverLabelCurveIdx: number | null;
    awaitingLabelReturnOnMove: boolean;
    awaitingLabelReturnFromX: number | null;
    awaitingLabelReturnFromY: number | null;
    returningLabelCurveIdx: number | null;
    returningLabelRafId: number | null;
    peakLabelMagnetMotion: PeakLabelMagnetMotion | null;
    cleanupFns: (() => void)[];
}

const state: BaselineEditorState = {
    active: false,
    dragCurveIdx: null,
    dragDotIdx: null,
    dragStartSvgY: null,
    dragOriginalValue: null,
    dragOriginalBaseline: null,
    activeScrubberCurveIdx: null,
    activeScrubberDotIdx: null,
    activeScrubberAnchorX: null,
    activeScrubberAnchorY: null,
    scrubberDrag: null,
    suppressHover: false,
    hoverDebounceTimer: null,
    curveRelaxations: new Map<number, CurveRelaxation>(),
    hoverLabelCurveIdx: null,
    awaitingLabelReturnOnMove: false,
    awaitingLabelReturnFromX: null,
    awaitingLabelReturnFromY: null,
    returningLabelCurveIdx: null,
    returningLabelRafId: null,
    peakLabelMagnetMotion: null,
    cleanupFns: [],
};

let _hoverRearmUntilTs = 0;

function getActiveDragAnchor(curveIdx: number, curvesData: any[]): { dotIdx: number; value: number } | null {
    const curve = curvesData[curveIdx];
    if (!curve?.baseline) return null;

    if (state.dragCurveIdx === curveIdx && state.dragDotIdx !== null) {
        const pt = curve.baseline[state.dragDotIdx];
        if (pt) return { dotIdx: state.dragDotIdx, value: Number(pt.value) };
    }

    if (state.scrubberDrag && state.scrubberDrag.curveIdx === curveIdx) {
        const pt = curve.baseline[state.scrubberDrag.dotIdx];
        if (pt) return { dotIdx: state.scrubberDrag.dotIdx, value: Number(pt.value) };
    }

    return null;
}

function getDisplayCurvePoints(curveIdx: number, curvesData: any[]): any[] {
    const curve = curvesData[curveIdx];
    if (!curve?.baseline || curve.baseline.length === 0) return [];

    const smoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    const anchor = getActiveDragAnchor(curveIdx, curvesData);
    const relaxation = state.curveRelaxations.get(curveIdx);
    if (relaxation && relaxation.fromPts.length === relaxation.toPts.length && relaxation.fromPts.length > 0) {
        const t = clamp((performance.now() - relaxation.startMs) / relaxation.durationMs, 0, 1);
        const eased = easeReleaseSettle(t);
        return relaxation.toPts.map((toPt: any, idx: number) => {
            const fromPt = relaxation.fromPts[idx] || toPt;
            const fromVal = Number(fromPt.value);
            const toVal = Number(toPt.value);
            return {
                ...toPt,
                value: fromVal + (toVal - fromVal) * eased,
            };
        });
    }

    if (!anchor || anchor.dotIdx < 0 || anchor.dotIdx >= smoothed.length) return smoothed;

    const anchored = smoothed.slice();
    const existing = anchored[anchor.dotIdx];
    if (!existing) return smoothed;

    anchored[anchor.dotIdx] = {
        ...existing,
        value: clamp(anchor.value, 0, 100),
    };
    return anchored;
}

function getDisplayPeakPoint(curveIdx: number, curvesData: any[]): { idx: number; point: any } | null {
    const pts = getDisplayCurvePoints(curveIdx, curvesData);
    if (!pts.length) return null;
    let peakDotIdx = 0;
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].value > pts[peakDotIdx].value) peakDotIdx = i;
    }
    return { idx: peakDotIdx, point: pts[peakDotIdx] };
}

function getActiveHoverCurveCandidates(svgX: number, curvesData: any[]): number[] {
    if (!DividerState.active || curvesData.length < 2) {
        return Array.from({ length: curvesData.length }, (_, i) => i);
    }
    const exposedCurveIdx = svgX <= DividerState.x ? 0 : 1;
    if (!Number.isFinite(exposedCurveIdx)) return [0, 1];
    return [clamp(exposedCurveIdx, 0, curvesData.length - 1)];
}

function getScrubberHoverCandidate(svgX: number, svgY: number, curvesData: any[]) {
    let closestCurve = -1;
    let closestDotIdx = 0;
    let closestX = svgX;
    let closestY = 0;
    let closestDist = Infinity;

    const candidateCurves = getActiveHoverCurveCandidates(svgX, curvesData);
    for (const i of candidateCurves) {
        const displayPts = getDisplayCurvePoints(i, curvesData);
        if (!displayPts.length) continue;
        const curveYAtCursorX = getCurveRenderedYAtSvgX(i, svgX, displayPts);
        if (!Number.isFinite(curveYAtCursorX)) continue;
        const dotIdx = getNearestDotIdxForSvgX(displayPts, svgX);
        const dist = Math.abs(curveYAtCursorX - svgY);
        if (dist < closestDist) {
            closestDist = dist;
            closestCurve = i;
            closestDotIdx = dotIdx;
            closestX = svgX;
            closestY = curveYAtCursorX;
        }
    }

    if (closestCurve < 0 || !Number.isFinite(closestDist) || closestDist > SCRUBBER_HOVER_MAX_DIST_PX) return null;
    return { closestCurve, closestDotIdx, closestX, closestY, closestDist };
}

function getClosestPointOnPath(
    path: SVGPathElement,
    targetX: number,
    targetY: number,
): { x: number; y: number; distance: number } | null {
    let totalLength = 0;
    try {
        totalLength = path.getTotalLength();
    } catch {
        totalLength = 0;
    }
    if (!Number.isFinite(totalLength) || totalLength <= 0) return null;

    const coarseSamples = 72;
    const coarseStep = totalLength / coarseSamples;
    let bestLen = 0;
    let bestPt = path.getPointAtLength(0);
    let bestDist2 = (bestPt.x - targetX) * (bestPt.x - targetX) + (bestPt.y - targetY) * (bestPt.y - targetY);

    for (let i = 1; i <= coarseSamples; i++) {
        const len = coarseStep * i;
        const pt = path.getPointAtLength(len);
        const dist2 = (pt.x - targetX) * (pt.x - targetX) + (pt.y - targetY) * (pt.y - targetY);
        if (dist2 < bestDist2) {
            bestDist2 = dist2;
            bestLen = len;
            bestPt = pt;
        }
    }

    let lo = Math.max(0, bestLen - coarseStep);
    let hi = Math.min(totalLength, bestLen + coarseStep);
    for (let i = 0; i < 10; i++) {
        const len1 = lo + (hi - lo) / 3;
        const len2 = hi - (hi - lo) / 3;
        const pt1 = path.getPointAtLength(len1);
        const pt2 = path.getPointAtLength(len2);
        const dist1 = (pt1.x - targetX) * (pt1.x - targetX) + (pt1.y - targetY) * (pt1.y - targetY);
        const dist2 = (pt2.x - targetX) * (pt2.x - targetX) + (pt2.y - targetY) * (pt2.y - targetY);
        if (dist1 <= dist2) {
            hi = len2;
            if (dist1 < bestDist2) {
                bestDist2 = dist1;
                bestPt = pt1;
            }
        } else {
            lo = len1;
            if (dist2 < bestDist2) {
                bestDist2 = dist2;
                bestPt = pt2;
            }
        }
    }

    const mid = (lo + hi) / 2;
    const midPt = path.getPointAtLength(mid);
    const midDist2 = (midPt.x - targetX) * (midPt.x - targetX) + (midPt.y - targetY) * (midPt.y - targetY);
    if (midDist2 < bestDist2) {
        bestDist2 = midDist2;
        bestPt = midPt;
    }

    return { x: bestPt.x, y: bestPt.y, distance: Math.sqrt(bestDist2) };
}

function getBaselineStrokePath(curveIdx: number): SVGPathElement | null {
    const baseGroup = document.getElementById('phase-baseline-curves');
    if (!baseGroup) return null;
    const sub = baseGroup.querySelector(`#phase-baseline-curves-e${curveIdx}`) || baseGroup;
    return sub.querySelector('.phase-baseline-path') as SVGPathElement | null;
}

function getNearestDotIdxForSvgX(points: any[], svgX: number): number {
    if (!points || points.length === 0) return 0;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
        const px = phaseChartX(points[i].hour * 60);
        const dist = Math.abs(px - svgX);
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function isMonotonicByHour(points: any[]): boolean {
    if (!points || points.length < 2) return true;
    for (let i = 1; i < points.length; i++) {
        if (Number(points[i].hour) < Number(points[i - 1].hour)) return false;
    }
    return true;
}

function getCurveRenderedYAtSvgX(curveIdx: number, svgX: number, displayPts: any[]): number {
    const path = getBaselineStrokePath(curveIdx);
    if (!path) {
        const timeH =
            (((svgX - PHASE_CHART.padL) / PHASE_CHART.plotW) * PHASE_CHART.totalMin + PHASE_CHART.startMin) / 60;
        const val = interpolatePointsAtTime(displayPts, timeH);
        return phaseChartY(val);
    }

    let totalLength = 0;
    try {
        totalLength = path.getTotalLength();
    } catch {
        totalLength = 0;
    }

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
        const timeH =
            (((svgX - PHASE_CHART.padL) / PHASE_CHART.plotW) * PHASE_CHART.totalMin + PHASE_CHART.startMin) / 60;
        const val = interpolatePointsAtTime(displayPts, timeH);
        return phaseChartY(val);
    }

    if (isMonotonicByHour(displayPts)) {
        let lo = 0;
        let hi = totalLength;
        for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            const p = path.getPointAtLength(mid);
            if (p.x < svgX) lo = mid;
            else hi = mid;
        }
        const pLo = path.getPointAtLength(lo);
        const pHi = path.getPointAtLength(hi);
        const dx = pHi.x - pLo.x;
        if (Math.abs(dx) < 0.001) return (pLo.y + pHi.y) / 2;
        const t = clamp((svgX - pLo.x) / dx, 0, 1);
        return pLo.y + (pHi.y - pLo.y) * t;
    }

    let best = path.getPointAtLength(0);
    let bestDist = Math.abs(best.x - svgX);
    const samples = 64;
    for (let i = 1; i <= samples; i++) {
        const p = path.getPointAtLength((totalLength * i) / samples);
        const dist = Math.abs(p.x - svgX);
        if (dist < bestDist) {
            best = p;
            bestDist = dist;
        }
    }
    return best.y;
}

function getClosestPointOnCurvePath(
    curveIdx: number,
    targetX: number,
    targetY: number,
    displayPts: any[],
): { x: number; y: number; distance: number } | null {
    const path = getBaselineStrokePath(curveIdx);
    if (path) {
        const closest = getClosestPointOnPath(path, targetX, targetY);
        if (closest) return closest;
    }

    const fallbackY = getCurveRenderedYAtSvgX(curveIdx, targetX, displayPts);
    const dx = 0;
    const dy = fallbackY - targetY;
    return { x: targetX, y: fallbackY, distance: Math.sqrt(dx * dx + dy * dy) };
}

// Global DOM refs for scrubber
let scrubberGroup: SVGGElement | null = null;
let scrubberStem: SVGLineElement | null = null;
let scrubberKnobGlow: SVGCircleElement | null = null;
let scrubberKnob: SVGCircleElement | null = null;
let scrubberHourLabel: SVGTextElement | null = null;
let scrubberDescLabel: SVGTextElement | null = null;

// Body-appended explainer elements (Sherlock-style positioning outside SVG)
let _leftExplainer: HTMLElement | null = null;
let _rightExplainer: HTMLElement | null = null;
let _explainerRAF: number | null = null;

// ============================================
// Public API
// ============================================

export function activateBaselineEditor(curvesData: any[]): void {
    cleanupBaselineEditor();
    ensureExplainerElements();
    placeInteractivePeakLabels(curvesData);
    setupScrubberHover(curvesData);
    startExplainerRepositionLoop();
    state.active = true;
}

export function cleanupBaselineEditor(): void {
    if (state.hoverDebounceTimer) {
        clearTimeout(state.hoverDebounceTimer);
        state.hoverDebounceTimer = null;
    }
    state.cleanupFns.forEach(fn => fn());
    state.cleanupFns = [];
    state.active = false;
    state.dragCurveIdx = null;
    state.dragDotIdx = null;
    state.dragStartSvgY = null;
    state.dragOriginalValue = null;
    state.dragOriginalBaseline = null;
    state.activeScrubberCurveIdx = null;
    state.activeScrubberDotIdx = null;
    state.activeScrubberAnchorX = null;
    state.activeScrubberAnchorY = null;
    state.scrubberDrag = null;
    state.suppressHover = false;
    state.hoverLabelCurveIdx = null;
    state.awaitingLabelReturnOnMove = false;
    state.awaitingLabelReturnFromX = null;
    state.awaitingLabelReturnFromY = null;
    clearPeakLabelMagnetOffset(state.hoverLabelCurveIdx);
    stopReturningLabelAnimation();
    for (const [curveIdx] of state.curveRelaxations) {
        stopCurveRelaxation(curveIdx);
    }
    setBaselineDragLock(false);

    scrubberGroup = null;
    scrubberStem = null;
    scrubberKnobGlow = null;
    scrubberKnob = null;
    scrubberHourLabel = null;
    scrubberDescLabel = null;

    const editorGroup = document.getElementById('phase-baseline-editor');
    if (editorGroup) editorGroup.innerHTML = '';

    // Remove body-appended explainer panels
    stopExplainerRepositionLoop();
    if (_leftExplainer) {
        _leftExplainer.remove();
        _leftExplainer = null;
    }
    if (_rightExplainer) {
        _rightExplainer.remove();
        _rightExplainer = null;
    }
}

// ============================================
// Interactive Peak Labels (Modernized)
// ============================================

// ============================================
// Odometer Logic
// ============================================

export function getLevelData(curve: any, val: number): OdometerLevel {
    const levelVal = nearestLevel(val);
    if (Array.isArray(curve.levels) && curve.levels.length > 0 && typeof curve.levels[0] === 'object') {
        let best = curve.levels[0];
        for (const l of curve.levels) {
            if (Math.abs(l.intensity_percent - val) < Math.abs(best.intensity_percent - val)) best = l;
        }
        // Support both new `label` format and legacy `slot_1/slot_2/slot_3` format
        const obj = best as any;
        const label = obj.label || [obj.slot_1, obj.slot_2, obj.slot_3].filter(Boolean).join(' ') || 'Baseline';
        return {
            step: obj.step,
            intensity_percent: obj.intensity_percent,
            label,
            full_context: obj.full_context || label,
        };
    }

    // Fallback for plain-string levels object
    const rawString = curve.levels?.[String(levelVal)] || 'Baseline';
    return {
        step: DESCRIPTOR_LEVELS.indexOf(levelVal) + 1,
        intensity_percent: levelVal,
        label: rawString,
        full_context: rawString,
    };
}

function getLevelDataFromStep(curve: any, step: number): OdometerLevel | null {
    if (!Array.isArray(curve.levels)) return null;
    const raw = curve.levels.find((l: any) => l.step === step);
    if (!raw) return null;
    const label = raw.label || [raw.slot_1, raw.slot_2, raw.slot_3].filter(Boolean).join(' ') || 'Baseline';
    return { step: raw.step, intensity_percent: raw.intensity_percent, label, full_context: raw.full_context || label };
}

function placeInteractivePeakLabels(curvesData: any[]): void {
    const editorGroup = document.getElementById('phase-baseline-editor')!;
    editorGroup.querySelectorAll('.baseline-peak-label').forEach(el => el.remove());

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;

        // Always place the label at the visual peak of the curve (highest point),
        // regardless of polarity. The descriptor will reflect the correct intensity.
        const keyPoint = getDisplayPeakPoint(i, curvesData);
        if (!keyPoint) continue;

        // Fallback or Array support check
        const level = nearestLevel(keyPoint.point.value);
        const descriptor = Array.isArray(curve.levels)
            ? getLevelData(curve, keyPoint.point.value).full_context
            : curve.levels[String(level)];
        if (!descriptor) continue;

        const px = phaseChartX(keyPoint.point.hour * 60);
        const py = phaseChartY(keyPoint.point.value);

        renderPeakLabel(editorGroup, curve, i, px, py, keyPoint.idx, curvesData);
    }
}

function renderPeakLabel(
    parent: Element,
    curve: any,
    curveIdx: number,
    px: number,
    py: number,
    peakDotIdx: number,
    curvesData: any[],
): void {
    const sub = DividerState.active && curvesData.length >= 2 ? getEffectSubGroup(parent, curveIdx) : parent;

    const labelGroup = svgEl('g', {
        class: 'baseline-peak-label',
        'data-curve-idx': String(curveIdx),
    }) as SVGGElement;

    const cyOffset = 22;
    const pyLabel = py - cyOffset;

    const chevronGroup = svgEl('g', {
        class: 'baseline-peak-chevron-group',
        opacity: '1',
    }) as SVGGElement;
    const upChevron = svgEl('path', {
        d: `M${px - 4},${pyLabel - 10} L${px},${pyLabel - 15} L${px + 4},${pyLabel - 10}`,
        fill: 'none',
        stroke: curve.color,
        'stroke-width': '2.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-opacity': '0.5',
        'pointer-events': 'none',
        class: 'baseline-chevron-up',
    }) as SVGElement;
    const downChevron = svgEl('path', {
        d: `M${px - 4},${pyLabel + 10} L${px},${pyLabel + 15} L${px + 4},${pyLabel + 10}`,
        fill: 'none',
        stroke: curve.color,
        'stroke-width': '2.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-opacity': '0.5',
        'pointer-events': 'none',
        class: 'baseline-chevron-down',
    }) as SVGElement;
    chevronGroup.setAttribute('style', 'transition: opacity 0.2s ease');
    chevronGroup.appendChild(upChevron);
    chevronGroup.appendChild(downChevron);
    labelGroup.appendChild(chevronGroup);

    // Label text — single SVG text element for the descriptor
    const labelText = svgEl('text', {
        x: px.toFixed(1),
        y: (pyLabel + 1).toFixed(1),
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: curve.color,
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': String(PEAK_LABEL_FONT_SIZE),
        'font-weight': '700',
        'letter-spacing': '0.03em',
        'pointer-events': 'none',
        class: 'peak-label-text',
        opacity: '0.85',
    }) as SVGTextElement;
    labelText.style.transition = 'font-size 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
    labelGroup.appendChild(labelText);

    labelGroup.setAttribute('data-label-x', px.toFixed(2));
    labelGroup.setAttribute('data-label-y', py.toFixed(2));

    sub.appendChild(labelGroup);

    labelGroup.style.transition = 'opacity 0.4s ease-out';
    labelGroup.setAttribute('opacity', '0');
    requestAnimationFrame(() => {
        labelGroup.setAttribute('opacity', '1');
        updateOdometerLogic(labelGroup, px, py, curve, curve.baseline[peakDotIdx].value);
    });
}

function updateOdometerLogic(labelGroup: Element, px: number, pyTarget: number, curve: any, targetVal: number): void {
    const labelText = labelGroup.querySelector('.peak-label-text') as SVGTextElement | null;
    if (!labelText) return;

    const pyLabel = pyTarget - 22;

    // Update label text position
    labelText.setAttribute('x', px.toFixed(1));
    labelText.setAttribute('y', (pyLabel + 1).toFixed(1));
    const upChevron = labelGroup.querySelector('.baseline-chevron-up') as SVGElement | null;
    const downChevron = labelGroup.querySelector('.baseline-chevron-down') as SVGElement | null;
    if (upChevron) {
        upChevron.setAttribute('d', `M${px - 4},${pyLabel - 10} L${px},${pyLabel - 15} L${px + 4},${pyLabel - 10}`);
    }
    if (downChevron) {
        downChevron.setAttribute('d', `M${px - 4},${pyLabel + 10} L${px},${pyLabel + 15} L${px + 4},${pyLabel + 10}`);
    }

    let odState = (labelGroup as any).__odometerState;
    if (!odState) {
        odState = { activeStep: null, lastVal: targetVal };
        (labelGroup as any).__odometerState = odState;
    }

    // --- Boundary Hysteresis (Anti-Jitter Lock) ---
    let stepObj = getLevelData(curve, targetVal);
    if (odState.activeStep !== null && odState.activeStep !== stepObj.step) {
        const prevObj = getLevelDataFromStep(curve, odState.activeStep);
        if (prevObj) {
            const diffFromPrevBoundary = Math.abs(targetVal - prevObj.intensity_percent);
            const boundaryEdge = Math.abs(prevObj.intensity_percent - stepObj.intensity_percent) / 2;
            if (diffFromPrevBoundary < boundaryEdge + 1.5) {
                stepObj = prevObj;
            }
        }
    }

    // Update label text when step changes
    if (stepObj.step !== odState.activeStep) {
        labelText.textContent = stepObj.label;
        odState.activeStep = stepObj.step;

        // Update the HTML explainer overlay outside the SVG
        const curveIdx = parseInt(labelGroup.getAttribute('data-curve-idx') || '0', 10);
        updateExplainerOverlay(curveIdx, stepObj.full_context, pyLabel, curve.color);
    }

    odState.lastVal = targetVal;
}

function setPeakLabelTextScale(curveIdx: number, enlarged: boolean): void {
    const labelGroup = getLabelGroupForCurve(curveIdx);
    if (!labelGroup) return;
    const labelText = labelGroup.querySelector('.peak-label-text') as SVGTextElement | null;
    if (!labelText) return;
    labelText.setAttribute('font-size', String(enlarged ? PEAK_LABEL_FONT_SIZE_ENLARGED : PEAK_LABEL_FONT_SIZE));
    const chevrons = labelGroup.querySelector('.baseline-peak-chevron-group');
    if (chevrons) chevrons.setAttribute('opacity', enlarged ? '0' : '1');
}

// ============================================
// Body-Appended Explainer Panels (Sherlock-style)
// ============================================

/** Create explainer elements on <body>, positioned by JS like Sherlock panels */
function ensureExplainerElements(): void {
    if (!_leftExplainer) {
        _leftExplainer = document.createElement('div');
        _leftExplainer.id = 'level-explainer-left';
        _leftExplainer.className = 'level-explainer level-explainer-left';
        document.body.appendChild(_leftExplainer);
    }
    if (!_rightExplainer) {
        _rightExplainer = document.createElement('div');
        _rightExplainer.id = 'level-explainer-right';
        _rightExplainer.className = 'level-explainer level-explainer-right';
        document.body.appendChild(_rightExplainer);
    }
}

/** Reposition explainers relative to SVG bounding rect (like Sherlock repositionPanel) */
function repositionExplainers(): void {
    const svg = document.getElementById('phase-chart-svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    const explainerWidth = 180;
    const gap = 14;
    const centerY = rect.top + window.scrollY + rect.height / 2;

    if (_leftExplainer) {
        const leftEdge = rect.left - explainerWidth - gap;
        _leftExplainer.style.left = `${Math.max(4, leftEdge)}px`;
        _leftExplainer.style.top = `${centerY}px`;
        _leftExplainer.style.width = `${explainerWidth}px`;
    }

    if (_rightExplainer) {
        const rightEdge = rect.right + gap;
        _rightExplainer.style.left = `${rightEdge}px`;
        _rightExplainer.style.top = `${centerY}px`;
        _rightExplainer.style.width = `${explainerWidth}px`;
    }
}

function startExplainerRepositionLoop(): void {
    if (_explainerRAF !== null) return;
    const tick = () => {
        repositionExplainers();
        _explainerRAF = requestAnimationFrame(tick);
    };
    _explainerRAF = requestAnimationFrame(tick);
}

function stopExplainerRepositionLoop(): void {
    if (_explainerRAF !== null) {
        cancelAnimationFrame(_explainerRAF);
        _explainerRAF = null;
    }
}

/** Update the explainer text and color */
function updateExplainerOverlay(curveIdx: number, text: string, _svgY: number, color: string): void {
    const el = curveIdx === 0 ? _leftExplainer : _rightExplainer;
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isLightMode() ? color : '';
}

function repositionLabelGroup(labelGroup: Element, px: number, py: number, curve: any, descriptorValue?: number): void {
    // Forward to new logic
    let targetVal = descriptorValue;
    if (typeof targetVal !== 'number') {
        const smoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const isHigherBetter = curve.polarity !== 'higher_is_worse';
        let peakVal = smoothed[0].value;
        for (const p of smoothed) {
            if (isHigherBetter ? p.value > peakVal : p.value < peakVal) peakVal = p.value;
        }
        targetVal = peakVal;
    }
    updateOdometerLogic(labelGroup, px, py, curve, targetVal);
    const group = labelGroup as SVGGElement;
    group.setAttribute('data-label-x', px.toFixed(2));
    group.setAttribute('data-label-y', py.toFixed(2));
}

function getLabelGroupForCurve(curveIdx: number): SVGGElement | null {
    const editorGroup = document.getElementById('phase-baseline-editor');
    if (!editorGroup) return null;
    return editorGroup.querySelector(`.baseline-peak-label[data-curve-idx="${curveIdx}"]`) as SVGGElement | null;
}

function getLabelCurrentX(curveIdx: number, fallbackX: number): number {
    const labelGroup = getLabelGroupForCurve(curveIdx);
    if (!labelGroup) return fallbackX;
    const rawAttr = labelGroup.getAttribute('data-label-x');
    const raw = rawAttr === null ? NaN : Number(rawAttr);
    return Number.isFinite(raw) ? raw : fallbackX;
}

function clearPeakLabelMagnetOffset(curveIdx: number | null): void {
    const stateMotion = state.peakLabelMagnetMotion;
    if (!stateMotion) return;
    if (curveIdx !== null && stateMotion.curveIdx !== curveIdx) return;
    if (stateMotion.rafId !== null) {
        cancelAnimationFrame(stateMotion.rafId);
    }
    const labelGroup = getLabelGroupForCurve(stateMotion.curveIdx);
    if (labelGroup) {
        labelGroup.removeAttribute('transform');
    }
    state.peakLabelMagnetMotion = null;
}

function applyPeakLabelMagnetOffset(curveIdx: number): void {
    const motion = state.peakLabelMagnetMotion;
    if (!motion || motion.curveIdx !== curveIdx) return;
    const labelGroup = getLabelGroupForCurve(curveIdx);
    if (!labelGroup) return;

    if (Math.abs(motion.offsetX) < PEAK_LABEL_MAGNET_EPSILON && Math.abs(motion.offsetY) < PEAK_LABEL_MAGNET_EPSILON) {
        labelGroup.removeAttribute('transform');
        return;
    }
    labelGroup.setAttribute('transform', `translate(${motion.offsetX.toFixed(2)} ${motion.offsetY.toFixed(2)})`);
}

function getPeakLabelMagnetOffset(curveIdx: number): { x: number; y: number } {
    const motion = state.peakLabelMagnetMotion;
    if (!motion || motion.curveIdx !== curveIdx) return { x: 0, y: 0 };
    return { x: motion.offsetX, y: motion.offsetY };
}

function decayPeakLabelMagnetState(): void {
    const motion = state.peakLabelMagnetMotion;
    if (!motion) return;

    const now = performance.now();
    const dtMs = Math.max(1, now - motion.lastFrameMs);
    const blend = 1 - Math.exp(-dtMs / PEAK_LABEL_MAGNET_RETURN_MS);
    const dx = motion.targetOffsetX - motion.offsetX;
    const dy = motion.targetOffsetY - motion.offsetY;
    motion.offsetX += dx * blend;
    motion.offsetY += dy * blend;

    applyPeakLabelMagnetOffset(motion.curveIdx);
    motion.lastFrameMs = now;

    const atTarget = Math.abs(dx) < PEAK_LABEL_MAGNET_EPSILON && Math.abs(dy) < PEAK_LABEL_MAGNET_EPSILON;
    if (atTarget) {
        motion.offsetX = motion.targetOffsetX;
        motion.offsetY = motion.targetOffsetY;
        applyPeakLabelMagnetOffset(motion.curveIdx);
        motion.rafId = null;
        if (
            Math.abs(motion.offsetX) < PEAK_LABEL_MAGNET_EPSILON &&
            Math.abs(motion.offsetY) < PEAK_LABEL_MAGNET_EPSILON
        ) {
            clearPeakLabelMagnetOffset(motion.curveIdx);
        }
        return;
    }
    motion.rafId = requestAnimationFrame(decayPeakLabelMagnetState);
}

function ensurePeakLabelMagnetRaf(): void {
    const motion = state.peakLabelMagnetMotion;
    if (!motion || motion.rafId !== null) return;
    motion.lastFrameMs = performance.now();
    motion.rafId = requestAnimationFrame(decayPeakLabelMagnetState);
}

function setPeakLabelMagnetOffset(
    curveIdx: number,
    cursorSvgX: number | null,
    cursorSvgY: number | null,
    labelAnchorX?: number | null,
    labelAnchorY?: number | null,
): void {
    if (cursorSvgX === null || cursorSvgY === null || !Number.isFinite(cursorSvgX) || !Number.isFinite(cursorSvgY)) {
        clearPeakLabelMagnetOffset(curveIdx);
        return;
    }

    if (!state.peakLabelMagnetMotion || state.peakLabelMagnetMotion.curveIdx !== curveIdx) {
        if (state.peakLabelMagnetMotion) {
            clearPeakLabelMagnetOffset(state.peakLabelMagnetMotion.curveIdx);
        }
        state.peakLabelMagnetMotion = {
            curveIdx,
            lastFrameMs: performance.now(),
            offsetX: 0,
            offsetY: 0,
            targetOffsetX: 0,
            targetOffsetY: 0,
            rafId: null,
        };
    }

    const motion = state.peakLabelMagnetMotion;
    const px =
        Number.isFinite(labelAnchorX) && labelAnchorX !== null
            ? labelAnchorX
            : (state.activeScrubberAnchorX ?? cursorSvgX);
    const py =
        Number.isFinite(labelAnchorY) && labelAnchorY !== null
            ? labelAnchorY
            : (state.activeScrubberAnchorY ?? PHASE_CHART.padT + PHASE_CHART.plotH / 2);

    if (!Number.isFinite(px) || !Number.isFinite(py)) {
        clearPeakLabelMagnetOffset(curveIdx);
        return;
    }

    const labelBaseY = py + (py < PHASE_CHART.padT + 60 ? +32 : -32);
    const distToLabel = Math.hypot(cursorSvgX - px, cursorSvgY - labelBaseY);
    const ratio = clamp(distToLabel / PEAK_LABEL_AVOID_RADIUS_PX, 0, 1);
    const pull = 1 - ratio;
    motion.targetOffsetY = -PEAK_LABEL_AVOID_MAX_OFFSET_Y * pull;
    motion.targetOffsetX = 0;
    ensurePeakLabelMagnetRaf();
}

function moveLabelTowardX(curveIdx: number, targetX: number, curvesData: any[], lerp: number): number {
    const labelGroup = getLabelGroupForCurve(curveIdx);
    const curve = curvesData[curveIdx];
    if (!labelGroup || !curve) return 0;

    const peak = getDisplayPeakPoint(curveIdx, curvesData);
    const peakX = peak ? phaseChartX(peak.point.hour * 60) : targetX;
    const clampedTargetX = Math.max(PHASE_CHART.padL, Math.min(PHASE_CHART.padL + PHASE_CHART.plotW, targetX));
    const currentX = getLabelCurrentX(curveIdx, peakX);
    const nextX = currentX + (clampedTargetX - currentX) * clamp(lerp, 0, 1);
    moveLabelToX(curveIdx, nextX, curvesData, labelGroup, curve);
    return clampedTargetX - nextX;
}

function moveLabelToX(
    curveIdx: number,
    x: number,
    curvesData: any[],
    labelGroup?: SVGGElement | null,
    curve?: any,
): void {
    const resolvedLabelGroup = labelGroup || getLabelGroupForCurve(curveIdx);
    const resolvedCurve = curve || curvesData[curveIdx];
    if (!resolvedLabelGroup || !resolvedCurve) return;

    const clampedX = Math.max(PHASE_CHART.padL, Math.min(PHASE_CHART.padL + PHASE_CHART.plotW, x));
    const displayPts = getDisplayCurvePoints(curveIdx, curvesData);
    const nextY = getCurveRenderedYAtSvgX(curveIdx, clampedX, displayPts);
    repositionLabelGroup(resolvedLabelGroup, clampedX, nextY, resolvedCurve, valueFromSvgY(nextY));
}

function easeInOutQuart(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < 0.5) {
        return 8 * Math.pow(t, 4);
    }
    return 1 - Math.pow(-2 * t + 2, 4) / 2;
}

function stopReturningLabelAnimation(): void {
    if (state.returningLabelRafId !== null) {
        cancelAnimationFrame(state.returningLabelRafId);
        state.returningLabelRafId = null;
    }
    state.returningLabelCurveIdx = null;
}

function animateLabelBackToPeak(curveIdx: number, curvesData: any[]): void {
    const peak = getDisplayPeakPoint(curveIdx, curvesData);
    if (!peak) return;
    const targetX = phaseChartX(peak.point.hour * 60);

    if (state.returningLabelCurveIdx === curveIdx && state.returningLabelRafId !== null) return;
    setPeakLabelTextScale(curveIdx, false);
    stopReturningLabelAnimation();
    state.returningLabelCurveIdx = curveIdx;

    const labelGroup = getLabelGroupForCurve(curveIdx);
    const curve = curvesData[curveIdx];
    if (!labelGroup || !curve) return;

    const startX = getLabelCurrentX(curveIdx, targetX);
    const startMs = performance.now();
    const deltaX = targetX - startX;

    const tick = () => {
        if (state.returningLabelCurveIdx !== curveIdx) return;
        const elapsed = Math.min(1, (performance.now() - startMs) / PEAK_LABEL_RETURN_DURATION_MS);
        const eased = easeInOutQuart(elapsed);
        const currentX = startX + deltaX * eased;
        moveLabelToX(curveIdx, currentX, curvesData, labelGroup, curve);
        if (elapsed >= 1) {
            stopReturningLabelAnimation();
            return;
        }
        state.returningLabelRafId = requestAnimationFrame(tick);
    };

    state.returningLabelRafId = requestAnimationFrame(tick);
}

function syncPeakLabelsToCurves(curvesData: any[]): void {
    const edGroup = document.getElementById('phase-baseline-editor');
    if (!edGroup) return;
    const labelGroups = edGroup.querySelectorAll('.baseline-peak-label');
    for (const lg of Array.from(labelGroups)) {
        const curveIdx = parseInt(lg.getAttribute('data-curve-idx') || '-1', 10);
        if (!Number.isFinite(curveIdx) || curveIdx < 0) continue;
        const curve = curvesData[curveIdx];
        if (!curve) continue;
        if (state.hoverLabelCurveIdx === curveIdx) continue;
        const peak = getDisplayPeakPoint(curveIdx, curvesData);
        if (!peak) continue;
        const px = phaseChartX(peak.point.hour * 60);
        const py = phaseChartY(peak.point.value);
        repositionLabelGroup(lg, px, py, curve, peak.point.value);
    }
}

function resetScrubberVisuals(): void {
    if (!scrubberKnobGlow) return;
    scrubberKnobGlow.setAttribute('fill-opacity', '0.12');
    scrubberKnobGlow.setAttribute('r', '18');
}

function finalizeCurveDragInteraction(curvesData: any[], keepLabelAtHoverPosition = false): void {
    state.suppressHover = false;
    setBaselineDragLock(false);
    resetScrubberVisuals();
    hideScrubber(curvesData, keepLabelAtHoverPosition);
    _hoverRearmUntilTs = performance.now() + SCRUBBER_HOVER_REARM_MS;
    syncPeakLabelsToCurves(curvesData);
}

function syncHeldLabelToCurrentCurveY(curvesData: any[]): void {
    if (state.hoverLabelCurveIdx === null) return;

    const curveIdx = state.hoverLabelCurveIdx;
    const labelGroup = getLabelGroupForCurve(curveIdx);
    const peak = getDisplayPeakPoint(curveIdx, curvesData);
    if (!labelGroup || !peak) return;

    const currentX = getLabelCurrentX(curveIdx, phaseChartX(peak.point.hour * 60));
    moveLabelTowardX(curveIdx, currentX, curvesData, 1);
}

// ============================================
// Global Universal Scrubber (Clean UX)
// ============================================

function initScrubberElements(editorGroup: Element) {
    if (scrubberGroup) return;

    scrubberGroup = svgEl('g', { id: 'baseline-universal-scrubber', class: 'universal-scrubber' }) as SVGGElement;
    scrubberGroup.style.transition = 'opacity 0.15s ease-out';
    scrubberGroup.setAttribute('opacity', '0');

    scrubberStem = svgEl('line', {
        y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: '#fff',
        'stroke-width': '1.5',
        'stroke-opacity': '0.3',
        'stroke-dasharray': '3 4',
        'pointer-events': 'none',
    }) as SVGLineElement;

    scrubberKnobGlow = svgEl('circle', {
        r: '18',
        fill: '#fff',
        'fill-opacity': '0.12',
        'pointer-events': 'all',
    }) as SVGCircleElement;

    scrubberKnob = svgEl('circle', {
        r: '5',
        fill: '#000',
        stroke: '#fff',
        'stroke-width': '2.5',
        'pointer-events': 'none',
    }) as SVGCircleElement;

    scrubberHourLabel = svgEl('text', {
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '10',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: '#fff',
        'pointer-events': 'none',
        'font-weight': '400',
        'letter-spacing': '0.5',
    }) as SVGTextElement;

    scrubberDescLabel = svgEl('text', {
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '12',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: '#fff',
        'fill-opacity': '0.9',
        'pointer-events': 'none',
        'font-weight': '600',
    }) as SVGTextElement;

    // Apply strict non-interactability to group, enable interactability only on glow knob
    scrubberGroup.style.pointerEvents = 'none';
    scrubberKnobGlow.style.pointerEvents = 'auto';

    scrubberGroup.appendChild(scrubberStem);
    scrubberGroup.appendChild(scrubberKnobGlow);
    scrubberGroup.appendChild(scrubberKnob);
    scrubberGroup.appendChild(scrubberHourLabel);
    scrubberGroup.appendChild(scrubberDescLabel);

    editorGroup.appendChild(scrubberGroup);
}

function setupScrubberHover(curvesData: any[]): void {
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement;
    const editorGroup = document.getElementById('phase-baseline-editor')!;

    initScrubberElements(editorGroup);

    const hitRect = svgEl('rect', {
        x: String(PHASE_CHART.padL),
        y: String(PHASE_CHART.padT),
        width: String(PHASE_CHART.plotW),
        height: String(PHASE_CHART.plotH),
        fill: 'transparent',
        'pointer-events': 'all',
        class: 'baseline-hover-hit',
    });
    const setMagnetCursor = (locked: boolean) => {
        const cursor = locked ? 'ns-resize' : 'default';
        hitRect.setAttribute('cursor', cursor);
        if (scrubberKnobGlow) {
            scrubberKnobGlow.setAttribute('cursor', cursor);
        }
    };
    setMagnetCursor(false);
    editorGroup.insertBefore(hitRect, editorGroup.firstChild);

    const onMove = (e: MouseEvent | TouchEvent) => {
        if (state.suppressHover || state.dragCurveIdx !== null || state.scrubberDrag) return;
        if (state.awaitingLabelReturnOnMove && state.hoverLabelCurveIdx !== null) {
            const pointerX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
            const pointerY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
            const releaseX = state.awaitingLabelReturnFromX ?? pointerX;
            const releaseY = state.awaitingLabelReturnFromY ?? pointerY;
            const moveDistance = Math.hypot(pointerX - releaseX, pointerY - releaseY);
            if (moveDistance < SCRUBBER_RELEASE_RETURN_HYSTERESIS_PX) {
                return;
            }
            state.awaitingLabelReturnOnMove = false;
            state.awaitingLabelReturnFromX = null;
            state.awaitingLabelReturnFromY = null;
            animateLabelBackToPeak(state.hoverLabelCurveIdx, curvesData);
            setPeakLabelTextScale(state.hoverLabelCurveIdx, false);
            setMagnetCursor(false);
            return;
        }
        if (performance.now() < _hoverRearmUntilTs) {
            hideScrubber(curvesData);
            setMagnetCursor(false);
            return;
        }
        const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
        const svgX = clientXToSvgX(svg, clientX);
        const svgY = clientYToSvgY(svg, clientY);
        if (svgX === null || svgY === null) return;

        const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
        const plotBottom = PHASE_CHART.padT + PHASE_CHART.plotH;
        if (svgX < PHASE_CHART.padL || svgX > plotRight || svgY < PHASE_CHART.padT || svgY > plotBottom) {
            hideScrubber(curvesData);
            setMagnetCursor(false);
            return;
        }

        const candidate = getScrubberHoverCandidate(svgX, svgY, curvesData);
        if (!candidate) {
            hideScrubber(curvesData);
            setMagnetCursor(false);
            return;
        }
        const { closestCurve, closestDotIdx, closestX, closestY } = candidate;

        if (state.hoverLabelCurveIdx !== null && state.hoverLabelCurveIdx !== closestCurve) {
            setPeakLabelTextScale(state.hoverLabelCurveIdx, false);
            animateLabelBackToPeak(state.hoverLabelCurveIdx, curvesData);
            clearPeakLabelMagnetOffset(state.hoverLabelCurveIdx);
            setMagnetCursor(false);
        }
        setPeakLabelTextScale(closestCurve, true);
        setPeakLabelMagnetOffset(closestCurve, svgX, svgY, closestX, closestY);
        setMagnetCursor(true);
        state.hoverLabelCurveIdx = closestCurve;

        state.activeScrubberCurveIdx = closestCurve;
        state.activeScrubberDotIdx = closestDotIdx;
        state.activeScrubberAnchorX = closestX;
        state.activeScrubberAnchorY = closestY;
        stopReturningLabelAnimation();
        moveLabelTowardX(closestCurve, closestX, curvesData, 0.32);
        updateScrubberPosition(closestCurve, closestDotIdx, curvesData);
    };

    const onEnter = () => {
        if (state.hoverDebounceTimer) {
            clearTimeout(state.hoverDebounceTimer);
            state.hoverDebounceTimer = null;
        }
    };

    const onLeave = (e: MouseEvent) => {
        // Suppress hide if we entered the knob
        if (e.relatedTarget === scrubberKnobGlow) {
            return;
        }

        if (state.hoverDebounceTimer) clearTimeout(state.hoverDebounceTimer);
        state.hoverDebounceTimer = setTimeout(() => {
            state.hoverDebounceTimer = null;
            if (!state.scrubberDrag && state.dragCurveIdx === null) {
                hideScrubber(curvesData);
                setMagnetCursor(false);
            }
        }, 150);
    };

    hitRect.addEventListener('mousemove', onMove);
    hitRect.addEventListener('touchmove', onMove, { passive: true });
    hitRect.addEventListener('mouseenter', onEnter);
    hitRect.addEventListener('mouseleave', onLeave);

    let scrubberPointerId: number | null = null;

    function bindWindowScrubberDragListeners(): void {
        window.addEventListener('pointermove', onScrubberMove as EventListener, { passive: false });
        window.addEventListener('pointerup', onScrubberUp as EventListener);
        window.addEventListener('pointercancel', onScrubberUp as EventListener);
    }

    function unbindWindowScrubberDragListeners(): void {
        window.removeEventListener('pointermove', onScrubberMove as EventListener);
        window.removeEventListener('pointerup', onScrubberUp as EventListener);
        window.removeEventListener('pointercancel', onScrubberUp as EventListener);
    }

    // Pointer Events + window-level listeners for scrubber drag (tracks beyond SVG bounds)
    const onScrubberDown = (e: PointerEvent) => {
        if (state.activeScrubberCurveIdx === null || state.activeScrubberDotIdx === null) return;
        const startSvgY = clientYToSvgY(svg, e.clientY);
        if (startSvgY === null) return;
        const startSvgX = clientXToSvgX(svg, e.clientX);
        e.preventDefault();
        e.stopPropagation();
        state.awaitingLabelReturnOnMove = false;
        state.awaitingLabelReturnFromX = null;
        state.awaitingLabelReturnFromY = null;
        scrubberPointerId = e.pointerId;
        setMagnetCursor(true);
        try {
            (scrubberKnobGlow as any)?.setPointerCapture?.(e.pointerId);
        } catch {}
        bindWindowScrubberDragListeners();
        const curveIdx = state.activeScrubberCurveIdx;
        const dotIdx = state.activeScrubberDotIdx;
        stopCurveRelaxation(curveIdx);
        state.suppressHover = true;
        const baselinePt = curvesData[curveIdx]?.baseline?.[dotIdx];
        const fallbackX = baselinePt ? phaseChartX(baselinePt.hour * 60) : PHASE_CHART.padL;
        const clampedStartX = Math.max(
            PHASE_CHART.padL,
            Math.min(PHASE_CHART.padL + PHASE_CHART.plotW, startSvgX ?? fallbackX),
        );
        const clampedStartY = Math.max(PHASE_CHART.padT, Math.min(PHASE_CHART.padT + PHASE_CHART.plotH, startSvgY));
        state.activeScrubberAnchorX = clampedStartX;
        state.activeScrubberAnchorY = clampedStartY;
        setBaselineDragLock(true);

        state.scrubberDrag = {
            curveIdx,
            dotIdx,
            startSvgY,
            originalValue: curvesData[curveIdx].baseline[dotIdx].value,
            originalBaseline: curvesData[curveIdx].baseline.map((pt: any) => Number(pt.value)),
        };
        state.hoverLabelCurveIdx = curveIdx;
        setPeakLabelTextScale(curveIdx, true);
        clearPeakLabelMagnetOffset(curveIdx);
        stopReturningLabelAnimation();

        if (scrubberKnobGlow) {
            scrubberKnobGlow.setAttribute('fill-opacity', '0.28');
            scrubberKnobGlow.setAttribute('r', '24');
        }
    };

    const onScrubberMove = (e: PointerEvent) => {
        if (!state.scrubberDrag) return;
        if (scrubberPointerId !== null && e.pointerId !== scrubberPointerId) return;
        e.preventDefault();

        const currentSvgY = clientYToSvgY(svg, e.clientY);
        if (currentSvgY === null) return;
        const currentSvgX = clientXToSvgX(svg, e.clientX);

        const { curveIdx, originalBaseline } = state.scrubberDrag;
        if (!originalBaseline) return;
        const clampedSvgY = Math.max(PHASE_CHART.padT, Math.min(PHASE_CHART.padT + PHASE_CHART.plotH, currentSvgY));
        const clampedSvgX =
            currentSvgX === null
                ? state.activeScrubberAnchorX
                : Math.max(PHASE_CHART.padL, Math.min(PHASE_CHART.padL + PHASE_CHART.plotW, currentSvgX));
        const dotIdx = getNearestDotIdxForSvgX(curvesData[curveIdx].baseline, clampedSvgX ?? PHASE_CHART.padL);
        state.scrubberDrag.dotIdx = dotIdx;
        state.activeScrubberDotIdx = dotIdx;
        const newValue = valueFromSvgY(clampedSvgY);

        applyLocalDragSmoothing(curvesData[curveIdx].baseline, originalBaseline, dotIdx, newValue);

        rerenderBaselineCurve(curveIdx, curvesData);
        if (clampedSvgX !== null) state.activeScrubberAnchorX = clampedSvgX;
        state.activeScrubberAnchorY = clampedSvgY;
        updateScrubberPosition(curveIdx, dotIdx, curvesData);
        syncPeakLabelsToCurves(curvesData);
        if (clampedSvgX !== null) {
            moveLabelTowardX(curveIdx, clampedSvgX, curvesData, 0.42);
        }
    };

    const onScrubberUp = (e: PointerEvent) => {
        if (!state.scrubberDrag) return;
        if (scrubberPointerId !== null && e.pointerId !== scrubberPointerId) return;
        const releasedCurveIdx = state.scrubberDrag.curveIdx;
        const releaseFromPts = getDisplayCurvePoints(releasedCurveIdx, curvesData);
        const releaseClientX = e.clientX;
        const releaseClientY = e.clientY;
        const releaseSvgX = clientXToSvgX(svg, releaseClientX);
        const releaseSvgY = clientYToSvgY(svg, releaseClientY);
        const releaseCandidate =
            releaseSvgX !== null && releaseSvgY !== null
                ? getScrubberHoverCandidate(releaseSvgX, releaseSvgY, curvesData)
                : null;
        const pid = scrubberPointerId ?? e.pointerId;
        scrubberPointerId = null;
        unbindWindowScrubberDragListeners();
        try {
            (scrubberKnobGlow as any)?.releasePointerCapture?.(pid);
        } catch {}
        state.scrubberDrag = null;
        if (state.hoverLabelCurveIdx !== null) {
            clearPeakLabelMagnetOffset(state.hoverLabelCurveIdx);
        }
        startCurveRelaxation(releasedCurveIdx, curvesData, releaseFromPts);
        const keepLabelAtHoverPosition = !!releaseCandidate;
        state.awaitingLabelReturnOnMove = keepLabelAtHoverPosition;
        state.awaitingLabelReturnFromX = releaseClientX;
        state.awaitingLabelReturnFromY = releaseClientY;
        finalizeCurveDragInteraction(curvesData, keepLabelAtHoverPosition);
        if (releaseCandidate) {
            const { closestCurve, closestDotIdx, closestX, closestY } = releaseCandidate;
            state.activeScrubberCurveIdx = closestCurve;
            state.activeScrubberDotIdx = closestDotIdx;
            state.activeScrubberAnchorX = closestX;
            state.activeScrubberAnchorY = closestY;
            setPeakLabelTextScale(closestCurve, true);
            moveLabelTowardX(closestCurve, closestX, curvesData, 1);
            setMagnetCursor(true);
        } else {
            setMagnetCursor(false);
        }
    };

    if (scrubberKnobGlow) {
        // Drag events use window listeners for cross-boundary tracking
        scrubberKnobGlow.addEventListener('pointerdown', onScrubberDown as EventListener);
        scrubberKnobGlow.addEventListener('pointermove', onMove as EventListener);
        scrubberKnobGlow.addEventListener('mousemove', onMove as EventListener);

        // Hover events stay as mouse events for debounce timer
        scrubberKnobGlow.addEventListener('mouseenter', (e: MouseEvent) => {
            if (state.hoverDebounceTimer) {
                clearTimeout(state.hoverDebounceTimer);
                state.hoverDebounceTimer = null;
            }
            e.stopPropagation();
        });

        scrubberKnobGlow.addEventListener('mouseleave', (e: MouseEvent) => {
            // Only start the fade if they've fully left into non-hitRect territory
            if (e.relatedTarget !== hitRect) {
                onLeave(e);
            }
        });
    }

    state.cleanupFns.push(() => {
        hitRect.removeEventListener('mousemove', onMove);
        hitRect.removeEventListener('touchmove', onMove);
        hitRect.removeEventListener('mouseenter', onEnter);
        hitRect.removeEventListener('mouseleave', onLeave);
        hitRect.remove();

        if (scrubberKnobGlow) {
            scrubberKnobGlow.removeEventListener('pointerdown', onScrubberDown as EventListener);
            scrubberKnobGlow.removeEventListener('pointermove', onMove as EventListener);
            scrubberKnobGlow.removeEventListener('mousemove', onMove as EventListener);
        }
        unbindWindowScrubberDragListeners();
    });
}

function updateScrubberPosition(curveIdx: number, dotIdx: number, curvesData: any[]): void {
    if (
        !scrubberGroup ||
        !scrubberStem ||
        !scrubberKnob ||
        !scrubberKnobGlow ||
        !scrubberHourLabel ||
        !scrubberDescLabel
    )
        return;

    const curve = curvesData[curveIdx];
    const pt = curve.baseline?.[dotIdx];
    if (!pt) return;
    const displayPts = getDisplayCurvePoints(curveIdx, curvesData);
    const hasActiveAnchor = state.activeScrubberCurveIdx === curveIdx && state.activeScrubberAnchorX !== null;
    const hasAnchorY = state.activeScrubberCurveIdx === curveIdx && state.activeScrubberAnchorY !== null;

    const defaultCx = phaseChartX(pt.hour * 60);
    const rawCx = hasActiveAnchor ? state.activeScrubberAnchorX! : defaultCx;
    const cx = Math.max(PHASE_CHART.padL, Math.min(PHASE_CHART.padL + PHASE_CHART.plotW, rawCx));
    const rawCy = hasAnchorY ? state.activeScrubberAnchorY! : getCurveRenderedYAtSvgX(curveIdx, cx, displayPts);
    const cy = Math.max(PHASE_CHART.padT, Math.min(PHASE_CHART.padT + PHASE_CHART.plotH, rawCy));
    const displayValue = valueFromSvgY(cy);

    if (scrubberGroup.getAttribute('opacity') === '0') {
        scrubberGroup.setAttribute('opacity', '1');
    }

    const dt = chartTheme();
    scrubberStem.setAttribute('stroke', curve.color);
    scrubberKnobGlow.setAttribute('fill', curve.color);
    scrubberKnob.setAttribute('stroke', curve.color);
    scrubberKnob.setAttribute('fill', dt.tooltipBg);

    scrubberStem.setAttribute('x1', cx.toFixed(1));
    scrubberStem.setAttribute('x2', cx.toFixed(1));
    scrubberStem.setAttribute('y1', cy.toFixed(1));

    scrubberKnobGlow.setAttribute('cx', cx.toFixed(1));
    scrubberKnobGlow.setAttribute('cy', cy.toFixed(1));

    scrubberKnob.setAttribute('cx', cx.toFixed(1));
    scrubberKnob.setAttribute('cy', cy.toFixed(1));

    const magnetOffset = getPeakLabelMagnetOffset(curveIdx);
    const labelBaseY = cy + (cy < PHASE_CHART.padT + 60 ? +32 : -32);
    const labelX = cx + magnetOffset.x;
    const labelY = labelBaseY + magnetOffset.y;

    scrubberHourLabel.setAttribute('x', labelX.toFixed(1));
    scrubberHourLabel.setAttribute('y', labelY.toFixed(1));
    scrubberHourLabel.textContent = formatClockTimeFromSvgX(cx);
    scrubberHourLabel.setAttribute('fill', curve.color);

    const levelData = getLevelData(curve, displayValue);
    const shortDesc = levelData.label;

    scrubberDescLabel.setAttribute('x', labelX.toFixed(1));
    scrubberDescLabel.setAttribute('y', (labelY + SCRUBBER_TIMESTAMP_TO_LABEL_PADDING_PX).toFixed(1));
    scrubberDescLabel.setAttribute('fill', curve.color);
    const showScrubberDescriptor = state.hoverLabelCurveIdx === null;
    if (showScrubberDescriptor) {
        scrubberDescLabel.textContent = shortDesc;
        scrubberDescLabel.setAttribute('fill-opacity', '0.9');
    } else {
        scrubberDescLabel.textContent = '';
        scrubberDescLabel.setAttribute('fill-opacity', '0');
    }
}

function hideScrubber(curvesData: any[], keepLabelAtCurrentPosition = false): void {
    if (scrubberGroup) {
        scrubberGroup.setAttribute('opacity', '0');
    }
    if (!keepLabelAtCurrentPosition) {
        state.awaitingLabelReturnOnMove = false;
        state.awaitingLabelReturnFromX = null;
        state.awaitingLabelReturnFromY = null;
    }
    if (state.dragCurveIdx === null && !state.scrubberDrag) {
        if (state.hoverLabelCurveIdx !== null) {
            clearPeakLabelMagnetOffset(state.hoverLabelCurveIdx);
        }
        if (!keepLabelAtCurrentPosition && state.hoverLabelCurveIdx !== null) {
            setPeakLabelTextScale(state.hoverLabelCurveIdx, false);
            animateLabelBackToPeak(state.hoverLabelCurveIdx, curvesData);
            state.hoverLabelCurveIdx = null;
        }
    }
    state.activeScrubberCurveIdx = null;
    state.activeScrubberDotIdx = null;
    state.activeScrubberAnchorX = null;
    state.activeScrubberAnchorY = null;
}

function valueFromSvgY(svgY: number): number {
    const top = PHASE_CHART.padT;
    const bottom = PHASE_CHART.padT + PHASE_CHART.plotH;
    const clampedY = Math.max(top, Math.min(bottom, svgY));
    const ratio = (bottom - clampedY) / PHASE_CHART.plotH;
    return clamp(ratio * 100, 0, 100);
}

function formatClockTimeFromSvgX(svgX: number): string {
    const ratio = clamp((svgX - PHASE_CHART.padL) / PHASE_CHART.plotW, 0, 1);
    const absoluteMinutes = PHASE_CHART.startMin + ratio * PHASE_CHART.totalMin;
    const minuteAtCursor = Math.floor(absoluteMinutes + 1e-6);
    const hh = Math.floor(minuteAtCursor / 60);
    const mm = minuteAtCursor % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

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

function applyLocalDragSmoothing(
    baseline: any[],
    originalValues: number[],
    centerIdx: number,
    centerTarget: number,
): void {
    const centerOriginal = originalValues[centerIdx];
    const delta = centerTarget - centerOriginal;
    const radius = DRAG_FALLOFF_WEIGHTS.length - 1;
    for (let i = 0; i < baseline.length; i++) {
        const dist = Math.abs(i - centerIdx);
        const weight = dist <= radius ? DRAG_FALLOFF_WEIGHTS[dist] : 0;
        const next = originalValues[i] + delta * weight;
        baseline[i].value = clamp(next, 0, 100);
    }
}

function setBaselineDragLock(active: boolean): void {
    document.body.classList.toggle('baseline-drag-lock', active);
    if (active) {
        try {
            window.getSelection?.()?.removeAllRanges();
        } catch {}
    }
}

function easeReleaseSettle(t: number): number {
    const base = 1 - Math.pow(1 - t, 3);
    const settle = Math.sin(t * Math.PI) * 0.06 * (1 - t);
    return clamp(base - settle, 0, 1);
}

function stopCurveRelaxation(curveIdx: number): void {
    const existing = state.curveRelaxations.get(curveIdx);
    if (!existing) return;
    if (existing.rafId !== null) {
        cancelAnimationFrame(existing.rafId);
    }
    state.curveRelaxations.delete(curveIdx);
}

function startCurveRelaxation(curveIdx: number, curvesData: any[], fromPts: any[]): void {
    if (!fromPts || fromPts.length === 0) return;
    const curve = curvesData[curveIdx];
    if (!curve?.baseline || curve.baseline.length === 0) return;

    const toPts = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    if (!toPts.length || toPts.length !== fromPts.length) return;

    stopCurveRelaxation(curveIdx);

    const relaxation: CurveRelaxation = {
        fromPts: fromPts.map((p: any) => ({ ...p })),
        toPts: toPts.map((p: any) => ({ ...p })),
        startMs: performance.now(),
        durationMs: 650,
        rafId: null,
    };
    state.curveRelaxations.set(curveIdx, relaxation);

    const tick = () => {
        const active = state.curveRelaxations.get(curveIdx);
        if (!active) return;
        const t = clamp((performance.now() - active.startMs) / active.durationMs, 0, 1);
        rerenderBaselineCurve(curveIdx, curvesData);
        syncHeldLabelToCurrentCurveY(curvesData);
        syncPeakLabelsToCurves(curvesData);
        if (t >= 1) {
            stopCurveRelaxation(curveIdx);
            rerenderBaselineCurve(curveIdx, curvesData);
            syncHeldLabelToCurrentCurveY(curvesData);
            syncPeakLabelsToCurves(curvesData);
            return;
        }
        active.rafId = requestAnimationFrame(tick);
    };

    relaxation.rafId = requestAnimationFrame(tick);
}

// ============================================
// Shared: Re-render Baseline Curve Path
// ============================================

function rerenderBaselineCurve(curveIdx: number, curvesData: any[]): void {
    const curve = curvesData[curveIdx];
    if (!curve?.baseline) return;
    const baseGroup = document.getElementById('phase-baseline-curves')!;
    const sub = baseGroup.querySelector(`#phase-baseline-curves-e${curveIdx}`) || baseGroup;
    const displayPts = getDisplayCurvePoints(curveIdx, curvesData);
    if (!displayPts.length) return;

    const strokePath = sub.querySelector('.phase-baseline-path') as SVGPathElement | null;
    if (strokePath) {
        const newD = phasePointsToPath(displayPts, true);
        strokePath.setAttribute('d', newD);
    }

    const paths = sub.querySelectorAll('path');
    for (const p of Array.from(paths)) {
        if (!p.classList.contains('phase-baseline-path') && !p.classList.contains('baseline-hover-hit')) {
            p.setAttribute('d', phasePointsToFillPath(displayPts, true));
            break;
        }
    }
}
