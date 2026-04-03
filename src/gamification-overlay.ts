/**
 * Gamification Overlay — Gain metrics callout rendered on the phase chart.
 * Supports imperative tracking during Phase 2 / Phase 4 and deterministic
 * engine-driven replay by sharing one pure frame renderer.
 */
import { PHASE_CHART, TIMELINE_ZONE } from './constants';
import { DividerState, MultiDayState, PhaseState, RevisionState, isTurboActive } from './state';
import { svgEl, phaseChartX, phaseChartY, chartTheme, clamp } from './utils';
import { interpolatePointsAtTime } from './curve-utils';
import { getEffectSubGroup } from './divider';
import { computeStackingPeaks } from './lx-compute';
import { normalizedEffectAt } from './pharma-model';

type OverlaySource = 'phase2' | 'phase4';
type CurvePoint = { hour: number; value: number };

const BOX_W = 240;
const BOX_H = 100;
const BOX_RX = 12;
const MIN_PEAK_GAIN = 3;
const CONTAINER_ID = 'gamification-overlay-container';
const ENTRANCE_MS = 500;
const FIELD_STEP = 12;
const FIELD_BLUR_RADIUS = 2; // 24 SVG units
const UPPER_BAND_RATIO = 0.45;
const BASIN_COST_TOLERANCE = 0.12;
const BASIN_SWITCH_IMPROVEMENT_RATIO = 0.2;
const BASIN_SWITCH_HOLD_MS = 180;
const SMOOTHING_HALF_LIFE_MS = 240;
const LOWER_BAND_ADVANTAGE_RATIO = 0.18;
const BASIN_OVERLAP_THRESHOLD = 0.32;
const BASIN_CENTROID_DISTANCE = FIELD_STEP * 3;

const CONCENTRATED_AREA_FRACTION = 0.65;
const CONCENTRATED_MAX_SPAN_HOURS = 4;
const PEAK_WINDOW_THRESHOLD = 0.4;
const SPREAD_CUMULATIVE_TRIM = 0.1;
const BOX_SAFE_X_PAD = 10;
const BOX_SAFE_Y_PAD = 10;
const BOX_CURVE_CLEARANCE = 10;
const IMPROVEMENT_GAP_THRESHOLD = 2;
const TOP_CHROME_HEIGHT = 34;
const BOTTOM_CHROME_HEIGHT = 18;
const UPPER_BAND_FALLBACK_PENALTY = 30;
const PROTECTED_OBSTACLE_INVALID_COST = 1000000;
const CONNECTOR_DENSITY_SAMPLE = 16;
const CONNECTOR_DENSITY_RADIUS = 20;
const CONNECTOR_CURVE_RADIUS = 14;
const CURVE_PRESSURE_SAMPLES = 10;

const STACKING_BAR_WIDTH = 10;
const STACKING_BAR_HEIGHT = 24;
const STACKING_BAR_GAP = 8;
const STACKING_BAR_TOP_Y = 38;
const STACKING_BAR_MIN_SEGMENT = 2;

// ---------------------------------------------------------------------------
// Per-effect improvement % — Cmax shift from baseline (peak % change)
// ---------------------------------------------------------------------------

function computeEffectImprovement(
    lxPoints: CurvePoint[],
    baselinePoints: CurvePoint[],
    _desiredPoints: CurvePoint[],
    polarity: string | undefined,
): number | null {
    if (!lxPoints?.length || !baselinePoints?.length) return null;
    const len = Math.min(lxPoints.length, baselinePoints.length);
    let maxRatio = 0;

    for (let i = 0; i < len; i++) {
        const b = baselinePoints[i].value;
        if (Math.abs(b) < IMPROVEMENT_GAP_THRESHOLD) continue;
        const lx = lxPoints[i].value;
        const shift = polarity === 'higher_is_worse' ? b - lx : lx - b;
        const ratio = shift / b;
        if (ratio > maxRatio) maxRatio = ratio;
    }

    if (maxRatio === 0) return null;
    return Math.max(maxRatio * 100, 0);
}

function formatPeakContext(peak: PeakGainPosition, polarity?: string): string {
    const h = peak.peakHour % 24;
    const hours = Math.floor(h);
    const minutes = Math.round((h - hours) * 60);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const mm = String(minutes).padStart(2, '0');
    const gain = Math.round(peak.peakGain);
    const sign = polarity === 'higher_is_worse' ? '-' : '+';
    return `Peak ${sign}${gain} pts at ${h12}:${mm} ${ampm}`;
}

export interface GainProfile {
    type: 'concentrated' | 'spread';
    peakGain: number;
    peakHour: number;
    anchorX: number;
    anchorY: number;
    spreadStartX?: number;
    spreadEndX?: number;
}

export interface BoxPosition {
    x: number;
    y: number;
}

export interface PeakGainPosition {
    peakGain: number;
    peakHour: number;
    anchorX: number;
    anchorY: number;
}

interface PlacementBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    centerX: number;
}

interface BasinBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

interface PlacementObstacle {
    x: number;
    y: number;
    width: number;
    height: number;
    pad: number;
    penalty: number;
    blocksPlacement: boolean;
}

interface PlacementEvaluation {
    valid: boolean;
    rawObstaclePressure: number;
    curveClearance: number;
    curvePressure: number;
    connectorDensityCost: number;
    connectorLengthCost: number;
    poiDistanceCost: number;
    bandCost: number;
}

interface OccupancyCell {
    x: number;
    y: number;
    row: number;
    col: number;
    upperBand: boolean;
    valid: boolean;
    rawObstaclePressure: number;
    blurredObstaclePressure: number;
    curveClearance: number;
    curvePressure: number;
    connectorDensityCost: number;
    connectorLengthCost: number;
    poiDistanceCost: number;
    bandCost: number;
    totalCost: number;
}

interface PlacementField {
    bounds: PlacementBounds;
    step: number;
    cols: number;
    rows: number;
    upperBandMaxY: number;
    cells: OccupancyCell[];
}

interface PlacementBasin {
    basinId: string;
    centroid: BoxPosition;
    bestCost: number;
    meanCost: number;
    bounds: BasinBounds;
    upperBand: boolean;
    cellCount: number;
    bestCell: OccupancyCell;
}

interface ResolvedPlacementTarget {
    box: BoxPosition;
    basinId: string;
    cost: number;
    basinBounds: BasinBounds;
    upperBand: boolean;
    bestCell: Pick<OccupancyCell, 'x' | 'y' | 'row' | 'col'>;
}

interface PlacementMemory {
    currentTarget: BoxPosition | null;
    currentBasinId: string | null;
    currentBasinCost: number | null;
    currentBasinBounds: BasinBounds | null;
    pendingBasinId: string | null;
    pendingBasinCost: number | null;
    pendingBasinBounds: BasinBounds | null;
    pendingBasinSince: number | null;
}

interface PlacementResolution {
    placement: ResolvedPlacementTarget;
    memory: PlacementMemory;
}

interface ConnectorOrigin {
    x: number;
    y: number;
    side: 'left' | 'right' | 'top' | 'bottom';
}

interface TrackedEffect {
    effectIdx: number;
    effectCount: number;
    polarity: string | undefined;
    baselinePoints: CurvePoint[] | null;
    displayedPoints: CurvePoint[] | null;
    currentBoxX: number | null;
    currentBoxY: number | null;
    targetBoxX: number | null;
    targetBoxY: number | null;
    lastResolvedBox: BoxPosition | null;
    lastPeak: PeakGainPosition | null;
    currentBasinId: string | null;
    currentBasinCost: number | null;
    currentBasinBounds: BasinBounds | null;
    pendingBasinId: string | null;
    pendingBasinCost: number | null;
    pendingBasinBounds: BasinBounds | null;
    pendingBasinSince: number | null;
    lastRenderAt: number | null;
    peakLock: PeakGainPosition | null;
    effectRoot: Element | null;
    frameGroup: SVGGElement | null;
    connectorPath: SVGPathElement | null;
    anchorDot: SVGCircleElement | null;
    boxGroupEl: SVGGElement | null;
    boxBackdropEl: SVGRectElement | null;
    boxTitleEl: SVGTextElement | null;
    bodyLineEls: SVGTextElement[];
    stackingBarGroup: SVGGElement | null;
}

interface FrameRenderOptions {
    immediate?: boolean;
    entranceProgress?: number;
}

interface ResolvedFrame {
    track: TrackedEffect;
    peak: PeakGainPosition;
    placement: ResolvedPlacementTarget;
    placementMemory: PlacementMemory;
    color: string;
}

let _trackingRafId: number | null = null;
let _tracked: TrackedEffect[] = [];
let _container: SVGGElement | null = null;
let _curvesData: any[] | null = null;
let _source: OverlaySource = 'phase2';
let _overlayMountedAt: number | null = null;
let _sweepProgress: number = 1;
let _sweepPlayheadHour: number = 30;
let _sweepStepIdx: number = -1; // which sorted-intervention index is currently sweeping (-1 = none)

function resetSweepState(): void {
    _sweepProgress = 1;
    _sweepPlayheadHour = 30;
    _sweepStepIdx = -1;
}

