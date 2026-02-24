import '../styles.css';

import { PHASE_CHART } from './constants';
import { AppState, PhaseState, DividerState, TimelineState, syncStageModelsForProvider } from './state';
import { sleep } from './utils';
import { chartTheme } from './utils';
import { injectPhaseChartDeps, startBioScanLine, stopBioScanLine } from './phase-chart';
import { injectLxDeps, cleanupMorphDrag } from './lx-system';
import {
    stopOrbitalRings, _orbitalRingsState, setOrbitalRingsState,
    _wordCloudPositions, setWordCloudPositions,
    startOrbitalRings, renderWordCloud, dismissWordCloud, morphRingsToCurves,
} from './word-cloud';
import {
    clearPromptError, showPromptError, resetPhaseChart,
    buildPhaseXAxis, buildPhaseYAxes, buildPhaseGrid,
    startScanLine, stopScanLine,
    renderBaselineCurvesInstant, renderBaselineCurves,
    renderPhaseLegend, morphToDesiredCurves,
    startTimelineScanLine, stopTimelineScanLine,
} from './phase-chart';
import { callFastModel, callMainModelForCurves, callInterventionModel, callSherlockModel } from './llm-pipeline';
import {
    validateInterventions, computeIncrementalLxOverlay,
    animateSequentialLxReveal,
} from './lx-system';
import { showBiometricTrigger, showInterventionPlayButton, showInterventionPlayButtonLoading, hideInterventionPlayButton, setInterventionPlayClickHandler, showBiometricOnVcrPanel, hideRevisionPlayButton, injectBiometricDeps, renderBiometricStrips } from './biometric';
import { BiometricState, RevisionState, SherlockState } from './state';
import { clearNarration, showNarrationPanel, showNarrationLoading, hideNarrationPanel, showLxStepControls, triggerLxPlay } from './sherlock';
import { cleanupBaselineEditor } from './baseline-editor';
import { DebugLog } from './debug-panel';

// Timeline engine imports
import { TimelineEngine } from './timeline-engine';
import { TimelineRibbon } from './timeline-ribbon';
import {
    buildPhase0Segments, addWordCloudSegments,
    addPostCurveSegments, buildPhase1Segments,
    addTimelineScanLine, buildPhase2Segments,
    addBioScanLine, buildPhase3Segments,
    buildPhase4Segments,
} from './timeline-builder';

declare const BIOMETRIC_DEVICES: any;
const HARD_RESET_PENDING_PROMPT_KEY = 'cortex_pending_prompt_after_hard_reset_v1';

type PendingPromptPayload = {
    prompt: string;
    rxMode?: 'off' | 'rx' | 'rx-only';
    timestamp: number;
};

function storePendingPromptForHardReset(prompt: string): void {
    const payload: PendingPromptPayload = {
        prompt,
        rxMode: AppState.rxMode,
        timestamp: Date.now(),
    };
    try {
        sessionStorage.setItem(HARD_RESET_PENDING_PROMPT_KEY, JSON.stringify(payload));
    } catch {
        // Ignore storage failures; fallback is normal reload without auto-submit.
    }
}

function consumePendingPromptAfterHardReset(): PendingPromptPayload | null {
    try {
        const raw = sessionStorage.getItem(HARD_RESET_PENDING_PROMPT_KEY);
        if (!raw) return null;
        sessionStorage.removeItem(HARD_RESET_PENDING_PROMPT_KEY);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.prompt !== 'string') return null;
        return parsed as PendingPromptPayload;
    } catch {
        return null;
    }
}

// ============================================
// Dependency Injection Wiring
// ============================================

injectPhaseChartDeps({ stopOrbitalRings, setOrbitalRingsState, setWordCloudPositions, cleanupMorphDrag, hideBiometricTrigger: () => { try { (document.getElementById('biometric-trigger') as any)?.classList.add('hidden'); } catch { } }, hideInterventionPlayButton, hideRevisionPlayButton, BiometricState, RevisionState } as any);
injectLxDeps({ renderBiometricStrips });

function extractSherlockBeatText(beat: any): string {
    if (typeof beat === 'string') return beat.trim();
    if (!beat || typeof beat !== 'object') return '';
    const candidates = [beat.text, beat.line, beat.narration, beat.message];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return '';
}

function fallbackSherlockBeat(iv: any): string {
    const substanceName = iv?.substance?.name || iv?.key || 'This move';
    const rationale = typeof iv?.rationale === 'string' ? iv.rationale.trim() : '';
    if (rationale) return rationale;

    const impacts = iv?.impacts && typeof iv.impacts === 'object'
        ? Object.entries(iv.impacts)
            .map(([key, value]) => ({ key, abs: Math.abs(Number(value) || 0) }))
            .sort((a, b) => b.abs - a.abs)
        : [];
    const topImpact = impacts[0]?.key;

    if (topImpact) {
        return `${topImpact} is the pressure point. ${substanceName} is deployed to correct it.`;
    }
    return `${substanceName} is now positioned to reinforce the target state.`;
}

