/**
 * Cortex Loop — Prompt-Driven Supplement Cartridge UI
 * Multi-LLM support: Claude, OpenAI, Grok, Gemini
 * Include toggles: Rx (prescription), Controlled (psychedelics, etc.)
 * 5-day capacity: each substance x 5 days, day-1 highlighted
 */

// ============================================
// 1. CONSTANTS & CONFIGURATION
// ============================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const CENTER = 400;
const FRONT_RADIUS = 220;
const BACK_RADIUS = 220;
const LABEL_RADIUS = 310;
const TIMING_ARC_RADIUS = 355;
const DAYS_IN_CARTRIDGE = 5;
const MAX_PER_LAYER = 20;

/**
 * Compute the shortest angular delta (CW or CCW) from one angle to another.
 * Returns a value in the range [-180, +180].
 */
function shortestAngleDelta(fromDeg, toDeg) {
    const delta = toDeg - fromDeg;
    return ((delta + 180) % 360 + 360) % 360 - 180;
}

const CartridgeConfig = {
    capsulesPerLayer: 13,
    totalCapsules: 26,
    angularSpacing: 360 / 13,
    halfSpacing: (360 / 13) / 2,
    frontCapsule: { width: 26, height: 60, rx: 13 },
    backCapsule: { width: 20, height: 48, rx: 10 },
    capsuleGroups: [],

    recalculate(perLayer) {
        this.capsulesPerLayer = perLayer;
        this.totalCapsules = perLayer * 2;
        this.angularSpacing = 360 / perLayer;
        this.halfSpacing = this.angularSpacing / 2;

        const arcLength = 2 * Math.PI * FRONT_RADIUS * (this.angularSpacing / 360);
        const frontW = Math.max(10, Math.min(26, arcLength * 0.50));
        const frontH = frontW * 2.3;
        this.frontCapsule = { width: frontW, height: frontH, rx: frontW / 2 };

        const backW = frontW * 0.77;
        const backH = frontH * 0.8;
        this.backCapsule = { width: backW, height: backH, rx: backW / 2 };
    },
};

// ============================================
// 2. SUBSTANCE DATABASE — loaded from Substance_DB.js (SUBSTANCE_DB)
// ============================================
// The unified SUBSTANCE_DB is loaded via <script src="Substance_DB.js">.
// Each entry uses: class (biology), regulatoryStatus (legality), color, standardDose,
// dataConfidence, dataNote, pharma {onset, peak, duration, halfLife, strength, rebound}.

// Map substance `class` values to display colors (used by legacy cartridge + fallback)
const CLASS_COLORS = {
    'Stimulant':            { fill: '#ff4757', glow: 'rgba(255,71,87,0.4)' },
    'Depressant/Sleep':     { fill: '#2f3542', glow: 'rgba(47,53,66,0.4)' },
    'Nootropic':            { fill: '#1e90ff', glow: 'rgba(30,144,255,0.4)' },
    'Adaptogen':            { fill: '#2ed573', glow: 'rgba(46,213,115,0.4)' },
    'Psychedelic/Atypical': { fill: '#9b59b6', glow: 'rgba(155,89,182,0.4)' },
    'Mineral/Electrolyte':  { fill: '#ffa502', glow: 'rgba(255,165,2,0.4)' },
    'Vitamin/Amino':        { fill: '#eccc68', glow: 'rgba(236,204,104,0.4)' },
    'Psychiatric/Other':    { fill: '#747d8c', glow: 'rgba(116,125,140,0.4)' },
    'unknown':              { fill: '#94a3b8', glow: 'rgba(148,163,184,0.4)' },
};
// Backward compat alias — old code references CATEGORY_COLORS
const CATEGORY_COLORS = CLASS_COLORS;

// Effect type groupings for chart curves (legacy effect chart uses these)
const EFFECT_TYPES = {
    'Focus & Cognition': { classes: ['Stimulant', 'Nootropic'],               color: '#60a5fa', glow: 'rgba(96,165,250,0.3)' },
    'Stress Resilience':  { classes: ['Adaptogen'],                            color: '#c084fc', glow: 'rgba(192,132,252,0.3)' },
    'Baseline Support':   { classes: ['Mineral/Electrolyte', 'Vitamin/Amino'], color: '#4ade80', glow: 'rgba(74,222,128,0.3)' },
    'Sedation':           { classes: ['Depressant/Sleep'],                     color: '#2dd4bf', glow: 'rgba(45,212,191,0.3)' },
    'Rx Effect':          { classes: ['Psychiatric/Other'],                    color: '#fb7185', glow: 'rgba(251,113,133,0.3)' },
    'Altered State':      { classes: ['Psychedelic/Atypical'],                 color: '#fbbf24', glow: 'rgba(251,191,36,0.3)' },
};

// Timing label → hour of day mapping
const TIMING_HOURS = { morning: 8, midday: 12, evening: 17, bedtime: 21 };

const TIMING_SEGMENTS = [
    { label: 'MORNING',  startAngle: -90,  endAngle: 0,    color: '#f59e0b' },
    { label: 'MIDDAY',   startAngle: 0,    endAngle: 90,   color: '#f97316' },
    { label: 'EVENING',  startAngle: 90,   endAngle: 180,  color: '#8b5cf6' },
    { label: 'BEDTIME',  startAngle: 180,  endAngle: 270,  color: '#06b6d4' },
];

// ============================================
// 3. FAST / MAIN MODEL CONFIGURATION
// ============================================

const FAST_MODELS = {
    anthropic: { model: 'claude-haiku-4-5-20251001', type: 'anthropic' },
    openai:    { model: 'gpt-4.1-nano',              type: 'openai' },
    grok:      { model: 'grok-3-mini-fast',           type: 'openai' },  // xAI uses OpenAI-compatible API
    gemini:    { model: 'gemini-2.5-flash-lite',      type: 'gemini' },
};

const MAIN_MODELS = {
    anthropic: 'claude-opus-4-6',
    openai:    'gpt-4o',
    grok:      'grok-3',
    gemini:    'gemini-2.0-flash',
};

const API_ENDPOINTS = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openai:    'https://api.openai.com/v1/chat/completions',
    grok:      'https://api.x.ai/v1/chat/completions',
};

// ============================================
// 3b. PHASE CHART CONFIGURATION
// ============================================

const PHASE_CHART = {
    viewW: 960, viewH: 500,
    padL: 70, padR: 70, padT: 62, padB: 50,
    startHour: 6, endHour: 30,   // 6:00am to 6:00am next day (30 = 24+6)
    maxEffect: 100,
    sampleInterval: 15,
};

PHASE_CHART.plotW = PHASE_CHART.viewW - PHASE_CHART.padL - PHASE_CHART.padR;
PHASE_CHART.plotH = PHASE_CHART.viewH - PHASE_CHART.padT - PHASE_CHART.padB;
PHASE_CHART.startMin = PHASE_CHART.startHour * 60;
PHASE_CHART.endMin = PHASE_CHART.endHour * 60;
PHASE_CHART.totalMin = PHASE_CHART.endMin - PHASE_CHART.startMin;

function phaseChartX(minutes) {
    return PHASE_CHART.padL + ((minutes - PHASE_CHART.startMin) / PHASE_CHART.totalMin) * PHASE_CHART.plotW;
}

function phaseChartY(effectVal) {
    const clamped = Math.max(0, Math.min(PHASE_CHART.maxEffect, effectVal));
    return PHASE_CHART.padT + PHASE_CHART.plotH - (clamped / PHASE_CHART.maxEffect) * PHASE_CHART.plotH;
}

// ============================================
// 4. APPLICATION STATE
// ============================================

// Load keys from config.js (gitignored) or fallback
const CONFIG_KEYS = (window.CORTEX_CONFIG && window.CORTEX_CONFIG.keys) || {};

const AppState = {
    currentStack: null,
    isLoading: false,
    isAnimating: false,
    capsuleElements: { front: [], back: [] },
    filledSlots: new Map(),
    tooltip: null,
    effectCurves: null,
    includeRx: false,
    includeControlled: false,
    maxEffects: parseInt(localStorage.getItem('cortex_max_effects')) || 2,
    selectedLLM: localStorage.getItem('cortex_llm') || 'anthropic',
    apiKeys: {
        anthropic: localStorage.getItem('cortex_key_anthropic') || CONFIG_KEYS.anthropic || '',
        openai:    localStorage.getItem('cortex_key_openai')    || CONFIG_KEYS.openai || '',
        grok:      localStorage.getItem('cortex_key_grok')      || CONFIG_KEYS.grok || '',
        gemini:    localStorage.getItem('cortex_key_gemini')     || CONFIG_KEYS.gemini || '',
    },
    // Per-stage model tier: 'fast' or 'main'
    stageModels: {
        fast:         localStorage.getItem('cortex_stage_fast')         || 'fast',
        curves:       localStorage.getItem('cortex_stage_curves')       || 'main',
        intervention: localStorage.getItem('cortex_stage_intervention') || 'main',
        biometric:    localStorage.getItem('cortex_stage_biometric')    || 'fast',
        revision:     localStorage.getItem('cortex_stage_revision')     || 'fast',
    },
};

/**
 * Resolve model name for a given pipeline stage.
 * Returns { model, provider, key } using the stage tier + selected provider.
 */
function getStageModel(stage) {
    const provider = AppState.selectedLLM;
    const tier = AppState.stageModels[stage] || 'main';
    const model = tier === 'fast' ? FAST_MODELS[provider].model : MAIN_MODELS[provider];
    return { model, provider, key: AppState.apiKeys[provider] };
}

// Phase chart flow state
const PhaseState = {
    isProcessing: false,
    effects: [],
    wordCloudEffects: [],       // [{name, relevance}, ...] from fast model
    curvesData: null,
    phase: 'idle',  // 'idle' | 'loading' | 'scanning' | 'word-cloud' | 'word-cloud-dismiss' | 'axes-revealed' | 'baseline-shown' | 'curves-drawn' | 'lx-sequential' | 'lx-rendered'
    interventionPromise: null,
    interventionResult: null,
    lxCurves: null,
    incrementalSnapshots: null, // array from computeIncrementalLxOverlay
    maxPhaseReached: -1,  // highest completed phase index (0/1/2)
    viewingPhase: -1,     // currently displayed phase index
};

const PHASE_STEPS = ['baseline-shown', 'curves-drawn', 'lx-rendered', 'biometric-rendered', 'revision-rendered'];

// Biometric Loop state
const BiometricState = {
    selectedDevices: [],
    profileText: '',
    biometricResult: null,
    channels: [],
    phase: 'idle',  // idle | selecting | profiling | loading | rendered
};

// Revision state (Phase 4 — chess player re-evaluates after biometric data)
const RevisionState = {
    revisionPromise: null,
    revisionResult: null,
    oldInterventions: null,
    newInterventions: null,
    diff: null,
    newLxCurves: null,
    phase: 'idle',  // idle | pending | ready | animating | rendered
};

// Effect divider state (split-screen for 2-effect mode)
const DividerState = {
    active: false,
    x: 480,             // SVG x-coord, default = center (maps to ~6pm)
    fadeWidth: 50,       // crossfade zone width in SVG pixels
    minOpacity: 0.12,    // ghost opacity on the "wrong" side
    elements: null,      // { group, line, glow, diamond, hitArea }
    masks: null,         // { leftGrad, rightGrad }
    dragging: false,
    dragCleanup: null,
};

// ============================================
// 3b. PROMPT TEMPLATE INTERPOLATION
// ============================================

function interpolatePrompt(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        vars[key] !== undefined ? vars[key] : `{{${key}}}`
    );
}

function chartTheme() {
    const light = document.body.classList.contains('light-mode');
    return light ? {
        grid:           'rgba(100, 130, 170, 0.22)',
        axisBoundary:   'rgba(80, 110, 150, 0.30)',
        axisLine:       'rgba(80, 110, 150, 0.55)',
        tickAnchor:     'rgba(50, 80, 120, 0.65)',
        tickNormal:     'rgba(80, 110, 150, 0.40)',
        labelAnchor:    'rgba(20, 40, 70, 0.92)',
        labelNormal:    'rgba(30, 50, 80, 0.70)',
        rulerLine:      'rgba(80, 110, 150, 0.30)',
        periodMorning:  'rgba(250, 200, 60, 0.10)',
        periodAfternoon:'rgba(240, 160, 50, 0.08)',
        periodEvening:  'rgba(180, 100, 200, 0.08)',
        periodNight:    'rgba(60, 80, 140, 0.10)',
        periodLabel:    'rgba(40, 60, 90, 0.50)',
        yTick:          'rgba(80, 110, 150, 0.40)',
        yLabel:         'rgba(40, 60, 90, 0.80)',
        yLabelDefault:  'rgba(30, 50, 80, 0.92)',
        tooltipBg:      'rgba(240, 243, 247, 0.88)',
        scanGlow:       'rgba(80, 100, 180, 0.10)',
        orbitalRing1:   'rgba(50, 100, 200, 0.4)',
        orbitalRing2:   'rgba(120, 70, 200, 0.4)',
        arrowhead:      'rgba(30, 50, 80, 0.7)',
    } : {
        grid:           'rgba(145, 175, 214, 0.17)',
        axisBoundary:   'rgba(174, 201, 237, 0.25)',
        axisLine:       'rgba(174, 201, 237, 0.58)',
        tickAnchor:     'rgba(174, 201, 237, 0.60)',
        tickNormal:     'rgba(174, 201, 237, 0.35)',
        labelAnchor:    'rgba(220, 235, 255, 0.95)',
        labelNormal:    'rgba(180, 200, 230, 0.70)',
        rulerLine:      'rgba(174, 201, 237, 0.25)',
        periodMorning:  'rgba(250, 200, 60, 0.07)',
        periodAfternoon:'rgba(240, 160, 50, 0.05)',
        periodEvening:  'rgba(180, 100, 220, 0.06)',
        periodNight:    'rgba(80, 100, 180, 0.08)',
        periodLabel:    'rgba(180, 200, 230, 0.45)',
        yTick:          'rgba(174, 201, 237, 0.35)',
        yLabel:         'rgba(167, 191, 223, 0.76)',
        yLabelDefault:  'rgba(171, 214, 255, 0.92)',
        tooltipBg:      'rgba(13, 17, 23, 0.8)',
        scanGlow:       'rgba(160, 160, 255, 0.08)',
        orbitalRing1:   'rgba(130, 170, 255, 0.4)',
        orbitalRing2:   'rgba(200, 150, 255, 0.4)',
        arrowhead:      'rgba(255, 255, 255, 0.7)',
    };
}

// ============================================
// 3c. EFFECT DIVIDER (split-screen for 2-effect mode)
// ============================================

/** Get or create a per-effect sub-group within a parent SVG group */
function getEffectSubGroup(parentGroup, effectIdx) {
    const id = `${parentGroup.id}-e${effectIdx}`;
    let sub = parentGroup.querySelector(`#${id}`);
    if (!sub) {
        sub = svgEl('g', { id });
        if (DividerState.active) {
            sub.setAttribute('mask',
                effectIdx === 0 ? 'url(#divider-mask-left)' : 'url(#divider-mask-right)');
        }
        parentGroup.appendChild(sub);
    }
    return sub;
}

