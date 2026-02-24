// ============================================
// TIMELINE BUILDER
// ============================================
// Assembles all animation segments in correct temporal order
// and registers them with the TimelineEngine.

import type { TimelineEngine, SegmentContext } from './timeline-engine';
import { PHASE_SMOOTH_PASSES } from './constants';
import { smoothPhaseValues } from './curve-utils';
import { allocateTimelineLanes } from './lx-system';

// Segment factory imports
import {
    createPromptSlideSegment,
    createXAxisBuildSegment,
    createYAxesGridSegment,
    createGateSegment,
} from './timeline-segments/transition-segments';
import {
    createMainScanLineSegment,
    createScanLineFadeSegment,
    createTimelineScanLineSegment,
    createBioScanLineSegment,
} from './timeline-segments/scan-line-segments';
import {
    createWordCloudEntranceSegment,
    createOrbitalRingsSegment,
    createWordCloudDismissSegment,
    createRingsToCurvesMorphSegment,
} from './timeline-segments/word-cloud-segments';
import {
    createBaselineCurvesSegment,
    createBaselinePeakLabelsSegment,
    createMissionArrowsSegment,
    createMorphToDesiredSegment,
    createDesiredPeakLabelsSegment,
    createYAxisIndicatorsSegment,
} from './timeline-segments/curves-segments';
import {
    createTransmuteDesiredSegment,
    createLxCurvesInitSegment,
    createSubstanceSweepSegment,
    createSubstancePillSegment,
    createCinematicPlayheadSegment,
} from './timeline-segments/lx-segments';
import { createBiometricRevealSegment } from './timeline-segments/biometric-segments';
import {
    createRevisionEntrySegment,
    createLxMorphToRevisionSegment,
} from './timeline-segments/revision-segments';
import {
    createSherlockBeatSegment,
    createSherlockOutroSegment,
    createSherlockRevisionBeatSegment,
    createSherlockRevisionOutroSegment,
} from './timeline-segments/sherlock-segments';

// ============================================
// Phase 0: Setup + Word Cloud + Baseline
// ============================================

/**
 * Build Phase 0 segments: prompt slide, scan line, word cloud, baseline curves.
 * Called immediately when the prompt is submitted.
 * Returns the time cursor after the last known segment.
 */
export function buildPhase0Segments(engine: TimelineEngine): number {
    let t = 0;

    // 1. Prompt slide up (350ms)
    engine.addSegment(createPromptSlideSegment(t));
    t += 350;

    // 2. Main scan line (variable — runs until main model returns)
    engine.addSegment(createMainScanLineSegment(t, Infinity));
    // The scan line's end time will be resolved via resolveDuration()
    // We don't advance t here — subsequent segments will be added
    // when the LLM calls resolve.

    return t;
}

/**
 * After the fast model returns effects: add word cloud segments.
 * Called with the time at which the scan line is still running.
 */
export function addWordCloudSegments(
    engine: TimelineEngine,
    scanLineStartTime: number,
    wordCloudEffects: any[],
): number {
    // Word cloud entrance runs concurrently with the scan line
    const entranceDur = 1800 + (wordCloudEffects.length - 1) * 180;
    engine.addSegment(createWordCloudEntranceSegment(scanLineStartTime + 200, entranceDur));

    // Orbital rings run concurrently, also variable until main model returns
    engine.addSegment(createOrbitalRingsSegment(scanLineStartTime + 400, Infinity));

    // Return the time we started the word cloud (for reference)
    return scanLineStartTime + 200;
}

/**
 * After the main model returns curves: resolve scan line, add dismiss + baseline segments.
 * `scanLineDuration` is the actual elapsed ms of the scan line.
 */
