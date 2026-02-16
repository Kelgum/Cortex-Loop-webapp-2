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
// 2. SUBSTANCE DATABASE (expanded)
// ============================================

const SUBSTANCES = {
    // --- Stimulants ---
    caffeine:       { name: 'Caffeine',         category: 'stimulant',  color: '#ff6b4a', pharma: { onset: 20, peak: 45, duration: 300, halfLife: 300, strength: 80, rebound: 15 } },
    theacrine:      { name: 'Theacrine',        category: 'stimulant',  color: '#ff8c42', pharma: { onset: 30, peak: 60, duration: 360, halfLife: 360, strength: 55, rebound: 5 } },
    dynamine:       { name: 'Dynamine',         category: 'stimulant',  color: '#ff7b55', pharma: { onset: 10, peak: 30, duration: 120, halfLife: 90, strength: 50, rebound: 8 } },

    // --- Adaptogens ---
    theanine:       { name: 'L-Theanine',       category: 'adaptogen',  color: '#a855f7', pharma: { onset: 20, peak: 50, duration: 240, halfLife: 180, strength: 50, rebound: 0 } },
    rhodiola:       { name: 'Rhodiola',         category: 'adaptogen',  color: '#c084fc', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 55, rebound: 0 } },
    bacopa:         { name: 'Bacopa',           category: 'adaptogen',  color: '#9333ea', pharma: { onset: 60, peak: 120, duration: 480, halfLife: 300, strength: 40, rebound: 0 } },
    ashwagandha:    { name: 'Ashwagandha',      category: 'adaptogen',  color: '#7c3aed', pharma: { onset: 45, peak: 120, duration: 480, halfLife: 360, strength: 50, rebound: 0 } },
    cordyceps:      { name: 'Cordyceps',        category: 'adaptogen',  color: '#b47ae8', pharma: { onset: 40, peak: 90, duration: 360, halfLife: 240, strength: 45, rebound: 0 } },
    reishi:         { name: 'Reishi',           category: 'adaptogen',  color: '#8b5cf6', pharma: { onset: 60, peak: 120, duration: 480, halfLife: 300, strength: 35, rebound: 0 } },
    holytBasil:     { name: 'Holy Basil',       category: 'adaptogen',  color: '#a78bfa', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 40, rebound: 0 } },
    ginseng:        { name: 'Panax Ginseng',    category: 'adaptogen',  color: '#6d28d9', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 300, strength: 55, rebound: 5 } },
    schisandra:     { name: 'Schisandra',       category: 'adaptogen',  color: '#d8b4fe', pharma: { onset: 30, peak: 60, duration: 300, halfLife: 180, strength: 35, rebound: 0 } },

    // --- Nootropics ---
    tyrosine:       { name: 'L-Tyrosine',       category: 'nootropic',  color: '#3b82f6', pharma: { onset: 20, peak: 60, duration: 240, halfLife: 150, strength: 60, rebound: 5 } },
    citicoline:     { name: 'Citicoline',       category: 'nootropic',  color: '#60a5fa', pharma: { onset: 30, peak: 60, duration: 300, halfLife: 210, strength: 50, rebound: 0 } },
    alphaGPC:       { name: 'Alpha-GPC',        category: 'nootropic',  color: '#2563eb', pharma: { onset: 20, peak: 60, duration: 240, halfLife: 180, strength: 55, rebound: 0 } },
    lionsMane:      { name: "Lion's Mane",      category: 'nootropic',  color: '#93c5fd', pharma: { onset: 60, peak: 180, duration: 480, halfLife: 360, strength: 35, rebound: 0 } },
    racetam:        { name: 'Piracetam',        category: 'nootropic',  color: '#1d4ed8', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 300, strength: 45, rebound: 0 } },
    aniracetam:     { name: 'Aniracetam',       category: 'nootropic',  color: '#3b5df6', pharma: { onset: 20, peak: 45, duration: 180, halfLife: 90, strength: 55, rebound: 5 } },
    noopept:        { name: 'Noopept',          category: 'nootropic',  color: '#4f86f7', pharma: { onset: 15, peak: 30, duration: 180, halfLife: 60, strength: 60, rebound: 5 } },
    phenylpiracetam:{ name: 'Phenylpiracetam',  category: 'nootropic',  color: '#5b7cf7', pharma: { onset: 20, peak: 60, duration: 300, halfLife: 180, strength: 65, rebound: 8 } },
    uridine:        { name: 'Uridine',          category: 'nootropic',  color: '#7ca3fa', pharma: { onset: 45, peak: 120, duration: 480, halfLife: 300, strength: 30, rebound: 0 } },
    phosphatidylserine: { name: 'PS',           category: 'nootropic',  color: '#5593f7', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 35, rebound: 0 } },
    dmae:           { name: 'DMAE',             category: 'nootropic',  color: '#6ba3f7', pharma: { onset: 30, peak: 60, duration: 240, halfLife: 150, strength: 35, rebound: 0 } },
    sulbutiamine:   { name: 'Sulbutiamine',     category: 'nootropic',  color: '#4a8af7', pharma: { onset: 20, peak: 60, duration: 300, halfLife: 180, strength: 50, rebound: 5 } },

    // --- Minerals & Aminos ---
    creatine:       { name: 'Creatine',         category: 'mineral',    color: '#22c55e', pharma: { onset: 60, peak: 180, duration: 720, halfLife: 480, strength: 25, rebound: 0 } },
    magnesium:      { name: 'Magnesium',        category: 'mineral',    color: '#4ade80', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 30, rebound: 0 } },
    taurine:        { name: 'Taurine',          category: 'mineral',    color: '#16a34a', pharma: { onset: 20, peak: 60, duration: 300, halfLife: 180, strength: 30, rebound: 0 } },
    zinc:           { name: 'Zinc',             category: 'mineral',    color: '#15803d', pharma: { onset: 60, peak: 120, duration: 480, halfLife: 360, strength: 20, rebound: 0 } },
    iron:           { name: 'Iron',             category: 'mineral',    color: '#166534', pharma: { onset: 60, peak: 180, duration: 720, halfLife: 480, strength: 20, rebound: 0 } },
    selenium:       { name: 'Selenium',         category: 'mineral',    color: '#059669', pharma: { onset: 60, peak: 120, duration: 480, halfLife: 360, strength: 15, rebound: 0 } },
    potassium:      { name: 'Potassium',        category: 'mineral',    color: '#10b981', pharma: { onset: 30, peak: 60, duration: 240, halfLife: 180, strength: 20, rebound: 0 } },
    nac:            { name: 'NAC',              category: 'mineral',    color: '#34d399', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 30, rebound: 0 } },
    alcar:          { name: 'ALCAR',            category: 'mineral',    color: '#2dd4bf', pharma: { onset: 20, peak: 60, duration: 300, halfLife: 240, strength: 40, rebound: 0 } },
    coq10:          { name: 'CoQ10',            category: 'mineral',    color: '#059669', pharma: { onset: 60, peak: 180, duration: 480, halfLife: 360, strength: 20, rebound: 0 } },
    pqq:            { name: 'PQQ',              category: 'mineral',    color: '#0d9488', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 25, rebound: 0 } },
    nmn:            { name: 'NMN',              category: 'mineral',    color: '#14b8a6', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 25, rebound: 0 } },
    resveratrol:    { name: 'Resveratrol',      category: 'mineral',    color: '#047857', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 20, rebound: 0 } },

    // --- Vitamins ---
    vitaminD:       { name: 'Vitamin D3',       category: 'vitamin',    color: '#eab308', pharma: { onset: 120, peak: 360, duration: 1440, halfLife: 720, strength: 15, rebound: 0 } },
    vitaminB12:     { name: 'Vitamin B12',      category: 'vitamin',    color: '#f59e0b', pharma: { onset: 30, peak: 120, duration: 480, halfLife: 360, strength: 25, rebound: 0 } },
    vitaminC:       { name: 'Vitamin C',        category: 'vitamin',    color: '#fbbf24', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 180, strength: 20, rebound: 0 } },
    vitaminK2:      { name: 'Vitamin K2',       category: 'vitamin',    color: '#d97706', pharma: { onset: 120, peak: 360, duration: 1440, halfLife: 720, strength: 10, rebound: 0 } },
    bComplex:       { name: 'B-Complex',        category: 'vitamin',    color: '#f97316', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 25, rebound: 0 } },
    omega3:         { name: 'Omega-3',          category: 'vitamin',    color: '#fb923c', pharma: { onset: 60, peak: 180, duration: 720, halfLife: 480, strength: 20, rebound: 0 } },
    folate:         { name: 'Methylfolate',     category: 'vitamin',    color: '#fdba74', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 15, rebound: 0 } },

    // --- Sleep ---
    glycine:        { name: 'Glycine',          category: 'sleep',      color: '#06d6a0', pharma: { onset: 20, peak: 60, duration: 300, halfLife: 180, strength: 50, rebound: 0 } },
    apigenin:       { name: 'Apigenin',         category: 'sleep',      color: '#2dd4bf', pharma: { onset: 30, peak: 60, duration: 300, halfLife: 180, strength: 45, rebound: 0 } },
    melatonin:      { name: 'Melatonin',        category: 'sleep',      color: '#14b8a6', pharma: { onset: 20, peak: 40, duration: 240, halfLife: 40, strength: 70, rebound: 0 } },
    gaba:           { name: 'GABA',             category: 'sleep',      color: '#0891b2', pharma: { onset: 15, peak: 45, duration: 180, halfLife: 90, strength: 55, rebound: 0 } },
    valerian:       { name: 'Valerian Root',    category: 'sleep',      color: '#06b6d4', pharma: { onset: 30, peak: 60, duration: 300, halfLife: 180, strength: 45, rebound: 0 } },
    passionflower:  { name: 'Passionflower',    category: 'sleep',      color: '#22d3ee', pharma: { onset: 30, peak: 60, duration: 240, halfLife: 150, strength: 40, rebound: 0 } },
    lemon_balm:     { name: 'Lemon Balm',       category: 'sleep',      color: '#67e8f9', pharma: { onset: 30, peak: 60, duration: 240, halfLife: 150, strength: 35, rebound: 0 } },
    tryptophan:     { name: 'L-Tryptophan',     category: 'sleep',      color: '#0e7490', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 45, rebound: 0 } },
    magL_threonate: { name: 'Mag L-Threonate',  category: 'sleep',      color: '#155e75', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 40, rebound: 0 } },
};

