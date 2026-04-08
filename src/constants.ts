/**
 * Constants — Layout dimensions, color palettes, model option tables, and API endpoint URLs.
 * Exports: PHASE_CHART, TIMELINE_ZONE, COMPILE_ZONE, BIOMETRIC_ZONE, MY_STREAM, MODEL_OPTIONS, API_ENDPOINTS, WORD_CLOUD_PALETTE, PHASE_STEPS
 * Depends on: (none — leaf module)
 */
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const CENTER = 400;

// ── Per-substance color differentiation ──────────────────────────
// Curated palettes per class: every color is hand-picked for strong visual
// contrast on dark backgrounds (#0a0a0f).
// indices 1–7 pick from the palette, overflow wraps with a lightness bump.
// Colors widen beyond the strict class hue for real perceptual distinctness.
export const CLASS_PALETTE: Record<string, string[]> = {
    //                       hero         2            3            4            5            6            7            8
    Stimulant: ['#ff4757', '#ff9f43', '#f7b731', '#fc5c65', '#fa8231', '#eb3b5a', '#e66767', '#d63031'],
    'Depressant/Sleep': ['#4a6078', '#778beb', '#cf6a87', '#546de5', '#a4b0be', '#5352ed', '#7e8ce0', '#70a1ff'],
    Nootropic: ['#1e90ff', '#00d2d3', '#a29bfe', '#e056fd', '#6c5ce7', '#48dbfb', '#55efc4', '#fd79a8'],
    Adaptogen: ['#2ed573', '#badc58', '#7bed9f', '#a3cb38', '#55efc4', '#26de81', '#009432', '#20bf6b'],
    'Psychedelic/Atypical': ['#9b59b6', '#e056fd', '#fd79a8', '#be2edd', '#d980fa', '#6c5ce7', '#a55eea', '#f8a5c2'],
    'Mineral/Electrolyte': ['#ffa502', '#ff793f', '#f6e58d', '#fab1a0', '#f0932b', '#ffda79', '#cc8e35', '#ffbe76'],
    'Vitamin/Amino': ['#eccc68', '#e77f67', '#f6e58d', '#f8c291', '#badc58', '#fdcb6e', '#f9ca24', '#ffeaa7'],
    'Psychiatric/Other': ['#747d8c', '#778beb', '#cf6a87', '#a4b0be', '#70a1ff', '#95afc0', '#636e72', '#57606f'],
    unknown: ['#94a3b8', '#778ca3', '#a4b0be', '#70a1ff', '#636e72', '#b2bec3', '#95afc0', '#c8d6e5'],
};

/** Pick a color for a known DB substance by its index within the class.
 *  Index 0 gets the curated hero color; 1–7 pick from the palette;
 *  overflow indices wrap with alternating lightness shifts. */
export function substanceColorFromIndex(className: string, index: number): string {
    const palette = CLASS_PALETTE[className] || CLASS_PALETTE['unknown'];
    if (index < palette.length) return palette[index];
    // Overflow: wrap around palette, alternate darken/lighten to stay distinct
    const base = palette[index % palette.length];
    const round = Math.floor(index / palette.length);
    const bump = (round % 2 === 0 ? -12 : 12) * round;
    return adjustHexLightness(base, bump);
}

/** Deterministic color for a dynamic substance (not in DB) via name hash. */
export function substanceColorFromHash(className: string, key: string): string {
    const palette = CLASS_PALETTE[className] || CLASS_PALETTE['unknown'];
    let hash = 5381;
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
    return palette[(hash % (palette.length - 1)) + 1]; // skip hero, pick from 1…N-1
}

/** Shift a hex color's lightness by `amount` percentage points (can be negative). */
function adjustHexLightness(hex: string, amount: number): string {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    let h = 0,
        s = 0,
        l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    l = Math.max(0.25, Math.min(0.82, l + amount / 100)); // clamp: visible on dark bg, never washed out
    return `hsl(${(h * 360).toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%)`;
}

export const EFFECT_TYPES: any = {
    'Focus & Cognition': { classes: ['Stimulant', 'Nootropic'], color: '#60a5fa', glow: 'rgba(96,165,250,0.3)' },
    'Stress Resilience': { classes: ['Adaptogen'], color: '#c084fc', glow: 'rgba(192,132,252,0.3)' },
    'Baseline Support': {
        classes: ['Mineral/Electrolyte', 'Vitamin/Amino'],
        color: '#4ade80',
        glow: 'rgba(74,222,128,0.3)',
    },
    Sedation: { classes: ['Depressant/Sleep'], color: '#2dd4bf', glow: 'rgba(45,212,191,0.3)' },
    'Rx Effect': { classes: ['Psychiatric/Other'], color: '#fb7185', glow: 'rgba(251,113,133,0.3)' },
    'Altered State': { classes: ['Psychedelic/Atypical'], color: '#fbbf24', glow: 'rgba(251,191,36,0.3)' },
};