function normalizeSherlockNarration(raw: any, interventions: any[], enabled: boolean): any {
    const base = (raw && typeof raw === 'object') ? raw : {};
    const rawBeats = Array.isArray(base.beats) ? base.beats : [];

    let beats = rawBeats
        .map((beat: any, idx: number) => {
            const text = extractSherlockBeatText(beat);
            if (!text) return null;
            const substanceKey = (beat && typeof beat === 'object' && typeof beat.substanceKey === 'string')
                ? beat.substanceKey
                : interventions[idx]?.key;
            if (beat && typeof beat === 'object') {
                return { ...beat, text, substanceKey };
            }
            return { substanceKey, text };
        })
        .filter(Boolean);

    if (beats.length === 0 && enabled && interventions.length > 0) {
        beats = interventions.map((iv: any) => ({
            substanceKey: iv?.key,
            text: fallbackSherlockBeat(iv),
        }));
    }

    if (beats.length === 0) return null;

    const outro = typeof base.outro === 'string' && base.outro.trim().length > 0
        ? base.outro.trim()
        : 'Route locked. Execute the protocol.';

    return { ...base, beats, outro };
}

function isCurveLike(item: any): boolean {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.effect !== 'string' || item.effect.trim().length === 0) return false;
    if (!Array.isArray(item.baseline) || !Array.isArray(item.desired)) return false;
    return true;
}

function extractCurvesData(raw: any): any[] {
    if (Array.isArray(raw)) {
        const arr = raw.filter(isCurveLike);
        if (arr.length > 0) return arr;
    }

    if (!raw || typeof raw !== 'object') return [];

    const candidates = [raw.curves, raw.data, raw.pharmacodynamic_curves];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            const arr = candidate.filter(isCurveLike);
            if (arr.length > 0) return arr;
        }
    }

    if (isCurveLike(raw)) return [raw];

    // Fallback: occasionally providers wrap curve objects under dynamic keys.
    const objectValues = Object.values(raw);
    const flatCurves = objectValues.filter(isCurveLike) as any[];
    if (flatCurves.length > 0) return flatCurves;

    return [];
}

function parseInterventionTime(value: any): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;

    const hhmm = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
    if (!hhmm) return null;
    let hours = Number(hhmm[1]);
    const mins = Number(hhmm[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(mins) || mins < 0 || mins > 59) return null;
    const meridiem = (hhmm[3] || '').toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    if (hours < 0 || hours > 23) return null;
    return hours * 60 + mins;
}

function looksInterventionLike(item: any): boolean {
    if (!item || typeof item !== 'object') return false;
    const key = item.key || item.substanceKey || item.substance_id;
    const timeVal = item.timeMinutes ?? item.time_min ?? item.timeMinute ?? item.minute ?? item.time;
    return !!key && parseInterventionTime(timeVal) !== null;
}

function normalizeIntervention(item: any): any | null {
    if (!item || typeof item !== 'object') return null;
    const key = item.key || item.substanceKey || item.substance_id;
    const timeVal = item.timeMinutes ?? item.time_min ?? item.timeMinute ?? item.minute ?? item.time;
    const timeMinutes = parseInterventionTime(timeVal);
    if (!key || timeMinutes === null) return null;

    const normalized: any = {
        ...item,
        key,
        timeMinutes,
    };

    if (normalized.dose == null && item.amount != null) normalized.dose = item.amount;
    if (normalized.impacts == null && item.impactVector && typeof item.impactVector === 'object') {
        normalized.impacts = item.impactVector;
    }
    if (normalized.rationale == null && typeof item.reason === 'string') normalized.rationale = item.reason;
    if (normalized.rationale == null && typeof item.explanation === 'string') normalized.rationale = item.explanation;

    return normalized;
}

function extractInterventionsData(raw: any): any[] {
    const candidates: any[] = [];
    if (Array.isArray(raw)) candidates.push(raw);
    if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.interventions)) candidates.push(raw.interventions);
        if (Array.isArray(raw.protocol)) candidates.push(raw.protocol);
        if (Array.isArray(raw.actions)) candidates.push(raw.actions);
        if (raw.plan && typeof raw.plan === 'object' && Array.isArray(raw.plan.interventions)) {
            candidates.push(raw.plan.interventions);
        }
        if (looksInterventionLike(raw)) candidates.push([raw]);
    }

    for (const candidate of candidates) {
        const normalized = candidate
            .map((iv: any) => normalizeIntervention(iv))
            .filter(Boolean);
        if (normalized.length > 0) return normalized;
    }

    if (raw && typeof raw === 'object') {
        const values = Object.values(raw);
        const normalized = values
            .map((iv: any) => normalizeIntervention(iv))
            .filter(Boolean);
        if (normalized.length > 0) return normalized;
    }

    return [];
}

function stopPromptPlayheadTracker() {
    const rafId = TimelineState._promptPlayheadRafId;
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        TimelineState._promptPlayheadRafId = null;
    }
}

function stopBioScanPlayheadTracker() {
    const rafId = TimelineState._bioScanPlayheadRafId;
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        TimelineState._bioScanPlayheadRafId = null;
    }
}

function stopBioRevealPlayheadTracker() {
    const rafId = TimelineState._bioRevealPlayheadRafId;
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        TimelineState._bioRevealPlayheadRafId = null;
    }
}