// Rx-only substances (shown when Rx toggle is on)
const RX_SUBSTANCES = {
    modafinil:      { name: 'Modafinil',        category: 'rx',         color: '#e11d48', pharma: { onset: 60, peak: 120, duration: 720, halfLife: 720, strength: 85, rebound: 10 } },
    armodafinil:    { name: 'Armodafinil',      category: 'rx',         color: '#f43f5e', pharma: { onset: 60, peak: 120, duration: 900, halfLife: 900, strength: 85, rebound: 8 } },
    methylphenidate:{ name: 'Methylphenidate',  category: 'rx',         color: '#fb7185', pharma: { onset: 20, peak: 60, duration: 240, halfLife: 180, strength: 90, rebound: 20 } },
    amphetamine:    { name: 'Amphetamine',      category: 'rx',         color: '#be123c', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 600, strength: 95, rebound: 25 } },
    atomoxetine:    { name: 'Atomoxetine',      category: 'rx',         color: '#9f1239', pharma: { onset: 60, peak: 120, duration: 480, halfLife: 300, strength: 60, rebound: 5 } },
    bromantane:     { name: 'Bromantane',       category: 'rx',         color: '#ff5e7a', pharma: { onset: 60, peak: 180, duration: 600, halfLife: 480, strength: 50, rebound: 0 } },
    selegiline:     { name: 'Selegiline',       category: 'rx',         color: '#ff8da1', pharma: { onset: 30, peak: 90, duration: 480, halfLife: 360, strength: 55, rebound: 5 } },
    memantine:      { name: 'Memantine',        category: 'rx',         color: '#ff3d6a', pharma: { onset: 180, peak: 480, duration: 1440, halfLife: 3600, strength: 40, rebound: 0 } },
    gabapentin:     { name: 'Gabapentin',       category: 'rx',         color: '#e74c7a', pharma: { onset: 60, peak: 180, duration: 480, halfLife: 360, strength: 50, rebound: 5 } },
    pregabalin:     { name: 'Pregabalin',       category: 'rx',         color: '#d63384', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 360, strength: 60, rebound: 8 } },
    buspirone:      { name: 'Buspirone',        category: 'rx',         color: '#c71f60', pharma: { onset: 30, peak: 60, duration: 240, halfLife: 150, strength: 45, rebound: 0 } },
    propranolol:    { name: 'Propranolol',      category: 'rx',         color: '#b81c5c', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 50, rebound: 0 } },
    clonidine:      { name: 'Clonidine',        category: 'rx',         color: '#a81854', pharma: { onset: 30, peak: 60, duration: 480, halfLife: 720, strength: 50, rebound: 5 } },
};