function createTrackedEffect(effectIdx: number, effectCount: number): TrackedEffect {
    return {
        effectIdx,
        effectCount,
        polarity: undefined,
        baselinePoints: null,
        displayedPoints: null,
        currentBoxX: null,
        currentBoxY: null,
        targetBoxX: null,
        targetBoxY: null,
        lastResolvedBox: null,
        lastPeak: null,
        currentBasinId: null,
        currentBasinCost: null,
        currentBasinBounds: null,
        pendingBasinId: null,
        pendingBasinCost: null,
        pendingBasinBounds: null,
        pendingBasinSince: null,
        lastRenderAt: null,
        peakLock: null,
        effectRoot: null,
        frameGroup: null,
        connectorPath: null,
        anchorDot: null,
        boxGroupEl: null,
        boxBackdropEl: null,
        boxTitleEl: null,
        bodyLineEls: [],
        stackingBarGroup: null,
    };
}

function clearEffectDom(track: TrackedEffect): void {
    track.frameGroup?.remove();
    track.effectRoot = null;
    track.frameGroup = null;
    track.connectorPath = null;
    track.anchorDot = null;
    track.boxGroupEl = null;
    track.boxBackdropEl = null;
    track.boxTitleEl = null;
    track.bodyLineEls = [];
    track.stackingBarGroup = null;
}

function clearTrackedDom(): void {
    for (const track of _tracked) clearEffectDom(track);
}

function cancelTrackingRaf(): void {
    if (_trackingRafId != null) {
        cancelAnimationFrame(_trackingRafId);
        _trackingRafId = null;
    }
}

function resetOverlayState(): void {
    cancelTrackingRaf();
    clearTrackedDom();
    _tracked = [];
    _container = null;
    _curvesData = null;
    _overlayMountedAt = null;
    resetSweepState();
    DividerState.onUpdate = null;
}

function getLiveContainer(): SVGGElement | null {
    if (typeof document === 'undefined') return null;
    const live = document.getElementById(CONTAINER_ID) as unknown as SVGGElement | null;
    if (live) {
        _container = live;
        return live;
    }
    return null;
}

function ensureContainer(source: OverlaySource): SVGGElement | null {
    if (typeof document === 'undefined') return null;
    const live = getLiveContainer();
    if (live) {
        live.setAttribute('data-source', source);
        return live;
    }

    clearTrackedDom();
    const tooltipOverlay = document.getElementById('phase-tooltip-overlay');
    if (!tooltipOverlay) return null;

    _container = svgEl('g', { id: CONTAINER_ID, 'data-source': source }) as SVGGElement;
    tooltipOverlay.appendChild(_container);
    return _container;
}

function ensureTrackedEffects(lxCurves: any[] | null | undefined, curvesData: any[], source: OverlaySource): void {
    _curvesData = curvesData;
    _source = source;
    DividerState.onUpdate = updateGamificationOverlayForDivider;

    const effectCount = Math.min(
        curvesData.length,
        Array.isArray(lxCurves) && lxCurves.length > 0 ? lxCurves.length : curvesData.length,
    );

    if (_tracked.length !== effectCount) {
        for (const stale of _tracked.slice(effectCount)) clearEffectDom(stale);
        _tracked = Array.from({ length: effectCount }, (_, idx) => createTrackedEffect(idx, effectCount));
    }

    for (let i = 0; i < effectCount; i++) {
        const track = _tracked[i];
        const lx = lxCurves?.[i];
        const curve = curvesData[i] || {};
        track.effectCount = effectCount;
        track.polarity = curve.polarity;
        track.baselinePoints = lx?.baseline ?? curve.baseline ?? track.baselinePoints;
        track.displayedPoints = lx?.points ?? track.displayedPoints ?? lx?.baseline ?? curve.baseline ?? null;
    }
}

function resolveEntranceProgress(override?: number): number {
    if (override != null) return clamp(override, 0, 1);
    if (isTurboActive()) return 1;
    if (_overlayMountedAt == null) return 1;
    return clamp((performance.now() - _overlayMountedAt) / ENTRANCE_MS, 0, 1);
}

function createBoxContent(): {
    group: SVGGElement;
    backdrop: SVGRectElement;
    title: SVGTextElement;
    bodyLines: SVGTextElement[];
} {
    const theme = chartTheme();
    const group = svgEl('g', { class: 'gamification-box' }) as SVGGElement;

    const backdrop = svgEl('rect', {
        x: '0',
        y: '0',
        width: String(BOX_W),
        height: String(BOX_H),
        rx: String(BOX_RX),
        ry: String(BOX_RX),
        fill: theme.tooltipBg,
        'stroke-opacity': '0.3',
        'stroke-width': '1',
    }) as SVGRectElement;
    group.appendChild(backdrop);

    const title = svgEl('text', {
        x: '16',
        y: '26',
        'font-size': '13',
        'font-weight': '500',
        'font-family': "'Space Grotesk', sans-serif",
        'letter-spacing': '0.6',
    }) as SVGTextElement;
    title.textContent = '';
    group.appendChild(title);

    const line1 = svgEl('text', {
        x: '16',
        y: '62',
        'font-size': '28',
        'font-weight': '700',
        'font-family': "'IBM Plex Mono', 'Space Grotesk', monospace",
    }) as SVGTextElement;
    line1.textContent = '';
    group.appendChild(line1);

    const line2 = svgEl('text', {
        x: '16',
        y: '84',
        'font-size': '11',
        'font-family': "'Space Grotesk', sans-serif",
        opacity: '0.7',
    }) as SVGTextElement;
    line2.textContent = '';
    group.appendChild(line2);

    return { group, backdrop, title, bodyLines: [line1, line2] };
}

function resolveAllInterventions(): any[] | null {
    if (_source === 'phase4' && (RevisionState as any).newInterventions?.length) {
        return (RevisionState as any).newInterventions;
    }
    if (MultiDayState.phase !== 'idle' && MultiDayState.days.length > 0) {
        const day = (MultiDayState as any).days[(MultiDayState as any).currentDay];
        if (day?.interventions?.length) return day.interventions;
    }
    return (PhaseState as any).interventionResult?.interventions ?? null;
}

function renderStackingBar(track: TrackedEffect, entranceProgress: number): void {
    const allInterventions = resolveAllInterventions();
    if (!allInterventions?.length || !_curvesData?.length) {
        if (track.stackingBarGroup) track.stackingBarGroup.setAttribute('opacity', '0');
        return;
    }

    // Compute full breakdown from ALL interventions (stable shares — never redistributes)
    const sorted = [...allInterventions].sort((a: any, b: any) => (a.timeMinutes || 0) - (b.timeMinutes || 0));
    const reports = computeStackingPeaks(sorted, _curvesData);
    const report = reports[track.effectIdx];
    if (!report?.breakdown?.length) {
        if (track.stackingBarGroup) track.stackingBarGroup.setAttribute('opacity', '0');
        return;
    }

    const positiveEntries = report.breakdown.filter((b: any) => b.contribution > 0);
    if (positiveEntries.length === 0) {
        if (track.stackingBarGroup) track.stackingBarGroup.setAttribute('opacity', '0');
        return;
    }

    const totalContribution = positiveEntries.reduce((s: number, b: any) => s + b.contribution, 0);
    if (totalContribution <= 0) {
        if (track.stackingBarGroup) track.stackingBarGroup.setAttribute('opacity', '0');
        return;
    }

    // Build substance key → color + intervention maps
    const colorMap = new Map<string, string>();
    const ivMap = new Map<string, any>();
    for (const iv of sorted) {
        if (iv.substance?.color) colorMap.set(iv.key, iv.substance.color);
        ivMap.set(iv.key, iv);
    }

    // Determine which substances are completed / sweeping / future.
    // Uses _sweepStepIdx (set by the sweep caller) instead of the stepper, because
    // the stepper advances currentStep before the sweep actually begins (during
    // pill/sherlock setup), which would flash the substance prematurely.
    const sweepingIdx = _sweepStepIdx;
    const duringReveal = sweepingIdx >= 0;
    // Map sorted intervention index → positiveEntries ordering
    const sortedKeys = sorted.map((iv: any) => iv.key);

    // Measure % text width for positioning
    const pctEl = track.bodyLineEls[0];
    let textWidth = 0;
    if (pctEl) {
        try {
            textWidth = pctEl.getComputedTextLength();
        } catch (_) {
            /* not in DOM yet */
        }
        if (!textWidth || textWidth < 10) {
            textWidth = (pctEl.textContent?.length || 4) * 17;
        }
    }

    const barX = 16 + textWidth + STACKING_BAR_GAP;

    // Create or reuse the bar group
    if (!track.stackingBarGroup || !track.stackingBarGroup.isConnected) {
        track.stackingBarGroup = svgEl('g', { class: 'gamification-stacking-bar' }) as SVGGElement;
        track.boxGroupEl?.appendChild(track.stackingBarGroup);
    }

    // Clear previous segments
    while (track.stackingBarGroup.firstChild) {
        track.stackingBarGroup.removeChild(track.stackingBarGroup.firstChild);
    }

    // Build segments: each substance gets a fixed final height from the stable full breakdown.
    // Completed: full height. Sweeping: scaled by live PK band height. Future: hidden.
    const segments: { color: string; height: number }[] = [];
    let remainingHeight = STACKING_BAR_HEIGHT;

    for (let i = 0; i < positiveEntries.length; i++) {
        const entry = positiveEntries[i];
        const sortedIdx = sortedKeys.indexOf(entry.key);

        // Future substance — not yet revealed
        if (duringReveal && sortedIdx > sweepingIdx) continue;

        const frac = entry.contribution / totalContribution;
        let finalH = Math.round(frac * STACKING_BAR_HEIGHT);
        if (finalH < STACKING_BAR_MIN_SEGMENT) finalH = STACKING_BAR_MIN_SEGMENT;
        finalH = Math.min(finalH, remainingHeight);
        if (finalH <= 0) break;

        let h = finalH;

        // Sweeping substance — scale by the live PK band height at the sweep playhead.
        // Once the playhead has crossed the substance peak, latch the segment full so
        // it never shrinks during the decay portion of the band sweep.
        if (duringReveal && sortedIdx === sweepingIdx) {
            const iv = ivMap.get(entry.key);
            let liveFrac = _sweepProgress; // fallback
            if (iv?.substance?.pharma) {
                const pharma = iv.substance.pharma;
                const doseMin = iv.timeMinutes || 0;
                const elapsedMin = _sweepPlayheadHour * 60 - doseMin;
                if (elapsedMin <= 0) {
                    liveFrac = 0;
                } else {
                    liveFrac = normalizedEffectAt(elapsedMin, pharma);
                    if (elapsedMin >= (pharma.peak || 0)) {
                        liveFrac = Math.max(liveFrac, 1);
                    }
                }
            }
            liveFrac = clamp(liveFrac, 0, 1);
            h = Math.max(liveFrac > 0.01 ? STACKING_BAR_MIN_SEGMENT : 0, Math.round(finalH * liveFrac));
            if (h <= 0) continue;
        }

        remainingHeight -= h;
        const color = colorMap.get(entry.key) || '#60a5fa';
        segments.push({ color, height: h });
    }

    // Render segments bottom-to-top
    let y = STACKING_BAR_TOP_Y + STACKING_BAR_HEIGHT;
    for (const seg of segments) {
        y -= seg.height;
        const rect = svgEl('rect', {
            x: String(barX),
            y: String(y),
            width: String(STACKING_BAR_WIDTH),
            height: String(seg.height),
            rx: '2',
            ry: '2',
            fill: seg.color,
            'fill-opacity': '0.85',
        });
        track.stackingBarGroup.appendChild(rect);
    }

    track.stackingBarGroup.setAttribute('opacity', entranceProgress.toFixed(3));
}

