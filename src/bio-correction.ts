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
import type { CurveData, CurvePoint, LxSnapshot } from './types';

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

/**
 * Animate baseline curves from original → bio-corrected positions,
 * and simultaneously morph Lx curves to match the new baseline.
 */
export async function animateBioCorrectionMorph(
    curvesData: CurveData[],
    correctedBaselines: CurvePoint[][],
    interventions: any[],
): Promise<{ newLxCurves: any[]; newIncrementalSnapshots: LxSnapshot[] | null }> {
    const baseGroup = document.getElementById('phase-baseline-curves');
    const lxGroup = document.getElementById('phase-lx-curves');
    const bandsGroup = document.getElementById('phase-lx-bands');
    const overlayGroup = document.getElementById('phase-tooltip-overlay');

    // Snapshot old baseline (smoothed, as rendered)
    const oldBaselines = curvesData.map(c => smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES));

    // Smooth the corrected baselines for rendering
    const newBaselines = correctedBaselines.map(bl => smoothPhaseValues(bl, PHASE_SMOOTH_PASSES));

    // Snapshot current Lx (from PhaseState)
    const oldLxCurves = PhaseState.lxCurves || [];
    const oldIncrementalSnapshots = PhaseState.incrementalSnapshots as LxSnapshot[] | null;

    // During biometric apply, preserve the current intervention delta and
    // rebase it onto the corrected baseline. Revision/Optimize is the step
    // that is allowed to renormalize the stack.
    let newLxCurves = rebaseLxCurveSet(oldLxCurves, oldBaselines, newBaselines, curvesData);
    let newIncrementalSnapshots = rebaseIncrementalSnapshots(
        oldIncrementalSnapshots,
        oldBaselines,
        newBaselines,
        curvesData,
    );

    if (!newLxCurves || !newIncrementalSnapshots) {
        const tempCurvesData = curvesData.map((curve, curveIdx) => ({
            ...curve,
            baseline: correctedBaselines[curveIdx],
        }));
        newLxCurves = computeLxOverlay(interventions, tempCurvesData);
        newIncrementalSnapshots = computeIncrementalLxOverlay(interventions, tempCurvesData) as LxSnapshot[];
    }

    // Get SVG path elements
    const baselineStrokes = baseGroup ? Array.from(baseGroup.querySelectorAll('.phase-baseline-path')) : [];
    const baselineFills = baseGroup
        ? Array.from(baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)'))
        : [];
    const lxStrokes = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-path')) : [];
    const lxFills = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-fill')) : [];
    const bandPaths = bandsGroup ? Array.from(bandsGroup.querySelectorAll('.lx-auc-band')) : [];
    const timelineDots = Array.from(document.querySelectorAll('.timeline-curve-dot'));
    const timelineConnectors = Array.from(document.querySelectorAll('.timeline-connector'));

    const MORPH_DURATION = 1500;

    await new Promise<void>(resolve => {
        const startTime = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / MORPH_DURATION);
            // Ease-in-out cubic
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

            for (let ci = 0; ci < curvesData.length; ci++) {
                // -- Morph baseline --
                const oldBl = oldBaselines[ci] || [];
                const newBl = newBaselines[ci] || [];
                const blLen = Math.min(oldBl.length, newBl.length);
                if (blLen > 0) {
                    const morphedBl = interpolatePointSeries(oldBl, newBl, ease);
                    const blPathD = phasePointsToPath(morphedBl, true);
                    const blFillD = phasePointsToFillPath(morphedBl, true);
                    if (baselineStrokes[ci]) baselineStrokes[ci].setAttribute('d', blPathD);
                    if (baselineFills[ci]) baselineFills[ci].setAttribute('d', blFillD);
                }

                // -- Morph Lx --
                const oldPts = (oldLxCurves as any)[ci]?.points || [];
                const newPts = newLxCurves[ci]?.points || [];
                const lxLen = Math.min(oldPts.length, newPts.length);
                if (lxLen > 0) {
                    const morphedLx = interpolatePointSeries(oldPts, newPts, ease);
                    if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(morphedLx, true));
                    if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphedLx, true));
                }
            }

            // Morph all persisted AUC bands so they remain the step delta between
            // the current source curve and the rebased target curve.
            bandPaths.forEach(band => {
                const stepIdx = parseInt(band.getAttribute('data-step-idx') || '-1', 10);
                const curveIdx = parseInt(band.getAttribute('data-curve-idx') || '-1', 10);
                if (stepIdx < 0 || curveIdx < 0) return;

                const oldSourcePts =
                    stepIdx === 0
                        ? oldBaselines[curveIdx]
                        : oldIncrementalSnapshots?.[stepIdx - 1]?.lxCurves?.[curveIdx]?.points;
                const oldTargetPts = oldIncrementalSnapshots?.[stepIdx]?.lxCurves?.[curveIdx]?.points;
                const newSourcePts =
                    stepIdx === 0
                        ? newBaselines[curveIdx]
                        : newIncrementalSnapshots?.[stepIdx - 1]?.lxCurves?.[curveIdx]?.points;
                const newTargetPts = newIncrementalSnapshots?.[stepIdx]?.lxCurves?.[curveIdx]?.points;
                if (!oldSourcePts || !oldTargetPts || !newSourcePts || !newTargetPts) return;

                const morphedSource = interpolatePointSeries(oldSourcePts, newSourcePts, ease);
                const morphedTarget = interpolatePointSeries(oldTargetPts, newTargetPts, ease);
                const bandD = phaseBandPath(morphedTarget, morphedSource);
                if (bandD) band.setAttribute('d', bandD);
            });

            // Timeline anchors should track the currently morphed final Lx curve.
            timelineDots.forEach(dot => {
                const curveIdx = parseInt(dot.getAttribute('data-curve-idx') || '-1', 10);
                const timeH = parseFloat(dot.getAttribute('data-time-h') || 'NaN');
                if (curveIdx < 0 || Number.isNaN(timeH)) return;
                const oldPts = (oldLxCurves as any)[curveIdx]?.points || [];
                const newPts = newLxCurves[curveIdx]?.points || [];
                if (oldPts.length === 0 || newPts.length === 0) return;
                const morphedPts = interpolatePointSeries(oldPts, newPts, ease);
                dot.setAttribute('cy', phaseChartY(interpolatePointsAtTime(morphedPts, timeH)).toFixed(1));
            });

            timelineConnectors.forEach(connector => {
                const curveIdx = parseInt(connector.getAttribute('data-curve-idx') || '-1', 10);
                const timeH = parseFloat(connector.getAttribute('data-time-h') || 'NaN');
                if (curveIdx < 0 || Number.isNaN(timeH)) return;
                const oldPts = (oldLxCurves as any)[curveIdx]?.points || [];
                const newPts = newLxCurves[curveIdx]?.points || [];
                if (oldPts.length === 0 || newPts.length === 0) return;
                const morphedPts = interpolatePointSeries(oldPts, newPts, ease);
                connector.setAttribute('y1', phaseChartY(interpolatePointsAtTime(morphedPts, timeH)).toFixed(1));
            });

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                if (baseGroup) baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
                if (overlayGroup) overlayGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
                const lxCurvesForLabels = curvesData.map((curve, curveIdx) => ({
                    ...curve,
                    baseline: correctedBaselines[curveIdx] || curve.baseline,
                    desired: newLxCurves[curveIdx]?.points || [],
                }));
                if (baseGroup) {
                    placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
                }
                resolve();
            }
        })(performance.now());
    });

    return { newLxCurves, newIncrementalSnapshots };
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
) {
    if (!curvesData) {
        console.warn('[StrategistBio] No curvesData, skipping bio-correction');
        return;
    }

    console.log('[StrategistBio] Starting bio-correction phase...');

    try {
        // Use pre-fired promise or fire now
        const resultPromise = strategistBioPromise || callStrategistBioModel(userGoal, curvesData);
        const result = await resultPromise;

        console.log('[StrategistBio] LLM response received:', result);

        // Validate corrected baselines
        const correctedBaselines = validateCorrectedBaselines(result, curvesData);
        if (!correctedBaselines) {
            console.warn('[StrategistBio] Validation failed, proceeding with original baselines');
            return;
        }

        // Get current interventions for Lx recomputation
        const currentInterventions = extractInterventionsData(PhaseState.interventionResult);
        const validatedIvs = validateInterventions(JSON.parse(JSON.stringify(currentInterventions)), curvesData);

        // Animate bio-correction morph (baseline + Lx shift simultaneously)
        const { newLxCurves, newIncrementalSnapshots } = await animateBioCorrectionMorph(
            curvesData,
            correctedBaselines,
            validatedIvs,
        );

        // Update curvesData baselines with corrected values
        for (let i = 0; i < curvesData.length; i++) {
            if (correctedBaselines[i]) {
                curvesData[i].baseline = correctedBaselines[i];
            }
        }

        // Update state
        PhaseState.lxCurves = newLxCurves;
        PhaseState.incrementalSnapshots = newIncrementalSnapshots;
        PhaseState.phase = 'bio-corrected';
        MultiDayState.bioCorrectedBaseline = correctedBaselines;
        if (TimelineState.engine) {
            const ctx = TimelineState.engine.getContext();
            ctx.curvesData = curvesData;
            ctx.lxCurves = newLxCurves;
            ctx.incrementalSnapshots = newIncrementalSnapshots;
        }

        console.log('[StrategistBio] Bio-correction complete');
    } catch (err: any) {
        console.error('[StrategistBio] Error:', err.message);
        reportRuntimeBug({ stage: 'strategistBio', message: `Bio-correction failed: ${err.message}` });
    }
}
