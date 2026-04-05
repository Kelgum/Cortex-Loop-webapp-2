/**
 * LLM Pipeline — Multi-provider LLM API calls (Anthropic, OpenAI, Gemini, Grok) with JSON parsing and retry logic.
 * Exports: callFastModel, callMainModelForCurves, callInterventionModel, callRevisionModel, callSherlockModel, callSherlockRevisionModel, extractAndParseJSON
 * Depends on: constants (API_ENDPOINTS), state (AppState, getStageModel), prompts (PROMPTS), debug-panel (DebugLog)
 */
import { API_ENDPOINTS, BADGE_CATEGORIES } from './constants';
import {
    AppState,
    PhaseState,
    BiometricState,
    AgentMatchState,
    getStageModel,
    resolveStageModelForProvider,
} from './state';
import { interpolatePrompt } from './utils';
import { PROMPTS, JSON_POSTAMBLE } from './prompts';
import { DebugLog } from './debug-panel';
import { getActiveSubstances } from './substances';
import { LLMCache } from './llm-cache';
import { validateStageResponseShape, extractInterventionsData } from './llm-response-shape';
import { validateInterventions, computeStackingPeaks, pruneConcurrentOverload } from './lx-compute';
import { reportRuntimeBug, reportRuntimeFallback } from './runtime-error-banner';
import { resolveCachedStageHit } from './stage-cache';
import {
    buildRevisionCurrentStateSummary,
    buildRevisionPromptGapSummary,
    serializeRevisionInterventions,
} from './revision-reference';
import type { PipelineStage, RevisionReferenceBundle, StageResultMap } from './types';
import { LLMLog, classifyError, inferErrorContext, generateCallId } from './llm-failure-log';

export { getStageModel } from './state';

/** Routed generic LLM call — exported for use by week-orchestrator and other modules. */
export async function callGenericRouted(
    userPrompt: any,
    key: any,
    model: any,
    type: any,
    provider: any,
    systemPrompt: any,
    maxTokens: any,
    reasoningEffort?: string,
): Promise<unknown> {
    return callGeneric(userPrompt, key, model, type, provider, systemPrompt, maxTokens, reasoningEffort);
}

async function callGeneric(
    userPrompt: any,
    key: any,
    model: any,
    type: any,
    provider: any,
    systemPrompt: any,
    maxTokens: any,
    reasoningEffort?: string,
    timeoutMs?: number,
) {
    const timeout = timeoutMs ?? REQUEST_TIMEOUT_FAST_MS;
    switch (type) {
        case 'anthropic':
            return callAnthropicGeneric(userPrompt, key, model, systemPrompt, maxTokens, timeout);
        case 'openai':
            return callOpenAIGeneric(
                userPrompt,
                key,
                model,
                provider === 'grok' ? API_ENDPOINTS.grok : API_ENDPOINTS.openai,
                systemPrompt,
                maxTokens,
                provider === 'grok' ? 'grok' : 'openai',
                reasoningEffort,
                timeout,
            );
        case 'gemini':
            return callGeminiGeneric(userPrompt, key, model, systemPrompt, maxTokens, timeout);
        default:
            return callOpenAIGeneric(
                userPrompt,
                key,
                model,
                API_ENDPOINTS.openai,
                systemPrompt,
                maxTokens,
                'openai',
                reasoningEffort,
                timeout,
            );
    }
}

type StageProviderContext = {
    stage: PipelineStage | string;
    stageLabel: string;
    stageClass: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    provider: string;
    model: string;
    type: string;
    key: string;
    modelKey: string;
    reasoningEffort?: string;
    timeoutMs: number;
    callGeneric: typeof callGeneric;
};

type StageFallbackOptions<TResult> = {
    stage: PipelineStage | string;
    stageLabel: string;
    stageClass: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    validateResult?: (result: unknown) => TResult;
    executeWithProvider?: (ctx: StageProviderContext) => Promise<TResult>;
};

const FALLBACK_SEQUENCE: string[] = ['gemini', 'anthropic', 'openai', 'grok'];
const REQUEST_TIMEOUT_FAST_MS = 45_000;
const REQUEST_TIMEOUT_MID_MS = 100_000;
const REQUEST_TIMEOUT_MAIN_MS = 150_000;

function providerPrettyName(provider: string): string {
    switch (provider) {
        case 'anthropic':
            return 'Claude';
        case 'openai':
            return 'OpenAI';
        case 'gemini':
            return 'Gemini';
        case 'grok':
            return 'Grok';
        default:
            return provider;
    }
}

function buildProviderAttemptOrder(primaryProvider: string): string[] {
    const unique: string[] = [];
    if (primaryProvider) unique.push(primaryProvider);
    for (const p of FALLBACK_SEQUENCE) {
        if (!unique.includes(p)) unique.push(p);
    }
    return unique;
}

function nextProviderInOrder(order: string[], idx: number): string | null {
    for (let i = idx + 1; i < order.length; i++) {
        if (order[i]) return order[i];
    }
    return null;
}

function attachRequestContext(err: any, requestBody: any, rawResponse?: string): Error {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    const anyErr: any = wrapped;
    if (requestBody != null && anyErr._requestBody == null) anyErr._requestBody = requestBody;
    if (typeof rawResponse === 'string' && rawResponse && anyErr._rawResponse == null)
        anyErr._rawResponse = rawResponse;
    return wrapped;
}

/**
 * Shared stage caller with provider failover.
 * Attempt order = selected stage provider first, then gemini -> anthropic -> openai -> grok (skipping attempted).
 * Provider switching is runtime-only and never persisted.
 */
