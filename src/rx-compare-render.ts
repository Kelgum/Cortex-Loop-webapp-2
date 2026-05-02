/**
 * Rx Compare Render — side-by-side Lx-vs-Rx panel for investor demos.
 *
 * Matches the primary phase-chart's geometry exactly (same 1120×500
 * viewBox) so the two views are directly comparable.
 *
 * Animation parity with Lx: the path elements (baseline, desired, Rx
 * overlay fill + stroke) are built ONCE. When the 7-day sequence advances
 * MultiDayState.currentDay, only the `d` attributes are animated — via
 * the Web Animations API — between the old day's shape and the new day's.
 * That avoids DOM rebuild snap-jumps and keeps Rx visually in step with
 * Lx's own morph animation on the adjacent panel. Pill positions are
 * identical every day for Rx (that's the point of "no adaptation"), so
 * the pill lane is rebuilt only on explicit re-render.
 */
import { PHASE_CHART } from './constants';
import {
    phasePointsToPath,
    phasePointsToFillPath,
    interpolatePointArrays,
    smoothPhaseValues,
} from './curve-utils';
import { PHASE_SMOOTH_PASSES } from './constants';
import { SUBSTANCE_DB } from './substances';
import { svgEl, phaseChartX, phaseChartY, chartTheme } from './utils';
import { computeEffectImprovement } from './gamification-overlay';
import type { CurveData, DaySnapshot, Intervention, LxCurve } from './types';
import type { RxSocTwin } from './rx-soc-transform';

const COMPARE_PANEL_ID = 'rx-compare-panel';
const COMPARE_SVG_ID = 'rx-compare-svg';
const COMPARE_BODY_CLASS = 'compare-mode';

/**
 * Fired by the "↻ re-prescribe" button inside the compare panel. main.ts
 * listens for it and invokes `requestRxTwinRegenerate` — a window event is
 * used instead of a direct import to avoid a rx-compare-render ↔ main.ts
 * circular dependency.
 */
export const RX_TWIN_REGENERATE_EVENT = 'lx-studio-rx-twin-regenerate';

const CURVE_MORPH_DURATION_MS = 650;

// Vertical space reserved below the plot for the pill lane(s). Matches
// Lx's substance-timeline height on the adjacent panel so both columns
// have a similar overall aspect.
const PILL_AREA_HEIGHT = 80;
const COMPARE_VIEW_H = PHASE_CHART.viewH + PILL_AREA_HEIGHT;

interface CurvePathRefs {
    baseline: SVGPathElement;
    desired: SVGPathElement;
    lxFill: SVGPathElement;
    lxStroke: SVGPathElement;
}

interface ScoreBoxRefs {
    group: SVGGElement;
    title: SVGTextElement;
    pct: SVGTextElement;
    sub: SVGTextElement;
}

interface GapIndicatorRefs {
    horizLine: SVGLineElement;
    dropLine: SVGLineElement;
    lxDot: SVGCircleElement;
    rxDot: SVGCircleElement;
    label: SVGTextElement;
}

interface CompareRenderContext {
    twin: RxSocTwin;
    curvesData: CurveData[];
    multiDayDays: DaySnapshot[] | null;
    currentDayIdx: number;
    curvePathsByEffect: CurvePathRefs[];
    scoreBoxesByEffect: ScoreBoxRefs[];
    gapIndicatorsByEffect: GapIndicatorRefs[];
    lastPathD: { baseline: string[]; desired: string[]; lxFill: string[]; lxStroke: string[] };
}

let _ctx: CompareRenderContext | null = null;

function ensureHostContainer(): HTMLElement | null {
    return document.getElementById('phase-chart-container');
}

function curvesForDay(ctx: CompareRenderContext, dayIdx: number): CurveData[] {
    const { multiDayDays, curvesData } = ctx;
    if (!multiDayDays || multiDayDays.length === 0) return curvesData;
    const day = multiDayDays[Math.min(dayIdx, multiDayDays.length - 1)];
    // Use postInterventionBaseline — the exact same source the Lx panel
    // renders (multi-day-animation.ts:475). The Rx overlay in twin.lxCurves7D
    // is also computed against PIB (see rx-soc-transform.ts) so the thick Rx
    // stroke sits directly on top of this baseline with the delta being the
    // intervention effect. Fall back to bioCorrectedBaseline, then canonical.
    return curvesData.map((c, i) => ({
        ...c,
        baseline:
            day?.postInterventionBaseline?.[i]?.length
                ? day.postInterventionBaseline[i]
                : day?.bioCorrectedBaseline?.[i] || c.baseline,
        desired: day?.desiredCurves?.[i] || c.desired,
    }));
}

