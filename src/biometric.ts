import { PHASE_CHART, TIMELINE_ZONE, BIOMETRIC_ZONE, API_ENDPOINTS } from './constants';
import { BiometricState, RevisionState, PhaseState, AppState } from './state';
import { svgEl, phaseChartX, phaseChartY, sleep, interpolatePrompt } from './utils';
import { callAnthropicGeneric, callOpenAIGeneric, callGeminiGeneric, getStageModel, callRevisionModel } from './llm-pipeline';
import { phasePointsToPath, phasePointsToFillPath } from './curve-utils';
import { placePeakDescriptors } from './phase-chart';
import { validateInterventions, computeLxOverlay, computeIncrementalLxOverlay, allocateTimelineLanes, renderSubstanceTimeline, preserveBiometricStrips, revealTimelinePillsInstant } from './lx-system';
import { DebugLog } from './debug-panel';
import { PROMPTS } from './prompts';

declare const BIOMETRIC_DEVICES: any;
declare const BIO_RED_PALETTE: string[] | undefined;

// ============================================
// Dependency injection for circular references
// ============================================

let _updateStepButtonsFn: any;
let _startBioScanLineFn: any;
let _stopBioScanLineFn: any;

export function injectBiometricDeps(d: any) {
    if (d.updateStepButtons) _updateStepButtonsFn = d.updateStepButtons;
    if (d.startBioScanLine) _startBioScanLineFn = d.startBioScanLine;
    if (d.stopBioScanLine) _stopBioScanLineFn = d.stopBioScanLine;
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
        fragments.push('moderate caffeine sensitivity');
    }

    // Sleep pattern — late sleeper + early substances = tension
    if (isFocus || isEnergy) {
        fragments.push('natural late sleeper (00:30–08:00)');
    } else if (isSleep) {
        fragments.push('light sleeper, wakes easily');
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
        fragments.push('elevated resting HR (~78 bpm)');
    } else if (isSleep) {
        fragments.push('low baseline HRV (~35ms)');
    } else if (isExercise) {
        fragments.push('resting HR 52 bpm, VO2max 48');
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
    return channels;
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

    const systemPrompt = interpolatePrompt(PROMPTS.biometric, {
        channelSpec: JSON.stringify(channelSpec),
        profileText: BiometricState.profileText,
        interventionSummary: buildInterventionSummary(),
        curveSummary: JSON.stringify(curveSummary),
    });

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
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.openai, systemPrompt, 16384);
                break;
            case 'grok':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.grok, systemPrompt, 16384);
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
        stage:        e.stage,
        stageClass:   e.stageClass,
        model:        e.model || null,
        duration:     e.duration || null,
        timestamp:    e.timestamp,
        systemPrompt: e.systemPrompt || null,
        userPrompt:   e.userPrompt || null,
        response:     e.response || null,
        parsed:       e.parsed || null,
        error:        e.error || null,
    }));
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
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

    // Start red scan line in the biometric zone while LLM is working
    _startBioScanLineFn?.();

    try {
        const result = await callBiometricModel(channelSpec);

        // Stop scan line before rendering strips
        _stopBioScanLineFn?.();
        await sleep(420); // wait for fade-out to finish

        if (!result || !Array.isArray(result.channels)) {
            console.error('[Biometric] Invalid LLM response — missing channels array');
            BiometricState.phase = 'idle';
            return;
        }

        // Validate channels: skip any with missing/short data
        const validChannels = result.channels.filter((ch: any) =>
            ch && ch.data && Array.isArray(ch.data) && ch.data.length >= 10 && ch.signal
        );

        if (validChannels.length === 0) {
            console.error('[Biometric] No valid channels in LLM response');
            BiometricState.phase = 'idle';
            return;
        }

        // Merge LLM-returned colors/ranges with the spec if missing
        for (const ch of validChannels) {
            const spec = channelSpec.find((s: any) => s.signal === ch.signal && s.device === ch.device);
            if (spec) {
                if (!ch.color) ch.color = spec.color;
                if (!ch.range) ch.range = spec.range;
                if (!ch.stripHeight) ch.stripHeight = spec.stripHeight;
                if (!ch.unit) ch.unit = spec.unit;
            }
        }

        BiometricState.biometricResult = result;
        BiometricState.channels = validChannels;
        BiometricState.phase = 'rendered';

        renderBiometricStrips(validChannels);
        await animateBiometricReveal(600);

        PhaseState.phase = 'biometric-rendered';
        PhaseState.maxPhaseReached = 3;
        PhaseState.viewingPhase = 3;
        _updateStepButtonsFn?.();

        // Kick off revision phase (Phase 4)
        await sleep(800);
        handleRevisionPhase(PhaseState.curvesData);

    } catch (err: any) {
        _stopBioScanLineFn?.();
        console.error('[Biometric] Pipeline error:', err.message);
        BiometricState.phase = 'idle';
    }
}