/** Install SVG mask + gradient pairs into <defs> for the 2-effect divider */
function installDividerMasks() {
    const svg = document.getElementById('phase-chart-svg');
    const defs = svg.querySelector('defs');
    const minOp = DividerState.minOpacity;

    // Left gradient: opaque on left, fades to dim at divider
    const leftGrad = svgEl('linearGradient', {
        id: 'divider-grad-left', gradientUnits: 'userSpaceOnUse',
        x1: '0', y1: '0', x2: String(PHASE_CHART.viewW), y2: '0',
    });
    leftGrad.appendChild(svgEl('stop', { offset: '0', 'stop-color': 'white', 'stop-opacity': '1' }));
    leftGrad.appendChild(svgEl('stop', { offset: '0.45', 'stop-color': 'white', 'stop-opacity': '1' }));
    leftGrad.appendChild(svgEl('stop', { offset: '0.55', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    leftGrad.appendChild(svgEl('stop', { offset: '1', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    defs.appendChild(leftGrad);

    // Right gradient: dim on left, fades to opaque at divider
    const rightGrad = svgEl('linearGradient', {
        id: 'divider-grad-right', gradientUnits: 'userSpaceOnUse',
        x1: '0', y1: '0', x2: String(PHASE_CHART.viewW), y2: '0',
    });
    rightGrad.appendChild(svgEl('stop', { offset: '0', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    rightGrad.appendChild(svgEl('stop', { offset: '0.45', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    rightGrad.appendChild(svgEl('stop', { offset: '0.55', 'stop-color': 'white', 'stop-opacity': '1' }));
    rightGrad.appendChild(svgEl('stop', { offset: '1', 'stop-color': 'white', 'stop-opacity': '1' }));
    defs.appendChild(rightGrad);

    // Left mask
    const leftMask = svgEl('mask', {
        id: 'divider-mask-left', maskUnits: 'userSpaceOnUse',
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
    });
    leftMask.appendChild(svgEl('rect', {
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
        fill: 'url(#divider-grad-left)',
    }));
    defs.appendChild(leftMask);

    // Right mask
    const rightMask = svgEl('mask', {
        id: 'divider-mask-right', maskUnits: 'userSpaceOnUse',
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
    });
    rightMask.appendChild(svgEl('rect', {
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
        fill: 'url(#divider-grad-right)',
    }));
    defs.appendChild(rightMask);

    DividerState.masks = { leftGrad, rightGrad };
}

/** Update mask gradient stop offsets based on divider x position */
function updateDividerMasks(x) {
    if (!DividerState.masks) return;
    const { leftGrad, rightGrad } = DividerState.masks;
    const halfFade = DividerState.fadeWidth / 2;
    const viewW = PHASE_CHART.viewW;

    const fadeStart = Math.max(0, (x - halfFade) / viewW);
    const fadeEnd = Math.min(1, (x + halfFade) / viewW);

    // Left gradient: 1,1 → minOp,minOp
    const ls = leftGrad.children;
    ls[1].setAttribute('offset', String(fadeStart));
    ls[2].setAttribute('offset', String(fadeEnd));

    // Right gradient: minOp,minOp → 1,1
    const rs = rightGrad.children;
    rs[1].setAttribute('offset', String(fadeStart));
    rs[2].setAttribute('offset', String(fadeEnd));
}

/** Create the visual divider line + drag handle */
function createDividerVisual() {
    const svg = document.getElementById('phase-chart-svg');
    const tooltipOverlay = document.getElementById('phase-tooltip-overlay');
    const t = chartTheme();
    const x = DividerState.x;
    const plotTop = PHASE_CHART.padT;
    const plotH = PHASE_CHART.plotH;

    const group = svgEl('g', { id: 'effect-divider' });

    // Subtle glow backdrop
    const glow = svgEl('rect', {
        x: String(x - 8), y: String(plotTop),
        width: '16', height: String(plotH),
        fill: t.scanGlow, rx: '8', 'pointer-events': 'none',
    });
    group.appendChild(glow);

    // Thin divider line
    const line = svgEl('rect', {
        x: String(x - 0.75), y: String(plotTop),
        width: '1.5', height: String(plotH),
        fill: t.axisLine, 'fill-opacity': '0.35',
        rx: '0.75', 'pointer-events': 'none', class: 'divider-line',
    });
    group.appendChild(line);

    // Diamond handle at vertical center
    const cy = plotTop + plotH / 2;
    const diamond = svgEl('polygon', {
        points: `${x},${cy - 7} ${x + 4.5},${cy} ${x},${cy + 7} ${x - 4.5},${cy}`,
        fill: 'rgba(200, 210, 230, 0.2)', stroke: t.axisLine,
        'stroke-width': '0.75', 'stroke-opacity': '0.45',
        'pointer-events': 'none',
    });
    group.appendChild(diamond);

    // Invisible hit area for drag
    const hitArea = svgEl('rect', {
        x: String(x - 15), y: String(plotTop),
        width: '30', height: String(plotH),
        fill: 'transparent', cursor: 'col-resize',
        'pointer-events': 'all',
        class: 'divider-hit-area',
    });
    group.appendChild(hitArea);

    svg.insertBefore(group, tooltipOverlay);
    DividerState.elements = { group, line, glow, diamond, hitArea };
}

/** Move all divider visual elements and update masks */
function updateDividerPosition(x) {
    const { line, glow, diamond, hitArea } = DividerState.elements;
    const plotTop = PHASE_CHART.padT;
    const plotH = PHASE_CHART.plotH;
    const cy = plotTop + plotH / 2;

    line.setAttribute('x', String(x - 0.75));
    glow.setAttribute('x', String(x - 8));
    hitArea.setAttribute('x', String(x - 15));
    diamond.setAttribute('points',
        `${x},${cy - 7} ${x + 4.5},${cy} ${x},${cy + 7} ${x - 4.5},${cy}`);

    updateDividerMasks(x);

    // Fade Y-axis labels based on divider position
    const leftAxis = document.getElementById('phase-y-axis-left');
    const rightAxis = document.getElementById('phase-y-axis-right');
    if (leftAxis && rightAxis) {
        const norm = (x - PHASE_CHART.padL) / PHASE_CHART.plotW; // 0=far left, 1=far right
        leftAxis.style.transition = 'opacity 150ms ease';
        rightAxis.style.transition = 'opacity 150ms ease';
        leftAxis.style.opacity = String(0.3 + 0.7 * Math.min(1, norm * 2));
        rightAxis.style.opacity = String(0.3 + 0.7 * Math.min(1, (1 - norm) * 2));
    }
}

/** Attach drag handlers for the divider */
function setupDividerDrag() {
    const { hitArea } = DividerState.elements;
    const svg = document.getElementById('phase-chart-svg');
    const minX = PHASE_CHART.padL;
    const maxX = PHASE_CHART.padL + PHASE_CHART.plotW;

    function onDown(e) {
        e.preventDefault();
        DividerState.dragging = true;
        DividerState.elements.line.setAttribute('fill-opacity', '0.55');
    }

    function onMove(e) {
        if (!DividerState.dragging) return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const m = svg.getScreenCTM();
        if (!m) return;
        const svgX = (clientX - m.e) / m.a;
        const clampedX = Math.max(minX, Math.min(maxX, svgX));
        DividerState.x = clampedX;
        updateDividerPosition(clampedX);
    }

    function onUp() {
        if (!DividerState.dragging) return;
        DividerState.dragging = false;
        DividerState.elements.line.setAttribute('fill-opacity', '0.35');
    }

    hitArea.addEventListener('mousedown', onDown);
    hitArea.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    DividerState.dragCleanup = () => {
        hitArea.removeEventListener('mousedown', onDown);
        hitArea.removeEventListener('touchstart', onDown);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchend', onUp);
    };
}

/** Apply divider masks to any existing sub-groups */
function applyDividerMasksToExistingGroups() {
    if (!DividerState.active) return;
    const groupIds = [
        'phase-baseline-curves', 'phase-desired-curves',
        'phase-lx-curves', 'phase-mission-arrows', 'phase-yaxis-indicators',
    ];
    for (const gid of groupIds) {
        const g = document.getElementById(gid);
        if (!g) continue;
        for (let ei = 0; ei < 2; ei++) {
            const sub = g.querySelector(`#${gid}-e${ei}`);
            if (sub) {
                sub.setAttribute('mask',
                    ei === 0 ? 'url(#divider-mask-left)' : 'url(#divider-mask-right)');
            }
        }
    }
}

/** Activate the 2-effect divider if conditions are met */
function activateDivider(curvesData) {
    if (AppState.maxEffects < 2 || !curvesData || curvesData.length < 2) return;

    DividerState.active = true;
    DividerState.x = PHASE_CHART.padL + PHASE_CHART.plotW / 2; // center = ~6pm

    installDividerMasks();
    applyDividerMasksToExistingGroups();
    createDividerVisual();
    setupDividerDrag();
    updateDividerPosition(DividerState.x);

    // Fade in
    DividerState.elements.group.style.opacity = '0';
    DividerState.elements.group.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 600, fill: 'forwards' }
    );
}

/** Clean up divider on chart reset */
function cleanupDivider() {
    if (DividerState.dragCleanup) DividerState.dragCleanup();
    DividerState.dragCleanup = null;

    const el = document.getElementById('effect-divider');
    if (el) el.remove();

    const svg = document.getElementById('phase-chart-svg');
    if (svg) {
        const defs = svg.querySelector('defs');
        if (defs) {
            ['divider-mask-left', 'divider-mask-right',
             'divider-grad-left', 'divider-grad-right'].forEach(id => {
                const node = defs.querySelector(`#${id}`);
                if (node) node.remove();
            });
        }
    }

    // Reset Y-axis opacity
    const leftAxis = document.getElementById('phase-y-axis-left');
    const rightAxis = document.getElementById('phase-y-axis-right');
    if (leftAxis) leftAxis.style.opacity = '';
    if (rightAxis) rightAxis.style.opacity = '';

    DividerState.active = false;
    DividerState.elements = null;
    DividerState.masks = null;
    DividerState.dragging = false;
}

// ============================================
// 4. DYNAMIC SUBSTANCE RESOLUTION
// ============================================

function getActiveSubstances() {
    const active = {};
    for (const [key, s] of Object.entries(SUBSTANCE_DB)) {
        const status = (s.regulatoryStatus || '').toLowerCase();
        // Supplement and OTC are always allowed
        if (status === 'supplement' || status === 'otc') {
            active[key] = s;
        } else if (status === 'rx' && AppState.includeRx) {
            active[key] = s;
        } else if (status === 'controlled' && AppState.includeControlled) {
            active[key] = s;
        }
    }
    return active;
}

function resolveSubstance(key, item) {
    const active = getActiveSubstances();
    if (active[key]) return active[key];
    // Also check the full DB (substance may exist but be filtered out by toggles)
    if (SUBSTANCE_DB[key]) return SUBSTANCE_DB[key];

    // Dynamic entry for substances the LLM returns that aren't in our database
    const cls = item.class || 'unknown';
    const clsColor = CLASS_COLORS[cls] || CLASS_COLORS.unknown;
    const dynamicEntry = {
        name: item.name || key.charAt(0).toUpperCase() + key.slice(1),
        class: cls,
        regulatoryStatus: item.regulatoryStatus || 'Supplement',
        color: item.color || clsColor.fill,
        standardDose: item.standardDose || item.dose || '',
        dataConfidence: 'Estimated',
        dataNote: 'Dynamically registered substance — not in database.',
        pharma: item.pharma || { onset: 30, peak: 60, duration: 240, halfLife: 120, strength: 40, rebound: 0 },
    };
    // Cache it so tooltips and labels work
    SUBSTANCE_DB[key] = dynamicEntry;
    return dynamicEntry;
}

// ============================================
// 5. SVG UTILITIES
// ============================================

/** Sanitize a class/category name for use as an SVG ID fragment (no slashes, spaces) */
function sanitizeId(name) {
    return (name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
    }
    return el;
}

function degToRad(deg) {
    return deg * Math.PI / 180;
}

function polarToXY(angleDeg, radius) {
    const rad = degToRad(angleDeg);
    return {
        x: CENTER + radius * Math.cos(rad),
        y: CENTER + radius * Math.sin(rad),
    };
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================
// 6. 5-DAY CARTRIDGE LAYOUT ENGINE
// ============================================

function computeCartridgeLayout(stack) {
    const capsuleGroups = [];
    let globalSlot = 0;

    for (const item of stack) {
        const dailyCount = item.count || 1;
        for (let dailyIdx = 0; dailyIdx < dailyCount; dailyIdx++) {
            for (let dayIndex = 0; dayIndex < DAYS_IN_CARTRIDGE; dayIndex++) {
                capsuleGroups.push({
                    key: item.key,
                    dose: item.dose,
                    timing: item.timing,
                    dayIndex,
                    dailyIndex: dailyIdx,
                    globalSlot,
                    isToday: dayIndex === 0,
                });
                globalSlot++;
            }
        }
    }

    const maxTotal = MAX_PER_LAYER * 2;
    if (capsuleGroups.length > maxTotal) {
        capsuleGroups.length = maxTotal;
        console.warn(`Cartridge truncated to ${maxTotal} capsules`);
    }

    const capsulesPerLayer = Math.ceil(capsuleGroups.length / 2);

    return {
        totalCapsules: capsuleGroups.length,
        capsulesPerLayer: Math.max(capsulesPerLayer, 1),
        capsuleGroups,
    };
}

// ============================================
// 7. SVG CARTRIDGE BUILDER
// ============================================

function buildCartridgeSVG() {
    const svg = document.getElementById('cartridge-svg');
    buildDefs(svg);
    buildTimingArcs();
    buildCapsuleLayer('back-layer', CartridgeConfig.backCapsule, BACK_RADIUS, CartridgeConfig.halfSpacing, 0.3);
    buildCapsuleLayer('front-layer', CartridgeConfig.frontCapsule, FRONT_RADIUS, 0, 1.0);
    buildCenterHub();
}

function rebuildCapsuleLayers() {
    const frontLayer = document.getElementById('front-layer');
    const backLayer = document.getElementById('back-layer');
    frontLayer.innerHTML = '';
    backLayer.innerHTML = '';
    backLayer.setAttribute('opacity', '0.3');
    backLayer.setAttribute('filter', 'url(#depth-blur)');
    AppState.capsuleElements = { front: [], back: [] };
    AppState.filledSlots.clear();

    buildCapsuleLayer('back-layer', CartridgeConfig.backCapsule, BACK_RADIUS, CartridgeConfig.halfSpacing, 0.3);
    buildCapsuleLayer('front-layer', CartridgeConfig.frontCapsule, FRONT_RADIUS, 0, 1.0);
}

function buildDefs(svg) {
    const defs = svg.querySelector('defs');

    for (const [cat, colors] of Object.entries(CATEGORY_COLORS)) {
        const grad = svgEl('linearGradient', {
            id: `grad-${sanitizeId(cat)}`, x1: '0%', y1: '0%', x2: '0%', y2: '100%',
        });
        grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': colors.fill, 'stop-opacity': '1' }));
        grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': colors.fill, 'stop-opacity': '0.55' }));
        defs.appendChild(grad);
    }

    const glow = svgEl('filter', { id: 'capsule-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    glow.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '4', result: 'blur' }));
    const merge = svgEl('feMerge');
    merge.appendChild(svgEl('feMergeNode', { in: 'blur' }));
    merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
    glow.appendChild(merge);
    defs.appendChild(glow);

    const depth = svgEl('filter', { id: 'depth-blur', x: '-10%', y: '-10%', width: '120%', height: '120%' });
    depth.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0.8' }));
    defs.appendChild(depth);
}

function buildTimingArcs() {
    const arcGroup = document.getElementById('timing-arcs');
    const labelGroup = document.getElementById('timing-labels');

    TIMING_SEGMENTS.forEach(seg => {
        const r = TIMING_ARC_RADIUS;
        const p1 = polarToXY(seg.startAngle, r);
        const p2 = polarToXY(seg.endAngle, r);
        const largeArc = (seg.endAngle - seg.startAngle) > 180 ? 1 : 0;

        const path = svgEl('path', {
            d: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
            fill: 'none',
            stroke: seg.color,
            'stroke-width': '2',
            'stroke-opacity': '0.15',
            'stroke-linecap': 'round',
        });
        arcGroup.appendChild(path);

        const midAngle = (seg.startAngle + seg.endAngle) / 2;
        const lp = polarToXY(midAngle, TIMING_ARC_RADIUS + 20);
        const label = svgEl('text', {
            x: lp.x.toFixed(2),
            y: lp.y.toFixed(2),
            fill: seg.color,
            'font-family': "'JetBrains Mono', monospace",
            'font-size': '8',
            'font-weight': '500',
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            opacity: '0.4',
            'letter-spacing': '0.12em',
        });
        label.textContent = seg.label;
        labelGroup.appendChild(label);
    });
}

function buildCapsuleLayer(groupId, dims, radius, angularOffset, baseOpacity) {
    const group = document.getElementById(groupId);
    const layerKey = groupId === 'front-layer' ? 'front' : 'back';

    if (layerKey === 'back') {
        group.setAttribute('opacity', String(baseOpacity));
        group.setAttribute('filter', 'url(#depth-blur)');
    }

    for (let i = 0; i < CartridgeConfig.capsulesPerLayer; i++) {
        const angleDeg = -90 + angularOffset + i * CartridgeConfig.angularSpacing;
        const pos = polarToXY(angleDeg, radius);
        const rotAngle = angleDeg + 90;

        const g = svgEl('g', {
            class: 'capsule-group',
            'data-layer': layerKey,
            'data-index': String(i),
            transform: `translate(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}) rotate(${rotAngle.toFixed(2)})`,
        });

        const outline = svgEl('rect', {
            class: 'capsule-outline',
            x: String(-dims.width / 2),
            y: String(-dims.height / 2),
            width: String(dims.width),
            height: String(dims.height),
            rx: String(dims.rx),
            fill: 'none',
            stroke: 'rgba(255,255,255,0.07)',
            'stroke-width': '1.5',
        });

        const fill = svgEl('rect', {
            class: 'capsule-fill',
            x: String(-dims.width / 2),
            y: String(-dims.height / 2),
            width: String(dims.width),
            height: String(dims.height),
            rx: String(dims.rx),
            fill: 'transparent',
            opacity: '0',
        });

        g.appendChild(outline);
        g.appendChild(fill);
        group.appendChild(g);

        AppState.capsuleElements[layerKey].push(g);
    }
}

function buildCenterHub() {
    const hub = document.getElementById('center-hub');

    hub.appendChild(svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '65',
        fill: 'none', stroke: 'rgba(255,255,255,0.04)', 'stroke-width': '1',
    }));

    hub.appendChild(svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '55',
        fill: '#0d0d15', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': '1',
    }));

    const pulse = svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '62',
        fill: 'none', stroke: 'rgba(160,160,255,0.3)', 'stroke-width': '2',
        id: 'hub-pulse', opacity: '0',
    });
    hub.appendChild(pulse);

    const text = svgEl('text', {
        x: String(CENTER), y: String(CENTER),
        fill: 'rgba(255,255,255,0.3)',
        'font-family': "'JetBrains Mono', monospace",
        'font-size': '12',
        'font-weight': '500',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        id: 'hub-text',
        'letter-spacing': '0.08em',
    });
    text.textContent = 'READY';
    hub.appendChild(text);
}

// ============================================
// 9. LLM DEBUG LOG
// ============================================

const DebugLog = {
    entries: [],

    clear() {
        this.entries = [];
        this.render();
    },

    addEntry(entry) {
        // entry: { stage, model?, systemPrompt?, userPrompt?, response?, error?, duration?, loading? }
        entry.timestamp = new Date();
        this.entries.push(entry);
        this.render();
        return entry;
    },

    updateEntry(entry, updates) {
        Object.assign(entry, updates);
        this.render();
    },

    exportToFile() {
        if (this.entries.length === 0) return;
        const payload = this.entries.map(e => ({
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
        a.download = 'cortex_loop_debug_log.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('[DebugLog] Exported', this.entries.length, 'entries to cortex_loop_debug_log.json');
    },

    render() {
        const container = document.getElementById('debug-entries');
        if (!container) return;

        if (this.entries.length === 0) {
            container.innerHTML = '<p class="debug-empty">Submit a prompt to see the LLM pipeline.</p>';
            return;
        }

        container.innerHTML = '';
        for (const entry of this.entries) {
            container.appendChild(this.buildEntryEl(entry));
        }
        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
    },

    buildEntryEl(entry) {
        const card = document.createElement('div');
        card.className = 'debug-entry';

        // Header
        const header = document.createElement('div');
        header.className = 'debug-entry-header';

        const stageBadge = document.createElement('span');
        stageBadge.className = `debug-entry-stage ${entry.stageClass || 'user-input'}`;
        stageBadge.textContent = entry.stage || 'Unknown';
        header.appendChild(stageBadge);

        if (entry.model) {
            const modelLabel = document.createElement('span');
            modelLabel.className = 'debug-entry-model';
            modelLabel.textContent = entry.model;
            header.appendChild(modelLabel);
        }

        if (entry.duration) {
            const timeLabel = document.createElement('span');
            timeLabel.className = 'debug-entry-time';
            timeLabel.textContent = `${entry.duration}ms`;
            header.appendChild(timeLabel);
        }

        card.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'debug-entry-body';

        if (entry.requestBody) {
            body.appendChild(this.buildToggleBlock('Request', JSON.stringify(entry.requestBody, null, 2), null, 'parsed'));
        } else {
            if (entry.systemPrompt) {
                body.appendChild(this.buildContentBlock('System Prompt', entry.systemPrompt, true));
            }
            if (entry.userPrompt) {
                body.appendChild(this.buildContentBlock('User Input', entry.userPrompt, false));
            }
        }
        if (entry.response || entry.rawResponse) {
            const parsedStr = entry.response
                ? (typeof entry.response === 'string' ? entry.response : JSON.stringify(entry.response, null, 2))
                : null;
            body.appendChild(this.buildToggleBlock('Response', parsedStr, entry.rawResponse || null, 'parsed'));
        }
        if (entry.error) {
            body.appendChild(this.buildContentBlock('Error', entry.error, false));
        }

        // Loading indicator
        if (entry.loading) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'debug-entry-loading';
            loadingDiv.innerHTML = '<div class="debug-spinner"></div><span>Waiting for response...</span>';
            body.appendChild(loadingDiv);
        }

        card.appendChild(body);
        return card;
    },

    buildContentBlock(label, content, collapsible) {
        const wrapper = document.createElement('div');

        const labelEl = document.createElement('div');
        labelEl.className = 'debug-entry-label';
        labelEl.textContent = label;
        wrapper.appendChild(labelEl);

        const contentEl = document.createElement('div');
        contentEl.className = 'debug-entry-content' + (collapsible && content.length > 200 ? ' collapsed' : '');
        contentEl.textContent = content;
        wrapper.appendChild(contentEl);

        if (collapsible && content.length > 200) {
            const toggle = document.createElement('button');
            toggle.className = 'debug-toggle-expand';
            toggle.textContent = 'Show more';
            toggle.addEventListener('click', () => {
                const isCollapsed = contentEl.classList.contains('collapsed');
                contentEl.classList.toggle('collapsed');
                toggle.textContent = isCollapsed ? 'Show less' : 'Show more';
            });
            wrapper.appendChild(toggle);
        }

        return wrapper;
    },

    buildToggleBlock(label, parsedContent, rawContent, defaultMode) {
        const wrapper = document.createElement('div');

        const headerRow = document.createElement('div');
        headerRow.className = 'debug-entry-label debug-toggle-header';

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        headerRow.appendChild(labelEl);

        // Only show toggle if we have both views
        const hasBoth = parsedContent && rawContent;
        let mode = defaultMode || 'parsed';

        const parsedEl = document.createElement('div');
        parsedEl.className = 'debug-entry-content';
        parsedEl.textContent = parsedContent || '';

        const rawEl = document.createElement('div');
        rawEl.className = 'debug-entry-content';
        rawEl.textContent = rawContent || '';

        // Apply collapsed state based on content length
        const activeContent = mode === 'parsed' ? parsedContent : rawContent;
        if (activeContent && activeContent.length > 200) {
            parsedEl.classList.add('collapsed');
            rawEl.classList.add('collapsed');
        }

        if (hasBoth) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'debug-mode-toggle';
            toggleBtn.textContent = mode === 'parsed' ? 'raw' : 'parsed';
            toggleBtn.addEventListener('click', () => {
                mode = mode === 'parsed' ? 'raw' : 'parsed';
                toggleBtn.textContent = mode === 'parsed' ? 'raw' : 'parsed';
                parsedEl.style.display = mode === 'parsed' ? '' : 'none';
                rawEl.style.display = mode === 'raw' ? '' : 'none';
                if (expandBtn) {
                    const visible = mode === 'parsed' ? parsedEl : rawEl;
                    expandBtn.style.display = visible.scrollHeight > 60 ? '' : 'none';
                }
            });
            headerRow.appendChild(toggleBtn);
        }

        wrapper.appendChild(headerRow);

        rawEl.style.display = mode === 'raw' ? '' : 'none';
        parsedEl.style.display = mode === 'parsed' ? '' : 'none';
        wrapper.appendChild(parsedEl);
        wrapper.appendChild(rawEl);

        // Show more / less toggle
        let expandBtn = null;
        const longestContent = Math.max((parsedContent || '').length, (rawContent || '').length);
        if (longestContent > 200) {
            expandBtn = document.createElement('button');
            expandBtn.className = 'debug-toggle-expand';
            expandBtn.textContent = 'Show more';
            expandBtn.addEventListener('click', () => {
                const visible = mode === 'parsed' ? parsedEl : rawEl;
                const isCollapsed = visible.classList.contains('collapsed');
                parsedEl.classList.toggle('collapsed');
                rawEl.classList.toggle('collapsed');
                expandBtn.textContent = isCollapsed ? 'Show less' : 'Show more';
            });
            wrapper.appendChild(expandBtn);
        }

        return wrapper;
    },
};

// ============================================
// 10. GENERIC API CALLERS (shared by fast + main models)
// ============================================

/**
 * Robust JSON extraction + sanitization for LLM responses.
 * Handles markdown fences, conversational wrapping, trailing commas,
 * and unescaped double quotes inside string values.
 */
function extractAndParseJSON(rawText) {
    let text = (rawText || '').trim();

    // 1. Strip markdown fences
    text = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```\s*/g, '').trim();

    // 2. Extract the FIRST complete JSON object/array by matching braces/brackets.
    //    This handles LLM self-correction responses that contain multiple JSON objects.
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let startIdx = -1;
    let openChar, closeChar;
    if (firstBrace >= 0 && (firstBracket < 0 || firstBrace <= firstBracket)) {
        startIdx = firstBrace;
        openChar = '{'; closeChar = '}';
    } else if (firstBracket >= 0) {
        startIdx = firstBracket;
        openChar = '['; closeChar = ']';
    }
    if (startIdx < 0) {
        console.error('[extractAndParseJSON] No JSON found in:', rawText);
        throw new Error('LLM returned no valid JSON. Check debug panel for raw response.');
    }
    // Walk forward from startIdx matching braces, respecting strings
    let depth = 0;
    let inString = false;
    let endIdx = -1;
    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; continue; } // skip escaped char
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) { endIdx = i; break; }
        }
    }
    if (endIdx < 0) {
        console.error('[extractAndParseJSON] Unmatched braces in:', rawText);
        throw new Error('LLM returned no valid JSON. Check debug panel for raw response.');
    }
    text = text.substring(startIdx, endIdx + 1);

    // 3. Fix trailing commas before } or ]
    text = text.replace(/,\s*([}\]])/g, '$1');

    // 4. Fix smart/curly quotes → straight quotes
    text = text.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    text = text.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

    // 5. Attempt parse
    try {
        return JSON.parse(text);
    } catch (e1) {
        // 6. Second pass: fix unescaped double quotes inside string values
        //    using a character-by-character state machine
        try {
            const fixed = fixUnescapedQuotes(text);
            return JSON.parse(fixed);
        } catch (e2) {
            // 7. Third pass: also fix unescaped newlines
            try {
                let fixed = fixUnescapedQuotes(text);
                fixed = fixed.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
                return JSON.parse(fixed);
            } catch (e3) {
                console.error('[extractAndParseJSON] PARSE FAILED.\nError:', e1.message, '\nCleaned text:', text);
                throw new Error('JSON parse error: ' + e1.message);
            }
        }
    }
}

/**
 * Walk JSON text character by character. When inside a string value,
 * if we hit a " that ISN'T followed by a JSON structural char (, : } ]),
 * it's an unescaped inner quote — replace it with an escaped \".
 */
function fixUnescapedQuotes(json) {
    const out = [];
    let i = 0;
    const len = json.length;

    while (i < len) {
        const ch = json[i];

        if (ch === '"') {
            // Start of a JSON string — scan to find the real closing quote
            out.push('"');
            i++;
            while (i < len) {
                const c = json[i];
                if (c === '\\') {
                    // Escaped char — pass through both chars
                    out.push(c);
                    i++;
                    if (i < len) { out.push(json[i]); i++; }
                    continue;
                }
                if (c === '"') {
                    // Is this the real closing quote or an unescaped inner quote?
                    // Peek ahead past whitespace to see what follows
                    let peek = i + 1;
                    while (peek < len && (json[peek] === ' ' || json[peek] === '\t' || json[peek] === '\r' || json[peek] === '\n')) peek++;
                    const next = peek < len ? json[peek] : '';
                    // Structural chars that can follow a closing string quote
                    if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
                        // Real closing quote
                        out.push('"');
                        i++;
                        break;
                    } else {
                        // Inner unescaped quote — escape it
                        out.push('\\"');
                        i++;
                        continue;
                    }
                }
                out.push(c);
                i++;
            }
        } else {
            out.push(ch);
            i++;
        }
    }
    return out.join('');
}

// Backward compat alias
function parseJSONObjectResponse(text) {
    return extractAndParseJSON(text);
}

async function callAnthropicGeneric(userPrompt, apiKey, model, systemPrompt, maxTokens) {
    const requestBody = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
    };
    const response = await fetch(API_ENDPOINTS.anthropic, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const parsed = parseJSONObjectResponse(data.content[0].text);
    parsed._requestBody = requestBody;
    parsed._rawResponse = data.content[0].text;
    return parsed;
}

async function callOpenAIGeneric(userPrompt, apiKey, model, endpoint, systemPrompt, maxTokens) {
    const requestBody = {
        model,
        max_tokens: maxTokens,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    };
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const parsed = parseJSONObjectResponse(data.choices[0].message.content);
    parsed._requestBody = requestBody;
    parsed._rawResponse = data.choices[0].message.content;
    return parsed;
}

async function callGeminiGeneric(userPrompt, apiKey, model, systemPrompt, maxTokens) {
    const requestBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
    };
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        }
    );
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const parsed = parseJSONObjectResponse(data.candidates[0].content.parts[0].text);
    parsed._requestBody = requestBody;
    parsed._rawResponse = data.candidates[0].content.parts[0].text;
    return parsed;
}

// ============================================
// 10b. FAST MODEL — Effect Identification
// ============================================

function buildFastModelSystemPrompt() {
    return interpolatePrompt(PROMPTS.fastModel, {
        maxEffects: AppState.maxEffects,
    });
}

async function callFastModel(prompt) {
    const { model, provider, key } = getStageModel('fast');
    if (!key) {
        throw new Error(`No API key configured for ${provider}. Add your key in Settings.`);
    }

    const systemPrompt = buildFastModelSystemPrompt();

    const debugEntry = DebugLog.addEntry({
        stage: 'Fast Model', stageClass: 'fast-model',
        model,
        systemPrompt,
        userPrompt: prompt,
        loading: true,
    });

    const startTime = performance.now();

    try {
        let result;
        switch (provider) {
            case 'anthropic':
                result = await callAnthropicGeneric(prompt, key, model, systemPrompt, 256);
                break;
            case 'openai':
                result = await callOpenAIGeneric(prompt, key, model, API_ENDPOINTS.openai, systemPrompt, 256);
                break;
            case 'grok':
                result = await callOpenAIGeneric(prompt, key, model, API_ENDPOINTS.grok, systemPrompt, 256);
                break;
            case 'gemini':
                result = await callGeminiGeneric(prompt, key, model, systemPrompt, 256);
                break;
        }
        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            requestBody,
            rawResponse,
            response: result,
            duration: Math.round(performance.now() - startTime),
        });
        return result;
    } catch (err) {
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err instanceof Error ? err : new Error('Fast model failed: ' + String(err));
    }
}

// ============================================
// 10c. MAIN MODEL — Pharmacodynamic Curves
// ============================================

function buildCurveModelSystemPrompt() {
    return interpolatePrompt(PROMPTS.curveModel, {
        maxEffects: AppState.maxEffects,
        maxEffectsPlural: AppState.maxEffects === 1 ? '' : 's',
    });
}

async function callMainModelForCurves(prompt) {
    const { model, provider, key } = getStageModel('curves');
    if (!key) {
        throw new Error(`No API key configured for ${provider}. Add your key in Settings.`);
    }

    const systemPrompt = buildCurveModelSystemPrompt();

    const debugEntry = DebugLog.addEntry({
        stage: 'Main Model', stageClass: 'main-model',
        model,
        systemPrompt,
        userPrompt: prompt,
        loading: true,
    });

    const startTime = performance.now();

    try {
        let result;
        switch (provider) {
            case 'anthropic':
                result = await callAnthropicGeneric(prompt, key, model, systemPrompt, 2048);
                break;
            case 'openai':
                result = await callOpenAIGeneric(prompt, key, model, API_ENDPOINTS.openai, systemPrompt, 2048);
                break;
            case 'grok':
                result = await callOpenAIGeneric(prompt, key, model, API_ENDPOINTS.grok, systemPrompt, 2048);
                break;
            case 'gemini':
                result = await callGeminiGeneric(prompt, key, model, systemPrompt, 2048);
                break;
        }
        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            requestBody,
            rawResponse,
            response: result,
            duration: Math.round(performance.now() - startTime),
        });
        return result;
    } catch (err) {
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err instanceof Error ? err : new Error('Main model failed: ' + String(err));
    }
}

// ============================================
// 11. ANIMATION ENGINE
// ============================================

async function animateFillSequence(stack) {
    AppState.isAnimating = true;
    const groups = CartridgeConfig.capsuleGroups;

    for (let i = 0; i < groups.length; i++) {
        const capsule = groups[i];
        const substance = resolveSubstance(capsule.key, capsule);
        if (!substance) continue;

        const category = substance.class || 'unknown';

        // Ensure gradient exists for this category
        ensureCategoryGradient(category);

        let layerKey, capsuleIndex;
        if (capsule.globalSlot < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = capsule.globalSlot;
        } else {
            layerKey = 'back';
            capsuleIndex = capsule.globalSlot - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (!capsuleGroup) continue;

        const fillRect = capsuleGroup.querySelector('.capsule-fill');
        const outlineRect = capsuleGroup.querySelector('.capsule-outline');

        fillRect.setAttribute('fill', `url(#grad-${sanitizeId(category)})`);

        const targetOpacity = capsule.isToday ? 1 : 0.25;

        fillRect.animate([
            { opacity: 0, transform: 'scale(0.6) translateY(10px)' },
            { opacity: targetOpacity, transform: 'scale(1.08) translateY(-2px)' },
            { opacity: targetOpacity, transform: 'scale(1) translateY(0)' },
        ], {
            duration: capsule.isToday ? 420 : 250,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            fill: 'forwards',
        });

        if (capsule.isToday) {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-width', '2');
            if (layerKey === 'front') {
                capsuleGroup.setAttribute('filter', 'url(#capsule-glow)');
            }
        } else {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-opacity', '0.2');
            outlineRect.setAttribute('stroke-width', '1');
            capsuleGroup.classList.add('dimmed');
        }

        capsuleGroup.classList.add('filled');
        capsuleGroup.dataset.substance = capsule.key;
        capsuleGroup.dataset.dose = capsule.dose;
        capsuleGroup.dataset.timing = capsule.timing;
        capsuleGroup.dataset.day = String(capsule.dayIndex + 1);

        AppState.filledSlots.set(capsule.globalSlot, capsule.key);
        updateCenterHub(i + 1, groups.length);

        await sleep(capsule.isToday ? 70 : 25);
    }

    await sleep(180);
    animateLabels(stack);

    await sleep(100);
    showStackSummary(stack);

    AppState.isAnimating = false;
}

function ensureCategoryGradient(category) {
    const safeId = sanitizeId(category);
    if (document.getElementById(`grad-${safeId}`)) return;
    const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.unknown;
    const defs = document.querySelector('#cartridge-svg defs');
    const grad = svgEl('linearGradient', {
        id: `grad-${safeId}`, x1: '0%', y1: '0%', x2: '0%', y2: '100%',
    });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': colors.fill, 'stop-opacity': '1' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': colors.fill, 'stop-opacity': '0.55' }));
    defs.appendChild(grad);
}

async function animateEjectSequence() {
    if (AppState.filledSlots.size === 0) return;
    AppState.isAnimating = true;

    clearLabels();
    hideStackSummary();
    await sleep(120);

    const slots = Array.from(AppState.filledSlots.keys()).reverse();

    for (const slotIndex of slots) {
        let layerKey, capsuleIndex;
        if (slotIndex < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = slotIndex;
        } else {
            layerKey = 'back';
            capsuleIndex = slotIndex - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (!capsuleGroup) continue;

        const fillRect = capsuleGroup.querySelector('.capsule-fill');
        const outlineRect = capsuleGroup.querySelector('.capsule-outline');

        fillRect.animate([
            { opacity: 1, transform: 'scale(1) translateY(0)' },
            { opacity: 0, transform: 'scale(0.5) translateY(-20px)' },
        ], {
            duration: 250,
            easing: 'ease-in',
            fill: 'forwards',
        });

        outlineRect.setAttribute('stroke', 'rgba(255,255,255,0.07)');
        outlineRect.setAttribute('stroke-width', '1.5');
        outlineRect.removeAttribute('stroke-opacity');
        capsuleGroup.removeAttribute('filter');
        capsuleGroup.classList.remove('filled', 'dimmed');
        delete capsuleGroup.dataset.substance;
        delete capsuleGroup.dataset.dose;
        delete capsuleGroup.dataset.timing;
        delete capsuleGroup.dataset.day;

        await sleep(20);
    }

    AppState.filledSlots.clear();
    updateCenterHub(0, 0);
    await sleep(80);
    AppState.isAnimating = false;
}

// ============================================
// 12. RADIAL LABEL & CONNECTOR SYSTEM
// ============================================

function getLabelTargets(stack) {
    if (CartridgeConfig.capsuleGroups.length > 0) {
        return CartridgeConfig.capsuleGroups
            .filter(c => c.isToday && c.globalSlot < CartridgeConfig.capsulesPerLayer)
            .map(c => ({
                item: { key: c.key, dose: c.dose, timing: c.timing },
                slotIndex: c.globalSlot,
            }));
    }
    return stack
        .slice(0, CartridgeConfig.capsulesPerLayer)
        .map((item, i) => ({ item, slotIndex: i }));
}

function animateLabels(stack) {
    const labelGroup = document.getElementById('label-ring');
    const connectorGroup = document.getElementById('connector-lines');
    labelGroup.innerHTML = '';
    connectorGroup.innerHTML = '';

    const targets = getLabelTargets(stack);
    const fontSize = CartridgeConfig.capsulesPerLayer > 18 ? 8 :
                     CartridgeConfig.capsulesPerLayer > 14 ? 9 : 10;

    for (let idx = 0; idx < targets.length; idx++) {
        const { item, slotIndex } = targets[idx];
        const substance = resolveSubstance(item.key, item);
        if (!substance) continue;

        const color = substance.color;
        const angleDeg = -90 + slotIndex * CartridgeConfig.angularSpacing;
        const lp = polarToXY(angleDeg, LABEL_RADIUS);

        const normalizedAngle = ((angleDeg % 360) + 360) % 360;
        const isLeftSide = normalizedAngle > 90 && normalizedAngle < 270;
        const textAngle = isLeftSide ? angleDeg + 180 : angleDeg;

        const isVertical = (normalizedAngle > 80 && normalizedAngle < 100) ||
                          (normalizedAngle > 260 && normalizedAngle < 280);
        const textAnchor = isVertical ? 'middle' : (isLeftSide ? 'end' : 'start');

        const label = svgEl('text', {
            x: lp.x.toFixed(2),
            y: lp.y.toFixed(2),
            fill: color,
            'font-family': "'Inter', sans-serif",
            'font-size': String(fontSize),
            'font-weight': '500',
            'text-anchor': textAnchor,
            'dominant-baseline': 'middle',
            opacity: '0',
            transform: `rotate(${textAngle.toFixed(2)}, ${lp.x.toFixed(2)}, ${lp.y.toFixed(2)})`,
        });
        label.textContent = `${substance.name} ${item.dose}`;
        labelGroup.appendChild(label);

        label.animate([
            { opacity: 0 },
            { opacity: 0.85 },
        ], {
            duration: 200,
            delay: idx * 40,
            fill: 'forwards',
        });

        const innerR = FRONT_RADIUS + 38;
        const outerR = LABEL_RADIUS - 12;
        const ip = polarToXY(angleDeg, innerR);
        const op = polarToXY(angleDeg, outerR);

        const line = svgEl('line', {
            x1: ip.x.toFixed(2), y1: ip.y.toFixed(2),
            x2: op.x.toFixed(2), y2: op.y.toFixed(2),
            stroke: color,
            'stroke-width': '0.75',
            'stroke-opacity': '0',
            'stroke-dasharray': '2,3',
        });
        connectorGroup.appendChild(line);

        line.animate([{ strokeOpacity: 0 }, { strokeOpacity: 0.15 }], {
            duration: 150, delay: idx * 40, fill: 'forwards',
        });
    }
}

function clearLabels() {
    const labelGroup = document.getElementById('label-ring');
    const connectorGroup = document.getElementById('connector-lines');

    labelGroup.querySelectorAll('text').forEach(el => {
        el.animate([{ opacity: 0.85 }, { opacity: 0 }], {
            duration: 120, fill: 'forwards',
        });
    });
    connectorGroup.querySelectorAll('line').forEach(el => {
        el.animate([{ strokeOpacity: 0.15 }, { strokeOpacity: 0 }], {
            duration: 120, fill: 'forwards',
        });
    });

    setTimeout(() => {
        labelGroup.innerHTML = '';
        connectorGroup.innerHTML = '';
    }, 140);
}

// ============================================
// 13. CENTER HUB & LOADING STATE
// ============================================

function updateCenterHub(filled, total) {
    const text = document.getElementById('hub-text');
    if (!text) return;

    if (total === 0) {
        text.textContent = 'READY';
        text.setAttribute('fill', 'rgba(255,255,255,0.3)');
        text.setAttribute('font-size', '12');
    } else {
        text.textContent = `${filled}/${total}`;
        text.setAttribute('fill', 'rgba(160,160,255,0.7)');
        text.setAttribute('font-size', '14');
    }
}

function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
    document.getElementById('prompt-submit').disabled = true;

    const pulse = document.getElementById('hub-pulse');
    if (pulse) {
        pulse.setAttribute('opacity', '1');
        const anim = pulse.animate([
            { opacity: 0.2, r: 62 },
            { opacity: 0.6, r: 68 },
            { opacity: 0.2, r: 62 },
        ], { duration: 1200, iterations: Infinity });
        pulse._anim = anim;
    }
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('prompt-submit').disabled = false;

    const pulse = document.getElementById('hub-pulse');
    if (pulse) {
        if (pulse._anim) pulse._anim.cancel();
        pulse.setAttribute('opacity', '0');
    }
}

// ============================================
// 14. STACK SUMMARY FOOTER
// ============================================

function showStackSummary(stack) {
    const footer = document.getElementById('stack-summary');
    const container = document.getElementById('summary-pills');
    container.innerHTML = '';

    stack.forEach((item, i) => {
        const substance = resolveSubstance(item.key, item);
        if (!substance) return;

        const color = substance.color;
        const count = item.count || 1;
        const pill = document.createElement('span');
        pill.className = 'summary-pill';
        pill.style.borderColor = color;
        pill.style.color = color;
        pill.style.animationDelay = `${i * 30}ms`;
        pill.textContent = count > 1
            ? `${substance.name} ${item.dose} x${count}`
            : `${substance.name} ${item.dose}`;
        container.appendChild(pill);
    });

    footer.classList.remove('hidden');
}

function hideStackSummary() {
    document.getElementById('stack-summary').classList.add('hidden');
}

// ============================================
// 15. PHASE CHART — Builders, Scanning Line, Curve Renderers
// ============================================

// ---- Phase Chart: X-Axis ----
function buildPhaseXAxis() {
    const group = document.getElementById('phase-x-axis');
    group.innerHTML = '';
    const t = chartTheme();

    const padT = PHASE_CHART.padT;
    const rulerTop = 8;
    const rulerBottom = padT - 8;
    const tickBaseY = rulerBottom;
    const labelY = rulerTop + 32;

    // Bottom boundary line for plot area
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL),
        y1: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
        y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: t.axisBoundary, 'stroke-width': '0.75',
    }));

    // High-contrast ruler strip behind top axis labels/ticks.
    group.appendChild(svgEl('rect', {
        x: String(PHASE_CHART.padL),
        y: String(rulerTop),
        width: String(PHASE_CHART.plotW),
        height: String(rulerBottom - rulerTop),
        fill: document.body.classList.contains('light-mode')
            ? 'rgba(40, 60, 90, 0.05)'
            : 'rgba(170, 200, 255, 0.07)',
        rx: '4',
        'pointer-events': 'none',
    }));

    // Day split zones to make the 24h rollover explicit.
    const day1StartX = phaseChartX(PHASE_CHART.startHour * 60);
    const midnightX = phaseChartX(24 * 60);
    const day2EndX = phaseChartX(PHASE_CHART.endHour * 60);
    group.appendChild(svgEl('rect', {
        x: day1StartX.toFixed(1),
        y: String(rulerTop + 1),
        width: (midnightX - day1StartX).toFixed(1),
        height: String(rulerBottom - rulerTop - 2),
        fill: document.body.classList.contains('light-mode')
            ? 'rgba(220, 170, 80, 0.07)'
            : 'rgba(220, 170, 80, 0.09)',
        'pointer-events': 'none',
    }));
    group.appendChild(svgEl('rect', {
        x: midnightX.toFixed(1),
        y: String(rulerTop + 1),
        width: (day2EndX - midnightX).toFixed(1),
        height: String(rulerBottom - rulerTop - 2),
        fill: document.body.classList.contains('light-mode')
            ? 'rgba(100, 130, 190, 0.08)'
            : 'rgba(100, 130, 190, 0.11)',
        'pointer-events': 'none',
    }));

    // Ruler baseline connecting ticks to plot area.
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(tickBaseY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(tickBaseY),
        stroke: t.rulerLine, 'stroke-width': '1',
    }));

    // Day labels.
    group.appendChild(svgEl('text', {
        x: ((day1StartX + midnightX) / 2).toFixed(1),
        y: String(rulerTop + 11),
        fill: t.periodLabel,
        'text-anchor': 'middle',
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '10.5',
        'font-weight': '600',
        'letter-spacing': '0.09em',
    })).textContent = 'DAY 1';
    group.appendChild(svgEl('text', {
        x: ((midnightX + day2EndX) / 2).toFixed(1),
        y: String(rulerTop + 11),
        fill: t.periodLabel,
        'text-anchor': 'middle',
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '10.5',
        'font-weight': '600',
        'letter-spacing': '0.09em',
    })).textContent = 'DAY 2';

    // Hour ticks every 1h; taller ticks every 2h.
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h++) {
        const x = phaseChartX(h * 60);
        const isEvenHour = h % 2 === 0;
        const isMidnight = (h % 24) === 0;
        const tickTopY = isMidnight ? (labelY + 4) : (isEvenHour ? (labelY + 8) : (labelY + 12));
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(tickTopY),
            x2: x.toFixed(1), y2: String(tickBaseY),
            stroke: isMidnight ? t.tickAnchor : t.tickNormal,
            'stroke-width': isMidnight ? '1.8' : (isEvenHour ? '1' : '0.7'),
        }));
    }

    // Label every 4h in full 24h format (HH:00) for readability.
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 4) {
        const x = phaseChartX(h * 60);
        const displayHour = h % 24;
        const isMidnight = displayHour === 0;
        const hh = String(displayHour).padStart(2, '0');
        const label = svgEl('text', {
            x: x.toFixed(1), y: String(labelY),
            fill: isMidnight ? t.labelAnchor : t.labelNormal,
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': isMidnight ? '17' : '14',
            'font-weight': isMidnight ? '700' : '500',
            'text-anchor': 'middle',
        });
        label.textContent = `${hh}:00`;
        if (isMidnight) {
            label.setAttribute('dy', '-1');
        }
        group.appendChild(label);
    }

    // Explicit midnight marker label.
    group.appendChild(svgEl('text', {
        x: (midnightX + 8).toFixed(1),
        y: String(rulerTop + 27),
        fill: t.labelAnchor,
        'text-anchor': 'start',
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '10',
        'font-weight': '600',
        'letter-spacing': '0.06em',
    })).textContent = 'MIDNIGHT';
}

// ---- Phase Chart: Curve highlight on Y-axis hover ----
// Uses CSS filter (not opacity) because Web Animations API fill:'forwards'
// overrides inline style.opacity in the cascade.
function highlightCurve(activeIdx, active) {
    if (!PhaseState.curvesData || PhaseState.curvesData.length < 2) return;
    const activeColor = PhaseState.curvesData[activeIdx].color;

    const dimFilter = 'saturate(0.1) brightness(0.25)';
    const boostFilter = 'brightness(1.15) drop-shadow(0 0 6px currentColor)';
    const transitionStyle = 'filter 200ms ease';

    const allGroupIds = [
        'phase-baseline-curves', 'phase-desired-curves', 'phase-lx-curves',
        'phase-mission-arrows', 'phase-yaxis-indicators', 'phase-lx-markers',
    ];

    for (const id of allGroupIds) {
        const g = document.getElementById(id);
        if (!g) continue;

        // If per-effect sub-groups exist, apply filter at the sub-group level
        const sub0 = g.querySelector(`#${id}-e0`);
        if (sub0 && PhaseState.curvesData && PhaseState.curvesData.length >= 2) {
            for (let ei = 0; ei < PhaseState.curvesData.length; ei++) {
                const sub = g.querySelector(`#${id}-e${ei}`);
                if (!sub) continue;
                if (active) {
                    sub.style.transition = transitionStyle;
                    sub.style.filter = (ei === activeIdx) ? boostFilter : dimFilter;
                } else {
                    sub.style.filter = '';
                }
            }
        } else {
            // Fallback: original per-child color matching (1-effect mode)
            for (const child of g.children) {
                const stroke = child.getAttribute('stroke');
                const fill = child.getAttribute('fill');
                const belongsToActive = stroke === activeColor || fill === activeColor;

                if (active) {
                    child.style.transition = transitionStyle;
                    child.style.filter = belongsToActive ? boostFilter : dimFilter;
                } else {
                    child.style.filter = '';
                }
            }
        }
    }
}

// ---- Phase Chart: Y-Axes ----
function buildPhaseYAxes(effects, colors, curvesData) {
    const leftGroup = document.getElementById('phase-y-axis-left');
    const rightGroup = document.getElementById('phase-y-axis-right');
    const tooltipOverlay = document.getElementById('phase-tooltip-overlay');
    leftGroup.innerHTML = '';
    rightGroup.innerHTML = '';
    tooltipOverlay.innerHTML = '';

    const cols = colors || [];
    const leftLevels = curvesData && curvesData[0] && curvesData[0].levels ? curvesData[0].levels : null;
    const rightLevels = curvesData && curvesData[1] && curvesData[1].levels ? curvesData[1].levels : null;
    if (effects.length >= 1) buildSingleYAxis(leftGroup, effects[0], 'left', cols[0], leftLevels, 0, effects.length);
    if (effects.length >= 2) buildSingleYAxis(rightGroup, effects[1], 'right', cols[1], rightLevels, 1, effects.length);
}

