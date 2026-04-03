// ============================================
// SUBSTANCE TIMELINE — lane allocation, pill rendering, sequential reveal, orchestration
// ============================================

import { PHASE_CHART, TIMELINE_ZONE, PHASE_SMOOTH_PASSES } from './constants';
import { BiometricState, MultiDayState, isTurboActive } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY, sleep, isLightMode, clamp, parseDoseToMg } from './utils';
import {
    smoothPhaseValues,
    phasePointsToPath,
    phasePointsToFillPath,
    buildProgressiveMorphPoints,
    interpolatePointsAtTime,
    phaseBandPath,
} from './curve-utils';
import { placePeakDescriptors } from './phase-chart';
import {
    renderGamificationOverlay,
    updateGamificationCurveData,
    setStackingBarSweepProgress,
} from './gamification-overlay';
import { computeSubstanceContributions } from './lx-compute';
import {
    showNarrationPanel,
    hideNarrationPanel,
    showSherlockStack,
    enableSherlockScrollMode,
    scrollSherlockCardToCenter,
    setSherlockHoverLock,
    showLxStepControls,
    hideLxStepControls,
    awaitLxStep,
    consumeSkipSweep,
    isLxSweepPaused,
    skippableSleep,
} from './sherlock';
import { buildSherlockCards } from './timeline-segments/sherlock-segments';
import { matchImpactToCurve, mapSubstanceToEffectAxis, computeIncrementalLxOverlay } from './lx-compute';

export interface LxRuntime {
    renderBiometricStrips: (channels: typeof BiometricState.channels, instant?: boolean, anchorSepY?: number) => void;
}

const lxRuntime: LxRuntime = {
    renderBiometricStrips: () => {},
};

export function configureLxRuntime(runtime: Partial<LxRuntime>): void {
    Object.assign(lxRuntime, runtime);
}

// ============================================
// Module-level state
// ============================================

let _viewBoxHeightAnimRaf: number | null = null;
let _viewBoxHeightAnimToken = 0;
let _timelineLabelMeasureCtx: CanvasRenderingContext2D | null = null;
const _timelineLabelWidthCache = new Map<string, number>();

const TIMELINE_LABEL_FONT = `500 12.5px 'IBM Plex Mono', monospace`;
const TIMELINE_LABEL_RX_FONT = `700 7px 'IBM Plex Mono', monospace`;
const TIMELINE_LABEL_LETTER_SPACING_PX = 12.5 * 0.03;
const TIMELINE_LABEL_LEFT_PAD = 6;
const TIMELINE_LABEL_WIDTH_BUFFER_PX = 8;

// ============================================
// Biometric strip preservation
// ============================================

/**
 * After timeline re-render, re-render biometric strips if they exist.
 * This preserves strip visibility when renderSubstanceTimeline() resets the viewBox.
 */
/** Compute the bottom Y of the substance timeline zone from rendered pills. */
export function getTimelineBottomY(): number {
    const timelineGroup = document.getElementById('phase-substance-timeline');
    let bottomY = TIMELINE_ZONE.top + TIMELINE_ZONE.bottomPad;
    if (timelineGroup) {
        timelineGroup.querySelectorAll('.timeline-bar').forEach((rect: Element) => {
            const y = parseFloat(rect.getAttribute('y') || '0');
            if (y > 0) {
                bottomY = Math.max(bottomY, y + TIMELINE_ZONE.laneH + TIMELINE_ZONE.bottomPad);
            }
        });
    }
    return bottomY;
}

/** Read the effective Y of the biometric separator (attribute + group transform). */
export function getBioSeparatorEffectiveY(): number {
    const bioGroup = document.getElementById('phase-biometric-strips');
    if (!bioGroup) return Infinity;
    const sep = bioGroup.querySelector('.biometric-separator') as SVGLineElement | null;
    const sepY = sep ? parseFloat(sep.getAttribute('y1') || '') : NaN;
    if (!Number.isFinite(sepY)) return Infinity;
    const m = (bioGroup.getAttribute('transform') || '').match(/translate\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)\s*\)/);
    return sepY + (m ? parseFloat(m[1]) || 0 : 0);
}

/**
 * After timeline re-render, re-render biometric strips preserving position.
 * @param pushDown  When true (default), ensures strips sit below all timeline lanes.
 *                  When false, strips stay at their old Y (used by revision animation
 *                  so that the slide-down can be animated later).
 */
export function preserveBiometricStrips(pushDown = true, fitToTimeline = false) {
    const channels = BiometricState.channels;
    if (!channels || channels.length === 0) return;
    const bioGroup = document.getElementById('phase-biometric-strips');
    if (!bioGroup || bioGroup.children.length === 0) return;

    // Capture the effective separator Y BEFORE clearing transforms so we know
    // where the strip was visually (attribute Y + transform offset).
    const effectiveSepY = getBioSeparatorEffectiveY();

    // Clear any leftover transforms from a previous slide animation
    bioGroup.removeAttribute('transform');
    const spotterGroup = document.getElementById('phase-spotter-highlights');
    if (spotterGroup) spotterGroup.removeAttribute('transform');

    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    const preservedViewBoxH = svg ? parseFloat(svg.getAttribute('viewBox')?.split(/\s+/)[3] || '500') : 500;

    // Keep the strip anchored at its existing Y position so timeline re-renders
    // do not visually yank the biometric region upward.
    const sep = bioGroup.querySelector('.biometric-separator') as SVGLineElement | null;
    const rawSepY = sep ? parseFloat(sep.getAttribute('y1') || '') : NaN;

    let anchorSepY: number | undefined;
    if (fitToTimeline) {
        // Fit directly to the current timeline bottom — used after revision completes
        // so bio strips sit right below the (possibly reduced) lane count.
        anchorSepY = getTimelineBottomY();
        _slideTargetSepY = null;
    } else if (pushDown) {
        // Use the most reliable anchor: max of attribute Y, effective Y
        // (includes transform), stored slide target, and timeline bottom.
        const candidates = [
            Number.isFinite(rawSepY) ? rawSepY : 0,
            Number.isFinite(effectiveSepY) && effectiveSepY < Infinity ? effectiveSepY : 0,
            _slideTargetSepY ?? 0,
            getTimelineBottomY(),
        ];
        anchorSepY = Math.max(...candidates);
        _slideTargetSepY = null;
    } else if (Number.isFinite(rawSepY)) {
        anchorSepY = rawSepY;
    }

    // Clear old bio clip-paths from defs
    if (svg) svg.querySelectorAll('defs [id^="bio-clip-"]').forEach(el => el.remove());

    // Re-render at correct position (instant = true, no clip animation)
    lxRuntime.renderBiometricStrips(channels, true, anchorSepY);

    if (!svg) return;

    const renderedViewBoxH = parseFloat(svg.getAttribute('viewBox')?.split(/\s+/)[3] || '500');
    const lockedViewBoxH = Math.max(
        Number.isFinite(preservedViewBoxH) ? preservedViewBoxH : 500,
        Number.isFinite(renderedViewBoxH) ? renderedViewBoxH : 500,
    );

    // Cancel any in-flight timeline envelope shrink so the biometric region
    // remains visible while revision animations are running.
    void animatePhaseChartViewBoxHeight(svg, lockedViewBoxH, 0);
}

// Stores the last slide target so preserveBiometricStrips can use it as a
// reliable anchor even if DOM analysis returns a stale value.
let _slideTargetSepY: number | null = null;

/**
 * Smoothly slide the biometric zone (strips + spotter highlights + POI
 * connectors) down so that the separator reaches `targetSepY`.
 * Used during revision animation when a new substance swimlane is claimed
 * beneath the current biometric position.
 */
