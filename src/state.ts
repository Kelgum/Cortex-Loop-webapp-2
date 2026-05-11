/**
 * State — Global mutable state objects for every major subsystem.
 * Exports: AppState, PhaseState, BiometricState, SimulationState, RevisionState, CompileState, TimelineState, SherlockState, DividerState, getStageModel, syncStageModelsForProvider
 * Depends on: constants (MODEL_OPTIONS), types
 */
import { MODEL_OPTIONS, mapModelAcrossProviders, defaultEffortForModel, effortOptionsForModel } from './constants';
import {
    legacyProviderApiKeyKey,
    providerApiKeyKey,
    settingsStore,
    stageEffortKey,
    stageFastModeKey,
    stageModelKey,
    stageProviderKey,
    STORAGE_KEYS,
} from './settings-store';
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

const CONFIG_KEYS =
    (typeof window !== 'undefined'
        ? (window as any).LX_STUDIO_CONFIG?.keys || (window as any).CORTEX_CONFIG?.keys
        : null) || {};

function getConfiguredProviderKey(provider: string): string {
    return (
        settingsStore.getString(providerApiKeyKey(provider)) ||
        settingsStore.getString(legacyProviderApiKeyKey(provider)) ||
        CONFIG_KEYS[provider] ||
        ''
    );
}

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
    'curvesExtended',
    'interventionExtended',
    'sherlockExtended',
    'socrx',
];

// Stage → tier classification (used to assign default models per provider).
//   0 = fast (extraction, short narration)
//   1 = mid  (some reasoning, smaller JSON)
//   2 = main (large JSON, full reasoning)
const STAGE_TIER: Record<string, 0 | 1 | 2> = {
    fast: 0,
    agentMatch: 0,
    biometricRec: 0,
    biometricProfile: 0,
    biometricChannel: 0,
    biometric: 0,
    sherlock: 0,
    sherlockRevision: 0,
    sherlock7d: 0,
    socrx: 0,
    spotterDaily: 0,
    strategistBio: 1,
    strategistBioDaily: 1,
    sherlockExtended: 1,
    curves: 2,
    intervention: 2,
    revision: 2,
    knight: 2,
    grandmasterDaily: 2,
    curvesExtended: 2,
    interventionExtended: 2,
};

// Per-provider model key per tier slot. Mid-tier defaults are the new addition.
const TIER_DEFAULT_KEYS: Record<string, Record<0 | 1 | 2, string>> = {
    anthropic: { 0: 'haiku', 1: 'sonnet', 2: 'opus47' },
    openai: { 0: '5.5-instant', 1: '5.4-mini', 2: '5.5' },
    grok: { 0: 'fast', 1: '4-20', 2: '4-3' },
    gemini: { 0: 'flash-lite-preview', 1: 'flash-25', 2: 'flash-preview' },
};

function buildStageDefaults(provider: string): Record<string, string> {
    const tierMap = TIER_DEFAULT_KEYS[provider];
    if (!tierMap) return {};
    const result: Record<string, string> = {};
    for (const stage of STAGE_IDS) {
        const tier = STAGE_TIER[stage] ?? 0;
        result[stage] = tierMap[tier];
    }
    return result;
}

const STAGE_DEFAULTS_BY_PROVIDER: any = {
    anthropic: buildStageDefaults('anthropic'),
    openai: buildStageDefaults('openai'),
    grok: buildStageDefaults('grok'),
    gemini: buildStageDefaults('gemini'),
};

const LEGACY_MAP: any = { fast: 0, main: -1 };

// Map of retired model keys → current replacement (per provider). Lets us migrate
// presets stored before the May 2026 model refresh without forcing the user to
// reconfigure each stage manually.
const LEGACY_MODEL_KEY_MAP: Record<string, Record<string, string>> = {
    openai: {
        '5.3-instant': '5.5-instant',
        '5.4-thinking': '5.5',
    },
    gemini: {
        // 'flash-lite-preview' and 'flash-preview' are still valid keys but the
        // underlying model id changed; mapping handled by entry definition.
    },
    grok: {
        'fast-non-reasoning': 'fast',
    },
    anthropic: {
        sonnet45: 'sonnet',
        opus46: 'opus',
    },
};

