/**
 * State — Global mutable state objects for every major subsystem.
 * Exports: AppState, PhaseState, BiometricState, SimulationState, RevisionState, CompileState, TimelineState, SherlockState, DividerState, getStageModel, syncStageModelsForProvider
 * Depends on: constants (MODEL_OPTIONS), types
 */
import { MODEL_OPTIONS, mapModelAcrossProviders } from './constants';
import { providerApiKeyKey, settingsStore, stageModelKey, stageProviderKey, STORAGE_KEYS } from './settings-store';
import type {
    PipelineStage,
    PhaseLabel,
    BiometricPhase,
    RevisionPhase,
    SimulationPhase,
    SherlockPhase,
    ProfileDraftStatus,
    ProfileSource,
    RxMode,
    MultiDayPhase,
    CompilePhase,
    IAppState,
    IPhaseState,
    IBiometricState,
    ISimulationState,
    IRevisionState,
    ITimelineState,
    ISherlockState,
    IDividerState,
    ICompileState,
    IMultiDayState,
    IAgentMatchState,
    AgentMatchPhase,
} from './types';

const CONFIG_KEYS = (typeof window !== 'undefined' ? (window as any).CORTEX_CONFIG?.keys : null) || {};

const STAGE_IDS = [
    'fast',
    'curves',
    'intervention',
    'biometricRec',
    'biometricProfile',
    'biometricChannel',
    'biometric',
    'revision',
    'sherlock',
    'sherlockRevision',
    'strategistBio',
    'knight',
    'spotterDaily',
    'strategistBioDaily',
    'grandmasterDaily',
    'agentMatch',
    'sherlock7d',
];

const STAGE_DEFAULTS_BY_PROVIDER: any = {
    anthropic: {
        fast: 'haiku',
        curves: 'opus',
        intervention: 'opus',
        biometricRec: 'haiku',
        biometricProfile: 'haiku',
        biometricChannel: 'haiku',
        biometric: 'haiku',
        revision: 'opus',
        sherlock: 'haiku',
        sherlockRevision: 'haiku',
        strategistBio: 'haiku',
        knight: 'opus',
        spotterDaily: 'haiku',
        strategistBioDaily: 'haiku',
        grandmasterDaily: 'opus',
        agentMatch: 'haiku',
        sherlock7d: 'haiku',
    },
    openai: {
        fast: '5.3-instant',
        curves: '5.4-thinking',
        intervention: '5.4-thinking',
        biometricRec: '5.3-instant',
        biometricProfile: '5.3-instant',
        biometricChannel: '5.3-instant',
        biometric: '5.3-instant',
        revision: '5.4-thinking',
        sherlock: '5.3-instant',
        sherlockRevision: '5.3-instant',
        strategistBio: '5.3-instant',
        knight: '5.4-thinking',
        spotterDaily: '5.3-instant',
        strategistBioDaily: '5.3-instant',
        grandmasterDaily: '5.4-thinking',
        agentMatch: '5.3-instant',
        sherlock7d: '5.3-instant',
    },
    grok: {
        fast: 'fast',
        curves: 'full',
        intervention: 'full',
        biometricRec: 'fast',
        biometricProfile: 'fast',
        biometricChannel: 'fast',
        biometric: 'fast',
        revision: 'full',
        sherlock: 'fast',
        sherlockRevision: 'fast',
        strategistBio: 'fast',
        knight: 'full',
        spotterDaily: 'fast',
        strategistBioDaily: 'fast',
        grandmasterDaily: 'full',
        agentMatch: 'fast',
        sherlock7d: 'fast',
    },
    gemini: {
        fast: 'flash-lite',
        curves: 'pro-preview',
        intervention: 'pro-preview',
        biometricRec: 'flash-lite',
        biometricProfile: 'flash-lite',
        biometricChannel: 'flash-lite',
        biometric: 'flash-lite',
        revision: 'pro-preview',
        sherlock: 'flash-lite',
        sherlockRevision: 'flash-lite',
        strategistBio: 'flash-lite',
        knight: 'pro-preview',
        spotterDaily: 'flash-lite',
        strategistBioDaily: 'flash-lite',
        grandmasterDaily: 'pro-preview',
        agentMatch: 'flash-lite',
        sherlock7d: 'flash-lite',
    },
};

const LEGACY_MAP: any = { fast: 0, main: -1 };

