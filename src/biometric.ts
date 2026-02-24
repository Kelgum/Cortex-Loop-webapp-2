import { PHASE_CHART, TIMELINE_ZONE, BIOMETRIC_ZONE, COMPOSITE_SLEEP, API_ENDPOINTS } from './constants';
import { BiometricState, RevisionState, PhaseState, AppState, SherlockState, TimelineState } from './state';
import { svgEl, phaseChartX, phaseChartY, sleep, interpolatePrompt } from './utils';
import { callAnthropicGeneric, callOpenAIGeneric, callGeminiGeneric, getStageModel, callRevisionModel, callSherlockRevisionModel } from './llm-pipeline';
import { phasePointsToPath, phasePointsToFillPath } from './curve-utils';
import { placePeakDescriptors } from './phase-chart';
import { validateInterventions, computeLxOverlay, computeIncrementalLxOverlay, allocateTimelineLanes, renderSubstanceTimeline, preserveBiometricStrips, revealTimelinePillsInstant } from './lx-system';
import { DebugLog } from './debug-panel';
import { PROMPTS } from './prompts';
import { showNarrationPanel, hideNarrationPanel, showSherlockStack, enableSherlockScrollMode, setVcrUpdateCallback, getLxStepperState, triggerLxPlay, triggerLxPrev, triggerLxNext } from './sherlock';
import { buildSherlockRevisionCards } from './timeline-segments/sherlock-segments';

declare const BIOMETRIC_DEVICES: any;
declare const BIO_RED_PALETTE: string[] | undefined;

// ============================================
// Dependency injection for circular references
// ============================================

let _startBioScanLineFn: any;
let _stopBioScanLineFn: any;
let _onBioScanStart: (() => void) | null = null;
let _onBioScanStop: ((channelCount: number) => void) | null = null;
let _onBioScanAbort: (() => void) | null = null;
let _onRevisionPlay: ((diff: any[]) => void) | null = null;
let _onRevisionPlayContext: ((narration: any) => void) | null = null;

export function injectBiometricDeps(d: any) {
    if (d.startBioScanLine) _startBioScanLineFn = d.startBioScanLine;
    if (d.stopBioScanLine) _stopBioScanLineFn = d.stopBioScanLine;
    if (d.onBioScanStart) _onBioScanStart = d.onBioScanStart;
    if (d.onBioScanStop) _onBioScanStop = d.onBioScanStop;
    if (d.onBioScanAbort) _onBioScanAbort = d.onBioScanAbort;
    if (d.onRevisionPlay) _onRevisionPlay = d.onRevisionPlay;
    if (d.onRevisionPlayContext) _onRevisionPlayContext = d.onRevisionPlayContext;
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
    return svg.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
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

    fresh.addEventListener('click', () => {
        wrap.classList.add('hidden');
        hideNarrationPanel();
        initBiometricFlow();
    }, { once: true });
}

export function hideBiometricTrigger() {
    const wrap = document.getElementById('biometric-trigger-wrap');
    if (wrap) wrap.classList.add('hidden');
}

/**
 * Build a contextual default profile placeholder based on the user's goal
 * and the prescribed intervention protocol. Designed to create biometric
 * patterns that produce interesting revision-model adjustments.
 */
export function buildContextualProfilePlaceholder() {
    const userGoal = ((document.getElementById('prompt-input') as HTMLInputElement).value || '').trim().toLowerCase();
    const interventions = PhaseState.interventionResult?.interventions || [];
    const keys = interventions.map((iv: any) => (iv.key || '').toLowerCase());

    // Detect substance categories present
    const hasCaffeine = keys.some((k: any) => k.includes('caffeine') || k.includes('theacrine') || k.includes('dynamine'));
    const hasSleepAid = keys.some((k: any) => k.includes('melatonin') || k.includes('glycine') || k.includes('magnesium') || k.includes('gaba'));
    const hasStimulant = keys.some((k: any) => k.includes('modafinil') || k.includes('methylphenidate') || k.includes('adderall'));
    const hasAdaptogen = keys.some((k: any) => k.includes('ashwagandha') || k.includes('rhodiola') || k.includes('theanine'));
    const hasNootropic = keys.some((k: any) => k.includes('tyrosine') || k.includes('citicoline') || k.includes('lion'));

    // Detect goal themes
    const isFocus = /focus|concentrat|attention|productiv|work|study|deep\s*work/i.test(userGoal);
    const isSleep = /sleep|rest|recover|insomnia|wind\s*down/i.test(userGoal);
    const isEnergy = /energy|fatigue|tired|wake|alert|morning/i.test(userGoal);
    const isAnxiety = /anxi|stress|calm|relax|tension/i.test(userGoal);
    const isExercise = /exercis|workout|train|gym|run|athlet|performance|endurance/i.test(userGoal);

    // Build profile fragments that create interesting biometric tensions
    const fragments: string[] = [];

    // Age/gender — random variety
    const ages = ['28yo female', '35yo male', '42yo female', '31yo male', '38yo non-binary', '45yo male', '33yo female'];
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

/**
 * Initialize the biometric device selection flow.
 * Slides down an inline strip below the SVG with device chips in a horizontal row.
 */
export function initBiometricFlow() {
    BiometricState.phase = 'selecting';
    BiometricState.selectedDevices = [];

    // Hide the VCR panel so it doesn't overlap the biometric UI
    hideInterventionPlayButton();

    const stripUI = document.getElementById('biometric-strip-ui')!;
    const deviceRow = document.getElementById('bio-device-row')!;
    const profileRow = document.getElementById('bio-profile-row')!;
    const scroll = document.getElementById('bio-device-scroll')!;
    const goBtn = document.getElementById('bio-go-btn') as HTMLButtonElement;

    // Reset steps
    deviceRow.classList.remove('hidden');
    profileRow.classList.add('hidden');
    goBtn.disabled = true;

    // Populate horizontal device chips
    scroll.innerHTML = '';
    const devices = (typeof BIOMETRIC_DEVICES !== 'undefined') ? BIOMETRIC_DEVICES.devices : [];
    const isLight = document.body.classList.contains('light-mode');
    devices.forEach((dev: any) => {
        const chip = document.createElement('div');
        chip.className = 'bio-device-chip';
        chip.dataset.key = dev.key;

        // Image-based icon (dark/light aware)
        const icon = document.createElement('img');
        icon.className = 'bio-device-chip-icon';
        icon.src = isLight ? dev.iconLight : dev.iconDark;
        icon.alt = dev.name;
        icon.draggable = false;
        // Store both paths for theme switching
        icon.dataset.srcDark = dev.iconDark;
        icon.dataset.srcLight = dev.iconLight;

        const name = document.createElement('span');
        name.className = 'bio-device-chip-name';
        name.textContent = dev.name;

        chip.appendChild(icon);
        chip.appendChild(name);

        chip.addEventListener('click', () => {
            chip.classList.toggle('selected');
            BiometricState.selectedDevices = Array.from(scroll.querySelectorAll('.bio-device-chip.selected'))
                .map((c: any) => c.dataset.key);
            goBtn.disabled = BiometricState.selectedDevices.length === 0;
        });

        scroll.appendChild(chip);
    });

    // Position below the SVG and slide open the strip
    stripUI.style.top = (getBiometricTopOffset() + 2) + 'px';
    stripUI.classList.remove('hidden');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => stripUI.classList.add('visible'));
    });

    // Go → switch to profile input with contextual placeholder
    goBtn.onclick = () => {
        BiometricState.phase = 'profiling';
        deviceRow.classList.add('hidden');
        profileRow.classList.remove('hidden');
        const input = document.getElementById('bio-profile-input') as HTMLInputElement;
        input.value = '';
        input.placeholder = buildContextualProfilePlaceholder();
        input.focus();
    };

    // Submit → close strip and execute pipeline
    const submitBtn = document.getElementById('bio-submit-btn')!;
    const handleSubmit = () => {
        const input = document.getElementById('bio-profile-input') as HTMLInputElement;
        BiometricState.profileText = input.value.trim() || input.placeholder;
        // Collapse the strip
        stripUI.classList.remove('visible');
        setTimeout(() => stripUI.classList.add('hidden'), 400);
        BiometricState.phase = 'loading';
        executeBiometricPipeline();
    };
    submitBtn.onclick = handleSubmit;

    (document.getElementById('bio-profile-input') as HTMLInputElement).onkeydown = (e: any) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    };
}

/**
 * Build the intervention summary string for the biometric prompt.
 */
export function buildInterventionSummary() {
    const result = PhaseState.interventionResult;
    if (!result || !result.interventions) return 'No interventions prescribed.';
    return result.interventions.map((iv: any) => {
        const h = Math.floor(iv.timeMinutes / 60);
        const m = iv.timeMinutes % 60;
        const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        return `${iv.key} ${iv.dose || ''} at ${time}`;
    }).join('; ');
}

/**
 * Build tension directives that instruct the Spotter to simulate biometric
 * anomalies that will provoke the Grandmaster into significant revisions.
 * Deterministic: based solely on the current intervention protocol.
 */