function lxCurvesForDay(ctx: CompareRenderContext, dayIdx: number): LxCurve[] {
    const { twin } = ctx;
    const idx = Math.min(dayIdx, twin.lxCurves7D.length - 1);
    return twin.lxCurves7D[idx] || [];
}

function buildAxes(): SVGGElement {
    const t = chartTheme();
    const g = svgEl('g', { id: 'rx-compare-axes' }) as SVGGElement;
    g.appendChild(
        svgEl('rect', {
            x: String(PHASE_CHART.padL),
            y: String(PHASE_CHART.padT),
            width: String(PHASE_CHART.plotW),
            height: String(PHASE_CHART.plotH),
            fill: 'none',
            stroke: t.axisBoundary,
            'stroke-width': '0.75',
            opacity: '0.5',
        }),
    );
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 4) {
        const x = phaseChartX(h * 60);
        g.appendChild(
            svgEl('line', {
                x1: String(x),
                x2: String(x),
                y1: String(PHASE_CHART.padT + PHASE_CHART.plotH),
                y2: String(PHASE_CHART.padT + PHASE_CHART.plotH + 5),
                stroke: t.axisLine,
                'stroke-width': '0.75',
            }),
        );
        const label = svgEl('text', {
            x: String(x),
            y: String(PHASE_CHART.padT + PHASE_CHART.plotH + 18),
            fill: t.labelNormal,
            'font-size': '10',
            'font-family': 'IBM Plex Mono, monospace',
            'text-anchor': 'middle',
        });
        label.textContent = `${h % 24}h`;
        g.appendChild(label);
    }
    for (const v of [0, 50, 100]) {
        const y = phaseChartY(v);
        g.appendChild(
            svgEl('line', {
                x1: String(PHASE_CHART.padL),
                x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
                y1: String(y),
                y2: String(y),
                stroke: t.grid,
                'stroke-width': '0.5',
                'stroke-dasharray': '2,3',
            }),
        );
    }
    return g;
}

function computePathData(
    ctx: CompareRenderContext,
    dayIdx: number,
): { baseline: string[]; desired: string[]; lxFill: string[]; lxStroke: string[] } {
    const curves = curvesForDay(ctx, dayIdx);
    const lx = lxCurvesForDay(ctx, dayIdx);
    const result = { baseline: [] as string[], desired: [] as string[], lxFill: [] as string[], lxStroke: [] as string[] };
    for (let i = 0; i < curves.length; i++) {
        const c = curves[i];
        // Baseline/desired come from the day snapshot as raw (unsmoothed) arrays —
        // pass alreadySmoothed=false so phasePointsToPath applies the smoothing pass.
        result.baseline.push(phasePointsToPath(c.baseline || [], false) || '');
        result.desired.push(phasePointsToPath(c.desired || [], false) || '');
        // Rx overlay points come from computeLxOverlay, which produces them from
        // PRE-SMOOTHED baselines (see lx-compute.ts: lx.baseline = info.blSmoothed).
        // Pass alreadySmoothed=true — otherwise the smoothing pass runs a SECOND
        // time and the Rx stroke deforms vs. the Lx stroke on the adjacent panel.
        const lxCurve = lx[i];
        result.lxFill.push(lxCurve?.points?.length ? phasePointsToFillPath(lxCurve.points, true) || '' : '');
        result.lxStroke.push(lxCurve?.points?.length ? phasePointsToPath(lxCurve.points, true) || '' : '');
    }
    return result;
}

function buildCurvePaths(ctx: CompareRenderContext): SVGGElement {
    const g = svgEl('g', { id: 'rx-compare-curves' }) as SVGGElement;
    const initialD = computePathData(ctx, ctx.currentDayIdx);
    ctx.lastPathD = initialD;
    ctx.curvePathsByEffect = [];

    for (let i = 0; i < ctx.curvesData.length; i++) {
        const color = ctx.curvesData[i].color || '#60a5fa';

        const baseline = svgEl('path', {
            d: initialD.baseline[i] || '',
            fill: 'none',
            stroke: color,
            'stroke-width': '1',
            'stroke-dasharray': '4,4',
            opacity: '0.45',
        }) as SVGPathElement;
        const desired = svgEl('path', {
            d: initialD.desired[i] || '',
            fill: 'none',
            stroke: color,
            'stroke-width': '1.25',
            'stroke-dasharray': '1,3',
            opacity: '0.6',
        }) as SVGPathElement;
        const lxFill = svgEl('path', {
            d: initialD.lxFill[i] || '',
            fill: color,
            opacity: '0.12',
        }) as SVGPathElement;
        const lxStroke = svgEl('path', {
            d: initialD.lxStroke[i] || '',
            fill: 'none',
            stroke: color,
            'stroke-width': '2.5',
            opacity: '0.95',
        }) as SVGPathElement;

        g.appendChild(baseline);
        g.appendChild(desired);
        g.appendChild(lxFill);
        g.appendChild(lxStroke);

        ctx.curvePathsByEffect.push({ baseline, desired, lxFill, lxStroke });
    }
    return g;
}

