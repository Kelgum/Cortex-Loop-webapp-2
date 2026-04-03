/**
 * LLM Failure Log — Persistent structured log for every LLM call attempt (success and failure).
 * Stores in localStorage as a bounded ring buffer. Survives page reloads and sessions.
 * Exports: LLMLog, classifyError, LLMErrorClass, LLMLogEntry, LLMLogSummary
 * Depends on: settings-store (settingsStore, STORAGE_KEYS)
 */
import { settingsStore, STORAGE_KEYS } from './settings-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMErrorClass =
    | 'missing_key'
    | 'timeout'
    | 'rate_limit'
    | 'server_error'
    | 'truncated_json'
    | 'parse_error'
    | 'validation_error'
    | 'network_error'
    | 'auth_error'
    | 'unknown';

export interface LLMLogEntry {
    /** ISO timestamp of the attempt */
    ts: string;
    /** Call ID — correlates attempts within one callStageWithFallback() invocation */
    cid: string;
    /** Pipeline stage class (e.g., 'fast-model', 'intervention-model') */
    stage: string;
    /** Human-readable stage label (e.g., 'Scout', 'Chess Player') */
    label: string;
    /** Provider attempted (e.g., 'gemini', 'anthropic') */
    provider: string;
    /** Model ID used */
    model: string;
    /** Whether this attempt succeeded */
    ok: boolean;
    /** Duration in ms */
    ms: number;
    /** HTTP status code (0 if no HTTP response) */
    http: number;
    /** Error classification (null if ok=true) */
    err: LLMErrorClass | null;
    /** Truncated error message (max 200 chars, null if ok=true) */
    msg: string | null;
    /** Position in fallback sequence (0 = primary) */
    seq: number;
    /** Was this a fallback attempt? */
    fb: boolean;
    /** Did the overall stage call ultimately succeed? */
    resolved: boolean;
    /** Provider that resolved the stage (null if total failure) */
    resolvedBy: string | null;
}

export interface LLMLogSummary {
    totalCalls: number;
    totalSuccess: number;
    totalFailure: number;
    successRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    byProvider: Record<
        string,
        {
            calls: number;
            successes: number;
            failures: number;
            avgMs: number;
            errorBreakdown: Partial<Record<LLMErrorClass, number>>;
        }
    >;
    byStage: Record<
        string,
        {
            label: string;
            calls: number;
            successes: number;
            failures: number;
            fallbackCount: number;
            avgMs: number;
        }
    >;
    byErrorClass: Partial<Record<LLMErrorClass, number>>;
    recentFailures: LLMLogEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 500;
const FLUSH_INTERVAL_MS = 2000;
const MSG_MAX_LEN = 200;
const SCHEMA_VERSION = 1;
const DISK_SYNC_INTERVAL_MS = 5000;

interface LLMLogStore {
    __v: number;
    entries: LLMLogEntry[];
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type ErrorContext = 'missing_key' | 'http' | 'network' | 'parse' | 'validate';

export function classifyError(message: string, httpStatus: number, context: ErrorContext): LLMErrorClass {
    if (context === 'missing_key') return 'missing_key';
    if (context === 'validate') return 'validation_error';
    if (context === 'parse') {
        if (/truncat|unclosed|unbalanced/i.test(message)) return 'truncated_json';
        return 'parse_error';
    }
    if (context === 'network') {
        if (/timeout|timed out|abort/i.test(message)) return 'timeout';
        return 'network_error';
    }
    // HTTP-based classification
    if (httpStatus === 401 || httpStatus === 403) return 'auth_error';
    if (httpStatus === 429) return 'rate_limit';
    if ([500, 502, 503, 504, 529].includes(httpStatus)) return 'server_error';
    if (/rate.?limit|too many/i.test(message)) return 'rate_limit';
    if (/timeout|timed out/i.test(message)) return 'timeout';
    if (/truncat|unclosed|unbalanced/i.test(message)) return 'truncated_json';
    return 'unknown';
}

/** Infer error context from error properties for use with classifyError(). */
export function inferErrorContext(err: any): { httpStatus: number; context: ErrorContext } {
    const status = typeof err?.status === 'number' ? err.status : 0;
    const name = String(err?.name || '');
    const message = String(err?.message || err || '');

    // Validation errors thrown by validateStageResponseShape()
    if (/^Invalid .+ response:/i.test(message)) {
        return { httpStatus: 0, context: 'validate' };
    }
    // Provider returned success but empty/missing content (e.g. OpenAI)
    if (/response missing .* content/i.test(message)) {
        return { httpStatus: status, context: 'validate' };
    }
    if (name === 'TypeError' || name === 'AbortError') {
        return { httpStatus: 0, context: 'network' };
    }
    if (/failed to fetch|network|load failed|econnreset|enotfound/i.test(message)) {
        return { httpStatus: 0, context: 'network' };
    }
    if (/timeout|timed out/i.test(message) && !status) {
        return { httpStatus: 0, context: 'network' };
    }
    if (/truncat|unclosed|unbalanced/i.test(message)) {
        return { httpStatus: status, context: 'parse' };
    }
    if (/invalid json|json parse|unexpected token/i.test(message)) {
        return { httpStatus: status, context: 'parse' };
    }
    // LLM returned text without any JSON structure
    if (/no valid JSON|returned no .*JSON/i.test(message)) {
        return { httpStatus: status, context: 'parse' };
    }
    if (status > 0) {
        return { httpStatus: status, context: 'http' };
    }
    return { httpStatus: 0, context: 'http' };
}

// ---------------------------------------------------------------------------
// Call ID generation
// ---------------------------------------------------------------------------

let _callCounter = 0;

export function generateCallId(): string {
    return `${Date.now().toString(36)}-${(++_callCounter).toString(36)}`;
}

// ---------------------------------------------------------------------------
// LLMLog singleton
// ---------------------------------------------------------------------------

export const LLMLog = {
    _entries: [] as LLMLogEntry[],
    _dirty: false,
    _flushTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    _diskSyncTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    _loaded: false,
    _unloadBound: false,

    /** Load entries from localStorage on first access. */
    _load(): void {
        if (this._loaded) return;
        this._loaded = true;
        const stored = settingsStore.getJson<LLMLogStore>(STORAGE_KEYS.llmLog, { __v: 0, entries: [] });
        if (stored && stored.__v === SCHEMA_VERSION && Array.isArray(stored.entries)) {
            this._entries = stored.entries;
        }
        this._bindUnload();
    },

    /** Bind page-unload handlers so dirty data is never lost. */
    _bindUnload(): void {
        if (this._unloadBound || typeof window === 'undefined') return;
        this._unloadBound = true;
        const flushNow = () => this.flush();
        window.addEventListener('beforeunload', flushNow);
        window.addEventListener('pagehide', flushNow);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushNow();
        });
        // Vite HMR: flush before module is disposed
        if ((import.meta as any).hot) {
            (import.meta as any).hot.dispose(flushNow);
        }
    },

