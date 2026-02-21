export const SVG_NS = 'http://www.w3.org/2000/svg';
export const CENTER = 400;
export const FRONT_RADIUS = 220;
export const BACK_RADIUS = 220;
export const LABEL_RADIUS = 310;
export const TIMING_ARC_RADIUS = 355;
export const DAYS_IN_CARTRIDGE = 5;
export const MAX_PER_LAYER = 20;

/**
 * Compute the shortest angular delta (CW or CCW) from one angle to another.
 * Returns a value in the range [-180, +180].
 */
export function shortestAngleDelta(fromDeg: any, toDeg: any) {
    const delta = toDeg - fromDeg;
    return ((delta + 180) % 360 + 360) % 360 - 180;
}

export const CartridgeConfig: any = {
    capsulesPerLayer: 13,
    totalCapsules: 26,
    angularSpacing: 360 / 13,
    halfSpacing: (360 / 13) / 2,
    frontCapsule: { width: 26, height: 60, rx: 13 },
    backCapsule: { width: 20, height: 48, rx: 10 },
    capsuleGroups: [],

    recalculate(perLayer: any) {
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

export const CLASS_COLORS: any = {
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
export const CATEGORY_COLORS = CLASS_COLORS;

export const EFFECT_TYPES: any = {
    'Focus & Cognition': { classes: ['Stimulant', 'Nootropic'],               color: '#60a5fa', glow: 'rgba(96,165,250,0.3)' },
    'Stress Resilience':  { classes: ['Adaptogen'],                            color: '#c084fc', glow: 'rgba(192,132,252,0.3)' },
    'Baseline Support':   { classes: ['Mineral/Electrolyte', 'Vitamin/Amino'], color: '#4ade80', glow: 'rgba(74,222,128,0.3)' },
    'Sedation':           { classes: ['Depressant/Sleep'],                     color: '#2dd4bf', glow: 'rgba(45,212,191,0.3)' },
    'Rx Effect':          { classes: ['Psychiatric/Other'],                    color: '#fb7185', glow: 'rgba(251,113,133,0.3)' },
    'Altered State':      { classes: ['Psychedelic/Atypical'],                 color: '#fbbf24', glow: 'rgba(251,191,36,0.3)' },
};

export const TIMING_HOURS: any = { morning: 8, midday: 12, evening: 17, bedtime: 21 };

export const TIMING_SEGMENTS = [
    { label: 'MORNING',  startAngle: -90,  endAngle: 0,    color: '#f59e0b' },
    { label: 'MIDDAY',   startAngle: 0,    endAngle: 90,   color: '#f97316' },
    { label: 'EVENING',  startAngle: 90,   endAngle: 180,  color: '#8b5cf6' },
    { label: 'BEDTIME',  startAngle: 180,  endAngle: 270,  color: '#06b6d4' },
];

// ============================================
// FAST / MAIN MODEL CONFIGURATION
// ============================================

export const FAST_MODELS: any = {
    anthropic: { model: 'claude-haiku-4-5-20251001', type: 'anthropic' },
    openai:    { model: 'gpt-4.1-nano',              type: 'openai' },
    grok:      { model: 'grok-3-mini-fast',           type: 'openai' },  // xAI uses OpenAI-compatible API
    gemini:    { model: 'gemini-2.5-flash-lite',      type: 'gemini' },
};

export const MAIN_MODELS: any = {
    anthropic: 'claude-opus-4-6',
    openai:    'gpt-4o',
    grok:      'grok-3',
    gemini:    'gemini-2.0-flash',
};

export const MODEL_OPTIONS: any = {
    anthropic: [
        { key: 'haiku',  model: 'claude-haiku-4-5-20251001',  label: 'Haiku',  type: 'anthropic' },
        { key: 'sonnet', model: 'claude-sonnet-4-6',           label: 'Sonnet', type: 'anthropic' },
        { key: 'opus',   model: 'claude-opus-4-6',            label: 'Opus',   type: 'anthropic' },
    ],
    openai: [
        { key: 'nano', model: 'gpt-4.1-nano', label: 'Nano',  type: 'openai' },
        { key: 'mini', model: 'gpt-4.1-mini', label: 'Mini',  type: 'openai' },
        { key: 'full', model: 'gpt-4o',       label: 'GPT-4o', type: 'openai' },
    ],
    grok: [
        { key: 'mini', model: 'grok-3-mini-fast', label: 'Mini', type: 'openai' },
        { key: 'full', model: 'grok-3',           label: 'Full', type: 'openai' },
    ],
    gemini: [
        { key: 'flash-lite', model: 'gemini-2.5-flash-lite', label: 'Flash Lite', type: 'gemini' },
        { key: 'flash',      model: 'gemini-2.0-flash',      label: 'Flash',      type: 'gemini' },
    ],
};

export const API_ENDPOINTS: any = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openai:    'https://api.openai.com/v1/chat/completions',
    grok:      'https://api.x.ai/v1/chat/completions',
};

// ============================================
// PHASE CHART CONFIGURATION
// ============================================

export const PHASE_CHART: any = {
    viewW: 1120, viewH: 500,
    padL: 150, padR: 150, padT: 50, padB: 50,
    startHour: 6, endHour: 30,   // 6:00am to 6:00am next day (30 = 24+6)
    maxEffect: 100,
    sampleInterval: 15,
};

PHASE_CHART.plotW = PHASE_CHART.viewW - PHASE_CHART.padL - PHASE_CHART.padR;
PHASE_CHART.plotH = PHASE_CHART.viewH - PHASE_CHART.padT - PHASE_CHART.padB;
PHASE_CHART.startMin = PHASE_CHART.startHour * 60;
PHASE_CHART.endMin = PHASE_CHART.endHour * 60;
PHASE_CHART.totalMin = PHASE_CHART.endMin - PHASE_CHART.startMin;

export const PHASE_STEPS = ['baseline-shown', 'curves-drawn', 'lx-rendered', 'biometric-rendered', 'revision-rendered'];

export const PHASE_SMOOTH_PASSES = 3;

export const WORD_CLOUD_PALETTE = [
    '#6ec8ff',
    '#b480ff',
    '#5eeabd',
    '#ffb86c',
    '#d4a0ff',
    '#4dd8a8',
    '#ff8a75',
    '#8cb8ff',
];

export const TIMELINE_ZONE = {
    separatorY: 454,   // thin line just below plot area
    top: 457,          // first track starts here
    laneH: 20,
    laneGap: 1,
    pillRx: 3,
    minBarW: 40,
    bottomPad: 6,
};

// ============================================
// LEGACY EFFECT CHART CONFIGURATION
// ============================================

export const CHART: any = {
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

export const BIOMETRIC_ZONE = {
    separatorPad: 8,
    laneH: 16,
    laneGap: 1,
    labelWidth: 58,
    bottomPad: 8,
};
