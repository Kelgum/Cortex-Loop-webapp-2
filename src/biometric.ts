/**
 * Biometric — Biometric Loop: device recommendation, LLM-driven profile drafting, strip rendering, revision controls, and POI overlay.
 * Exports: initBiometricFlow, executeBiometricPipeline, renderBiometricStrips, handleRevisionPhase, morphLxCurvesToRevision, showSimulationButton, launchMultiDayPipeline, showWeekSequenceButton, showDebugEndsHere
 * Depends on: constants, state, utils, llm-pipeline, lx-system, biometric-devices, svg-animate, revision-animation, sherlock, debug-panel
 */
import { PHASE_CHART, TIMELINE_ZONE, BIOMETRIC_ZONE, COMPOSITE_SLEEP, SPOTTER_MARKER } from './constants';
import {
    BiometricState,
    RevisionState,
    PhaseState,
    SherlockState,
    TimelineState,
    SimulationState,
    MultiDayState,
    AppState,
    CompileState,
    isTurboActive,
} from './state';
import { settingsStore, STORAGE_KEYS } from './settings-store';
import { svgEl, phaseChartX, sleep, interpolatePrompt, isLightMode, chartTheme, clamp, withImageRetry } from './utils';
import {
    callStageWithFallback,
    callRevisionModel,
    callSherlockRevisionModel,
    buildSlimCurveSummary,
    runCachedStage,
} from './llm-pipeline';
import { extractInterventionsData } from './llm-response-shape';
import { reportRuntimeBug } from './runtime-error-banner';
import { phaseBandPath, phasePointsToPath, phasePointsToFillPath } from './curve-utils';
import { placePeakDescriptors, buildWeekStrip, updateWeekStripDay, hideWeekStrip } from './phase-chart';
import {
    validateInterventions,
    computeLxOverlay,
    computeIncrementalLxOverlay,
    computeLxScaleFactors,
    computeLxScaleFactorsFromReference,
    allocateTimelineLanes,
    animatePhaseChartViewBoxHeight,
    attachBandHoverListeners,
    computeDoseBarWidth,
} from './lx-system';
import { DebugLog } from './debug-panel';
import { PROMPTS } from './prompts';
import {
    hideNarrationPanel,
    clearNarration,
    setVcrUpdateCallback,
    getLxStepperState,
    triggerLxPlay,
    triggerLxPrev,
    triggerLxNext,
    showSherlock7DStack,
    hideSherlock7D,
    showNarrationPanel,
    enableSherlockScrollMode,
} from './sherlock';
import { handleBioCorrectionPhase } from './bio-correction';
import { callStrategistBioModel } from './llm-pipeline';
import { runWeekPipeline, callSherlock7D, buildFallbackSherlock7D } from './week-orchestrator';
import {
    getRuntimeReplaySnapshot,
    isRuntimeReplayActive,
    recordRevisionReplayState,
    recordWeekReplayState,
} from './replay-snapshot';
import {
    playMultiDaySequence,
    seekToDay,
    renderDayState,
    pauseMultiDay,
    resumeMultiDay,
    cycleMultiDaySpeed,
    setupWeekStripDrag,
} from './multi-day-animation';
import { LLMCache } from './llm-cache';
import { resolveCachedStageHit } from './stage-cache';
import { buildRevisionReferenceBundle, computeRevisionFitMetrics } from './revision-reference';
import type { BiometricChannel, DiffEntry, LxSnapshot, StageResultMap } from './types';
import { normalizeSherlockRevisionNarration, normalizeSherlock7DNarration } from './sherlock-narration';
import { animateCompileSequence } from './compile-animation';
import { runEjectAnimation } from './eject-animation';
import { updateGamificationCurveData } from './gamification-overlay';

import { BIOMETRIC_DEVICES, BIO_RED_PALETTE, SIGNAL_METADATA } from './biometric-devices';
import { diffInterventions, animateRevisionScan } from './revision-animation';
import {
    animateBioDeviceDock,
    dockDeviceImmediate,
    undockBioDevice,
    undockAllBioDevices,
    getDockedDeviceKeys,
    isDocked,
    setDockChangeCallback,
    resyncDockedDevices,
} from './bio-device-dock';

export interface BiometricRuntime {
    onBioScanStart: () => void;
    onBioScanStop: (channelCount: number) => void;
    onBioScanAbort: () => void;
    onBioCorrectionStart: () => void;
    onBioCorrectionStop: () => void;
    onBioCorrectionAbort: () => void;
    onRevisionPlay: (diff: DiffEntry[]) => void;
    onRevisionPlayContext: (narration: unknown) => void;
}

const biometricRuntime: BiometricRuntime = {
    onBioScanStart: () => {},
    onBioScanStop: () => {},
    onBioScanAbort: () => {},
    onBioCorrectionStart: () => {},
    onBioCorrectionStop: () => {},
    onBioCorrectionAbort: () => {},
    onRevisionPlay: () => {},
    onRevisionPlayContext: () => {},
};

export function configureBiometricRuntime(runtime: Partial<BiometricRuntime>): void {
    Object.assign(biometricRuntime, runtime);
}

// ============================================
// 25. BIOMETRIC LOOP — Trigger, Flow, LLM, Rendering
// ============================================

/**
 * Position biometric HTML elements right below the SVG's rendered box.
 * Returns the top offset (px) relative to the chart container.
 */
export function getBiometricTopOffset() {
    const svg = document.getElementById('phase-chart-svg');
    if (!svg) return 0;
    const container = svg.closest('.phase-chart-container');
    if (!container) return svg.clientHeight;
    const containerRect = container.getBoundingClientRect();
    let bottom = svg.getBoundingClientRect().bottom;

    // Floating VCR modules live below the SVG in absolute positioning.
    // Anchor biometric HTML below whichever module is currently visible.
    const floatingPanels = container.querySelectorAll('.vcr-control-panel, .strategist-vcr-panel');
    floatingPanels.forEach(node => {
        const panel = node as HTMLElement;
        const cs = window.getComputedStyle(panel);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (panel.classList.contains('vcr-hidden')) return;
        if (parseFloat(cs.opacity || '1') < 0.02) return;
        const r = panel.getBoundingClientRect();
        if (r.height < 1) return;
        bottom = Math.max(bottom, r.bottom);
    });

    return bottom - containerRect.top;
}

function syncBiometricUiAnchors(): void {
    const top = getBiometricTopOffset();

    const triggerWrap = document.getElementById('biometric-trigger-wrap') as HTMLElement | null;
    if (triggerWrap && !triggerWrap.classList.contains('hidden')) {
        triggerWrap.style.top = `${top}px`;
    }

    const stripUI = document.getElementById('biometric-strip-ui') as HTMLElement | null;
    if (stripUI && !stripUI.classList.contains('hidden')) {
        stripUI.style.top = `${top + 2}px`;
    }
}

/**
 * Show the red "+" trigger button just below the SVG.
 */
export function showBiometricTrigger() {
    const wrap = document.getElementById('biometric-trigger-wrap');
    if (!wrap) return;

    // Position right below the SVG
    wrap.style.top = getBiometricTopOffset() + 'px';
    wrap.classList.remove('hidden');

    const btn = document.getElementById('bio-trigger-btn')!;
    // Remove old listener by cloning
    const fresh = btn.cloneNode(true) as HTMLElement;
    btn.parentNode!.replaceChild(fresh, btn);

    fresh.addEventListener(
        'click',
        () => {
            wrap.classList.add('hidden');
            hideNarrationPanel();
            initBiometricFlow();
        },
        { once: true },
    );
}

export function hideBiometricTrigger() {
    const wrap = document.getElementById('biometric-trigger-wrap');
    if (wrap) wrap.classList.add('hidden');
}

type ProfileStatusTone = 'neutral' | 'success' | 'warn';