/**
 * Per-curve peak improvement scores computed with the EXACT same formula
 * and inputs the Lx gamification box uses (gamification-overlay.ts:781):
 * substance overlay `points` vs the smoothed `lx.baseline` stashed on the
 * LxCurve by computeLxOverlay. That's the only way Rx and Lx numbers are
 * apples-to-apples comparable.
 *
 * Returns {rx, lx} per curve so the Rx box can show the signed gap.
 */
function computePeakPairsForDay(
    ctx: CompareRenderContext,
    dayIdx: number,
): { rx: number | null; lx: number | null }[] {
    const curves = curvesForDay(ctx, dayIdx);
    const rxLx = lxCurvesForDay(ctx, dayIdx);
    const day = ctx.multiDayDays?.[Math.min(dayIdx, (ctx.multiDayDays?.length || 1) - 1)];
    return curves.map((c, i) => {
        const rxCurve = rxLx[i];
        const rxBaseline = rxCurve?.baseline ?? c.baseline;
        const rx =
            rxCurve?.points?.length && rxBaseline?.length
                ? computeEffectImprovement(rxCurve.points, rxBaseline, c.desired || [], c.polarity)
                : null;
        const lxLive = day?.lxCurves?.[i];
        const lxBaseline = lxLive?.baseline ?? c.baseline;
        const lx =
            lxLive?.points?.length && lxBaseline?.length
                ? computeEffectImprovement(lxLive.points, lxBaseline, c.desired || [], c.polarity)
                : null;
        return { rx, lx };
    });
}

/**
 * Format the Rx box the same way the Lx gamification box formats its
 * number: render the signed vertical-slice % at the intervention's Cmax
 * (computed by computeEffectImprovement), preserving sign so Rx that sits
 * below baseline on a higher-is-better curve reads negative.
 */
function formatDelta(rx: number | null, _lx: number | null, _polarity: string | undefined): string {
    if (rx == null || !Number.isFinite(rx)) return '\u2014';
    const n = Math.round(rx);
    if (n === 0) return '0%';
    return n > 0 ? `+${n}%` : `\u2212${Math.abs(n)}%`;
}

function buildScoreBoxes(ctx: CompareRenderContext): SVGGElement {
    const g = svgEl('g', { id: 'rx-compare-score-boxes' }) as SVGGElement;
    ctx.scoreBoxesByEffect = [];

    // Match Lx gamification box dimensions (gamification-overlay.ts BOX_W/BOX_H)
    // so the stacked pair across the divider is visually a 1:1 mirror.
    const BOX_W = 240;
    const BOX_H = 100;
    const BOX_RX = 12;
    const GAP = 12;
    const theme = chartTheme();
    // Magnetize flush against the SVG's left edge — as close to the divider
    // (and therefore to the Lx box on the adjacent panel) as possible.
    // Breaches the plot's padL margin intentionally, per Perry: "don't be
    // bothered by breaching the bounds of the plots."
    const baseX = 2;
    const baseY = PHASE_CHART.padT + 12;
    const pairs = computePeakPairsForDay(ctx, ctx.currentDayIdx);

    for (let i = 0; i < ctx.curvesData.length; i++) {
        const c = ctx.curvesData[i];
        const boxX = baseX;
        const boxY = baseY + i * (BOX_H + GAP);
        const group = svgEl('g', { transform: `translate(${boxX}, ${boxY})` }) as SVGGElement;

        group.appendChild(
            svgEl('rect', {
                x: '0',
                y: '0',
                width: String(BOX_W),
                height: String(BOX_H),
                rx: String(BOX_RX),
                ry: String(BOX_RX),
                fill: theme.tooltipBg,
                stroke: 'rgba(255, 107, 107, 0.35)',
                'stroke-width': '1',
                opacity: '0.94',
            }),
        );

        const title = svgEl('text', {
            x: '14',
            y: '24',
            'font-size': '12',
            'font-weight': '600',
            'font-family': "'Space Grotesk', sans-serif",
            'letter-spacing': '0.5',
            fill: c.color || '#60a5fa',
        }) as SVGTextElement;
        title.textContent = (c.effect || `Effect ${i + 1}`).toUpperCase();
        group.appendChild(title);

        const pct = svgEl('text', {
            x: '14',
            y: '58',
            'font-size': '26',
            'font-weight': '700',
            'font-family': "'IBM Plex Mono', monospace",
            fill: theme.labelAnchor || '#e2e8f0',
        }) as SVGTextElement;
        pct.textContent = formatDelta(pairs[i]?.rx ?? null, pairs[i]?.lx ?? null, c.polarity);
        group.appendChild(pct);

        const sub = svgEl('text', {
            x: '14',
            y: '78',
            'font-size': '10',
            'font-family': "'Space Grotesk', sans-serif",
            opacity: '0.7',
            fill: theme.labelNormal,
        }) as SVGTextElement;
        sub.textContent = 'Rx vs Lx · peak';
        group.appendChild(sub);

        g.appendChild(group);
        ctx.scoreBoxesByEffect.push({ group, title, pct, sub });
    }
    return g;
}