// Controlled substances (shown when Controlled toggle is on)
const CONTROLLED_SUBSTANCES = {
    psilocybin:     { name: 'Psilocybin',       category: 'controlled', color: '#f59e0b', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 180, strength: 70, rebound: 5 } },
    lsd:            { name: 'LSD',              category: 'controlled', color: '#fbbf24', pharma: { onset: 30, peak: 120, duration: 720, halfLife: 300, strength: 75, rebound: 5 } },
    mdma:           { name: 'MDMA',             category: 'controlled', color: '#f97316', pharma: { onset: 30, peak: 90, duration: 300, halfLife: 480, strength: 90, rebound: 30 } },
    ketamine:       { name: 'Ketamine',         category: 'controlled', color: '#eab308', pharma: { onset: 5, peak: 20, duration: 90, halfLife: 150, strength: 85, rebound: 10 } },
    dmt:            { name: 'DMT',              category: 'controlled', color: '#d97706', pharma: { onset: 2, peak: 5, duration: 30, halfLife: 15, strength: 95, rebound: 5 } },
    mescaline:      { name: 'Mescaline',        category: 'controlled', color: '#ca8a04', pharma: { onset: 60, peak: 180, duration: 720, halfLife: 360, strength: 75, rebound: 5 } },
    thc:            { name: 'THC',              category: 'controlled', color: '#a3e635', pharma: { onset: 10, peak: 30, duration: 180, halfLife: 120, strength: 65, rebound: 10 } },
    cbd:            { name: 'CBD',              category: 'controlled', color: '#84cc16', pharma: { onset: 30, peak: 90, duration: 360, halfLife: 240, strength: 40, rebound: 0 } },
    ghb:            { name: 'GHB',              category: 'controlled', color: '#b45309', pharma: { onset: 15, peak: 45, duration: 180, halfLife: 30, strength: 80, rebound: 15 } },
    ibogaine:       { name: 'Ibogaine',         category: 'controlled', color: '#92400e', pharma: { onset: 60, peak: 240, duration: 1440, halfLife: 720, strength: 85, rebound: 10 } },
};

