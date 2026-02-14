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
    curvesData: null,
    phase: 'idle',  // 'idle' | 'loading' | 'axes-revealed' | 'scanning' | 'curves-drawn'
};

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
// 8. DYNAMIC SYSTEM PROMPT BUILDER
// ============================================

function buildSystemPrompt() {
    const active = getActiveSubstances();
    const keyList = Object.keys(active);

    const byCategory = {};
    for (const [key, sub] of Object.entries(active)) {
        if (!byCategory[sub.category]) byCategory[sub.category] = [];
        byCategory[sub.category].push(key);
    }

    const categoryLines = Object.entries(byCategory)
        .map(([cat, keys]) => `- ${cat}: ${keys.join(', ')}`)
        .join('\n');

    let modeNote = '';
    if (AppState.includeRx) {
        modeNote += '\nRx MODE ENABLED: The user has opted in to prescription substances. You MAY include Rx substances like modafinil, armodafinil, methylphenidate, amphetamine, etc. when they fit the desired outcome. Note interactions and that these require a prescription.';
    }
    if (AppState.includeControlled) {
        modeNote += '\nCONTROLLED SUBSTANCE MODE ENABLED: The user has opted in to controlled substances for research/therapeutic context. You MAY include substances like psilocybin (microdose), LSD (microdose), ketamine, MDMA, THC, CBD, etc. Use therapeutic/microdose protocols when applicable. Note legal status.';
    }

    return `You are a supplement stack formulator. Given a user's desired outcome, return a JSON array of supplements to achieve it.

Known substance keys:
${keyList.join(', ')}

Categories:
${categoryLines}

Rules:
1. Return ONLY valid JSON — no markdown, no code fences, no explanation
2. Return an array of objects: [{"key": "substanceKey", "name": "Display Name", "category": "categoryName", "dose": "100mg", "timing": "morning", "count": 1}]
3. "count" is the number of capsules of this substance per day (1-3). Use 1 unless a higher dose is split across capsules.
4. Valid timings: "morning", "midday", "evening", "bedtime"
5. Use evidence-based dosing
6. Maximum 8 unique substances per stack
7. Consider interactions and contraindications
8. If the user asks for no sleep impact, avoid caffeine or limit to early morning with theanine
9. Always consider protective/recovery compounds when using stimulants
10. IMPORTANT: If the user specifically asks for a substance by name, you MUST include it in the stack. Use the closest matching key if one exists, or create a new key in camelCase. Always include the "name" and "category" fields so the UI can display it correctly.
11. You are allowed to include ANY substance the user requests, even if it's not in the known list above. Just provide a sensible key, name, category, and dose.${modeNote}`;
}

// ============================================
// 9. MULTI-LLM API CALLERS
// ============================================

async function callLLM(prompt) {
    const llm = AppState.selectedLLM;
    const key = AppState.apiKeys[llm];

    if (!key) {
        throw new Error(`No API key configured for ${llm}. Add your key in Settings.`);
    }

    try {
        let rawStack;
        switch (llm) {
            case 'anthropic': rawStack = await callAnthropic(prompt, key); break;
            case 'openai':    rawStack = await callOpenAI(prompt, key); break;
            case 'grok':      rawStack = await callGrok(prompt, key); break;
            case 'gemini':    rawStack = await callGemini(prompt, key); break;
            default:          rawStack = await callAnthropic(prompt, key);
        }

        if (!rawStack || rawStack.length === 0) {
            throw new Error('LLM returned an empty stack. Please try a different prompt.');
        }

        // Resolve substances — allow dynamic entries
        const stack = rawStack.map(item => {
            const key = item.key;
            resolveSubstance(key, item);
            return {
                key,
                dose: item.dose || '',
                timing: ['morning', 'midday', 'evening', 'bedtime'].includes(item.timing)
                    ? item.timing : 'morning',
                count: Math.min(3, Math.max(1, parseInt(item.count) || 1)),
            };
        });

        return sortStack(stack);
    } catch (err) {
        if (err instanceof Error) throw err;
        throw new Error('API call failed: ' + String(err));
    }
}

