/**
 * Curve Utils — Path generation for SVG curves: smoothing, points-to-path, fill-path, band-path, peak/trough finding, and interpolation.
 * Exports: smoothPhaseValues, phasePointsToPath, phasePointsToFillPath, phaseBandPath, buildProgressiveMorphPoints, findCurvePeak, nearestLevel, interpolatePointsAtTime
 * Depends on: constants (PHASE_CHART, DESCRIPTOR_LEVELS), utils (phaseChartX, phaseChartY)
 */
import { PHASE_CHART, PHASE_SMOOTH_PASSES, DESCRIPTOR_LEVELS } from './constants';
import { phaseChartX, phaseChartY, clamp } from './utils';

export function smoothPhaseValues(points: any, passes = 3) {
    if (!points || points.length < 5 || passes <= 0) return points || [];

    let vals = points.map((p: any) => Number(p.value));

    // Intentional low-pass filtering for approximation-first visualization.
    for (let p = 0; p < passes; p++) {
        const next = [vals[0], vals[1]];
        for (let i = 2; i < vals.length - 2; i++) {
            next.push(
                vals[i - 2] * 0.08 + vals[i - 1] * 0.24 + vals[i] * 0.36 + vals[i + 1] * 0.24 + vals[i + 2] * 0.08,
            );
        }
        next.push(vals[vals.length - 2], vals[vals.length - 1]);
        vals = next;
    }

    return points.map((p: any, i: any) => ({ ...p, value: vals[i] }));
}

/**
 * Build a monotone-cubic Bezier path string through the given screen-space
 * coordinates. Returns the full path starting with an `M` command, or (when
 * `omitMove` is true) just the cubic-segment chain suitable for appending to
 * an existing path. Falls back to a polyline when x-ordering is invalid.
 *
 * Shared between `phasePointsToPath` (Lx stroke) and `phaseBandPath` (AUC band
 * boundaries) so the two render with identical curvature — otherwise the Lx
 * stroke would visibly separate from the top of the stacked bands at peaks.
 */