const INITIAL_PROVIDER = settingsStore.getString(STORAGE_KEYS.selectedLlm) || 'anthropic';

function getProviderDefaults(provider: string) {
    return STAGE_DEFAULTS_BY_PROVIDER[provider] || STAGE_DEFAULTS_BY_PROVIDER.anthropic;
}

function getDefaultStageModelKey(stage: string, provider: string) {
    const defaults = getProviderDefaults(provider);
    const opts = MODEL_OPTIONS[provider] || [];
    return defaults[stage] || opts[0]?.key || '';
}

function getModelEntry(provider: string, modelKey: string): any | null {
    const opts = MODEL_OPTIONS[provider] || [];
    return opts.find((o: any) => o.key === modelKey) || null;
}

function getDefaultStageEffort(stage: string, provider: string): string {
    const modelKey = getDefaultStageModelKey(stage, provider);
    const entry = getModelEntry(provider, modelKey);
    return defaultEffortForModel(entry);
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

    const legacyForProvider = LEGACY_MODEL_KEY_MAP[provider] || {};
    if (stored in legacyForProvider) {
        const migrated = legacyForProvider[stored];
        if (opts.some((o: any) => o.key === migrated)) return migrated;
    }

    if (opts.some((o: any) => o.key === stored)) return stored;
    return fallback;
}

function resolveStoredStageEffort(stage: string, provider: string, modelKey: string): string {
    const entry = getModelEntry(provider, modelKey);
    const defaultEffort = defaultEffortForModel(entry);
    if (!entry?.supportsEffort) return '';

    const stored = settingsStore.getString(stageEffortKey(stage));
    if (!stored) return defaultEffort;

    if (entry.adaptiveOnly) return 'adaptive';
    const allowed = effortOptionsForModel(entry);
    return allowed.includes(stored) ? stored : defaultEffort;
}

function resolveStoredStageFastMode(stage: string, provider: string, modelKey: string): boolean {
    const entry = getModelEntry(provider, modelKey);
    if (!entry?.supportsFastMode) return false;
    return settingsStore.getBoolean(stageFastModeKey(stage), false);
}

function refreshStageEffortAndFastMode(stage: string, provider: string, modelKey: string) {
    const entry = getModelEntry(provider, modelKey);
    const effort = entry?.supportsEffort ? defaultEffortForModel(entry) : '';
    AppState.stageEfforts[stage] = effort;
    if (effort) settingsStore.setString(stageEffortKey(stage), effort);
    else settingsStore.remove(stageEffortKey(stage));

    if (!entry?.supportsFastMode) {
        AppState.stageFastMode[stage] = false;
        settingsStore.remove(stageFastModeKey(stage));
    }
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
        refreshStageEffortAndFastMode(stage, provider, resolved);
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
    refreshStageEffortAndFastMode(stage, newProvider, resolved);
}

/**
 * Update the model for a single pipeline stage. Resets effort/fastMode to the
 * new model's defaults (lowest effort, fastMode off).
 */
export function switchStageModel(stage: string, newModelKey: string) {
    const provider = AppState.stageProviders[stage];
    const opts = MODEL_OPTIONS[provider] || [];
    const resolved = opts.some((o: any) => o.key === newModelKey) ? newModelKey : getDefaultStageModelKey(stage, provider);

    AppState.stageModels[stage] = resolved;
    settingsStore.setString(stageModelKey(stage), resolved);
    refreshStageEffortAndFastMode(stage, provider, resolved);
}

/**
 * Update the effort level for a single pipeline stage. Validated against the
 * selected model's allowed effort options.
 */