    /** Schedule a batched flush to localStorage. */
    _scheduledFlush(): void {
        if (this._flushTimer != null) return;
        this._flushTimer = setTimeout(() => {
            this._flushTimer = undefined;
            this.flush();
        }, FLUSH_INTERVAL_MS);
    },

    /** Evict oldest entries if over capacity. */
    _evict(): void {
        if (this._entries.length <= MAX_ENTRIES) return;
        const removeCount = Math.max(1, Math.floor(MAX_ENTRIES * 0.25));
        this._entries.splice(0, removeCount);
    },

    /** Record a single LLM call attempt (success or failure). */
    record(entry: Omit<LLMLogEntry, 'ts'>): void {
        this._load();
        const full: LLMLogEntry = { ts: new Date().toISOString(), ...entry };
        if (full.msg && full.msg.length > MSG_MAX_LEN) {
            full.msg = full.msg.slice(0, MSG_MAX_LEN - 3) + '...';
        }
        this._entries.push(full);
        this._evict();
        this._dirty = true;
        this.flush();
    },

    /** Mark all entries for a given callId as resolved/unresolved. */
    resolveStage(callId: string, succeeded: boolean, resolvedBy: string | null): void {
        this._load();
        for (let i = this._entries.length - 1; i >= 0; i--) {
            const entry = this._entries[i];
            if (entry.cid !== callId) continue;
            entry.resolved = succeeded;
            entry.resolvedBy = resolvedBy;
        }
        this._dirty = true;
        this.flush();
    },

    /** Get all entries (newest first). */
    getEntries(): readonly LLMLogEntry[] {
        this._load();
        return [...this._entries].reverse();
    },

    /** Get entries filtered by criteria. */
    query(filter: {
        since?: string;
        stage?: string;
        provider?: string;
        errClass?: LLMErrorClass;
        onlyErrors?: boolean;
    }): LLMLogEntry[] {
        this._load();
        let results = [...this._entries];
        if (filter.since) {
            const cutoff = new Date(filter.since).getTime();
            results = results.filter(e => new Date(e.ts).getTime() >= cutoff);
        }
        if (filter.stage) {
            results = results.filter(e => e.stage === filter.stage);
        }
        if (filter.provider) {
            results = results.filter(e => e.provider === filter.provider);
        }
        if (filter.errClass) {
            results = results.filter(e => e.err === filter.errClass);
        }
        if (filter.onlyErrors) {
            results = results.filter(e => !e.ok);
        }
        return results.reverse();
    },

