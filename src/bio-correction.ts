/**
 * Bio-Correction — Strategist Bio phase: adjusts baseline curves based on biometric evidence.
 * Exports: handleBioCorrectionPhase, animateBioCorrectionMorph
 * Depends on: state, llm-pipeline, lx-system, curve-utils, biometric (handleRevisionPhase)
 */
import { PhaseState, MultiDayState, TimelineState } from './state';
import { callStrategistBioModel } from './llm-pipeline';
import { extractInterventionsData } from './llm-response-shape';
import { computeIncrementalLxOverlay, computeLxOverlay, validateInterventions } from './lx-system';
import {
    interpolatePointArrays,
    interpolatePointsAtTime,
    phaseBandPath,
    phasePointsToFillPath,
    phasePointsToPath,
    smoothPhaseValues,
} from './curve-utils';
import { PHASE_SMOOTH_PASSES } from './constants';
import { phaseChartY, clamp } from './utils';
import { placePeakDescriptors } from './phase-chart';
import { reportRuntimeBug } from './runtime-error-banner';
import { syncGamificationOverlayFrame } from './gamification-overlay';
import { getRuntimeReplaySnapshot, isRuntimeReplayActive, recordBioCorrectedReplayState } from './replay-snapshot';
import type { CurveData, CurvePoint, LxSnapshot } from './types';
import type { BiometricRuntime } from './biometric';

export const BIO_CORRECTION_MORPH_MS = 1500;

interface BioCorrectionFrameInput {
    oldBaselines: CurvePoint[][];
    newBaselines: CurvePoint[][];
    oldLxCurves: any[] | null;
    newLxCurves: any[];
    oldIncrementalSnapshots: LxSnapshot[] | null;
    newIncrementalSnapshots: LxSnapshot[] | null;
}

interface PreparedBioCorrectionState {
    correctedBaselines: CurvePoint[][];
    correctedCurvesData: CurveData[];
    newLxCurves: any[];
    newIncrementalSnapshots: LxSnapshot[] | null;
    frameInput: BioCorrectionFrameInput;
}

interface BioCorrectionFrameData {
    baselines: CurvePoint[][];
    lxCurves: any[];
}

function clonePoints(points: CurvePoint[]): CurvePoint[] {
    return (points || []).map(point => ({
        hour: Number(point.hour),
        value: Number(point.value),
    }));
}

const interpolatePointSeries = interpolatePointArrays;

function rebaseCurvePoints(
    oldBaseline: CurvePoint[],
    newBaseline: CurvePoint[],
    curvePoints: CurvePoint[],
): CurvePoint[] {
    const len = Math.min(oldBaseline.length, newBaseline.length, curvePoints.length);
    const rebased: CurvePoint[] = [];
    for (let i = 0; i < len; i++) {
        const preservedDelta = curvePoints[i].value - oldBaseline[i].value;
        rebased.push({
            hour: Number(newBaseline[i].hour),
            value: clamp(newBaseline[i].value + preservedDelta, 0, 100),
        });
    }
    return rebased;
}

function computeMaxDesiredGap(baseline: CurvePoint[], desired: CurvePoint[]): number {
    const len = Math.min(baseline.length, desired.length);
    let maxDesiredGap = 1;
    for (let i = 0; i < len; i++) {
        maxDesiredGap = Math.max(maxDesiredGap, Math.abs(desired[i].value - baseline[i].value));
    }
    return maxDesiredGap;
}

function rebaseLxCurveSet(
    sourceCurves: any[] | null | undefined,
    oldBaselines: CurvePoint[][],
    newBaselines: CurvePoint[][],
    curvesData: CurveData[],
): any[] | null {
    if (!Array.isArray(sourceCurves) || sourceCurves.length !== curvesData.length) return null;

    const desiredFallback = curvesData.map(curve => smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES));

    const rebased = sourceCurves.map((curve, curveIdx) => {
        const oldBaseline = oldBaselines[curveIdx] || [];
        const newBaseline = newBaselines[curveIdx] || [];
        const sourcePoints = curve?.points || [];
        const desiredPoints =
            Array.isArray(curve?.desired) && curve.desired.length > 0
                ? clonePoints(curve.desired)
                : clonePoints(desiredFallback[curveIdx] || []);

        if (oldBaseline.length === 0 || newBaseline.length === 0 || sourcePoints.length === 0) {
            return null;
        }

        const points = rebaseCurvePoints(oldBaseline, newBaseline, sourcePoints);
        const baseline = clonePoints(newBaseline);

        return {
            ...curve,
            baseline,
            desired: desiredPoints,
            points,
            polarity: curve?.polarity || curvesData[curveIdx]?.polarity || 'higher_is_better',
            maxDesiredGap: computeMaxDesiredGap(baseline, desiredPoints),
        };
    });

    return rebased.every(Boolean) ? rebased : null;
}