const CATEGORY_COLORS = {
    stimulant:  { fill: '#ff6b4a', glow: 'rgba(255,107,74,0.4)' },
    adaptogen:  { fill: '#a855f7', glow: 'rgba(168,85,247,0.4)' },
    nootropic:  { fill: '#3b82f6', glow: 'rgba(59,130,246,0.4)' },
    sleep:      { fill: '#06d6a0', glow: 'rgba(6,214,160,0.4)' },
    mineral:    { fill: '#22c55e', glow: 'rgba(34,197,94,0.4)' },
    vitamin:    { fill: '#eab308', glow: 'rgba(234,179,8,0.4)' },
    rx:         { fill: '#e11d48', glow: 'rgba(225,29,72,0.4)' },
    controlled: { fill: '#f59e0b', glow: 'rgba(245,158,11,0.4)' },
    unknown:    { fill: '#94a3b8', glow: 'rgba(148,163,184,0.4)' },
};

// Effect type groupings for chart curves
const EFFECT_TYPES = {
    'Focus & Cognition': { categories: ['stimulant', 'nootropic'], color: '#60a5fa', glow: 'rgba(96,165,250,0.3)' },
    'Stress Resilience':  { categories: ['adaptogen'],             color: '#c084fc', glow: 'rgba(192,132,252,0.3)' },
    'Baseline Support':   { categories: ['mineral', 'vitamin'],    color: '#4ade80', glow: 'rgba(74,222,128,0.3)' },
    'Sedation':           { categories: ['sleep'],                 color: '#2dd4bf', glow: 'rgba(45,212,191,0.3)' },
    'Rx Effect':          { categories: ['rx'],                    color: '#fb7185', glow: 'rgba(251,113,133,0.3)' },
    'Altered State':      { categories: ['controlled'],            color: '#fbbf24', glow: 'rgba(251,191,36,0.3)' },
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
    padL: 70, padR: 70, padT: 40, padB: 50,
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
};

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

const PHASE_STEPS = ['baseline-shown', 'curves-drawn', 'lx-rendered'];

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
        tickAnchor:     'rgba(80, 110, 150, 0.45)',
        tickNormal:     'rgba(80, 110, 150, 0.28)',
        labelAnchor:    'rgba(40, 60, 90, 0.75)',
        labelNormal:    'rgba(40, 60, 90, 0.50)',
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
        tickAnchor:     'rgba(174, 201, 237, 0.35)',
        tickNormal:     'rgba(174, 201, 237, 0.2)',
        labelAnchor:    'rgba(167, 191, 223, 0.7)',
        labelNormal:    'rgba(167, 191, 223, 0.45)',
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
        'phase-lx-curves', 'phase-mission-arrows',
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
    const active = { ...SUBSTANCES };
    if (AppState.includeRx) Object.assign(active, RX_SUBSTANCES);
    if (AppState.includeControlled) Object.assign(active, CONTROLLED_SUBSTANCES);
    return active;
}

function resolveSubstance(key, item) {
    const active = getActiveSubstances();
    if (active[key]) return active[key];

    // Dynamic entry for substances the LLM returns that aren't in our database
    const cat = item.category || 'unknown';
    const catColor = CATEGORY_COLORS[cat] || CATEGORY_COLORS.unknown;
    const dynamicEntry = {
        name: item.name || key.charAt(0).toUpperCase() + key.slice(1),
        category: cat,
        color: catColor.fill,
    };
    // Cache it so tooltips and labels work
    SUBSTANCES[key] = dynamicEntry;
    return dynamicEntry;
}

// ============================================
// 5. SVG UTILITIES
// ============================================

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
            id: `grad-${cat}`, x1: '0%', y1: '0%', x2: '0%', y2: '100%',
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