function setBioProfileStatus(message: string, tone: ProfileStatusTone = 'neutral') {
    const status = document.getElementById('bio-profile-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.remove('success', 'warn');
    if (tone === 'success') status.classList.add('success');
    if (tone === 'warn') status.classList.add('warn');
}

function formatTensionDirectiveBlock(directives: string[]): string {
    if (!Array.isArray(directives)) return '';
    const clean = directives.map((d: any) => String(d || '').trim()).filter(Boolean);
    if (clean.length === 0) return '';
    return (
        'TENSION DIRECTIVES (simulate these biometric anomalies to create revision opportunities):\n' +
        clean.map((d, i) => `${i + 1}. ${d}`).join('\n')
    );
}

/**
 * Build a contextual default profile placeholder based on the user's goal
 * and the prescribed intervention protocol. Designed to create biometric
 * patterns that produce interesting revision-model adjustments.
 */
export function buildContextualProfilePlaceholder() {
    const userGoal = (PhaseState.userGoal || '').toLowerCase();
    const interventions = extractInterventionsData(PhaseState.interventionResult);
    const keys = interventions.map((iv: any) => (iv.key || '').toLowerCase());

    // Detect substance categories present
    const hasCaffeine = keys.some(
        (k: any) => k.includes('caffeine') || k.includes('theacrine') || k.includes('dynamine'),
    );
    const hasSleepAid = keys.some(
        (k: any) => k.includes('melatonin') || k.includes('glycine') || k.includes('magnesium') || k.includes('gaba'),
    );
    const hasStimulant = keys.some(
        (k: any) => k.includes('modafinil') || k.includes('methylphenidate') || k.includes('adderall'),
    );
    const hasAdaptogen = keys.some(
        (k: any) => k.includes('ashwagandha') || k.includes('rhodiola') || k.includes('theanine'),
    );
    const hasNootropic = keys.some(
        (k: any) => k.includes('tyrosine') || k.includes('citicoline') || k.includes('lion'),
    );

    // Detect goal themes
    const isFocus = /focus|concentrat|attention|productiv|work|study|deep\s*work/i.test(userGoal);
    const isSleep = /sleep|rest|recover|insomnia|wind\s*down/i.test(userGoal);
    const isEnergy = /energy|fatigue|tired|wake|alert|morning/i.test(userGoal);
    const isAnxiety = /anxi|stress|calm|relax|tension/i.test(userGoal);
    const isExercise = /exercis|workout|train|gym|run|athlet|performance|endurance/i.test(userGoal);

    // Build profile fragments that create interesting biometric tensions
    const fragments: string[] = [];

    // Age/gender — random variety
    const ages = ['28yo female', '35yo male', '42yo female', '31yo male', '38yo male', '45yo male', '33yo female'];
    fragments.push(ages[Math.floor(Math.random() * ages.length)]);

    // Exercise timing — place it where it conflicts interestingly with substances
    if (hasSleepAid || isSleep) {
        fragments.push('evening HIIT at 19:30');
    } else if (hasCaffeine || isFocus) {
        fragments.push('morning run at 6:30');
    } else if (isExercise) {
        fragments.push('strength training at 17:00');
    } else {
        const exTimes = ['yoga at 7:00', 'cycling at 17:30', 'HIIT at 18:00', 'morning jog at 6:45'];
        fragments.push(exTimes[Math.floor(Math.random() * exTimes.length)]);
    }

    // Caffeine sensitivity — creates revision pressure on stimulant doses
    if (hasCaffeine || hasStimulant) {
        fragments.push('high caffeine sensitivity (CYP1A2 slow metabolizer)');
    }

    // Sleep pattern — late sleeper + early substances = tension
    if (isFocus || isEnergy) {
        fragments.push('natural late sleeper (01:30–09:00), sluggish morning cortisol');
    } else if (isSleep) {
        fragments.push('chronic light sleeper, wakes 3-4x/night, low deep sleep %');
    }

    // Stress context — creates HRV/HR variation
    if (isAnxiety || hasAdaptogen) {
        fragments.push('high-stress job with back-to-back meetings 9–13');
    } else if (isFocus || hasNootropic) {
        fragments.push('deep work blocks 9–12 and 14–17');
    }

    // Meal timing — affects glucose, interacts with supplements
    if (interventions.some((iv: any) => (iv.timeMinutes || 0) < 480)) {
        fragments.push('skips breakfast (IF until 12:00)');
    } else {
        fragments.push('meals at 8:00, 12:30, 19:00');
    }

    // Existing condition that adds biometric interest
    if (isAnxiety) {
        fragments.push('elevated resting HR (~82 bpm), anxiety-driven HRV suppression');
    } else if (isSleep) {
        fragments.push('low baseline HRV (~28ms), poor sleep architecture');
    } else if (isExercise) {
        fragments.push('resting HR 52 bpm, VO2max 48');
    }

    // Extra tension: add a condition that conflicts with the protocol
    if (hasCaffeine && hasSleepAid) {
        fragments.push('paradoxical caffeine response (anxiogenic above 150mg)');
    } else if (hasStimulant && !hasSleepAid) {
        fragments.push('history of stimulant-induced insomnia');
    } else if (hasAdaptogen && hasNootropic) {
        fragments.push('tendency toward afternoon cognitive crashes');
    }

    return fragments.join(', ');
}

const BIO_GO_BTN_MARKUP = `
    <span class="bio-step-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
    </span>
    <span class="bio-step-label">Select Devices</span>
`;

const BIO_SUBMIT_BTN_MARKUP = `
    <span class="bio-step-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="7,4 20,12 7,20"></polygon>
        </svg>
    </span>
    <span class="bio-step-label">Run Biometric Loop</span>
`;

const BIO_SUBMIT_LOADING_MARKUP = `
    <span class="bio-step-icon bio-step-spinner-wrap" aria-hidden="true">
        <span class="bio-step-spinner"></span>
    </span>
    <span class="bio-step-label">Simulating Biometric Data</span>
`;

/**
 * Initialize the biometric device selection flow.
 * Slides down an inline strip below the SVG with device chips in a horizontal row.
 * Spotter Pass 1 (device rec) and Pass 3 (profile draft) run in the background
 * while the user selects devices.
 */
export async function initBiometricFlow() {
    // Clear any previously docked devices from a prior biometric session
    undockAllBioDevices();

    // Turbo: skip device selection UI, use last-saved devices, go straight to pipeline
    if (isTurboActive()) {
        const savedDevices = settingsStore.getJson<string[]>(STORAGE_KEYS.lastBioDevices, []);
        const allDeviceKeys = BIOMETRIC_DEVICES.devices.map((d: any) => d.key);
        const devices =
            savedDevices.length > 0 ? savedDevices.filter((k: string) => allDeviceKeys.includes(k)) : allDeviceKeys; // fallback: select all
        BiometricState.selectedDevices = devices;
        BiometricState.profileText = buildContextualProfilePlaceholder();
        BiometricState.profileSource = 'fallback';
        BiometricState.phase = 'loading';
        executeBiometricPipeline();
        return;
    }

    BiometricState.phase = 'selecting';
    BiometricState.selectedDevices = [];
    BiometricState.profileDraftText = '';
    BiometricState.profileDraftStatus = 'loading';
    BiometricState.profileDraftError = null;
    BiometricState.profileDirty = false;
    BiometricState.profileSource = 'fallback';
    BiometricState.profileDraftTensionDirectives = [];
    setBioProfileStatus('');

    // Show canon VCR with a disabled checkmark anchor — enabled when devices are selected
    configureVcrCanonAction({
        label: 'Select Devices',
        icon: ICON_CHECK,
        playClass: 'vcr-play-check',
        onClick: () => {}, // placeholder — wired up below
    });
    if (_vcrPlayBtn) {
        _vcrPlayBtn.disabled = true;
        _vcrPlayBtn.classList.add('loading');
    }

    const stripUI = document.getElementById('biometric-strip-ui')!;
    const deviceRow = document.getElementById('bio-device-row')!;
    const profileRow = document.getElementById('bio-profile-row')!;
    const goBtn = document.getElementById('bio-go-btn') as HTMLButtonElement;
    const submitBtn = document.getElementById('bio-submit-btn') as HTMLButtonElement;
    const input = document.getElementById('bio-profile-input') as HTMLInputElement;

    // Reset steps — keep strip hidden, devices live inside VCR now
    deviceRow.classList.add('hidden');
    profileRow.classList.add('hidden');
    goBtn.innerHTML = BIO_GO_BTN_MARKUP;
    goBtn.classList.remove('loading', 'bio-btn-morph-out', 'bio-btn-morph-in');
    goBtn.disabled = true;
    goBtn.style.display = 'none';
    submitBtn.innerHTML = BIO_SUBMIT_BTN_MARKUP;
    submitBtn.classList.remove('loading', 'bio-btn-morph-out', 'bio-btn-morph-in');
    submitBtn.disabled = false;
    submitBtn.style.display = 'none';

    // Fire Spotter passes in parallel while UI builds
    const spotterPromise = callSpotterDeviceRec().catch(err => {
        console.warn('[Spotter] Device rec failed, no pre-selection:', err.message);
        reportRuntimeBug({ stage: 'Spotter (Device)', provider: '', message: err.message });
        return null;
    });
    callSpotterProfileDraft()
        .then((draft: any) => {
            const text = String(draft?.profileText || '').trim();
            if (!text) throw new Error('Spotter profile draft missing profileText.');

            const directives = Array.isArray(draft?.tensionDirectives)
                ? draft.tensionDirectives.map((d: any) => String(d || '').trim()).filter(Boolean)
                : [];

            BiometricState.profileDraftText = text;
            BiometricState.profileDraftTensionDirectives = directives;
            BiometricState.profileDraftStatus = 'ready';
            BiometricState.profileDraftError = null;

            if (BiometricState.phase === 'profiling' && !BiometricState.profileDirty) {
                input.value = text;
                BiometricState.profileSource = 'spotter';
                setBioProfileStatus('Spotter profile draft loaded. Edit if needed, then run.', 'success');
            }
        })
        .catch((err: any) => {
            const msg = err?.message || String(err);
            console.warn('[Spotter] Profile draft failed, falling back:', msg);
            reportRuntimeBug({ stage: 'Spotter (Profile)', provider: '', message: msg });
            BiometricState.profileDraftText = '';
            BiometricState.profileDraftTensionDirectives = [];
            BiometricState.profileDraftStatus = 'failed';
            BiometricState.profileDraftError = msg;
            if (BiometricState.phase === 'profiling' && !BiometricState.profileDirty) {
                setBioProfileStatus('Spotter profile draft failed; using fallback context.', 'warn');
            }
        });

    // Capture VCR panel reference for closures (handleGo/handleSubmit)
    const panel = ensureVcrPanel();

    // ── Show left-side device panel (where Sherlock was) ──
    const devices = BIOMETRIC_DEVICES.devices;
    const isLight = isLightMode();
    const devicePanel = ensureBioDevicePanel();

    // Helper: sync selection from docked devices
    const syncSelection = () => {
        BiometricState.selectedDevices = getDockedDeviceKeys();
        const hasSelection = BiometricState.selectedDevices.length > 0;
        goBtn.disabled = !hasSelection;
        if (_vcrPlayBtn) _vcrPlayBtn.disabled = !hasSelection;
    };

    // Wire dock change callback so VCR updates on dock/un-dock
    setDockChangeCallback(syncSelection);

    // Build device cards
    devicePanel.innerHTML = '';
    devices.forEach((dev: any) => {
        const card = document.createElement('div');
        card.className = 'bio-dp-card';
        card.dataset.key = dev.key;

        const icon = withImageRetry(document.createElement('img'));
        icon.className = 'bio-dp-card-icon';
        icon.src = isLight ? dev.iconLight : dev.iconDark;
        icon.alt = dev.name;
        icon.draggable = false;
        icon.dataset.srcDark = dev.iconDark;
        icon.dataset.srcLight = dev.iconLight;

        const name = document.createElement('span');
        name.className = 'bio-dp-card-name';
        name.textContent = dev.name;

        card.appendChild(icon);
        card.appendChild(name);

        card.addEventListener('click', () => {
            if (isDocked(dev.key)) {
                // Un-dock: reverse animation, deselect card
                undockBioDevice(dev.key);
                card.classList.remove('selected');
            } else {
                // Dock animation to VCR left side
                card.classList.add('selected');
                card.classList.remove('spotter-recommended');
                animateBioDeviceDock(card, dev);
            }
        });

        devicePanel.appendChild(card);
    });

    // Show the panel
    showBioDevicePanel();

    // When spotter returns, stop spinner and show recommended badges (no auto-dock yet).
    // Auto-dock happens later in handleGo if user hasn't manually chosen any devices.
    let _spotterRecommended: string[] = [];
    spotterPromise.then((rec: any) => {
        if (_vcrPlayBtn) _vcrPlayBtn.classList.remove('loading');
        if (!rec || !Array.isArray(rec.recommended) || BiometricState.phase !== 'selecting') return;

        _spotterRecommended = rec.recommended;
        const cards = devicePanel.querySelectorAll('.bio-dp-card');
        cards.forEach((card: any) => {
            if (rec.recommended.includes(card.dataset.key)) {
                card.classList.add('spotter-recommended');
                if (!card.querySelector('.bio-rec-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'bio-rec-badge';
                    badge.textContent = 'REC';
                    card.appendChild(badge);
                }
            }
        });

        // Enable play button if no manual selection yet — user can click to auto-dock recs
        if (getDockedDeviceKeys().length === 0 && _spotterRecommended.length > 0) {
            if (_vcrPlayBtn) _vcrPlayBtn.disabled = false;
            goBtn.disabled = false;
        }
    });

    // --- Submit action: resolve profile context and execute pipeline ---
    const handleSubmit = () => {
        // Read context from VCR inline textarea if present, else fall back
        const vcrInput = panel.querySelector('.vcr-bio-context-input') as HTMLTextAreaElement | null;
        const inlineText = vcrInput ? vcrInput.value.trim() : '';
        const legacyText = input.value.trim();
        const profileText = inlineText || legacyText;

        if (profileText) {
            BiometricState.profileText = profileText;
        } else if (BiometricState.profileDraftStatus === 'ready' && BiometricState.profileDraftText) {
            BiometricState.profileText = BiometricState.profileDraftText;
            if (!BiometricState.profileDirty) BiometricState.profileSource = 'spotter';
        } else {
            BiometricState.profileText = buildContextualProfilePlaceholder();
            if (!BiometricState.profileDirty) BiometricState.profileSource = 'fallback';
        }
        if (BiometricState.profileDirty) {
            BiometricState.profileSource = 'user-edited';
        }

        // Persist device selection for turbo reuse
        settingsStore.setJson(STORAGE_KEYS.lastBioDevices, BiometricState.selectedDevices);

        // Hide device panel
        hideBioDevicePanel();

        // Collapse legacy strip if open
        stripUI.classList.remove('visible');
        setTimeout(() => stripUI.classList.add('hidden'), 380);
        BiometricState.phase = 'loading';
        executeBiometricPipeline();
    };
    submitBtn.onclick = handleSubmit;

    // --- Go action: show "Run Biometric Loop" with clickable right label ---
    const handleGo = () => {
        // Auto-dock recommended devices if user hasn't manually selected any.
        // Animate them as if the user clicked each card, then proceed after a delay.
        if (getDockedDeviceKeys().length === 0 && _spotterRecommended.length > 0) {
            let delay = 0;
            for (const key of _spotterRecommended) {
                const dev = devices.find((d: any) => d.key === key);
                const card = devicePanel.querySelector(`.bio-dp-card[data-key="${key}"]`) as HTMLElement | null;
                if (dev && card && !isDocked(dev.key)) {
                    setTimeout(() => {
                        if (!isDocked(dev.key)) {
                            animateBioDeviceDock(card, dev);
                        }
                    }, delay);
                    delay += 200;
                }
            }
            // Wait for dock animations to finish, then re-enter handleGo to proceed
            setTimeout(() => {
                syncSelection();
                if (BiometricState.selectedDevices.length > 0) {
                    _proceedAfterDock();
                }
            }, delay + 600);
            return;
        }
        if (BiometricState.selectedDevices.length === 0) return;
        _proceedAfterDock();
    };

    const _proceedAfterDock = () => {
        BiometricState.phase = 'profiling';
        BiometricState.profileDirty = false;

        // Hide device panel — selection is done
        hideBioDevicePanel();

        // Resolve the profile text that will pre-fill the inline editor
        let contextText = '';
        if (BiometricState.profileDraftStatus === 'ready' && BiometricState.profileDraftText) {
            contextText = BiometricState.profileDraftText;
            BiometricState.profileSource = 'spotter';
        } else {
            contextText = buildContextualProfilePlaceholder();
            BiometricState.profileSource = 'fallback';
        }

        // Update VCR: checkmark → "Run Biometric Loop" (clears device select mode)
        configureVcrCanonAction({
            label: 'Run Biometric Loop',
            icon: ICON_CHECK,
            playClass: 'vcr-play-check',
            onClick: handleSubmit,
        });

        // Make right label clickable to expand bio-context editor
        panel.classList.add('vcr-bio-context-ready');
        if (_vcrRightLabel) {
            _vcrRightLabel.style.pointerEvents = 'auto';
            _vcrRightLabel.style.cursor = 'pointer';

            _bioContextLabelClick = () => {
                if (panel.classList.contains('vcr-bio-context-open')) return;
                expandBioContextEditor(panel, contextText, handleSubmit);
            };
            _vcrRightLabel.addEventListener('click', _bioContextLabelClick);
        }
    };
    goBtn.onclick = handleGo;
    // Wire VCR checkmark to Go action initially
    _vcrOnPlayClick = handleGo;
}

/**
 * Build the intervention summary string for the biometric prompt.
 */
export function buildInterventionSummary() {
    const result = PhaseState.interventionResult;
    if (!result || !result.interventions) return 'No interventions prescribed.';
    return result.interventions
        .map((iv: any) => {
            const h = Math.floor(iv.timeMinutes / 60);
            const m = iv.timeMinutes % 60;
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            return `${iv.key} ${iv.dose || ''} at ${time}`;
        })
        .join('; ');
}

/**
 * Fallback tension directives used only when Spotter profile drafting fails.
 * Deterministic: based solely on the current intervention protocol.
 */
/**
 * Build the raw list of deterministic tension directive strings for a set of interventions.
 */
function buildFallbackTensionDirectivesList(interventions: any[]): string[] {
    if (interventions.length === 0) return [];

    const directives: string[] = [];

    for (const iv of interventions) {
        const key = (iv.key || '').toLowerCase();
        const timeMin = iv.timeMinutes || 0;
        const h = Math.floor(timeMin / 60);
        const m = timeMin % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        // --- CAFFEINE / STIMULANT tension ---
        if (key.includes('caffeine') || key.includes('theacrine') || key.includes('dynamine')) {
            if (timeMin < 540) {
                // Before 9am
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate elevated resting HR (+12-18bpm above baseline) persisting from ${timeStr} until 01:00 (hour 25). ` +
                        `Show suppressed HRV (drop 25-35ms below evening baseline) from 20:00-01:00, indicating caffeine half-life overshoot disrupting parasympathetic recovery. ` +
                        `This should justify: delaying caffeine to 09:30+ and halving the dose.`,
                );
            } else {
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate a cortisol rebound spike at ${timeStr} + 6 hours ` +
                        `(HR +8-10bpm, HRV -15ms during the 18:00-21:00 window), suggesting the dose is too high for this time of day. ` +
                        `This should justify: reducing dose by 50%.`,
                );
            }
        }

        // --- STIMULANT Rx tension ---
        if (
            key.includes('modafinil') ||
            key.includes('methylphenidate') ||
            key.includes('adderall') ||
            key.includes('ritalin') ||
            key.includes('concerta') ||
            key.includes('vyvanse') ||
            key.includes('focalin')
        ) {
            if (timeMin >= 720) {
                // Afternoon (after noon)
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate persistent elevated HR (+10-15bpm) and suppressed HRV (-20-30ms) from ${timeStr} through 23:00, ` +
                        `with elevated resp rate (+3-4 br/min) during evening wind-down. ` +
                        `Show delayed sleep onset (sleep channels stay 0 until 01:00 instead of 23:00). ` +
                        `This should justify: removing the afternoon stimulant entirely and adding an evening adaptogen (e.g., ashwagandha or theanine).`,
                );
            } else {
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate a sharp HR spike (+20bpm) and HRV crash (-30ms) at ${timeStr}+30min, ` +
                        `followed by a crash pattern at ${timeStr}+4hours (HR drops 15bpm below morning baseline, HRV overshoots +10ms briefly then crashes again). ` +
                        `This should justify: splitting the dose into two smaller doses 3 hours apart.`,
                );
            }
        }

        // --- SLEEP AID tension ---
        if (
            key.includes('melatonin') ||
            key.includes('zolpidem') ||
            key.includes('ambien') ||
            key.includes('suvorexant')
        ) {
            directives.push(
                `TENSION — ${iv.key} at ${timeStr}: Simulate poor deep sleep architecture — sleep_deep channel shows only 50-60 intensity ` +
                    `(instead of 80-100) and deep sleep onset delayed by 90 minutes past sleep start. REM cycles (sleep_rem) are shortened to 10-min fragments. ` +
                    `Show brief wake events (HR spikes +15bpm for 1-2 samples) at 02:00 and 04:00. ` +
                    `This should justify: adding glycine 1-2 hours before bed, shifting ${iv.key} 60 minutes earlier, and potentially replacing with a different sleep aid.`,
            );
        }

        // --- GLYCINE / MAGNESIUM tension ---
        if (key.includes('glycine') || key.includes('magnesium')) {
            if (timeMin < 1200) {
                // Before 8pm
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: This is too early for a sleep-support substance. ` +
                        `Simulate normal HRV during sleep but show the substance has minimal impact at this timing — ` +
                        `no improvement in deep sleep onset, baseline-level HRV during the 22:00-02:00 window. ` +
                        `This should justify: moving ${iv.key} to 21:00-22:00 for proximity to sleep onset.`,
                );
            }
        }

        // --- ADAPTOGEN tension ---
        if (key.includes('ashwagandha') || key.includes('rhodiola')) {
            if (timeMin < 600) {
                // Before 10am
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate morning drowsiness — HR stays 5-8bpm below expected waking baseline ` +
                        `until 10:00, HRV is elevated but in a sedated-not-recovered pattern. ` +
                        `This should justify: moving the adaptogen to afternoon (14:00-16:00) as a stress-buffer rather than a morning supplement.`,
                );
            }
        }

        // --- NOOTROPIC tension ---
        if (
            key.includes('tyrosine') ||
            key.includes('citicoline') ||
            key.includes('alpha-gpc') ||
            key.includes('alphagpc')
        ) {
            directives.push(
                `TENSION — ${iv.key} at ${timeStr}: Simulate an HRV pattern suggesting overstimulation — ` +
                    `HRV drops 10-15ms below baseline during the 2 hours after dosing, then overshoots briefly, ` +
                    `suggesting the nootropic is stacking with other stimulants to create excess sympathetic drive. ` +
                    `This should justify: replacing ${iv.key} with a different nootropic (e.g., swap tyrosine for lion's mane, or swap citicoline for bacopa) or reducing its dose by 50%.`,
            );
        }
    }

    // --- EXERCISE × SUBSTANCE tension ---
    // Check for stimulants near likely exercise windows
    for (const iv of interventions) {
        const k = (iv.key || '').toLowerCase();
        const t = iv.timeMinutes || 0;
        const isStim = k.includes('caffeine') || k.includes('modafinil') || k.includes('theacrine');
        if (!isStim) continue;
        // If a stimulant is dosed within 2 hours of a typical exercise window (6-8am or 17-19pm)
        const nearMorningExercise = t >= 300 && t <= 540; // 5am-9am
        const nearEveningExercise = t >= 900 && t <= 1140; // 3pm-7pm
        if (nearMorningExercise || nearEveningExercise) {
            const exWindow = nearMorningExercise ? '06:30-08:00' : '17:00-19:00';
            const h2 = Math.floor(t / 60);
            const m2 = t % 60;
            const ts = `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
            directives.push(
                `TENSION — EXERCISE+${iv.key} at ${ts}: The user likely exercises during ${exWindow}. ` +
                    `Simulate compounded cardiac stress: HR peaks at 170-180bpm instead of typical 140-160bpm during exercise ` +
                    `with ${iv.key} on board. HRV crashes to 8-12ms (dangerously low) during exercise and takes 3+ hours to recover ` +
                    `instead of the normal 30-60 minute recovery. ` +
                    `This should justify: separating the stimulant at least 3 hours from exercise, or reducing dose on exercise days.`,
            );
        }
    }

    // --- POLYPHARMACY STACKING tension ---
    // Check for 2+ substances dosed within 60 minutes of each other
    const sortedByTime = [...interventions].sort((a: any, b: any) => (a.timeMinutes || 0) - (b.timeMinutes || 0));
    for (let i = 0; i < sortedByTime.length - 1; i++) {
        const a = sortedByTime[i];
        const b = sortedByTime[i + 1];
        const gap = Math.abs((b.timeMinutes || 0) - (a.timeMinutes || 0));
        if (gap <= 60) {
            const hA = Math.floor((a.timeMinutes || 0) / 60);
            const mA = (a.timeMinutes || 0) % 60;
            const tsA = `${String(hA).padStart(2, '0')}:${String(mA).padStart(2, '0')}`;
            directives.push(
                `TENSION — POLYPHARMACY STACK at ${tsA}: ${a.key} and ${b.key} are dosed within ${gap} minutes of each other. ` +
                    `Simulate compounded HRV suppression (-25-35ms below resting baseline) lasting 4+ hours after the stack, ` +
                    `with HR elevated +10-18bpm above expected baseline during this window. Resp rate elevated +2-3 br/min. ` +
                    `This should justify: spacing these substances at least 2 hours apart, or removing one.`,
            );
        }
    }

    // --- ADAPTOGEN × STIMULANT contradiction tension ---
    const hasAdaptogenIv = interventions.some((iv: any) => {
        const k = (iv.key || '').toLowerCase();
        return k.includes('ashwagandha') || k.includes('rhodiola') || k.includes('theanine') || k.includes('reishi');
    });
    const hasStimIv = interventions.some((iv: any) => {
        const k = (iv.key || '').toLowerCase();
        return k.includes('caffeine') || k.includes('modafinil') || k.includes('theacrine') || k.includes('tyrosine');
    });
    if (hasAdaptogenIv && hasStimIv) {
        // Find the adaptogen/stim pair closest in time
        const adaptogens = interventions.filter((iv: any) => {
            const k = (iv.key || '').toLowerCase();
            return (
                k.includes('ashwagandha') || k.includes('rhodiola') || k.includes('theanine') || k.includes('reishi')
            );
        });
        const stims = interventions.filter((iv: any) => {
            const k = (iv.key || '').toLowerCase();
            return (
                k.includes('caffeine') || k.includes('modafinil') || k.includes('theacrine') || k.includes('tyrosine')
            );
        });
        for (const adpt of adaptogens) {
            for (const stm of stims) {
                const gap2 = Math.abs((adpt.timeMinutes || 0) - (stm.timeMinutes || 0));
                if (gap2 <= 180) {
                    // Within 3 hours
                    directives.push(
                        `TENSION — ADAPTOGEN×STIMULANT: ${adpt.key} and ${stm.key} are dosed within ${Math.round(gap2 / 60)}h of each other. ` +
                            `Simulate a contradictory HRV pattern: oscillating between parasympathetic activation (HRV spikes +15ms) ` +
                            `and sympathetic drive (HRV drops -15ms) in 30-45 minute waves for 3 hours after dosing. ` +
                            `HR shows erratic ±8bpm swings during this window. ` +
                            `This should justify: separating them by 4+ hours, or choosing one approach (calming vs stimulating).`,
                    );
                    break; // One directive per adaptogen is enough
                }
            }
        }
    }

    // Global tension if protocol is complex
    if (interventions.length >= 4) {
        directives.push(
            `GLOBAL TENSION: The protocol has ${interventions.length} substances. Simulate a general pattern of elevated baseline HR (+5-8bpm all day) ` +
                `and compressed HRV range (narrower oscillation, 15-20% less variation than a clean baseline), ` +
                `suggesting systemic pharmacological load. This should justify: removing at least one substance entirely.`,
        );
    }

    return directives;
}

/**
 * Fallback tension directives used only when Spotter profile drafting fails.
 * Deterministic: based solely on the current intervention protocol.
 */
export function buildFallbackTensionDirectives(): string {
    const interventions = extractInterventionsData(PhaseState.interventionResult);
    return formatTensionDirectiveBlock(buildFallbackTensionDirectivesList(interventions));
}

function buildSpotterTensionDirectiveBlock(): string {
    // Always merge LLM-generated directives with deterministic substance-specific
    // fallback directives. LLM directives alone tend to be vague and miss the
    // aggressive degradation signals that per-substance fallback directives encode.
    const llmDirectives = (BiometricState.profileDraftTensionDirectives || []).filter(Boolean);
    const interventions = extractInterventionsData(PhaseState.interventionResult);
    if (interventions.length === 0 && llmDirectives.length === 0) return '';

    // Build the deterministic directives (unformatted) for merging
    const deterministicDirectives = buildFallbackTensionDirectivesList(interventions);

    const combined = [...llmDirectives, ...deterministicDirectives];
    return formatTensionDirectiveBlock(combined);
}

// Revised biometric re-simulation removed — demonstrator does not need
// a second LLM call to re-simulate biometrics after protocol revision.
// The Lx curve morph + Sherlock revision narration are sufficient.

// ============================================
// Spotter Pass 1: Device Recommendation
// ============================================

/**
 * Call the spotter LLM to recommend which biometric devices are most relevant
 * for the current protocol. Returns recommended device keys.
 */
export async function callSpotterDeviceRec(): Promise<StageResultMap['biometricRec']> {
    const stageClass = 'biometric-rec-model';
    const userGoal = PhaseState.userGoal || '';
    const effects = PhaseState.curvesData ? PhaseState.curvesData.map((c: any) => c.effect).join(', ') : '';
    const interventionSummary = buildInterventionSummary();

    // Build device catalog with full signal lists
    const devices = BIOMETRIC_DEVICES.devices;
    const catalog = devices.map((dev: any) => ({
        key: dev.key,
        name: dev.name,
        signals: dev.fullSignals || dev.displayChannels.map((ch: any) => ch.signal),
    }));

    const systemPrompt = interpolatePrompt(PROMPTS.spotterDeviceRec, {
        userGoal,
        effectsList: effects,
        interventionSummary,
        deviceCatalog: JSON.stringify(catalog),
    });

    const userPrompt = 'Recommend the best biometric devices for this protocol. Respond with JSON only.';
    if (LLMCache.isEnabled(stageClass) && LLMCache.hasData(stageClass)) {
        const cached = resolveCachedStageHit<StageResultMap['biometricRec']>(stageClass, systemPrompt, userPrompt);
        if (!cached) {
            LLMCache.clear(stageClass);
        } else {
            DebugLog.addEntry({
                stage: 'Spotter: Device Rec',
                stageClass,
                model: 'cached',
                provider: 'local',
                systemPrompt: cached.systemPrompt,
                userPrompt: cached.userPrompt,
                requestBody: cached.requestBody,
                loading: false,
                response: cached.payload,
                duration: 0,
                cache: cached.cache,
            });
            return cached.payload;
        }
    }

    try {
        const result = await callStageWithFallback<StageResultMap['biometricRec']>({
            stage: 'biometricRec',
            stageLabel: 'Spotter: Device Rec',
            stageClass: 'biometric-rec-model',
            systemPrompt,
            userPrompt,
            maxTokens: 2048,
        });
        LLMCache.set(stageClass, result, {
            systemPrompt,
            userPrompt,
            requestBody: null,
        });
        return result;
    } catch (err: any) {
        console.error('[Spotter] Device rec failed:', err.message);
        reportRuntimeBug({ stage: 'Spotter (Device)', provider: '', message: err.message });
        return { recommended: devices.map((d: any) => d.key), reasoning: [] };
    }
}

// ============================================
// Spotter Pass 3: Profile Draft
// ============================================

/**
 * Generate a default, editable biometric profile draft plus optional
 * tension directives to increase revision pressure in downstream stages.
 */
export async function callSpotterProfileDraft(): Promise<StageResultMap['biometricProfile']> {
    const stageClass = 'biometric-profile-model';
    const userGoal = PhaseState.userGoal || '';
    const effects = PhaseState.curvesData ? PhaseState.curvesData.map((c: any) => c.effect).join(', ') : 'Unknown';
    const interventionSummary = buildInterventionSummary();

    const systemPrompt = interpolatePrompt(PROMPTS.spotterProfileDraft, {
        userGoal,
        effectsList: effects,
        interventionSummary,
    });

    const userPrompt = 'Generate the biometric profile draft and tension directives. Respond with JSON only.';
    if (LLMCache.isEnabled(stageClass) && LLMCache.hasData(stageClass)) {
        const cached = resolveCachedStageHit<StageResultMap['biometricProfile']>(stageClass, systemPrompt, userPrompt);
        if (!cached) {
            LLMCache.clear(stageClass);
        } else {
            DebugLog.addEntry({
                stage: 'Spotter: Profile Draft',
                stageClass: 'biometric-profile-model',
                model: 'cached',
                provider: 'local',
                systemPrompt: cached.systemPrompt,
                userPrompt: cached.userPrompt,
                requestBody: cached.requestBody,
                loading: false,
                response: cached.payload,
                duration: 0,
                cache: cached.cache,
            });
            return cached.payload;
        }
    }

    try {
        const result = await callStageWithFallback<StageResultMap['biometricProfile']>({
            stage: 'biometricProfile',
            stageLabel: 'Spotter: Profile Draft',
            stageClass: 'biometric-profile-model',
            systemPrompt,
            userPrompt,
            maxTokens: 2048,
            validateResult: (payload: unknown) => {
                const profileText = String(
                    (payload as StageResultMap['biometricProfile'] | null)?.profileText || '',
                ).trim();
                if (!profileText) {
                    throw new Error('Invalid Spotter profile response: expected non-empty profileText.');
                }
                return payload as StageResultMap['biometricProfile'];
            },
        });

        const profileText = String(result?.profileText || '').trim();
        const tensionDirectives = Array.isArray(result?.tensionDirectives)
            ? result.tensionDirectives.map((d: any) => String(d || '').trim()).filter(Boolean)
            : [];
        const cacheResult = {
            profileText,
            tensionDirectives,
            revisionLevers: Array.isArray(result?.revisionLevers) ? result.revisionLevers : undefined,
        };
        LLMCache.set(stageClass, cacheResult, {
            systemPrompt,
            userPrompt,
            requestBody: null,
        });
        return cacheResult;
    } catch (err: any) {
        throw err;
    }
}

// ============================================
// Spotter Pass 2: Channel Selection (after profile submit)
// ============================================

/**
 * Call the spotter LLM to pick the top 5 biometric channels from the
 * selected devices' full signal catalogs.
 */
export async function callSpotterChannelPick(): Promise<BiometricChannel[]> {
    const stageClass = 'biometric-channel-model';
    const userGoal = PhaseState.userGoal || '';
    const interventionSummary = buildInterventionSummary();
    const devices = BIOMETRIC_DEVICES.devices;

    // Build signal catalog for selected devices only
    const selectedSignals: any[] = [];
    for (const devKey of BiometricState.selectedDevices) {
        const dev = devices.find((d: any) => d.key === devKey);
        if (!dev) continue;
        const signals = dev.fullSignals || dev.displayChannels.map((ch: any) => ch.signal);
        selectedSignals.push({ device: devKey, name: dev.name, signals });
    }

    // Build signal metadata subset (only signals available from selected devices)
    const allSignals = new Set<string>();
    selectedSignals.forEach((ds: any) => ds.signals.forEach((s: string) => allSignals.add(s)));
    const metadataSubset: any = {};
    const sigMeta = SIGNAL_METADATA;
    allSignals.forEach(s => {
        if (sigMeta[s]) metadataSubset[s] = sigMeta[s];
    });

    const tensionDirectiveBlock =
        BiometricState.profileDraftStatus === 'failed'
            ? buildFallbackTensionDirectives()
            : buildSpotterTensionDirectiveBlock();

    const systemPrompt = interpolatePrompt(PROMPTS.spotterChannelPick, {
        userGoal,
        interventionSummary,
        profileText: BiometricState.profileText,
        selectedDeviceSignals: JSON.stringify(selectedSignals),
        signalMetadata: JSON.stringify(metadataSubset),
        tensionDirectiveBlock,
    });

    const userPrompt = 'Pick the 5 best biometric channels for protocol revision. Respond with JSON only.';
    if (LLMCache.isEnabled(stageClass) && LLMCache.hasData(stageClass)) {
        const cached = resolveCachedStageHit<BiometricChannel[]>(stageClass, systemPrompt, userPrompt);
        if (!cached) {
            LLMCache.clear(stageClass);
        } else {
            DebugLog.addEntry({
                stage: 'Spotter: Channel Pick',
                stageClass: 'biometric-channel-model',
                model: 'cached',
                provider: 'local',
                systemPrompt: cached.systemPrompt,
                userPrompt: cached.userPrompt,
                requestBody: cached.requestBody,
                loading: false,
                response: cached.payload,
                duration: 0,
                cache: cached.cache,
            });
            return cached.payload;
        }
    }

    try {
        const result = await callStageWithFallback<StageResultMap['biometricChannel']>({
            stage: 'biometricChannel',
            stageLabel: 'Spotter: Channel Pick',
            stageClass: 'biometric-channel-model',
            systemPrompt,
            userPrompt,
            maxTokens: 2048,
            validateResult: (payload: unknown) => {
                const pickResult = payload as StageResultMap['biometricChannel'] | null;
                if (!pickResult || !Array.isArray(pickResult.channels) || pickResult.channels.length === 0) {
                    throw new Error('Invalid Spotter channel response: expected non-empty channels array.');
                }
                const resolved = resolveChannelPicks(pickResult.channels);
                if (resolved.length === 0) {
                    throw new Error('Spotter channel picks could not be resolved to channel specs.');
                }
                return pickResult;
            },
        });
        const resolved = resolveChannelPicks(result.channels);
        LLMCache.set(stageClass, resolved, {
            systemPrompt,
            userPrompt,
            requestBody: null,
        });
        return resolved;
    } catch (err: any) {
        console.error('[Spotter] Channel pick failed:', err.message);
        reportRuntimeBug({ stage: 'Spotter (Channel)', provider: '', message: err.message });
        return buildChannelSpec();
    }
}

/**
 * Resolve LLM channel picks into renderable channel specs using SIGNAL_METADATA.
 */
function resolveChannelPicks(picks: StageResultMap['biometricChannel']['channels']): BiometricChannel[] {
    const sigMeta = SIGNAL_METADATA;
    const palette = BIO_RED_PALETTE;

    return picks.slice(0, 5).map((pick: any, idx: number) => {
        const meta = sigMeta[pick.signal];
        return {
            signal: pick.signal,
            displayName: meta?.displayName || pick.signal,
            device: pick.device,
            deviceName: pick.device,
            color: palette[idx % palette.length],
            range: meta?.range || ([0, 100] as [number, number]),
            unit: meta?.unit || '',
            stripHeight: meta?.stripHeight || 16,
        };
    });
}

/**
 * Build the channel spec from selected devices (legacy fallback).
 */
export function buildChannelSpec(): BiometricChannel[] {
    const devices = BIOMETRIC_DEVICES.devices;
    const channels: any[] = [];
    const seen = new Set();

    for (const devKey of BiometricState.selectedDevices) {
        const dev = devices.find((d: any) => d.key === devKey);
        if (!dev) continue;
        for (const ch of dev.displayChannels) {
            if (ch.composite && ch.subChannels) {
                // Composite: expand sub-channels for LLM, tag with group for renderer
                for (const sub of ch.subChannels) {
                    const tag = `${devKey}:${sub.signal}`;
                    if (seen.has(tag)) continue;
                    seen.add(tag);
                    channels.push({
                        signal: sub.signal,
                        displayName: sub.displayName,
                        device: devKey,
                        deviceName: dev.name,
                        color: sub.color,
                        range: sub.range,
                        unit: '',
                        stripHeight: ch.stripHeight,
                        _compositeGroup: ch.signal,
                        _compositeLabel: ch.displayName,
                    });
                }
            } else {
                // Tag with device for uniqueness when multiple devices share signals
                const tag = `${devKey}:${ch.signal}`;
                if (seen.has(tag)) continue;
                seen.add(tag);
                channels.push({
                    signal: ch.signal,
                    displayName: ch.displayName,
                    device: devKey,
                    deviceName: dev.name,
                    color: ch.color,
                    range: ch.range,
                    unit: ch.unit,
                    stripHeight: ch.stripHeight,
                });
            }
        }
    }
    return channels;
}

/**
 * Compute the number of render lanes (composite groups count as 1).
 */
export function computeLaneCount(channels: BiometricChannel[]): number {
    const groups = new Set();
    let count = 0;
    for (const ch of channels) {
        if (ch._compositeGroup) {
            if (!groups.has(ch._compositeGroup)) {
                groups.add(ch._compositeGroup);
                count++;
            }
        } else {
            count++;
        }
    }
    return count;
}

/**
 * Call the biometric LLM model (always claude-haiku-4-5 via Anthropic).
 */
export async function callBiometricModel(channelSpec: any): Promise<StageResultMap['biometric']> {
    const stageClass = 'biometric-model';
    const userGoal = PhaseState.userGoal || '';

    // Slim curve summary — only include every 4th point to reduce prompt size
    const curveSummary = buildSlimCurveSummary(PhaseState.curvesData);

    const tensionDirectiveBlock =
        BiometricState.profileDraftStatus === 'failed'
            ? buildFallbackTensionDirectives()
            : buildSpotterTensionDirectiveBlock();

    const systemPrompt = interpolatePrompt(PROMPTS.biometric, {
        userGoal,
        channelSpec: JSON.stringify(channelSpec),
        profileText: BiometricState.profileText,
        interventionSummary: buildInterventionSummary(),
        curveSummary: curveSummary,
        tensionDirectiveBlock,
    });

    const userPrompt = 'Simulate the 24-hour biometric data for the specified channels.';

    const result = await runCachedStage<StageResultMap['biometric']>({
        stage: 'biometric',
        stageLabel: 'Biometric Model',
        stageClass: 'biometric-model',
        systemPrompt,
        userPrompt,
        maxTokens: 8192,
    });

    return result;
}

/**
 * Export biometric-specific debug log as a downloadable JSON file.
 */
export function exportBiometricLog() {
    const bioEntries = DebugLog.entries.filter((e: any) => e.stageClass === 'biometric-model');
    if (bioEntries.length === 0) return;

    const payload = bioEntries.map((e: any) => ({
        stage: e.stage,
        stageClass: e.stageClass,
        model: e.model || null,
        duration: e.duration || null,
        timestamp: e.timestamp,
        systemPrompt: e.systemPrompt || null,
        userPrompt: e.userPrompt || null,
        response: e.response || null,
        parsed: e.parsed || null,
        error: e.error || null,
    }));
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cortex_loop_biometric_log.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('[BiometricLog] Exported', bioEntries.length, 'biometric entries to cortex_loop_biometric_log.json');
}

/**
 * Orchestrate the full biometric pipeline:
 * Spotter Pass 2 (channel pick) → Biometric LLM → parse → render strips.
 */
export async function executeBiometricPipeline() {
    // Show a loading VCR with status text (canon layout)
    const fallbackContext = BiometricState.profileDraftStatus === 'failed';
    const initialStatus = fallbackContext
        ? 'Spotter profile draft failed; using fallback context…'
        : 'SELECTING CHANNELS';
    configureVcrCanonAction({ label: initialStatus, icon: '', loading: true });

    // Spotter Pass 2: pick the 5 best channels from selected devices
    let channelSpec: any[];
    try {
        channelSpec = await callSpotterChannelPick();
    } catch (err: any) {
        console.warn('[Spotter] Channel pick failed, falling back to displayChannels:', err.message);
        reportRuntimeBug({ stage: 'Spotter (Channel)', provider: '', message: err.message });
        channelSpec = buildChannelSpec();
    }
    BiometricState.channelSpec = channelSpec;

    // Update running status text in place (canon loading VCR)
    configureVcrCanonAction({ label: 'Simulating biometric data…', icon: '', loading: true });

    const timelineOwner = TimelineState.engine;
    if (timelineOwner) {
        TimelineState.interactionLocked = true;
    }

    // Notify timeline engine that biometric phase has started
    biometricRuntime.onBioScanStart();

    try {
        const result = await callBiometricModel(channelSpec);

        if (!result || !Array.isArray(result.channels)) {
            console.error('[Biometric] Invalid LLM response — missing channels array');
            BiometricState.phase = 'idle';
            biometricRuntime.onBioScanAbort();
            setVcrPanelMode('hidden');
            return;
        }

        // Validate channels: skip any with missing/short data, and only keep
        // channels that were in the requested spec (LLM may hallucinate extras)
        const specSignals = new Set(channelSpec.map((s: any) => s.signal));
        const validChannels = result.channels.filter(
            (ch: any) =>
                ch &&
                ch.data &&
                Array.isArray(ch.data) &&
                ch.data.length >= 10 &&
                ch.signal &&
                specSignals.has(ch.signal),
        );

        if (validChannels.length === 0) {
            console.error('[Biometric] No valid channels in LLM response');
            BiometricState.phase = 'idle';
            biometricRuntime.onBioScanAbort();
            setVcrPanelMode('hidden');
            return;
        }

        // Normalize data format: LLM sometimes returns bare number arrays
        // instead of {hour, value} objects — convert them in-place
        const startH = PHASE_CHART.startHour;
        const endH = PHASE_CHART.endHour;
        for (const ch of validChannels) {
            if (ch.data.length > 0 && typeof ch.data[0] !== 'object') {
                const step = (endH - startH) / Math.max(1, ch.data.length - 1);
                ch.data = ch.data.map((v: any, i: number) => ({
                    hour: startH + i * step,
                    value: Number(v) || 0,
                }));
            }
        }

        // Merge LLM-returned colors/ranges with the spec if missing, propagate composite metadata
        for (const ch of validChannels) {
            const spec =
                channelSpec.find((s: any) => s.signal === ch.signal && s.device === ch.device) ||
                channelSpec.find((s: any) => s.signal === ch.signal);
            if (spec) {
                if (!ch.color) ch.color = spec.color;
                if (!ch.range) ch.range = spec.range;
                if (!ch.stripHeight) ch.stripHeight = spec.stripHeight;
                if (!ch.unit) ch.unit = spec.unit;
                if (spec._compositeGroup) ch._compositeGroup = spec._compositeGroup;
                if (spec._compositeLabel) ch._compositeLabel = spec._compositeLabel;
            }
        }

        // Ensure every channel's data covers the full chart range (hours 6-30).
        // The LLM sometimes stops at hour 24 (midnight) — pad to hour 30 (6am)
        // by repeating the last known value so waveforms span the full width.
        for (const ch of validChannels) {
            if (!ch.data || ch.data.length === 0) continue;
            const lastPt = ch.data[ch.data.length - 1];
            const lastHour = Number(lastPt.hour);
            if (lastHour < 30) {
                const step = ch.data.length > 1 ? Number(ch.data[1].hour) - Number(ch.data[0].hour) : 0.25;
                for (let h = lastHour + step; h <= 30; h += step) {
                    ch.data.push({ hour: +h.toFixed(2), value: lastPt.value });
                }
            }
        }

        BiometricState.biometricResult = result;
        BiometricState.channels = validChannels;
        BiometricState.phase = 'rendered';

        // Extract and store spotter highlights (external life events)
        const rawHighlights = result.highlights;
        if (Array.isArray(rawHighlights) && rawHighlights.length > 0) {
            const channelSignals = new Set(validChannels.map((ch: any) => ch.signal));
            BiometricState.spotterHighlights = rawHighlights
                .filter(
                    (h: any) =>
                        h && typeof h.hour === 'number' && h.label && h.channel && channelSignals.has(h.channel),
                )
                .map((h: any) => ({
                    hour: h.hour,
                    label: h.label,
                    channel: h.channel,
                    impact: h.impact || '',
                    icon: h.icon || '•',
                }))
                .slice(0, 5);
        } else {
            BiometricState.spotterHighlights = [];
        }

        renderBiometricStrips(validChannels);
        biometricRuntime.onBioScanStop(computeLaneCount(validChannels));
        await animateBiometricReveal(600);

        // Render spotter highlight cards below biometric strips
        if (BiometricState.spotterHighlights.length > 0) {
            renderSpotterHighlights(BiometricState.spotterHighlights, validChannels);
            await animateSpotterHighlights(800);
        }

        PhaseState.phase = 'biometric-rendered';
        PhaseState.maxPhaseReached = 3;
        PhaseState.viewingPhase = 3;

        // Show "Apply Biometrics" button — the rest of the pipeline
        // (Strategist Bio → Bio-Correction → Revision) fires when the user clicks it.
        showSimulationButton();
    } catch (err: any) {
        setVcrPanelMode('hidden');
        biometricRuntime.onBioScanAbort();
        console.error('[Biometric] Pipeline error:', err.message);
        reportRuntimeBug({ stage: 'Spotter (Sim)', provider: '', message: err.message });
        BiometricState.phase = 'idle';
    } finally {
        // Only unlock if this pipeline still owns the active timeline instance.
        if (timelineOwner && TimelineState.engine === timelineOwner) {
            TimelineState.interactionLocked = false;
        }
    }
}

/**
 * Render biometric strips as oscilloscope-style waveforms below the substance timeline.
 * Supports composite channels (e.g. sleep_deep/rem/light rendered as overlaid lines in one lane).
 */
export function renderBiometricStrips(channels: BiometricChannel[], instant?: boolean, anchorSepY?: number) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;
    group.innerHTML = '';

    // Force red-shade palette on non-composite channels
    const redShades = BIO_RED_PALETTE;
    let redIdx = 0;
    channels.forEach((ch: any) => {
        if (!ch._compositeGroup) {
            ch.color = redShades[redIdx % redShades.length];
            redIdx++;
        }
        // Composite channels keep their assigned colors
    });

    // Build render lanes: group composite sub-channels into single lanes
    interface RenderLane {
        type: 'single' | 'composite';
        channels: any[];
        label: string;
        height: number;
    }
    const lanes: RenderLane[] = [];
    const compositeGroups = new Map<string, any[]>();
    const compositeOrder: string[] = [];

    for (const ch of channels) {
        if (ch._compositeGroup) {
            if (!compositeGroups.has(ch._compositeGroup)) {
                compositeGroups.set(ch._compositeGroup, []);
                compositeOrder.push(ch._compositeGroup);
            }
            compositeGroups.get(ch._compositeGroup)!.push(ch);
        } else {
            lanes.push({
                type: 'single',
                channels: [ch],
                label: ch.metric || ch.displayName || ch.signal,
                height: ch.stripHeight || BIOMETRIC_ZONE.laneH,
            });
        }
    }
    for (const groupKey of compositeOrder) {
        const subChannels = compositeGroups.get(groupKey)!;
        const first = subChannels[0];
        lanes.push({
            type: 'composite',
            channels: subChannels,
            label: first._compositeLabel || 'Sleep',
            height: first.stripHeight || COMPOSITE_SLEEP.laneH,
        });
    }

    const svg = document.getElementById('phase-chart-svg')!;
    const defs = svg.querySelector('defs')!;
    const currentVB = svg.getAttribute('viewBox')!.split(' ').map(Number);
    let currentH = currentVB[3];

    // Draw separator line.
    // If anchorSepY is supplied, preserve previous vertical placement.
    const sepY =
        typeof anchorSepY === 'number' && Number.isFinite(anchorSepY)
            ? anchorSepY
            : currentH + BIOMETRIC_ZONE.separatorPad;
    const sep = svgEl('line', {
        x1: String(PHASE_CHART.padL),
        y1: String(sepY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
        y2: String(sepY),
        class: 'biometric-separator',
    });
    group.appendChild(sep);

    let yOffset = sepY + BIOMETRIC_ZONE.separatorPad;

    lanes.forEach((lane, laneIdx) => {
        const y = yOffset;
        const h = lane.height;

        // Store render coordinates on each channel for multi-day morphing
        lane.channels.forEach((ch: any) => {
            ch._renderY = y;
            ch._renderH = h;
        });

        // Alternating lane background stripe
        if (laneIdx % 2 === 0) {
            const stripe = svgEl('rect', {
                x: String(PHASE_CHART.padL),
                y: String(y),
                width: String(PHASE_CHART.plotW),
                height: String(h),
                fill: 'rgba(255, 255, 255, 0.015)',
                rx: '1',
            });
            group.appendChild(stripe);
        }

        // Left-margin label with accent bar
        const labelColor =
            lane.type === 'composite'
                ? COMPOSITE_SLEEP.subChannels[1]?.color || '#8b5cf6'
                : lane.channels[0].color || 'rgba(238, 244, 255, 0.65)';

        // Thin colored accent bar at plot left edge (visual anchor)
        const accentBar = svgEl('rect', {
            x: String(PHASE_CHART.padL - 1.5),
            y: String(y + 2),
            width: '1.5',
            height: String(h - 4),
            fill: labelColor,
            opacity: '0.45',
            rx: '0.75',
            class: 'bio-strip-accent',
        });
        group.appendChild(accentBar);

        const label = svgEl('text', {
            x: String(PHASE_CHART.padL - 6),
            y: String(y + h / 2),
            class: 'bio-strip-label',
            fill: labelColor,
            'text-anchor': 'end',
        });
        label.textContent = lane.label;
        group.appendChild(label);

        // Unit subtitle (dimmer, below label) — only if lane is tall enough
        const chUnit = lane.channels[0]?.unit;
        if (chUnit && h >= 20) {
            const unitLabel = svgEl('text', {
                x: String(PHASE_CHART.padL - 6),
                y: String(y + h / 2 + 9),
                class: 'bio-strip-unit',
                fill: labelColor,
                'text-anchor': 'end',
            });
            unitLabel.textContent = chUnit;
            group.appendChild(unitLabel);
        }

        // Build waveform group
        const stripG = svgEl('g', { class: 'bio-strip-group' });
        stripG.setAttribute('data-channel', lane.channels.map((c: any) => c.signal).join(','));

        if (lane.type === 'single') {
            const ch = lane.channels[0];
            if (ch.signal === 'hr_bpm') stripG.classList.add('bio-strip-hr');

            const { strokeD, fillD } = buildBiometricWaveformPath(ch.data, ch.range, y, h);
            if (fillD) {
                stripG.appendChild(
                    svgEl('path', {
                        d: fillD,
                        class: 'bio-strip-fill',
                        fill: ch.color || '#ff6b6b',
                    }),
                );
            }
            stripG.appendChild(
                svgEl('path', {
                    d: strokeD,
                    class: 'bio-strip-path',
                    stroke: ch.color || '#ff6b6b',
                }),
            );
        } else {
            // Composite: render all sub-channel paths overlaid
            for (const subCh of lane.channels) {
                const subColor = subCh.color || '#8b5cf6';
                const { strokeD, fillD } = buildBiometricWaveformPath(subCh.data, subCh.range, y, h);
                if (fillD) {
                    stripG.appendChild(
                        svgEl('path', {
                            d: fillD,
                            class: 'bio-strip-fill bio-composite-fill',
                            fill: subColor,
                        }),
                    );
                }
                stripG.appendChild(
                    svgEl('path', {
                        d: strokeD,
                        class: 'bio-strip-path bio-composite-path',
                        stroke: subColor,
                    }),
                );
            }

            // Mini-legend: colored dots + labels at right edge
            const legendX = PHASE_CHART.padL + PHASE_CHART.plotW + 6;
            for (let si = 0; si < lane.channels.length; si++) {
                const subCh = lane.channels[si];
                const subColor = subCh.color || COMPOSITE_SLEEP.subChannels[si]?.color || '#8b5cf6';
                const legendY = y + 4 + si * 7;

                stripG.appendChild(
                    svgEl('circle', {
                        cx: String(legendX + 3),
                        cy: String(legendY),
                        r: '2',
                        fill: subColor,
                    }),
                );
                const legendLabel = svgEl('text', {
                    x: String(legendX + 8),
                    y: String(legendY + 1.5),
                    class: 'bio-strip-legend-label',
                    fill: subColor,
                });
                legendLabel.textContent = subCh.displayName || subCh.signal;
                stripG.appendChild(legendLabel);
            }
        }

        // Clip path — constrains waveforms to the plot area on the left
        // (prevents bleeding into the label margin) while leaving the right
        // edge unconstrained.  For animated reveal the clip starts at width 0
        // and expands; for instant re-renders it starts at full width.
        {
            const clipId = `bio-clip-${laneIdx}`;
            const clipPath = svgEl('clipPath', { id: clipId });
            const fullW = PHASE_CHART.viewW - PHASE_CHART.padL;
            const clipRect = svgEl('rect', {
                x: String(PHASE_CHART.padL),
                y: String(y - 2),
                width: instant ? String(fullW) : '0',
                height: String(h + 4),
            });
            clipPath.appendChild(clipRect);
            defs.appendChild(clipPath);
            stripG.setAttribute('clip-path', `url(#${clipId})`);
            if (!instant) (stripG as any).dataset.clipId = clipId;
        }

        group.appendChild(stripG);
        yOffset += h + BIOMETRIC_ZONE.laneGap;
    });

    // Expand viewBox to fit all strips
    const totalH = yOffset + BIOMETRIC_ZONE.bottomPad;
    const targetH = Math.max(currentH, totalH);
    if (instant) {
        svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${targetH}`);
    } else {
        // Smoothly expand so the bio zone doesn't pop
        void animatePhaseChartViewBoxHeight(svg as unknown as SVGSVGElement, targetH, 500);
    }
}

/**
 * Build SVG path data for a biometric waveform strip.
 * Uses monotone cubic (Fritsch-Carlson) for smooth curves — same approach as phasePointsToPath.
 */
export function buildBiometricWaveformPath(data: any, range: any, yTop: any, height: any) {
    if (!data || data.length < 2) return { strokeD: '', fillD: '' };

    const [rMin, rMax] = range || [0, 100];
    const rSpan = rMax - rMin || 1;

    // Map data to SVG coords
    const coords = data.map((p: any) => ({
        x: phaseChartX(Number(p.hour) * 60),
        y: yTop + height - ((Math.max(rMin, Math.min(rMax, Number(p.value))) - rMin) / rSpan) * height,
    }));

    // Monotone cubic interpolation (same as phasePointsToPath)
    const n = coords.length;
    if (n === 2) {
        const strokeD = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`;
        const baseY = yTop + height;
        const fillD =
            strokeD +
            ` L ${coords[1].x.toFixed(1)} ${baseY.toFixed(1)} L ${coords[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`;
        return { strokeD, fillD };
    }

    const dx = new Array(n - 1);
    const dy = new Array(n - 1);
    const m = new Array(n - 1);
    const t = new Array(n);

    for (let i = 0; i < n - 1; i++) {
        dx[i] = coords[i + 1].x - coords[i].x;
        dy[i] = coords[i + 1].y - coords[i].y;
        m[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
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

    let strokeD = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
        const p0 = coords[i];
        const p1 = coords[i + 1];
        const h = dx[i];
        const cp1x = p0.x + h / 3;
        const cp1y = p0.y + (t[i] * h) / 3;
        const cp2x = p1.x - h / 3;
        const cp2y = p1.y - (t[i + 1] * h) / 3;
        strokeD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }

    // Fill: close path along bottom
    const baseY = yTop + height;
    const fillD =
        strokeD +
        ` L ${coords[n - 1].x.toFixed(1)} ${baseY.toFixed(1)}` +
        ` L ${coords[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`;

    return { strokeD, fillD };
}

