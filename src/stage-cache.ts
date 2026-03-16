import { LLMCache } from './llm-cache';

export interface CachedStageHit<TPayload = unknown> {
    payload: TPayload;
    systemPrompt: string;
    userPrompt: string;
    requestBody: unknown;
    cache: {
        hit: true;
        key: string;
        cachedAt: string;
        inputMismatch: boolean;
    };
}

export function resolveCachedStageHit<TPayload>(
    stageClass: string,
    systemPrompt: string,
    userPrompt: string,
): CachedStageHit<TPayload> | null {
    const cached = LLMCache.getWithMeta(stageClass);
    if (cached.payload == null) return null;

    const cachedSys = cached.meta?.systemPrompt || '';
    const cachedUser = cached.meta?.userPrompt || '';

    // Session cache is an intentionally locked full-run replay.
    // We still surface prompt drift in debug metadata, but we do not
    // invalidate the cached session when the current inputs differ.
    const inputMismatch = cachedSys !== systemPrompt || cachedUser !== userPrompt;

    return {
        payload: cached.payload as TPayload,
        systemPrompt: cachedSys,
        userPrompt: cachedUser,
        requestBody: cached.meta?.requestBody ?? null,
        cache: {
            hit: true,
            key: cached.meta?.cacheKey || `session:${stageClass}`,
            cachedAt: cached.meta?.cachedAt || '',
            inputMismatch,
        },
    };
}