function ensureEffectDom(track: TrackedEffect, color: string): void {
    const container = ensureContainer(_source);
    if (!container) return;

    const root =
        track.effectCount >= 2 && DividerState.active ? getEffectSubGroup(container, track.effectIdx) : container;

    if (!track.frameGroup || !track.frameGroup.isConnected) {
        const frameGroup = svgEl('g', {
            id: `gamification-overlay-effect-${track.effectIdx}`,
            class: 'gamification-overlay-effect',
        }) as SVGGElement;
        const connectorPath = svgEl('path', {
            fill: 'none',
            'stroke-width': '1.2',
            'stroke-dasharray': '4 3',
            class: 'gamification-connector',
        }) as SVGPathElement;
        const anchorDot = svgEl('circle', {
            r: '0',
            class: 'gamification-anchor-dot',
        }) as SVGCircleElement;
        const box = createBoxContent();

        frameGroup.appendChild(connectorPath);
        frameGroup.appendChild(anchorDot);
        frameGroup.appendChild(box.group);
        root.appendChild(frameGroup);

        track.effectRoot = root;
        track.frameGroup = frameGroup;
        track.connectorPath = connectorPath;
        track.anchorDot = anchorDot;
        track.boxGroupEl = box.group;
        track.boxBackdropEl = box.backdrop;
        track.boxTitleEl = box.title;
        track.bodyLineEls = box.bodyLines;
    } else if (track.effectRoot !== root) {
        root.appendChild(track.frameGroup);
        track.effectRoot = root;
    }

    const theme = chartTheme();
    track.connectorPath?.setAttribute('stroke', color);
    track.anchorDot?.setAttribute('fill', color);
    track.anchorDot?.setAttribute('fill-opacity', '0.7');
    track.boxBackdropEl?.setAttribute('fill', theme.tooltipBg);
    track.boxBackdropEl?.setAttribute('stroke', color);
    track.boxTitleEl?.setAttribute('fill', color);
    for (const line of track.bodyLineEls) line.setAttribute('fill', theme.labelNormal);
}

function clonePlacementMemoryFromTrack(track: TrackedEffect): PlacementMemory {
    return {
        currentTarget:
            track.targetBoxX != null && track.targetBoxY != null ? { x: track.targetBoxX, y: track.targetBoxY } : null,
        currentBasinId: track.currentBasinId,
        currentBasinCost: track.currentBasinCost,
        currentBasinBounds: track.currentBasinBounds ? { ...track.currentBasinBounds } : null,
        pendingBasinId: track.pendingBasinId,
        pendingBasinCost: track.pendingBasinCost,
        pendingBasinBounds: track.pendingBasinBounds ? { ...track.pendingBasinBounds } : null,
        pendingBasinSince: track.pendingBasinSince,
    };
}

function resolveSmoothingAlpha(dtMs: number): number {
    if (!(dtMs > 0)) return 0;
    return 1 - Math.exp((-Math.log(2) * dtMs) / SMOOTHING_HALF_LIFE_MS);
}

function applyResolvedFrame(track: TrackedEffect, frame: ResolvedFrame, options: FrameRenderOptions, now: number): void {
    ensureEffectDom(track, frame.color);
    if (!track.frameGroup || !track.boxGroupEl || !track.connectorPath || !track.anchorDot) return;

    const immediate = options.immediate === true;
    const idealBox = frame.placement.box;
    let currentX = track.currentBoxX;
    let currentY = track.currentBoxY;

    if (currentX == null || currentY == null || immediate) {
        currentX = idealBox.x;
        currentY = idealBox.y;
    } else {
        const alpha = resolveSmoothingAlpha(now - (track.lastRenderAt ?? now));
        currentX += (idealBox.x - currentX) * alpha;
        currentY += (idealBox.y - currentY) * alpha;
    }

    track.currentBoxX = currentX;
    track.currentBoxY = currentY;
    track.targetBoxX = idealBox.x;
    track.targetBoxY = idealBox.y;
    track.lastResolvedBox = { x: currentX, y: currentY };
    track.lastPeak = frame.peak;
    track.currentBasinId = frame.placementMemory.currentBasinId;
    track.currentBasinCost = frame.placementMemory.currentBasinCost;
    track.currentBasinBounds = frame.placementMemory.currentBasinBounds
        ? { ...frame.placementMemory.currentBasinBounds }
        : null;
    track.pendingBasinId = frame.placementMemory.pendingBasinId;
    track.pendingBasinCost = frame.placementMemory.pendingBasinCost;
    track.pendingBasinBounds = frame.placementMemory.pendingBasinBounds
        ? { ...frame.placementMemory.pendingBasinBounds }
        : null;
    track.pendingBasinSince = frame.placementMemory.pendingBasinSince;
    track.lastRenderAt = now;
    track.peakLock = frame.peak;

    const entranceProgress = resolveEntranceProgress(options.entranceProgress);
    const slideOffset = (1 - entranceProgress) * 8;
    const renderedBoxY = currentY + slideOffset;

    track.connectorPath.setAttribute(
        'd',
        buildElbowPath(currentX, renderedBoxY, frame.peak.anchorX, frame.peak.anchorY),
    );
    track.connectorPath.setAttribute('stroke-opacity', (0.35 * entranceProgress).toFixed(3));

    track.anchorDot.setAttribute('cx', frame.peak.anchorX.toFixed(1));
    track.anchorDot.setAttribute('cy', frame.peak.anchorY.toFixed(1));
    track.anchorDot.setAttribute('r', (3 * entranceProgress).toFixed(2));

    track.boxGroupEl.setAttribute('transform', `translate(${currentX.toFixed(1)}, ${renderedBoxY.toFixed(1)})`);
    track.boxGroupEl.setAttribute('opacity', (0.9 * entranceProgress).toFixed(3));
    track.frameGroup.setAttribute('opacity', '1');

    // --- Dynamic body text: effect name + improvement % + peak context ---
    const curveData = _curvesData?.[track.effectIdx];
    const desired = curveData?.desired;
    if (desired && track.displayedPoints && track.baselinePoints) {
        const improvement = computeEffectImprovement(
            track.displayedPoints,
            track.baselinePoints,
            desired,
            track.polarity,
        );
        if (track.boxTitleEl) {
            track.boxTitleEl.textContent = (curveData.effect || 'GAIN').toUpperCase();
        }
        if (track.bodyLineEls[0]) {
            const sign = track.polarity === 'higher_is_worse' ? '-' : '+';
            track.bodyLineEls[0].textContent = improvement != null ? `${sign}${Math.round(improvement)}%` : '\u2014';
            track.bodyLineEls[0].setAttribute('fill', frame.color);
        }
        if (track.bodyLineEls[1]) {
            track.bodyLineEls[1].textContent = formatPeakContext(frame.peak, track.polarity);
        }

        renderStackingBar(track, entranceProgress);
    }
}