function monotoneCubicPath(coords: Array<{ x: number; y: number }>, omitMove = false): string {
    if (coords.length < 2) return '';

    // Fallback to polyline if x ordering is invalid (duplicate/descending x).
    for (let i = 0; i < coords.length - 1; i++) {
        if (!(coords[i + 1].x > coords[i].x)) {
            let linear = omitMove ? '' : `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
            const startIdx = omitMove ? 0 : 1;
            for (let j = startIdx; j < coords.length; j++) {
                linear += ` L ${coords[j].x.toFixed(1)} ${coords[j].y.toFixed(1)}`;
            }
            return linear;
        }
    }

    if (coords.length === 2) {
        const head = omitMove ? '' : `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
        return `${head} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`;
    }

    // Monotone cubic interpolation (Fritsch-Carlson) to avoid overshoot artifacts.
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

    let d = omitMove ? '' : `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
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

/** Discard samples whose hour falls outside the chart's time window. Protects
 *  rendering against stale/corrupt LLM output (e.g. chronobiotic phase-shift
 *  outputs that drift the hour array off the plot area). Lightweight no-op when
 *  all points are already in-range. */
function filterPointsInChartRange(points: any[]): any[] {
    if (!Array.isArray(points) || points.length === 0) return [];
    const lo = PHASE_CHART.startHour;
    const hi = PHASE_CHART.endHour;
    // Fast path — scan without allocating until we hit something out of range.
    for (let i = 0; i < points.length; i++) {
        const h = Number(points[i]?.hour);
        if (!Number.isFinite(h) || h < lo || h > hi) {
            return points.filter((p: any) => {
                const hh = Number(p?.hour);
                return Number.isFinite(hh) && hh >= lo && hh <= hi;
            });
        }
    }
    return points;
}

export function phasePointsToPath(points: any, alreadySmoothed = false) {
    if (!points || points.length < 2) return '';

    const inRange = filterPointsInChartRange(points);
    if (inRange.length < 2) return '';

    const smoothed = alreadySmoothed ? inRange : smoothPhaseValues(inRange, PHASE_SMOOTH_PASSES);
    const coords = smoothed.map((p: any) => ({
        x: phaseChartX(Number(p.hour) * 60),
        y: phaseChartY(Number(p.value)),
    }));

    return monotoneCubicPath(coords, false);
}

export function phasePointsToFillPath(points: any, alreadySmoothed = false) {
    const inRange = filterPointsInChartRange(points);
    const pathD = phasePointsToPath(inRange, alreadySmoothed);
    if (!pathD) return '';
    const firstX = phaseChartX(inRange[0].hour * 60);
    const lastX = phaseChartX(inRange[inRange.length - 1].hour * 60);
    const baseY = phaseChartY(0);
    return pathD + ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
}

/** Closed path between two curves (upper traced L→R, lower traced R→L) for AUC band fills.
 *  The upper edge is drawn with the same monotone-cubic Bezier as `phasePointsToPath`
 *  so the band top matches the Lx stroke pixel-for-pixel. The lower edge uses straight
 *  `L` segments — adjacent bands stack top-to-bottom so each band's polyline lower edge
 *  coincides with the next band's polyline upper edge (no inter-band gaps), and the
 *  top-most band's cubic upper edge is what the user compares against the Lx stroke. */
export function phaseBandPath(upperPts: any[], lowerPts: any[]): string {
    if (!upperPts || !lowerPts || upperPts.length < 2 || lowerPts.length < 2) return '';

    // Clip to chart time window so stale/corrupt LLM output doesn't drift bands
    // off the plot area.
    const upperIn = filterPointsInChartRange(upperPts);
    const lowerIn = filterPointsInChartRange(lowerPts);
    if (upperIn.length < 2 || lowerIn.length < 2) return '';

    // Upper edge: reuse the exact cubic path used by the Lx stroke.
    // `alreadySmoothed=true` — the caller already applies smoothing upstream (points come
    // from `computeIncrementalLxOverlay` which uses pre-smoothed baselines).
    const upperPath = phasePointsToPath(upperIn, true);
    if (!upperPath) return '';

    // Lower edge: polyline R→L (closes the band).
    let lowerPath = '';
    for (let i = lowerIn.length - 1; i >= 0; i--) {
        lowerPath += ` L ${phaseChartX(Number(lowerIn[i].hour) * 60).toFixed(1)} ${phaseChartY(Number(lowerIn[i].value)).toFixed(1)}`;
    }

    return `${upperPath}${lowerPath} Z`;
}

/** Progressive morph: blend desired→Lx values based on playhead position */
export function buildProgressiveMorphPoints(desiredPts: any, lxPts: any, playheadHour: any, blendWidth: any) {
    const halfBlend = blendWidth / 2;
    const len = Math.min(desiredPts.length, lxPts.length);
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
        const hour = desiredPts[i].hour;
        let t; // 0 = fully desired, 1 = fully Lx
        if (hour <= playheadHour - halfBlend) {
            t = 1;
        } else if (hour >= playheadHour + halfBlend) {
            t = 0;
        } else {
            const x = (playheadHour + halfBlend - hour) / blendWidth;
            t = x * x * (3 - 2 * x); // smoothstep
        }
        result[i] = {
            hour: hour,
            value: desiredPts[i].value + (lxPts[i].value - desiredPts[i].value) * t,
        };
    }
    return result;
}

export function findCurvePeak(points: any) {
    const smoothed = smoothPhaseValues(points, PHASE_SMOOTH_PASSES);
    let peak = smoothed[0];
    for (const p of smoothed) {
        if (p.value > peak.value) peak = p;
    }
    return peak;
}

export function findCurveTrough(points: any) {
    const smoothed = smoothPhaseValues(points, PHASE_SMOOTH_PASSES);
    let trough = smoothed[0];
    for (const p of smoothed) {
        if (p.value < trough.value) trough = p;
    }
    return trough;
}

export function nearestLevel(value: any) {
    let best = DESCRIPTOR_LEVELS[0];
    for (const l of DESCRIPTOR_LEVELS) {
        if (Math.abs(l - value) < Math.abs(best - value)) best = l;
    }
    return best;
}

export function levelIndex(value: number): number {
    return DESCRIPTOR_LEVELS.indexOf(nearestLevel(value));
}

export function levelStep(value: number, direction: 1 | -1): number {
    const idx = levelIndex(value);
    const newIdx = clamp(idx + direction, 0, DESCRIPTOR_LEVELS.length - 1);
    return DESCRIPTOR_LEVELS[newIdx];
}

/** Map old 5-level descriptors {0,25,50,75,100} to 10-level format */
export function normalizeLevels(levels: Record<string, string>): Record<string, string> {
    const keys = Object.keys(levels)
        .map(Number)
        .sort((a, b) => a - b);
    if (keys.length >= 9) return levels;
    const normalized: Record<string, string> = {};
    for (const newLevel of DESCRIPTOR_LEVELS) {
        const nearest = keys.reduce((a, b) => (Math.abs(b - newLevel) < Math.abs(a - newLevel) ? b : a));
        normalized[String(newLevel)] = levels[String(nearest)] || '';
    }
    return normalized;
}

export function findMaxDivergence(curve: any) {
    const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
    let best: any = null;
    const len = Math.min(blSmoothed.length, dsSmoothed.length);
    for (let j = 0; j < len; j++) {
        const diff = dsSmoothed[j].value - blSmoothed[j].value;
        if (!best || Math.abs(diff) > Math.abs(best.diff)) {
            best = { hour: dsSmoothed[j].hour, value: dsSmoothed[j].value, diff };
        }
    }
    return best;
}

/** Generic linear interpolation on any {hour,value}[] array */
export function interpolatePointsAtTime(pts: any, timeH: any) {
    if (!pts || pts.length === 0) return 50;
    if (timeH <= pts[0].hour) return pts[0].value;
    if (timeH >= pts[pts.length - 1].hour) return pts[pts.length - 1].value;
    for (let i = 0; i < pts.length - 1; i++) {
        if (timeH >= pts[i].hour && timeH <= pts[i + 1].hour) {
            const t = (timeH - pts[i].hour) / (pts[i + 1].hour - pts[i].hour);
            return pts[i].value + t * (pts[i + 1].value - pts[i].value);
        }
    }
    return pts[pts.length - 1].value;
}

/** Linear interpolation of Lx curve value at any minute (legacy wrapper) */
export function interpolateLxValue(lxCurve: any, timeMinutes: any) {
    return interpolatePointsAtTime(lxCurve.points, timeMinutes / 60);
}

/** Interpolate between two same-length point arrays by a 0→1 progress factor. */
export function interpolatePointArrays(
    fromPts: { hour: number; value: number }[],
    toPts: { hour: number; value: number }[],
    progress: number,
): { hour: number; value: number }[] {
    const len = Math.min(fromPts.length, toPts.length);
    const result: { hour: number; value: number }[] = [];
    for (let i = 0; i < len; i++) {
        result.push({
            hour: toPts[i].hour,
            value: fromPts[i].value + (toPts[i].value - fromPts[i].value) * progress,
        });
    }
    return result;
}