const INITIAL_PROVIDER = settingsStore.getString(STORAGE_KEYS.selectedLlm) || 'anthropic';

function getProviderDefaults(provider: string) {
    return STAGE_DEFAULTS_BY_PROVIDER[provider] || STAGE_DEFAULTS_BY_PROVIDER.anthropic;
}

function getDefaultStageModelKey(stage: string, provider: string) {
    const defaults = getProviderDefaults(provider);
    const opts = MODEL_OPTIONS[provider] || [];
    return defaults[stage] || opts[0]?.key || '';
}

function resolveStoredStageProvider(stage: string): string {
    const stored = settingsStore.getString(stageProviderKey(stage));
    if (stored && MODEL_OPTIONS[stored]) return stored;
    return INITIAL_PROVIDER;
}

function resolveStoredStageModel(stage: string, provider: string) {
    const opts = MODEL_OPTIONS[provider] || [];
    const fallback = getDefaultStageModelKey(stage, provider);
    const stored = settingsStore.getString(stageModelKey(stage));
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
        settingsStore.setString(stageProviderKey(stage), provider);
        settingsStore.setString(stageModelKey(stage), resolved);
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
    settingsStore.setString(stageProviderKey(stage), newProvider);
    settingsStore.setString(stageModelKey(stage), resolved);
}

/**
 * Capture a snapshot of the current pipeline model/provider configuration.
 */
export function capturePresetSnapshot(): {
    stageModels: Record<string, string>;
    stageProviders: Record<string, string>;
} {
    return {
        stageModels: { ...AppState.stageModels },
        stageProviders: { ...AppState.stageProviders },
    };
}

/**
 * Apply a preset snapshot to AppState and persist to localStorage.
 * Validates providers/models exist; falls back to defaults for invalid entries.
 * Caller is responsible for refreshing UI dropdowns afterward.
 */
export function applyPresetSnapshot(snapshot: {
    stageModels: Record<string, string>;
    stageProviders: Record<string, string>;
}): void {
    for (const stage of STAGE_IDS) {
        const provider = snapshot.stageProviders?.[stage];
        const validProvider = provider && MODEL_OPTIONS[provider] ? provider : AppState.stageProviders[stage];

        const modelKey = snapshot.stageModels?.[stage];
        const opts = MODEL_OPTIONS[validProvider] || [];
        const validModel =
            modelKey && opts.some((o: any) => o.key === modelKey)
                ? modelKey
                : getDefaultStageModelKey(stage, validProvider);

        AppState.stageProviders[stage] = validProvider;
        AppState.stageModels[stage] = validModel;
        settingsStore.setString(stageProviderKey(stage), validProvider);
        settingsStore.setString(stageModelKey(stage), validModel);
    }
}

/**
 * Turbo target phase (0 = disabled, 1-4 = auto-advance to that phase).
 * Stored on AppState but initialized from localStorage here so it's ready
 * before any prompt submission.
 */
const _turboTarget = settingsStore.getNumber(STORAGE_KEYS.startAtPhase, 0);

