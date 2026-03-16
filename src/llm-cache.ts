/**
 * LLM Cache — Single coherent session cache for one full pipeline flow.
 * The app either replays one complete cached session or runs fully live.
 */

import { settingsStore } from './settings-store';

const SESSION_CACHE_KEY = 'cortex_session_cache_bundle';
const SESSION_CACHE_ENABLED_KEY = 'cortex_session_cache_enabled';
const CACHE_SCHEMA = 2;

export interface CacheMeta {
    stageClass: string;
    cacheKey: string;
    cachedAt: string;
    systemPrompt?: string;
    userPrompt?: string;
    requestBody?: any;
}

export interface CacheEntryEnvelope {
    payload: any;
    meta: CacheMeta;
}

export interface SessionCacheBundle {
    __cortexCache: number;
    runId: string;
    createdAt: string;
    completedAt: string;
    stages: Record<string, CacheEntryEnvelope>;
}

function buildMeta(stageClass: string, meta?: Partial<CacheMeta>): CacheMeta {
    return {
        stageClass,
        cacheKey: `session:${stageClass}`,
        cachedAt: new Date().toISOString(),
        ...(meta || {}),
    };
}

function isSessionCacheBundle(value: any): value is SessionCacheBundle {
    return (
        !!value &&
        typeof value === 'object' &&
        value.__cortexCache === CACHE_SCHEMA &&
        typeof value.runId === 'string' &&
        typeof value.createdAt === 'string' &&
        typeof value.completedAt === 'string' &&
        !!value.stages &&
        typeof value.stages === 'object'
    );
}

function readBundle(): SessionCacheBundle | null {
    const parsed = settingsStore.getJson<any>(SESSION_CACHE_KEY, null);
    return isSessionCacheBundle(parsed) ? parsed : null;
}

function writeBundle(bundle: SessionCacheBundle | null): boolean {
    if (!bundle) {
        settingsStore.remove(SESSION_CACHE_KEY);
        return true;
    }
    return settingsStore.setJson(SESSION_CACHE_KEY, bundle);
}

function readEnabled(): boolean {
    return settingsStore.getBoolean(SESSION_CACHE_ENABLED_KEY, false);
}

function writeEnabled(enabled: boolean): void {
    settingsStore.setString(SESSION_CACHE_ENABLED_KEY, String(enabled));
}

function emitCacheStateChanged() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('cortex-session-cache-changed'));
}

const initialBundle = readBundle();
const persistedEnabled = readEnabled();
const initialEnabled = persistedEnabled && !!initialBundle;

if (persistedEnabled && !initialBundle) {
    writeEnabled(false);
}

export const LLMCache = {
    _enabled: initialEnabled,
    _bundle: initialBundle as SessionCacheBundle | null,
    _draftRunId: '',
    _draftCreatedAt: '',
    _draftStages: {} as Record<string, CacheEntryEnvelope>,

    subscribe(listener: () => void) {
        if (typeof window === 'undefined') return () => {};
        const wrapped = () => listener();
        window.addEventListener('cortex-session-cache-changed', wrapped);
        return () => window.removeEventListener('cortex-session-cache-changed', wrapped);
    },

    _emit() {
        emitCacheStateChanged();
    },

    _ensureDraftRun() {
        if (this._draftRunId) return;
        this._draftRunId = `run-${Date.now()}`;
        this._draftCreatedAt = new Date().toISOString();
        this._draftStages = {};
    },

    _persistEnabled() {
        writeEnabled(this._enabled);
    },

    _persistBundle() {
        const wrote = writeBundle(this._bundle);
        if (wrote) return;
        console.warn('[LLMCache] Storage full, clearing previous session cache');
        this.clearAll();
    },

    getState() {
        return {
            enabled: this._enabled && !!this._bundle,
            ready: !!this._bundle,
            runId: this._bundle?.runId || null,
            completedAt: this._bundle?.completedAt || null,
        };
    },

    isEnabled(_stageClass?: string): boolean {
        return this._enabled && !!this._bundle;
    },

    toggle(_stageClass?: string): boolean {
        if (this.isEnabled()) {
            this.disable();
        } else {
            this.enable();
        }
        return this.isEnabled();
    },

    enable(_stageClass?: string): void {
        if (!this._bundle) return;
        this._enabled = true;
        this._persistEnabled();
        this._emit();
    },

    disable(_stageClass?: string): void {
        this._enabled = false;
        this._persistEnabled();
        this._emit();
    },

    hasCompleteFlow(): boolean {
        return !!this._bundle;
    },

    hasData(stageClass: string): boolean {
        return !!this._bundle?.stages?.[stageClass];
    },

    get(stageClass: string): any | null {
        const wrapped = this.getWithMeta(stageClass);
        return wrapped.payload;
    },

    getWithMeta(stageClass: string): { payload: any | null; meta: CacheMeta | null } {
        const entry = this._bundle?.stages?.[stageClass] || null;
        if (!entry) return { payload: null, meta: null };
        return {
            payload: entry.payload,
            meta: entry.meta,
        };
    },

    startLiveFlow(): void {
        if (this._enabled && this._bundle) return;
        this._enabled = false;
        this._persistEnabled();
        this._bundle = null;
        writeBundle(null);
        this._draftRunId = `run-${Date.now()}`;
        this._draftCreatedAt = new Date().toISOString();
        this._draftStages = {};
        this._emit();
    },

    set(stageClass: string, data: any, meta?: Partial<CacheMeta>): void {
        if (this._enabled && this._bundle) return;
        const entry = {
            payload: data,
            meta: buildMeta(stageClass, meta),
        };
        if (this._bundle) {
            this._bundle = {
                ...this._bundle,
                completedAt: new Date().toISOString(),
                stages: {
                    ...this._bundle.stages,
                    [stageClass]: entry,
                },
            };
            this._persistBundle();
            this._emit();
            return;
        }
        this._ensureDraftRun();
        this._draftStages[stageClass] = entry;
    },

    markFlowComplete(): void {
        if (this._enabled && this._bundle) return;
        const stageEntries = Object.entries(this._draftStages);
        if (stageEntries.length === 0) return;

        this._bundle = {
            __cortexCache: CACHE_SCHEMA,
            runId: this._draftRunId || `run-${Date.now()}`,
            createdAt: this._draftCreatedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            stages: { ...this._draftStages },
        };
        this._persistBundle();
        this._draftRunId = '';
        this._draftCreatedAt = '';
        this._draftStages = {};
        this._emit();
    },

    clear(stageClass: string): void {
        if (this._bundle || this._draftStages[stageClass]) {
            this.clearAll();
        }
    },

    clearAll(): void {
        this._enabled = false;
        this._persistEnabled();
        this._bundle = null;
        writeBundle(null);
        this._draftRunId = '';
        this._draftCreatedAt = '';
        this._draftStages = {};
        this._emit();
    },

    enableAllWithData(): void {
        this.enable();
    },

    loadBundle(bundle: SessionCacheBundle): void {
        this._bundle = bundle;
        this._enabled = true;
        this._persistBundle();
        this._persistEnabled();
        this._draftRunId = '';
        this._draftCreatedAt = '';
        this._draftStages = {};
        this._emit();
    },

    breakFromCache(): Record<string, CacheEntryEnvelope> {
        const stages = this._bundle?.stages ? { ...this._bundle.stages } : {};
        this._enabled = false;
        this._bundle = null;
        this._persistEnabled();
        writeBundle(null);
        this._emit();
        return stages;
    },
};