export const TIMING_HOURS: any = { morning: 8, midday: 12, evening: 17, bedtime: 21 };

// ============================================
// FAST / MAIN MODEL CONFIGURATION
// ============================================

export const FAST_MODELS: any = {
    anthropic: { model: 'claude-haiku-4-5-20251001', type: 'anthropic' },
    openai: { model: 'gpt-5.3-chat-latest', type: 'openai' },
    grok: { model: 'grok-4-1-fast-non-reasoning', type: 'openai' }, // xAI uses OpenAI-compatible API
    gemini: { model: 'gemini-2.5-flash-lite', type: 'gemini' },
};

export const MAIN_MODELS: any = {
    anthropic: 'claude-opus-4-6',
    openai: 'gpt-5.4',
    grok: 'grok-4-0709',
    gemini: 'gemini-3.1-pro-preview',
};

export const MODEL_OPTIONS: any = {
    anthropic: [
        {
            key: 'haiku',
            model: 'claude-haiku-4-5-20251001',
            label: 'Haiku 4.5',
            type: 'anthropic',
            tier: 0,
            maxOutput: 8192,
        },
        { key: 'sonnet', model: 'claude-sonnet-4-6', label: 'Sonnet 4.6', type: 'anthropic', tier: 1 },
        { key: 'opus', model: 'claude-opus-4-6', label: 'Opus 4.6', type: 'anthropic', tier: 2 },
    ],
    openai: [
        {
            key: '5.3-instant',
            model: 'gpt-5.3-chat-latest',
            label: '5.3 Instant',
            type: 'openai',
            tier: 0,
            maxOutput: 8192,
        },
        { key: '5.4', model: 'gpt-5.4', label: '5.4', type: 'openai', tier: 1 },
        {
            key: '5.4-thinking',
            model: 'gpt-5.4',
            label: '5.4 Thinking',
            type: 'openai',
            tier: 2,
            reasoningEffort: 'high',
        },
    ],
    grok: [
        {
            key: 'fast',
            model: 'grok-4-1-fast-non-reasoning',
            label: '4.1 Fast',
            type: 'openai',
            tier: 0,
            maxOutput: 8192,
        },
        { key: 'full', model: 'grok-4-0709', label: '4', type: 'openai', tier: 2 },
    ],
    gemini: [
        {
            key: 'flash-lite',
            model: 'gemini-2.5-flash-lite',
            label: '2.5 Flash Lite',
            type: 'gemini',
            tier: 0,
            maxOutput: 8192,
        },
        {
            key: 'flash-lite-preview',
            model: 'gemini-3.1-flash-lite-preview',
            label: '3.1 Flash Lite Preview',
            type: 'gemini',
            tier: 0,
        },
        { key: 'flash-preview', model: 'gemini-3-flash-preview', label: '3 Flash Preview', type: 'gemini', tier: 1 },
        { key: 'pro-preview', model: 'gemini-3.1-pro-preview', label: '3.1 Pro Preview', type: 'gemini', tier: 2 },
    ],
};

export const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Claude',
    openai: 'ChatGPT',
    grok: 'Grok',
    gemini: 'Gemini',
};

export const PROVIDER_IDS = ['gemini', 'anthropic', 'openai', 'grok'];

/**
 * Map a model key from one provider to the closest tier equivalent in another.
 */
export function mapModelAcrossProviders(fromProvider: string, fromKey: string, toProvider: string): string {
    const fromOpts = MODEL_OPTIONS[fromProvider] || [];
    const toOpts = MODEL_OPTIONS[toProvider] || [];
    if (toOpts.length === 0) return '';
    const fromEntry = fromOpts.find((o: any) => o.key === fromKey);
    if (!fromEntry) return toOpts[0]?.key || '';

    const fromTier = fromEntry.tier;
    let best = toOpts[0];
    let bestDist = Math.abs(best.tier - fromTier);
    for (const opt of toOpts) {
        const dist = Math.abs(opt.tier - fromTier);
        if (dist < bestDist || (dist === bestDist && opt.tier < best.tier)) {
            best = opt;
            bestDist = dist;
        }
    }
    return best.key;
}

export const API_ENDPOINTS: any = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openai: 'https://api.openai.com/v1/chat/completions',
    grok: 'https://api.x.ai/v1/chat/completions',
};

// ============================================
// PHASE CHART CONFIGURATION
// ============================================