export function switchStageEffort(stage: string, effort: string) {
    const provider = AppState.stageProviders[stage];
    const modelKey = AppState.stageModels[stage];
    const entry = getModelEntry(provider, modelKey);
    if (!entry?.supportsEffort) return;
    if (entry.adaptiveOnly) {
        AppState.stageEfforts[stage] = 'adaptive';
        settingsStore.setString(stageEffortKey(stage), 'adaptive');
        return;
    }
    const allowed = effortOptionsForModel(entry);
    const next = allowed.includes(effort) ? effort : defaultEffortForModel(entry);
    AppState.stageEfforts[stage] = next;
    settingsStore.setString(stageEffortKey(stage), next);
}

/**
 * Toggle the Fast Mode flag for a single pipeline stage. Silently ignored when
 * the selected model does not support a premium-latency tier.
 */
export function switchStageFastMode(stage: string, enabled: boolean) {
    const provider = AppState.stageProviders[stage];
    const modelKey = AppState.stageModels[stage];
    const entry = getModelEntry(provider, modelKey);
    if (!entry?.supportsFastMode) {
        AppState.stageFastMode[stage] = false;
        settingsStore.remove(stageFastModeKey(stage));
        return;
    }
    AppState.stageFastMode[stage] = enabled;
    if (enabled) settingsStore.setString(stageFastModeKey(stage), 'true');
    else settingsStore.remove(stageFastModeKey(stage));
}

/**
 * Capture a snapshot of the current pipeline model/provider configuration.
 */
export function capturePresetSnapshot(): {
    stageModels: Record<string, string>;
    stageProviders: Record<string, string>;
    stageEfforts: Record<string, string>;
    stageFastMode: Record<string, boolean>;
} {
    return {
        stageModels: { ...AppState.stageModels },
        stageProviders: { ...AppState.stageProviders },
        stageEfforts: { ...AppState.stageEfforts },
        stageFastMode: { ...AppState.stageFastMode },
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
    stageEfforts?: Record<string, string>;
    stageFastMode?: Record<string, boolean>;
}): void {
    for (const stage of STAGE_IDS) {
        const provider = snapshot.stageProviders?.[stage];
        const validProvider = provider && MODEL_OPTIONS[provider] ? provider : AppState.stageProviders[stage];

        const modelKey = snapshot.stageModels?.[stage];
        const opts = MODEL_OPTIONS[validProvider] || [];
        const legacyForProvider = LEGACY_MODEL_KEY_MAP[validProvider] || {};
        const migrated = modelKey && legacyForProvider[modelKey];
        const candidate = migrated || modelKey;
        const validModel =
            candidate && opts.some((o: any) => o.key === candidate)
                ? candidate
                : getDefaultStageModelKey(stage, validProvider);

        AppState.stageProviders[stage] = validProvider;
        AppState.stageModels[stage] = validModel;
        settingsStore.setString(stageProviderKey(stage), validProvider);
        settingsStore.setString(stageModelKey(stage), validModel);

        const entry = getModelEntry(validProvider, validModel);
        const defaultEffort = defaultEffortForModel(entry);
        const requestedEffort = snapshot.stageEfforts?.[stage];
        let effort = defaultEffort;
        if (entry?.supportsEffort && requestedEffort) {
            if (entry.adaptiveOnly) {
                effort = 'adaptive';
            } else {
                const allowed = effortOptionsForModel(entry);
                effort = allowed.includes(requestedEffort) ? requestedEffort : defaultEffort;
            }
        }
        AppState.stageEfforts[stage] = effort;
        if (effort) settingsStore.setString(stageEffortKey(stage), effort);
        else settingsStore.remove(stageEffortKey(stage));

        const fastModeRequested = snapshot.stageFastMode?.[stage] === true;
        const fastMode = entry?.supportsFastMode ? fastModeRequested : false;
        AppState.stageFastMode[stage] = fastMode;
        if (fastMode) settingsStore.setString(stageFastModeKey(stage), 'true');
        else settingsStore.remove(stageFastModeKey(stage));
    }
}

