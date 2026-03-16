import { afterEach, describe, expect, it } from 'vitest';

import { AppState, getStageModel } from '../../src/state';

const originalProviders = { ...AppState.stageProviders };
const originalModels = { ...AppState.stageModels };
const originalSelectedLlm = AppState.selectedLLM;

describe('revision model defaults', () => {
    afterEach(() => {
        Object.assign(AppState.stageProviders, originalProviders);
        Object.assign(AppState.stageModels, originalModels);
        AppState.selectedLLM = originalSelectedLlm;
    });

    it('resolves Grandmaster defaults to the main-tier model for every provider', () => {
        const expectations = [
            ['anthropic', 'claude-opus-4-6'],
            ['openai', 'gpt-5.4'],
            ['grok', 'grok-4-0709'],
            ['gemini', 'gemini-3.1-pro-preview'],
        ] as const;

        for (const [provider, expectedModel] of expectations) {
            AppState.selectedLLM = provider;
            AppState.stageProviders.revision = provider;
            AppState.stageModels.revision = '__invalid__';
            expect(getStageModel('revision').model).toBe(expectedModel);
        }
    });

    it('preserves an explicit user override for the revision stage', () => {
        AppState.selectedLLM = 'openai';
        AppState.stageProviders.revision = 'openai';
        AppState.stageModels.revision = '5.3-instant';

        expect(getStageModel('revision').model).toBe('gpt-5.3-chat-latest');
    });
});