function startBioRevealPlayheadTracker(
    engine: TimelineEngine,
    revealStartTime: number,
    revealDurationMs: number,
    revealEndTime: number,
) {
    stopBioRevealPlayheadTracker();
    const wallStart = performance.now();

    const tick = () => {
        if (TimelineState.engine !== engine) {
            stopBioRevealPlayheadTracker();
            return;
        }

        const elapsed = performance.now() - wallStart;
        if (elapsed >= revealDurationMs) {
            engine.advanceTimeTo(revealEndTime);
            stopBioRevealPlayheadTracker();
            return;
        }

        engine.advanceTimeTo(revealStartTime + elapsed);
        TimelineState._bioRevealPlayheadRafId = requestAnimationFrame(tick);
    };

    TimelineState._bioRevealPlayheadRafId = requestAnimationFrame(tick);
}

function startBioScanPlayheadTracker(engine: TimelineEngine, timelineStart: number) {
    stopBioScanPlayheadTracker();

    TimelineState._bioScanWallStart = performance.now();
    TimelineState._bioScanTimelineStart = timelineStart;

    const tick = () => {
        const wallStart = TimelineState._bioScanWallStart;
        if (wallStart == null || TimelineState.engine !== engine) {
            stopBioScanPlayheadTracker();
            return;
        }
        const elapsed = performance.now() - wallStart;
        engine.advanceTimeTo(TimelineState._bioScanTimelineStart + elapsed);
        TimelineState._bioScanPlayheadRafId = requestAnimationFrame(tick);
    };

    TimelineState._bioScanPlayheadRafId = requestAnimationFrame(tick);
}

function estimateBioScanLaneCount(): number {
    const selected = BiometricState.selectedDevices;
    if (!Array.isArray(selected) || selected.length === 0) return 5;

    const devices = BIOMETRIC_DEVICES?.devices;
    if (!Array.isArray(devices)) return 5;

    let laneCount = 0;
    for (const key of selected) {
        const dev = devices.find((d: any) => d?.key === key);
        laneCount += Array.isArray(dev?.displayChannels) ? dev.displayChannels.length : 0;
    }

    return Math.max(1, laneCount || 5);
}

injectBiometricDeps({
    startBioScanLine,
    stopBioScanLine,
    onBioScanStart: () => {
        const engine = TimelineState.engine;
        if (!engine) return;
        stopBioRevealPlayheadTracker();
        const channelCount = estimateBioScanLaneCount(); // estimate; actual count resolved on stop
        addBioScanLine(engine, TimelineState.cursor, channelCount);
        // Track playhead continuously while biometric scan is active.
        startBioScanPlayheadTracker(engine, TimelineState.cursor);
    },
    onBioScanStop: (channelCount: number) => {
        const engine = TimelineState.engine;
        stopBioScanPlayheadTracker();
        const wallStart = TimelineState._bioScanWallStart;
        TimelineState._bioScanWallStart = null;
        TimelineState._bioScanTimelineStart = null;
        if (!engine || wallStart == null) return;
        const bioScanDuration = performance.now() - wallStart;
        const phase2EndTime = TimelineState.cursor;
        TimelineState.cursor = buildPhase3Segments(
            engine, TimelineState.cursor, bioScanDuration, channelCount,
        );
        const bioRevealStartTime = phase2EndTime + bioScanDuration;
        const bioRevealDuration = 600 + Math.max(0, channelCount - 1) * 80;
        const bioRevealEndTime = TimelineState.cursor;

        // Land at reveal start, then advance while strip reveal animation runs.
        engine.advanceTimeTo(bioRevealStartTime);
        startBioRevealPlayheadTracker(
            engine,
            bioRevealStartTime,
            bioRevealDuration,
            bioRevealEndTime,
        );
    },
    onBioScanAbort: () => {
        stopBioScanPlayheadTracker();
        stopBioRevealPlayheadTracker();
        TimelineState._bioScanWallStart = null;
        TimelineState._bioScanTimelineStart = null;
    },
    onRevisionPlay: (diff: any[]) => {
        const engine = TimelineState.engine;
        if (!engine) return;
        engine.resolveGate('biometric-gate');
        TimelineState.cursor = buildPhase4Segments(
            engine, TimelineState.cursor, diff,
        );
        engine.resolveGate('revision-gate');
        // We do NOT manually advance timeline here. 
        // Biometric.ts performs iterative UI sweep, and advances it at the end.
    },
    onRevisionPlayContext: (narration: any) => {
        const engine = TimelineState.engine;
        if (!engine) return;
        engine.getContext().sherlockRevisionNarration = narration;
    },
});

// ============================================
// 20. EVENT HANDLERS
// ============================================

// ============================================
// 20b. PHASE CHART FLOW — New Prompt Handler
// ============================================