export function buildTensionDirectives(): string {
    const interventions = PhaseState.interventionResult?.interventions || [];
    if (interventions.length === 0) return '';

    const directives: string[] = [];

    for (const iv of interventions) {
        const key = (iv.key || '').toLowerCase();
        const timeMin = iv.timeMinutes || 0;
        const h = Math.floor(timeMin / 60);
        const m = timeMin % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        // --- CAFFEINE / STIMULANT tension ---
        if (key.includes('caffeine') || key.includes('theacrine') || key.includes('dynamine')) {
            if (timeMin < 540) { // Before 9am
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate elevated resting HR (+12-18bpm above baseline) persisting from ${timeStr} until 01:00 (hour 25). ` +
                    `Show suppressed HRV (drop 25-35ms below evening baseline) from 20:00-01:00, indicating caffeine half-life overshoot disrupting parasympathetic recovery. ` +
                    `This should justify: delaying caffeine to 09:30+ and halving the dose.`
                );
            } else {
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate a cortisol rebound spike at ${timeStr} + 6 hours ` +
                    `(HR +8-10bpm, HRV -15ms during the 18:00-21:00 window), suggesting the dose is too high for this time of day. ` +
                    `This should justify: reducing dose by 50%.`
                );
            }
        }

        // --- STIMULANT Rx tension ---
        if (key.includes('modafinil') || key.includes('methylphenidate') || key.includes('adderall')
            || key.includes('ritalin') || key.includes('concerta') || key.includes('vyvanse') || key.includes('focalin')) {
            if (timeMin >= 720) { // Afternoon (after noon)
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate persistent elevated HR (+10-15bpm) and suppressed HRV (-20-30ms) from ${timeStr} through 23:00, ` +
                    `with elevated resp rate (+3-4 br/min) during evening wind-down. ` +
                    `Show delayed sleep onset (sleep channels stay 0 until 01:00 instead of 23:00). ` +
                    `This should justify: removing the afternoon stimulant entirely and adding an evening adaptogen (e.g., ashwagandha or theanine).`
                );
            } else {
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate a sharp HR spike (+20bpm) and HRV crash (-30ms) at ${timeStr}+30min, ` +
                    `followed by a crash pattern at ${timeStr}+4hours (HR drops 15bpm below morning baseline, HRV overshoots +10ms briefly then crashes again). ` +
                    `This should justify: splitting the dose into two smaller doses 3 hours apart.`
                );
            }
        }

        // --- SLEEP AID tension ---
        if (key.includes('melatonin') || key.includes('zolpidem') || key.includes('ambien') || key.includes('suvorexant')) {
            directives.push(
                `TENSION — ${iv.key} at ${timeStr}: Simulate poor deep sleep architecture — sleep_deep channel shows only 50-60 intensity ` +
                `(instead of 80-100) and deep sleep onset delayed by 90 minutes past sleep start. REM cycles (sleep_rem) are shortened to 10-min fragments. ` +
                `Show brief wake events (HR spikes +15bpm for 1-2 samples) at 02:00 and 04:00. ` +
                `This should justify: adding glycine 1-2 hours before bed, shifting ${iv.key} 60 minutes earlier, and potentially replacing with a different sleep aid.`
            );
        }

        // --- GLYCINE / MAGNESIUM tension ---
        if (key.includes('glycine') || key.includes('magnesium')) {
            if (timeMin < 1200) { // Before 8pm
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: This is too early for a sleep-support substance. ` +
                    `Simulate normal HRV during sleep but show the substance has minimal impact at this timing — ` +
                    `no improvement in deep sleep onset, baseline-level HRV during the 22:00-02:00 window. ` +
                    `This should justify: moving ${iv.key} to 21:00-22:00 for proximity to sleep onset.`
                );
            }
        }

        // --- ADAPTOGEN tension ---
        if (key.includes('ashwagandha') || key.includes('rhodiola')) {
            if (timeMin < 600) { // Before 10am
                directives.push(
                    `TENSION — ${iv.key} at ${timeStr}: Simulate morning drowsiness — HR stays 5-8bpm below expected waking baseline ` +
                    `until 10:00, HRV is elevated but in a sedated-not-recovered pattern. ` +
                    `This should justify: moving the adaptogen to afternoon (14:00-16:00) as a stress-buffer rather than a morning supplement.`
                );
            }
        }

        // --- NOOTROPIC tension ---
        if (key.includes('tyrosine') || key.includes('citicoline') || key.includes('alpha-gpc') || key.includes('alphagpc')) {
            directives.push(
                `TENSION — ${iv.key} at ${timeStr}: Simulate an HRV pattern suggesting overstimulation — ` +
                `HRV drops 10-15ms below baseline during the 2 hours after dosing, then overshoots briefly, ` +
                `suggesting the nootropic is stacking with other stimulants to create excess sympathetic drive. ` +
                `This should justify: replacing ${iv.key} with a different nootropic (e.g., swap tyrosine for lion's mane, or swap citicoline for bacopa) or reducing its dose by 50%.`
            );
        }
    }

    // Global tension if protocol is complex
    if (interventions.length >= 4) {
        directives.push(
            `GLOBAL TENSION: The protocol has ${interventions.length} substances. Simulate a general pattern of elevated baseline HR (+5-8bpm all day) ` +
            `and compressed HRV range (narrower oscillation, 15-20% less variation than a clean baseline), ` +
            `suggesting systemic pharmacological load. This should justify: removing at least one substance entirely.`
        );
    }

    if (directives.length === 0) return '';

    return '\n\nTENSION DIRECTIVES (simulate these biometric anomalies to create revision opportunities):\n'
        + directives.map((d, i) => `${i + 1}. ${d}`).join('\n');
}

/**
 * Build the channel spec from selected devices.
 */
export function buildChannelSpec() {
    const devices = (typeof BIOMETRIC_DEVICES !== 'undefined') ? BIOMETRIC_DEVICES.devices : [];
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
export function computeLaneCount(channels: any[]): number {
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
export async function callBiometricModel(channelSpec: any) {
    const { model, provider, key } = getStageModel('biometric');
    if (!key) throw new Error(`No API key configured for ${provider}. Add one in Settings.`);

    // Slim curve summary — only include every 4th point to reduce prompt size
    const curveSummary = PhaseState.curvesData ? PhaseState.curvesData.map((c: any) => ({
        effect: c.effect,
        polarity: c.polarity || 'higher_is_better',
        baseline: (c.baseline || []).filter((_: any, i: number) => i % 4 === 0),
        desired: (c.desired || []).filter((_: any, i: number) => i % 4 === 0),
    })) : [];

    const tensionDirectives = buildTensionDirectives();

    const systemPrompt = interpolatePrompt(PROMPTS.biometric, {
        channelSpec: JSON.stringify(channelSpec),
        profileText: BiometricState.profileText,
        interventionSummary: buildInterventionSummary(),
        curveSummary: JSON.stringify(curveSummary),
    }) + tensionDirectives;

    const userPrompt = 'Simulate the 24-hour biometric data for the specified channels. Respond with JSON only.';

    const debugEntry = DebugLog.addEntry({
        stage: 'Biometric Model', stageClass: 'biometric-model',
        model,
        systemPrompt,
        userPrompt,
        loading: true,
    });

    const startTime = performance.now();

    try {
        let result: any;
        switch (provider) {
            case 'anthropic':
                result = await callAnthropicGeneric(userPrompt, key, model, systemPrompt, 16384);
                break;
            case 'openai':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.openai, systemPrompt, 16384, 'openai');
                break;
            case 'grok':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.grok, systemPrompt, 16384, 'grok');
                break;
            case 'gemini':
                result = await callGeminiGeneric(userPrompt, key, model, systemPrompt, 16384);
                break;
        }
        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;

        const duration = Math.round(performance.now() - startTime);
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            duration,
            requestBody,
            rawResponse,
            response: result,
        });
        return result;
    } catch (err: any) {
        const duration = Math.round(performance.now() - startTime);
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            duration,
            error: err.message,
        });
        throw err;
    }
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
 * Orchestrate the full biometric pipeline: LLM call → parse → render strips.
 */
