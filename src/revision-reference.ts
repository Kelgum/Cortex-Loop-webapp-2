import { PHASE_CHART, PHASE_SMOOTH_PASSES } from './constants';
import { interpolatePointsAtTime, smoothPhaseValues } from './curve-utils';
import type {
    CurveData,
    CurvePoint,
    Intervention,
    LxCurve,
    RevisionCurveSeries,
    RevisionFitMetrics,
    RevisionGapEffectSummary,
    RevisionGapPoint,
    RevisionGapSummary,
    RevisionGapWindow,
    RevisionReferenceBundle,
} from './types';

const RESAMPLE_INTERVAL_MINUTES = PHASE_CHART.sampleInterval || 15;
const PROMPT_DOWNSAMPLE_STEP = 6;
const MISSION_THRESHOLD_POINTS = 5;
const MISSION_THRESHOLD_RATIO = 0.15;
const MISSION_MERGE_GAP_MINUTES = 30;
const MISSION_MIN_DURATION_MINUTES = 45;
const TARGET_GAP_THRESHOLD_POINTS = 5;
const TARGET_MERGE_GAP_MINUTES = 30;
const TARGET_MIN_DURATION_MINUTES = 30;

type WindowSpan = {
    startIdx: number;
    endIdx: number;
};

type BuildRevisionReferenceBundleOptions = {
    curvesData: CurveData[];
    currentLxCurves: LxCurve[] | null | undefined;
    currentInterventions: Intervention[];
    bioCorrectionApplied: boolean;
};

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function clonePoints(points: CurvePoint[] | null | undefined): CurvePoint[] {
    return (points || []).map(point => ({
        hour: Number(point.hour),
        value: Number(point.value),
    }));
}

function cloneInterventions(interventions: Intervention[] | null | undefined): Intervention[] {
    return (interventions || []).map(iv => ({ ...iv }));
}

function resamplePoints(points: CurvePoint[]): CurvePoint[] {
    const resampled: CurvePoint[] = [];
    for (let minute = PHASE_CHART.startMin; minute <= PHASE_CHART.endMin; minute += RESAMPLE_INTERVAL_MINUTES) {
        const hour = minute / 60;
        resampled.push({
            hour,
            value: interpolatePointsAtTime(points, hour),
        });
    }
    return resampled;
}

function normalizeCurvePoints(points: CurvePoint[] | null | undefined): CurvePoint[] {
    const cloned = clonePoints(points);
    const smoothed = smoothPhaseValues(cloned, PHASE_SMOOTH_PASSES);
    return resamplePoints(smoothed);
}

/** Resample already-smoothed points (e.g. LX curves computed on a smoothed baseline grid)
 *  without applying additional smoothing passes that would attenuate peaks. */
function resampleOnly(points: CurvePoint[] | null | undefined): CurvePoint[] {
    const cloned = clonePoints(points);
    return resamplePoints(cloned);
}

function buildSeries(
    effect: string,
    polarity: 'higher_is_better' | 'higher_is_worse',
    points: CurvePoint[],
): RevisionCurveSeries {
    return {
        effect,
        polarity,
        points,
    };
}

function windowGapSamples(maxGapMinutes: number): number {
    return Math.max(0, Math.floor(maxGapMinutes / RESAMPLE_INTERVAL_MINUTES));
}

function collectWindowSpans(values: number[], threshold: number): WindowSpan[] {
    const spans: WindowSpan[] = [];
    let startIdx = -1;

    for (let idx = 0; idx < values.length; idx++) {
        if (values[idx] >= threshold) {
            if (startIdx < 0) startIdx = idx;
            continue;
        }
        if (startIdx >= 0) {
            spans.push({ startIdx, endIdx: idx - 1 });
            startIdx = -1;
        }
    }

    if (startIdx >= 0) {
        spans.push({ startIdx, endIdx: values.length - 1 });
    }

    return spans;
}

function mergeWindowSpans(spans: WindowSpan[], maxGapMinutes: number): WindowSpan[] {
    if (spans.length <= 1) return spans;

    const maxGapSamples = windowGapSamples(maxGapMinutes);
    const merged: WindowSpan[] = [spans[0]];

    for (let idx = 1; idx < spans.length; idx++) {
        const current = spans[idx];
        const last = merged[merged.length - 1];
        if (current.startIdx - last.endIdx - 1 <= maxGapSamples) {
            last.endIdx = current.endIdx;
        } else {
            merged.push({ ...current });
        }
    }

    return merged;
}