export async function handlePromptSubmit(e) {
    e.preventDefault();

    const input = document.getElementById('prompt-input') as HTMLInputElement;
    const prompt = input.value.trim();
    if (!prompt || PhaseState.isProcessing) return;

    const shouldHardResetBeforeNewPrompt =
        document.body.classList.contains('phase-engaged')
        || PhaseState.maxPhaseReached >= 0
        || !!TimelineState.engine;
    if (shouldHardResetBeforeNewPrompt) {
        storePendingPromptForHardReset(prompt);
        window.location.reload();
        return;
    }

    // Ensure no stale timeline trackers survive across prompt resubmits.
    stopPromptPlayheadTracker();
    stopBioScanPlayheadTracker();
    stopBioRevealPlayheadTracker();
    TimelineState._bioScanWallStart = null;
    TimelineState._bioScanTimelineStart = null;
    (window as any).__onLxStepWait = null;
    (window as any).__onLxStepWaitOwner = null;

    clearPromptError();
    PhaseState.isProcessing = true;
    PhaseState.phase = 'loading';
    document.body.classList.add('phase-engaged');
    document.getElementById('prompt-hint').style.opacity = '0';
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = true;

    // Reset phase chart and Sherlock narration if resubmitting
    resetPhaseChart();
    clearNarration();

    // Tear down previous timeline engine if resubmitting
    if (TimelineState.engine) {
        TimelineState.engine.destroy();
        TimelineState.ribbon?.destroy();
        TimelineState.engine = null;
        TimelineState.ribbon = null;
        TimelineState.active = false;
    }

    // Initialize timeline engine
    const svgRoot = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement;
    const engine = new TimelineEngine(svgRoot);
    (window as any).__timelineEngine = engine;
    const ribbon = new TimelineRibbon(engine);
    TimelineState.engine = engine;
    TimelineState.ribbon = ribbon;
    TimelineState.active = true;
    TimelineState.interactionLocked = true;

    // Build Phase 0 setup segments and start tracking timing
    const scanLineStartTime = buildPhase0Segments(engine);
    const scanLineWallStart = performance.now();
    ribbon.show();

    // --- First-run playhead tracking ---
    // During first-run, the engine is in recordOnly mode.
    // We advance the playhead via a 60fps rAF loop that maps
    // wall-clock time to timeline time using segment milestones.
    //
    // `timelineBase` = the known timeline position at the start of the
    // current animation phase. `wallBase` = the wall-clock time at that point.
    // Between milestones, elapsed wall time maps 1:1 to timeline advancement
    // (scan lines are variable-duration, their actual wall time becomes the segment duration).
    let _timelineBase = 0;
    let _wallBase = performance.now();
    let _playheadPaused = false;
    let _playheadRafId: number | null = null;

    function advancePlayhead() {
        if (_playheadPaused) return;
        const wallElapsed = performance.now() - _wallBase;
        engine.advanceTimeTo(_timelineBase + wallElapsed);
    }
    function startPlayheadTracker() {
        function frame() {
            advancePlayhead();
            _playheadRafId = requestAnimationFrame(frame);
            TimelineState._promptPlayheadRafId = _playheadRafId;
        }
        _playheadRafId = requestAnimationFrame(frame);
        TimelineState._promptPlayheadRafId = _playheadRafId;
    }
    function stopPlayheadTracker() {
        stopPromptPlayheadTracker();
        if (_playheadRafId !== null) {
            cancelAnimationFrame(_playheadRafId);
            _playheadRafId = null;
        }
        TimelineState._promptPlayheadRafId = null;
        if ((window as any).__onLxStepWaitOwner === engine) {
            (window as any).__onLxStepWait = null;
            (window as any).__onLxStepWaitOwner = null;
        }
    }
    /** Jump playhead to a specific timeline position (at a milestone) and reset wall base */
    function setPlayheadMilestone(timelineMs: number) {
        _timelineBase = timelineMs;
        _wallBase = performance.now();
        engine.advanceTimeTo(timelineMs);
    }
    /** Pause playhead (during gate waits) */
    function pausePlayhead(atTimelineMs?: number) {
        _playheadPaused = true;
        if (atTimelineMs !== undefined) engine.advanceTimeTo(atTimelineMs);
    }
    /** Resume playhead from a new milestone */
    function resumePlayhead(timelineMs: number) {
        _timelineBase = timelineMs;
        _wallBase = performance.now();
        _playheadPaused = false;
    }
    (window as any).__onLxStepWaitOwner = engine;
    (window as any).__onLxStepWait = (waiting: boolean) => {
        if (TimelineState.engine !== engine) return;
        if (waiting) {
            pausePlayhead(engine.getCurrentTime());
        } else if (_playheadPaused) {
            resumePlayhead(engine.getCurrentTime());
        }
    };
    startPlayheadTracker();

    // Log user input to debug panel
    DebugLog.clear();
    DebugLog.addEntry({
        stage: 'User Input', stageClass: 'user-input',
        model: AppState.selectedLLM,
        userPrompt: prompt,
    });

    // === Animate prompt upward + reveal X-axis ===
    const promptSection = document.getElementById('prompt-section');
    promptSection.classList.remove('phase-centered');
    promptSection.classList.add('phase-top');

    const chartContainer = document.getElementById('phase-chart-container');
    chartContainer.classList.add('visible');

    await sleep(350);

    // === Fire both API calls in parallel ===
    const fastModelPromise = callFastModel(prompt);
    const mainModelPromise = callMainModelForCurves(prompt);

    // Start scanning line
    await sleep(400);
    startScanLine();
    PhaseState.phase = 'scanning';

    // === WORD CLOUD PHASE: Fast model returns 15-18 effects (primary + supporting) ===
    let wordCloudEffects;
    try {
        const fastResult = await fastModelPromise;
        const rawEffects = fastResult.effects || [];
        if (rawEffects.length === 0) throw new Error('Fast model returned no effects.');
        // Normalize: handle both new format [{name, relevance}] and legacy ["string"]
        wordCloudEffects = rawEffects.map(e =>
            typeof e === 'string' ? { name: e, relevance: 80 } : e
        );
    } catch (err) {
        stopScanLine();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        showPromptError(err instanceof Error ? err.message : String(err));
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    PhaseState.wordCloudEffects = wordCloudEffects;

    // Populate engine context with word cloud effects
    engine.getContext().wordCloudEffects = wordCloudEffects;

    // Show word cloud + orbital rings (skip if too few effects)
    const cloudCx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
    const cloudCy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
    let hasCloud = false;

    if (wordCloudEffects.length >= 3) {
        PhaseState.phase = 'word-cloud';
        addWordCloudSegments(engine, scanLineStartTime, wordCloudEffects);
        const cloudPromise = renderWordCloud(wordCloudEffects);
        startOrbitalRings(cloudCx, cloudCy);
        await cloudPromise;
        hasCloud = true;
    }

    // === MAIN MODEL RETURNS: Transition to chart ===
    let curvesResult;
    try {
        curvesResult = await mainModelPromise;
    } catch (err) {
        stopScanLine();
        stopOrbitalRings();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        document.getElementById('phase-word-cloud').innerHTML = '';
        showPromptError(err instanceof Error ? err.message : String(err));
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    // Robust extraction: handle array, wrapped object, or single-curve object responses.
    const curvesData = extractCurvesData(curvesResult);

    if (curvesData.length === 0) {
        stopScanLine();
        stopOrbitalRings();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        document.getElementById('phase-word-cloud').innerHTML = '';
        const keys = Array.isArray(curvesResult) ? `[array of ${curvesResult.length}]` : Object.keys(curvesResult || {}).join(', ');
        console.error('[CortexLoop] Curve result had no usable curves. Parsed keys:', keys, 'Full result:', curvesResult);
        showPromptError(`Main model returned no usable curve objects. Parsed keys: ${keys || '(empty)'}. Expected curve fields include effect, baseline[], and desired[]. Check debug panel for raw response.`);
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    // Stop scanning line
    stopScanLine();

    // Record scan line actual duration and add post-curve segments to timeline
    const scanLineDuration = performance.now() - scanLineWallStart;
    engine.getContext().curvesData = curvesData;
    let timelineCursor = addPostCurveSegments(engine, scanLineStartTime, scanLineDuration, hasCloud);

    // Milestone: scan line resolved, post-curve animations start
    setPlayheadMilestone(scanLineStartTime + scanLineDuration);

    // Dismiss word cloud + morph rings into baseline curves (in parallel)
    const mainEffects = curvesData.map(c => c.effect);
    const mainColors = curvesData.map(c => c.color);

    if (hasCloud) {
        PhaseState.phase = 'word-cloud-dismiss';
        // Build Y-axes + grid simultaneously so curves have somewhere to land
        const effects = mainEffects.slice(0, AppState.maxEffects);
        PhaseState.effects = effects;
        buildPhaseYAxes(effects, mainColors, curvesData);
        document.getElementById('phase-y-axis-left').classList.add('revealed');
        if (effects.length > 1) {
            document.getElementById('phase-y-axis-right').classList.add('revealed');
        }
        buildPhaseGrid();

        await Promise.all([
            dismissWordCloud(mainEffects, mainColors),
            morphRingsToCurves(curvesData),
        ]);

        // Render real baseline DOM elements BEFORE removing rings — no flicker gap
        renderBaselineCurvesInstant(curvesData);
        renderPhaseLegend(curvesData, 'baseline');

        // Now safe to remove ring elements (baseline curves are painted)
        if (_orbitalRingsState) {
            _orbitalRingsState.ring1.remove();
            if (_orbitalRingsState.ring2) _orbitalRingsState.ring2.remove();
            setOrbitalRingsState(null);
        }
        buildPhaseXAxis();
        document.getElementById('phase-x-axis').classList.add('revealed');
    } else {
        // No cloud — standard flow
        const effects = mainEffects.slice(0, AppState.maxEffects);
        PhaseState.effects = effects;
        buildPhaseYAxes(effects, mainColors, curvesData);
        document.getElementById('phase-y-axis-left').classList.add('revealed');
        if (effects.length > 1) {
            document.getElementById('phase-y-axis-right').classList.add('revealed');
        }
        buildPhaseGrid();
        await sleep(300);
        await renderBaselineCurves(curvesData);
        renderPhaseLegend(curvesData, 'baseline');
        buildPhaseXAxis();
        document.getElementById('phase-x-axis').classList.add('revealed');
    }

    PhaseState.curvesData = curvesData;
    PhaseState.phase = 'baseline-shown';
    PhaseState.maxPhaseReached = 0;
    PhaseState.viewingPhase = 0;

    // Add Phase 1 segments (optimize gate + desired curves) to timeline
    const optimizeGateTime = timelineCursor; // gate sits at this position
    timelineCursor = buildPhase1Segments(engine, timelineCursor);

    // Milestone: Phase 0 complete, pause playhead at optimize gate
    pausePlayhead(optimizeGateTime);

    // === SHOW OPTIMIZE BUTTON — wait for user click ===
    // Fire intervention model in background for head start
    PhaseState.interventionPromise = callInterventionModel(prompt, curvesData).catch(() => null);

    const optimizeBtn = document.getElementById('phase-optimize-btn');
    optimizeBtn.classList.remove('hidden');
    optimizeBtn.style.opacity = '0';
    optimizeBtn.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });

    PhaseState.isProcessing = false;
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;

    // Wait for Optimize button click
    await new Promise<void>(resolve => {
        function onOptimize() {
            optimizeBtn.removeEventListener('click', onOptimize);
            resolve();
        }
        optimizeBtn.addEventListener('click', onOptimize);
    });

    optimizeBtn.classList.add('hidden');
    PhaseState.isProcessing = true;
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = true;

    // Resolve the optimize gate on the timeline and resume playhead
    engine.resolveGate('optimize-gate');
    resumePlayhead(optimizeGateTime);

    // Cleanup baseline editor before morphing to desired
    cleanupBaselineEditor();

    // Morph baseline → desired
    await morphToDesiredCurves(curvesData);
    renderPhaseLegend(curvesData, 'full');

    PhaseState.phase = 'curves-drawn';
    PhaseState.maxPhaseReached = 1;
    PhaseState.viewingPhase = 1;

    // === SEQUENTIAL SUBSTANCE LAYERING ===
    // Show rotating orange waiting button while strategist (intervention) + Sherlock process
    showInterventionPlayButtonLoading();
    // Start timeline scan line while waiting for intervention model
    startTimelineScanLine(3);
    const tlScanStartTime = timelineCursor;
    const tlScanWallStart = performance.now();
    addTimelineScanLine(engine, tlScanStartTime, 3);

    // Playhead milestone: Phase 1 animations done, scan line running
    setPlayheadMilestone(tlScanStartTime);

    // Wait for intervention model
    let interventionData = PhaseState.interventionResult;
    if (!interventionData && PhaseState.interventionPromise) {
        interventionData = await PhaseState.interventionPromise;
    }

    // Stop scan line — LLM has returned
    stopTimelineScanLine();
    const tlScanDuration = performance.now() - tlScanWallStart;

    if (!interventionData) {
        console.error('[Lx] No intervention data — model call failed or no API key.');
        hideInterventionPlayButton();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }
    PhaseState.interventionResult = interventionData;

    const extractedInterventions = extractInterventionsData(interventionData);
    const interventions = validateInterventions(extractedInterventions, curvesData);
    if (interventions.length === 0) {
        hideInterventionPlayButton();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        const keys = interventionData && typeof interventionData === 'object'
            ? Object.keys(interventionData).join(', ')
            : '';
        showPromptError(`Intervention model returned no usable interventions. Parsed keys: ${keys || '(empty)'}. Check debug panel for raw response.`);
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    // Fire Sherlock narration in parallel (non-blocking)
    let sherlockPromise: Promise<any> | null = null;
    console.log('[Sherlock] enabled:', SherlockState.enabled, '| interventions:', interventions.length);
    if (SherlockState.enabled) {
        SherlockState.phase = 'loading';

        // --- ADDED: Show waiting animation for Sherlock ---
        showNarrationPanel();
        showNarrationLoading();

        sherlockPromise = callSherlockModel(prompt, interventions, curvesData).catch(err => {
            console.error('[Sherlock] Narration FAILED:', err);
            hideNarrationPanel();
            return null;
        });
    } else {
        console.warn('[Sherlock] DISABLED — narration skipped');
    }

    // Compute incremental Lx overlays (one per substance step)
    const incrementalSnapshots = computeIncrementalLxOverlay(interventions, curvesData);
    PhaseState.incrementalSnapshots = incrementalSnapshots;
    PhaseState.lxCurves = incrementalSnapshots[incrementalSnapshots.length - 1].lxCurves;

    // Populate engine context with intervention data
    engine.getContext().interventions = interventions;
    engine.getContext().incrementalSnapshots = incrementalSnapshots;
    engine.getContext().lxCurves = PhaseState.lxCurves;

    // Resolve Sherlock narration before building Phase 2 segments
    // (segments check context.sherlockNarration at build time)
    const rawNarration = sherlockPromise ? await sherlockPromise : null;
    const narration = normalizeSherlockNarration(rawNarration, interventions, SherlockState.enabled);
    if (SherlockState.enabled && rawNarration && !narration) {
        console.warn('[Sherlock] Narration payload had no usable beats; cards disabled for this run.');
    } else if (SherlockState.enabled && !rawNarration && narration) {
        console.warn('[Sherlock] Narration model unavailable; using fallback cards from interventions.');
    }
    SherlockState.narrationResult = narration;
    SherlockState.phase = narration ? 'ready' : 'idle';
    engine.getContext().sherlockNarration = narration;
    console.log('[Sherlock] resolved narration:', narration ? `intro=${!!narration.intro}, beats=${narration.beats?.length}, outro=${!!narration.outro}` : 'NULL');

    // Build Phase 2 segments (play gate + per-substance sweeps + cinematic playhead + sherlock narration)
    const playGateTime = tlScanStartTime + tlScanDuration; // gate position
    timelineCursor = buildPhase2Segments(
        engine, tlScanStartTime, tlScanDuration,
        interventions, incrementalSnapshots, curvesData,
    );
    TimelineState.cursor = timelineCursor;

    // Milestone: intervention model returned, pause at play gate
    pausePlayhead(playGateTime);

    PhaseState.phase = 'lx-ready';

    // Keep Sherlock hidden at the Play gate; first card appears only after Play.
    hideNarrationPanel();

    // Show step controls (play/next) alongside yellow play button
    showLxStepControls(incrementalSnapshots.length);
    showInterventionPlayButton();
    PhaseState.isProcessing = false;
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;

    await new Promise<void>(resolve => {
        setInterventionPlayClickHandler(() => {
            triggerLxPlay();
            engine.resolveGate('play-gate');
            resumePlayhead(playGateTime);
            setInterventionPlayClickHandler(null);
            resolve();
        });
    });

    PhaseState.isProcessing = true;
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = true;
    PhaseState.phase = 'lx-sequential';

    // Animate sequential substance reveal (narration already resolved above)
    await animateSequentialLxReveal(incrementalSnapshots, interventions, curvesData, narration);

    PhaseState.phase = 'lx-rendered';
    PhaseState.maxPhaseReached = 2;
    PhaseState.viewingPhase = 2;

    // Milestone: Phase 2 Lx animation complete, pause at end
    pausePlayhead(timelineCursor);

    // Add biometric button to VCR panel when stream finishes
    await sleep(2500);
    showBiometricOnVcrPanel();

    // Stop the first-run playhead tracker (Phases 3/4 have their own milestone tracking via biometric callbacks)
    stopPlayheadTracker();
    // First-run imperative phase handoff complete — timeline seek/play is now safe.
    TimelineState.interactionLocked = false;

    PhaseState.isProcessing = false;
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
}

export function initDebugPanel() {
    const debugBtn = document.getElementById('debug-btn');
    const debugPanel = document.getElementById('debug-panel');
    const debugClose = document.getElementById('debug-close');

    debugBtn.addEventListener('click', () => {
        const isOpen = debugPanel.classList.contains('open');
        debugPanel.classList.toggle('open');
        debugBtn.classList.toggle('active');

        if (!isOpen) {
            document.getElementById('settings-popover').classList.add('hidden');
            document.getElementById('settings-btn').classList.remove('active');
        }
    });

    debugClose.addEventListener('click', () => {
        debugPanel.classList.remove('open');
        debugBtn.classList.remove('active');
    });

    DebugLog.initCards();
}

export function refreshPipelineSelects() {
    DebugLog.refreshSelects();
}

export function initSettings() {
    const btn = document.getElementById('settings-btn');
    const popover = document.getElementById('settings-popover');
    const keyInput = document.getElementById('api-key-input') as HTMLInputElement;
    const saveBtn = document.getElementById('api-key-save');
    const status = document.getElementById('api-key-status');
    const llmSelect = document.getElementById('llm-select') as HTMLSelectElement;
    const providerLabel = document.getElementById('key-provider-label');

    const PLACEHOLDERS = {
        anthropic: 'sk-ant-...',
        openai: 'sk-proj-...',
        grok: 'xai-...',
        gemini: 'AIza...',
    };

    const PROVIDER_NAMES = {
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        grok: 'xAI',
        gemini: 'Google',
    };

    // Init LLM select
    llmSelect.value = AppState.selectedLLM;

    // Init effects select
    const effectsSelect = document.getElementById('effects-select') as HTMLSelectElement;
    effectsSelect.value = String(AppState.maxEffects);
    effectsSelect.addEventListener('change', () => {
        AppState.maxEffects = parseInt(effectsSelect.value);
        localStorage.setItem('cortex_max_effects', effectsSelect.value);
    });

    // Sherlock narration toggle
    const sherlockToggle = document.getElementById('sherlock-toggle') as HTMLInputElement;
    if (sherlockToggle) {
        sherlockToggle.checked = SherlockState.enabled;
        sherlockToggle.addEventListener('change', () => {
            SherlockState.enabled = sherlockToggle.checked;
            localStorage.setItem('cortex_sherlock_enabled', JSON.stringify(sherlockToggle.checked));
        });
    }

    updateKeyUI();

    function updateKeyUI() {
        const llm = AppState.selectedLLM;
        keyInput.placeholder = PLACEHOLDERS[llm] || '';
        providerLabel.textContent = `(${PROVIDER_NAMES[llm] || llm})`;
        keyInput.value = AppState.apiKeys[llm] || '';
        const hasKey = !!AppState.apiKeys[llm];
        status.textContent = hasKey ? 'Key configured' : 'No key — add one to generate';
        status.className = 'api-key-status ' + (hasKey ? 'success' : 'error');
    }

    llmSelect.addEventListener('change', () => {
        AppState.selectedLLM = llmSelect.value;
        localStorage.setItem('cortex_llm', llmSelect.value);
        syncStageModelsForProvider(llmSelect.value);
        updateKeyUI();
        DebugLog.refreshSelects();
    });

    saveBtn.addEventListener('click', () => {
        const llm = AppState.selectedLLM;
        const key = keyInput.value.trim();
        if (key) {
            AppState.apiKeys[llm] = key;
            localStorage.setItem(`cortex_key_${llm}`, key);
            status.textContent = 'Key saved';
            status.className = 'api-key-status success';
        } else {
            AppState.apiKeys[llm] = '';
            localStorage.removeItem(`cortex_key_${llm}`);
            status.textContent = 'Key removed';
            status.className = 'api-key-status error';
        }
    });

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !popover.classList.contains('hidden');
        if (isOpen) {
            popover.classList.add('hidden');
            btn.classList.remove('active');
        } else {
            popover.classList.remove('hidden');
            btn.classList.add('active');
            updateKeyUI();
        }
    });

    document.addEventListener('click', (e) => {
        if (!popover.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) {
            popover.classList.add('hidden');
            btn.classList.remove('active');
        }
    });
}