export async function executeBiometricPipeline() {
    const channelSpec = buildChannelSpec();
    const timelineOwner = TimelineState.engine;
    if (timelineOwner) {
        TimelineState.interactionLocked = true;
    }

    // Start red scan line in the biometric zone while LLM is working
    _startBioScanLineFn?.();
    _onBioScanStart?.();

    try {
        const result = await callBiometricModel(channelSpec);

        // Stop scan line before rendering strips
        _stopBioScanLineFn?.();
        await sleep(420); // wait for fade-out to finish

        if (!result || !Array.isArray(result.channels)) {
            console.error('[Biometric] Invalid LLM response — missing channels array');
            BiometricState.phase = 'idle';
            _onBioScanAbort?.();
            return;
        }

        // Validate channels: skip any with missing/short data
        const validChannels = result.channels.filter((ch: any) =>
            ch && ch.data && Array.isArray(ch.data) && ch.data.length >= 10 && ch.signal
        );

        if (validChannels.length === 0) {
            console.error('[Biometric] No valid channels in LLM response');
            BiometricState.phase = 'idle';
            _onBioScanAbort?.();
            return;
        }

        // Merge LLM-returned colors/ranges with the spec if missing, propagate composite metadata
        for (const ch of validChannels) {
            const spec = channelSpec.find((s: any) => s.signal === ch.signal && s.device === ch.device)
                || channelSpec.find((s: any) => s.signal === ch.signal);
            if (spec) {
                if (!ch.color) ch.color = spec.color;
                if (!ch.range) ch.range = spec.range;
                if (!ch.stripHeight) ch.stripHeight = spec.stripHeight;
                if (!ch.unit) ch.unit = spec.unit;
                if (spec._compositeGroup) ch._compositeGroup = spec._compositeGroup;
                if (spec._compositeLabel) ch._compositeLabel = spec._compositeLabel;
            }
        }

        BiometricState.biometricResult = result;
        BiometricState.channels = validChannels;
        BiometricState.phase = 'rendered';

        renderBiometricStrips(validChannels);
        _onBioScanStop?.(computeLaneCount(validChannels));
        await animateBiometricReveal(600);

        PhaseState.phase = 'biometric-rendered';
        PhaseState.maxPhaseReached = 3;
        PhaseState.viewingPhase = 3;

        // Kick off revision phase (Phase 4)
        await sleep(800);
        await handleRevisionPhase(PhaseState.curvesData);

    } catch (err: any) {
        _stopBioScanLineFn?.();
        _onBioScanAbort?.();
        console.error('[Biometric] Pipeline error:', err.message);
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
export function renderBiometricStrips(channels: any, instant?: boolean, anchorSepY?: number) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;
    group.innerHTML = '';

    // Force red-shade palette on non-composite channels
    const redShades = (typeof BIO_RED_PALETTE !== 'undefined') ? BIO_RED_PALETTE
        : ['#ff4d4d', '#e03e3e', '#c92a2a', '#ff6b6b', '#f76707', '#d9480f', '#ff8787', '#e8590c', '#fa5252', '#b72b2b'];
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
    const sepY = (typeof anchorSepY === 'number' && Number.isFinite(anchorSepY))
        ? anchorSepY
        : currentH + BIOMETRIC_ZONE.separatorPad;
    const sep = svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(sepY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(sepY),
        class: 'biometric-separator',
    });
    group.appendChild(sep);

    let yOffset = sepY + BIOMETRIC_ZONE.separatorPad;

    lanes.forEach((lane, laneIdx) => {
        const y = yOffset;
        const h = lane.height;

        // Alternating lane background stripe
        if (laneIdx % 2 === 0) {
            const stripe = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(y),
                width: String(PHASE_CHART.plotW), height: String(h),
                fill: 'rgba(255, 255, 255, 0.015)',
                rx: '1',
            });
            group.appendChild(stripe);
        }

        // Left-margin label
        const labelColor = lane.type === 'composite'
            ? (COMPOSITE_SLEEP.subChannels[1]?.color || '#8b5cf6')
            : (lane.channels[0].color || 'rgba(238, 244, 255, 0.65)');
        const label = svgEl('text', {
            x: String(PHASE_CHART.padL - 4),
            y: String(y + h / 2),
            class: 'bio-strip-label',
            fill: labelColor,
            'text-anchor': 'end',
        });
        label.textContent = lane.label;
        group.appendChild(label);

        // Build waveform group
        const stripG = svgEl('g');

        if (lane.type === 'single') {
            const ch = lane.channels[0];
            if (ch.signal === 'hr_bpm') stripG.classList.add('bio-strip-hr');

            const { strokeD, fillD } = buildBiometricWaveformPath(ch.data, ch.range, y, h);
            if (fillD) {
                stripG.appendChild(svgEl('path', {
                    d: fillD, class: 'bio-strip-fill', fill: ch.color || '#ff6b6b',
                }));
            }
            stripG.appendChild(svgEl('path', {
                d: strokeD, class: 'bio-strip-path', stroke: ch.color || '#ff6b6b',
            }));
        } else {
            // Composite: render all sub-channel paths overlaid
            for (const subCh of lane.channels) {
                const subColor = subCh.color || '#8b5cf6';
                const { strokeD, fillD } = buildBiometricWaveformPath(subCh.data, subCh.range, y, h);
                if (fillD) {
                    stripG.appendChild(svgEl('path', {
                        d: fillD, class: 'bio-strip-fill bio-composite-fill', fill: subColor,
                    }));
                }
                stripG.appendChild(svgEl('path', {
                    d: strokeD, class: 'bio-strip-path bio-composite-path', stroke: subColor,
                }));
            }

            // Mini-legend: colored dots + labels at right edge
            const legendX = PHASE_CHART.padL + PHASE_CHART.plotW + 6;
            for (let si = 0; si < lane.channels.length; si++) {
                const subCh = lane.channels[si];
                const subColor = subCh.color || COMPOSITE_SLEEP.subChannels[si]?.color || '#8b5cf6';
                const legendY = y + 4 + si * 7;

                stripG.appendChild(svgEl('circle', {
                    cx: String(legendX + 3), cy: String(legendY),
                    r: '2', fill: subColor,
                }));
                const legendLabel = svgEl('text', {
                    x: String(legendX + 8), y: String(legendY + 1.5),
                    class: 'bio-strip-legend-label',
                    fill: subColor,
                });
                legendLabel.textContent = subCh.displayName || subCh.signal;
                stripG.appendChild(legendLabel);
            }
        }

        // Clip path for animation (skipped when instant re-render)
        if (!instant) {
            const clipId = `bio-clip-${laneIdx}`;
            const clipPath = svgEl('clipPath', { id: clipId });
            const clipRect = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(y - 2),
                width: '0', height: String(h + 4),
            });
            clipPath.appendChild(clipRect);
            defs.appendChild(clipPath);
            stripG.setAttribute('clip-path', `url(#${clipId})`);
            (stripG as any).dataset.clipId = clipId;
        }

        group.appendChild(stripG);
        yOffset += h + BIOMETRIC_ZONE.laneGap;
    });

    // Expand viewBox to fit all strips
    const totalH = yOffset + BIOMETRIC_ZONE.bottomPad;
    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${Math.max(currentH, totalH)}`);
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
        const fillD = strokeD + ` L ${coords[1].x.toFixed(1)} ${baseY.toFixed(1)} L ${coords[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`;
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
            t[i] = (w1 + w2) / ((w1 / m[i - 1]) + (w2 / m[i]));
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
    const fillD = strokeD
        + ` L ${coords[n - 1].x.toFixed(1)} ${baseY.toFixed(1)}`
        + ` L ${coords[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`;

    return { strokeD, fillD };
}

/**
 * Animate biometric strips with staggered left-to-right clip-path reveal.
 */
export async function animateBiometricReveal(duration: any) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;

    const stripGroups = group.querySelectorAll('g[data-clip-id]');
    const svg = document.getElementById('phase-chart-svg')!;
    const defs = svg.querySelector('defs')!;
    const stagger = 80;

    const promises = Array.from(stripGroups).map((sg: any, i: number) => {
        return new Promise<void>(resolve => {
            const clipId = sg.dataset.clipId;
            const clip = defs.querySelector(`#${clipId}`);
            if (!clip) { resolve(); return; }
            const rect = clip.querySelector('rect');
            if (!rect) { resolve(); return; }

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
                        // Remove clip after reveal
                        sg.removeAttribute('clip-path');
                        clip.remove();
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

const ICON_PLAY = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
const ICON_PAUSE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="14,4 2,12 14,20"/><rect x="18" y="6" width="2" height="12" rx="0.5"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="4" y="6" width="2" height="12" rx="0.5"/><polygon points="10,4 22,12 10,20"/></svg>';

let _vcrPanel: HTMLElement | null = null;
let _vcrPlayBtn: HTMLButtonElement | null = null;
let _vcrPrevBtn: HTMLButtonElement | null = null;
let _vcrNextBtn: HTMLButtonElement | null = null;
let _vcrBioBtn: HTMLElement | null = null;
let _vcrOnPlayClick: (() => void) | null = null;
let _vcrReadyAnimTimer: number | null = null;

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

function teardownVcrPanel(): void {
    if (_vcrReadyAnimTimer != null) {
        window.clearTimeout(_vcrReadyAnimTimer);
        _vcrReadyAnimTimer = null;
    }
    setVcrUpdateCallback(null);
    _vcrOnPlayClick = null;

    const panel = _vcrPanel || document.querySelector('.vcr-control-panel');
    if (panel) {
        panel.classList.remove('vcr-loading');
        panel.classList.remove('visible');
        panel.classList.add('hidden');
        panel.remove();
    }

    _vcrPanel = null;
    _vcrPlayBtn = null;
    _vcrPrevBtn = null;
    _vcrNextBtn = null;
    _vcrBioBtn = null;
}

function updateVcrPanelState(): void {
    if (!_vcrPanel) return;
    const { currentStep, totalSteps, mode } = getLxStepperState();
    if (_vcrPrevBtn) {
        _vcrPrevBtn.disabled = currentStep <= 0;
        _vcrPrevBtn.classList.toggle('vcr-btn-faded', mode === 'ready' && currentStep === 0);
    }
    if (_vcrPlayBtn) {
        _vcrPlayBtn.innerHTML = mode === 'playing' ? ICON_PAUSE : ICON_PLAY;
        _vcrPlayBtn.title = mode === 'playing' ? 'Pause' : 'Play';
    }
    if (_vcrNextBtn) {
        _vcrNextBtn.disabled = mode === 'playing';
    }
}

function ensureVcrPanel(): HTMLElement {
    if (_vcrPanel) {
        // Rebind after prior runs, since hideInterventionPlayButton() clears the callback.
        setVcrUpdateCallback(updateVcrPanelState);
        return _vcrPanel;
    }
    const wrapper = document.querySelector('.phase-svg-wrapper');
    if (!wrapper) throw new Error('VCR panel: phase-svg-wrapper not found');
    const panel = document.createElement('div');
    panel.className = 'vcr-control-panel hidden';
    panel.innerHTML = `
        <button class="vcr-btn vcr-prev" title="Previous track" disabled>${ICON_PREV}</button>
        <button class="vcr-btn vcr-play intervention-play-btn" id="intervention-play-btn" title="Play">${ICON_PLAY}</button>
        <button class="vcr-btn vcr-next" title="Next track">${ICON_NEXT}</button>
        <div class="vcr-biometric-wrap hidden">
            <span class="vcr-bio-label">Biometric Loop</span>
            <button class="vcr-btn vcr-bio" aria-label="Start biometric loop">+</button>
        </div>
    `;
    wrapper.appendChild(panel);
    _vcrPanel = panel;
    _vcrPlayBtn = panel.querySelector('.vcr-play') as HTMLButtonElement;
    _vcrPrevBtn = panel.querySelector('.vcr-prev') as HTMLButtonElement;
    _vcrNextBtn = panel.querySelector('.vcr-next') as HTMLButtonElement;
    _vcrBioBtn = panel.querySelector('.vcr-biometric-wrap');

    _vcrPrevBtn.addEventListener('click', () => triggerLxPrev());
    _vcrNextBtn.addEventListener('click', () => triggerLxNext());
    _vcrPlayBtn.addEventListener('click', () => {
        if (_vcrOnPlayClick) _vcrOnPlayClick();
        else triggerLxPlay();
    });
    _vcrBioBtn?.querySelector('.vcr-bio')?.addEventListener('click', () => {
        panel.querySelector('.vcr-biometric-wrap')?.classList.add('hidden');
        hideNarrationPanel();
        initBiometricFlow();
    }, { once: true });

    setVcrUpdateCallback(updateVcrPanelState);
    return panel;
}

/** Show rotating orange waiting button while strategist (intervention) + Sherlock process */
export function showInterventionPlayButtonLoading() {
    const panel = ensureVcrPanel();
    if (_vcrReadyAnimTimer != null) {
        window.clearTimeout(_vcrReadyAnimTimer);
        _vcrReadyAnimTimer = null;
    }
    panel.classList.remove('hidden');
    panel.classList.add('vcr-loading');
    panel.querySelector('.vcr-biometric-wrap')?.classList.add('hidden');
    _vcrPlayBtn?.classList.add('loading');
    _vcrPrevBtn?.classList.add('vcr-btn-hidden');
    _vcrNextBtn?.classList.add('vcr-btn-hidden');
    syncLegacyLxButton('loading');
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('visible')));
}

/** Show VCR panel with prev | play | next when ready */
export function showInterventionPlayButton() {
    const panel = ensureVcrPanel();
    if (_vcrReadyAnimTimer != null) {
        window.clearTimeout(_vcrReadyAnimTimer);
        _vcrReadyAnimTimer = null;
    }
    panel.classList.remove('hidden');
    panel.classList.remove('vcr-loading');
    panel.querySelector('.vcr-biometric-wrap')?.classList.add('hidden');
    _vcrPrevBtn?.classList.remove('vcr-btn-hidden');
    _vcrNextBtn?.classList.remove('vcr-btn-hidden');
    _vcrReadyAnimTimer = window.setTimeout(() => {
        _vcrPlayBtn?.classList.remove('loading');
        _vcrReadyAnimTimer = null;
    }, 120);
    updateVcrPanelState();
    syncLegacyLxButton('ready');
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
    const panel = _vcrPanel || document.querySelector('.vcr-control-panel');
    const wrap = panel?.querySelector('.vcr-biometric-wrap');
    if (wrap) {
        wrap.classList.remove('hidden');
    }
}

export function hideInterventionPlayButton() {
    syncLegacyLxButton('hidden');
    teardownVcrPanel();
}

// ---- Revision Play Button (red) ----

export function showRevisionPlayButton() {
    let btn = document.getElementById('revision-play-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'revision-play-btn';
        btn.className = 'revision-play-btn hidden';
        btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
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
    setTimeout(() => { btn.classList.add('hidden'); btn.classList.remove('loading'); }, 500);
}

export function setRevisionPlayReady() {
    const btn = document.getElementById('revision-play-btn');
    if (btn) btn.classList.remove('loading');
}

// ---- Diffing Logic ----

export function diffInterventions(oldIvs: any, newIvs: any) {
    const diff: any[] = [];
    const matched = new Set();
    const usedNew = new Set();

    // Pass 1: Match by substance key
    for (let oi = 0; oi < oldIvs.length; oi++) {
        for (let ni = 0; ni < newIvs.length; ni++) {
            if (usedNew.has(ni)) continue;
            if (oldIvs[oi].key === newIvs[ni].key) {
                const timeDelta = Math.abs(oldIvs[oi].timeMinutes - newIvs[ni].timeMinutes);
                const doseDiff = oldIvs[oi].dose !== newIvs[ni].dose
                    || (oldIvs[oi].doseMultiplier || 1) !== (newIvs[ni].doseMultiplier || 1);
                if (timeDelta > 15 || doseDiff) {
                    diff.push({ type: timeDelta > 15 ? 'moved' : 'resized', oldIv: oldIvs[oi], newIv: newIvs[ni] });
                }
                // else unchanged — no animation needed
                matched.add(oi);
                usedNew.add(ni);
                break;
            }
        }
    }

    // Pass 2: Unmatched old → replacement or removal
    for (let oi = 0; oi < oldIvs.length; oi++) {
        if (matched.has(oi)) continue;
        let bestNi = -1, bestDelta = Infinity;
        for (let ni = 0; ni < newIvs.length; ni++) {
            if (usedNew.has(ni)) continue;
            const delta = Math.abs(oldIvs[oi].timeMinutes - newIvs[ni].timeMinutes);
            if (delta < 60 && delta < bestDelta) { bestDelta = delta; bestNi = ni; }
        }
        if (bestNi >= 0) {
            diff.push({ type: 'replaced', oldIv: oldIvs[oi], newIv: newIvs[bestNi] });
            matched.add(oi);
            usedNew.add(bestNi);
        } else {
            diff.push({ type: 'removed', oldIv: oldIvs[oi], newIv: null });
            matched.add(oi);
        }
    }

    // Pass 3: Unmatched new → additions
    for (let ni = 0; ni < newIvs.length; ni++) {
        if (usedNew.has(ni)) continue;
        diff.push({ type: 'added', oldIv: null, newIv: newIvs[ni] });
    }

    // Sort chronologically by the relevant intervention's time
    diff.sort((a, b) => {
        const tA = (a.oldIv || a.newIv).timeMinutes;
        const tB = (b.oldIv || b.newIv).timeMinutes;
        return tA - tB;
    });
    return diff;
}

// ---- Pill Matching ----

export function findPillByIntervention(iv: any, timelineGroup: any) {
    if (!iv || !timelineGroup) return null;

    // Match by data-substance-key AND data-time-minutes proximity
    const candidates = timelineGroup.querySelectorAll(
        `.timeline-pill-group[data-substance-key="${iv.key}"]`
    );
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
        // Multiple pills with same key — match by closest time
        let best: any = null, bestDelta = Infinity;
        for (const c of candidates) {
            const t = parseInt(c.getAttribute('data-time-minutes') || '0');
            const delta = Math.abs(t - iv.timeMinutes);
            if (delta < bestDelta) { bestDelta = delta; best = c; }
        }
        if (best) return best;
    }

    // Fallback: match by name text + X proximity
    const name = iv.substance?.name || iv.key;
    const targetX = phaseChartX(iv.timeMinutes);
    const pills = timelineGroup.querySelectorAll('.timeline-pill-group');
    for (const pill of pills) {
        const label = pill.querySelector('.timeline-bar-label');
        if (!label) continue;
        const labelText = label.textContent || '';
        if (!labelText.toLowerCase().includes(name.toLowerCase())) continue;
        const bar = pill.querySelector('rect[rx]') || pill.querySelector('.timeline-bar');
        if (bar && Math.abs(parseFloat(bar.getAttribute('x')) - targetX) < 30) return pill;
    }
    console.warn('[Revision] Could not find pill for:', iv.key, '@', iv.timeMinutes, 'min');
    return null;
}

// ---- SVG Animation Helper ----
// rAF-based interpolation for SVG attributes (more reliable than WAAPI on SVG)

export function animateSvgTransform(el: any, fromTx: any, fromTy: any, toTx: any, toTy: any, duration: any, easing: any) {
    const start = performance.now();
    const ease = easing === 'ease-in'
        ? (t: number) => t * t
        : easing === 'ease-out'
            ? (t: number) => 1 - (1 - t) * (1 - t)
            : (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const rawT = Math.min(1, (now - start) / duration);
            const t = ease(rawT);
            const tx = fromTx + (toTx - fromTx) * t;
            const ty = fromTy + (toTy - fromTy) * t;
            el.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
            if (rawT < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

export function animateSvgOpacity(el: any, from: any, to: any, duration: any) {
    const start = performance.now();
    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const t = Math.min(1, (now - start) / duration);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            el.setAttribute('opacity', String(from + (to - from) * ease));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

export function animateSvgWidth(el: any, fromW: any, toW: any, duration: any) {
    const start = performance.now();
    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const t = Math.min(1, (now - start) / duration);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            el.setAttribute('width', String(fromW + (toW - fromW) * ease));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

// ---- Individual Pill Animations ----

export function animatePillMove(trigger: any, timelineGroup: any, targetLayout: any) {
    const pill = findPillByIntervention(trigger.oldIv, timelineGroup);
    if (!pill) { console.warn('[Revision] Move: pill not found for', trigger.oldIv.key); return; }

    const target = targetLayout.get(layoutKey(trigger.newIv));
    const bar = pill.querySelector('rect[rx]') || pill.querySelector('.timeline-bar');
    if (!bar) return;

    const oldX = parseFloat(bar.getAttribute('x'));
    const oldY = parseFloat(bar.getAttribute('y'));
    const deltaX = target ? target.x - oldX : phaseChartX(trigger.newIv.timeMinutes) - oldX;
    const deltaY = target ? target.y - oldY : 0;

    console.log('[Revision] MOVE:', trigger.oldIv.key, `dx=${deltaX.toFixed(0)} dy=${deltaY.toFixed(0)}`);

    pill.setAttribute('opacity', '1');
    animateSvgTransform(pill, 0, 0, deltaX, deltaY, 800, 'ease-in-out');

    // Also update bar width + label for any dose change
    if (target) {
        const oldW = parseFloat(bar.getAttribute('width'));
        if (Math.abs(target.w - oldW) > 2) {
            animateSvgWidth(bar, oldW, target.w, 800);
        }
    }
    const label = pill.querySelector('.timeline-bar-label');
    if (label) {
        const name = trigger.newIv.substance?.name || trigger.newIv.key;
        label.textContent = `${name} ${trigger.newIv.dose || ''}`;
    }
    pill.setAttribute('data-time-minutes', String(trigger.newIv.timeMinutes));
}

export function animatePillResize(trigger: any, timelineGroup: any, targetLayout: any) {
    const pill = findPillByIntervention(trigger.oldIv, timelineGroup);
    if (!pill) { console.warn('[Revision] Resize: pill not found for', trigger.oldIv.key); return; }

    const target = targetLayout.get(layoutKey(trigger.newIv));
    const bar = pill.querySelector('rect[rx]') || pill.querySelector('.timeline-bar');
    if (!bar) return;

    const oldW = parseFloat(bar.getAttribute('width'));
    const newW = target ? target.w : oldW;
    const oldY = parseFloat(bar.getAttribute('y'));
    const deltaY = target ? target.y - oldY : 0;

    console.log('[Revision] RESIZE:', trigger.oldIv.key, trigger.oldIv.dose, '→', trigger.newIv.dose,
        `dw=${(newW - oldW).toFixed(0)} dy=${deltaY.toFixed(0)}`);

    // Animate bar width + lane change
    if (Math.abs(newW - oldW) > 2) animateSvgWidth(bar, oldW, newW, 600);
    if (Math.abs(deltaY) > 1) animateSvgTransform(pill, 0, 0, 0, deltaY, 600, 'ease-in-out');

    // Flash effect: brief opacity pulse to make dose change visible
    animateSvgOpacity(pill, 1, 0.3, 200).then(() => animateSvgOpacity(pill, 0.3, 1, 400));

    // Update label
    const label = pill.querySelector('.timeline-bar-label');
    if (label) {
        const name = trigger.newIv.substance?.name || trigger.newIv.key;
        label.textContent = `${name} ${trigger.newIv.dose || ''}`;
    }
}

export function animatePillFlip(trigger: any, timelineGroup: any, targetLayout: any) {
    const pill = findPillByIntervention(trigger.oldIv, timelineGroup);
    if (!pill) { console.warn('[Revision] Flip: pill not found for', trigger.oldIv.key); return; }

    const target = targetLayout.get(layoutKey(trigger.newIv));
    const bar = pill.querySelector('rect[rx]') || pill.querySelector('.timeline-bar');
    const label = pill.querySelector('.timeline-bar-label');

    console.log('[Revision] FLIP:', trigger.oldIv.key, '→', trigger.newIv.key);

    // Move to new lane if needed
    if (target && bar) {
        const oldY = parseFloat(bar.getAttribute('y'));
        const deltaY = target.y - oldY;
        if (Math.abs(deltaY) > 1) animateSvgTransform(pill, 0, 0, 0, deltaY, 600, 'ease-in-out');
    }

    // Phase 1: fade out old
    animateSvgOpacity(pill, 1, 0.05, 300).then(() => {
        // Swap content at midpoint
        const newSub = trigger.newIv.substance;
        const newColor = newSub ? newSub.color : 'rgba(245,180,60,0.7)';
        if (bar) {
            bar.setAttribute('fill', newColor);
            bar.setAttribute('stroke', newColor);
            if (target) bar.setAttribute('width', target.w.toFixed(1));
        }
        if (label) {
            label.textContent = `${newSub?.name || trigger.newIv.key} ${trigger.newIv.dose || ''}`;
            label.setAttribute('fill', newColor);
        }
        pill.setAttribute('data-substance-key', trigger.newIv.key);
        pill.setAttribute('data-time-minutes', String(trigger.newIv.timeMinutes));
        // Phase 2: fade in new
        animateSvgOpacity(pill, 0.05, 1, 300);
    });
}

export function animatePillRemove(trigger: any, timelineGroup: any) {
    const pill = findPillByIntervention(trigger.oldIv, timelineGroup);
    if (!pill) { console.warn('[Revision] Remove: pill not found for', trigger.oldIv.key); return; }
    console.log('[Revision] REMOVE:', trigger.oldIv.key);
    animateSvgOpacity(pill, 1, 0, 500).then(() => pill.remove());
}

export function animatePillAdd(trigger: any, timelineGroup: any, targetLayout: any) {
    const iv = trigger.newIv;
    const target = targetLayout.get(layoutKey(iv));
    const sub = iv.substance;
    const color = sub ? sub.color : 'rgba(245,180,60,0.7)';
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;

    const x1 = target ? target.x : phaseChartX(iv.timeMinutes);
    const barW = target ? target.w : Math.max(TIMELINE_ZONE.minBarW,
        Math.min(phaseChartX(Math.min(iv.timeMinutes + ((sub?.pharma?.duration) || 240), PHASE_CHART.endMin)) - x1, plotRight - x1));
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const y = target ? target.y : TIMELINE_ZONE.top;
    const h = TIMELINE_ZONE.laneH;
    const rx = TIMELINE_ZONE.pillRx;

    console.log('[Revision] ADD:', iv.key, `x=${x1.toFixed(0)} y=${y.toFixed(0)} w=${barW.toFixed(0)}`);

    const pillG = svgEl('g', {
        class: 'timeline-pill-group', opacity: '0',
        'data-substance-key': iv.key,
        'data-time-minutes': String(iv.timeMinutes),
    });

    pillG.appendChild(svgEl('rect', {
        x: x1.toFixed(1), y: y.toFixed(1),
        width: barW.toFixed(1), height: String(h),
        rx: String(rx), fill: color, 'fill-opacity': '0.22',
        stroke: color, 'stroke-opacity': '0.45', 'stroke-width': '0.75',
    }));

    const labelText = `${sub?.name || iv.key} ${iv.dose || ''}`;
    const labelEl = svgEl('text', {
        x: (x1 + 5).toFixed(1), y: (y + h / 2 + 3).toFixed(1),
        class: 'timeline-bar-label', fill: color, 'font-size': '9',
    });
    labelEl.textContent = labelText;
    // Rx badge as inline tspan after label text
    const regStatus = sub ? (sub.regulatoryStatus || '').toLowerCase() : '';
    if (regStatus === 'rx' || regStatus === 'controlled') {
        const rxSpan = svgEl('tspan', {
            fill: '#e11d48', 'font-size': '7', 'font-weight': '700',
            dy: '-0.5',
        });
        rxSpan.textContent = ' Rx';
        labelEl.appendChild(rxSpan);
    }
    pillG.appendChild(labelEl);

    timelineGroup.appendChild(pillG);
    animateSvgOpacity(pillG, 0, 1, 500);
}

/** Build layout key for target position map */
export function layoutKey(iv: any) {
    return `${iv.key}@${iv.timeMinutes}`;
}

/** Pre-compute target layout from allocateTimelineLanes → Map<key@time, {x,y,w,laneIdx}> */
export function buildTargetLayout(newInterventions: any) {
    const allocated = allocateTimelineLanes(newInterventions);
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const map = new Map();

    for (const item of allocated) {
        const { iv, laneIdx, startMin, endMin } = item;
        const x = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const w = Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - x), plotRight - x);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        map.set(layoutKey(iv), { x, y, w, laneIdx });
    }
    return map;
}

export function animatePillDiffEntry(trigger: any, timelineGroup: any, curvesData: any, targetLayout: any) {
    switch (trigger.type) {
        case 'moved': animatePillMove(trigger, timelineGroup, targetLayout); break;
        case 'resized': animatePillResize(trigger, timelineGroup, targetLayout); break;
        case 'replaced': animatePillFlip(trigger, timelineGroup, targetLayout); break;
        case 'removed': animatePillRemove(trigger, timelineGroup); break;
        case 'added': animatePillAdd(trigger, timelineGroup, targetLayout); break;
    }
}

// ---- Revision Pick-and-Place Animation ----

/**
 * Shuffle array in-place (Fisher-Yates).
 */
export function shuffleArray(arr: any) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Create animated targeting brackets around a pill.
 * Returns { group, animateIn(), animateOut() }
 */
export function createTargetBrackets(svg: any, pillBBox: any, color: any) {
    const PAD = 22;      // start wide
    const SNUG = 4;      // end snug
    const CORNER = 8;    // bracket arm length
    const STROKE_W = 1.5;
    const cx = pillBBox.x + pillBBox.width / 2;
    const cy = pillBBox.y + pillBBox.height / 2;
    const isLight = document.body.classList.contains('light-mode');

    const g = svgEl('g', { class: 'revision-target-brackets', opacity: '0' });

    // Glow backdrop (soft rect behind pill)
    const glow = svgEl('rect', {
        x: (pillBBox.x - 6).toFixed(1), y: (pillBBox.y - 4).toFixed(1),
        width: (pillBBox.width + 12).toFixed(1), height: (pillBBox.height + 8).toFixed(1),
        rx: '4', fill: color, 'fill-opacity': '0', 'pointer-events': 'none',
    });
    g.appendChild(glow);

    // 4 corner brackets (each is a polyline: L-shape)
    const bracketStyle: any = {
        fill: 'none', stroke: isLight ? '#b45309' : '#fbbf24',
        'stroke-width': String(STROKE_W), 'stroke-linecap': 'round',
        'pointer-events': 'none',
    };

    const tl = svgEl('polyline', { ...bracketStyle, class: 'bracket-tl' });
    const tr = svgEl('polyline', { ...bracketStyle, class: 'bracket-tr' });
    const bl = svgEl('polyline', { ...bracketStyle, class: 'bracket-bl' });
    const br = svgEl('polyline', { ...bracketStyle, class: 'bracket-br' });
    g.appendChild(tl); g.appendChild(tr); g.appendChild(bl); g.appendChild(br);

    // Crosshair dot in center
    const dot = svgEl('circle', {
        cx: cx.toFixed(1), cy: cy.toFixed(1), r: '1.5',
        fill: isLight ? '#b45309' : '#fbbf24', opacity: '0',
    });
    g.appendChild(dot);

    svg.appendChild(g);

    function setBracketPositions(pad: number) {
        const L = pillBBox.x - pad;
        const R = pillBBox.x + pillBBox.width + pad;
        const T = pillBBox.y - pad;
        const B = pillBBox.y + pillBBox.height + pad;
        const c = CORNER;
        tl.setAttribute('points', `${L},${T + c} ${L},${T} ${L + c},${T}`);
        tr.setAttribute('points', `${R - c},${T} ${R},${T} ${R},${T + c}`);
        bl.setAttribute('points', `${L},${B - c} ${L},${B} ${L + c},${B}`);
        br.setAttribute('points', `${R - c},${B} ${R},${B} ${R},${B - c}`);
    }

    return {
        group: g,
        /** Animate brackets from wide to snug + glow fade in (350ms) */
        animateIn() {
            return new Promise<void>(resolve => {
                g.setAttribute('opacity', '1');
                const start = performance.now();
                const DUR = 350;
                (function tick(now: number) {
                    const rawT = Math.min(1, (now - start) / DUR);
                    const ease = 1 - Math.pow(1 - rawT, 3); // ease-out cubic
                    const pad = PAD + (SNUG - PAD) * ease;
                    setBracketPositions(pad);
                    glow.setAttribute('fill-opacity', (0.08 * ease).toFixed(3));
                    dot.setAttribute('opacity', (ease * 0.7).toFixed(2));
                    // Bracket stroke opacity ramps in
                    const strokeOp = (0.3 + 0.7 * ease).toFixed(2);
                    [tl, tr, bl, br].forEach((b: any) => b.setAttribute('stroke-opacity', strokeOp));
                    if (rawT < 1) requestAnimationFrame(tick);
                    else resolve();
                })(performance.now());
            });
        },
        /** Fade out brackets + glow (200ms) */
        animateOut() {
            return animateSvgOpacity(g, 1, 0, 200).then(() => g.remove());
        },
    };
}

/**
 * Brief amber/gold flash on a pill (action fire indicator).
 */
export function flashPill(pill: any, duration = 250) {
    const bar = pill.querySelector('.timeline-bar') || pill.querySelector('rect');
    if (!bar) return Promise.resolve();
    const origFillOp = bar.getAttribute('fill-opacity') || '0.22';
    const origStrokeOp = bar.getAttribute('stroke-opacity') || '0.45';
    const isLight = document.body.classList.contains('light-mode');
    const flashColor = isLight ? '#b45309' : '#fbbf24';
    const origFill = bar.getAttribute('fill');
    const origStroke = bar.getAttribute('stroke');

    return new Promise<void>(resolve => {
        // Flash on
        bar.setAttribute('fill', flashColor);
        bar.setAttribute('fill-opacity', '0.5');
        bar.setAttribute('stroke', flashColor);
        bar.setAttribute('stroke-opacity', '0.9');
        bar.setAttribute('stroke-width', '2');

        setTimeout(() => {
            // Flash off — restore
            bar.setAttribute('fill', origFill);
            bar.setAttribute('fill-opacity', origFillOp);
            bar.setAttribute('stroke', origStroke);
            bar.setAttribute('stroke-opacity', origStrokeOp);
            bar.setAttribute('stroke-width', '0.75');
            resolve();
        }, duration);
    });
}

/**
 * Get bounding box of a pill relative to the SVG coordinate system.
 */
export function getPillBBox(pill: any) {
    try {
        const bar = pill.querySelector('.timeline-bar') || pill.querySelector('rect');
        if (bar) {
            return {
                x: parseFloat(bar.getAttribute('x')),
                y: parseFloat(bar.getAttribute('y')),
                width: parseFloat(bar.getAttribute('width')),
                height: parseFloat(bar.getAttribute('height')),
            };
        }
        return pill.getBBox();
    } catch { return { x: 100, y: 460, width: 60, height: 20 }; }
}

function getPillParts(pill: any) {
    if (!pill) return { bar: null as any, label: null as any };
    const bar = pill.querySelector('.timeline-bar') || pill.querySelector('rect[rx]') || pill.querySelector('rect');
    const label = pill.querySelector('.timeline-bar-label');
    return { bar, label };
}

function getPillAnchorX(pill: any) {
    if (!pill) return PHASE_CHART.padL;
    const box = getPillBBox(pill);
    return box.x + box.width / 2;
}

function animatePillAddIn(newPill: any, duration = 700) {
    if (!newPill) return Promise.resolve();
    const { bar, label } = getPillParts(newPill);
    if (!bar) return animateSvgOpacity(newPill, 0, 1, Math.min(duration, 400));

    const target = getPillBBox(newPill);
    const startW = Math.max(1, target.width * 0.06);
    const startX = target.x + target.width / 2 - startW / 2;
    const labelTargetX = parseFloat(label?.getAttribute('x') || `${target.x + 5}`);
    const labelTargetY = parseFloat(label?.getAttribute('y') || `${target.y + target.height / 2 + 3}`);

    bar.setAttribute('x', startX.toFixed(1));
    bar.setAttribute('width', startW.toFixed(1));
    if (label) {
        label.setAttribute('opacity', '0');
        label.setAttribute('x', (startX + 5).toFixed(1));
        label.setAttribute('y', labelTargetY.toFixed(1));
    }
    newPill.setAttribute('opacity', '0.12');
    newPill.classList.add('revision-introduced');

    return new Promise<void>(resolve => {
        const start = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - start) / duration);
            const ease = 1 - Math.pow(1 - rawT, 3); // ease-out cubic
            const w = startW + (target.width - startW) * ease;
            const x = target.x + target.width / 2 - w / 2;

            bar.setAttribute('x', x.toFixed(1));
            bar.setAttribute('width', w.toFixed(1));

            const pillOpacity = 0.12 + 0.88 * Math.min(1, rawT * 1.15);
            newPill.setAttribute('opacity', pillOpacity.toFixed(3));

            if (label) {
                const labelEase = Math.max(0, Math.min(1, (rawT - 0.2) / 0.8));
                const lx = (x + 5) + (labelTargetX - (x + 5)) * labelEase;
                label.setAttribute('x', lx.toFixed(1));
                label.setAttribute('opacity', labelEase.toFixed(3));
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                bar.setAttribute('x', target.x.toFixed(1));
                bar.setAttribute('width', target.width.toFixed(1));
                if (label) {
                    label.setAttribute('x', labelTargetX.toFixed(1));
                    label.setAttribute('y', labelTargetY.toFixed(1));
                    label.setAttribute('opacity', '1');
                }
                newPill.setAttribute('opacity', '1');
                newPill.classList.remove('revision-introduced');
                resolve();
            }
        })(performance.now());
    });
}

function animatePillRemoveOut(oldPill: any, duration = 520) {
    if (!oldPill) return Promise.resolve();
    const { bar, label } = getPillParts(oldPill);
    if (!bar) return animateSvgOpacity(oldPill, 1, 0, duration);

    const from = getPillBBox(oldPill);
    oldPill.classList.add('revision-mutating');

    return new Promise<void>(resolve => {
        const start = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - start) / duration);
            const ease = 1 - Math.pow(1 - rawT, 3);
            const w = Math.max(0.8, from.width * (1 - ease));
            const x = from.x + (from.width - w) * 0.5;
            const y = from.y + ease * 3;
            const opacity = 1 - ease;

            bar.setAttribute('x', x.toFixed(1));
            bar.setAttribute('y', y.toFixed(1));
            bar.setAttribute('width', w.toFixed(1));
            oldPill.setAttribute('opacity', opacity.toFixed(3));

            if (label) {
                label.setAttribute('opacity', Math.max(0, 1 - ease * 1.6).toFixed(3));
                label.setAttribute('x', (x + 5).toFixed(1));
                label.setAttribute('y', (y + from.height / 2 + 3).toFixed(1));
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                oldPill.setAttribute('opacity', '0');
                oldPill.classList.remove('revision-mutating');
                resolve();
            }
        })(performance.now());
    });
}

