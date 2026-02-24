import { PHASE_CHART, PHASE_SMOOTH_PASSES, DESCRIPTOR_LEVELS } from './constants';
import { phaseChartX, phaseChartY } from './utils';

export function smoothPhaseValues(points: any, passes = 3) {
    if (!points || points.length < 5 || passes <= 0) return points || [];

    let vals = points.map((p: any) => Number(p.value));

    // Intentional low-pass filtering for approximation-first visualization.
    for (let p = 0; p < passes; p++) {
        const next = [vals[0], vals[1]];
        for (let i = 2; i < vals.length - 2; i++) {
            next.push(
                vals[i - 2] * 0.08 +
                vals[i - 1] * 0.24 +
                vals[i] * 0.36 +
                vals[i + 1] * 0.24 +
                vals[i + 2] * 0.08
            );
        }
        next.push(vals[vals.length - 2], vals[vals.length - 1]);
        vals = next;
    }

    return points.map((p: any, i: any) => ({ ...p, value: vals[i] }));
}

export function phasePointsToPath(points: any, alreadySmoothed = false) {
    if (!points || points.length < 2) return '';

    const smoothed = alreadySmoothed ? points : smoothPhaseValues(points, PHASE_SMOOTH_PASSES);
    const coords = smoothed.map((p: any) => ({
        x: phaseChartX(Number(p.hour) * 60),
        y: phaseChartY(Number(p.value)),
    }));

    // Fallback to polyline if x ordering is invalid.
    for (let i = 0; i < coords.length - 1; i++) {
        if (!(coords[i + 1].x > coords[i].x)) {
            let linear = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
            for (let j = 1; j < coords.length; j++) {
                linear += ` L ${coords[j].x.toFixed(1)} ${coords[j].y.toFixed(1)}`;
            }
            return linear;
        }
    }

    if (coords.length === 2) {
        return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`;
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
            t[i] = (w1 + w2) / ((w1 / m[i - 1]) + (w2 / m[i]));
        }
    }

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

export function phasePointsToFillPath(points: any, alreadySmoothed = false) {
    const pathD = phasePointsToPath(points, alreadySmoothed);
    if (!pathD) return '';
    const firstX = phaseChartX(points[0].hour * 60);
    const lastX = phaseChartX(points[points.length - 1].hour * 60);
    const baseY = phaseChartY(0);
    return pathD + ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
}

/** Closed path between two curves (upper traced L→R, lower traced R→L) for AUC band fills */
export function phaseBandPath(upperPts: any[], lowerPts: any[]): string {
    if (!upperPts || !lowerPts || upperPts.length < 2 || lowerPts.length < 2) return '';
    const x0 = phaseChartX(upperPts[0].hour * 60);
    const y0 = phaseChartY(upperPts[0].value);
    let d = `M ${x0.toFixed(1)} ${y0.toFixed(1)}`;
    for (let i = 1; i < upperPts.length; i++) {
        d += ` L ${phaseChartX(upperPts[i].hour * 60).toFixed(1)} ${phaseChartY(upperPts[i].value).toFixed(1)}`;
    }
    for (let i = lowerPts.length - 1; i >= 0; i--) {
        d += ` L ${phaseChartX(lowerPts[i].hour * 60).toFixed(1)} ${phaseChartY(lowerPts[i].value).toFixed(1)}`;
    }
    return d + ' Z';
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
    const newIdx = Math.max(0, Math.min(DESCRIPTOR_LEVELS.length - 1, idx + direction));
    return DESCRIPTOR_LEVELS[newIdx];
}

/** Map old 5-level descriptors {0,25,50,75,100} to 10-level format */
export function normalizeLevels(levels: Record<string, string>): Record<string, string> {
    const keys = Object.keys(levels).map(Number).sort((a, b) => a - b);
    if (keys.length >= 9) return levels;
    const normalized: Record<string, string> = {};
    for (const newLevel of DESCRIPTOR_LEVELS) {
        const nearest = keys.reduce((a, b) => Math.abs(b - newLevel) < Math.abs(a - newLevel) ? b : a);
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
