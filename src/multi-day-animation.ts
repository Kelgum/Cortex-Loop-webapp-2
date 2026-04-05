/**
 * Multi-Day Animation — Smooth day-to-day transitions for the 7-day cycle.
 * Features: desired curve morphing, delayed Lx catchup, simultaneous substance
 * pill animation, POI re-rendering per day, enhanced day labels.
 * Exports: playMultiDaySequence, seekToDay, pauseMultiDay, resumeMultiDay, renderDayState,
 *          renderAtContinuousDay, setupWeekStripDrag, cleanupWeekStripDrag, clearContinuousDayCache
 * Depends on: state, curve-utils, lx-system, poi-render, revision-animation
 */
import { MultiDayState, PhaseState, BiometricState } from './state';
import {
    interpolatePointArrays,
    phasePointsToPath,
    phasePointsToFillPath,
    smoothPhaseValues,
    phaseBandPath,
} from './curve-utils';
import { PHASE_SMOOTH_PASSES, PHASE_CHART, BIOMETRIC_ZONE, TIMELINE_ZONE, TELEPORT } from './constants';
import {
    renderSubstanceTimeline,
    revealTimelinePillsInstant,
    preserveBiometricStrips,
    renderLxBandsStatic,
    allocateTimelineLanes,
    computeIncrementalLxOverlay,
} from './lx-system';
// easeInOutCubic removed — linear easing for continuous day-to-day flow
import { svgEl, phaseChartX, phaseChartY, clamp } from './utils';
import {
    type PillGeometry,
    type DoseMorphInfo,
    type PillMorphPlan,
    type PillMorphCurveCtx,
    parseDoseFromZero,
    parseDoseMorph,
    matchInterventions,
    computePillGeometry,
    computeLaneCount,
    buildMorphPillNode,
    tickPillMorph,
} from './pill-morph';
import { renderPoiDotsAndConnectors, animatePoiWeekly } from './poi-render';
import {
    buildWeekStrip,
    updateWeekStripDay,
    interpolateWeekStripHighlight,
    hideWeekStrip,
    showWeekStripPlayIcon,
} from './phase-chart';
import { updateGamificationCurveData } from './gamification-overlay';
import type { CurveData, CurvePoint, DaySnapshot, MultiDayPhase } from './types';

const interpolatePoints = interpolatePointArrays;

function hasCurveSamples(points: CurvePoint[] | undefined): boolean {
    return Array.isArray(points) && points.length > 0;
}

function hasCoherentLxCurve(curve: any): boolean {
    return hasCurveSamples(curve?.points) && hasCurveSamples(curve?.baseline) && hasCurveSamples(curve?.desired);
}

function cloneCurveSamples(points: CurvePoint[] | undefined): CurvePoint[] {
    return hasCurveSamples(points) ? points.map(point => ({ hour: point.hour, value: point.value })) : [];
}

function cloneLxCurve(curve: any): any {
    return {
        points: cloneCurveSamples(curve?.points),
        baseline: cloneCurveSamples(curve?.baseline),
        desired: cloneCurveSamples(curve?.desired),
    };
}

function selectCoherentLxCurveSource(fromCurve: any, toCurve: any, t: number): any | null {
    const preferred = t < 0.5 ? fromCurve : toCurve;
    const alternate = t < 0.5 ? toCurve : fromCurve;
    if (hasCoherentLxCurve(preferred)) return preferred;
    if (hasCoherentLxCurve(alternate)) return alternate;
    return preferred || alternate || null;
}

function buildMorphedGamificationCurves(fromDay: DaySnapshot, toDay: DaySnapshot, t: number, curveCount: number): any[] {
    const morphedCurves: any[] = new Array(curveCount);

    for (let ci = 0; ci < curveCount; ci++) {
        const fromCurve = fromDay.lxCurves[ci];
        const toCurve = toDay.lxCurves[ci];
        if (hasCoherentLxCurve(fromCurve) && hasCoherentLxCurve(toCurve)) {
            morphedCurves[ci] = {
                points: interpolatePoints(fromCurve.points, toCurve.points, t),
                baseline: interpolatePoints(fromCurve.baseline, toCurve.baseline, t),
                desired: interpolatePoints(fromCurve.desired, toCurve.desired, t),
            };
            continue;
        }

        const fallbackCurve = selectCoherentLxCurveSource(fromCurve, toCurve, t);
        if (fallbackCurve) morphedCurves[ci] = cloneLxCurve(fallbackCurve);
    }

    return morphedCurves;
}

/** Read MultiDayState.phase without TS control-flow narrowing (phase is mutated externally). */
function _mdPhase(): MultiDayPhase {
    return MultiDayState.phase;
}

function getVisibleWeekStartIndex(days: DaySnapshot[]): number {
    return 0;
}

// ── POI helper for multi-day ──
// Copies _renderY/_renderH from Phase 3 channels and passes bio translate offset.

function renderPoiForDay(day: DaySnapshot) {
    if (!day.poiEvents || day.poiEvents.length === 0) {
        const sg = document.getElementById('phase-spotter-highlights');
        const pc = document.getElementById('phase-poi-connectors');
        if (sg) sg.innerHTML = '';
        if (pc) pc.innerHTML = '';
        return;
    }
    // Copy render coordinates from initial Phase 3 channels
    const initial = BiometricState.channels || [];
    for (let i = 0; i < day.biometricChannels.length && i < initial.length; i++) {
        (day.biometricChannels[i] as any)._renderY = (initial[i] as any)._renderY;
        (day.biometricChannels[i] as any)._renderH = (initial[i] as any)._renderH;
    }
    // Read bio group translate so connectors align with translated dots
    const bioG = document.getElementById('phase-biometric-strips');
    const m = (bioG?.getAttribute('transform') || '').match(/translate\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)\s*\)/);
    const bioTY = m ? parseFloat(m[1]) || 0 : 0;
    renderPoiDotsAndConnectors(day.poiEvents, day.biometricChannels, day.interventions, bioTY);
}

// ── Substance pill morph helpers ──

// Types PillGeometry, DoseMorphInfo, PillMorphPlan imported from pill-morph.ts

// parseDoseFromZero, parseDoseMorph, matchInterventions, computePillGeometry,
// buildMorphPillNode — imported from pill-morph.ts

/** Prepare the morph plan: match pills, compute from/to geometries, find/create DOM elements */
function preparePillMorph(fromDay: DaySnapshot, toDay: DaySnapshot, _curvesData: CurveData[]): PillMorphPlan | null {
    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (!timelineGroup) return null;

    const fromAlloc = allocateTimelineLanes(fromDay.interventions || []);
    const toAlloc = allocateTimelineLanes(toDay.interventions || []);
    const fromGeoMap = computePillGeometry(fromAlloc);
    const toGeoMap = computePillGeometry(toAlloc);

    const { matched, removed, added } = matchInterventions(fromDay.interventions || [], toDay.interventions || []);

    // Find existing DOM pill elements
    const existingPills = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group'));
    function findPillEl(iv: any): SVGGElement | null {
        const key = iv?.key || '';
        const time = String(iv?.timeMinutes ?? '');
        return (
            (existingPills.find(
                (el: Element) =>
                    el.getAttribute('data-substance-key') === key && el.getAttribute('data-time-minutes') === time,
            ) as SVGGElement | null) ?? null
        );
    }

    const plan: PillMorphPlan = { matched: [], removed: [], added: [] };

    const teleportThresholdPx = (TELEPORT.thresholdMin / PHASE_CHART.totalMin) * PHASE_CHART.plotW;

    for (const { from, to } of matched) {
        const fromGeo = fromGeoMap.get(from);
        const toGeo = toGeoMap.get(to);
        const el = findPillEl(from);
        if (fromGeo && toGeo && el) {
            const doseMorph = parseDoseMorph(from, to);
            // Create a destination ghost for portal-distance moves (horizontal or vertical)
            let ghost: SVGGElement | null = null;
            const laneDist = Math.abs(toGeo.laneIdx - fromGeo.laneIdx);
            if (Math.abs(toGeo.x - fromGeo.x) > teleportThresholdPx || laneDist >= TELEPORT.thresholdLanes) {
                ghost = buildMorphPillNode(toGeo, toDay.lxCurves);
                ghost.setAttribute('opacity', '0');
                ghost.removeAttribute('data-substance-key'); // avoid duplicate lookups
                ghost.removeAttribute('data-time-minutes');
                timelineGroup.appendChild(ghost);
            }
            plan.matched.push({ from: fromGeo, to: toGeo, el, doseMorph, ghost });
        }
    }

    for (const iv of removed) {
        const geo = fromGeoMap.get(iv);
        const el = findPillEl(iv);
        if (geo && el) {
            plan.removed.push({ geo, el });
        }
    }

    for (const iv of added) {
        const geo = toGeoMap.get(iv);
        if (geo) {
            const el = buildMorphPillNode(geo, toDay.lxCurves);
            timelineGroup.appendChild(el);
            const doseMorph = parseDoseFromZero(iv);
            plan.added.push({ geo, el, doseMorph });
        }
    }

    return plan;
}

