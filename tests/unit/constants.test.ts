import { describe, expect, it } from 'vitest';

import { FAST_MODELS, MAIN_MODELS, MODEL_OPTIONS, mapModelAcrossProviders } from '../../src/constants';

describe('mapModelAcrossProviders', () => {
    it('maps across providers by nearest tier', () => {
        // Fast tier (Haiku) → Fast tier OpenAI (5.5 Instant)
        expect(mapModelAcrossProviders('anthropic', 'haiku', 'openai')).toBe('5.5-instant');
        // Main tier OpenAI (5.5) → Main tier Anthropic (Opus 4.7)
        expect(mapModelAcrossProviders('openai', '5.5', 'anthropic')).toBe('opus47');
        // Main tier Grok (4.3) → Main tier Gemini (3 Flash)
        expect(mapModelAcrossProviders('grok', '4-3', 'gemini')).toBe('flash-preview');
    });

    it('falls back to the first option when the source key is unknown', () => {
        expect(mapModelAcrossProviders('openai', 'unknown-model', 'anthropic')).toBe('haiku');
    });

    it('exposes the May-2026 Gemini lineup with 3.x defaults', () => {
        expect(FAST_MODELS.gemini.model).toBe('gemini-3.1-flash-lite-preview');
        expect(MAIN_MODELS.gemini).toBe('gemini-3-flash');
        expect(MODEL_OPTIONS.gemini.find((entry: any) => entry.key === 'flash-lite')?.model).toBe('gemini-2.5-flash-lite');
        expect(MODEL_OPTIONS.gemini.find((entry: any) => entry.key === 'flash-preview')?.model).toBe('gemini-3-flash');
        expect(MODEL_OPTIONS.gemini.find((entry: any) => entry.key === 'pro-preview')?.model).toBe(
            'gemini-3.1-pro-preview',
        );
        // 2.5 Flash is now exposed as the Mid-tier slot for Google.
        expect(MODEL_OPTIONS.gemini.some((entry: any) => entry.key === 'flash-25')).toBe(true);
    });
});