function buildResolvedFrames(now: number): (ResolvedFrame | null)[] {
    const resolved: (ResolvedFrame | null)[] = [];
    let priorPlacement: ResolvedPlacementTarget | null = null;

    for (const track of _tracked) {
        const points = track.displayedPoints;
        const baseline = track.baselinePoints;
        if (!points || !baseline || points.length === 0 || baseline.length === 0) {
            resolved.push(null);
            continue;
        }

        const peak = computePeakFromData(points, baseline, track.polarity);
        if (!peak) {
            resolved.push(null);
            continue;
        }

        let anchorY = phaseChartY(interpolatePointsAtTime(points, peak.peakHour));
        if (!Number.isFinite(anchorY)) {
            const lxPath = findLxPath(track.effectIdx);
            const liveY = lxPath ? sampleLivePathYAtX(lxPath, peak.anchorX) : null;
            if (liveY != null) anchorY = liveY;
        }

        const resolvedPeak = { ...peak, anchorY };
        const gainProfile = analyzeGainProfile(points, baseline, track.polarity);
        const profile: GainProfile = gainProfile
            ? { ...gainProfile, peakGain: peak.peakGain, peakHour: peak.peakHour, anchorX: peak.anchorX, anchorY }
            : {
                  type: 'concentrated',
                  peakGain: peak.peakGain,
                  peakHour: peak.peakHour,
                  anchorX: peak.anchorX,
                  anchorY,
              };
        const placement = resolveBoxPlacement(
            profile,
            track.effectIdx,
            track.effectCount,
            priorPlacement,
            points,
            baseline,
            clonePlacementMemoryFromTrack(track),
            now,
        );
        if (placement.placement.box.x < -1000) {
            resolved.push(null);
            continue;
        }

        priorPlacement = placement.placement;
        resolved.push({
            track,
            peak: resolvedPeak,
            placement: placement.placement,
            placementMemory: placement.memory,
            color: _curvesData?.[track.effectIdx]?.color || '#60a5fa',
        });
    }

    return resolved;
}

function renderTrackedOverlayFrame(options: FrameRenderOptions = {}): void {
    if (!getLiveContainer() || !_curvesData || _tracked.length === 0) return;

    const now = performance.now();
    const frames = buildResolvedFrames(now);
    for (let i = 0; i < _tracked.length; i++) {
        const track = _tracked[i];
        const frame = frames[i];
        if (!frame) {
            clearEffectDom(track);
            track.currentBoxX = null;
            track.currentBoxY = null;
            track.targetBoxX = null;
            track.targetBoxY = null;
            track.lastResolvedBox = null;
            track.lastPeak = null;
            track.currentBasinId = null;
            track.currentBasinCost = null;
            track.currentBasinBounds = null;
            track.pendingBasinId = null;
            track.pendingBasinCost = null;
            track.pendingBasinBounds = null;
            track.pendingBasinSince = null;
            track.lastRenderAt = null;
            track.peakLock = null;
            continue;
        }
        applyResolvedFrame(track, frame, options, now);
    }
}

function startTracking(): void {
    cancelTrackingRaf();

    const tick = () => {
        renderTrackedOverlayFrame({ immediate: false });
        _trackingRafId = requestAnimationFrame(tick);
    };

    renderTrackedOverlayFrame({ immediate: true, entranceProgress: isTurboActive() ? 1 : 0 });
    _trackingRafId = requestAnimationFrame(tick);
}

function sampleMaxCurveValue(
    leftX: number,
    width: number,
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
): number {
    const { padL, plotW } = PHASE_CHART;
    let peak = 0;
    const steps = 5;

    for (let s = 0; s <= steps; s++) {
        const sx = leftX + (width * s) / steps;
        const hour = (PHASE_CHART.startMin + ((sx - padL) / plotW) * PHASE_CHART.totalMin) / 60;
        if (lxPoints) peak = Math.max(peak, interpolatePointsAtTime(lxPoints, hour));
        if (baselinePoints) peak = Math.max(peak, interpolatePointsAtTime(baselinePoints, hour));
    }

    return peak;
}

function sampleCurveTopY(leftX: number, width: number, lxPoints?: CurvePoint[], baselinePoints?: CurvePoint[]): number {
    return phaseChartY(sampleMaxCurveValue(leftX, width, lxPoints, baselinePoints));
}

function sampleLivePathYAtX(path: SVGGeometryElement, targetX: number): number | null {
    let totalLen = 0;
    try {
        totalLen = path.getTotalLength();
    } catch {
        return null;
    }
    if (totalLen <= 0) return null;

    let lo = 0;
    let hi = totalLen;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const pt = path.getPointAtLength(mid);
        if (pt.x < targetX) lo = mid;
        else hi = mid;
    }

    const result = path.getPointAtLength((lo + hi) / 2);
    return Math.abs(result.x - targetX) > 10 ? null : result.y;
}

function findLxPath(effectIdx: number): SVGGeometryElement | null {
    const group = document.getElementById('phase-lx-curves');
    if (!group) return null;
    const sub = group.querySelector(`#phase-lx-curves-e${effectIdx}`);
    if (sub) {
        const subPath = sub.querySelector('.phase-lx-path') as SVGGeometryElement | null;
        if (subPath) return subPath;
    }
    const paths = group.querySelectorAll('.phase-lx-path');
    return (paths[effectIdx] as SVGGeometryElement) ?? null;
}

export function computePeakFromData(
    lxPoints: CurvePoint[],
    baselinePoints: CurvePoint[],
    polarity: string | undefined,
): PeakGainPosition | null {
    if (!lxPoints?.length || !baselinePoints?.length) return null;

    let bestGain = -Infinity;
    const len = Math.min(lxPoints.length, baselinePoints.length);
    const positiveCandidates: { hour: number; gain: number; value: number }[] = [];

    for (let i = 0; i < len; i++) {
        const delta = lxPoints[i].value - baselinePoints[i].value;
        const gain = polarity === 'higher_is_worse' ? -delta : delta;
        if (gain > bestGain) bestGain = gain;
        if (gain > 0) {
            positiveCandidates.push({
                hour: lxPoints[i].hour,
                gain,
                value: lxPoints[i].value,
            });
        }
    }

    if (bestGain < MIN_PEAK_GAIN) return null;
    if (positiveCandidates.length === 0) return null;

    let anchor = positiveCandidates[0];
    for (let i = 1; i < positiveCandidates.length; i++) {
        const candidate = positiveCandidates[i];
        const isMoreRelevant =
            polarity === 'higher_is_worse'
                ? candidate.value < anchor.value ||
                  (candidate.value === anchor.value && candidate.gain > anchor.gain)
                : candidate.value > anchor.value || (candidate.value === anchor.value && candidate.gain > anchor.gain);
        if (isMoreRelevant) anchor = candidate;
    }

    const anchorValue = interpolatePointsAtTime(lxPoints, anchor.hour);
    return {
        peakGain: bestGain,
        peakHour: anchor.hour,
        anchorX: phaseChartX(anchor.hour * 60),
        anchorY: phaseChartY(anchorValue),
    };
}

function distancePointToRect(px: number, py: number, x: number, y: number, w: number, h: number): number {
    const dx = px < x ? x - px : px > x + w ? px - (x + w) : 0;
    const dy = py < y ? y - py : py > y + h ? py - (y + h) : 0;
    return Math.hypot(dx, dy);
}

function boxesOverlap(a: BoxPosition, b: BoxPosition, pad = 0): boolean {
    return !(
        a.x + BOX_W + pad <= b.x ||
        b.x + BOX_W + pad <= a.x ||
        a.y + BOX_H + pad <= b.y ||
        b.y + BOX_H + pad <= a.y
    );
}

function rectsOverlap(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    pad = 0,
): boolean {
    return !(ax + aw + pad <= bx || bx + bw + pad <= ax || ay + ah + pad <= by || by + bh + pad <= ay);
}

function parseNumericAttr(el: Element, name: string): number {
    const value = parseFloat(el.getAttribute(name) || '');
    return Number.isFinite(value) ? value : 0;
}