/**
 * Render biometric strips as oscilloscope-style waveforms below the substance timeline.
 */
export function renderBiometricStrips(channels: any, instant?: boolean) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;
    group.innerHTML = '';

    // Force red-shade palette on all channels regardless of LLM-returned colors
    const redShades = (typeof BIO_RED_PALETTE !== 'undefined') ? BIO_RED_PALETTE
        : ['#ff4d4d','#e03e3e','#c92a2a','#ff6b6b','#f76707','#d9480f','#ff8787','#e8590c','#fa5252','#b72b2b'];
    channels.forEach((ch: any, i: number) => { ch.color = redShades[i % redShades.length]; });

    const svg = document.getElementById('phase-chart-svg')!;
    const defs = svg.querySelector('defs')!;
    const currentVB = svg.getAttribute('viewBox')!.split(' ').map(Number);
    let currentH = currentVB[3];

    // Draw separator line
    const sepY = currentH + BIOMETRIC_ZONE.separatorPad;
    const sep = svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(sepY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(sepY),
        class: 'biometric-separator',
    });
    group.appendChild(sep);

    let yOffset = sepY + BIOMETRIC_ZONE.separatorPad;
    const laneStep = BIOMETRIC_ZONE.laneH + BIOMETRIC_ZONE.laneGap;

    channels.forEach((ch: any, i: number) => {
        const y = yOffset + i * laneStep;
        const h = ch.stripHeight || BIOMETRIC_ZONE.laneH;

        // Alternating lane background stripe
        if (i % 2 === 0) {
            const stripe = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(y),
                width: String(PHASE_CHART.plotW), height: String(h),
                fill: 'rgba(255, 255, 255, 0.015)',
                rx: '1',
            });
            group.appendChild(stripe);
        }

        // Left-margin label
        const label = svgEl('text', {
            x: String(PHASE_CHART.padL - 4),
            y: String(y + h / 2),
            class: 'bio-strip-label',
            fill: ch.color || 'rgba(238, 244, 255, 0.65)',
            'text-anchor': 'end',
        });
        label.textContent = ch.metric || ch.displayName || ch.signal;
        group.appendChild(label);

        // Build waveform
        const stripG = svgEl('g');
        if (ch.signal === 'hr_bpm') stripG.classList.add('bio-strip-hr');

        const { strokeD, fillD } = buildBiometricWaveformPath(ch.data, ch.range, y, h);

        // Fill path (semi-transparent)
        if (fillD) {
            const fillPath = svgEl('path', {
                d: fillD,
                class: 'bio-strip-fill',
                fill: ch.color || '#ff6b6b',
            });
            stripG.appendChild(fillPath);
        }

        // Stroke path
        const strokePath = svgEl('path', {
            d: strokeD,
            class: 'bio-strip-path',
            stroke: ch.color || '#ff6b6b',
        });
        stripG.appendChild(strokePath);

        // Clip path for animation (skipped when instant re-render)
        if (!instant) {
            const clipId = `bio-clip-${i}`;
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
    });

    // Expand viewBox to fit all strips
    const totalH = yOffset + channels.length * laneStep + BIOMETRIC_ZONE.bottomPad;
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

// ---- Intervention Play Button (amber/gold) ----

export function showInterventionPlayButton() {
    let btn = document.getElementById('intervention-play-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'intervention-play-btn';
        btn.className = 'intervention-play-btn hidden';
        btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
        document.querySelector('.phase-chart-container')!.appendChild(btn);
    }
    const svg = document.getElementById('phase-chart-svg');
    const top = svg ? svg.clientHeight + 16 : getBiometricTopOffset() + 16;
    (btn as HTMLElement).style.top = top + 'px';
    btn.classList.remove('hidden', 'loading');
    requestAnimationFrame(() => requestAnimationFrame(() => btn!.classList.add('visible')));
}