// tickPillMorph — imported from pill-morph.ts

/** Wrap DaySnapshot Lx curves into PillMorphCurveCtx for the shared tickPillMorph */
function buildDayCurveCtx(fromDay: DaySnapshot, toDay: DaySnapshot): PillMorphCurveCtx {
    const maxCurves = Math.max(fromDay.lxCurves?.length || 0, toDay.lxCurves?.length || 0);
    const fromLxPoints: Array<Array<{ hour: number; value: number }>> = [];
    const toLxPoints: Array<Array<{ hour: number; value: number }>> = [];
    for (let ci = 0; ci < maxCurves; ci++) {
        fromLxPoints.push(fromDay.lxCurves?.[ci]?.points || []);
        toLxPoints.push(toDay.lxCurves?.[ci]?.points || []);
    }
    return { fromLxPoints, toLxPoints };
}

// ── Weekday name helpers ──

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDayLabel(dayNumber: number): string {
    const startWeekday = MultiDayState.startWeekday || 'Monday';
    const startIdx = WEEKDAYS.findIndex(d => d.toLowerCase() === startWeekday.toLowerCase());
    if (startIdx === -1) return `Day ${dayNumber}`;
    const dayIdx = (startIdx + dayNumber - 1) % 7;
    return WEEKDAYS[dayIdx];
}

// ── Band morph types ──

interface BandGeo {
    key: string; // substance key
    curveIdx: number;
    stepIdx: number; // stacking layer in the incremental overlay
    color: string;
    upper: CurvePoint[];
    lower: CurvePoint[];
}

interface BandMorphPlan {
    /** One contiguous layer stack per curveIdx.
     *  Bands are derived as slices between adjacent interpolated layers,
     *  guaranteeing no dark gaps (band N's lower = band N-1's upper by construction). */
    stacks: Array<{
        curveIdx: number;
        fromLayers: CurvePoint[][]; // padded to same length as toLayers
        toLayers: CurvePoint[][];
        fromBandCount: number; // real band count before padding (removed bands = max - fromBandCount)
        toBandCount: number; // real band count before padding (added bands = max - toBandCount)
        bands: Array<{
            el: SVGPathElement;
            fromColor: string;
            toColor: string;
            fromRgb: [number, number, number];
            toRgb: [number, number, number];
        }>;
    }>;
}

/** Compute per-substance band geometries (upper/lower point pairs) for a day. */
function computeBandGeos(interventions: any, curvesData: CurveData[]): BandGeo[] {
    const snapshots = computeIncrementalLxOverlay(interventions, curvesData);
    if (!snapshots?.length) return [];
    const result: BandGeo[] = [];
    let prevPts: CurvePoint[][] | null = null;
    for (let k = 0; k < snapshots.length; k++) {
        const { lxCurves, step } = snapshots[k];
        const targetPts = lxCurves.map((lx: any) => lx.points as CurvePoint[]);
        const sourcePts = prevPts || lxCurves.map((lx: any) => lx.baseline as CurvePoint[]);
        for (let ci = 0; ci < curvesData.length; ci++) {
            if (!targetPts[ci]?.length || !sourcePts[ci]?.length) continue;
            result.push({
                key: step[0]?.key || '',
                curveIdx: ci,
                stepIdx: k,
                color: step[0]?.substance?.color || curvesData[ci].color,
                upper: targetPts[ci],
                lower: sourcePts[ci],
            });
        }
        prevPts = targetPts.map(pts => pts.map(p => ({ ...p })));
    }
    return result;
}

/** Linearly interpolate between two hex colors (e.g. "#ff8800") at factor t (0→1). */
function _lerpHexColor(a: string, b: string, t: number): string {
    const ha = a.replace('#', '');
    const hb = b.replace('#', '');
    const r = Math.round(parseInt(ha.substring(0, 2), 16) * (1 - t) + parseInt(hb.substring(0, 2), 16) * t);
    const g = Math.round(parseInt(ha.substring(2, 4), 16) * (1 - t) + parseInt(hb.substring(2, 4), 16) * t);
    const bl = Math.round(parseInt(ha.substring(4, 6), 16) * (1 - t) + parseInt(hb.substring(4, 6), 16) * t);
    return `rgb(${r},${g},${bl})`;
}

function _parseHexRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

/** Extract cumulative layer boundaries from a sorted set of BandGeos for one curveIdx.
 *  Returns [baseline, after_sub_1, after_sub_2, ..., final_Lx] — one more entry than the number of bands. */
function extractLayerBoundaries(geos: BandGeo[], curveIdx: number): { layers: CurvePoint[][]; colors: string[] } {
    const filtered = geos.filter(g => g.curveIdx === curveIdx).sort((a, b) => a.stepIdx - b.stepIdx);
    if (filtered.length === 0) return { layers: [], colors: [] };
    const layers: CurvePoint[][] = [filtered[0].lower];
    const colors: string[] = [];
    for (const g of filtered) {
        layers.push(g.upper);
        colors.push(g.color);
    }
    return { layers, colors };
}

/** Helper: create a bare SVG band path element.
 *  Uses inline style for fillOpacity so it beats the CSS property
 *  (CSS `fill-opacity: var(--band-fill-opacity)` overrides SVG attributes). */
function _makeBandEl(color: string, opacity: string, pathD: string, bandsGroup: HTMLElement): SVGPathElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('class', 'lx-auc-band');
    el.setAttribute('fill', color);
    el.setAttribute('d', pathD);
    el.style.fillOpacity = opacity;
    el.style.transition = 'none'; // prevent CSS transition fighting rAF updates
    bandsGroup.appendChild(el);
    return el;
}

/** Build band morph plan using contiguous layer-boundary interpolation.
 *  Instead of animating bands independently (which creates dark gaps),
 *  we interpolate cumulative layer boundaries and derive bands as slices
 *  between adjacent layers — contiguity is guaranteed by construction. */
