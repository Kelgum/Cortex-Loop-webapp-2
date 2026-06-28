// ── Cycle creator backfill ───────────────────────────────────────────
//
// Existing saved cycles (pre-creator-metadata schema) lack creatorHandle /
// avatarUrl / creatorName on their index entries. The agent-match-model
// stage in each bundle DOES carry the headlining KOL agent id, so we can
// derive creator fields by loading each bundle and PATCHing the index.
//
// This runs once at app startup, in the background, with bounded
// concurrency so it doesn't stall the UI. After each successful patch we
// emit a `lx:cycle-creator-updated` CustomEvent so the Stream view can
// re-render and reveal the new stars/avatars without a manual refresh.

import { getCycleIndex, loadCycleBundle, patchCycle, type SavedCycleIndexEntry } from './cycle-store';
import { getAgentById } from './creator-agents/index';

const CONCURRENCY = 3;
const BATCH_RERENDER_EVENT = 'lx:cycle-creator-updated';

let _running = false;

/**
 * Walks the cycle index and fills in creator metadata for any entry that
 * has none. Safe to call multiple times — a guard prevents reentrancy.
 */
export async function backfillCreatorMetadata(): Promise<void> {
    if (_running) return;
    _running = true;

    try {
        const candidates = getCycleIndex().filter(e => !e.creatorHandle);
        if (candidates.length === 0) return;

        // Process in parallel batches.
        let idx = 0;
        const workers: Promise<void>[] = [];
        for (let w = 0; w < CONCURRENCY; w++) {
            workers.push(
                (async () => {
                    while (idx < candidates.length) {
                        const myIdx = idx++;
                        const entry = candidates[myIdx];
                        await tryPatchOne(entry);
                    }
                })(),
            );
        }
        await Promise.all(workers);
    } finally {
        _running = false;
        // Final notification — even if some patches failed mid-flight, a
        // re-render brings the page in sync with whatever did persist.
        dispatchUpdated(null);
    }
}

async function tryPatchOne(entry: SavedCycleIndexEntry): Promise<void> {
    try {
        const bundle = await loadCycleBundle(entry.id);
        if (!bundle) return;

        const matchPayload = (bundle.stages as Record<string, { payload?: any }> | undefined)?.['agent-match-model']
            ?.payload;
        const topAgentId: string | undefined = matchPayload?.ranked?.[0]?.agentId;
        if (!topAgentId) return;

        const agent = getAgentById(topAgentId);
        if (!agent) return;

        await patchCycle(entry.id, {
            creatorHandle: agent.meta.creatorHandle,
            avatarUrl: agent.meta.avatarUrl,
            creatorName: agent.meta.creatorName || agent.meta.name,
        });

        dispatchUpdated(entry.id);
    } catch {
        // Swallow — backfill is best-effort; failed entries stay un-enriched
        // and can be retried on next app launch.
    }
}

function dispatchUpdated(id: string | null): void {
    try {
        window.dispatchEvent(new CustomEvent(BATCH_RERENDER_EVENT, { detail: { id } }));
    } catch {
        /* SSR / no-window guards */
    }
}

export { BATCH_RERENDER_EVENT };
