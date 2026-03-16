/**
 * Cycle Store — File-based persistence for saved pipeline cycles.
 *
 * Uses Vite dev-server API endpoints (/__cycles/*) to read/write JSON files
 * in the saved-cycles/ directory. Any Vite instance on any port reads the
 * same files on disk, so saved cycles are shared across sessions.
 *
 * A lightweight in-memory index cache is populated on init for synchronous
 * list access; writes refresh the cache from the server response.
 *
 * Loaded-cycle state (ID + prompt) persists in localStorage so the cycle
 * survives browser refreshes and tab re-opens until explicitly unloaded.
 */

import { settingsStore } from './settings-store';
import type { SessionCacheBundle, CacheEntryEnvelope } from './llm-cache';

export { SessionCacheBundle, CacheEntryEnvelope };

const LOADED_CYCLE_KEY = 'cortex_loaded_cycle_id';
const LOADED_CYCLE_PROMPT_KEY = 'cortex_loaded_cycle_prompt';

export interface SavedCycleIndexEntry {
    id: string;
    filename: string;
    prompt: string;
    maxEffects: 1 | 2;
    rxMode: string;
    savedAt: string;
    hookSentence: string | null;
    topEffects: string[];
}

export interface SavedCycleRecord extends SavedCycleIndexEntry {
    createdAt: string;
    bundle: SessionCacheBundle;
}

/** In-memory cache populated during initCycleStore(). */
let _index: SavedCycleIndexEntry[] = [];

export async function initCycleStore(): Promise<void> {
    try {
        const res = await fetch('/__cycles/index');
        if (res.ok) {
            const data = await res.json();
            _index = Array.isArray(data) ? data : [];
        }
    } catch {
        _index = [];
    }
}

export async function saveCycle(record: SavedCycleRecord): Promise<void> {
    const res = await fetch('/__cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Save failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.index)) _index = data.index;
}

export async function loadCycleBundle(id: string): Promise<SessionCacheBundle | null> {
    try {
        const res = await fetch(`/__cycles/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const record: SavedCycleRecord = await res.json();
        return record?.bundle ?? null;
    } catch {
        return null;
    }
}

export async function deleteCycle(id: string): Promise<void> {
    const res = await fetch(`/__cycles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Delete failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.index)) {
        _index = data.index;
    } else {
        _index = _index.filter(e => e.id !== id);
    }
}

export function getCycleIndex(): SavedCycleIndexEntry[] {
    return _index;
}

export function getCycleCount(): number {
    return _index.length;
}

/** Persists the loaded cycle ID + prompt so it survives refreshes. */
export function setLoadedCycleId(id: string | null): void {
    if (id) {
        settingsStore.setString(LOADED_CYCLE_KEY, id);
    } else {
        settingsStore.remove(LOADED_CYCLE_KEY);
        settingsStore.remove(LOADED_CYCLE_PROMPT_KEY);
    }
}

/** Non-destructive read — the ID stays until explicitly cleared. */
export function getLoadedCycleId(): string | null {
    return settingsStore.getString(LOADED_CYCLE_KEY);
}

/** Persist the prompt + rxMode alongside the loaded cycle ID. */
export function setLoadedCyclePrompt(prompt: string, rxMode: string): void {
    settingsStore.setJson(LOADED_CYCLE_PROMPT_KEY, { prompt, rxMode });
}

/** Read the persisted prompt for auto-submit on reload. */
export function getLoadedCyclePrompt(): { prompt: string; rxMode: string } | null {
    return settingsStore.getJson<{ prompt: string; rxMode: string } | null>(LOADED_CYCLE_PROMPT_KEY, null);
}

/** Clear all loaded-cycle state (unload). */
export function clearLoadedCycleId(): void {
    settingsStore.remove(LOADED_CYCLE_KEY);
    settingsStore.remove(LOADED_CYCLE_PROMPT_KEY);
}
