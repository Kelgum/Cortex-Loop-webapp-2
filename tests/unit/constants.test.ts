import { describe, expect, it } from 'vitest';

import { FAST_MODELS, MAIN_MODELS, MODEL_OPTIONS, mapModelAcrossProviders } from '../../src/constants';

describe('mapModelAcrossProviders', () => {
    it('maps across providers by nearest tier', () => {
        expect(mapModelAcrossProviders('anthropic', 'haiku', 'openai')).toBe('5.3-instant');
        expect(mapModelAcrossProviders('openai', '5.4-thinking', 'anthropic')).toBe('opus');
        expect(mapModelAcrossProviders('grok', 'full', 'gemini')).toBe('pro-preview');
    });

    it('falls back to the first option when the source key is unknown', () => {
        expect(mapModelAcrossProviders('openai', 'unknown-model', 'anthropic')).toBe('haiku');
    });

    it('keeps Gemini defaults while removing 2.5 Flash/Pro options', () => {
        expect(FAST_MODELS.gemini.model).toBe('gemini-2.5-flash-lite');
        expect(MAIN_MODELS.gemini).toBe('gemini-3.1-pro-preview');
        expect(MODEL_OPTIONS.gemini.find((entry: any) => entry.key === 'flash-lite')?.model).toBe('gemini-2.5-flash-lite');
        expect(MODEL_OPTIONS.gemini.find((entry: any) => entry.key === 'flash-preview')?.model).toBe('gemini-3-flash-preview');
        expect(MODEL_OPTIONS.gemini.find((entry: any) => entry.key === 'pro-preview')?.model).toBe('gemini-3.1-pro-preview');
        expect(MODEL_OPTIONS.gemini.some((entry: any) => entry.model === 'gemini-2.5-flash')).toBe(false);
        expect(MODEL_OPTIONS.gemini.some((entry: any) => entry.model === 'gemini-2.5-pro')).toBe(false);
    });
});