export function hideInterventionPlayButton() {
    const btn = document.getElementById('intervention-play-btn');
    if (!btn) return;
    btn.classList.remove('visible');
    setTimeout(() => btn.classList.add('hidden'), 500);
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
    pillG.appendChild(svgEl('text', {
        x: (x1 + 5).toFixed(1), y: (y + h / 2 + 3).toFixed(1),
        class: 'timeline-bar-label', fill: color, 'font-size': '9',
    })).textContent = labelText;

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
        case 'moved':    animatePillMove(trigger, timelineGroup, targetLayout); break;
        case 'resized':  animatePillResize(trigger, timelineGroup, targetLayout); break;
        case 'replaced': animatePillFlip(trigger, timelineGroup, targetLayout); break;
        case 'removed':  animatePillRemove(trigger, timelineGroup); break;
        case 'added':    animatePillAdd(trigger, timelineGroup, targetLayout); break;
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

/**
 * Main revision animation: mechanistic pick-and-place.
 *
 * For each changed substance (random order):
 *   1. Target brackets lock on
 *   2. Action fires (move / resize / replace / remove / add)
 *   3. Brackets dissolve
 * After all individual actions, a silent re-render ensures DOM consistency.
 */
export async function animateRevisionScan(diff: any, newInterventions: any, newLxCurves: any, curvesData: any) {
    const svg = document.getElementById('phase-chart-svg');
    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (!svg || !timelineGroup) return;

    console.log('[Revision] Diff:', diff.length, diff.map((d: any) => `${d.type}: ${(d.oldIv||d.newIv).key}`));

    // If no changes, skip animation entirely
    if (diff.length === 0) {
        renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
        preserveBiometricStrips();
        revealTimelinePillsInstant();
        return;
    }

    const targetLayout = buildTargetLayout(newInterventions);

    // Ensure all existing pills are visible before we start
    revealTimelinePillsInstant();

    // Shuffle for the "intelligent random" pick-and-place feel
    const shuffled = shuffleArray([...diff]);

    // ── Process each diff entry sequentially ──
    for (const entry of shuffled) {
        const { type, oldIv, newIv } = entry;
        const iv = oldIv || newIv;

        // --- STEP 1: TARGET — lock on with brackets ---
        let pill: any = null;
        let brackets: any = null;

        if (type === 'added') {
            // For additions, show brackets at the target position (no existing pill)
            const target = targetLayout.get(layoutKey(newIv));
            const bbox = target
                ? { x: target.x, y: target.y, width: target.w, height: TIMELINE_ZONE.laneH }
                : { x: phaseChartX(newIv.timeMinutes), y: TIMELINE_ZONE.top, width: 60, height: TIMELINE_ZONE.laneH };
            const color = newIv.substance?.color || '#fbbf24';
            brackets = createTargetBrackets(svg, bbox, color);
            await brackets.animateIn();
            await sleep(120);
        } else {
            // Find the existing pill
            pill = findPillByIntervention(oldIv, timelineGroup);
            if (!pill) {
                console.warn(`[Revision] ${type}: pill not found for`, iv.key);
                continue;
            }
            const bbox = getPillBBox(pill);
            const color = oldIv.substance?.color || '#fbbf24';
            brackets = createTargetBrackets(svg, bbox, color);
            await brackets.animateIn();
            await sleep(120);
        }

        // --- STEP 2: ACTION — perform the change ---
        switch (type) {
            case 'moved': {
                await flashPill(pill, 180);
                const target = targetLayout.get(layoutKey(newIv));
                const bar = pill.querySelector('.timeline-bar') || pill.querySelector('rect');
                if (bar && target) {
                    const oldX = parseFloat(bar.getAttribute('x'));
                    const oldY = parseFloat(bar.getAttribute('y'));
                    const dx = target.x - oldX;
                    const dy = target.y - oldY;
                    const oldW = parseFloat(bar.getAttribute('width'));
                    // Animate position + width simultaneously
                    const moveP = animateSvgTransform(pill, 0, 0, dx, dy, 650, 'ease-in-out');
                    const widthP = Math.abs(target.w - oldW) > 2
                        ? animateSvgWidth(bar, oldW, target.w, 650)
                        : Promise.resolve();
                    await Promise.all([moveP, widthP]);
                }
                // Update label
                const label = pill.querySelector('.timeline-bar-label');
                if (label) {
                    const name = newIv.substance?.name || newIv.key;
                    label.textContent = `${name} ${newIv.dose || ''}`;
                }
                pill.setAttribute('data-time-minutes', String(newIv.timeMinutes));
                break;
            }
            case 'resized': {
                await flashPill(pill, 180);
                const target = targetLayout.get(layoutKey(newIv));
                const bar = pill.querySelector('.timeline-bar') || pill.querySelector('rect');
                if (bar) {
                    const oldW = parseFloat(bar.getAttribute('width'));
                    const newW = target ? target.w : oldW;
                    const oldY = parseFloat(bar.getAttribute('y'));
                    const dy = target ? target.y - oldY : 0;
                    const widthP = Math.abs(newW - oldW) > 2
                        ? animateSvgWidth(bar, oldW, newW, 500)
                        : Promise.resolve();
                    const moveP = Math.abs(dy) > 1
                        ? animateSvgTransform(pill, 0, 0, 0, dy, 500, 'ease-in-out')
                        : Promise.resolve();
                    await Promise.all([widthP, moveP]);
                }
                const label = pill.querySelector('.timeline-bar-label');
                if (label) {
                    label.textContent = `${newIv.substance?.name || newIv.key} ${newIv.dose || ''}`;
                }
                break;
            }
            case 'replaced': {
                // Phase 1: flash + fade out old identity
                await flashPill(pill, 150);
                await animateSvgOpacity(pill, 1, 0.05, 250);
                // Phase 2: swap color/label at the invisible state
                const newSub = newIv.substance;
                const newColor = newSub ? newSub.color : 'rgba(245,180,60,0.7)';
                const bar = pill.querySelector('.timeline-bar') || pill.querySelector('rect');
                if (bar) {
                    bar.setAttribute('fill', newColor);
                    bar.setAttribute('stroke', newColor);
                    const target = targetLayout.get(layoutKey(newIv));
                    if (target) bar.setAttribute('width', target.w.toFixed(1));
                }
                const label = pill.querySelector('.timeline-bar-label');
                if (label) {
                    label.textContent = `${newSub?.name || newIv.key} ${newIv.dose || ''}`;
                }
                pill.setAttribute('data-substance-key', newIv.key);
                pill.setAttribute('data-time-minutes', String(newIv.timeMinutes));
                // Phase 3: fade back in with new identity
                await animateSvgOpacity(pill, 0.05, 1, 300);
                break;
            }
            case 'removed': {
                await flashPill(pill, 200);
                // Shrink + fade out
                await animateSvgOpacity(pill, 1, 0, 400);
                pill.remove();
                break;
            }
            case 'added': {
                // Build a minimal pill and animate it in
                const target = targetLayout.get(layoutKey(newIv));
                const sub = newIv.substance;
                const color = sub ? sub.color : 'rgba(245,180,60,0.7)';
                const x1 = target ? target.x : phaseChartX(newIv.timeMinutes);
                const y = target ? target.y : TIMELINE_ZONE.top;
                const w = target ? target.w : 60;
                const h = TIMELINE_ZONE.laneH;
                const rx = TIMELINE_ZONE.pillRx;

                const pillG = svgEl('g', {
                    class: 'timeline-pill-group', opacity: '0',
                    'data-substance-key': newIv.key,
                    'data-time-minutes': String(newIv.timeMinutes),
                });
                pillG.appendChild(svgEl('rect', {
                    x: x1.toFixed(1), y: y.toFixed(1),
                    width: w.toFixed(1), height: String(h),
                    rx: String(rx), fill: color, 'fill-opacity': '0.22',
                    stroke: color, 'stroke-opacity': '0.45', 'stroke-width': '0.75',
                    class: 'timeline-bar',
                }));
                const labelEl = svgEl('text', {
                    x: (x1 + 5).toFixed(1), y: (y + h / 2 + 3).toFixed(1),
                    class: 'timeline-bar-label',
                });
                labelEl.textContent = `${sub?.name || newIv.key} ${newIv.dose || ''}`;
                pillG.appendChild(labelEl);
                timelineGroup.appendChild(pillG);
                // Animate in: scale-up feel via opacity + subtle Y offset
                await animateSvgOpacity(pillG, 0, 1, 400);
                break;
            }
        }

        // --- STEP 3: SETTLE — dissolve brackets ---
        if (brackets) {
            await brackets.animateOut();
        }
        // Brief pause between entries for the staggered pick-and-place rhythm
        await sleep(80);
    }

    // ── Final: silent re-render for DOM consistency ──
    await sleep(200);
    renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
    preserveBiometricStrips();
    revealTimelinePillsInstant();
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
            console.log('[Revision] Diff entries:', diff.length, diff.map((d: any) => `${d.type}: ${(d.oldIv||d.newIv).key}`));

            // 7. Compute new Lx overlay
            const oldLxCurves = PhaseState.lxCurves;
            const newLxCurves = computeLxOverlay(newIvs, curvesData);
            RevisionState.newLxCurves = newLxCurves;

            // 8. Scan sweep → fade old → re-render new → staggered reveal
            await animateRevisionScan(diff, newIvs, newLxCurves, curvesData);

            // 9. Morph Lx curves to revised positions
            await morphLxCurvesToRevision(oldLxCurves, newLxCurves, curvesData);

            // 11. Update global state
            PhaseState.lxCurves = newLxCurves;
            PhaseState.interventionResult = RevisionState.revisionResult;
            PhaseState.incrementalSnapshots = computeIncrementalLxOverlay(newIvs, curvesData);

            RevisionState.phase = 'rendered';
            PhaseState.phase = 'revision-rendered';
            PhaseState.maxPhaseReached = 4;
            PhaseState.viewingPhase = 4;
            _updateStepButtonsFn?.();

            resolve();
        }, { once: true });
    });
}