export function addPostCurveSegments(
    engine: TimelineEngine,
    scanLineStartTime: number,
    scanLineDuration: number,
    hasWordCloud: boolean,
): number {
    // Resolve the main scan line's actual duration
    engine.resolveDuration('main-scan-line', scanLineDuration);

    let t = scanLineStartTime + scanLineDuration;

    // Scan line fade
    engine.addSegment(createScanLineFadeSegment(t));
    t += 400;

    if (hasWordCloud) {
        // Resolve orbital rings duration
        engine.resolveDuration('orbital-rings', scanLineDuration + 200);

        // Word cloud dismiss + ring morph (parallel)
        engine.addSegment(createWordCloudDismissSegment(t));
        engine.addSegment(createRingsToCurvesMorphSegment(t));
        t += 1400; // ring morph is 1400ms (longest of the two parallel)
    }

    // Y-axes + grid build
    engine.addSegment(createYAxesGridSegment(t));
    t += 50;

    // Baseline curves reveal
    engine.addSegment(createBaselineCurvesSegment(t));
    t += 1000;

    // X-axis build (after curves appear — post ring collapse)
    engine.addSegment(createXAxisBuildSegment(t));
    t += 50;

    // Baseline peak labels
    engine.addSegment(createBaselinePeakLabelsSegment(t));
    t += 500;

    return t;
}

// ============================================
// Phase 0 → 1: Optimize Gate + Desired Curves
// ============================================

/**
 * Add the Optimize gate and Phase 1 segments (arrows, morph to desired).
 */
export function buildPhase1Segments(engine: TimelineEngine, startTime: number): number {
    let t = startTime;

    // Gate: wait for Optimize button click
    engine.addSegment(createGateSegment('optimize-gate', 'Optimize', t, 0));
    engine.addGate('optimize-gate');

    // Mission arrows grow (concurrent with Y-axis indicators)
    engine.addSegment(createMissionArrowsSegment(t));

    // Y-axis transition indicators (keep/change arrows in axis margins) — concurrent with arrows
    engine.addSegment(createYAxisIndicatorsSegment(t));
    t += 400; // arrows start, morph begins with overlap

    // Morph baseline → desired
    engine.addSegment(createMorphToDesiredSegment(t));
    t += 1200;

    // Desired peak labels
    engine.addSegment(createDesiredPeakLabelsSegment(t));
    t += 500;

    return t;
}

// ============================================
// Phase 1 → 2: Intervention Gate + Lx Reveal
// ============================================

/**
 * Add timeline scan line (while waiting for intervention model).
 */
export function addTimelineScanLine(engine: TimelineEngine, startTime: number, laneCount: number): number {
    engine.addSegment(createTimelineScanLineSegment(startTime, Infinity, laneCount));
    return startTime;
}

/**
 * After intervention model returns: resolve scan line, add Lx segments.
 */
export function buildPhase2Segments(
    engine: TimelineEngine,
    startTime: number,
    tlScanLineDuration: number,
    interventions: any[],
    incrementalSnapshots: any[],
    curvesData: any[],
): number {
    // Resolve timeline scan line
    engine.resolveDuration('timeline-scan-line', tlScanLineDuration);

    let t = startTime + tlScanLineDuration;

    // Gate: wait for Play button click
    engine.addSegment(createGateSegment('play-gate', 'Play', t, 1));
    engine.addGate('play-gate');

    // Transmute desired curves to ghost
    engine.addSegment(createTransmuteDesiredSegment(t));
    t += 400;

    // Initialize Lx curves at baseline + timeline zone
    engine.addSegment(createLxCurvesInitSegment(t));
    t += 50;

    // Allocate timeline lanes for pill positioning
    const allocated = allocateTimelineLanes(interventions);

    // Per-substance segments: pill reveal + playhead sweep
    const sorted = [...interventions].sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);
    const GAP_BETWEEN_SUBSTANCES = 200; // ms gap between substance sweeps

    // Pre-compute smoothed baseline points as the starting state
    const baselinePts = curvesData.map((c: any) =>
        smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES));

    for (let k = 0; k < sorted.length; k++) {
        const substance = sorted[k];
        const snapshot = incrementalSnapshots[k];
        const prevSnapshot = k > 0 ? incrementalSnapshots[k - 1] : null;

        // Source points: previous step's Lx points (or baseline for first)
        const sourcePts = prevSnapshot
            ? prevSnapshot.lxCurves.map((lc: any) => lc.points)
            : baselinePts;

        // Target points: this step's Lx points
        const targetPts = snapshot.lxCurves.map((lc: any) => lc.points);

        // Per-substance gate (zero-width marker for Prev seek targets)
        engine.addSegment(createGateSegment(`substance-gate-${k}`, `Sub ${k + 1}`, t, 2));

        // Track beat start for Sherlock narration
        const beatStart = t;

        // Pill reveal (350ms)
        engine.addSegment(createSubstancePillSegment(
            t, k, substance, allocated, curvesData,
            snapshot.lxCurves,
        ));
        t += 350;

        // Substance sweep (variable duration based on step index)
        const sweepSeg = createSubstanceSweepSegment(
            t, k, substance, sourcePts, targetPts, curvesData,
        );
        engine.addSegment(sweepSeg);
        t += sweepSeg.duration + GAP_BETWEEN_SUBSTANCES;

        // Sherlock narration beat spans pill + sweep (concurrent)
        if (engine.getContext().sherlockNarration?.beats?.[k]) {
            engine.addSegment(createSherlockBeatSegment(beatStart, k, t - beatStart));
        }
    }

    // Sherlock outro (before cinematic playhead)
    if (engine.getContext().sherlockNarration?.outro) {
        engine.addSegment(createSherlockOutroSegment(t));
        t += 2500;
    }

    // Lx peak labels (via cinematic playhead morph)
    engine.addSegment(createCinematicPlayheadSegment(t));
    t += 4500;

    return t;
}