function animatePillMutate(oldPill: any, newPill: any, type: any, duration = 720) {
    if (!oldPill && newPill) return animatePillAddIn(newPill, duration);
    if (!newPill && oldPill) return animatePillRemoveOut(oldPill, duration);
    if (!oldPill || !newPill) return Promise.resolve();

    const { bar: oldBar, label: oldLabel } = getPillParts(oldPill);
    if (!oldBar) {
        const tasks: Promise<any>[] = [animateSvgOpacity(newPill, 0, 1, Math.min(duration, 420))];
        if (oldPill) tasks.push(animateSvgOpacity(oldPill, 1, 0, Math.min(duration, 420)));
        return Promise.all(tasks).then(() => undefined);
    }

    const from = getPillBBox(oldPill);
    const to = getPillBBox(newPill);
    const labelStartX = parseFloat(oldLabel?.getAttribute('x') || `${from.x + 5}`);
    const labelStartY = parseFloat(oldLabel?.getAttribute('y') || `${from.y + from.height / 2 + 3}`);
    const labelTargetX = parseFloat((newPill.querySelector('.timeline-bar-label') as any)?.getAttribute('x') || `${to.x + 5}`);
    const labelTargetY = parseFloat((newPill.querySelector('.timeline-bar-label') as any)?.getAttribute('y') || `${to.y + to.height / 2 + 3}`);
    const oldFill = oldBar.getAttribute('fill');
    const oldStroke = oldBar.getAttribute('stroke');
    const newBar = getPillParts(newPill).bar;
    const newFill = newBar?.getAttribute('fill') || oldFill;
    const newStroke = newBar?.getAttribute('stroke') || oldStroke;
    let recolored = false;

    newPill.setAttribute('opacity', '0');
    oldPill.classList.add('revision-mutating');
    newPill.classList.add('revision-introduced');

    const morphOld = new Promise<void>(resolve => {
        const start = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - start) / duration);
            const ease = rawT < 0.5
                ? 2 * rawT * rawT
                : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

            const x = from.x + (to.x - from.x) * ease;
            const y = from.y + (to.y - from.y) * ease;
            const w = from.width + (to.width - from.width) * ease;
            const fadeT = Math.max(0, (rawT - 0.12) / 0.88);
            const opacity = 1 - fadeT;

            oldBar.setAttribute('x', x.toFixed(1));
            oldBar.setAttribute('y', y.toFixed(1));
            oldBar.setAttribute('width', Math.max(0.8, w).toFixed(1));
            oldPill.setAttribute('opacity', opacity.toFixed(3));

            if (oldLabel) {
                const lx = labelStartX + (labelTargetX - labelStartX) * ease;
                const ly = labelStartY + (labelTargetY - labelStartY) * ease;
                oldLabel.setAttribute('x', lx.toFixed(1));
                oldLabel.setAttribute('y', ly.toFixed(1));
                oldLabel.setAttribute('opacity', Math.max(0, 1 - fadeT * 1.25).toFixed(3));
            }

            if (type === 'replaced' && !recolored && rawT > 0.38) {
                if (newFill) oldBar.setAttribute('fill', newFill);
                if (newStroke) oldBar.setAttribute('stroke', newStroke);
                if (oldLabel && newFill) oldLabel.setAttribute('fill', newFill);
                recolored = true;
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                oldPill.setAttribute('opacity', '0');
                if (oldFill) oldBar.setAttribute('fill', oldFill);
                if (oldStroke) oldBar.setAttribute('stroke', oldStroke);
                oldPill.classList.remove('revision-mutating');
                resolve();
            }
        })(performance.now());
    });

    return morphOld
        .then(() => animateSvgOpacity(newPill, parseFloat(newPill.getAttribute('opacity') || '0'), 1, 140))
        .then(() => {
            newPill.classList.remove('revision-introduced');
        });
}