function updateScoreBoxes(ctx: CompareRenderContext, dayIdx: number): void {
    const pairs = computePeakPairsForDay(ctx, dayIdx);
    for (let i = 0; i < ctx.scoreBoxesByEffect.length; i++) {
        const refs = ctx.scoreBoxesByEffect[i];
        const next = formatDelta(pairs[i]?.rx ?? null, pairs[i]?.lx ?? null, ctx.curvesData[i]?.polarity);
        if (refs.pct.textContent === next) continue;
        refs.pct.textContent = next;
        refs.pct.animate(
            [{ opacity: 0.25 }, { opacity: 1 }],
            { duration: 450, easing: 'ease-out', fill: 'forwards' },
        );
    }
}

function findPeak(points: { hour: number; value: number }[] | undefined):
    | { hour: number; value: number; idx: number }
    | null {
    if (!points?.length) return null;
    let best = { hour: 0, value: -Infinity, idx: 0 };
    for (let i = 0; i < points.length; i++) {
        const v = points[i]?.value;
        if (v == null) continue;
        if (v > best.value) best = { hour: points[i].hour, value: v, idx: i };
    }
    return best.value === -Infinity ? null : best;
}

/**
 * Build a per-curve gap indicator that stretches a dotted line from the
 * Lx curve's peak level down to the Rx curve's actual peak, so investors
 * can see the shortfall visually: "Lx would've reached here — Rx only
 * got this far."
 *
 * Shape:
 *   ┌────── Lx peak Y ──────┐   (horizontal dotted, across the plot)
 *                    │         (vertical dotted from Lx-peak Y down)
 *                    ●         (dot on Rx peak)
 */
function buildGapIndicators(ctx: CompareRenderContext): SVGGElement {
    const g = svgEl('g', { id: 'rx-compare-gap-indicators' }) as SVGGElement;
    ctx.gapIndicatorsByEffect = [];

    for (let i = 0; i < ctx.curvesData.length; i++) {
        const color = ctx.curvesData[i].color || '#60a5fa';

        const horizLine = svgEl('line', {
            x1: '0', y1: '0', x2: '0', y2: '0',
            stroke: color,
            'stroke-width': '1.25',
            'stroke-dasharray': '3,4',
            opacity: '0.55',
            'pointer-events': 'none',
        }) as SVGLineElement;
        const dropLine = svgEl('line', {
            x1: '0', y1: '0', x2: '0', y2: '0',
            stroke: color,
            'stroke-width': '1.25',
            'stroke-dasharray': '3,4',
            opacity: '0.55',
            'pointer-events': 'none',
        }) as SVGLineElement;
        const lxDot = svgEl('circle', {
            cx: '0', cy: '0', r: '3.5',
            fill: 'none',
            stroke: color,
            'stroke-width': '1.5',
            opacity: '0.75',
            'pointer-events': 'none',
        }) as SVGCircleElement;
        const rxDot = svgEl('circle', {
            cx: '0', cy: '0', r: '3.5',
            fill: color,
            opacity: '0.95',
            'pointer-events': 'none',
        }) as SVGCircleElement;
        const label = svgEl('text', {
            x: '0', y: '0',
            fill: color,
            'font-size': '9.5',
            'font-family': "'IBM Plex Mono', monospace",
            'font-weight': '600',
            'text-anchor': 'middle',
            opacity: '0.8',
            'pointer-events': 'none',
        }) as SVGTextElement;
        label.textContent = '';

        g.appendChild(horizLine);
        g.appendChild(dropLine);
        g.appendChild(lxDot);
        g.appendChild(rxDot);
        g.appendChild(label);
        ctx.gapIndicatorsByEffect.push({ horizLine, dropLine, lxDot, rxDot, label });
    }
    return g;
}

