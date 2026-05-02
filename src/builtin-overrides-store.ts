/**
 * Built-in Section Overrides Store
 *
 * Persists per-section manual force-include / force-exclude cycle-id lists for
 * BUILT-IN stream sections (recent, focus, sleep, etc.) via the
 * /__builtin-overrides server endpoints (single JSON file on disk). Custom
 * sections carry their own force lists inside their per-section JSON files —
 * this is the built-in equivalent, used to persist drag-and-drop card moves in
 * stream edit mode so they survive reloads and travel with the repo.
 *
 * Exports: initBuiltinOverridesStore, getBuiltinForceInclude,
 *          getBuiltinForceExclude, updateBuiltinForceLists
 */

interface BuiltinOverrides {
    forceIncludeIds: Record<string, string[]>;
    forceExcludeIds: Record<string, string[]>;
    cardOrder: Record<string, string[]>;
    titleOverrides: Record<string, string>;
    effectOverrides: Record<string, string[]>;
    negativeTagOverrides: Record<string, string[]>;
}

const EMPTY_OVERRIDES: BuiltinOverrides = {
    forceIncludeIds: {},
    forceExcludeIds: {},
    cardOrder: {},
    titleOverrides: {},
    effectOverrides: {},
    negativeTagOverrides: {},
};

/** In-memory cache populated during initBuiltinOverridesStore(). */
let _overrides: BuiltinOverrides = { ...EMPTY_OVERRIDES };
let _ready = false;

export function isBuiltinOverridesReady(): boolean {
    return _ready;
}

export async function initBuiltinOverridesStore(): Promise<void> {
    try {
        const res = await fetch('/__builtin-overrides');
        if (res.ok) {
            const data = await res.json();
            _overrides = {
                forceIncludeIds: data && typeof data.forceIncludeIds === 'object' ? data.forceIncludeIds : {},
                forceExcludeIds: data && typeof data.forceExcludeIds === 'object' ? data.forceExcludeIds : {},
                cardOrder: data && typeof data.cardOrder === 'object' ? data.cardOrder : {},
                titleOverrides: data && typeof data.titleOverrides === 'object' ? data.titleOverrides : {},
                effectOverrides: data && typeof data.effectOverrides === 'object' ? data.effectOverrides : {},
                negativeTagOverrides:
                    data && typeof data.negativeTagOverrides === 'object' ? data.negativeTagOverrides : {},
            };
        }
    } catch {
        _overrides = { ...EMPTY_OVERRIDES };
    }
    _ready = true;
}

export function getBuiltinForceInclude(sectionKey: string): string[] {
    return _overrides.forceIncludeIds[sectionKey] || [];
}

export function getBuiltinForceExclude(sectionKey: string): string[] {
    return _overrides.forceExcludeIds[sectionKey] || [];
}

export function getBuiltinCardOrder(sectionKey: string): string[] {
    return _overrides.cardOrder[sectionKey] || [];
}

/** Replace the card order for a built-in section. */
export async function setBuiltinCardOrder(sectionKey: string, order: string[]): Promise<void> {
    if (order.length > 0) {
        _overrides.cardOrder[sectionKey] = order;
    } else {
        delete _overrides.cardOrder[sectionKey];
    }
    await _flush();
}

/**
 * Apply a patch to a built-in section's force lists. Mutates the in-memory
 * cache synchronously (so subsequent reads see the new state immediately) and
 * persists to disk in the background.
 */
export async function updateBuiltinForceLists(
    sectionKey: string,
    patch: {
        addInclude?: string;
        removeInclude?: string;
        addExclude?: string;
        removeExclude?: string;
    },
): Promise<void> {
    const incList = _overrides.forceIncludeIds[sectionKey] || [];
    const excList = _overrides.forceExcludeIds[sectionKey] || [];

    let nextInc = incList.slice();
    let nextExc = excList.slice();

    if (patch.addInclude && !nextInc.includes(patch.addInclude)) {
        nextInc.push(patch.addInclude);
    }
    if (patch.removeInclude) {
        nextInc = nextInc.filter(id => id !== patch.removeInclude);
    }
    if (patch.addExclude && !nextExc.includes(patch.addExclude)) {
        nextExc.push(patch.addExclude);
    }
    if (patch.removeExclude) {
        nextExc = nextExc.filter(id => id !== patch.removeExclude);
    }

    if (nextInc.length > 0) {
        _overrides.forceIncludeIds[sectionKey] = nextInc;
    } else {
        delete _overrides.forceIncludeIds[sectionKey];
    }
    if (nextExc.length > 0) {
        _overrides.forceExcludeIds[sectionKey] = nextExc;
    } else {
        delete _overrides.forceExcludeIds[sectionKey];
    }

    await _flush();
}

// ── Title / Effect / Negative-Tag Overrides for built-in sections ──

export function getBuiltinTitleOverride(sectionKey: string): string | undefined {
    return _overrides.titleOverrides[sectionKey];
}

export function getBuiltinEffectOverride(sectionKey: string): string[] | undefined {
    return _overrides.effectOverrides[sectionKey];
}

export function getBuiltinNegativeTagOverride(sectionKey: string): string[] | undefined {
    return _overrides.negativeTagOverrides[sectionKey];
}

/** Persist a title rename for a built-in section. */
export async function setBuiltinTitleOverride(sectionKey: string, title: string): Promise<void> {
    _overrides.titleOverrides[sectionKey] = title;
    await _flush();
}

/** Persist effect + negative-tag overrides for a built-in section. */
export async function setBuiltinSectionOverrides(
    sectionKey: string,
    patch: { title?: string; effects?: string[]; negativeTags?: string[] },
): Promise<void> {
    if (patch.title !== undefined) _overrides.titleOverrides[sectionKey] = patch.title;
    if (patch.effects !== undefined) _overrides.effectOverrides[sectionKey] = patch.effects;
    if (patch.negativeTags !== undefined) _overrides.negativeTagOverrides[sectionKey] = patch.negativeTags;
    await _flush();
}

async function _flush(): Promise<void> {
    try {
        await fetch('/__builtin-overrides', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_overrides),
        });
    } catch {
        // Silent
    }
}