function buildBandMorphPlan(fromGeos: BandGeo[], toGeos: BandGeo[], bandsGroup: HTMLElement): BandMorphPlan {
    const plan: BandMorphPlan = { stacks: [] };

    // Read current band opacity from CSS variable (animated by phase transitions)
    const bandOp = String(
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--band-fill-opacity')) || 0.18,
    );

    // Collect all curveIdx values present in either day
    const curveIndices = new Set<number>();
    for (const g of fromGeos) curveIndices.add(g.curveIdx);
    for (const g of toGeos) curveIndices.add(g.curveIdx);

    // Reuse existing DOM elements to prevent pops from innerHTML wipe
    const existingEls = Array.from(bandsGroup.querySelectorAll('.lx-auc-band')) as SVGPathElement[];
    let reuseIdx = 0;

    for (const ci of curveIndices) {
        const fromStack = extractLayerBoundaries(fromGeos, ci);
        const toStack = extractLayerBoundaries(toGeos, ci);
        if (fromStack.layers.length === 0 && toStack.layers.length === 0) continue;

        let fromLayers = fromStack.layers;
        let toLayers = toStack.layers;
        let fromColors = fromStack.colors;
        let toColors = toStack.colors;

        // Handle case where one day has no bands for this curveIdx:
        // create a degenerate 2-layer stack (baseline = top layer) so the band collapses from/to zero height
        if (fromLayers.length === 0 && toLayers.length > 0) {
            // No bands on fromDay — use toDay's baseline as both layers (zero-height start)
            fromLayers = [toLayers[0]];
            fromColors = [];
        }
        if (toLayers.length === 0 && fromLayers.length > 0) {
            // No bands on toDay — use fromDay's baseline as both layers (zero-height end)
            toLayers = [fromLayers[0]];
            toColors = [];
        }

        // Capture real band counts before padding (used for accelerated remove/add transitions)
        const fromBandCount = Math.max(0, fromLayers.length - 1);
        const toBandCount = Math.max(0, toLayers.length - 1);

        // Pad shorter stack by repeating top layer (bands collapse/expand to zero height)
        const maxLen = Math.max(fromLayers.length, toLayers.length);
        while (fromLayers.length < maxLen) {
            fromLayers.push(fromLayers[fromLayers.length - 1]);
            fromColors.push(fromColors[fromColors.length - 1] || '');
        }
        while (toLayers.length < maxLen) {
            toLayers.push(toLayers[toLayers.length - 1]);
            toColors.push(toColors[toColors.length - 1] || '');
        }

        // Number of bands = number of layers - 1
        const bandCount = maxLen - 1;
        const bands: BandMorphPlan['stacks'][0]['bands'] = [];

        for (let b = 0; b < bandCount; b++) {
            const fromColor = fromColors[b] || toColors[b] || '#888';
            const toColor = toColors[b] || fromColors[b] || '#888';
            const pathD = phaseBandPath(fromLayers[b + 1], fromLayers[b]);

            // Reuse existing DOM element if available
            let el: SVGPathElement;
            if (reuseIdx < existingEls.length) {
                el = existingEls[reuseIdx++];
                el.setAttribute('fill', fromColor);
                el.setAttribute('d', pathD);
                el.style.fillOpacity = bandOp;
            } else {
                el = _makeBandEl(fromColor, bandOp, pathD, bandsGroup);
            }
            bands.push({ el, fromColor, toColor, fromRgb: _parseHexRgb(fromColor), toRgb: _parseHexRgb(toColor) });
        }

        plan.stacks.push({ curveIdx: ci, fromLayers, toLayers, fromBandCount, toBandCount, bands });
    }

    // Remove orphaned DOM elements not reused in the new plan
    for (let i = reuseIdx; i < existingEls.length; i++) {
        existingEls[i].remove();
    }

    return plan;
}

// ── Shared interpolation context (pre-computed DOM refs + smoothed data) ──

interface InterpolationCtx {
    baselineStrokes: Element[];
    desiredStrokes: Element[];
    desiredFills: Element[];
    lxStrokes: Element[];
    lxFills: Element[];
    bioStrokePaths: Element[];
    bioFillPaths: Element[];
    bandsGroup: HTMLElement | null;
    fromBaselines: CurvePoint[][];
    toBaselines: CurvePoint[][];
    bioShift: {
        lanesDiffer: boolean;
        bioGroupEl: HTMLElement | null;
        spotterGroupEl: HTMLElement | null;
        bioStartTY: number;
        bioDeltaY: number;
        svgEl: SVGSVGElement | null;
        startViewBoxH: number;
        viewBoxDeltaH: number;
    };
    bandMorphPlan: BandMorphPlan | null;
    bandFillOpacity: number;
    fromDesiredSmoothed: CurvePoint[][];
    toDesiredSmoothed: CurvePoint[][];
}

/** Build an InterpolationCtx for a from→to day pair. Caches DOM queries + smoothed baselines. */
function buildInterpolationCtx(fromDay: DaySnapshot, toDay: DaySnapshot, curvesData?: CurveData[]): InterpolationCtx {
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const lxGroup = document.getElementById('phase-lx-curves');
    const bioGroup = document.getElementById('phase-biometric-strips');

    const fromBaselines = fromDay.bioCorrectedBaseline.map(bl => smoothPhaseValues(bl, PHASE_SMOOTH_PASSES));
    const toBaselines = toDay.bioCorrectedBaseline.map(bl => smoothPhaseValues(bl, PHASE_SMOOTH_PASSES));

    // Bio strip lane shift
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const fromAlloc = allocateTimelineLanes(fromDay.interventions || []);
    const toAlloc = allocateTimelineLanes(toDay.interventions || []);
    const fromLaneCount = fromAlloc.reduce((mx: number, a: any) => Math.max(mx, (a.laneIdx || 0) + 1), 0);
    const toLaneCount = toAlloc.reduce((mx: number, a: any) => Math.max(mx, (a.laneIdx || 0) + 1), 0);
    const lanesDiffer = fromLaneCount !== toLaneCount;

    // Always track bio shift + viewBox so we can adjust per-frame even when lanes match
    const bioGroupEl = document.getElementById('phase-biometric-strips');
    const spotterGroupEl = document.getElementById('phase-spotter-highlights');

    let bioStartTY = 0;
    if (bioGroupEl) {
        const m = (bioGroupEl.getAttribute('transform') || '').match(
            /translate\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)\s*\)/,
        );
        bioStartTY = m ? parseFloat(m[1]) || 0 : 0;
    }
    const bioDeltaY = (toLaneCount - fromLaneCount) * laneStep;

    // Track viewBox height so it shrinks/grows with the bio shift (eliminates dead space)
    const svgNode = document.getElementById('phase-chart-svg');
    const svgEl_ = svgNode instanceof SVGSVGElement ? svgNode : null;
    const currentVB = svgEl_?.getAttribute('viewBox')?.split(/\s+/).map(Number) || [0, 0, 1120, 500];
    const startViewBoxH = currentVB[3];
    const viewBoxDeltaH = bioDeltaY; // viewBox shrinks/grows same as bio shift

    // Pre-compute band fill opacity (avoids getComputedStyle per animation frame)
    const bandFillOpacity =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--band-fill-opacity')) || 0.18;

    // Pre-smooth desired curves (avoids smoothPhaseValues per animation frame)
    const fromDesiredSmoothed = (fromDay.desiredCurves || []).map((d: CurvePoint[]) =>
        smoothPhaseValues(d, PHASE_SMOOTH_PASSES),
    );
    const toDesiredSmoothed = (toDay.desiredCurves || []).map((d: CurvePoint[]) =>
        smoothPhaseValues(d, PHASE_SMOOTH_PASSES),
    );

    // Pre-compute band morph plan for smooth AUC interpolation
    const bandsGroup = document.getElementById('phase-lx-bands');
    let bandMorphPlan: BandMorphPlan | null = null;
    if (bandsGroup && curvesData) {
        const fromCurves = curvesData.map((c: CurveData, i: number) => ({
            ...c,
            baseline: fromDay.postInterventionBaseline?.[i] || fromDay.bioCorrectedBaseline[i] || c.baseline,
            desired: fromDay.desiredCurves[i] || c.desired,
        }));
        const toCurves = curvesData.map((c: CurveData, i: number) => ({
            ...c,
            baseline: toDay.postInterventionBaseline?.[i] || toDay.bioCorrectedBaseline[i] || c.baseline,
            desired: toDay.desiredCurves[i] || c.desired,
        }));
        const fromGeos = computeBandGeos(fromDay.interventions, fromCurves);
        const toGeos = computeBandGeos(toDay.interventions, toCurves);
        bandMorphPlan = buildBandMorphPlan(fromGeos, toGeos, bandsGroup);
    }

    return {
        baselineStrokes: baseGroup ? Array.from(baseGroup.querySelectorAll('.phase-baseline-path')) : [],
        desiredStrokes: desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-path')) : [],
        desiredFills: desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-fill')) : [],
        lxStrokes: lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-path')) : [],
        lxFills: lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-fill')) : [],
        bioStrokePaths: bioGroup ? Array.from(bioGroup.querySelectorAll('.bio-strip-path')) : [],
        bioFillPaths: bioGroup ? Array.from(bioGroup.querySelectorAll('.bio-strip-fill')) : [],
        bandsGroup,
        fromBaselines,
        toBaselines,
        bioShift: {
            lanesDiffer,
            bioGroupEl,
            spotterGroupEl,
            bioStartTY,
            bioDeltaY,
            svgEl: svgEl_,
            startViewBoxH,
            viewBoxDeltaH,
        },
        bandMorphPlan,
        bandFillOpacity,
        fromDesiredSmoothed,
        toDesiredSmoothed,
    };
}