function updateGapIndicators(ctx: CompareRenderContext, dayIdx: number): void {
    const lx = lxCurvesForDay(ctx, dayIdx);
    const day = ctx.multiDayDays?.[Math.min(dayIdx, (ctx.multiDayDays?.length || 1) - 1)];

    for (let i = 0; i < ctx.gapIndicatorsByEffect.length; i++) {
        const refs = ctx.gapIndicatorsByEffect[i];
        // Lx peak: prefer the live Lx run's actual overlay (what the user
        // sees on the adjacent panel) over any stand-in. Falls back to the
        // desired curve if no Lx data (shows what Lx would have aimed for).
        const lxLive = day?.lxCurves?.[i]?.points || null;
        const lxFallback = ctx.curvesData[i]?.desired || null;
        const lxPeak = findPeak(lxLive || lxFallback);
        const rxPeak = findPeak(lx[i]?.points);

        if (!lxPeak || !rxPeak || lxPeak.value <= rxPeak.value) {
            // Rx reaches Lx (or no data): hide the gap indicator — no
            // shortfall to visualize.
            refs.horizLine.setAttribute('opacity', '0');
            refs.dropLine.setAttribute('opacity', '0');
            refs.lxDot.setAttribute('opacity', '0');
            refs.rxDot.setAttribute('opacity', '0');
            refs.label.setAttribute('opacity', '0');
            continue;
        }

        const lxY = phaseChartY(lxPeak.value);
        const rxY = phaseChartY(rxPeak.value);
        const lxX = phaseChartX(lxPeak.hour * 60);
        const rxX = phaseChartX(rxPeak.hour * 60);

        refs.horizLine.setAttribute('x1', String(PHASE_CHART.padL));
        refs.horizLine.setAttribute('x2', String(PHASE_CHART.padL + PHASE_CHART.plotW));
        refs.horizLine.setAttribute('y1', String(lxY));
        refs.horizLine.setAttribute('y2', String(lxY));
        refs.horizLine.setAttribute('opacity', '0.5');

        refs.dropLine.setAttribute('x1', String(rxX));
        refs.dropLine.setAttribute('x2', String(rxX));
        refs.dropLine.setAttribute('y1', String(lxY));
        refs.dropLine.setAttribute('y2', String(rxY));
        refs.dropLine.setAttribute('opacity', '0.7');

        refs.lxDot.setAttribute('cx', String(lxX));
        refs.lxDot.setAttribute('cy', String(lxY));
        refs.lxDot.setAttribute('opacity', '0.75');

        refs.rxDot.setAttribute('cx', String(rxX));
        refs.rxDot.setAttribute('cy', String(rxY));
        refs.rxDot.setAttribute('opacity', '0.95');

        const deltaPts = Math.round(lxPeak.value - rxPeak.value);
        refs.label.textContent = `−${deltaPts} pts`;
        // Place label mid-drop, offset right so it doesn't overlap the line.
        refs.label.setAttribute('x', String(rxX + 30));
        refs.label.setAttribute('y', String((lxY + rxY) / 2 + 4));
        refs.label.setAttribute('opacity', '0.85');
    }
}

function buildPills(interventions: Intervention[]): SVGGElement {
    const g = svgEl('g', { id: 'rx-compare-pills' }) as SVGGElement;
    // Place pills in the dedicated area below the plot so they don't clip.
    const baseY = PHASE_CHART.viewH + 10;
    const pillH = 18;
    const laneGap = 4;

    // Simple greedy lane allocation — overlapping pills stack vertically so
    // both Vyvanse and Magnesium at 08:00 stay readable.
    type Allotted = { iv: Intervention; lane: number; x0: number; x1: number; width: number; cx: number };
    const allotted: Allotted[] = [];
    const laneEnds: number[] = [];
    for (const iv of interventions) {
        const sub = iv.substance || SUBSTANCE_DB[iv.key];
        const name = sub?.name || iv.key;
        const text = `${name} · ${iv.dose}`;
        const width = Math.max(80, text.length * 6.2);
        const cx = phaseChartX(iv.timeMinutes);
        const x0 = cx - width / 2;
        const x1 = cx + width / 2;
        let lane = 0;
        while (lane < laneEnds.length && laneEnds[lane] > x0) lane++;
        if (lane === laneEnds.length) laneEnds.push(0);
        laneEnds[lane] = x1 + 4;
        allotted.push({ iv, lane, x0, x1, width, cx });
    }

    for (const a of allotted) {
        const sub = a.iv.substance || SUBSTANCE_DB[a.iv.key];
        const color = sub?.color || '#94a3b8';
        const name = sub?.name || a.iv.key;
        const text = `${name} · ${a.iv.dose}`;
        const y = baseY + a.lane * (pillH + laneGap);
        g.appendChild(
            svgEl('rect', {
                x: String(a.x0),
                y: String(y),
                width: String(a.width),
                height: String(pillH),
                rx: '9',
                fill: color,
                opacity: '0.9',
            }),
        );
        const label = svgEl('text', {
            x: String(a.cx),
            y: String(y + 12),
            fill: '#0b131f',
            'font-size': '10',
            'font-weight': '600',
            'font-family': 'IBM Plex Mono, monospace',
            'text-anchor': 'middle',
        });
        label.textContent = text;
        g.appendChild(label);
    }
    return g;
}

