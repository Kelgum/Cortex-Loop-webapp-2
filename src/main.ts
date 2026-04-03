/**
 * Main — App entry point: prompt submission handler, phase orchestration, settings UI, and timeline engine wiring.
 * Exports: handlePromptSubmit, initSettings, initThemeToggle, initRxMode, refreshChartTheme
 * Depends on: state, constants, utils, phase-chart, lx-system, word-cloud, biometric, sherlock, timeline-engine, timeline-ribbon, timeline-builder
 */
import '../styles.css';

import { PHASE_CHART, BADGE_CATEGORIES } from './constants';
import {
    AppState,
    PhaseState,
    DividerState,
    TimelineState,
    MultiDayState,
    AgentMatchState,
    isTurboActive,
} from './state';
import { sleep, isLightMode } from './utils';
import { chartTheme } from './utils';
import { clearPromptError, configurePhaseChartRuntime, resetPhaseChart, showPromptError } from './phase-chart-ui';
import { cleanupMorphDrag, configureLxRuntime } from './lx-system';
import {
    stopOrbitalRings,
    _orbitalRingsState,
    setOrbitalRingsState,
    _wordCloudPositions,
    setWordCloudPositions,
    startOrbitalRings,
    stopWordCloudFloat,
    renderWordCloud,
    skipWordCloudEntrance,
    dismissWordCloud,
    morphRingsToCurves,
} from './word-cloud';
import {
    buildPhaseXAxis,
    buildPhaseYAxes,
    buildPhaseGrid,
    startScanLine,
    stopScanLine,
    renderBaselineCurvesInstant,
    renderBaselineCurves,
    renderPhaseLegend,
    morphToDesiredCurves,
    startTimelineScanLine,
    stopTimelineScanLine,
    hideWeekStrip,
    placePeakDescriptors,
} from './phase-chart';
import { callFastModel, callMainModelForCurves, callInterventionModel, callSherlockModel } from './llm-pipeline';
import {
    validateInterventions, computeIncrementalLxOverlay, animateSequentialLxReveal,
    renderLxCurves, renderSubstanceTimeline, revealTimelinePillsInstant,
    renderLxBandsStatic, animatePhaseChartViewBoxHeight,
} from './lx-system';
import {
    showBiometricTrigger,
    showInterventionPlayButton,
    hideInterventionPlayButton,
    showBiometricOnVcrPanel,
    hideRevisionPlayButton,
    configureBiometricRuntime,
    renderBiometricStrips,
    hideBiometricTrigger,
    showWeekSequenceButton,
} from './biometric';
import { BiometricState, RevisionState, SherlockState } from './state';
import { clearNarration, hideNarrationPanel, showLxStepControls } from './sherlock';
import { cleanupBaselineEditor } from './baseline-editor';
import { DebugLog } from './debug-panel';
import {
    clearRuntimeBug,
    initRuntimeErrorBanner,
    reportRuntimeBug,
    reportRuntimeCacheWarning,
} from './runtime-error-banner';
import { extractCurvesData, extractInterventionsData } from './llm-response-shape';
import { normalizeSherlockNarration } from './sherlock-narration';
import { describeStageClasses, reconcileEnabledCacheDependencies } from './cache-policy';
import { initAnalogyOverlay } from './analogy-overlay';

// Timeline engine imports
import { TimelineEngine } from './timeline-engine';
import { TimelineRibbon } from './timeline-ribbon';
import { PipelineTimeline } from './pipeline-timeline';
import {
    buildPhase0Segments,
    addWordCloudSegments,
    addPostCurveSegments,
    buildPhase1Segments,
    addTimelineScanLine,
    buildPhase2Segments,
    addBioScanLine,
    buildPhase3Segments,
    buildPhase3BioCorrectionSegments,
    buildPhase4Segments,
} from './timeline-builder';
import { BIOMETRIC_DEVICES } from './biometric-devices';
import { BIO_CORRECTION_MORPH_MS } from './bio-correction';
import { getAppDom } from './dom';
import { sessionSettingsStore, settingsStore, STORAGE_KEYS } from './settings-store';
import { TaskGroup } from './task-group';
import { initDebugBundleExport } from './debug-bundle';
import { LLMCache } from './llm-cache';
import { initCycleUi } from './cycle-ui';
import { getLoadedCycleId, getLoadedCyclePrompt } from './cycle-store';
import {
    getRuntimeReplaySnapshot,
    isRuntimeReplayActive,
    recordDesignReplayState,
    resetRuntimeReplaySnapshotDraft,
} from './replay-snapshot';
import { initAgentDesigner } from './creator-agent-designer';
import { initAgentBrowser } from './creator-agent-browser';
import { initModeSwitcher, getCurrentMode, refreshStreamCardPresentation } from './mode-switcher';
import { rankCreatorAgents, showAgentMatchPanel, resetAgentMatch } from './creator-agent-matcher';
import { getAgentById } from './creator-agents/index';
import {
    activateCurveSculptor,
    deactivateCurveSculptor,
    isSculptorActive,
    refreshSculptorRxFilter,
} from './curve-sculptor';
import {
    activateSubstanceWall,
    deactivateSubstanceWall,
    isWallActive,
    refreshWallRxFilter,
    getWallPhase,
    expandWallDepth,
} from './substance-wall';
import type { TimelineEngineHandle } from './contracts';
const HARD_RESET_PENDING_PROMPT_KEY = 'cortex_pending_prompt_after_hard_reset_v1';

type PendingPromptPayload = {
    prompt: string;
    rxMode?: 'off' | 'rx' | 'rx-only';
    timestamp: number;
    skipTo7D?: boolean;
    openAtLxReady?: boolean;
};

let _landAtLxReadyOnNextSubmit = false;

type StrategistOutcome = { ok: true; result: any; settledAt: number } | { ok: false; error: any; settledAt: number };

type StrategistVcrState = 'hidden' | 'loading' | 'analysis-baseline' | 'baseline-optimize' | 'optimizing' | 'handoff';

function storePendingPromptForHardReset(prompt: string): void {
    const payload: PendingPromptPayload = {
        prompt,
        rxMode: AppState.rxMode,
        timestamp: Date.now(),
    };
    try {
        sessionSettingsStore.setJson(HARD_RESET_PENDING_PROMPT_KEY, payload);
    } catch {
        // Ignore storage failures; fallback is normal reload without auto-submit.
    }
}

function consumePendingPromptAfterHardReset(): PendingPromptPayload | null {
    try {
        const raw = sessionSettingsStore.getString(HARD_RESET_PENDING_PROMPT_KEY);
        if (!raw) return null;
        sessionSettingsStore.remove(HARD_RESET_PENDING_PROMPT_KEY);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.prompt !== 'string') return null;
        return parsed as PendingPromptPayload;
    } catch {
        return null;
    }
}

const STRATEGIST_PLAY_ICON =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
const STRATEGIST_PLAY_VCR_HIDDEN_CLASS = 'vcr-hidden';
const STRATEGIST_PLAY_VCR_COMPACT_CLASS = 'vcr-compact';
const STRATEGIST_VCR_LOADING_CLASS = 'vcr-loading';
const STRATEGIST_VCR_HANDOFF_OUT_CLASS = 'vcr-handoff-out';
const STRATEGIST_LABEL_TRANSIT_DELAY = 280;
const STRATEGIST_LABEL_SETTLE_DELAY = 380;
let _strategistPanel: HTMLElement | null = null;
let _strategistPlayBtn: HTMLButtonElement | null = null;
let _strategistPlayHandler: (() => void) | null = null;
let _strategistLeftLabel: HTMLElement | null = null;
let _strategistRightLabel: HTMLElement | null = null;
let _strategistLabelTransitTimer: number | null = null;
let _strategistPillResyncTimer: number | null = null;
let _strategistFontSyncBound = false;
let _strategistVcrState: StrategistVcrState = 'hidden';
let _strategistEarlyReady = false;
let _strategistQueuedFirstClick = false;
let _strategistSkipRequested = false;

function ensureStrategistPlayButton(): HTMLButtonElement | null {
    if (_strategistPlayBtn && document.body.contains(_strategistPlayBtn)) {
        return _strategistPlayBtn;
    }

    const wrapper = document.querySelector('.phase-svg-wrapper');
    if (!wrapper) return null;

    // Create the VCR-style envelope
    const panel = document.createElement('div');
    panel.className = `strategist-vcr-panel ${STRATEGIST_PLAY_VCR_HIDDEN_CLASS}`;

    // Left label (inside panel, order: 1)
    const leftLabel = document.createElement('span');
    leftLabel.className = 'vcr-step-label vcr-step-left';
    panel.appendChild(leftLabel);
    _strategistLeftLabel = leftLabel;

    // Play button (inside panel, order: 2)
    const btn = document.createElement('button');
    btn.id = 'strategist-play-btn';
    btn.className = 'strategist-play-btn loading';
    btn.title = 'Play';
    btn.innerHTML = STRATEGIST_PLAY_ICON;
    btn.addEventListener('click', () => {
        if (_strategistPlayHandler) _strategistPlayHandler();
    });
    panel.appendChild(btn);

    // Right label (inside panel, order: 3)
    const rightLabel = document.createElement('span');
    rightLabel.className = 'vcr-step-label vcr-step-right';
    panel.appendChild(rightLabel);
    _strategistRightLabel = rightLabel;

    wrapper.appendChild(panel);
    _strategistPanel = panel;
    _strategistPlayBtn = btn;
    bindStrategistFontResync();
    return btn;
}

function queueStrategistPillResync(): void {
    updateStrategistPillWidth();
    requestAnimationFrame(() => updateStrategistPillWidth());
    if (_strategistPillResyncTimer != null) {
        window.clearTimeout(_strategistPillResyncTimer);
    }
    _strategistPillResyncTimer = window.setTimeout(() => {
        _strategistPillResyncTimer = null;
        updateStrategistPillWidth();
    }, 140);
}

function bindStrategistFontResync(): void {
    if (_strategistFontSyncBound) return;
    const fontSet = (document as any).fonts as FontFaceSet | undefined;
    if (!fontSet || typeof fontSet.addEventListener !== 'function') return;
    _strategistFontSyncBound = true;

    fontSet.addEventListener('loadingdone', () => {
        if (!_strategistPanel || !_strategistPanel.classList.contains('visible')) return;
        queueStrategistPillResync();
    });

    fontSet.ready
        .then(() => {
            if (_strategistPanel) queueStrategistPillResync();
        })
        .catch(() => {});
}