// ============================================
// Spotter Highlights — Event Markers with Strip Zoom
// ============================================

// Module-level zoom state
let _spotterZoomedGroup: SVGGElement | null = null;
let _spotterLeaveTimer: number = 0;

/**
 * Interpolate the value of a biometric channel at a given hour.
 * Finds the two nearest data points and linearly interpolates between them.
 */
function interpolateChannelValue(data: any[], hour: number): number {
    if (!data || data.length === 0) return 50;
    if (data.length === 1) return data[0].value ?? 50;

    let lo = data[0],
        hi = data[data.length - 1];
    for (let i = 0; i < data.length - 1; i++) {
        if (data[i].hour <= hour && data[i + 1].hour >= hour) {
            lo = data[i];
            hi = data[i + 1];
            break;
        }
    }

    const span = hi.hour - lo.hour;
    if (span <= 0) return lo.value ?? 50;
    const t = (hour - lo.hour) / span;
    return lo.value + (hi.value - lo.value) * t;
}

/** Run relaxation layout with per-element widths.  Returns left-edge X array. */
function _spotterRelaxLayout(
    bioXs: number[],
    widths: number[],
    plotLeft: number,
    plotRight: number,
    gap: number,
): number[] {
    const n = bioXs.length;
    const xs = bioXs.map((bx, i) => bx - widths[i] / 2);
    const cl = (v: number, i: number) => Math.max(plotLeft, Math.min(plotRight - widths[i], v));
    for (let i = 0; i < n; i++) xs[i] = cl(xs[i], i);

    for (let pass = 0; pass < 30; pass++) {
        let moved = false;
        for (let i = 0; i < n - 1; i++) {
            const overlap = xs[i] + widths[i] + gap - xs[i + 1];
            if (overlap > 0) {
                const shift = overlap / 2 + 0.5;
                xs[i] = cl(xs[i] - shift, i);
                xs[i + 1] = cl(xs[i + 1] + shift, i + 1);
                moved = true;
            }
        }
        if (!moved) break;
    }
    for (let i = 0; i < n - 1; i++) {
        const minNext = xs[i] + widths[i] + gap;
        if (xs[i + 1] < minNext) xs[i + 1] = cl(minNext, i + 1);
    }
    return xs;
}

/** Estimate the SVG width of a flag label pill. */
function _estimateFlagWidth(icon: string, label: string): number {
    const { flagPadX, flagIconSize, flagLabelSize, flagLabelMaxChars } = SPOTTER_MARKER;
    const truncated = label.length > flagLabelMaxChars ? label.slice(0, flagLabelMaxChars - 1) + '\u2026' : label;
    const textW = flagIconSize + 2 + truncated.length * flagLabelSize * 0.58;
    return flagPadX * 2 + textW;
}

/** Format an hour (float) as "H:MM" or "H:MMam/pm". */
function _formatHour(h: number): string {
    const wrapped = h >= 24 ? h - 24 : h;
    const hr = Math.floor(wrapped);
    const min = Math.round((wrapped - hr) * 60);
    return `${hr}:${min < 10 ? '0' : ''}${min}`;
}

/** Clean up previous zoom infrastructure on biometric strips. */
function _spotterCleanupZoom() {
    clearTimeout(_spotterLeaveTimer);
    _spotterZoomedGroup = null;

    // Remove zoomable class, zoom-active, and transforms from all strip groups
    document.querySelectorAll('.spotter-zoomable').forEach(el => {
        el.classList.remove('spotter-zoomable', 'spotter-zoom-active');
        (el as HTMLElement).style.transform = '';
    });

    // Unwrap any clip wrappers (restore original DOM)
    document.querySelectorAll('.spotter-clip-wrapper').forEach(wrapper => {
        const stripG = wrapper.querySelector('.bio-strip-group');
        if (stripG && wrapper.parentElement) {
            wrapper.parentElement.insertBefore(stripG, wrapper);
        }
        wrapper.remove();
    });

    // Remove zone clip path from defs
    const svg = document.getElementById('phase-chart-svg');
    if (svg) {
        const defs = svg.querySelector('defs');
        if (defs) {
            const zoneClip = defs.querySelector('#spotter-zone-clip');
            if (zoneClip) zoneClip.remove();
        }
    }

    // Remove focus dimming from biometric strip elements
    document.querySelectorAll('.spotter-focus-dimmed').forEach(el => {
        el.classList.remove('spotter-focus-dimmed');
    });

    // Remove zoomed-active class from spotter highlights group
    const spotterGroup = document.getElementById('phase-spotter-highlights');
    if (spotterGroup) spotterGroup.classList.remove('spotter-zoomed-active');
}

/** Populate the top info bar for the zoomed biometric view. */
function _populateInfoPill(
    pill: SVGGElement,
    highlight: any,
    channel: any,
    _markerX: number,
    zoneTop: number,
    plotLeft: number,
    plotRight: number,
) {
    pill.innerHTML = '';
    const theme = chartTheme();

    const icon = highlight.icon || '\u2022';
    const label = (highlight.label || '').trim();
    const impact = (highlight.impact || '').trim();
    const color = channel.color || '#ff4444';
    const displayName = channel.displayName || channel.signal || '';

    const barH = 20;
    const barY = zoneTop;

    // Semi-transparent background bar
    pill.appendChild(
        svgEl('rect', {
            x: String(plotLeft),
            y: String(barY),
            width: String(plotRight - plotLeft),
            height: String(barH),
            rx: '2',
            ry: '2',
            fill: theme.tooltipBg,
            'fill-opacity': '0.85',
            class: 'spotter-info-pill-bg',
        }),
    );

    // Left: channel name badge
    const chFontSize = 9;
    const chText = displayName.toUpperCase();
    const chW = chText.length * chFontSize * 0.54 + 12;
    pill.appendChild(
        svgEl('rect', {
            x: String(plotLeft + 3),
            y: String(barY + 3),
            width: String(chW),
            height: String(barH - 6),
            rx: '2',
            ry: '2',
            fill: color,
            'fill-opacity': '0.12',
            stroke: color,
            'stroke-width': '0.4',
            'stroke-opacity': '0.25',
        }),
    );
    const chEl = svgEl('text', {
        x: String(plotLeft + 3 + chW / 2),
        y: String(barY + barH / 2),
        fill: color,
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': String(chFontSize),
        'font-weight': '600',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'fill-opacity': '0.85',
        'letter-spacing': '0.3',
        'pointer-events': 'none',
    });
    chEl.textContent = chText;
    pill.appendChild(chEl);

    // Center: event icon + label (truncated to fit bar)
    const availLeft = plotLeft + 3 + chW + 10; // after channel badge + gap
    const availRight = plotRight - 60; // before time display
    const maxChars = Math.floor((availRight - availLeft) / 7); // ~7px per char at 12px
    let truncLabel = label;
    if (truncLabel.length > maxChars) {
        truncLabel = truncLabel.slice(0, maxChars - 1).trimEnd() + '\u2026';
    }
    const titleText = `${icon}  ${truncLabel}`;
    const titleX = availLeft + (availRight - availLeft) / 2;
    const titleEl = svgEl('text', {
        x: String(titleX),
        y: String(barY + barH / 2),
        fill: isLightMode() ? 'rgba(30, 45, 65, 0.92)' : 'rgba(225, 235, 250, 0.92)',
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '12',
        'font-weight': '500',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'pointer-events': 'none',
    });
    titleEl.textContent = titleText;
    pill.appendChild(titleEl);

    // Right: time
    const timeEl = svgEl('text', {
        x: String(plotRight - 5),
        y: String(barY + barH / 2),
        fill: isLightMode() ? 'rgba(40, 55, 80, 0.55)' : 'rgba(174, 201, 237, 0.55)',
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '9',
        'text-anchor': 'end',
        'dominant-baseline': 'central',
        'pointer-events': 'none',
    });
    timeEl.textContent = _formatHour(highlight.hour);
    pill.appendChild(timeEl);
}

/**
 * Populate a vertical crosshair at the event position in zoomed space.
 * Shows a dashed vertical line + small anchor dot where the event is.
 */
function _populateZoomCrosshair(
    crosshair: SVGGElement,
    eventX: number,
    anchorY: number,
    zoneTop: number,
    zoneH: number,
    color: string,
    sx: number,
    tx: number,
    sy: number,
    ty: number,
) {
    crosshair.innerHTML = '';

    // Compute where the event X appears in zoomed space
    const apparentX = eventX * sx + tx;
    // Compute where the anchor dot appears in zoomed space
    const apparentY = anchorY * sy + ty;
    const barH = 16; // info bar height at top

    // Vertical dashed line from below the info bar to bottom of zone
    crosshair.appendChild(
        svgEl('line', {
            x1: String(apparentX),
            y1: String(zoneTop + barH),
            x2: String(apparentX),
            y2: String(zoneTop + zoneH),
            stroke: color,
            'stroke-width': '0.8',
            'stroke-dasharray': '3 4',
            'stroke-opacity': '0.4',
            class: 'spotter-crosshair-line',
        }),
    );

    // Anchor dot at the event's waveform position
    crosshair.appendChild(
        svgEl('circle', {
            cx: String(apparentX),
            cy: String(apparentY),
            r: '3.5',
            fill: color,
            'fill-opacity': '0.7',
            stroke: color,
            'stroke-width': '1',
            'stroke-opacity': '0.3',
            class: 'spotter-crosshair-dot',
        }),
    );

    // Glow ring
    crosshair.appendChild(
        svgEl('circle', {
            cx: String(apparentX),
            cy: String(apparentY),
            r: '7',
            fill: color,
            'fill-opacity': '0.08',
            class: 'spotter-crosshair-glow',
        }),
    );
}

/** Populate Y-axis value labels at the left edge during full-zone zoom. */
function _populateYLabels(labelsG: SVGGElement, channel: any, zoneTop: number, zoneH: number, plotLeft: number) {
    labelsG.innerHTML = '';

    const [rMin, rMax] = channel.range || [0, 100];
    const unit = channel.unit || '';
    const color = channel.color || '#ff4444';
    const axisTextColor = isLightMode() ? 'rgba(40, 55, 80, 0.65)' : 'rgba(174, 201, 237, 0.65)';

    // Show 3 labels: bottom (min), middle, top (max)
    for (let i = 0; i <= 2; i++) {
        const frac = i / 2;
        const val = rMin + (rMax - rMin) * frac;
        const yPos = zoneTop + zoneH - frac * zoneH;

        // Tick mark
        labelsG.appendChild(
            svgEl('line', {
                x1: String(plotLeft - 3),
                y1: String(yPos),
                x2: String(plotLeft),
                y2: String(yPos),
                stroke: color,
                'stroke-width': '0.6',
                'stroke-opacity': '0.5',
            }),
        );

        // Value label
        const labelEl = svgEl('text', {
            x: String(plotLeft - 4),
            y: String(yPos + 1),
            fill: axisTextColor,
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '6.5',
            'text-anchor': 'end',
            'dominant-baseline': 'central',
            'pointer-events': 'none',
        });
        labelEl.textContent = `${Math.round(val)}${i === 2 ? unit : ''}`;
        labelsG.appendChild(labelEl);
    }
}

/** Compute the full biometric zone extent from channel layout. */
function _getBiometricZone(channels: any[]): { top: number; height: number } {
    if (!channels || channels.length === 0) return { top: 500, height: 100 };

    let top = Infinity,
        bottom = 0;
    const compositeSeen = new Set<string>();

    for (let ci = 0; ci < channels.length; ci++) {
        const ch = channels[ci];
        if (ch._compositeGroup && compositeSeen.has(ch._compositeGroup)) continue;
        if (ch._compositeGroup) compositeSeen.add(ch._compositeGroup);

        const y = getBiometricStripY(ci, channels);
        const h = ch.stripHeight || BIOMETRIC_ZONE.laneH;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + h);
    }

    return { top, height: bottom - top };
}

/**
 * Render spotter event markers on biometric strips.
 * Each marker: vertical hairline + anchor dot on waveform + flag label at strip top.
 * Hover takes over the full biometric zone — other strips fade out, target strip
 * expands with CSS transform to fill the zone, zoomed around the event.
 */
export function renderSpotterHighlights(highlights: any[], channels: any[]) {
    const group = document.getElementById('phase-spotter-highlights');
    if (!group) return;
    group.innerHTML = '';

    // Clean up any previous zoom infrastructure on strip groups
    _spotterCleanupZoom();

    if (!highlights || highlights.length === 0 || !channels || channels.length === 0) return;

    const SM = SPOTTER_MARKER;
    const plotLeft = PHASE_CHART.padL;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const plotW = PHASE_CHART.plotW;
    const theme = chartTheme();

    // Compute full biometric zone extent (for full-zone zoom)
    const zone = _getBiometricZone(channels);
    const zoneTop = zone.top;
    const zoneH = zone.height;

    // Group highlights by channel
    const byChannel = new Map<string, any[]>();
    for (const h of highlights) {
        const list = byChannel.get(h.channel) || [];
        list.push(h);
        byChannel.set(h.channel, list);
    }

    // --- Find strip groups for channels that have markers + add clip containment ---
    const svg = document.getElementById('phase-chart-svg');
    const defs = svg?.querySelector('defs');
    const stripsGroup = document.getElementById('phase-biometric-strips');
    const zoomMap = new Map<string, SVGGElement>();

    // Create a clip path constraining zoomed strips to the biometric zone.
    // Width includes legend margin so the clip can stay permanently active
    // on wrappers (no class toggle → no transition overflow glitches).
    if (defs) {
        const clipId = 'spotter-zone-clip';
        const old = defs.querySelector(`#${clipId}`);
        if (old) old.remove();
        const clipPath = svgEl('clipPath', { id: clipId });
        const legendMargin = 80; // room for composite mini-legend dots + labels
        clipPath.appendChild(
            svgEl('rect', {
                x: String(plotLeft),
                y: String(zoneTop),
                width: String(plotW + legendMargin),
                height: String(zoneH),
            }),
        );
        defs.appendChild(clipPath);
    }

    for (const [signal] of byChannel) {
        const chIdx = channels.findIndex((ch: any) => ch.signal === signal);
        if (chIdx < 0) continue;

        // Find the strip group by data-channel attribute
        const allStripGs = stripsGroup?.querySelectorAll('.bio-strip-group');
        let targetStripG: SVGGElement | null = null;
        if (allStripGs) {
            for (const sg of Array.from(allStripGs)) {
                const attr = sg.getAttribute('data-channel') || '';
                if (attr.split(',').includes(signal)) {
                    targetStripG = sg as SVGGElement;
                    break;
                }
            }
        }

        if (!targetStripG) continue;

        // Add zoomable class for CSS transition + non-scaling-stroke
        targetStripG.classList.add('spotter-zoomable');

        // Pre-wrap in permanent clipped container so DOM reparenting
        // doesn't kill CSS transitions during hover.
        // Clip is always active (extended to include legend area) so curves
        // never overflow the strip boundary during zoom transitions.
        if (!targetStripG.parentElement?.classList.contains('spotter-clip-wrapper')) {
            const wrapper = svgEl('g', {
                class: 'spotter-clip-wrapper',
                'clip-path': 'url(#spotter-zone-clip)',
            });
            targetStripG.parentElement?.insertBefore(wrapper, targetStripG);
            wrapper.appendChild(targetStripG);
        }

        zoomMap.set(signal, targetStripG);
    }

    // Shared overlays: info bar (top) + crosshair (appended last for Z-order)
    const infoPill = svgEl('g', { class: 'spotter-info-pill', opacity: '0' }) as SVGGElement;
    const crosshairG = svgEl('g', { class: 'spotter-crosshair', opacity: '0' }) as SVGGElement;

    // --- Build markers per channel ---
    for (const [signal, channelHighlights] of byChannel) {
        const chIdx = channels.findIndex((ch: any) => ch.signal === signal);
        if (chIdx < 0) continue;
        const ch = channels[chIdx];
        const color = ch.color || '#ff4444';
        const stripY = getBiometricStripY(chIdx, channels);
        const stripH = ch.stripHeight || BIOMETRIC_ZONE.laneH;

        const sorted = [...channelHighlights].sort((a: any, b: any) => a.hour - b.hour);
        const trueXs = sorted.map((h: any) => phaseChartX(h.hour * 60));

        // Compute flag label widths and run relaxation layout
        const flagWidths = sorted.map((h: any) => _estimateFlagWidth(h.icon || '\u2022', h.label || ''));
        const flagXs = _spotterRelaxLayout(trueXs, flagWidths, plotLeft, plotRight, SM.flagGap);

        for (let i = 0; i < sorted.length; i++) {
            const h = sorted[i];
            const trueX = trueXs[i];
            const flagX = flagXs[i];
            const flagW = flagWidths[i];
            const label = (h.label || '').trim();
            const truncated =
                label.length > SM.flagLabelMaxChars ? label.slice(0, SM.flagLabelMaxChars - 1) + '\u2026' : label;
            const icon = h.icon || '\u2022';

            // Anchor Y on waveform
            const value = interpolateChannelValue(ch.data || [], h.hour);
            const rangeMin = ch.range?.[0] ?? 0;
            const rangeMax = ch.range?.[1] ?? 100;
            const normalized = (value - rangeMin) / (rangeMax - rangeMin || 1);
            const anchorY = stripY + stripH - normalized * stripH;

            const g = svgEl('g', { class: 'spotter-marker', opacity: '0' });

            // Hit area (invisible, captures mouse)
            const hitRect = svgEl('rect', {
                x: String(trueX - SM.hitAreaW / 2),
                y: String(stripY - 2),
                width: String(SM.hitAreaW),
                height: String(stripH + 4),
                fill: 'transparent',
                'pointer-events': 'all',
                class: 'spotter-hit',
            });
            g.appendChild(hitRect);

            // Vertical hairline spanning strip height
            g.appendChild(
                svgEl('line', {
                    x1: String(trueX),
                    y1: String(stripY),
                    x2: String(trueX),
                    y2: String(stripY + stripH),
                    stroke: color,
                    'stroke-width': '0.8',
                    'stroke-opacity': String(SM.hairlineOpacity),
                    'stroke-dasharray': SM.hairlineDash,
                    class: 'spotter-hairline',
                    'pointer-events': 'none',
                }),
            );

            // Anchor glow ring
            g.appendChild(
                svgEl('circle', {
                    cx: String(trueX),
                    cy: String(anchorY),
                    r: String(SM.anchorGlowR),
                    fill: color,
                    'fill-opacity': '0.10',
                    class: 'spotter-anchor-glow',
                    'pointer-events': 'none',
                }),
            );

            // Anchor dot on waveform
            g.appendChild(
                svgEl('circle', {
                    cx: String(trueX),
                    cy: String(anchorY),
                    r: String(SM.anchorR),
                    fill: color,
                    'fill-opacity': '0.7',
                    class: 'spotter-anchor',
                    'pointer-events': 'none',
                }),
            );

            // Flag label at strip top
            const flagGroup = svgEl('g', { class: 'spotter-flag', 'pointer-events': 'none' });

            // Displacement connector if flag was pushed away from true X
            const flagCenter = flagX + flagW / 2;
            if (Math.abs(flagCenter - trueX) > 3) {
                flagGroup.appendChild(
                    svgEl('line', {
                        x1: String(trueX),
                        y1: String(stripY + 2),
                        x2: String(flagCenter),
                        y2: String(stripY + 2),
                        stroke: color,
                        'stroke-width': '0.4',
                        'stroke-opacity': '0.2',
                    }),
                );
            }

            // Flag pill background
            flagGroup.appendChild(
                svgEl('rect', {
                    x: String(flagX),
                    y: String(stripY),
                    width: String(flagW),
                    height: String(SM.flagH),
                    rx: String(SM.flagRx),
                    ry: String(SM.flagRx),
                    fill: theme.tooltipBg,
                    stroke: color,
                    'stroke-width': '0.5',
                    'stroke-opacity': '0.25',
                    class: 'spotter-flag-bg',
                }),
            );

            // Flag icon
            const flagIconEl = svgEl('text', {
                x: String(flagX + SM.flagPadX),
                y: String(stripY + SM.flagH / 2 + 1),
                'font-size': String(SM.flagIconSize),
                'dominant-baseline': 'central',
                class: 'spotter-flag-icon',
            });
            flagIconEl.textContent = icon;
            flagGroup.appendChild(flagIconEl);

            // Flag label text
            const flagLabelEl = svgEl('text', {
                x: String(flagX + SM.flagPadX + SM.flagIconSize + 2),
                y: String(stripY + SM.flagH / 2 + 1),
                fill: color,
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': String(SM.flagLabelSize),
                'dominant-baseline': 'central',
                'fill-opacity': '0.85',
                class: 'spotter-flag-label',
            });
            flagLabelEl.textContent = truncated;
            flagGroup.appendChild(flagLabelEl);

            g.appendChild(flagGroup);

            // ── Hover events: Full-Zone Strip Takeover ────────
            hitRect.addEventListener('mouseenter', () => {
                clearTimeout(_spotterLeaveTimer);

                // Hide all marker visuals (hairlines, flags, dots) via CSS class
                group.classList.add('spotter-zoomed-active');

                // Dim ALL biometric strip siblings except the target strip
                // (strip may be nested inside a .spotter-clip-wrapper, so check contains)
                const targetStripG = zoomMap.get(signal);
                if (stripsGroup) {
                    Array.from(stripsGroup.children).forEach(child => {
                        const isTarget = child === targetStripG || (targetStripG && child.contains(targetStripG));
                        if (isTarget) {
                            (child as HTMLElement).classList.remove('spotter-focus-dimmed');
                        } else {
                            (child as HTMLElement).classList.add('spotter-focus-dimmed');
                        }
                    });
                }

                // Un-zoom previously zoomed strip if different
                if (_spotterZoomedGroup && _spotterZoomedGroup !== targetStripG) {
                    _spotterZoomedGroup.style.transform = '';
                    _spotterZoomedGroup.classList.remove('spotter-zoom-active');
                }

                // Zoom target strip to fill the full biometric zone
                if (targetStripG) {
                    const sx = SM.zoomFactor;
                    const sy = zoneH / stripH;

                    // Horizontal: center on event, clamped to bounds
                    const halfWindow = plotW / (2 * sx);
                    const center = Math.max(plotLeft + halfWindow, Math.min(plotRight - halfWindow, trueX));
                    const visibleLeft = center - halfWindow;
                    const tx = plotLeft - visibleLeft * sx;

                    // Vertical: move strip to fill zone
                    const ty = zoneTop - stripY * sy;

                    // Apply dotted stroke effect (clip is always active on wrapper)
                    targetStripG.classList.add('spotter-zoom-active');

                    targetStripG.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
                    _spotterZoomedGroup = targetStripG;

                    // Show info bar at top of zone
                    _populateInfoPill(infoPill, h, ch, trueX, zoneTop, plotLeft, plotRight);
                    infoPill.setAttribute('opacity', '1');

                    // Show crosshair at event position in zoomed space
                    _populateZoomCrosshair(crosshairG, trueX, anchorY, zoneTop, zoneH, color, sx, tx, sy, ty);
                    crosshairG.setAttribute('opacity', '1');

                    // ── POI connector integration ──
                    const poiContainer = document.getElementById('phase-poi-connectors');
                    if (poiContainer) {
                        const pois: any[] = (BiometricState as any)._pois || [];
                        const poiGroups = Array.from(poiContainer.querySelectorAll('.poi-connector-group'));

                        poiGroups.forEach((pg, idx) => {
                            const poiSignal = pg.getAttribute('data-bio-signal');
                            const poiHour = parseFloat(pg.getAttribute('data-bio-hour') || '');

                            const isMatch = poiSignal === signal && !isNaN(poiHour) && Math.abs(poiHour - h.hour) < 2;

                            if (!isMatch) {
                                pg.classList.add('poi-spotter-dimmed');
                                return;
                            }

                            pg.classList.remove('poi-spotter-dimmed');
                            pg.classList.add('poi-spotter-focused');

                            const poi = pois[idx];
                            if (!poi) return;

                            const newBioX = poi.bioSvgX * sx + tx;
                            const newBioY = poi.bioSvgY * sy + ty;
                            const cX = Math.max(plotLeft + 3, Math.min(plotRight - 3, newBioX));
                            const cY = Math.max(zoneTop + 2, Math.min(zoneTop + zoneH - 2, newBioY));

                            const path = pg.querySelector('path') as SVGPathElement;
                            const dot = pg.querySelector('.poi-dot') as SVGCircleElement;
                            const pulse = pg.querySelector('.poi-pulse-ring') as SVGCircleElement;

                            if (path && !path.hasAttribute('data-orig-d')) {
                                path.setAttribute('data-orig-d', path.getAttribute('d') || '');
                            }
                            if (dot && !dot.hasAttribute('data-orig-cx')) {
                                dot.setAttribute('data-orig-cx', dot.getAttribute('cx') || '');
                                dot.setAttribute('data-orig-cy', dot.getAttribute('cy') || '');
                            }
                            if (pulse && !pulse.hasAttribute('data-orig-cx')) {
                                pulse.setAttribute('data-orig-cx', pulse.getAttribute('cx') || '');
                                pulse.setAttribute('data-orig-cy', pulse.getAttribute('cy') || '');
                            }

                            if (dot) {
                                dot.setAttribute('cx', String(cX));
                                dot.setAttribute('cy', String(cY));
                            }
                            if (pulse) {
                                pulse.setAttribute('cx', String(cX));
                                pulse.setAttribute('cy', String(cY));
                            }

                            if (path) {
                                const pillX = poi.pillSvgX;
                                const pillY = poi.pillSvgY;
                                const midY = (cY + pillY) / 2;
                                const newD = `M${cX},${cY} L${cX},${midY} L${pillX},${midY} L${pillX},${pillY}`;
                                path.setAttribute('d', newD);
                            }
                        });
                    }
                }
            });

            hitRect.addEventListener('mouseleave', () => {
                // Debounced leave: allow quick marker-to-marker switching
                _spotterLeaveTimer = window.setTimeout(() => {
                    // Remove marker-hiding class
                    group.classList.remove('spotter-zoomed-active');

                    // Un-dim all biometric strip elements
                    if (stripsGroup) {
                        stripsGroup.querySelectorAll('.spotter-focus-dimmed').forEach(el => {
                            el.classList.remove('spotter-focus-dimmed');
                        });
                    }

                    // Un-zoom strip (clip is always active on wrapper, no toggle needed)
                    if (_spotterZoomedGroup) {
                        _spotterZoomedGroup.style.transform = '';
                        _spotterZoomedGroup.classList.remove('spotter-zoom-active');
                        _spotterZoomedGroup = null;
                    }

                    // Hide overlays
                    infoPill.setAttribute('opacity', '0');
                    crosshairG.setAttribute('opacity', '0');

                    // ── Restore POI connectors ──
                    const poiContainerLeave = document.getElementById('phase-poi-connectors');
                    if (poiContainerLeave) {
                        poiContainerLeave.querySelectorAll('.poi-connector-group').forEach(pg => {
                            pg.classList.remove('poi-spotter-dimmed');
                            pg.classList.remove('poi-spotter-focused');

                            // Restore original positions
                            const path = pg.querySelector('path') as SVGPathElement;
                            const dot = pg.querySelector('.poi-dot') as SVGCircleElement;
                            const pulse = pg.querySelector('.poi-pulse-ring') as SVGCircleElement;

                            if (path?.hasAttribute('data-orig-d')) {
                                path.setAttribute('d', path.getAttribute('data-orig-d')!);
                                path.removeAttribute('data-orig-d');
                            }
                            if (dot?.hasAttribute('data-orig-cx')) {
                                dot.setAttribute('cx', dot.getAttribute('data-orig-cx')!);
                                dot.setAttribute('cy', dot.getAttribute('data-orig-cy')!);
                                dot.removeAttribute('data-orig-cx');
                                dot.removeAttribute('data-orig-cy');
                            }
                            if (pulse?.hasAttribute('data-orig-cx')) {
                                pulse.setAttribute('cx', pulse.getAttribute('data-orig-cx')!);
                                pulse.setAttribute('cy', pulse.getAttribute('data-orig-cy')!);
                                pulse.removeAttribute('data-orig-cx');
                                pulse.removeAttribute('data-orig-cy');
                            }
                        });
                    }
                }, 100);
            });

            group.appendChild(g);
        }
    }

    // Append shared overlays last (highest Z-order)
    group.appendChild(crosshairG);
    group.appendChild(infoPill);
}