function filterWindowSpans(spans: WindowSpan[], minDurationMinutes: number): WindowSpan[] {
    const minSamples = Math.max(1, Math.ceil(minDurationMinutes / RESAMPLE_INTERVAL_MINUTES));
    return spans.filter(span => span.endIdx - span.startIdx + 1 >= minSamples);
}

function buildWindowSummary(points: CurvePoint[], values: number[], span: WindowSpan): RevisionGapWindow {
    let peakGap = 0;
    let peakGapHour = points[span.startIdx]?.hour ?? PHASE_CHART.startHour;
    let areaPointMinutes = 0;

    for (let idx = span.startIdx; idx <= span.endIdx; idx++) {
        const value = Math.max(0, Number(values[idx] || 0));
        areaPointMinutes += value * RESAMPLE_INTERVAL_MINUTES;
        if (value > peakGap) {
            peakGap = value;
            peakGapHour = points[idx]?.hour ?? peakGapHour;
        }
    }

    return {
        startHour: Number(points[span.startIdx]?.hour ?? PHASE_CHART.startHour),
        endHour: Number(points[span.endIdx]?.hour ?? PHASE_CHART.startHour),
        durationMinutes: (span.endIdx - span.startIdx + 1) * RESAMPLE_INTERVAL_MINUTES,
        areaPointMinutes: round1(areaPointMinutes),
        peakGap: round1(peakGap),
        peakGapHour: Number(peakGapHour),
    };
}

function buildMissionWindows(baseline: CurvePoint[], desired: CurvePoint[]): RevisionGapWindow[] {
    const maxDesiredGap = baseline.reduce((maxGap, point, idx) => {
        const desiredPoint = desired[idx];
        if (!desiredPoint) return maxGap;
        return Math.max(maxGap, Math.abs(Number(desiredPoint.value) - Number(point.value)));
    }, 0);
    const threshold = Math.max(MISSION_THRESHOLD_POINTS, maxDesiredGap * MISSION_THRESHOLD_RATIO);
    const desiredGapValues = baseline.map((point, idx) =>
        Math.abs(Number(desired[idx]?.value ?? point.value) - Number(point.value)),
    );

    const spans = filterWindowSpans(
        mergeWindowSpans(collectWindowSpans(desiredGapValues, threshold), MISSION_MERGE_GAP_MINUTES),
        MISSION_MIN_DURATION_MINUTES,
    );

    return spans.map(span => buildWindowSummary(desired, desiredGapValues, span));
}

function findMissionIndices(missionWindows: RevisionGapWindow[], points: CurvePoint[]): Set<number> {
    const indices = new Set<number>();
    if (missionWindows.length === 0) {
        points.forEach((_, idx) => indices.add(idx));
        return indices;
    }

    for (const window of missionWindows) {
        for (let idx = 0; idx < points.length; idx++) {
            const hour = Number(points[idx]?.hour ?? 0);
            if (hour >= window.startHour && hour <= window.endHour) {
                indices.add(idx);
            }
        }
    }
    return indices;
}

function summarizeTargetWindows(points: CurvePoint[], values: number[], maxCount: number): RevisionGapWindow[] {
    const spans = filterWindowSpans(
        mergeWindowSpans(collectWindowSpans(values, TARGET_GAP_THRESHOLD_POINTS), TARGET_MERGE_GAP_MINUTES),
        TARGET_MIN_DURATION_MINUTES,
    );

    return spans
        .map(span => buildWindowSummary(points, values, span))
        .sort((a, b) => b.areaPointMinutes - a.areaPointMinutes || b.peakGap - a.peakGap || a.startHour - b.startHour)
        .slice(0, maxCount);
}

