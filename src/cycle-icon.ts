/**
 * Cycle Icon — Generates animated landscape SVG thumbnails from 7-day cycle data.
 *
 * Produces a self-contained 200×120 landscape SVG with per-substance rainbow
 * AUC bands animating through 7 days via SMIL, plus a substance timing strip
 * below the curves showing colored pill rectangles that morph across days.
 *
 * Two entry points:
 *  - generateCycleIconSvg()       — from live MultiDayState.days (at save time)
 *  - generateCycleIconFromBundle() — from a stored SessionCacheBundle (lazy regen)
 *
 * Exports: generateCycleIconSvg, generateCycleIconFromBundle
 * Depends on: types, lx-system (barrel — computeIncrementalLxOverlay, validateInterventions)
 */

import type { DaySnapshot, CurvePoint, CurveData } from './types';
import { computeIncrementalLxOverlay, validateInterventions } from './lx-system';
import { extractInterventionsData } from './llm-response-shape';
import { RUNTIME_REPLAY_STAGE_CLASS } from './replay-snapshot';

// ── Layout constants ────────────────────────────────────────────────────

const ICON_W = 200;
const ICON_H = 120;
const ICON_PAD = 8;
const CURVE_TOP = 8;
const CURVE_H = 68; // y=8 to y=76
const STRIP_TOP = 82;
const STRIP_H = 30; // y=82 to y=112
const CORNER_R = 8;
const PILL_H = 7;
const PILL_GAP = 2;
const PILL_R = 2;
const MAX_PILL_LANES = 3;
const PILL_OPACITY = 0.55;

const HOUR_START = 6;
const HOUR_END = 30;
const HOUR_SPAN = HOUR_END - HOUR_START; // 24
const DAY_DURATION_S = 1.5;
const DOWNSAMPLE_TARGET = 18;
const BAND_OPACITY = 0.45;
const MAX_BANDS = 6;

// ── Coordinate helpers ──────────────────────────────────────────────────

function downsampleCurve(pts: CurvePoint[], target: number): CurvePoint[] {
    if (!pts || pts.length === 0) return [];
    if (pts.length <= target) return pts;
    const result: CurvePoint[] = [pts[0]];
    const step = (pts.length - 1) / (target - 1);
    for (let i = 1; i < target - 1; i++) {
        result.push(pts[Math.round(i * step)]);
    }
    result.push(pts[pts.length - 1]);
    return result;
}

function iconX(hour: number): number {
    return ICON_PAD + ((hour - HOUR_START) / HOUR_SPAN) * (ICON_W - 2 * ICON_PAD);
}

function iconY(value: number, yOffset: number, plotH: number): number {
    const clamped = Math.max(0, Math.min(100, value));
    return yOffset + plotH - (clamped / 100) * plotH;
}

// ── Bezier path helpers ──────────────────────────────────────────────────

/**
 * Monotone cubic Fritsch-Carlson interpolation in icon coordinate space.
 * Mirrors the algorithm in curve-utils.ts phasePointsToPath() but maps to
 * icon (x,y) coordinates rather than main chart pixel space. Produces smooth
 * cubic bezier paths with no overshoot and consistent SMIL-compatible structure.
 */