function applyRxModeVisual(btn: HTMLButtonElement, mode: string) {
    btn.classList.remove('rx-active', 'rx-only-active');
    switch (mode) {
        case 'rx':
            btn.textContent = 'Rx';
            btn.classList.add('rx-active');
            break;
        case 'rx-only':
            btn.textContent = 'Rx only';
            btn.classList.add('rx-only-active');
            break;
        default:
            btn.textContent = 'Rx';
            break;
    }
}

export function initRxMode() {
    const btn = document.getElementById('rx-mode-btn') as HTMLButtonElement;
    const container = btn?.closest('.rx-mode-container') as HTMLElement;
    const input = document.getElementById('prompt-input') as HTMLInputElement;
    if (!btn || !container || !input) return;

    applyRxModeVisual(btn, AppState.rxMode);

    btn.addEventListener('click', () => {
        const next = AppState.rxMode === 'off' ? 'rx'
                   : AppState.rxMode === 'rx' ? 'rx-only'
                   : 'off';
        AppState.rxMode = next;
        applyRxModeVisual(btn, next);
    });

    input.addEventListener('input', () => {
        if (input.value.length > 0) {
            container.style.display = 'flex';
            requestAnimationFrame(() => container.classList.add('visible'));
        }
    });
}

// ============================================
// 21. INITIALIZATION
// ============================================