export const PHASE_CHART: any = {
    viewW: 1120,
    viewH: 500,
    padL: 150,
    padR: 150,
    padT: 50,
    padB: 50,
    startHour: 6,
    endHour: 30, // 6:00am to 6:00am next day (30 = 24+6)
    maxEffect: 100,
    sampleInterval: 15,
};

PHASE_CHART.plotW = PHASE_CHART.viewW - PHASE_CHART.padL - PHASE_CHART.padR;
PHASE_CHART.plotH = PHASE_CHART.viewH - PHASE_CHART.padT - PHASE_CHART.padB;
PHASE_CHART.startMin = PHASE_CHART.startHour * 60;
PHASE_CHART.endMin = PHASE_CHART.endHour * 60;
PHASE_CHART.totalMin = PHASE_CHART.endMin - PHASE_CHART.startMin;

/**
 * Extended chart config — maps day-indexed data onto the same SVG dimensions as the daily chart.
 * All N days fit within the existing plotW (~820px). No scrolling.
 */
export function getExtendedChartConfig(durationDays: number) {
    return {
        startUnit: 1,
        endUnit: durationDays,
        unit: 'day' as const,
        viewW: PHASE_CHART.viewW as number,
        plotW: PHASE_CHART.plotW as number,
        plotH: PHASE_CHART.plotH as number,
        padL: PHASE_CHART.padL as number,
        padR: PHASE_CHART.padR as number,
        padT: PHASE_CHART.padT as number,
        padB: PHASE_CHART.padB as number,
        maxEffect: PHASE_CHART.maxEffect as number,
    };
}

export const PHASE_STEPS = ['baseline-shown', 'curves-drawn', 'lx-rendered', 'biometric-rendered', 'revision-rendered'];

export const PHASE_SMOOTH_PASSES = 3;

/**
 * Gap-adaptive Lx coverage fraction.
 * @deprecated Used only by the legacy global-scale-factor path (when fixedScaleFactors
 * are explicitly provided). The primary normalized path computes overlay as
 * normalizedPharmaShape × impactVector × localGap — no global scaling needed.
 */
export const LX_GAP_COVERAGE = 0.95;

// ── Substance density / pruning thresholds ──────────────────────────────────

/** Plateau duration threshold (minutes) — substances with plateau >= this are "background" */
export const BACKGROUND_DURATION_THRESHOLD = 480;

/** Max tactical (non-background) substances in any temporal cluster */
export const CONCURRENT_SUBSTANCE_MAX = 5;

/** Substance exceeding cluster cap is kept if it contributes >= this % within the cluster */
export const CONCURRENT_KEEP_THRESHOLD = 5;

/** Max total substances (background + tactical) across the entire day */
export const DAILY_SUBSTANCE_MAX = 15;

/** Never prune below this count */
export const SUBSTANCE_MIN = 2;

export const DESCRIPTOR_LEVELS = [0, 11, 22, 33, 44, 56, 67, 78, 89, 100];

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
    separatorY: 454, // thin line just below plot area
    top: 457, // first track starts here
    laneH: 20,
    laneGap: 1,
    pillRx: 3,
    minBarW: 40,
    doseBaseW: 70, // pill width at doseMultiplier = 1.0
    doseMaxW: 200, // max pill width (high multipliers)
    bottomPad: 6,
};

// ============================================
// LEGACY EFFECT CHART CONFIGURATION
// ============================================

export const CHART: any = {
    viewW: 520,
    viewH: 360,
    padL: 50,
    padR: 20,
    padT: 30,
    padB: 40,
    startHour: 6,
    endHour: 24, // 06:00 – 24:00
    maxEffect: 100,
    baselineLevel: 15,
    sampleInterval: 10, // minutes between curve sample points
};

CHART.plotW = CHART.viewW - CHART.padL - CHART.padR;
CHART.plotH = CHART.viewH - CHART.padT - CHART.padB;
CHART.startMin = CHART.startHour * 60;
CHART.endMin = CHART.endHour * 60;
CHART.totalMin = CHART.endMin - CHART.startMin;

export const COMPILE_ZONE = {
    ringRadius: 120, // cartridge ring radius (slot centers sit here)
    hubRadius: 30, // central hub radius
    slotW: 28, // pill slot width
    slotH: 12, // pill slot height
    slotRx: 4, // slot corner radius
    spokeWidth: 0.5, // spoke line width
    deviceW: 320, // device body width
    deviceH: 400, // device body height
    deviceRx: 24, // device body corner radius
    heroScale: 1.2, // final centered scale
};

export const BIOMETRIC_ZONE = {
    separatorPad: 8,
    laneH: 16,
    laneGap: 1,
    labelWidth: 58,
    bottomPad: 24,
};