/**
 * Fetch the filesystem-default preset and apply it to AppState + localStorage.
 * Called once at startup so the default survives across sessions/browsers.
 */
export async function loadDefaultPreset(): Promise<void> {
    try {
        const res = await fetch('/__default-preset');
        if (!res.ok) return;
        const snapshot = await res.json();
        if (snapshot?.stageModels && snapshot?.stageProviders) {
            applyPresetSnapshot(snapshot);
        }
    } catch {
        // Dev server not available (e.g. production build) — ignore
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
        anthropic: getConfiguredProviderKey('anthropic'),
        openai: getConfiguredProviderKey('openai'),
        grok: getConfiguredProviderKey('grok'),
        gemini: getConfiguredProviderKey('gemini'),
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
        curvesExtended: resolveStoredStageProvider('curvesExtended'),
        interventionExtended: resolveStoredStageProvider('interventionExtended'),
        sherlockExtended: resolveStoredStageProvider('sherlockExtended'),
        socrx: resolveStoredStageProvider('socrx'),
    },
    stageModels: (() => {
        const out: any = {};
        for (const stage of STAGE_IDS) {
            out[stage] = resolveStoredStageModel(stage, resolveStoredStageProvider(stage));
        }
        return out;
    })(),
    stageEfforts: (() => {
        const out: any = {};
        for (const stage of STAGE_IDS) {
            const provider = resolveStoredStageProvider(stage);
            const modelKey = resolveStoredStageModel(stage, provider);
            out[stage] = resolveStoredStageEffort(stage, provider, modelKey);
        }
        return out;
    })(),
    stageFastMode: (() => {
        const out: any = {};
        for (const stage of STAGE_IDS) {
            const provider = resolveStoredStageProvider(stage);
            const modelKey = resolveStoredStageModel(stage, provider);
            out[stage] = resolveStoredStageFastMode(stage, provider, modelKey);
        }
        return out;
    })(),
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
    const effort = entry?.supportsEffort
        ? AppState.stageEfforts[stage] || defaultEffortForModel(entry)
        : '';
    const fastMode = entry?.supportsFastMode ? !!AppState.stageFastMode[stage] : false;
    return {
        model: entry.model,
        type: entry.type,
        provider,
        key: AppState.apiKeys[provider],
        effort,
        effortFamily: entry?.effortFamily,
        adaptiveOnly: !!entry?.adaptiveOnly,
        fastMode,
        // Back-compat alias for the older OpenAI-only field name; callers that
        // still read `reasoningEffort` get the OpenAI-flavoured value.
        reasoningEffort: entry?.effortFamily === 'openai' ? effort : undefined,
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

    // Cross-provider effort transfer: keep the user's intent (lowest stays lowest)
    // by carrying the same effort *position* across providers when possible.
    let effort = '';
    if (entry?.supportsEffort) {
        if (entry.adaptiveOnly) {
            effort = 'adaptive';
        } else if (provider === currentProvider) {
            effort = AppState.stageEfforts[stage] || defaultEffortForModel(entry);
        } else {
            effort = defaultEffortForModel(entry);
        }
    }
    const fastMode = entry?.supportsFastMode && provider === currentProvider ? !!AppState.stageFastMode[stage] : false;

    return {
        model: entry.model,
        type: entry.type,
        provider,
        key: AppState.apiKeys[provider],
        modelKey: resolvedKey,
        effort,
        effortFamily: entry?.effortFamily,
        adaptiveOnly: !!entry?.adaptiveOnly,
        fastMode,
        reasoningEffort: entry?.effortFamily === 'openai' ? effort : undefined,
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
    timeHorizon: null,
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
    onCompareInterp: null,
};