/**
 * Animate a path from its current d to a target d using Web Animations
 * API. Falls back to immediate attribute swap if the browser doesn't
 * support animating `d` or if either string is empty.
 */
function morphPath(el: SVGPathElement, fromD: string, toD: string, durationMs: number): void {
    if (!toD) {
        el.setAttribute('d', '');
        return;
    }
    if (!fromD || fromD === toD) {
        el.setAttribute('d', toD);
        return;
    }
    try {
        const anim = el.animate(
            [{ d: `path("${fromD}")` }, { d: `path("${toD}")` }],
            { duration: durationMs, easing: 'ease-out', fill: 'forwards' },
        );
        anim.onfinish = () => el.setAttribute('d', toD);
        anim.oncancel = () => el.setAttribute('d', toD);
    } catch {
        el.setAttribute('d', toD);
    }
}

/**
 * Build the narrative header strip: shows the LLM-provided condition label
 * + one-line clinician narrative, a "SOC heuristic" chip when the
 * deterministic fallback was used, and a "↻ re-prescribe" button that
 * dispatches `RX_TWIN_REGENERATE_EVENT` on the window.
 */
function buildCompareHeader(twin: RxSocTwin): HTMLElement | null {
    const hasNarrative = typeof twin.narrative === 'string' && twin.narrative.length > 0;
    const hasFallback = !!twin.socrxFallbackReason;
    // Render the regenerate button even with no narrative so the user can
    // always re-ask SOCRx from a deterministic fallback twin.

    const header = document.createElement('div');
    header.className = 'rx-compare-header';

    const text = document.createElement('div');
    text.className = 'rx-compare-header-text';
    if (hasNarrative) {
        const narr = document.createElement('div');
        narr.className = 'rx-compare-header-narrative';
        narr.textContent = twin.narrative!;
        text.appendChild(narr);
    }
    if (hasFallback) {
        const chip = document.createElement('span');
        chip.className = 'rx-compare-header-chip';
        chip.textContent = 'SOC heuristic';
        chip.title =
            twin.socrxFallbackReason === 'llm_unavailable'
                ? 'LLM unavailable — deterministic SOC fallback'
                : 'LLM produced no valid picks — deterministic SOC fallback';
        text.appendChild(chip);
    }
    header.appendChild(text);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'rx-twin-regen-btn';
    btn.className = 'rx-compare-header-regen';
    btn.title = 'Ask SOCRx to re-prescribe';
    btn.setAttribute('aria-label', 'Re-prescribe');
    btn.textContent = '\u21bb';
    btn.addEventListener('click', () => {
        try {
            window.dispatchEvent(new CustomEvent(RX_TWIN_REGENERATE_EVENT));
        } catch {
            // Event dispatch can't actually fail in the browser environment we target.
        }
    });
    header.appendChild(btn);

    return header;
}