function measureStrategistLabelWidth(label: HTMLElement | null): number {
    if (!label) return 0;
    const text = (label.textContent || '').trim();
    if (!text) {
        label.style.setProperty('--vcr-label-max', '0px');
        return 0;
    }
    if (!_strategistPanel) {
        const fallback = Math.max(0, Math.ceil(label.getBoundingClientRect().width));
        label.style.setProperty('--vcr-label-max', `${fallback}px`);
        return fallback;
    }
    const probe = document.createElement('span');
    probe.className = label.className;
    probe.textContent = text;
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    probe.style.top = '-9999px';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.opacity = '0';
    probe.style.transform = 'none';
    probe.style.maxWidth = 'none';
    _strategistPanel.appendChild(probe);
    const probeWidth = Math.max(0, Math.ceil(probe.getBoundingClientRect().width));
    probe.remove();
    const renderedWidth = Math.max(0, Math.ceil(label.scrollWidth || 0));
    const width = Math.max(probeWidth, renderedWidth) + 2;
    label.style.setProperty('--vcr-label-max', `${width}px`);
    return width;
}

/** Update strategist envelope width/offset so center button stays anchored while wings resize smoothly. */
function updateStrategistPillWidth(): void {
    if (!_strategistPanel) return;
    requestAnimationFrame(() => {
        if (!_strategistPanel) return;
        const leftW = measureStrategistLabelWidth(_strategistLeftLabel);
        const rightW = measureStrategistLabelWidth(_strategistRightLabel);
        const playW = _strategistPlayBtn?.getBoundingClientRect().width || 52;
        const pillW = leftW + rightW + playW + 48;
        const pillOffset = (rightW - leftW) / 2;
        _strategistPanel.style.setProperty('--strategist-pill-w', Math.max(pillW, 84) + 'px');
        _strategistPanel.style.setProperty('--strategist-pill-offset', `${pillOffset.toFixed(1)}px`);
    });
}

function showStrategistPlayButtonLoading(): void {
    const btn = ensureStrategistPlayButton();
    if (!btn || !_strategistPanel) return;
    _strategistPlayHandler = null;
    _strategistVcrState = 'loading';
    _strategistEarlyReady = false;
    _strategistQueuedFirstClick = false;
    _strategistSkipRequested = false;

    // Reset panel state
    _strategistPanel.classList.remove(STRATEGIST_VCR_HANDOFF_OUT_CLASS);
    _strategistPanel.classList.remove(STRATEGIST_PLAY_VCR_HIDDEN_CLASS);
    _strategistPanel.classList.remove(STRATEGIST_PLAY_VCR_COMPACT_CLASS);
    _strategistPanel.classList.remove('visible');
    _strategistPanel.classList.add(STRATEGIST_VCR_LOADING_CLASS);

    // Button in loading spinner mode
    btn.classList.add('loading');
    btn.innerHTML = STRATEGIST_PLAY_ICON;

    // Left label: "Effects" (what system is working on) — pulsing via CSS
    if (_strategistLeftLabel) {
        _strategistLeftLabel.textContent = 'Analysis';
        _strategistLeftLabel.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in');
        _strategistLeftLabel.classList.add('vcr-label-visible');
    }

    // Right label: empty during genesis loading
    if (_strategistRightLabel) {
        _strategistRightLabel.textContent = '';
        _strategistRightLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-out', 'vcr-label-transit-in');
    }

    updateStrategistPillWidth();
    // Fade in
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            _strategistPanel!.classList.add('visible');
        }),
    );
}

/** As soon as Strategist resolves, stop spinner and show play + baseline cue. */
function setStrategistBaselineReadyEarly(): void {
    if (_strategistEarlyReady) return;
    _strategistEarlyReady = true;
    setStrategistPlayButtonReady('Baseline', () => {
        _strategistQueuedFirstClick = true;
        _strategistSkipRequested = true;
        skipWordCloudEntrance();
    });
}

function fadeOutHookSentenceFast(durationMs: number = 220): Promise<void> {
    const hook = document.getElementById('hook-sentence') as HTMLElement | null;
    if (!hook) return Promise.resolve();

    const hasText = !!(hook.textContent || '').trim();
    if (!hasText) {
        hook.style.opacity = '0';
        return Promise.resolve();
    }

    const rawStart = parseFloat(hook.style.opacity || '0.92');
    const startOpacity = Number.isFinite(rawStart) ? rawStart : 0.92;
    const t0 = performance.now();

    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const rawT = Math.min(1, (now - t0) / Math.max(1, durationMs));
            hook.style.opacity = (startOpacity * (1 - rawT)).toFixed(3);
            if (rawT < 1) {
                requestAnimationFrame(tick);
                return;
            }
            hook.textContent = '';
            hook.style.opacity = '0';
            resolve();
        })(performance.now());
    });
}

function setStrategistPlayButtonReady(descriptor: string, onClick: () => void): void {
    const btn = ensureStrategistPlayButton();
    if (!btn || !_strategistPanel) return;
    if (_strategistLabelTransitTimer != null) {
        window.clearTimeout(_strategistLabelTransitTimer);
        _strategistLabelTransitTimer = null;
    }
    _strategistPlayHandler = onClick;
    _strategistVcrState = descriptor === 'Optimize' ? 'baseline-optimize' : 'analysis-baseline';

    // Exit loading state on panel
    _strategistPanel.classList.remove(STRATEGIST_VCR_LOADING_CLASS);

    // Button: stop spinner, show play icon
    btn.classList.remove('loading');
    btn.innerHTML = STRATEGIST_PLAY_ICON;
    btn.title = 'Play';

    // Left label: "Analysis" visible (was pulsing during loading, now static)
    if (_strategistLeftLabel) {
        _strategistLeftLabel.getAnimations().forEach(a => a.cancel());
        _strategistLeftLabel.textContent = 'Analysis';
        _strategistLeftLabel.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in');
        _strategistLeftLabel.classList.add('vcr-label-visible');
    }

    // Right label: descriptor (e.g. "Analysis")
    if (_strategistRightLabel) {
        _strategistRightLabel.getAnimations().forEach(a => a.cancel());
        _strategistRightLabel.style.transition = 'none';
        _strategistRightLabel.textContent = descriptor;
        _strategistRightLabel.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in');
        _strategistRightLabel.classList.add('vcr-label-visible');
        void _strategistRightLabel.offsetWidth;
        _strategistRightLabel.style.transition = '';
    }
    updateStrategistPillWidth();
}

/** First strategist click: Baseline flows right→left; right label becomes Optimize. */
function animateStrategistBaselineToOptimizeReady(): Promise<void> {
    const left = _strategistLeftLabel;
    const right = _strategistRightLabel;
    if (!left || !right) return Promise.resolve();
    _strategistVcrState = 'baseline-optimize';

    if (_strategistLabelTransitTimer != null) {
        window.clearTimeout(_strategistLabelTransitTimer);
        _strategistLabelTransitTimer = null;
    }

    // Turbo: skip animation, just set final state
    if (isTurboActive()) {
        left.textContent = 'Baseline';
        left.classList.add('vcr-label-visible');
        right.textContent = 'Optimize';
        right.classList.add('vcr-label-visible');
        updateStrategistPillWidth();
        return Promise.resolve();
    }

    // Phase 1: both labels exit leftward; Baseline appears to pass through play into the left slot.
    right.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    right.classList.add('vcr-label-transit-out');
    left.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    left.classList.add('vcr-label-transit-out');
    updateStrategistPillWidth();

    return new Promise<void>(resolve => {
        _strategistLabelTransitTimer = window.setTimeout(() => {
            left.classList.remove('vcr-label-transit-out');
            right.classList.remove('vcr-label-transit-out');

            left.textContent = 'Baseline';
            left.classList.add('vcr-label-transit-in');

            right.textContent = 'Optimize';
            requestAnimationFrame(() => right.classList.add('vcr-label-visible'));
            updateStrategistPillWidth();

            _strategistLabelTransitTimer = window.setTimeout(() => {
                left.classList.remove('vcr-label-transit-in');
                left.classList.add('vcr-label-visible');
                _strategistLabelTransitTimer = null;
                updateStrategistPillWidth();
                resolve();
            }, STRATEGIST_LABEL_SETTLE_DELAY);
        }, STRATEGIST_LABEL_TRANSIT_DELAY);
    });
}

/** Second strategist click: Baseline fades; Optimize flows left and resolves as Optimizing… */
function animateStrategistOptimizingTransit(): Promise<void> {
    if (_strategistLabelTransitTimer != null) {
        window.clearTimeout(_strategistLabelTransitTimer);
        _strategistLabelTransitTimer = null;
    }
    _strategistVcrState = 'optimizing';

    // Turbo: skip animation
    if (isTurboActive()) {
        if (_strategistLeftLabel) {
            _strategistLeftLabel.textContent = 'Optimizing\u2026';
            _strategistLeftLabel.classList.add('vcr-label-visible');
        }
        if (_strategistRightLabel) _strategistRightLabel.textContent = '';
        updateStrategistPillWidth();
        return Promise.resolve();
    }

    // Phase 1: current labels exit leftward.
    _strategistRightLabel?.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    _strategistRightLabel?.classList.add('vcr-label-transit-out');
    _strategistLeftLabel?.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    _strategistLeftLabel?.classList.add('vcr-label-transit-out');
    updateStrategistPillWidth();

    return new Promise<void>(resolve => {
        _strategistLabelTransitTimer = window.setTimeout(() => {
            if (_strategistLeftLabel) {
                _strategistLeftLabel.classList.remove('vcr-label-transit-out');
                _strategistLeftLabel.textContent = 'Optimizing\u2026';
                _strategistLeftLabel.classList.add('vcr-label-transit-in');
            }
            if (_strategistRightLabel) {
                _strategistRightLabel.classList.remove('vcr-label-transit-out');
                _strategistRightLabel.textContent = '';
            }
            updateStrategistPillWidth();

            _strategistLabelTransitTimer = window.setTimeout(() => {
                if (_strategistLeftLabel) {
                    _strategistLeftLabel.classList.remove('vcr-label-transit-in');
                    _strategistLeftLabel.classList.add('vcr-label-visible');
                }
                _strategistLabelTransitTimer = null;
                updateStrategistPillWidth();
                resolve();
            }, STRATEGIST_LABEL_SETTLE_DELAY);
        }, STRATEGIST_LABEL_TRANSIT_DELAY);
    });
}