// ============================================
// Phase 2 → 3: Biometric Gate + Strips
// ============================================

/**
 * Add biometric scan line (while waiting for biometric model).
 */
export function addBioScanLine(engine: TimelineEngine, startTime: number, channelCount: number): number {
    engine.addSegment(createBioScanLineSegment(startTime, Infinity, channelCount));
    return startTime;
}

/**
 * After biometric model returns: add strip reveal segments.
 */
export function buildPhase3Segments(
    engine: TimelineEngine,
    startTime: number,
    bioScanLineDuration: number,
    stripCount: number,
): number {
    // Resolve bio scan line
    engine.resolveDuration('bio-scan-line', bioScanLineDuration);

    let t = startTime + bioScanLineDuration;

    // Gate: biometric trigger (phase 3 boundary)
    engine.addSegment(createGateSegment('biometric-gate', 'Biometric', t, 3));
    engine.addGate('biometric-gate');

    // Biometric strips reveal
    engine.addSegment(createBiometricRevealSegment(t, stripCount));
    const revealDur = 600 + (stripCount - 1) * 80;
    t += revealDur;

    return t;
}

// ============================================
// Phase 3 → 4: Revision Gate + Diff Animation
// ============================================

/**
 * Build revision segments from the diff entries.
 */
export function buildPhase4Segments(
    engine: TimelineEngine,
    startTime: number,
    diffEntries: any[],
): number {
    let t = startTime;

    // Gate: revision play
    engine.addSegment(createGateSegment('revision-gate', 'Revision', t, 3));
    engine.addGate('revision-gate');

    // Per diff entry: bracket lock-on + action + narration beat
    const ENTRY_GAP = 100;
    for (let i = 0; i < diffEntries.length; i++) {
        const entry = diffEntries[i];
        const seg = createRevisionEntrySegment(t, i, entry);
        engine.addSegment(seg);

        // Sherlock revision beat spans the bracket+action duration
        if (engine.getContext().sherlockRevisionNarration?.beats?.[i]) {
            engine.addSegment(createSherlockRevisionBeatSegment(t, i, seg.duration));
        }

        t += seg.duration + ENTRY_GAP;
    }

    // Sherlock revision outro (before Lx morph)
    if (engine.getContext().sherlockRevisionNarration?.outro) {
        engine.addSegment(createSherlockRevisionOutroSegment(t));
        t += 2500;
    }

    // Lx curves morph to revision
    engine.addSegment(createLxMorphToRevisionSegment(t));
    t += 1200;

    return t;
}