/**
 * Stateless per-frame interpolation: morphs all visual elements between fromDay→toDay at factor t.
 * Shared by both the rAF animation loop and the drag-to-scrub continuous renderer.
 */
function _interpolateFrame(
    fromDay: DaySnapshot,
    toDay: DaySnapshot,
    t: number,
    curvesData: CurveData[],
    pillPlan: PillMorphPlan | null,
    ctx: InterpolationCtx,
): void {
    const {
        baselineStrokes,
        desiredStrokes,
        desiredFills,
        lxStrokes,
        lxFills,
        bioStrokePaths,
        bioFillPaths,
        bandsGroup,
        fromBaselines,
        toBaselines,
        bioShift,
    } = ctx;
    const morphedLxCurves = buildMorphedGamificationCurves(fromDay, toDay, t, curvesData.length);

    // ── Morph baseline curves ──
    for (let ci = 0; ci < curvesData.length; ci++) {
        const fromBl = fromBaselines[ci] || [];
        const toBl = toBaselines[ci] || [];
        if (fromBl.length > 0 && toBl.length > 0) {
            const morphed = interpolatePoints(fromBl, toBl, t);
            if (baselineStrokes[ci]) {
                baselineStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
            }
        }
    }

    // ── Morph desired curves (using pre-smoothed arrays from ctx) ──
    if (ctx.fromDesiredSmoothed.length > 0 && ctx.toDesiredSmoothed.length > 0) {
        for (let ci = 0; ci < curvesData.length; ci++) {
            const fromDes = ctx.fromDesiredSmoothed[ci] || [];
            const toDes = ctx.toDesiredSmoothed[ci] || [];
            if (fromDes.length > 0 && toDes.length > 0) {
                const morphed = interpolatePoints(fromDes, toDes, t);
                if (desiredStrokes[ci]) {
                    desiredStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
                }
                if (desiredFills[ci]) {
                    desiredFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
                }
            }
        }
    }

    // ── Morph Lx curves ──
    for (let ci = 0; ci < curvesData.length; ci++) {
        const morphedCurve = morphedLxCurves[ci];
        const morphedPoints = morphedCurve?.points || [];
        if (morphedPoints.length > 0) {
            if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(morphedPoints, true));
            if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphedPoints, true));
        }
    }
    if (morphedLxCurves.some(Boolean)) {
        updateGamificationCurveData(morphedLxCurves);
    }

    // ── Per-pill substance morph ──
    if (pillPlan) {
        tickPillMorph(pillPlan, t, buildDayCurveCtx(fromDay, toDay));
    }

    // ── Smoothly slide week strip highlight ──
    const totalDays = MultiDayState.days.length || 7;
    interpolateWeekStripHighlight(fromDay.day, toDay.day, t, totalDays);

    // ── Smoothly slide bio strips + adjust viewBox when lane count changes ──
    if (bioShift.lanesDiffer && bioShift.bioGroupEl) {
        const ty = bioShift.bioStartTY + bioShift.bioDeltaY * t;
        bioShift.bioGroupEl.setAttribute('transform', `translate(0,${ty.toFixed(2)})`);
        if (bioShift.spotterGroupEl) {
            bioShift.spotterGroupEl.setAttribute('transform', `translate(0,${ty.toFixed(2)})`);
        }
    }
    // Shrink/grow viewBox to eliminate dead space below bio strips
    if (bioShift.svgEl && Math.abs(bioShift.viewBoxDeltaH) > 0.5) {
        const newH = bioShift.startViewBoxH + bioShift.viewBoxDeltaH * t;
        bioShift.svgEl.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${newH.toFixed(1)}`);
    }

    // ── Interpolate AUC band paths (contiguous layer-boundary model) ──
    // Interpolates cumulative layer boundaries and derives bands as slices between
    // adjacent layers — contiguity is guaranteed by construction (no dark gaps).
    // Uses inline style (el.style.fillOpacity) so JS values beat the CSS property.
    if (ctx.bandMorphPlan) {
        const bandOp = ctx.bandFillOpacity;
        for (const stack of ctx.bandMorphPlan.stacks) {
            // Layers beyond the shared boundary belong to removed/added bands — accelerate 50%
            const sharedCount = Math.min(stack.fromBandCount, stack.toBandCount);
            const accelT = Math.min(1, t * 1.5);

            // Interpolate each cumulative layer boundary between from and to day
            const interpolatedLayers = stack.fromLayers.map((fl, i) =>
                interpolatePoints(fl, stack.toLayers[i], i > sharedCount ? accelT : t),
            );
            // Render each band as the space between consecutive interpolated layers
            for (let b = 0; b < stack.bands.length; b++) {
                const band = stack.bands[b];
                band.el.setAttribute('d', phaseBandPath(interpolatedLayers[b + 1], interpolatedLayers[b]));
                if (band.fromColor !== band.toColor) {
                    const [fr, fg, fb] = band.fromRgb,
                        [tr, tg, tb] = band.toRgb;
                    const r = Math.round(fr + (tr - fr) * t);
                    const g = Math.round(fg + (tg - fg) * t);
                    const bl = Math.round(fb + (tb - fb) * t);
                    band.el.setAttribute('fill', `rgb(${r},${g},${bl})`);
                }
                band.el.style.fillOpacity = String(bandOp);
            }
        }
    }

    // ── Morph biometric waveforms ──
    const initialChannels = BiometricState.channels || [];
    const minChannels = Math.min(
        fromDay.biometricChannels.length,
        toDay.biometricChannels.length,
        bioStrokePaths.length,
    );
    for (let ch = 0; ch < minChannels; ch++) {
        const fromData = fromDay.biometricChannels[ch]?.data || [];
        const toData = toDay.biometricChannels[ch]?.data || [];
        if (fromData.length > 0 && toData.length > 0) {
            const morphedData = interpolatePoints(fromData, toData, t);
            const strokePath = bioStrokePaths[ch];
            const fillPath = bioFillPaths[ch];
            if (strokePath) {
                const range = toDay.biometricChannels[ch].range || [0, 100];
                const renderCh = initialChannels[ch];
                const stripY = renderCh?._renderY ?? 0;
                const stripH = renderCh?._renderH ?? (toDay.biometricChannels[ch].stripHeight || BIOMETRIC_ZONE.laneH);
                const [lo, hi] = range;
                const span = hi - lo || 1;
                let strokeD = '';
                for (let i = 0; i < morphedData.length; i++) {
                    const x = phaseChartX(morphedData[i].hour * 60);
                    const normVal = clamp((morphedData[i].value - lo) / span, 0, 1);
                    const y = stripY + stripH - normVal * stripH;
                    strokeD += (i === 0 ? 'M ' : ' L ') + x.toFixed(1) + ' ' + y.toFixed(1);
                }
                if (strokeD) {
                    strokePath.setAttribute('d', strokeD);
                    if (fillPath) {
                        const baseY = stripY + stripH;
                        const lastX = phaseChartX(morphedData[morphedData.length - 1].hour * 60);
                        const firstX = phaseChartX(morphedData[0].hour * 60);
                        const fillD =
                            strokeD +
                            ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)}` +
                            ` L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
                        fillPath.setAttribute('d', fillD);
                    }
                }
            }
        }
    }
}

// ── Detect whether Knight changed desired curves significantly across the week ──

function hasSignificantDesiredCurveChange(days: DaySnapshot[]): boolean {
    if (days.length < 2) return false;

    const first = days[0].desiredCurves;
    const last = days[days.length - 1].desiredCurves;
    if (!first || !last) return false;

    const numCurves = Math.min(first.length, last.length);
    if (numCurves === 0) return false;

    let totalAbsDiff = 0;
    let totalPoints = 0;

    for (let ci = 0; ci < numCurves; ci++) {
        const fromPts = first[ci] || [];
        const toPts = last[ci] || [];
        const len = Math.min(fromPts.length, toPts.length);
        for (let pi = 0; pi < len; pi++) {
            totalAbsDiff += Math.abs(fromPts[pi].value - toPts[pi].value);
            totalPoints++;
        }
    }

    if (totalPoints === 0) return false;

    // Threshold: 3 units avg diff on 0-100 scale.
    // Knight constant = 0, jetlag shift = ~5-8.
    return totalAbsDiff / totalPoints > 3;
}

// ── Animate a single day-to-day transition with delayed Lx catchup ──

async function animateDayTransition(
    fromDay: DaySnapshot,
    toDay: DaySnapshot,
    curvesData: CurveData[],
    durationMs: number,
    onComplete?: () => void,
): Promise<void> {
    const mySeqId = _animSeqId; // capture token — bail if a newer sequence starts
    const ctx = buildInterpolationCtx(fromDay, toDay, curvesData);
    const pillPlan = preparePillMorph(fromDay, toDay, curvesData);

    await new Promise<void>(resolve => {
        let progress = 0;
        let lastTime = performance.now();
        (function tick(now: number) {
            // Bail immediately if a newer animation sequence has started
            if (_animSeqId !== mySeqId) {
                resolve();
                return;
            }

            const dt = now - lastTime;
            lastTime = now;

            // Freeze when paused — keep looping but don't advance
            const curPhase = MultiDayState.phase;
            if (curPhase === 'paused') {
                requestAnimationFrame(tick);
                return;
            }
            if (curPhase === 'idle') {
                resolve();
                return;
            }

            // Advance with dynamic speed so changes apply instantly
            progress += (dt * MultiDayState.speed) / durationMs;
            const rawT = Math.min(1, progress);

            _interpolateFrame(fromDay, toDay, rawT, curvesData, pillPlan, ctx);

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                // Run DOM rebuild in the same frame as the final animation
                if (onComplete) onComplete();
                resolve();
            }
        })(performance.now());
    });
}

// ── Fade-based day transition (used for Sun→Mon wrap-around) ──
// Instead of interpolating curves, fades out the current state, snaps to the new day, and fades back in.

async function animateDayFadeTransition(
    fromDay: DaySnapshot,
    toDay: DaySnapshot,
    curvesData: CurveData[],
    durationMs: number,
    onComplete?: () => void,
): Promise<void> {
    const mySeqId = _animSeqId;

    // Groups to crossfade
    const fadeGroupIds = [
        'phase-baseline-curves',
        'phase-desired-curves',
        'phase-lx-bands',
        'phase-lx-curves',
        'phase-substance-timeline',
        'phase-biometric-strips',
        'phase-spotter-highlights',
        'phase-poi-connectors',
    ];
    const fadeGroups = fadeGroupIds.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];

    await new Promise<void>(resolve => {
        let progress = 0;
        let lastTime = performance.now();
        let snapped = false;

        (function tick(now: number) {
            if (_animSeqId !== mySeqId) {
                resolve();
                return;
            }

            const dt = now - lastTime;
            lastTime = now;

            const curPhase = MultiDayState.phase;
            if (curPhase === 'paused') {
                requestAnimationFrame(tick);
                return;
            }
            if (curPhase === 'idle') {
                resolve();
                return;
            }

            progress += (dt * MultiDayState.speed) / durationMs;
            const rawT = Math.min(1, progress);

            // First half: fade out (opacity 1→0)
            // Second half: fade in (opacity 0→1)
            if (rawT <= 0.5) {
                const fadeOut = 1 - rawT * 2; // 1→0
                for (const g of fadeGroups) g.style.opacity = fadeOut.toFixed(3);
            } else {
                // Snap to new day at midpoint
                if (!snapped) {
                    renderDayState(toDay, curvesData);
                    renderSubstanceTimeline(toDay.interventions, toDay.lxCurves, curvesData);
                    revealTimelinePillsInstant();
                    _resetBioGroupTransform(toDay);
                    renderPoiForDay(toDay);
                    animatePoiWeekly();
                    snapped = true;
                }
                const fadeIn = (rawT - 0.5) * 2; // 0→1
                for (const g of fadeGroups) g.style.opacity = fadeIn.toFixed(3);
            }

            // Smoothly slide week strip highlight during fade too
            const totalDays = MultiDayState.days.length || 7;
            interpolateWeekStripHighlight(fromDay.day, toDay.day, rawT, totalDays);

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                // Ensure opacity fully restored
                for (const g of fadeGroups) g.style.opacity = '1';
                if (onComplete) onComplete();
                resolve();
            }
        })(performance.now());
    });
}

// ── Update day counter display with weekday name and narrative ──

function updateDayCounter(day: number, narrativeBeat?: string) {
    const counter = document.getElementById('day-number');
    if (counter) counter.textContent = String(day);

    // Update SVG overlay with weekday label
    const svgCounter = document.getElementById('phase-day-counter');
    if (svgCounter) {
        const weekday = getDayLabel(day);
        svgCounter.textContent = `Day ${day} — ${weekday}`;
    }

    // Update narrative beat display
    const narrativeEl = document.getElementById('day-narrative-beat');
    if (narrativeEl && narrativeBeat) {
        narrativeEl.textContent = narrativeBeat;
        narrativeEl.style.opacity = '1';
    }

    // Update scrubber
    const scrubber = document.getElementById('day-scrubber') as HTMLInputElement;
    if (scrubber) scrubber.value = String(day);
}

// ── Render a specific day state instantly (for seeking) ──

export function renderDayState(day: DaySnapshot, curvesData: CurveData[], opts?: { skipBands?: boolean }) {
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const lxGroup = document.getElementById('phase-lx-curves');

    // Render baseline curves
    const baselineStrokes = baseGroup ? Array.from(baseGroup.querySelectorAll('.phase-baseline-path')) : [];
    for (let ci = 0; ci < curvesData.length; ci++) {
        const bl = smoothPhaseValues(day.bioCorrectedBaseline[ci] || curvesData[ci].baseline, PHASE_SMOOTH_PASSES);
        if (baselineStrokes[ci] && bl.length > 0) {
            baselineStrokes[ci].setAttribute('d', phasePointsToPath(bl, true));
        }
    }

    // Render desired curves (new!)
    if (day.desiredCurves) {
        const desiredStrokes = desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-path')) : [];
        const desiredFills = desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-fill')) : [];
        for (let ci = 0; ci < curvesData.length; ci++) {
            const des = day.desiredCurves[ci];
            if (des && des.length > 0) {
                const smoothed = smoothPhaseValues(des, PHASE_SMOOTH_PASSES);
                if (desiredStrokes[ci]) desiredStrokes[ci].setAttribute('d', phasePointsToPath(smoothed, true));
                if (desiredFills[ci]) desiredFills[ci].setAttribute('d', phasePointsToFillPath(smoothed, true));
            }
        }
    }

    // Render Lx curves
    const lxStrokes = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-path')) : [];
    const lxFills = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-fill')) : [];
    for (let ci = 0; ci < curvesData.length; ci++) {
        const pts = day.lxCurves[ci]?.points || [];
        if (pts.length > 0) {
            if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(pts, true));
            if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(pts, true));
        }
    }
    if (day.lxCurves?.length) updateGamificationCurveData(day.lxCurves);

    // Render substance timeline pills + AUC bands (instant swap)
    const mdPhase = MultiDayState.phase;
    const isMultiDay = mdPhase !== 'idle';
    if (day.interventions.length > 0 || isMultiDay) {
        renderSubstanceTimeline(day.interventions, day.lxCurves, curvesData);
        // Update per-substance AUC bands with this day's corrected baselines
        // (skip during scrub boundary crossing — buildBandMorphPlan handles bands via DOM reuse)
        if (!opts?.skipBands) {
            const dayCurves = curvesData.map((c: CurveData, i: number) => ({
                ...c,
                baseline: day.postInterventionBaseline?.[i] || day.bioCorrectedBaseline[i] || c.baseline,
                desired: day.desiredCurves[i] || c.desired,
            }));
            renderLxBandsStatic(day.interventions, dayCurves);
        }
        if (!isMultiDay) {
            preserveBiometricStrips();
        }
        revealTimelinePillsInstant();
    }

    // Render POI dots and connectors
    renderPoiForDay(day);

    updateDayCounter(day.day, day.narrativeBeat);
    // Snap week strip highlight for instant seek
    const totalDays = MultiDayState.days.length || 7;
    updateWeekStripDay(day.day, totalDays);
    MultiDayState.currentDay = day.day;

    // Sync Sherlock 7D on instant seek
    const sherlock7dCb = MultiDayState.onSherlock7DSync;
    if (typeof sherlock7dCb === 'function') sherlock7dCb(day.day);
}

// ── Seek to a specific day (instant) ──

export function seekToDay(dayIndex: number) {
    const { days } = MultiDayState;
    if (dayIndex < 0 || dayIndex >= days.length) return;

    const curvesData = PhaseState.curvesData;
    if (!curvesData) return;

    renderDayState(days[dayIndex], curvesData);
    // Reset bio group to correct absolute position (prevents stale transform from scrubbing)
    _resetBioGroupTransform(days[dayIndex]);
}

// ── Continuous day rendering for drag-to-scrub ──

/** Cache for pill morph plan during continuous scrubbing (avoids DOM churn on every frame) */
let _scrubCacheFromIdx = -1;
let _scrubCachePlan: PillMorphPlan | null = null;
let _scrubCacheCtx: InterpolationCtx | null = null;

/** Clear the continuous scrub cache (call when drag ends or animation resumes) */
export function clearContinuousDayCache(): void {
    // Remove any portal ghost elements from the previous plan
    if (_scrubCachePlan) {
        for (const m of _scrubCachePlan.matched) {
            if (m.ghost) m.ghost.remove();
        }
    }
    _scrubCacheFromIdx = -1;
    _scrubCachePlan = null;
    _scrubCacheCtx = null;
}

/**
 * Reset the bio group transform to the correct absolute vertical position for a given day.
 * During autoplay, the bio shift telescopes cleanly across transitions. During scrubbing,
 * the transform can become stale from partial interpolation frames. This computes the
 * absolute offset = (dayLanes − day0Lanes) × laneStep, ensuring a clean baseline for
 * the next buildInterpolationCtx call.
 */
function _resetBioGroupTransform(day: DaySnapshot): void {
    const { days } = MultiDayState;
    if (!days || days.length === 0) return;

    const bioGroupEl = document.getElementById('phase-biometric-strips');
    const spotterGroupEl = document.getElementById('phase-spotter-highlights');
    if (!bioGroupEl) return;

    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const day0Alloc = allocateTimelineLanes(days[0].interventions || []);
    const day0Lanes = day0Alloc.reduce((mx: number, a: any) => Math.max(mx, (a.laneIdx || 0) + 1), 0);
    const dayAlloc = allocateTimelineLanes(day.interventions || []);
    const dayLanes = dayAlloc.reduce((mx: number, a: any) => Math.max(mx, (a.laneIdx || 0) + 1), 0);

    // Include the base offset (Phase 4 → day 0 repositioning) computed in biometric.ts
    const absY = MultiDayState.bioBaseTranslateY + (dayLanes - day0Lanes) * laneStep;
    bioGroupEl.setAttribute('transform', `translate(0,${absY.toFixed(2)})`);
    if (spotterGroupEl) {
        spotterGroupEl.setAttribute('transform', `translate(0,${absY.toFixed(2)})`);
    }

    // Adjust viewBox to tightly wrap content (eliminate dead space below bio strips)
    const svgNode = document.getElementById('phase-chart-svg');
    if (svgNode instanceof SVGSVGElement && MultiDayState.lockedViewBoxHeight != null) {
        const laneDelta = (dayLanes - day0Lanes) * laneStep;
        const newH = MultiDayState.lockedViewBoxHeight + laneDelta;
        svgNode.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${newH.toFixed(1)}`);
    }
}