function rebaseIncrementalSnapshots(
    oldSnapshots: LxSnapshot[] | null | undefined,
    oldBaselines: CurvePoint[][],
    newBaselines: CurvePoint[][],
    curvesData: CurveData[],
): LxSnapshot[] | null {
    if (!Array.isArray(oldSnapshots) || oldSnapshots.length === 0) return null;

    const rebasedSnapshots = oldSnapshots.map(snapshot => {
        const rebasedCurves = rebaseLxCurveSet(snapshot?.lxCurves, oldBaselines, newBaselines, curvesData);
        if (!rebasedCurves) return null;
        return {
            step: snapshot.step || [],
            lxCurves: rebasedCurves,
        };
    });

    return rebasedSnapshots.every(Boolean) ? (rebasedSnapshots as LxSnapshot[]) : null;
}

function cloneCurvesDataWithBaselines(curvesData: CurveData[], baselines: CurvePoint[][]): CurveData[] {
    return curvesData.map((curve, curveIdx) => ({
        ...curve,
        baseline: clonePoints(baselines[curveIdx] || curve.baseline || []),
        desired: clonePoints(curve.desired || []),
    }));
}

function interpolateSeriesSafely(source: CurvePoint[], target: CurvePoint[], progress: number): CurvePoint[] {
    if (source.length > 0 && target.length > 0) {
        return interpolatePointSeries(source, target, progress);
    }
    return clonePoints((progress >= 1 ? target : source) || target || source || []);
}

export function computeBioCorrectionFrameData(
    input: BioCorrectionFrameInput,
    progress: number,
): BioCorrectionFrameData {
    const t = clamp(progress, 0, 1);
    const baselines = input.newBaselines.map((newBaseline, curveIdx) =>
        interpolateSeriesSafely(input.oldBaselines[curveIdx] || [], newBaseline || [], t),
    );

    const curveCount = Math.max(input.newLxCurves.length, input.oldLxCurves?.length || 0, baselines.length);
    const lxCurves = Array.from({ length: curveCount }, (_, curveIdx) => {
        const sourceCurve = input.oldLxCurves?.[curveIdx] || input.newLxCurves[curveIdx] || null;
        const targetCurve = input.newLxCurves[curveIdx] || sourceCurve || null;
        const sourcePoints = sourceCurve?.points || [];
        const targetPoints = targetCurve?.points || [];
        const points = interpolateSeriesSafely(sourcePoints, targetPoints, t);
        const baseline = baselines[curveIdx] || clonePoints(targetCurve?.baseline || sourceCurve?.baseline || []);
        const desired =
            Array.isArray(targetCurve?.desired) && targetCurve.desired.length > 0
                ? clonePoints(targetCurve.desired)
                : clonePoints(sourceCurve?.desired || []);

        return {
            ...sourceCurve,
            ...targetCurve,
            baseline,
            desired,
            points,
        };
    });

    return { baselines, lxCurves };
}

function clearPeakDescriptors(group: Element | null): void {
    group?.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
}

export function finalizeBioCorrectionPeakDescriptors(correctedCurvesData: CurveData[], correctedLxCurves: any[]): void {
    if (typeof document === 'undefined') return;
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const overlayGroup = document.getElementById('phase-tooltip-overlay');

    clearPeakDescriptors(baseGroup);
    clearPeakDescriptors(desiredGroup);
    clearPeakDescriptors(overlayGroup);

    if (!baseGroup) return;
    const lxCurvesForLabels = correctedCurvesData.map((curve, curveIdx) => ({
        ...curve,
        desired: correctedLxCurves[curveIdx]?.points || [],
    }));
    placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
    baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
        el.setAttribute('opacity', '0.85');
    });
}

export function restorePreBioCorrectionPeakDescriptors(curvesData: CurveData[]): void {
    if (typeof document === 'undefined') return;
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const overlayGroup = document.getElementById('phase-tooltip-overlay');

    clearPeakDescriptors(baseGroup);
    clearPeakDescriptors(overlayGroup);
    if (!desiredGroup) return;
    clearPeakDescriptors(desiredGroup);
    placePeakDescriptors(desiredGroup, curvesData, 'desired', 0);
    desiredGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
        el.setAttribute('opacity', '0.85');
    });
}