export function slideBiometricZoneDown(targetSepY: number, duration = 280): Promise<void> {
    const bioGroup = document.getElementById('phase-biometric-strips');
    const spotterGroup = document.getElementById('phase-spotter-highlights');
    const svgNode = document.getElementById('phase-chart-svg');
    const svg = svgNode instanceof SVGSVGElement ? svgNode : null;
    if (!bioGroup || !svg) return Promise.resolve();

    const currentEffY = getBioSeparatorEffectiveY();
    const delta = targetSepY - currentEffY;
    if (Math.abs(delta) < 1) return Promise.resolve();

    _slideTargetSepY = targetSepY;

    // Parse existing transform on bio group
    const m = (bioGroup.getAttribute('transform') || '').match(/translate\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)\s*\)/);
    const startTY = m ? parseFloat(m[1]) || 0 : 0;

    // Parse existing transform on spotter group
    const ms = spotterGroup
        ? (spotterGroup.getAttribute('transform') || '').match(/translate\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)\s*\)/)
        : null;
    const spotterStartTY = ms ? parseFloat(ms[1]) || 0 : 0;

    // POI connector data
    const pois: any[] = (BiometricState as any)._pois || [];
    const poiContainer = document.getElementById('phase-poi-connectors');
    const poiGroups = poiContainer ? Array.from(poiContainer.querySelectorAll('.poi-connector-group')) : [];
    const poiBioStartY = pois.map((p: any) => p.bioSvgY as number);

    // ViewBox snapshot
    const vb = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const startH = vb[3];

    const applyFrame = (d: number) => {
        const ty = `translate(0,${(startTY + d).toFixed(2)})`;
        bioGroup.setAttribute('transform', ty);
        if (spotterGroup) spotterGroup.setAttribute('transform', `translate(0,${(spotterStartTY + d).toFixed(2)})`);
        svg.setAttribute('viewBox', `${vb[0]} ${vb[1]} ${vb[2]} ${(startH + d).toFixed(2)}`);
        shiftPoiBioDots(pois, poiGroups, poiBioStartY, d);
    };

    // Turbo: skip animation
    if (isTurboActive()) {
        applyFrame(delta);
        return Promise.resolve();
    }

    return new Promise<void>(resolve => {
        const t0 = performance.now();
        const tick = (now: number) => {
            const raw = Math.min(1, (now - t0) / duration);
            const ease = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
            applyFrame(delta * ease);
            if (raw < 1) requestAnimationFrame(tick);
            else resolve();
        };
        requestAnimationFrame(tick);
    });
}

/** Update POI bio-side dots, bioSvgY, AND connector paths during a slide frame. */
function shiftPoiBioDots(pois: any[], poiGroups: Element[], startYs: number[], delta: number) {
    for (let i = 0; i < pois.length; i++) {
        const poi = pois[i];
        poi.bioSvgY = startYs[i] + delta;
        if (i >= poiGroups.length) continue;
        const g = poiGroups[i];

        // Move bio-side dots
        const dot = g.querySelector('.poi-dot') as SVGCircleElement | null;
        if (dot) dot.setAttribute('cy', poi.bioSvgY.toFixed(1));
        const pulse = g.querySelector('.poi-pulse-ring') as SVGCircleElement | null;
        if (pulse) pulse.setAttribute('cy', poi.bioSvgY.toFixed(1));

        // Redraw connector path so it tracks the shifting bio endpoint
        const path = g.querySelector('path') as SVGPathElement | null;
        if (path) {
            const bx = poi.bioSvgX,
                by = poi.bioSvgY;
            const px = poi.pillSvgX,
                py = poi.pillSvgY;
            if (path.classList.contains('poi-line-bezier')) {
                const mx = (bx + px) / 2,
                    my = (by + py) / 2 - 20;
                path.setAttribute('d', `M${bx},${by} Q${mx},${my} ${px},${py}`);
            } else {
                const my = (by + py) / 2;
                path.setAttribute('d', `M${bx},${by} L${bx},${my} L${px},${my} L${px},${py}`);
            }
        }
    }
}

// ============================================
// Desired curve transmutation
// ============================================