export async function callStageWithFallback<TResult>(options: StageFallbackOptions<TResult>): Promise<TResult> {
    const initial = getStageModel(options.stage);
    const attemptProviders = buildProviderAttemptOrder(initial.provider);
    const stageErrors: string[] = [];
    let lastFailure: { provider: string; model: string; message: string } | null = null;
    const callId = generateCallId();

    for (let i = 0; i < attemptProviders.length; i++) {
        const provider = attemptProviders[i];
        const nextProvider = nextProviderInOrder(attemptProviders, i);
        const modelInfo = resolveStageModelForProvider(options.stage, provider);

        if (!modelInfo.key) {
            const noKeyMessage = `No API key configured for ${providerPrettyName(provider)}.`;
            stageErrors.push(`${provider}: ${noKeyMessage}`);
            lastFailure = { provider, model: modelInfo.model, message: noKeyMessage };
            reportRuntimeBug({
                stage: options.stageLabel,
                provider,
                message: noKeyMessage,
                retryProvider: nextProvider,
            });
            LLMLog.record({
                cid: callId,
                stage: options.stageClass,
                label: options.stageLabel,
                provider,
                model: modelInfo.model,
                ok: false,
                ms: 0,
                http: 0,
                err: 'missing_key',
                msg: noKeyMessage,
                seq: i,
                fb: i > 0,
                resolved: false,
                resolvedBy: null,
            });
            continue;
        }

        const tierTimeout =
            modelInfo.tier === 2
                ? REQUEST_TIMEOUT_MAIN_MS
                : modelInfo.tier === 1
                  ? REQUEST_TIMEOUT_MID_MS
                  : REQUEST_TIMEOUT_FAST_MS;
        // Heavy stages (maxTokens >= 8192) need at least mid-tier timeout regardless of model tier
        const timeoutMs = options.maxTokens >= 8192 ? Math.max(tierTimeout, REQUEST_TIMEOUT_MID_MS) : tierTimeout;

        // Defensive: if a tier-2 model is used for a lightweight stage, bump maxTokens
        const effectiveMaxTokens =
            modelInfo.tier >= 2 && options.maxTokens < 4096 ? Math.max(options.maxTokens * 2, 2048) : options.maxTokens;

        // Skip models whose output cap can't satisfy the stage's token requirement
        if (modelInfo.maxOutput && modelInfo.maxOutput < effectiveMaxTokens) {
            const skipMsg = `Skipping ${providerPrettyName(provider)}/${modelInfo.model} — maxOutput ${modelInfo.maxOutput} < required ${effectiveMaxTokens}`;
            console.warn(`[LLM] ${skipMsg}`);
            stageErrors.push(`${provider}: ${skipMsg}`);
            lastFailure = { provider, model: modelInfo.model, message: skipMsg };
            continue;
        }

        const debugEntry = DebugLog.addEntry({
            stage: options.stageLabel,
            stageClass: options.stageClass,
            model: modelInfo.model,
            provider,
            systemPrompt: options.systemPrompt,
            userPrompt: options.userPrompt,
            loading: true,
        });
        const started = performance.now();

        try {
            const result = options.executeWithProvider
                ? await options.executeWithProvider({
                      stage: options.stage,
                      stageLabel: options.stageLabel,
                      stageClass: options.stageClass,
                      systemPrompt: options.systemPrompt,
                      userPrompt: options.userPrompt,
                      maxTokens: effectiveMaxTokens,
                      provider,
                      model: modelInfo.model,
                      type: modelInfo.type,
                      key: modelInfo.key,
                      modelKey: modelInfo.modelKey,
                      reasoningEffort: modelInfo.reasoningEffort,
                      timeoutMs,
                      callGeneric: (up: any, k: any, m: any, t: any, p: any, sp: any, mt: any, re?: string) =>
                          callGeneric(up, k, m, t, p, sp, mt, re, timeoutMs),
                  })
                : await callGeneric(
                      options.userPrompt,
                      modelInfo.key,
                      modelInfo.model,
                      modelInfo.type,
                      provider,
                      options.systemPrompt,
                      effectiveMaxTokens,
                      modelInfo.reasoningEffort,
                      timeoutMs,
                  );

            const requestBody = result?._requestBody;
            const rawResponse = result?._rawResponse;
            const effectiveModel = result?._effectiveModel;
            if (result && typeof result === 'object') {
                delete result._requestBody;
                delete result._rawResponse;
                delete result._effectiveModel;
            }

            const resolvedModel = typeof effectiveModel === 'string' ? effectiveModel : modelInfo.model;

            const validated = options.validateResult
                ? options.validateResult(result)
                : (validateStageResponseShape(options.stage, result) as TResult);

            DebugLog.updateEntry(debugEntry, {
                loading: false,
                model: resolvedModel,
                requestBody,
                rawResponse,
                response: validated,
                duration: Math.round(performance.now() - started),
            });
            const providerFallback = provider !== initial.provider;
            if (providerFallback) {
                reportRuntimeFallback({
                    stage: options.stageLabel,
                    failedProvider: lastFailure?.provider || initial.provider,
                    failedModel: lastFailure?.model || initial.model,
                    failedMessage: lastFailure?.message || 'Automatic fallback after a failed API call.',
                    activeProvider: provider,
                    activeModel: resolvedModel,
                });
            }
            LLMLog.record({
                cid: callId,
                stage: options.stageClass,
                label: options.stageLabel,
                provider,
                model: resolvedModel,
                ok: true,
                ms: Math.round(performance.now() - started),
                http: 200,
                err: null,
                msg: null,
                seq: i,
                fb: provider !== initial.provider,
                resolved: true,
                resolvedBy: provider,
            });
            LLMLog.resolveStage(callId, true, provider);
            return validated;
        } catch (err: any) {
            const message = err?.message || String(err);
            stageErrors.push(`${provider}: ${message}`);
            lastFailure = { provider, model: modelInfo.model, message };
            DebugLog.updateEntry(debugEntry, {
                loading: false,
                ...(err?._requestBody ? { requestBody: err._requestBody } : {}),
                ...(err?._rawResponse ? { rawResponse: err._rawResponse } : {}),
                error: message,
                duration: Math.round(performance.now() - started),
            });
            reportRuntimeBug({
                stage: options.stageLabel,
                provider,
                message,
                retryProvider: nextProvider,
            });
            const errCtx = inferErrorContext(err);
            LLMLog.record({
                cid: callId,
                stage: options.stageClass,
                label: options.stageLabel,
                provider,
                model: modelInfo.model,
                ok: false,
                ms: Math.round(performance.now() - started),
                http: errCtx.httpStatus,
                err: classifyError(message, errCtx.httpStatus, errCtx.context),
                msg: message,
                seq: i,
                fb: i > 0,
                resolved: false,
                resolvedBy: null,
            });
        }
    }

    LLMLog.resolveStage(callId, false, null);
    LLMLog.flush();
    throw new Error(`${options.stageLabel} failed across providers: ${stageErrors.join(' | ')}`);
}

type ProviderErrorInfo = {
    message: string;
    type: string;
    requestId: string | null;
};

const TRANSIENT_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_ERROR_TYPES = new Set([
    'overloaded_error',
    'rate_limit_error',
    'server_error',
    'api_error',
    'timeout',
    'request_timeout',
    'service_unavailable',
    'temporarily_unavailable',
    'internal_server_error',
]);

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function computeRetryDelayMs(attempt: number) {
    const baseMs = 600;
    const jitterMs = Math.floor(Math.random() * 350);
    const maxMs = 7000;
    return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)) + jitterMs);
}

function parseRetryAfterMs(headerValue: string | null) {
    if (!headerValue) return null;
    const raw = headerValue.trim();
    if (!raw) return null;

    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.round(seconds * 1000);
    }

    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) {
        return Math.max(0, dateMs - Date.now());
    }

    return null;
}

function parseProviderErrorInfo(bodyText: string, fallbackMessage: string): ProviderErrorInfo {
    const info: ProviderErrorInfo = {
        message: fallbackMessage || 'Request failed.',
        type: 'http_error',
        requestId: null,
    };

    const trimmed = String(bodyText || '').trim();
    if (!trimmed) return info;

    try {
        const parsed = JSON.parse(trimmed);
        const parsedAny = parsed as any;

        // OpenAI Responses-style transport error:
        // { type: "error", error: { type, message }, request_id }
        if (parsedAny?.type === 'error' && parsedAny?.error) {
            const errObj = parsedAny.error;
            info.message = String(errObj.message || info.message);
            info.type = String(errObj.type || errObj.code || parsedAny.type || info.type).toLowerCase();
            info.requestId = typeof parsedAny.request_id === 'string' ? parsedAny.request_id : null;
            return info;
        }

        // OpenAI/Anthropic/Grok normal error shape:
        // { error: { type, code, message }, request_id? }
        if (parsedAny?.error) {
            const errObj = parsedAny.error;
            info.message = String(errObj.message || parsedAny.message || info.message);
            info.type = String(errObj.type || errObj.code || parsedAny.type || info.type).toLowerCase();
            if (typeof parsedAny.request_id === 'string') {
                info.requestId = parsedAny.request_id;
            } else if (typeof errObj.request_id === 'string') {
                info.requestId = errObj.request_id;
            }
            return info;
        }

        if (typeof parsedAny?.message === 'string') info.message = parsedAny.message;
        if (typeof parsedAny?.type === 'string') info.type = parsedAny.type.toLowerCase();
        if (typeof parsedAny?.request_id === 'string') info.requestId = parsedAny.request_id;
        return info;
    } catch {
        info.message = trimmed;
        return info;
    }
}

function isTransientProviderError(status: number, info: ProviderErrorInfo) {
    if (TRANSIENT_HTTP_STATUSES.has(status)) return true;
    if (TRANSIENT_ERROR_TYPES.has(String(info.type || '').toLowerCase())) return true;
    return /(overload|overloaded|rate limit|too many requests|temporar|try again|busy|unavailable|timeout|timed out|capacity)/i.test(
        info.message || '',
    );
}

function isTransientNetworkError(err: any) {
    const name = String(err?.name || '');
    const message = String(err?.message || err || '');
    if (name === 'TypeError' || name === 'AbortError') return true;
    return /(failed to fetch|network|load failed|timed out|timeout|connection|econnreset|enotfound|service unavailable)/i.test(
        message,
    );
}

function buildProviderError(providerLabel: string, status: number, info: ProviderErrorInfo) {
    const statusSuffix = status ? ` (HTTP ${status})` : '';
    const requestSuffix = info.requestId ? ` [request_id: ${info.requestId}]` : '';
    const err: any = new Error(`${providerLabel} request failed: ${info.message}${statusSuffix}${requestSuffix}`);
    err.status = status;
    err.type = info.type;
    err.requestId = info.requestId;
    return err;
}

function buildGeminiGenerationConfig(model: string, maxTokens: number) {
    // Gemini thinking-model handling:
    //  • 3.1+ models REQUIRE thinking (budget 0 → HTTP 400). Give a small budget
    //    so thinking tokens don't starve the actual JSON response.
    //  • 2.5-pro/flash and 3.0 models default to thinking ON, which eats the
    //    output budget and truncates JSON. Disable it (budget 0).
    //  • Legacy flash-lite models before 3.1 have no thinking mode — leave config alone.
    const isThinkingRequired = /^gemini-(3\.[1-9]|[4-9])/.test(model);
    const isThinkingOptional = !isThinkingRequired && /^gemini-(3|2\.5-(pro|flash))(?!-lite)/.test(model);
    const generationConfig: any = { maxOutputTokens: maxTokens };
    if (isThinkingRequired) {
        const thinkBudget = 2048;
        generationConfig.thinkingConfig = { thinkingBudget: thinkBudget };
        generationConfig.maxOutputTokens = maxTokens + thinkBudget;
    } else if (isThinkingOptional) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    return generationConfig;
}