function iconPointsToPath(pts: CurvePoint[], yOff: number, pH: number): string {
    if (!pts || pts.length === 0) return `M ${ICON_PAD.toFixed(1)} ${(yOff + pH).toFixed(1)}`;
    const ds = downsampleCurve(pts, DOWNSAMPLE_TARGET);
    if (ds.length === 1) {
        return `M ${iconX(ds[0].hour).toFixed(1)} ${iconY(ds[0].value, yOff, pH).toFixed(1)}`;
    }

    const coords = ds.map(p => ({ x: iconX(p.hour), y: iconY(p.value, yOff, pH) }));

    // Guard: if x-ordering isn't strictly increasing, fall back to polyline
    for (let i = 0; i < coords.length - 1; i++) {
        if (!(coords[i + 1].x > coords[i].x)) {
            return coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
        }
    }

    if (coords.length === 2) {
        return (
            `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}` +
            ` L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`
        );
    }

    // Fritsch-Carlson: compute per-point tangent slopes
    const n = coords.length;
    const dx = new Array(n - 1);
    const dy = new Array(n - 1);
    const m = new Array(n - 1);
    const t = new Array(n);

    for (let i = 0; i < n - 1; i++) {
        dx[i] = coords[i + 1].x - coords[i].x;
        dy[i] = coords[i + 1].y - coords[i].y;
        m[i] = dy[i] / dx[i];
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
        if (m[i - 1] === 0 || m[i] === 0 || m[i - 1] * m[i] <= 0) {
            t[i] = 0;
        } else {
            const w1 = 2 * dx[i] + dx[i - 1];
            const w2 = dx[i] + 2 * dx[i - 1];
            t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
        }
    }

    // Emit cubic bezier path
    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
        const p0 = coords[i];
        const p1 = coords[i + 1];
        const h = dx[i];
        const cp1x = p0.x + h / 3;
        const cp1y = p0.y + (t[i] * h) / 3;
        const cp2x = p1.x - h / 3;
        const cp2y = p1.y - (t[i + 1] * h) / 3;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    return d;
}

/**
 * Closed AUC band path: upper edge traced L→R with smooth cubic beziers,
 * lower edge traced R→L as polyline (interior edge, less visible in fill).
 */
function smoothedBandPath(upper: CurvePoint[], lower: CurvePoint[], yOff: number, pH: number): string {
    if (!upper?.length || !lower?.length) {
        return `M ${ICON_PAD.toFixed(1)} ${(yOff + pH).toFixed(1)} Z`;
    }
    const uPath = iconPointsToPath(upper, yOff, pH);
    const lDs = downsampleCurve(lower, DOWNSAMPLE_TARGET);
    const lSegs = [...lDs]
        .reverse()
        .map(p => `L ${iconX(p.hour).toFixed(1)} ${iconY(p.value, yOff, pH).toFixed(1)}`)
        .join(' ');
    return `${uPath} ${lSegs} Z`;
}

// ── SMIL helpers ────────────────────────────────────────────────────────

function buildKeyTimes(count: number): string {
    return Array.from({ length: count }, (_, i) => (i / (count - 1)).toFixed(3)).join(';');
}

function buildKeySplines(count: number): string {
    return Array(count - 1)
        .fill('0.42 0 0.58 1')
        .join(';');
}

// ── Per-substance band data per day ─────────────────────────────────────

interface SubstanceBand {
    color: string;
    upper: CurvePoint[];
    lower: CurvePoint[];
}

interface IconDayData {
    day: number;
    baseline: CurvePoint[][]; // per effect
    lxOverlay: CurvePoint[][]; // per effect — top of stacked bands
    effectColor: string[]; // per effect — dominant color for line strokes
    bands: SubstanceBand[][]; // per effect → stacked substance bands
    interventions: any[]; // validated Intervention[] for substance strip
}

/**
 * Compute per-substance rainbow bands from interventions + curvesData.
 */
function computeIconBands(interventions: any[], curvesData: CurveData[], effectCount: number): SubstanceBand[][] {
    const snapshots = computeIncrementalLxOverlay(interventions, curvesData);
    if (!snapshots?.length) return Array.from({ length: effectCount }, () => []);

    const bandsByEffect: SubstanceBand[][] = Array.from({ length: effectCount }, () => []);
    let prevPts: CurvePoint[][] | null = null;

    for (let k = 0; k < snapshots.length && k < MAX_BANDS; k++) {
        const { lxCurves, step } = snapshots[k];
        const targetPts = lxCurves.map((lx: any) => (lx?.points as CurvePoint[]) || []);
        const sourcePts = prevPts || lxCurves.map((lx: any) => (lx?.baseline as CurvePoint[]) || []);

        for (let ci = 0; ci < effectCount; ci++) {
            if (!targetPts[ci]?.length || !sourcePts[ci]?.length) continue;
            bandsByEffect[ci].push({
                color: step[0]?.substance?.color || curvesData[ci]?.color || '#60a5fa',
                upper: targetPts[ci],
                lower: sourcePts[ci],
            });
        }
        prevPts = targetPts.map(pts => pts.map(p => ({ ...p })));
    }

    return bandsByEffect;
}