/**
 * Animate spotter markers with staggered reveal.
 */
export async function animateSpotterHighlights(duration: number = 800): Promise<void> {
    const container = document.getElementById('phase-spotter-highlights');
    if (!container) return;

    const markers = Array.from(container.querySelectorAll('.spotter-marker'));
    if (markers.length === 0) return;

    if (isTurboActive()) {
        markers.forEach((g: any) => g.setAttribute('opacity', '1'));
        return;
    }

    const stagger = Math.min(100, duration / markers.length);
    for (let i = 0; i < markers.length; i++) {
        const g = markers[i] as SVGElement;
        setTimeout(() => {
            const start = performance.now();
            const fadeIn = () => {
                const t = Math.min(1, (performance.now() - start) / 250);
                const ease = 1 - (1 - t) * (1 - t); // ease-out quadratic
                g.setAttribute('opacity', String(ease));
                if (t < 1) requestAnimationFrame(fadeIn);
            };
            requestAnimationFrame(fadeIn);
        }, i * stagger);
    }

    return new Promise(resolve => setTimeout(resolve, markers.length * stagger + 250));
}

/**
 * Re-render spotter markers after biometric strip morph (revision).
 * Markers are time-fixed; just re-render with updated waveform positions.
 */
export function updateSpotterHighlightConnectors(channels: any[]) {
    const highlights = BiometricState.spotterHighlights;
    if (!highlights || highlights.length === 0) return;
    renderSpotterHighlights(highlights, channels);
    // Make them visible immediately (no animation on revision update)
    const container = document.getElementById('phase-spotter-highlights');
    if (container) {
        container.querySelectorAll('.spotter-marker').forEach((g: any) => g.setAttribute('opacity', '1'));
    }
}
/**
 * Animate biometric strips with staggered left-to-right clip-path reveal.
 */
export async function animateBiometricReveal(duration: any) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;

    // Turbo: skip reveal animation, just remove all clips immediately
    if (isTurboActive()) {
        const svg = document.getElementById('phase-chart-svg')!;
        const defs = svg.querySelector('defs')!;
        group.querySelectorAll('g[data-clip-id]').forEach((sg: any) => {
            const clipId = sg.dataset.clipId;
            const clip = clipId ? defs.querySelector(`#${clipId}`) : null;
            if (clip) {
                sg.removeAttribute('clip-path');
                clip.remove();
            }
        });
        return;
    }

    const stripGroups = group.querySelectorAll('g[data-clip-id]');
    const svg = document.getElementById('phase-chart-svg')!;
    const defs = svg.querySelector('defs')!;
    const stagger = 80;

    const promises = Array.from(stripGroups).map((sg: any, i: number) => {
        return new Promise<void>(resolve => {
            const clipId = sg.dataset.clipId;
            const clip = defs.querySelector(`#${clipId}`);
            if (!clip) {
                resolve();
                return;
            }
            const rect = clip.querySelector('rect');
            if (!rect) {
                resolve();
                return;
            }

            const delay = i * stagger;

            setTimeout(() => {
                const startTime = performance.now();
                (function animate() {
                    const elapsed = performance.now() - startTime;
                    const t = Math.min(1, elapsed / duration);
                    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                    rect.setAttribute('width', String(PHASE_CHART.plotW * ease));
                    if (t < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        // Keep clip as permanent left-side boundary (extends to SVG edge)
                        rect.setAttribute('width', String(PHASE_CHART.viewW - PHASE_CHART.padL));
                        resolve();
                    }
                })();
            }, delay);
        });
    });

    await Promise.all(promises);
}

// ============================================
// PHASE 4 — REVISION (Biometric-Informed Re-evaluation)
// ============================================

// ---- VCR Control Panel (prev | play | next | biometric) ----

const ICON_PLAY =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
const ICON_PAUSE =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/></svg>';
const ICON_PREV =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="14,4 2,12 14,20"/><rect x="18" y="6" width="2" height="12" rx="0.5"/></svg>';
const ICON_NEXT =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="4" y="6" width="2" height="12" rx="0.5"/><polygon points="10,4 22,12 10,20"/></svg>';
const ICON_EJECT =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="4,14 12,4 20,14"/><rect x="4" y="17" width="16" height="3" rx="1"/></svg>';
const VCR_HIDDEN_CLASS = 'vcr-hidden';
const VCR_COMPACT_CLASS = 'vcr-compact';
const VCR_BIO_HIDDEN_CLASS = 'vcr-bio-hidden';
const VCR_BIO_INTRO_CLASS = 'vcr-bio-intro';
const VCR_BIO_INTRO_LEFT_RESERVE_VAR = '--vcr-bio-intro-left-reserve';
const VCR_BIO_INTRO_ANCHOR_OFFSET_VAR = '--vcr-bio-intro-anchor-offset';
const VCR_MULTI_DAY_ACTIVE_CLASS = 'vcr-multi-day-active';
const MULTI_DAY_VCR_MOUNTED_CLASS = 'vcr-mounted';
const VCR_ACTION_ACTIVE_CLASS = 'vcr-action-active';
const VCR_ACTION_TRAY_CLASS = 'vcr-action-tray';
const ICON_CHECK =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_OPTIMIZE =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
const ICON_LX =
    '<svg class="vcr-lx-mark" width="24" height="24" viewBox="0 0 24 24">' +
    '<g stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
    '<polyline points="6,4 6,18.5 13,18.5"/>' +
    '<line x1="15" y1="9.5" x2="21" y2="18.5"/>' +
    '<line x1="21" y1="9.5" x2="15" y2="18.5"/>' +
    '</g></svg>';
const VCR_PLAY_VARIANTS = [
    'vcr-play-bio',
    'vcr-play-optimize',
    'vcr-play-revise',
    'vcr-play-check',
    'vcr-play-stream',
] as const;

let _vcrPanel: HTMLElement | null = null;
let _vcrPlayBtn: HTMLButtonElement | null = null;
let _vcrPrevBtn: HTMLButtonElement | null = null;
let _vcrNextBtn: HTMLButtonElement | null = null;
let _vcrBioBtn: HTMLElement | null = null;
let _vcrLeftLabel: HTMLElement | null = null;
let _vcrRightLabel: HTMLElement | null = null;
let _vcrOnPlayClick: (() => void) | null = null;
let _bioMode = false;
let _canonActionActive = false;
let _vcrReadyAnimTimer: number | null = null;
let _labelTransitTimer: number | null = null;
let _lastLabeledStep = -1;
let _pillSyncRAF = 0;
let _vcrPillResyncTimer: number | null = null;
let _vcrFontSyncBound = false;
let _multiDayMode = false;
let _ejectActivated = false;

type VcrStepperMode = 'idle' | 'ready' | 'playing' | 'stepping' | 'complete';

export interface VcrNavStateInput {
    mode: VcrStepperMode;
    currentStep: number;
    totalSteps: number;
    bioMode: boolean;
    canonActionActive: boolean;
}

export interface VcrNavState {
    stepperActive: boolean;
    preplay: boolean;
    showPrev: boolean;
    showNext: boolean;
    prevDisabled: boolean;
    nextDisabled: boolean;
    prevFaded: boolean;
}

export function resolveVcrNavState(input: VcrNavStateInput): VcrNavState {
    const { mode, currentStep, totalSteps, bioMode, canonActionActive } = input;
    if (bioMode || canonActionActive) {
        return {
            stepperActive: false,
            preplay: false,
            showPrev: false,
            showNext: false,
            prevDisabled: true,
            nextDisabled: true,
            prevFaded: false,
        };
    }

    const hasSteps = totalSteps > 0;
    const preplay = hasSteps && mode === 'ready';
    const inPlayback = hasSteps && (mode === 'playing' || mode === 'stepping');
    const stepperActive = preplay || inPlayback;
    const showPrev = inPlayback;
    const showNext = preplay || inPlayback;
    const prevDisabled = !showPrev || currentStep <= 0;
    const nextDisabled = !showNext;
    const prevFaded = showPrev && currentStep <= 0;

    return { stepperActive, preplay, showPrev, showNext, prevDisabled, nextDisabled, prevFaded };
}

function syncLegacyLxButton(state: 'hidden' | 'loading' | 'ready'): void {
    const lxBtn = document.getElementById('phase-lx-btn') as HTMLButtonElement | null;
    if (!lxBtn) return;

    // Legacy text button intentionally disabled: VCR icon controls are the only play UI.
    lxBtn.classList.remove('visible');
    lxBtn.classList.add('hidden');
    lxBtn.textContent = 'Lx';
    lxBtn.disabled = false;
    lxBtn.onclick = null;
}

function setVcrPanelMode(mode: 'hidden' | 'compact' | 'visible'): void {
    const panel = _vcrPanel || document.querySelector('.vcr-control-panel');
    if (!panel) return;

    panel.classList.remove(VCR_COMPACT_CLASS, VCR_HIDDEN_CLASS);
    panel.classList.remove('visible');

    if (mode === 'hidden') {
        requestAnimationFrame(() => {
            panel.classList.add(VCR_HIDDEN_CLASS);
            syncBiometricUiAnchors();
        });
        return;
    }

    if (mode === 'compact') {
        panel.classList.add(VCR_COMPACT_CLASS);
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            panel.classList.add('visible');
            syncBiometricUiAnchors();
        });
    });
}

function clearBioIntroMode(panel: HTMLElement | null): void {
    if (!panel) return;
    panel.classList.remove(VCR_BIO_INTRO_CLASS);
    panel.style.removeProperty(VCR_BIO_INTRO_LEFT_RESERVE_VAR);
    panel.style.removeProperty(VCR_BIO_INTRO_ANCHOR_OFFSET_VAR);
}

function syncBioIntroEnvelope(_panel: HTMLElement | null): void {
    // No-op: full-width grid keeps the play button centered automatically.
}

function queueVcrPillResync(): void {
    syncPillWidth();
    requestAnimationFrame(() => syncPillWidth());
    if (_vcrPillResyncTimer != null) {
        window.clearTimeout(_vcrPillResyncTimer);
    }
    _vcrPillResyncTimer = window.setTimeout(() => {
        _vcrPillResyncTimer = null;
        syncPillWidth();
    }, 140);
}

function bindVcrFontResync(): void {
    if (_vcrFontSyncBound) return;
    const fontSet = (document as any).fonts as FontFaceSet | undefined;
    if (!fontSet || typeof fontSet.addEventListener !== 'function') return;
    _vcrFontSyncBound = true;

    fontSet.addEventListener('loadingdone', () => {
        if (!_vcrPanel || !_vcrPanel.classList.contains('visible')) return;
        queueVcrPillResync();
    });

    fontSet.ready
        .then(() => {
            if (_vcrPanel) queueVcrPillResync();
        })
        .catch(() => {});
}

// ============================================
// VCR Pill Background — Symmetric sizing
// ============================================