/** Handoff: Optimizing fades out and left wing shrinks to play-button envelope before VCR swap. */
function animateStrategistOptimizingCollapseOut(): Promise<void> {
    const panel = _strategistPanel;
    if (!panel) return Promise.resolve();
    _strategistVcrState = 'handoff';

    if (_strategistLabelTransitTimer != null) {
        window.clearTimeout(_strategistLabelTransitTimer);
        _strategistLabelTransitTimer = null;
    }

    // Turbo: skip animation
    if (isTurboActive()) {
        hideStrategistPlayButtonImmediate();
        return Promise.resolve();
    }

    if (_strategistRightLabel) {
        _strategistRightLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-in', 'vcr-label-transit-out');
        _strategistRightLabel.textContent = '';
    }
    if (_strategistLeftLabel) {
        _strategistLeftLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
        _strategistLeftLabel.classList.add('vcr-label-transit-out');
    }
    updateStrategistPillWidth();

    return new Promise<void>(resolve => {
        window.setTimeout(() => {
            hideStrategistPlayButtonImmediate();
            resolve();
        }, STRATEGIST_LABEL_TRANSIT_DELAY + 60);
    });
}

function clearStrategistLabels(): void {
    if (_strategistLabelTransitTimer != null) {
        window.clearTimeout(_strategistLabelTransitTimer);
        _strategistLabelTransitTimer = null;
    }
    if (_strategistPillResyncTimer != null) {
        window.clearTimeout(_strategistPillResyncTimer);
        _strategistPillResyncTimer = null;
    }
    if (_strategistLeftLabel) {
        _strategistLeftLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-out', 'vcr-label-transit-in');
        _strategistLeftLabel.textContent = '';
    }
    if (_strategistRightLabel) {
        _strategistRightLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-out', 'vcr-label-transit-in');
        _strategistRightLabel.textContent = '';
    }
}

function hideStrategistPlayButton(persistAsMini: boolean = false): void {
    _strategistPlayHandler = null;
    _strategistVcrState = persistAsMini ? 'handoff' : 'hidden';
    _strategistEarlyReady = false;
    _strategistQueuedFirstClick = false;
    _strategistSkipRequested = false;
    clearStrategistLabels();
    const panel = _strategistPanel;
    if (!panel) return;

    panel.classList.remove('visible');
    panel.classList.remove(STRATEGIST_VCR_LOADING_CLASS);

    if (persistAsMini) {
        panel.classList.remove(STRATEGIST_PLAY_VCR_HIDDEN_CLASS);
        panel.classList.add(STRATEGIST_PLAY_VCR_COMPACT_CLASS);
    } else {
        panel.classList.remove(STRATEGIST_PLAY_VCR_COMPACT_CLASS);
        panel.classList.add(STRATEGIST_PLAY_VCR_HIDDEN_CLASS);
    }

    if (_strategistPlayBtn) {
        _strategistPlayBtn.classList.remove('loading');
    }
}

function hideStrategistPlayButtonImmediate(): void {
    _strategistPlayHandler = null;
    _strategistVcrState = 'hidden';
    _strategistEarlyReady = false;
    _strategistQueuedFirstClick = false;
    _strategistSkipRequested = false;
    clearStrategistLabels();
    const panel = _strategistPanel;
    if (!panel) return;

    // Handoff to canonical VCR: fade out in place, do not drop below the anchor.
    panel.classList.add(STRATEGIST_VCR_HANDOFF_OUT_CLASS);
    panel.classList.remove('visible');
    panel.classList.remove(STRATEGIST_VCR_LOADING_CLASS);
    panel.classList.remove(STRATEGIST_PLAY_VCR_COMPACT_CLASS);
    panel.classList.add(STRATEGIST_PLAY_VCR_HIDDEN_CLASS);

    window.setTimeout(() => {
        panel.classList.remove(STRATEGIST_VCR_HANDOFF_OUT_CLASS);
    }, 320);

    if (_strategistPlayBtn) {
        _strategistPlayBtn.classList.remove('loading');
    }
}

function resetBiometricFlowState(): void {
    BiometricState.selectedDevices = [];
    BiometricState.profileText = '';
    BiometricState.profileDraftText = '';
    BiometricState.profileDraftStatus = 'idle';
    BiometricState.profileDraftError = null;
    BiometricState.profileDirty = false;
    BiometricState.profileSource = 'fallback';
    BiometricState.profileDraftTensionDirectives = [];
    BiometricState.biometricResult = null;
    BiometricState.channels = [];
    BiometricState.phase = 'idle';
    delete (BiometricState as any)._pois;
}

function resetRevisionFlowState(): void {
    RevisionState.revisionPromise = null;
    RevisionState.revisionResult = null;
    RevisionState.oldInterventions = null;
    RevisionState.newInterventions = null;
    RevisionState.diff = null;
    RevisionState.newLxCurves = null;
    RevisionState.referenceBundle = null;
    RevisionState.fitMetricsBefore = null;
    RevisionState.fitMetricsAfter = null;
    RevisionState.phase = 'idle';
}

configurePhaseChartRuntime({
    stopOrbitalRings,
    setOrbitalRingsState,
    setWordCloudPositions,
    cleanupMorphDrag,
    hideBiometricTrigger,
    hideInterventionPlayButton,
    hideRevisionPlayButton,
    resetBiometricState: resetBiometricFlowState,
    resetRevisionState: resetRevisionFlowState,
    deactivateCurveSculptor,
    deactivateSubstanceWall,
});
configureLxRuntime({ renderBiometricStrips });

function stopPromptPlayheadTracker() {
    const rafId = TimelineState.playheadTrackers.prompt.rafId;
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        TimelineState.playheadTrackers.prompt.rafId = null;
    }
}

function stopBioScanPlayheadTracker() {
    const rafId = TimelineState.playheadTrackers.bioScan.rafId;
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        TimelineState.playheadTrackers.bioScan.rafId = null;
    }
}

function stopBioRevealPlayheadTracker() {
    const rafId = TimelineState.playheadTrackers.bioReveal.rafId;
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        TimelineState.playheadTrackers.bioReveal.rafId = null;
    }
}

function stopBioCorrectionPlayheadTracker() {
    const rafId = TimelineState.playheadTrackers.bioCorrection.rafId;
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        TimelineState.playheadTrackers.bioCorrection.rafId = null;
    }
}

let _bioCorrectionEndTime: number | null = null;

function startBioRevealPlayheadTracker(
    engine: TimelineEngineHandle,
    revealStartTime: number,
    revealDurationMs: number,
    revealEndTime: number,
) {
    stopBioRevealPlayheadTracker();
    TimelineState.playheadTrackers.bioReveal.wallStart = performance.now();
    TimelineState.playheadTrackers.bioReveal.timelineStart = revealStartTime;

    const tick = () => {
        if (TimelineState.engine !== engine) {
            stopBioRevealPlayheadTracker();
            return;
        }

        const elapsed = performance.now() - (TimelineState.playheadTrackers.bioReveal.wallStart ?? performance.now());
        if (elapsed >= revealDurationMs) {
            engine.advanceTimeTo(revealEndTime);
            stopBioRevealPlayheadTracker();
            return;
        }

        engine.advanceTimeTo(revealStartTime + elapsed);
        TimelineState.playheadTrackers.bioReveal.rafId = requestAnimationFrame(tick);
    };

    TimelineState.playheadTrackers.bioReveal.rafId = requestAnimationFrame(tick);
}

function startBioScanPlayheadTracker(engine: TimelineEngineHandle, timelineStart: number) {
    stopBioScanPlayheadTracker();

    TimelineState.playheadTrackers.bioScan.wallStart = performance.now();
    TimelineState.playheadTrackers.bioScan.timelineStart = timelineStart;

    const tick = () => {
        const wallStart = TimelineState.playheadTrackers.bioScan.wallStart;
        if (wallStart == null || TimelineState.engine !== engine) {
            stopBioScanPlayheadTracker();
            return;
        }
        const elapsed = performance.now() - wallStart;
        engine.advanceTimeTo((TimelineState.playheadTrackers.bioScan.timelineStart ?? timelineStart) + elapsed);
        TimelineState.playheadTrackers.bioScan.rafId = requestAnimationFrame(tick);
    };

    TimelineState.playheadTrackers.bioScan.rafId = requestAnimationFrame(tick);
}

function startBioCorrectionPlayheadTracker(
    engine: TimelineEngineHandle,
    correctionStartTime: number,
    correctionDurationMs: number,
    correctionEndTime: number,
) {
    stopBioCorrectionPlayheadTracker();
    TimelineState.playheadTrackers.bioCorrection.wallStart = performance.now();
    TimelineState.playheadTrackers.bioCorrection.timelineStart = correctionStartTime;

    const tick = () => {
        if (TimelineState.engine !== engine) {
            stopBioCorrectionPlayheadTracker();
            return;
        }

        const elapsed =
            performance.now() - (TimelineState.playheadTrackers.bioCorrection.wallStart ?? performance.now());
        if (elapsed >= correctionDurationMs) {
            engine.advanceTimeTo(correctionEndTime);
            stopBioCorrectionPlayheadTracker();
            return;
        }

        engine.advanceTimeTo(correctionStartTime + elapsed);
        TimelineState.playheadTrackers.bioCorrection.rafId = requestAnimationFrame(tick);
    };

    TimelineState.playheadTrackers.bioCorrection.rafId = requestAnimationFrame(tick);
}

function estimateBioScanLaneCount(): number {
    const selected = BiometricState.selectedDevices;
    if (!Array.isArray(selected) || selected.length === 0) return 5;

    const devices = BIOMETRIC_DEVICES.devices;
    if (!Array.isArray(devices)) return 5;

    let laneCount = 0;
    for (const key of selected) {
        const dev = devices.find((d: any) => d?.key === key);
        laneCount += Array.isArray(dev?.displayChannels) ? dev.displayChannels.length : 0;
    }

    return Math.max(1, laneCount || 5);
}