/** Extract Lx overlay (top of stacked bands) per effect. Falls back to baseline. */
function lxOverlayFromBands(bands: SubstanceBand[][], curvesData: CurveData[], effectCount: number): CurvePoint[][] {
    return Array.from({ length: effectCount }, (_, ei) => {
        const eBands = bands[ei];
        if (eBands && eBands.length > 0) return eBands[eBands.length - 1].upper;
        return curvesData[ei]?.baseline || [];
    });
}

/** Effect color for line strokes — uses CurveData.color to match the main chart. */
function effectColorsFromCurves(curvesData: CurveData[], effectCount: number): string[] {
    return Array.from({ length: effectCount }, (_, ei) => curvesData[ei]?.color || '#60a5fa');
}

// ── Substance strip builder ─────────────────────────────────────────────

interface StripPillFrame {
    x: number;
    w: number;
    opacity: number;
}

/**
 * Build animated substance strip SVG: colored pill rectangles that morph across 7 days.
 * Each unique substance gets one <rect> with SMIL animate for x, width, and opacity.
 */
function buildSubstanceStrip(dayData: IconDayData[], keyTimes: string, dur: string, splines: string): string {
    // Collect all unique substance keys + their colors across all days
    const substanceMap = new Map<string, { color: string; frames: StripPillFrame[] }>();

    // Append loop-back frame (day 0 again)
    const allDays = [...dayData, dayData[0]];

    for (const dd of allDays) {
        for (const iv of dd.interventions || []) {
            if (!iv.key || !iv.substance) continue;
            if (!substanceMap.has(iv.key)) {
                substanceMap.set(iv.key, {
                    color: iv.substance.color || '#60a5fa',
                    frames: [],
                });
            }
        }
    }

    if (substanceMap.size === 0) return '';

    // Build per-frame data for each substance
    const plotW = ICON_W - 2 * ICON_PAD;
    for (const [key, info] of substanceMap) {
        for (const dd of allDays) {
            const iv = (dd.interventions || []).find((i: any) => i.key === key);
            if (iv && iv.substance?.pharma) {
                const hour = iv.timeMinutes / 60;
                const durHours = (iv.substance.pharma.duration || 120) / 60;
                const x = iconX(hour);
                const w = Math.max(4, (durHours / HOUR_SPAN) * plotW);
                // Clamp to not exceed right edge
                const clampedW = Math.min(w, ICON_W - ICON_PAD - x);
                info.frames.push({ x, w: Math.max(2, clampedW), opacity: PILL_OPACITY });
            } else {
                // Substance absent this day — keep last known position but invisible
                const last = info.frames.length > 0 ? info.frames[info.frames.length - 1] : null;
                info.frames.push({ x: last?.x ?? ICON_PAD, w: last?.w ?? 0, opacity: 0 });
            }
        }
    }

    // Lane allocation (first-fit by average x position)
    const pills = Array.from(substanceMap.entries()).map(([key, info]) => ({
        key,
        ...info,
        avgX:
            info.frames.reduce((s, f) => s + (f.opacity > 0 ? f.x : 0), 0) /
            Math.max(1, info.frames.filter(f => f.opacity > 0).length),
    }));
    pills.sort((a, b) => a.avgX - b.avgX);

    const lanes: { endX: number }[][] = [];
    for (const pill of pills) {
        let assigned = false;
        const maxEnd = Math.max(...pill.frames.filter(f => f.opacity > 0).map(f => f.x + f.w));
        const minStart = Math.min(...pill.frames.filter(f => f.opacity > 0).map(f => f.x));

        for (let li = 0; li < MAX_PILL_LANES; li++) {
            if (!lanes[li]) lanes[li] = [];
            const conflict = lanes[li].some(
                existing => !(maxEnd + 2 < existing.endX - 200 || minStart - 2 > existing.endX),
            );
            // Simple: check if this pill's range overlaps anything in the lane
            const realConflict = lanes[li].some(existing => {
                // stored as endX from previous pills in this lane
                return minStart < existing.endX + 4;
            });
            if (!realConflict) {
                lanes[li].push({ endX: maxEnd });
                (pill as any).lane = li;
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            (pill as any).lane = Math.min(pills.indexOf(pill), MAX_PILL_LANES - 1);
        }
    }

    // Generate SVG rects with SMIL
    const rects: string[] = [];
    for (const pill of pills) {
        const lane = (pill as any).lane || 0;
        const y = STRIP_TOP + lane * (PILL_H + PILL_GAP);
        const f0 = pill.frames[0];
        const xValues = pill.frames.map(f => f.x.toFixed(1)).join(';');
        const wValues = pill.frames.map(f => f.w.toFixed(1)).join(';');
        const oValues = pill.frames.map(f => f.opacity.toFixed(2)).join(';');

        rects.push(
            `<rect x="${f0.x.toFixed(1)}" y="${y}" width="${f0.w.toFixed(1)}" height="${PILL_H}" rx="${PILL_R}" ` +
                `fill="${pill.color}" opacity="${f0.opacity.toFixed(2)}">` +
                `<animate attributeName="x" values="${xValues}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite" calcMode="spline" keySplines="${splines}"/>` +
                `<animate attributeName="width" values="${wValues}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite" calcMode="spline" keySplines="${splines}"/>` +
                `<animate attributeName="opacity" values="${oValues}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite" calcMode="spline" keySplines="${splines}"/>` +
                `</rect>`,
        );
    }

    // Add a faint separator line between curves and strip
    rects.unshift(
        `<line x1="${ICON_PAD}" y1="${STRIP_TOP - 3}" x2="${ICON_W - ICON_PAD}" y2="${STRIP_TOP - 3}" ` +
            `stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>`,
    );

    return rects.join('');
}

// ── SVG builder ─────────────────────────────────────────────────────────

function buildIconSvg(dayData: IconDayData[], effectCount: number): string {
    const u = Math.random().toString(36).slice(2, 6);
    const frames = [...dayData, dayData[0]];
    const keyTimes = buildKeyTimes(frames.length);
    const dur = `${(frames.length * DAY_DURATION_S).toFixed(1)}s`;
    const splines = buildKeySplines(frames.length);

    const pH = CURVE_H;
    const yOff = CURVE_TOP;

    const paths: string[] = [];
    const gradientDefs: string[] = [];

    for (let ei = 0; ei < effectCount; ei++) {
        const lineColor0 = dayData[0].effectColor[ei] || '#60a5fa';
        const lineColors = frames.map(d => d.effectColor[ei] || lineColor0);
        const lineColorsVary = lineColors.some(c => c !== lineColor0);

        // ── Layer 1: Gradient fill under Lx line ──
        const rightX = iconX(HOUR_END).toFixed(1);
        const leftX = iconX(HOUR_START).toFixed(1);
        const bottom = (yOff + pH).toFixed(1);
        const fillValues = frames
            .map(d => {
                const lxPath = iconPointsToPath(d.lxOverlay[ei] || [], yOff, pH);
                return `${lxPath} L ${rightX} ${bottom} L ${leftX} ${bottom} Z`;
            })
            .join(';');
        const fillPath0 = `${iconPointsToPath(dayData[0].lxOverlay[ei] || [], yOff, pH)} L ${rightX} ${bottom} L ${leftX} ${bottom} Z`;
        gradientDefs.push(
            `<linearGradient id="ci-g${ei}-${u}" x1="0" y1="${yOff}" x2="0" y2="${yOff + pH}" gradientUnits="userSpaceOnUse">` +
                `<stop offset="0" stop-color="${lineColor0}" stop-opacity="0.25"/>` +
                `<stop offset="1" stop-color="${lineColor0}" stop-opacity="0.03"/>` +
                `</linearGradient>`,
        );
        paths.push(
            `<path d="${fillPath0}" fill="url(#ci-g${ei}-${u})" stroke="none">` +
                `<animate attributeName="d" values="${fillValues}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite" calcMode="spline" keySplines="${splines}"/>` +
                `</path>`,
        );

        // ── Layer 2: Per-substance rainbow AUC bands ──
        const maxBands = Math.max(...dayData.map(d => d.bands[ei]?.length || 0));

        for (let bi = 0; bi < maxBands; bi++) {
            const bandValues = frames
                .map(d => {
                    const band = d.bands[ei]?.[bi];
                    if (band) return smoothedBandPath(band.upper, band.lower, yOff, pH);
                    const bl = d.baseline[ei] || [];
                    return smoothedBandPath(bl, bl, yOff, pH);
                })
                .join(';');

            const band0 = dayData[0].bands[ei]?.[bi];
            const path0 = band0
                ? smoothedBandPath(band0.upper, band0.lower, yOff, pH)
                : smoothedBandPath(dayData[0].baseline[ei] || [], dayData[0].baseline[ei] || [], yOff, pH);

            const colors = frames.map(d => d.bands[ei]?.[bi]?.color || 'transparent');
            const color0 = colors[0];
            const colorsVary = colors.some(c => c !== color0);

            paths.push(
                `<path d="${path0}" fill="${color0}" stroke="none" opacity="${BAND_OPACITY}">` +
                    `<animate attributeName="d" values="${bandValues}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite" calcMode="spline" keySplines="${splines}"/>` +
                    (colorsVary
                        ? `<animate attributeName="fill" values="${colors.join(';')}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite"/>`
                        : '') +
                    `</path>`,
            );
        }

        // ── Layer 3: Lx hero line ──
        const lxValues = frames.map(d => iconPointsToPath(d.lxOverlay[ei] || [], yOff, pH)).join(';');
        const lxPath0 = iconPointsToPath(dayData[0].lxOverlay[ei] || [], yOff, pH);
        paths.push(
            `<path d="${lxPath0}" stroke="${lineColor0}" stroke-width="1.6" fill="none" opacity="0.95"` +
                ` stroke-linecap="round" stroke-linejoin="round">` +
                `<animate attributeName="d" values="${lxValues}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite" calcMode="spline" keySplines="${splines}"/>` +
                (lineColorsVary
                    ? `<animate attributeName="stroke" values="${lineColors.join(';')}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite"/>`
                    : '') +
                `</path>`,
        );
    }

    // Substance strip
    const stripSvg = buildSubstanceStrip(dayData, keyTimes, dur, splines);

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_W} ${ICON_H}" data-v="10">`,
        gradientDefs.length ? `<defs>${gradientDefs.join('')}</defs>` : '',
        `<rect class="ci-bg" width="${ICON_W}" height="${ICON_H}" rx="${CORNER_R}"/>`,
        ...paths,
        stripSvg,
        `<rect class="ci-frame" width="${ICON_W}" height="${ICON_H}" rx="${CORNER_R}" fill="none"/>`,
        `</svg>`,
    ].join('');
}