async function fetchJsonWithRetry(
    endpoint: string,
    init: RequestInit,
    providerLabel: string,
    maxAttempts = 2,
    timeoutMs = REQUEST_TIMEOUT_FAST_MS,
) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response: Response;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let didTimeout = false;
        const controller = new AbortController();
        const parentSignal = init.signal || null;
        const onParentAbort = () => controller.abort();
        timeoutId = setTimeout(() => {
            didTimeout = true;
            controller.abort();
        }, timeoutMs);
        if (parentSignal) {
            if (parentSignal.aborted) controller.abort();
            else parentSignal.addEventListener('abort', onParentAbort, { once: true });
        }

        try {
            response = await fetch(endpoint, { ...init, signal: controller.signal });
        } catch (err: any) {
            if (timeoutId) clearTimeout(timeoutId);
            if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
            const resolvedError = didTimeout
                ? new Error(`${providerLabel} request timed out after ${timeoutMs}ms.`)
                : err instanceof Error
                  ? err
                  : new Error(String(err));
            if (didTimeout || !isTransientNetworkError(resolvedError) || attempt === maxAttempts) {
                throw resolvedError;
            }
            const waitMs = computeRetryDelayMs(attempt);
            console.warn(
                `[LLM:${providerLabel}] transient network error on attempt ${attempt}/${maxAttempts}; retrying in ${waitMs}ms`,
                resolvedError,
            );
            await wait(waitMs);
            continue;
        }
        if (timeoutId) clearTimeout(timeoutId);
        if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);

        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            const fallbackMessage = `${response.status} ${response.statusText}`.trim() || 'Request failed.';
            const info = parseProviderErrorInfo(bodyText, fallbackMessage);
            const isTransient = isTransientProviderError(response.status, info);
            if (!isTransient || attempt === maxAttempts) {
                throw buildProviderError(providerLabel, response.status, info);
            }

            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
            const isOverloaded = response.status === 529 || response.status === 503;
            const waitMs = Math.max(isOverloaded ? 3000 : 300, retryAfterMs ?? computeRetryDelayMs(attempt));
            console.warn(
                `[LLM:${providerLabel}] transient provider error "${info.type}" on attempt ${attempt}/${maxAttempts}; retrying in ${waitMs}ms`,
            );
            await wait(waitMs);
            continue;
        }

        try {
            return await response.json();
        } catch (err: any) {
            const parseError = err?.message || String(err);
            throw new Error(`${providerLabel} returned invalid JSON: ${parseError}`);
        }
    }

    throw new Error(`${providerLabel} request failed after ${maxAttempts} attempts.`);
}

/**
 * Walk from `startIdx` matching braces/brackets (respecting strings) and
 * return the end index of the balanced pair, or -1 if unmatched.
 */
function matchBraces(text: string, startIdx: number, openChar: string, closeChar: string): number {
    let depth = 0;
    let inStr = false;
    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') {
            inStr = true;
            continue;
        }
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * Try multiple brace-delimited candidates in `text` to find the best JSON.
 * The first `{` might be in reasoning text ("the user needs {focus}"), not the JSON payload.
 * Tries each `{` candidate, favoring ones that look like valid JSON objects (have known keys).
 */
function findBestJsonCandidate(text: string, rawText: any): string {
    // Collect all candidate { positions
    const candidates: { start: number; end: number; openChar: string; closeChar: string }[] = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
            const end = matchBraces(text, i, '{', '}');
            if (end > i) {
                candidates.push({ start: i, end, openChar: '{', closeChar: '}' });
                i = end; // skip past this candidate to avoid sub-objects
            }
        } else if (text[i] === '[' && candidates.length === 0) {
            // Only consider top-level arrays if no objects found yet
            const end = matchBraces(text, i, '[', ']');
            if (end > i) {
                candidates.push({ start: i, end, openChar: '[', closeChar: ']' });
                i = end;
            }
        }
    }

    if (candidates.length === 0) {
        console.error('[extractAndParseJSON] No JSON found in:', rawText);
        throw new Error('LLM returned no valid JSON. Check debug panel for raw response.');
    }

    // Prefer the candidate that looks most like real JSON (has common keys like "beats", "effects", "curves", "interventions", "channels")
    // Among matches, prefer the LAST one: models put reasoning/analysis first, actual response last.
    const jsonKeyPattern =
        /"(?:beats|effects|curves|interventions|channels|outro|text|substanceKey|action|name|key|effect|data)\s*"/;
    const matching = candidates.filter(c => jsonKeyPattern.test(text.substring(c.start, c.end + 1)));
    let best;
    if (matching.length > 0) {
        // Pick the last matching candidate (models output reasoning first, payload last)
        best = matching[matching.length - 1];
    } else {
        // No key matches — fall back to the last candidate overall
        best = candidates[candidates.length - 1];
    }
    return text.substring(best.start, best.end + 1);
}

/**
 * Detect truncated JSON responses (model hit max_tokens).
 * If the outermost `{` or `[` has no balanced closing counterpart,
 * throw immediately so the caller can fall back to another provider
 * rather than silently producing a degraded result.
 */
function rejectTruncatedJson(text: string): void {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    if (firstBrace < 0 && firstBracket < 0) return;

    const startIdx = firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;
    const openChar = text[startIdx] as '{' | '[';
    const closeChar = openChar === '{' ? '}' : ']';

    if (matchBraces(text, startIdx, openChar, closeChar) >= 0) return;

    throw new Error(
        'Truncated JSON response (model likely hit max_tokens). ' +
            'Outermost structure is unclosed — rejecting to trigger provider fallback.',
    );
}

/**
 * Robust JSON extraction + sanitization for LLM responses.
 * Handles markdown fences, conversational wrapping, trailing commas,
 * and unescaped double quotes inside string values.
 */