/**
 * Render the fully interpolated visual state at a continuous day position.
 * e.g., dayFloat=2.6 renders 60% between Day 2 and Day 3.
 * Used by the drag-to-scrub handler for smooth sub-day scrubbing.
 */
export function renderAtContinuousDay(dayFloat: number, curvesData: CurveData[]): void {
    const { days } = MultiDayState;
    if (!days || days.length < 2) return;

    const clamped = clamp(dayFloat, 0, days.length - 1);
    const fromIdx = Math.min(Math.floor(clamped), days.length - 2);
    const toIdx = fromIdx + 1;
    const t = clamped - fromIdx;

    // Exactly on a day boundary — use the instant renderer
    if (t < 0.001) {
        clearContinuousDayCache();
        renderDayState(days[fromIdx], curvesData);
        _resetBioGroupTransform(days[fromIdx]);
        return;
    }

    const fromDay = days[fromIdx];
    const toDay = days[toIdx];

    // Rebuild pill morph plan + interpolation context when crossing a day boundary
    if (fromIdx !== _scrubCacheFromIdx) {
        // Reset DOM to the "from" day (clean pill elements) before building new plan.
        // Skip bands — buildInterpolationCtx → buildBandMorphPlan handles them via DOM reuse.
        renderDayState(fromDay, curvesData, { skipBands: true });

        // Set the correct absolute bio group position for fromDay.
        // During autoplay this telescopes cleanly (each transition builds on the last),
        // but during scrubbing the bio group transform can be stale from a previous
        // interpolation frame, causing random gaps between bio and substance strips.
        // Absolute position = (fromDay lanes - day0 lanes) × laneStep.
        _resetBioGroupTransform(fromDay);

        _scrubCachePlan = preparePillMorph(fromDay, toDay, curvesData);
        _scrubCacheCtx = buildInterpolationCtx(fromDay, toDay, curvesData);
        _scrubCacheFromIdx = fromIdx;
    }

    if (_scrubCacheCtx) {
        _interpolateFrame(fromDay, toDay, t, curvesData, _scrubCachePlan, _scrubCacheCtx);
    }

    // Update day counter — show whichever day has majority
    const nearestDay = t < 0.5 ? fromDay.day : toDay.day;
    const narrativeBeat = t < 0.5 ? fromDay.narrativeBeat : toDay.narrativeBeat;
    updateDayCounter(nearestDay, narrativeBeat);
    MultiDayState.currentDay = fromIdx;

    // Sync Sherlock 7D narration card during scrub
    const sherlock7dCb = MultiDayState.onSherlock7DSync;
    if (typeof sherlock7dCb === 'function') sherlock7dCb(nearestDay);

    // Sync HTML scrubber
    const scrubber = document.getElementById('day-scrubber') as HTMLInputElement;
    if (scrubber) scrubber.value = String(Math.round(clamped));
}