function buildSingleYAxis(group, effectLabel, side, color, levels, curveIndex, totalCurves) {
    const x = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
    const tickDir = side === 'left' ? -6 : 6;
    const textAnchor = side === 'left' ? 'end' : 'start';
    const labelOffset = side === 'left' ? -10 : 10;
    const t = chartTheme();
    const labelColor = color || t.yLabelDefault;

    // Axis line
    group.appendChild(svgEl('line', {
        x1: String(x), y1: String(PHASE_CHART.padT),
        x2: String(x), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: t.axisLine, 'stroke-width': '1.2',
    }));

    // Collect tick data for magnetic hit areas
    const ticks = [];
    for (let v = 0; v <= 100; v += 25) ticks.push(v);

    // Tick marks + labels every 25% (including 0)
    const tickElements = []; // { v, y, numLabel, descriptor, guideLine, tipGroup }
    for (let ti = 0; ti < ticks.length; ti++) {
        const v = ticks[ti];
        const y = phaseChartY(v);
        group.appendChild(svgEl('line', {
            x1: String(x), y1: y.toFixed(1),
            x2: String(x + tickDir), y2: y.toFixed(1),
            stroke: t.yTick, 'stroke-width': '1',
        }));

        const numLabel = svgEl('text', {
            x: String(x + labelOffset), y: (y + 3).toFixed(1),
            fill: t.yLabel,
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '10', 'text-anchor': textAnchor,
        });
        numLabel.textContent = String(v);
        group.appendChild(numLabel);

        const entry = { v, y, numLabel, descriptor: null, guideLine: null, tipGroup: null };

        // Hover descriptor tooltip + guide line (rendered in topmost overlay)
        if (levels && levels[String(v)]) {
            const descriptor = levels[String(v)];
            entry.descriptor = descriptor;
            const overlay = document.getElementById('phase-tooltip-overlay');
            // Position descriptor inside the chart area
            const tooltipAnchor = side === 'left' ? 'start' : 'end';
            const tooltipX = side === 'left' ? x + 12 : x - 12;

            // Dotted guide line spanning the full chart width (hidden by default)
            const guideLine = svgEl('line', {
                x1: String(PHASE_CHART.padL), y1: y.toFixed(1),
                x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: y.toFixed(1),
                stroke: labelColor, 'stroke-width': '0.8',
                'stroke-dasharray': '4 4', 'stroke-opacity': '0',
                class: 'tick-guide-line', 'pointer-events': 'none',
            });
            overlay.appendChild(guideLine);
            entry.guideLine = guideLine;

            // Tooltip group with dark backdrop (hidden by default)
            const tipGroup = svgEl('g', { class: 'tick-tooltip', opacity: '0', 'pointer-events': 'none' });

            // Measure text for backdrop pill
            const tipTextW = descriptor.length * 7;
            const tipPillPadX = 8, tipPillPadY = 4;
            const tipPillW = tipTextW + tipPillPadX * 2;
            const tipPillH = 16 + tipPillPadY * 2;
            const tipPillX = side === 'left'
                ? tooltipX - tipPillPadX
                : tooltipX - tipPillW + tipPillPadX;

            const tipBackdrop = svgEl('rect', {
                x: tipPillX.toFixed(1),
                y: (y - tipPillH / 2 + 2).toFixed(1),
                width: tipPillW.toFixed(1),
                height: tipPillH.toFixed(1),
                rx: '5', ry: '5',
                fill: t.tooltipBg,
            });
            tipGroup.appendChild(tipBackdrop);

            const textEl = svgEl('text', {
                x: String(tooltipX), y: (y + 4).toFixed(1),
                fill: labelColor, 'fill-opacity': '0.92',
                'font-family': "'Space Grotesk', sans-serif",
                'font-size': '12', 'font-weight': '500',
                'text-anchor': tooltipAnchor,
                'letter-spacing': '0.02em',
            });
            textEl.textContent = descriptor;
            tipGroup.appendChild(textEl);

            overlay.appendChild(tipGroup);
            entry.tipGroup = tipGroup;
        }

        tickElements.push(entry);
    }

    // Build magnetic hit areas that span the full gap between ticks (no dead zones)
    const overlay = document.getElementById('phase-tooltip-overlay');
    const axisTop = PHASE_CHART.padT;
    const axisBot = PHASE_CHART.padT + PHASE_CHART.plotH;
    // Note: tick y values are inverted (higher value = lower y pixel)
    // ticks are 0,25,50,75,100 but y pixels go from axisBot (v=0) to axisTop (v=100)

    for (let ti = 0; ti < tickElements.length; ti++) {
        const entry = tickElements[ti];

        // Compute the vertical range this tick "owns" (midpoints to neighbors, clamped to axis)
        let hitTop, hitBot;
        if (ti === tickElements.length - 1) {
            // Topmost tick (v=100, lowest y pixel) — extend to axis top
            hitTop = axisTop;
        } else {
            hitTop = (entry.y + tickElements[ti + 1].y) / 2;
        }
        if (ti === 0) {
            // Bottommost tick (v=0, highest y pixel) — extend to axis bottom
            hitBot = axisBot;
        } else {
            hitBot = (entry.y + tickElements[ti - 1].y) / 2;
        }

        const hitHeight = hitBot - hitTop;
        const hitArea = svgEl('rect', {
            x: String(side === 'left' ? x - 40 : x),
            y: hitTop.toFixed(1),
            width: '40', height: hitHeight.toFixed(1),
            fill: 'transparent',
            class: 'tick-hover-area',
            'pointer-events': 'all',
            cursor: 'default',
        });
        overlay.appendChild(hitArea);

        // Hover events — emphasize number, show descriptor, guide line, dim other curves
        let guideAnim = null;
        hitArea.addEventListener('mouseenter', () => {
            // Emphasize the number with curve color
            entry.numLabel.setAttribute('fill', labelColor);
            entry.numLabel.setAttribute('font-weight', '600');
            entry.numLabel.style.filter = `drop-shadow(0 0 3px ${labelColor})`;
            entry.numLabel.style.transition = 'filter 150ms ease';

            if (entry.tipGroup) {
                entry.tipGroup.setAttribute('opacity', '1');
            }

            // Animate guide line in from the axis side
            if (entry.guideLine) {
                const startX = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
                const endX = side === 'left' ? PHASE_CHART.padL + PHASE_CHART.plotW : PHASE_CHART.padL;
                entry.guideLine.setAttribute('x1', String(startX));
                entry.guideLine.setAttribute('x2', String(startX));
                entry.guideLine.setAttribute('stroke-opacity', '0.35');
                const animStart = performance.now();
                guideAnim = (function growLine() {
                    const t = Math.min(1, (performance.now() - animStart) / 350);
                    const ease = 1 - Math.pow(1 - t, 3);
                    entry.guideLine.setAttribute('x2', String(startX + (endX - startX) * ease));
                    if (t < 1) requestAnimationFrame(growLine);
                    return growLine;
                })();
            }

            // Dim the OTHER curve to make this one pop
            if (totalCurves >= 2) {
                highlightCurve(curveIndex, true);
            }
        });
        hitArea.addEventListener('mouseleave', () => {
            // Restore number to default
            entry.numLabel.setAttribute('fill', 'rgba(167, 191, 223, 0.76)');
            entry.numLabel.setAttribute('font-weight', '400');
            entry.numLabel.style.filter = '';

            if (entry.tipGroup) {
                entry.tipGroup.setAttribute('opacity', '0');
            }
            if (entry.guideLine) {
                entry.guideLine.setAttribute('stroke-opacity', '0');
            }
            guideAnim = null;

            // Restore all curves
            if (totalCurves >= 2) {
                highlightCurve(curveIndex, false);
            }
        });
    }

    // Effect label inside plot area, top corner
    const labelAnchor = side === 'left' ? 'start' : 'end';
    const labelX = side === 'left' ? PHASE_CHART.padL + 6 : PHASE_CHART.padL + PHASE_CHART.plotW - 6;
    const yLabel = svgEl('text', {
        x: String(labelX), y: String(PHASE_CHART.padT + 14),
        fill: labelColor, 'fill-opacity': '0.85',
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '11', 'font-weight': '500', 'letter-spacing': '0.04em',
        'text-anchor': labelAnchor,
    });
    yLabel.textContent = effectLabel;
    group.appendChild(yLabel);
}

// ---- Phase Chart: Grid ----
function buildPhaseGrid() {
    const group = document.getElementById('phase-grid');
    group.innerHTML = '';
    const t = chartTheme();

    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 2) {
        const x = phaseChartX(h * 60);
        const displayHour = h % 24;
        const isAnchor = displayHour % 6 === 0;
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(PHASE_CHART.padT),
            x2: x.toFixed(1), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            stroke: isAnchor ? t.axisBoundary : t.grid, 'stroke-width': '1',
        }));
    }
    for (let v = 25; v <= 100; v += 25) {
        const y = phaseChartY(v);
        group.appendChild(svgEl('line', {
            x1: String(PHASE_CHART.padL), y1: y.toFixed(1),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: y.toFixed(1),
            stroke: t.grid, 'stroke-width': '1',
        }));
    }
}

// ---- Phase Chart: Scanning Line ----
let scanLineAnimId = null;

function startScanLine() {
    const group = document.getElementById('phase-scan-line');
    group.innerHTML = '';

    const startX = PHASE_CHART.padL;

    // Glow behind line
    const t = chartTheme();
    const glow = svgEl('rect', {
        id: 'scan-line-glow',
        x: String(startX - 4), y: String(PHASE_CHART.padT),
        width: '10', height: String(PHASE_CHART.plotH),
        fill: t.scanGlow, rx: '5',
    });
    group.appendChild(glow);

    // Main scan line
    const line = svgEl('rect', {
        id: 'scan-line-rect',
        x: String(startX), y: String(PHASE_CHART.padT),
        width: '2', height: String(PHASE_CHART.plotH),
        fill: 'url(#scan-line-grad)', opacity: '0.7',
    });
    group.appendChild(line);

    let direction = 1;
    let position = 0;
    const range = PHASE_CHART.plotW;
    const speed = range / 1.25; // traverse in 1.25 seconds
    let lastTime = performance.now();

    function tick(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        position += direction * speed * dt;
        if (position >= range) { position = range; direction = -1; }
        if (position <= 0) { position = 0; direction = 1; }
        const currentX = PHASE_CHART.padL + position;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        scanLineAnimId = requestAnimationFrame(tick);
    }
    scanLineAnimId = requestAnimationFrame(tick);
}

function stopScanLine() {
    if (scanLineAnimId) {
        cancelAnimationFrame(scanLineAnimId);
        scanLineAnimId = null;
    }
    const line = document.getElementById('scan-line-rect');
    const glow = document.getElementById('scan-line-glow');
    if (line) line.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
    setTimeout(() => {
        const group = document.getElementById('phase-scan-line');
        if (group) group.innerHTML = '';
    }, 450);
}

// ---- Timeline Scan Line (gold-themed, runs in substance timeline zone) ----
let tlScanLineAnimId = null;

function startTimelineScanLine(laneCount) {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;

    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const zoneTop = TIMELINE_ZONE.separatorY;
    const zoneH = Math.max(30, laneCount * laneStep + TIMELINE_ZONE.bottomPad);

    const glow = svgEl('rect', {
        id: 'tl-scan-glow',
        x: String(PHASE_CHART.padL - 4), y: String(zoneTop),
        width: '10', height: String(zoneH),
        fill: 'rgba(245, 200, 80, 0.08)', rx: '5',
    });
    group.appendChild(glow);

    const line = svgEl('rect', {
        id: 'tl-scan-rect',
        x: String(PHASE_CHART.padL), y: String(zoneTop),
        width: '2', height: String(zoneH),
        fill: 'url(#tl-scan-line-grad)', opacity: '0.7',
    });
    group.appendChild(line);

    let direction = 1;
    let position = 0;
    const range = PHASE_CHART.plotW;
    const speed = range / 1.5;
    let lastTime = performance.now();

    function tick(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        position += direction * speed * dt;
        if (position >= range) { position = range; direction = -1; }
        if (position <= 0) { position = 0; direction = 1; }
        const currentX = PHASE_CHART.padL + position;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        tlScanLineAnimId = requestAnimationFrame(tick);
    }
    tlScanLineAnimId = requestAnimationFrame(tick);
}

function stopTimelineScanLine() {
    if (tlScanLineAnimId) {
        cancelAnimationFrame(tlScanLineAnimId);
        tlScanLineAnimId = null;
    }
    const line = document.getElementById('tl-scan-rect');
    const glow = document.getElementById('tl-scan-glow');
    if (line) line.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    setTimeout(() => {
        if (line) line.remove();
        if (glow) glow.remove();
    }, 350);
}

// ---- Biometric Scan Line (red-themed, runs in biometric strip zone) ----
let bioScanLineAnimId = null;

function startBioScanLine() {
    const svg = document.getElementById('phase-chart-svg');
    const group = document.getElementById('phase-biometric-strips');
    if (!svg || !group) return;

    // Clear any existing content
    group.innerHTML = '';

    // Determine the zone: starts just below current viewBox bottom
    const currentVB = svg.getAttribute('viewBox').split(' ').map(Number);
    const currentH = currentVB[3];

    // Store pre-scan viewBox height so renderBiometricStrips can reset to it
    svg.dataset.preBioScanH = String(currentH);

    // Estimate strip zone height (~8 channels × 17px each + padding)
    const estimatedChannels = BiometricState.selectedDevices.reduce((sum, dKey) => {
        const dev = BIOMETRIC_DEVICES.devices.find(d => d.key === dKey);
        return sum + (dev ? dev.displayChannels.length : 0);
    }, 0);
    const zoneH = Math.max(80, estimatedChannels * (BIOMETRIC_ZONE.laneH + BIOMETRIC_ZONE.laneGap) + BIOMETRIC_ZONE.separatorPad * 2 + BIOMETRIC_ZONE.bottomPad);

    // Expand viewBox to make room for the scan zone
    const newH = currentH + zoneH;
    svg.setAttribute('viewBox', `0 0 960 ${newH}`);

    const zoneTop = currentH + BIOMETRIC_ZONE.separatorPad;
    const zoneBottom = newH - BIOMETRIC_ZONE.bottomPad;
    const zoneHeight = zoneBottom - zoneTop;

    // Faint zone background
    const bg = svgEl('rect', {
        x: String(PHASE_CHART.padL), y: String(zoneTop),
        width: String(PHASE_CHART.plotW), height: String(zoneHeight),
        fill: 'rgba(255, 77, 77, 0.02)', rx: '2',
    });
    group.appendChild(bg);

    // Red glow behind line
    const glow = svgEl('rect', {
        id: 'bio-scan-glow',
        x: String(PHASE_CHART.padL - 4), y: String(zoneTop),
        width: '10', height: String(zoneHeight),
        fill: 'rgba(255, 77, 77, 0.12)', rx: '5',
    });
    group.appendChild(glow);

    // Main red scan line
    const line = svgEl('rect', {
        id: 'bio-scan-rect',
        x: String(PHASE_CHART.padL), y: String(zoneTop),
        width: '2', height: String(zoneHeight),
        fill: 'url(#bio-scan-line-grad)', opacity: '0.8',
    });
    group.appendChild(line);

    let direction = 1;
    let position = 0;
    const range = PHASE_CHART.plotW;
    const speed = range / 1.8; // slightly slower than the main scan line
    let lastTime = performance.now();

    function tick(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        position += direction * speed * dt;
        if (position >= range) { position = range; direction = -1; }
        if (position <= 0) { position = 0; direction = 1; }
        const currentX = PHASE_CHART.padL + position;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        bioScanLineAnimId = requestAnimationFrame(tick);
    }
    bioScanLineAnimId = requestAnimationFrame(tick);
}

function stopBioScanLine() {
    if (bioScanLineAnimId) {
        cancelAnimationFrame(bioScanLineAnimId);
        bioScanLineAnimId = null;
    }
    const line = document.getElementById('bio-scan-rect');
    const glow = document.getElementById('bio-scan-glow');
    if (line) line.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });
    setTimeout(() => {
        const group = document.getElementById('phase-biometric-strips');
        if (group) group.innerHTML = '';
        // Restore viewBox to pre-scan height so renderBiometricStrips starts clean
        const svg = document.getElementById('phase-chart-svg');
        if (svg && svg.dataset.preBioScanH) {
            svg.setAttribute('viewBox', `0 0 960 ${svg.dataset.preBioScanH}`);
            delete svg.dataset.preBioScanH;
        }
    }, 400);
}

// ============================================
// 12b. WORD CLOUD — Effect Visualization
// ============================================

const WORD_CLOUD_PALETTE = [
    'rgba(110, 200, 255, 0.85)',
    'rgba(168, 130, 255, 0.80)',
    'rgba(110, 231, 200, 0.75)',
    'rgba(255, 180, 100, 0.75)',
    'rgba(200, 160, 255, 0.70)',
    'rgba(100, 220, 180, 0.70)',
    'rgba(255, 150, 130, 0.70)',
    'rgba(180, 200, 255, 0.75)',
];

let _wordCloudPositions = []; // stored bboxes for dismiss animation
let _orbitalRingsState = null;
let _wordCloudFloatId = null;

function startWordCloudFloat() {
    stopWordCloudFloat();
    const t0 = performance.now();
    function tick() {
        const t = (performance.now() - t0) / 1000;
        for (const pos of _wordCloudPositions) {
            const phase = pos.x * 0.037 + pos.y * 0.029;
            const dx = Math.sin(t * 0.5 + phase) * 3.5;
            const dy = Math.cos(t * 0.4 + phase * 1.3) * 2.5;
            pos.el.setAttribute('x', (pos.x + dx).toFixed(1));
            pos.el.setAttribute('y', (pos.y + dy).toFixed(1));
        }
        _wordCloudFloatId = requestAnimationFrame(tick);
    }
    _wordCloudFloatId = requestAnimationFrame(tick);
}

function stopWordCloudFloat() {
    if (_wordCloudFloatId) {
        cancelAnimationFrame(_wordCloudFloatId);
        _wordCloudFloatId = null;
    }
}

// ---- Orbital Rings — encircle word cloud, morph into baseline curves ----

function startOrbitalRings(cx, cy) {
    const group = document.getElementById('phase-word-cloud');
    if (!group) return null;

    const NPTS = 72;
    const singleRing = AppState.maxEffects === 1;
    const R1 = singleRing ? 148 : 140;
    const R2 = 158;

    const ot = chartTheme();
    const ring1 = svgEl('path', {
        fill: 'none', stroke: ot.orbitalRing1,
        'stroke-width': '1.5', class: 'orbital-ring', opacity: '0',
    });
    group.insertBefore(ring1, group.firstChild);
    ring1.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });

    let ring2 = null;
    if (!singleRing) {
        ring2 = svgEl('path', {
            fill: 'none', stroke: ot.orbitalRing2,
            'stroke-width': '1.5', class: 'orbital-ring', opacity: '0',
        });
        group.insertBefore(ring2, group.firstChild);
        ring2.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards', delay: 120 });
    }

    let running = true;
    let animId;

    function computeD(t, r, phase) {
        const breathe = 1 + 0.012 * Math.sin(t * 1.2 + phase);
        let d = '';
        for (let i = 0; i <= NPTS; i++) {
            const angle = (i / NPTS) * Math.PI * 2;
            const wobble = 1 + 0.025 * Math.sin(angle * 2 + t * 0.8 + phase)
                             + 0.015 * Math.sin(angle * 3 + t * 1.3);
            const rEff = r * breathe * wobble;
            const px = cx + rEff * Math.cos(angle);
            const py = cy + rEff * Math.sin(angle);
            d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
        }
        return d + 'Z';
    }

    const t0 = performance.now();
    function tick() {
        if (!running) return;
        const t = (performance.now() - t0) / 1000;
        ring1.setAttribute('d', computeD(t, R1, 0));
        if (ring2) ring2.setAttribute('d', computeD(t, R2, Math.PI));
        animId = requestAnimationFrame(tick);
    }
    tick();

    _orbitalRingsState = {
        ring1, ring2, singleRing, cx, cy, NPTS, R1, R2,
        stop() { running = false; if (animId) cancelAnimationFrame(animId); },
        getLastT() { return (performance.now() - t0) / 1000; },
    };
    return _orbitalRingsState;
}

function stopOrbitalRings() {
    if (_orbitalRingsState) {
        _orbitalRingsState.stop();
    }
}

/**
 * Morph orbital ring(s) into baseline curve(s).
 * Each ring "breaks apart" — the circle unfurls into a curve shape.
 * Top half of ring maps to the curve, bottom half collapses up to merge.
 */