export function renderCompareView(
    twin: RxSocTwin,
    curvesData: CurveData[],
    multiDayDays: DaySnapshot[] | null = null,
    currentDayIdx = 0,
): void {
    clearCompareView();
    const host = ensureHostContainer();
    if (!host) return;

    _ctx = {
        twin,
        curvesData,
        multiDayDays,
        currentDayIdx: Math.max(0, currentDayIdx),
        curvePathsByEffect: [],
        scoreBoxesByEffect: [],
        gapIndicatorsByEffect: [],
        lastPathD: { baseline: [], desired: [], lxFill: [], lxStroke: [] },
    };

    const panel = document.createElement('div');
    panel.id = COMPARE_PANEL_ID;
    panel.className = 'rx-compare-panel';

    const wrap = document.createElement('div');
    wrap.className = 'rx-compare-svg-wrap';
    panel.appendChild(wrap);

    // Narrative header sits BELOW the SVG, positioned absolutely to align
    // vertically with the VCR control panel on the Lx side (`top: calc(100% + 16px)`
    // on .vcr-control-panel) so the two panels feel like mirrors.
    const header = buildCompareHeader(twin);
    if (header) panel.appendChild(header);

    host.appendChild(panel);

    const svg = svgEl('svg', {
        id: COMPARE_SVG_ID,
        viewBox: `0 0 ${PHASE_CHART.viewW} ${COMPARE_VIEW_H}`,
        preserveAspectRatio: 'xMidYMin meet',
    }) as SVGSVGElement;
    svg.appendChild(buildAxes());
    svg.appendChild(buildCurvePaths(_ctx));
    // Gap indicators layer above curves so the dashed ceiling reads clearly.
    const gapGroup = buildGapIndicators(_ctx);
    svg.appendChild(gapGroup);
    updateGapIndicators(_ctx, _ctx.currentDayIdx);
    // Score boxes ride on top of everything else.
    svg.appendChild(buildScoreBoxes(_ctx));
    const day0Interventions = twin.interventions7D?.[_ctx.currentDayIdx] || twin.interventions7D?.[0] || [];
    svg.appendChild(buildPills(day0Interventions));
    wrap.appendChild(svg);

    document.body.classList.add(COMPARE_BODY_CLASS);

    // Align the narrative header vertically with the VCR on the Lx side.
    // The Lx side has its own biometric strip nested inside phase-svg-wrapper
    // so its bottom sits lower than the Rx SVG's; the VCR hangs 16px below
    // that. We measure VCR's actual top (in rx-compare-panel coordinates)
    // and set --rx-header-top so the CSS rule can pin the header there.
    if (header) alignHeaderToVcr(panel, header);
}

function alignHeaderToVcr(panel: HTMLElement, header: HTMLElement): void {
    const apply = () => {
        const vcr = document.querySelector('.vcr-control-panel') as HTMLElement | null;
        if (!vcr) return;
        const panelRect = panel.getBoundingClientRect();
        const vcrRect = vcr.getBoundingClientRect();
        // Offset from the panel's own top, minus the default top:100% anchor,
        // leaves the delta to push the header down to match the VCR's top.
        const topOffsetPx = Math.max(16, vcrRect.top - panelRect.bottom);
        header.style.setProperty('--rx-header-top-offset', `${topOffsetPx}px`);
    };
    apply();
    // Re-align on next frame in case layout is still settling.
    requestAnimationFrame(apply);
}

/**
 * Morph the Rx curves smoothly to the given day's state. Path elements
 * stay in the DOM; only their `d` attributes animate. Pills stay static
 * — Rx interventions don't change day-to-day (that's the whole point).
 */
export function updateCompareViewDay(dayIdx: number): void {
    if (!_ctx) return;
    const panel = document.getElementById(COMPARE_PANEL_ID);
    if (!panel) return;

    const clamped = Math.max(0, dayIdx | 0);
    if (clamped === _ctx.currentDayIdx) return;
    _ctx.currentDayIdx = clamped;

    const newD = computePathData(_ctx, clamped);
    const prev = _ctx.lastPathD;

    for (let i = 0; i < _ctx.curvePathsByEffect.length; i++) {
        const refs = _ctx.curvePathsByEffect[i];
        morphPath(refs.baseline, prev.baseline[i] || '', newD.baseline[i] || '', CURVE_MORPH_DURATION_MS);
        morphPath(refs.desired, prev.desired[i] || '', newD.desired[i] || '', CURVE_MORPH_DURATION_MS);
        morphPath(refs.lxFill, prev.lxFill[i] || '', newD.lxFill[i] || '', CURVE_MORPH_DURATION_MS);
        morphPath(refs.lxStroke, prev.lxStroke[i] || '', newD.lxStroke[i] || '', CURVE_MORPH_DURATION_MS);
    }
    _ctx.lastPathD = newD;
    updateScoreBoxes(_ctx, clamped);
    updateGapIndicators(_ctx, clamped);
}

/**
 * Per-frame Rx interpolation — called from the multi-day animation loop
 * (MultiDayState.onCompareInterp) so Rx curves morph smoothly in lockstep
 * with Lx instead of snapping once per integer day change.
 *
 * Interpolates baseline/desired (from multiDayDays) and the Rx overlay
 * (from twin.lxCurves7D) between the fromDay and toDay array slots at
 * factor t, then writes the `d` attributes directly — bypasses the
 * morphPath WAAPI animation that updateCompareViewDay uses.
 */