function readElementBounds(el: Element | null): { x: number; y: number; width: number; height: number } | null {
    if (!el) return null;
    const anyEl = el as any;
    if (typeof anyEl.getBBox === 'function') {
        try {
            const bbox = anyEl.getBBox();
            if (bbox && Number.isFinite(bbox.x) && Number.isFinite(bbox.y)) {
                return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
            }
        } catch {
            // Fall through to attribute-based approximations.
        }
    }

    const tagName = String((anyEl.tagName || '')).toLowerCase();
    if (tagName === 'rect') {
        return {
            x: parseNumericAttr(el, 'x'),
            y: parseNumericAttr(el, 'y'),
            width: parseNumericAttr(el, 'width'),
            height: parseNumericAttr(el, 'height'),
        };
    }
    if (tagName === 'circle') {
        const cx = parseNumericAttr(el, 'cx');
        const cy = parseNumericAttr(el, 'cy');
        const r = parseNumericAttr(el, 'r');
        return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    if (tagName === 'line') {
        const x1 = parseNumericAttr(el, 'x1');
        const y1 = parseNumericAttr(el, 'y1');
        const x2 = parseNumericAttr(el, 'x2');
        const y2 = parseNumericAttr(el, 'y2');
        return {
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
        };
    }
    if (tagName === 'text' || tagName === 'tspan') {
        const fontSize = parseNumericAttr(el, 'font-size') || 12;
        const text = (anyEl.textContent || '').trim();
        const width = Math.max(fontSize * 0.8, text.length * fontSize * 0.58);
        const height = fontSize * 1.2;
        let x = parseNumericAttr(el, 'x');
        let y = parseNumericAttr(el, 'y');
        const anchor = el.getAttribute('text-anchor');
        const baseline = el.getAttribute('dominant-baseline');
        if (anchor === 'middle') x -= width / 2;
        else if (anchor === 'end') x -= width;
        if (baseline === 'middle') y -= height / 2;
        else y -= height * 0.8;
        return { x, y, width, height };
    }

    const children = Array.from((anyEl.children || []) as ArrayLike<Element>);
    let union: { x: number; y: number; width: number; height: number } | null = null;
    for (const child of children) {
        const childBounds = readElementBounds(child);
        if (!childBounds) continue;
        if (!union) {
            union = { ...childBounds };
            continue;
        }
        const x1 = Math.min(union.x, childBounds.x);
        const y1 = Math.min(union.y, childBounds.y);
        const x2 = Math.max(union.x + union.width, childBounds.x + childBounds.width);
        const y2 = Math.max(union.y + union.height, childBounds.y + childBounds.height);
        union = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
    return union;
}

function pushObstacle(
    obstacles: PlacementObstacle[],
    bounds: { x: number; y: number; width: number; height: number } | null,
    pad: number,
    penalty: number,
    blocksPlacement = false,
): void {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    obstacles.push({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        pad,
        penalty,
        blocksPlacement,
    });
}

function collectPlacementObstacles(
    profile: GainProfile,
    effectIdx: number,
    otherPlacement: ResolvedPlacementTarget | null,
): PlacementObstacle[] {
    const obstacles: PlacementObstacle[] = [];
    const plotTop = PHASE_CHART.padT;
    const plotBottom = PHASE_CHART.padT + PHASE_CHART.plotH;
    const plotLeft = PHASE_CHART.padL;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;

    pushObstacle(
        obstacles,
        {
            x: profile.anchorX - 78,
            y: clamp(profile.anchorY - 56, plotTop + 10, plotBottom - 112),
            width: 156,
            height: 112,
        },
        6,
        640,
        false,
    );
    pushObstacle(
        obstacles,
        {
            x: plotLeft,
            y: plotTop,
            width: plotRight - plotLeft,
            height: TOP_CHROME_HEIGHT,
        },
        0,
        520,
        true,
    );
    pushObstacle(
        obstacles,
        {
            x: plotLeft,
            y: TIMELINE_ZONE.separatorY - BOTTOM_CHROME_HEIGHT,
            width: plotRight - plotLeft,
            height: PHASE_CHART.viewH - (TIMELINE_ZONE.separatorY - BOTTOM_CHROME_HEIGHT),
        },
        0,
        520,
        true,
    );
    if (otherPlacement) {
        pushObstacle(
            obstacles,
            {
                x: otherPlacement.box.x,
                y: otherPlacement.box.y,
                width: BOX_W,
                height: BOX_H,
            },
            12,
            900,
            true,
        );
    }

    if (typeof document === 'undefined') return obstacles;
    const svgRoot = document.getElementById('phase-chart-svg');
    if (!svgRoot) return obstacles;

    svgRoot.querySelectorAll('.peak-descriptor').forEach((el: Element) => {
        const targetIdx = el.getAttribute('data-effect-idx');
        if (targetIdx != null && targetIdx !== '' && Number(targetIdx) !== effectIdx) return;
        pushObstacle(obstacles, readElementBounds(el.querySelector('rect') || el), 10, 280);
    });

    svgRoot.querySelectorAll('.bullseye-emoji').forEach((el: Element) => {
        pushObstacle(obstacles, readElementBounds(el), 12, 260);
    });

    svgRoot.querySelectorAll('.yaxis-change-indicator').forEach((el: Element) => {
        pushObstacle(obstacles, readElementBounds(el), 8, 180);
    });
    svgRoot.querySelectorAll('.yaxis-keep-indicator').forEach((el: Element) => {
        pushObstacle(obstacles, readElementBounds(el), 8, 180);
    });

    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (timelineGroup) {
        timelineGroup.querySelectorAll('.timeline-pill-group').forEach((el: Element) => {
            const targetIdx = el.getAttribute('data-curve-idx');
            if (targetIdx != null && targetIdx !== '' && Number(targetIdx) !== effectIdx) return;
            pushObstacle(obstacles, readElementBounds(el), 8, 160);
        });
    }

    return obstacles;
}

function chooseConnectorOrigin(boxX: number, boxY: number, anchorX: number, anchorY: number): ConnectorOrigin {
    const boxLeft = boxX;
    const boxRight = boxX + BOX_W;
    const boxTop = boxY;
    const boxBottom = boxY + BOX_H;

    if (anchorX >= boxRight + 4) {
        return {
            x: boxRight,
            y: clamp(anchorY, boxTop + 10, boxBottom - 10),
            side: 'right',
        };
    }
    if (anchorX <= boxLeft - 4) {
        return {
            x: boxLeft,
            y: clamp(anchorY, boxTop + 10, boxBottom - 10),
            side: 'left',
        };
    }
    if (anchorY >= boxBottom) {
        return {
            x: clamp(anchorX, boxLeft + 10, boxRight - 10),
            y: boxBottom,
            side: 'bottom',
        };
    }

    return {
        x: clamp(anchorX, boxLeft + 10, boxRight - 10),
        y: boxTop,
        side: 'top',
    };
}

function connectorLength(boxX: number, boxY: number, anchorX: number, anchorY: number): number {
    const origin = chooseConnectorOrigin(boxX, boxY, anchorX, anchorY);
    return Math.abs(anchorX - origin.x) + Math.abs(anchorY - origin.y);
}

function buildElbowPath(boxX: number, boxY: number, anchorX: number, anchorY: number): string {
    const origin = chooseConnectorOrigin(boxX, boxY, anchorX, anchorY);
    const dx = anchorX - origin.x;
    const dy = anchorY - origin.y;

    if (origin.side === 'left' || origin.side === 'right') {
        const elbowX = origin.x + dx * 0.55;
        return [
            `M ${origin.x.toFixed(1)} ${origin.y.toFixed(1)}`,
            `L ${elbowX.toFixed(1)} ${origin.y.toFixed(1)}`,
            `L ${elbowX.toFixed(1)} ${anchorY.toFixed(1)}`,
            `L ${anchorX.toFixed(1)} ${anchorY.toFixed(1)}`,
        ].join(' ');
    }

    const elbowY = origin.y + dy * 0.55;
    return [
        `M ${origin.x.toFixed(1)} ${origin.y.toFixed(1)}`,
        `L ${origin.x.toFixed(1)} ${elbowY.toFixed(1)}`,
        `L ${anchorX.toFixed(1)} ${elbowY.toFixed(1)}`,
        `L ${anchorX.toFixed(1)} ${anchorY.toFixed(1)}`,
    ].join(' ');
}

function analyzeGainProfile(
    points: CurvePoint[],
    baseline: CurvePoint[],
    polarity: string | undefined,
): GainProfile | null {
    if (!points || !baseline || points.length === 0) return null;

    const len = Math.min(points.length, baseline.length);
    const gains: { hour: number; gain: number }[] = [];
    let totalPositiveGain = 0;

    for (let i = 0; i < len; i++) {
        let gain = points[i].value - baseline[i].value;
        if (polarity === 'higher_is_worse') gain = -gain;
        gains.push({ hour: points[i].hour, gain });
        if (gain > 0) totalPositiveGain += gain;
    }

    if (totalPositiveGain <= 0) return null;

    let peakIdx = 0;
    let peakGain = gains[0]?.gain ?? 0;
    for (let i = 1; i < gains.length; i++) {
        if (gains[i].gain > peakGain) {
            peakGain = gains[i].gain;
            peakIdx = i;
        }
    }

    if (peakGain < MIN_PEAK_GAIN) return null;

    const threshold = PEAK_WINDOW_THRESHOLD * peakGain;
    let windowStart = peakIdx;
    let windowEnd = peakIdx;
    while (windowStart > 0 && gains[windowStart - 1].gain >= threshold) windowStart--;
    while (windowEnd < gains.length - 1 && gains[windowEnd + 1].gain >= threshold) windowEnd++;

    const windowGain = gains
        .slice(windowStart, windowEnd + 1)
        .reduce((sum, gainEntry) => sum + Math.max(0, gainEntry.gain), 0);
    const windowSpanHours = gains[windowEnd].hour - gains[windowStart].hour;
    const areaFraction = windowGain / totalPositiveGain;
    const peakHour = gains[peakIdx].hour;
    const peakValue = interpolatePointsAtTime(points, peakHour);

    if (areaFraction >= CONCENTRATED_AREA_FRACTION && windowSpanHours <= CONCENTRATED_MAX_SPAN_HOURS) {
        return {
            type: 'concentrated',
            peakGain,
            peakHour,
            anchorX: phaseChartX(peakHour * 60),
            anchorY: phaseChartY(peakValue),
        };
    }

    const positiveGains = gains.filter(gainEntry => gainEntry.gain > 0);
    let weightedSum = 0;
    let weightTotal = 0;
    for (const gainEntry of positiveGains) {
        weightedSum += gainEntry.gain * gainEntry.hour;
        weightTotal += gainEntry.gain;
    }

    const centerHour = weightTotal > 0 ? weightedSum / weightTotal : peakHour;
    const lowThreshold = totalPositiveGain * SPREAD_CUMULATIVE_TRIM;
    const highThreshold = totalPositiveGain * (1 - SPREAD_CUMULATIVE_TRIM);
    let cumulative = 0;
    let spanStartHour = positiveGains[0]?.hour ?? centerHour;
    let spanEndHour = positiveGains[positiveGains.length - 1]?.hour ?? centerHour;

    for (const gainEntry of positiveGains) {
        cumulative += gainEntry.gain;
        if (cumulative >= lowThreshold && spanStartHour === positiveGains[0].hour) {
            spanStartHour = gainEntry.hour;
        }
        if (cumulative >= highThreshold) {
            spanEndHour = gainEntry.hour;
            break;
        }
    }

    return {
        type: 'spread',
        peakGain,
        peakHour: centerHour,
        anchorX: phaseChartX(centerHour * 60),
        anchorY: phaseChartY(interpolatePointsAtTime(points, centerHour)),
        spreadStartX: phaseChartX(spanStartHour * 60),
        spreadEndX: phaseChartX(spanEndHour * 60),
    };
}

export function computeBoxPosition(
    profile: GainProfile,
    effectIdx: number,
    effectCount: number,
    otherBoxPos: BoxPosition | null,
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
): BoxPosition {
    return resolveBoxPlacement(
        profile,
        effectIdx,
        effectCount,
        otherBoxPos
            ? {
                  box: otherBoxPos,
                  basinId: 'other',
                  cost: 0,
                  basinBounds: {
                      minX: otherBoxPos.x,
                      maxX: otherBoxPos.x,
                      minY: otherBoxPos.y,
                      maxY: otherBoxPos.y,
                  },
                  upperBand: true,
                  bestCell: { x: otherBoxPos.x, y: otherBoxPos.y, row: 0, col: 0 },
              }
            : null,
        lxPoints,
        baselinePoints,
        createEmptyPlacementMemory(),
        0,
    ).placement.box;
}

function getPlacementBounds(effectIdx: number, effectCount: number): PlacementBounds | null {
    const { padL, plotW, padT, plotH } = PHASE_CHART;
    const chartRight = padL + plotW;
    const chartBottom = padT + plotH;

    let minX = padL + BOX_SAFE_X_PAD;
    let maxX = chartRight - BOX_W - BOX_SAFE_X_PAD;
    const minY = padT + BOX_SAFE_Y_PAD;
    const maxY = chartBottom - BOX_H - BOX_SAFE_Y_PAD;

    if (effectCount >= 2 && DividerState.active) {
        const divX = DividerState.x;
        const halfFade = DividerState.fadeWidth / 2;
        if (effectIdx === 0) {
            maxX = Math.min(maxX, divX - halfFade - BOX_W - BOX_SAFE_X_PAD);
        } else {
            minX = Math.max(minX, divX + halfFade + BOX_SAFE_X_PAD);
        }
    }

    if (maxX < minX || maxY < minY) return null;
    return {
        minX,
        maxX,
        minY,
        maxY,
        centerX: (minX + maxX) / 2 + BOX_W / 2,
    };
}

function createEmptyPlacementMemory(): PlacementMemory {
    return {
        currentTarget: null,
        currentBasinId: null,
        currentBasinCost: null,
        currentBasinBounds: null,
        pendingBasinId: null,
        pendingBasinCost: null,
        pendingBasinBounds: null,
        pendingBasinSince: null,
    };
}

function createInvalidPlacement(): ResolvedPlacementTarget {
    return {
        box: { x: -9999, y: -9999 },
        basinId: 'invalid',
        cost: Infinity,
        basinBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        upperBand: true,
        bestCell: { x: -9999, y: -9999, row: -1, col: -1 },
    };
}

function isBoxWithinBounds(box: BoxPosition, bounds: PlacementBounds): boolean {
    return box.x >= bounds.minX && box.x <= bounds.maxX && box.y >= bounds.minY && box.y <= bounds.maxY;
}

function buildFieldAxisPositions(min: number, max: number, step: number): number[] {
    const values: number[] = [];
    for (let value = min; value <= max + 0.001; value += step) {
        values.push(Math.min(value, max));
    }
    if (values.length === 0 || Math.abs(values[values.length - 1] - max) > 0.5) values.push(max);
    return values;
}

function computeRectOverlapArea(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    pad = 0,
): number {
    const overlapW = Math.min(ax + aw, bx + bw + pad) - Math.max(ax, bx - pad);
    const overlapH = Math.min(ay + ah, by + bh + pad) - Math.max(ay, by - pad);
    return Math.max(0, overlapW) * Math.max(0, overlapH);
}

function rectDistance(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    pad = 0,
): number {
    const dx = ax + aw < bx - pad ? bx - pad - (ax + aw) : bx + bw + pad < ax ? ax - (bx + bw + pad) : 0;
    const dy = ay + ah < by - pad ? by - pad - (ay + ah) : by + bh + pad < ay ? ay - (by + bh + pad) : 0;
    return Math.hypot(dx, dy);
}

function buildFieldIndex(cols: number, col: number, row: number): number {
    return row * cols + col;
}

function sampleCurveFootprintPressure(
    boxX: number,
    boxY: number,
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
): { curveClearance: number; curvePressure: number } {
    const { padL, plotW } = PHASE_CHART;
    const boxBottom = boxY + BOX_H;
    let minClearance = Infinity;
    let pressure = 0;

    for (let step = 0; step <= CURVE_PRESSURE_SAMPLES; step++) {
        const sampleX = boxX + (BOX_W * step) / CURVE_PRESSURE_SAMPLES;
        const hour = (PHASE_CHART.startMin + ((sampleX - padL) / plotW) * PHASE_CHART.totalMin) / 60;
        const curveYs: number[] = [];
        if (lxPoints) curveYs.push(phaseChartY(interpolatePointsAtTime(lxPoints, hour)));
        if (baselinePoints) curveYs.push(phaseChartY(interpolatePointsAtTime(baselinePoints, hour)));

        for (const curveY of curveYs) {
            const clearance = curveY - boxBottom;
            if (clearance < minClearance) minClearance = clearance;

            const overlapDepth = boxBottom + BOX_CURVE_CLEARANCE - curveY;
            if (overlapDepth > 0) pressure += overlapDepth * 4.5;
            else if (overlapDepth > -20) pressure += (20 + overlapDepth) * 0.8;
        }
    }

    return {
        curveClearance: Number.isFinite(minClearance) ? minClearance : 9999,
        curvePressure: pressure / (CURVE_PRESSURE_SAMPLES + 1),
    };
}

function buildConnectorPoints(boxX: number, boxY: number, anchorX: number, anchorY: number): { x: number; y: number }[] {
    const origin = chooseConnectorOrigin(boxX, boxY, anchorX, anchorY);
    if (origin.side === 'left' || origin.side === 'right') {
        const elbowX = origin.x + (anchorX - origin.x) * 0.55;
        return [
            { x: origin.x, y: origin.y },
            { x: elbowX, y: origin.y },
            { x: elbowX, y: anchorY },
            { x: anchorX, y: anchorY },
        ];
    }

    const elbowY = origin.y + (anchorY - origin.y) * 0.55;
    return [
        { x: origin.x, y: origin.y },
        { x: origin.x, y: elbowY },
        { x: anchorX, y: elbowY },
        { x: anchorX, y: anchorY },
    ];
}

function sampleConnectorPoints(boxX: number, boxY: number, anchorX: number, anchorY: number): { x: number; y: number }[] {
    const vertices = buildConnectorPoints(boxX, boxY, anchorX, anchorY);
    const samples: { x: number; y: number }[] = [];

    for (let i = 0; i < vertices.length - 1; i++) {
        const start = vertices[i];
        const end = vertices[i + 1];
        const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
        const count = Math.max(1, Math.ceil(length / CONNECTOR_DENSITY_SAMPLE));
        for (let step = 0; step <= count; step++) {
            if (i > 0 && step === 0) continue;
            const t = count === 0 ? 0 : step / count;
            samples.push({
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
            });
        }
    }

    return samples;
}

function computeConnectorDensityCost(
    boxX: number,
    boxY: number,
    profile: GainProfile,
    obstacles: PlacementObstacle[],
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
): number {
    const samples = sampleConnectorPoints(boxX, boxY, profile.anchorX, profile.anchorY);
    let penalty = 0;

    for (const sample of samples) {
        for (const obstacle of obstacles) {
            const distance = distancePointToRect(
                sample.x,
                sample.y,
                obstacle.x - obstacle.pad,
                obstacle.y - obstacle.pad,
                obstacle.width + obstacle.pad * 2,
                obstacle.height + obstacle.pad * 2,
            );
            if (distance < CONNECTOR_DENSITY_RADIUS) {
                penalty += ((CONNECTOR_DENSITY_RADIUS - distance) / CONNECTOR_DENSITY_RADIUS) * obstacle.penalty * 0.08;
            }
        }

        if (sample.x < PHASE_CHART.padL || sample.x > PHASE_CHART.padL + PHASE_CHART.plotW) continue;
        const hour = (PHASE_CHART.startMin + ((sample.x - PHASE_CHART.padL) / PHASE_CHART.plotW) * PHASE_CHART.totalMin) / 60;
        const curveYs: number[] = [];
        if (lxPoints) curveYs.push(phaseChartY(interpolatePointsAtTime(lxPoints, hour)));
        if (baselinePoints) curveYs.push(phaseChartY(interpolatePointsAtTime(baselinePoints, hour)));
        for (const curveY of curveYs) {
            const delta = Math.abs(sample.y - curveY);
            if (delta < CONNECTOR_CURVE_RADIUS) penalty += (CONNECTOR_CURVE_RADIUS - delta) * 2.2;
        }
    }

    return penalty / Math.max(1, samples.length);
}

function evaluatePlacementBase(
    boxX: number,
    boxY: number,
    profile: GainProfile,
    bounds: PlacementBounds,
    obstacles: PlacementObstacle[],
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
    upperBand = true,
): PlacementEvaluation {
    if (!isBoxWithinBounds({ x: boxX, y: boxY }, bounds)) {
        return {
            valid: false,
            rawObstaclePressure: PROTECTED_OBSTACLE_INVALID_COST,
            curveClearance: -Infinity,
            curvePressure: 0,
            connectorDensityCost: 0,
            connectorLengthCost: Infinity,
            poiDistanceCost: Infinity,
            bandCost: upperBand ? 0 : UPPER_BAND_FALLBACK_PENALTY,
        };
    }

    let valid = true;
    let rawObstaclePressure = 0;
    for (const obstacle of obstacles) {
        const overlapArea = computeRectOverlapArea(
            boxX,
            boxY,
            BOX_W,
            BOX_H,
            obstacle.x,
            obstacle.y,
            obstacle.width,
            obstacle.height,
            obstacle.pad,
        );
        if (overlapArea <= 0) continue;
        rawObstaclePressure += obstacle.penalty + overlapArea * 0.08;
        if (obstacle.blocksPlacement) valid = false;
    }

    const curve = sampleCurveFootprintPressure(boxX, boxY, lxPoints, baselinePoints);
    return {
        valid,
        rawObstaclePressure,
        curveClearance: curve.curveClearance,
        curvePressure: curve.curvePressure,
        connectorDensityCost: computeConnectorDensityCost(boxX, boxY, profile, obstacles, lxPoints, baselinePoints),
        connectorLengthCost: connectorLength(boxX, boxY, profile.anchorX, profile.anchorY) * 0.16,
        poiDistanceCost: distancePointToRect(profile.anchorX, profile.anchorY, boxX, boxY, BOX_W, BOX_H) * 0.08,
        bandCost: upperBand ? 0 : UPPER_BAND_FALLBACK_PENALTY,
    };
}

function blurObstaclePressure(cells: OccupancyCell[], cols: number, rows: number): number[] {
    const blurred = new Array<number>(cells.length).fill(0);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            let sum = 0;
            let weightSum = 0;
            for (let dy = -FIELD_BLUR_RADIUS; dy <= FIELD_BLUR_RADIUS; dy++) {
                const sampleRow = row + dy;
                if (sampleRow < 0 || sampleRow >= rows) continue;
                for (let dx = -FIELD_BLUR_RADIUS; dx <= FIELD_BLUR_RADIUS; dx++) {
                    const sampleCol = col + dx;
                    if (sampleCol < 0 || sampleCol >= cols) continue;
                    const weight = dx === 0 && dy === 0 ? 1.5 : 1 / (Math.abs(dx) + Math.abs(dy) + 1);
                    sum += cells[buildFieldIndex(cols, sampleCol, sampleRow)].rawObstaclePressure * weight;
                    weightSum += weight;
                }
            }
            blurred[buildFieldIndex(cols, col, row)] = weightSum > 0 ? sum / weightSum : 0;
        }
    }

    return blurred;
}