// ── Animation sequence cancellation token ──
// Monotonically increasing ID — bumped each time a new animation sequence starts.
// Old rAF loops check this and exit immediately if stale, preventing dual-loop races.
let _animSeqId = 0;

// ── Play multi-day sequence ──

export async function playMultiDaySequence(days: DaySnapshot[], curvesData: CurveData[]): Promise<void> {
    if (days.length < 2) return;

    _animSeqId++; // invalidate any prior animation loops
    const mySeqId = _animSeqId;

    MultiDayState.phase = 'playing';
    PhaseState.phase = 'week-playing';

    const visibleStartIdx = getVisibleWeekStartIndex(days);
    const visibleStartDay = days[visibleStartIdx];

    // Build the week strip (replaces Day/Night bands) if it is not already
    // visible from the Day 0 preview state.
    if (!document.getElementById('week-strip-hit')) {
        buildWeekStrip(days.length);
    }
    updateWeekStripDay(visibleStartDay.day, days.length);

    // Attach drag-to-scrub on the week strip hit area
    setupWeekStripDrag();

    const baseDuration = 3000; // ms per day transition
    const fastFadeDuration = 1500; // ms for wrap-around fade when Knight changed curves

    // Continuous loop: start from the first visible computed day and loop back there.
    while (_mdPhase() === 'playing' && _animSeqId === mySeqId) {
        for (let i = visibleStartIdx; i < days.length - 1; i++) {
            if (_animSeqId !== mySeqId) return; // newer sequence started
            // Check for pause (phase is mutated externally, so re-read each iteration)
            if (_mdPhase() === 'paused') {
                await new Promise<void>(resolve => {
                    const checkResume = () => {
                        const p = _mdPhase();
                        if (p === 'playing' || p === 'idle' || _animSeqId !== mySeqId) {
                            resolve();
                        } else {
                            setTimeout(checkResume, 100);
                        }
                    };
                    checkResume();
                });
                if (_animSeqId !== mySeqId) return;
                if (_mdPhase() === 'idle') return;
            }
            // Exit loop if no longer playing (paused then set to idle externally)
            if (_mdPhase() !== 'playing') break;

            updateDayCounter(days[i + 1].day, days[i + 1].narrativeBeat);

            // Notify VCR stepper to animate day label transit
            const advanceCb = MultiDayState.onDayAdvance;
            if (typeof advanceCb === 'function') advanceCb();

            const nextDay = days[i + 1];
            await animateDayTransition(days[i], nextDay, curvesData, baseDuration, () => {
                // Rebuild DOM in final animation frame — no visible gap between days
                // Skip renderLxBandsStatic: interpolation at t=1 already shows the correct
                // final band state, and the next buildBandMorphPlan rebuilds for the next transition.
                MultiDayState.currentDay = nextDay.day;
                renderSubstanceTimeline(nextDay.interventions, nextDay.lxCurves, curvesData);
                revealTimelinePillsInstant();
                renderPoiForDay(nextDay);
                animatePoiWeekly();
            });
            if (_animSeqId !== mySeqId) return; // bail after await
        }

        // Loop back: final visible day → first visible computed day
        if (MultiDayState.phase === 'playing' && _animSeqId === mySeqId && days.length >= 2) {
            const lastDay = days[days.length - 1];
            const firstDay = visibleStartDay;
            updateDayCounter(firstDay.day, firstDay.narrativeBeat);

            const advanceCb = MultiDayState.onDayAdvance;
            if (typeof advanceCb === 'function') advanceCb();

            if (hasSignificantDesiredCurveChange(days)) {
                // Knight adapted desired curves — faster fade for wrap-around
                await animateDayFadeTransition(lastDay, firstDay, curvesData, fastFadeDuration, () => {
                    MultiDayState.currentDay = 0;
                });
            } else {
                // Knight kept desired curves constant — smooth morph like any other day
                await animateDayTransition(lastDay, firstDay, curvesData, baseDuration, () => {
                    MultiDayState.currentDay = 0;
                    renderSubstanceTimeline(firstDay.interventions, firstDay.lxCurves, curvesData);
                    revealTimelinePillsInstant();
                    renderPoiForDay(firstDay);
                    animatePoiWeekly();
                });
            }
            if (_animSeqId !== mySeqId) return;
        }
    }

    // Only set complete if we're still the active sequence
    if (_animSeqId === mySeqId) {
        MultiDayState.phase = 'complete';
        PhaseState.phase = 'week-complete';
    }
}

