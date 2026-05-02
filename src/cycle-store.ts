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
import type { TimeHorizon } from './types';
import type { RxSocTwin } from './rx-soc-transform';

export { SessionCacheBundle, CacheEntryEnvelope };
export type { RxSocTwin };

const LOADED_CYCLE_KEY = 'lx_studio_loaded_cycle_id';
const LOADED_CYCLE_PROMPT_KEY = 'lx_studio_loaded_cycle_prompt';

export interface SavedCycleIndexEntry {
    id: string;
    filename: string;
    /** Optional user-edited title shown on the card thumbnail overlay. Falls back to filename. */
    overlayTitle?: string | null;
    prompt: string;
    maxEffects: 1 | 2;
    rxMode: string;
    savedAt: string;
    hookSentence: string | null;
    topEffects: string[];
    /**
     * Strategist-assigned curve effect names, aligned 1:1 with effectScores indices
     * (max 2). Used ONLY for card badge display — section matching still uses the
     * broader Scout-derived topEffects (which contains the category tags like
     * "Focus" / "Alertness" that SECTION_DEFINITIONS looks for).
     */
    curveEffects?: string[];
    /**
     * Hex colors for each curve, aligned 1:1 with curveEffects. Pulled from
     * the Strategist's curvesData[].color so the stream-card score label
     * renders in the exact curve color (curve 0 ≠ curve 1). Without this,
     * buildScoreLineHtml falls back to getEffectColor which keyword-matches
     * the effect name and returns the same badge-category color for both.
     */
    curveColors?: string[];
    /**
     * Polarity per curve, aligned 1:1 with curveEffects. Values are
     * 'higher_is_better' or 'higher_is_worse'. Used by the stream card
     * score label to show `+X%` for improve-upward effects and `−X%` for
     * reduce-downward effects — without it, a protocol that *reduces*
     * gastric distress by 63% of the gap would mis-render as "+63% GASTRIC
     * DISTRESS", which reads as an increase.
     */
    curvePolarities?: string[];
    badgeCategory?: string | null;
    iconSvg?: string | null;
    recommendedDevices?: string[];
    substanceClasses?: string[];
    timeHorizon?: TimeHorizon;
    /** 7D average gap-closure % per effect (0..2 entries, aligned to curveEffects/topEffects). */
    effectScores?: number[];
    /**
     * Schema version of the effect-score formula. Used to invalidate cached
     * scores when the metric changes (see EFFECT_SCORE_FORMULA_VERSION).
     */
    effectScoresVersion?: number;
    /** Protocol-level aggregate confidence score (0–100). */
    protocolConfidence?: number;
    /** Schema version of the confidence formula (see CONFIDENCE_FORMULA_VERSION). */
    confidenceVersion?: number;
    /**
     * True when an Rx-SOC twin has been generated for this cycle. Used by
     * the gallery to decorate cards without loading the full bundle.
     */
    hasRxTwin?: boolean;
    /** 7D gap-closure % per curve for the Rx-SOC twin (aligned to curveEffects). */
    rxEffectScores?: number[];
}

export interface SavedCycleRecord extends SavedCycleIndexEntry {
    createdAt: string;
    bundle: SessionCacheBundle;
    /**
     * Optional Rx-SOC investor-demo twin derived from this cycle's Lx data.
     * When present, the app can render a side-by-side Lx-vs-Rx contrast
     * view without recomputing. Annexed onto the cycle (same file) so the
     * pair travels together.
     */
    rxTwin?: RxSocTwin | null;
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

export async function patchCycle(
    id: string,
    patch: {
        filename?: string;
        overlayTitle?: string | null;
        iconSvg?: string | null;
        recommendedDevices?: string[];
        substanceClasses?: string[];
        timeHorizon?: TimeHorizon;
        effectScores?: number[];
        effectScoresVersion?: number;
        topEffects?: string[];
        curveEffects?: string[];
        curveColors?: string[];
        curvePolarities?: string[];
        protocolConfidence?: number;
        confidenceVersion?: number;
        rxTwin?: RxSocTwin | null;
    },
): Promise<void> {
    const res = await fetch(`/__cycles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Patch failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.index)) {
        _index = data.index;
    } else {
        const entry = _index.find(e => e.id === id);
        if (entry) {
            if (patch.filename) entry.filename = patch.filename;
            if (typeof patch.overlayTitle !== 'undefined') entry.overlayTitle = patch.overlayTitle;
            if (typeof patch.iconSvg !== 'undefined') entry.iconSvg = patch.iconSvg;
            if (patch.recommendedDevices) entry.recommendedDevices = patch.recommendedDevices;
            if (patch.substanceClasses) entry.substanceClasses = patch.substanceClasses;
            if (patch.effectScores) entry.effectScores = patch.effectScores;
            if (typeof patch.effectScoresVersion === 'number') {
                entry.effectScoresVersion = patch.effectScoresVersion;
            }
            if (patch.topEffects) entry.topEffects = patch.topEffects;
            if (patch.curveEffects) entry.curveEffects = patch.curveEffects;
            if (patch.curveColors) entry.curveColors = patch.curveColors;
            if (patch.curvePolarities) entry.curvePolarities = patch.curvePolarities;
            if (typeof patch.rxTwin !== 'undefined') {
                entry.hasRxTwin = !!patch.rxTwin;
                entry.rxEffectScores = patch.rxTwin?.effectScores;
            }
        }
    }
}

/** Annex/replace the Rx-SOC twin on a saved cycle. Pass null to clear. */
export async function saveRxTwin(id: string, twin: RxSocTwin | null): Promise<void> {
    await patchCycle(id, { rxTwin: twin });
}

/** Fetch the full record and return its rxTwin (or null). */
export async function loadRxTwin(id: string): Promise<RxSocTwin | null> {
    try {
        const res = await fetch(`/__cycles/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const record: SavedCycleRecord = await res.json();
        return record?.rxTwin ?? null;
    } catch {
        return null;
    }
}

export async function renameCycle(id: string, filename: string): Promise<void> {
    const res = await fetch(`/__cycles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Rename failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.index)) {
        _index = data.index;
    } else {
        const entry = _index.find(e => e.id === id);
        if (entry) entry.filename = filename;
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