export function interpolateCompareDay(fromDayIdx: number, toDayIdx: number, t: number): void {
    if (!_ctx) return;
    const panel = document.getElementById(COMPARE_PANEL_ID);
    if (!panel) return;

    const daysLen = _ctx.multiDayDays?.length || 0;
    const twinLen = _ctx.twin.lxCurves7D.length;
    const fromI = Math.max(0, Math.min(fromDayIdx | 0, daysLen - 1));
    const toI = Math.max(0, Math.min(toDayIdx | 0, daysLen - 1));
    const fromLxI = Math.max(0, Math.min(fromDayIdx | 0, twinLen - 1));
    const toLxI = Math.max(0, Math.min(toDayIdx | 0, twinLen - 1));

    const fromDay = _ctx.multiDayDays?.[fromI];
    const toDay = _ctx.multiDayDays?.[toI];
    const fromLx = _ctx.twin.lxCurves7D[fromLxI] || [];
    const toLx = _ctx.twin.lxCurves7D[toLxI] || [];

    const newD = { baseline: [] as string[], desired: [] as string[], lxFill: [] as string[], lxStroke: [] as string[] };

    for (let i = 0; i < _ctx.curvesData.length; i++) {
        const c = _ctx.curvesData[i];
        // Mirror Lx: postInterventionBaseline is the source (fallback to
        // bioCorrectedBaseline, then canonical) so the dashed baseline on
        // the Rx panel is identical to the one on the Lx panel frame-for-frame.
        const fromBlRaw =
            (fromDay?.postInterventionBaseline?.[i]?.length ? fromDay.postInterventionBaseline[i] : null) ||
            fromDay?.bioCorrectedBaseline?.[i] ||
            c.baseline ||
            [];
        const toBlRaw =
            (toDay?.postInterventionBaseline?.[i]?.length ? toDay.postInterventionBaseline[i] : null) ||
            toDay?.bioCorrectedBaseline?.[i] ||
            c.baseline ||
            [];
        const bFrom = smoothPhaseValues(fromBlRaw, PHASE_SMOOTH_PASSES);
        const bTo = smoothPhaseValues(toBlRaw, PHASE_SMOOTH_PASSES);
        const dFrom = smoothPhaseValues(fromDay?.desiredCurves?.[i] || c.desired || [], PHASE_SMOOTH_PASSES);
        const dTo = smoothPhaseValues(toDay?.desiredCurves?.[i] || c.desired || [], PHASE_SMOOTH_PASSES);
        // Rx overlay points come out of computeLxOverlay already smoothed —
        // hand them to phasePointsToPath with alreadySmoothed=true below.
        // Under the new static-twin model fromLx and toLx are identical
        // across days, so the interpolation is a no-op — but we keep it
        // structurally uniform in case the twin ever regains per-day shape.
        const rxFrom = fromLx[i]?.points || [];
        const rxTo = toLx[i]?.points || [];

        const baseline = interpolatePointArrays(bFrom, bTo, t);
        const desired = interpolatePointArrays(dFrom, dTo, t);
        const rx = rxFrom.length && rxTo.length ? interpolatePointArrays(rxFrom, rxTo, t) : rxTo.length ? rxTo : rxFrom;

        newD.baseline.push(phasePointsToPath(baseline, true) || '');
        newD.desired.push(phasePointsToPath(desired, true) || '');
        newD.lxFill.push(rx.length ? phasePointsToFillPath(rx, true) || '' : '');
        newD.lxStroke.push(rx.length ? phasePointsToPath(rx, true) || '' : '');

        const refs = _ctx.curvePathsByEffect[i];
        if (refs) {
            refs.baseline.setAttribute('d', newD.baseline[i]);
            refs.desired.setAttribute('d', newD.desired[i]);
            refs.lxFill.setAttribute('d', newD.lxFill[i]);
            refs.lxStroke.setAttribute('d', newD.lxStroke[i]);
        }
    }

    _ctx.lastPathD = newD;
    _ctx.currentDayIdx = t >= 1 ? toI : fromI;
    updateScoreBoxes(_ctx, _ctx.currentDayIdx);
    updateGapIndicators(_ctx, _ctx.currentDayIdx);
}

export function clearCompareView(): void {
    const existing = document.getElementById(COMPARE_PANEL_ID);
    if (existing) existing.remove();
    document.body.classList.remove(COMPARE_BODY_CLASS);
    _ctx = null;
}

export function isCompareActive(): boolean {
    return document.body.classList.contains(COMPARE_BODY_CLASS);
}