async function morphRingsToCurves(curvesData) {
    if (!_orbitalRingsState) return;
    const rings = _orbitalRingsState;
    rings.stop();

    const lastT = rings.getLastT();
    const N = 50;
    const duration = 1400;

    // Sample circular ring at frozen breathing position
    function sampleRing(r, phase) {
        const breathe = 1 + 0.012 * Math.sin(lastT * 1.2 + phase);
        const pts = [];
        // Top half: angle π → 0 (left to right across the top)
        for (let i = 0; i < N; i++) {
            const frac = i / (N - 1);
            const angle = Math.PI * (1 - frac);
            const wobble = 1 + 0.025 * Math.sin(angle * 2 + lastT * 0.8 + phase)
                             + 0.015 * Math.sin(angle * 3 + lastT * 1.3);
            const rEff = r * breathe * wobble;
            pts.push({
                x: rings.cx + rEff * Math.cos(angle),
                y: rings.cy + rEff * Math.sin(angle),
            });
        }
        // Bottom half: angle 0 → -π (collapses onto curve)
        for (let i = 0; i < N; i++) {
            const frac = i / (N - 1);
            const angle = -Math.PI * frac;
            const wobble = 1 + 0.025 * Math.sin(angle * 2 + lastT * 0.8 + phase)
                             + 0.015 * Math.sin(angle * 3 + lastT * 1.3);
            const rEff = r * breathe * wobble;
            pts.push({
                x: rings.cx + rEff * Math.cos(angle),
                y: rings.cy + rEff * Math.sin(angle),
            });
        }
        return pts; // 2*N points
    }

    // Sample target baseline curve positions (top half maps forward, bottom half maps reversed)
    function sampleCurveTarget(curveIdx) {
        const baseline = curvesData[curveIdx]?.baseline;
        if (!baseline) return null;
        const smoothed = smoothPhaseValues(baseline, PHASE_SMOOTH_PASSES);
        const forward = [];
        for (let i = 0; i < N; i++) {
            const frac = i / (N - 1);
            const hour = PHASE_CHART.startHour + frac * (PHASE_CHART.endHour - PHASE_CHART.startHour);
            const value = interpolatePointsAtTime(smoothed, hour);
            forward.push({ x: phaseChartX(hour * 60), y: phaseChartY(value) });
        }
        // Bottom half collapses onto the curve (same points, reversed order)
        const reversed = [];
        for (let i = N - 1; i >= 0; i--) {
            reversed.push({ x: forward[i].x, y: forward[i].y });
        }
        return [...forward, ...reversed]; // 2*N points
    }

    const src1 = sampleRing(rings.R1, 0);
    const tgt1 = sampleCurveTarget(0);

    let src2 = null, tgt2 = null;
    if (rings.ring2) {
        src2 = sampleRing(rings.R2, Math.PI);
        tgt2 = curvesData.length > 1 ? sampleCurveTarget(1) : sampleCurveTarget(0);
    }

    if (!tgt1) {
        rings.ring1.remove();
        if (rings.ring2) rings.ring2.remove();
        _orbitalRingsState = null;
        return;
    }

    const color1 = curvesData[0].color;
    const color2 = curvesData.length > 1 ? curvesData[1].color : color1;

    // Parse hex color to [r,g,b]
    function hexToRgb(hex) {
        const h = hex.replace('#', '');
        return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
    }
    // Parse rgba(...) to [r,g,b]
    function rgbaToRgb(rgba) {
        const m = rgba.match(/[\d.]+/g);
        return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
    }
    function lerpColor(fromRgb, toRgb, t) {
        const r = Math.round(fromRgb[0] + (toRgb[0] - fromRgb[0]) * t);
        const g = Math.round(fromRgb[1] + (toRgb[1] - fromRgb[1]) * t);
        const b = Math.round(fromRgb[2] + (toRgb[2] - fromRgb[2]) * t);
        return `rgb(${r},${g},${b})`;
    }

    const ot = chartTheme();
    const ringRgb1 = rgbaToRgb(ot.orbitalRing1);
    const ringRgb2 = rgbaToRgb(ot.orbitalRing2);
    const curveRgb1 = hexToRgb(color1);
    const curveRgb2 = hexToRgb(color2);

    await new Promise(resolve => {
        const start = performance.now();

        function tick(now) {
            const rawP = Math.min(1, (now - start) / duration);
            // Smooth ease-in-out
            const p = rawP < 0.5 ? 2 * rawP * rawP : 1 - Math.pow(-2 * rawP + 2, 2) / 2;

            function buildMorphPath(src, tgt) {
                let d = '';
                for (let i = 0; i < src.length; i++) {
                    const x = src[i].x + (tgt[i].x - src[i].x) * p;
                    const y = src[i].y + (tgt[i].y - src[i].y) * p;
                    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
                }
                return d;
            }

            // Transition opacity and width
            const strokeOp = 0.28 + p * 0.35;
            const strokeW = 1.2 + p * 0.6;

            rings.ring1.setAttribute('d', buildMorphPath(src1, tgt1));
            rings.ring1.setAttribute('stroke', lerpColor(ringRgb1, curveRgb1, p));
            rings.ring1.setAttribute('stroke-opacity', strokeOp.toFixed(2));
            rings.ring1.setAttribute('stroke-width', strokeW.toFixed(1));

            if (rings.ring2 && src2 && tgt2) {
                rings.ring2.setAttribute('d', buildMorphPath(src2, tgt2));
                rings.ring2.setAttribute('stroke', lerpColor(ringRgb2, curveRgb2, p));
                rings.ring2.setAttribute('stroke-opacity', strokeOp.toFixed(2));
                rings.ring2.setAttribute('stroke-width', strokeW.toFixed(1));
            }

            if (rawP < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(tick);
    });

    // Don't remove rings here — caller removes after baseline curves are rendered
    // to prevent a flicker gap between ring disappearance and curve appearance.
}

function renderWordCloud(effects) {
    return new Promise(resolve => {
        const group = document.getElementById('phase-word-cloud');
        group.innerHTML = '';
        _wordCloudPositions = [];

        if (!effects || effects.length === 0) { resolve(); return; }

        const cx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        const cy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;

        // Match ring radii so words pack tightly inside the innermost ring
        const singleRing = AppState.maxEffects === 1;
        const innerRingR = singleRing ? 148 : 140;
        const cloudRadius = innerRingR - 10;

        // Sort by relevance descending
        const sorted = [...effects].sort((a, b) => b.relevance - a.relevance);
        const maxRel = sorted[0].relevance || 100;

        // Phase 1: Create invisible text elements and measure via getBBox
        const measured = [];
        for (let i = 0; i < sorted.length; i++) {
            const eff = sorted[i];
            const relFrac = eff.relevance / maxRel; // 0..1 relative to top
            const fontSize = 9 + relFrac * 11; // 9px (low) to 20px (top)
            const fontWeight = relFrac > 0.7 ? '700' : relFrac > 0.4 ? '600' : '400';
            // Variable letter-spacing: large words tighter, small words slightly open
            const letterSpacing = relFrac > 0.7 ? '-0.04em' : relFrac > 0.4 ? '-0.02em' : '0.01em';
            const color = WORD_CLOUD_PALETTE[i % WORD_CLOUD_PALETTE.length];
            const opacity = 0.5 + relFrac * 0.5;

            const textEl = svgEl('text', {
                x: '0', y: '0',
                fill: color,
                'font-size': fontSize.toFixed(1),
                'font-weight': fontWeight,
                'letter-spacing': letterSpacing,
                class: 'word-cloud-word',
                opacity: '0',
                'data-effect-name': eff.name,
                'data-relevance': String(eff.relevance),
                'data-target-opacity': opacity.toFixed(2),
            });
            textEl.textContent = eff.name;
            group.appendChild(textEl);

            // Measure actual rendered size via SVG getBBox
            const bbox = textEl.getBBox();
            const actualW = bbox.width;
            const actualH = bbox.height;

            measured.push({ eff, fontSize, color, opacity, textEl, w: actualW, h: actualH });
        }

        // Phase 2: Compute layout — tight circular packing via fine spiral search
        const placed = []; // { x, y, w, h } bounding boxes
        const PAD = 4;
        const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 137.5°

        for (let i = 0; i < measured.length; i++) {
            const m = measured[i];
            let bestX = cx, bestY = cy;

            if (i === 0) {
                bestX = cx;
                bestY = cy;
            } else {
                let found = false;
                // Fine spiral: try many angles at each radius for tight circular packing
                for (let r = 4; r <= cloudRadius; r += 1.5) {
                    const angle = i * GOLDEN_ANGLE + r * 0.12;
                    const tx = cx + Math.cos(angle) * r;
                    const ty = cy + Math.sin(angle) * r;

                    // Circular boundary — keep word bbox inside the ring
                    const dist = Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2);
                    if (dist + Math.max(m.w, m.h) / 2 > cloudRadius) continue;

                    const collides = placed.some(p =>
                        tx - m.w / 2 - PAD < p.x + p.w / 2 &&
                        tx + m.w / 2 + PAD > p.x - p.w / 2 &&
                        ty - m.h / 2 - PAD < p.y + p.h / 2 &&
                        ty + m.h / 2 + PAD > p.y - p.h / 2
                    );
                    if (!collides) {
                        bestX = tx;
                        bestY = ty;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    const fallbackAngle = i * GOLDEN_ANGLE;
                    const fallbackR = cloudRadius * 0.6;
                    bestX = cx + Math.cos(fallbackAngle) * fallbackR;
                    bestY = cy + Math.sin(fallbackAngle) * fallbackR;
                }
            }

            placed.push({ x: bestX, y: bestY, w: m.w, h: m.h });

            m.textEl.setAttribute('x', bestX.toFixed(1));
            m.textEl.setAttribute('y', bestY.toFixed(1));
            m.textEl.setAttribute('data-cx', bestX.toFixed(1));
            m.textEl.setAttribute('data-cy', bestY.toFixed(1));

            _wordCloudPositions.push({
                el: m.textEl, x: bestX, y: bestY, w: m.w, h: m.h,
                name: m.eff.name, relevance: m.eff.relevance,
            });
        }

        // Phase 3: Words spring from center to position with stagger, then float
        const stagger = 180;
        const slideDur = 500;
        const words = group.querySelectorAll('.word-cloud-word');
        const totalEntranceDur = words.length * stagger + slideDur;

        words.forEach((word, idx) => {
            const targetOp = parseFloat(word.getAttribute('data-target-opacity'));
            const finalX = parseFloat(word.getAttribute('x'));
            const finalY = parseFloat(word.getAttribute('y'));

            // Start at center
            word.setAttribute('x', cx.toFixed(1));
            word.setAttribute('y', cy.toFixed(1));

            setTimeout(() => {
                const t0 = performance.now();
                (function slide() {
                    const t = Math.min(1, (performance.now() - t0) / slideDur);
                    const c1 = 1.70158;
                    const c3 = c1 + 1;
                    const ease = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

                    word.setAttribute('x', (cx + (finalX - cx) * ease).toFixed(1));
                    word.setAttribute('y', (cy + (finalY - cy) * ease).toFixed(1));
                    word.setAttribute('opacity', (targetOp * Math.min(1, t * 2.5)).toFixed(2));

                    if (t < 1) requestAnimationFrame(slide);
                })();
            }, idx * stagger);
        });

        // Start gentle float after entrance settles
        setTimeout(() => startWordCloudFloat(), totalEntranceDur + 100);

        setTimeout(resolve, totalEntranceDur);
    });
}

function dismissWordCloud(mainEffectNames, mainColors) {
    return new Promise(resolve => {
        const group = document.getElementById('phase-word-cloud');
        const words = Array.from(group.querySelectorAll('.word-cloud-word'));

        stopWordCloudFloat();

        if (words.length === 0) { resolve(); return; }

        // Fuzzy match: find the best cloud word for each main effect
        const winners = [];
        const claimed = new Set();

        for (let mi = 0; mi < mainEffectNames.length && mi < AppState.maxEffects; mi++) {
            const target = mainEffectNames[mi].toLowerCase().trim();
            let bestIdx = -1;
            let bestScore = 0;

            for (let wi = 0; wi < _wordCloudPositions.length; wi++) {
                if (claimed.has(wi)) continue;
                const wName = _wordCloudPositions[wi].name.toLowerCase().trim();

                // Exact match
                if (wName === target) { bestIdx = wi; bestScore = 100; break; }
                // Includes match
                if (wName.includes(target) || target.includes(wName)) {
                    const score = 80;
                    if (score > bestScore) { bestScore = score; bestIdx = wi; }
                    continue;
                }
                // Partial word overlap
                const wWords = wName.split(/\s+/);
                const tWords = target.split(/\s+/);
                const overlap = wWords.filter(w => tWords.some(t => t.includes(w) || w.includes(t))).length;
                if (overlap > 0) {
                    const score = 50 + overlap * 15;
                    if (score > bestScore) { bestScore = score; bestIdx = wi; }
                }
            }

            // If no match found, take highest-relevance unclaimed word
            if (bestIdx === -1) {
                let maxRel = -1;
                for (let wi = 0; wi < _wordCloudPositions.length; wi++) {
                    if (claimed.has(wi)) continue;
                    if (_wordCloudPositions[wi].relevance > maxRel) {
                        maxRel = _wordCloudPositions[wi].relevance;
                        bestIdx = wi;
                    }
                }
            }

            if (bestIdx >= 0) {
                claimed.add(bestIdx);
                winners.push({ wordIdx: bestIdx, mainIdx: mi });
            }
        }

        // Winner words: fly to Y-axis label position (top-left / top-right)
        const flyDuration = 700;
        const cx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        const cy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;

        for (const w of winners) {
            const pos = _wordCloudPositions[w.wordIdx];
            const el = pos.el;
            const mainName = mainEffectNames[w.mainIdx];
            const isLeft = w.mainIdx === 0;
            // Match buildSingleYAxis label position: inside plot area, top corner
            const targetX = isLeft
                ? PHASE_CHART.padL + 6
                : PHASE_CHART.padL + PHASE_CHART.plotW - 6;
            const targetY = PHASE_CHART.padT + 14;

            // Crossfade text if names differ
            if (pos.name.toLowerCase().trim() !== mainName.toLowerCase().trim()) {
                el.animate([{ opacity: parseFloat(el.getAttribute('opacity') || 0.8) }, { opacity: 0 }], {
                    duration: 150, fill: 'forwards',
                });
                setTimeout(() => {
                    el.textContent = mainName;
                    el.setAttribute('font-size', '13');
                    el.setAttribute('fill', mainColors[w.mainIdx] || WORD_CLOUD_PALETTE[0]);
                    el.setAttribute('text-anchor', isLeft ? 'start' : 'end');
                    el.animate([{ opacity: 0 }, { opacity: 0.9 }], {
                        duration: 150, fill: 'forwards',
                    });
                }, 150);
            }

            // Fly to axis label position, shrink font, then fade
            const startX = pos.x;
            const startY = pos.y;
            const startFontSize = parseFloat(el.getAttribute('font-size'));
            const targetFontSize = 11;
            const startTime = performance.now();
            const delay = 300;

            (function animateFly() {
                const elapsed = performance.now() - startTime;
                if (elapsed < delay) { requestAnimationFrame(animateFly); return; }
                const t = Math.min(1, (elapsed - delay) / flyDuration);
                const ease = 1 - Math.pow(1 - t, 3);

                el.setAttribute('x', (startX + (targetX - startX) * ease).toFixed(1));
                el.setAttribute('y', (startY + (targetY - startY) * ease).toFixed(1));
                el.setAttribute('font-size', (startFontSize + (targetFontSize - startFontSize) * ease).toFixed(1));
                el.setAttribute('font-weight', '500');
                el.setAttribute('letter-spacing', '0.04em');

                if (t >= 1) {
                    el.animate([{ opacity: 0.9 }, { opacity: 0 }], {
                        duration: 120, fill: 'forwards',
                    });
                } else {
                    requestAnimationFrame(animateFly);
                }
            })();
        }

        // Non-winners: simultaneous radial burst outward from center + fast fade
        const burstDuration = 350;
        words.forEach(word => {
            const isWinner = winners.some(w => _wordCloudPositions[w.wordIdx].el === word);
            if (isWinner) return;

            const curX = parseFloat(word.getAttribute('x'));
            const curY = parseFloat(word.getAttribute('y'));
            // Radial direction away from center
            let dx = curX - cx;
            let dy = curY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const burstDist = 250 + Math.random() * 100;
            dx = (dx / dist) * burstDist;
            dy = (dy / dist) * burstDist;

            const t0 = performance.now();
            (function burst() {
                const t = Math.min(1, (performance.now() - t0) / burstDuration);
                const ease = 1 - Math.pow(1 - t, 2); // ease-out-quad: fast start

                word.setAttribute('x', (curX + dx * ease).toFixed(1));
                word.setAttribute('y', (curY + dy * ease).toFixed(1));
                word.setAttribute('opacity', Math.max(0, 1 - t * 2).toFixed(2));

                if (t < 1) requestAnimationFrame(burst);
            })();
        });

        // Resolve after longest animation
        const totalTime = Math.max(flyDuration + 300 + 120, burstDuration);
        setTimeout(() => {
            // Remove only word-cloud words — preserve orbital rings (still morphing)
            group.querySelectorAll('.word-cloud-word').forEach(el => el.remove());
            _wordCloudPositions = [];
            resolve();
        }, totalTime + 50);
    });
}

// ---- Phase Chart: Curve Path Utility ----
const PHASE_SMOOTH_PASSES = 3;

function smoothPhaseValues(points, passes = 3) {
    if (!points || points.length < 5 || passes <= 0) return points || [];

    let vals = points.map(p => Number(p.value));

    // Intentional low-pass filtering for approximation-first visualization.
    for (let p = 0; p < passes; p++) {
        const next = [vals[0], vals[1]];
        for (let i = 2; i < vals.length - 2; i++) {
            next.push(
                vals[i - 2] * 0.08 +
                vals[i - 1] * 0.24 +
                vals[i] * 0.36 +
                vals[i + 1] * 0.24 +
                vals[i + 2] * 0.08
            );
        }
        next.push(vals[vals.length - 2], vals[vals.length - 1]);
        vals = next;
    }

    return points.map((p, i) => ({ ...p, value: vals[i] }));
}

function phasePointsToPath(points, alreadySmoothed = false) {
    if (!points || points.length < 2) return '';

    const smoothed = alreadySmoothed ? points : smoothPhaseValues(points, PHASE_SMOOTH_PASSES);
    const coords = smoothed.map(p => ({
        x: phaseChartX(Number(p.hour) * 60),
        y: phaseChartY(Number(p.value)),
    }));

    // Fallback to polyline if x ordering is invalid.
    for (let i = 0; i < coords.length - 1; i++) {
        if (!(coords[i + 1].x > coords[i].x)) {
            let linear = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
            for (let j = 1; j < coords.length; j++) {
                linear += ` L ${coords[j].x.toFixed(1)} ${coords[j].y.toFixed(1)}`;
            }
            return linear;
        }
    }

    if (coords.length === 2) {
        return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`;
    }

    // Monotone cubic interpolation (Fritsch-Carlson) to avoid overshoot artifacts.
    const n = coords.length;
    const dx = new Array(n - 1);
    const dy = new Array(n - 1);
    const m = new Array(n - 1);
    const t = new Array(n);

    for (let i = 0; i < n - 1; i++) {
        dx[i] = coords[i + 1].x - coords[i].x;
        dy[i] = coords[i + 1].y - coords[i].y;
        m[i] = dy[i] / dx[i];
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

    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
        const p0 = coords[i];
        const p1 = coords[i + 1];
        const h = dx[i];
        const cp1x = p0.x + h / 3;
        const cp1y = p0.y + (t[i] * h) / 3;
        const cp2x = p1.x - h / 3;
        const cp2y = p1.y - (t[i + 1] * h) / 3;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }

    return d;
}

function phasePointsToFillPath(points, alreadySmoothed = false) {
    const pathD = phasePointsToPath(points, alreadySmoothed);
    if (!pathD) return '';
    const firstX = phaseChartX(points[0].hour * 60);
    const lastX = phaseChartX(points[points.length - 1].hour * 60);
    const baseY = phaseChartY(0);
    return pathD + ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
}

/** Progressive morph: blend desired→Lx values based on playhead position */
function buildProgressiveMorphPoints(desiredPts, lxPts, playheadHour, blendWidth) {
    const halfBlend = blendWidth / 2;
    const len = Math.min(desiredPts.length, lxPts.length);
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
        const hour = desiredPts[i].hour;
        let t; // 0 = fully desired, 1 = fully Lx
        if (hour <= playheadHour - halfBlend) {
            t = 1;
        } else if (hour >= playheadHour + halfBlend) {
            t = 0;
        } else {
            const x = (playheadHour + halfBlend - hour) / blendWidth;
            t = x * x * (3 - 2 * x); // smoothstep
        }
        result[i] = {
            hour: hour,
            value: desiredPts[i].value + (lxPts[i].value - desiredPts[i].value) * t,
        };
    }
    return result;
}

// ---- Phase Chart: Peak descriptor labels with collision avoidance ----
function findCurvePeak(points) {
    const smoothed = smoothPhaseValues(points, PHASE_SMOOTH_PASSES);
    let peak = smoothed[0];
    for (const p of smoothed) {
        if (p.value > peak.value) peak = p;
    }
    return peak;
}

function findCurveTrough(points) {
    const smoothed = smoothPhaseValues(points, PHASE_SMOOTH_PASSES);
    let trough = smoothed[0];
    for (const p of smoothed) {
        if (p.value < trough.value) trough = p;
    }
    return trough;
}

function nearestLevel(value) {
    const levels = [0, 25, 50, 75, 100];
    let best = levels[0];
    for (const l of levels) {
        if (Math.abs(l - value) < Math.abs(best - value)) best = l;
    }
    return best;
}

function findMaxDivergence(curve) {
    const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
    let best = null;
    const len = Math.min(blSmoothed.length, dsSmoothed.length);
    for (let j = 0; j < len; j++) {
        const diff = dsSmoothed[j].value - blSmoothed[j].value;
        if (!best || Math.abs(diff) > Math.abs(best.diff)) {
            best = { hour: dsSmoothed[j].hour, value: dsSmoothed[j].value, diff };
        }
    }
    return best;
}

function placePeakDescriptors(group, curvesData, pointsKey, baseDelay) {
    // Both baseline and target labels anchor at the max divergence point —
    // the time where the intervention matters most to the user.
    // Baseline label: shows the baseline value at that critical time
    // Target label: shows the target value at that critical time
    const isBaseline = pointsKey === 'baseline';

    const items = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;

        // Find the max divergence point (most impactful time)
        const div = findMaxDivergence(curve);
        let keyPoint;
        if (div) {
            if (isBaseline) {
                // Read the baseline value at the divergence time
                const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
                const match = blSmoothed.reduce((a, b) =>
                    Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a);
                keyPoint = { hour: match.hour, value: match.value };
            } else {
                // Target value at divergence time (already in div)
                keyPoint = div;
            }
        } else {
            // Fallback if no divergence data
            keyPoint = isBaseline
                ? findCurveTrough(curve[pointsKey])
                : findCurvePeak(curve[pointsKey]);
        }

        const level = nearestLevel(keyPoint.value);
        const descriptor = curve.levels[String(level)];
        if (!descriptor) continue;
        const px = phaseChartX(keyPoint.hour * 60);
        const py = phaseChartY(keyPoint.value);
        items.push({ curve, curveIdx: i, descriptor, px, py, peakVal: keyPoint.value });
    }
    if (items.length === 0) return;

    // Default placement: label goes on the side with more space
    // High values (low py) → label above; Low values (high py) → label below
    for (const item of items) {
        const isHighValue = item.peakVal >= 50;
        item.labelY = isHighValue ? item.py - 14 : item.py + 18;
    }

    // Collision avoidance for 2 labels
    if (items.length === 2) {
        const dx = Math.abs(items[0].px - items[1].px);
        const dy = Math.abs(items[0].labelY - items[1].labelY);
        // Estimate text width ~7px per char
        const w0 = items[0].descriptor.length * 7 / 2;
        const w1 = items[1].descriptor.length * 7 / 2;
        const xOverlap = dx < (w0 + w1 + 10);
        const yOverlap = dy < 18;

        if (xOverlap && yOverlap) {
            // Put the higher-peak label above, lower-peak label below its curve
            const higher = items[0].peakVal >= items[1].peakVal ? 0 : 1;
            const lower = 1 - higher;
            items[higher].labelY = items[higher].py - 16;
            items[lower].labelY = items[lower].py + 16;
        }
    }

    // Clamp within chart bounds
    for (const item of items) {
        item.labelY = Math.max(PHASE_CHART.padT + 12, Math.min(PHASE_CHART.padT + PHASE_CHART.plotH - 8, item.labelY));
    }

    // Create and animate labels with backdrop for readability over curves
    const dt = chartTheme();
    for (let i = 0; i < items.length; i++) {
        const { curve, curveIdx, descriptor, px, labelY } = items[i];
        const delayMs = baseDelay + i * 200;

        // Estimate text dimensions for backdrop pill
        const estTextW = descriptor.length * 6.5;
        const pillPadX = 8, pillPadY = 4;
        const pillW = estTextW + pillPadX * 2;
        const pillH = 16 + pillPadY * 2;

        // Container group for backdrop + text
        const labelGroup = svgEl('g', {
            class: 'peak-descriptor', opacity: '0',
            'data-effect-idx': String(curveIdx),
        });

        // Backdrop pill
        const backdrop = svgEl('rect', {
            x: (px - pillW / 2).toFixed(1),
            y: (labelY - pillH / 2 - 2).toFixed(1),
            width: pillW.toFixed(1),
            height: pillH.toFixed(1),
            rx: '6', ry: '6',
            fill: dt.tooltipBg,
        });
        labelGroup.appendChild(backdrop);

        const label = svgEl('text', {
            x: px.toFixed(1), y: (labelY + 1).toFixed(1),
            fill: curve.color,
            'font-family': "'Space Grotesk', sans-serif",
            'font-size': '11', 'font-weight': '600',
            'text-anchor': 'middle', 'letter-spacing': '0.03em',
            'dominant-baseline': 'middle',
        });
        label.textContent = descriptor;
        labelGroup.appendChild(label);
        // Append to per-effect sub-group if divider is active, otherwise to parent
        const targetGroup = (DividerState.active && curvesData.length >= 2)
            ? getEffectSubGroup(group, curveIdx)
            : group;
        targetGroup.appendChild(labelGroup);

        const startTime = performance.now();
        (function fadeIn() {
            const elapsed = performance.now() - startTime;
            if (elapsed < delayMs) { requestAnimationFrame(fadeIn); return; }
            const t = Math.min(1, (elapsed - delayMs) / 500);
            const ease = 1 - Math.pow(1 - t, 3);
            labelGroup.setAttribute('opacity', String(0.85 * ease));
            if (t < 1) requestAnimationFrame(fadeIn);
        })();
    }
}

// ---- Phase Chart: Y-Axis Transition Indicators ----
// Renders FROM→TO level descriptors (change) or keep markers in the Y-axis margins
function renderYAxisTransitionIndicators(curvesData, animDelay = 0) {
    const group = document.getElementById('phase-yaxis-indicators');
    if (!group) return;
    group.innerHTML = '';
    group.style.opacity = '1';

    const t = chartTheme();

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;

        const side = i === 0 ? 'left' : 'right';
        const axisX = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;

        const div = findMaxDivergence(curve);
        const isChange = div && Math.abs(div.diff) >= 5;

        const sub = getEffectSubGroup(group, i);

        if (isChange) {
            renderChangeIndicator(sub, curve, i, div, side, axisX, t, animDelay + i * 200);
        } else {
            renderKeepIndicator(sub, curve, i, side, axisX, t, animDelay + i * 200);
        }
    }
}

function renderChangeIndicator(group, curve, curveIdx, div, side, axisX, theme, delay) {
    const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    const blMatch = blSmoothed.reduce((a, b) =>
        Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a);

    const baselineVal = blMatch.value;
    const desiredVal = div.value;

    const baseLevel = nearestLevel(baselineVal);
    const desiredLevel = nearestLevel(desiredVal);

    const baseDescriptor = curve.levels[String(baseLevel)];
    const desiredDescriptor = curve.levels[String(desiredLevel)];
    if (!baseDescriptor || !desiredDescriptor) return;
    if (baseLevel === desiredLevel) return;

    const baseY = phaseChartY(baseLevel);
    const desiredY = phaseChartY(desiredLevel);

    const textX = side === 'left' ? axisX - 14 : axisX + 14;
    const textAnchor = side === 'left' ? 'end' : 'start';

    const maxChars = 10;
    const baseTxt = baseDescriptor.length > maxChars
        ? baseDescriptor.slice(0, maxChars - 1) + '\u2026' : baseDescriptor;
    const desTxt = desiredDescriptor.length > maxChars
        ? desiredDescriptor.slice(0, maxChars - 1) + '\u2026' : desiredDescriptor;

    const container = svgEl('g', {
        class: 'yaxis-change-indicator', opacity: '0',
        'data-effect-idx': String(curveIdx),
    });

    // FROM label (baseline level — strikethrough, subdued)
    const fromLabel = svgEl('text', {
        x: String(textX), y: (baseY + 3).toFixed(1),
        fill: curve.color, 'fill-opacity': '0.5',
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '9', 'font-weight': '500',
        'text-anchor': textAnchor,
        'text-decoration': 'line-through',
        'letter-spacing': '0.01em',
    });
    fromLabel.textContent = baseTxt;
    container.appendChild(fromLabel);

    // TO label (desired level — bold, bright)
    const toLabel = svgEl('text', {
        x: String(textX), y: (desiredY + 3).toFixed(1),
        fill: curve.color, 'fill-opacity': '0.92',
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '9', 'font-weight': '700',
        'text-anchor': textAnchor,
        'letter-spacing': '0.01em',
    });
    toLabel.textContent = desTxt;
    container.appendChild(toLabel);

    // Vertical arrow shaft in the margin
    const arrowX = side === 'left' ? axisX - 6 : axisX + 6;

    const shaft = svgEl('line', {
        x1: String(arrowX), y1: baseY.toFixed(1),
        x2: String(arrowX), y2: baseY.toFixed(1),
        stroke: curve.color, 'stroke-width': '1.5',
        'stroke-opacity': '0.7', 'stroke-linecap': 'round',
    });
    container.appendChild(shaft);

    // Arrow tip (inline chevron)
    const tipSize = 4;
    const tipDir = desiredY < baseY ? -1 : 1; // -1 = up (higher value), +1 = down
    const tipPath = svgEl('path', {
        d: `M${(arrowX - tipSize).toFixed(1)} ${(desiredY - tipDir * tipSize).toFixed(1)} L${arrowX.toFixed(1)} ${desiredY.toFixed(1)} L${(arrowX + tipSize).toFixed(1)} ${(desiredY - tipDir * tipSize).toFixed(1)}`,
        fill: 'none', stroke: curve.color, 'stroke-width': '1.5',
        'stroke-opacity': '0', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    container.appendChild(tipPath);

    group.appendChild(container);

    // Animate: fade in + grow arrow
    const startTime = performance.now();
    const fadeInDur = 400;
    const arrowGrowDur = 600;

    (function animate() {
        const elapsed = performance.now() - startTime;
        if (elapsed < delay) { requestAnimationFrame(animate); return; }

        const localT = elapsed - delay;

        // Fade in container
        const fadeT = Math.min(1, localT / fadeInDur);
        container.setAttribute('opacity', String(1 - Math.pow(1 - fadeT, 3)));

        // Grow arrow shaft (starts 200ms after fade begins)
        if (localT > 200) {
            const arrowT = Math.min(1, (localT - 200) / arrowGrowDur);
            const arrowEase = 1 - Math.pow(1 - arrowT, 3);
            const curY2 = baseY + (desiredY - baseY) * arrowEase;
            shaft.setAttribute('y2', curY2.toFixed(1));

            // Tip fades in near completion
            if (arrowT > 0.85) {
                tipPath.setAttribute('stroke-opacity', String(0.7 * ((arrowT - 0.85) / 0.15)));
            }
        }

        if (localT < fadeInDur + arrowGrowDur + 200) {
            requestAnimationFrame(animate);
        }
    })();
}

function renderKeepIndicator(group, curve, curveIdx, side, axisX, theme, delay) {
    const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);

    // Find baseline range
    let minVal = 100, maxVal = 0;
    for (const pt of blSmoothed) {
        if (pt.value < minVal) minVal = pt.value;
        if (pt.value > maxVal) maxVal = pt.value;
    }

    const avgVal = (minVal + maxVal) / 2;
    const avgLevel = nearestLevel(avgVal);
    const descriptor = curve.levels ? curve.levels[String(avgLevel)] : null;
    if (!descriptor) return;

    const centerY = phaseChartY(avgVal);
    const textX = side === 'left' ? axisX - 14 : axisX + 14;
    const textAnchor = side === 'left' ? 'end' : 'start';

    const maxChars = 10;
    const txt = descriptor.length > maxChars
        ? descriptor.slice(0, maxChars - 1) + '\u2026' : descriptor;

    const container = svgEl('g', {
        class: 'yaxis-keep-indicator', opacity: '0',
        'data-effect-idx': String(curveIdx),
    });

    // Level descriptor text
    const label = svgEl('text', {
        x: String(textX), y: (centerY + 3).toFixed(1),
        fill: curve.color, 'fill-opacity': '0.75',
        'font-family': "'IBM Plex Mono', monospace",
        'font-size': '9', 'font-weight': '500',
        'text-anchor': textAnchor,
    });
    label.textContent = txt;
    container.appendChild(label);

    // Keep marker: horizontal line with center dot
    const markerX = side === 'left' ? axisX - 6 : axisX + 6;
    const markerHalfW = 6;

    container.appendChild(svgEl('line', {
        x1: String(markerX - markerHalfW), y1: centerY.toFixed(1),
        x2: String(markerX + markerHalfW), y2: centerY.toFixed(1),
        stroke: curve.color, 'stroke-width': '1.2',
        'stroke-opacity': '0.6', 'stroke-linecap': 'round',
    }));

    container.appendChild(svgEl('circle', {
        cx: String(markerX), cy: centerY.toFixed(1),
        r: '2.5', fill: curve.color, 'fill-opacity': '0.7',
    }));

    // Small "keep" label below marker
    const keepLabel = svgEl('text', {
        x: String(markerX), y: (centerY + 14).toFixed(1),
        fill: curve.color, 'fill-opacity': '0.45',
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '7', 'font-weight': '500',
        'text-anchor': 'middle', 'font-style': 'italic',
    });
    keepLabel.textContent = 'keep';
    container.appendChild(keepLabel);

    // Baseline range bracket (dashed vertical span)
    const minY = phaseChartY(minVal);
    const maxY = phaseChartY(maxVal);
    if (Math.abs(minY - maxY) > 8) {
        container.appendChild(svgEl('line', {
            x1: String(markerX), y1: maxY.toFixed(1),
            x2: String(markerX), y2: minY.toFixed(1),
            stroke: curve.color, 'stroke-width': '0.8',
            'stroke-opacity': '0.3', 'stroke-dasharray': '2 2',
        }));
    }

    group.appendChild(container);

    // Animate: simple fade in
    const startTime = performance.now();
    (function animate() {
        const elapsed = performance.now() - startTime;
        if (elapsed < delay) { requestAnimationFrame(animate); return; }
        const localT = Math.min(1, (elapsed - delay) / 500);
        container.setAttribute('opacity', String(0.85 * (1 - Math.pow(1 - localT, 3))));
        if (localT < 1) requestAnimationFrame(animate);
    })();
}

// ---- Phase Chart: Render Baseline Curves ----
async function renderBaselineCurves(curvesData) {
    const group = document.getElementById('phase-baseline-curves');
    group.innerHTML = '';

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const pathD = phasePointsToPath(curve.baseline);
        if (!pathD) continue;

        const sub = getEffectSubGroup(group, i);

        // Area fill
        const fillPath = svgEl('path', {
            d: phasePointsToFillPath(curve.baseline),
            fill: curve.color, 'fill-opacity': '0', // animate in
        });
        sub.appendChild(fillPath);

        // Dashed stroke
        const strokePath = svgEl('path', {
            d: pathD, fill: 'none', stroke: curve.color,
            class: 'phase-baseline-path', opacity: '0',
        });
        sub.appendChild(strokePath);

        // Animate fade-in
        strokePath.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: 800, fill: 'forwards' });
        fillPath.animate([{ fillOpacity: 0 }, { fillOpacity: 0.04 }], { duration: 800, fill: 'forwards' });

            await sleep(200);
    }

    // Place peak descriptors at each baseline curve's peak (batch for collision avoidance)
    placePeakDescriptors(group, curvesData, 'baseline', 400);

    // Activate split-screen divider for 2-effect mode
    activateDivider(curvesData);
}

/** Instant baseline curves — no animation, used after ring→curve morph */
function renderBaselineCurvesInstant(curvesData) {
    const group = document.getElementById('phase-baseline-curves');
    group.innerHTML = '';

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const pathD = phasePointsToPath(curve.baseline);
        if (!pathD) continue;

        const sub = getEffectSubGroup(group, i);

        const fillPath = svgEl('path', {
            d: phasePointsToFillPath(curve.baseline),
            fill: curve.color, 'fill-opacity': '0.04',
        });
        sub.appendChild(fillPath);

        const strokePath = svgEl('path', {
            d: pathD, fill: 'none', stroke: curve.color,
            class: 'phase-baseline-path', opacity: '0.5',
        });
        sub.appendChild(strokePath);
    }

    placePeakDescriptors(group, curvesData, 'baseline', 0);

    // Activate split-screen divider for 2-effect mode
    activateDivider(curvesData);
}

// ---- Phase Chart: Morph baseline → desired with arrows ----
async function morphToDesiredCurves(curvesData) {
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const arrowGroup = document.getElementById('phase-mission-arrows');
    desiredGroup.innerHTML = '';
    arrowGroup.innerHTML = '';

    // Compute one arrow per curve at the point of maximum divergence
    const allArrows = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const div = findMaxDivergence(curve);
        if (!div || Math.abs(div.diff) < 5) continue;
        // Get baseline value at the same hour
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const match = blSmoothed.reduce((a, b) => Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a);
        allArrows.push({ curve, idx: i, arrow: { hour: div.hour, baseVal: match.value, desiredVal: div.value, diff: div.diff } });
    }

    // Phase 1: Grow elegant arrows from baseline → desired (900ms)
    for (const { curve, idx, arrow } of allArrows) {
        const arrowSub = getEffectSubGroup(arrowGroup, idx);
        const x = phaseChartX(arrow.hour * 60);
        const y1 = phaseChartY(arrow.baseVal);
        const y2 = phaseChartY(arrow.desiredVal);

        // Subtle glow behind the arrow shaft
        const glowLine = svgEl('line', {
            x1: x.toFixed(1), y1: y1.toFixed(1),
            x2: x.toFixed(1), y2: y1.toFixed(1),
            stroke: curve.color, 'stroke-width': '4', 'stroke-opacity': '0',
            'stroke-linecap': 'round', fill: 'none', 'pointer-events': 'none',
        });
        arrowSub.appendChild(glowLine);

        // Main arrow shaft
        const arrowLine = svgEl('line', {
            x1: x.toFixed(1), y1: y1.toFixed(1),
            x2: x.toFixed(1), y2: y1.toFixed(1),
            stroke: curve.color, class: 'mission-arrow', opacity: '0',
        });
        arrowSub.appendChild(arrowLine);

        // Animate both shaft and glow
        const startTime = performance.now();
        const animDur = 900;
        (function animateArrow() {
            const t = Math.min(1, (performance.now() - startTime) / animDur);
            const ease = 1 - Math.pow(1 - t, 3);
            const curY = y1 + (y2 - y1) * ease;
            const opacity = 0.7 * Math.min(1, t * 2.5);
            arrowLine.setAttribute('opacity', String(opacity));
            arrowLine.setAttribute('y2', curY.toFixed(1));
            glowLine.setAttribute('stroke-opacity', String(0.15 * Math.min(1, t * 2.5)));
            glowLine.setAttribute('y2', curY.toFixed(1));
            if (t < 1) requestAnimationFrame(animateArrow);
        })();
    }

    // Y-axis margin indicators (change arrows / keep markers) — concurrent with mission arrows
    renderYAxisTransitionIndicators(curvesData, 0);

    await sleep(400);

    // Phase 2: Morph baseline paths → desired paths (1200ms)
    const morphDuration = 1200;

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];

        // Create desired stroke + fill that start at baseline shape
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const basePathD = phasePointsToPath(blSmoothed, true);
        const desiredPathD = phasePointsToPath(dsSmoothed, true);
        const baseFillD = phasePointsToFillPath(blSmoothed, true);

        if (!basePathD || !desiredPathD) continue;

        const desiredSub = getEffectSubGroup(desiredGroup, i);

        // Desired fill
        const fillPath = svgEl('path', {
            d: baseFillD,
            fill: curve.color, 'fill-opacity': '0',
            class: 'phase-desired-fill',
        });
        desiredSub.appendChild(fillPath);
        fillPath.animate([{ fillOpacity: 0 }, { fillOpacity: 0.08 }], { duration: morphDuration, fill: 'forwards' });

        // Desired stroke — starts at baseline path, morphs to desired
        const strokePath = svgEl('path', {
            d: basePathD, fill: 'none', stroke: curve.color,
            class: 'phase-desired-path', opacity: '0',
        });
        desiredSub.appendChild(strokePath);
        strokePath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });

        // Interpolate smoothed points for morph (matches rendered curve positions)
        const startTime = performance.now();
        (function animateMorph() {
            const t = Math.min(1, (performance.now() - startTime) / morphDuration);
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // Interpolate each smoothed point
            const morphedPoints = [];
            const len = Math.min(blSmoothed.length, dsSmoothed.length);
            for (let j = 0; j < len; j++) {
                morphedPoints.push({
                    hour: blSmoothed[j].hour,
                    value: blSmoothed[j].value + (dsSmoothed[j].value - blSmoothed[j].value) * ease,
                });
            }

            const morphPathD = phasePointsToPath(morphedPoints, true);
            const morphFillD = phasePointsToFillPath(morphedPoints, true);
            strokePath.setAttribute('d', morphPathD);
            fillPath.setAttribute('d', morphFillD);

            if (t < 1) requestAnimationFrame(animateMorph);
        })();
    }

    // Fade out baseline peak descriptors
    baseGroup.querySelectorAll('.peak-descriptor').forEach(el => {
        const fadeStart = performance.now();
        (function fadeOut() {
            const t = Math.min(1, (performance.now() - fadeStart) / 400);
            el.setAttribute('opacity', String(0.8 * (1 - t)));
            if (t < 1) requestAnimationFrame(fadeOut);
        })();
    });

    // Place peak descriptors on desired curves after morph settles
    await sleep(morphDuration + 200);

    // Place peak descriptors at each target curve's peak (batch for collision avoidance)
    placePeakDescriptors(desiredGroup, curvesData, 'desired', 0);
}

// ---- Phase Chart: Legend ----
function renderPhaseLegend(curvesData, mode) {
    // Legend removed — labels are now outside the chart (baseline/target below X-axis)
    const group = document.getElementById('phase-legend');
    group.innerHTML = '';
}

// ---- Phase Chart: Error display ----
function showPromptError(message) {
    const hint = document.getElementById('prompt-hint');
    if (!hint) return;
    hint.textContent = message;
    hint.classList.add('error');
    hint.style.opacity = '1';
}

function clearPromptError() {
    const hint = document.getElementById('prompt-hint');
    if (!hint) return;
    hint.textContent = 'e.g. "4 hours of deep focus, no sleep impact"';
    hint.classList.remove('error');
    hint.style.opacity = '';
}

// ---- Phase Chart: Reset ----
function resetPhaseChart() {
    cleanupDivider();
    ['phase-x-axis', 'phase-y-axis-left', 'phase-y-axis-right', 'phase-grid',
     'phase-scan-line', 'phase-word-cloud', 'phase-baseline-curves', 'phase-desired-curves',
     'phase-lx-curves', 'phase-lx-markers', 'phase-substance-timeline',
     'phase-biometric-strips', 'phase-mission-arrows', 'phase-yaxis-indicators',
     'phase-legend', 'phase-tooltip-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = '';
            el.classList.remove('revealed');
        }
    });
    const optimizeBtn = document.getElementById('phase-optimize-btn');
    if (optimizeBtn) {
        optimizeBtn.classList.remove('visible');
        optimizeBtn.classList.add('hidden');
    }
    const lxBtn = document.getElementById('phase-lx-btn');
    if (lxBtn) {
        lxBtn.classList.remove('visible');
        lxBtn.classList.add('hidden');
    }
    PhaseState.interventionPromise = null;
    PhaseState.interventionResult = null;
    PhaseState.lxCurves = null;
    PhaseState.wordCloudEffects = [];
    PhaseState.incrementalSnapshots = null;
    _wordCloudPositions = [];
    stopOrbitalRings();
    _orbitalRingsState = null;

    // Remove any lingering substance step labels
    document.querySelectorAll('.substance-step-label').forEach(el => el.remove());
    document.querySelectorAll('.sequential-playhead').forEach(el => el.remove());

    // Clean up morph playhead and drag state
    cleanupMorphDrag();

    // Reset phase step controls
    hidePhaseStepControls();
    PhaseState.maxPhaseReached = -1;
    PhaseState.viewingPhase = -1;

    // Clear any inline opacity/transition/filter styles left by phase stepping
    ['phase-desired-curves', 'phase-mission-arrows', 'phase-yaxis-indicators', 'phase-lx-curves', 'phase-lx-markers'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.opacity = '';
            el.style.transition = '';
            el.style.filter = '';
        }
    });

    // Clear transmutation state (dashed desired curves)
    const desiredGroup = document.getElementById('phase-desired-curves');
    if (desiredGroup) {
        desiredGroup.querySelectorAll('.phase-desired-path').forEach(p => {
            p.removeAttribute('stroke-dasharray');
        });
    }

    // Clear substance timeline
    const timeline = document.getElementById('phase-substance-timeline');
    if (timeline) timeline.innerHTML = '';

    // Clean up timeline defs + restore viewBox
    const svg = document.getElementById('phase-chart-svg');
    if (svg) {
        svg.querySelectorAll('defs [id^="tl-grad-"], defs [id^="tl-clip-"], defs [id^="bio-clip-"]').forEach(el => el.remove());
        svg.setAttribute('viewBox', '0 0 960 500');
    }

    // Reset scan lines and biometric state
    stopTimelineScanLine();
    stopBioScanLine();
    hideBiometricTrigger();
    const bioStripUI = document.getElementById('biometric-strip-ui');
    if (bioStripUI) {
        bioStripUI.classList.remove('visible');
        bioStripUI.classList.add('hidden');
    }
    BiometricState.selectedDevices = [];
    BiometricState.profileText = '';
    BiometricState.biometricResult = null;
    BiometricState.channels = [];
    BiometricState.phase = 'idle';

    // Reset play buttons
    hideInterventionPlayButton();
    hideRevisionPlayButton();
    RevisionState.revisionPromise = null;
    RevisionState.revisionResult = null;
    RevisionState.oldInterventions = null;
    RevisionState.newInterventions = null;
    RevisionState.diff = null;
    RevisionState.newLxCurves = null;
    RevisionState.phase = 'idle';
}

// ============================================
// 15a2. PHASE STEP CONTROLS (< > chevrons)
// ============================================

function showPhaseStepControls() {
    const el = document.getElementById('phase-step-controls');
    if (!el) return;
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('visible'));
}

function hidePhaseStepControls() {
    const el = document.getElementById('phase-step-controls');
    if (!el) return;
    el.classList.remove('visible');
    el.classList.add('hidden');
}

let _stepAnimating = false;
let _morphDragState = null; // Holds state for the draggable before/after playhead

function updateStepButtons() {
    const backBtn = document.getElementById('phase-step-back');
    const fwdBtn = document.getElementById('phase-step-forward');
    if (!backBtn || !fwdBtn) return;
    backBtn.disabled = _stepAnimating || PhaseState.viewingPhase <= 0;
    fwdBtn.disabled = _stepAnimating || PhaseState.viewingPhase >= PhaseState.maxPhaseReached;
}

function fadeGroup(group, targetOpacity, duration) {
    if (!group) return;
    group.style.transition = `opacity ${duration}ms ease`;
    group.style.opacity = String(targetOpacity);
}

// Stagger-fade children of a group from current opacity to target
function staggerFadeChildren(group, targetOpacity, perChildMs, staggerMs) {
    if (!group) return;
    const children = Array.from(group.children);
    children.forEach((child, i) => {
        const delay = i * staggerMs;
        child.style.transition = `opacity ${perChildMs}ms ease ${delay}ms`;
        child.style.opacity = String(targetOpacity);
    });
}

// Quick clip-path reveal left→right for Lx curves (compressed replay)
function quickLxClipReveal(durationMs) {
    const group = document.getElementById('phase-lx-curves');
    if (!group || group.children.length === 0) return;

    // Ensure children are visible first
    group.style.opacity = '1';
    for (const child of group.children) {
        child.style.opacity = '';
    }

    const svg = document.getElementById('phase-chart-svg');
    const defs = svg.querySelector('defs');
    const clipId = 'lx-step-clip-reveal';

    // Remove any leftover clip from previous step
    const old = defs.querySelector(`#${clipId}`);
    if (old) old.remove();
    group.removeAttribute('clip-path');

    const clipPath = svgEl('clipPath', { id: clipId });
    const clipRect = svgEl('rect', {
        x: String(PHASE_CHART.padL), y: '0',
        width: '0', height: String(PHASE_CHART.viewH),
    });
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    group.setAttribute('clip-path', `url(#${clipId})`);

    const startTime = performance.now();
    (function animate() {
        const t = Math.min(1, (performance.now() - startTime) / durationMs);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        clipRect.setAttribute('width', String(PHASE_CHART.plotW * ease));
        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            group.removeAttribute('clip-path');
            clipPath.remove();
        }
    })();
}

async function stepToPhase(targetIdx) {
    const current = PhaseState.viewingPhase;
    if (targetIdx === current) return;
    if (targetIdx < 0 || targetIdx > PhaseState.maxPhaseReached) return;
    if (_stepAnimating) return;

    const desiredGroup = document.getElementById('phase-desired-curves');
    const arrowGroup = document.getElementById('phase-mission-arrows');
    const lxGroup = document.getElementById('phase-lx-curves');
    const lxMarkers = document.getElementById('phase-lx-markers');
    const timelineGroup = document.getElementById('phase-substance-timeline');
    const baseGroup = document.getElementById('phase-baseline-curves');

    if (targetIdx < current) {
        // ---- Stepping BACKWARD — fast rewind via fades/morphs ----
        _stepAnimating = true;
        const dur = 250;

        if (targetIdx < 4 && current >= 4) {
            // Phase 4→3: undo revision — restore old Lx curves + timeline
            hideRevisionPlayButton();
            if (RevisionState.oldInterventions && PhaseState.curvesData) {
                const oldLx = computeLxOverlay(RevisionState.oldInterventions, PhaseState.curvesData);
                PhaseState.lxCurves = oldLx;
                PhaseState.interventionResult = { interventions: RevisionState.oldInterventions.map(iv => ({
                    key: iv.key, dose: iv.dose, doseMultiplier: iv.doseMultiplier,
                    timeMinutes: iv.timeMinutes, impacts: iv.impacts, rationale: iv.rationale,
                })) };
                PhaseState.incrementalSnapshots = computeIncrementalLxOverlay(RevisionState.oldInterventions, PhaseState.curvesData);
                // Re-render timeline with original interventions
                renderSubstanceTimeline(RevisionState.oldInterventions, oldLx, PhaseState.curvesData);
                revealTimelinePillsInstant();
                preserveBiometricStrips();
                // Restore Lx curves
                const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
                const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');
                for (let ci = 0; ci < PhaseState.curvesData.length; ci++) {
                    if (oldLx[ci] && oldLx[ci].points) {
                        if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(oldLx[ci].points, true));
                        if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(oldLx[ci].points, true));
                    }
                }
            }
        }

        if (targetIdx < 3 && current >= 3) {
            // Remove biometric strips
            const bioGroup = document.getElementById('phase-biometric-strips');
            if (bioGroup) {
                fadeGroup(bioGroup, 0, dur);
                await sleep(dur);
                bioGroup.innerHTML = '';
                bioGroup.style.opacity = '';
            }
            // Hide trigger + strip UI
            hideBiometricTrigger();
            const svg = document.getElementById('phase-chart-svg');
            if (svg) {
                svg.querySelectorAll('defs [id^="bio-clip-"]').forEach(el => el.remove());
                // Recalculate viewBox based on timeline
                const tlGroup = document.getElementById('phase-substance-timeline');
                if (tlGroup && tlGroup.children.length > 0) {
                    const tlBox = tlGroup.getBBox();
                    const neededH = Math.ceil(tlBox.y + tlBox.height + TIMELINE_ZONE.bottomPad);
                    svg.setAttribute('viewBox', `0 0 960 ${Math.max(500, neededH)}`);
                } else {
                    svg.setAttribute('viewBox', '0 0 960 500');
                }
            }
            // Hide the strip UI
            const bioStripUI = document.getElementById('biometric-strip-ui');
            if (bioStripUI) {
                bioStripUI.classList.remove('visible');
                bioStripUI.classList.add('hidden');
            }
        }

        if (targetIdx < 2 && current >= 2) {
            // Remove Lx layer: clear ghost AUC fills, timeline, markers, playhead
            hideInterventionPlayButton();
            lxGroup.innerHTML = '';
            fadeGroup(lxMarkers, 0, dur);
            timelineGroup.innerHTML = '';
            document.querySelectorAll('.substance-step-label, .sequential-playhead').forEach(el => el.remove());
            // Restore desired curves from ghost back to solid
            transmuteDesiredCurves(false);
            // Restore arrows
            arrowGroup.style.opacity = '1';
            arrowGroup.style.filter = '';
            Array.from(arrowGroup.children).forEach(ch => {
                ch.style.opacity = '';
                ch.getAnimations().forEach(a => a.cancel());
            });
            // Restore Y-axis indicators
            const yaxisInd = document.getElementById('phase-yaxis-indicators');
            if (yaxisInd) { yaxisInd.style.opacity = '1'; yaxisInd.style.filter = ''; }
            // Restore baseline curves to their original shape (scans morphed them)
            const cd = PhaseState.curvesData;
            if (cd) {
                const bStrokes = baseGroup.querySelectorAll('.phase-baseline-path');
                const bFills = baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)');
                for (let ci = 0; ci < cd.length; ci++) {
                    const origD = phasePointsToPath(cd[ci].baseline);
                    const origFillD = phasePointsToFillPath(cd[ci].baseline);
                    if (bStrokes[ci]) {
                        bStrokes[ci].setAttribute('d', origD);
                        bStrokes[ci].setAttribute('stroke-dasharray', '6 4');
                        bStrokes[ci].setAttribute('stroke-opacity', '0.54');
                        bStrokes[ci].setAttribute('stroke-width', '1.7');
                    }
                    if (bFills[ci] && origFillD) bFills[ci].setAttribute('d', origFillD);
                }
                // Restore baseline peak descriptors
                baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
                placePeakDescriptors(baseGroup, cd, 'baseline', 0);
            }
        }
        if (targetIdx < 1 && current >= 1) {
            fadeGroup(desiredGroup, 0, dur);
            fadeGroup(arrowGroup, 0, dur);
            const indicatorGroup = document.getElementById('phase-yaxis-indicators');
            if (indicatorGroup) fadeGroup(indicatorGroup, 0, dur);
        }

        if (targetIdx === 0) {
            baseGroup.querySelectorAll('.peak-descriptor').forEach(el => {
                el.style.transition = `opacity ${dur}ms ease`;
                el.style.opacity = '0.8';
            });
        }

        await sleep(dur + 50);
        _stepAnimating = false;
        PhaseState.viewingPhase = targetIdx;
        updateStepButtons();

    } else {
        // ---- Stepping FORWARD — replay the actual animations from cached data ----
        _stepAnimating = true;
        updateStepButtons();

        const curvesData = PhaseState.curvesData;
        if (!curvesData) { _stepAnimating = false; return; }

        if (targetIdx >= 1 && current < 1) {
            // Phase 0→1: Replay the real morphToDesiredCurves animation
            baseGroup.querySelectorAll('.peak-descriptor').forEach(el => {
                el.style.transition = 'opacity 300ms ease';
                el.style.opacity = '0';
            });

            await morphToDesiredCurves(curvesData);
            renderPhaseLegend(curvesData, 'full');

            PhaseState.viewingPhase = 1;
            updateStepButtons();
        }

        if (targetIdx >= 2 && PhaseState.viewingPhase < 2) {
            // Phase 1→2: Show play button then replay sequential substance animation
            const snapshots = PhaseState.incrementalSnapshots;
            const interventionData = PhaseState.interventionResult;
            if (snapshots && interventionData) {
                const interventions = validateInterventions(interventionData.interventions || [], curvesData);

                // Show amber play button and wait for click
                showInterventionPlayButton();
                _stepAnimating = false; // Allow UI interaction while waiting
                await new Promise(resolve => {
                    const btn = document.getElementById('intervention-play-btn');
                    if (!btn) { resolve(); return; }
                    btn.addEventListener('click', () => {
                        hideInterventionPlayButton();
                        resolve();
                    }, { once: true });
                });
                _stepAnimating = true;

                await animateSequentialLxReveal(snapshots, interventions, curvesData);
            }

            PhaseState.viewingPhase = 2;
            updateStepButtons();
        }

        if (targetIdx >= 3 && PhaseState.viewingPhase < 3) {
            // Phase 2→3: Re-render biometric strips from cache or show trigger
            if (BiometricState.biometricResult) {
                renderBiometricStrips(BiometricState.channels);
                await animateBiometricReveal(600);
                PhaseState.viewingPhase = 3;
            } else {
                showBiometricTrigger();
                PhaseState.viewingPhase = 2; // stay at 2 until user completes flow
            }
            updateStepButtons();
        }

        if (targetIdx >= 4 && PhaseState.viewingPhase < 4) {
            // Phase 3→4: Replay revision from cache or show play button
            if (RevisionState.phase === 'rendered' && RevisionState.newLxCurves) {
                const oldLx = computeLxOverlay(RevisionState.oldInterventions, curvesData);
                const diff = RevisionState.diff || diffInterventions(RevisionState.oldInterventions, RevisionState.newInterventions);
                await animateRevisionScan(diff, RevisionState.newInterventions, RevisionState.newLxCurves, curvesData);
                await morphLxCurvesToRevision(oldLx, RevisionState.newLxCurves, curvesData);
                PhaseState.lxCurves = RevisionState.newLxCurves;
                PhaseState.viewingPhase = 4;
            } else if (RevisionState.revisionResult) {
                showRevisionPlayButton();
                setRevisionPlayReady();
            } else {
                showRevisionPlayButton();
            }
            updateStepButtons();
        }

        _stepAnimating = false;
        updateStepButtons();
    }
}

