import { MODEL_OPTIONS, mapModelAcrossProviders } from './constants';

declare const window: any;

const CONFIG_KEYS = (window.CORTEX_CONFIG && window.CORTEX_CONFIG.keys) || {};

const STAGE_IDS = [
    'fast',
    'curves',
    'intervention',
    'biometric',
    'revision',
    'sherlock',
    'sherlockRevision',
];

const STAGE_DEFAULTS_BY_PROVIDER: any = {
    anthropic: {
        fast: 'haiku',
        curves: 'opus',
        intervention: 'opus',
        biometric: 'haiku',
        revision: 'haiku',
        sherlock: 'haiku',
        sherlockRevision: 'haiku',
    },
    openai: {
        fast: 'o4-mini',
        curves: '5.2',
        intervention: '5.2',
        biometric: 'o4-mini',
        revision: 'o4-mini',
        sherlock: 'o4-mini',
        sherlockRevision: 'o4-mini',
    },
    grok: {
        fast: 'fast',
        curves: 'full',
        intervention: 'full',
        biometric: 'fast',
        revision: 'fast',
        sherlock: 'fast',
        sherlockRevision: 'fast',
    },
    gemini: {
        fast: 'flash-lite',
        curves: 'pro',
        intervention: 'pro',
        biometric: 'flash-lite',
        revision: 'flash-lite',
        sherlock: 'flash-lite',
        sherlockRevision: 'flash-lite',
    },
};

const LEGACY_MAP: any = { fast: 0, main: -1 };

const INITIAL_PROVIDER = localStorage.getItem('cortex_llm') || 'anthropic';

function getProviderDefaults(provider: string) {
    return STAGE_DEFAULTS_BY_PROVIDER[provider] || STAGE_DEFAULTS_BY_PROVIDER.anthropic;
}

function getDefaultStageModelKey(stage: string, provider: string) {
    const defaults = getProviderDefaults(provider);
    const opts = MODEL_OPTIONS[provider] || [];
    return defaults[stage] || opts[0]?.key || '';
}

function resolveStoredStageProvider(stage: string): string {
    const stored = localStorage.getItem(`cortex_stage_provider_${stage}`);
    if (stored && MODEL_OPTIONS[stored]) return stored;
    return INITIAL_PROVIDER;
}

function resolveStoredStageModel(stage: string, provider: string) {
    const opts = MODEL_OPTIONS[provider] || [];
    const fallback = getDefaultStageModelKey(stage, provider);
    const stored = localStorage.getItem(`cortex_stage_${stage}`);
    if (!stored) return fallback;

    if (stored in LEGACY_MAP) {
        const idx = LEGACY_MAP[stored] === -1 ? opts.length - 1 : LEGACY_MAP[stored];
        return opts[idx]?.key || fallback;
    }

    if (opts.some((o: any) => o.key === stored)) return stored;
    return fallback;
}

export function syncStageModelsForProvider(provider: string) {
    for (const stage of STAGE_IDS) {
        const oldProvider = AppState.stageProviders[stage];
        const oldKey = AppState.stageModels[stage];
        const newKey = mapModelAcrossProviders(oldProvider, oldKey, provider);
        const resolved = newKey || getDefaultStageModelKey(stage, provider);

        AppState.stageProviders[stage] = provider;
        AppState.stageModels[stage] = resolved;
        localStorage.setItem(`cortex_stage_provider_${stage}`, provider);
        localStorage.setItem(`cortex_stage_${stage}`, resolved);
    }
}

/**
 * Switch provider for a single pipeline stage, mapping the model to the closest tier.
 */
export function switchStageProvider(stage: string, newProvider: string) {
    const oldProvider = AppState.stageProviders[stage];
    const oldKey = AppState.stageModels[stage];
    const newKey = mapModelAcrossProviders(oldProvider, oldKey, newProvider);
    const resolved = newKey || getDefaultStageModelKey(stage, newProvider);

    AppState.stageProviders[stage] = newProvider;
    AppState.stageModels[stage] = resolved;
    localStorage.setItem(`cortex_stage_provider_${stage}`, newProvider);
    localStorage.setItem(`cortex_stage_${stage}`, resolved);
}