export function refreshChartTheme() {
    const t = chartTheme();
    // Update scan-line gradient stops for current theme
    const grad = document.getElementById('scan-line-grad');
    if (grad) {
        const stops = grad.querySelectorAll('stop');
        const light = document.body.classList.contains('light-mode');
        const base = light ? '80,100,180' : '160,160,255';
        if (stops.length >= 3) {
            stops[0].setAttribute('stop-color', `rgba(${base},0)`);
            stops[1].setAttribute('stop-color', `rgba(${base},0.6)`);
            stops[2].setAttribute('stop-color', `rgba(${base},0)`);
        }
    }
    // Re-render grid and axes if chart is populated
    const gridGroup = document.getElementById('phase-grid');
    if (gridGroup && gridGroup.children.length > 0) {
        buildPhaseGrid();
        buildPhaseXAxis();
        if (PhaseState.curvesData && PhaseState.curvesData.length > 0) {
            const effects = PhaseState.curvesData.map(c => c.effect);
            const colors = PhaseState.curvesData.map(c => c.color);
            buildPhaseYAxes(effects, colors, PhaseState.curvesData);
        }
    }
    // Update peak descriptor backdrop fills
    document.querySelectorAll('.peak-descriptor rect').forEach(r => {
        r.setAttribute('fill', t.tooltipBg);
    });
    // Update divider visual if active
    if (DividerState.elements) {
        DividerState.elements.line.setAttribute('fill', t.axisLine);
        DividerState.elements.glow.setAttribute('fill', t.scanGlow);
        DividerState.elements.diamond.setAttribute('stroke', t.axisLine);
    }
}