configureBiometricRuntime({
    onBioScanStart: () => {
        const engine = TimelineState.engine;
        if (!engine) return;
        const timelineEngine = engine as TimelineEngine;
        stopBioRevealPlayheadTracker();
        const channelCount = estimateBioScanLaneCount(); // estimate; actual count resolved on stop
        addBioScanLine(timelineEngine, TimelineState.cursor, channelCount);
        // Track playhead continuously while biometric scan is active.
        startBioScanPlayheadTracker(engine, TimelineState.cursor);
    },
    onBioScanStop: (channelCount: number) => {
        const engine = TimelineState.engine;
        stopBioScanPlayheadTracker();
        const wallStart = TimelineState.playheadTrackers.bioScan.wallStart;
        TimelineState.playheadTrackers.bioScan.wallStart = null;
        TimelineState.playheadTrackers.bioScan.timelineStart = null;
        if (!engine || wallStart == null) return;
        const timelineEngine = engine as TimelineEngine;
        const bioScanDuration = performance.now() - wallStart;
        const phase2EndTime = TimelineState.cursor;
        TimelineState.cursor = buildPhase3Segments(timelineEngine, TimelineState.cursor, bioScanDuration, channelCount);
        const bioRevealStartTime = phase2EndTime + bioScanDuration;
        const bioRevealDuration = 600 + Math.max(0, channelCount - 1) * 80;
        const bioRevealEndTime = TimelineState.cursor;

        // Land at reveal start, then advance while strip reveal animation runs.
        engine.advanceTimeTo(bioRevealStartTime);
        startBioRevealPlayheadTracker(engine, bioRevealStartTime, bioRevealDuration, bioRevealEndTime);
    },
    onBioScanAbort: () => {
        stopBioScanPlayheadTracker();
        stopBioRevealPlayheadTracker();
        TimelineState.playheadTrackers.bioScan.wallStart = null;
        TimelineState.playheadTrackers.bioScan.timelineStart = null;
    },
    onBioCorrectionStart: () => {
        const engine = TimelineState.engine;
        if (!engine) return;
        const timelineEngine = engine as TimelineEngine;
        const correctionStartTime = TimelineState.cursor;
        TimelineState.cursor = buildPhase3BioCorrectionSegments(timelineEngine, TimelineState.cursor);
        _bioCorrectionEndTime = TimelineState.cursor;
        engine.advanceTimeTo(correctionStartTime);
        startBioCorrectionPlayheadTracker(
            engine,
            correctionStartTime,
            BIO_CORRECTION_MORPH_MS,
            _bioCorrectionEndTime,
        );
    },
    onBioCorrectionStop: () => {
        const engine = TimelineState.engine;
        stopBioCorrectionPlayheadTracker();
        TimelineState.playheadTrackers.bioCorrection.wallStart = null;
        TimelineState.playheadTrackers.bioCorrection.timelineStart = null;
        if (engine && _bioCorrectionEndTime != null) {
            engine.advanceTimeTo(_bioCorrectionEndTime);
        }
        _bioCorrectionEndTime = null;
    },
    onBioCorrectionAbort: () => {
        stopBioCorrectionPlayheadTracker();
        TimelineState.playheadTrackers.bioCorrection.wallStart = null;
        TimelineState.playheadTrackers.bioCorrection.timelineStart = null;
        _bioCorrectionEndTime = null;
    },
    onRevisionPlay: (diff: any[]) => {
        const engine = TimelineState.engine;
        if (!engine) return;
        const timelineEngine = engine as TimelineEngine;
        stopBioCorrectionPlayheadTracker();
        TimelineState.playheadTrackers.bioCorrection.wallStart = null;
        TimelineState.playheadTrackers.bioCorrection.timelineStart = null;
        _bioCorrectionEndTime = null;
        engine.resolveGate('biometric-gate');
        TimelineState.cursor = buildPhase4Segments(timelineEngine, TimelineState.cursor, diff);
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

    // In Stream mode, the form is used for search — don't launch the pipeline
    if (getCurrentMode() === 'stream') return;

    const { prompt: promptDom, phaseChart } = getAppDom();
    const prompt = promptDom.input.value.trim();
    if (!prompt || PhaseState.isProcessing) return;

    PhaseState.userGoal = prompt;
    LLMCache.startLiveFlow();
    resetRuntimeReplaySnapshotDraft();
    const replaySnapshot = isRuntimeReplayActive() ? getRuntimeReplaySnapshot() : null;

    const shouldHardResetBeforeNewPrompt =
        document.body.classList.contains('phase-engaged') || PhaseState.maxPhaseReached >= 0 || !!TimelineState.engine;
    if (shouldHardResetBeforeNewPrompt) {
        storePendingPromptForHardReset(prompt);
        window.location.reload();
        return;
    }

    const landAtLxReady = _landAtLxReadyOnNextSubmit;
    _landAtLxReadyOnNextSubmit = false;

    // Ensure no stale timeline trackers survive across prompt resubmits.
    stopPromptPlayheadTracker();
    stopBioScanPlayheadTracker();
    stopBioRevealPlayheadTracker();
    stopBioCorrectionPlayheadTracker();
    TimelineState.playheadTrackers.bioScan.wallStart = null;
    TimelineState.playheadTrackers.bioScan.timelineStart = null;
    TimelineState.playheadTrackers.bioCorrection.wallStart = null;
    TimelineState.playheadTrackers.bioCorrection.timelineStart = null;
    _bioCorrectionEndTime = null;
    TimelineState.onLxStepWait = null;
    TimelineState.onLxStepWaitOwner = null;
    TimelineState.runTasks?.cancelAll();
    TimelineState.runTasks = new TaskGroup();

    hideStrategistPlayButton();
    clearPromptError();
    PhaseState.isProcessing = true;
    PhaseState.phase = 'loading';
    document.body.classList.add('phase-engaged');
    promptDom.hint.style.opacity = '0';
    promptDom.submit.disabled = true;

    // Reset phase chart and Sherlock narration if resubmitting
    resetPhaseChart();
    clearNarration();

    // Tear down previous timeline engine if resubmitting
    if (TimelineState.engine) {
        TimelineState.engine.destroy();
        TimelineState.ribbon?.destroy();
        TimelineState.pipelineTimeline?.destroy();
        TimelineState.engine = null;
        TimelineState.ribbon = null;
        TimelineState.pipelineTimeline = null;
        TimelineState.active = false;
    }

    // Initialize timeline engine
    const engine = new TimelineEngine(phaseChart.svg);
    // TimelineState.engine is set below during engine init
    const ribbon = new TimelineRibbon(engine);
    const pipelineTimeline = new PipelineTimeline();
    TimelineState.engine = engine;
    TimelineState.ribbon = ribbon;
    TimelineState.pipelineTimeline = pipelineTimeline;
    TimelineState.active = true;
    TimelineState.interactionLocked = true;

    // Build Phase 0 setup segments and start tracking timing
    const scanLineStartTime = buildPhase0Segments(engine);
    const scanLineWallStart = performance.now();
    ribbon.show();
    pipelineTimeline.show();

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
    let _pendingPlayGateId: string | null = null;
    let _pendingPlayGateResolved = false;

    function advancePlayhead() {
        if (_playheadPaused) return;
        const wallElapsed = performance.now() - _wallBase;
        engine.advanceTimeTo(_timelineBase + wallElapsed);
    }
    function startPlayheadTracker() {
        function frame() {
            advancePlayhead();
            _playheadRafId = requestAnimationFrame(frame);
            TimelineState.playheadTrackers.prompt.rafId = _playheadRafId;
        }
        _playheadRafId = requestAnimationFrame(frame);
        TimelineState.playheadTrackers.prompt.rafId = _playheadRafId;
    }
    function stopPlayheadTracker() {
        stopPromptPlayheadTracker();
        if (_playheadRafId !== null) {
            cancelAnimationFrame(_playheadRafId);
            _playheadRafId = null;
        }
        TimelineState.playheadTrackers.prompt.rafId = null;
        if (TimelineState.onLxStepWaitOwner === engine) {
            TimelineState.onLxStepWait = null;
            TimelineState.onLxStepWaitOwner = null;
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
    TimelineState.onLxStepWaitOwner = engine;
    TimelineState.onLxStepWait = (waiting: boolean) => {
        if (TimelineState.engine !== engine) return;
        if (waiting) {
            pausePlayhead(engine.getCurrentTime());
        } else {
            if (_pendingPlayGateId && !_pendingPlayGateResolved) {
                engine.resolveGate(_pendingPlayGateId);
                _pendingPlayGateResolved = true;
            }
            if (_playheadPaused) {
                resumePlayhead(engine.getCurrentTime());
            }
        }
    };
    startPlayheadTracker();

    // Log user input to debug panel
    DebugLog.clear();

    // Clean up multi-day state (release viewBox lock, hide ribbon, restore day/night bands)
    MultiDayState.lockedViewBoxHeight = null;
    MultiDayState.maxTimelineLanes = 0;
    MultiDayState.bioBaseTranslateY = 0;
    MultiDayState.phase = 'idle';
    MultiDayState.days = [];
    MultiDayState.currentDay = 0;
    MultiDayState.bioCorrectedBaseline = null;
    MultiDayState.knightOutput = null;
    MultiDayState.startWeekday = null;
    hideWeekStrip();
    const mdRibbon = document.getElementById('multi-day-ribbon');
    if (mdRibbon) mdRibbon.classList.remove('visible', 'loading');
    document.body.classList.remove('multi-day-active');

    DebugLog.addEntry({
        stage: 'User Input',
        stageClass: 'user-input',
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
    const strategistOutcomePromise: Promise<StrategistOutcome> = mainModelPromise.then(
        result => ({ ok: true, result, settledAt: performance.now() }),
        error => ({ ok: false, error, settledAt: performance.now() }),
    );
    let strategistOutcome: StrategistOutcome | null = null;

    // Start scanning line immediately so loading feedback is always visible.
    startScanLine();
    PhaseState.phase = 'scanning';

    // === WORD CLOUD PHASE: Fast model returns 15-18 effects (primary + supporting) ===
    let wordCloudEffects;
    try {
        const fastResult = await fastModelPromise;
        const rawEffects = fastResult.effects || [];
        if (rawEffects.length === 0) throw new Error('Fast model returned no effects.');
        // Normalize: handle both new format [{name, relevance}] and legacy ["string"]
        wordCloudEffects = rawEffects.map(e => (typeof e === 'string' ? { name: e, relevance: 80 } : e));
        // Extract hook sentence from Scout result
        const hookSentence =
            typeof fastResult.hookSentence === 'string' && fastResult.hookSentence.trim().length > 0
                ? fastResult.hookSentence.trim()
                : null;
        PhaseState.hookSentence = hookSentence;
        engine.getContext().hookSentence = hookSentence;
        // Extract cycle filename from Scout result
        PhaseState.cycleFilename =
            typeof fastResult.cycleFilename === 'string' && fastResult.cycleFilename.trim().length > 0
                ? fastResult.cycleFilename.trim().slice(0, 60)
                : prompt.slice(0, 40).trim();
        // Extract badge category from Scout result
        const rawBadge =
            typeof fastResult.badgeCategory === 'string' ? fastResult.badgeCategory.trim().toUpperCase() : null;
        PhaseState.badgeCategory =
            rawBadge && (BADGE_CATEGORIES as readonly string[]).includes(rawBadge) ? rawBadge : null;
    } catch (err) {
        hideStrategistPlayButton();
        stopScanLine();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        showPromptError(err instanceof Error ? err.message : String(err));
        PhaseState.isProcessing = false;
        promptDom.submit.disabled = false;
        return;
    }

    PhaseState.wordCloudEffects = wordCloudEffects;

    // Populate engine context with word cloud effects
    engine.getContext().wordCloudEffects = wordCloudEffects;

    // Fire agent matching LLM call in parallel (resolves while curves/Lx animate)
    AgentMatchState.phase = 'ranking';
    const agentMatchPromise = rankCreatorAgents(prompt, wordCloudEffects).catch(err => {
        console.warn('[AgentMatcher] ranking failed:', err);
        return [];
    });

    // Show word cloud + orbital rings (skip if too few effects)
    const cloudCx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
    const cloudCy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
    let hasCloud = false;
    let cloudDone = true;

    if (wordCloudEffects.length >= 3) {
        PhaseState.phase = 'word-cloud';
        hasCloud = true;
        cloudDone = false;
        // Turbo: skip word cloud + orbital rings entirely — don't render them at all
        if (isTurboActive()) {
            _strategistSkipRequested = true;
            cloudDone = true;
        }
        addWordCloudSegments(engine, scanLineStartTime, wordCloudEffects);

        if (!isTurboActive()) {
            const cloudPromise = renderWordCloud(wordCloudEffects, PhaseState.hookSentence);
            startOrbitalRings(cloudCx, cloudCy);
            const cloudDonePromise = cloudPromise.then(() => {
                cloudDone = true;
            });
            showStrategistPlayButtonLoading();

            const firstEvent = await Promise.race([
                cloudDonePromise.then(() => ({ type: 'cloud' as const })),
                strategistOutcomePromise.then(outcome => ({ type: 'strategist' as const, outcome })),
            ]);

            if (firstEvent.type === 'strategist') {
                strategistOutcome = firstEvent.outcome;
                if (strategistOutcome.ok) {
                    setStrategistBaselineReadyEarly();
                }
            }

            await cloudDonePromise;
        }
    } else {
        hideStrategistPlayButton();
    }

    if (!strategistOutcome) {
        strategistOutcome = await strategistOutcomePromise;
    }
    if (strategistOutcome.ok) {
        setStrategistBaselineReadyEarly();
    }

    stopScanLine();
    const scanLineDuration = Math.max(0, strategistOutcome.settledAt - scanLineWallStart);

    if (!strategistOutcome.ok) {
        const strategistError = (strategistOutcome as { ok: false; error: any }).error;
        hideStrategistPlayButton();
        stopOrbitalRings();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        phaseChart.groups['phase-word-cloud'].replaceChildren();
        showPromptError(strategistError instanceof Error ? strategistError.message : String(strategistError));
        PhaseState.isProcessing = false;
        promptDom.submit.disabled = false;
        return;
    }

    const curvesResult = strategistOutcome.result;

    // Robust extraction: handle array, wrapped object, or single-curve object responses.
    const extractedCurvesData = extractCurvesData(curvesResult);
    const curvesData =
        replaySnapshot?.design?.curvesData && replaySnapshot.design.curvesData.length > 0
            ? replaySnapshot.design.curvesData
            : extractedCurvesData;

    // Store the Strategist's protected effect (axis the user wants preserved but isn't shown as a curve)
    PhaseState.strategistProtectedEffect =
        curvesResult && typeof curvesResult === 'object' && typeof (curvesResult as any).protectedEffect === 'string'
            ? (curvesResult as any).protectedEffect
            : '';

    if (curvesData.length === 0) {
        hideStrategistPlayButton();
        stopScanLine();
        stopOrbitalRings();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        phaseChart.groups['phase-word-cloud'].replaceChildren();
        const keys = Array.isArray(curvesResult)
            ? `[array of ${curvesResult.length}]`
            : Object.keys(curvesResult || {}).join(', ');
        console.error(
            '[CortexLoop] Curve result had no usable curves. Parsed keys:',
            keys,
            'Full result:',
            curvesResult,
        );
        showPromptError(
            `Main model returned no usable curve objects. Parsed keys: ${keys || '(empty)'}. Expected curve fields include effect, baseline[], and desired[]. Check debug panel for raw response.`,
        );
        PhaseState.isProcessing = false;
        promptDom.submit.disabled = false;
        return;
    }

    // Record scan line actual duration and add post-curve segments to timeline
    engine.getContext().curvesData = curvesData;
    let timelineCursor = addPostCurveSegments(engine, scanLineStartTime, scanLineDuration, hasCloud);

    // Milestone: scan line resolved, post-curve animations start
    // Preserve monotonic playhead time if cloud animation continued after strategist settled.
    setPlayheadMilestone(Math.max(engine.getCurrentTime(), scanLineStartTime + scanLineDuration));

    // Dismiss word cloud + morph rings into baseline curves (in parallel)
    const mainEffects = curvesData.map(c => c.effect);
    const mainColors = curvesData.map(c => c.color);

    if (hasCloud) {
        PhaseState.phase = 'word-cloud-dismiss';
        // Build Y-axes + grid simultaneously so curves have somewhere to land
        const effects = mainEffects.slice(0, AppState.maxEffects);
        PhaseState.effects = effects;
        buildPhaseYAxes(effects, mainColors, curvesData);
        phaseChart.groups['phase-y-axis-left'].classList.add('revealed');
        if (effects.length > 1) {
            phaseChart.groups['phase-y-axis-right'].classList.add('revealed');
        }
        buildPhaseGrid();

        if (_strategistSkipRequested) {
            stopWordCloudFloat();
            if (!isTurboActive()) await fadeOutHookSentenceFast(240);
            stopOrbitalRings();
            phaseChart.groups['phase-word-cloud'].replaceChildren();
        } else {
            await Promise.all([dismissWordCloud(mainEffects, mainColors), morphRingsToCurves(curvesData)]);
        }
        _strategistSkipRequested = false;

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
        phaseChart.groups['phase-x-axis'].classList.add('revealed');
    } else {
        // No cloud — standard flow
        const effects = mainEffects.slice(0, AppState.maxEffects);
        PhaseState.effects = effects;
        buildPhaseYAxes(effects, mainColors, curvesData);
        phaseChart.groups['phase-y-axis-left'].classList.add('revealed');
        if (effects.length > 1) {
            phaseChart.groups['phase-y-axis-right'].classList.add('revealed');
        }
        buildPhaseGrid();
        if (isTurboActive()) {
            renderBaselineCurvesInstant(curvesData);
        } else {
            await sleep(300);
            await renderBaselineCurves(curvesData);
        }
        renderPhaseLegend(curvesData, 'baseline');
        buildPhaseXAxis();
        phaseChart.groups['phase-x-axis'].classList.add('revealed');
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

    // === TWO-STEP GATE: Baseline → Optimize → Optimizing ===
    // Fire intervention model in background for head start
    PhaseState.interventionPromise = callInterventionModel(prompt, curvesData).catch((err: any) => {
        reportRuntimeBug({ stage: 'Chess Player', provider: '', message: err?.message || String(err) });
        return null;
    });
    const optimizeBtn = document.getElementById('phase-optimize-btn') as HTMLButtonElement;
    if (optimizeBtn) optimizeBtn.classList.add('hidden');

    PhaseState.isProcessing = false;
    promptDom.submit.disabled = false;

    // === FIRST CLICK: Baseline flows right→left and right updates to Optimize ===
    await new Promise<void>(resolve => {
        _strategistPlayHandler = async () => {
            if (_strategistVcrState !== 'analysis-baseline' && _strategistVcrState !== 'baseline-optimize') return;
            _strategistQueuedFirstClick = false;
            _strategistPlayHandler = null;
            if (_strategistPlayBtn) _strategistPlayBtn.disabled = true;
            await animateStrategistBaselineToOptimizeReady();
            if (_strategistPlayBtn) _strategistPlayBtn.disabled = false;
            _strategistVcrState = 'baseline-optimize';
            resolve();
        };
        // Always auto-advance: word cloud → chart transition shows Optimize without requiring a click
        _strategistQueuedFirstClick = false;
        queueMicrotask(() => _strategistPlayHandler?.());
    });

    // === SECOND CLICK: Baseline fades, Optimize flows left and becomes Optimizing ===
    await new Promise<void>(resolve => {
        _strategistPlayHandler = async () => {
            if (_strategistVcrState !== 'baseline-optimize') return;
            _strategistPlayHandler = null;
            if (_strategistPlayBtn) _strategistPlayBtn.disabled = true;
            await animateStrategistOptimizingTransit();
            // Put button back to loading state
            if (_strategistPlayBtn) {
                _strategistPlayBtn.classList.add('loading');
                _strategistPlayBtn.disabled = false;
            }
            _strategistPanel?.classList.add(STRATEGIST_VCR_LOADING_CLASS);
            _strategistVcrState = 'optimizing';
            resolve();
        };
        // Turbo: auto-fire second click
        if (isTurboActive()) {
            queueMicrotask(() => _strategistPlayHandler?.());
        }
    });
    PhaseState.isProcessing = true;
    promptDom.submit.disabled = true;

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
    // Keep strategist VCR in "Optimizing…" state while intervention/snapshots are prepared.
    // Start timeline scan line while waiting for intervention model
    startTimelineScanLine(3);
    const tlScanStartTime = timelineCursor;
    const tlScanWallStart = performance.now();
    addTimelineScanLine(engine, tlScanStartTime, 3);

    // Playhead milestone: Phase 1 animations done, scan line running
    setPlayheadMilestone(tlScanStartTime);

    // Wait for intervention model
    let interventionData = replaySnapshot?.design?.interventionResult || PhaseState.interventionResult;
    if (!interventionData && PhaseState.interventionPromise) {
        interventionData = await PhaseState.interventionPromise;
    }

    // Stop scan line — LLM has returned
    stopTimelineScanLine();
    const tlScanDuration = performance.now() - tlScanWallStart;

    if (!interventionData) {
        console.error('[Lx] No intervention data — model call failed or no API key.');
        showPromptError('Chess Player failed across all providers. Check API keys and debug panel.');
        hideInterventionPlayButton();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        PhaseState.isProcessing = false;
        promptDom.submit.disabled = false;
        return;
    }
    PhaseState.interventionResult = interventionData;

    const extractedInterventions = extractInterventionsData(interventionData);
    const interventions = validateInterventions(extractedInterventions, curvesData);
    if (interventions.length === 0) {
        hideInterventionPlayButton();
        stopPlayheadTracker();
        TimelineState.interactionLocked = false;
        const keys =
            interventionData && typeof interventionData === 'object' ? Object.keys(interventionData).join(', ') : '';
        showPromptError(
            `Intervention model returned no usable interventions. Parsed keys: ${keys || '(empty)'}. Check debug panel for raw response.`,
        );
        PhaseState.isProcessing = false;
        promptDom.submit.disabled = false;
        return;
    }

    // Fire Sherlock narration in parallel (non-blocking)
    let sherlockPromise: Promise<any> | null = null;
    console.log('[Sherlock] enabled:', SherlockState.enabled, '| interventions:', interventions.length);
    if (SherlockState.enabled) {
        SherlockState.phase = 'loading';

        sherlockPromise = callSherlockModel(prompt, interventions, curvesData).catch(err => {
            console.error('[Sherlock] Narration FAILED:', err);
            hideNarrationPanel();
            return null;
        });
    } else {
        console.warn('[Sherlock] DISABLED — narration skipped');
    }

    // Compute incremental Lx overlays (one per substance step)
    const replayIncrementalSnapshots = replaySnapshot?.design?.incrementalSnapshots;
    const incrementalSnapshots =
        replayIncrementalSnapshots && replayIncrementalSnapshots.length > 0
            ? replayIncrementalSnapshots
            : computeIncrementalLxOverlay(interventions, curvesData);
    PhaseState.incrementalSnapshots = incrementalSnapshots;
    PhaseState.lxCurves =
        replaySnapshot?.design?.lxCurves && replaySnapshot.design.lxCurves.length > 0
            ? replaySnapshot.design.lxCurves
            : incrementalSnapshots[incrementalSnapshots.length - 1].lxCurves;
    recordDesignReplayState({
        curvesData,
        interventionResult: PhaseState.interventionResult,
        lxCurves: PhaseState.lxCurves,
        incrementalSnapshots,
    });

    // Populate engine context with intervention data
    engine.getContext().interventions = interventions;
    engine.getContext().incrementalSnapshots = incrementalSnapshots;
    engine.getContext().lxCurves = PhaseState.lxCurves;

    // Resolve Sherlock narration before building Phase 2 segments
    // (segments check context.sherlockNarration at build time)
    const rawNarration = sherlockPromise ? await sherlockPromise : null;
    const normalizedNarration = normalizeSherlockNarration(rawNarration, interventions, SherlockState.enabled);
    const narration = normalizedNarration.narration;
    if (SherlockState.enabled) {
        if (normalizedNarration.status === 'full-fallback' && rawNarration) {
            console.warn('[Sherlock] Narration payload had no usable beats; using fallback cards from interventions.');
        } else if (normalizedNarration.status === 'full-fallback' && !rawNarration && narration) {
            console.warn('[Sherlock] Narration model unavailable; using fallback cards from interventions.');
        } else if (!narration) {
            console.warn('[Sherlock] Narration unavailable for this run.');
        }
    }
    SherlockState.narrationResult = narration;
    SherlockState.phase = narration ? 'ready' : 'idle';
    engine.getContext().sherlockNarration = narration;
    console.log(
        '[Sherlock] resolved narration:',
        narration
            ? `status=${normalizedNarration.status}, intro=${!!narration.intro}, beats=${narration.beats?.length}, outro=${!!narration.outro}`
            : 'NULL',
    );

    // Build Phase 2 segments (play gate + per-substance sweeps + cinematic playhead + sherlock narration)
    const playGateTime = tlScanStartTime + tlScanDuration; // gate position
    timelineCursor = buildPhase2Segments(
        engine,
        tlScanStartTime,
        tlScanDuration,
        interventions,
        incrementalSnapshots,
        curvesData,
    );
    TimelineState.cursor = timelineCursor;

    // Milestone: intervention model returned, pause at play gate
    pausePlayhead(playGateTime);

    PhaseState.phase = 'lx-ready';

    // Keep Sherlock hidden at the Play gate; first card appears only after Play.
    hideNarrationPanel();

    // Handoff from strategist to canonical VCR only when first substance is ready.
    await animateStrategistOptimizingCollapseOut();
    if (landAtLxReady) {
        // Stream-card loads should arrive at the Lx gate ready to press,
        // not auto-play through the first substance step.
        AppState.turboTargetPhase = 0;
    }
    showInterventionPlayButton();
    showLxStepControls(incrementalSnapshots.length);
    _pendingPlayGateId = 'play-gate';
    _pendingPlayGateResolved = false;

    PhaseState.isProcessing = true;
    promptDom.submit.disabled = true;
    PhaseState.phase = 'lx-sequential';

    // Animate sequential substance reveal (narration already resolved above)
    await animateSequentialLxReveal(incrementalSnapshots, interventions, curvesData, narration);
    _pendingPlayGateId = null;
    _pendingPlayGateResolved = false;

    PhaseState.phase = 'lx-rendered';
    PhaseState.maxPhaseReached = 2;
    PhaseState.viewingPhase = 2;

    // Milestone: Phase 2 Lx animation complete, pause at end
    pausePlayhead(timelineCursor);

    // Morph to biometric mode immediately after destination handoff completes.
    showBiometricOnVcrPanel();

    // Show matched creator agent cards alongside biometric mode
    agentMatchPromise.then(results => {
        if (results.length > 0) {
            AgentMatchState.matchResults = results;
            AgentMatchState.matchedAgents = results.map(r => getAgentById(r.agentId)).filter(Boolean);
            AgentMatchState.phase = 'matched';
            showAgentMatchPanel();
        }
    });

    // Stop the first-run playhead tracker (Phases 3/4 have their own milestone tracking via biometric callbacks)
    stopPlayheadTracker();
    // First-run imperative phase handoff complete — timeline seek/play is now safe.
    TimelineState.interactionLocked = false;

    PhaseState.isProcessing = false;
    promptDom.submit.disabled = false;

    // Show investor demo buttons after Phase 2 completes
    showDemoButtons();
}

function showDemoButtons(): void {
    const rxBtn = document.getElementById('demo-rx-btn');
    const sculptorBtn = document.getElementById('curve-sculptor-btn');
    const wallBtn = document.getElementById('substance-wall-btn');
    if (rxBtn) rxBtn.classList.remove('hidden');
    if (sculptorBtn) sculptorBtn.classList.remove('hidden');
    if (wallBtn) wallBtn.classList.remove('hidden');
}

export function initDebugPanel() {
    const appDom = getAppDom();
    const debugBtn = appDom.debugButton;
    const debugPanel = appDom.debugPanel;
    const debugClose = appDom.debugClose;

    debugBtn.addEventListener('click', () => {
        const isOpen = debugPanel.classList.contains('open');
        debugPanel.classList.toggle('open');
        debugBtn.classList.toggle('active');

        if (!isOpen) {
            appDom.settingsPopover.classList.add('hidden');
            appDom.settingsButton.classList.remove('active');
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

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;
declare const __GIT_BRANCH__: string;
declare const __BUILD_TIME__: string;

function initVersionFooter() {
    const el = document.getElementById('settings-version');
    if (!el) return;

    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
    const hash = typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : '?';
    const branch = typeof __GIT_BRANCH__ !== 'undefined' ? __GIT_BRANCH__ : '?';
    const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

    let timeStr = '';
    if (buildTime) {
        const d = new Date(buildTime);
        timeStr =
            d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
            ' ' +
            d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    el.innerHTML =
        `v${version}` + ` <span>·</span> ${hash}` + ` <span>·</span> ${branch}` + (timeStr ? `<br>${timeStr}` : '');
}

function applyBandBrightness(value: number): void {
    // value 0–100: 0 = dim (fill-opacity 0.18, brightness 1.0), 100 = max (fill-opacity 0.50, brightness 1.5)
    const t = Math.max(0, Math.min(100, value)) / 100;
    const fillOpacity = 0.18 + t * (0.5 - 0.18);
    const brightness = 1.0 + t * (1.5 - 1.0);
    document.documentElement.style.setProperty('--band-fill-opacity', fillOpacity.toFixed(3));
    document.documentElement.style.setProperty('--band-brightness', brightness.toFixed(2));
}

type SettingsVisualMode = 'design' | 'stream';

const STREAM_VISUAL_DEFAULTS = {
    cardDensity: 50,
    cardChrome: 50,
    titleScale: 50,
    titleColorIntensity: 50,
    badgeIntensity: 50,
} as const;

let visualControlsExpanded = false;

function clampVisualValue(value: number): number {
    return Math.max(0, Math.min(100, value));
}

function resolveSettingsVisualMode(): SettingsVisualMode {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (hash === 'stream' || hash === 'design') return hash;
    const stored = settingsStore.getString(STORAGE_KEYS.appMode);
    return stored === 'stream' ? 'stream' : 'design';
}

function applyStreamCardDensity(value: number): void {
    const t = (clampVisualValue(value) - 50) / 50;
    const width = 188 + t * 16;
    const gap = 12 + t * 2;
    document.documentElement.style.setProperty('--stream-card-width', `${width.toFixed(1)}px`);
    document.documentElement.style.setProperty('--stream-card-gap', `${gap.toFixed(1)}px`);
}

function applyStreamCardChrome(value: number): void {
    const t = (clampVisualValue(value) - 50) / 50;
    document.documentElement.style.setProperty('--stream-card-bg-top-alpha', (0.885 + t * 0.045).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-bg-bottom-alpha', (0.94 + t * 0.03).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-border-opacity', (0.125 + t * 0.05).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-hover-border-opacity', (0.19 + t * 0.05).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-shadow-alpha', (0.22 + t * 0.1).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-shadow-hover-alpha', (0.29 + t * 0.1).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-name-opacity', (0.9 + t * 0.08).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-prompt-alpha', (0.77 + t * 0.12).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-meta-alpha', (0.71 + t * 0.1).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-device-opacity', (0.36 + t * 0.1).toFixed(3));
    document.documentElement.style.setProperty('--stream-card-device-hover-opacity', (0.62 + t * 0.12).toFixed(3));
}

function applyStreamTitleScale(value: number): void {
    const t = (clampVisualValue(value) - 50) / 50;
    const scale = 1 + t * 0.08;
    document.documentElement.style.setProperty('--stream-title-scale', scale.toFixed(3));
}

function applyStoredStreamVisualControls(): void {
    applyStreamCardDensity(settingsStore.getNumber(STORAGE_KEYS.streamCardDensity, STREAM_VISUAL_DEFAULTS.cardDensity));
    applyStreamCardChrome(settingsStore.getNumber(STORAGE_KEYS.streamCardChrome, STREAM_VISUAL_DEFAULTS.cardChrome));
    applyStreamTitleScale(settingsStore.getNumber(STORAGE_KEYS.streamTitleScale, STREAM_VISUAL_DEFAULTS.titleScale));
}

function renderVisualControl(label: string, inputId: string, value: number): string {
    return (
        `<div class="settings-control">` +
        `<div class="settings-control-header">` +
        `<label class="settings-control-label" for="${inputId}">${label}</label>` +
        `<span class="settings-control-value" id="${inputId}-value">${value}</span>` +
        `</div>` +
        `<input id="${inputId}" type="range" min="0" max="100" value="${value}" class="settings-slider" />` +
        `</div>`
    );
}

function buildVisualControlsMarkup(mode: SettingsVisualMode): string {
    if (mode === 'design') {
        const bandValue = settingsStore.getNumber(STORAGE_KEYS.bandBrightness, 50);
        return renderVisualControl('AUC Band Brightness', 'band-brightness-slider', bandValue);
    }

    return [
        renderVisualControl(
            'Card Density',
            'stream-card-density-slider',
            settingsStore.getNumber(STORAGE_KEYS.streamCardDensity, STREAM_VISUAL_DEFAULTS.cardDensity),
        ),
        renderVisualControl(
            'Card Chrome',
            'stream-card-chrome-slider',
            settingsStore.getNumber(STORAGE_KEYS.streamCardChrome, STREAM_VISUAL_DEFAULTS.cardChrome),
        ),
        renderVisualControl(
            'Title Scale',
            'stream-title-scale-slider',
            settingsStore.getNumber(STORAGE_KEYS.streamTitleScale, STREAM_VISUAL_DEFAULTS.titleScale),
        ),
        renderVisualControl(
            'Title Color Intensity',
            'stream-title-color-intensity-slider',
            settingsStore.getNumber(STORAGE_KEYS.streamTitleColorIntensity, STREAM_VISUAL_DEFAULTS.titleColorIntensity),
        ),
        renderVisualControl(
            'Badge Intensity',
            'stream-badge-intensity-slider',
            settingsStore.getNumber(STORAGE_KEYS.streamBadgeIntensity, STREAM_VISUAL_DEFAULTS.badgeIntensity),
        ),
    ].join('');
}

function bindVisualSlider(
    sliderId: string,
    onInput: (value: number) => void,
    valueId = `${sliderId}-value`,
): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    const valueEl = document.getElementById(valueId);
    if (!slider || !valueEl) return;

    const handleInput = () => {
        const value = clampVisualValue(parseInt(slider.value, 10) || 0);
        valueEl.textContent = String(value);
        onInput(value);
    };

    slider.addEventListener('input', handleInput);
}

function renderVisualControlsSection(): void {
    const toggle = document.getElementById('visual-controls-toggle') as HTMLButtonElement | null;
    const body = document.getElementById('visual-controls-body') as HTMLElement | null;
    if (!toggle || !body) return;

    const mode = resolveSettingsVisualMode();
    toggle.setAttribute('aria-expanded', String(visualControlsExpanded));
    toggle.classList.toggle('expanded', visualControlsExpanded);
    body.hidden = !visualControlsExpanded;

    if (!visualControlsExpanded) {
        body.innerHTML = '';
        return;
    }

    body.innerHTML = buildVisualControlsMarkup(mode);

    if (mode === 'design') {
        bindVisualSlider('band-brightness-slider', value => {
            applyBandBrightness(value);
            settingsStore.setString(STORAGE_KEYS.bandBrightness, String(value));
        });
        return;
    }

    bindVisualSlider('stream-card-density-slider', value => {
        applyStreamCardDensity(value);
        settingsStore.setString(STORAGE_KEYS.streamCardDensity, String(value));
    });
    bindVisualSlider('stream-card-chrome-slider', value => {
        applyStreamCardChrome(value);
        settingsStore.setString(STORAGE_KEYS.streamCardChrome, String(value));
    });
    bindVisualSlider('stream-title-scale-slider', value => {
        applyStreamTitleScale(value);
        settingsStore.setString(STORAGE_KEYS.streamTitleScale, String(value));
    });
    bindVisualSlider('stream-title-color-intensity-slider', value => {
        settingsStore.setString(STORAGE_KEYS.streamTitleColorIntensity, String(value));
        refreshStreamCardPresentation();
    });
    bindVisualSlider('stream-badge-intensity-slider', value => {
        settingsStore.setString(STORAGE_KEYS.streamBadgeIntensity, String(value));
        refreshStreamCardPresentation();
    });
}

export function initSettings() {
    const appDom = getAppDom();
    const btn = appDom.settingsButton;
    const popover = appDom.settingsPopover;

    // Init effects select
    const effectsSelect = document.getElementById('effects-select') as HTMLSelectElement;
    const normalizeMaxEffects = (value: number) => (value === 1 ? 1 : 2);
    const normalizedMaxEffects = normalizeMaxEffects(AppState.maxEffects);
    if (normalizedMaxEffects !== AppState.maxEffects) {
        AppState.maxEffects = normalizedMaxEffects;
        settingsStore.setString(STORAGE_KEYS.maxEffects, String(normalizedMaxEffects));
    }
    effectsSelect.value = String(normalizedMaxEffects);
    effectsSelect.addEventListener('change', () => {
        const next = normalizeMaxEffects(parseInt(effectsSelect.value, 10));
        AppState.maxEffects = next;
        settingsStore.setString(STORAGE_KEYS.maxEffects, String(next));
    });

    // Init start-at-phase select (turbo skip)
    const startPhaseSelect = document.getElementById('start-phase-select') as HTMLSelectElement;
    if (startPhaseSelect) {
        startPhaseSelect.value = String(AppState.turboTargetPhase);
        startPhaseSelect.addEventListener('change', () => {
            const val = parseInt(startPhaseSelect.value, 10) || 0;
            AppState.turboTargetPhase = val;
            settingsStore.setString(STORAGE_KEYS.startAtPhase, String(val));
        });
    }

    applyBandBrightness(settingsStore.getNumber(STORAGE_KEYS.bandBrightness, 50));
    applyStoredStreamVisualControls();

    initDebugBundleExport();
    void initCycleUi();
    initVersionFooter();

    const visualControlsToggle = document.getElementById('visual-controls-toggle') as HTMLButtonElement | null;
    visualControlsToggle?.addEventListener('click', () => {
        visualControlsExpanded = !visualControlsExpanded;
        renderVisualControlsSection();
    });

    window.addEventListener('cortex:app-mode-changed', () => {
        if (!popover.classList.contains('hidden')) {
            renderVisualControlsSection();
        }
    });

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = !popover.classList.contains('hidden');
        if (isOpen) {
            popover.classList.add('hidden');
            btn.classList.remove('active');
        } else {
            popover.classList.remove('hidden');
            btn.classList.add('active');
            renderVisualControlsSection();
        }
    });

    document.addEventListener('click', e => {
        const target = e.target as HTMLElement | null;
        const clickedModeTabs = !!target?.closest('.mode-tabs');
        if (!popover.contains(target as Node) && target !== btn && !btn.contains(target as Node) && !clickedModeTabs) {
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
    const input = getAppDom().prompt.input;
    if (!btn || !container || !input) return;

    applyRxModeVisual(btn, AppState.rxMode);

    btn.addEventListener('click', () => {
        const next = AppState.rxMode === 'off' ? 'rx' : AppState.rxMode === 'rx' ? 'rx-only' : 'off';
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
// 20b. INVESTOR DEMO BUTTONS (Rx toggle, Curve Sculptor, Substance Wall)
// ============================================

function initDemoButtons(): void {
    const rxBtn = document.getElementById('demo-rx-btn');
    const sculptorBtn = document.getElementById('curve-sculptor-btn');
    const wallBtn = document.getElementById('substance-wall-btn');

    // Demo Rx toggle — cycles AppState.rxMode and notifies active features
    if (rxBtn) {
        rxBtn.addEventListener('click', () => {
            const next = AppState.rxMode === 'off' ? 'rx' : 'off';
            AppState.rxMode = next;
            rxBtn.classList.toggle('active', next === 'rx');

            // Notify active features of the Rx change
            if (isSculptorActive()) refreshSculptorRxFilter();
            if (isWallActive()) refreshWallRxFilter();
        });
    }

    // Curve sculptor toggle
    if (sculptorBtn) {
        sculptorBtn.addEventListener('click', () => {
            if (isSculptorActive()) {
                deactivateCurveSculptor();
                sculptorBtn.classList.remove('active');
            } else if (PhaseState.viewingPhase >= 2 && PhaseState.lxCurves && PhaseState.curvesData) {
                // Deactivate wall first (mutually exclusive)
                if (isWallActive()) {
                    deactivateSubstanceWall();
                    wallBtn?.classList.remove('active');
                }
                activateCurveSculptor(
                    PhaseState.lxCurves,
                    PhaseState.curvesData,
                    PhaseState.interventionResult?.interventions || [],
                );
                sculptorBtn.classList.add('active');
            }
        });
    }

    // Substance wall toggle (3-state: off → flat wall → 3D depth → off)
    if (wallBtn) {
        wallBtn.addEventListener('click', () => {
            const phase = getWallPhase();
            if (phase === 0) {
                // Activate flat wall
                if (PhaseState.viewingPhase >= 2 && PhaseState.interventionResult) {
                    if (isSculptorActive()) {
                        deactivateCurveSculptor();
                        sculptorBtn?.classList.remove('active');
                    }
                    activateSubstanceWall(PhaseState.interventionResult?.interventions || []);
                    wallBtn.classList.add('active');
                }
            } else if (phase === 1) {
                // Expand to 3D depth perspective
                expandWallDepth();
            } else {
                // Phase 2 → deactivate everything
                deactivateSubstanceWall();
                wallBtn.classList.remove('active');
            }
        });
    }
}

// ============================================
// 21. INITIALIZATION
// ============================================

export function refreshChartTheme() {
    const { phaseChart } = getAppDom();
    const t = chartTheme();
    // Update scan-line gradient stops for current theme
    const grad = document.getElementById('scan-line-grad');
    if (grad) {
        const stops = grad.querySelectorAll('stop');
        const light = isLightMode();
        const base = light ? '80,100,180' : '160,160,255';
        if (stops.length >= 3) {
            stops[0].setAttribute('stop-color', `rgba(${base},0)`);
            stops[1].setAttribute('stop-color', `rgba(${base},0.6)`);
            stops[2].setAttribute('stop-color', `rgba(${base},0)`);
        }
    }
    // Re-render grid and axes if chart is populated
    const gridGroup = phaseChart.groups['phase-grid'];
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
    const saved = settingsStore.getString(STORAGE_KEYS.theme);
    if (saved === 'light') {
        document.body.classList.add('light-mode');
    }
    refreshChartTheme();
    const btn = getAppDom().themeToggle;
    if (btn) {
        btn.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const isLight = isLightMode();
            settingsStore.setString(STORAGE_KEYS.theme, isLight ? 'light' : 'dark');
            refreshChartTheme();
            // Swap biometric device icons for the new theme (panel cards + VCR dock)
            document
                .querySelectorAll(
                    '.bio-dp-card-icon[data-src-dark], .vcr-bio-dock-icon[data-src-dark], .bio-morph-icon[data-src-dark]',
                )
                .forEach((img: any) => {
                    img.src = isLight ? img.dataset.srcLight : img.dataset.srcDark;
                });
        });
    }
}

// ============================================
// Direct Cycle Render — skip pipeline entirely for stream-page loads
// ============================================

/**
 * Render the final Phase 4 state directly from the cached replay snapshot,
 * bypassing the entire 16-agent pipeline. Returns true if successful.
 */
function renderCycleDirectFromCache(): boolean {
    if (!isRuntimeReplayActive()) return false;
    const snapshot = getRuntimeReplaySnapshot();
    if (!snapshot) return false;

    // Need revision data (Phase 4 output) and design data (base curves)
    const designCurves = snapshot.bioCorrected?.curvesData || snapshot.design?.curvesData;
    const revisionResult = snapshot.revision?.interventionResult;
    const revisionLxCurves = snapshot.revision?.lxCurves;
    if (!designCurves || !revisionResult || !revisionLxCurves) return false;

    // Extract and validate revised interventions
    const rawIvs = extractInterventionsData(revisionResult);
    const interventions = validateInterventions(rawIvs, designCurves);
    if (interventions.length === 0) return false;

    // Get biometric channels from Day 0 of week snapshot (if available)
    const day0 = snapshot.week?.days?.[0];
    const bioChannels = day0?.biometricChannels || [];

    // ── Set global state ──
    PhaseState.curvesData = designCurves;
    PhaseState.interventionResult = revisionResult;
    PhaseState.lxCurves = revisionLxCurves;
    PhaseState.incrementalSnapshots = snapshot.revision?.incrementalSnapshots || null;
    PhaseState.effects = designCurves.map((c: any) => c.effect);
    PhaseState.maxPhaseReached = 4;
    PhaseState.viewingPhase = 4;
    PhaseState.phase = 'revision-rendered';
    PhaseState.isProcessing = false;

    RevisionState.revisionResult = revisionResult;
    RevisionState.newInterventions = interventions;
    RevisionState.newLxCurves = revisionLxCurves;
    RevisionState.phase = 'rendered';

    if (bioChannels.length > 0) {
        BiometricState.channels = bioChannels;
        BiometricState.phase = 'rendered';
    }

    // ── Engage chart UI ──
    document.body.classList.add('phase-engaged');
    const { phaseChart } = getAppDom();
    const svg = phaseChart.svg as unknown as SVGSVGElement;

    // ── Render chart structure ──
    buildPhaseXAxis();
    buildPhaseGrid();
    buildPhaseYAxes(
        designCurves.map((c: any) => c.effect),
        designCurves.map((c: any) => c.color),
        designCurves,
    );

    // ── Render baseline + desired curves ──
    // morphToDesiredCurves handles both baseline dimming and desired curve creation.
    // In turbo mode (still active at this point), it's fully synchronous.
    renderBaselineCurvesInstant(designCurves);
    void morphToDesiredCurves(designCurves);

    // Dim baselines + desired to final Phase 4 visual state (Lx replaces them)
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    if (baseGroup) {
        baseGroup.querySelectorAll('.phase-baseline-path').forEach((s: any) => {
            s.setAttribute('stroke-opacity', '0.25');
        });
        baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)').forEach((f: any) => {
            f.setAttribute('fill-opacity', '0');
        });
        baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
            el.style.opacity = '0';
        });
    }
    if (desiredGroup) {
        desiredGroup.querySelectorAll('.phase-desired-fill').forEach((f: any) => {
            f.setAttribute('fill-opacity', '0');
        });
    }
    // Hide mission arrows (created by morphToDesiredCurves)
    const arrowGroup = document.getElementById('phase-mission-arrows');
    if (arrowGroup) arrowGroup.querySelectorAll('*').forEach((a: any) => a.setAttribute('opacity', '0'));

    // ── Render Lx overlay curves ──
    renderLxCurves(revisionLxCurves, designCurves);

    // ── Render substance timeline ──
    renderSubstanceTimeline(interventions, revisionLxCurves, designCurves);
    revealTimelinePillsInstant();
    renderLxBandsStatic(interventions, designCurves);

    // ── Render biometric strips ──
    if (bioChannels.length > 0) {
        renderBiometricStrips(bioChannels, true);
    }

    // ── Set viewBox to fit all content ──
    const vbParts = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vbParts.length === 4) {
        animatePhaseChartViewBoxHeight(svg, vbParts[3], 0);
    }

    // ── Place peak descriptors at Lx positions ──
    if (baseGroup) {
        baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
        const lxCurvesForLabels = designCurves.map((c: any, i: number) => ({
            ...c,
            desired: revisionLxCurves[i]?.points || [],
        }));
        placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
    }

    // ── Show "Stream" VCR button ──
    showWeekSequenceButton();

    // Deactivate turbo so animations play normally when user clicks Stream
    AppState.turboTargetPhase = 0;

    console.log('[DirectRender] Cycle loaded from cache — Phase 4 rendered, Stream button ready');
    return true;
}

document.addEventListener('DOMContentLoaded', async () => {
    resetPhaseChart();

    // Check sessionStorage first (set during explicit cycle-load reload),
    // then fall back to persistent loaded-cycle prompt in localStorage
    // (so the cycle auto-runs on every refresh / new tab until unloaded).
    let pendingPrompt = consumePendingPromptAfterHardReset();
    if (!pendingPrompt) {
        const loadedId = getLoadedCycleId();
        if (loadedId) {
            const saved = getLoadedCyclePrompt();
            if (saved) {
                pendingPrompt = { prompt: saved.prompt, rxMode: saved.rxMode as any, timestamp: Date.now() };
            }
        }
    }

    if (pendingPrompt?.rxMode === 'off' || pendingPrompt?.rxMode === 'rx' || pendingPrompt?.rxMode === 'rx-only') {
        AppState.rxMode = pendingPrompt.rxMode;
    }

    _landAtLxReadyOnNextSubmit = false;

    // Stream-page cycle load: either jump directly to the 7D replay,
    // or turbo through setup and pause at the Lx gate.
    if (pendingPrompt?.skipTo7D) {
        AppState.turboTargetPhase = 5;
    } else if (pendingPrompt?.openAtLxReady) {
        AppState.turboTargetPhase = 2;
        _landAtLxReadyOnNextSubmit = true;
    }

    initThemeToggle();
    initRuntimeErrorBanner();
    clearRuntimeBug();
    const repairedCacheStages = reconcileEnabledCacheDependencies();
    if (repairedCacheStages.length > 0) {
        reportRuntimeCacheWarning({
            title: 'Cache chain repaired',
            body: 'Saved cache toggles were out of dependency order and were corrected before this run.',
            detail: `Disabled: ${describeStageClasses(repairedCacheStages)}.`,
        });
    }
    initSettings();
    initRxMode();
    initDebugPanel();
    initAgentDesigner();
    initAgentBrowser();
    initModeSwitcher();
    initDemoButtons();
    initAnalogyOverlay();
    const appDom = getAppDom();

    appDom.prompt.form.addEventListener('submit', handlePromptSubmit);
    appDom.prompt.input.focus();

    appDom.prompt.hintExample?.addEventListener('click', e => {
        e.preventDefault();
        if (getCurrentMode() === 'stream') return;
        appDom.prompt.input.value = '4 hours of deep focus, no sleep quality impact';
        appDom.prompt.form.dispatchEvent(new Event('submit', { cancelable: true }));
    });

    if (pendingPrompt?.prompt) {
        if (appDom.prompt.input && appDom.prompt.form) {
            appDom.prompt.input.value = pendingPrompt.prompt;
            PhaseState.userGoal = pendingPrompt.prompt;

            // Direct 7D handoff: render final state directly from cache,
            // bypassing the entire pipeline. Fall back to turbo if cache is missing.
            if (pendingPrompt.skipTo7D && renderCycleDirectFromCache()) {
                // Success — chart is rendered, Stream button is showing.
                // Don't auto-submit the form.
            } else {
                // For saved cycles starting at phase 0: populate the prompt but
                // wait for the user to press submit rather than auto-running.
                // Other phases auto-run as intended.
                const isLoadedCycle = !!getLoadedCycleId();
                const startsAtPhase0 = AppState.turboTargetPhase === 0;
                if (!isLoadedCycle || !startsAtPhase0) {
                    requestAnimationFrame(() => {
                        appDom.prompt.form.dispatchEvent(new Event('submit', { cancelable: true }));
                    });
                }
            }
        }
    }

    // Prompt starts centered (class already set in HTML)
    // Cartridge section starts hidden (class already set in HTML)
});