function parseJSONResponse(text) {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    // Also handle case where LLM wraps in extra text
    const bracketMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (bracketMatch) jsonStr = bracketMatch[0];
    return JSON.parse(jsonStr);
}

async function callAnthropic(prompt, apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model: 'claude-opus-4-6',
            max_tokens: 1024,
            system: buildSystemPrompt(),
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        console.warn('Anthropic API error:', err);
        return null;
    }

    const data = await response.json();
    return parseJSONResponse(data.content[0].text);
}

async function callOpenAI(prompt, apiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 1024,
            messages: [
                { role: 'system', content: buildSystemPrompt() },
                { role: 'user', content: prompt },
            ],
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        console.warn('OpenAI API error:', err);
        return null;
    }

    const data = await response.json();
    return parseJSONResponse(data.choices[0].message.content);
}

async function callGrok(prompt, apiKey) {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'grok-3',
            max_tokens: 1024,
            messages: [
                { role: 'system', content: buildSystemPrompt() },
                { role: 'user', content: prompt },
            ],
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        console.warn('Grok API error:', err);
        return null;
    }

    const data = await response.json();
    return parseJSONResponse(data.choices[0].message.content);
}

async function callGemini(prompt, apiKey) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1024 },
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        console.warn('Gemini API error:', err);
        return null;
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    return parseJSONResponse(text);
}

function sortStack(stack) {
    const timingOrder = { morning: 0, midday: 1, evening: 2, bedtime: 3 };
    stack.sort((a, b) => timingOrder[a.timing] - timingOrder[b.timing]);
    return stack;
}

// ============================================
// 9b. LLM DEBUG LOG
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
    return `You are an expert pharmacologist. Given a user's desired cognitive or physical outcome, identify the 1-2 most relevant pharmacodynamic effects that would need to be modulated.

Rules:
1. Return ONLY valid JSON — no markdown, no code fences, no explanation
2. Format: {"effects": ["Effect Name 1", "Effect Name 2"]}
3. Maximum 2 effects
4. Use clear, concise pharmacodynamic effect labels (1-3 words). Must be physiological effects, NOT molecule/substance names. Good: "Focused Attention", "Sleep Pressure", "Stress Resilience", "Circadian Rhythm", "Wakefulness". Bad: "Melatonin", "Cortisol", "GABA", "Dopamine"
5. If the objective clearly maps to a single effect, return only 1`;
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
    return `You are an expert pharmacologist modeling 24-hour pharmacodynamic curves. Given the user's desired outcome:

1. Identify the 1-2 most relevant pharmacodynamic effects to model
2. For each effect, provide a baseline curve (no supplementation/medication/controlled substances, natural circadian rhythms) and a desired/target curve (with optimal supplementation/medication/controlled substances)
3. For each effect, provide 5 short descriptors (max 4 words each) for the 0%, 25%, 50%, 75%, 100% intensity levels so the user can gauge whether the baseline is accurate

Rules:
1. Return ONLY valid JSON — no markdown, no code fences
2. Format:
{
  "curves": [
    {
      "effect": "Effect Name",
      "color": "#hex",
      "levels": {"0": "No activity", "25": "Mild", "50": "Moderate", "75": "Strong", "100": "Peak"},
      "baseline": [{"hour": 6, "value": 20}, {"hour": 7, "value": 25}, ...],
      "desired": [{"hour": 6, "value": 20}, {"hour": 7, "value": 30}, ...]
    }
  ]
}
3. Provide datapoints for every hour from 6 to 30 (25 points per curve). Hours 24-30 represent the next day (i.e., hour 24=midnight, 25=1am, 26=2am, ..., 30=6am)
4. Values: 0-100 scale (0 = minimal activity, 100 = maximal)
5. Baseline: reflect natural circadian/ultradian rhythms (e.g. cortisol peaks morning, melatonin peaks night)
6. Desired: show the improvement the user wants — e.g. enhanced attention during work, deeper sleep at night, etc.
7. Colors: distinct, visible on dark background (#0a0a0f). Use muted but vibrant tones like #60a5fa, #c084fc, #4ade80, #fb7185
8. Maximum 2 effect curves
9. Be physiologically realistic
10. Effect names MUST be pharmacodynamic effects (not molecules or substances). Use short (1-3 words) physiological descriptors — e.g. "Sleep Pressure", "Focused Attention", "Stress Resilience", "Circadian Rhythm". NEVER use substance names like "Melatonin", "Cortisol", "GABA" as effect labels. Never combine concepts with "/" or "and"
11. Level descriptors must be experiential and specific to the effect — e.g. for Focused Attention: "0": "No focus", "25": "Easily distracted", "50": "Steady awareness", "75": "Deep concentration", "100": "Flow state"`;
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

    // X-axis line
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL),
        y1: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
        y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: 'rgba(174, 201, 237, 0.58)', 'stroke-width': '1.2',
    }));

    // Hour labels + ticks every 2h (6am to 6am next day)
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 2) {
        const x = phaseChartX(h * 60);
        // Tick mark
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            x2: x.toFixed(1), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH + 6),
            stroke: 'rgba(174, 201, 237, 0.4)', 'stroke-width': '1',
        }));
        // Label — wrap hours > 24 back to 0-based, format as am/pm
        const displayHour = h % 24;
        const hour12 = displayHour === 0 ? 12 : displayHour > 12 ? displayHour - 12 : displayHour;
        const ampm = displayHour < 12 ? 'a' : 'p';
        const label = svgEl('text', {
            x: x.toFixed(1), y: String(PHASE_CHART.padT + PHASE_CHART.plotH + 22),
            fill: 'rgba(167, 191, 223, 0.88)',
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '9', 'text-anchor': 'middle',
        });
        label.textContent = `${hour12}${ampm}`;
        group.appendChild(label);
    }

    // "Time" label
    const xLabel = svgEl('text', {
        x: String(PHASE_CHART.padL + PHASE_CHART.plotW / 2),
        y: String(PHASE_CHART.viewH - 8),
        fill: 'rgba(159, 217, 255, 0.96)',
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '12', 'font-weight': '600', 'letter-spacing': '0.18em', 'text-anchor': 'middle',
    });
    xLabel.textContent = 'Time';
    group.appendChild(xLabel);
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
    if (effects.length >= 1) buildSingleYAxis(leftGroup, effects[0], 'left', cols[0], leftLevels);
    if (effects.length >= 2) buildSingleYAxis(rightGroup, effects[1], 'right', cols[1], rightLevels);
}