function initPhaseStepControls() {
    const backBtn = document.getElementById('phase-step-back');
    const fwdBtn = document.getElementById('phase-step-forward');
    if (!backBtn || !fwdBtn) return;

    backBtn.addEventListener('click', () => {
        if (PhaseState.viewingPhase > 0) {
            stepToPhase(PhaseState.viewingPhase - 1);
        }
    });

    fwdBtn.addEventListener('click', () => {
        if (PhaseState.viewingPhase < PhaseState.maxPhaseReached) {
            stepToPhase(PhaseState.viewingPhase + 1);
        }
    });
}

// ============================================
// 15b. EFFECT CHART RENDERER (for simulation — existing)
// ============================================

const CHART = {
    viewW: 520, viewH: 360,
    padL: 50, padR: 20, padT: 30, padB: 40,
    startHour: 6, endHour: 24,   // 06:00 – 24:00
    maxEffect: 100,
    baselineLevel: 15,
    sampleInterval: 10,          // minutes between curve sample points
};

CHART.plotW = CHART.viewW - CHART.padL - CHART.padR;
CHART.plotH = CHART.viewH - CHART.padT - CHART.padB;
CHART.startMin = CHART.startHour * 60;
CHART.endMin = CHART.endHour * 60;
CHART.totalMin = CHART.endMin - CHART.startMin;

function chartX(minutes) {
    return CHART.padL + ((minutes - CHART.startMin) / CHART.totalMin) * CHART.plotW;
}

function chartY(effectVal) {
    const clamped = Math.max(-20, Math.min(CHART.maxEffect, effectVal));
    return CHART.padT + CHART.plotH - (clamped / CHART.maxEffect) * CHART.plotH;
}

/**
 * Compute the effect value of a single substance dose at a given time.
 * Uses a piecewise model: ramp up → peak → plateau → exponential decay → optional rebound.
 */
function substanceEffectAt(minutesSinceDose, pharma) {
    if (minutesSinceDose < 0) return 0;
    const { onset, peak, duration, halfLife, strength, rebound } = pharma;

    let effect = 0;
    if (minutesSinceDose <= onset) {
        // Ramp-up phase (ease-in)
        const t = minutesSinceDose / onset;
        effect = strength * t * t;
    } else if (minutesSinceDose <= peak) {
        // Rising to peak (ease-out)
        const t = (minutesSinceDose - onset) / (peak - onset);
        effect = strength * (0.7 + 0.3 * (1 - (1 - t) * (1 - t)));
    } else if (minutesSinceDose <= duration * 0.6) {
        // Plateau near peak
        const decay = (minutesSinceDose - peak) / (duration * 0.6 - peak);
        effect = strength * (1 - decay * 0.15);
    } else if (minutesSinceDose <= duration) {
        // Exponential decay
        const elapsed = minutesSinceDose - duration * 0.6;
        effect = strength * 0.85 * Math.pow(0.5, elapsed / halfLife);
    } else {
        // Post-duration: continued decay + rebound dip
        const elapsedAtDuration = duration - duration * 0.6;
        const valueAtDuration = strength * 0.85 * Math.pow(0.5, elapsedAtDuration / halfLife);
        const elapsed = minutesSinceDose - duration;
        const residual = valueAtDuration * Math.pow(0.5, elapsed / halfLife);
        const reboundDip = rebound * Math.exp(-elapsed / (halfLife * 0.5));
        effect = residual - reboundDip;
    }

    return effect;
}

/**
 * Compute all effect curves from a stack.
 * Returns { effectType: { label, color, points: [{min, val}] }, ... }
 */
function computeEffectCurves(stack) {
    const curves = {};

    // Build dose events: {substanceKey, doseTimeMinutes, pharma}
    const doseEvents = [];
    for (const item of stack) {
        const sub = resolveSubstance(item.key, item);
        const doseHour = TIMING_HOURS[item.timing] || 8;
        const doseMin = doseHour * 60;
        const pharma = sub.pharma || { onset: 30, peak: 60, duration: 240, halfLife: 120, strength: 40, rebound: 0 };
        const count = item.count || 1;
        for (let c = 0; c < count; c++) {
            doseEvents.push({ key: item.key, substanceClass: sub.class || 'unknown', doseMin, pharma });
        }
    }

    // Group dose events by effect type
    for (const [typeName, typeInfo] of Object.entries(EFFECT_TYPES)) {
        const relevant = doseEvents.filter(d => (typeInfo.classes || []).includes(d.substanceClass));
        if (relevant.length === 0) continue;

        const points = [];
        for (let m = CHART.startMin; m <= CHART.endMin; m += CHART.sampleInterval) {
            let totalEffect = CHART.baselineLevel;
            for (const dose of relevant) {
                totalEffect += substanceEffectAt(m - dose.doseMin, dose.pharma);
            }
            points.push({ min: m, val: Math.min(totalEffect, CHART.maxEffect) });
        }

        curves[typeName] = {
            label: typeName,
            color: typeInfo.color,
            glow: typeInfo.glow,
            points,
        };
    }

    return curves;
}

/**
 * Convert points array to a smooth SVG path using cubic bezier approximation.
 */
function pointsToPath(points) {
    if (points.length < 2) return '';
    const coords = points.map(p => ({ x: chartX(p.min), y: chartY(p.val) }));

    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        const cpx = (prev.x + curr.x) / 2;
        d += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    return d;
}

/**
 * Convert points to a closed fill path (area under curve down to baseline).
 */
function pointsToFillPath(points) {
    const pathD = pointsToPath(points);
    if (!pathD) return '';
    const lastX = chartX(points[points.length - 1].min);
    const firstX = chartX(points[0].min);
    const baseY = chartY(0);
    return pathD + ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
}

/**
 * Build the chart grid, axes, and labels.
 */
function buildChartGrid() {
    const gridGroup = document.getElementById('chart-grid');
    const axesGroup = document.getElementById('chart-axes');
    const baselineGroup = document.getElementById('chart-baseline');
    gridGroup.innerHTML = '';
    axesGroup.innerHTML = '';
    baselineGroup.innerHTML = '';

    // Vertical grid lines (every 2 hours)
    for (let h = CHART.startHour; h <= CHART.endHour; h += 2) {
        const x = chartX(h * 60);
        gridGroup.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(CHART.padT),
            x2: x.toFixed(1), y2: String(CHART.padT + CHART.plotH),
            stroke: 'rgba(255,255,255,0.04)', 'stroke-width': '1',
        }));
        // Time labels
        const label = svgEl('text', {
            x: x.toFixed(1), y: String(CHART.padT + CHART.plotH + 18),
            fill: 'rgba(255,255,255,0.3)',
            'font-family': "'JetBrains Mono', monospace",
            'font-size': '8', 'text-anchor': 'middle',
        });
        label.textContent = `${String(h).padStart(2, '0')}:00`;
        axesGroup.appendChild(label);
    }

    // Horizontal grid lines (every 25% effect)
    for (let v = 0; v <= 100; v += 25) {
        const y = chartY(v);
        gridGroup.appendChild(svgEl('line', {
            x1: String(CHART.padL), y1: y.toFixed(1),
            x2: String(CHART.padL + CHART.plotW), y2: y.toFixed(1),
            stroke: 'rgba(255,255,255,0.03)', 'stroke-width': '1',
        }));
        if (v > 0) {
            const label = svgEl('text', {
                x: String(CHART.padL - 8), y: (y + 3).toFixed(1),
                fill: 'rgba(255,255,255,0.2)',
                'font-family': "'JetBrains Mono', monospace",
                'font-size': '7', 'text-anchor': 'end',
            });
            label.textContent = String(v);
            axesGroup.appendChild(label);
        }
    }

    // Baseline reference line
    const blY = chartY(CHART.baselineLevel);
    baselineGroup.appendChild(svgEl('line', {
        x1: String(CHART.padL), y1: blY.toFixed(1),
        x2: String(CHART.padL + CHART.plotW), y2: blY.toFixed(1),
        stroke: 'rgba(255,255,255,0.12)', 'stroke-width': '1',
        'stroke-dasharray': '4 4',
    }));
    const blLabel = svgEl('text', {
        x: String(CHART.padL - 8), y: (blY + 3).toFixed(1),
        fill: 'rgba(255,255,255,0.25)',
        'font-family': "'JetBrains Mono', monospace",
        'font-size': '7', 'text-anchor': 'end',
    });
    blLabel.textContent = 'base';
    axesGroup.appendChild(blLabel);

    // Axes lines
    axesGroup.appendChild(svgEl('line', {
        x1: String(CHART.padL), y1: String(CHART.padT),
        x2: String(CHART.padL), y2: String(CHART.padT + CHART.plotH),
        stroke: 'rgba(255,255,255,0.1)', 'stroke-width': '1',
    }));
    axesGroup.appendChild(svgEl('line', {
        x1: String(CHART.padL), y1: String(CHART.padT + CHART.plotH),
        x2: String(CHART.padL + CHART.plotW), y2: String(CHART.padT + CHART.plotH),
        stroke: 'rgba(255,255,255,0.1)', 'stroke-width': '1',
    }));

    // Y-axis label
    const yLabel = svgEl('text', {
        x: '14', y: String(CHART.padT + CHART.plotH / 2),
        fill: 'rgba(255,255,255,0.2)',
        'font-family': "'Inter', sans-serif",
        'font-size': '8', 'text-anchor': 'middle',
        transform: `rotate(-90, 14, ${CHART.padT + CHART.plotH / 2})`,
    });
    yLabel.textContent = 'Effect';
    axesGroup.appendChild(yLabel);

    // X-axis label
    const xLabel = svgEl('text', {
        x: String(CHART.padL + CHART.plotW / 2), y: String(CHART.viewH - 6),
        fill: 'rgba(255,255,255,0.2)',
        'font-family': "'Inter', sans-serif",
        'font-size': '8', 'text-anchor': 'middle',
    });
    xLabel.textContent = 'Time of Day';
    axesGroup.appendChild(xLabel);
}

/**
 * Render effect curves onto the chart.
 */
function renderEffectCurves(curves) {
    const curvesGroup = document.getElementById('chart-curves');
    const legendGroup = document.getElementById('chart-legend');
    curvesGroup.innerHTML = '';
    legendGroup.innerHTML = '';

    let legendIdx = 0;
    for (const [typeName, curve] of Object.entries(curves)) {
        // Area fill
        const fillPath = svgEl('path', {
            d: pointsToFillPath(curve.points),
            fill: curve.color,
            'fill-opacity': '0.08',
            'clip-path': 'none',
        });
        curvesGroup.appendChild(fillPath);

        // Stroke line
        const strokePath = svgEl('path', {
            d: pointsToPath(curve.points),
            fill: 'none',
            stroke: curve.color,
            'stroke-width': '2',
            'stroke-opacity': '0.8',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
        });

        // Animate line drawing
        const totalLength = strokePath.getTotalLength ? 0 : 1000; // will set after append
        curvesGroup.appendChild(strokePath);

        // Set up clip for simulation progressive reveal
        strokePath.dataset.effectType = typeName;
        fillPath.dataset.effectType = typeName;

        // Legend entry
        const lx = CHART.padL + CHART.plotW - 10;
        const ly = CHART.padT + 12 + legendIdx * 16;

        const legendDot = svgEl('circle', {
            cx: String(lx), cy: String(ly),
            r: '3', fill: curve.color,
        });
        legendGroup.appendChild(legendDot);

        const legendText = svgEl('text', {
            x: String(lx - 8), y: String(ly + 3),
            fill: curve.color,
            'font-family': "'Inter', sans-serif",
            'font-size': '8', 'font-weight': '500',
            'text-anchor': 'end', 'fill-opacity': '0.8',
        });
        legendText.textContent = typeName;
        legendGroup.appendChild(legendText);

        legendIdx++;
    }
}

/**
 * Build and display the full effect chart for a stack.
 */
function buildEffectChart(stack) {
    buildChartGrid();
    const curves = computeEffectCurves(stack);
    renderEffectCurves(curves);

    // Store curves for simulation use
    AppState.effectCurves = curves;

    return curves;
}

/**
 * Show/hide the chart panel with animation.
 */
function showChartPanel() {
    const section = document.getElementById('cartridge-section');
    const panel = document.getElementById('effect-chart-panel');
    section.classList.add('split-view');
    // Force reflow before adding visible class for transition
    panel.offsetHeight;
    panel.style.display = 'block';
    requestAnimationFrame(() => {
        panel.classList.add('visible');
    });
}

function hideChartPanel() {
    const section = document.getElementById('cartridge-section');
    const panel = document.getElementById('effect-chart-panel');
    panel.classList.remove('visible');
    setTimeout(() => {
        section.classList.remove('split-view');
        panel.style.display = 'none';
    }, 600);
}

// ============================================
// 16. PLAY BUTTON
// ============================================

function showPlayButton() {
    const hub = document.getElementById('center-hub');
    // Remove existing play button if any
    const existing = hub.querySelector('.play-btn-group');
    if (existing) existing.remove();

    const hubText = document.getElementById('hub-text');
    if (hubText) hubText.setAttribute('opacity', '0');

    const g = svgEl('g', { class: 'play-btn-group' });

    // Pulse ring
    const pulse = svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '42',
        fill: 'none', stroke: 'rgba(160,160,255,0.25)', 'stroke-width': '1.5',
        class: 'play-pulse-ring',
    });
    g.appendChild(pulse);

    // Background circle
    const bg = svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '38',
        class: 'play-btn-bg',
    });
    g.appendChild(bg);

    // Play triangle (right-facing, centered at CENTER)
    const triSize = 16;
    const x1 = CENTER - triSize * 0.4;
    const y1 = CENTER - triSize;
    const x2 = CENTER + triSize * 0.8;
    const y2 = CENTER;
    const x3 = CENTER - triSize * 0.4;
    const y3 = CENTER + triSize;

    const tri = svgEl('polygon', {
        points: `${x1},${y1} ${x2},${y2} ${x3},${y3}`,
        class: 'play-btn-icon',
    });
    g.appendChild(tri);

    g.addEventListener('click', () => {
        startSimulation();
    });

    hub.appendChild(g);
}

function hidePlayButton() {
    const hub = document.getElementById('center-hub');
    const btn = hub.querySelector('.play-btn-group');
    if (btn) {
        btn.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        setTimeout(() => btn.remove(), 200);
    }
}

// ============================================
// 17. CAPSULE WHEEL ROTATION (JS-animated SVG)
// ============================================

/**
 * Set the capsule wheel rotation instantly (no animation).
 * Uses SVG transform attribute with rotate(deg, cx, cy) which
 * always rotates around the SVG viewBox center — immune to CSS scaling issues.
 */
function setWheelRotation(deg) {
    const wheel = document.getElementById('capsule-wheel');
    if (wheel) {
        wheel.setAttribute('transform', `rotate(${deg.toFixed(2)}, ${CENTER}, ${CENTER})`);
    }
}

/**
 * Animate the capsule wheel from its current rotation to a target rotation.
 * Returns a promise that resolves when done.
 */
function animateWheelRotation(fromDeg, toDeg, durationMs = 800) {
    return new Promise(resolve => {
        const wheel = document.getElementById('capsule-wheel');
        if (!wheel) { resolve(); return; }

        const startTime = performance.now();

        function tick(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / durationMs, 1);
            // Cubic ease-out
            const eased = 1 - Math.pow(1 - t, 3);
            const current = fromDeg + (toDeg - fromDeg) * eased;
            wheel.setAttribute('transform', `rotate(${current.toFixed(2)}, ${CENTER}, ${CENTER})`);

            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(tick);
    });
}

// ============================================
// 18. PROTOCOL SIMULATION ENGINE
// ============================================

const Simulation = {
    isPlaying: false,
    currentTimeMin: 0,
    endTimeMin: 24 * 60,
    startTimeMin: 6 * 60,
    speed: 60 / 3,          // simulated minutes per real second (60 min / 3 sec = 20 min/sec)
    animFrameId: null,
    lastTimestamp: 0,
    doseEvents: [],
    nextDoseIdx: 0,
    wheelRotation: 0,
    isPausedForDose: false,
};

/**
 * Build dose events from the current stack, mapped to front-layer capsule slots.
 */
function buildDoseEvents(stack) {
    const events = [];
    const groups = CartridgeConfig.capsuleGroups;

    for (let i = 0; i < groups.length; i++) {
        const capsule = groups[i];
        if (!capsule.isToday) continue;  // Only simulate day 1

        const sub = resolveSubstance(capsule.key, capsule);
        const doseHour = TIMING_HOURS[capsule.timing] || 8;
        const doseMin = doseHour * 60;

        events.push({
            timeMin: doseMin,
            key: capsule.key,
            dose: capsule.dose,
            timing: capsule.timing,
            globalSlot: capsule.globalSlot,
            substance: sub,
            dispensed: false,
        });
    }

    // Sort by time
    events.sort((a, b) => a.timeMin - b.timeMin);
    return events;
}

/**
 * Start the protocol simulation.
 */