export const AppState: any = {
    currentStack: null,
    isLoading: false,
    isAnimating: false,
    capsuleElements: { front: [], back: [] },
    filledSlots: new Map(),
    tooltip: null,
    effectCurves: null,
    rxMode: 'off' as 'off' | 'rx' | 'rx-only',
    maxEffects: parseInt(localStorage.getItem('cortex_max_effects') as any) || 2,
    selectedLLM: INITIAL_PROVIDER,
    apiKeys: {
        anthropic: localStorage.getItem('cortex_key_anthropic') || CONFIG_KEYS.anthropic || '',
        openai:    localStorage.getItem('cortex_key_openai')    || CONFIG_KEYS.openai || '',
        grok:      localStorage.getItem('cortex_key_grok')      || CONFIG_KEYS.grok || '',
        gemini:    localStorage.getItem('cortex_key_gemini')     || CONFIG_KEYS.gemini || '',
    },
    stageProviders: {
        fast:              resolveStoredStageProvider('fast'),
        curves:            resolveStoredStageProvider('curves'),
        intervention:      resolveStoredStageProvider('intervention'),
        biometric:         resolveStoredStageProvider('biometric'),
        revision:          resolveStoredStageProvider('revision'),
        sherlock:          resolveStoredStageProvider('sherlock'),
        sherlockRevision:  resolveStoredStageProvider('sherlockRevision'),
    },
    stageModels: {
        fast:              resolveStoredStageModel('fast', resolveStoredStageProvider('fast')),
        curves:            resolveStoredStageModel('curves', resolveStoredStageProvider('curves')),
        intervention:      resolveStoredStageModel('intervention', resolveStoredStageProvider('intervention')),
        biometric:         resolveStoredStageModel('biometric', resolveStoredStageProvider('biometric')),
        revision:          resolveStoredStageModel('revision', resolveStoredStageProvider('revision')),
        sherlock:          resolveStoredStageModel('sherlock', resolveStoredStageProvider('sherlock')),
        sherlockRevision:  resolveStoredStageModel('sherlockRevision', resolveStoredStageProvider('sherlockRevision')),
    },
};

/**
 * Resolve the actual model name + API type for a pipeline stage.
 * Uses the per-stage provider (not the global provider).
 */
export function getStageModel(stage: any) {
    const provider = AppState.stageProviders[stage] || AppState.selectedLLM;
    const opts = MODEL_OPTIONS[provider] || [];
    const fallbackKey = getDefaultStageModelKey(stage, provider);
    const modelKey = AppState.stageModels[stage];
    const resolvedKey = opts.some((o: any) => o.key === modelKey) ? modelKey : fallbackKey;
    if (resolvedKey && modelKey !== resolvedKey) {
        AppState.stageModels[stage] = resolvedKey;
    }

    const entry = opts.find((o: any) => o.key === resolvedKey) || opts[0] || { model: 'unknown', type: 'openai' };
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

// Timeline engine state
export const TimelineState: any = {
    engine: null,       // TimelineEngine instance
    ribbon: null,       // TimelineRibbon instance
    active: false,      // Whether the timeline system is driving animations
    cursor: 0,          // Current timeline build cursor (ms) for progressive building
    interactionLocked: false, // Prevent seek/play while imperative first-run is still active
};

// Sherlock narration state
export const SherlockState: any = {
    enabled: JSON.parse(localStorage.getItem('cortex_sherlock_enabled') || 'true'),
    narrationResult: null,          // { intro, beats: [{substanceKey, text}], outro }
    revisionNarrationResult: null,  // { intro, beats: [{action, substanceKey, text}], outro }
    phase: 'idle',                  // idle | loading | ready | animating | rendered
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