function animateRevisionDiffAction(entry: any, oldPill: any, newPill: any) {
    switch (entry?.type) {
        case 'added':
            return animatePillAddIn(newPill, 760);
        case 'removed':
            return animatePillRemoveOut(oldPill, 540);
        case 'moved':
            return animatePillMutate(oldPill, newPill, 'moved', 760);
        case 'resized':
            return animatePillMutate(oldPill, newPill, 'resized', 700);
        case 'replaced':
            return animatePillMutate(oldPill, newPill, 'replaced', 820);
        default: {
            const tasks: Promise<any>[] = [];
            if (oldPill) tasks.push(animateSvgOpacity(oldPill, 1, 0, 400));
            if (newPill) tasks.push(animateSvgOpacity(newPill, 0, 1, 400));
            return Promise.all(tasks).then(() => undefined);
        }
    }
}

function createRevisionDayScanLine(svg: any, timelineLayer: any, oldLayer: any, newLayer: any) {
    const isLight = document.body.classList.contains('light-mode');
    const lineColor = isLight ? 'rgba(180, 83, 9, 0.85)' : 'rgba(251, 191, 36, 0.9)';
    const coreColor = isLight ? 'rgba(146, 64, 14, 0.92)' : 'rgba(253, 224, 71, 0.95)';
    const glowColor = isLight ? 'rgba(180, 83, 9, 0.18)' : 'rgba(251, 191, 36, 0.2)';
    const markerColor = isLight ? '#b45309' : '#fbbf24';
    const HALO_BASE = 0.24;
    const SWEEP_SPEED_PX_PER_MS = 0.2; // ~4.1s across full plot width

    const boxes: any[] = [];
    const collect = (layer: any) => {
        if (!layer) return;
        layer.querySelectorAll('.timeline-pill-group').forEach((pill: any) => {
            const box = getPillBBox(pill);
            if (Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.height)) {
                boxes.push(box);
            }
        });
    };
    collect(oldLayer);
    collect(newLayer);

    const top = boxes.length > 0
        ? Math.min(...boxes.map((b: any) => b.y)) - 12
        : TIMELINE_ZONE.top - 12;
    const bottom = boxes.length > 0
        ? Math.max(...boxes.map((b: any) => b.y + b.height)) + 12
        : TIMELINE_ZONE.top + 6 * (TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap);
    const zoneH = Math.max(28, bottom - top);
    const dotY = top - 6;

    const g = svgEl('g', {
        class: 'revision-day-scan',
        opacity: '0',
        'pointer-events': 'none',
    });
    const glow = svgEl('rect', {
        class: 'revision-day-scan-glow',
        x: (PHASE_CHART.padL - 6).toFixed(1),
        y: top.toFixed(1),
        width: '14',
        height: zoneH.toFixed(1),
        fill: glowColor,
        rx: '7',
        opacity: '0.9',
    });
    const line = svgEl('rect', {
        class: 'revision-day-scan-line',
        x: (PHASE_CHART.padL - 1).toFixed(1),
        y: top.toFixed(1),
        width: '2',
        height: zoneH.toFixed(1),
        fill: lineColor,
        opacity: '0.9',
    });
    const core = svgEl('rect', {
        class: 'revision-day-scan-core',
        x: (PHASE_CHART.padL - 0.5).toFixed(1),
        y: top.toFixed(1),
        width: '1',
        height: zoneH.toFixed(1),
        fill: coreColor,
        opacity: '0.9',
    });
    const marker = svgEl('circle', {
        class: 'revision-day-scan-marker',
        cx: PHASE_CHART.padL.toFixed(1),
        cy: dotY.toFixed(1),
        r: '3.4',
        fill: markerColor,
        opacity: '0.92',
    });
    const halo = svgEl('circle', {
        class: 'revision-day-scan-halo',
        cx: PHASE_CHART.padL.toFixed(1),
        cy: dotY.toFixed(1),
        r: '7',
        fill: markerColor,
        opacity: String(HALO_BASE),
    });
    g.appendChild(glow);
    g.appendChild(line);
    g.appendChild(core);
    g.appendChild(marker);
    g.appendChild(halo);
    timelineLayer.appendChild(g);

    let currentX = PHASE_CHART.padL;
    const setX = (x: number) => {
        glow.setAttribute('x', (x - 7).toFixed(1));
        line.setAttribute('x', (x - 1).toFixed(1));
        core.setAttribute('x', (x - 0.5).toFixed(1));
        marker.setAttribute('cx', x.toFixed(1));
        halo.setAttribute('cx', x.toFixed(1));
    };

    return {
        async intro() {
            await animateSvgOpacity(g, 0, 1, 220);
        },
        async primeWithSleepContext(hasSleepContext: boolean) {
            if (!hasSleepContext) return;
            await this.pulse(280);
            await sleep(110);
            await this.pulse(220);
            await sleep(80);
        },
        async moveTo(x: number) {
            const targetX = Number.isFinite(x) ? x : currentX;
            const dist = Math.abs(targetX - currentX);
            if (dist < 0.6) {
                setX(targetX);
                currentX = targetX;
                return;
            }

            const duration = Math.max(120, Math.min(1300, dist / SWEEP_SPEED_PX_PER_MS));
            const start = performance.now();
            const fromX = currentX;

            await new Promise<void>(resolve => {
                (function tick(now: number) {
                    const rawT = Math.min(1, (now - start) / duration);
                    const xPos = fromX + (targetX - fromX) * rawT; // linear for scan feel
                    setX(xPos);
                    if (rawT < 1) requestAnimationFrame(tick);
                    else resolve();
                })(performance.now());
            });

            currentX = targetX;
        },
        pulse(duration = 240) {
            return new Promise<void>(resolve => {
                const start = performance.now();
                (function tick(now: number) {
                    const rawT = Math.min(1, (now - start) / duration);
                    const pulseT = rawT < 0.5 ? rawT / 0.5 : (1 - rawT) / 0.5;
                    const haloR = 7 + 9 * pulseT;
                    const haloOp = HALO_BASE + 0.58 * pulseT;
                    const lineOp = 0.72 + 0.26 * pulseT;
                    const glowOp = 0.78 + 0.22 * pulseT;
                    const glowW = 14 + 7 * pulseT;

                    halo.setAttribute('r', haloR.toFixed(2));
                    halo.setAttribute('opacity', haloOp.toFixed(3));
                    line.setAttribute('opacity', lineOp.toFixed(3));
                    core.setAttribute('opacity', Math.min(1, lineOp + 0.06).toFixed(3));
                    glow.setAttribute('opacity', glowOp.toFixed(3));
                    glow.setAttribute('width', glowW.toFixed(2));
                    glow.setAttribute('x', (currentX - glowW / 2).toFixed(1));

                    if (rawT < 1) {
                        requestAnimationFrame(tick);
                    } else {
                        halo.setAttribute('r', '7');
                        halo.setAttribute('opacity', String(HALO_BASE));
                        line.setAttribute('opacity', '0.9');
                        core.setAttribute('opacity', '0.9');
                        glow.setAttribute('opacity', '0.9');
                        glow.setAttribute('width', '14');
                        glow.setAttribute('x', (currentX - 7).toFixed(1));
                        resolve();
                    }
                })(performance.now());
            });
        },
        async sweepToDayEnd() {
            await this.moveTo(PHASE_CHART.padL + PHASE_CHART.plotW);
        },
        async outro() {
            const from = parseFloat(g.getAttribute('opacity') || '1');
            await animateSvgOpacity(g, from, 0, 220);
            g.remove();
        },
        remove() {
            g.remove();
        },
    };
}