/** Toggle desired curves to dashed/dim when Lx takes over */
export function transmuteDesiredCurves(transmute: any) {
    const desiredGroup = document.getElementById('phase-desired-curves') as HTMLElement | null;
    const arrowGroup = document.getElementById('phase-mission-arrows') as HTMLElement | null;
    if (!desiredGroup || !arrowGroup) return;

    if (transmute) {
        const isLight = isLightMode();
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
        desiredGroup.style.filter = isLight ? 'opacity(0.35) saturate(0.5)' : 'brightness(0.45) saturate(0.5)';
        arrowGroup.style.transition = 'filter 600ms ease';
        arrowGroup.style.filter = isLight ? 'opacity(0.2) saturate(0.2)' : 'brightness(0.25) saturate(0.2)';
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

// ============================================
// Timeline label measurement helpers
// ============================================

function hasTimelineWarningIcon(sub: any): boolean {
    const conf = ((sub && sub.dataConfidence) || '').toLowerCase();
    return conf === 'estimated' || conf === 'medium';
}

function hasTimelineRxBadge(sub: any): boolean {
    const status = ((sub && sub.regulatoryStatus) || '').toLowerCase();
    return status === 'rx' || status === 'controlled';
}

/** Compute display dose accounting for doseMultiplier (e.g. "200mg" * 1.5 → "300mg") */
export function computeDisplayDose(iv: any): string {
    const rawDose = ((iv && iv.dose) || iv?.substance?.standardDose || '').trim();
    const multiplier = iv?.doseMultiplier ?? 1;
    if (!rawDose || multiplier === 1) return rawDose;
    const match = rawDose.match(/^([\d.]+)\s*(.*)$/);
    if (!match) return rawDose;
    const scaled = parseFloat(match[1]) * multiplier;
    const rounded = scaled % 1 === 0 ? String(scaled) : scaled.toFixed(1);
    return `${rounded}${match[2]}`;
}

/** Compute pill bar width proportional to effective dose vs standard dose. */
export function computeDoseBarWidth(iv: any): number {
    // Derive ratio from effective dose vs substance standardDose
    const displayDose = computeDisplayDose(iv);
    const sub = iv?.substance;
    const standardDose = sub?.standardDose || '';
    const effectiveMg = displayDose ? parseDoseToMg(displayDose) : null;
    const standardMg = standardDose ? parseDoseToMg(standardDose) : null;
    let ratio = iv?.doseMultiplier || 1.0;
    if (effectiveMg != null && standardMg != null && standardMg > 0) {
        ratio = effectiveMg / standardMg;
    }
    return Math.max(TIMELINE_ZONE.minBarW, Math.min(TIMELINE_ZONE.doseBaseW * ratio, TIMELINE_ZONE.doseMaxW));
}

function getTimelineCollisionLabelText(iv: any): string {
    const sub = iv && iv.substance;
    const name = (sub && sub.name) || (iv && iv.key) || '';
    const dose = computeDisplayDose(iv);
    const warnIcon = hasTimelineWarningIcon(sub) ? ' 🧪' : '';
    return dose ? `${name} ${dose}${warnIcon}` : `${name}${warnIcon}`;
}

function getTimelineMeasureCtx(): CanvasRenderingContext2D | null {
    if (_timelineLabelMeasureCtx) return _timelineLabelMeasureCtx;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    _timelineLabelMeasureCtx = canvas.getContext('2d');
    return _timelineLabelMeasureCtx;
}

function measureTextWithSpacing(text: string, font: string): number {
    if (!text) return 0;
    const ctx = getTimelineMeasureCtx();
    if (!ctx) return text.length * 7.1;
    ctx.font = font;
    const glyphW = ctx.measureText(text).width;
    const trackingW = Math.max(0, text.length - 1) * TIMELINE_LABEL_LETTER_SPACING_PX;
    return glyphW + trackingW;
}

function estimateTimelineLabelRightPx(iv: any, barX: number): number {
    const text = getTimelineCollisionLabelText(iv);
    const sub = iv && iv.substance;
    const hasRx = hasTimelineRxBadge(sub);
    const cacheKey = `${text}|rx=${hasRx ? 1 : 0}`;
    let textW = _timelineLabelWidthCache.get(cacheKey);
    if (textW == null) {
        textW = measureTextWithSpacing(text, TIMELINE_LABEL_FONT);
        if (hasRx) {
            textW += measureTextWithSpacing(' Rx', TIMELINE_LABEL_RX_FONT);
        }
        _timelineLabelWidthCache.set(cacheKey, textW);
    }
    return barX + TIMELINE_LABEL_LEFT_PAD + textW + TIMELINE_LABEL_WIDTH_BUFFER_PX;
}

// ============================================
// Lane allocation
// ============================================

/** Allocate swim lanes — pixel-space tight packing, no overlap */
export function allocateTimelineLanes(interventions: any) {
    const sorted = [...interventions].sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const pxGap = 6;
    const lanes: any[] = []; // each lane = array of { pxL, pxR, startMin, endMin }

    return sorted.map((iv: any) => {
        const sub = iv.substance;
        const rawDur = sub && sub.pharma ? sub.pharma.duration : 240;
        const dur = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 240;
        const startMin = iv.timeMinutes ?? 0;
        const endMin = startMin + dur;

        const pxL = phaseChartX(startMin);
        const doseW = computeDoseBarWidth(iv);
        const barPxR = pxL + Math.min(doseW, plotRight - pxL);
        const labelPxR = estimateTimelineLabelRightPx(iv, pxL);
        const pxR = Math.max(barPxR, labelPxR);

        // Find first lane with no pixel overlap (label width handles nearby pills)
        let laneIdx = 0;
        for (; laneIdx < lanes.length; laneIdx++) {
            const overlaps = lanes[laneIdx].some((o: any) => pxL < o.pxR + pxGap && pxR > o.pxL - pxGap);
            if (!overlaps) break;
        }
        if (!lanes[laneIdx]) lanes[laneIdx] = [];
        lanes[laneIdx].push({ pxL, pxR, startMin, endMin });

        return { iv, laneIdx, startMin, endMin, dur };
    });
}

/** Linear interpolation of Lx curve value at any minute (legacy wrapper) */
export function interpolateLxValue(lxCurve: any, timeMinutes: any) {
    return interpolatePointsAtTime(lxCurve.points, timeMinutes / 60);
}

// ============================================
// ViewBox height animation
// ============================================

/**
 * Smoothly animate phase-chart SVG viewBox height changes to avoid timeline "pop down".
 */
export function animatePhaseChartViewBoxHeight(
    svg: SVGSVGElement,
    targetHeight: number,
    duration = 280,
): Promise<void> {
    // Turbo: set viewBox synchronously to avoid layout race conditions
    if (isTurboActive()) duration = 0;
    const fallback = [0, 0, PHASE_CHART.viewW, PHASE_CHART.viewH];
    const parsed = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    const [vbX, vbY, vbW, vbH] = parsed.length === 4 && parsed.every(n => Number.isFinite(n)) ? parsed : fallback;

    const targetH = Math.max(PHASE_CHART.viewH, targetHeight);
    const startH = vbH;
    if (duration <= 0 || Math.abs(targetH - startH) < 0.5) {
        // Cancel any in-flight animation so it doesn't overwrite this value
        if (_viewBoxHeightAnimRaf != null) {
            cancelAnimationFrame(_viewBoxHeightAnimRaf);
            _viewBoxHeightAnimRaf = null;
        }
        ++_viewBoxHeightAnimToken;
        svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${targetH}`);
        return Promise.resolve();
    }

    if (_viewBoxHeightAnimRaf != null) {
        cancelAnimationFrame(_viewBoxHeightAnimRaf);
        _viewBoxHeightAnimRaf = null;
    }

    const token = ++_viewBoxHeightAnimToken;
    return new Promise<void>(resolve => {
        const startTs = performance.now();
        const tick = (now: number) => {
            if (token !== _viewBoxHeightAnimToken) {
                resolve();
                return;
            }

            const t = clamp((now - startTs) / duration, 0, 1);
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const h = startH + (targetH - startH) * ease;
            svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${h.toFixed(2)}`);

            if (t < 1) {
                _viewBoxHeightAnimRaf = requestAnimationFrame(tick);
                return;
            }

            _viewBoxHeightAnimRaf = null;
            svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${targetH}`);
            resolve();
        };

        _viewBoxHeightAnimRaf = requestAnimationFrame(tick);
    });
}

// ============================================
// Substance timeline rendering
// ============================================

/** Render FCP-style substance timeline below the chart */
export function renderSubstanceTimeline(interventions: any, lxCurves: any, curvesData: any) {
    const group = document.getElementById('phase-substance-timeline')!;
    group.innerHTML = '';
    // During multi-day, always proceed (render empty lane stripes even with no substances)
    if ((!interventions || interventions.length === 0) && MultiDayState.lockedViewBoxHeight == null) return;

    const svg = document.getElementById('phase-chart-svg')!;
    const defs = svg.querySelector('defs')!;

    // Clean up old timeline clip-paths and gradients
    defs.querySelectorAll('[id^="tl-clip-"], [id^="tl-grad-"]').forEach(el => el.remove());

    // Thin separator line
    group.appendChild(
        svgEl('line', {
            x1: String(PHASE_CHART.padL),
            y1: String(TIMELINE_ZONE.separatorY),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
            y2: String(TIMELINE_ZONE.separatorY),
            class: 'timeline-separator',
        }),
    );

    const allocated = allocateTimelineLanes(interventions || []);
    const contributions = computeSubstanceContributions(interventions || [], curvesData || []);

    // Compute layout
    const rawLaneCount = allocated.reduce((max: number, a: any) => Math.max(max, a.laneIdx + 1), 0);
    // During multi-day: use locked max lane count so the envelope never shrinks
    const isMultiDayLocked = MultiDayState.lockedViewBoxHeight != null;
    const laneCount = isMultiDayLocked ? Math.max(rawLaneCount, MultiDayState.maxTimelineLanes) : rawLaneCount;
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;

    // During multi-day: freeze the viewBox (it already includes bio strip space)
    // Outside multi-day: animate normally
    if (!isMultiDayLocked) {
        const neededH = TIMELINE_ZONE.top + laneCount * laneStep + TIMELINE_ZONE.bottomPad;
        const finalH = Math.max(500, neededH);
        void animatePhaseChartViewBoxHeight(svg as unknown as SVGSVGElement, finalH);
    }

    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const plotLeft = PHASE_CHART.padL;

    // Alternating track backgrounds (FCP-style lane stripes)
    const tlTheme = chartTheme();
    const laneStripeFill = isLightMode() ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)';
    for (let i = 0; i < rawLaneCount; i++) {
        const y = TIMELINE_ZONE.top + i * laneStep;
        if (i % 2 === 1) {
            group.appendChild(
                svgEl('rect', {
                    x: String(plotLeft),
                    y: y.toFixed(1),
                    width: String(PHASE_CHART.plotW),
                    height: String(TIMELINE_ZONE.laneH),
                    fill: laneStripeFill,
                    'pointer-events': 'none',
                }),
            );
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
        const barW = Math.min(computeDoseBarWidth(iv), plotRight - x1);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const h = TIMELINE_ZONE.laneH;
        const rx = TIMELINE_ZONE.pillRx;

        const pillG = svgEl('g', {
            class: 'timeline-pill-group',
            opacity: '0',
            'data-substance-key': iv.key,
            'data-time-minutes': String(iv.timeMinutes),
            'data-revision-stable-id': String(iv._revisionStableId || ''),
        });

        // SVG tooltip (hover title)
        if (sub) {
            const ttConf = (sub.dataConfidence || '').toLowerCase();
            const ttWarn =
                ttConf === 'estimated' || ttConf === 'medium'
                    ? `\n\u26A0\uFE0F ${sub.dataNote || 'Clinical estimation'}`
                    : '';
            const titleEl = svgEl('title');
            titleEl.textContent = `${sub.name} — ${sub.class || ''}\nDose: ${computeDisplayDose(iv) || sub.standardDose || ''}${ttWarn}`;
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
        pillG.appendChild(
            svgEl('line', {
                x1: x1.toFixed(1),
                y1: connectorTopY.toFixed(1),
                x2: x1.toFixed(1),
                y2: String(y),
                stroke: curveColor,
                'stroke-opacity': '0.25',
                'stroke-width': '0.75',
                'stroke-dasharray': '2 3',
                class: 'timeline-connector',
                'pointer-events': 'none',
                'data-curve-idx': String(targetIdx),
                'data-time-h': timeH.toFixed(4),
            }),
        );

        // Dot on curve at administration point
        if (hasLxData) {
            pillG.appendChild(
                svgEl('circle', {
                    cx: x1.toFixed(1),
                    cy: connectorTopY.toFixed(1),
                    r: '3',
                    fill: curveColor,
                    'fill-opacity': '0.65',
                    stroke: curveColor,
                    'stroke-opacity': '0.9',
                    'stroke-width': '0.5',
                    class: 'timeline-curve-dot',
                    'pointer-events': 'none',
                    'data-curve-idx': String(targetIdx),
                    'data-time-h': timeH.toFixed(4),
                }),
            );
        }

        // Clip-path to contain label — extends beyond bar so dose text isn't truncated
        const clipId = `tl-clip-${idx}`;
        const clip = svgEl('clipPath', { id: clipId });
        const labelOverflow = Math.max(0, plotRight - (x1 + barW));
        clip.appendChild(
            svgEl('rect', {
                x: x1.toFixed(1),
                y: y.toFixed(1),
                width: (barW + labelOverflow).toFixed(1),
                height: String(h),
                rx: String(rx),
                ry: String(rx),
            }),
        );
        defs.appendChild(clip);

        // Solid colored bar with border
        pillG.appendChild(
            svgEl('rect', {
                x: x1.toFixed(1),
                y: y.toFixed(1),
                width: barW.toFixed(1),
                height: String(h),
                rx: String(rx),
                ry: String(rx),
                fill: color,
                'fill-opacity': '0.22',
                stroke: color,
                'stroke-opacity': '0.45',
                'stroke-width': '0.75',
                class: 'timeline-bar',
            }),
        );

        // Clipped label inside bar
        const contentG = svgEl('g', { 'clip-path': `url(#${clipId})` });
        const name = sub ? sub.name : iv.key;
        const dose = computeDisplayDose(iv) || (sub ? sub.standardDose : '') || '';
        const conf = sub ? sub.dataConfidence || '' : '';
        const warnIcon = conf.toLowerCase() === 'estimated' || conf.toLowerCase() === 'medium' ? ' 🧪' : '';
        const label = svgEl('text', {
            x: (x1 + 5).toFixed(1),
            y: (y + h / 2 + 3).toFixed(1),
            class: 'timeline-bar-label',
        });
        label.textContent = dose ? `${name} ${dose}${warnIcon}` : `${name}${warnIcon}`;
        // Rx badge as inline tspan after label text
        const regStatus = sub ? (sub.regulatoryStatus || '').toLowerCase() : '';
        if (regStatus === 'rx' || regStatus === 'controlled') {
            const rxSpan = svgEl('tspan', {
                fill: '#e11d48',
                'font-size': '7',
                'font-weight': '700',
                dy: '-0.5',
            });
            rxSpan.textContent = ' Rx';
            label.appendChild(rxSpan);
        }
        // Contribution % badge
        const contribPct = contributions.get(iv.key);
        if (contribPct != null && contribPct > 0) {
            const pctSpan = svgEl('tspan', {
                'fill-opacity': '0.5',
                'font-size': '8',
            });
            pctSpan.textContent = `  ${contribPct}%`;
            label.appendChild(pctSpan);
        }
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

/**
 * Render per-substance AUC bands statically (no animation).
 * Used during multi-day transitions and seeking to keep bands in sync with curves.
 */
export function renderLxBandsStatic(interventions: any, curvesData: any) {
    const bandsGroup = document.getElementById('phase-lx-bands');
    if (!bandsGroup) return;
    bandsGroup.innerHTML = '';

    if (!interventions || interventions.length === 0 || !curvesData || curvesData.length === 0) return;

    const snapshots = computeIncrementalLxOverlay(interventions, curvesData);
    if (!snapshots || snapshots.length === 0) return;

    // Build cumulative bands: each step's band spans from previous Lx to current Lx
    let prevPts: any[][] | null = null;
    for (let k = 0; k < snapshots.length; k++) {
        const { lxCurves, step } = snapshots[k];
        const targetPts = lxCurves.map((lx: any) => lx.points);
        const sourcePts = prevPts || lxCurves.map((lx: any) => lx.baseline);

        for (let ci = 0; ci < curvesData.length; ci++) {
            const bandD = phaseBandPath(targetPts[ci], sourcePts[ci]);
            if (!bandD) continue;
            const substanceColor = step[0]?.substance?.color || curvesData[ci].color;
            const band = svgEl('path', {
                d: bandD,
                fill: substanceColor,
                'fill-opacity': '0.18',
                class: 'lx-auc-band',
                'data-substance-key': step[0]?.key || '',
                'data-step-idx': String(k),
                'data-curve-idx': String(ci),
            });
            bandsGroup.appendChild(band);
        }

        prevPts = targetPts.map((pts: any) => pts.map((p: any) => ({ ...p })));
    }
}

/** Progressive left→right reveal for timeline pills */
export function animateTimelineReveal(duration: any) {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;
    const pills = group.querySelectorAll('.timeline-pill-group');
    if (pills.length === 0) return;

    if (isTurboActive()) {
        pills.forEach((pill: any) => pill.setAttribute('opacity', '1'));
        return;
    }

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
                [
                    { opacity: 0, transform: 'translateY(4px)' },
                    { opacity: 1, transform: 'translateY(0)' },
                ],
                { duration: 400, fill: 'forwards', easing: 'ease-out' },
            );
        }, delay);
    });
}