// ── Public: from live DaySnapshot[] (at save time) ──────────────────────

export function generateCycleIconSvg(days: DaySnapshot[], curvesData: CurveData[]): string | null {
    if (!days || days.length < 2 || !curvesData || curvesData.length === 0) return null;

    const effectCount = Math.min(curvesData.length, 2);

    const dayData: IconDayData[] = days.map(day => {
        const dayCurves: CurveData[] = curvesData.slice(0, effectCount).map((c, ei) => ({
            ...c,
            baseline: day.bioCorrectedBaseline?.[ei] || c.baseline,
            desired: day.desiredCurves?.[ei] || c.desired,
        }));

        const bands = computeIconBands(day.interventions || [], dayCurves, effectCount);

        return {
            day: day.day,
            baseline: dayCurves.map(c => c.baseline),
            lxOverlay: lxOverlayFromBands(bands, dayCurves, effectCount),
            effectColor: effectColorsFromCurves(dayCurves, effectCount),
            bands,
            interventions: day.interventions || [],
        };
    });

    return buildIconSvg(dayData, effectCount);
}

// ── Public: from a stored SessionCacheBundle (lazy regeneration) ─────────

export function generateCycleIconFromBundle(bundle: any): string | null {
    if (!bundle?.stages) return null;

    const curvesPayload = bundle.stages['main-model']?.payload;
    if (!curvesPayload?.curves || !Array.isArray(curvesPayload.curves)) return null;
    const runtimeReplayPayload = bundle.stages[RUNTIME_REPLAY_STAGE_CLASS]?.payload;
    const runtimeWeekDays = runtimeReplayPayload?.week?.days;
    const runtimeDesignCurves = runtimeReplayPayload?.design?.curvesData;

    const curves: CurveData[] =
        Array.isArray(runtimeDesignCurves) && runtimeDesignCurves.length > 0 ? runtimeDesignCurves : curvesPayload.curves;
    const effectCount = Math.min(curves.length, 2);

    if (Array.isArray(runtimeWeekDays) && runtimeWeekDays.length >= 2) {
        return generateCycleIconSvg(runtimeWeekDays as DaySnapshot[], curves);
    }

    const knightPayload = bundle.stages['knight-model']?.payload;
    if (!knightPayload?.days || !Array.isArray(knightPayload.days)) return null;

    const stratBioPayload = bundle.stages['strategist-bio-daily-model']?.payload;
    if (!stratBioPayload?.days || !Array.isArray(stratBioPayload.days)) return null;

    const gmPayload = bundle.stages['grandmaster-daily-model']?.payload;

    // Day 0: use main-model data + initial interventions from intervention-model
    const ivPayload = bundle.stages['intervention-model']?.payload;
    const day0Ivs = ivPayload ? validateInterventions(extractInterventionsData(ivPayload), curves) : [];
    const day0Bands = computeIconBands(day0Ivs, curves.slice(0, effectCount) as CurveData[], effectCount);

    const day0Curves = curves.slice(0, effectCount) as CurveData[];
    const dayData: IconDayData[] = [
        {
            day: 0,
            baseline: day0Curves.map(c => c.baseline || []),
            lxOverlay: lxOverlayFromBands(day0Bands, day0Curves, effectCount),
            effectColor: effectColorsFromCurves(day0Curves, effectCount),
            bands: day0Bands,
            interventions: day0Ivs,
        },
    ];

    // Days 1–7
    for (let dayNum = 1; dayNum <= 7; dayNum++) {
        const knightDay = knightPayload.days.find((d: any) => d.day === dayNum);
        const stratDay = stratBioPayload.days.find((d: any) => d.day === dayNum);
        const gmDay = gmPayload?.days?.find((d: any) => d.day === dayNum);

        const dayCurves: CurveData[] = curves.slice(0, effectCount).map((c: any, ei: number) => {
            const effectName = c.effect;
            const stratEffect = (stratDay?.correctedBaseline || []).find((e: any) => e.effect === effectName);
            const knightEffect = (knightDay?.desired || []).find((e: any) => e.effect === effectName);
            return {
                ...c,
                baseline: stratEffect?.baseline || c.baseline || [],
                desired: knightEffect?.desired || c.desired || [],
            };
        });

        const rawIvs = gmDay ? extractInterventionsData(gmDay) : [];
        const validatedIvs = validateInterventions(JSON.parse(JSON.stringify(rawIvs)), dayCurves);
        const bands = computeIconBands(validatedIvs, dayCurves, effectCount);

        dayData.push({
            day: dayNum,
            baseline: dayCurves.map(c => c.baseline),
            lxOverlay: lxOverlayFromBands(bands, dayCurves, effectCount),
            effectColor: effectColorsFromCurves(dayCurves, effectCount),
            bands,
            interventions: validatedIvs,
        });
    }

    return buildIconSvg(dayData, effectCount);
}
