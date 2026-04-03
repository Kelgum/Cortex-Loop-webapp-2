import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LLMCache } from '../../src/llm-cache';
import { persistPostProcessedStageResult } from '../../src/llm-pipeline';
import { JSON_POSTAMBLE } from '../../src/prompts';

describe('persistPostProcessedStageResult', () => {
    beforeEach(() => {
        LLMCache.clearAll();
        LLMCache.startLiveFlow();
    });

    afterEach(() => {
        LLMCache.clearAll();
    });

    it('overwrites an earlier draft-stage payload with the finalized result', () => {
        const stageClass = 'intervention-model';
        const draftPayload = {
            interventions: [{ key: 'caffeine', impacts: { Focus: 1.15 } }],
        };
        const finalizedPayload = {
            interventions: [{ key: 'caffeine', impacts: { Focus: 0.82 } }],
        };

        LLMCache.set(stageClass, draftPayload, {
            systemPrompt: 'draft system',
            userPrompt: 'draft user',
            requestBody: null,
        });

        persistPostProcessedStageResult(stageClass, 'final system', 'final user', finalizedPayload);
        LLMCache.markFlowComplete();

        const cached = LLMCache.getWithMeta(stageClass);
        expect(cached.payload).toEqual(finalizedPayload);
        expect(cached.meta?.systemPrompt).toBe(`final system\n\n${JSON_POSTAMBLE}`);
        expect(cached.meta?.userPrompt).toBe('final user');
    });
});