function buildPlacementField(
    profile: GainProfile,
    effectIdx: number,
    effectCount: number,
    otherPlacement: ResolvedPlacementTarget | null,
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
): { field: PlacementField | null; obstacles: PlacementObstacle[] } {
    const bounds = getPlacementBounds(effectIdx, effectCount);
    const obstacles = collectPlacementObstacles(profile, effectIdx, otherPlacement);
    if (!bounds) return { field: null, obstacles };

    const xPositions = buildFieldAxisPositions(bounds.minX, bounds.maxX, FIELD_STEP);
    const yPositions = buildFieldAxisPositions(bounds.minY, bounds.maxY, FIELD_STEP);
    const upperBandMaxY = bounds.minY + (bounds.maxY - bounds.minY) * UPPER_BAND_RATIO;
    const cells: OccupancyCell[] = [];

    for (let row = 0; row < yPositions.length; row++) {
        for (let col = 0; col < xPositions.length; col++) {
            const x = xPositions[col];
            const y = yPositions[row];
            const upperBand = y <= upperBandMaxY + 0.001;
            const evaluation = evaluatePlacementBase(x, y, profile, bounds, obstacles, lxPoints, baselinePoints, upperBand);
            cells.push({
                x,
                y,
                row,
                col,
                upperBand,
                valid: evaluation.valid,
                rawObstaclePressure: evaluation.rawObstaclePressure,
                blurredObstaclePressure: 0,
                curveClearance: evaluation.curveClearance,
                curvePressure: evaluation.curvePressure,
                connectorDensityCost: evaluation.connectorDensityCost,
                connectorLengthCost: evaluation.connectorLengthCost,
                poiDistanceCost: evaluation.poiDistanceCost,
                bandCost: evaluation.bandCost,
                totalCost: Infinity,
            });
        }
    }

    const blurred = blurObstaclePressure(cells, xPositions.length, yPositions.length);
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        cell.blurredObstaclePressure = blurred[i];
        cell.totalCost = cell.valid
            ? blurred[i] +
              cell.curvePressure +
              cell.connectorDensityCost +
              cell.connectorLengthCost +
              cell.poiDistanceCost +
              cell.bandCost
            : Infinity;
    }

    return {
        field: {
            bounds,
            step: FIELD_STEP,
            cols: xPositions.length,
            rows: yPositions.length,
            upperBandMaxY,
            cells,
        },
        obstacles,
    };
}