export function initThemeToggle() {
    const saved = localStorage.getItem('cortex_theme');
    if (saved === 'light') {
        document.body.classList.add('light-mode');
    }
    refreshChartTheme();
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const isLight = document.body.classList.contains('light-mode');
            localStorage.setItem('cortex_theme', isLight ? 'light' : 'dark');
            refreshChartTheme();
            // Swap biometric device chip icons for the new theme
            document.querySelectorAll('.bio-device-chip-icon[data-src-dark]').forEach((img: any) => {
                img.src = isLight ? img.dataset.srcLight : img.dataset.srcDark;
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const pendingPrompt = consumePendingPromptAfterHardReset();
    if (pendingPrompt?.rxMode === 'off' || pendingPrompt?.rxMode === 'rx' || pendingPrompt?.rxMode === 'rx-only') {
        AppState.rxMode = pendingPrompt.rxMode;
    }

    // Defer cartridge initialization — not visible in phase chart flow
    // buildCartridgeSVG();
    // initTooltip();

    initThemeToggle();
    initSettings();
    initRxMode();
    initDebugPanel();
    document.getElementById('prompt-form').addEventListener('submit', handlePromptSubmit);
    (document.getElementById('prompt-input') as HTMLElement).focus();

    document.getElementById('hint-example')?.addEventListener('click', (e) => {
        e.preventDefault();
        const input = document.getElementById('prompt-input') as HTMLInputElement;
        input.value = '4 hours of deep focus, no sleep impact';
        document.getElementById('prompt-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });

    if (pendingPrompt?.prompt) {
        const input = document.getElementById('prompt-input') as HTMLInputElement | null;
        const form = document.getElementById('prompt-form') as HTMLFormElement | null;
        if (input && form) {
            input.value = pendingPrompt.prompt;
            requestAnimationFrame(() => {
                form.dispatchEvent(new Event('submit', { cancelable: true }));
            });
        }
    }

    // Prompt starts centered (class already set in HTML)
    // Cartridge section starts hidden (class already set in HTML)
});