function parseJSONObjectResponse(text) {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
    return JSON.parse(jsonStr);
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
    const provider = AppState.selectedLLM;
    const key = AppState.apiKeys[provider];
    if (!key) {
        throw new Error(`No API key configured for ${provider}. Add your key in Settings.`);
    }

    const config = FAST_MODELS[provider];
    const systemPrompt = buildFastModelSystemPrompt();

    const debugEntry = DebugLog.addEntry({
        stage: 'Fast Model', stageClass: 'fast-model',
        model: config.model,
        systemPrompt,
        userPrompt: prompt,
        loading: true,
    });

    const startTime = performance.now();

    try {
        let result;
        switch (config.type) {
            case 'anthropic':
                result = await callAnthropicGeneric(prompt, key, config.model, systemPrompt, 256);
                break;
            case 'openai':
                result = await callOpenAIGeneric(prompt, key, config.model,
                    provider === 'grok' ? API_ENDPOINTS.grok : API_ENDPOINTS.openai,
                    systemPrompt, 256);
                break;
            case 'gemini':
                result = await callGeminiGeneric(prompt, key, config.model, systemPrompt, 256);
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
    const provider = AppState.selectedLLM;
    const key = AppState.apiKeys[provider];
    if (!key) {
        throw new Error(`No API key configured for ${provider}. Add your key in Settings.`);
    }

    const model = MAIN_MODELS[provider];
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

        const category = substance.category;

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

        fillRect.setAttribute('fill', `url(#grad-${category})`);

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
    if (document.getElementById(`grad-${category}`)) return;
    const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.unknown;
    const defs = document.querySelector('#cartridge-svg defs');
    const grad = svgEl('linearGradient', {
        id: `grad-${category}`, x1: '0%', y1: '0%', x2: '0%', y2: '100%',
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

    const rulerY = 12;  // top time ruler, FCP-style

    // Subtle bottom boundary line for plot area
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL),
        y1: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
        y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: t.axisBoundary, 'stroke-width': '0.75',
    }));

    // Hour labels + ticks every 2h at the TOP (FCP time ruler)
    // Sparse AM/PM: show suffix only at 6h anchors (6am, 12pm, 6pm, 12am)
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 2) {
        const x = phaseChartX(h * 60);
        const displayHour = h % 24;
        const isAnchor = displayHour % 6 === 0; // 0, 6, 12, 18

        // Downward tick — slightly taller at anchors
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(rulerY + 4),
            x2: x.toFixed(1), y2: String(rulerY + (isAnchor ? 12 : 9)),
            stroke: isAnchor ? t.tickAnchor : t.tickNormal,
            'stroke-width': '0.75',
        }));

        // Hour number
        const hour12 = displayHour === 0 ? 12 : displayHour > 12 ? displayHour - 12 : displayHour;
        const label = svgEl('text', {
            x: x.toFixed(1), y: String(rulerY),
            fill: isAnchor ? t.labelAnchor : t.labelNormal,
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '8', 'text-anchor': 'middle',
        });

        if (isAnchor) {
            // Anchor labels: "6am", "12pm" etc. — suffix in smaller tspan
            const ampm = displayHour < 12 || displayHour === 0 ? 'am' : 'pm';
            const numSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            numSpan.textContent = String(hour12);
            const suffixSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            suffixSpan.textContent = ampm;
            suffixSpan.setAttribute('font-size', '6');
            suffixSpan.setAttribute('fill-opacity', '0.7');
            label.appendChild(numSpan);
            label.appendChild(suffixSpan);
        } else {
            label.textContent = String(hour12);
        }

        group.appendChild(label);
    }

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
        'phase-mission-arrows', 'phase-lx-markers',
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
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(PHASE_CHART.padT),
            x2: x.toFixed(1), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            stroke: t.grid, 'stroke-width': '1',
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

            // Transition colors and opacity
            const strokeOp = 0.28 + p * 0.35;
            const strokeW = 1.2 + p * 0.6;

            rings.ring1.setAttribute('d', buildMorphPath(src1, tgt1));
            rings.ring1.setAttribute('stroke', color1);
            rings.ring1.setAttribute('stroke-opacity', strokeOp.toFixed(2));
            rings.ring1.setAttribute('stroke-width', strokeW.toFixed(1));

            if (rings.ring2 && src2 && tgt2) {
                rings.ring2.setAttribute('d', buildMorphPath(src2, tgt2));
                rings.ring2.setAttribute('stroke', color2);
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

    // Clean up ring elements
    rings.ring1.remove();
    if (rings.ring2) rings.ring2.remove();
    _orbitalRingsState = null;
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
            group.innerHTML = '';
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
     'phase-mission-arrows', 'phase-legend'].forEach(id => {
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
    ['phase-desired-curves', 'phase-mission-arrows', 'phase-lx-curves', 'phase-lx-markers'].forEach(id => {
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
        svg.querySelectorAll('defs [id^="tl-grad-"], defs [id^="tl-clip-"]').forEach(el => el.remove());
        svg.setAttribute('viewBox', '0 0 960 500');
    }
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
        if (targetIdx < 2 && current >= 2) {
            // Remove Lx layer: clear ghost AUC fills, timeline, markers, playhead
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
            // Phase 1→2: Replay the full sequential substance animation
            const snapshots = PhaseState.incrementalSnapshots;
            const interventionData = PhaseState.interventionResult;
            if (snapshots && interventionData) {
                const interventions = validateInterventions(interventionData.interventions || [], curvesData);
                await animateSequentialLxReveal(snapshots, interventions, curvesData);
            }

            PhaseState.viewingPhase = 2;
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
        const elapsed = minutesSinceDose - duration;
        const residual = strength * 0.3 * Math.pow(0.5, elapsed / halfLife);
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
            doseEvents.push({ key: item.key, category: sub.category, doseMin, pharma });
        }
    }

    // Group dose events by effect type
    for (const [typeName, typeInfo] of Object.entries(EFFECT_TYPES)) {
        const relevant = doseEvents.filter(d => typeInfo.categories.includes(d.category));
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
        ensureCategoryGradient(substance.category);

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

        fillRect.setAttribute('fill', `url(#grad-${substance.category})`);
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

            const dayLabel = capsule.dataset.day ? `Day ${capsule.dataset.day}` : '';
            tooltip.querySelector('.tooltip-detail').textContent =
                `${capsule.dataset.dose} · ${capsule.dataset.timing}${dayLabel ? ' · ' + dayLabel : ''}`;

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

        // Rings morphed into position — now render real baseline DOM elements (instant, no animation)
        renderBaselineCurvesInstant(curvesData);
        renderPhaseLegend(curvesData, 'baseline');
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
    // Wait for intervention model
    let interventionData = PhaseState.interventionResult;
    if (!interventionData && PhaseState.interventionPromise) {
        interventionData = await PhaseState.interventionPromise;
    }
    if (!interventionData) {
        interventionData = generateInterventionFallback(curvesData);
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

    PhaseState.phase = 'lx-sequential';

    // Animate sequential substance reveal
    await animateSequentialLxReveal(incrementalSnapshots, interventions, curvesData);

    PhaseState.phase = 'lx-rendered';
    PhaseState.maxPhaseReached = 2;
    PhaseState.viewingPhase = 2;
    updateStepButtons();

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

function buildInterventionSystemPrompt(curvesData) {
    // Serialize substance database for the LLM
    const active = getActiveSubstances();
    const substanceList = Object.entries(active).map(([key, s]) => ({
        key,
        name: s.name,
        category: s.category,
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
        substanceList: JSON.stringify(substanceList, null, 1),
        curveSummary: JSON.stringify(curveSummary, null, 1),
    });
}

async function callInterventionModel(prompt, curvesData) {
    const provider = AppState.selectedLLM;
    const key = AppState.apiKeys[provider];
    if (!key) return generateInterventionFallback(curvesData);

    const model = MAIN_MODELS[provider];
    const systemPrompt = buildInterventionSystemPrompt(curvesData);
    const userPrompt = `The user's goal: "${prompt}". Analyze the baseline vs desired curves and prescribe the optimal supplement intervention protocol.`;

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
                result = await callAnthropicGeneric(userPrompt, key, model, systemPrompt, 1024);
                break;
            case 'openai':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.openai, systemPrompt, 1024);
                break;
            case 'grok':
                result = await callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.grok, systemPrompt, 1024);
                break;
            case 'gemini':
                result = await callGeminiGeneric(userPrompt, key, model, systemPrompt, 1024);
                break;
        }

        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;

        // Parse JSON from response text
        let text = typeof result === 'string' ? result : (result.text || result.content || JSON.stringify(result));
        // Strip markdown fences
        text = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(text);

        DebugLog.updateEntry(debugEntry, {
            loading: false,
            requestBody,
            rawResponse,
            response: parsed,
            duration: Math.round(performance.now() - startTime),
        });

        PhaseState.interventionResult = parsed;
        return parsed;
    } catch (err) {
        DebugLog.updateEntry(debugEntry, {
            loading: false,
            error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        // Fall back to algorithmic intervention
        const fallback = generateInterventionFallback(curvesData);
        PhaseState.interventionResult = fallback;
        return fallback;
    }
}

function generateInterventionFallback(curvesData) {
    // Simple algorithmic fallback when no API key
    const interventions = [];
    const active = getActiveSubstances();

    for (const curve of curvesData) {
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const polarity = curve.polarity || 'higher_is_better';

        // Find the hour of max gap
        let maxGap = 0, gapHour = 12;
        const len = Math.min(blSmoothed.length, dsSmoothed.length);
        for (let j = 0; j < len; j++) {
            const gap = dsSmoothed[j].value - blSmoothed[j].value;
            if (Math.abs(gap) > Math.abs(maxGap)) {
                maxGap = gap;
                gapHour = dsSmoothed[j].hour;
            }
        }

        // Pick substances based on gap direction and polarity
        const needsBoost = (polarity === 'higher_is_better' && maxGap > 0) ||
                           (polarity === 'higher_is_worse' && maxGap < 0);

        if (needsBoost) {
            // For positive effects needing boost: stimulants/nootropics
            // For negative effects needing reduction: adaptogens/sleep
            const cats = polarity === 'higher_is_better'
                ? ['stimulant', 'nootropic', 'adaptogen']
                : ['adaptogen', 'sleep'];

            const candidates = Object.entries(active)
                .filter(([, s]) => cats.includes(s.category))
                .sort((a, b) => b[1].pharma.strength - a[1].pharma.strength)
                .slice(0, 2);

            const doseTimeMin = Math.round(gapHour * 60) - 60; // dose 1hr before peak need
            for (const [key, sub] of candidates) {
                interventions.push({
                    key,
                    dose: guessDose(sub),
                    timeMinutes: Math.max(360, Math.min(1380, doseTimeMin)),
                    targetEffect: curve.effect,
                });
            }
        }
    }

    return { interventions, rationale: 'Algorithmic fallback — no API key configured.' };
}

function guessDose(substance) {
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
        const sub = active[iv.key];
        if (!sub) return false;
        iv.substance = sub;
        iv.timeMinutes = Math.max(PHASE_CHART.startMin, Math.min(PHASE_CHART.endMin, iv.timeMinutes));

        // Resolve targetEffect string → targetCurveIdx
        if (curvesData && iv.targetEffect) {
            const idx = curvesData.findIndex(c =>
                c.effect && c.effect.toLowerCase() === iv.targetEffect.toLowerCase());
            iv.targetCurveIdx = idx >= 0 ? idx : null;
        }
        if (iv.targetCurveIdx == null && curvesData) {
            iv.targetCurveIdx = mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
        }

        return true;
    });
}

function mapSubstanceToEffectAxis(substanceKey, curvesData) {
    const active = getActiveSubstances();
    const sub = active[substanceKey];
    if (!sub) return [0];

    const cat = sub.category;

    // Map categories to curve indices based on polarity and effect type
    const mapping = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const polarity = curve.polarity || 'higher_is_better';

        // Stimulants & nootropics → positive effects (higher_is_better)
        if (['stimulant', 'nootropic'].includes(cat) && polarity === 'higher_is_better') {
            mapping.push(i);
        }
        // Adaptogens → both positive effects and negative effect reduction
        else if (cat === 'adaptogen') {
            mapping.push(i);
        }
        // Sleep → sedation or negative effect reduction
        else if (cat === 'sleep' && (polarity === 'higher_is_worse' || curve.effect?.toLowerCase().includes('sleep'))) {
            mapping.push(i);
        }
        // Minerals/vitamins → general support, affects all
        else if (['mineral', 'vitamin'].includes(cat)) {
            mapping.push(i);
        }
    }

    return mapping.length > 0 ? mapping : [0];
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

    // Compute raw pharmacokinetic contribution per curve
    for (let ci = 0; ci < curvesData.length; ci++) {
        const lx = lxCurves[ci];
        const points = [];
        let maxRawEffect = 0;

        // Sample every 15 minutes
        for (let j = 0; j < lx.baseline.length; j++) {
            const hourVal = lx.baseline[j].hour;
            const sampleMin = hourVal * 60;
            let rawEffect = 0;

            for (const iv of interventions) {
                const targetIdx = iv.targetCurveIdx != null
                    ? iv.targetCurveIdx
                    : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
                if (targetIdx !== ci) continue;

                const minutesSinceDose = sampleMin - iv.timeMinutes;
                const sub = iv.substance;
                if (!sub || !sub.pharma) continue;

                rawEffect += substanceEffectAt(minutesSinceDose, sub.pharma);
            }

            maxRawEffect = Math.max(maxRawEffect, Math.abs(rawEffect));
            points.push({ hour: hourVal, rawEffect });
        }

        // Normalize and apply to baseline
        const scaleFactor = maxRawEffect > 0 ? lx.maxDesiredGap / maxRawEffect : 0;

        lx.points = points.map((p, j) => {
            const baseVal = lx.baseline[j].value;
            const scaledEffect = p.rawEffect * scaleFactor;

            let value;
            if (lx.polarity === 'higher_is_worse') {
                // Reduce negative effects
                value = baseVal - scaledEffect;
            } else {
                // Boost positive effects
                value = baseVal + scaledEffect;
            }

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

    // 4. Compute GLOBAL scale factor using ALL interventions
    const globalScaleFactors = curveInfo.map((ci, curveIdx) => {
        let maxRawEffect = 0;
        for (let j = 0; j < ci.blSmoothed.length; j++) {
            const sampleMin = ci.blSmoothed[j].hour * 60;
            let rawEffect = 0;
            for (const iv of sorted) {
                const targetIdx = iv.targetCurveIdx != null
                    ? iv.targetCurveIdx
                    : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
                if (targetIdx !== curveIdx) continue;
                const sub = iv.substance;
                if (!sub || !sub.pharma) continue;
                rawEffect += substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
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
                    const targetIdx = iv.targetCurveIdx != null
                        ? iv.targetCurveIdx
                        : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
                    if (targetIdx !== curveIdx) continue;
                    const sub = iv.substance;
                    if (!sub || !sub.pharma) continue;
                    rawEffect += substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
                }
                const scaledEffect = rawEffect * globalScaleFactors[curveIdx];
                let value;
                if (ci.polarity === 'higher_is_worse') {
                    value = bp.value - scaledEffect;
                } else {
                    value = bp.value + scaledEffect;
                }
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
        lxSmoothed: smoothPhaseValues(lx.points, PHASE_SMOOTH_PASSES),
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
            lxSmoothed: smoothPhaseValues(lx.points, PHASE_SMOOTH_PASSES),
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
            lxSmoothed: smoothPhaseValues(lx.points, PHASE_SMOOTH_PASSES),
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
            lxSmoothed: smoothPhaseValues(lx.points, PHASE_SMOOTH_PASSES),
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
    top: 457,          // first track starts here
    laneH: 20,
    laneGap: 1,
    pillRx: 3,
    minBarW: 40,
    bottomPad: 6,
};

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

        const pillG = svgEl('g', { class: 'timeline-pill-group', opacity: '0' });

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
            fill: color, 'fill-opacity': '0.22',
            stroke: color, 'stroke-opacity': '0.45', 'stroke-width': '0.75',
            class: 'timeline-bar',
        }));

        // Clipped label inside bar
        const contentG = svgEl('g', { 'clip-path': `url(#${clipId})` });
        const name = sub ? sub.name : iv.key;
        const dose = iv.dose || '';
        const label = svgEl('text', {
            x: (x1 + 5).toFixed(1),
            y: (y + h / 2 + 3).toFixed(1),
            class: 'timeline-bar-label',
        });
        label.textContent = dose ? `${name} ${dose}` : name;
        contentG.appendChild(label);
        pillG.appendChild(contentG);

        group.appendChild(pillG);
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

    // Grab references to the existing baseline stroke and fill paths
    const baselineStrokes = [];
    const baselineFills = [];
    for (let ci = 0; ci < curvesData.length; ci++) {
        const strokes = baseGroup.querySelectorAll('.phase-baseline-path');
        const fills = baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)');
        baselineStrokes.push(strokes[ci] || null);
        baselineFills.push(fills[ci] || null);
    }

    // Make baseline strokes solid for the layering phase (remove dashing, boost opacity)
    baselineStrokes.forEach(s => {
        if (!s) return;
        s.style.transition = 'stroke-opacity 400ms ease';
        s.setAttribute('stroke-dasharray', 'none');
        s.setAttribute('stroke-opacity', '0.85');
        s.setAttribute('stroke-width', '2.2');
    });

    // Track current smoothed points per curve (start from baseline)
    let currentPts = curvesData.map(c => smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES));

    // Fade baseline peak descriptors
    baseGroup.querySelectorAll('.peak-descriptor').forEach(el => {
        el.style.transition = 'opacity 300ms ease';
        el.style.opacity = '0';
    });

    // The baseline FILL paths stay at their original position throughout the scans,
    // serving as the ghost AUC reference. Only the STROKES move.

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

        const pillG = svgEl('g', { class: 'timeline-pill-group', opacity: '0' });

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
            rx: String(rx), fill: color, 'fill-opacity': '0.18',
            stroke: color, 'stroke-opacity': '0.35', 'stroke-width': '0.75',
        }));

        const labelText = `${sub?.name || iv.key}  ${iv.dose || ''}`;
        pillG.appendChild(svgEl('text', {
            x: (x1 + 6).toFixed(1),
            y: (y + h / 2 + 3.5).toFixed(1),
            class: 'timeline-bar-label',
            fill: color, 'font-size': '9',
        })).textContent = labelText;

        timelineGroup.appendChild(pillG);
        return pillG;
    }

    // Iterate through each step — one substance at a time
    for (let k = 0; k < snapshots.length; k++) {
        const snapshot = snapshots[k];
        const step = snapshot.step;
        const targetPts = snapshot.lxCurves.map(lx =>
            smoothPhaseValues(lx.points, PHASE_SMOOTH_PASSES)
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

                // Morph baseline STROKES only (fills stay as original AUC ghost)
                for (let ci = 0; ci < curvesData.length; ci++) {
                    const morphed = buildProgressiveMorphPoints(
                        sourcePts[ci], targetPts[ci], playheadHour, BLEND_WIDTH
                    );
                    const strokeD = phasePointsToPath(morphed, true);
                    if (baselineStrokes[ci]) baselineStrokes[ci].setAttribute('d', strokeD);
                }

                if (rawT < 1) {
                    requestAnimationFrame(tick);
                } else {
                    for (let ci = 0; ci < curvesData.length; ci++) {
                        const strokeD = phasePointsToPath(targetPts[ci], true);
                        if (baselineStrokes[ci]) baselineStrokes[ci].setAttribute('d', strokeD);
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
        const lxSmoothed = smoothPhaseValues(finalLxCurves[ci]?.points || [], PHASE_SMOOTH_PASSES);
        const val = interpolatePointsAtTime(lxSmoothed, tH);
        dot.setAttribute('cy', phaseChartY(val).toFixed(1));
    });

    connectors.forEach(conn => {
        const ci = parseInt(conn.getAttribute('data-curve-idx'));
        const tH = parseFloat(conn.getAttribute('data-time-h'));
        const lxSmoothed = smoothPhaseValues(finalLxCurves[ci]?.points || [], PHASE_SMOOTH_PASSES);
        const val = interpolatePointsAtTime(lxSmoothed, tH);
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

            // Await intervention result (likely already cached from background call)
            let interventionData = PhaseState.interventionResult;
            if (!interventionData && PhaseState.interventionPromise) {
                interventionData = await PhaseState.interventionPromise;
            }
            if (!interventionData) {
                interventionData = generateInterventionFallback(curvesData);
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
            resolve();
        }, { once: true });
    });
}