export function extractAndParseJSON(rawText: any) {
    let text = String(rawText ?? '').trim();
    if (!text) {
        console.error('[extractAndParseJSON] Empty or null response');
        throw new Error('LLM returned no valid JSON. Check debug panel for raw response.');
    }

    // 1. Strip markdown fences
    text = text
        .replace(/```(?:json|JSON)?\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

    // 1b. Strip XML-like tags that some models wrap around their response
    //     e.g. <response>...</response>, <json>...</json>, <output>...</output>
    text = text.replace(/<\/?(?:response|json|output|result|answer|data|thinking|antThinking)[^>]*>/gi, '').trim();

    // 1c. Truncation guard: if the outermost structure is unbalanced (model hit
    //     max_tokens), reject immediately so the provider fallback chain kicks in
    //     instead of silently extracting a degraded sub-object.
    rejectTruncatedJson(text);

    // 2. Extract a complete JSON object/array by matching braces/brackets.
    //    Try multiple candidates — the first '{' may be in reasoning text, not the actual JSON.
    text = findBestJsonCandidate(text, rawText);

    // 3. Fix trailing commas before } or ]
    text = text.replace(/,\s*([}\]])/g, '$1');

    // 3b. Fix missing commas between adjacent elements separated by whitespace/newlines
    //     Common LLM issue: numbers, objects, or arrays missing commas between them
    text = text.replace(/(\d)\s*\n\s*(\d)/g, '$1,\n$2');
    text = text.replace(/(\d)\s{2,}(\d)/g, '$1, $2');
    text = text.replace(/(})\s*\n\s*({)/g, '$1,\n$2');
    text = text.replace(/(])\s*\n\s*(\[)/g, '$1,\n$2');
    text = text.replace(new RegExp('("\\s*)\\n\\s*(")', 'g'), '$1,\n$2');
    // Also repair one-line outputs missing commas between closed array/object
    // elements, e.g. ...}{... or ...][... inside arrays.
    text = repairMissingArrayCommas(text);

    // 4. Fix smart/curly quotes → straight quotes
    text = text.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    text = text.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

    // 4b. Normalize JSON-like outputs that incorrectly use single-quoted keys/values.
    //     Some providers occasionally return JavaScript-style object literals.
    const singleQuoteNormalized = normalizeSingleQuotedJSON(text);
    const parseSource = singleQuoteNormalized || text;

    // 5. Attempt parse
    try {
        return JSON.parse(text);
    } catch (e1: any) {
        if (parseSource !== text) {
            try {
                return JSON.parse(parseSource);
            } catch (_) {}
        }
        // 6. Second pass: fix unescaped double quotes inside string values
        //    using a character-by-character state machine
        try {
            const fixed = fixUnescapedQuotes(parseSource);
            return JSON.parse(fixed);
        } catch (e2) {
            // 6b. Third pass: retry after structural comma repair
            try {
                const repaired = repairMissingArrayCommas(fixUnescapedQuotes(parseSource));
                return JSON.parse(repaired);
            } catch (_) {}
            // 7. Third pass: also fix unescaped newlines
            try {
                let fixed = fixUnescapedQuotes(parseSource);
                fixed = fixed.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
                return JSON.parse(fixed);
            } catch (e3) {
                // 8. Fourth pass: nuclear option — replace ALL double quotes inside
                //    known long-text field values with single quotes.
                //    Targets: full_context, rationale, label, text, intro, outro
                try {
                    const nuked = sanitizeLongTextFields(parseSource);
                    return JSON.parse(nuked);
                } catch (e4) {
                    console.error('[extractAndParseJSON] PARSE FAILED.\nError:', e1.message, '\nCleaned text:', text);
                    throw new Error('JSON parse error: ' + e1.message);
                }
            }
        }
    }
}

function findPrevNonWhitespace(text: string, idx: number): string {
    for (let i = idx - 1; i >= 0; i--) {
        const ch = text[i];
        if (!/\s/.test(ch)) return ch;
    }
    return '';
}

function isLikelySingleQuoteStart(text: string, idx: number): boolean {
    const prev = findPrevNonWhitespace(text, idx);
    return !prev || prev === '{' || prev === '[' || prev === ':' || prev === ',';
}

/**
 * Repairs JS-style single-quoted strings in otherwise JSON-like payloads.
 * Converts delimiters to standard double quotes while preserving apostrophes.
 */
function normalizeSingleQuotedJSON(json: string): string {
    if (!json.includes("'")) return json;

    const out: string[] = [];
    let inDouble = false;
    let inSingle = false;

    for (let i = 0; i < json.length; i++) {
        const ch = json[i];

        if (inDouble) {
            out.push(ch);
            if (ch === '\\') {
                if (i + 1 < json.length) {
                    i++;
                    out.push(json[i]);
                }
                continue;
            }
            if (ch === '"') inDouble = false;
            continue;
        }

        if (inSingle) {
            if (ch === '\\') {
                const next = i + 1 < json.length ? json[i + 1] : '';
                if (next) {
                    if (next === "'") {
                        out.push("'");
                    } else if (next === '"') {
                        out.push('\\', '"');
                    } else {
                        out.push('\\', next);
                    }
                    i++;
                    continue;
                }
                out.push('\\');
                continue;
            }

            if (ch === "'") {
                let peek = i + 1;
                while (peek < json.length && /\s/.test(json[peek])) peek++;
                const nextSig = peek < json.length ? json[peek] : '';
                if (nextSig === ',' || nextSig === '}' || nextSig === ']' || nextSig === ':' || nextSig === '') {
                    out.push('"');
                    inSingle = false;
                } else {
                    out.push("'");
                }
                continue;
            }

            if (ch === '"') {
                out.push('\\', '"');
                continue;
            }

            if (ch === '\n') {
                out.push('\\n');
                continue;
            }
            if (ch === '\r') {
                if (i + 1 < json.length && json[i + 1] === '\n') i++;
                out.push('\\n');
                continue;
            }
            if (ch === '\t') {
                out.push('\\t');
                continue;
            }

            out.push(ch);
            continue;
        }

        if (ch === '"') {
            inDouble = true;
            out.push(ch);
            continue;
        }

        if (ch === "'" && isLikelySingleQuoteStart(json, i)) {
            inSingle = true;
            out.push('"');
            continue;
        }

        out.push(ch);
    }

    if (inSingle) out.push('"');
    return out.join('');
}

/**
 * Walk JSON text character by character. When inside a string value,
 * if we hit a " that ISN'T followed by a JSON structural char (, : } ]),
 * it's an unescaped inner quote — replace it with an escaped \".
 */
export function fixUnescapedQuotes(json: any) {
    const out: any[] = [];
    let i = 0;
    const len = json.length;

    while (i < len) {
        const ch = json[i];

        if (ch === '"') {
            // Start of a JSON string — scan to find the real closing quote
            out.push('"');
            i++;
            while (i < len) {
                const c = json[i];
                if (c === '\\') {
                    // Escaped char — pass through both chars
                    out.push(c);
                    i++;
                    if (i < len) {
                        out.push(json[i]);
                        i++;
                    }
                    continue;
                }
                if (c === '"') {
                    // Is this the real closing quote or an unescaped inner quote?
                    // Peek ahead past whitespace to see what follows
                    let peek = i + 1;
                    while (
                        peek < len &&
                        (json[peek] === ' ' || json[peek] === '\t' || json[peek] === '\r' || json[peek] === '\n')
                    )
                        peek++;
                    const next = peek < len ? json[peek] : '';
                    // Structural chars that can follow a closing string quote
                    if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
                        // Real closing quote
                        out.push('"');
                        i++;
                        break;
                    } else {
                        // Inner unescaped quote — escape it
                        out.push('\\"');
                        i++;
                        continue;
                    }
                }
                out.push(c);
                i++;
            }
        } else {
            out.push(ch);
            i++;
        }
    }
    return out.join('');
}

function isJsonValueStart(ch: string): boolean {
    return (
        ch === '{' ||
        ch === '[' ||
        ch === '"' ||
        ch === '-' ||
        (ch >= '0' && ch <= '9') ||
        ch === 't' ||
        ch === 'f' ||
        ch === 'n'
    );
}

/**
 * Repairs missing commas between adjacent array elements while preserving
 * quoted strings. Targets patterns like:
 *   [{...}{...}]  -> [{...},{...}]
 *   [[...][...]]  -> [[...],[...]]
 */
function repairMissingArrayCommas(json: string): string {
    const out: string[] = [];
    const stack: string[] = [];
    let inString = false;

    for (let i = 0; i < json.length; i++) {
        const ch = json[i];
        out.push(ch);

        if (inString) {
            if (ch === '\\') {
                if (i + 1 < json.length) {
                    out.push(json[i + 1]);
                    i++;
                }
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{' || ch === '[') {
            stack.push(ch);
            continue;
        }

        if (ch === '}' || ch === ']') {
            if (stack.length > 0) stack.pop();

            // If parent container is an array, a following value start without
            // a comma is malformed and should be repaired.
            const parent = stack[stack.length - 1];
            if (parent === '[') {
                let j = i + 1;
                while (j < json.length && /\s/.test(json[j])) j++;
                if (j < json.length) {
                    const next = json[j];
                    if (next !== ',' && next !== ']' && isJsonValueStart(next)) {
                        out.push(',');
                    }
                }
            }
        }
    }

    return out.join('');
}

/**
 * Nuclear repair: for known long-text JSON fields (full_context, rationale, label, text, intro, outro),
 * find the field value and replace any unescaped inner double-quotes with single quotes.
 * This handles the edge case where fixUnescapedQuotes fails because an inner quote
 * is followed by a structural character (e.g., "zone," looks like end-of-string).
 */
function sanitizeLongTextFields(json: string): string {
    // Pattern: "fieldName" : "...value..."
    // We match the key, then scan forward to find the true closing quote by looking for
    // a quote followed by end-of-object patterns like  ",  or  "}  or  "]
    const textFields = /("(?:full_context|rationale|label|text|intro|outro)")\s*:\s*"/g;
    let result = json;
    let match;
    // Collect replacements (process in reverse order to preserve positions)
    const replacements: { start: number; end: number; replacement: string }[] = [];

    while ((match = textFields.exec(json)) !== null) {
        const valueStart = match.index + match[0].length; // position right after opening "
        // Scan forward to find the closing quote:
        // The real closing quote is a " that is followed (ignoring whitespace) by:
        //   ,  }  ]  or end-of-string
        // AND the character before it is NOT a backslash
        // We use a greedy approach: find the LAST " before the next key or structural boundary
        let depth = 0;
        let bestEnd = -1;
        for (let i = valueStart; i < json.length; i++) {
            const c = json[i];
            if (c === '\\') {
                i++;
                continue;
            } // skip escaped chars
            if (c === '"') {
                // Check if this could be the closing quote
                let peek = i + 1;
                while (peek < json.length && /\s/.test(json[peek])) peek++;
                const nc = peek < json.length ? json[peek] : '';
                // Closing quote patterns: followed by , } ] or next key ("key":)
                if (nc === ',' || nc === '}' || nc === ']' || nc === '') {
                    bestEnd = i;
                    break;
                }
                // Could also be followed by another key (end of this value, start of next pair)
                if (nc === '"') {
                    // Peek further: is this the start of a new key? (i.e., "newKey":)
                    let keyEnd = peek + 1;
                    while (keyEnd < json.length && json[keyEnd] !== '"' && json[keyEnd] !== '\n') keyEnd++;
                    if (keyEnd < json.length && json[keyEnd] === '"') {
                        let afterKey = keyEnd + 1;
                        while (afterKey < json.length && /\s/.test(json[afterKey])) afterKey++;
                        if (afterKey < json.length && json[afterKey] === ':') {
                            bestEnd = i;
                            break;
                        }
                    }
                }
                // Otherwise this is an inner quote — continue scanning
            }
        }
        if (bestEnd > valueStart) {
            const innerValue = json.substring(valueStart, bestEnd);
            // Replace all unescaped double quotes in the inner value with single quotes
            const sanitized = innerValue.replace(/(?<!\\)"/g, "'");
            if (sanitized !== innerValue) {
                replacements.push({ start: valueStart, end: bestEnd, replacement: sanitized });
            }
        }
    }

    // Apply replacements in reverse order
    for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        result = result.substring(0, r.start) + r.replacement + result.substring(r.end);
    }

    // Also fix trailing commas and newlines in the result
    result = result.replace(/,\s*([}\]])/g, '$1');
    result = result
        .replace(/\r\n/g, '\\n')
        .replace(/(?<!\\)\n/g, '\\n')
        .replace(/\t/g, '\\t');

    return result;
}

// Backward compat alias
export function parseJSONObjectResponse(text: any) {
    return extractAndParseJSON(text);
}

export async function callAnthropicGeneric(
    userPrompt: any,
    apiKey: any,
    model: any,
    systemPrompt: any,
    maxTokens: any,
    timeoutMs = REQUEST_TIMEOUT_FAST_MS,
) {
    const requestBody = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
    };
    try {
        const data = await fetchJsonWithRetry(
            API_ENDPOINTS.anthropic,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    ...(maxTokens > 4096 ? { 'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15' } : {}),
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify(requestBody),
            },
            'anthropic',
            2,
            timeoutMs,
        );
        // Find the text block — content may contain thinking blocks before the text block
        const textBlock = Array.isArray(data?.content) ? data.content.find((b: any) => b.type === 'text') : null;
        const responseText = textBlock?.text ?? data?.content?.[0]?.text;
        if (typeof responseText !== 'string' || !responseText.trim()) {
            throw new Error('anthropic request failed: response missing text content.');
        }
        const parsed = parseJSONObjectResponse(responseText);
        parsed._requestBody = requestBody;
        parsed._rawResponse = responseText;
        return parsed;
    } catch (err: any) {
        throw attachRequestContext(err, requestBody, err?._rawResponse);
    }
}

export async function callOpenAIGeneric(
    userPrompt: any,
    apiKey: any,
    model: any,
    endpoint: any,
    systemPrompt: any,
    maxTokens: any,
    providerLabel = 'openai',
    reasoningEffort?: string,
    timeoutMs = REQUEST_TIMEOUT_FAST_MS,
) {
    // OpenAI o-series reasoning models require max_completion_tokens and developer role.
    // Newer GPT models (4.1+, 5+) also require max_completion_tokens instead of max_tokens.
    // Grok uses the OpenAI-compatible API but still accepts max_tokens.
    const isOSeries = /^o\d/.test(model);
    const needsCompletionTokens = isOSeries || /^gpt-(4\.1|4\.5|5)/.test(model);
    const tokenKey = needsCompletionTokens && providerLabel !== 'grok' ? 'max_completion_tokens' : 'max_tokens';
    const sysRole = isOSeries ? 'developer' : 'system';
    // o-series reasoning tokens are counted within the completion budget — give extra headroom.
    const tokenBudget = isOSeries ? Math.min(maxTokens * 6, 25000) : maxTokens;

    const requestBody: any = {
        model,
        [tokenKey]: tokenBudget,
        messages: [
            { role: sysRole, content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    };
    const resolvedReasoningEffort = reasoningEffort || (isOSeries ? 'low' : '');
    if (resolvedReasoningEffort) {
        requestBody.reasoning_effort = resolvedReasoningEffort;
    }
    try {
        const data = await fetchJsonWithRetry(
            endpoint,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestBody),
            },
            providerLabel,
            2,
            timeoutMs,
        );
        // o-series may return output_text at top level, or standard choices array
        const responseText = data?.output_text ?? data?.choices?.[0]?.message?.content;
        if (typeof responseText !== 'string' || !responseText.trim()) {
            throw new Error(`${providerLabel} request failed: response missing assistant content.`);
        }
        const parsed = parseJSONObjectResponse(responseText);
        parsed._requestBody = requestBody;
        parsed._rawResponse = responseText;
        return parsed;
    } catch (err: any) {
        throw attachRequestContext(err, requestBody, err?._rawResponse);
    }
}

export async function callGeminiGeneric(
    userPrompt: any,
    apiKey: any,
    model: any,
    systemPrompt: any,
    maxTokens: any,
    timeoutMs = REQUEST_TIMEOUT_FAST_MS,
) {
    const selectedModel = String(model || '').trim();
    const requestBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: buildGeminiGenerationConfig(selectedModel, maxTokens),
    };
    try {
        const data = await fetchJsonWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            },
            'gemini',
            2,
            timeoutMs,
        );
        // When thinking is enabled, parts[0] is the reasoning (thought:true).
        // The actual answer is the last non-thought part.
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const answerPart = parts.filter((p: any) => !p.thought).pop() || parts[0];
        const responseText = answerPart?.text;
        if (typeof responseText !== 'string' || !responseText.trim()) {
            throw new Error('gemini request failed: response missing text content.');
        }
        const parsed = parseJSONObjectResponse(responseText);
        parsed._requestBody = requestBody;
        parsed._rawResponse = responseText;
        parsed._effectiveModel = selectedModel;
        return parsed;
    } catch (err: any) {
        throw attachRequestContext(err, requestBody, err?._rawResponse);
    }
}

// ============================================
// 10b. FAST MODEL — Effect Identification
// ============================================

export function buildFastModelSystemPrompt() {
    return interpolatePrompt(PROMPTS.fastModel, {
        maxEffects: AppState.maxEffects,
        badgeCategories: BADGE_CATEGORIES.join(', '),
    });
}

export async function callFastModel(prompt: string): Promise<StageResultMap['fast']> {
    const stageClass = 'fast-model';
    const systemPrompt = buildFastModelSystemPrompt();
    const userPrompt = prompt;

    const result = await runCachedStage<StageResultMap['fast']>({
        stage: 'fast',
        stageLabel: 'Fast Model',
        stageClass,
        systemPrompt,
        userPrompt,
        maxTokens: 1024,
    });

    return result;
}

// ============================================
// 10c. MAIN MODEL — Pharmacodynamic Curves
// ============================================

export function buildCurveModelSystemPrompt() {
    return interpolatePrompt(PROMPTS.curveModel, {
        maxEffects: AppState.maxEffects,
        maxEffectsPlural: AppState.maxEffects === 1 ? '' : 's',
    });
}

export async function callMainModelForCurves(prompt: string): Promise<StageResultMap['curves']> {
    const stageClass = 'main-model';
    const systemPrompt = buildCurveModelSystemPrompt();
    const userPrompt = prompt;

    const result = await runCachedStage<StageResultMap['curves']>({
        stage: 'curves',
        stageLabel: 'Main Model',
        stageClass,
        systemPrompt,
        userPrompt,
        maxTokens: 8192,
    });

    return result;
}

// ============================================
// 10d. EXTENDED STRATEGIST — Day-Level Curves
// ============================================

export async function callExtendedStrategist(prompt: string, durationDays: number): Promise<any> {
    const systemPrompt = interpolatePrompt(PROMPTS.curveModelExtended, {
        durationDays,
        userGoal: prompt,
    });
    const userPrompt = `Design a ${durationDays}-day pharmacodynamic landscape for: ${prompt}`;

    const result = await runCachedStage<any>({
        stage: 'curvesExtended',
        stageLabel: 'Extended Strategist',
        stageClass: 'extended-strategist',
        systemPrompt,
        userPrompt,
        maxTokens: 8192,
    });

    return result;
}

// ============================================
// 10e. EXTENDED CHESS PLAYER — Multi-Day Protocol
// ============================================

export async function callExtendedIntervention(
    prompt: string,
    durationDays: number,
    effectRoster: any[],
    phaseSpotlights: any[],
): Promise<any> {
    const extendedCurveSummary = JSON.stringify(
        effectRoster.map((e: any) => ({
            effect: e.effect,
            polarity: e.polarity,
            baselineSample: e.baseline.filter((_: any, i: number) => i % 7 === 0 || i === e.baseline.length - 1),
            desiredSample: e.desired.filter((_: any, i: number) => i % 7 === 0 || i === e.desired.length - 1),
        })),
    );
    const systemPrompt = interpolatePrompt(PROMPTS.interventionExtended, {
        durationDays,
        userGoal: prompt,
        substanceList: buildSubstanceListSummary(),
        extendedCurveSummary,
        phaseSpotlights: JSON.stringify(phaseSpotlights),
    });
    const userPrompt = `Design a ${durationDays}-day substance protocol for: ${prompt}`;

    const result = await runCachedStage<any>({
        stage: 'interventionExtended',
        stageLabel: 'Extended Chess Player',
        stageClass: 'extended-intervention',
        systemPrompt,
        userPrompt,
        maxTokens: 8192,
    });

    return result;
}

// ============================================
// 10f. EXTENDED SHERLOCK — Phase-Level Narration
// ============================================

export async function callExtendedSherlock(
    prompt: string,
    durationDays: number,
    effectRoster: any[],
    phaseSpotlights: any[],
    interventions: any[],
    protocolPhases: any[],
): Promise<any> {
    const phaseSummary = JSON.stringify(
        (protocolPhases.length > 0 ? protocolPhases : phaseSpotlights).map((p: any) => ({
            name: p.name || p.phase,
            startDay: p.startDay,
            endDay: p.endDay,
        })),
    );
    const effectSummary = JSON.stringify(
        effectRoster.map((e: any) => ({
            effect: e.effect,
            polarity: e.polarity,
        })),
    );
    const interventionSummary = JSON.stringify(
        interventions.slice(0, 20).map((iv: any) => ({
            key: iv.key,
            day: iv.day,
            dose: iv.dose,
            phase: iv.phase,
            frequency: iv.frequency,
        })),
    );

    const systemPrompt = interpolatePrompt(PROMPTS.sherlockExtended, {
        durationDays,
        userGoal: prompt,
        phaseSummary,
        effectSummary,
        interventionSummary,
    });
    const userPrompt = `Narrate the ${durationDays}-day protocol for: ${prompt}`;

    const result = await runCachedStage<any>({
        stage: 'sherlockExtended',
        stageLabel: 'Extended Sherlock',
        stageClass: 'extended-sherlock',
        systemPrompt,
        userPrompt,
        maxTokens: 4096,
    });

    return result;
}

// Prompt formatting helpers ================================

export function buildSubstanceListSummary(): string {
    const active = getActiveSubstances();
    const list = Object.entries(active).map(([key, s]: [string, any]) => {
        // Strip pharma fields the LLM doesn't need (strength is internal to pharma-model.ts curve scaling).
        // Keep rebound — it signals which substances cause rebound effects that need compensating.
        const { strength, ...llmPharma } = s.pharma || {};
        return {
            key,
            name: s.name,
            class: s.class,
            standardDose: s.standardDose,
            pharma: llmPharma,
        };
    });
    return JSON.stringify(list);
}

export function getRxInstructionSuffix(): string {
    if (AppState.rxMode === 'rx-only') {
        return '\n\nCRITICAL CONSTRAINT: The user has selected PRESCRIPTION-ONLY mode. You MUST only prescribe from the substances listed above — all of which are prescription (Rx) or controlled substances. Do NOT suggest any over-the-counter supplements, vitamins, or adaptogens. Focus exclusively on pharmaceutical interventions.';
    } else if (AppState.rxMode === 'rx') {
        return '\n\nNOTE: The user has enabled prescription and controlled substances. You may use any substance from the list, including Rx and controlled substances alongside supplements.';
    }
    return '';
}

export function buildSlimCurveSummary(curvesData: any[]): string {
    if (!curvesData) return '[]';
    const summary = curvesData.map((c: any) => ({
        effect: c.effect,
        polarity: c.polarity || 'higher_is_better',
        baseline: (c.baseline || []).filter((_: any, i: number) => i % 4 === 0),
        desired: (c.desired || []).filter((_: any, i: number) => i % 4 === 0),
    }));
    return JSON.stringify(summary);
}

export function buildFullCurveSummary(curvesData: any[]): string {
    if (!curvesData) return '[]';
    const summary = curvesData.map((c: any) => ({
        effect: c.effect,
        color: c.color,
        polarity: c.polarity || 'higher_is_better',
        baseline: c.baseline,
        desired: c.desired,
    }));
    return JSON.stringify(summary);
}

// ============================================
// 10d. INTERVENTION MODEL (Lx pipeline)
// ============================================

/** Summarize the baseline→desired gap at key hours for each effect curve.
 *  Injected into the Chess Player / Grandmaster prompts so the LLM can
 *  calibrate impact vectors to the actual gap magnitude. */
export function buildGapContext(curvesData: any[]): string {
    if (!curvesData) return '[]';
    const keyHours = [6, 8, 10, 12, 14, 16, 18, 20, 22, 0];
    return JSON.stringify(
        curvesData.map((c: any) => {
            const bl = c.baseline || [];
            const ds = c.desired || [];
            const gapByHour: Record<string, number> = {};
            for (const hour of keyHours) {
                const idx = bl.findIndex((p: any) => Math.abs(p.hour - hour) < 0.5);
                if (idx >= 0 && ds[idx]) {
                    gapByHour[`${hour}:00`] = Math.round(ds[idx].value - bl[idx].value);
                }
            }
            let maxGap = 0;
            for (let i = 0; i < bl.length && i < ds.length; i++) {
                maxGap = Math.max(maxGap, Math.abs((ds[i]?.value ?? 0) - (bl[i]?.value ?? 0)));
            }
            return { effect: c.effect, maxGap: Math.round(maxGap), gapByHour };
        }),
        null,
        1,
    );
}

export function buildInterventionSystemPrompt(userGoal: any, curvesData: any) {
    const protectedEffect = PhaseState.strategistProtectedEffect || '';
    const protectedBlock = protectedEffect ? `\nPROTECTED EFFECT (do not worsen this axis): ${protectedEffect}\n` : '';
    return (
        interpolatePrompt(PROMPTS.intervention, {
            userGoal: userGoal,
            substanceList: buildSubstanceListSummary(),
            curveSummary: buildFullCurveSummary(curvesData),
            gapContext: buildGapContext(curvesData),
        }) +
        protectedBlock +
        getRxInstructionSuffix()
    );
}

// ============================================
// Stacking validation + LLM correction loop
// ============================================

export const STACKING_THRESHOLD = 1.1;

/**
 * Check stacking of validated interventions against curvesData.
 * Returns a human-readable correction prompt if any curve's peak normSum > threshold,
 * or null if stacking is acceptable.
 */
export function buildStackingCorrectionPrompt(interventions: any[], curvesData: any[]): string | null {
    const validated = validateInterventions(interventions, curvesData);
    if (validated.length === 0) return null;

    const reports = computeStackingPeaks(validated, curvesData);
    const violations = reports.filter(r => Math.abs(r.peakNormSum) > STACKING_THRESHOLD);
    if (violations.length === 0) {
        for (const r of reports) {
            console.log(`[Stacking] Curve "${r.curve}" peakNormSum=${r.peakNormSum} at ${r.peakHour}:00 — OK`);
        }
        return null;
    }

    const lines = ['STACKING OVERSHOOT DETECTED — your protocol exceeds the desired curve on these axes:'];
    for (const v of violations) {
        const hourStr = v.peakHour >= 24 ? `${v.peakHour - 24}:00+1` : `${v.peakHour}:00`;
        lines.push(`\n• ${v.curve}: peak stacked impact = ${v.peakNormSum} at ${hourStr}`);
        for (const b of v.breakdown) {
            lines.push(`  - ${b.key}: contribution ${b.contribution}`);
        }
        lines.push(`  (Target: ≤ 1.0)`);
        console.warn(`[Stacking] Curve "${v.curve}" peakNormSum=${v.peakNormSum} at ${hourStr} — OVERSHOOT`);
    }
    lines.push(
        '\nReduce individual impact values so the peak stacked impact on EACH curve stays between 0.8 and 1.0. ' +
            'The more substances overlapping on one axis, the smaller each impact must be. ' +
            'Output the complete corrected interventions array as JSON.',
    );
    return lines.join('\n');
}

/**
 * After an LLM returns interventions, validate stacking and make one correction call if needed.
 * Returns the (possibly corrected) result.
 */
async function correctStackingIfNeeded(
    result: StageResultMap['intervention'],
    curvesData: any[],
    systemPrompt: string,
    stageOpts: { stageLabel: string; stageClass: string; maxTokens: number },
): Promise<StageResultMap['intervention']> {
    const interventions = result.interventions || [];
    if (interventions.length === 0) return result;

    const correctionPrompt = buildStackingCorrectionPrompt(interventions, curvesData);
    if (!correctionPrompt) return result;

    console.log(`[Stacking] Correction needed — calling LLM for adjustment (${stageOpts.stageLabel})`);

    const originalJson = JSON.stringify(
        interventions.map((iv: any) => ({
            key: iv.key,
            dose: iv.dose,
            doseMultiplier: iv.doseMultiplier,
            timeMinutes: iv.timeMinutes,
            impacts: iv.impacts,
            rationale: iv.rationale,
        })),
        null,
        1,
    );

    const correctionUserPrompt =
        `Your previous protocol output:\n\`\`\`json\n${originalJson}\n\`\`\`\n\n` + correctionPrompt;

    try {
        const corrected = await callStageWithFallback<StageResultMap['intervention']>({
            stage: 'intervention',
            stageLabel: `${stageOpts.stageLabel} (stacking correction)`,
            stageClass: stageOpts.stageClass,
            systemPrompt,
            userPrompt: correctionUserPrompt,
            maxTokens: stageOpts.maxTokens,
        });

        // Validate the corrected result has interventions
        const correctedIvs = corrected?.interventions || [];
        if (correctedIvs.length >= 2) {
            // Log the corrected stacking
            const revalidated = validateInterventions(correctedIvs, curvesData);
            const newReports = computeStackingPeaks(revalidated, curvesData);
            for (const r of newReports) {
                console.log(`[Stacking] Corrected "${r.curve}" peakNormSum=${r.peakNormSum} at ${r.peakHour}:00`);
            }
            return corrected;
        }

        console.warn('[Stacking] Correction produced < 2 interventions — keeping original');
        return result;
    } catch (err) {
        console.warn('[Stacking] Correction call failed — keeping original:', err);
        return result;
    }
}

export async function callInterventionModel(prompt: string, curvesData: any): Promise<StageResultMap['intervention']> {
    const stageClass = 'intervention-model';
    const systemPrompt = buildInterventionSystemPrompt(prompt, curvesData);
    const userPrompt =
        'Analyze the baseline vs desired curves and prescribe the optimal supplement intervention protocol.';

    // Check if this will be a cache hit — skip correction for cached results
    const isCached = LLMCache.isEnabled(stageClass) && LLMCache.hasData(stageClass);

    let result = await runCachedStage<StageResultMap['intervention']>({
        stage: 'intervention',
        stageLabel: 'Intervention Model',
        stageClass,
        systemPrompt,
        userPrompt,
        maxTokens: 8192,
    });

    // Stacking correction loop — only for fresh LLM calls
    if (!isCached && curvesData) {
        result = await correctStackingIfNeeded(result, curvesData, systemPrompt, {
            stageLabel: 'Chess Player',
            stageClass,
            maxTokens: 8192,
        });

        // Concurrent density pruning — remove low-value substances from over-dense clusters
        if (result.interventions?.length) {
            const validated = validateInterventions(result.interventions, curvesData);
            const { pruned, removed } = pruneConcurrentOverload(validated, curvesData);
            if (removed.length > 0) {
                result = { ...result, interventions: pruned };
                // Re-validate stacking after rescaling
                result = await correctStackingIfNeeded(result, curvesData, systemPrompt, {
                    stageLabel: 'Chess Player (post-prune)',
                    stageClass,
                    maxTokens: 8192,
                });
            }
        }

        // Persist the finalized payload, not the pre-correction draft cached by runCachedStage().
        // Otherwise saved/replayed cycles can reuse stale impact vectors while the live run used
        // the corrected intervention set to render the Lx curves.
        persistPostProcessedStageResult(stageClass, systemPrompt, userPrompt, result);
    }

    PhaseState.interventionResult = result;
    return result;
}

// ============================================
// REVISION MODEL — Biometric-Informed Re-evaluation
// ============================================

function buildBiometricSummary() {
    const channels = BiometricState.channels;
    if (!channels || channels.length === 0) return 'No biometric data available.';
    return channels
        .map((ch: any) => {
            const data = ch.data || [];
            const hourly = data.filter((_: any, i: number) => i % 4 === 0);
            const values = hourly.map((p: any) => `${p.hour}h:${Math.round(p.value)}`).join(', ');
            return `${ch.metric || ch.displayName || ch.signal} (${ch.unit}): [${values}]`;
        })
        .join('\n');
}

export function buildRevisionSystemPrompt(userGoal: any, referenceBundle: RevisionReferenceBundle) {
    const currentCorrectedInterventions = JSON.stringify(
        serializeRevisionInterventions(referenceBundle.currentInterventions || []),
    );
    const currentStateSummary = JSON.stringify(buildRevisionCurrentStateSummary(referenceBundle));
    const gapSummary = JSON.stringify(buildRevisionPromptGapSummary(referenceBundle));

    // Serialize spotter highlights as concise externality list for the grandmaster
    const highlights = BiometricState.spotterHighlights || [];
    const spotterHighlights =
        highlights.length > 0
            ? highlights
                  .map((h: any) => {
                      const hStr =
                          h.hour >= 24
                              ? `${Math.floor(h.hour - 24)}:${String(Math.round((h.hour % 1) * 60)).padStart(2, '0')}am+1`
                              : `${Math.floor(h.hour)}:${String(Math.round((h.hour % 1) * 60)).padStart(2, '0')}`;
                      return `${h.icon || '•'} ${hStr} — ${h.label} (${h.impact} on ${h.channel})`;
                  })
                  .join('\n')
            : 'No external events reported.';

    const protectedEffect = PhaseState.strategistProtectedEffect || '';
    const protectedBlock = protectedEffect ? `\nPROTECTED EFFECT (do not worsen this axis): ${protectedEffect}\n` : '';

    let revisionPrompt =
        interpolatePrompt(PROMPTS.revision, {
            userGoal,
            currentCorrectedInterventions,
            currentStateSummary,
            gapSummary,
            biometricSummary: buildBiometricSummary(),
            spotterHighlights,
            substanceList: buildSubstanceListSummary(),
        }) +
        protectedBlock +
        getRxInstructionSuffix();

    // Inject selected creator agent mandate as co-pilot context
    if (AgentMatchState.selectedAgent?.mandate) {
        const agent = AgentMatchState.selectedAgent;
        revisionPrompt += `\n\nCREATOR AGENT CO-PILOT (${agent.meta.creatorHandle} — ${agent.meta.name}):\nThe user has selected this creator agent to guide the revision. Honor their philosophy and approach:\n${agent.mandate}`;
    }

    return revisionPrompt;
}

export async function callRevisionModel(
    userGoal: any,
    referenceBundle: RevisionReferenceBundle,
): Promise<StageResultMap['revision']> {
    const stageClass = 'revision-model';
    const systemPrompt = buildRevisionSystemPrompt(userGoal, referenceBundle);
    const userPrompt = 'Revise the intervention protocol based on the biometric feedback. Respond with JSON only.';

    const isCached = LLMCache.isEnabled(stageClass) && LLMCache.hasData(stageClass);

    let result = await runCachedStage<StageResultMap['revision']>({
        stage: 'revision',
        stageLabel: 'Revision Model',
        stageClass,
        systemPrompt,
        userPrompt,
        maxTokens: 8192,
    });

    // Stacking correction loop — only for fresh LLM calls
    if (!isCached && PhaseState.curvesData) {
        result = await correctStackingIfNeeded(result, PhaseState.curvesData, systemPrompt, {
            stageLabel: 'Grandmaster',
            stageClass,
            maxTokens: 8192,
        });

        // Concurrent density pruning — remove low-value substances from over-dense clusters
        if (result.interventions?.length) {
            const validated = validateInterventions(result.interventions, PhaseState.curvesData);
            const { pruned, removed } = pruneConcurrentOverload(validated, PhaseState.curvesData);
            if (removed.length > 0) {
                result = { ...result, interventions: pruned };
                result = await correctStackingIfNeeded(result, PhaseState.curvesData, systemPrompt, {
                    stageLabel: 'Grandmaster (post-prune)',
                    stageClass,
                    maxTokens: 8192,
                });
            }
        }

        // Keep the persisted bundle aligned with the corrected revision actually rendered live.
        persistPostProcessedStageResult(stageClass, systemPrompt, userPrompt, result);
    }

    return result;
}

// ============================================
// STRATEGIST BIO MODEL — Biometric-Informed Baseline Correction
// ============================================

function buildStrategistBioSystemPrompt(userGoal: any, curvesData: any) {
    const baselineCurves = curvesData.map((c: any) => ({
        effect: c.effect,
        baseline: c.baseline,
    }));
    const desiredCurves = curvesData.map((c: any) => ({
        effect: c.effect,
        desired: c.desired,
    }));

    const biometricSummary = buildBiometricSummary();

    return interpolatePrompt(PROMPTS.strategistBio, {
        userGoal,
        baselineCurves: JSON.stringify(baselineCurves),
        desiredCurves: JSON.stringify(desiredCurves),
        biometricSummary,
        profileText: BiometricState.profileText || 'No profile available.',
    });
}

export async function callStrategistBioModel(userGoal: any, curvesData: any): Promise<StageResultMap['strategistBio']> {
    const stageClass = 'strategist-bio-model';
    const systemPrompt = buildStrategistBioSystemPrompt(userGoal, curvesData);
    const userPrompt = 'Analyze the biometric data and output bio-corrected baseline curves.';

    const result = await runCachedStage<StageResultMap['strategistBio']>({
        stage: 'strategistBio',
        stageLabel: 'Strategist Bio',
        stageClass,
        systemPrompt,
        userPrompt,
        maxTokens: 4096,
    });

    return result;
}

export interface StageOptions<TResult> {
    stage: PipelineStage | string;
    stageLabel: string;
    stageClass: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
}

export function persistPostProcessedStageResult<TResult>(
    stageClass: string,
    systemPrompt: string,
    userPrompt: string,
    result: TResult,
): void {
    LLMCache.set(stageClass, result, {
        systemPrompt: `${systemPrompt}\n\n${JSON_POSTAMBLE}`,
        userPrompt,
        requestBody: null,
    });
}

/**
 * Shared helper that wraps callStageWithFallback with cache hit/miss resolution,
 * JSON postamble appendage, and DebugLog entry creation.
 */
export async function runCachedStage<TResult>(opts: StageOptions<TResult>): Promise<TResult> {
    const finalSystemPrompt = `${opts.systemPrompt}\n\n${JSON_POSTAMBLE}`;

    if (LLMCache.isEnabled(opts.stageClass) && LLMCache.hasData(opts.stageClass)) {
        const cached = resolveCachedStageHit<TResult>(opts.stageClass, finalSystemPrompt, opts.userPrompt);
        if (!cached) {
            LLMCache.clear(opts.stageClass);
        } else {
            DebugLog.addEntry({
                stage: opts.stageLabel,
                stageClass: opts.stageClass,
                model: 'cached',
                provider: 'local',
                systemPrompt: cached.systemPrompt,
                userPrompt: cached.userPrompt,
                requestBody: cached.requestBody,
                loading: false,
                response: cached.payload,
                duration: 0,
                cache: cached.cache,
            });
            return cached.payload;
        }
    }

    const result = await callStageWithFallback<TResult>({
        ...opts,
        systemPrompt: opts.systemPrompt, // Let callStageWithFallback use original for display/sending? No, send final
        // Actually callStageWithFallback does NOT append the postamble anymore, so we must pass it here:
        // Wait, for clarity, let's just pass the original systemPrompt to callStageWithFallback,
        // and we already modified callStageWithFallback to append the postamble before sending over the wire.
        // Wait, I did that previously, let's verify. Yes, callStageWithFallback line 1040 is `const finalSystemPrompt = ...`.
        // So we ONLY need to pass the normal systemPrompt to callStageWithFallback.
    });

    LLMCache.set(opts.stageClass, result, {
        systemPrompt: finalSystemPrompt,
        userPrompt: opts.userPrompt,
        requestBody: null,
    });

    return result;
}

// ============================================
// SHERLOCK MODEL — Intervention Narration (Stage 3.5)
// ============================================

export function buildSherlockSystemPrompt(userGoal: any, interventions: any, curvesData: any) {
    const selectedSubstanceInfo = interventions.map((iv: any) => ({
        key: iv.key,
        name: iv.substance?.name,
        class: iv.substance?.class,
        dose: iv.dose,
        timeMinutes: iv.timeMinutes,
        pharma: iv.substance?.pharma,
    }));

    return interpolatePrompt(PROMPTS.sherlock, {
        userGoal,
        interventionSummary: JSON.stringify(
            interventions.map((iv: any) => ({
                key: iv.key,
                dose: iv.dose,
                timeMinutes: iv.timeMinutes,
                impacts: iv.impacts,
                rationale: iv.rationale,
            })),
            null,
            1,
        ),
        interventionRationale: PhaseState.interventionResult?.rationale || '',
        selectedSubstanceInfo: JSON.stringify(selectedSubstanceInfo),
        curveSummary: buildSlimCurveSummary(curvesData),
        substanceCount: String(interventions.length),
    });
}

export async function callSherlockModel(userGoal: any, interventions: any, curvesData: any) {
    const stageClass = 'sherlock-model';
    const systemPrompt = buildSherlockSystemPrompt(userGoal, interventions, curvesData);
    const userPrompt =
        'Narrate the intervention protocol in Sherlock style. Lead each beat with the intended effect, then mention the substance.';

    if (LLMCache.isEnabled(stageClass) && LLMCache.hasData(stageClass)) {
        const cached = resolveCachedStageHit<StageResultMap['sherlock']>(
            stageClass,
            `${systemPrompt}\n\n${JSON_POSTAMBLE}`,
            userPrompt,
        );
        if (!cached) {
            LLMCache.clear(stageClass);
        } else {
            DebugLog.addEntry({
                stage: 'Sherlock Narration',
                stageClass,
                model: 'cached',
                provider: 'local',
                systemPrompt: cached.systemPrompt,
                userPrompt: cached.userPrompt,
                requestBody: cached.requestBody,
                loading: false,
                response: cached.payload,
                duration: 0,
                cache: cached.cache,
            });
            return cached.payload;
        }
    }

    const result = await callStageWithFallback<StageResultMap['sherlock']>({
        stage: 'sherlock',
        stageLabel: 'Sherlock Narration',
        stageClass,
        systemPrompt,
        userPrompt,
        maxTokens: 2048,
    });
    LLMCache.set(stageClass, result, {
        systemPrompt: `${systemPrompt}\n\n${JSON_POSTAMBLE}`,
        userPrompt,
        requestBody: null,
    });
    return result;
}

// ============================================
// SHERLOCK REVISION MODEL — Revision Narration (Stage 5.5)
// ============================================

export function buildSherlockRevisionSystemPrompt(userGoal: any, oldIvs: any, newIvs: any, diff: any, curvesData: any) {
    const biometricSummary = buildBiometricSummary();
    const revisionDiff = diff.map((d: any) => ({
        type: d.type,
        substanceKey: (d.oldIv || d.newIv).key,
        substanceName: (d.oldIv || d.newIv).substance?.name || (d.oldIv || d.newIv).key,
        ...(d.oldIv ? { oldTime: d.oldIv.timeMinutes, oldDose: d.oldIv.dose } : {}),
        ...(d.newIv ? { newTime: d.newIv.timeMinutes, newDose: d.newIv.dose } : {}),
    }));

    return interpolatePrompt(PROMPTS.sherlockRevision, {
        userGoal,
        originalInterventions: JSON.stringify(
            oldIvs.map((iv: any) => ({
                key: iv.key,
                dose: iv.dose,
                timeMinutes: iv.timeMinutes,
            })),
            null,
            1,
        ),
        revisedInterventions: JSON.stringify(
            newIvs.map((iv: any) => ({
                key: iv.key,
                dose: iv.dose,
                timeMinutes: iv.timeMinutes,
            })),
            null,
            1,
        ),
        revisionDiff: JSON.stringify(revisionDiff),
        biometricSummary,
    });
}

export async function callSherlockRevisionModel(userGoal: any, oldIvs: any, newIvs: any, diff: any, curvesData: any) {
    const stageClass = 'sherlock-revision-model';
    const systemPrompt = buildSherlockRevisionSystemPrompt(userGoal, oldIvs, newIvs, diff, curvesData);
    const userPrompt =
        'Narrate the protocol revision based on biometric feedback. Lead each beat with the intended correction effect, then mention the substance/action.';

    const result = await runCachedStage<StageResultMap['sherlockRevision']>({
        stage: 'sherlockRevision',
        stageLabel: 'Sherlock (Revision)',
        stageClass,
        systemPrompt,
        userPrompt,
        maxTokens: 2048,
    });

    return result;
}

export function guessDose(substance: any) {
    // Prefer the standardDose from the new database
    if (substance.standardDose) return substance.standardDose;
    const doses: any = {
        caffeine: '200mg',
        theanine: '400mg',
        rhodiola: '500mg',
        ashwagandha: '600mg',
        tyrosine: '1000mg',
        citicoline: '500mg',
        alphaGPC: '600mg',
        lionsMane: '1000mg',
        magnesium: '400mg',
        creatine: '5g',
        nac: '600mg',
        glycine: '3g',
        melatonin: '3mg',
        gaba: '750mg',
        apigenin: '50mg',
        taurine: '2g',
    };
    return (
        doses[substance.name?.toLowerCase()] ||
        doses[Object.keys(doses).find(k => substance.name?.toLowerCase().includes(k)) as string] ||
        '500mg'
    );
}