function prepareBioCorrectionState(
    curvesData: CurveData[],
    correctedBaselines: CurvePoint[][],
    interventions: any[],
): PreparedBioCorrectionState {
    const oldBaselines = curvesData.map(curve => smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES));
    const newBaselines = correctedBaselines.map(baseline => smoothPhaseValues(baseline, PHASE_SMOOTH_PASSES));
    const correctedCurvesData = cloneCurvesDataWithBaselines(curvesData, correctedBaselines);

    const oldLxCurves = PhaseState.lxCurves || [];
    const oldIncrementalSnapshots = PhaseState.incrementalSnapshots as LxSnapshot[] | null;

    let newLxCurves = rebaseLxCurveSet(oldLxCurves, oldBaselines, newBaselines, curvesData);
    let newIncrementalSnapshots = rebaseIncrementalSnapshots(
        oldIncrementalSnapshots,
        oldBaselines,
        newBaselines,
        curvesData,
    );

    if (!newLxCurves || !newIncrementalSnapshots) {
        newLxCurves = computeLxOverlay(interventions, correctedCurvesData);
        newIncrementalSnapshots = computeIncrementalLxOverlay(interventions, correctedCurvesData) as LxSnapshot[];
    }

    return {
        correctedBaselines: correctedBaselines.map(clonePoints),
        correctedCurvesData,
        newLxCurves,
        newIncrementalSnapshots,
        frameInput: {
            oldBaselines,
            newBaselines,
            oldLxCurves,
            newLxCurves,
            oldIncrementalSnapshots,
            newIncrementalSnapshots,
        },
    };
}

export function renderBioCorrectionFrame(
    input: BioCorrectionFrameInput,
    curvesData: CurveData[],
    progress: number,
): BioCorrectionFrameData {
    const frame = computeBioCorrectionFrameData(input, progress);
    const baseGroup = typeof document !== 'undefined' ? document.getElementById('phase-baseline-curves') : null;
    const lxGroup = typeof document !== 'undefined' ? document.getElementById('phase-lx-curves') : null;
    const bandsGroup = typeof document !== 'undefined' ? document.getElementById('phase-lx-bands') : null;

    const baselineStrokes = baseGroup ? Array.from(baseGroup.querySelectorAll('.phase-baseline-path')) : [];
    const baselineFills = baseGroup
        ? Array.from(baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)'))
        : [];
    const lxStrokes = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-path')) : [];
    const lxFills = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-fill')) : [];
    const bandPaths = bandsGroup ? Array.from(bandsGroup.querySelectorAll('.lx-auc-band')) : [];
    const timelineDots =
        typeof document !== 'undefined' ? Array.from(document.querySelectorAll('.timeline-curve-dot')) : [];
    const timelineConnectors =
        typeof document !== 'undefined' ? Array.from(document.querySelectorAll('.timeline-connector')) : [];

    for (let curveIdx = 0; curveIdx < frame.baselines.length; curveIdx++) {
        const baselinePoints = frame.baselines[curveIdx] || [];
        const lxPoints = frame.lxCurves[curveIdx]?.points || [];
        if (baselinePoints.length > 0) {
            const baselinePath = phasePointsToPath(baselinePoints, true);
            const baselineFill = phasePointsToFillPath(baselinePoints, true);
            if (baselineStrokes[curveIdx] && baselinePath) baselineStrokes[curveIdx].setAttribute('d', baselinePath);
            if (baselineFills[curveIdx] && baselineFill) baselineFills[curveIdx].setAttribute('d', baselineFill);
        }
        if (lxPoints.length > 0) {
            const lxPath = phasePointsToPath(lxPoints, true);
            const lxFill = phasePointsToFillPath(lxPoints, true);
            if (lxStrokes[curveIdx] && lxPath) lxStrokes[curveIdx].setAttribute('d', lxPath);
            if (lxFills[curveIdx] && lxFill) lxFills[curveIdx].setAttribute('d', lxFill);
        }
    }

    bandPaths.forEach((band: any) => {
        const stepIdx = parseInt(band.getAttribute('data-step-idx') || '-1', 10);
        const curveIdx = parseInt(band.getAttribute('data-curve-idx') || '-1', 10);
        if (stepIdx < 0 || curveIdx < 0) return;

        const oldSourcePts =
            stepIdx === 0
                ? input.oldBaselines[curveIdx]
                : input.oldIncrementalSnapshots?.[stepIdx - 1]?.lxCurves?.[curveIdx]?.points;
        const oldTargetPts = input.oldIncrementalSnapshots?.[stepIdx]?.lxCurves?.[curveIdx]?.points;
        const newSourcePts =
            stepIdx === 0
                ? input.newBaselines[curveIdx]
                : input.newIncrementalSnapshots?.[stepIdx - 1]?.lxCurves?.[curveIdx]?.points;
        const newTargetPts = input.newIncrementalSnapshots?.[stepIdx]?.lxCurves?.[curveIdx]?.points;
        if (!oldSourcePts || !oldTargetPts || !newSourcePts || !newTargetPts) return;

        const morphedSource = interpolateSeriesSafely(oldSourcePts, newSourcePts, progress);
        const morphedTarget = interpolateSeriesSafely(oldTargetPts, newTargetPts, progress);
        const bandPath = phaseBandPath(morphedTarget, morphedSource);
        if (bandPath) band.setAttribute('d', bandPath);
    });

    timelineDots.forEach((dot: any) => {
        const curveIdx = parseInt(dot.getAttribute('data-curve-idx') || '-1', 10);
        const timeH = parseFloat(dot.getAttribute('data-time-h') || 'NaN');
        if (curveIdx < 0 || Number.isNaN(timeH) || !frame.lxCurves[curveIdx]?.points?.length) return;
        dot.setAttribute('cy', phaseChartY(interpolatePointsAtTime(frame.lxCurves[curveIdx].points, timeH)).toFixed(1));
    });

    timelineConnectors.forEach((connector: any) => {
        const curveIdx = parseInt(connector.getAttribute('data-curve-idx') || '-1', 10);
        const timeH = parseFloat(connector.getAttribute('data-time-h') || 'NaN');
        if (curveIdx < 0 || Number.isNaN(timeH) || !frame.lxCurves[curveIdx]?.points?.length) return;
        connector.setAttribute(
            'y1',
            phaseChartY(interpolatePointsAtTime(frame.lxCurves[curveIdx].points, timeH)).toFixed(1),
        );
    });

    syncGamificationOverlayFrame(frame.lxCurves, curvesData, 'phase2', {
        immediate: true,
        entranceProgress: 1,
    });

    return frame;
}