/** Measure wing width, using target label text width so envelope can pre-size before label reveal. */
function measureWingContentWidth(wing: HTMLElement): number {
    const measureLabelTargetWidth = (labelEl: HTMLElement): number => {
        const text = (labelEl.textContent || '').trim();
        if (!text) {
            labelEl.style.setProperty('--vcr-label-max', '0px');
            return 0;
        }
        if (!_vcrPanel) {
            const fallback = Math.max(0, Math.ceil(labelEl.getBoundingClientRect().width));
            labelEl.style.setProperty('--vcr-label-max', `${fallback}px`);
            return fallback;
        }

        const probe = document.createElement('span');
        probe.className = labelEl.className;
        probe.textContent = text;
        probe.style.position = 'absolute';
        probe.style.left = '-9999px';
        probe.style.top = '-9999px';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        probe.style.opacity = '0';
        probe.style.transform = 'none';
        probe.style.maxWidth = 'none';
        _vcrPanel.appendChild(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        const probeWidth = Math.max(0, Math.ceil(w));
        const renderedWidth = Math.max(0, Math.ceil(labelEl.scrollWidth || 0));
        const measured = Math.max(probeWidth, renderedWidth) + 2;
        labelEl.style.setProperty('--vcr-label-max', `${measured}px`);
        return measured;
    };

    let width = 0;
    let count = 0;
    for (let i = 0; i < wing.children.length; i++) {
        const el = wing.children[i] as HTMLElement;
        const isLabel = el.classList.contains('vcr-step-label');
        const w = isLabel ? measureLabelTargetWidth(el) : el.getBoundingClientRect().width;
        if (w < 1) continue;
        if (count > 0) width += 8; // gap between flex items
        width += w;
        count++;
    }
    return width;
}

/**
 * Set width and offset CSS variables so the envelope can resize asymmetrically
 * while the center play button remains fixed on the same horizontal anchor.
 */
function syncPillWidth(): void {
    if (!_vcrPanel) return;
    const apply = () => {
        _pillSyncRAF = 0;
        if (!_vcrPanel) return;
        const leftWing = _vcrPanel.querySelector('.vcr-wing-left') as HTMLElement | null;
        const rightWing = _vcrPanel.querySelector('.vcr-wing-right') as HTMLElement | null;
        if (!leftWing || !rightWing) return;

        const leftW = measureWingContentWidth(leftWing);
        const rightW = measureWingContentWidth(rightWing);
        const playW = _vcrPlayBtn?.getBoundingClientRect().width || 52;
        const pillW = leftW + rightW + playW + 48;
        const pillOffset = (rightW - leftW) / 2;
        const resolvedPillW = Math.max(pillW, 84);
        const panelWidth = _vcrPanel.clientWidth || _vcrPanel.getBoundingClientRect().width || 0;
        const pillRight = panelWidth / 2 + pillOffset + resolvedPillW / 2;
        _vcrPanel.style.setProperty('--pill-w', resolvedPillW + 'px');
        _vcrPanel.style.setProperty('--pill-offset', `${pillOffset.toFixed(1)}px`);
        _vcrPanel.style.setProperty('--vcr-pill-right', `${pillRight.toFixed(1)}px`);
        _vcrPanel.style.setProperty('--vcr-left-wing-w', `${Math.max(0, leftW + 2)}px`);
        _vcrPanel.style.setProperty('--vcr-right-wing-w', `${Math.max(0, rightW + 2)}px`);

        // Reposition docked bio devices now that pill geometry is committed
        resyncDockedDevices();
    };

    if (_pillSyncRAF) {
        cancelAnimationFrame(_pillSyncRAF);
        _pillSyncRAF = 0;
    }
    _pillSyncRAF = requestAnimationFrame(apply);
}

// ============================================
// VCR Canon Action — Reuse play button as action trigger
// ============================================

interface VcrCanonConfig {
    label: string;
    icon: string;
    playClass?: (typeof VCR_PLAY_VARIANTS)[number];
    loading?: boolean;
    onClick?: () => void | Promise<void>;
    /** Which phase this action completes (turbo won't auto-fire if this equals the target phase) */
    completesPhase?: number;
}

/**
 * Configure the VCR panel in canon layout for an action state:
 * play button circle (with icon/color variant) + right-wing label.
 * This replaces the old action-tray pattern while keeping the play button
 * as the immovable center anchor.
 */
function configureVcrCanonAction(config: VcrCanonConfig): void {
    // Block LX stepper updates immediately — before ensureVcrPanel triggers callbacks
    _canonActionActive = true;
    const panel = ensureVcrPanel();
    clearVcrActionModule();
    deactivateMultiDayRibbonModule();
    clearBioIntroMode(panel);
    panel.classList.remove('vcr-loading');

    // Hide prev/next and biometric wrap
    _vcrPrevBtn?.classList.add('vcr-btn-hidden');
    _vcrNextBtn?.classList.add('vcr-btn-hidden');
    _vcrBioBtn?.classList.add(VCR_BIO_HIDDEN_CLASS);

    // Configure play button icon and color
    if (_vcrPlayBtn) {
        _vcrPlayBtn.classList.remove('loading', ...VCR_PLAY_VARIANTS);
        if (config.loading) {
            _vcrPlayBtn.classList.add('loading');
            _vcrPlayBtn.disabled = true;
        } else {
            _vcrPlayBtn.innerHTML = config.icon;
            _vcrPlayBtn.disabled = false;
        }
        if (config.playClass) {
            _vcrPlayBtn.classList.add(config.playClass);
        }
    }

    // Right label shows the action name
    if (_vcrRightLabel) {
        _vcrRightLabel.textContent = config.label;
        _vcrRightLabel.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in', 'vcr-label-bio');
        _vcrRightLabel.classList.add('vcr-label-visible');
    }
    // Clear left label
    if (_vcrLeftLabel) {
        _vcrLeftLabel.textContent = '';
        _vcrLeftLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-out', 'vcr-label-transit-in');
    }

    // Set click handler
    _vcrOnPlayClick = config.onClick || null;
    _bioMode = false;

    setVcrPanelMode('visible');
    queueVcrPillResync();

    // Turbo: auto-fire onClick to advance through biometric/revision gates
    // But don't auto-fire the button that completes the target phase — that's where the user wants to land
    if (isTurboActive() && config.onClick && !config.loading) {
        const wouldCompleteTarget = config.completesPhase != null && config.completesPhase >= AppState.turboTargetPhase;
        if (!wouldCompleteTarget) {
            queueMicrotask(() => config.onClick!());
        } else {
            // Turbo reached its target — deactivate so animations play normally when user clicks
            AppState.turboTargetPhase = 0;
        }
    }
}

// ============================================
// VCR Step Labels — Right-to-Left Command Flow
// ============================================

const VCR_LABEL_TRANSIT_DELAY = 280;
const VCR_LABEL_SETTLE_DELAY = 380;

/**
 * Resolve what the left (active) and right (next) labels should show.
 */
function resolveVcrLabels(): { left: string; right: string } {
    if (_multiDayMode) return resolveMultiDayLabels();
    const { currentStep, totalSteps, mode } = getLxStepperState();
    const snapshots = PhaseState.incrementalSnapshots;

    // Loading state (intervention model running)
    if (mode === 'idle' && _vcrPanel?.classList.contains('vcr-loading')) {
        return { left: '', right: 'Preparing Substances' };
    }

    // Lx stepping: use substance names from snapshots
    if (snapshots && totalSteps > 0) {
        const getSubstanceName = (idx: number): string => {
            if (!snapshots[idx]) return '';
            const step = (snapshots[idx] as any).step;
            if (!step || step.length === 0) return '';
            return step.map((iv: any) => iv.substance?.name || iv.key).join(' + ');
        };

        if (mode === 'complete') {
            return { left: '', right: 'Biometric Loop' };
        }

        const leftName = currentStep > 0 ? getSubstanceName(currentStep - 1) : '';
        const rightName = currentStep < totalSteps ? getSubstanceName(currentStep) : 'Biometric Loop';
        return { left: leftName, right: rightName };
    }

    return { left: '', right: '' };
}

/**
 * Update VCR labels without animation (for initial state, mode switches).
 */
function updateVcrLabelsStatic(): void {
    const left = _vcrLeftLabel;
    const right = _vcrRightLabel;
    if (!left || !right) return;

    // Clear all transit classes
    left.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in');
    right.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in', 'vcr-label-bio');

    const labels = resolveVcrLabels();

    left.classList.remove('vcr-label-visible');
    right.classList.remove('vcr-label-visible');
    left.textContent = labels.left;
    right.textContent = labels.right;
    syncPillWidth();
    requestAnimationFrame(() => {
        left.classList.toggle('vcr-label-visible', !!labels.left);
        right.classList.toggle('vcr-label-visible', !!labels.right);
        _lastLabeledStep = getLxStepperState().currentStep;
        syncPillWidth();
    });
}

/**
 * Animate the right label flowing through the play button to the left.
 * Used when play / next is pressed (forward transit).
 */
function animateVcrLabelTransit(): void {
    const left = _vcrLeftLabel;
    const right = _vcrRightLabel;
    if (!left || !right) return;

    // Cancel any pending transit
    if (_labelTransitTimer != null) {
        window.clearTimeout(_labelTransitTimer);
        _labelTransitTimer = null;
    }

    // Phase 1: both labels exit leftward
    right.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    right.classList.add('vcr-label-transit-out');

    left.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    left.classList.add('vcr-label-transit-out');
    syncPillWidth();

    // Phase 2: swap text and enter new positions
    _labelTransitTimer = window.setTimeout(() => {
        const labels = resolveVcrLabels();

        // Clear exit classes
        left.classList.remove('vcr-label-transit-out');
        right.classList.remove('vcr-label-transit-out', 'vcr-label-bio');

        // Left label enters from center outward
        left.textContent = labels.left;
        if (labels.left) {
            left.classList.add('vcr-label-transit-in');
        }

        // Right label appears with new next-step text
        right.textContent = labels.right;
        right.classList.remove('vcr-label-visible');
        syncPillWidth();
        if (labels.right) {
            // Small delay so right appears slightly after left starts entering
            requestAnimationFrame(() => right.classList.add('vcr-label-visible'));
        }

        // Phase 3: settle to static visible
        _labelTransitTimer = window.setTimeout(() => {
            left.classList.remove('vcr-label-transit-in');
            if (labels.left) left.classList.add('vcr-label-visible');
            _labelTransitTimer = null;
            _lastLabeledStep = getLxStepperState().currentStep;
            syncPillWidth();
        }, VCR_LABEL_SETTLE_DELAY);
    }, VCR_LABEL_TRANSIT_DELAY);
}

// ============================================
// Multi-Day VCR — Day stepper using label transit
// ============================================

const MD_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getMdDayName(dayNum: number): string {
    const startWeekday = MultiDayState.startWeekday || 'Monday';
    const startIdx = MD_WEEKDAYS.findIndex(d => d.toLowerCase() === startWeekday.toLowerCase());
    if (startIdx === -1) return `Day ${dayNum}`;
    return MD_WEEKDAYS[(startIdx + dayNum - 1) % 7];
}

function resolveMultiDayLabels(): { left: string; right: string } {
    const { days, currentDay } = MultiDayState;
    if (days.length === 0) return { left: '', right: '' };

    const phase = MultiDayState.phase;
    const visibleStartIdx = getVisibleWeekStartIndex(days);
    const leftName = currentDay > visibleStartIdx ? getMdDayName(currentDay - 1) : '';
    const rightName = currentDay < days.length ? getMdDayName(currentDay) : '';

    if (phase === 'complete') {
        return { left: getMdDayName(currentDay), right: '' };
    }
    return { left: leftName, right: rightName };
}

function updateMultiDayVcrNav(): void {
    if (!_vcrPanel) return;
    const { days, currentDay } = MultiDayState;
    const totalDays = days.length;
    const phase = MultiDayState.phase;
    const isPlaying = phase === 'playing';
    const isComplete = phase === 'complete';

    _vcrPanel.classList.add('vcr-stepper-active');
    _vcrPanel.classList.remove('vcr-preplay');

    if (_vcrPrevBtn) {
        _vcrPrevBtn.classList.remove('vcr-btn-hidden', 'vcr-btn-faded');
        // Left button = pause/resume during multi-day
        _vcrPrevBtn.disabled = false;
        _vcrPrevBtn.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
        _vcrPrevBtn.title = isPlaying ? 'Pause' : 'Play';
        _vcrPrevBtn.classList.add('vcr-nav-active');
    }
    if (_vcrPlayBtn) {
        _vcrPlayBtn.classList.remove('loading', ...VCR_PLAY_VARIANTS);
        // Center button = eject during multi-day (unless eject was already activated → stays as play)
        if (!_ejectActivated) {
            _vcrPlayBtn.innerHTML = ICON_EJECT;
            _vcrPlayBtn.title = 'Eject';
        }
        _vcrPlayBtn.disabled = false;
    }
    if (_vcrNextBtn) {
        _vcrNextBtn.classList.remove('vcr-btn-hidden', 'vcr-btn-faded');
        // Right button = speed cycle during multi-day
        _vcrNextBtn.disabled = false;
        const spd = MultiDayState.speed;
        const spdLabel = `${spd}x`;
        _vcrNextBtn.innerHTML = `<span class="vcr-speed-label">${spdLabel}</span>`;
        _vcrNextBtn.title = `Speed: ${spdLabel}`;
        _vcrNextBtn.classList.add('vcr-nav-active');
    }

    queueVcrPillResync();
}

function updateMultiDayLabelsStatic(): void {
    const left = _vcrLeftLabel;
    const right = _vcrRightLabel;
    if (!left || !right) return;

    left.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in', 'vcr-label-bio');
    right.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in', 'vcr-label-bio');

    const labels = resolveMultiDayLabels();
    left.classList.remove('vcr-label-visible');
    right.classList.remove('vcr-label-visible');
    left.textContent = labels.left;
    right.textContent = labels.right;
    syncPillWidth();
    requestAnimationFrame(() => {
        left.classList.toggle('vcr-label-visible', !!labels.left);
        right.classList.toggle('vcr-label-visible', !!labels.right);
        syncPillWidth();
    });
}

function animateMultiDayLabelTransit(): void {
    const left = _vcrLeftLabel;
    const right = _vcrRightLabel;
    if (!left || !right) return;

    if (_labelTransitTimer != null) {
        window.clearTimeout(_labelTransitTimer);
        _labelTransitTimer = null;
    }

    // Phase 1: both labels exit leftward
    right.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    right.classList.add('vcr-label-transit-out');
    left.classList.remove('vcr-label-visible', 'vcr-label-transit-in');
    left.classList.add('vcr-label-transit-out');
    syncPillWidth();

    // Phase 2: swap text and enter new positions
    _labelTransitTimer = window.setTimeout(() => {
        const labels = resolveMultiDayLabels();

        left.classList.remove('vcr-label-transit-out');
        right.classList.remove('vcr-label-transit-out', 'vcr-label-bio');

        left.textContent = labels.left;
        if (labels.left) left.classList.add('vcr-label-transit-in');

        right.textContent = labels.right;
        right.classList.remove('vcr-label-visible');
        syncPillWidth();
        if (labels.right) {
            requestAnimationFrame(() => right.classList.add('vcr-label-visible'));
        }

        // Phase 3: settle
        _labelTransitTimer = window.setTimeout(() => {
            left.classList.remove('vcr-label-transit-in');
            if (labels.left) left.classList.add('vcr-label-visible');
            _labelTransitTimer = null;
            syncPillWidth();
        }, VCR_LABEL_SETTLE_DELAY);
    }, VCR_LABEL_TRANSIT_DELAY);
}

function multiDayNext(): void {
    const { days, currentDay } = MultiDayState;
    if (currentDay >= days.length - 1) return;
    if (MultiDayState.phase === 'playing') pauseMultiDay();

    seekToDay(currentDay + 1);
    animateMultiDayLabelTransit();
    updateMultiDayVcrNav();
}

function multiDayPrev(): void {
    const { currentDay } = MultiDayState;
    if (currentDay <= 0) return;
    if (MultiDayState.phase === 'playing') pauseMultiDay();

    seekToDay(currentDay - 1);
    updateMultiDayLabelsStatic();
    updateMultiDayVcrNav();
}

function multiDayPlayPause(): void {
    const phase = MultiDayState.phase;
    if (phase === 'playing') {
        pauseMultiDay();
        updateMultiDayVcrNav();
    } else if (phase === 'paused') {
        resumeMultiDay();
        updateMultiDayVcrNav();
    } else if (phase === 'complete') {
        seekToDay(getVisibleWeekStartIndex(MultiDayState.days));
        updateMultiDayLabelsStatic();
        const curvesData = PhaseState.curvesData;
        if (curvesData && MultiDayState.days.length > 0) {
            playMultiDaySequence(MultiDayState.days, curvesData).then(() => {
                updateMultiDayVcrNav();
                updateMultiDayLabelsStatic();
            });
            updateMultiDayVcrNav();
        }
    }
}

/**
 * Called by playMultiDaySequence via onDayAdvance callback
 * whenever the current day changes during auto-play.
 */
function onMultiDayAdvance(): void {
    animateMultiDayLabelTransit();
    updateMultiDayVcrNav();

    // Advance Sherlock 7D card to current day
    if (MultiDayState.sherlock7dReady && SherlockState.sherlock7dNarration) {
        const dayIdx = Math.max(0, MultiDayState.currentDay - 1);
        showSherlock7DStack(SherlockState.sherlock7dNarration.beats, dayIdx);
    }
}

function teardownVcrPanel(): void {
    if (_vcrReadyAnimTimer != null) {
        window.clearTimeout(_vcrReadyAnimTimer);
        _vcrReadyAnimTimer = null;
    }
    if (_vcrPillResyncTimer != null) {
        window.clearTimeout(_vcrPillResyncTimer);
        _vcrPillResyncTimer = null;
    }
    if (_labelTransitTimer != null) {
        window.clearTimeout(_labelTransitTimer);
        _labelTransitTimer = null;
    }
    setVcrUpdateCallback(null);
    _vcrOnPlayClick = null;
    clearVcrActionModule();
    deactivateMultiDayRibbonModule();
    setVcrPanelMode('hidden');
    clearBioIntroMode(_vcrPanel);
    _vcrPanel?.classList.remove('vcr-preplay');
    _vcrPanel?.style.removeProperty('--pill-offset');
    _vcrPanel?.style.removeProperty('--vcr-left-wing-w');
    _vcrPanel?.style.removeProperty('--vcr-right-wing-w');
    _vcrBioBtn?.classList.add(VCR_BIO_HIDDEN_CLASS);
    _bioMode = false;
    _canonActionActive = false;
    _vcrLeftLabel = null;
    _vcrRightLabel = null;
    _lastLabeledStep = -1;
}

function mountMultiDayRibbonModule(): void {
    _multiDayMode = true;
    _canonActionActive = false;
    _bioMode = false;
    const panel = ensureVcrPanel();
    clearVcrActionModule();
    clearBioIntroMode(panel);
    panel.classList.remove('vcr-loading', VCR_MULTI_DAY_ACTIVE_CLASS);

    // Hide biometric wrap
    _vcrBioBtn?.classList.add(VCR_BIO_HIDDEN_CLASS);

    // Configure play button as loading spinner initially
    if (_vcrPlayBtn) {
        _vcrPlayBtn.classList.remove(...VCR_PLAY_VARIANTS);
        _vcrPlayBtn.classList.add('loading');
        _vcrPlayBtn.disabled = true;
    }

    // Show "preparing" label on right
    if (_vcrRightLabel) {
        _vcrRightLabel.textContent = 'Preparing Days';
        _vcrRightLabel.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in', 'vcr-label-bio');
        _vcrRightLabel.classList.add('vcr-label-visible');
    }
    if (_vcrLeftLabel) {
        _vcrLeftLabel.textContent = '';
        _vcrLeftLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-out', 'vcr-label-transit-in');
    }

    // Hide prev/next during loading
    _vcrPrevBtn?.classList.add('vcr-btn-hidden');
    _vcrNextBtn?.classList.add('vcr-btn-hidden');

    setVcrPanelMode('visible');
    queueVcrPillResync();
}

function activateMultiDayVcrStepper(): void {
    if (!_vcrPanel) return;

    // Remove loading, show stepper controls
    if (_vcrPlayBtn) {
        _vcrPlayBtn.classList.remove('loading');
        _vcrPlayBtn.disabled = false;
    }

    updateMultiDayLabelsStatic();
    updateMultiDayVcrNav();
    queueVcrPillResync();
}

function deactivateMultiDayRibbonModule(): void {
    _multiDayMode = false;
    MultiDayState.onDayAdvance = null;
    MultiDayState.onSherlock7DSync = null;
    MultiDayState.sherlock7dReady = false;
    SherlockState.sherlock7dNarration = null;
    hideSherlock7D();
    const panel = _vcrPanel || document.querySelector('.vcr-control-panel');
    if (panel) panel.classList.remove(VCR_MULTI_DAY_ACTIVE_CLASS);
}

function clearLegacyActionWraps(): void {
    document.querySelectorAll('.sim-play-wrap, .multi-day-wrap').forEach(node => node.remove());
}

function clearVcrActionModule(): void {
    const panel = _vcrPanel || document.querySelector('.vcr-control-panel');
    if (!panel) {
        clearLegacyActionWraps();
        return;
    }
    panel.classList.remove(VCR_ACTION_ACTIVE_CLASS);
    const tray = panel.querySelector(`.${VCR_ACTION_TRAY_CLASS}`);
    tray?.remove();
    clearLegacyActionWraps();
    clearVcrDeviceSelectMode();
}

/** Remove all VCR-inline device chips, separators, and bio-context editor from the wings.
 *  Does NOT clear docked device capsules — those persist across phases. */
function clearVcrDeviceSelectMode(): void {
    const panel = _vcrPanel;
    if (!panel) return;
    panel.classList.remove('vcr-device-select', 'vcr-bio-context-ready', 'vcr-bio-context-open');
    panel
        .querySelectorAll('.vcr-device-chip-inline, .vcr-device-sep, .vcr-device-select-loader, .vcr-bio-context-input')
        .forEach(el => el.remove());
    // Remove click handler and inline styles from right label
    if (_vcrRightLabel) {
        _vcrRightLabel.removeEventListener('click', _bioContextLabelClick);
        _vcrRightLabel.style.pointerEvents = '';
        _vcrRightLabel.style.cursor = '';
    }
    // Hide the left-side device panel if open
    hideBioDevicePanel();
    setDockChangeCallback(null);
}

/** Full reset: clear docked devices + device select mode. Call only on explicit pipeline restart. */
export function resetBioDeviceDock(): void {
    undockAllBioDevices();
    clearVcrDeviceSelectMode();
}

/** Stored reference for removable event listener */
let _bioContextLabelClick: () => void = () => {};

// ============================================
// Bio Device Panel — Left-side vertical panel (where Sherlock was)
// ============================================

let _bioDevicePanel: HTMLElement | null = null;
let _bioDevicePanelRAF: number | null = null;

function ensureBioDevicePanel(): HTMLElement {
    if (_bioDevicePanel) return _bioDevicePanel;

    const panel = document.createElement('div');
    panel.id = 'bio-device-panel';
    panel.className = 'bio-device-panel';
    document.body.appendChild(panel);
    _bioDevicePanel = panel;
    repositionBioDevicePanel();
    return panel;
}

function repositionBioDevicePanel(): void {
    if (!_bioDevicePanel) return;
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    const panelWidth = 110;
    const gap = 16;
    let leftPos = rect.left - panelWidth - gap;
    // Clamp so panel doesn't go off left edge of viewport
    if (leftPos < 4) {
        leftPos = 4;
    }

    _bioDevicePanel.style.left = `${leftPos}px`;

    // Use the full SVG bounding box height
    const svgTop = rect.top + window.scrollY;
    const svgHeight = rect.height;

    _bioDevicePanel.style.top = `${svgTop}px`;
    _bioDevicePanel.style.height = `${svgHeight}px`;
}

function startBioDevicePanelLoop(): void {
    if (_bioDevicePanelRAF !== null) return;
    const tick = () => {
        repositionBioDevicePanel();
        _bioDevicePanelRAF = requestAnimationFrame(tick);
    };
    _bioDevicePanelRAF = requestAnimationFrame(tick);
}

function stopBioDevicePanelLoop(): void {
    if (_bioDevicePanelRAF !== null) {
        cancelAnimationFrame(_bioDevicePanelRAF);
        _bioDevicePanelRAF = null;
    }
}

function showBioDevicePanel(): void {
    const panel = ensureBioDevicePanel();
    void panel.offsetWidth;
    panel.classList.add('visible');
    startBioDevicePanelLoop();
    repositionBioDevicePanel();
}

export function hideBioDevicePanel(): void {
    if (!_bioDevicePanel) return;
    _bioDevicePanel.classList.remove('visible');
    stopBioDevicePanelLoop();
}

/**
 * Expand the inline bio-context editor inside the VCR right wing.
 * The right label "Run Biometric Loop" animates to the left side,
 * and a textarea appears in the right wing for editing context.
 */
function expandBioContextEditor(panel: HTMLElement, contextText: string, onSubmit: () => void): void {
    panel.classList.remove('vcr-bio-context-ready');
    panel.classList.add('vcr-bio-context-open');

    // Animate label: right → left
    if (_vcrRightLabel) {
        _vcrRightLabel.style.pointerEvents = '';
        _vcrRightLabel.style.cursor = '';
        _vcrRightLabel.removeEventListener('click', _bioContextLabelClick);
        _vcrRightLabel.classList.add('vcr-label-transit-out');
    }

    // After the right label fades out, move text to left label and reveal it
    setTimeout(() => {
        if (_vcrLeftLabel) {
            _vcrLeftLabel.textContent = 'Run Biometric Loop';
            _vcrLeftLabel.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in');
            _vcrLeftLabel.classList.add('vcr-label-visible');
        }
        if (_vcrRightLabel) {
            _vcrRightLabel.textContent = '';
            _vcrRightLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-out');
        }
        syncPillWidth();
    }, VCR_LABEL_TRANSIT_DELAY);

    // Insert the inline textarea into the right wing
    const rightWing = panel.querySelector('.vcr-wing-right') as HTMLElement;
    if (!rightWing) return;

    const textarea = document.createElement('textarea');
    textarea.className = 'vcr-bio-context-input';
    textarea.value = contextText;
    textarea.placeholder = 'Biometric context (optional)';
    textarea.rows = 2;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';

    // Insert after the label element
    rightWing.appendChild(textarea);

    // Focus after animation settles
    setTimeout(() => {
        textarea.focus();
        syncPillWidth();
    }, VCR_LABEL_SETTLE_DELAY);

    // Track edits
    textarea.addEventListener('input', () => {
        BiometricState.profileDirty = true;
        BiometricState.profileSource = 'user-edited';
    });

    // Enter submits
    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
        }
    });

    queueVcrPillResync();
}

function ensureVcrActionTray(): HTMLElement {
    const panel = ensureVcrPanel();
    deactivateMultiDayRibbonModule();
    panel.classList.remove('vcr-loading');
    panel.classList.add(VCR_ACTION_ACTIVE_CLASS);

    let tray = panel.querySelector(`.${VCR_ACTION_TRAY_CLASS}`) as HTMLElement | null;
    if (!tray) {
        tray = document.createElement('div');
        tray.className = VCR_ACTION_TRAY_CLASS;
        panel.appendChild(tray);
    }

    clearLegacyActionWraps();
    setVcrPanelMode('visible');
    return tray;
}

function upsertVcrActionButton(
    id: string,
    label: string,
    iconSvg: string,
    variantClass: string,
    onClick: () => void | Promise<void>,
): HTMLButtonElement {
    const tray = ensureVcrActionTray();
    let btn = tray.querySelector(`#${id}`) as HTMLButtonElement | null;
    if (!btn) {
        btn = document.createElement('button');
        btn.id = id;
        tray.appendChild(btn);
    }
    btn.className = `sim-play-btn vcr-action-btn ${variantClass}`;
    btn.innerHTML = `<span class="vcr-action-icon" aria-hidden="true">${iconSvg}</span><span class="vcr-action-label">${label}</span>`;
    btn.onclick = onClick;
    return btn;
}

function removeVcrActionButton(id: string): void {
    const panel = _vcrPanel || document.querySelector('.vcr-control-panel');
    if (!panel) return;
    const tray = panel.querySelector(`.${VCR_ACTION_TRAY_CLASS}`) as HTMLElement | null;
    if (!tray) return;
    const btn = tray.querySelector(`#${id}`);
    btn?.remove();
    if (tray.children.length === 0) {
        tray.remove();
        panel.classList.remove(VCR_ACTION_ACTIVE_CLASS);
    }
}

function updateVcrPanelState(): void {
    if (!_vcrPanel) return;
    // Multi-day mode: labels and nav managed by multi-day functions
    if (_multiDayMode) return;
    // Canon action mode: labels are managed by configureVcrCanonAction, skip LX updates
    if (_canonActionActive) return;
    const { currentStep, totalSteps, mode } = getLxStepperState();
    const nav = resolveVcrNavState({
        mode: mode as VcrStepperMode,
        currentStep,
        totalSteps,
        bioMode: _bioMode,
        canonActionActive: _canonActionActive,
    });
    _vcrPanel.classList.toggle('vcr-stepper-active', nav.stepperActive);
    _vcrPanel.classList.toggle('vcr-preplay', nav.preplay);

    if (_vcrPrevBtn) {
        _vcrPrevBtn.classList.toggle('vcr-btn-hidden', !nav.showPrev);
        _vcrPrevBtn.disabled = nav.prevDisabled;
        _vcrPrevBtn.classList.toggle('vcr-btn-faded', nav.prevFaded);
        _vcrPrevBtn.classList.toggle('vcr-nav-active', nav.showPrev && !nav.prevDisabled);
    }
    if (_vcrPlayBtn) {
        if (_bioMode) {
            _vcrPlayBtn.innerHTML = '∞';
            _vcrPlayBtn.classList.add('vcr-play-bio');
            _vcrPlayBtn.title = 'Start biometric loop';
        } else {
            _vcrPlayBtn.classList.remove('vcr-play-bio');
            _vcrPlayBtn.innerHTML = mode === 'playing' ? ICON_PAUSE : ICON_PLAY;
            _vcrPlayBtn.title = mode === 'playing' ? 'Pause' : 'Play';
        }
    }
    if (_vcrNextBtn) {
        _vcrNextBtn.classList.toggle('vcr-btn-hidden', !nav.showNext);
        _vcrNextBtn.disabled = nav.nextDisabled;
        _vcrNextBtn.classList.remove('vcr-btn-faded');
        _vcrNextBtn.classList.toggle('vcr-nav-active', nav.showNext && !nav.nextDisabled);
    }
    // Bio mode: labels are managed by showBiometricOnVcrPanel, skip stepper-driven updates
    if (_bioMode) return;
    // Auto-play conveyor belt: animate labels when step advances during playing mode
    if (mode === 'playing' && currentStep !== _lastLabeledStep && _lastLabeledStep >= 0) {
        animateVcrLabelTransit();
    } else if (mode !== 'playing' && _labelTransitTimer == null) {
        // Static update for non-playing modes, but only if no transit animation in progress
        updateVcrLabelsStatic();
    }
}

function ensureVcrPanel(): HTMLElement {
    if (_vcrPanel) {
        // Rebind after prior runs, since hideInterventionPlayButton() clears refs.
        setVcrUpdateCallback(updateVcrPanelState);
        bindVcrFontResync();
        if (!_vcrLeftLabel) _vcrLeftLabel = _vcrPanel.querySelector('.vcr-step-left');
        if (!_vcrRightLabel) _vcrRightLabel = _vcrPanel.querySelector('.vcr-step-right');
        if (!_vcrPlayBtn) _vcrPlayBtn = _vcrPanel.querySelector('.vcr-play') as HTMLButtonElement;
        if (!_vcrPrevBtn) _vcrPrevBtn = _vcrPanel.querySelector('.vcr-prev') as HTMLButtonElement;
        if (!_vcrNextBtn) _vcrNextBtn = _vcrPanel.querySelector('.vcr-next') as HTMLButtonElement;
        if (!_vcrBioBtn) _vcrBioBtn = _vcrPanel.querySelector('.vcr-biometric-wrap');
        return _vcrPanel;
    }
    const wrapper = document.querySelector('.phase-svg-wrapper');
    if (!wrapper) throw new Error('VCR panel: phase-svg-wrapper not found');
    const panel = document.createElement('div');
    panel.className = 'vcr-control-panel vcr-hidden';
    panel.innerHTML = `
        <div class="vcr-wing vcr-wing-left">
            <button class="vcr-btn vcr-prev" title="Previous track" disabled>${ICON_PREV}</button>
            <span class="vcr-step-label vcr-step-left"></span>
            <div class="vcr-biometric-wrap vcr-bio-hidden">
                <span class="vcr-bio-label">Biometric Loop</span>
            </div>
        </div>
        <button class="vcr-btn vcr-play intervention-play-btn" id="intervention-play-btn" title="Play">${ICON_PLAY}</button>
        <div class="vcr-wing vcr-wing-right">
            <span class="vcr-step-label vcr-step-right"></span>
            <button class="vcr-btn vcr-next" title="Next track">${ICON_NEXT}</button>
        </div>
    `;
    wrapper.appendChild(panel);
    _vcrPanel = panel;
    _vcrPlayBtn = panel.querySelector('.vcr-play') as HTMLButtonElement;
    _vcrPrevBtn = panel.querySelector('.vcr-prev') as HTMLButtonElement;
    _vcrNextBtn = panel.querySelector('.vcr-next') as HTMLButtonElement;
    _vcrBioBtn = panel.querySelector('.vcr-biometric-wrap');
    _vcrLeftLabel = panel.querySelector('.vcr-step-left');
    _vcrRightLabel = panel.querySelector('.vcr-step-right');
    bindVcrFontResync();

    _vcrPrevBtn.addEventListener('click', () => {
        if (_vcrPrevBtn?.disabled) return;
        if (_multiDayMode) {
            multiDayPlayPause();
            return;
        }
        triggerLxPrev();
        // Prev doesn't animate labels — quietly update after a short delay
        setTimeout(() => updateVcrLabelsStatic(), 100);
    });
    _vcrNextBtn.addEventListener('click', () => {
        if (_vcrNextBtn?.disabled) return;
        if (_multiDayMode) {
            cycleMultiDaySpeed();
            updateMultiDayVcrNav();
            return;
        }
        animateVcrLabelTransit();
        triggerLxNext();
    });
    _vcrPlayBtn.addEventListener('click', () => {
        if (_multiDayMode) {
            _ejectActivated = true;
            runEjectAnimation(panel);
            return;
        }
        if (_bioMode) {
            _bioMode = false;
            panel.querySelector('.vcr-biometric-wrap')?.classList.add(VCR_BIO_HIDDEN_CLASS);
            clearBioIntroMode(panel);
            hideNarrationPanel();
            // initBiometricFlow → configureVcrCanonAction handles panel mode
            initBiometricFlow();
            return;
        }
        const { mode } = getLxStepperState();
        if (mode === 'ready' || mode === 'playing' || mode === 'stepping') {
            animateVcrLabelTransit();
        }
        if (_vcrOnPlayClick) _vcrOnPlayClick();
        else triggerLxPlay();
    });

    setVcrUpdateCallback(updateVcrPanelState);
    return panel;
}

/** Show rotating orange waiting button while strategist (intervention) + Sherlock process */
export function showInterventionPlayButtonLoading() {
    _canonActionActive = false;
    _bioMode = false;
    const panel = ensureVcrPanel();
    clearVcrActionModule();
    deactivateMultiDayRibbonModule();
    clearBioIntroMode(panel);
    if (_vcrReadyAnimTimer != null) {
        window.clearTimeout(_vcrReadyAnimTimer);
        _vcrReadyAnimTimer = null;
    }
    setVcrPanelMode('visible');
    panel.classList.add('vcr-loading');
    panel.querySelector('.vcr-biometric-wrap')?.classList.add(VCR_BIO_HIDDEN_CLASS);
    _vcrPlayBtn?.classList.add('loading');
    _vcrPrevBtn?.classList.add('vcr-btn-hidden');
    _vcrNextBtn?.classList.add('vcr-btn-hidden');
    syncLegacyLxButton('loading');
    // Set initial label state for loading
    if (_vcrRightLabel) {
        _vcrRightLabel.textContent = 'Preparing Substances';
        _vcrRightLabel.classList.remove('vcr-label-bio');
        _vcrRightLabel.classList.add('vcr-label-visible');
    }
    if (_vcrLeftLabel) {
        _vcrLeftLabel.textContent = '';
        _vcrLeftLabel.classList.remove('vcr-label-visible');
    }
    _lastLabeledStep = -1;
    // Also clear any play button variant class
    _vcrPlayBtn?.classList.remove(...VCR_PLAY_VARIANTS);
    queueVcrPillResync();
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('visible')));
}

/** Show VCR panel with prev | play | next when ready */
export function showInterventionPlayButton() {
    _canonActionActive = false;
    _bioMode = false;
    const panel = ensureVcrPanel();
    clearVcrActionModule();
    deactivateMultiDayRibbonModule();
    clearBioIntroMode(panel);
    if (_vcrReadyAnimTimer != null) {
        window.clearTimeout(_vcrReadyAnimTimer);
        _vcrReadyAnimTimer = null;
    }
    setVcrPanelMode('visible');
    panel.classList.remove('vcr-loading');
    panel.querySelector('.vcr-biometric-wrap')?.classList.add(VCR_BIO_HIDDEN_CLASS);
    _vcrPrevBtn?.classList.remove('vcr-nav-active', 'vcr-btn-faded');
    _vcrPlayBtn?.classList.remove('loading', ...VCR_PLAY_VARIANTS);
    _vcrRightLabel?.classList.remove('vcr-label-bio');
    _lastLabeledStep = -1;
    updateVcrPanelState();
    syncLegacyLxButton('ready');
    queueVcrPillResync();
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('visible')));
}

export function setInterventionPlayClickHandler(fn: (() => void) | null) {
    _vcrOnPlayClick = fn;
    if (fn === null) {
        syncLegacyLxButton('hidden');
    }
}

/** Add biometric button to VCR panel when stream finishes */
export function showBiometricOnVcrPanel() {
    clearVcrActionModule();
    const panel = ensureVcrPanel();
    _canonActionActive = false;
    panel.classList.remove('vcr-loading');
    // Bio wrap stays hidden — only the red ∞ play button + right label are shown
    setVcrPanelMode('visible');
    _bioMode = true;
    panel.classList.add(VCR_BIO_INTRO_CLASS);
    _vcrPrevBtn?.classList.add('vcr-btn-hidden');
    _vcrNextBtn?.classList.add('vcr-btn-hidden');
    if (_vcrPlayBtn) {
        _vcrPlayBtn.innerHTML = '∞';
        _vcrPlayBtn.classList.remove('loading', ...VCR_PLAY_VARIANTS);
        _vcrPlayBtn.classList.add('vcr-play-bio');
        _vcrPlayBtn.title = 'Start biometric loop';
    }
    // Left flank empty
    if (_vcrLeftLabel) {
        _vcrLeftLabel.textContent = '';
        _vcrLeftLabel.classList.remove('vcr-label-visible', 'vcr-label-transit-out', 'vcr-label-transit-in');
    }
    // Right flank: "Biometric Loop"
    if (_vcrRightLabel) {
        _vcrRightLabel.textContent = 'Biometric Loop';
        _vcrRightLabel.classList.remove('vcr-label-transit-out', 'vcr-label-transit-in');
        _vcrRightLabel.classList.add('vcr-label-bio');
        _vcrRightLabel.classList.add('vcr-label-visible');
    }
    queueVcrPillResync();

    // Turbo: auto-click the ∞ button to start biometric flow
    if (isTurboActive()) {
        queueMicrotask(() => {
            _bioMode = false;
            panel.querySelector('.vcr-biometric-wrap')?.classList.add(VCR_BIO_HIDDEN_CLASS);
            clearBioIntroMode(panel);
            hideNarrationPanel();
            initBiometricFlow();
        });
    }
}

export function hideInterventionPlayButton() {
    syncLegacyLxButton('hidden');
    teardownVcrPanel();
}

export function showStreamOnVcrPanel() {
    configureVcrCanonAction({
        label: 'Stream',
        icon: ICON_LX,
        playClass: 'vcr-play-stream',
        onClick: () => {
            if (CompileState.phase !== 'idle') return;
            clearNarration();
            const engine = TimelineState.engine;
            if (engine) engine.seek(engine.getCurrentTime());
            const svg = document.getElementById('phase-chart-svg');
            if (svg instanceof SVGSVGElement) {
                void animateCompileSequence(svg);
            }
        },
    });
}

// ---- Revision Play Button (red) ----

export function showRevisionPlayButton() {
    let btn = document.getElementById('revision-play-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'revision-play-btn';
        btn.className = 'revision-play-btn hidden';
        btn.innerHTML =
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
        document.querySelector('.phase-chart-container')!.appendChild(btn);
    }
    // Use SVG rendered height for positioning (more reliable than getBoundingClientRect)
    const svg = document.getElementById('phase-chart-svg');
    const top = svg ? svg.clientHeight + 16 : getBiometricTopOffset() + 16;
    (btn as HTMLElement).style.top = top + 'px';
    btn.classList.remove('hidden');
    btn.classList.add('loading');
    requestAnimationFrame(() => requestAnimationFrame(() => btn!.classList.add('visible')));
}

export function hideRevisionPlayButton() {
    const btn = document.getElementById('revision-play-btn');
    if (!btn) return;
    btn.classList.remove('visible');
    setTimeout(() => {
        btn.classList.add('hidden');
        btn.classList.remove('loading');
    }, 500);
}