/**
 * Resume playback from a specific day index (used after drag-to-scrub).
 * Unlike playMultiDaySequence, this skips buildWeekStrip (already exists)
 * and starts the animation loop from the given day instead of day 0.
 */
async function playMultiDaySequenceFrom(startDay: number, days: DaySnapshot[], curvesData: CurveData[]): Promise<void> {
    if (days.length < 2) return;

    _animSeqId++; // invalidate any prior animation loops
    const mySeqId = _animSeqId;
    const visibleStartIdx = getVisibleWeekStartIndex(days);

    MultiDayState.phase = 'playing';
    PhaseState.phase = 'week-playing';
    showWeekStripPlayIcon(false);

    const baseDuration = 3000;
    const fastFadeDuration = 1500;
    let loopStart = clamp(startDay, visibleStartIdx, days.length - 2);

    // Force a clean DOM rebuild at the starting day to clear any scrub artifacts
    // (morph-added pills, mid-transform elements, stale opacity/transform attrs)
    renderDayState(days[loopStart], curvesData);

    while (_mdPhase() === 'playing' && _animSeqId === mySeqId) {
        for (let i = loopStart; i < days.length - 1; i++) {
            if (_animSeqId !== mySeqId) return;
            if (_mdPhase() === 'paused') {
                await new Promise<void>(resolve => {
                    const checkResume = () => {
                        const p = _mdPhase();
                        if (p === 'playing' || p === 'idle' || _animSeqId !== mySeqId) {
                            resolve();
                        } else {
                            setTimeout(checkResume, 100);
                        }
                    };
                    checkResume();
                });
                if (_animSeqId !== mySeqId) return;
                if (_mdPhase() === 'idle') return;
            }
            if (_mdPhase() !== 'playing') break;

            updateDayCounter(days[i + 1].day, days[i + 1].narrativeBeat);
            const advanceCb = MultiDayState.onDayAdvance;
            if (typeof advanceCb === 'function') advanceCb();

            const nextDay = days[i + 1];
            await animateDayTransition(days[i], nextDay, curvesData, baseDuration, () => {
                MultiDayState.currentDay = nextDay.day;
                renderSubstanceTimeline(nextDay.interventions, nextDay.lxCurves, curvesData);
                revealTimelinePillsInstant();
                renderPoiForDay(nextDay);
                animatePoiWeekly();
            });
            if (_animSeqId !== mySeqId) return;
        }

        // Wrap around: final visible day → first visible computed day
        if (MultiDayState.phase === 'playing' && _animSeqId === mySeqId && days.length >= 2) {
            const lastDay = days[days.length - 1];
            const firstDay = days[visibleStartIdx];
            updateDayCounter(firstDay.day, firstDay.narrativeBeat);
            const advanceCb = MultiDayState.onDayAdvance;
            if (typeof advanceCb === 'function') advanceCb();

            if (hasSignificantDesiredCurveChange(days)) {
                await animateDayFadeTransition(lastDay, firstDay, curvesData, fastFadeDuration, () => {
                    MultiDayState.currentDay = 0;
                });
            } else {
                await animateDayTransition(lastDay, firstDay, curvesData, baseDuration, () => {
                    MultiDayState.currentDay = 0;
                    renderSubstanceTimeline(firstDay.interventions, firstDay.lxCurves, curvesData);
                    revealTimelinePillsInstant();
                    renderPoiForDay(firstDay);
                    animatePoiWeekly();
                });
            }
            if (_animSeqId !== mySeqId) return;
        }

        // After the first pass (which started from startDay), all subsequent loops
        // restart from the first visible computed day rather than the hidden day 0.
        loopStart = visibleStartIdx;
    }

    if (_animSeqId === mySeqId) {
        MultiDayState.phase = 'complete';
        PhaseState.phase = 'week-complete';
    }
}

// ── Pause / Resume controls ──

export function pauseMultiDay() {
    if (MultiDayState.phase === 'playing') {
        MultiDayState.phase = 'paused';
    }
}

export function resumeMultiDay() {
    if (MultiDayState.phase === 'paused') {
        MultiDayState.phase = 'playing';
        // Hide inline play icon and clear scrub cache when animation resumes
        showWeekStripPlayIcon(false);
        clearContinuousDayCache();
    }
}

// ── Toggle speed ──

export function cycleMultiDaySpeed() {
    const speeds = [1, 1.5, 2, 3, 4, 8];
    const idx = speeds.indexOf(MultiDayState.speed);
    MultiDayState.speed = speeds[(idx + 1) % speeds.length];
    const btn = document.getElementById('day-speed-btn');
    if (btn) btn.textContent = `${MultiDayState.speed}x`;
}

// ── Week strip drag-to-scrub ──

/** Module-local drag state — not in global state.ts, following baseline-editor.ts pattern */
const _weekDrag = {
    active: false,
    wasPlaying: false,
    currentDayFloat: 0,
    grabOffsetDays: 0, // offset between click position and highlight center (prevents jump)
    startDayFloat: 0, // where the pointer went down (for click-to-jump detection)
    moved: false, // whether meaningful movement occurred (distinguishes click from drag)
    cleanupFn: null as (() => void) | null,
};

/**
 * Attach drag-to-scrub handlers on the week strip hit area.
 * Call after `buildWeekStrip()` creates the `#week-strip-hit` element.
 */
