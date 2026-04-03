/**
 * Custom Sections Store
 *
 * Persists user-created stream categories via the /__custom-sections
 * server endpoints (JSON files on disk). Mirrors the cycle-store pattern.
 *
 * Exports: initCustomSectionsStore, getCustomSections, saveCustomSection,
 *          patchCustomSection, deleteCustomSection
 */

export interface CustomSectionEntry {
    id: string;
    title: string;
    tags: string[];
    negativeTags?: string[];
}

/** In-memory cache populated during initCustomSectionsStore(). */
let _sections: CustomSectionEntry[] = [];

export async function initCustomSectionsStore(): Promise<void> {
    try {
        const res = await fetch('/__custom-sections/index');
        if (res.ok) {
            const data = await res.json();
            _sections = Array.isArray(data) ? data : [];
        }
    } catch {
        _sections = [];
    }
}

export function getCustomSections(): CustomSectionEntry[] {
    return _sections;
}

export async function saveCustomSection(record: CustomSectionEntry): Promise<void> {
    const res = await fetch('/__custom-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Save failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.index)) _sections = data.index;
}

export async function patchCustomSection(
    id: string,
    patch: { title?: string; tags?: string[]; negativeTags?: string[] },
): Promise<void> {
    const res = await fetch(`/__custom-sections/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Patch failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.index)) _sections = data.index;
}

export async function deleteCustomSection(id: string): Promise<void> {
    const res = await fetch(`/__custom-sections/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Delete failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.index)) _sections = data.index;
}