async function startSimulation() {
    if (Simulation.isPlaying) return;
    if (!AppState.currentStack) return;

    Simulation.isPlaying = true;
    Simulation.currentTimeMin = Simulation.startTimeMin;
    Simulation.nextDoseIdx = 0;
    Simulation.isPausedForDose = false;
    Simulation.wheelRotation = 0;

    hidePlayButton();

    // Restore capsules if this is a replay
    setWheelRotation(0);

    // Rebuild capsule layers to restore any dispensed capsules
    const stack = AppState.currentStack;
    const layout = computeCartridgeLayout(stack);
    CartridgeConfig.recalculate(layout.capsulesPerLayer);
    CartridgeConfig.capsuleGroups = layout.capsuleGroups;
    rebuildCapsuleLayers();

    // Quick refill without the slow animation
    const groups = CartridgeConfig.capsuleGroups;
    for (let i = 0; i < groups.length; i++) {
        const capsule = groups[i];
        const substance = resolveSubstance(capsule.key, capsule);
        if (!substance) continue;
        ensureCategoryGradient(substance.class || 'unknown');

        let layerKey, capsuleIndex;
        if (capsule.globalSlot < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = capsule.globalSlot;
        } else {
            layerKey = 'back';
            capsuleIndex = capsule.globalSlot - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (!capsuleGroup) continue;

        const fillRect = capsuleGroup.querySelector('.capsule-fill');
        const outlineRect = capsuleGroup.querySelector('.capsule-outline');
        const targetOpacity = capsule.isToday ? 1 : 0.25;

        fillRect.setAttribute('fill', `url(#grad-${sanitizeId(substance.class || 'unknown')})`);
        fillRect.setAttribute('opacity', String(targetOpacity));

        if (capsule.isToday) {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-width', '2');
            if (layerKey === 'front') {
                capsuleGroup.setAttribute('filter', 'url(#capsule-glow)');
            }
        } else {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-opacity', '0.2');
            outlineRect.setAttribute('stroke-width', '1');
            capsuleGroup.classList.add('dimmed');
        }

        capsuleGroup.classList.add('filled');
        capsuleGroup.dataset.substance = capsule.key;
        capsuleGroup.dataset.dose = capsule.dose;
        capsuleGroup.dataset.timing = capsule.timing;
        capsuleGroup.dataset.day = String(capsule.dayIndex + 1);
        AppState.filledSlots.set(capsule.globalSlot, capsule.key);
    }

    Simulation.doseEvents = buildDoseEvents(AppState.currentStack);

    // Clear previous dose markers
    const markersGroup = document.getElementById('chart-dose-markers');
    markersGroup.innerHTML = '';

    // Create time cursor on chart
    const cursorGroup = document.getElementById('chart-cursor');
    cursorGroup.innerHTML = '';

    const cursorLine = svgEl('line', {
        x1: String(chartX(Simulation.startTimeMin)),
        y1: String(CHART.padT),
        x2: String(chartX(Simulation.startTimeMin)),
        y2: String(CHART.padT + CHART.plotH),
        class: 'chart-cursor-line',
        id: 'sim-cursor-line',
    });
    cursorGroup.appendChild(cursorLine);

    const cursorDot = svgEl('circle', {
        cx: String(chartX(Simulation.startTimeMin)),
        cy: String(CHART.padT - 6),
        r: '4',
        class: 'chart-cursor-dot',
        id: 'sim-cursor-dot',
    });
    cursorGroup.appendChild(cursorDot);

    const cursorTime = svgEl('text', {
        x: String(chartX(Simulation.startTimeMin)),
        y: String(CHART.padT - 14),
        class: 'chart-cursor-time',
        id: 'sim-cursor-time',
        'text-anchor': 'middle',
    });
    cursorTime.textContent = '06:00';
    cursorGroup.appendChild(cursorTime);

    // Show time in hub
    updateSimHubTime(Simulation.currentTimeMin);

    // Set up clip paths for progressive curve reveal
    setupProgressiveReveal();

    Simulation.lastTimestamp = performance.now();
    Simulation.animFrameId = requestAnimationFrame(simulationTick);
}

/**
 * Set up clip rectangles to progressively reveal curves.
 */
function setupProgressiveReveal() {
    const svg = document.getElementById('effect-chart-svg');
    let clipDef = svg.querySelector('#sim-clip-rect');
    if (!clipDef) {
        const defs = svg.querySelector('defs');
        const clipPath = svgEl('clipPath', { id: 'sim-reveal-clip' });
        const rect = svgEl('rect', {
            id: 'sim-clip-rect',
            x: String(CHART.padL), y: '0',
            width: '0', height: String(CHART.viewH),
        });
        clipPath.appendChild(rect);
        defs.appendChild(clipPath);
    }

    const curvesGroup = document.getElementById('chart-curves');
    curvesGroup.setAttribute('clip-path', 'url(#sim-reveal-clip)');

    // Reset clip to start position
    const rect = svg.querySelector('#sim-clip-rect');
    rect.setAttribute('width', String(chartX(Simulation.startTimeMin) - CHART.padL));
}

/**
 * Main simulation tick driven by requestAnimationFrame.
 */
function simulationTick(timestamp) {
    if (!Simulation.isPlaying) return;

    const deltaMs = timestamp - Simulation.lastTimestamp;
    Simulation.lastTimestamp = timestamp;

    if (Simulation.isPausedForDose) {
        Simulation.animFrameId = requestAnimationFrame(simulationTick);
        return;
    }

    // Advance time
    const deltaMin = (deltaMs / 1000) * Simulation.speed;
    Simulation.currentTimeMin += deltaMin;

    if (Simulation.currentTimeMin >= Simulation.endTimeMin) {
        Simulation.currentTimeMin = Simulation.endTimeMin;
        updateCursorPosition(Simulation.currentTimeMin);
        updateClipReveal(Simulation.currentTimeMin);
        endSimulation();
        return;
    }

    updateCursorPosition(Simulation.currentTimeMin);
    updateClipReveal(Simulation.currentTimeMin);
    updateSimHubTime(Simulation.currentTimeMin);

    // Check for dose events
    while (Simulation.nextDoseIdx < Simulation.doseEvents.length) {
        const dose = Simulation.doseEvents[Simulation.nextDoseIdx];
        if (dose.timeMin <= Simulation.currentTimeMin && !dose.dispensed) {
            // Collect all doses at the same time
            const simultaneousDoses = [];
            while (
                Simulation.nextDoseIdx < Simulation.doseEvents.length &&
                Simulation.doseEvents[Simulation.nextDoseIdx].timeMin <= Simulation.currentTimeMin &&
                !Simulation.doseEvents[Simulation.nextDoseIdx].dispensed
            ) {
                simultaneousDoses.push(Simulation.doseEvents[Simulation.nextDoseIdx]);
                Simulation.nextDoseIdx++;
            }
            dispenseCapsules(simultaneousDoses);
            break;
        } else {
            break;
        }
    }

    Simulation.animFrameId = requestAnimationFrame(simulationTick);
}

function updateCursorPosition(timeMin) {
    const x = chartX(timeMin);
    const line = document.getElementById('sim-cursor-line');
    const dot = document.getElementById('sim-cursor-dot');
    const timeText = document.getElementById('sim-cursor-time');

    if (line) {
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('x2', x.toFixed(1));
    }
    if (dot) dot.setAttribute('cx', x.toFixed(1));
    if (timeText) {
        timeText.setAttribute('x', x.toFixed(1));
        const hours = Math.floor(timeMin / 60);
        const mins = Math.floor(timeMin % 60);
        timeText.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
}

function updateClipReveal(timeMin) {
    const rect = document.querySelector('#sim-clip-rect');
    if (rect) {
        const width = chartX(timeMin) - CHART.padL;
        rect.setAttribute('width', String(Math.max(0, width)));
    }
}

function updateSimHubTime(timeMin) {
    const hubText = document.getElementById('hub-text');
    if (!hubText) return;
    hubText.setAttribute('opacity', '1');
    hubText.setAttribute('fill', 'rgba(160,160,255,0.7)');
    hubText.setAttribute('font-size', '14');
    const hours = Math.floor(timeMin / 60);
    const mins = Math.floor(timeMin % 60);
    hubText.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Rotate the capsule wheel and dispense capsules.
 */
async function dispenseCapsules(doses) {
    Simulation.isPausedForDose = true;

    for (const dose of doses) {
        // Calculate the angular position of this capsule
        const slotIndex = dose.globalSlot;
        let capsuleAngle;
        if (slotIndex < CartridgeConfig.capsulesPerLayer) {
            capsuleAngle = -90 + slotIndex * CartridgeConfig.angularSpacing;
        } else {
            capsuleAngle = -90 + CartridgeConfig.halfSpacing + (slotIndex - CartridgeConfig.capsulesPerLayer) * CartridgeConfig.angularSpacing;
        }

        // Rotate wheel so this capsule goes to 12 o'clock (-90°)
        // Target: capsuleAngle + wheelRotation = -90 (mod 360)
        const targetRotation = -capsuleAngle - 90;
        // Use shortestAngleDelta for shortest CW/CCW path
        const delta = shortestAngleDelta(Simulation.wheelRotation, targetRotation);
        const prevRotation = Simulation.wheelRotation;
        // Accumulate without normalizing — allows angles beyond 360° so
        // animateWheelRotation always interpolates the short way around
        Simulation.wheelRotation += delta;
        await animateWheelRotation(prevRotation, Simulation.wheelRotation, 800);

        // Dispensation animation
        let layerKey, capsuleIndex;
        if (slotIndex < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = slotIndex;
        } else {
            layerKey = 'back';
            capsuleIndex = slotIndex - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (capsuleGroup) {
            // Pulse bright
            const fillRect = capsuleGroup.querySelector('.capsule-fill');
            const color = dose.substance.color;

            fillRect.animate([
                { filter: 'brightness(1)', transform: 'scale(1) translateY(0)' },
                { filter: 'brightness(2)', transform: 'scale(1.3) translateY(-5px)' },
                { filter: 'brightness(1.5)', transform: 'scale(1.1) translateY(-20px)', opacity: '0.8' },
                { filter: 'brightness(0.5)', transform: 'scale(0.3) translateY(-50px)', opacity: '0' },
            ], {
                duration: 800,
                easing: 'ease-out',
                fill: 'forwards',
            });

            // Spawn particles
            spawnDispenseParticles(capsuleGroup, color);

            // Add dose marker on chart
            addDoseMarker(dose);
        }

        dose.dispensed = true;
        await sleep(600);
    }

    Simulation.isPausedForDose = false;
}

/**
 * Spawn dissolving particle effects from a capsule position.
 */
function spawnDispenseParticles(capsuleGroup, color) {
    const svg = document.getElementById('cartridge-svg');
    const transform = capsuleGroup.getAttribute('transform');
    // Extract translate coordinates from the capsule group
    const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
    if (!match) return;
    const cx = parseFloat(match[1]);
    const cy = parseFloat(match[2]);

    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5;
        const dist = 20 + Math.random() * 40;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - 30; // Bias upward
        const r = 2 + Math.random() * 3;
        const dur = 600 + Math.random() * 400;

        const particle = svgEl('circle', {
            cx: String(cx), cy: String(cy),
            r: String(r),
            fill: color,
            opacity: '0',
        });
        svg.appendChild(particle);

        // Use SMIL-style animation via animate elements
        const animCx = svgEl('animate', {
            attributeName: 'cx',
            from: String(cx), to: String(cx + dx),
            dur: `${dur}ms`, fill: 'freeze',
        });
        const animCy = svgEl('animate', {
            attributeName: 'cy',
            from: String(cy), to: String(cy + dy),
            dur: `${dur}ms`, fill: 'freeze',
        });
        const animOp = svgEl('animate', {
            attributeName: 'opacity',
            from: '0.7', to: '0',
            dur: `${dur}ms`, fill: 'freeze',
        });
        const animR = svgEl('animate', {
            attributeName: 'r',
            from: String(r), to: '0.5',
            dur: `${dur}ms`, fill: 'freeze',
        });

        particle.appendChild(animCx);
        particle.appendChild(animCy);
        particle.appendChild(animOp);
        particle.appendChild(animR);

        // Trigger animations
        particle.setAttribute('opacity', '0.7');

        setTimeout(() => particle.remove(), dur + 100);
    }
}

/**
 * Add a dose marker dot on the chart timeline.
 */
function addDoseMarker(dose) {
    const markersGroup = document.getElementById('chart-dose-markers');
    const x = chartX(dose.timeMin);
    const baseY = chartY(0);

    // Vertical marker line
    const line = svgEl('line', {
        x1: x.toFixed(1), y1: String(CHART.padT),
        x2: x.toFixed(1), y2: String(CHART.padT + CHART.plotH),
        stroke: dose.substance.color,
        'stroke-width': '1',
        'stroke-opacity': '0.25',
        'stroke-dasharray': '2 4',
    });
    markersGroup.appendChild(line);

    // Substance dot
    const dot = svgEl('circle', {
        cx: x.toFixed(1), cy: String(CHART.padT + CHART.plotH + 6),
        r: '3', fill: dose.substance.color, opacity: '0',
    });
    markersGroup.appendChild(dot);
    dot.animate([{ opacity: 0, r: 0 }, { opacity: 0.8, r: 3 }], {
        duration: 300, fill: 'forwards',
    });

    // Tiny label
    const label = svgEl('text', {
        x: x.toFixed(1), y: String(CHART.padT + CHART.plotH + 28),
        fill: dose.substance.color,
        'font-family': "'JetBrains Mono', monospace",
        'font-size': '6', 'text-anchor': 'middle',
        'fill-opacity': '0.6',
    });
    label.textContent = dose.substance.name.length > 8
        ? dose.substance.name.substring(0, 8) + '.'
        : dose.substance.name;
    markersGroup.appendChild(label);
}

/**
 * End the simulation — show completion state and replay button.
 */
function endSimulation() {
    Simulation.isPlaying = false;
    if (Simulation.animFrameId) {
        cancelAnimationFrame(Simulation.animFrameId);
        Simulation.animFrameId = null;
    }

    // Show "COMPLETE" in hub briefly, then show play button for replay
    const hubText = document.getElementById('hub-text');
    if (hubText) {
        hubText.textContent = 'COMPLETE';
        hubText.setAttribute('fill', 'rgba(160,160,255,0.5)');
        hubText.setAttribute('font-size', '10');
    }

    // Remove clip from curves to show full chart
    const curvesGroup = document.getElementById('chart-curves');
    curvesGroup.removeAttribute('clip-path');

    setTimeout(() => {
        showPlayButton();
    }, 1500);
}

/**
 * Reset the simulation state and restore capsules.
 */
function resetSimulation() {
    Simulation.isPlaying = false;
    if (Simulation.animFrameId) {
        cancelAnimationFrame(Simulation.animFrameId);
        Simulation.animFrameId = null;
    }
    Simulation.wheelRotation = 0;
    setWheelRotation(0);

    // Clear simulation UI
    const cursorGroup = document.getElementById('chart-cursor');
    if (cursorGroup) cursorGroup.innerHTML = '';
    const markersGroup = document.getElementById('chart-dose-markers');
    if (markersGroup) markersGroup.innerHTML = '';

    // Remove clip
    const curvesGroup = document.getElementById('chart-curves');
    if (curvesGroup) curvesGroup.removeAttribute('clip-path');
}

// ============================================
// 19. TOOLTIP SYSTEM
// ============================================

function initTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'capsule-tooltip';
    tooltip.innerHTML = `
        <div class="tooltip-name"></div>
        <div class="tooltip-detail"></div>
        <div class="tooltip-warning"></div>
    `;
    document.body.appendChild(tooltip);
    AppState.tooltip = tooltip;

    const svg = document.getElementById('cartridge-svg');

    svg.addEventListener('mousemove', (e) => {
        const capsule = e.target.closest('.capsule-group.filled');
        if (capsule) {
            const key = capsule.dataset.substance;
            const substance = resolveSubstance(key, {});
            if (!substance) return;

            tooltip.querySelector('.tooltip-name').textContent = substance.name;
            tooltip.querySelector('.tooltip-name').style.color = substance.color;

            const classLabel = substance.class || '';
            const doseLabel = substance.standardDose || capsule.dataset.dose || '';
            const dayLabel = capsule.dataset.day ? `Day ${capsule.dataset.day}` : '';
            const parts = [classLabel, doseLabel, capsule.dataset.timing, dayLabel].filter(Boolean);
            tooltip.querySelector('.tooltip-detail').textContent = parts.join(' · ');

            // Data confidence warning
            const warningEl = tooltip.querySelector('.tooltip-warning');
            const conf = (substance.dataConfidence || '').toLowerCase();
            if (conf === 'estimated' || conf === 'medium') {
                warningEl.textContent = `\u26A0\uFE0F ${substance.dataNote || 'Clinical estimation'}`;
                warningEl.style.display = '';
            } else {
                warningEl.textContent = '';
                warningEl.style.display = 'none';
            }

            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY - 10}px`;
            tooltip.classList.add('visible');
        } else {
            tooltip.classList.remove('visible');
        }
    });

    svg.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
    });
}

// ============================================
// 20. EVENT HANDLERS
// ============================================

// ============================================
// 20b. PHASE CHART FLOW — New Prompt Handler
// ============================================

async function handlePromptSubmit(e) {
    e.preventDefault();

    const input = document.getElementById('prompt-input');
    const prompt = input.value.trim();
    if (!prompt || PhaseState.isProcessing) return;

    clearPromptError();
    PhaseState.isProcessing = true;
    PhaseState.phase = 'loading';
    document.body.classList.add('phase-engaged');
    document.getElementById('prompt-hint').style.opacity = '0';
    document.getElementById('prompt-submit').disabled = true;

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
        document.getElementById('prompt-submit').disabled = false;
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
        document.getElementById('prompt-submit').disabled = false;
        return;
    }

    let curvesData = curvesResult.curves || [];
    if (curvesData.length === 0) {
        stopScanLine();
        stopOrbitalRings();
        document.getElementById('phase-word-cloud').innerHTML = '';
        showPromptError('Main model returned no curve data.');
        PhaseState.isProcessing = false;
        document.getElementById('prompt-submit').disabled = false;
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
            _orbitalRingsState = null;
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
    document.getElementById('prompt-submit').disabled = false;

    // Wait for Optimize button click
    await new Promise(resolve => {
        function onOptimize() {
            optimizeBtn.removeEventListener('click', onOptimize);
            resolve();
        }
        optimizeBtn.addEventListener('click', onOptimize);
    });

    optimizeBtn.classList.add('hidden');
    PhaseState.isProcessing = true;
    document.getElementById('prompt-submit').disabled = true;

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
        document.getElementById('prompt-submit').disabled = false;
        return;
    }
    PhaseState.interventionResult = interventionData;

    const interventions = validateInterventions(interventionData.interventions || [], curvesData);
    if (interventions.length === 0) {
        PhaseState.isProcessing = false;
        document.getElementById('prompt-submit').disabled = false;
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
    document.getElementById('prompt-submit').disabled = false;

    await new Promise(resolve => {
        const btn = document.getElementById('intervention-play-btn');
        if (!btn) { resolve(); return; }
        btn.addEventListener('click', () => {
            hideInterventionPlayButton();
            resolve();
        }, { once: true });
    });

    PhaseState.isProcessing = true;
    document.getElementById('prompt-submit').disabled = true;
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
    document.getElementById('prompt-submit').disabled = false;
}

function initDebugPanel() {
    const debugBtn = document.getElementById('debug-btn');
    const debugPanel = document.getElementById('debug-panel');
    const debugClose = document.getElementById('debug-close');

    debugBtn.addEventListener('click', () => {
        const isOpen = debugPanel.classList.contains('open');
        debugPanel.classList.toggle('open');
        debugBtn.classList.toggle('active');

        // Close settings popover if open
        if (!isOpen) {
            document.getElementById('settings-popover').classList.add('hidden');
            document.getElementById('settings-btn').classList.remove('active');
        }
    });

    debugClose.addEventListener('click', () => {
        debugPanel.classList.remove('open');
        debugBtn.classList.remove('active');
    });
}

function initSettings() {
    const btn = document.getElementById('settings-btn');
    const popover = document.getElementById('settings-popover');
    const keyInput = document.getElementById('api-key-input');
    const saveBtn = document.getElementById('api-key-save');
    const status = document.getElementById('api-key-status');
    const llmSelect = document.getElementById('llm-select');
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

    // Init per-stage model selectors
    const STAGE_IDS = ['fast', 'curves', 'intervention', 'biometric', 'revision'];
    STAGE_IDS.forEach(stage => {
        const sel = document.getElementById(`stage-${stage}`);
        if (!sel) return;
        sel.value = AppState.stageModels[stage];
        sel.addEventListener('change', () => {
            AppState.stageModels[stage] = sel.value;
            localStorage.setItem(`cortex_stage_${stage}`, sel.value);
        });
    });

    // Init effects select
    const effectsSelect = document.getElementById('effects-select');
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
        if (!popover.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            popover.classList.add('hidden');
            btn.classList.remove('active');
        }
    });
}

function initToggles() {
    const rxToggle = document.getElementById('toggle-rx');
    const controlledToggle = document.getElementById('toggle-controlled');

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

function refreshChartTheme() {
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

function initThemeToggle() {
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
            document.querySelectorAll('.bio-device-chip-icon[data-src-dark]').forEach(img => {
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
    document.getElementById('prompt-input').focus();

    // Prompt starts centered (class already set in HTML)
    // Cartridge section starts hidden (class already set in HTML)
});

// ============================================
// 10d. INTERVENTION MODEL (Lx pipeline)
// ============================================

function buildInterventionSystemPrompt(userGoal, curvesData) {
    // Serialize substance database for the LLM
    const active = getActiveSubstances();
    const substanceList = Object.entries(active).map(([key, s]) => ({
        key,
        name: s.name,
        class: s.class,
        standardDose: s.standardDose,
        pharma: s.pharma,
    }));

    const curveSummary = curvesData.map(c => ({
        effect: c.effect,
        color: c.color,
        polarity: c.polarity || 'higher_is_better',
        baseline: c.baseline,
        desired: c.desired,
    }));

    return interpolatePrompt(PROMPTS.intervention, {
        userGoal: userGoal,
        substanceList: JSON.stringify(substanceList, null, 1),
        curveSummary: JSON.stringify(curveSummary, null, 1),
    });
}

async function callInterventionModel(prompt, curvesData) {
    const { model, provider, key } = getStageModel('intervention');
    if (!key) throw new Error(`No API key configured for ${provider}. Add one in Settings.`);

    const systemPrompt = buildInterventionSystemPrompt(prompt, curvesData);
    const userPrompt = 'Analyze the baseline vs desired curves and prescribe the optimal supplement intervention protocol. Respond with JSON only.';

    const debugEntry = DebugLog.addEntry({
        stage: 'Intervention Model', stageClass: 'intervention-model',
        model,
        systemPrompt,
        userPrompt,
        loading: true,
    });

    const startTime = performance.now();

    try {
        let result;
        switch (provider) {
            case 'anthropic':
                result = await callAnthropicGeneric(userPrompt, key, model, systemPrompt, 4096);
                break;
            case 'openai':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.openai, systemPrompt, 4096);
                break;
            case 'grok':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.grok, systemPrompt, 4096);
                break;
            case 'gemini':
                result = await callGeminiGeneric(userPrompt, key, model, systemPrompt, 4096);
                break;
        }

        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;

        // Generic callers already parse JSON via extractAndParseJSON — use result directly
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            requestBody,
            rawResponse,
            response: result,
            duration: Math.round(performance.now() - startTime),
        });

        PhaseState.interventionResult = result;
        return result;
    } catch (err) {
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err;
    }
}

// ============================================
// REVISION MODEL — Biometric-Informed Re-evaluation
// ============================================

function buildBiometricSummary() {
    const channels = BiometricState.channels;
    if (!channels || channels.length === 0) return 'No biometric data available.';
    return channels.map(ch => {
        const data = ch.data || [];
        const hourly = data.filter((_, i) => i % 4 === 0);
        const values = hourly.map(p => `${p.hour}h:${Math.round(p.value)}`).join(', ');
        return `${ch.metric || ch.displayName || ch.signal} (${ch.unit}): [${values}]`;
    }).join('\n');
}

function buildRevisionSystemPrompt(userGoal, curvesData) {
    const active = getActiveSubstances();
    const substanceList = Object.entries(active).map(([key, s]) => ({
        key, name: s.name, class: s.class, standardDose: s.standardDose, pharma: s.pharma,
    }));
    const curveSummary = curvesData.map(c => ({
        effect: c.effect, polarity: c.polarity || 'higher_is_better',
        baseline: (c.baseline || []).filter((_, i) => i % 4 === 0),
        desired: (c.desired || []).filter((_, i) => i % 4 === 0),
    }));
    const originalInterventions = PhaseState.interventionResult
        ? JSON.stringify(PhaseState.interventionResult.interventions, null, 1)
        : '[]';
    return interpolatePrompt(PROMPTS.revision, {
        userGoal,
        originalInterventions,
        biometricSummary: buildBiometricSummary(),
        curveSummary: JSON.stringify(curveSummary),
        substanceList: JSON.stringify(substanceList),
    });
}

async function callRevisionModel(userGoal, curvesData) {
    const { model, provider, key } = getStageModel('revision');
    if (!key) throw new Error(`No API key configured for ${provider}.`);

    const systemPrompt = buildRevisionSystemPrompt(userGoal, curvesData);
    const userPrompt = 'Revise the intervention protocol based on the biometric feedback. Respond with JSON only.';

    const debugEntry = DebugLog.addEntry({
        stage: 'Revision Model', stageClass: 'revision-model',
        model, systemPrompt, userPrompt, loading: true,
    });

    const startTime = performance.now();

    try {
        let result;
        switch (provider) {
            case 'anthropic':
                result = await callAnthropicGeneric(userPrompt, key, model, systemPrompt, 4096);
                break;
            case 'openai':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.openai, systemPrompt, 4096);
                break;
            case 'grok':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.grok, systemPrompt, 4096);
                break;
            case 'gemini':
                result = await callGeminiGeneric(userPrompt, key, model, systemPrompt, 4096);
                break;
        }

        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;

        DebugLog.updateEntry(debugEntry, {
            loading: false, requestBody, rawResponse,
            response: result,
            duration: Math.round(performance.now() - startTime),
        });

        return result;
    } catch (err) {
        DebugLog.updateEntry(debugEntry, {
            loading: false, error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err;
    }
}

function guessDose(substance) {
    // Prefer the standardDose from the new database
    if (substance.standardDose) return substance.standardDose;
    const doses = {
        caffeine: '200mg', theanine: '400mg', rhodiola: '500mg', ashwagandha: '600mg',
        tyrosine: '1000mg', citicoline: '500mg', alphaGPC: '600mg', lionsMane: '1000mg',
        magnesium: '400mg', creatine: '5g', nac: '600mg', glycine: '3g',
        melatonin: '3mg', gaba: '750mg', apigenin: '50mg', taurine: '2g',
    };
    return doses[substance.name?.toLowerCase()] || doses[Object.keys(doses).find(k =>
        substance.name?.toLowerCase().includes(k))] || '500mg';
}

// ============================================
// 20c. Lx OVERLAY COMPUTATION
// ============================================

function validateInterventions(interventions, curvesData) {
    if (!Array.isArray(interventions)) return [];
    const active = getActiveSubstances();
    return interventions.filter(iv => {
        if (!iv.key || iv.timeMinutes == null) return false;
        // Resolve substance from active set or full DB
        const sub = active[iv.key] || SUBSTANCE_DB[iv.key];
        if (!sub) return false;
        iv.substance = sub;
        iv.timeMinutes = Math.max(PHASE_CHART.startMin, Math.min(PHASE_CHART.endMin, iv.timeMinutes));

        // Resolve primary target curve for connector line drawing
        // Multi-vector: find the impact key with the highest absolute vector
        if (curvesData && iv.impacts && typeof iv.impacts === 'object') {
            let bestKey = null, bestAbs = 0;
            for (const [effectKey, vec] of Object.entries(iv.impacts)) {
                if (Math.abs(vec) > bestAbs) {
                    bestAbs = Math.abs(vec);
                    bestKey = effectKey;
                }
            }
            if (bestKey) {
                const idx = curvesData.findIndex(c =>
                    c.effect && matchImpactToCurve({ [bestKey]: 1 }, c.effect) !== 0);
                iv.targetCurveIdx = idx >= 0 ? idx : null;
            }
        }
        // Legacy fallback: single targetEffect string
        if (iv.targetCurveIdx == null && curvesData && iv.targetEffect) {
            const idx = curvesData.findIndex(c =>
                c.effect && matchImpactToCurve({ [iv.targetEffect]: 1 }, c.effect) !== 0);
            iv.targetCurveIdx = idx >= 0 ? idx : null;
        }
        if (iv.targetCurveIdx == null && curvesData) {
            iv.targetCurveIdx = mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
        }

        return true;
    });
}

function mapSubstanceToEffectAxis(substanceKey, curvesData) {
    const sub = resolveSubstance(substanceKey, {});
    if (!sub) return [0];

    const cls = sub.class || 'unknown';

    // Map substance class to curve indices based on polarity and effect type
    const mapping = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const polarity = curve.polarity || 'higher_is_better';

        // Stimulants & nootropics → positive effects (higher_is_better)
        if (['Stimulant', 'Nootropic'].includes(cls) && polarity === 'higher_is_better') {
            mapping.push(i);
        }
        // Adaptogens → both positive effects and negative effect reduction
        else if (cls === 'Adaptogen') {
            mapping.push(i);
        }
        // Sleep/Depressants → sedation or negative effect reduction
        else if (cls === 'Depressant/Sleep' && (polarity === 'higher_is_worse' || curve.effect?.toLowerCase().includes('sleep'))) {
            mapping.push(i);
        }
        // Minerals/Vitamins → general support, affects all
        else if (['Mineral/Electrolyte', 'Vitamin/Amino'].includes(cls)) {
            mapping.push(i);
        }
    }

    return mapping.length > 0 ? mapping : [0];
}

/**
 * Fuzzy-match an impact key from the LLM to a curve effect name.
 * Handles exact match, substring containment, and word overlap.
 * Returns the impact value if matched, 0 otherwise.
 */
function matchImpactToCurve(impacts, curveName) {
    if (!impacts || typeof impacts !== 'object') return 0;
    const cn = curveName.toLowerCase().trim();
    const cnWords = cn.split(/\s+/);

    // Pass 1: exact match
    for (const [key, vec] of Object.entries(impacts)) {
        if (key.toLowerCase().trim() === cn) return vec;
    }
    // Pass 2: substring containment (either direction)
    for (const [key, vec] of Object.entries(impacts)) {
        const kn = key.toLowerCase().trim();
        if (cn.includes(kn) || kn.includes(cn)) return vec;
    }
    // Pass 3: any significant word overlap (ignore short words)
    for (const [key, vec] of Object.entries(impacts)) {
        const kWords = key.toLowerCase().trim().split(/\s+/);
        const overlap = kWords.filter(w => w.length > 3 && cnWords.some(cw => cw.length > 3 && (cw.includes(w) || w.includes(cw))));
        if (overlap.length > 0) return vec;
    }
    return 0;
}

function computeLxOverlay(interventions, curvesData) {
    const lxCurves = curvesData.map(curve => {
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const polarity = curve.polarity || 'higher_is_better';

        // Compute max desired gap for scaling
        let maxDesiredGap = 0;
        const len = Math.min(blSmoothed.length, dsSmoothed.length);
        for (let j = 0; j < len; j++) {
            maxDesiredGap = Math.max(maxDesiredGap, Math.abs(dsSmoothed[j].value - blSmoothed[j].value));
        }
        if (maxDesiredGap < 1) maxDesiredGap = 1;

        return { baseline: blSmoothed, desired: dsSmoothed, polarity, maxDesiredGap, points: [] };
    });

    // Build a map of curve effect names → curve indices for multi-vector lookup
    const effectNameToIdx = {};
    curvesData.forEach((c, i) => {
        if (c.effect) effectNameToIdx[c.effect.toLowerCase()] = i;
    });

    // Compute raw pharmacokinetic contribution per curve using multi-vector impacts
    for (let ci = 0; ci < curvesData.length; ci++) {
        const lx = lxCurves[ci];
        const curveName = (curvesData[ci].effect || '').toLowerCase();
        const points = [];
        let maxRawEffect = 0;

        // Diagnostic: log which interventions match this curve
        const matchLog = interventions.map(iv => {
            if (!iv.impacts || typeof iv.impacts !== 'object') return null;
            const val = matchImpactToCurve(iv.impacts, curveName);
            if (val === 0) return null;
            return `${iv.key}(${JSON.stringify(iv.impacts)}) → ${val}`;
        }).filter(Boolean);
        if (matchLog.length > 0) {
            console.log(`[Lx] Curve "${curveName}" matched:`, matchLog);
        } else {
            console.warn(`[Lx] Curve "${curveName}" — NO interventions matched. Impacts:`,
                interventions.map(iv => ({ key: iv.key, impacts: iv.impacts })));
        }

        for (let j = 0; j < lx.baseline.length; j++) {
            const hourVal = lx.baseline[j].hour;
            const sampleMin = hourVal * 60;
            let rawEffect = 0;

            for (const iv of interventions) {
                const sub = iv.substance;
                if (!sub || !sub.pharma) continue;

                // Multi-vector: check impacts dictionary with fuzzy matching
                if (iv.impacts && typeof iv.impacts === 'object') {
                    const impactValue = matchImpactToCurve(iv.impacts, curveName);
                    if (impactValue === 0) continue;

                    const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
                    const scaledWave = baseWave * (iv.doseMultiplier || 1.0);
                    rawEffect += scaledWave * impactValue;
                } else {
                    // Legacy fallback: single targetEffect
                    const targetIdx = iv.targetCurveIdx != null
                        ? iv.targetCurveIdx
                        : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
                    if (targetIdx !== ci) continue;

                    const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
                    rawEffect += baseWave * (iv.doseMultiplier || 1.0);
                }
            }

            maxRawEffect = Math.max(maxRawEffect, Math.abs(rawEffect));
            points.push({ hour: hourVal, rawEffect });
        }

        // Normalize and apply to baseline
        const scaleFactor = maxRawEffect > 0 ? lx.maxDesiredGap / maxRawEffect : 0;

        lx.points = points.map((p, j) => {
            const baseVal = lx.baseline[j].value;
            const scaledEffect = p.rawEffect * scaleFactor;
            // Impact vectors from the LLM already encode direction (positive=up, negative=down),
            // so we always ADD — no polarity flip needed.
            const value = baseVal + scaledEffect;
            return { hour: p.hour, value: Math.max(0, Math.min(100, value)) };
        });
    }

    return lxCurves;
}

/**
 * Compute incremental Lx curve snapshots — one per substance "step" (grouped by dose time).
 * Uses a GLOBAL scale factor from the full intervention set so the Y-axis scale stays consistent.
 * Returns: [ { lxCurves: [...], step: [intervention, ...] }, ... ]
 */
function computeIncrementalLxOverlay(interventions, curvesData) {
    // 1. Sort by time
    const sorted = [...interventions].sort((a, b) => a.timeMinutes - b.timeMinutes);

    // 2. Each intervention is its own step (no grouping)
    const steps = sorted.map(iv => [iv]);

    // 3. Pre-compute per-curve data: smoothed baseline/desired, maxDesiredGap
    const curveInfo = curvesData.map(curve => {
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const polarity = curve.polarity || 'higher_is_better';
        let maxDesiredGap = 0;
        const len = Math.min(blSmoothed.length, dsSmoothed.length);
        for (let j = 0; j < len; j++) {
            maxDesiredGap = Math.max(maxDesiredGap, Math.abs(dsSmoothed[j].value - blSmoothed[j].value));
        }
        if (maxDesiredGap < 1) maxDesiredGap = 1;
        return { blSmoothed, dsSmoothed, polarity, maxDesiredGap };
    });

    // Build effect name → curve index map for multi-vector lookup
    const effectNameToIdx = {};
    curvesData.forEach((c, i) => {
        if (c.effect) effectNameToIdx[c.effect.toLowerCase()] = i;
    });

    // Helper: compute raw multi-vector effect for a single intervention on a given curve
    function ivRawEffect(iv, curveIdx, sampleMin) {
        const sub = iv.substance;
        if (!sub || !sub.pharma) return 0;
        const curveName = (curvesData[curveIdx].effect || '');

        if (iv.impacts && typeof iv.impacts === 'object') {
            const impactValue = matchImpactToCurve(iv.impacts, curveName);
            if (impactValue === 0) return 0;
            const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
            return baseWave * (iv.doseMultiplier || 1.0) * impactValue;
        } else {
            // Legacy fallback: single targetEffect
            const targetIdx = iv.targetCurveIdx != null
                ? iv.targetCurveIdx
                : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
            if (targetIdx !== curveIdx) return 0;
            const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
            return baseWave * (iv.doseMultiplier || 1.0);
        }
    }

    // 4. Compute GLOBAL scale factor using ALL interventions
    const globalScaleFactors = curveInfo.map((ci, curveIdx) => {
        let maxRawEffect = 0;
        for (let j = 0; j < ci.blSmoothed.length; j++) {
            const sampleMin = ci.blSmoothed[j].hour * 60;
            let rawEffect = 0;
            for (const iv of sorted) {
                rawEffect += ivRawEffect(iv, curveIdx, sampleMin);
            }
            maxRawEffect = Math.max(maxRawEffect, Math.abs(rawEffect));
        }
        return maxRawEffect > 0 ? ci.maxDesiredGap / maxRawEffect : 0;
    });

    // 5. For each step, compute cumulative curves
    const snapshots = [];
    for (let k = 0; k < steps.length; k++) {
        const activeInterventions = steps.slice(0, k + 1).flat();

        const lxCurves = curveInfo.map((ci, curveIdx) => {
            const points = ci.blSmoothed.map((bp, j) => {
                const sampleMin = bp.hour * 60;
                let rawEffect = 0;
                for (const iv of activeInterventions) {
                    rawEffect += ivRawEffect(iv, curveIdx, sampleMin);
                }
                const scaledEffect = rawEffect * globalScaleFactors[curveIdx];
                // Impact vectors already encode direction — always ADD.
                const value = bp.value + scaledEffect;
                return { hour: bp.hour, value: Math.max(0, Math.min(100, value)) };
            });
            return {
                baseline: ci.blSmoothed,
                desired: ci.dsSmoothed,
                polarity: ci.polarity,
                maxDesiredGap: ci.maxDesiredGap,
                points,
            };
        });

        snapshots.push({ lxCurves, step: steps[k] });
    }

    return snapshots;
}

// ============================================
// 20d. Lx RENDERING
// ============================================

function renderLxCurves(lxCurves, curvesData) {
    const group = document.getElementById('phase-lx-curves');
    group.innerHTML = '';

    for (let i = 0; i < lxCurves.length; i++) {
        const lx = lxCurves[i];
        const color = curvesData[i].color;

        if (lx.points.length < 2) continue;

        const sub = getEffectSubGroup(group, i);

        // Area fill
        const fillD = phasePointsToFillPath(lx.points, false);
        if (fillD) {
            const fillPath = svgEl('path', {
                d: fillD, fill: color, class: 'phase-lx-fill', opacity: '0',
            });
            sub.appendChild(fillPath);
            fillPath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });
        }

        // Stroke path
        const strokeD = phasePointsToPath(lx.points, false);
        if (strokeD) {
            const strokePath = svgEl('path', {
                d: strokeD, stroke: color, class: 'phase-lx-path', opacity: '0',
            });
            sub.appendChild(strokePath);
            strokePath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, fill: 'forwards' });
        }
    }
}

/** Convert SVG-space X to hour value (inverse of phaseChartX) */
function svgXToHour(svgX) {
    const norm = (svgX - PHASE_CHART.padL) / PHASE_CHART.plotW;
    return PHASE_CHART.startHour + norm * (PHASE_CHART.endHour - PHASE_CHART.startHour);
}

/** Shared: update all morph visuals (curves, dots, connectors, fills, arrows) at a given playhead hour */
function updateMorphAtPlayhead(playheadHour, state) {
    const { curveAnimData, blendWidth, phLine, phGlow, arrows, arrowGroup } = state;
    const startHour = PHASE_CHART.startHour;
    const endHour = PHASE_CHART.endHour;
    const hourRange = endHour - startHour;
    const progress = Math.max(0, Math.min(1, (playheadHour - startHour) / hourRange));
    const halfBlend = blendWidth / 2;

    // Move playhead visual
    const playheadX = phaseChartX(playheadHour * 60);
    phLine.setAttribute('x', playheadX.toFixed(1));
    phGlow.setAttribute('x', (playheadX - 8).toFixed(1));

    // Morph each curve's stroke
    for (const cd of curveAnimData) {
        if (!cd.strokeEl) continue;
        const morphedPts = buildProgressiveMorphPoints(
            cd.desiredPts, cd.lxSmoothed, playheadHour, blendWidth);
        cd.strokeEl.setAttribute('d', phasePointsToPath(morphedPts, true));
    }

    // Ghost fills progressively
    const fillOp = 0.08 + (0.03 - 0.08) * progress;
    for (const cd of curveAnimData) {
        if (cd.fillEl) cd.fillEl.setAttribute('fill-opacity', fillOp.toFixed(4));
    }

    // Fade arrows
    const arrowOp = Math.max(0, 0.7 * (1 - progress * 1.5));
    for (const arrow of arrows) {
        arrow.setAttribute('opacity', arrowOp.toFixed(3));
    }
    if (progress >= 1) arrowGroup.style.opacity = '0';
    else arrowGroup.style.opacity = '';

    // Update dots + connector lines to track morphed curve positions
    const dots = document.querySelectorAll('.timeline-curve-dot');
    const connectors = document.querySelectorAll('.timeline-connector');

    dots.forEach(dot => {
        const ci = parseInt(dot.getAttribute('data-curve-idx'));
        const tH = parseFloat(dot.getAttribute('data-time-h'));
        const cd = curveAnimData[ci];
        if (!cd) return;
        let t;
        if (tH <= playheadHour - halfBlend) t = 1;
        else if (tH >= playheadHour + halfBlend) t = 0;
        else { const x = (playheadHour + halfBlend - tH) / blendWidth; t = x * x * (3 - 2 * x); }
        const dv = interpolatePointsAtTime(cd.desiredPts, tH);
        const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
        dot.setAttribute('cy', phaseChartY(dv + (lv - dv) * t).toFixed(1));
    });

    connectors.forEach(conn => {
        const ci = parseInt(conn.getAttribute('data-curve-idx'));
        const tH = parseFloat(conn.getAttribute('data-time-h'));
        const cd = curveAnimData[ci];
        if (!cd) return;
        let t;
        if (tH <= playheadHour - halfBlend) t = 1;
        else if (tH >= playheadHour + halfBlend) t = 0;
        else { const x = (playheadHour + halfBlend - tH) / blendWidth; t = x * x * (3 - 2 * x); }
        const dv = interpolatePointsAtTime(cd.desiredPts, tH);
        const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
        conn.setAttribute('y1', phaseChartY(dv + (lv - dv) * t).toFixed(1));
    });
}

/** Set up drag interaction on the morph playhead for before/after comparison */
function setupPlayheadDrag(state) {
    const { svg, playheadGroup, phLine, phGlow } = state;

    // Add a wider invisible drag handle for comfortable grabbing
    const phHandle = svgEl('rect', {
        x: String(parseFloat(phLine.getAttribute('x')) - 14),
        y: String(PHASE_CHART.padT),
        width: '30', height: String(PHASE_CHART.plotH),
        fill: 'transparent', cursor: 'col-resize',
        class: 'morph-playhead-handle',
    });
    playheadGroup.appendChild(phHandle);

    // Transition playhead to persistent drag style: brighter, thicker
    phLine.setAttribute('fill', 'rgba(245, 200, 80, 0.7)');
    phLine.setAttribute('width', '2');
    phGlow.setAttribute('fill', 'rgba(245, 200, 80, 0.04)');

    let dragging = false;
    const ctm = () => svg.getScreenCTM();

    function onDown(e) {
        e.preventDefault();
        dragging = true;
        phLine.setAttribute('fill', 'rgba(245, 200, 80, 0.9)');
        phHandle.setAttribute('cursor', 'col-resize');
    }

    function onMove(e) {
        if (!dragging) return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const m = ctm();
        if (!m) return;
        const svgX = (clientX - m.e) / m.a;
        const hour = Math.max(PHASE_CHART.startHour, Math.min(PHASE_CHART.endHour, svgXToHour(svgX)));
        // Update handle position to track playhead
        phHandle.setAttribute('x', String(phaseChartX(hour * 60) - 14));
        updateMorphAtPlayhead(hour, state);
    }

    function onUp() {
        if (!dragging) return;
        dragging = false;
        phLine.setAttribute('fill', 'rgba(245, 200, 80, 0.7)');
        phHandle.setAttribute('cursor', 'col-resize');
    }

    phHandle.addEventListener('mousedown', onDown);
    phHandle.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    // Store cleanup refs
    state.dragCleanup = () => {
        phHandle.removeEventListener('mousedown', onDown);
        phHandle.removeEventListener('touchstart', onDown);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchend', onUp);
    };
}

/** Remove draggable playhead and clean up event listeners */
function cleanupMorphDrag() {
    if (!_morphDragState) return;
    if (_morphDragState.dragCleanup) _morphDragState.dragCleanup();
    const ph = document.getElementById('morph-playhead');
    if (ph) ph.remove();
    _morphDragState = null;
}

/** Show a draggable playhead at the right edge (for step-forward re-entry to phase 2) */
function showDraggablePlayhead(lxCurves, curvesData) {
    cleanupMorphDrag();

    const desiredGroup = document.getElementById('phase-desired-curves');
    const arrowGroup = document.getElementById('phase-mission-arrows');
    const svg = document.getElementById('phase-chart-svg');

    const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
    const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');
    const arrows = Array.from(arrowGroup.children);

    const curveAnimData = lxCurves.map((lx, i) => ({
        desiredPts: lx.desired,
        // lx.points is already produced from a smoothed baseline; avoid re-smoothing
        // here because it can attenuate early-step peaks below baseline.
        lxSmoothed: (lx.points || []).map(p => ({ ...p })),
        strokeEl: strokePaths[i] || null,
        fillEl: fillPaths[i] || null,
    }));

    const endX = phaseChartX(PHASE_CHART.endHour * 60);
    const playheadGroup = svgEl('g', { id: 'morph-playhead' });
    const phGlow = svgEl('rect', {
        x: (endX - 8).toFixed(1), y: String(PHASE_CHART.padT),
        width: '18', height: String(PHASE_CHART.plotH),
        fill: 'rgba(245, 200, 80, 0.04)', rx: '9', 'pointer-events': 'none',
    });
    playheadGroup.appendChild(phGlow);
    const phLine = svgEl('rect', {
        x: endX.toFixed(1), y: String(PHASE_CHART.padT),
        width: '2', height: String(PHASE_CHART.plotH),
        fill: 'rgba(245, 200, 80, 0.7)', rx: '0.75', 'pointer-events': 'none',
    });
    playheadGroup.appendChild(phLine);

    const tooltipOverlay = document.getElementById('phase-tooltip-overlay');
    svg.insertBefore(playheadGroup, tooltipOverlay);

    const state = {
        curveAnimData, blendWidth: 1.5,
        phLine, phGlow, arrows, arrowGroup,
        svg, playheadGroup,
    };

    _morphDragState = state;
    setupPlayheadDrag(state);
}

/** Cinematic playhead sweep: morphs desired strokes → Lx positions left-to-right,
 *  then leaves a draggable before/after comparison playhead */
function animatePlayheadMorph(lxCurves, curvesData) {
    return new Promise(resolve => {
        cleanupMorphDrag(); // Clear any prior drag state

        const desiredGroup = document.getElementById('phase-desired-curves');
        const arrowGroup = document.getElementById('phase-mission-arrows');
        const svg = document.getElementById('phase-chart-svg');

        const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
        const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');
        const arrows = Array.from(arrowGroup.children);

        const curveAnimData = lxCurves.map((lx, i) => ({
            desiredPts: lx.desired,
            lxSmoothed: (lx.points || []).map(p => ({ ...p })),
            strokeEl: strokePaths[i] || null,
            fillEl: fillPaths[i] || null,
        }));

        // Create playhead element
        const playheadGroup = svgEl('g', { id: 'morph-playhead' });
        const phGlow = svgEl('rect', {
            x: String(PHASE_CHART.padL - 8), y: String(PHASE_CHART.padT),
            width: '18', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.06)', rx: '9', 'pointer-events': 'none',
        });
        playheadGroup.appendChild(phGlow);
        const phLine = svgEl('rect', {
            x: String(PHASE_CHART.padL), y: String(PHASE_CHART.padT),
            width: '1.5', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.55)', rx: '0.75', 'pointer-events': 'none',
        });
        playheadGroup.appendChild(phLine);

        const tooltipOverlay = document.getElementById('phase-tooltip-overlay');
        svg.insertBefore(playheadGroup, tooltipOverlay);

        const BLEND_WIDTH = 1.5;
        const startHour = PHASE_CHART.startHour;
        const endHour = PHASE_CHART.endHour;
        const hourRange = endHour - startHour;
        const SWEEP_DURATION = 4500; // Slow cinematic sweep

        const state = {
            curveAnimData, blendWidth: BLEND_WIDTH,
            phLine, phGlow, arrows, arrowGroup,
            svg, playheadGroup,
        };

        const startTime = performance.now();

        (function tick(now) {
            const rawT = Math.min(1, (now - startTime) / SWEEP_DURATION);
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
            const playheadHour = startHour + hourRange * ease;

            updateMorphAtPlayhead(playheadHour, state);

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                // Final state: fully morphed to Lx
                updateMorphAtPlayhead(endHour, state);

                // Keep playhead and make it draggable (before/after comparison)
                _morphDragState = state;
                setupPlayheadDrag(state);

                resolve();
            }
        })(performance.now());
    });
}

/** Quick morph desired→Lx (no playhead) — for step-forward navigation */
function quickMorphDesiredToLx(lxCurves, curvesData, durationMs) {
    return new Promise(resolve => {
        const desiredGroup = document.getElementById('phase-desired-curves');
        const arrowGroup = document.getElementById('phase-mission-arrows');
        const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
        const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');

        const perCurve = lxCurves.map((lx, i) => ({
            desiredPts: lx.desired,
            lxSmoothed: (lx.points || []).map(p => ({ ...p })),
            strokeEl: strokePaths[i] || null,
            fillEl: fillPaths[i] || null,
        }));

        const dots = document.querySelectorAll('.timeline-curve-dot');
        const connectors = document.querySelectorAll('.timeline-connector');

        const startTime = performance.now();
        (function tick(now) {
            const rawT = Math.min(1, (now - startTime) / durationMs);
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

            for (const pc of perCurve) {
                if (!pc.strokeEl) continue;
                const morphed = pc.desiredPts.map((dp, j) => ({
                    hour: dp.hour,
                    value: dp.value + (pc.lxSmoothed[j].value - dp.value) * ease,
                }));
                pc.strokeEl.setAttribute('d', phasePointsToPath(morphed, true));
            }

            const fillOp = 0.08 + (0.03 - 0.08) * ease;
            for (const pc of perCurve) {
                if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', fillOp.toFixed(4));
            }

            const arrowOp = Math.max(0, 0.7 * (1 - ease * 1.5));
            Array.from(arrowGroup.children).forEach(a => a.setAttribute('opacity', arrowOp.toFixed(3)));

            // Animate dots + connectors
            dots.forEach(dot => {
                const ci = parseInt(dot.getAttribute('data-curve-idx'));
                const tH = parseFloat(dot.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                dot.setAttribute('cy', phaseChartY(dv + (lv - dv) * ease).toFixed(1));
            });
            connectors.forEach(conn => {
                const ci = parseInt(conn.getAttribute('data-curve-idx'));
                const tH = parseFloat(conn.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                conn.setAttribute('y1', phaseChartY(dv + (lv - dv) * ease).toFixed(1));
            });

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                for (const pc of perCurve) {
                    if (pc.strokeEl) pc.strokeEl.setAttribute('d', phasePointsToPath(pc.lxSmoothed, true));
                    if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', '0.03');
                }
                arrowGroup.style.opacity = '0';
                resolve();
            }
        })(performance.now());
    });
}

/** Reverse morph Lx→desired — for step-backward navigation */
function quickMorphLxToDesired(lxCurves, curvesData, durationMs) {
    return new Promise(resolve => {
        cleanupMorphDrag(); // Remove draggable playhead if present

        const desiredGroup = document.getElementById('phase-desired-curves');
        const arrowGroup = document.getElementById('phase-mission-arrows');
        const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
        const fillPaths = desiredGroup.querySelectorAll('.phase-desired-fill');

        const perCurve = lxCurves.map((lx, i) => ({
            desiredPts: lx.desired,
            lxSmoothed: (lx.points || []).map(p => ({ ...p })),
            strokeEl: strokePaths[i] || null,
            fillEl: fillPaths[i] || null,
        }));

        const dots = document.querySelectorAll('.timeline-curve-dot');
        const connectors = document.querySelectorAll('.timeline-connector');

        arrowGroup.style.opacity = '';
        const startTime = performance.now();
        (function tick(now) {
            const rawT = Math.min(1, (now - startTime) / durationMs);
            const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

            for (const pc of perCurve) {
                if (!pc.strokeEl) continue;
                const morphed = pc.lxSmoothed.map((lp, j) => ({
                    hour: lp.hour,
                    value: lp.value + (pc.desiredPts[j].value - lp.value) * ease,
                }));
                pc.strokeEl.setAttribute('d', phasePointsToPath(morphed, true));
            }

            const fillOp = 0.03 + (0.08 - 0.03) * ease;
            for (const pc of perCurve) {
                if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', fillOp.toFixed(4));
            }

            const arrowOp = Math.min(0.7, 0.7 * ease);
            Array.from(arrowGroup.children).forEach(a => a.setAttribute('opacity', arrowOp.toFixed(3)));

            // Animate dots + connectors back to desired positions
            dots.forEach(dot => {
                const ci = parseInt(dot.getAttribute('data-curve-idx'));
                const tH = parseFloat(dot.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                dot.setAttribute('cy', phaseChartY(lv + (dv - lv) * ease).toFixed(1));
            });
            connectors.forEach(conn => {
                const ci = parseInt(conn.getAttribute('data-curve-idx'));
                const tH = parseFloat(conn.getAttribute('data-time-h'));
                const cd = perCurve[ci];
                if (!cd) return;
                const dv = interpolatePointsAtTime(cd.desiredPts, tH);
                const lv = interpolatePointsAtTime(cd.lxSmoothed, tH);
                conn.setAttribute('y1', phaseChartY(lv + (dv - lv) * ease).toFixed(1));
            });

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                for (const pc of perCurve) {
                    if (pc.strokeEl) pc.strokeEl.setAttribute('d', phasePointsToPath(pc.desiredPts, true));
                    if (pc.fillEl) pc.fillEl.setAttribute('fill-opacity', '0.08');
                }
                Array.from(arrowGroup.children).forEach(a => a.setAttribute('opacity', '0.7'));
                arrowGroup.style.opacity = '';
                resolve();
            }
        })(performance.now());
    });
}

async function animateLxReveal(lxCurves, curvesData, interventions) {
    // 1. Render substance timeline first (pills + connectors + dots at Lx target positions)
    renderSubstanceTimeline(interventions, lxCurves, curvesData);

    // 2. Stagger-reveal timeline pills
    animateTimelineReveal(800);
    await sleep(800);

    // 3. Brief pause — visual tension (dots at targets, strokes still at desired)
    await sleep(300);

    // 4. Playhead sweep morphs desired strokes → Lx positions
    await animatePlayheadMorph(lxCurves, curvesData);

    // 5. Fade old peak descriptors, re-place at Lx peak positions
    const desiredGroup = document.getElementById('phase-desired-curves');
    desiredGroup.querySelectorAll('.peak-descriptor').forEach(el => {
        el.style.transition = 'opacity 400ms ease';
        el.style.opacity = '0';
    });
    await sleep(450);
    // Re-place descriptors using Lx positions
    const lxCurvesForLabels = curvesData.map((c, i) => ({
        ...c,
        desired: lxCurves[i].points,
    }));
    placePeakDescriptors(desiredGroup, lxCurvesForLabels, 'desired', 0);
}

// ============================================
// 20d2. DESIRED CURVE TRANSMUTATION & SUBSTANCE TIMELINE
// ============================================

const TIMELINE_ZONE = {
    separatorY: 454,   // thin line just below plot area
    top: 460,          // first track starts here
    laneH: 28,
    laneGap: 4,
    pillRx: 6,
    minBarW: 58,
    bottomPad: 10,
};

const BIOMETRIC_ZONE = {
    separatorPad: 8,
    laneH: 16,
    laneGap: 1,
    labelWidth: 58,
    bottomPad: 8,
};

/**
 * After timeline re-render, re-render biometric strips if they exist.
 * This preserves strip visibility when renderSubstanceTimeline() resets the viewBox.
 */
function preserveBiometricStrips() {
    const channels = BiometricState.channels;
    if (!channels || channels.length === 0) return;
    const bioGroup = document.getElementById('phase-biometric-strips');
    if (!bioGroup || bioGroup.children.length === 0) return;

    // Clear old bio clip-paths from defs
    const svg = document.getElementById('phase-chart-svg');
    if (svg) svg.querySelectorAll('defs [id^="bio-clip-"]').forEach(el => el.remove());

    // Re-render at correct position (instant = true, no clip animation)
    renderBiometricStrips(channels, true);
}

/** Toggle desired curves to dashed/dim when Lx takes over */
function transmuteDesiredCurves(transmute) {
    const desiredGroup = document.getElementById('phase-desired-curves');
    const arrowGroup = document.getElementById('phase-mission-arrows');
    if (!desiredGroup || !arrowGroup) return;

    if (transmute) {
        const isLight = document.body.classList.contains('light-mode');
        desiredGroup.querySelectorAll('.phase-desired-path').forEach(p => {
            p.setAttribute('stroke-dasharray', '6 4');
        });
        // Move peak descriptors to overlay so they aren't dimmed by the group filter
        const overlay = document.getElementById('phase-tooltip-overlay');
        desiredGroup.querySelectorAll('.peak-descriptor').forEach(pd => {
            pd.setAttribute('data-origin', 'phase-desired-curves');
            overlay.appendChild(pd);
        });
        desiredGroup.style.transition = 'filter 600ms ease';
        desiredGroup.style.filter = isLight
            ? 'opacity(0.35) saturate(0.5)'
            : 'brightness(0.45) saturate(0.5)';
        arrowGroup.style.transition = 'filter 600ms ease';
        arrowGroup.style.filter = isLight
            ? 'opacity(0.2) saturate(0.2)'
            : 'brightness(0.25) saturate(0.2)';
    } else {
        desiredGroup.querySelectorAll('.phase-desired-path').forEach(p => {
            p.removeAttribute('stroke-dasharray');
        });
        // Move peak descriptors back from overlay to their correct sub-group (or parent)
        const overlay = document.getElementById('phase-tooltip-overlay');
        overlay.querySelectorAll('.peak-descriptor[data-origin="phase-desired-curves"]').forEach(pd => {
            pd.removeAttribute('data-origin');
            const ei = pd.getAttribute('data-effect-idx');
            const sub = ei != null ? desiredGroup.querySelector(`#phase-desired-curves-e${ei}`) : null;
            (sub || desiredGroup).appendChild(pd);
        });
        desiredGroup.style.transition = 'filter 400ms ease';
        desiredGroup.style.filter = '';
        arrowGroup.style.transition = 'filter 400ms ease';
        arrowGroup.style.filter = '';
    }
}

/** Allocate swim lanes — pixel-space tight packing, no overlap */
function allocateTimelineLanes(interventions) {
    const sorted = [...interventions].sort((a, b) => a.timeMinutes - b.timeMinutes);
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const pxGap = 3;
    const lanes = []; // each lane = array of { pxL, pxR }

    return sorted.map(iv => {
        const sub = iv.substance;
        const dur = (sub && sub.pharma) ? sub.pharma.duration : 240;
        const startMin = iv.timeMinutes;
        const endMin = startMin + dur;

        const pxL = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const pxR = pxL + Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - pxL), plotRight - pxL);

        // Find first lane with no pixel overlap
        let laneIdx = 0;
        for (; laneIdx < lanes.length; laneIdx++) {
            const overlaps = lanes[laneIdx].some(o => pxL < o.pxR + pxGap && pxR > o.pxL - pxGap);
            if (!overlaps) break;
        }
        if (!lanes[laneIdx]) lanes[laneIdx] = [];
        lanes[laneIdx].push({ pxL, pxR });

        return { iv, laneIdx, startMin, endMin, dur };
    });
}

