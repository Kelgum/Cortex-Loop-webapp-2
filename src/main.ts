import '../styles.css';

import { PHASE_CHART } from './constants';
import { AppState, PhaseState, DividerState } from './state';
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
    hidePhaseStepControls, updateStepButtons, showPhaseStepControls,
    initPhaseStepControls,
} from './phase-controls';
import {
    clearPromptError, showPromptError, resetPhaseChart,
    buildPhaseXAxis, buildPhaseYAxes, buildPhaseGrid,
    startScanLine, stopScanLine,
    renderBaselineCurvesInstant, renderBaselineCurves,
    renderPhaseLegend, morphToDesiredCurves,
    startTimelineScanLine, stopTimelineScanLine,
} from './phase-chart';
import { callFastModel, callMainModelForCurves, callInterventionModel } from './llm-pipeline';
import {
    validateInterventions, computeIncrementalLxOverlay,
    animateSequentialLxReveal,
} from './lx-system';
import { showBiometricTrigger, showInterventionPlayButton, hideInterventionPlayButton, hideRevisionPlayButton, injectBiometricDeps } from './biometric';
import { BiometricState, RevisionState } from './state';
import { DebugLog } from './debug-panel';

// ============================================
// Dependency Injection Wiring
// ============================================

injectPhaseChartDeps({ stopOrbitalRings, setOrbitalRingsState, setWordCloudPositions, hidePhaseStepControls, cleanupMorphDrag, hideBiometricTrigger: () => { try { (document.getElementById('biometric-trigger') as any)?.classList.add('hidden'); } catch {} }, hideInterventionPlayButton, hideRevisionPlayButton, BiometricState, RevisionState } as any);
injectLxDeps({ updateStepButtons });
injectBiometricDeps({ updateStepButtons, startBioScanLine, stopBioScanLine });

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

    clearPromptError();
    PhaseState.isProcessing = true;
    PhaseState.phase = 'loading';
    document.body.classList.add('phase-engaged');
    document.getElementById('prompt-hint').style.opacity = '0';
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = true;

    // Reset phase chart if resubmitting
    resetPhaseChart();

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
    buildPhaseXAxis();
    document.getElementById('phase-x-axis').classList.add('revealed');

    // === Fire both API calls in parallel ===
    const fastModelPromise = callFastModel(prompt);
    const mainModelPromise = callMainModelForCurves(prompt);

    // Start scanning line
    await sleep(400);
    startScanLine();
    PhaseState.phase = 'scanning';

    // === WORD CLOUD PHASE: Fast model returns 5-8 effects ===
    let wordCloudEffects;
    try {
        const fastResult = await fastModelPromise;
        const rawEffects = fastResult.effects || [];
        if (rawEffects.length === 0) throw new Error('Fast model returned no effects.');
        // Normalize: handle both new format [{name, relevance}] and legacy ["string"]
        wordCloudEffects = rawEffects.map(e =>
            typeof e === 'string' ? { name: e, relevance: 80 } : e
        );
        if (wordCloudEffects.length > 8) wordCloudEffects = wordCloudEffects.slice(0, 8);
    } catch (err) {
        stopScanLine();
        showPromptError(err instanceof Error ? err.message : String(err));
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    PhaseState.wordCloudEffects = wordCloudEffects;

    // Show word cloud + orbital rings (skip if too few effects)
    const cloudCx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
    const cloudCy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
    let hasCloud = false;

    if (wordCloudEffects.length >= 3) {
        PhaseState.phase = 'word-cloud';
        await renderWordCloud(wordCloudEffects);
        startOrbitalRings(cloudCx, cloudCy);
        hasCloud = true;
    }

    // === MAIN MODEL RETURNS: Transition to chart ===
    let curvesResult;
    try {
        curvesResult = await mainModelPromise;
    } catch (err) {
        stopScanLine();
        stopOrbitalRings();
        document.getElementById('phase-word-cloud').innerHTML = '';
        showPromptError(err instanceof Error ? err.message : String(err));
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    let curvesData = curvesResult.curves || [];
    if (curvesData.length === 0) {
        stopScanLine();
        stopOrbitalRings();
        document.getElementById('phase-word-cloud').innerHTML = '';
        showPromptError('Main model returned no curve data.');
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    // Stop scanning line
    stopScanLine();

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
    }

    PhaseState.curvesData = curvesData;
    PhaseState.phase = 'baseline-shown';
    PhaseState.maxPhaseReached = 0;
    PhaseState.viewingPhase = 0;

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

    // Morph baseline → desired
    await morphToDesiredCurves(curvesData);
    renderPhaseLegend(curvesData, 'full');

    PhaseState.phase = 'curves-drawn';
    PhaseState.maxPhaseReached = 1;
    PhaseState.viewingPhase = 1;
    showPhaseStepControls();
    updateStepButtons();

    // === SEQUENTIAL SUBSTANCE LAYERING ===
    // Start timeline scan line while waiting for intervention model
    startTimelineScanLine(3);

    // Wait for intervention model
    let interventionData = PhaseState.interventionResult;
    if (!interventionData && PhaseState.interventionPromise) {
        interventionData = await PhaseState.interventionPromise;
    }

    // Stop scan line — LLM has returned
    stopTimelineScanLine();

    if (!interventionData) {
        console.error('[Lx] No intervention data — model call failed or no API key.');
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }
    PhaseState.interventionResult = interventionData;

    const interventions = validateInterventions(interventionData.interventions || [], curvesData);
    if (interventions.length === 0) {
        PhaseState.isProcessing = false;
        (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;
        return;
    }

    // Compute incremental Lx overlays (one per substance step)
    const incrementalSnapshots = computeIncrementalLxOverlay(interventions, curvesData);
    PhaseState.incrementalSnapshots = incrementalSnapshots;
    PhaseState.lxCurves = incrementalSnapshots[incrementalSnapshots.length - 1].lxCurves;

    PhaseState.phase = 'lx-ready';

    // Show amber play button — wait for user to trigger the substance layup
    showInterventionPlayButton();
    PhaseState.isProcessing = false;
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;

    await new Promise<void>(resolve => {
        const btn = document.getElementById('intervention-play-btn');
        if (!btn) { resolve(); return; }
        btn.addEventListener('click', () => {
            hideInterventionPlayButton();
            resolve();
        }, { once: true });
    });

    PhaseState.isProcessing = true;
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = true;
    PhaseState.phase = 'lx-sequential';

    // Animate sequential substance reveal
    await animateSequentialLxReveal(incrementalSnapshots, interventions, curvesData);

    PhaseState.phase = 'lx-rendered';
    PhaseState.maxPhaseReached = 2;
    PhaseState.viewingPhase = 2;
    updateStepButtons();

    // Show biometric trigger after Lx completes
    await sleep(600);
    showBiometricTrigger();

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

export function initToggles() {
    const rxToggle = document.getElementById('toggle-rx') as HTMLInputElement;
    const controlledToggle = document.getElementById('toggle-controlled') as HTMLInputElement;

    rxToggle.addEventListener('change', () => {
        AppState.includeRx = rxToggle.checked;
    });

    controlledToggle.addEventListener('change', () => {
        AppState.includeControlled = controlledToggle.checked;
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
    // Defer cartridge initialization — not visible in phase chart flow
    // buildCartridgeSVG();
    // initTooltip();

    initThemeToggle();
    initSettings();
    initToggles();
    initDebugPanel();
    initPhaseStepControls();

    document.getElementById('prompt-form').addEventListener('submit', handlePromptSubmit);
    (document.getElementById('prompt-input') as HTMLElement).focus();

    document.getElementById('hint-example')?.addEventListener('click', (e) => {
        e.preventDefault();
        const input = document.getElementById('prompt-input') as HTMLInputElement;
        input.value = '4 hours of deep focus, no sleep impact';
        document.getElementById('prompt-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });

    // Prompt starts centered (class already set in HTML)
    // Cartridge section starts hidden (class already set in HTML)
});