export function setRevisionPlayReady() {
    const btn = document.getElementById('revision-play-btn');
    if (btn) btn.classList.remove('loading');
}

// ---- Lx Curve Morph After Revision ----

type RevisionBandDescriptor = {
    id: string;
    bandId: string;
    curveIdx: number;
    color: string;
    substanceKey: string;
    timeMinutes: number;
    stepIdx: number;
    deltaPts: any[];
};

function interpolateRevisionPoints(fromPts: any[], toPts: any[], progress: number): any[] {
    const len = Math.min(fromPts.length, toPts.length);
    const points: any[] = [];
    for (let i = 0; i < len; i++) {
        points.push({
            hour: toPts[i].hour,
            value: fromPts[i].value + (toPts[i].value - fromPts[i].value) * progress,
        });
    }
    return points;
}

function cloneRevisionPoints(points: any[]): any[] {
    return (points || []).map(point => ({
        hour: Number(point.hour),
        value: Number(point.value),
    }));
}

function zeroRevisionPoints(points: any[]): any[] {
    return (points || []).map(point => ({
        hour: Number(point.hour),
        value: 0,
    }));
}

function addRevisionDeltaToPoints(basePts: any[], deltaPts: any[]): any[] {
    const len = Math.min(basePts.length, deltaPts.length);
    const points: any[] = [];
    for (let i = 0; i < len; i++) {
        points.push({
            hour: Number(basePts[i].hour),
            value: basePts[i].value + deltaPts[i].value,
        });
    }
    return points;
}

function baselinePointsForRevisionBands(
    fromIncrementalSnapshots: LxSnapshot[] | null | undefined,
    toIncrementalSnapshots: LxSnapshot[] | null | undefined,
    curvesData: any,
): any[][] {
    const curveCount = Array.isArray(curvesData) ? curvesData.length : 0;
    const baselines: any[][] = [];
    for (let curveIdx = 0; curveIdx < curveCount; curveIdx++) {
        const fromBaseline = fromIncrementalSnapshots?.[0]?.lxCurves?.[curveIdx]?.baseline;
        const toBaseline = toIncrementalSnapshots?.[0]?.lxCurves?.[curveIdx]?.baseline;
        const fallback = curvesData?.[curveIdx]?.baseline || [];
        baselines.push(cloneRevisionPoints(fromBaseline || toBaseline || fallback));
    }
    return baselines;
}

function revisionBandId(iv: any): string {
    if (iv?._revisionStableId) return String(iv._revisionStableId);
    return [iv?.key || '', iv?.timeMinutes ?? '', iv?.dose || '', iv?.doseMultiplier ?? 1].join('|');
}

function buildRevisionBandState(
    incrementalSnapshots: LxSnapshot[] | null | undefined,
    curvesData: any,
): Map<string, RevisionBandDescriptor> {
    const descriptors = new Map<string, RevisionBandDescriptor>();
    if (!Array.isArray(incrementalSnapshots)) return descriptors;

    for (let stepIdx = 0; stepIdx < incrementalSnapshots.length; stepIdx++) {
        const snapshot = incrementalSnapshots[stepIdx];
        const iv = snapshot?.step?.[0];
        if (!iv) continue;

        const bandId = revisionBandId(iv);
        const substanceColor = iv.substance?.color || curvesData?.[0]?.color || 'rgba(245,180,60,0.7)';

        for (let curveIdx = 0; curveIdx < curvesData.length; curveIdx++) {
            const sourcePts =
                stepIdx === 0
                    ? snapshot?.lxCurves?.[curveIdx]?.baseline || []
                    : incrementalSnapshots?.[stepIdx - 1]?.lxCurves?.[curveIdx]?.points || [];
            const targetPts = snapshot?.lxCurves?.[curveIdx]?.points || [];
            if (sourcePts.length < 2 || targetPts.length < 2) continue;
            const deltaPts = targetPts.map((targetPt: any, ptIdx: number) => ({
                hour: Number(targetPt.hour),
                value: Number(targetPt.value) - Number(sourcePts[ptIdx]?.value ?? targetPt.value),
            }));

            const id = `${bandId}::${curveIdx}`;
            descriptors.set(id, {
                id,
                bandId,
                curveIdx,
                color: substanceColor,
                substanceKey: iv.key || '',
                timeMinutes: Number(iv.timeMinutes || 0),
                stepIdx,
                deltaPts,
            });
        }
    }

    return descriptors;
}

function renderRevisionBandState(
    incrementalSnapshots: LxSnapshot[] | null | undefined,
    curvesData: any,
    bandRenderOrder?: Map<string, number> | null,
): void {
    const bandsGroup = document.getElementById('phase-lx-bands');
    if (!bandsGroup) return;

    const bandState = buildRevisionBandState(incrementalSnapshots, curvesData);
    const sortedBands = Array.from(bandState.values()).sort(
        (a, b) =>
            (bandRenderOrder?.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
                (bandRenderOrder?.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
            a.curveIdx - b.curveIdx ||
            a.timeMinutes - b.timeMinutes,
    );
    const baselines = baselinePointsForRevisionBands(null, incrementalSnapshots, curvesData);
    const runningByCurve = baselines.map(baseline => cloneRevisionPoints(baseline));

    bandsGroup.innerHTML = '';
    for (const band of sortedBands) {
        const sourcePts = cloneRevisionPoints(runningByCurve[band.curveIdx] || []);
        const targetPts = addRevisionDeltaToPoints(sourcePts, band.deltaPts);
        const bandD = phaseBandPath(targetPts, sourcePts);
        if (!bandD) continue;
        bandsGroup.appendChild(
            svgEl('path', {
                d: bandD,
                fill: band.color,
                'fill-opacity': '0.18',
                class: 'lx-auc-band',
                'data-substance-key': band.substanceKey,
                'data-time-minutes': String(band.timeMinutes),
                'data-step-idx': String(band.stepIdx),
                'data-curve-idx': String(band.curveIdx),
            }),
        );
        runningByCurve[band.curveIdx] = targetPts;
    }
}

function buildRevisionBandAliasMaps(revisionEntries?: DiffEntry[] | DiffEntry | null): {
    oldToNew: Map<string, string>;
    newToOld: Map<string, string>;
} {
    const entries = Array.isArray(revisionEntries) ? revisionEntries : revisionEntries ? [revisionEntries] : [];
    const oldToNew = new Map<string, string>();

    for (const entry of entries) {
        if (!entry?.oldIv || !entry?.newIv) continue;
        oldToNew.set(revisionBandId(entry.oldIv), revisionBandId(entry.newIv));
    }

    const newToOld = new Map<string, string>();
    oldToNew.forEach((newId, oldId) => newToOld.set(newId, oldId));
    return { oldToNew, newToOld };
}

function buildRevisionBandRenderOrder(
    fromState: Map<string, RevisionBandDescriptor>,
    toState: Map<string, RevisionBandDescriptor>,
    revisionEntries?: DiffEntry[] | DiffEntry | null,
): Map<string, number> {
    const { newToOld } = buildRevisionBandAliasMaps(revisionEntries);
    const order = new Map<string, number>();
    let nextOrder = 0;

    for (const id of fromState.keys()) {
        order.set(id, nextOrder++);
    }

    for (const toBand of toState.values()) {
        if (order.has(toBand.id)) continue;
        const aliasedOldBandId = newToOld.get(toBand.bandId);
        const aliasedKey = aliasedOldBandId ? `${aliasedOldBandId}::${toBand.curveIdx}` : null;
        if (aliasedKey && order.has(aliasedKey)) {
            order.set(toBand.id, order.get(aliasedKey)!);
        } else {
            order.set(toBand.id, nextOrder++);
        }
    }

    return order;
}

function renderRevisionBandMorphFrame(
    fromIncrementalSnapshots: LxSnapshot[] | null | undefined,
    toIncrementalSnapshots: LxSnapshot[] | null | undefined,
    curvesData: any,
    progress: number,
    revisionEntries?: DiffEntry[] | DiffEntry | null,
    bandRenderOrder?: Map<string, number> | null,
): void {
    const bandsGroup = document.getElementById('phase-lx-bands');
    if (!bandsGroup) return;

    const fromState = buildRevisionBandState(fromIncrementalSnapshots, curvesData);
    const toState = buildRevisionBandState(toIncrementalSnapshots, curvesData);
    const { newToOld } = buildRevisionBandAliasMaps(revisionEntries);
    const renderOrder = bandRenderOrder || buildRevisionBandRenderOrder(fromState, toState, revisionEntries);
    const baselines = baselinePointsForRevisionBands(fromIncrementalSnapshots, toIncrementalSnapshots, curvesData);

    const matchedOld = new Set<string>();
    const renderQueue: Array<{
        descriptor: RevisionBandDescriptor;
        deltaPts: any[];
        order: number;
    }> = [];

    for (const toBand of toState.values()) {
        let fromBand = fromState.get(toBand.id);
        if (!fromBand) {
            const aliasedOldBandId = newToOld.get(toBand.bandId);
            if (aliasedOldBandId) {
                fromBand = fromState.get(`${aliasedOldBandId}::${toBand.curveIdx}`);
            }
        }

        if (fromBand) {
            matchedOld.add(fromBand.id);
            renderQueue.push({
                descriptor: toBand,
                deltaPts: interpolateRevisionPoints(fromBand.deltaPts, toBand.deltaPts, progress),
                order: renderOrder.get(toBand.id) ?? Number.MAX_SAFE_INTEGER,
            });
        } else {
            renderQueue.push({
                descriptor: toBand,
                deltaPts: interpolateRevisionPoints(zeroRevisionPoints(toBand.deltaPts), toBand.deltaPts, progress),
                order: renderOrder.get(toBand.id) ?? Number.MAX_SAFE_INTEGER,
            });
        }
    }

    for (const fromBand of fromState.values()) {
        if (matchedOld.has(fromBand.id)) continue;
        if (toState.has(fromBand.id)) continue;

        renderQueue.push({
            descriptor: fromBand,
            deltaPts: interpolateRevisionPoints(fromBand.deltaPts, zeroRevisionPoints(fromBand.deltaPts), progress),
            order: renderOrder.get(fromBand.id) ?? Number.MAX_SAFE_INTEGER,
        });
    }

    renderQueue.sort((a, b) => a.order - b.order || a.descriptor.curveIdx - b.descriptor.curveIdx);

    const runningByCurve = baselines.map(baseline => cloneRevisionPoints(baseline));

    bandsGroup.innerHTML = '';
    for (const item of renderQueue) {
        const curveIdx = item.descriptor.curveIdx;
        const sourcePts = cloneRevisionPoints(runningByCurve[curveIdx] || []);
        const targetPts = addRevisionDeltaToPoints(sourcePts, item.deltaPts);
        const path = phaseBandPath(targetPts, sourcePts);
        if (!path) continue;
        bandsGroup.appendChild(
            svgEl('path', {
                d: path,
                fill: item.descriptor.color,
                'fill-opacity': '0.18',
                class: 'lx-auc-band',
                'data-substance-key': item.descriptor.substanceKey,
                'data-time-minutes': String(item.descriptor.timeMinutes),
                'data-step-idx': String(item.descriptor.stepIdx),
                'data-curve-idx': String(item.descriptor.curveIdx),
            }),
        );
        runningByCurve[curveIdx] = targetPts;
    }
}

function renderLxCurveMorphFrame(oldLxCurves: any, newLxCurves: any, curvesData: any, progress: number): void {
    const lxGroup = document.getElementById('phase-lx-curves');
    if (!lxGroup) return;
    const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
    const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');
    const morphedCurves: any[] = [];

    for (let ci = 0; ci < curvesData.length; ci++) {
        const oldPts = oldLxCurves[ci]?.points || [];
        const newPts = newLxCurves[ci]?.points || [];
        const len = Math.min(oldPts.length, newPts.length);
        if (len === 0) continue;

        const morphed: any[] = [];
        for (let j = 0; j < len; j++) {
            morphed.push({
                hour: oldPts[j].hour,
                value: oldPts[j].value + (newPts[j].value - oldPts[j].value) * progress,
            });
        }

        if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
        if (lxFills[ci]) {
            lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
            if (lxFills[ci].getAttribute('fill-opacity') === '0') {
                lxFills[ci].setAttribute('fill-opacity', '0.08');
            }
        }

        morphedCurves.push({
            ...newLxCurves[ci],
            baseline: newLxCurves[ci]?.baseline ?? oldLxCurves[ci]?.baseline,
            points: morphed,
        });
    }

    updateGamificationCurveData(morphedCurves);
}

function updateRevisionPeakDescriptors(newLxCurves: any, curvesData: any): void {
    const baseGroup = document.getElementById('phase-baseline-curves');
    const overlay = document.getElementById('phase-tooltip-overlay');
    if (baseGroup) baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
    if (overlay) overlay.querySelectorAll('.peak-descriptor').forEach(el => el.remove());

    const lxCurvesForLabels = curvesData.map((c: any, i: number) => ({
        ...c,
        desired: newLxCurves[i].points,
    }));
    placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
}

export async function morphLxCurvesToRevision(
    oldLxCurves: any,
    newLxCurves: any,
    curvesData: any,
    options: {
        duration?: number;
        updatePeakDescriptors?: boolean;
        fromIncrementalSnapshots?: LxSnapshot[] | null;
        toIncrementalSnapshots?: LxSnapshot[] | null;
        revisionEntries?: DiffEntry[] | DiffEntry | null;
        bandRenderOrder?: Map<string, number> | null;
    } = {},
) {
    const duration = isTurboActive() ? 0 : (options.duration ?? 1200);
    const shouldUpdatePeaks = options.updatePeakDescriptors !== false;
    const fromIncrementalSnapshots = options.fromIncrementalSnapshots;
    const toIncrementalSnapshots = options.toIncrementalSnapshots;
    const revisionEntries = options.revisionEntries ?? null;
    const bandRenderOrder = options.bandRenderOrder ?? null;

    if (duration <= 0) {
        renderLxCurveMorphFrame(oldLxCurves, newLxCurves, curvesData, 1);
        if (toIncrementalSnapshots) {
            if (fromIncrementalSnapshots) {
                renderRevisionBandMorphFrame(
                    fromIncrementalSnapshots,
                    toIncrementalSnapshots,
                    curvesData,
                    1,
                    revisionEntries,
                    bandRenderOrder,
                );
            } else {
                renderRevisionBandState(toIncrementalSnapshots, curvesData, bandRenderOrder);
            }
            attachBandHoverListeners();
        }
        if (shouldUpdatePeaks) updateRevisionPeakDescriptors(newLxCurves, curvesData);
        return;
    }

    await new Promise<void>(resolve => {
        const startTime = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / duration);
            const ease = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

            renderLxCurveMorphFrame(oldLxCurves, newLxCurves, curvesData, ease);
            if (fromIncrementalSnapshots && toIncrementalSnapshots) {
                renderRevisionBandMorphFrame(
                    fromIncrementalSnapshots,
                    toIncrementalSnapshots,
                    curvesData,
                    ease,
                    revisionEntries,
                    bandRenderOrder,
                );
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        })(performance.now());
    });

    if (shouldUpdatePeaks) updateRevisionPeakDescriptors(newLxCurves, curvesData);
}

function buildRevisionInterventionSnapshots(oldInterventions: any[], diff: any[]) {
    const slots = (oldInterventions || []).map((iv: any, idx: number) => ({
        slotId: `old-${idx}`,
        iv,
    }));
    const slotIds = new Map((oldInterventions || []).map((iv: any, idx: number) => [iv, `old-${idx}`]));
    const snapshots: any[] = [];

    for (let idx = 0; idx < diff.length; idx++) {
        const entry = diff[idx];
        if (entry?.type === 'added' && entry.newIv) {
            slots.push({ slotId: `added-${idx}`, iv: entry.newIv });
        } else if (entry?.oldIv) {
            const slotId = slotIds.get(entry.oldIv);
            const slotIndex = slots.findIndex((slot: any) => slot.slotId === slotId);
            if (slotIndex >= 0) {
                if (entry.type === 'removed') {
                    slots.splice(slotIndex, 1);
                } else if (entry.newIv) {
                    slots[slotIndex] = { ...slots[slotIndex], iv: entry.newIv };
                }
            } else if (entry.newIv) {
                slots.push({ slotId: `late-${idx}`, iv: entry.newIv });
            }
        }

        const activeInterventions = slots
            .map((slot: any) => slot.iv)
            .filter(Boolean)
            .sort((a: any, b: any) => (a.timeMinutes || 0) - (b.timeMinutes || 0));
        snapshots.push(activeInterventions);
    }

    return snapshots;
}

function buildRevisionCurveSnapshots(
    oldInterventions: any[],
    diff: any[],
    curvesData: any,
    fixedScaleFactors?: number[] | null,
) {
    return buildRevisionInterventionSnapshots(oldInterventions, diff).map((activeInterventions: any[]) =>
        computeLxOverlay(activeInterventions, curvesData, fixedScaleFactors),
    );
}

function buildRevisionIncrementalSnapshots(
    oldInterventions: any[],
    diff: any[],
    curvesData: any,
    fixedScaleFactors?: number[] | null,
): LxSnapshot[][] {
    return buildRevisionInterventionSnapshots(oldInterventions, diff).map((activeInterventions: any[]) =>
        computeIncrementalLxOverlay(activeInterventions, curvesData, fixedScaleFactors),
    );
}

// ---- Biometric Strip Morph After Revision ----

/**
 * Smoothly morph biometric strip waveforms from old channel data to new channel data.
 * Interpolates the 97 datapoints per channel and rebuilds SVG paths each frame.
 */
// morphBiometricStripsToRevision removed — no longer needed since
// revised biometric re-simulation was removed.

// ============================================
// Points of Interest — Neural Network Connectors
// ============================================

const POI_ENABLED = true;

/**
 * Extract points of interest from revision diff + biometric data.
 * Maps each diff entry (substance change) to a biometric coordinate + substance pill coordinate.
 */
export function extractPointsOfInterest(diff: any[], channels: any[], timelineGroup: Element): any[] {
    const pois: any[] = [];
    if (!diff || diff.length === 0 || !channels || channels.length === 0) return pois;

    for (const d of diff) {
        const triggerIv = d.newIv || d.oldIv;
        const anchorIv = d.oldIv || d.newIv;
        if (!triggerIv || !anchorIv) continue;

        let bioHour: number | null = null;
        let bioSignal: string | null = null;
        let observation = '';

        // Try to use LLM-provided bioTrigger first
        if (triggerIv.bioTrigger && triggerIv.bioTrigger.hour != null && triggerIv.bioTrigger.channel) {
            bioHour = triggerIv.bioTrigger.hour;
            bioSignal = triggerIv.bioTrigger.channel;
            observation = triggerIv.bioTrigger.observation || '';
        } else {
            // Fallback: derive from biometric data variance
            const derived = deriveBioTriggerFallback(d, channels);
            if (derived) {
                bioHour = derived.hour;
                bioSignal = derived.channel;
                observation = `High variance in ${derived.channel} near intervention time`;
            }
        }

        if (bioHour == null || !bioSignal) continue;

        // Find the channel in rendered strips
        const channelIdx = channels.findIndex((ch: any) => ch.signal === bioSignal);
        if (channelIdx < 0) continue;
        const channel = channels[channelIdx];

        // Compute biometric strip SVG coordinates (clamped to plot bounds)
        const plotL = PHASE_CHART.padL;
        const plotR = PHASE_CHART.padL + PHASE_CHART.plotW;
        const bioSvgX = Math.max(plotL, Math.min(plotR, phaseChartX(bioHour * 60)));
        const bioY = getBiometricStripY(channelIdx, channels);
        const stripH = channel.stripHeight || 16;

        // Find the value at this hour in the channel data
        let bioVal = 50; // fallback
        if (channel.data && Array.isArray(channel.data)) {
            const closest = channel.data.reduce((prev: any, curr: any) =>
                Math.abs((curr.hour || 0) - bioHour!) < Math.abs((prev.hour || 0) - bioHour!) ? curr : prev,
            );
            bioVal = closest.value ?? 50;
        }
        const rangeMin = (channel.range && channel.range[0]) || 0;
        const rangeMax = (channel.range && channel.range[1]) || 100;
        const normalized = (bioVal - rangeMin) / (rangeMax - rangeMin || 1);
        const bioSvgY = bioY + stripH - normalized * stripH;

        // Find substance pill SVG coordinates — skip if no matching pill in DOM
        const pills = timelineGroup.querySelectorAll('.timeline-pill-group');
        let foundPill = false;
        let pillSvgY = TIMELINE_ZONE.top + 10;
        let resolvedPillSvgX = Math.max(plotL, Math.min(plotR, phaseChartX(anchorIv.timeMinutes || 0)));
        for (const pill of Array.from(pills)) {
            const pk = pill.getAttribute('data-substance-key');
            const pt = parseFloat(pill.getAttribute('data-time-minutes') || '0');
            const stableId = pill.getAttribute('data-revision-stable-id') || '';
            if (
                (anchorIv._revisionStableId && stableId === String(anchorIv._revisionStableId)) ||
                (pk === anchorIv.key && Math.abs(pt - (anchorIv.timeMinutes || 0)) < 30)
            ) {
                const rect = pill.querySelector('rect');
                if (rect) {
                    resolvedPillSvgX = Math.max(
                        plotL,
                        Math.min(plotR, parseFloat(rect.getAttribute('x') || String(resolvedPillSvgX))),
                    );
                    pillSvgY =
                        parseFloat(rect.getAttribute('y') || String(TIMELINE_ZONE.top)) +
                        parseFloat(rect.getAttribute('height') || '20') / 2;
                }
                foundPill = true;
                break;
            }
        }

        // No matching pill in the DOM → orphan connector, skip it
        if (!foundPill) continue;

        pois.push({
            bioHour,
            bioSignal,
            bioSvgX,
            bioSvgY,
            bioStripIdx: channelIdx,
            substanceKey: anchorIv.key,
            pillSvgX: resolvedPillSvgX,
            pillSvgY,
            diffType: d.type,
            observation,
            color: channel.color || '#ff4444',
            _oldIv: d.oldIv || null,
            _newIv: d.newIv || null,
        });
    }

    return pois;
}

/**
 * Get the Y offset of a biometric strip by index.
 * The biometric zone top is computed dynamically from the SVG.
 */
function getBiometricStripY(idx: number, channels: any[]): number {
    const stripsGroup = document.getElementById('phase-biometric-strips');
    if (!stripsGroup) return 500;

    // Find the bio-zone separator line to determine the start of biometric strips
    const sep = stripsGroup.querySelector('line');
    let startY = sep ? parseFloat(sep.getAttribute('y1') || '500') + BIOMETRIC_ZONE.separatorPad : 500;

    // Walk through channels to find the Y offset for `idx`
    const compositesSeen = new Set<string>();
    let y = startY;
    for (let i = 0; i < channels.length; i++) {
        const ch = channels[i];
        if (ch._compositeGroup) {
            if (compositesSeen.has(ch._compositeGroup)) continue;
            compositesSeen.add(ch._compositeGroup);
        }
        if (i === idx || (ch._compositeGroup && channels[idx]?._compositeGroup === ch._compositeGroup)) {
            return y;
        }
        const h = ch.stripHeight || BIOMETRIC_ZONE.laneH;
        y += h + BIOMETRIC_ZONE.laneGap;
    }
    return y;
}

/**
 * Derive a bioTrigger fallback from biometric data variance.
 */
function deriveBioTriggerFallback(diffEntry: any, channels: any[]): { hour: number; channel: string } | null {
    const iv = diffEntry.oldIv || diffEntry.newIv;
    if (!iv || !channels || channels.length === 0) return null;

    const timeH = (iv.timeMinutes || 0) / 60;
    let bestScore = -1;
    let bestChannel = '';
    let bestHour = timeH;

    // Collect eligible (non-composite) channels
    const eligible = channels.filter(
        (ch: any) => ch.signal && ch.data && Array.isArray(ch.data) && ch.data.length >= 5 && !ch._compositeGroup,
    );

    if (eligible.length === 0) {
        // Last resort: pick any channel with data
        const any = channels.find((ch: any) => ch.signal && ch.data && ch.data.length > 0);
        return any ? { hour: timeH, channel: any.signal } : null;
    }

    for (const ch of eligible) {
        // Find data in a window around the substance time
        const windowData = ch.data.filter((d: any) => Math.abs((d.hour || d.time || 0) - timeH) <= 1.5);

        if (windowData.length < 2) continue;

        const mean = windowData.reduce((s: number, d: any) => s + (d.value || 0), 0) / windowData.length;
        const variance =
            windowData.reduce((s: number, d: any) => s + Math.pow((d.value || 0) - mean, 2), 0) / windowData.length;

        // Score: higher variance = more interesting, but any non-zero score is acceptable
        if (variance > bestScore) {
            bestScore = variance;
            bestChannel = ch.signal;
            // Find the peak deviation point
            let maxDev = 0;
            for (const d of windowData) {
                const dev = Math.abs((d.value || 0) - mean);
                if (dev > maxDev) {
                    maxDev = dev;
                    bestHour = d.hour || d.time || timeH;
                }
            }
        }
    }

    // If variance-based selection found nothing (all channels flat), just pick
    // the first eligible channel at the substance time
    if (!bestChannel && eligible.length > 0) {
        bestChannel = eligible[0].signal;
        bestHour = timeH;
    }

    return bestChannel ? { hour: bestHour, channel: bestChannel } : null;
}

/**
 * Render points of interest as red dots + connector lines.
 */
export function renderPointsOfInterest(pois: any[], container: SVGElement, mode: 'bezier' | 'circuit') {
    // Clear existing
    while (container.firstChild) container.removeChild(container.firstChild);
    if (pois.length === 0) return;

    const palette = BIO_RED_PALETTE;

    for (let i = 0; i < pois.length; i++) {
        const poi = pois[i];
        const g = svgEl('g', {
            class: 'poi-connector-group',
            opacity: '0',
            'data-bio-signal': poi.bioSignal || '',
            'data-bio-hour': String(poi.bioHour ?? ''),
        });

        // Connector line
        const lineColor = poi.color || palette[i % palette.length];
        let pathD: string;

        if (mode === 'bezier') {
            // Quadratic bezier: upward curve from bio dot to pill
            const midX = (poi.bioSvgX + poi.pillSvgX) / 2;
            const midY = (poi.bioSvgY + poi.pillSvgY) / 2 - 20;
            pathD = `M${poi.bioSvgX},${poi.bioSvgY} Q${midX},${midY} ${poi.pillSvgX},${poi.pillSvgY}`;
        } else {
            // Circuit: right-angle stepped lines
            const midY = (poi.bioSvgY + poi.pillSvgY) / 2;
            pathD = `M${poi.bioSvgX},${poi.bioSvgY} L${poi.bioSvgX},${midY} L${poi.pillSvgX},${midY} L${poi.pillSvgX},${poi.pillSvgY}`;
        }

        const line = svgEl('path', {
            d: pathD,
            fill: 'none',
            stroke: lineColor,
            'stroke-width': mode === 'circuit' ? '1.5' : '1',
            'stroke-dasharray': mode === 'bezier' ? '3 4' : 'none',
            'stroke-opacity': '0.45',
            class: mode === 'circuit' ? 'poi-line-circuit' : 'poi-line-bezier',
        });
        g.appendChild(line);

        // Red dot on biometric strip
        const dot = svgEl('circle', {
            cx: String(poi.bioSvgX),
            cy: String(poi.bioSvgY),
            r: '3.5',
            fill: '#ff4444',
            'fill-opacity': '0.85',
            stroke: '#ff4444',
            'stroke-width': '1',
            'stroke-opacity': '0.3',
            class: 'poi-dot',
        });
        g.appendChild(dot);

        // Pulse ring around dot
        const pulseRing = svgEl('circle', {
            cx: String(poi.bioSvgX),
            cy: String(poi.bioSvgY),
            r: '3.5',
            fill: 'none',
            stroke: '#ff4444',
            'stroke-width': '1.5',
            'stroke-opacity': '0.6',
            class: 'poi-pulse-ring',
        });
        g.appendChild(pulseRing);

        // Small dot at pill end
        const pillDot = svgEl('circle', {
            cx: String(poi.pillSvgX),
            cy: String(poi.pillSvgY),
            r: '2',
            fill: lineColor,
            'fill-opacity': '0.6',
        });
        g.appendChild(pillDot);

        container.appendChild(g);
    }
}

/**
 * Animate POI appearance as an upward connector draw with a trailing pulse.
 */