/** Generic linear interpolation on any {hour,value}[] array */
function interpolatePointsAtTime(pts, timeH) {
    if (!pts || pts.length === 0) return 50;
    if (timeH <= pts[0].hour) return pts[0].value;
    if (timeH >= pts[pts.length - 1].hour) return pts[pts.length - 1].value;
    for (let i = 0; i < pts.length - 1; i++) {
        if (timeH >= pts[i].hour && timeH <= pts[i + 1].hour) {
            const t = (timeH - pts[i].hour) / (pts[i + 1].hour - pts[i].hour);
            return pts[i].value + t * (pts[i + 1].value - pts[i].value);
        }
    }
    return pts[pts.length - 1].value;
}

/** Linear interpolation of Lx curve value at any minute (legacy wrapper) */
function interpolateLxValue(lxCurve, timeMinutes) {
    return interpolatePointsAtTime(lxCurve.points, timeMinutes / 60);
}

/** Render FCP-style substance timeline below the chart */
function renderSubstanceTimeline(interventions, lxCurves, curvesData) {
    const group = document.getElementById('phase-substance-timeline');
    group.innerHTML = '';
    if (!interventions || interventions.length === 0) return;

    const svg = document.getElementById('phase-chart-svg');
    const defs = svg.querySelector('defs');

    // Clean up old timeline clip-paths and gradients
    defs.querySelectorAll('[id^="tl-clip-"], [id^="tl-grad-"]').forEach(el => el.remove());

    // Thin separator line
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(TIMELINE_ZONE.separatorY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(TIMELINE_ZONE.separatorY),
        class: 'timeline-separator',
    }));

    const allocated = allocateTimelineLanes(interventions);

    // Compute layout
    const laneCount = allocated.reduce((max, a) => Math.max(max, a.laneIdx + 1), 0);
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const neededH = TIMELINE_ZONE.top + laneCount * laneStep + TIMELINE_ZONE.bottomPad;
    const finalH = Math.max(500, neededH);
    svg.setAttribute('viewBox', `0 0 960 ${finalH}`);

    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const plotLeft = PHASE_CHART.padL;

    // Alternating track backgrounds (FCP-style lane stripes)
    const tlTheme = chartTheme();
    const laneStripeFill = document.body.classList.contains('light-mode')
        ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)';
    for (let i = 0; i < laneCount; i++) {
        const y = TIMELINE_ZONE.top + i * laneStep;
        if (i % 2 === 1) {
            group.appendChild(svgEl('rect', {
                x: String(plotLeft), y: y.toFixed(1),
                width: String(PHASE_CHART.plotW), height: String(TIMELINE_ZONE.laneH),
                fill: laneStripeFill, 'pointer-events': 'none',
            }));
        }
    }

    // Render connector lines + bars
    const plotTop = PHASE_CHART.padT;
    const plotBot = PHASE_CHART.padT + PHASE_CHART.plotH;

    allocated.forEach((item, idx) => {
        const { iv, laneIdx, startMin, endMin } = item;
        const sub = iv.substance;
        const color = sub ? sub.color : 'rgba(245,180,60,0.7)';

        const x1 = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const barW = Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - x1), plotRight - x1);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const h = TIMELINE_ZONE.laneH;
        const rx = TIMELINE_ZONE.pillRx;

        const pillG = svgEl('g', {
            class: 'timeline-pill-group', opacity: '0',
            'data-substance-key': iv.key,
            'data-time-minutes': String(iv.timeMinutes),
        });

        // SVG tooltip (hover title)
        if (sub) {
            const ttConf = (sub.dataConfidence || '').toLowerCase();
            const ttWarn = (ttConf === 'estimated' || ttConf === 'medium') ? `\n\u26A0\uFE0F ${sub.dataNote || 'Clinical estimation'}` : '';
            const titleEl = svgEl('title');
            titleEl.textContent = `${sub.name} — ${sub.class || ''}\nDose: ${iv.dose || sub.standardDose || ''}${ttWarn}`;
            pillG.appendChild(titleEl);
        }

        // Connector line from bar up to the targeted curve
        const targetIdx = iv.targetCurveIdx != null ? iv.targetCurveIdx : 0;
        const hasLxData = lxCurves && lxCurves[targetIdx];
        const curveColor = (curvesData && curvesData[targetIdx] && curvesData[targetIdx].color) || color;

        // Place dot/connector at DESIRED curve position initially (curves haven't morphed yet)
        const timeH = iv.timeMinutes / 60;
        let connectorTopY = plotBot; // fallback: bottom of chart
        if (hasLxData) {
            const desiredVal = interpolatePointsAtTime(lxCurves[targetIdx].desired, timeH);
            connectorTopY = phaseChartY(desiredVal);
        }

        // Dashed connector line from bar to curve
        pillG.appendChild(svgEl('line', {
            x1: x1.toFixed(1), y1: connectorTopY.toFixed(1),
            x2: x1.toFixed(1), y2: String(y),
            stroke: curveColor, 'stroke-opacity': '0.25', 'stroke-width': '0.75',
            'stroke-dasharray': '2 3',
            class: 'timeline-connector', 'pointer-events': 'none',
            'data-curve-idx': String(targetIdx),
            'data-time-h': timeH.toFixed(4),
        }));

        // Dot on curve at administration point
        if (hasLxData) {
            pillG.appendChild(svgEl('circle', {
                cx: x1.toFixed(1), cy: connectorTopY.toFixed(1), r: '3',
                fill: curveColor, 'fill-opacity': '0.65',
                stroke: curveColor, 'stroke-opacity': '0.9', 'stroke-width': '0.5',
                class: 'timeline-curve-dot', 'pointer-events': 'none',
                'data-curve-idx': String(targetIdx),
                'data-time-h': timeH.toFixed(4),
            }));
        }

        // Clip-path to contain label inside bar
        const clipId = `tl-clip-${idx}`;
        const clip = svgEl('clipPath', { id: clipId });
        clip.appendChild(svgEl('rect', {
            x: x1.toFixed(1), y: y.toFixed(1),
            width: barW.toFixed(1), height: String(h),
            rx: String(rx), ry: String(rx),
        }));
        defs.appendChild(clip);

        // Solid colored bar with border
        pillG.appendChild(svgEl('rect', {
            x: x1.toFixed(1), y: y.toFixed(1),
            width: barW.toFixed(1), height: String(h),
            rx: String(rx), ry: String(rx),
            fill: color, 'fill-opacity': '0.30',
            stroke: color, 'stroke-opacity': '0.60', 'stroke-width': '1',
            class: 'timeline-bar',
        }));

        // Clipped label inside bar
        const contentG = svgEl('g', { 'clip-path': `url(#${clipId})` });
        const name = sub ? sub.name : iv.key;
        const dose = iv.dose || (sub ? sub.standardDose : '') || '';
        const conf = sub ? (sub.dataConfidence || '') : '';
        const warnIcon = (conf.toLowerCase() === 'estimated' || conf.toLowerCase() === 'medium') ? ' \u26A0\uFE0F' : '';
        const label = svgEl('text', {
            x: (x1 + 7).toFixed(1),
            y: (y + h / 2 + 4).toFixed(1),
            class: 'timeline-bar-label',
        });
        label.textContent = dose ? `${name} ${dose}${warnIcon}` : `${name}${warnIcon}`;
        contentG.appendChild(label);
        pillG.appendChild(contentG);

        group.appendChild(pillG);
    });
}

/** Instantly show all timeline pills (used after re-render outside initial sequential flow) */
function revealTimelinePillsInstant() {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;
    group.querySelectorAll('.timeline-pill-group').forEach(pill => {
        pill.setAttribute('opacity', '1');
    });
}

