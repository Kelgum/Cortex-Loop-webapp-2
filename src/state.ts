import { MODEL_OPTIONS } from './constants';

declare const window: any;

const CONFIG_KEYS = (window.CORTEX_CONFIG && window.CORTEX_CONFIG.keys) || {};

const STAGE_DEFAULTS: any = {
    fast: 'haiku', curves: 'opus', intervention: 'opus',
    biometric: 'haiku', revision: 'haiku',
};

const LEGACY_MAP: any = { fast: 0, main: -1 };

function resolveStoredStageModel(stage: string) {
    const stored = localStorage.getItem(`cortex_stage_${stage}`);
    if (!stored) return STAGE_DEFAULTS[stage];
    if (stored in LEGACY_MAP) {
        const provider = localStorage.getItem('cortex_llm') || 'anthropic';
        const opts = MODEL_OPTIONS[provider] || [];
        const idx = LEGACY_MAP[stored] === -1 ? opts.length - 1 : LEGACY_MAP[stored];
        return opts[idx]?.key || STAGE_DEFAULTS[stage];
    }
    return stored;
}

export const AppState: any = {
    currentStack: null,
    isLoading: false,
    isAnimating: false,
    capsuleElements: { front: [], back: [] },
    filledSlots: new Map(),
    tooltip: null,
    effectCurves: null,
    includeRx: false,
    includeControlled: false,
    maxEffects: parseInt(localStorage.getItem('cortex_max_effects') as any) || 2,
    selectedLLM: localStorage.getItem('cortex_llm') || 'anthropic',
    apiKeys: {
        anthropic: localStorage.getItem('cortex_key_anthropic') || CONFIG_KEYS.anthropic || '',
        openai:    localStorage.getItem('cortex_key_openai')    || CONFIG_KEYS.openai || '',
        grok:      localStorage.getItem('cortex_key_grok')      || CONFIG_KEYS.grok || '',
        gemini:    localStorage.getItem('cortex_key_gemini')     || CONFIG_KEYS.gemini || '',
    },
    stageModels: {
        fast:         resolveStoredStageModel('fast'),
        curves:       resolveStoredStageModel('curves'),
        intervention: resolveStoredStageModel('intervention'),
        biometric:    resolveStoredStageModel('biometric'),
        revision:     resolveStoredStageModel('revision'),
    },
};

/**
 * Resolve the actual model name + API type for a pipeline stage.
 * Looks up the model key in MODEL_OPTIONS for the current provider.
 */
export function getStageModel(stage: any) {
    const provider = AppState.selectedLLM;
    const modelKey = AppState.stageModels[stage] || STAGE_DEFAULTS[stage];
    const opts = MODEL_OPTIONS[provider] || [];
    const entry = opts.find((o: any) => o.key === modelKey) || opts[opts.length - 1] || { model: 'unknown', type: 'openai' };
    return { model: entry.model, type: entry.type, provider, key: AppState.apiKeys[provider] };
}

// Phase chart flow state
export const PhaseState: any = {
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

// Biometric Loop state
export const BiometricState: any = {
    selectedDevices: [],
    profileText: '',
    biometricResult: null,
    channels: [],
    phase: 'idle',  // idle | selecting | profiling | loading | rendered
};

// Revision state (Phase 4 — chess player re-evaluates after biometric data)
export const RevisionState: any = {
    revisionPromise: null,
    revisionResult: null,
    oldInterventions: null,
    newInterventions: null,
    diff: null,
    newLxCurves: null,
    phase: 'idle',  // idle | pending | ready | animating | rendered
};

// Effect divider state (split-screen for 2-effect mode)
export const DividerState: any = {
    active: false,
    x: 480,             // SVG x-coord, default = center (maps to ~6pm)
    fadeWidth: 50,       // crossfade zone width in SVG pixels
    minOpacity: 0.12,    // ghost opacity on the "wrong" side
    elements: null,      // { group, line, glow, diamond, hitArea }
    masks: null,         // { leftGrad, rightGrad }
    dragging: false,
    dragCleanup: null,
};
