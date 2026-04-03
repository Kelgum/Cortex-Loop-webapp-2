import { afterEach, describe, expect, it, vi } from 'vitest';

import { LLMCache } from '../../src/llm-cache';
import { resolveCachedStageHit } from '../../src/stage-cache';

describe('resolveCachedStageHit', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null when there is no cached payload', () => {
        vi.spyOn(LLMCache, 'getWithMeta').mockReturnValue({ payload: null, meta: null });

        expect(resolveCachedStageHit('fast-model', 'system', 'user')).toBeNull();
    });

    it('returns cached payload with inputMismatch flag when prompts differ', () => {
        vi.spyOn(LLMCache, 'getWithMeta').mockReturnValue({
            payload: { ok: true },
            meta: {
                stageClass: 'fast-model',
                cacheKey: 'cortex_cache_fast-model',
                cachedAt: '2026-03-06T00:00:00.000Z',
                systemPrompt: 'cached system',
                userPrompt: 'cached user',
                requestBody: { cached: true },
            },
        });

        const hit = resolveCachedStageHit<{ ok: boolean }>('fast-model', 'fresh system', 'fresh user');

        // Session cache is intentionally locked — prompt drift is flagged but not rejected
        expect(hit).not.toBeNull();
        expect(hit!.payload).toEqual({ ok: true });
        expect(hit!.cache.hit).toBe(true);
        expect(hit!.cache.inputMismatch).toBe(true);
    });
});