function buildSingleYAxis(group, effectLabel, side, color, levels) {
    const x = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
    const tickDir = side === 'left' ? -6 : 6;
    const textAnchor = side === 'left' ? 'end' : 'start';
    const labelOffset = side === 'left' ? -10 : 10;
    const labelColor = color || 'rgba(171, 214, 255, 0.92)';

    // Axis line
    group.appendChild(svgEl('line', {
        x1: String(x), y1: String(PHASE_CHART.padT),
        x2: String(x), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: 'rgba(174, 201, 237, 0.58)', 'stroke-width': '1.2',
    }));

    // Tick marks + labels every 25% (including 0)
    for (let v = 0; v <= 100; v += 25) {
        const y = phaseChartY(v);
        group.appendChild(svgEl('line', {
            x1: String(x), y1: y.toFixed(1),
            x2: String(x + tickDir), y2: y.toFixed(1),
            stroke: 'rgba(174, 201, 237, 0.35)', 'stroke-width': '1',
        }));

        const numLabel = svgEl('text', {
            x: String(x + labelOffset), y: (y + 3).toFixed(1),
            fill: 'rgba(167, 191, 223, 0.76)',
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '10', 'text-anchor': textAnchor,
        });
        numLabel.textContent = String(v);
        group.appendChild(numLabel);

        // Hover descriptor tooltip + guide line (rendered in topmost overlay)
        if (levels && levels[String(v)]) {
            const descriptor = levels[String(v)];
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

            // Invisible hit area for hover (in overlay so it's above curves)
            const hitArea = svgEl('rect', {
                x: String(side === 'left' ? x - 40 : x),
                y: String(y - 12),
                width: '40', height: '24',
                fill: 'transparent',
                class: 'tick-hover-area',
                'pointer-events': 'all',
                cursor: 'default',
            });
            overlay.appendChild(hitArea);

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
                fill: 'rgba(13, 17, 23, 0.8)',
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

            // Hover events — show descriptor, guide line, hide number
            let guideAnim = null;
            hitArea.addEventListener('mouseenter', () => {
                tipGroup.setAttribute('opacity', '1');
                numLabel.setAttribute('opacity', '0');
                // Animate guide line in from the axis side
                const startX = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
                const endX = side === 'left' ? PHASE_CHART.padL + PHASE_CHART.plotW : PHASE_CHART.padL;
                guideLine.setAttribute('x1', String(startX));
                guideLine.setAttribute('x2', String(startX));
                guideLine.setAttribute('stroke-opacity', '0.35');
                const animStart = performance.now();
                guideAnim = (function growLine() {
                    const t = Math.min(1, (performance.now() - animStart) / 350);
                    const ease = 1 - Math.pow(1 - t, 3);
                    guideLine.setAttribute('x2', String(startX + (endX - startX) * ease));
                    if (t < 1) requestAnimationFrame(growLine);
                    return growLine;
                })();
            });
            hitArea.addEventListener('mouseleave', () => {
                tipGroup.setAttribute('opacity', '0');
                numLabel.setAttribute('opacity', '1');
                guideLine.setAttribute('stroke-opacity', '0');
                guideAnim = null;
            });
        }
    }

    // Horizontal effect label at top of axis
    const labelAnchor = side === 'left' ? 'start' : 'end';
    const labelX = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
    const yLabel = svgEl('text', {
        x: String(labelX), y: String(PHASE_CHART.padT - 14),
        fill: labelColor,
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

    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 2) {
        const x = phaseChartX(h * 60);
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(PHASE_CHART.padT),
            x2: x.toFixed(1), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            stroke: 'rgba(145, 175, 214, 0.17)', 'stroke-width': '1',
        }));
    }
    for (let v = 25; v <= 100; v += 25) {
        const y = phaseChartY(v);
        group.appendChild(svgEl('line', {
            x1: String(PHASE_CHART.padL), y1: y.toFixed(1),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: y.toFixed(1),
            stroke: 'rgba(145, 175, 214, 0.17)', 'stroke-width': '1',
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
    const glow = svgEl('rect', {
        id: 'scan-line-glow',
        x: String(startX - 4), y: String(PHASE_CHART.padT),
        width: '10', height: String(PHASE_CHART.plotH),
        fill: 'rgba(160,160,255,0.08)', rx: '5',
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
    // Baseline: worst point (trough) — user empathises with their condition
    // Target: max divergence from baseline — where the stack helps the most
    const useWorst = pointsKey === 'baseline';

    const items = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;

        let keyPoint;
        if (useWorst) {
            keyPoint = findCurveTrough(curve[pointsKey]);
        } else {
            // Place target label at max divergence point
            const div = findMaxDivergence(curve);
            keyPoint = div || findCurvePeak(curve[pointsKey]);
        }

        const level = nearestLevel(keyPoint.value);
        const descriptor = curve.levels[String(level)];
        if (!descriptor) continue;
        const px = phaseChartX(keyPoint.hour * 60);
        const py = phaseChartY(keyPoint.value);
        items.push({ curve, descriptor, px, py, peakVal: keyPoint.value });
    }
    if (items.length === 0) return;

    // Default placement: above peaks (target), below troughs (baseline)
    for (const item of items) {
        item.labelY = useWorst ? item.py + 18 : item.py - 14;
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
    for (let i = 0; i < items.length; i++) {
        const { curve, descriptor, px, labelY } = items[i];
        const delayMs = baseDelay + i * 200;

        // Estimate text dimensions for backdrop pill
        const estTextW = descriptor.length * 6.5;
        const pillPadX = 8, pillPadY = 4;
        const pillW = estTextW + pillPadX * 2;
        const pillH = 16 + pillPadY * 2;

        // Container group for backdrop + text
        const labelGroup = svgEl('g', { class: 'peak-descriptor', opacity: '0' });

        // Dark backdrop pill
        const backdrop = svgEl('rect', {
            x: (px - pillW / 2).toFixed(1),
            y: (labelY - pillH / 2 - 2).toFixed(1),
            width: pillW.toFixed(1),
            height: pillH.toFixed(1),
            rx: '6', ry: '6',
            fill: 'rgba(13, 17, 23, 0.75)',
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
        group.appendChild(labelGroup);

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

        // Area fill
        const fillPath = svgEl('path', {
            d: phasePointsToFillPath(curve.baseline),
            fill: curve.color, 'fill-opacity': '0', // animate in
        });
        group.appendChild(fillPath);

        // Dashed stroke
        const strokePath = svgEl('path', {
            d: pathD, fill: 'none', stroke: curve.color,
            class: 'phase-baseline-path', opacity: '0',
        });
        group.appendChild(strokePath);

        // Animate fade-in
        strokePath.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: 800, fill: 'forwards' });
        fillPath.animate([{ fillOpacity: 0 }, { fillOpacity: 0.04 }], { duration: 800, fill: 'forwards' });

            await sleep(200);
    }

    // Place peak descriptors at each baseline curve's peak (batch for collision avoidance)
    placePeakDescriptors(group, curvesData, 'baseline', 400);
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
        allArrows.push({ curve, arrow: { hour: div.hour, baseVal: match.value, desiredVal: div.value, diff: div.diff } });
    }

    // Phase 1: Grow elegant arrows from baseline → desired (900ms)
    for (const { curve, arrow } of allArrows) {
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
        arrowGroup.appendChild(glowLine);

        // Main arrow shaft
        const arrowLine = svgEl('line', {
            x1: x.toFixed(1), y1: y1.toFixed(1),
            x2: x.toFixed(1), y2: y1.toFixed(1),
            stroke: curve.color, class: 'mission-arrow', opacity: '0',
        });
        arrowGroup.appendChild(arrowLine);

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

        // Desired fill
        const fillPath = svgEl('path', {
            d: baseFillD,
            fill: curve.color, 'fill-opacity': '0',
        });
        desiredGroup.appendChild(fillPath);
        fillPath.animate([{ fillOpacity: 0 }, { fillOpacity: 0.08 }], { duration: morphDuration, fill: 'forwards' });

        // Desired stroke — starts at baseline path, morphs to desired
        const strokePath = svgEl('path', {
            d: basePathD, fill: 'none', stroke: curve.color,
            class: 'phase-desired-path', opacity: '0',
        });
        desiredGroup.appendChild(strokePath);
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
    ['phase-x-axis', 'phase-y-axis-left', 'phase-y-axis-right', 'phase-grid',
     'phase-scan-line', 'phase-baseline-curves', 'phase-desired-curves',
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

    // === STEP 5: Animate prompt upward + reveal X-axis ===
    const promptSection = document.getElementById('prompt-section');
    promptSection.classList.remove('phase-centered');
    promptSection.classList.add('phase-top');

    // Show chart container
    const chartContainer = document.getElementById('phase-chart-container');
    chartContainer.classList.add('visible');

    // Build and reveal X-axis
    await sleep(350);
    buildPhaseXAxis();
    document.getElementById('phase-x-axis').classList.add('revealed');

    // === STEP 2 + 4: Fire both API calls in parallel ===
    const fastModelPromise = callFastModel(prompt);
    const mainModelPromise = callMainModelForCurves(prompt);

    // === STEP 7: Start scanning line after brief pause ===
    await sleep(400);
    startScanLine();
    PhaseState.phase = 'scanning';

    // === STEP 6: When fast model returns, show Y-axes ===
    let effects;
    try {
        const fastResult = await fastModelPromise;
        effects = fastResult.effects || [];
        if (effects.length === 0) throw new Error('Fast model returned no effects.');
        if (effects.length > 2) effects = effects.slice(0, 2);
    } catch (err) {
        stopScanLine();
        showPromptError(err instanceof Error ? err.message : String(err));
        PhaseState.isProcessing = false;
        document.getElementById('prompt-submit').disabled = false;
        return;
    }

    PhaseState.effects = effects;
    PhaseState.phase = 'axes-revealed';

    buildPhaseYAxes(effects);
    buildPhaseGrid();
    document.getElementById('phase-y-axis-left').classList.add('revealed');
    if (effects.length > 1) {
        document.getElementById('phase-y-axis-right').classList.add('revealed');
    }

    // === STEP 8: When main model returns, draw curves ===
    let curvesResult;
    try {
        curvesResult = await mainModelPromise;
    } catch (err) {
        stopScanLine();
        showPromptError(err instanceof Error ? err.message : String(err));
        PhaseState.isProcessing = false;
        document.getElementById('prompt-submit').disabled = false;
        return;
    }

    // Validate curve data
    let curvesData = curvesResult.curves || [];
    if (curvesData.length === 0) {
        stopScanLine();
        showPromptError('Main model returned no curve data.');
        PhaseState.isProcessing = false;
        document.getElementById('prompt-submit').disabled = false;
        return;
    }

    // Update Y-axis labels with main model's effect names + colors
    const mainEffects = curvesData.map(c => c.effect);
    const mainColors = curvesData.map(c => c.color);
    if (mainEffects.length > 0) {
        effects = mainEffects.slice(0, 2);
        PhaseState.effects = effects;
        buildPhaseYAxes(effects, mainColors, curvesData);
    }

    // Stop scanning line
    stopScanLine();
    await sleep(500);

    // Draw baseline curves with labels sliding in from axes
    await renderBaselineCurves(curvesData);
    renderPhaseLegend(curvesData, 'baseline');
    await sleep(600);

    // Show "Optimize" button
    const optimizeBtn = document.getElementById('phase-optimize-btn');
    optimizeBtn.classList.remove('hidden');
    requestAnimationFrame(() => optimizeBtn.classList.add('visible'));

    PhaseState.curvesData = curvesData;
    PhaseState.phase = 'baseline-shown';
    PhaseState.isProcessing = false;
    document.getElementById('prompt-submit').disabled = false;

    // Wait for user to click Optimize
    await new Promise(resolve => {
        optimizeBtn.addEventListener('click', async () => {
            optimizeBtn.classList.remove('visible');
            await sleep(300);
            optimizeBtn.classList.add('hidden');

            // Morph baseline → desired with arrows
            await morphToDesiredCurves(curvesData);
            renderPhaseLegend(curvesData, 'full');

            PhaseState.phase = 'curves-drawn';
            resolve();
        }, { once: true });
    });
}

// Old handlePromptSubmit for cartridge flow (preserved for future use)
async function handlePromptSubmitCartridge(e) {
    e.preventDefault();

    const input = document.getElementById('prompt-input');
    const prompt = input.value.trim();
    if (!prompt || AppState.isAnimating || AppState.isLoading) return;

    clearPromptError();
    document.getElementById('prompt-hint').style.opacity = '0';

    AppState.isLoading = true;
    showLoading();

    resetSimulation();

    if (AppState.filledSlots.size > 0) {
        hideChartPanel();
        await animateEjectSequence();
    }

    try {
        const stack = await callLLM(prompt);
        AppState.currentStack = stack;
        buildEffectChart(stack);
        showChartPanel();
        await sleep(400);
        const layout = computeCartridgeLayout(stack);
        CartridgeConfig.recalculate(layout.capsulesPerLayer);
        CartridgeConfig.capsuleGroups = layout.capsuleGroups;
        rebuildCapsuleLayers();
        hideLoading();
        await sleep(200);
        await animateFillSequence(stack);
        await sleep(300);
        showPlayButton();
    } catch (err) {
        hideLoading();
        showPromptError(err instanceof Error ? err.message : String(err));
    }

    AppState.isLoading = false;
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

document.addEventListener('DOMContentLoaded', () => {
    // Defer cartridge initialization — not visible in phase chart flow
    // buildCartridgeSVG();
    // initTooltip();

    initSettings();
    initToggles();
    initDebugPanel();

    document.getElementById('prompt-form').addEventListener('submit', handlePromptSubmit);
    document.getElementById('prompt-input').focus();

    // Prompt starts centered (class already set in HTML)
    // Cartridge section starts hidden (class already set in HTML)
});