export async function animatePointsOfInterest(container: SVGElement, duration: number = 1200): Promise<void> {
    const groups = Array.from(container.querySelectorAll('.poi-connector-group'));
    if (groups.length === 0) return;

    // Turbo: show everything instantly
    if (isTurboActive()) {
        groups.forEach((g: any) => g.setAttribute('opacity', '1'));
        return;
    }

    const connectorCount = Math.max(1, groups.length);
    const stagger = Math.min(150, Math.max(70, duration / Math.max(connectorCount * 1.8, 1)));
    const drawDuration = Math.max(420, duration - stagger * Math.max(0, connectorCount - 1));

    await Promise.all(
        groups.map(
            (group, idx) =>
                new Promise<void>(resolve => {
                    window.setTimeout(() => {
                        const g = group as SVGElement;
                        const path = g.querySelector('path') as SVGPathElement | null;
                        const dot = g.querySelector('.poi-dot') as SVGCircleElement | null;
                        const pulseRing = g.querySelector('.poi-pulse-ring') as SVGCircleElement | null;
                        const pillDot = Array.from(g.querySelectorAll('circle')).find(
                            el => !el.classList.contains('poi-dot') && !el.classList.contains('poi-pulse-ring'),
                        ) as SVGCircleElement | null;

                        const baseStrokeOpacity = path?.getAttribute('stroke-opacity') || '0.45';
                        let pathLength = 0;
                        if (path) {
                            try {
                                pathLength = path.getTotalLength();
                            } catch {
                                pathLength = 0;
                            }
                            if (pathLength > 0) {
                                path.style.strokeDasharray = `${pathLength}`;
                                path.style.strokeDashoffset = `${pathLength}`;
                            }
                            path.setAttribute('stroke-opacity', '0.88');
                            path.setAttribute('stroke-linecap', 'round');
                        }

                        g.setAttribute('opacity', '1');

                        if (dot) {
                            dot.setAttribute('opacity', '0');
                            dot.setAttribute('r', '2.2');
                        }
                        if (pulseRing) {
                            pulseRing.setAttribute('opacity', '0');
                            pulseRing.setAttribute('r', '3.5');
                        }
                        if (pillDot) {
                            pillDot.setAttribute('opacity', '0');
                            pillDot.setAttribute('r', '1.3');
                        }

                        const start = performance.now();
                        const tick = (now: number) => {
                            const rawT = Math.min(1, (now - start) / drawDuration);
                            const ease = 1 - Math.pow(1 - rawT, 3);

                            if (path && pathLength > 0) {
                                path.style.strokeDashoffset = `${pathLength * (1 - ease)}`;
                                const strokeOpacity = 0.24 + 0.64 * ease;
                                path.setAttribute('stroke-opacity', strokeOpacity.toFixed(3));
                            }

                            if (dot) {
                                const dotT = Math.min(1, rawT / 0.35);
                                dot.setAttribute('opacity', dotT.toFixed(3));
                                dot.setAttribute('r', (2.2 + 1.3 * dotT).toFixed(2));
                            }

                            if (pulseRing) {
                                const pulseT = clamp((rawT - 0.06) / 0.74, 0, 1);
                                pulseRing.setAttribute('opacity', (0.68 * (1 - pulseT * 0.45)).toFixed(3));
                                pulseRing.setAttribute('r', (3.5 + 7.2 * pulseT).toFixed(2));
                            }

                            if (pillDot) {
                                const pillT = clamp((rawT - 0.48) / 0.52, 0, 1);
                                pillDot.setAttribute('opacity', pillT.toFixed(3));
                                pillDot.setAttribute('r', (1.3 + 0.9 * pillT).toFixed(2));
                            }

                            if (rawT < 1) {
                                requestAnimationFrame(tick);
                                return;
                            }

                            if (path) {
                                path.style.strokeDasharray = '';
                                path.style.strokeDashoffset = '';
                                path.setAttribute('stroke-opacity', baseStrokeOpacity);
                            }
                            if (dot) {
                                dot.setAttribute('opacity', '1');
                                dot.setAttribute('r', '3.5');
                            }
                            if (pulseRing) {
                                pulseRing.setAttribute('opacity', '0.6');
                                pulseRing.setAttribute('r', '10.7');
                            }
                            if (pillDot) {
                                pillDot.setAttribute('opacity', '1');
                                pillDot.setAttribute('r', '2');
                            }
                            resolve();
                        };

                        requestAnimationFrame(tick);
                    }, idx * stagger);
                }),
        ),
    );
}

/**
 * Update POI connector pill endpoints after substance pills have been re-rendered.
 * Walks the stored POI list, finds each pill's new position in the DOM, and re-draws paths.
 */
function updatePoiConnectorPillEndpoints(
    pois: any[],
    container: SVGElement,
    timelineGroup: Element,
    mode: 'bezier' | 'circuit',
) {
    const groups = Array.from(container.querySelectorAll('.poi-connector-group'));
    if (groups.length !== pois.length) return;

    const pills = timelineGroup.querySelectorAll('.timeline-pill-group');

    for (let i = 0; i < pois.length; i++) {
        const poi = pois[i];
        const g = groups[i] as SVGElement;

        // Find updated pill position
        let newPillY = poi.pillSvgY;
        let newPillX = poi.pillSvgX;
        for (const pill of Array.from(pills)) {
            const pk = pill.getAttribute('data-substance-key');
            const pt = parseFloat(pill.getAttribute('data-time-minutes') || '0');
            const iv = poi._newIv || poi;
            const ivKey = iv.substanceKey || iv.key;
            const ivTime = iv.timeMinutes ?? (poi.pillSvgX != null ? null : 0);
            if (pk === ivKey && Math.abs(pt - (ivTime ?? pt)) < 30) {
                const rect = pill.querySelector('rect');
                if (rect) {
                    newPillY =
                        parseFloat(rect.getAttribute('y') || String(TIMELINE_ZONE.top)) +
                        parseFloat(rect.getAttribute('height') || '20') / 2;
                    newPillX = parseFloat(rect.getAttribute('x') || String(phaseChartX(pt)));
                }
                break;
            }
        }

        poi.pillSvgX = newPillX;
        poi.pillSvgY = newPillY;

        // Re-draw connector path
        const path = g.querySelector('path');
        if (path) {
            let pathD: string;
            if (mode === 'bezier') {
                const midX = (poi.bioSvgX + newPillX) / 2;
                const midY = (poi.bioSvgY + newPillY) / 2 - 20;
                pathD = `M${poi.bioSvgX},${poi.bioSvgY} Q${midX},${midY} ${newPillX},${newPillY}`;
            } else {
                const midY = (poi.bioSvgY + newPillY) / 2;
                pathD = `M${poi.bioSvgX},${poi.bioSvgY} L${poi.bioSvgX},${midY} L${newPillX},${midY} L${newPillX},${newPillY}`;
            }
            path.setAttribute('d', pathD);
        }

        // Update pill-end dot
        const pillDot = g.querySelector('circle:last-child');
        if (pillDot && !pillDot.classList.contains('poi-dot') && !pillDot.classList.contains('poi-pulse-ring')) {
            pillDot.setAttribute('cx', String(newPillX));
            pillDot.setAttribute('cy', String(newPillY));
        }
    }
}

// ---- Revision Orchestrator ----

export async function handleRevisionPhase(curvesData: any): Promise<boolean> {
    if (!curvesData || !PhaseState.interventionResult) {
        return false;
    }

    const userGoal = PhaseState.userGoal || '';
    const rawOld = extractInterventionsData(PhaseState.interventionResult);
    const oldIvs = validateInterventions(rawOld, curvesData);
    const referenceBundle = buildRevisionReferenceBundle({
        curvesData,
        currentLxCurves: PhaseState.lxCurves || null,
        currentInterventions: oldIvs,
        bioCorrectionApplied:
            Array.isArray(MultiDayState.bioCorrectedBaseline) && MultiDayState.bioCorrectedBaseline.length > 0,
    });

    RevisionState.phase = 'pending';
    RevisionState.referenceBundle = referenceBundle;
    RevisionState.fitMetricsBefore = computeRevisionFitMetrics(
        referenceBundle.baselineCurves,
        referenceBundle.desiredCurves,
        referenceBundle.currentLxCurves,
    );
    RevisionState.fitMetricsAfter = null;
    delete (BiometricState as any)._pois;

    const revisionPromise = callRevisionModel(userGoal, referenceBundle).catch((err: any) => {
        console.error('[Revision] LLM error:', err.message);
        reportRuntimeBug({ stage: 'Grandmaster', provider: '', message: err.message });
        return null;
    });
    RevisionState.revisionPromise = revisionPromise;
    const revisionResult = await revisionPromise;
    RevisionState.revisionPromise = null;

    if (!revisionResult) {
        console.error('[Revision] No result from LLM.');
        reportRuntimeBug({
            stage: 'Grandmaster',
            provider: '',
            message: 'All providers exhausted — no revision result.',
        });
        RevisionState.phase = 'idle';
        return false;
    }

    RevisionState.revisionResult = revisionResult;

    const rawNew = extractInterventionsData(revisionResult);
    const newIvs = validateInterventions(rawNew, curvesData);
    const revisionScaleFactors = null;

    RevisionState.oldInterventions = oldIvs;
    RevisionState.newInterventions = newIvs;

    const diff = diffInterventions(oldIvs, newIvs);
    RevisionState.diff = diff;

    const newLxCurves = computeLxOverlay(newIvs, curvesData, revisionScaleFactors);
    RevisionState.newLxCurves = newLxCurves;
    const revisedReferenceBundle = buildRevisionReferenceBundle({
        curvesData,
        currentLxCurves: newLxCurves,
        currentInterventions: newIvs,
        bioCorrectionApplied: referenceBundle.bioCorrectionApplied,
    });
    RevisionState.fitMetricsAfter = computeRevisionFitMetrics(
        revisedReferenceBundle.baselineCurves,
        revisedReferenceBundle.desiredCurves,
        revisedReferenceBundle.currentLxCurves,
    );
    console.debug('[Revision] Fit metrics', {
        before: RevisionState.fitMetricsBefore,
        after: RevisionState.fitMetricsAfter,
    });

    if (TimelineState.engine) {
        TimelineState.engine.getContext()._revisedLxCurves = newLxCurves;
    }

    let sherlockRevPromise: Promise<any> | null = null;
    const narrationDiff = diff.filter((d: any) => d.type !== 'unchanged');
    if (SherlockState.enabled && narrationDiff.length > 0) {
        SherlockState.phase = 'loading';
        SherlockState.revisionNarrationResult = null;
        sherlockRevPromise = callSherlockRevisionModel(userGoal, oldIvs, newIvs, narrationDiff, curvesData).catch(
            err => {
                console.warn('[Sherlock] Revision narration failed:', err);
                reportRuntimeBug({ stage: 'Sherlock (Rev)', provider: '', message: err?.message || String(err) });
                return null;
            },
        );
    } else {
        SherlockState.phase = 'idle';
        SherlockState.revisionNarrationResult = null;
    }

    const rawRevisionNarration = await (sherlockRevPromise ?? Promise.resolve(null));
    const normalizedRevisionNarration = normalizeSherlockRevisionNarration(
        rawRevisionNarration,
        diff,
        SherlockState.enabled,
    );
    SherlockState.revisionNarrationResult = normalizedRevisionNarration.narration;
    SherlockState.phase = normalizedRevisionNarration.narration ? 'ready' : 'idle';

    if (SherlockState.enabled && diff.length > 0) {
        if (normalizedRevisionNarration.status === 'full-model') {
            console.log(
                `[Sherlock] Revision narration ready with full model coverage (${normalizedRevisionNarration.modelBeatCount}/${diff.length}).`,
            );
        } else if (normalizedRevisionNarration.status === 'partial-fallback') {
            console.warn(
                `[Sherlock] Revision narration partially repaired with fallback beats (${normalizedRevisionNarration.fallbackBeatCount}/${diff.length}).`,
            );
        } else if (normalizedRevisionNarration.status === 'full-fallback') {
            const reason = rawRevisionNarration ? 'payload unusable' : 'model unavailable';
            console.warn(`[Sherlock] Revision narration ${reason}; using fallback beats from diff.`);
        }
        console.log(
            '[Sherlock] resolved revision narration:',
            normalizedRevisionNarration.narration
                ? `status=${normalizedRevisionNarration.status}, beats=${normalizedRevisionNarration.narration.beats.length}, outro=${!!normalizedRevisionNarration.narration.outro}`
                : 'NULL',
        );
    }

    const poiContainer = document.getElementById('phase-poi-connectors');
    if (poiContainer) poiContainer.innerHTML = '';
    let pois: any[] = [];
    if (POI_ENABLED && diff.length > 0) {
        const timelineGroup = document.getElementById('phase-substance-timeline');
        if (timelineGroup && poiContainer) {
            const preRenderDiff = diff.map((d: any) => {
                if (!d.oldIv) return d;
                const merged = { ...d.oldIv };
                if (d.newIv?.bioTrigger) merged.bioTrigger = d.newIv.bioTrigger;
                return { ...d, newIv: merged, oldIv: d.oldIv };
            });

            pois = extractPointsOfInterest(preRenderDiff, BiometricState.channels, timelineGroup);
            if (pois.length > 0) {
                (BiometricState as any)._pois = pois;
                renderPointsOfInterest(pois, poiContainer as any, 'circuit');
                await animatePointsOfInterest(poiContainer as any, 1200);
            }
        }
    }

    RevisionState.phase = 'ready';
    return true;
}