export function setupWeekStripDrag(): void {
    // Clean up any prior listeners first
    cleanupWeekStripDrag();

    const hitRect = document.getElementById('week-strip-hit');
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement;
    if (!hitRect || !svg) return;

    const plotL = PHASE_CHART.padL;
    const plotW = PHASE_CHART.plotW;

    /** Convert a mouse/touch event to SVG X coordinate */
    function svgXFromEvent(e: PointerEvent): number {
        const m = svg.getScreenCTM();
        if (!m) return plotL;
        return (e.clientX - m.e) / m.a;
    }

    /** Convert an SVG X coordinate to a continuous day float (unclamped).
     *  Callers clamp after applying grab offset — clamping here would prevent
     *  dragging the highlight to the rightmost cell when offset > 0. */
    function svgXToDayFloat(svgX: number): number {
        const totalDays = MultiDayState.days.length || 7;
        const cellW = plotW / totalDays;
        const relX = svgX - plotL;
        return relX / cellW;
    }

    /** Check if pointer is in the central zone of the highlight rect (play icon area) */
    function isInPlayIconZone(svgX: number): boolean {
        const highlight = document.getElementById('week-strip-highlight');
        const playIcon = document.getElementById('week-strip-play-icon');
        if (!highlight || !playIcon || playIcon.getAttribute('opacity') === '0') return false;

        const hx = parseFloat(highlight.getAttribute('x') || '0');
        const hw = parseFloat(highlight.getAttribute('width') || '0');
        const center = hx + hw / 2;
        return Math.abs(svgX - center) < 12; // ~24px central zone
    }

    /** Get the current highlight rect position as a day float (uses left edge, not center) */
    function highlightDayFloat(): number {
        const highlight = document.getElementById('week-strip-highlight');
        if (!highlight) return MultiDayState.currentDay;
        const hx = parseFloat(highlight.getAttribute('x') || '0');
        // Use left edge — that's how interpolateWeekStripHighlight positions it:
        // x = plotL + dayIndex * cellW, so svgXToDayFloat(x) = dayIndex exactly.
        return svgXToDayFloat(hx);
    }

    function onDown(e: PointerEvent) {
        const days = MultiDayState.days;
        if (!days || days.length < 2) return;

        const svgX = svgXFromEvent(e);

        // If clicking the play icon zone, resume playback instead of dragging
        if (isInPlayIconZone(svgX)) {
            e.preventDefault();
            showWeekStripPlayIcon(false);
            clearContinuousDayCache();

            // Kill old animation loop (bump token so old rAF exits immediately)
            // and restart from the scrubbed day
            const startDay = MultiDayState.currentDay;
            const curvesData = PhaseState.curvesData;
            const playPauseBtn = document.getElementById('day-play-pause');
            if (playPauseBtn) playPauseBtn.innerHTML = pauseSvgIcon();

            // _animSeqId is bumped inside playMultiDaySequenceFrom, which makes
            // old rAF loops bail on their next tick. No timing race.
            MultiDayState.phase = 'idle';
            if (curvesData && days.length > 0) {
                playMultiDaySequenceFrom(startDay, days, curvesData).then(() => {
                    if (playPauseBtn) playPauseBtn.innerHTML = playSvgIcon();
                });
            }
            return;
        }

        e.preventDefault();
        const clickDayFloat = svgXToDayFloat(svgX);
        const currentHighlightDay = highlightDayFloat();

        _weekDrag.active = true;
        _weekDrag.wasPlaying = MultiDayState.phase === 'playing';
        _weekDrag.startDayFloat = clickDayFloat;
        _weekDrag.moved = false;
        // Track offset so the rect doesn't jump — it moves relative to the grab point
        _weekDrag.grabOffsetDays = clickDayFloat - currentHighlightDay;
        _weekDrag.currentDayFloat = currentHighlightDay;

        // Pause animation during drag
        if (MultiDayState.phase === 'playing') pauseMultiDay();

        // Hide play icon while dragging
        showWeekStripPlayIcon(false);

        // Change cursor to grabbing
        hitRect.setAttribute('cursor', 'grabbing');

        // Capture pointer for reliable tracking outside the element
        hitRect.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
        const svgX = svgXFromEvent(e);

        // Update cursor on hover (fires even when not dragging)
        if (!_weekDrag.active) {
            const playIcon = document.getElementById('week-strip-play-icon');
            const playVisible = playIcon && playIcon.getAttribute('opacity') !== '0';
            if (playVisible && isInPlayIconZone(svgX)) {
                hitRect.setAttribute('cursor', 'pointer');
            } else {
                hitRect.setAttribute('cursor', 'grab');
            }
            return;
        }

        // Active drag — scrub to new position
        e.preventDefault();
        const totalDays = MultiDayState.days.length || 7;
        // Subtract grab offset so the rect stays anchored to the grab point
        const dayFloat = clamp(svgXToDayFloat(svgX) - _weekDrag.grabOffsetDays, 0, totalDays - 1);

        // Mark as moved if pointer traveled more than ~10% of a day cell
        if (!_weekDrag.moved && Math.abs(svgXToDayFloat(svgX) - _weekDrag.startDayFloat) > 0.1) {
            _weekDrag.moved = true;
        }

        _weekDrag.currentDayFloat = dayFloat;

        const curvesData = PhaseState.curvesData;
        if (curvesData) renderAtContinuousDay(dayFloat, curvesData);
    }

    function onUp(e: PointerEvent) {
        if (!_weekDrag.active) return;
        _weekDrag.active = false;

        // Restore cursor to grab
        hitRect.setAttribute('cursor', 'grab');

        // Release pointer capture
        hitRect.releasePointerCapture(e.pointerId);

        const totalDays = MultiDayState.days.length || 7;

        let targetDay: number;
        if (!_weekDrag.moved) {
            // Click without drag — jump to the clicked day cell
            targetDay = clamp(Math.floor(_weekDrag.startDayFloat), 0, totalDays - 1);
        } else {
            // Drag — snap to nearest day
            targetDay = Math.round(_weekDrag.currentDayFloat);
        }

        clearContinuousDayCache();
        seekToDay(clamp(targetDay, 0, totalDays - 1));

        // Show inline play icon centered in the highlight
        showWeekStripPlayIcon(true);
    }

    hitRect.addEventListener('pointerdown', onDown);
    hitRect.addEventListener('pointermove', onMove);
    hitRect.addEventListener('pointerup', onUp);
    hitRect.addEventListener('pointercancel', onUp);

    _weekDrag.cleanupFn = () => {
        hitRect.removeEventListener('pointerdown', onDown);
        hitRect.removeEventListener('pointermove', onMove);
        hitRect.removeEventListener('pointerup', onUp);
        hitRect.removeEventListener('pointercancel', onUp);
    };
}

/** Remove week strip drag listeners */
export function cleanupWeekStripDrag(): void {
    if (_weekDrag.cleanupFn) _weekDrag.cleanupFn();
    _weekDrag.cleanupFn = null;
    _weekDrag.active = false;
}

// ── Initialize day controls event listeners ──

export function initMultiDayControls() {
    const scrubber = document.getElementById('day-scrubber') as HTMLInputElement;
    if (scrubber) {
        scrubber.addEventListener('input', () => {
            const day = parseInt(scrubber.value, 10);
            if (MultiDayState.phase === 'playing') pauseMultiDay();
            seekToDay(day);
        });
    }

    const playPauseBtn = document.getElementById('day-play-pause');
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            if (MultiDayState.phase === 'playing') {
                pauseMultiDay();
                playPauseBtn.innerHTML = playSvgIcon();
            } else if (MultiDayState.phase === 'paused') {
                resumeMultiDay();
                playPauseBtn.innerHTML = pauseSvgIcon();
            } else if (MultiDayState.phase === 'complete') {
                const curvesData = PhaseState.curvesData;
                if (curvesData && MultiDayState.days.length > 0) {
                    seekToDay(0);
                    playPauseBtn.innerHTML = pauseSvgIcon();
                    playMultiDaySequence(MultiDayState.days, curvesData).then(() => {
                        playPauseBtn.innerHTML = playSvgIcon();
                    });
                }
            }
        });
    }

    const speedBtn = document.getElementById('day-speed-btn');
    if (speedBtn) {
        speedBtn.addEventListener('click', cycleMultiDaySpeed);
    }
}

function playSvgIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 14 14"><polygon points="3,1 12,7 3,13" fill="currentColor"/></svg>';
}

function pauseSvgIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="0.5" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" rx="0.5" fill="currentColor"/></svg>';
}

export const __testing = {
    buildMorphedGamificationCurves,
};