export const AppState: IAppState = {
    currentStack: null,
    isLoading: false,
    isAnimating: false,
    capsuleElements: { front: [], back: [] },
    filledSlots: new Map(),
    tooltip: null,
    effectCurves: null,
    rxMode: 'off' as RxMode,
    maxEffects: (() => {
        const rawMaxEffects = settingsStore.getNumber(STORAGE_KEYS.maxEffects, 2);
        return rawMaxEffects === 1 ? 1 : 2;
    })(),
    selectedLLM: INITIAL_PROVIDER,
    apiKeys: {
        anthropic: settingsStore.getString(providerApiKeyKey('anthropic')) || CONFIG_KEYS.anthropic || '',
        openai: settingsStore.getString(providerApiKeyKey('openai')) || CONFIG_KEYS.openai || '',
        grok: settingsStore.getString(providerApiKeyKey('grok')) || CONFIG_KEYS.grok || '',
        gemini: settingsStore.getString(providerApiKeyKey('gemini')) || CONFIG_KEYS.gemini || '',
    },
    stageProviders: {
        fast: resolveStoredStageProvider('fast'),
        curves: resolveStoredStageProvider('curves'),
        intervention: resolveStoredStageProvider('intervention'),
        biometricRec: resolveStoredStageProvider('biometricRec'),
        biometricProfile: resolveStoredStageProvider('biometricProfile'),
        biometricChannel: resolveStoredStageProvider('biometricChannel'),
        biometric: resolveStoredStageProvider('biometric'),
        revision: resolveStoredStageProvider('revision'),
        sherlock: resolveStoredStageProvider('sherlock'),
        sherlockRevision: resolveStoredStageProvider('sherlockRevision'),
        strategistBio: resolveStoredStageProvider('strategistBio'),
        knight: resolveStoredStageProvider('knight'),
        spotterDaily: resolveStoredStageProvider('spotterDaily'),
        strategistBioDaily: resolveStoredStageProvider('strategistBioDaily'),
        grandmasterDaily: resolveStoredStageProvider('grandmasterDaily'),
        agentMatch: resolveStoredStageProvider('agentMatch'),
        sherlock7d: resolveStoredStageProvider('sherlock7d'),
    },
    stageModels: {
        fast: resolveStoredStageModel('fast', resolveStoredStageProvider('fast')),
        curves: resolveStoredStageModel('curves', resolveStoredStageProvider('curves')),
        intervention: resolveStoredStageModel('intervention', resolveStoredStageProvider('intervention')),
        biometricRec: resolveStoredStageModel('biometricRec', resolveStoredStageProvider('biometricRec')),
        biometricProfile: resolveStoredStageModel('biometricProfile', resolveStoredStageProvider('biometricProfile')),
        biometricChannel: resolveStoredStageModel('biometricChannel', resolveStoredStageProvider('biometricChannel')),
        biometric: resolveStoredStageModel('biometric', resolveStoredStageProvider('biometric')),
        revision: resolveStoredStageModel('revision', resolveStoredStageProvider('revision')),
        sherlock: resolveStoredStageModel('sherlock', resolveStoredStageProvider('sherlock')),
        sherlockRevision: resolveStoredStageModel('sherlockRevision', resolveStoredStageProvider('sherlockRevision')),
        strategistBio: resolveStoredStageModel('strategistBio', resolveStoredStageProvider('strategistBio')),
        knight: resolveStoredStageModel('knight', resolveStoredStageProvider('knight')),
        spotterDaily: resolveStoredStageModel('spotterDaily', resolveStoredStageProvider('spotterDaily')),
        strategistBioDaily: resolveStoredStageModel(
            'strategistBioDaily',
            resolveStoredStageProvider('strategistBioDaily'),
        ),
        grandmasterDaily: resolveStoredStageModel('grandmasterDaily', resolveStoredStageProvider('grandmasterDaily')),
        agentMatch: resolveStoredStageModel('agentMatch', resolveStoredStageProvider('agentMatch')),
        sherlock7d: resolveStoredStageModel('sherlock7d', resolveStoredStageProvider('sherlock7d')),
    },
    turboTargetPhase: _turboTarget,
};

/** True when turbo-skip is active and hasn't reached target phase yet. */
export function isTurboActive(): boolean {
    return AppState.turboTargetPhase > 0 && PhaseState.maxPhaseReached < AppState.turboTargetPhase;
}

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
    return {
        model: entry.model,
        type: entry.type,
        provider,
        key: AppState.apiKeys[provider],
        reasoningEffort: entry.reasoningEffort,
    };
}

/**
 * Resolve stage model details for a specific provider without mutating
 * stage provider/model preferences in AppState/localStorage.
 */
export function resolveStageModelForProvider(stage: any, providerOverride: string) {
    const provider = MODEL_OPTIONS[providerOverride]
        ? providerOverride
        : AppState.stageProviders[stage] || AppState.selectedLLM;
    const opts = MODEL_OPTIONS[provider] || [];
    const fallbackKey = getDefaultStageModelKey(stage, provider);

    const currentProvider = AppState.stageProviders[stage] || AppState.selectedLLM;
    const currentKey = AppState.stageModels[stage];
    // Only cross-map when the provider actually changed; otherwise honour the
    // user's exact model pick (avoids collapsing same-tier siblings like
    // flash-lite vs flash-lite-preview).
    const preferredKey =
        provider === currentProvider
            ? currentKey
            : mapModelAcrossProviders(currentProvider, currentKey, provider) || currentKey;

    const resolvedKey = opts.some((o: any) => o.key === preferredKey) ? preferredKey : fallbackKey;
    const entry = opts.find((o: any) => o.key === resolvedKey) || opts[0] || { model: 'unknown', type: 'openai' };

    return {
        model: entry.model,
        type: entry.type,
        provider,
        key: AppState.apiKeys[provider],
        modelKey: resolvedKey,
        reasoningEffort: entry.reasoningEffort,
        tier: entry.tier ?? 0,
        maxOutput: entry.maxOutput as number | undefined,
    };
}