/**
 * Main revision animation: mechanistic pick-and-place.
 *
 * Flow:
 *   1. If sleep biometrics are present, apply an immediate sleep-informed batch revision.
 *   2. Then run a daytime scan line left→right through the strip.
 *   3. When the scan touches a substance time, target brackets lock on and action fires.
 *   4. Scan continues through the day to show realtime forward adjustments.
 * After all individual actions, a silent re-render ensures DOM consistency.
 */
export async function animateRevisionScan(diff: any, newInterventions: any, newLxCurves: any, curvesData: any, narration?: { intro: string; beats: any[]; outro: string } | null) {
    const svg = document.getElementById('phase-chart-svg');
    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (!svg || !timelineGroup) return;

    console.log('[Revision] Diff:', diff.length, diff.map((d: any) => `${d.type}: ${(d.oldIv || d.newIv).key}`));

    // If no changes, skip animation entirely
    if (diff.length === 0) {
        renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
        preserveBiometricStrips();
        revealTimelinePillsInstant();
        return;
    }

    revealTimelinePillsInstant();

    // 1. Snapshot the OLD pills into a temp group so they are preserved visually
    const tempGroup = svgEl('g', { id: 'phase-substance-timeline-old' });
    const oldPills = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group'));
    oldPills.forEach(pill => tempGroup.appendChild(pill));
    svg.insertBefore(tempGroup, timelineGroup);

    // 2. Clear and render the NEW layout completely invisibly
    renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
    const newPills = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group'));
    newPills.forEach((pill: any) => pill.setAttribute('opacity', '0'));

    // We must restore biometric strips which get destroyed by renderSubstanceTimeline
    preserveBiometricStrips();

    const sherlockCtx = { sherlockRevisionNarration: narration, revisionDiff: diff, curvesData } as any;
    const cards = buildSherlockRevisionCards(sherlockCtx);

    // Show Sherlock panel
    if (cards.length > 0) {
        showNarrationPanel();
    }

    const dayScan = createRevisionDayScanLine(svg, timelineGroup, tempGroup, timelineGroup);
    await dayScan.intro();
    let cursorClosed = false;

    try {
        const hasSleepContext = (BiometricState.channels || []).some((ch: any) => {
            const sig = String(ch?.signal || '').toLowerCase();
            return sig.startsWith('sleep_') || sig.includes('sleep');
        });
        await dayScan.primeWithSleepContext(hasSleepContext);

        const SLEEP_BATCH_CUTOFF_MIN = 11 * 60; // 11:00
        const sleepBatchIndices = new Set<number>();
        if (hasSleepContext) {
            diff.forEach((entry: any, idx: number) => {
                const iv = entry.oldIv || entry.newIv;
                const tMin = iv?.timeMinutes;
                if (Number.isFinite(tMin) && tMin <= SLEEP_BATCH_CUTOFF_MIN) {
                    sleepBatchIndices.add(idx);
                }
            });
            // Ensure sleep context has visible immediate impact even if all changes are later in the day.
            if (sleepBatchIndices.size === 0 && diff.length > 0) {
                sleepBatchIndices.add(0);
            }
        }

        const applyRevisionEntry = async (entry: any, beatIdx: number, withSweep: boolean) => {
            const { oldIv, newIv } = entry;
            const iv = oldIv || newIv;

            const oldPill = oldIv ? findPillByIntervention(oldIv, tempGroup) : null;
            const newPill = newIv ? findPillByIntervention(newIv, timelineGroup) : null;

            if (withSweep) {
                const anchorX = phaseChartX((iv?.timeMinutes ?? PHASE_CHART.startMin));
                await dayScan.moveTo(anchorX);
                await dayScan.pulse(200);
            }

            if (cards.length > beatIdx) {
                showSherlockStack(cards, beatIdx);
            }

            if (oldPill) await flashPill(oldPill, 130);
            await animateRevisionDiffAction(entry, oldPill, newPill);

            // Mark them as handled so we don't fade them again in the final step
            if (oldPill) oldPill.setAttribute('data-handled', 'true');
            if (newPill) newPill.setAttribute('data-handled', 'true');

            await sleep(150);
        };

        // 3a. Sleep-informed batch revision before daytime starts
        if (sleepBatchIndices.size > 0) {
            await dayScan.pulse(300);
            for (let idx = 0; idx < diff.length; idx++) {
                if (!sleepBatchIndices.has(idx)) continue;
                await applyRevisionEntry(diff[idx], idx, false);
            }
        }

        // 3b. Daytime sweep: process remaining future updates as scan line reaches them
        for (let idx = 0; idx < diff.length; idx++) {
            if (sleepBatchIndices.has(idx)) continue;
            await applyRevisionEntry(diff[idx], idx, true);
        }

        await dayScan.sweepToDayEnd();

        // 4. Cleanup with lane stability:
        // keep unchanged pills on their existing rows (old layer),
        // and only keep new-layer pills for actual changes.
        const newPillsByKeyTime = new Map<string, any[]>();
        newPills.forEach((pill: any) => {
            const key = pill.getAttribute('data-substance-key') || '';
            const time = pill.getAttribute('data-time-minutes') || '';
            const mapKey = `${key}@${time}`;
            if (!newPillsByKeyTime.has(mapKey)) newPillsByKeyTime.set(mapKey, []);
            newPillsByKeyTime.get(mapKey)!.push(pill);
        });

        Array.from(tempGroup.children).forEach((pill: any) => {
            if (pill.getAttribute('data-handled')) return;
            const key = pill.getAttribute('data-substance-key') || '';
            const time = pill.getAttribute('data-time-minutes') || '';
            const mapKey = `${key}@${time}`;
            const candidates = newPillsByKeyTime.get(mapKey);
            if (candidates && candidates.length > 0) {
                const dupNew = candidates.shift();
                dupNew?.remove();
            }
            pill.setAttribute('opacity', '1');
            pill.removeAttribute('data-handled');
            timelineGroup.appendChild(pill);
        });

        const cleanupAnims: Promise<any>[] = [];
        Array.from(timelineGroup.querySelectorAll('.timeline-pill-group')).forEach((pill: any) => {
            const handled = !!pill.getAttribute('data-handled');
            if (handled) {
                const op = parseFloat(pill.getAttribute('opacity') || '0');
                if (op < 1) cleanupAnims.push(animateSvgOpacity(pill, op, 1, 180));
            }
            pill.removeAttribute('data-handled');
        });

        await Promise.all(cleanupAnims);

        if (narration?.outro && cards.length > 0) {
            showSherlockStack(cards, cards.length - 1);
        }

        await dayScan.outro();
        if (cards.length > 0) {
            enableSherlockScrollMode();
        }
        cursorClosed = true;
    } finally {
        if (!cursorClosed) dayScan.remove();
        tempGroup.remove();
    }
}