function extractBestPlacementBasin(field: PlacementField, upperBand: boolean): PlacementBasin | null {
    const eligible = field.cells.filter(cell => cell.valid && cell.upperBand === upperBand && Number.isFinite(cell.totalCost));
    if (eligible.length === 0) return null;

    let bestCell = eligible[0];
    for (const cell of eligible) {
        if (cell.totalCost < bestCell.totalCost) bestCell = cell;
    }

    const threshold = Math.max(bestCell.totalCost * (1 + BASIN_COST_TOLERANCE), bestCell.totalCost + 8);
    const visited = new Set<number>();
    const queue = [buildFieldIndex(field.cols, bestCell.col, bestCell.row)];
    visited.add(queue[0]);

    let weightSum = 0;
    let weightedX = 0;
    let weightedY = 0;
    let totalCost = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;

    while (queue.length > 0) {
        const idx = queue.shift()!;
        const cell = field.cells[idx];
        if (!cell.valid || cell.upperBand !== upperBand || cell.totalCost > threshold) continue;

        const weight = 1 / Math.max(1, cell.totalCost);
        weightSum += weight;
        weightedX += cell.x * weight;
        weightedY += cell.y * weight;
        totalCost += cell.totalCost;
        minX = Math.min(minX, cell.x);
        maxX = Math.max(maxX, cell.x);
        minY = Math.min(minY, cell.y);
        maxY = Math.max(maxY, cell.y);
        count++;

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nextCol = cell.col + dx;
                const nextRow = cell.row + dy;
                if (nextCol < 0 || nextCol >= field.cols || nextRow < 0 || nextRow >= field.rows) continue;
                const nextIdx = buildFieldIndex(field.cols, nextCol, nextRow);
                if (visited.has(nextIdx)) continue;
                visited.add(nextIdx);
                queue.push(nextIdx);
            }
        }
    }

    if (count === 0 || weightSum <= 0) return null;
    const centroid = {
        x: clamp(weightedX / weightSum, field.bounds.minX, field.bounds.maxX),
        y: clamp(weightedY / weightSum, field.bounds.minY, field.bounds.maxY),
    };

    return {
        basinId: `${upperBand ? 'upper' : 'lower'}:${Math.round(centroid.x / FIELD_STEP)}:${Math.round(centroid.y / FIELD_STEP)}`,
        centroid,
        bestCost: bestCell.totalCost,
        meanCost: totalCost / count,
        bounds: { minX, maxX, minY, maxY },
        upperBand,
        cellCount: count,
        bestCell,
    };
}

function choosePreferredBasin(upperBasin: PlacementBasin | null, lowerBasin: PlacementBasin | null): PlacementBasin | null {
    if (upperBasin) {
        if (!lowerBasin) return upperBasin;
        return lowerBasin.meanCost <= upperBasin.meanCost * (1 - LOWER_BAND_ADVANTAGE_RATIO) ? lowerBasin : upperBasin;
    }
    return lowerBasin;
}

function placementFromBasin(basin: PlacementBasin): ResolvedPlacementTarget {
    return {
        box: { ...basin.centroid },
        basinId: basin.basinId,
        cost: basin.meanCost,
        basinBounds: { ...basin.bounds },
        upperBand: basin.upperBand,
        bestCell: {
            x: basin.bestCell.x,
            y: basin.bestCell.y,
            row: basin.bestCell.row,
            col: basin.bestCell.col,
        },
    };
}

function boundsArea(bounds: BasinBounds): number {
    return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function boundsOverlapArea(a: BasinBounds, b: BasinBounds): number {
    return computeRectOverlapArea(
        a.minX,
        a.minY,
        Math.max(0, a.maxX - a.minX),
        Math.max(0, a.maxY - a.minY),
        b.minX,
        b.minY,
        Math.max(0, b.maxX - b.minX),
        Math.max(0, b.maxY - b.minY),
    );
}

function areBasinsEquivalent(
    currentBounds: BasinBounds | null,
    nextBounds: BasinBounds,
    currentTarget: BoxPosition | null,
    nextTarget: BoxPosition,
): boolean {
    if (currentBounds) {
        const overlap = boundsOverlapArea(currentBounds, nextBounds);
        const minArea = Math.max(1, Math.min(boundsArea(currentBounds), boundsArea(nextBounds)));
        if (overlap / minArea >= BASIN_OVERLAP_THRESHOLD) return true;
    }
    if (currentTarget) {
        const distance = Math.hypot(currentTarget.x - nextTarget.x, currentTarget.y - nextTarget.y);
        if (distance <= BASIN_CENTROID_DISTANCE) return true;
    }
    return false;
}

function sampleFieldObstaclePressure(field: PlacementField, target: BoxPosition): number {
    let nearestPressure = 0;
    let nearestDistance = Infinity;
    for (const cell of field.cells) {
        const distance = Math.hypot(cell.x - target.x, cell.y - target.y);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPressure = cell.blurredObstaclePressure;
        }
    }
    return nearestPressure;
}