/** Progressive left→right reveal for timeline pills */
function animateTimelineReveal(duration) {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;
    const pills = group.querySelectorAll('.timeline-pill-group');
    if (pills.length === 0) return;

    pills.forEach(pill => {
        // Get the x position of the bar (first rect child)
        const bar = pill.querySelector('rect');
        if (!bar) return;
        const xPos = parseFloat(bar.getAttribute('x') || '0');
        const xNorm = (xPos - PHASE_CHART.padL) / PHASE_CHART.plotW;
        const delay = Math.max(0, xNorm) * duration * 0.8;

        pill.setAttribute('opacity', '0');
        pill.style.transition = '';
        setTimeout(() => {
            pill.animate(
                [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
                { duration: 400, fill: 'forwards', easing: 'ease-out' }
            );
        }, delay);
    });
}

// ============================================
// 20d3. SEQUENTIAL SUBSTANCE LAYERING
// ============================================

/**
 * Animate the sequential Lx reveal — one substance (step) at a time.
 * Each step: substance label → timeline pill → playhead sweep → pause.
 * The "active" curve progressively modifies from baseline toward desired.
 */
async function animateSequentialLxReveal(snapshots, interventions, curvesData) {
    const svg = document.getElementById('phase-chart-svg');
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const arrowGroup = document.getElementById('phase-mission-arrows');
    const timelineGroup = document.getElementById('phase-substance-timeline');
    const lxGroup = document.getElementById('phase-lx-curves');

    // Dim desired curves to ghost AUC reference
    transmuteDesiredCurves(true);
    await sleep(400);

    // Clear any previous Lx curves
    lxGroup.innerHTML = '';

    // Prepare the timeline zone (separator + lane backgrounds) but NO pills yet
    timelineGroup.innerHTML = '';
    const defs = svg.querySelector('defs');
    defs.querySelectorAll('[id^="tl-clip-"], [id^="tl-grad-"]').forEach(el => el.remove());

    timelineGroup.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(TIMELINE_ZONE.separatorY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(TIMELINE_ZONE.separatorY),
        class: 'timeline-separator',
    }));

    const allocated = allocateTimelineLanes(interventions);
    const laneCount = allocated.reduce((max, a) => Math.max(max, a.laneIdx + 1), 0);
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const neededH = TIMELINE_ZONE.top + laneCount * laneStep + TIMELINE_ZONE.bottomPad;
    const finalH = Math.max(500, neededH);
    svg.setAttribute('viewBox', `0 0 960 ${finalH}`);

    for (let i = 0; i < laneCount; i++) {
        const y = TIMELINE_ZONE.top + i * laneStep;
        if (i % 2 === 1) {
            timelineGroup.appendChild(svgEl('rect', {
                x: String(PHASE_CHART.padL), y: y.toFixed(1),
                width: String(PHASE_CHART.plotW), height: String(TIMELINE_ZONE.laneH),
                fill: 'rgba(255,255,255,0.02)', 'pointer-events': 'none',
            }));
        }
    }

    // Fade arrows out
    Array.from(arrowGroup.children).forEach(a => {
        a.animate([{ opacity: parseFloat(a.getAttribute('opacity') || '0.7') }, { opacity: 0 }], {
            duration: 600, fill: 'forwards',
        });
    });

    // Create NEW Lx stroke + fill paths in the lxGroup, starting at baseline position.
    // This avoids repurposing the baseline strokes (which would cause a visible jump
    // when the desired strokes dim and the lower baseline strokes become prominent).
    const lxStrokes = [];
    const lxFills = [];
    const baselinePts = curvesData.map(c => smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES));
    for (let ci = 0; ci < curvesData.length; ci++) {
        const curve = curvesData[ci];
        const initD = phasePointsToPath(baselinePts[ci], true);
        const initFillD = phasePointsToFillPath(baselinePts[ci], true);
        const lxFill = svgEl('path', {
            d: initFillD, fill: curve.color, 'fill-opacity': '0.06',
            class: 'phase-lx-fill',
        });
        lxGroup.appendChild(lxFill);
        lxFills.push(lxFill);
        const lxStroke = svgEl('path', {
            d: initD, fill: 'none', stroke: curve.color,
            'stroke-width': '2.2', 'stroke-opacity': '0.9',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            class: 'phase-lx-path',
        });
        lxGroup.appendChild(lxStroke);
        lxStrokes.push(lxStroke);
    }

    // Dim baseline strokes to ghost reference (keep dashed)
    const baselineStrokesAll = baseGroup.querySelectorAll('.phase-baseline-path');
    baselineStrokesAll.forEach(s => {
        if (!s) return;
        s.style.transition = 'stroke-opacity 400ms ease';
        s.setAttribute('stroke-opacity', '0.25');
    });

    // Fade out desired fills so only the Lx fills are visible as the area reference
    desiredGroup.querySelectorAll('.phase-desired-fill').forEach(f => {
        f.animate([{ fillOpacity: parseFloat(f.getAttribute('fill-opacity') || '0.08') }, { fillOpacity: 0 }], {
            duration: 600, fill: 'forwards',
        });
    });

    // Also fade out baseline fills (the Lx fills replace them)
    baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)').forEach(f => {
        f.animate([{ fillOpacity: parseFloat(f.getAttribute('fill-opacity') || '0.04') }, { fillOpacity: 0 }], {
            duration: 600, fill: 'forwards',
        });
    });

    // Track current smoothed points per curve (Lx strokes start at baseline)
    let currentPts = baselinePts.map(pts => pts.map(p => ({ ...p })));

    // Fade baseline peak descriptors
    baseGroup.querySelectorAll('.peak-descriptor').forEach(el => {
        el.style.transition = 'opacity 300ms ease';
        el.style.opacity = '0';
    });

    const finalLxCurves = snapshots[snapshots.length - 1].lxCurves;
    const plotBot = PHASE_CHART.padT + PHASE_CHART.plotH;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;

    // Helper: render a single substance's timeline pill
    function renderSinglePill(iv) {
        const alloc = allocated.find(a => a.iv === iv);
        if (!alloc) return null;
        const { laneIdx, startMin, endMin } = alloc;
        const sub = iv.substance;
        const color = sub ? sub.color : 'rgba(245,180,60,0.7)';

        const x1 = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const barW = Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - x1), plotRight - x1);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const h = TIMELINE_ZONE.laneH;
        const rx = TIMELINE_ZONE.pillRx;

        const pillG = svgEl('g', {
            class: 'timeline-pill-group', opacity: '0',
            'data-substance-key': iv.key,
            'data-time-minutes': String(iv.timeMinutes),
        });

        // SVG tooltip (hover title)
        if (sub) {
            const ttConf = (sub.dataConfidence || '').toLowerCase();
            const ttWarn = (ttConf === 'estimated' || ttConf === 'medium') ? `\n\u26A0\uFE0F ${sub.dataNote || 'Clinical estimation'}` : '';
            const titleEl = svgEl('title');
            titleEl.textContent = `${sub.name} — ${sub.class || ''}\nDose: ${iv.dose || sub.standardDose || ''}${ttWarn}`;
            pillG.appendChild(titleEl);
        }

        const targetIdx = iv.targetCurveIdx != null ? iv.targetCurveIdx : 0;
        const hasLxData = finalLxCurves && finalLxCurves[targetIdx];
        const curveColor = (curvesData && curvesData[targetIdx] && curvesData[targetIdx].color) || color;
        const timeH = iv.timeMinutes / 60;
        let connectorTopY = plotBot;
        if (hasLxData) {
            const desiredVal = interpolatePointsAtTime(finalLxCurves[targetIdx].desired, timeH);
            connectorTopY = phaseChartY(desiredVal);
        }

        pillG.appendChild(svgEl('line', {
            x1: x1.toFixed(1), y1: connectorTopY.toFixed(1),
            x2: x1.toFixed(1), y2: String(y),
            stroke: curveColor, 'stroke-opacity': '0.25', 'stroke-width': '0.75',
            'stroke-dasharray': '2 3',
            class: 'timeline-connector', 'pointer-events': 'none',
            'data-curve-idx': String(targetIdx), 'data-time-h': timeH.toFixed(3),
        }));

        pillG.appendChild(svgEl('circle', {
            cx: x1.toFixed(1), cy: connectorTopY.toFixed(1), r: '2.5',
            fill: curveColor, 'fill-opacity': '0.6',
            class: 'timeline-curve-dot', 'pointer-events': 'none',
            'data-curve-idx': String(targetIdx), 'data-time-h': timeH.toFixed(3),
        }));

        pillG.appendChild(svgEl('rect', {
            x: x1.toFixed(1), y: y.toFixed(1),
            width: barW.toFixed(1), height: String(h),
            rx: String(rx), fill: color, 'fill-opacity': '0.30',
            stroke: color, 'stroke-opacity': '0.60', 'stroke-width': '1',
        }));

        const conf = sub ? (sub.dataConfidence || '') : '';
        const warnIcon = (conf.toLowerCase() === 'estimated' || conf.toLowerCase() === 'medium') ? ' \u26A0\uFE0F' : '';
        const labelText = `${sub?.name || iv.key}  ${iv.dose || (sub?.standardDose || '')}${warnIcon}`;
        pillG.appendChild(svgEl('text', {
            x: (x1 + 7).toFixed(1),
            y: (y + h / 2 + 4).toFixed(1),
            class: 'timeline-bar-label',
            fill: color,
        })).textContent = labelText;

        timelineGroup.appendChild(pillG);
        return pillG;
    }

    // Iterate through each step — one substance at a time
    for (let k = 0; k < snapshots.length; k++) {
        const snapshot = snapshots[k];
        const step = snapshot.step;
        const targetPts = snapshot.lxCurves.map(lx =>
            (lx.points || []).map(p => ({ ...p }))
        );

        // 1. Show substance label
        const labelNames = step.map(iv => {
            const name = iv.substance?.name || iv.key;
            return `${name} · ${iv.dose || ''}`;
        }).join('  +  ');

        const labelEl = svgEl('text', {
            x: (PHASE_CHART.padL + PHASE_CHART.plotW / 2).toFixed(1),
            y: (PHASE_CHART.padT + 22).toFixed(1),
            class: 'substance-step-label',
            opacity: '0',
            'letter-spacing': '0.06em',
        });
        labelEl.textContent = labelNames;
        svg.appendChild(labelEl);

        labelEl.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 200, fill: 'forwards',
        });

        // 3. Render and reveal this substance's timeline pill
        for (let pi = 0; pi < step.length; pi++) {
            const pill = renderSinglePill(step[pi]);
            if (pill) {
                setTimeout(() => {
                    pill.animate([
                        { opacity: 0, transform: 'translateY(4px)' },
                        { opacity: 1, transform: 'translateY(0)' },
                    ], { duration: 300, fill: 'forwards', easing: 'ease-out' });
                }, pi * 100);
            }
        }

        await sleep(350);

        // 4. Playhead sweep — morph BASELINE curves in place
        const sweepDuration = Math.max(1200, 2500 - k * 250);
        const BLEND_WIDTH = 1.5;
        const startHour = PHASE_CHART.startHour;
        const endHour = PHASE_CHART.endHour;
        const hourRange = endHour - startHour;

        const playheadGroup = svgEl('g', { class: 'sequential-playhead' });
        const phGlow = svgEl('rect', {
            x: String(PHASE_CHART.padL - 8), y: String(PHASE_CHART.padT),
            width: '18', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.06)', rx: '9', 'pointer-events': 'none',
        });
        playheadGroup.appendChild(phGlow);
        const phLine = svgEl('rect', {
            x: String(PHASE_CHART.padL), y: String(PHASE_CHART.padT),
            width: '1.5', height: String(PHASE_CHART.plotH),
            fill: 'rgba(245, 200, 80, 0.55)', rx: '0.75', 'pointer-events': 'none',
        });
        playheadGroup.appendChild(phLine);
        svg.appendChild(playheadGroup);

        const sourcePts = currentPts.map(pts => pts.map(p => ({ ...p })));

        await new Promise(resolveSweep => {
            const sweepStart = performance.now();

            (function tick(now) {
                const rawT = Math.min(1, (now - sweepStart) / sweepDuration);
                const ease = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
                const playheadHour = startHour + hourRange * ease;

                const playheadX = phaseChartX(playheadHour * 60);
                phLine.setAttribute('x', playheadX.toFixed(1));
                phGlow.setAttribute('x', (playheadX - 8).toFixed(1));

                // Morph Lx STROKES + FILLS (baseline stays as ghost reference)
                for (let ci = 0; ci < curvesData.length; ci++) {
                    const morphed = buildProgressiveMorphPoints(
                        sourcePts[ci], targetPts[ci], playheadHour, BLEND_WIDTH
                    );
                    const strokeD = phasePointsToPath(morphed, true);
                    if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                    if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
                }

                if (rawT < 1) {
                    requestAnimationFrame(tick);
                } else {
                    for (let ci = 0; ci < curvesData.length; ci++) {
                        const strokeD = phasePointsToPath(targetPts[ci], true);
                        if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                        if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(targetPts[ci], true));
                    }
                    resolveSweep();
                }
            })(performance.now());
        });

        playheadGroup.remove();
        currentPts = targetPts;

        // 5. Fade out substance label
        labelEl.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 200, fill: 'forwards',
        });
        setTimeout(() => labelEl.remove(), 250);

        // 6. Pause between steps (skip for last)
        if (k < snapshots.length - 1) {
            await sleep(400);
        }
    }

    // After all steps: update dots/connectors to final positions
    const dots = document.querySelectorAll('.timeline-curve-dot');
    const connectors = document.querySelectorAll('.timeline-connector');

    dots.forEach(dot => {
        const ci = parseInt(dot.getAttribute('data-curve-idx'));
        const tH = parseFloat(dot.getAttribute('data-time-h'));
        const lxPts = finalLxCurves[ci]?.points || [];
        const val = interpolatePointsAtTime(lxPts, tH);
        dot.setAttribute('cy', phaseChartY(val).toFixed(1));
    });

    connectors.forEach(conn => {
        const ci = parseInt(conn.getAttribute('data-curve-idx'));
        const tH = parseFloat(conn.getAttribute('data-time-h'));
        const lxPts = finalLxCurves[ci]?.points || [];
        const val = interpolatePointsAtTime(lxPts, tH);
        conn.setAttribute('y1', phaseChartY(val).toFixed(1));
    });

    // Re-place peak descriptors at final Lx positions
    baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
    const lxCurvesForLabels = curvesData.map((c, i) => ({
        ...c,
        desired: finalLxCurves[i].points,
    }));
    placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
}

// ============================================
// 20e. Lx ORCHESTRATION
// ============================================

function showLxButton() {
    const btn = document.getElementById('phase-lx-btn');
    btn.classList.remove('hidden');
    requestAnimationFrame(() => btn.classList.add('visible'));
}

function hideLxButton() {
    const btn = document.getElementById('phase-lx-btn');
    btn.classList.remove('visible');
    setTimeout(() => btn.classList.add('hidden'), 500);
}

async function handleLxPhase(curvesData) {
    // Show Lx button after 500ms delay
    await sleep(500);
    showLxButton();
    PhaseState.phase = 'lx-ready';

    // Wait for user to click Lx
    await new Promise(resolve => {
        document.getElementById('phase-lx-btn').addEventListener('click', async () => {
            hideLxButton();

            // Start timeline scan line while waiting for intervention model
            startTimelineScanLine(3);

            // Await intervention result (likely already cached from background call)
            let interventionData = PhaseState.interventionResult;
            if (!interventionData && PhaseState.interventionPromise) {
                interventionData = await PhaseState.interventionPromise;
            }

            // Stop scan line — LLM has returned
            stopTimelineScanLine();

            if (!interventionData) {
                console.error('[Lx] No intervention data — model call failed or no API key.');
                resolve();
                return;
            }

            PhaseState.interventionResult = interventionData;

            // Validate interventions
            const interventions = validateInterventions(interventionData.interventions || [], curvesData);
            if (interventions.length === 0) {
                resolve();
                return;
            }

            // Compute pharmacokinetic overlay
            const lxCurves = computeLxOverlay(interventions, curvesData);
            PhaseState.lxCurves = lxCurves;

            // Render with playhead morph reveal
            await animateLxReveal(lxCurves, curvesData, interventions);

            PhaseState.phase = 'lx-rendered';
            PhaseState.maxPhaseReached = 2;
            PhaseState.viewingPhase = 2;
            updateStepButtons();

            // Show biometric trigger after Lx completes
            await sleep(600);
            showBiometricTrigger();

            resolve();
        }, { once: true });
    });
}

// ============================================
// 25. BIOMETRIC LOOP — Trigger, Flow, LLM, Rendering
// ============================================

/**
 * Position biometric HTML elements right below the SVG's rendered box.
 * Returns the top offset (px) relative to the chart container.
 */
function getBiometricTopOffset() {
    const svg = document.getElementById('phase-chart-svg');
    if (!svg) return 0;
    const container = svg.closest('.phase-chart-container');
    if (!container) return svg.clientHeight;
    return svg.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
}

/**
 * Show the red "+" trigger button just below the SVG.
 */
function showBiometricTrigger() {
    const wrap = document.getElementById('biometric-trigger-wrap');
    if (!wrap) return;

    // Position right below the SVG
    wrap.style.top = getBiometricTopOffset() + 'px';
    wrap.classList.remove('hidden');

    const btn = document.getElementById('bio-trigger-btn');
    // Remove old listener by cloning
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);

    fresh.addEventListener('click', () => {
        wrap.classList.add('hidden');
        initBiometricFlow();
    }, { once: true });
}

function hideBiometricTrigger() {
    const wrap = document.getElementById('biometric-trigger-wrap');
    if (wrap) wrap.classList.add('hidden');
}

/**
 * Build a contextual default profile placeholder based on the user's goal
 * and the prescribed intervention protocol. Designed to create biometric
 * patterns that produce interesting revision-model adjustments.
 */
function buildContextualProfilePlaceholder() {
    const userGoal = (document.getElementById('prompt-input').value || '').trim().toLowerCase();
    const interventions = PhaseState.interventionResult?.interventions || [];
    const keys = interventions.map(iv => (iv.key || '').toLowerCase());

    // Detect substance categories present
    const hasCaffeine = keys.some(k => k.includes('caffeine') || k.includes('theacrine') || k.includes('dynamine'));
    const hasSleepAid = keys.some(k => k.includes('melatonin') || k.includes('glycine') || k.includes('magnesium') || k.includes('gaba'));
    const hasStimulant = keys.some(k => k.includes('modafinil') || k.includes('methylphenidate') || k.includes('adderall'));
    const hasAdaptogen = keys.some(k => k.includes('ashwagandha') || k.includes('rhodiola') || k.includes('theanine'));
    const hasNootropic = keys.some(k => k.includes('tyrosine') || k.includes('citicoline') || k.includes('lion'));

    // Detect goal themes
    const isFocus = /focus|concentrat|attention|productiv|work|study|deep\s*work/i.test(userGoal);
    const isSleep = /sleep|rest|recover|insomnia|wind\s*down/i.test(userGoal);
    const isEnergy = /energy|fatigue|tired|wake|alert|morning/i.test(userGoal);
    const isAnxiety = /anxi|stress|calm|relax|tension/i.test(userGoal);
    const isExercise = /exercis|workout|train|gym|run|athlet|performance|endurance/i.test(userGoal);

    // Build profile fragments that create interesting biometric tensions
    const fragments = [];

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
    if (interventions.some(iv => (iv.timeMinutes || 0) < 480)) {
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
function initBiometricFlow() {
    BiometricState.phase = 'selecting';
    BiometricState.selectedDevices = [];

    const stripUI = document.getElementById('biometric-strip-ui');
    const deviceRow = document.getElementById('bio-device-row');
    const profileRow = document.getElementById('bio-profile-row');
    const scroll = document.getElementById('bio-device-scroll');
    const goBtn = document.getElementById('bio-go-btn');

    // Reset steps
    deviceRow.classList.remove('hidden');
    profileRow.classList.add('hidden');
    goBtn.disabled = true;

    // Populate horizontal device chips
    scroll.innerHTML = '';
    const devices = (typeof BIOMETRIC_DEVICES !== 'undefined') ? BIOMETRIC_DEVICES.devices : [];
    const isLight = document.body.classList.contains('light-mode');
    devices.forEach(dev => {
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
                .map(c => c.dataset.key);
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
        const input = document.getElementById('bio-profile-input');
        input.value = '';
        input.placeholder = buildContextualProfilePlaceholder();
        input.focus();
    };

    // Submit → close strip and execute pipeline
    const submitBtn = document.getElementById('bio-submit-btn');
    const handleSubmit = () => {
        const input = document.getElementById('bio-profile-input');
        BiometricState.profileText = input.value.trim() || input.placeholder;
        // Collapse the strip
        stripUI.classList.remove('visible');
        setTimeout(() => stripUI.classList.add('hidden'), 400);
        BiometricState.phase = 'loading';
        executeBiometricPipeline();
    };
    submitBtn.onclick = handleSubmit;

    document.getElementById('bio-profile-input').onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    };
}

/**
 * Build the intervention summary string for the biometric prompt.
 */
function buildInterventionSummary() {
    const result = PhaseState.interventionResult;
    if (!result || !result.interventions) return 'No interventions prescribed.';
    return result.interventions.map(iv => {
        const h = Math.floor(iv.timeMinutes / 60);
        const m = iv.timeMinutes % 60;
        const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        return `${iv.key} ${iv.dose || ''} at ${time}`;
    }).join('; ');
}

/**
 * Build the channel spec from selected devices.
 */
function buildChannelSpec() {
    const devices = (typeof BIOMETRIC_DEVICES !== 'undefined') ? BIOMETRIC_DEVICES.devices : [];
    const channels = [];
    const seen = new Set();

    for (const devKey of BiometricState.selectedDevices) {
        const dev = devices.find(d => d.key === devKey);
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
async function callBiometricModel(channelSpec) {
    const { model, provider, key } = getStageModel('biometric');
    if (!key) throw new Error(`No API key configured for ${provider}. Add one in Settings.`);

    // Slim curve summary — only include every 4th point to reduce prompt size
    const curveSummary = PhaseState.curvesData ? PhaseState.curvesData.map(c => ({
        effect: c.effect,
        polarity: c.polarity || 'higher_is_better',
        baseline: (c.baseline || []).filter((_, i) => i % 4 === 0),
        desired: (c.desired || []).filter((_, i) => i % 4 === 0),
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
        let result;
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
    } catch (err) {
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
function exportBiometricLog() {
    const bioEntries = DebugLog.entries.filter(e => e.stageClass === 'biometric-model');
    if (bioEntries.length === 0) return;

    const payload = bioEntries.map(e => ({
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
async function executeBiometricPipeline() {
    const channelSpec = buildChannelSpec();

    // Start red scan line in the biometric zone while LLM is working
    startBioScanLine();

    try {
        const result = await callBiometricModel(channelSpec);

        // Stop scan line before rendering strips
        stopBioScanLine();
        await sleep(420); // wait for fade-out to finish

        if (!result || !Array.isArray(result.channels)) {
            console.error('[Biometric] Invalid LLM response — missing channels array');
            BiometricState.phase = 'idle';
            return;
        }

        // Validate channels: skip any with missing/short data
        const validChannels = result.channels.filter(ch =>
            ch && ch.data && Array.isArray(ch.data) && ch.data.length >= 10 && ch.signal
        );

        if (validChannels.length === 0) {
            console.error('[Biometric] No valid channels in LLM response');
            BiometricState.phase = 'idle';
            return;
        }

        // Merge LLM-returned colors/ranges with the spec if missing
        for (const ch of validChannels) {
            const spec = channelSpec.find(s => s.signal === ch.signal && s.device === ch.device);
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
        updateStepButtons();



        // Kick off revision phase (Phase 4)
        await sleep(800);
        handleRevisionPhase(PhaseState.curvesData);

    } catch (err) {
        stopBioScanLine();
        console.error('[Biometric] Pipeline error:', err.message);
        BiometricState.phase = 'idle';
    }
}

/**
 * Render biometric strips as oscilloscope-style waveforms below the substance timeline.
 * @param {Array} channels - Biometric channel data
 * @param {boolean} instant - If true, skip clip-path setup (strips appear immediately)
 */
function renderBiometricStrips(channels, instant) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;
    group.innerHTML = '';

    // Force red-shade palette on all channels regardless of LLM-returned colors
    const redShades = (typeof BIO_RED_PALETTE !== 'undefined') ? BIO_RED_PALETTE
        : ['#ff4d4d','#e03e3e','#c92a2a','#ff6b6b','#f76707','#d9480f','#ff8787','#e8590c','#fa5252','#b72b2b'];
    channels.forEach((ch, i) => { ch.color = redShades[i % redShades.length]; });

    const svg = document.getElementById('phase-chart-svg');
    const defs = svg.querySelector('defs');
    const currentVB = svg.getAttribute('viewBox').split(' ').map(Number);
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

    channels.forEach((ch, i) => {
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
            stripG.dataset.clipId = clipId;
        }

        group.appendChild(stripG);
    });

    // Expand viewBox to fit all strips
    const totalH = yOffset + channels.length * laneStep + BIOMETRIC_ZONE.bottomPad;
    svg.setAttribute('viewBox', `0 0 960 ${Math.max(currentH, totalH)}`);
}

/**
 * Build SVG path data for a biometric waveform strip.
 * Uses monotone cubic (Fritsch-Carlson) for smooth curves — same approach as phasePointsToPath.
 */
function buildBiometricWaveformPath(data, range, yTop, height) {
    if (!data || data.length < 2) return { strokeD: '', fillD: '' };

    const [rMin, rMax] = range || [0, 100];
    const rSpan = rMax - rMin || 1;

    // Map data to SVG coords
    const coords = data.map(p => ({
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
async function animateBiometricReveal(duration) {
    const group = document.getElementById('phase-biometric-strips');
    if (!group) return;

    const stripGroups = group.querySelectorAll('g[data-clip-id]');
    const svg = document.getElementById('phase-chart-svg');
    const defs = svg.querySelector('defs');
    const stagger = 80;

    const promises = Array.from(stripGroups).map((sg, i) => {
        return new Promise(resolve => {
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

function showInterventionPlayButton() {
    let btn = document.getElementById('intervention-play-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'intervention-play-btn';
        btn.className = 'intervention-play-btn hidden';
        btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
        document.querySelector('.phase-chart-container').appendChild(btn);
    }
    const svg = document.getElementById('phase-chart-svg');
    const top = svg ? svg.clientHeight + 16 : getBiometricTopOffset() + 16;
    btn.style.top = top + 'px';
    btn.classList.remove('hidden', 'loading');
    requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add('visible')));
}

function hideInterventionPlayButton() {
    const btn = document.getElementById('intervention-play-btn');
    if (!btn) return;
    btn.classList.remove('visible');
    setTimeout(() => btn.classList.add('hidden'), 500);
}

// ---- Revision Play Button (red) ----

function showRevisionPlayButton() {
    let btn = document.getElementById('revision-play-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'revision-play-btn';
        btn.className = 'revision-play-btn hidden';
        btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';
        document.querySelector('.phase-chart-container').appendChild(btn);
    }
    // Use SVG rendered height for positioning (more reliable than getBoundingClientRect)
    const svg = document.getElementById('phase-chart-svg');
    const top = svg ? svg.clientHeight + 16 : getBiometricTopOffset() + 16;
    btn.style.top = top + 'px';
    btn.classList.remove('hidden');
    btn.classList.add('loading');
    requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add('visible')));
}

function hideRevisionPlayButton() {
    const btn = document.getElementById('revision-play-btn');
    if (!btn) return;
    btn.classList.remove('visible');
    setTimeout(() => { btn.classList.add('hidden'); btn.classList.remove('loading'); }, 500);
}

function setRevisionPlayReady() {
    const btn = document.getElementById('revision-play-btn');
    if (btn) btn.classList.remove('loading');
}

// ---- Diffing Logic ----

function diffInterventions(oldIvs, newIvs) {
    const diff = [];
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

function findPillByIntervention(iv, timelineGroup) {
    // Match by data-substance-key AND data-time-minutes proximity
    const candidates = timelineGroup.querySelectorAll(
        `.timeline-pill-group[data-substance-key="${iv.key}"]`
    );
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
        // Multiple pills with same key — match by closest time
        let best = null, bestDelta = Infinity;
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

function animateSvgTransform(el, fromTx, fromTy, toTx, toTy, duration, easing) {
    const start = performance.now();
    const ease = easing === 'ease-in'
        ? t => t * t
        : easing === 'ease-out'
        ? t => 1 - (1 - t) * (1 - t)
        : t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
    return new Promise(resolve => {
        (function tick(now) {
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

function animateSvgOpacity(el, from, to, duration) {
    const start = performance.now();
    return new Promise(resolve => {
        (function tick(now) {
            const t = Math.min(1, (now - start) / duration);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            el.setAttribute('opacity', String(from + (to - from) * ease));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

function animateSvgWidth(el, fromW, toW, duration) {
    const start = performance.now();
    return new Promise(resolve => {
        (function tick(now) {
            const t = Math.min(1, (now - start) / duration);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            el.setAttribute('width', String(fromW + (toW - fromW) * ease));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

// ---- Individual Pill Animations ----
// All animations receive a `targetLayout` map: key+time → {x, y, w, laneIdx}

function animatePillMove(trigger, timelineGroup, targetLayout) {
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

function animatePillResize(trigger, timelineGroup, targetLayout) {
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

function animatePillFlip(trigger, timelineGroup, targetLayout) {
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

function animatePillRemove(trigger, timelineGroup) {
    const pill = findPillByIntervention(trigger.oldIv, timelineGroup);
    if (!pill) { console.warn('[Revision] Remove: pill not found for', trigger.oldIv.key); return; }
    console.log('[Revision] REMOVE:', trigger.oldIv.key);
    animateSvgOpacity(pill, 1, 0, 500).then(() => pill.remove());
}

function animatePillAdd(trigger, timelineGroup, targetLayout) {
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
        rx: String(rx), fill: color, 'fill-opacity': '0.30',
        stroke: color, 'stroke-opacity': '0.60', 'stroke-width': '1',
    }));

    const labelText = `${sub?.name || iv.key} ${iv.dose || ''}`;
    pillG.appendChild(svgEl('text', {
        x: (x1 + 7).toFixed(1), y: (y + h / 2 + 4).toFixed(1),
        class: 'timeline-bar-label', fill: color,
    })).textContent = labelText;

    timelineGroup.appendChild(pillG);
    animateSvgOpacity(pillG, 0, 1, 500);
}

/** Build layout key for target position map */
function layoutKey(iv) {
    return `${iv.key}@${iv.timeMinutes}`;
}

/** Pre-compute target layout from allocateTimelineLanes → Map<key@time, {x,y,w,laneIdx}> */
function buildTargetLayout(newInterventions) {
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

function animatePillDiffEntry(trigger, timelineGroup, curvesData, targetLayout) {
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
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Create animated targeting brackets around a pill.
 * Returns { group, animateIn(), animateOut() }
 *
 * Brackets look like corner marks:
 *   ⌐              ¬
 *   |  [ pill ]    |
 *   ⌙              ⌟
 */
function createTargetBrackets(svg, pillBBox, color) {
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
    const bracketStyle = {
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

    function setBracketPositions(pad) {
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
            return new Promise(resolve => {
                g.setAttribute('opacity', '1');
                const start = performance.now();
                const DUR = 350;
                (function tick(now) {
                    const rawT = Math.min(1, (now - start) / DUR);
                    const ease = 1 - Math.pow(1 - rawT, 3); // ease-out cubic
                    const pad = PAD + (SNUG - PAD) * ease;
                    setBracketPositions(pad);
                    glow.setAttribute('fill-opacity', (0.08 * ease).toFixed(3));
                    dot.setAttribute('opacity', (ease * 0.7).toFixed(2));
                    // Bracket stroke opacity ramps in
                    const strokeOp = (0.3 + 0.7 * ease).toFixed(2);
                    [tl, tr, bl, br].forEach(b => b.setAttribute('stroke-opacity', strokeOp));
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
function flashPill(pill, duration = 250) {
    const bar = pill.querySelector('.timeline-bar') || pill.querySelector('rect');
    if (!bar) return Promise.resolve();
    const origFillOp = bar.getAttribute('fill-opacity') || '0.30';
    const origStrokeOp = bar.getAttribute('stroke-opacity') || '0.60';
    const isLight = document.body.classList.contains('light-mode');
    const flashColor = isLight ? '#b45309' : '#fbbf24';
    const origFill = bar.getAttribute('fill');
    const origStroke = bar.getAttribute('stroke');

    return new Promise(resolve => {
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
function getPillBBox(pill) {
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
async function animateRevisionScan(diff, newInterventions, newLxCurves, curvesData) {
    const svg = document.getElementById('phase-chart-svg');
    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (!svg || !timelineGroup) return;

    console.log('[Revision] Diff:', diff.length, diff.map(d => `${d.type}: ${(d.oldIv||d.newIv).key}`));

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
        let pill = null;
        let brackets = null;

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
                    rx: String(rx), fill: color, 'fill-opacity': '0.30',
                    stroke: color, 'stroke-opacity': '0.60', 'stroke-width': '1',
                    class: 'timeline-bar',
                }));
                const labelEl = svgEl('text', {
                    x: (x1 + 7).toFixed(1), y: (y + h / 2 + 4).toFixed(1),
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
    // The individual animations may leave transforms/positions slightly off.
    // Re-render fully, reveal instantly, and restore biometric strips.
    await sleep(200);
    renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
    preserveBiometricStrips();
    revealTimelinePillsInstant();
}

// ---- Lx Curve Morph After Revision ----

async function morphLxCurvesToRevision(oldLxCurves, newLxCurves, curvesData) {
    const lxGroup = document.getElementById('phase-lx-curves');
    if (!lxGroup) return;
    const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
    const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');

    const MORPH_DURATION = 1200;

    await new Promise(resolve => {
        const startTime = performance.now();
        (function tick(now) {
            const rawT = Math.min(1, (now - startTime) / MORPH_DURATION);
            const ease = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

            for (let ci = 0; ci < curvesData.length; ci++) {
                const oldPts = oldLxCurves[ci]?.points || [];
                const newPts = newLxCurves[ci]?.points || [];
                const len = Math.min(oldPts.length, newPts.length);
                if (len === 0) continue;

                const morphed = [];
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

    const lxCurvesForLabels = curvesData.map((c, i) => ({
        ...c,
        desired: newLxCurves[i].points,
    }));
    placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
}

// ---- Revision Orchestrator ----

async function handleRevisionPhase(curvesData) {
    const userGoal = document.getElementById('prompt-input').value.trim();

    // 1. Fire revision LLM in background
    RevisionState.phase = 'pending';
    RevisionState.revisionPromise = callRevisionModel(userGoal, curvesData).catch(err => {
        console.error('[Revision] LLM error:', err.message);
        return null;
    });

    // 2. Show play button (loading state)
    showRevisionPlayButton();

    // 3. When LLM resolves, mark as ready
    RevisionState.revisionPromise.then(result => {
        RevisionState.revisionResult = result;
        if (result) {
            RevisionState.phase = 'ready';
            setRevisionPlayReady();
        }
    });

    // 4. Wait for play button click
    await new Promise(resolve => {
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
            console.log('[Revision] Raw old interventions:', rawOld.length, rawOld.map(iv => iv.key));
            console.log('[Revision] Raw new interventions:', rawNew.length, rawNew.map(iv => iv.key));

            const oldIvs = validateInterventions(rawOld, curvesData);
            const newIvs = validateInterventions(rawNew, curvesData);
            console.log('[Revision] Validated old:', oldIvs.length, oldIvs.map(iv => `${iv.key}@${iv.timeMinutes}min ${iv.dose}`));
            console.log('[Revision] Validated new:', newIvs.length, newIvs.map(iv => `${iv.key}@${iv.timeMinutes}min ${iv.dose}`));

            RevisionState.oldInterventions = oldIvs;
            RevisionState.newInterventions = newIvs;

            // 6. Diff
            const diff = diffInterventions(oldIvs, newIvs);
            RevisionState.diff = diff;
            console.log('[Revision] Diff entries:', diff.length, diff.map(d => `${d.type}: ${(d.oldIv||d.newIv).key}`));

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
            updateStepButtons();

            resolve();
        }, { once: true });
    });
}