/**
 * Animate baseline curves from original → bio-corrected positions,
 * and simultaneously morph Lx curves to match the new baseline.
 */
export async function animateBioCorrectionMorph(
    prepared: PreparedBioCorrectionState,
    curvesData: CurveData[],
): Promise<{ correctedCurvesData: CurveData[]; newLxCurves: any[]; newIncrementalSnapshots: LxSnapshot[] | null }> {
    await new Promise<void>(resolve => {
        const safetyTimer = setTimeout(resolve, BIO_CORRECTION_MORPH_MS + 3000);
        const startTime = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / BIO_CORRECTION_MORPH_MS);
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
            renderBioCorrectionFrame(prepared.frameInput, curvesData, ease);

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                renderBioCorrectionFrame(prepared.frameInput, curvesData, 1);
                finalizeBioCorrectionPeakDescriptors(prepared.correctedCurvesData, prepared.newLxCurves);
                clearTimeout(safetyTimer);
                resolve();
            }
        })(performance.now());
    });

    return {
        correctedCurvesData: prepared.correctedCurvesData,
        newLxCurves: prepared.newLxCurves,
        newIncrementalSnapshots: prepared.newIncrementalSnapshots,
    };
}

/**
 * Validate bio-corrected baselines from the LLM response.
 * Returns an array of CurvePoint[][] matching curvesData order,
 * or null if validation fails.
 */
