import { PHASE_CHART } from './constants';
import { computeLxOverlay, validateInterventions } from './lx-system';
import { clamp } from './utils';
import type { CurveData, CurvePoint, DaySnapshot } from './types';

const HOUR_EPSILON = 0.001;

type RawCurvePoint = { hour?: number; value?: number } | null | undefined;

function clonePoint(point: RawCurvePoint): CurvePoint | null {
    const hour = Number(point?.hour);
    const value = Number(point?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(value)) return null;
    return {
        hour,
        value: clamp(value, 0, 100),
    };
}

function clonePoints(points: unknown): CurvePoint[] {
    if (!Array.isArray(points)) return [];
    return points.map(point => clonePoint(point as RawCurvePoint)).filter(Boolean) as CurvePoint[];
}

function cloneInterventions<T>(value: T): T {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value)) as T;
}

function hourRangeLabel(points: CurvePoint[]): string {
    if (points.length === 0) return 'empty';
    return `${points[0].hour}->${points[points.length - 1].hour}`;
}

function pointsMatchReferenceGrid(points: CurvePoint[], reference: CurvePoint[]): boolean {
    if (points.length !== reference.length) return false;
    for (let i = 0; i < reference.length; i++) {
        if (Math.abs(points[i].hour - reference[i].hour) > HOUR_EPSILON) return false;
    }
    return true;
}

export function normalizeCurvePointsToReferenceGrid(
    points: unknown,
    reference: CurvePoint[] | undefined,
    opts: { dayNumber: number; effect: string; label: string },
): CurvePoint[] {
    const canonical = clonePoints(reference);
    if (canonical.length === 0) return clonePoints(points);

    const normalized = clonePoints(points);
    if (normalized.length === 0) return canonical;
    if (pointsMatchReferenceGrid(normalized, canonical)) return normalized;

    const inRange = normalized.filter(
        point => point.hour >= PHASE_CHART.startHour && point.hour <= PHASE_CHART.endHour,
    );
    if (pointsMatchReferenceGrid(inRange, canonical)) return inRange;

    // eslint-disable-next-line no-console
    console.warn(
        `[WeekSnapshots] Day ${opts.dayNumber} curve "${opts.effect}" ${opts.label} ` +
            `used hour grid ${hourRangeLabel(normalized)} instead of canonical ${hourRangeLabel(canonical)}; ` +
            `falling back to the reference grid.`,
    );
    return canonical;
}

export function sanitizeWeekDaySnapshots(days: DaySnapshot[], curvesData: CurveData[]): DaySnapshot[] {
    if (!Array.isArray(days) || days.length === 0 || !Array.isArray(curvesData) || curvesData.length === 0) {
        return Array.isArray(days) ? cloneInterventions(days) : [];
    }

    return days.map(day => {
        const bioCorrectedBaseline = curvesData.map((curve, curveIdx) =>
            normalizeCurvePointsToReferenceGrid(day.bioCorrectedBaseline?.[curveIdx], curve.baseline, {
                dayNumber: day.day,
                effect: curve.effect,
                label: 'bioCorrectedBaseline',
            }),
        );

        const desiredCurves = curvesData.map((curve, curveIdx) =>
            normalizeCurvePointsToReferenceGrid(day.desiredCurves?.[curveIdx], curve.desired, {
                dayNumber: day.day,
                effect: curve.effect,
                label: 'desiredCurves',
            }),
        );

        const postInterventionBaseline = curvesData.map((curve, curveIdx) =>
            normalizeCurvePointsToReferenceGrid(
                day.postInterventionBaseline?.[curveIdx],
                bioCorrectedBaseline[curveIdx] || curve.baseline,
                {
                    dayNumber: day.day,
                    effect: curve.effect,
                    label: 'postInterventionBaseline',
                },
            ),
        );

        const tempCurvesData = curvesData.map((curve, curveIdx) => ({
            ...curve,
            baseline: postInterventionBaseline[curveIdx] || curve.baseline,
            desired: desiredCurves[curveIdx] || curve.desired,
        }));

        const validatedInterventions = validateInterventions(
            cloneInterventions(day.interventions || []),
            tempCurvesData,
        );
        const lxCurves = computeLxOverlay(validatedInterventions, tempCurvesData);

        return {
            ...day,
            bioCorrectedBaseline,
            desiredCurves,
            postInterventionBaseline,
            interventions: validatedInterventions,
            lxCurves,
        };
    });
}

export const __testing = {
    normalizeCurvePointsToReferenceGrid,
};