    /** Compute aggregate summary from current entries. */
    summarize(): LLMLogSummary {
        this._load();
        const entries = this._entries;

        const totalCalls = entries.length;
        const successes = entries.filter(e => e.ok);
        const failures = entries.filter(e => !e.ok);
        const totalSuccess = successes.length;
        const totalFailure = failures.length;
        const successRate = totalCalls > 0 ? totalSuccess / totalCalls : 0;

        // Latency stats (successes only)
        const latencies = successes.map(e => e.ms).sort((a, b) => a - b);
        const avgLatencyMs = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
        const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
        const p95LatencyMs = latencies.length > 0 ? latencies[p95Idx] : 0;

        // By provider
        const byProvider: LLMLogSummary['byProvider'] = {};
        for (const e of entries) {
            if (!byProvider[e.provider]) {
                byProvider[e.provider] = { calls: 0, successes: 0, failures: 0, avgMs: 0, errorBreakdown: {} };
            }
            const p = byProvider[e.provider];
            p.calls++;
            if (e.ok) {
                p.successes++;
            } else {
                p.failures++;
                if (e.err) {
                    p.errorBreakdown[e.err] = (p.errorBreakdown[e.err] || 0) + 1;
                }
            }
        }
        for (const key of Object.keys(byProvider)) {
            const p = byProvider[key];
            const provSuccesses = entries.filter(e => e.provider === key && e.ok);
            p.avgMs =
                provSuccesses.length > 0
                    ? Math.round(provSuccesses.reduce((a, e) => a + e.ms, 0) / provSuccesses.length)
                    : 0;
        }

        // By stage
        const byStage: LLMLogSummary['byStage'] = {};
        for (const e of entries) {
            if (!byStage[e.stage]) {
                byStage[e.stage] = { label: e.label, calls: 0, successes: 0, failures: 0, fallbackCount: 0, avgMs: 0 };
            }
            const s = byStage[e.stage];
            s.calls++;
            if (e.ok) {
                s.successes++;
                if (e.fb) s.fallbackCount++;
            } else {
                s.failures++;
            }
        }
        for (const key of Object.keys(byStage)) {
            const s = byStage[key];
            const stageSuccesses = entries.filter(e => e.stage === key && e.ok);
            s.avgMs =
                stageSuccesses.length > 0
                    ? Math.round(stageSuccesses.reduce((a, e) => a + e.ms, 0) / stageSuccesses.length)
                    : 0;
        }

        // By error class
        const byErrorClass: Partial<Record<LLMErrorClass, number>> = {};
        for (const e of failures) {
            if (e.err) {
                byErrorClass[e.err] = (byErrorClass[e.err] || 0) + 1;
            }
        }

        // Recent failures (last 50)
        const recentFailures = [...failures].reverse().slice(0, 50);

        return {
            totalCalls,
            totalSuccess,
            totalFailure,
            successRate,
            avgLatencyMs: Math.round(avgLatencyMs),
            p95LatencyMs,
            byProvider,
            byStage,
            byErrorClass,
            recentFailures,
        };
    },

    /** Export all entries as JSON string. */
    exportJson(): string {
        this._load();
        return JSON.stringify({ __v: SCHEMA_VERSION, entries: this._entries }, null, 2);
    },

    /** Download log as a JSON file. */
    exportToFile(): void {
        const json = this.exportJson();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cortex_llm_log_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    /** Clear all persistent log data. */
    clear(): void {
        this._entries = [];
        this._dirty = false;
        settingsStore.remove(STORAGE_KEYS.llmLog);
    },

    /** Force flush in-memory buffer to localStorage. */
    flush(): void {
        if (!this._dirty) return;
        this._dirty = false;
        const store: LLMLogStore = { __v: SCHEMA_VERSION, entries: this._entries };
        const ok = settingsStore.setJson(STORAGE_KEYS.llmLog, store);
        if (!ok) {
            // Quota exceeded — evict 25% and retry once
            const removeCount = Math.max(1, Math.floor(this._entries.length * 0.25));
            this._entries.splice(0, removeCount);
            settingsStore.setJson(STORAGE_KEYS.llmLog, { __v: SCHEMA_VERSION, entries: this._entries });
        }
        this._scheduleDiskSync();
    },

    /** Debounced sync of the full log to the Vite dev server for disk persistence. */
    _scheduleDiskSync(): void {
        if (this._diskSyncTimer != null) return;
        this._diskSyncTimer = setTimeout(() => {
            this._diskSyncTimer = undefined;
            this._syncToDisk();
        }, DISK_SYNC_INTERVAL_MS);
    },

    /** POST log to Vite middleware for disk persistence (.cortex-logs/). */
    _syncToDisk(): void {
        try {
            const payload = JSON.stringify({ __v: SCHEMA_VERSION, entries: this._entries });
            // Use sendBeacon for reliability during page unload; fetch otherwise
            if (document.visibilityState === 'hidden' && navigator.sendBeacon) {
                navigator.sendBeacon('/__llm-log/write', new Blob([payload], { type: 'application/json' }));
            } else {
                fetch('/__llm-log/write', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true,
                }).catch(() => {
                    /* silent — dev server may not be running */
                });
            }
        } catch {
            /* silent — not critical */
        }
    },

    /** Number of entries currently stored. */
    get size(): number {
        this._load();
        return this._entries.length;
    },
};