function validateCorrectedBaselines(result: any, curvesData: CurveData[]): CurvePoint[][] | null {
    if (!result || !Array.isArray(result.correctedBaselines)) {
        console.warn('[StrategistBio] Missing correctedBaselines array');
        reportRuntimeBug({ stage: 'strategistBio', message: 'Missing correctedBaselines array in LLM response' });
        return null;
    }

    const corrected: CurvePoint[][] = [];
    for (const curve of curvesData) {
        const match =
            result.correctedBaselines.find(
                (cb: any) => cb.effect && cb.effect.toLowerCase() === curve.effect.toLowerCase(),
            ) ||
            result.correctedBaselines.find(
                (cb: any) =>
                    cb.effect &&
                    (curve.effect.toLowerCase().includes(cb.effect.toLowerCase()) ||
                        cb.effect.toLowerCase().includes(curve.effect.toLowerCase())),
            );

        if (!match || !Array.isArray(match.baseline) || match.baseline.length < 10) {
            console.warn(`[StrategistBio] No valid corrected baseline for "${curve.effect}", using original`);
            corrected.push([...curve.baseline]);
            continue;
        }

        // Clamp values to 0-100
        const clamped = match.baseline.map((p: any) => ({
            hour: Number(p.hour),
            value: clamp(Number(p.value), 0, 100),
        }));
        corrected.push(clamped);
    }

    return corrected;
}

/**
 * Orchestrate the bio-correction phase:
 * 1. Call Strategist Bio LLM
 * 2. Validate corrected baselines
 * 3. Animate bio-correction morph
 * 4. Update state
 *
 * Does NOT chain to revision — caller decides what happens next.
 */
export async function handleBioCorrectionPhase(
    curvesData: CurveData[] | null,
    userGoal: string,
    strategistBioPromise?: Promise<any> | null,
    runtime?: Pick<BiometricRuntime, 'onBioCorrectionStart' | 'onBioCorrectionStop' | 'onBioCorrectionAbort'>,
) {
    if (!curvesData) {
        console.warn('[StrategistBio] No curvesData, skipping bio-correction');
        return;
    }

    console.log('[StrategistBio] Starting bio-correction phase...');
    let bioCorrectionStarted = false;

    try {
        const replaySnapshot = isRuntimeReplayActive() ? getRuntimeReplaySnapshot() : null;
        const replayCurves = replaySnapshot?.bioCorrected?.curvesData;

        let correctedBaselines =
            replayCurves && replayCurves.length === curvesData.length
                ? replayCurves.map(curve => clonePoints(curve?.baseline || []))
                : null;

        if (!correctedBaselines) {
            // Use pre-fired promise or fire now
            const resultPromise = strategistBioPromise || callStrategistBioModel(userGoal, curvesData);
            const result = await resultPromise;

            console.log('[StrategistBio] LLM response received:', result);

            // Validate corrected baselines
            correctedBaselines = validateCorrectedBaselines(result, curvesData);
        }

        if (!correctedBaselines) {
            console.warn('[StrategistBio] Validation failed, proceeding with original baselines');
            return;
        }

        // Get current interventions for Lx recomputation
        const currentInterventions = extractInterventionsData(PhaseState.interventionResult);
        const validatedIvs = validateInterventions(JSON.parse(JSON.stringify(currentInterventions)), curvesData);

        const prepared = prepareBioCorrectionState(curvesData, correctedBaselines, validatedIvs);
        if (TimelineState.engine) {
            const ctx = TimelineState.engine.getContext();
            ctx.bioCorrectedCurvesData = prepared.correctedCurvesData;
            ctx.bioCorrectedLxCurves = prepared.newLxCurves;
            ctx.bioCorrectedIncrementalSnapshots = prepared.newIncrementalSnapshots;
        }

        runtime?.onBioCorrectionStart();
        bioCorrectionStarted = true;

        // Animate bio-correction morph (baseline + Lx shift simultaneously)
        const { correctedCurvesData, newLxCurves, newIncrementalSnapshots } = await animateBioCorrectionMorph(
            prepared,
            curvesData,
        );

        // Update state
        PhaseState.curvesData = correctedCurvesData;
        PhaseState.lxCurves = newLxCurves;
        PhaseState.incrementalSnapshots = newIncrementalSnapshots;
        PhaseState.phase = 'bio-corrected';
        MultiDayState.bioCorrectedBaseline = prepared.correctedBaselines;
        recordBioCorrectedReplayState({
            curvesData: correctedCurvesData,
            lxCurves: newLxCurves,
            incrementalSnapshots: newIncrementalSnapshots,
        });
        runtime?.onBioCorrectionStop();
        bioCorrectionStarted = false;

        console.log('[StrategistBio] Bio-correction complete');
    } catch (err: any) {
        if (bioCorrectionStarted) {
            runtime?.onBioCorrectionAbort();
        }
        console.error('[StrategistBio] Error:', err.message);
        reportRuntimeBug({ stage: 'strategistBio', message: `Bio-correction failed: ${err.message}` });
    }
}

export const __testing = {
    computeBioCorrectionFrameData,
};