function evaluatePlacementFromField(
    field: PlacementField,
    target: BoxPosition,
    profile: GainProfile,
    obstacles: PlacementObstacle[],
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
): { valid: boolean; cost: number } {
    const base = evaluatePlacementBase(
        target.x,
        target.y,
        profile,
        field.bounds,
        obstacles,
        lxPoints,
        baselinePoints,
        target.y <= field.upperBandMaxY + 0.001,
    );
    if (!base.valid) return { valid: false, cost: Infinity };

    return {
        valid: true,
        cost:
            sampleFieldObstaclePressure(field, target) +
            base.curvePressure +
            base.connectorDensityCost +
            base.connectorLengthCost +
            base.poiDistanceCost +
            base.bandCost,
    };
}

function acceptPlacement(memory: PlacementMemory, placement: ResolvedPlacementTarget): PlacementResolution {
    return {
        placement,
        memory: {
            currentTarget: { ...placement.box },
            currentBasinId: placement.basinId,
            currentBasinCost: placement.cost,
            currentBasinBounds: { ...placement.basinBounds },
            pendingBasinId: null,
            pendingBasinCost: null,
            pendingBasinBounds: null,
            pendingBasinSince: null,
        },
    };
}

function keepCurrentPlacement(memory: PlacementMemory, placement: ResolvedPlacementTarget, currentCost: number): PlacementResolution {
    return {
        placement,
        memory: {
            ...memory,
            currentTarget: { ...placement.box },
            currentBasinId: placement.basinId,
            currentBasinCost: currentCost,
            currentBasinBounds: { ...placement.basinBounds },
        },
    };
}

function placementFromMemory(memory: PlacementMemory): ResolvedPlacementTarget | null {
    if (!memory.currentTarget || !memory.currentBasinBounds) return null;
    return {
        box: { ...memory.currentTarget },
        basinId: memory.currentBasinId || 'held',
        cost: memory.currentBasinCost ?? Infinity,
        basinBounds: { ...memory.currentBasinBounds },
        upperBand: memory.currentTarget.y <= memory.currentBasinBounds.maxY,
        bestCell: {
            x: memory.currentTarget.x,
            y: memory.currentTarget.y,
            row: Math.round(memory.currentTarget.y / FIELD_STEP),
            col: Math.round(memory.currentTarget.x / FIELD_STEP),
        },
    };
}

function resolveBoxPlacement(
    profile: GainProfile,
    effectIdx: number,
    effectCount: number,
    otherPlacement: ResolvedPlacementTarget | null,
    lxPoints?: CurvePoint[],
    baselinePoints?: CurvePoint[],
    memory: PlacementMemory = createEmptyPlacementMemory(),
    now = performance.now(),
): PlacementResolution {
    const { field, obstacles } = buildPlacementField(profile, effectIdx, effectCount, otherPlacement, lxPoints, baselinePoints);
    const invalid = createInvalidPlacement();
    if (!field) {
        return { placement: invalid, memory: createEmptyPlacementMemory() };
    }

    const upperBasin = extractBestPlacementBasin(field, true);
    const lowerBasin = extractBestPlacementBasin(field, false);
    const preferredBasin = choosePreferredBasin(upperBasin, lowerBasin);
    const currentPlacement = placementFromMemory(memory);

    if (!preferredBasin) {
        if (currentPlacement) {
            const currentEval = evaluatePlacementFromField(field, currentPlacement.box, profile, obstacles, lxPoints, baselinePoints);
            if (currentEval.valid) return keepCurrentPlacement(memory, currentPlacement, currentEval.cost);
        }
        return { placement: invalid, memory: createEmptyPlacementMemory() };
    }

    const candidatePlacement = placementFromBasin(preferredBasin);
    if (!currentPlacement) return acceptPlacement(memory, candidatePlacement);

    const currentEval = evaluatePlacementFromField(field, currentPlacement.box, profile, obstacles, lxPoints, baselinePoints);
    if (!currentEval.valid) return acceptPlacement(memory, candidatePlacement);

    if (
        areBasinsEquivalent(memory.currentBasinBounds, candidatePlacement.basinBounds, memory.currentTarget, candidatePlacement.box)
    ) {
        return acceptPlacement(memory, candidatePlacement);
    }

    const improvement =
        currentEval.cost > 0
            ? (currentEval.cost - candidatePlacement.cost) / currentEval.cost
            : candidatePlacement.cost < currentEval.cost
              ? 1
              : 0;

    if (improvement >= BASIN_SWITCH_IMPROVEMENT_RATIO) {
        const samePending = areBasinsEquivalent(
            memory.pendingBasinBounds,
            candidatePlacement.basinBounds,
            memory.currentTarget,
            candidatePlacement.box,
        );
        if (samePending && memory.pendingBasinSince != null && now - memory.pendingBasinSince >= BASIN_SWITCH_HOLD_MS) {
            return acceptPlacement(memory, candidatePlacement);
        }
        return {
            placement: currentPlacement,
            memory: {
                ...memory,
                currentBasinCost: currentEval.cost,
                pendingBasinId: candidatePlacement.basinId,
                pendingBasinCost: candidatePlacement.cost,
                pendingBasinBounds: { ...candidatePlacement.basinBounds },
                pendingBasinSince: samePending ? memory.pendingBasinSince : now,
            },
        };
    }

    return {
        placement: currentPlacement,
        memory: {
            ...memory,
            currentBasinCost: currentEval.cost,
            pendingBasinId: null,
            pendingBasinCost: null,
            pendingBasinBounds: null,
            pendingBasinSince: null,
        },
    };
}

export function ensureGamificationOverlayPresence(
    lxCurves: any[],
    curvesData: any[],
    source: OverlaySource,
): void {
    if (!Array.isArray(curvesData) || curvesData.length === 0) return;
    const container = ensureContainer(source);
    if (!container) return;

    if (_overlayMountedAt == null) _overlayMountedAt = performance.now();
    ensureTrackedEffects(lxCurves, curvesData, source);
}

export function syncGamificationOverlayFrame(
    lxCurves: any[],
    curvesData: any[],
    source: OverlaySource,
    options: FrameRenderOptions = {},
): void {
    ensureGamificationOverlayPresence(lxCurves, curvesData, source);
    if (!getLiveContainer()) return;

    if (Array.isArray(lxCurves)) {
        for (const track of _tracked) {
            const lx = lxCurves[track.effectIdx];
            if (!lx) continue;
            track.displayedPoints = lx.points ?? track.displayedPoints;
            track.baselinePoints = lx.baseline ?? track.baselinePoints;
        }
    }

    renderTrackedOverlayFrame({ immediate: options.immediate ?? true, entranceProgress: options.entranceProgress });
}

export function renderGamificationOverlay(lxCurves: any[], curvesData: any[], source: OverlaySource): void {
    removeGamificationOverlay();
    ensureGamificationOverlayPresence(lxCurves, curvesData, source);
    if (!getLiveContainer()) return;
    startTracking();
}

export function updateGamificationCurveData(lxCurves: any[]): void {
    if (!Array.isArray(lxCurves) || _tracked.length === 0) return;

    for (const track of _tracked) {
        const lx = lxCurves[track.effectIdx];
        if (!lx) continue;
        track.displayedPoints = lx.points ?? track.displayedPoints;
        track.baselinePoints = lx.baseline ?? track.baselinePoints;
    }

    if (_trackingRafId == null) {
        renderTrackedOverlayFrame({ immediate: true, entranceProgress: 1 });
    }
}

export function setStackingBarSweepProgress(t: number, playheadHour?: number, stepIdx?: number): void {
    _sweepProgress = t;
    if (playheadHour != null) _sweepPlayheadHour = playheadHour;
    else if (t <= 0) _sweepPlayheadHour = 0;
    else if (t >= 1) _sweepPlayheadHour = 30;
    if (stepIdx != null) _sweepStepIdx = stepIdx;
}

export function updateGamificationOverlayForDivider(): void {
    if (!getLiveContainer() || _tracked.length === 0) return;
    renderTrackedOverlayFrame({ immediate: true });
}

export function removeGamificationOverlay(): void {
    cancelTrackingRaf();
    getLiveContainer()?.remove();
    resetOverlayState();
}

export const __testing = {
    analyzeGainProfile,
    resolveBoxPlacement,
    buildPlacementField,
    extractBestPlacementBasin,
    createEmptyPlacementMemory,
    boxSize: { width: BOX_W, height: BOX_H },
    getTrackedCount: () => _tracked.length,
    getTrackedPlacementSnapshot: () =>
        _tracked.map(track => ({
            effectIdx: track.effectIdx,
            basinId: track.currentBasinId,
            score: track.currentBasinCost,
            box: track.lastResolvedBox,
            target: track.targetBoxX != null && track.targetBoxY != null ? { x: track.targetBoxX, y: track.targetBoxY } : null,
            basinBounds: track.currentBasinBounds,
            pendingBasinId: track.pendingBasinId,
            pendingBasinSince: track.pendingBasinSince,
            peak: track.lastPeak,
            peakLock: track.peakLock,
        })),
};