// ---- Lx Curve Morph After Revision ----

export async function morphLxCurvesToRevision(oldLxCurves: any, newLxCurves: any, curvesData: any) {
    const lxGroup = document.getElementById('phase-lx-curves');
    if (!lxGroup) return;
    const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
    const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');

    const MORPH_DURATION = 1200;

    await new Promise<void>(resolve => {
        const startTime = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / MORPH_DURATION);
            const ease = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

            for (let ci = 0; ci < curvesData.length; ci++) {
                const oldPts = oldLxCurves[ci]?.points || [];
                const newPts = newLxCurves[ci]?.points || [];
                const len = Math.min(oldPts.length, newPts.length);
                if (len === 0) continue;

                const morphed: any[] = [];
                for (let j = 0; j < len; j++) {
                    morphed.push({
                        hour: oldPts[j].hour,
                        value: oldPts[j].value + (newPts[j].value - oldPts[j].value) * ease,
                    });
                }

                if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
                if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        })(performance.now());
    });

    // Update peak descriptors at new Lx positions
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

// ---- Revision Orchestrator ----

export async function handleRevisionPhase(curvesData: any) {
    const userGoal = (document.getElementById('prompt-input') as HTMLInputElement).value.trim();

    // 1. Fire revision LLM in background
    RevisionState.phase = 'pending';
    RevisionState.revisionPromise = callRevisionModel(userGoal, curvesData).catch((err: any) => {
        console.error('[Revision] LLM error:', err.message);
        return null;
    });

    // 2. Show play button (loading state)
    showRevisionPlayButton();

    // 3. When LLM resolves, mark as ready
    RevisionState.revisionPromise.then((result: any) => {
        RevisionState.revisionResult = result;
        if (result) {
            RevisionState.phase = 'ready';
            setRevisionPlayReady();
        }
    });

    // 4. Wait for play button click
    await new Promise<void>(resolve => {
        const btn = document.getElementById('revision-play-btn');
        if (!btn) { resolve(); return; }

        btn.addEventListener('click', async () => {
            // If LLM hasn't returned yet, wait
            if (RevisionState.phase === 'pending') {
                btn.classList.add('loading');
                const result = await RevisionState.revisionPromise;
                if (!result) {
                    console.error('[Revision] No result from LLM.');
                    hideRevisionPlayButton();
                    resolve();
                    return;
                }
                RevisionState.revisionResult = result;
            }

            hideRevisionPlayButton();
            RevisionState.phase = 'animating';

            // 5. Validate old & new interventions
            const rawOld = PhaseState.interventionResult.interventions || [];
            const rawNew = RevisionState.revisionResult.interventions || [];
            console.log('[Revision] Raw old interventions:', rawOld.length, rawOld.map((iv: any) => iv.key));
            console.log('[Revision] Raw new interventions:', rawNew.length, rawNew.map((iv: any) => iv.key));

            const oldIvs = validateInterventions(rawOld, curvesData);
            const newIvs = validateInterventions(rawNew, curvesData);
            console.log('[Revision] Validated old:', oldIvs.length, oldIvs.map((iv: any) => `${iv.key}@${iv.timeMinutes}min ${iv.dose}`));
            console.log('[Revision] Validated new:', newIvs.length, newIvs.map((iv: any) => `${iv.key}@${iv.timeMinutes}min ${iv.dose}`));

            RevisionState.oldInterventions = oldIvs;
            RevisionState.newInterventions = newIvs;

            // 6. Diff
            const diff = diffInterventions(oldIvs, newIvs);
            RevisionState.diff = diff;
            console.log('[Revision] Diff entries:', diff.length, diff.map((d: any) => `${d.type}: ${(d.oldIv || d.newIv).key}`));

            // 7. Compute new Lx overlay + fire Sherlock revision narration in parallel
            const oldLxCurves = PhaseState.lxCurves;
            const newLxCurves = computeLxOverlay(newIvs, curvesData);
            RevisionState.newLxCurves = newLxCurves;

            let sherlockRevPromise: Promise<any> | null = null;
            if (SherlockState.enabled && diff.length > 0) {
                sherlockRevPromise = callSherlockRevisionModel(
                    userGoal, oldIvs, newIvs, diff, curvesData
                ).catch(err => {
                    console.warn('[Sherlock] Revision narration failed:', err);
                    return null;
                });
            }

            const revisionNarration = sherlockRevPromise ? await sherlockRevPromise : null;
            SherlockState.revisionNarrationResult = revisionNarration;

            // Populate engine context before building Phase 4 segments
            _onRevisionPlayContext?.(revisionNarration);
            const revisionEngine = TimelineState.engine;
            const revisionStartTime = revisionEngine?.getCurrentTime() ?? null;
            _onRevisionPlay?.(diff);
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

            // 8. Scan sweep → fade old → re-render new → staggered reveal
            await animateRevisionScan(diff, newIvs, newLxCurves, curvesData, revisionNarration);

            // 9. Morph Lx curves to revised positions
            await morphLxCurvesToRevision(oldLxCurves, newLxCurves, curvesData);

            // 10. Sync engine playhead to complete Phase 4
            if (revisionPlayheadRafId != null) {
                cancelAnimationFrame(revisionPlayheadRafId);
            }
            TimelineState.engine?.advanceTimeTo(TimelineState.cursor);

            // 11. Update global state
            PhaseState.lxCurves = newLxCurves;
            PhaseState.interventionResult = RevisionState.revisionResult;
            PhaseState.incrementalSnapshots = computeIncrementalLxOverlay(newIvs, curvesData);

            RevisionState.phase = 'rendered';
            PhaseState.phase = 'revision-rendered';
            PhaseState.maxPhaseReached = 4;
            PhaseState.viewingPhase = 4;

            resolve();
        }, { once: true });
    });
}