async function applyPreparedRevisionPhase(curvesData: any): Promise<boolean> {
    if (
        !curvesData ||
        RevisionState.phase !== 'ready' ||
        !RevisionState.revisionResult ||
        !RevisionState.newInterventions ||
        !RevisionState.newLxCurves
    ) {
        return false;
    }

    RevisionState.phase = 'animating';

    const diff = RevisionState.diff || [];
    const newIvs = RevisionState.newInterventions;
    const newLxCurves = RevisionState.newLxCurves;
    const oldIvs = RevisionState.oldInterventions || [];
    const oldLxCurves = PhaseState.lxCurves || newLxCurves;
    const revisionScaleFactors = null;
    const oldIncrementalSnapshots =
        (PhaseState.incrementalSnapshots as LxSnapshot[] | null) ||
        computeIncrementalLxOverlay(oldIvs, curvesData, revisionScaleFactors);
    const newIncrementalSnapshots = computeIncrementalLxOverlay(newIvs, curvesData, revisionScaleFactors);
    const revisionNarration = SherlockState.revisionNarrationResult;
    const curveSnapshots = buildRevisionCurveSnapshots(oldIvs, diff, curvesData, revisionScaleFactors);
    const bandSnapshots = buildRevisionIncrementalSnapshots(oldIvs, diff, curvesData, revisionScaleFactors);
    const revisionBandRenderOrder = buildRevisionBandRenderOrder(
        buildRevisionBandState(oldIncrementalSnapshots, curvesData),
        buildRevisionBandState(newIncrementalSnapshots, curvesData),
        diff,
    );

    const revisionEngine = TimelineState.engine;
    const timelineOwner = revisionEngine;
    const revisionStartTime = revisionEngine?.getCurrentTime() ?? null;

    biometricRuntime.onRevisionPlayContext(revisionNarration);
    biometricRuntime.onRevisionPlay(diff as DiffEntry[]);
    const revisionEndTime = TimelineState.cursor;

    let revisionPlayheadRafId: number | null = null;
    if (revisionEngine && revisionStartTime != null && revisionEndTime > revisionStartTime) {
        const wallStart = performance.now();
        const revisionDuration = revisionEndTime - revisionStartTime;

        const trackRevisionPlayhead = () => {
            if (TimelineState.engine !== revisionEngine) return;
            const elapsed = performance.now() - wallStart;
            if (elapsed >= revisionDuration) {
                revisionEngine.advanceTimeTo(revisionEndTime);
                return;
            }
            revisionEngine.advanceTimeTo(revisionStartTime + elapsed);
            revisionPlayheadRafId = requestAnimationFrame(trackRevisionPlayhead);
        };

        revisionPlayheadRafId = requestAnimationFrame(trackRevisionPlayhead);
    }

    TimelineState.interactionLocked = true;

    try {
        await animateRevisionScan(diff, newIvs, newLxCurves, curvesData, revisionNarration, {
            morphLxStep: async (entry, entryIdx, durationMs) => {
                const fromCurves = entryIdx === 0 ? oldLxCurves : curveSnapshots[entryIdx - 1] || oldLxCurves;
                const toCurves = curveSnapshots[entryIdx] || fromCurves;
                const fromBands =
                    entryIdx === 0 ? oldIncrementalSnapshots : bandSnapshots[entryIdx - 1] || oldIncrementalSnapshots;
                const toBands = bandSnapshots[entryIdx] || fromBands;
                await morphLxCurvesToRevision(fromCurves, toCurves, curvesData, {
                    duration: durationMs,
                    updatePeakDescriptors: false,
                    fromIncrementalSnapshots: fromBands,
                    toIncrementalSnapshots: toBands,
                    revisionEntries: entry,
                    bandRenderOrder: revisionBandRenderOrder,
                });
            },
        });

        const chartSvg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
        if (chartSvg) {
            const vbParts = (chartSvg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
            const currentH = vbParts.length === 4 && Number.isFinite(vbParts[3]) ? vbParts[3] : 500;
            animatePhaseChartViewBoxHeight(chartSvg, currentH, 0);
        }

        await morphLxCurvesToRevision(newLxCurves, newLxCurves, curvesData, {
            duration: 0,
            fromIncrementalSnapshots: oldIncrementalSnapshots,
            toIncrementalSnapshots: newIncrementalSnapshots,
            revisionEntries: diff,
            bandRenderOrder: revisionBandRenderOrder,
        });

        if (BiometricState.spotterHighlights.length > 0) {
            updateSpotterHighlightConnectors(BiometricState.channels);
        }

        const poiContainer = document.getElementById('phase-poi-connectors');
        const timelineGroup = document.getElementById('phase-substance-timeline');
        const pois = (BiometricState as any)._pois || [];
        if (POI_ENABLED && pois.length > 0 && poiContainer && timelineGroup) {
            updatePoiConnectorPillEndpoints(pois, poiContainer as any, timelineGroup, 'circuit');
        }

        if (revisionPlayheadRafId != null) {
            cancelAnimationFrame(revisionPlayheadRafId);
            revisionPlayheadRafId = null;
        }
        TimelineState.engine?.advanceTimeTo(TimelineState.cursor);

        PhaseState.lxCurves = newLxCurves;
        PhaseState.interventionResult = RevisionState.revisionResult;
        PhaseState.incrementalSnapshots = newIncrementalSnapshots;
        recordRevisionReplayState({
            interventionResult: PhaseState.interventionResult,
            lxCurves: PhaseState.lxCurves,
            incrementalSnapshots: PhaseState.incrementalSnapshots,
        });

        RevisionState.phase = 'rendered';
        PhaseState.phase = 'revision-rendered';
        PhaseState.maxPhaseReached = 4;
        PhaseState.viewingPhase = 4;
        LLMCache.markFlowComplete();

        showWeekSequenceButton();
        showNarrationPanel(); // Keep revision narration visible until user clicks Stream

        return true;
    } finally {
        if (revisionPlayheadRafId != null) {
            cancelAnimationFrame(revisionPlayheadRafId);
        }
        if (!timelineOwner || TimelineState.engine === timelineOwner) {
            TimelineState.interactionLocked = false;
        }
    }
}

// ============================================
// 24-Hour Simulation — Phase 5
// ============================================

const SIM_DURATION_BASE = 12000; // 12 seconds at 1x speed
const MULTI_DAY_DAY0_PREVIEW_MS = 900;

function getVisibleWeekStartIndex(days: { day: number }[]): number {
    return 0;
}

/**
 * Show the "Apply Biometrics" button using canon VCR layout.
 * Play button circle = red bio color, right wing = "Apply Biometrics".
 */
export function showSimulationButton() {
    configureVcrCanonAction({
        label: 'Apply Biometrics',
        icon: ICON_PLAY,
        playClass: 'vcr-play-bio',
        onClick: async () => {
            // Switch to loading state
            configureVcrCanonAction({
                label: 'Applying biometrics…',
                icon: '',
                loading: true,
            });

            try {
                const userGoal = PhaseState.userGoal || '';
                const curvesData = PhaseState.curvesData;

                // Fire Strategist Bio LLM
                const strategistBioPromise = curvesData
                    ? callStrategistBioModel(userGoal, curvesData).catch(err => {
                          console.warn('[StrategistBio] Failed:', err.message);
                          reportRuntimeBug({ stage: 'Strategist Bio', provider: '', message: err.message });
                          return null;
                      })
                    : null;

                // Bio-correction morphs baseline + Lx curves
                await sleep(400);
                await handleBioCorrectionPhase(curvesData, userGoal, strategistBioPromise, biometricRuntime);
            } catch (err: any) {
                console.error('[ApplyBiometrics] Pipeline error:', err.message, err.stack);
                reportRuntimeBug({ stage: 'Strategist Bio', provider: '', message: err.message });
            }

            // Show "Optimize" button
            showOptimizeButton();
        },
    });
}

/**
 * Show the "Optimize" button using canon VCR layout.
 * Play button circle = optimize blue, right wing = "Optimize".
 */
function showOptimizeButton() {
    configureVcrCanonAction({
        label: 'Compute',
        icon: ICON_OPTIMIZE,
        playClass: 'vcr-play-optimize',
        onClick: async () => {
            // Switch to loading state
            configureVcrCanonAction({
                label: 'Computing interventions…',
                icon: '',
                loading: true,
            });

            try {
                const curvesData = PhaseState.curvesData;
                const prepared = await handleRevisionPhase(curvesData);
                if (!prepared) {
                    showOptimizeButton();
                    return;
                }
            } catch (err: any) {
                console.error('[Optimize] Revision pipeline error:', err.message, err.stack);
                reportRuntimeBug({ stage: 'Grandmaster', provider: '', message: err.message });
                showOptimizeButton();
                return;
            }

            showReviseButton();
        },
    });
}

function showReviseButton() {
    configureVcrCanonAction({
        label: 'Execute',
        icon: ICON_PLAY,
        playClass: 'vcr-play-revise',
        completesPhase: 4,
        onClick: async () => {
            configureVcrCanonAction({
                label: 'Executing…',
                icon: '',
                loading: true,
            });

            let applied = false;
            try {
                applied = await applyPreparedRevisionPhase(PhaseState.curvesData);
            } catch (err: any) {
                console.error('[Revise] Revision apply error:', err.message, err.stack);
                reportRuntimeBug({ stage: 'Grandmaster', provider: '', message: err.message });
            }

            if (!applied) {
                if (RevisionState.phase === 'ready') {
                    showReviseButton();
                } else {
                    showOptimizeButton();
                }
                return;
            }

            console.log('[Debug] Pipeline complete through Phase 4 (revision). Multi-day disabled for now.');
        },
    });
}

// ============================================
// Multi-Day Iteration — Day 0-7 weekly cycle
// ============================================

/**
 * Show the "Lx" button on the VCR panel after revision completes.
 * Uses VCR canon layout (centered play circle + right wing label)
 * to stay consistent with every other VCR phase gate.
 */
export function showWeekSequenceButton() {
    configureVcrCanonAction({
        label: 'Stream',
        icon: ICON_LX,
        playClass: 'vcr-play-stream',
        completesPhase: 5,
        onClick: async () => {
            hideNarrationPanel(); // Clean up revision narration before multi-day
            configureVcrCanonAction({
                label: 'Preparing Days',
                icon: '',
                loading: true,
            });
            await launchMultiDayPipeline();
            // Only show debug-ends / continue to Phase 6 if the multi-day pipeline
            // actually completed. When the user scrubs and restarts playback,
            // playMultiDaySequence gets cancelled and returns early — in that case
            // phase will be 'playing' (the new sequence is running), not 'complete'.
            const phase = MultiDayState.phase;
            if (phase === 'playing' || phase === 'paused') return;
            showDebugEndsHere();
            // Turbo: auto-fire eject → delivery → camera if target is phase 6
            // (configureVcrCanonAction handles the auto-fire of THIS onClick;
            //  we just need to chain Phase 6 here when it completes)
            if (isTurboActive()) {
                const panel = _vcrPanel ?? (document.querySelector('.vcr-control-panel') as HTMLElement | null);
                if (panel) {
                    _ejectActivated = true;
                    // 1st press: radial wrap
                    await runEjectAnimation(panel);
                    // 2nd press: delivery sequence
                    await runEjectAnimation(panel);
                    // 3rd press: camera + tracker
                    await runEjectAnimation(panel);
                    AppState.turboTargetPhase = 0;
                }
            }
        },
    });
    // Turbo auto-fire is handled by configureVcrCanonAction
}

/**
 * Show "Debug Ends Here" placeholder on the VCR panel after 7D loop exits.
 * Also reveals the save-cycle checkmark since the full cycle is now complete.
 */
function showDebugEndsHere() {
    upsertVcrActionButton('debug-ends-here-btn', 'Debug Ends Here', '', 'vcr-action-debug-end', () => {
        /* future: substance loading hook */
    });
    // Reveal save-cycle checkmark — full cycle (including 7D) is complete
    const saveBtn = document.getElementById('cycle-save-btn');
    if (saveBtn && !saveBtn.classList.contains('saved')) {
        saveBtn.style.display = '';
    }
}

/**
 * Show the multi-day button alongside the simulation button after revision completes.
 */
function showMultiDayButton() {
    upsertVcrActionButton(
        'multi-day-btn',
        'Multi-Day',
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        'vcr-action-multi-day',
        async () => {
            hideMultiDayButton();
            await launchMultiDayPipeline();
        },
    );
}

/**
 * Hide the multi-day button.
 */
function hideMultiDayButton() {
    removeVcrActionButton('multi-day-btn');
}

/**
 * Launch the multi-day pipeline: loading → week orchestrator → daily sims → animation.
 */
async function launchMultiDayPipeline() {
    // Preload both 3D device model variants in background (needed for eject animation)
    import('./lx-player-3d')
        .then(m => {
            m.preloadLxPlayerModel('v1');
            m.preloadLxPlayerModel('v2');
        })
        .catch(() => {});

    const curvesData = PhaseState.curvesData;
    if (!curvesData) {
        console.error('[MultiDay] No curvesData available');
        return;
    }

    // Use revised interventions if available, else original
    const interventions = RevisionState.newInterventions || PhaseState.interventionResult?.interventions || [];

    // Configure VCR pill for multi-day stepper (shows loading state).
    mountMultiDayRibbonModule();

    // Hide the timeline-ribbon while multi-day is active
    const timelineRibbon = document.getElementById('timeline-ribbon');
    if (timelineRibbon) timelineRibbon.classList.remove('visible');

    MultiDayState.phase = 'loading';
    PhaseState.phase = 'week-loading';

    try {
        const replaySnapshot = isRuntimeReplayActive() ? getRuntimeReplaySnapshot() : null;
        const replayDays = replaySnapshot?.week?.days;

        // Run the full week pipeline unless we have an exact saved snapshot to replay.
        const allDays =
            replayDays && replayDays.length > 0
                ? replayDays
                : await runWeekPipeline(curvesData, interventions, msg => {
                      console.log('[MultiDay]', msg);
                  });

        // Trim to 7 days (Mon-Sun). The pipeline produces Day 0 (baseline Monday)
        // + Days 1-7 from the LLM = 8 total, but Day 7 wraps back to Monday.
        // Keep only days 0-6 for a clean Mon→Sun week.
        const days = allDays.length > 7 ? allDays.slice(0, 7) : allDays;

        if (days.length < 2) {
            console.warn('[MultiDay] Not enough day snapshots:', days.length);
            MultiDayState.phase = 'idle';
            hideWeekStrip();
            deactivateMultiDayRibbonModule();
            showSimulationButton();
            return;
        }

        // Store days
        MultiDayState.days = days;
        const initialDayIdx = getVisibleWeekStartIndex(days);
        const initialDay = days[initialDayIdx];
        MultiDayState.currentDay = initialDay.day;
        recordWeekReplayState(days);

        // Fire Sherlock 7D narration in background (non-blocking)
        const sherlock7dPromise = SherlockState.enabled
            ? callSherlock7D(days, PhaseState.userGoal || '').catch(err => {
                  console.warn('[Sherlock7D] Narration failed, using fallback:', err.message);
                  return null;
              })
            : Promise.resolve(null);

        // Lock viewBox height to the max envelope so the chart never rescales.
        // Bio strip translation is handled per-frame by animateDayTransition.
        let maxLanes = 0;
        for (const day of days) {
            if (day.interventions && day.interventions.length > 0) {
                const alloc = allocateTimelineLanes(day.interventions);
                const lc = alloc.reduce((max: number, a: any) => Math.max(max, a.laneIdx + 1), 0);
                maxLanes = Math.max(maxLanes, lc);
            }
        }
        MultiDayState.maxTimelineLanes = maxLanes;

        const svg = document.getElementById('phase-chart-svg');
        const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
        const initialDayAlloc = allocateTimelineLanes(initialDay.interventions || []);
        const initialDayLanes = initialDayAlloc.reduce((mx: number, a: any) => Math.max(mx, (a.laneIdx || 0) + 1), 0);

        // Compute day 0's lane count
        const day0Alloc = allocateTimelineLanes(days[0].interventions || []);
        const day0Lanes = day0Alloc.reduce((mx: number, a: any) => Math.max(mx, (a.laneIdx || 0) + 1), 0);

        // Reposition bio strips to sit right below day 0's actual lanes,
        // eliminating dead space from Phase 4's (possibly larger) lane count.
        const bioGroup = document.getElementById('phase-biometric-strips');
        const spotterGroup = document.getElementById('phase-spotter-highlights');

        // Ensure bio strips are visible — previous animations (compile, revision)
        // may have left them hidden via inline styles
        if (bioGroup) {
            bioGroup.style.opacity = '';
            bioGroup.style.visibility = '';
            (bioGroup.style as any).pointerEvents = '';
            bioGroup.removeAttribute('opacity');
        }
        if (spotterGroup) {
            spotterGroup.style.opacity = '';
            spotterGroup.style.visibility = '';
            (spotterGroup.style as any).pointerEvents = '';
            spotterGroup.removeAttribute('opacity');
        }

        // If bio strips were cleared (e.g. by timeline engine exit), re-render them
        if (
            bioGroup &&
            bioGroup.children.length === 0 &&
            BiometricState.channels &&
            BiometricState.channels.length > 0
        ) {
            renderBiometricStrips(BiometricState.channels, true);
        }

        const bioSep = bioGroup?.querySelector('.biometric-separator');
        let bioZoneH = 0;
        let baseBioTY = 0;
        if (bioGroup && bioSep) {
            const bb = (bioGroup as unknown as SVGGraphicsElement).getBBox();
            bioZoneH = bb.height;
            const currentBioSepY = parseFloat(bioSep.getAttribute('y1') || '0');
            const contentAboveSep = Math.max(0, currentBioSepY - bb.y);
            const targetBioSepY = TIMELINE_ZONE.top + day0Lanes * laneStep + TIMELINE_ZONE.bottomPad + contentAboveSep;
            baseBioTY = targetBioSepY - currentBioSepY;
            MultiDayState.bioBaseTranslateY = baseBioTY;
        }

        // Lock viewBox based on day 0's lane count (not maxLanes).
        // The viewBox will dynamically adjust per-day during transitions via _interpolateFrame,
        // so we don't need the max envelope — this eliminates dead space on days with fewer lanes.
        const day0LanesBottom = TIMELINE_ZONE.top + day0Lanes * laneStep + TIMELINE_ZONE.bottomPad;
        MultiDayState.lockedViewBoxHeight = Math.max(day0LanesBottom + bioZoneH + BIOMETRIC_ZONE.bottomPad, 500);

        // Pipeline complete — mark Phase 5 reached and reveal save checkmark immediately
        PhaseState.maxPhaseReached = 5;
        PhaseState.viewingPhase = 5;
        const saveBtn = document.getElementById('cycle-save-btn');
        if (saveBtn && !saveBtn.classList.contains('saved')) {
            saveBtn.style.display = '';
        }

        // Render the first visible computed day and build the week strip BEFORE
        // the viewBox animation.
        // This way the substance pills, curves, and week strip change once, and the
        // viewBox resize smoothly adapts around the already-changed content instead of
        // popping everything in a single frame after the resize completes.
        renderDayState(initialDay, curvesData);
        buildWeekStrip(days.length);
        updateWeekStripDay(initialDay.day, days.length);
        setupWeekStripDrag();
        activateMultiDayVcrStepper();

        const initialLaneDelta = (initialDayLanes - day0Lanes) * laneStep;
        const targetBioTY = baseBioTY + initialLaneDelta;
        const targetViewBoxHeight = MultiDayState.lockedViewBoxHeight + initialLaneDelta;

        // Smoothly animate viewBox height and bio group repositioning
        if (svg) {
            const currentVB = svg.getAttribute('viewBox')!.split(' ').map(Number);
            const fromH = currentVB[3];
            const toH = targetViewBoxHeight;

            // Read current bio group translate
            let fromBioTY = 0;
            if (bioGroup) {
                const m = (bioGroup.getAttribute('transform') || '').match(
                    /translate\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)\s*\)/,
                );
                fromBioTY = m ? parseFloat(m[1]) || 0 : 0;
            }

            const transitionMs = isTurboActive() ? 0 : 500;
            await new Promise<void>(resolve => {
                if (transitionMs <= 0) {
                    // Turbo: skip animation — set final values immediately
                    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${toH}`);
                    if (bioGroup) {
                        bioGroup.setAttribute('transform', `translate(0,${targetBioTY.toFixed(2)})`);
                        if (spotterGroup) {
                            spotterGroup.setAttribute('transform', `translate(0,${targetBioTY.toFixed(2)})`);
                        }
                    }
                    resolve();
                    return;
                }
                const startT = performance.now();
                (function tick(now: number) {
                    const elapsed = now - startT;
                    const rawT = Math.min(1, elapsed / transitionMs);
                    // Ease-out cubic for a smooth deceleration
                    const t = 1 - Math.pow(1 - rawT, 3);

                    const h = fromH + (toH - fromH) * t;
                    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${h.toFixed(1)}`);

                    if (bioGroup) {
                        const bioY = fromBioTY + (targetBioTY - fromBioTY) * t;
                        bioGroup.setAttribute('transform', `translate(0,${bioY.toFixed(2)})`);
                        if (spotterGroup) {
                            spotterGroup.setAttribute('transform', `translate(0,${bioY.toFixed(2)})`);
                        }
                    }

                    if (rawT < 1) {
                        requestAnimationFrame(tick);
                    } else {
                        // Ensure final values are exact
                        svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${toH}`);
                        if (bioGroup) {
                            bioGroup.setAttribute('transform', `translate(0,${targetBioTY.toFixed(2)})`);
                            if (spotterGroup) {
                                spotterGroup.setAttribute('transform', `translate(0,${targetBioTY.toFixed(2)})`);
                            }
                        }
                        resolve();
                    }
                })(performance.now());
            });
        }

        // Resolve Sherlock 7D narration (should be done by now — ran in parallel with viewBox animation)
        const sherlock7dResult = await sherlock7dPromise;
        if (sherlock7dResult) {
            const normalized = normalizeSherlock7DNarration(sherlock7dResult, days, SherlockState.enabled);
            SherlockState.sherlock7dNarration = normalized.narration;
        } else if (SherlockState.enabled) {
            SherlockState.sherlock7dNarration = buildFallbackSherlock7D(days);
        }
        MultiDayState.sherlock7dReady = true;

        // Show Sherlock 7D panel with Day 0 card before playback begins
        if (SherlockState.sherlock7dNarration && SherlockState.sherlock7dNarration.beats.length > 0) {
            showSherlock7DStack(SherlockState.sherlock7dNarration.beats, 0);
            showNarrationPanel();
        }

        // Set scrub sync callback for Sherlock 7D
        MultiDayState.onSherlock7DSync = (dayNumber: number) => {
            if (SherlockState.sherlock7dNarration && SherlockState.sherlock7dNarration.beats.length > 0) {
                // Map day number to beat index (beats are for days 1-7, index 0-6)
                const beatIdx = Math.max(0, dayNumber - 1);
                showSherlock7DStack(SherlockState.sherlock7dNarration.beats, beatIdx);
                // Enable scrolling only when animation is paused/idle (not during playback)
                if (MultiDayState.phase !== 'playing') {
                    enableSherlockScrollMode();
                }
            }
        };

        // Set the day-advance callback so playback animates VCR labels
        MultiDayState.onDayAdvance = onMultiDayAdvance;

        // Hold on the initial visible day briefly before auto-play. Without this preview beat,
        // the initial week render and the first transition visually
        // collapse into a single "pop" when Stream is clicked.
        if (!isTurboActive()) {
            await sleep(MULTI_DAY_DAY0_PREVIEW_MS);
        }

        // Begin auto-play (loops until paused)
        await playMultiDaySequence(days, curvesData);

        // Playback paused/complete — update VCR state and enable Sherlock scrolling
        updateMultiDayVcrNav();
        enableSherlockScrollMode();
        updateMultiDayLabelsStatic();
    } catch (err: any) {
        console.error('[MultiDay] Pipeline error:', err.message);
        reportRuntimeBug({ stage: 'Multi-Day', provider: '', message: err.message });
        MultiDayState.phase = 'idle';
        MultiDayState.lockedViewBoxHeight = null;
        MultiDayState.maxTimelineLanes = 0;
        MultiDayState.bioBaseTranslateY = 0;
        hideWeekStrip();
        deactivateMultiDayRibbonModule();
        // Restore buttons (multi-day disabled)
        showSimulationButton();
    }
}

/**
 * Build simulation schedule: pre-compute all events in chronological order.
 */
function buildSimulationSchedule(): any[] {
    const diff = RevisionState.diff || [];
    const pois = (BiometricState as any)._pois || [];
    const events: any[] = [];

    // Pill events from diff (these trigger actual animations: move, resize, etc.)
    const diffKeys = new Set<string>();
    for (const d of diff) {
        const iv = d.newIv || d.oldIv;
        if (!iv) continue;
        const hour = (iv.timeMinutes || 0) / 60;
        diffKeys.add(`${iv.key}@${iv.timeMinutes}`);
        events.push({
            hour,
            type: `pill-${d.type}`, // pill-moved, pill-resized, pill-replaced, pill-removed, pill-added
            diff: d,
            fired: false,
        });
    }

    // Flash events for ALL current interventions (even ones NOT in the diff)
    // This ensures every pill lights up when the scan reaches it
    const currentIvs = RevisionState.newInterventions || extractInterventionsData(PhaseState.interventionResult);
    for (const iv of currentIvs) {
        if (!iv || !iv.key) continue;
        const tag = `${iv.key}@${iv.timeMinutes}`;
        if (diffKeys.has(tag)) continue; // already has a diff event
        const hour = (iv.timeMinutes || 0) / 60;
        events.push({
            hour,
            type: 'pill-flash',
            iv,
            fired: false,
        });
    }

    // POI pulse events
    for (const poi of pois) {
        events.push({
            hour: poi.bioHour,
            type: 'poi-pulse',
            poi,
            fired: false,
        });
    }

    // Sort chronologically
    events.sort((a: any, b: any) => a.hour - b.hour);
    return events;
}

/**
 * Create or update the unified simulation scan line.
 */
function updateSimScanLine(svgX: number, svgHeight: number) {
    const group = document.getElementById('phase-sim-scan-line');
    if (!group) return;

    let rect = group.querySelector('#sim-scan-rect') as SVGElement;
    let glow = group.querySelector('#sim-scan-glow') as SVGElement;

    if (!rect) {
        rect = svgEl('rect', {
            id: 'sim-scan-rect',
            x: '0',
            y: String(PHASE_CHART.padT),
            width: '2',
            height: String(svgHeight - PHASE_CHART.padT),
            fill: 'url(#sim-scan-line-grad)',
            opacity: '0.8',
            'pointer-events': 'none',
        });
        group.appendChild(rect);
    }
    if (!glow) {
        glow = svgEl('rect', {
            id: 'sim-scan-glow',
            x: '0',
            y: String(PHASE_CHART.padT),
            width: '16',
            height: String(svgHeight - PHASE_CHART.padT),
            fill: 'url(#sim-scan-line-grad)',
            opacity: '0.08',
            'pointer-events': 'none',
        });
        group.appendChild(glow);
    }

    rect.setAttribute('x', String(svgX - 1));
    rect.setAttribute('height', String(svgHeight - PHASE_CHART.padT));
    glow.setAttribute('x', String(svgX - 8));
    glow.setAttribute('height', String(svgHeight - PHASE_CHART.padT));
}

/**
 * Clear the simulation scan line.
 */
function clearSimScanLine() {
    const group = document.getElementById('phase-sim-scan-line');
    if (group) {
        while (group.firstChild) group.removeChild(group.firstChild);
    }
}

/**
 * Flash a POI connector group when the scan line passes it.
 */
function flashPoiConnector(poi: any) {
    const container = document.getElementById('phase-poi-connectors');
    if (!container) return;

    // Find the connector group at this POI position
    const groups = container.querySelectorAll('.poi-connector-group');
    for (const g of Array.from(groups)) {
        const dot = g.querySelector('.poi-dot');
        if (!dot) continue;
        const cx = parseFloat(dot.getAttribute('cx') || '0');
        const cy = parseFloat(dot.getAttribute('cy') || '0');
        if (Math.abs(cx - poi.bioSvgX) < 5 && Math.abs(cy - poi.bioSvgY) < 5) {
            // Flash: temporarily boost opacity
            const line = g.querySelector('path');
            if (line) {
                const origOpacity = line.getAttribute('stroke-opacity') || '0.45';
                line.setAttribute('stroke-opacity', '0.9');
                line.setAttribute('stroke-width', '2');
                setTimeout(() => {
                    line.setAttribute('stroke-opacity', origOpacity);
                    line.setAttribute('stroke-width', '1.5');
                }, 300);
            }
            break;
        }
    }
}

/**
 * Find a pill element by substance key and optional time.
 */
function findPillByKey(key: string, timeMinutes?: number): SVGElement | null {
    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (!timelineGroup) return null;
    const pills = timelineGroup.querySelectorAll('.timeline-pill-group');
    for (const pill of Array.from(pills)) {
        const pk = pill.getAttribute('data-substance-key');
        if (pk === key) {
            if (timeMinutes != null) {
                const pt = parseFloat(pill.getAttribute('data-time-minutes') || '0');
                if (Math.abs(pt - timeMinutes) < 30) return pill as SVGElement;
            } else {
                return pill as SVGElement;
            }
        }
    }
    return null;
}

/**
 * Smoothly animate an SVG element's rect attributes over a duration.
 */
function animatePillRect(
    pill: SVGElement,
    fromX: number,
    toX: number,
    fromW: number,
    toW: number,
    duration: number = 600,
): void {
    const rect = pill.querySelector('rect');
    const label = pill.querySelector('text');
    if (!rect) return;

    const startTime = performance.now();
    const fromLabelX = fromX + 5;
    const toLabelX = toX + 5;

    const tick = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        // Ease out cubic
        const e = 1 - Math.pow(1 - t, 3);
        const curX = fromX + (toX - fromX) * e;
        const curW = fromW + (toW - fromW) * e;
        rect.setAttribute('x', curX.toFixed(1));
        rect.setAttribute('width', curW.toFixed(1));
        if (label) {
            label.setAttribute('x', (fromLabelX + (toLabelX - fromLabelX) * e).toFixed(1));
        }
        if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/**
 * Animate a pill pop-in with scale effect.
 */
function animatePillPopIn(pill: SVGElement, duration: number = 400): void {
    const rect = pill.querySelector('rect');
    if (!rect) return;

    const finalW = parseFloat(rect.getAttribute('width') || '0');
    const x = parseFloat(rect.getAttribute('x') || '0');
    const centerX = x + finalW / 2;

    pill.setAttribute('opacity', '0');

    const startTime = performance.now();
    const tick = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        // Elastic ease out
        const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
        const scale = e;
        const curW = finalW * scale;
        const curX = centerX - curW / 2;
        rect.setAttribute('x', curX.toFixed(1));
        rect.setAttribute('width', curW.toFixed(1));
        pill.setAttribute('opacity', String(Math.min(1, t * 2)));
        if (t < 1) requestAnimationFrame(tick);
        else {
            rect.setAttribute('x', x.toFixed(1));
            rect.setAttribute('width', finalW.toFixed(1));
            pill.setAttribute('opacity', '1');
        }
    };
    requestAnimationFrame(tick);
}

/**
 * Animate a pill fade out.
 */
function animatePillFadeOut(pill: SVGElement, duration: number = 400): void {
    const startTime = performance.now();
    const tick = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        pill.setAttribute('opacity', String(1 - t));
        if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/**
 * Animate a pill crossfade (replacement): old fades + shrinks, new fades in + grows.
 */
function animatePillCrossfade(oldPill: SVGElement, newPill: SVGElement, duration: number = 600): void {
    newPill.setAttribute('opacity', '0');
    const startTime = performance.now();
    const tick = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        oldPill.setAttribute('opacity', String(Math.max(0, 1 - t * 1.5)));
        newPill.setAttribute('opacity', String(Math.min(1, t * 1.5)));
        if (t < 1) requestAnimationFrame(tick);
        else {
            oldPill.setAttribute('opacity', '0');
            newPill.setAttribute('opacity', '1');
        }
    };
    requestAnimationFrame(tick);
}

/**
 * Prepare pills for simulation: move diff'd pills to pre-revision positions.
 * Returns a cleanup function to restore everything.
 */
function prepareSimulationPills(diff: any[]): () => void {
    const restoreOps: (() => void)[] = [];
    console.log(
        '[DBG-SIM] prepareSimulationPills: diff entries:',
        diff.length,
        diff.map(d => `${d.type}:${(d.newIv || d.oldIv)?.key}`),
    );

    for (const d of diff) {
        const newKey = d.newIv?.key;
        const newTime = d.newIv?.timeMinutes;
        const oldKey = d.oldIv?.key;

        if (d.type === 'moved' && d.oldIv && d.newIv) {
            // Move pill back to old position
            const pill = findPillByKey(newKey, newTime);
            if (!pill) {
                console.log('[DBG-SIM] moved: pill not found for', newKey, '@', newTime);
                continue;
            }
            const rect = pill.querySelector('rect');
            const label = pill.querySelector('text');
            if (!rect) continue;
            // Save current (revised) position
            const revisedX = rect.getAttribute('x') || '0';
            const revisedW = rect.getAttribute('width') || '0';
            const revisedLabelX = label?.getAttribute('x') || '0';
            // Compute old position
            const oldX = phaseChartX(d.oldIv.timeMinutes);
            const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
            const oldW = Math.min(computeDoseBarWidth(d.oldIv), plotRight - oldX);
            rect.setAttribute('x', oldX.toFixed(1));
            rect.setAttribute('width', oldW.toFixed(1));
            if (label) label.setAttribute('x', (oldX + 5).toFixed(1));

            // Store info for animation
            (d as any)._simOldX = oldX;
            (d as any)._simOldW = oldW;
            (d as any)._simNewX = parseFloat(revisedX);
            (d as any)._simNewW = parseFloat(revisedW);
            (d as any)._simPill = pill;

            restoreOps.push(() => {
                rect.setAttribute('x', revisedX);
                rect.setAttribute('width', revisedW);
                if (label) label.setAttribute('x', revisedLabelX);
            });
        } else if (d.type === 'resized' && d.oldIv && d.newIv) {
            // Resize pill back to old width
            const pill = findPillByKey(newKey, newTime);
            if (!pill) {
                console.log('[DBG-SIM] resized: pill not found for', newKey, '@', newTime);
                continue;
            }
            const rect = pill.querySelector('rect');
            if (!rect) continue;
            const revisedW = rect.getAttribute('width') || '0';
            const oldX = phaseChartX(d.oldIv.timeMinutes);
            const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
            const oldW = Math.min(computeDoseBarWidth(d.oldIv), plotRight - oldX);
            const curX = parseFloat(rect.getAttribute('x') || '0');
            rect.setAttribute('width', oldW.toFixed(1));

            (d as any)._simOldX = curX;
            (d as any)._simOldW = oldW;
            (d as any)._simNewX = curX;
            (d as any)._simNewW = parseFloat(revisedW);
            (d as any)._simPill = pill;

            restoreOps.push(() => {
                rect.setAttribute('width', revisedW);
            });
        } else if (d.type === 'added' && d.newIv) {
            // Hide added pills until scan reaches them
            const pill = findPillByKey(newKey, newTime);
            if (!pill) {
                console.log('[DBG-SIM] added: pill not found for', newKey, '@', newTime);
                continue;
            }
            const origOpacity = pill.getAttribute('opacity') || '1';
            pill.setAttribute('opacity', '0');
            (d as any)._simPill = pill;
            restoreOps.push(() => pill.setAttribute('opacity', origOpacity));
        } else if (d.type === 'removed' && d.oldIv) {
            // For removed pills, we'd need to temporarily re-create them.
            // Since renderSubstanceTimeline already removed them, just mark for gold flash.
            (d as any)._simPill = null;
        } else if (d.type === 'replaced' && d.oldIv && d.newIv) {
            // For replacement: the new pill is in the timeline, but we want to show
            // the old one first and crossfade. Since the old one is gone, just hide
            // the new one and pop it in when scan arrives.
            const pill = findPillByKey(newKey, newTime);
            if (!pill) {
                console.log('[DBG-SIM] replaced: pill not found for', newKey, '@', newTime);
                continue;
            }
            const origOpacity = pill.getAttribute('opacity') || '1';
            pill.setAttribute('opacity', '0');
            (d as any)._simPill = pill;
            restoreOps.push(() => pill.setAttribute('opacity', origOpacity));
        }
    }

    return () => restoreOps.forEach(fn => fn());
}

/**
 * Flash a pill with a gold stroke highlight.
 */
function flashPillGold(pill: SVGElement, duration: number = 500): void {
    const rect = pill.querySelector('rect');
    if (!rect) return;
    const origStroke = rect.getAttribute('stroke') || '';
    const origStrokeW = rect.getAttribute('stroke-width') || '0.75';
    rect.setAttribute('stroke', 'rgba(245,200,80,0.8)');
    rect.setAttribute('stroke-width', '2');
    setTimeout(() => {
        rect.setAttribute('stroke', origStroke);
        rect.setAttribute('stroke-width', origStrokeW);
    }, duration);
}

/**
 * Animate a pill element for a simulation event.
 */
function animateSimPillEvent(event: any) {
    // Handle "pill-flash" events (no diff, just a pill highlight)
    if (event.type === 'pill-flash') {
        const iv = event.iv;
        if (!iv) return;
        const pill = findPillByKey(iv.key, iv.timeMinutes);
        if (pill) flashPillGold(pill, 500);
        return;
    }

    const d = event.diff;
    if (!d) return;

    const pill = (d as any)._simPill as SVGElement | null;
    if (!pill && d.type !== 'removed') return;

    switch (d.type) {
        case 'moved':
            if (pill) {
                flashPillGold(pill, 700);
                animatePillRect(
                    pill,
                    (d as any)._simOldX,
                    (d as any)._simNewX,
                    (d as any)._simOldW,
                    (d as any)._simNewW,
                    600,
                );
            }
            break;
        case 'resized':
            if (pill) {
                flashPillGold(pill, 700);
                animatePillRect(
                    pill,
                    (d as any)._simOldX,
                    (d as any)._simNewX,
                    (d as any)._simOldW,
                    (d as any)._simNewW,
                    600,
                );
            }
            break;
        case 'added':
            if (pill) {
                animatePillPopIn(pill, 400);
            }
            break;
        case 'removed':
            // The pill was already removed by renderSubstanceTimeline.
            break;
        case 'replaced':
            if (pill) {
                animatePillPopIn(pill, 500);
            }
            break;
    }
}

/**
 * Start the 24-hour simulation.
 */
async function startSimulation(): Promise<void> {
    const schedule = buildSimulationSchedule();
    SimulationState.schedule = schedule;
    SimulationState.phase = 'running';
    SimulationState.progress = 0;

    // Get SVG dimensions
    const svg = document.getElementById('phase-chart-svg');
    const svgHeight = svg ? parseFloat(svg.getAttribute('viewBox')?.split(' ')[3] || '500') : 500;
    const defs = svg?.querySelector('defs');

    // Create fresh clip-paths for biometric strips (the initial reveal removes them)
    const bioStrips = document.getElementById('phase-biometric-strips');
    const clipRects: SVGElement[] = [];
    if (bioStrips && defs) {
        const stripGroups = bioStrips.querySelectorAll('g.bio-strip-group, g[data-channel]');
        const targets =
            stripGroups.length > 0
                ? Array.from(stripGroups)
                : Array.from(bioStrips.children).filter(c => c.tagName === 'g' && !c.id);

        targets.forEach((sg, i) => {
            const bbox = (sg as SVGGraphicsElement).getBBox?.();
            if (!bbox || bbox.width === 0) return;

            const clipId = `sim-bio-clip-${i}`;
            // Remove any stale clip with same id
            defs.querySelector(`#${clipId}`)?.remove();

            const clipPath = svgEl('clipPath', { id: clipId });
            const clipRect = svgEl('rect', {
                x: String(bbox.x),
                y: String(bbox.y - 2),
                width: '0',
                height: String(bbox.height + 4),
            });
            clipPath.appendChild(clipRect);
            defs.appendChild(clipPath);
            (sg as SVGElement).setAttribute('clip-path', `url(#${clipId})`);
            clipRects.push(clipRect);
        });
    }

    // Prepare pills: move diff'd pills to pre-revision positions
    const diff = RevisionState.diff || [];
    const restoreSimPills = prepareSimulationPills(diff);

    // Also hide POI connectors initially, reveal as scan passes
    const poiContainer = document.getElementById('phase-poi-connectors');
    const poiGroups = poiContainer ? Array.from(poiContainer.querySelectorAll('.poi-connector-group')) : [];
    poiGroups.forEach(g => (g as SVGElement).setAttribute('opacity', '0'));

    const startHour = 6;
    const endHour = 30;
    const totalHours = endHour - startHour;
    const duration = SIM_DURATION_BASE / SimulationState.speed;

    const startTime = performance.now();
    let scheduleIdx = 0;

    const tick = () => {
        if (SimulationState.phase !== 'running') {
            clearSimScanLine();
            restoreSimPills();
            return;
        }

        const elapsed = performance.now() - startTime;
        const rawProgress = Math.min(1, elapsed / duration);
        SimulationState.progress = rawProgress;

        // Current hour based on progress
        const currentHour = startHour + rawProgress * totalHours;
        const svgX = phaseChartX(currentHour * 60);

        // 1. Update scan line position
        updateSimScanLine(svgX, svgHeight);

        // 2. Progressive biometric strip reveal
        const plotLeft = phaseChartX(startHour * 60);
        const revealWidth = svgX - plotLeft;
        clipRects.forEach(r => {
            r.setAttribute('width', String(Math.max(0, revealWidth)));
        });

        // 3. Progressive POI connector reveal — show when scan reaches their x position
        poiGroups.forEach(g => {
            const dot = g.querySelector('.poi-dot');
            if (!dot) return;
            const cx = parseFloat(dot.getAttribute('cx') || '0');
            if (cx <= svgX) {
                (g as SVGElement).setAttribute('opacity', '1');
            }
        });

        // 4. Fire scheduled events
        while (scheduleIdx < schedule.length && schedule[scheduleIdx].hour <= currentHour) {
            const event = schedule[scheduleIdx];
            if (!event.fired) {
                event.fired = true;
                if (event.type === 'poi-pulse') {
                    if (POI_ENABLED) flashPoiConnector(event.poi);
                } else if (event.type.startsWith('pill-')) {
                    animateSimPillEvent(event);
                }
            }
            scheduleIdx++;
        }

        if (rawProgress < 1) {
            SimulationState.rafId = requestAnimationFrame(tick);
        } else {
            // Simulation complete
            SimulationState.phase = 'complete';
            // Remove simulation clip-paths, restore full visibility
            clipRects.forEach(r => {
                const clipEl = r.parentElement;
                if (clipEl) {
                    // Find the element using this clip and remove the attribute
                    const clipId = clipEl.id;
                    bioStrips?.querySelector(`[clip-path="url(#${clipId})"]`)?.removeAttribute('clip-path');
                    clipEl.remove();
                }
            });
            poiGroups.forEach(g => (g as SVGElement).setAttribute('opacity', '1'));
            // Restore pills to their final revised positions
            restoreSimPills();
            // Fade out scan line
            setTimeout(() => clearSimScanLine(), 500);
            // Re-show simulation button for replay (multi-day disabled)
            setTimeout(() => {
                showSimulationButton();
            }, 600);
        }
    };

    SimulationState.rafId = requestAnimationFrame(tick);

    // Wait for completion
    return new Promise(resolve => {
        const check = () => {
            if (SimulationState.phase === 'complete' || SimulationState.phase === 'idle') {
                resolve();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}

// ═══════════════════════════════════════════════════════════════════
// Weekly Simplified Biometric Rendering — lighter strip + POI dots
// ═══════════════════════════════════════════════════════════════════

import type { PoiEvent, Intervention } from './types';

/**
 * Render biometric strips in simplified weekly mode — waveforms only, no zoom cards,
 * no spotter panels. Stores _renderY/_renderH on channels for multi-day morphing.
 */
export function renderWeeklyBiometricStrips(channels: BiometricChannel[], anchorSepY?: number) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;
    group.innerHTML = '';

    // Force red-shade palette
    const redShades = BIO_RED_PALETTE;
    let redIdx = 0;
    channels.forEach((ch: any) => {
        if (!ch._compositeGroup) {
            ch.color = redShades[redIdx % redShades.length];
            redIdx++;
        }
    });

    const svg = document.getElementById('phase-chart-svg')!;
    const currentVB = svg.getAttribute('viewBox')!.split(' ').map(Number);
    let currentH = currentVB[3];

    const sepY =
        typeof anchorSepY === 'number' && Number.isFinite(anchorSepY)
            ? anchorSepY
            : currentH + BIOMETRIC_ZONE.separatorPad;

    // Separator line
    group.appendChild(
        svgEl('line', {
            x1: String(PHASE_CHART.padL),
            y1: String(sepY),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
            y2: String(sepY),
            class: 'biometric-separator',
        }),
    );

    let yOffset = sepY + BIOMETRIC_ZONE.separatorPad;

    for (const ch of channels) {
        if (ch._compositeGroup) continue; // skip composite sub-channels for now
        const h = ch.stripHeight || BIOMETRIC_ZONE.laneH;
        const y = yOffset;

        // Store render position for multi-day morphing
        (ch as any)._renderY = y;
        (ch as any)._renderH = h;

        // Build waveform
        const { strokeD, fillD } = buildBiometricWaveformPath(ch.data, ch.range, y, h);

        if (fillD) {
            group.appendChild(
                svgEl('path', {
                    d: fillD,
                    class: 'bio-strip-fill',
                    fill: ch.color,
                    'fill-opacity': '0.08',
                }),
            );
        }
        if (strokeD) {
            group.appendChild(
                svgEl('path', {
                    d: strokeD,
                    class: 'bio-strip-path',
                    stroke: ch.color,
                    'stroke-width': '1.2',
                    fill: 'none',
                    opacity: '0.8',
                }),
            );
        }

        // Label
        const labelX = PHASE_CHART.padL - 6;
        const labelY = y + h / 2;
        const labelEl = svgEl('text', {
            x: String(labelX),
            y: String(labelY),
            'text-anchor': 'end',
            'dominant-baseline': 'central',
            'font-size': '9',
            'font-family': 'IBM Plex Mono, monospace',
            fill: ch.color,
            opacity: '0.7',
        });
        labelEl.textContent = ch.metric || ch.displayName || ch.signal;
        group.appendChild(labelEl);

        yOffset += h + BIOMETRIC_ZONE.laneGap;
    }

    // Expand viewBox
    const newH = yOffset + BIOMETRIC_ZONE.bottomPad;
    if (newH > currentH) {
        svg.setAttribute('viewBox', `${currentVB[0]} ${currentVB[1]} ${currentVB[2]} ${newH}`);
    }
}

// Re-export from extracted module (broken out to avoid biometric ↔ multi-day-animation cycle)
export { renderPoiDotsAndConnectors } from './poi-render';