function buildGapEffectSummary(
    baselineCurve: RevisionCurveSeries,
    desiredCurve: RevisionCurveSeries,
    currentCurve: RevisionCurveSeries,
): RevisionGapEffectSummary {
    const missionWindows = buildMissionWindows(baselineCurve.points, desiredCurve.points);
    const missionIndices = findMissionIndices(missionWindows, desiredCurve.points);
    const underTargetValues = desiredCurve.points.map((point, idx) => {
        if (!missionIndices.has(idx)) return 0;
        return Math.max(0, Number(point.value) - Number(currentCurve.points[idx]?.value ?? point.value));
    });
    const overTargetValues = desiredCurve.points.map((point, idx) => {
        if (!missionIndices.has(idx)) return 0;
        return Math.max(0, Number(currentCurve.points[idx]?.value ?? point.value) - Number(point.value));
    });
    const absoluteErrors = desiredCurve.points.map((point, idx) => ({
        hour: Number(point.hour),
        absoluteError: Math.abs(Number(currentCurve.points[idx]?.value ?? point.value) - Number(point.value)),
    }));

    let totalUnderArea = 0;
    let totalOverArea = 0;
    let worstPointGap: RevisionGapPoint = {
        hour: Number(desiredCurve.points[0]?.hour ?? PHASE_CHART.startHour),
        value: 0,
        kind: 'aligned' as const,
    };
    let bestAchievedAlignment = absoluteErrors[0] || {
        hour: PHASE_CHART.startHour,
        absoluteError: 0,
    };

    for (let idx = 0; idx < desiredCurve.points.length; idx++) {
        const under = underTargetValues[idx];
        const over = overTargetValues[idx];
        totalUnderArea += under * RESAMPLE_INTERVAL_MINUTES;
        totalOverArea += over * RESAMPLE_INTERVAL_MINUTES;

        if (under > worstPointGap.value) {
            worstPointGap = {
                hour: Number(desiredCurve.points[idx]?.hour ?? worstPointGap.hour),
                value: round1(under),
                kind: 'under',
            };
        }
        if (over > worstPointGap.value) {
            worstPointGap = {
                hour: Number(desiredCurve.points[idx]?.hour ?? worstPointGap.hour),
                value: round1(over),
                kind: 'over',
            };
        }
        if (absoluteErrors[idx] && absoluteErrors[idx].absoluteError < bestAchievedAlignment.absoluteError) {
            bestAchievedAlignment = absoluteErrors[idx];
        }
    }

    return {
        effect: desiredCurve.effect,
        polarity: desiredCurve.polarity,
        missionWindows,
        topUnderTargetWindows: summarizeTargetWindows(desiredCurve.points, underTargetValues, 3),
        topOverTargetWindows: summarizeTargetWindows(desiredCurve.points, overTargetValues, 2),
        totalUnderArea: round1(totalUnderArea),
        totalOverArea: round1(totalOverArea),
        worstPointGap,
        bestAchievedAlignment: {
            hour: Number(bestAchievedAlignment.hour),
            absoluteError: round1(bestAchievedAlignment.absoluteError),
        },
    };
}

export function buildRevisionGapSummary(
    baselineCurves: RevisionCurveSeries[],
    desiredCurves: RevisionCurveSeries[],
    currentLxCurves: RevisionCurveSeries[],
): RevisionGapSummary {
    const effects = desiredCurves.map((desiredCurve, curveIdx) =>
        buildGapEffectSummary(baselineCurves[curveIdx], desiredCurve, currentLxCurves[curveIdx] || desiredCurve),
    );

    return {
        effects,
        totalUnderArea: round1(effects.reduce((sum, effect) => sum + effect.totalUnderArea, 0)),
        totalOverArea: round1(effects.reduce((sum, effect) => sum + effect.totalOverArea, 0)),
    };
}

export function computeRevisionFitMetrics(
    baselineCurves: RevisionCurveSeries[],
    desiredCurves: RevisionCurveSeries[],
    currentLxCurves: RevisionCurveSeries[],
): RevisionFitMetrics {
    const gapSummary = buildRevisionGapSummary(baselineCurves, desiredCurves, currentLxCurves);

    return {
        totalUnderArea: gapSummary.totalUnderArea,
        totalOverArea: gapSummary.totalOverArea,
        totalAbsoluteArea: round1(gapSummary.totalUnderArea + gapSummary.totalOverArea),
        peakShortfall: round1(
            gapSummary.effects.reduce(
                (maxGap, effect) =>
                    Math.max(maxGap, effect.worstPointGap.kind === 'under' ? effect.worstPointGap.value : 0),
                0,
            ),
        ),
        peakOvershoot: round1(
            gapSummary.effects.reduce(
                (maxGap, effect) =>
                    Math.max(maxGap, effect.worstPointGap.kind === 'over' ? effect.worstPointGap.value : 0),
                0,
            ),
        ),
        effects: gapSummary.effects.map(effect => ({
            effect: effect.effect,
            totalUnderArea: effect.totalUnderArea,
            totalOverArea: effect.totalOverArea,
            worstPointGap: effect.worstPointGap.value,
            bestAchievedAlignment: effect.bestAchievedAlignment.absoluteError,
        })),
    };
}