export const SPOTTER_MARKER = {
    hairlineDash: '2 3', // dashed vertical hairline pattern
    hairlineOpacity: 0.25, // default hairline opacity
    hairlineHoverOpacity: 0.55, // hairline opacity on hover
    anchorR: 2.5, // dot radius on waveform
    anchorGlowR: 6, // glow ring radius around dot
    flagH: 11, // flag label pill height
    flagRx: 3, // flag label corner radius
    flagPadX: 4, // flag label horizontal padding
    flagIconSize: 8, // emoji icon font size in flag
    flagLabelSize: 7, // label font size in flag
    flagLabelMaxChars: 12, // max chars before truncation
    flagGap: 3, // min gap between flag labels
    hitAreaW: 22, // invisible hover hit area width
    zoomFactor: 3, // horizontal zoom multiplier on strip hover
    infoPillH: 14, // compact info pill height above strip
    infoPillRx: 4, // info pill corner radius
    infoPillPadX: 5, // info pill horizontal padding
    infoPillGap: 3, // gap between strip top and info pill
};

export const TELEPORT = {
    thresholdMin: 240, // 4 hours — minimum time-shift to trigger portal instead of smooth glide
    thresholdLanes: 2, // minimum lane distance (≥2 = more than 1 lane) to trigger vertical portal
    driftFraction: 0.12, // how far the pill drifts before vanishing / after spawning (0-1)
};

// ── Badge Categories ────────────────────────────────────────────────
// Single source of truth: used in Scout prompt (LLM picks one) and badge renderer.
export const BADGE_CATEGORIES = [
    'NEURO',
    'SLEEP',
    'METABOLIC',
    'CARDIO',
    'MOOD',
    'HORMONAL',
    'RECOVERY',
    'IMMUNE',
    'PAIN',
    'PERFORMANCE',
    'LONGEVITY',
    'GUT',
    'BEAUTY',
    'ADDICTION',
] as const;

export type BadgeCategory = (typeof BADGE_CATEGORIES)[number];

export const BADGE_CATEGORY_CSS: Record<BadgeCategory, string> = {
    NEURO: 'badge-neuro',
    SLEEP: 'badge-sleep',
    METABOLIC: 'badge-metabolic',
    CARDIO: 'badge-cardio',
    MOOD: 'badge-mood',
    HORMONAL: 'badge-hormonal',
    RECOVERY: 'badge-recovery',
    IMMUNE: 'badge-immune',
    PAIN: 'badge-pain',
    PERFORMANCE: 'badge-performance',
    LONGEVITY: 'badge-longevity',
    GUT: 'badge-gut',
    BEAUTY: 'badge-beauty',
    ADDICTION: 'badge-addiction',
};

// ── My Stream (28-cartridge waveform strip) ──────────────────────
export const MY_STREAM = {
    days: 28, // total cartridges in the strip
    spokeCount: 26, // radial spokes per cartridge (25 substance + 1 empty)
    substanceSlots: 25, // usable slots (spokeCount - 1)
    emptySpokeDeg: 207.7, // angle of the mechanical empty spoke (~15th spoke from 12 o'clock)
    spokeDeg: 360 / 26, // 13.846° per spoke
    cartridgeDiameter: 36, // px — icon diameter (R = 18)
    spokeInnerR: 7.7, // px — spoke starts here (hub boundary, 43% of R — matches 3D carousel)
    hubDotR: 2, // px — central hub dot radius
    gapY: 1.5, // px — vertical gap between top and bottom halves
    fillOpacity: 0.7, // substance fill opacity
    fillDelay: 30, // ms — stagger between slot fills
    spokeStroke: 'rgba(255,255,255,0.18)',
    hubColor: '#10b981',
    emptySlotStroke: 'rgba(255,255,255,0.10)',
    // S-wave: step = 2*R (diameter), top halves offset right by R
    // (derived at runtime from cartridgeDiameter, no extra constants needed)

    // Capsule vs tablet
    capsuleThresholdMg: 300, // dose > this = capsule (full spoke)
    tabletsPerSpoke: 5, // max tablets sharing one spoke
    capsuleW: 4, // px — capsule oval width (tangential)
    capsuleH: 1.8, // px — capsule oval height (radial)
    tabletR: 1.2, // px — tablet dot radius
    slotRadius: 2.5, // px — empty slot circle radius (structural outline)
    tabletHalfSpan: 5, // degrees — half the angular width of a tablet wedge (~70% of half-spoke-width)
};

export const COMPOSITE_SLEEP = {
    laneH: 24,
    subChannels: [
        { key: 'sleep_deep', label: 'Deep', color: '#4a5fc1' }, // indigo
        { key: 'sleep_rem', label: 'REM', color: '#8b5cf6' }, // violet
        { key: 'sleep_light', label: 'Light', color: '#f9a8d4' }, // rose
    ],
};