// ============================================
// SEQUENTIAL SUBSTANCE LAYERING
// ============================================

/**
 * Animate the sequential Lx reveal — one substance (step) at a time.
 * Each step: substance label → timeline pill → playhead sweep → pause.
 * The "active" curve progressively modifies from baseline toward desired.
 */
export async function animateSequentialLxReveal(
    snapshots: any,
    interventions: any,
    curvesData: any,
    narration?: { intro: string; beats: any[]; outro: string } | null,
) {
    const svg = document.getElementById('phase-chart-svg')!;
    const baseGroup = document.getElementById('phase-baseline-curves')!;
    const desiredGroup = document.getElementById('phase-desired-curves')!;
    const arrowGroup = document.getElementById('phase-mission-arrows')!;
    const timelineGroup = document.getElementById('phase-substance-timeline')!;
    const lxGroup = document.getElementById('phase-lx-curves')!;

    // Pre-build the Waze cards for the full stack.
    // buildSherlockCards sorts cards by timeMinutes to match the chronological
    // order of snapshots (computeIncrementalLxOverlay sorts by timeMinutes).
    const sherlockCtx = { sherlockNarration: narration, interventions, curvesData } as any;
    const cards = buildSherlockCards(sherlockCtx);

    // Show Sherlock panel (first card appears with first substance, not here)
    console.log('[Sherlock] animateSequentialLxReveal narration:', narration);
    if (cards.length > 0) {
        showNarrationPanel();
    }

    // Show step controls (Play/Next) for substance-by-substance navigation
    showLxStepControls(snapshots.length);

    // Prepare the timeline zone (separator only). Lane rows are added progressively per step.
    timelineGroup.innerHTML = '';
    const defs = svg.querySelector('defs')!;
    defs.querySelectorAll('[id^="tl-clip-"], [id^="tl-grad-"]').forEach(el => el.remove());

    timelineGroup.appendChild(
        svgEl('line', {
            x1: String(PHASE_CHART.padL),
            y1: String(TIMELINE_ZONE.separatorY),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
            y2: String(TIMELINE_ZONE.separatorY),
            class: 'timeline-separator',
        }),
    );

    const allocated = allocateTimelineLanes(interventions);
    const seqContributions = computeSubstanceContributions(interventions || [], curvesData || []);

    // Build lane lookup by stable key (key + timeMinutes) instead of object identity.
    // When replaying from cache, snapshot.step contains deserialized intervention objects
    // that are structurally equal but NOT the same references as `interventions`.
    const ivStableKey = (iv: any) => `${iv.key}@${iv.timeMinutes}`;
    const laneByKey = new Map<string, number>();
    const allocByKey = new Map<string, any>();
    allocated.forEach((a: any) => {
        const k = ivStableKey(a.iv);
        laneByKey.set(k, a.laneIdx);
        allocByKey.set(k, a);
    });
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const laneStripeFill = isLightMode() ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)';
    let visibleLaneCount = 0;
    const ensureTimelineLaneCoverage = (targetLaneCount: number) => {
        if (targetLaneCount <= visibleLaneCount) return;
        visibleLaneCount = targetLaneCount;

        // During multi-day, don't touch viewBox — it's locked
        if (MultiDayState.lockedViewBoxHeight != null) return;

        const neededH = TIMELINE_ZONE.top + visibleLaneCount * laneStep + TIMELINE_ZONE.bottomPad;
        const finalH = Math.max(500, neededH);
        void animatePhaseChartViewBoxHeight(svg as unknown as SVGSVGElement, finalH);

        for (let laneIdx = 1; laneIdx < visibleLaneCount; laneIdx += 2) {
            if (timelineGroup.querySelector(`.timeline-lane-stripe[data-lane-idx="${laneIdx}"]`)) continue;
            timelineGroup.appendChild(
                svgEl('rect', {
                    x: String(PHASE_CHART.padL),
                    y: (TIMELINE_ZONE.top + laneIdx * laneStep).toFixed(1),
                    width: String(PHASE_CHART.plotW),
                    height: String(TIMELINE_ZONE.laneH),
                    fill: laneStripeFill,
                    class: 'timeline-lane-stripe',
                    'data-lane-idx': String(laneIdx),
                    'pointer-events': 'none',
                }),
            );
        }
    };

    // ── PLAY GATE: wait for user to click Play before any visual changes ──
    await awaitLxStep(0, snapshots.length);

    // Clear any previous Lx curves and AUC bands
    lxGroup.innerHTML = '';
    const bandsGroup = document.getElementById('phase-lx-bands')!;
    bandsGroup.innerHTML = '';

    // Create NEW Lx stroke + fill paths at BASELINE, initially transparent.
    // They fade in while the desired curves dim out — a clean crossfade.
    const lxStrokes: any[] = [];
    const lxFills: any[] = [];
    const baselinePts = curvesData.map((c: any) => smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES));
    const LX_FADE_MS = 600;
    for (let ci = 0; ci < curvesData.length; ci++) {
        const curve = curvesData[ci];
        const initD = phasePointsToPath(baselinePts[ci], true);
        const initFillD = phasePointsToFillPath(baselinePts[ci], true);
        const lxFill = svgEl('path', {
            d: initFillD,
            fill: curve.color,
            'fill-opacity': '0',
            class: 'phase-lx-fill',
        });
        lxGroup.appendChild(lxFill);
        lxFills.push(lxFill);
        const lxStroke = svgEl('path', {
            d: initD,
            fill: 'none',
            stroke: curve.color,
            'stroke-width': '2.2',
            'stroke-opacity': '0',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            class: 'phase-lx-path',
        });
        lxGroup.appendChild(lxStroke);
        lxStrokes.push(lxStroke);
    }

    // Crossfade: dim desired curves while fading Lx baseline curves in
    transmuteDesiredCurves(true);

    if (!isTurboActive()) {
        for (const s of lxStrokes) {
            s.animate([{ strokeOpacity: 0 }, { strokeOpacity: 0.9 }], { duration: LX_FADE_MS, fill: 'forwards' });
        }
    } else {
        for (const s of lxStrokes) s.setAttribute('stroke-opacity', '0.9');
    }

    // Fade arrows out
    Array.from(arrowGroup.children).forEach((a: any) => {
        if (isTurboActive()) {
            a.setAttribute('opacity', '0');
            return;
        }
        a.animate([{ opacity: parseFloat(a.getAttribute('opacity') || '0.7') }, { opacity: 0 }], {
            duration: 600,
            fill: 'forwards',
        });
    });

    // Dim baseline strokes to ghost reference (keep dashed)
    const baselineStrokesAll = baseGroup.querySelectorAll('.phase-baseline-path');
    baselineStrokesAll.forEach((s: any) => {
        if (!s) return;
        s.style.transition = 'stroke-opacity 400ms ease';
        s.setAttribute('stroke-opacity', '0.25');
    });

    // Fade out desired fills so only the Lx fills are visible as the area reference
    desiredGroup.querySelectorAll('.phase-desired-fill').forEach((f: any) => {
        if (isTurboActive()) {
            f.setAttribute('fill-opacity', '0');
            return;
        }
        f.animate([{ fillOpacity: parseFloat(f.getAttribute('fill-opacity') || '0.08') }, { fillOpacity: 0 }], {
            duration: 600,
            fill: 'forwards',
        });
    });

    // Also fade out baseline fills (the Lx fills replace them)
    baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)').forEach((f: any) => {
        if (isTurboActive()) {
            f.setAttribute('fill-opacity', '0');
            return;
        }
        f.animate([{ fillOpacity: parseFloat(f.getAttribute('fill-opacity') || '0.04') }, { fillOpacity: 0 }], {
            duration: 600,
            fill: 'forwards',
        });
    });

    // Fade baseline peak descriptors
    baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
        el.style.transition = 'opacity 300ms ease';
        el.style.opacity = '0';
    });

    // Wait for crossfade to complete before starting substance sweeps
    if (!isTurboActive()) {
        await sleep(LX_FADE_MS);
    }

    // Track current smoothed points per curve (Lx strokes are at baseline)
    let currentPts = baselinePts.map((pts: any) => pts.map((p: any) => ({ ...p })));

    const finalLxCurves = snapshots[snapshots.length - 1].lxCurves;
    const plotBot = PHASE_CHART.padT + PHASE_CHART.plotH;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;

    // Helper: render a single substance's timeline pill
    function renderSinglePill(iv: any) {
        const alloc = allocByKey.get(ivStableKey(iv));
        if (!alloc) return null;
        const { laneIdx, startMin, endMin } = alloc;
        const sub = iv.substance;
        const color = sub ? sub.color : 'rgba(245,180,60,0.7)';

        const x1 = phaseChartX(startMin);
        const barW = Math.min(computeDoseBarWidth(iv), plotRight - x1);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const h = TIMELINE_ZONE.laneH;
        const rx = TIMELINE_ZONE.pillRx;

        const pillG = svgEl('g', {
            class: 'timeline-pill-group',
            opacity: '0',
            'data-substance-key': iv.key,
            'data-time-minutes': String(iv.timeMinutes),
            'data-revision-stable-id': String(iv._revisionStableId || ''),
        });

        // SVG tooltip (hover title)
        if (sub) {
            const ttConf = (sub.dataConfidence || '').toLowerCase();
            const ttWarn =
                ttConf === 'estimated' || ttConf === 'medium'
                    ? `\n\u26A0\uFE0F ${sub.dataNote || 'Clinical estimation'}`
                    : '';
            const titleEl = svgEl('title');
            titleEl.textContent = `${sub.name} — ${sub.class || ''}\nDose: ${computeDisplayDose(iv) || sub.standardDose || ''}${ttWarn}`;
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

        pillG.appendChild(
            svgEl('line', {
                x1: x1.toFixed(1),
                y1: connectorTopY.toFixed(1),
                x2: x1.toFixed(1),
                y2: String(y),
                stroke: curveColor,
                'stroke-opacity': '0.25',
                'stroke-width': '0.75',
                'stroke-dasharray': '2 3',
                class: 'timeline-connector',
                'pointer-events': 'none',
                'data-curve-idx': String(targetIdx),
                'data-time-h': timeH.toFixed(3),
            }),
        );

        pillG.appendChild(
            svgEl('circle', {
                cx: x1.toFixed(1),
                cy: connectorTopY.toFixed(1),
                r: '2.5',
                fill: curveColor,
                'fill-opacity': '0.6',
                class: 'timeline-curve-dot',
                'pointer-events': 'none',
                'data-curve-idx': String(targetIdx),
                'data-time-h': timeH.toFixed(3),
            }),
        );

        pillG.appendChild(
            svgEl('rect', {
                x: x1.toFixed(1),
                y: y.toFixed(1),
                width: barW.toFixed(1),
                height: String(h),
                rx: String(rx),
                fill: color,
                'fill-opacity': '0.18',
                stroke: color,
                'stroke-opacity': '0.35',
                'stroke-width': '0.75',
                class: 'timeline-bar',
            }),
        );

        const conf = sub ? sub.dataConfidence || '' : '';
        const warnIcon = conf.toLowerCase() === 'estimated' || conf.toLowerCase() === 'medium' ? ' 🧪' : '';
        const labelText = `${sub?.name || iv.key}  ${computeDisplayDose(iv) || sub?.standardDose || ''}${warnIcon}`;
        const labelEl = svgEl('text', {
            x: (x1 + 6).toFixed(1),
            y: (y + h / 2 + 3.5).toFixed(1),
            class: 'timeline-bar-label',
            fill: color,
            'font-size': '9',
        });
        labelEl.textContent = labelText;
        // Rx badge as inline tspan after label text
        const regStatus = sub ? (sub.regulatoryStatus || '').toLowerCase() : '';
        if (regStatus === 'rx' || regStatus === 'controlled') {
            const rxSpan = svgEl('tspan', {
                fill: '#e11d48',
                'font-size': '7',
                'font-weight': '700',
                dy: '-0.5',
            });
            rxSpan.textContent = ' Rx';
            labelEl.appendChild(rxSpan);
        }
        // Contribution % badge
        const seqContribPct = seqContributions.get(iv.key);
        if (seqContribPct != null && seqContribPct > 0) {
            const pctSpan = svgEl('tspan', {
                'fill-opacity': '0.5',
                'font-size': '8',
            });
            pctSpan.textContent = `  ${seqContribPct}%`;
            labelEl.appendChild(pctSpan);
        }
        pillG.appendChild(labelEl);

        timelineGroup.appendChild(pillG);
        return pillG;
    }

    const SHERLOCK_CARD_ENTRY_MS = 400;
    const SHERLOCK_POST_CARD_PAUSE_MS = 120;
    const SUBSTANCE_STRIP_LEAD_MS = 180;
    const hasSherlockBeat = (idx: number): boolean => {
        const card = cards[idx];
        return !!(card && typeof card.text === 'string' && card.text.trim().length > 0);
    };

    // Iterate through each step — one substance at a time
    for (let k = 0; k < snapshots.length; k++) {
        // k=0 was already gated before visual setup; subsequent steps wait for user advance
        if (k > 0) await awaitLxStep(k, snapshots.length);

        const snapshot = snapshots[k];
        const step = snapshot.step;
        const targetPts = snapshot.lxCurves.map((lx: any) => (lx.points || []).map((p: any) => ({ ...p })));

        // 1. Show substance label
        const labelNames = step
            .map((iv: any) => {
                const name = iv.substance?.name || iv.key;
                return `${name} \u00B7 ${computeDisplayDose(iv) || ''}`;
            })
            .join('  +  ');

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
            duration: 200,
            fill: 'forwards',
        });

        // Show Sherlock narration beat first. Keep a tiny pause before the strip update.
        if (hasSherlockBeat(k)) {
            showSherlockStack(cards, k);
            await skippableSleep(SHERLOCK_CARD_ENTRY_MS + SHERLOCK_POST_CARD_PAUSE_MS);
        } else if (narration && k === 0) {
            // Hide if there are no beats
            hideNarrationPanel();
        }

        // Expand timeline zone only as far as this step needs.
        const stepLaneCount = step.reduce((max: number, iv: any) => {
            const laneIdx = laneByKey.get(ivStableKey(iv));
            if (laneIdx == null) return max;
            return Math.max(max, laneIdx + 1);
        }, visibleLaneCount);
        ensureTimelineLaneCoverage(stepLaneCount);

        // 3. Render and reveal this substance's timeline pill
        for (let pi = 0; pi < step.length; pi++) {
            const pill = renderSinglePill(step[pi]);
            if (pill) {
                if (isTurboActive()) {
                    pill.setAttribute('opacity', '1');
                    continue;
                }
                setTimeout(() => {
                    pill.animate(
                        [
                            { opacity: 0, transform: 'translateY(4px)' },
                            { opacity: 1, transform: 'translateY(0)' },
                        ],
                        { duration: 300, fill: 'forwards', easing: 'ease-out' },
                    );
                }, pi * 100);
            }
        }

        const pillRevealLead = Math.max(SUBSTANCE_STRIP_LEAD_MS, (step.length - 1) * 100 + 140);
        await skippableSleep(pillRevealLead);

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
        const SIGMA_EXIT = 0.1; // gradual exit
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
            let lo = 0,
                hi = WARP_SAMPLES - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (warpCum[mid + 1] <= targetCum) lo = mid + 1;
                else hi = mid;
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

        // --- Push chevron (primary) ---
        const chevronGroup = svgEl('g', { 'pointer-events': 'none' });
        const chevFill = svgEl('path', {
            d: 'M -8 -10 L 0 2 L 8 -10 Z',
            fill: curvesData[0]?.color || '#f5c850',
            'pointer-events': 'none',
        });
        chevronGroup.appendChild(chevFill);
        playheadGroup.appendChild(chevronGroup);

        svg.appendChild(playheadGroup);

        const sourcePts = currentPts.map((pts: any) => pts.map((p: any) => ({ ...p })));

        // 4a. Pre-create AUC band paths clipped to the playhead position
        const bandClipId = `lx-band-clip-${k}`;
        const bandClip = svgEl('clipPath', { id: bandClipId });
        const bandClipRect = svgEl('rect', {
            x: String(PHASE_CHART.padL),
            y: '0',
            width: '0',
            height: '1200',
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
                'data-time-minutes': String(step[0].timeMinutes ?? ''),
                'data-step-idx': String(k),
                'data-curve-idx': String(ci),
            });
            bandsGroup.appendChild(band);
            stepBands.push(band);
        }

        // Precompute which curve changes most and second-most
        const curveTotals: { ci: number; total: number }[] = [];
        for (let ci = 0; ci < curvesData.length; ci++) {
            if (!sourcePts[ci] || !targetPts[ci]) continue;
            let totalDelta = 0;
            for (let j = 0; j < sourcePts[ci].length; j++) {
                totalDelta += Math.abs(targetPts[ci][j].value - sourcePts[ci][j].value);
            }
            curveTotals.push({ ci, total: totalDelta });
        }
        curveTotals.sort((a, b) => b.total - a.total);
        const bestCurveIdx = curveTotals[0]?.ci ?? 0;
        const secondCurveIdx = curveTotals[1]?.ci ?? null;

        let chevron2Group: Element | null = null;
        let chevFill2: Element | null = null;
        if (secondCurveIdx != null && secondCurveIdx !== bestCurveIdx) {
            chevron2Group = svgEl('g', { 'pointer-events': 'none' });
            chevFill2 = svgEl('path', {
                d: 'M -8 -10 L 0 2 L 8 -10 Z',
                fill: curvesData[secondCurveIdx]?.color || '#94a3b8',
                'pointer-events': 'none',
            });
            chevron2Group.appendChild(chevFill2);
            playheadGroup.appendChild(chevron2Group);
        }

        // Turbo: skip playhead sweep entirely — jump to final state
        if (isTurboActive()) {
            for (let ci = 0; ci < curvesData.length; ci++) {
                const strokeD = phasePointsToPath(targetPts[ci], true);
                const fillD = phasePointsToFillPath(targetPts[ci], true);
                if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                if (lxFills[ci]) lxFills[ci].setAttribute('d', fillD);
            }
            // Show AUC bands fully
            bandClipRect.setAttribute('width', String(PHASE_CHART.plotW + 20));
            stepBands.forEach(b => b.removeAttribute('clip-path'));
            bandClip.remove();
            playheadGroup.remove();
            currentPts = targetPts;
            // Remove label
            labelEl.remove();
            if (k === 0) renderGamificationOverlay(snapshot.lxCurves, curvesData, 'phase2');
            else updateGamificationCurveData(snapshot.lxCurves);
            setStackingBarSweepProgress(1, PHASE_CHART.endHour, k);
            continue;
        }

        // Trigger gamification overlay when first AUC band starts animating
        if (k === 0) {
            renderGamificationOverlay(
                snapshot.lxCurves.map((lx: any, ci: number) => ({
                    ...lx,
                    points: sourcePts[ci],
                })),
                curvesData,
                'phase2',
            );
        }

        await new Promise<void>(resolveSweep => {
            const sweepStart = performance.now();
            let pausedAt: number | null = null;
            let pausedAccum = 0;

            (function tick(now: number) {
                if (isLxSweepPaused()) {
                    if (pausedAt == null) pausedAt = now;
                    requestAnimationFrame(tick);
                    return;
                }
                if (pausedAt != null) {
                    pausedAccum += now - pausedAt;
                    pausedAt = null;
                }

                // Check if skip was requested (user clicked Next / queued skips)
                const skipNow = consumeSkipSweep();
                const sweepElapsed = Math.max(0, now - sweepStart - pausedAccum);
                const rawT = skipNow ? 1 : Math.min(1, sweepElapsed / sweepDuration);
                const playheadHour = warpedHour(rawT);
                const smo = slowmoIntensity(playheadHour);

                const playheadX = phaseChartX(playheadHour * 60);

                // Playhead intensification during slow-mo
                const lineW = 1.5 + smo * 1.5;
                const lineOp = 0.55 + smo * 0.35;
                const glowOp = 0.06 + smo * 0.1;
                phLine.setAttribute('x', (playheadX - lineW / 2).toFixed(1));
                phLine.setAttribute('width', lineW.toFixed(2));
                phLine.setAttribute('fill', `rgba(245, 200, 80, ${lineOp.toFixed(2)})`);
                phGlow.setAttribute('x', (playheadX - 9).toFixed(1));
                phGlow.setAttribute('fill', `rgba(245, 200, 80, ${glowOp.toFixed(2)})`);

                // Wipe-reveal the AUC band in sync with the playhead
                bandClipRect.setAttribute('width', (playheadX - PHASE_CHART.padL).toFixed(1));

                // Morph Lx STROKES + FILLS
                const overlayCurves: any[] = [];
                for (let ci = 0; ci < curvesData.length; ci++) {
                    const morphed = buildProgressiveMorphPoints(
                        sourcePts[ci],
                        targetPts[ci],
                        playheadHour,
                        BLEND_WIDTH,
                    );
                    const strokeD = phasePointsToPath(morphed, true);
                    if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                    if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
                    overlayCurves.push({
                        ...snapshot.lxCurves[ci],
                        points: morphed,
                    });
                }
                updateGamificationCurveData(overlayCurves);
                setStackingBarSweepProgress(rawT, playheadHour, k);

                // --- Push chevron: trace the curve that changes the most ---
                const ci = bestCurveIdx;
                const morphed = buildProgressiveMorphPoints(sourcePts[ci], targetPts[ci], playheadHour, BLEND_WIDTH);
                const morphedVal = interpolatePointsAtTime(morphed, playheadHour);
                const curveY = phaseChartY(morphedVal);

                const srcVal = interpolatePointsAtTime(sourcePts[ci], playheadHour);
                const tgtVal = interpolatePointsAtTime(targetPts[ci], playheadHour);
                const bestDelta = Math.abs(tgtVal - srcVal);
                const bestPushDown = tgtVal < srcVal;
                const chevronColor = step[0].substance?.color || curvesData[ci].color || '#f5c850';

                // Tip of chevron path is at (0, 2). Place center so tip touches curve.
                // scaleY=1: tip at center+2 → center = curveY - 2
                // scaleY=-1: tip at center-2 → center = curveY + 2
                const flipY = bestPushDown ? 1 : -1;
                const chevY = flipY === 1 ? curveY - 2 : curveY + 2;

                // No change: faded. Peak change: brightest of its color.
                const intensity = Math.min(1, bestDelta / 3);
                chevronGroup.setAttribute('opacity', '1');

                let brightColor = chevronColor;
                if (chevronColor.startsWith('#')) {
                    const hex = chevronColor.slice(1);
                    const r = parseInt(hex.substring(0, 2), 16) || 245;
                    const g = parseInt(hex.substring(2, 4), 16) || 200;
                    const b = parseInt(hex.substring(4, 6), 16) || 80;
                    const max = Math.max(r, g, b, 1);
                    const scale = 255 / max;
                    const br = Math.round(r + (r * scale - r) * intensity);
                    const bg = Math.round(g + (g * scale - g) * intensity);
                    const bb = Math.round(b + (b * scale - b) * intensity);
                    brightColor = `rgb(${br},${bg},${bb})`;
                } else if (chevronColor.startsWith('rgb')) {
                    const m = chevronColor.match(/[\d.]+/g);
                    if (m && m.length >= 3) {
                        const r = Math.round(+m[0]),
                            g = Math.round(+m[1]),
                            b = Math.round(+m[2]);
                        const max = Math.max(r, g, b, 1);
                        const scale = 255 / max;
                        const br = Math.round(r + (r * scale - r) * intensity);
                        const bg = Math.round(g + (g * scale - g) * intensity);
                        const bb = Math.round(b + (b * scale - b) * intensity);
                        brightColor = `rgb(${br},${bg},${bb})`;
                    }
                }

                chevFill.setAttribute('fill', brightColor);
                chevFill.setAttribute('fill-opacity', (0.38 + intensity * 0.62).toFixed(2));

                chevronGroup.setAttribute(
                    'transform',
                    `translate(${playheadX.toFixed(1)}, ${chevY.toFixed(1)}) scale(1, ${flipY})`,
                );

                // Secondary chevron: faint unless serious motion on that curve
                if (chevron2Group && chevFill2 && secondCurveIdx != null) {
                    const c2 = secondCurveIdx;
                    const c2Morphed = buildProgressiveMorphPoints(
                        sourcePts[c2],
                        targetPts[c2],
                        playheadHour,
                        BLEND_WIDTH,
                    );
                    const c2MorphedVal = interpolatePointsAtTime(c2Morphed, playheadHour);
                    const c2CurveY = phaseChartY(c2MorphedVal);
                    const c2SrcVal = interpolatePointsAtTime(sourcePts[c2], playheadHour);
                    const c2TgtVal = interpolatePointsAtTime(targetPts[c2], playheadHour);
                    const c2Delta = Math.abs(c2TgtVal - c2SrcVal);
                    const c2PushDown = c2TgtVal < c2SrcVal;
                    const c2FlipY = c2PushDown ? 1 : -1;
                    const c2ChevY = c2FlipY === 1 ? c2CurveY - 2 : c2CurveY + 2;

                    const c2Intensity = Math.min(1, c2Delta / 6);
                    const c2Opacity = (0.06 + c2Intensity * 0.42).toFixed(2);
                    chevFill2.setAttribute('fill-opacity', c2Opacity);
                    chevron2Group.setAttribute(
                        'transform',
                        `translate(${playheadX.toFixed(1)}, ${c2ChevY.toFixed(1)}) scale(1, ${c2FlipY})`,
                    );
                }

                if (rawT < 1) {
                    requestAnimationFrame(tick);
                } else {
                    for (let ci = 0; ci < curvesData.length; ci++) {
                        const strokeD = phasePointsToPath(targetPts[ci], true);
                        if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                        if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(targetPts[ci], true));
                    }
                    updateGamificationCurveData(snapshot.lxCurves);
                    setStackingBarSweepProgress(1, PHASE_CHART.endHour, k);
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
            duration: 200,
            fill: 'forwards',
        });
        setTimeout(() => labelEl.remove(), 250);

        // (No longer hiding the beat; the stacked Waze cards remain visible and accumulate)

        // (Pacing between steps is handled by awaitLxStep at the top of the loop)
    }

    // Hide step controls now that all substances are revealed
    hideLxStepControls();

    // If the narration returned extra beats (model mismatch), continue
    // advancing cards so Sherlock does not appear "stuck" mid-stack.
    const beatCount = Array.isArray(narration?.beats) ? narration!.beats.length : 0;
    if (cards.length > 0 && beatCount > snapshots.length) {
        for (let i = snapshots.length; i < beatCount; i++) {
            if (hasSherlockBeat(i)) {
                showSherlockStack(cards, i);
                await sleep(850);
            }
        }
    }

    // Show Sherlock narration outro — stays visible until next user interaction
    if (narration?.outro && cards.length > 0) {
        showSherlockStack(cards, cards.length - 1);
    }

    // Once forward narration is complete, switch to scroll mode.
    if (cards.length > 0) {
        enableSherlockScrollMode();
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
// AUC BAND <-> TIMELINE PILL HOVER WIRING
// ============================================

function clearBandHoverClasses() {
    document.querySelectorAll('.lx-auc-band.band-dim, .lx-auc-band.band-highlight').forEach(el => {
        el.classList.remove('band-dim', 'band-highlight');
    });
    document.querySelectorAll('.timeline-pill-group.pill-dim, .timeline-pill-group.pill-highlight').forEach(el => {
        el.classList.remove('pill-dim', 'pill-highlight');
    });
}

export function attachBandHoverListeners() {
    const bands = document.querySelectorAll('.lx-auc-band');
    const pills = document.querySelectorAll('.timeline-pill-group');

    const parseCurveFromEl = (el: Element): number | null => {
        const raw = el.getAttribute('data-curve-idx');
        if (raw != null && raw !== '') {
            const parsed = parseInt(raw, 10);
            if (!isNaN(parsed) && parsed >= 0) return parsed;
        }
        const marker = el.querySelector('.timeline-curve-dot, .timeline-connector');
        const markerRaw = marker?.getAttribute('data-curve-idx');
        if (markerRaw != null && markerRaw !== '') {
            const parsed = parseInt(markerRaw, 10);
            if (!isNaN(parsed) && parsed >= 0) return parsed;
        }
        return null;
    };

    const parseTimeFromEl = (el: Element): number | null => {
        const raw = el.getAttribute('data-time-minutes');
        if (raw != null && raw !== '') {
            const parsed = parseFloat(raw);
            if (isFinite(parsed)) return parsed;
        }
        return null;
    };

    const onEntityClick = (el: Element) => {
        const substanceKey = el.getAttribute('data-substance-key');
        const curveIdx = parseCurveFromEl(el);
        const timeMinutes = parseTimeFromEl(el);
        // Clicking should immediately hand control back to Sherlock center-sync,
        // so the auto-scrolled card becomes undimmed without requiring mouseleave.
        setSherlockHoverLock(false);
        scrollSherlockCardToCenter({ substanceKey, curveIdx, timeMinutes });
    };

    bands.forEach(band => {
        band.addEventListener('mouseenter', () => {
            setSherlockHoverLock(true);
            const key = band.getAttribute('data-substance-key');
            bands.forEach(b => {
                if (b.getAttribute('data-substance-key') === key) {
                    b.classList.add('band-highlight');
                } else {
                    b.classList.add('band-dim');
                }
            });
            pills.forEach(p => {
                if (p.getAttribute('data-substance-key') === key) {
                    p.classList.add('pill-highlight');
                } else {
                    p.classList.add('pill-dim');
                }
            });
        });
        band.addEventListener('click', () => onEntityClick(band));
        band.addEventListener('mouseleave', () => {
            clearBandHoverClasses();
            setSherlockHoverLock(false);
        });
    });

    pills.forEach(pill => {
        pill.addEventListener('mouseenter', () => {
            setSherlockHoverLock(true);
            const key = pill.getAttribute('data-substance-key');
            bands.forEach(b => {
                if (b.getAttribute('data-substance-key') === key) {
                    b.classList.add('band-highlight');
                } else {
                    b.classList.add('band-dim');
                }
            });
            pills.forEach(p => {
                if (p.getAttribute('data-substance-key') === key) {
                    p.classList.add('pill-highlight');
                } else {
                    p.classList.add('pill-dim');
                }
            });
        });
        pill.addEventListener('click', () => onEntityClick(pill));
        pill.addEventListener('mouseleave', () => {
            clearBandHoverClasses();
            setSherlockHoverLock(false);
        });
    });
}