export function buildRevisionReferenceBundle(options: BuildRevisionReferenceBundleOptions): RevisionReferenceBundle {
    const baselineCurves = options.curvesData.map(curve =>
        buildSeries(curve.effect, curve.polarity || 'higher_is_better', normalizeCurvePoints(curve.baseline)),
    );
    const desiredCurves = options.curvesData.map(curve =>
        buildSeries(curve.effect, curve.polarity || 'higher_is_better', normalizeCurvePoints(curve.desired)),
    );
    const currentLxCurves = options.curvesData.map((curve, curveIdx) => {
        const currentPoints = options.currentLxCurves?.[curveIdx]?.points;
        const fallbackPoints = baselineCurves[curveIdx]?.points || normalizeCurvePoints(curve.baseline);
        return buildSeries(
            curve.effect,
            curve.polarity || 'higher_is_better',
            currentPoints && currentPoints.length > 0 ? resampleOnly(currentPoints) : clonePoints(fallbackPoints),
        );
    });

    return {
        baselineCurves,
        desiredCurves,
        currentLxCurves,
        currentInterventions: cloneInterventions(options.currentInterventions),
        gapSummary: buildRevisionGapSummary(baselineCurves, desiredCurves, currentLxCurves),
        bioCorrectionApplied: options.bioCorrectionApplied,
    };
}

function pickEveryNthPoint(points: CurvePoint[], step: number): CurvePoint[] {
    if (points.length === 0) return [];
    const sampled = points.filter((_, idx) => idx % step === 0);
    const lastPoint = points[points.length - 1];
    if (!sampled.some(point => point.hour === lastPoint.hour)) {
        sampled.push(lastPoint);
    }
    return sampled;
}

function serializePoints(points: CurvePoint[]): Array<{ hour: number; value: number }> {
    return points.map(point => ({
        hour: round1(Number(point.hour)),
        value: round1(Number(point.value)),
    }));
}

function serializeWindow(window: RevisionGapWindow) {
    return {
        startHour: round1(window.startHour),
        endHour: round1(window.endHour),
        durationMinutes: Math.round(window.durationMinutes),
        areaPointMinutes: round1(window.areaPointMinutes),
        peakGap: round1(window.peakGap),
        peakGapHour: round1(window.peakGapHour),
    };
}

export function buildRevisionCurrentStateSummary(bundle: RevisionReferenceBundle) {
    return bundle.desiredCurves.map((desiredCurve, curveIdx) => ({
        effect: desiredCurve.effect,
        polarity: desiredCurve.polarity,
        baseline: serializePoints(
            pickEveryNthPoint(bundle.baselineCurves[curveIdx]?.points || [], PROMPT_DOWNSAMPLE_STEP),
        ),
        desired: serializePoints(pickEveryNthPoint(desiredCurve.points, PROMPT_DOWNSAMPLE_STEP)),
        currentLx: serializePoints(
            pickEveryNthPoint(bundle.currentLxCurves[curveIdx]?.points || [], PROMPT_DOWNSAMPLE_STEP),
        ),
    }));
}

export function buildRevisionPromptGapSummary(bundle: RevisionReferenceBundle) {
    return {
        bioCorrectionApplied: bundle.bioCorrectionApplied,
        totals: {
            totalUnderArea: round1(bundle.gapSummary.totalUnderArea),
            totalOverArea: round1(bundle.gapSummary.totalOverArea),
        },
        effects: bundle.gapSummary.effects.map(effect => ({
            effect: effect.effect,
            polarity: effect.polarity,
            missionWindows: effect.missionWindows.map(serializeWindow),
            topUnderTargetWindows: effect.topUnderTargetWindows.map(serializeWindow),
            topOverTargetWindows: effect.topOverTargetWindows.map(serializeWindow),
            totalUnderArea: round1(effect.totalUnderArea),
            totalOverArea: round1(effect.totalOverArea),
            worstPointGap: {
                hour: round1(effect.worstPointGap.hour),
                value: round1(effect.worstPointGap.value),
                kind: effect.worstPointGap.kind,
            },
            bestAchievedAlignment: {
                hour: round1(effect.bestAchievedAlignment.hour),
                absoluteError: round1(effect.bestAchievedAlignment.absoluteError),
            },
        })),
        optimizationPriority: [
            'Minimize totalUnderArea first.',
            'Then reduce the largest under-target windows inside mission windows.',
            'Avoid creating unnecessary overshoot outside the mission windows.',
        ],
    };
}

export function serializeRevisionInterventions(interventions: Intervention[]) {
    return interventions.map(iv => ({
        key: iv.key,
        dose: iv.dose,
        doseMultiplier: iv.doseMultiplier,
        timeMinutes: iv.timeMinutes,
        impacts: iv.impacts,
        bioTrigger: iv.bioTrigger,
        rationale: iv.rationale,
    }));
}