// Phase chart flow state
export const PhaseState: IPhaseState = {
    isProcessing: false,
    effects: [],
    wordCloudEffects: [],
    curvesData: null,
    phase: 'idle' as PhaseLabel,
    interventionPromise: null,
    interventionResult: null,
    lxCurves: null,
    incrementalSnapshots: null,
    hookSentence: null,
    maxPhaseReached: -1,
    viewingPhase: -1,
    userGoal: null,
    cycleFilename: null,
    loadedCycleId: null,
    strategistProtectedEffect: '',
    badgeCategory: null,
};

// Biometric Loop state
export const BiometricState: IBiometricState = {
    selectedDevices: [],
    profileText: '',
    profileDraftText: '',
    profileDraftStatus: 'idle' as ProfileDraftStatus,
    profileDraftError: null,
    profileDirty: false,
    profileSource: 'fallback' as ProfileSource,
    profileDraftTensionDirectives: [],
    biometricResult: null,
    channels: [],
    phase: 'idle' as BiometricPhase,
    spotterHighlights: [],
};

// Simulation state (Phase 5 — 24-hour animated simulation)
export const SimulationState: ISimulationState = {
    phase: 'idle' as SimulationPhase,
    progress: 0,
    speed: 1,
    rafId: null,
    schedule: [],
};

// Revision state (Phase 4 -- chess player re-evaluates after biometric data)
export const RevisionState: IRevisionState = {
    revisionPromise: null,
    revisionResult: null,
    oldInterventions: null,
    newInterventions: null,
    diff: null,
    newLxCurves: null,
    referenceBundle: null,
    fitMetricsBefore: null,
    fitMetricsAfter: null,
    phase: 'idle' as RevisionPhase,
};

// Timeline engine state
export const TimelineState: ITimelineState = {
    engine: null,
    ribbon: null,
    pipelineTimeline: null,
    active: false,
    cursor: 0,
    interactionLocked: false,
    onLxStepWait: null,
    onLxStepWaitOwner: null,
    playheadTrackers: {
        prompt: { rafId: null, wallStart: null, timelineStart: null },
        bioScan: { rafId: null, wallStart: null, timelineStart: null },
        bioReveal: { rafId: null, wallStart: null, timelineStart: null },
        bioCorrection: { rafId: null, wallStart: null, timelineStart: null },
    },
    runTasks: null,
};

// Sherlock narration state
export const SherlockState: ISherlockState = {
    enabled: settingsStore.getJson(STORAGE_KEYS.sherlockEnabled, true),
    narrationResult: null,
    revisionNarrationResult: null,
    sherlock7dNarration: null,
    phase: 'idle' as SherlockPhase,
};

// Effect divider state (split-screen for 2-effect mode)
export const DividerState: IDividerState = {
    active: false,
    x: 480,
    fadeWidth: 50,
    minOpacity: 0.12,
    elements: null,
    masks: null,
    dragging: false,
    dragCleanup: null,
    onUpdate: null,
};

// Compile/Stream state (dose.player cartridge assembly)
export const CompileState: ICompileState = {
    phase: 'idle' as CompilePhase,
    countdownTimer: null,
    runId: 0,
    cleanup: null,
};

// Agent match state (creator agent co-pilot selection)
export const AgentMatchState: IAgentMatchState = {
    matchedAgents: [],
    matchResults: [],
    selectedAgent: null,
    phase: 'idle' as AgentMatchPhase,
    categoryTitle: 'Protocol Streamers',
};

// Multi-day iteration state (Days 0-7 weekly cycle)
export const MultiDayState: IMultiDayState = {
    phase: 'idle' as MultiDayPhase,
    days: [],
    currentDay: 0,
    animationRafId: null,
    speed: 2,
    knightOutput: null,
    startWeekday: null,
    bioCorrectedBaseline: null,
    lockedViewBoxHeight: null,
    maxTimelineLanes: 0,
    bioBaseTranslateY: 0,
    sherlock7dReady: false,
    onDayAdvance: null,
    onSherlock7DSync: null,
};
