import { API_ENDPOINTS } from './constants';
import { AppState, PhaseState, BiometricState, SherlockState, getStageModel } from './state';
import { interpolatePrompt } from './utils';
import { PROMPTS } from './prompts';
import { DebugLog } from './debug-panel';
import { getActiveSubstances } from './substances';

export { getStageModel } from './state';

async function callGeneric(userPrompt: any, key: any, model: any, type: any, provider: any, systemPrompt: any, maxTokens: any) {
    switch (type) {
        case 'anthropic':
            return callAnthropicGeneric(userPrompt, key, model, systemPrompt, maxTokens);
        case 'openai':
            return callOpenAIGeneric(userPrompt, key, model,
                provider === 'grok' ? API_ENDPOINTS.grok : API_ENDPOINTS.openai,
                systemPrompt, maxTokens,
                provider === 'grok' ? 'grok' : 'openai');
        case 'gemini':
            return callGeminiGeneric(userPrompt, key, model, systemPrompt, maxTokens);
        default:
            return callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.openai, systemPrompt, maxTokens, 'openai');
    }
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
    return /(overload|overloaded|rate limit|too many requests|temporar|try again|busy|unavailable|timeout|timed out|capacity)/i.test(info.message || '');
}

function isTransientNetworkError(err: any) {
    const name = String(err?.name || '');
    const message = String(err?.message || err || '');
    if (name === 'TypeError' || name === 'AbortError') return true;
    return /(failed to fetch|network|load failed|timed out|timeout|connection|econnreset|enotfound|service unavailable)/i.test(message);
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

async function fetchJsonWithRetry(endpoint: string, init: RequestInit, providerLabel: string, maxAttempts = 4) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response: Response;
        try {
            response = await fetch(endpoint, init);
        } catch (err: any) {
            if (!isTransientNetworkError(err) || attempt === maxAttempts) {
                throw (err instanceof Error ? err : new Error(String(err)));
            }
            const waitMs = computeRetryDelayMs(attempt);
            console.warn(`[LLM:${providerLabel}] transient network error on attempt ${attempt}/${maxAttempts}; retrying in ${waitMs}ms`, err);
            await wait(waitMs);
            continue;
        }

        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            const fallbackMessage = `${response.status} ${response.statusText}`.trim() || 'Request failed.';
            const info = parseProviderErrorInfo(bodyText, fallbackMessage);
            const isTransient = isTransientProviderError(response.status, info);
            if (!isTransient || attempt === maxAttempts) {
                throw buildProviderError(providerLabel, response.status, info);
            }

            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
            const waitMs = Math.max(300, retryAfterMs ?? computeRetryDelayMs(attempt));
            console.warn(`[LLM:${providerLabel}] transient provider error "${info.type}" on attempt ${attempt}/${maxAttempts}; retrying in ${waitMs}ms`);
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
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
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
    const jsonKeyPattern = /"(?:beats|effects|curves|interventions|channels|outro|text|substanceKey|action|name|key|effect|data)\s*"/;
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
    text = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```\s*/g, '').trim();

    // 1b. Strip XML-like tags that some models wrap around their response
    //     e.g. <response>...</response>, <json>...</json>, <output>...</output>
    text = text.replace(/<\/?(?:response|json|output|result|answer|data|thinking|antThinking)[^>]*>/gi, '').trim();

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

    // 5. Attempt parse
    try {
        return JSON.parse(text);
    } catch (e1: any) {
        // 6. Second pass: fix unescaped double quotes inside string values
        //    using a character-by-character state machine
        try {
            const fixed = fixUnescapedQuotes(text);
            return JSON.parse(fixed);
        } catch (e2) {
            // 6b. Third pass: retry after structural comma repair
            try {
                const repaired = repairMissingArrayCommas(fixUnescapedQuotes(text));
                return JSON.parse(repaired);
            } catch (_) { }
            // 7. Third pass: also fix unescaped newlines
            try {
                let fixed = fixUnescapedQuotes(text);
                fixed = fixed.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
                return JSON.parse(fixed);
            } catch (e3) {
                // 8. Fourth pass: nuclear option — replace ALL double quotes inside
                //    known long-text field values with single quotes.
                //    Targets: full_context, rationale, label, text, intro, outro
                try {
                    const nuked = sanitizeLongTextFields(text);
                    return JSON.parse(nuked);
                } catch (e4) {
                    console.error('[extractAndParseJSON] PARSE FAILED.\nError:', e1.message, '\nCleaned text:', text);
                    throw new Error('JSON parse error: ' + e1.message);
                }
            }
        }
    }
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
                    if (i < len) { out.push(json[i]); i++; }
                    continue;
                }
                if (c === '"') {
                    // Is this the real closing quote or an unescaped inner quote?
                    // Peek ahead past whitespace to see what follows
                    let peek = i + 1;
                    while (peek < len && (json[peek] === ' ' || json[peek] === '\t' || json[peek] === '\r' || json[peek] === '\n')) peek++;
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
    return ch === '{'
        || ch === '['
        || ch === '"'
        || ch === '-'
        || (ch >= '0' && ch <= '9')
        || ch === 't'
        || ch === 'f'
        || ch === 'n';
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
            if (c === '\\') { i++; continue; } // skip escaped chars
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
    result = result.replace(/\r\n/g, '\\n').replace(/(?<!\\)\n/g, '\\n').replace(/\t/g, '\\t');

    return result;
}


// Backward compat alias
export function parseJSONObjectResponse(text: any) {
    return extractAndParseJSON(text);
}

export async function callAnthropicGeneric(userPrompt: any, apiKey: any, model: any, systemPrompt: any, maxTokens: any) {
    const requestBody = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
    };
    const data = await fetchJsonWithRetry(
        API_ENDPOINTS.anthropic,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                ...((maxTokens > 4096) ? { 'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15' } : {}),
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(requestBody),
        },
        'anthropic',
    );
    // Find the text block — content may contain thinking blocks before the text block
    const textBlock = Array.isArray(data?.content)
        ? data.content.find((b: any) => b.type === 'text')
        : null;
    const responseText = textBlock?.text ?? data?.content?.[0]?.text;
    if (typeof responseText !== 'string' || !responseText.trim()) {
        throw new Error('anthropic request failed: response missing text content.');
    }
    try {
        const parsed = parseJSONObjectResponse(responseText);
        parsed._requestBody = requestBody;
        parsed._rawResponse = responseText;
        return parsed;
    } catch (parseErr: any) {
        parseErr._rawResponse = responseText;
        parseErr._requestBody = requestBody;
        throw parseErr;
    }
}

export async function callOpenAIGeneric(userPrompt: any, apiKey: any, model: any, endpoint: any, systemPrompt: any, maxTokens: any, providerLabel = 'openai') {
    // OpenAI o-series reasoning models require max_completion_tokens and developer role
    const isOSeries = /^o\d/.test(model);
    const tokenKey = isOSeries ? 'max_completion_tokens' : 'max_tokens';
    const sysRole = isOSeries ? 'developer' : 'system';

    const requestBody: any = {
        model,
        [tokenKey]: maxTokens,
        messages: [
            { role: sysRole, content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    };
    const data = await fetchJsonWithRetry(
        endpoint,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        },
        providerLabel,
    );
    // o-series may return output_text at top level, or standard choices array
    const responseText = data?.output_text
        ?? data?.choices?.[0]?.message?.content;
    if (typeof responseText !== 'string' || !responseText.trim()) {
        throw new Error(`${providerLabel} request failed: response missing assistant content.`);
    }
    try {
        const parsed = parseJSONObjectResponse(responseText);
        parsed._requestBody = requestBody;
        parsed._rawResponse = responseText;
        return parsed;
    } catch (parseErr: any) {
        parseErr._rawResponse = responseText;
        parseErr._requestBody = requestBody;
        throw parseErr;
    }
}

export async function callGeminiGeneric(userPrompt: any, apiKey: any, model: any, systemPrompt: any, maxTokens: any) {
    const requestBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
    };
    const data = await fetchJsonWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        },
        'gemini',
    );
    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof responseText !== 'string' || !responseText.trim()) {
        throw new Error('gemini request failed: response missing text content.');
    }
    try {
        const parsed = parseJSONObjectResponse(responseText);
        parsed._requestBody = requestBody;
        parsed._rawResponse = responseText;
        return parsed;
    } catch (parseErr: any) {
        parseErr._rawResponse = responseText;
        parseErr._requestBody = requestBody;
        throw parseErr;
    }
}

// ============================================
// 10b. FAST MODEL — Effect Identification
// ============================================

export function buildFastModelSystemPrompt() {
    return interpolatePrompt(PROMPTS.fastModel, {
        maxEffects: AppState.maxEffects,
    });
}

export async function callFastModel(prompt: any) {
    const { model, type, provider, key } = getStageModel('fast');
    if (!key) throw new Error(`No API key configured for ${provider}. Add your key in Settings.`);

    const systemPrompt = buildFastModelSystemPrompt();
    const debugEntry = DebugLog.addEntry({
        stage: 'Fast Model', stageClass: 'fast-model', model,
        systemPrompt, userPrompt: prompt, loading: true,
    });
    const startTime = performance.now();

    try {
        const result = await callGeneric(prompt, key, model, type, provider, systemPrompt, 1024);
        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;
        DebugLog.updateEntry(debugEntry, {
            loading: false, requestBody, rawResponse, response: result,
            duration: Math.round(performance.now() - startTime),
        });
        return result;
    } catch (err: any) {
        DebugLog.updateEntry(debugEntry, {
            loading: false, error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err instanceof Error ? err : new Error('Fast model failed: ' + String(err));
    }
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

export async function callMainModelForCurves(prompt: any) {
    const { model, type, provider, key } = getStageModel('curves');
    if (!key) throw new Error(`No API key configured for ${provider}. Add your key in Settings.`);

    const systemPrompt = buildCurveModelSystemPrompt();
    const debugEntry = DebugLog.addEntry({
        stage: 'Main Model', stageClass: 'main-model', model,
        systemPrompt, userPrompt: prompt, loading: true,
    });
    const startTime = performance.now();

    try {
        const result = await callGeneric(prompt, key, model, type, provider, systemPrompt, 8192);
        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;
        DebugLog.updateEntry(debugEntry, {
            loading: false, requestBody, rawResponse, response: result,
            duration: Math.round(performance.now() - startTime),
        });
        return result;
    } catch (err: any) {
        DebugLog.updateEntry(debugEntry, {
            loading: false, error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err instanceof Error ? err : new Error('Main model failed: ' + String(err));
    }
}

// ============================================
// 10d. INTERVENTION MODEL (Lx pipeline)
// ============================================

export function buildInterventionSystemPrompt(userGoal: any, curvesData: any) {
    // Serialize substance database for the LLM
    const active = getActiveSubstances();
    const substanceList = Object.entries(active).map(([key, s]: [string, any]) => ({
        key,
        name: s.name,
        class: s.class,
        standardDose: s.standardDose,
        pharma: s.pharma,
    }));

    const curveSummary = curvesData.map((c: any) => ({
        effect: c.effect,
        color: c.color,
        polarity: c.polarity || 'higher_is_better',
        baseline: c.baseline,
        desired: c.desired,
    }));

    let rxInstruction = '';
    if (AppState.rxMode === 'rx-only') {
        rxInstruction = '\n\nCRITICAL CONSTRAINT: The user has selected PRESCRIPTION-ONLY mode. You MUST only prescribe from the substances listed above — all of which are prescription (Rx) or controlled substances. Do NOT suggest any over-the-counter supplements, vitamins, or adaptogens. Focus exclusively on pharmaceutical interventions.';
    } else if (AppState.rxMode === 'rx') {
        rxInstruction = '\n\nNOTE: The user has enabled prescription and controlled substances. You may use any substance from the list, including Rx and controlled substances alongside supplements.';
    }

    return interpolatePrompt(PROMPTS.intervention, {
        userGoal: userGoal,
        substanceList: JSON.stringify(substanceList, null, 1),
        curveSummary: JSON.stringify(curveSummary, null, 1),
    }) + rxInstruction;
}

export async function callInterventionModel(prompt: any, curvesData: any) {
    const { model, type, provider, key } = getStageModel('intervention');
    if (!key) throw new Error(`No API key configured for ${provider}. Add one in Settings.`);

    const systemPrompt = buildInterventionSystemPrompt(prompt, curvesData);
    const userPrompt = 'Analyze the baseline vs desired curves and prescribe the optimal supplement intervention protocol. Respond with JSON only.';
    const debugEntry = DebugLog.addEntry({
        stage: 'Intervention Model', stageClass: 'intervention-model',
        model, systemPrompt, userPrompt, loading: true,
    });
    const startTime = performance.now();

    try {
        const result = await callGeneric(userPrompt, key, model, type, provider, systemPrompt, 4096);
        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;
        DebugLog.updateEntry(debugEntry, {
            loading: false, requestBody, rawResponse, response: result,
            duration: Math.round(performance.now() - startTime),
        });
        PhaseState.interventionResult = result;
        return result;
    } catch (err: any) {
        DebugLog.updateEntry(debugEntry, {
            loading: false, error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err;
    }
}

// ============================================
// REVISION MODEL — Biometric-Informed Re-evaluation
// ============================================

function buildBiometricSummary() {
    const channels = BiometricState.channels;
    if (!channels || channels.length === 0) return 'No biometric data available.';
    return channels.map((ch: any) => {
        const data = ch.data || [];
        const hourly = data.filter((_: any, i: number) => i % 4 === 0);
        const values = hourly.map((p: any) => `${p.hour}h:${Math.round(p.value)}`).join(', ');
        return `${ch.metric || ch.displayName || ch.signal} (${ch.unit}): [${values}]`;
    }).join('\n');
}

export function buildRevisionSystemPrompt(userGoal: any, curvesData: any) {
    const active = getActiveSubstances();
    const substanceList = Object.entries(active).map(([key, s]: [string, any]) => ({
        key, name: s.name, class: s.class, standardDose: s.standardDose, pharma: s.pharma,
    }));
    const curveSummary = curvesData.map((c: any) => ({
        effect: c.effect, polarity: c.polarity || 'higher_is_better',
        baseline: (c.baseline || []).filter((_: any, i: number) => i % 4 === 0),
        desired: (c.desired || []).filter((_: any, i: number) => i % 4 === 0),
    }));
    const originalInterventions = PhaseState.interventionResult
        ? JSON.stringify(PhaseState.interventionResult.interventions, null, 1)
        : '[]';
    let rxInstruction = '';
    if (AppState.rxMode === 'rx-only') {
        rxInstruction = '\n\nCRITICAL CONSTRAINT: PRESCRIPTION-ONLY mode. Only prescribe from the Rx/controlled substances listed. Do NOT suggest supplements or OTC.';
    } else if (AppState.rxMode === 'rx') {
        rxInstruction = '\n\nNOTE: Prescription and controlled substances are available alongside supplements.';
    }

    return interpolatePrompt(PROMPTS.revision, {
        userGoal,
        originalInterventions,
        biometricSummary: buildBiometricSummary(),
        curveSummary: JSON.stringify(curveSummary),
        substanceList: JSON.stringify(substanceList),
    }) + rxInstruction;
}

export async function callRevisionModel(userGoal: any, curvesData: any) {
    const { model, type, provider, key } = getStageModel('revision');
    if (!key) throw new Error(`No API key configured for ${provider}.`);

    const systemPrompt = buildRevisionSystemPrompt(userGoal, curvesData);
    const userPrompt = 'Revise the intervention protocol based on the biometric feedback. Respond with JSON only.';
    const debugEntry = DebugLog.addEntry({
        stage: 'Revision Model', stageClass: 'revision-model',
        model, systemPrompt, userPrompt, loading: true,
    });
    const startTime = performance.now();

    try {
        const result = await callGeneric(userPrompt, key, model, type, provider, systemPrompt, 4096);
        const requestBody = result._requestBody;
        const rawResponse = result._rawResponse;
        delete result._requestBody;
        delete result._rawResponse;
        DebugLog.updateEntry(debugEntry, {
            loading: false, requestBody, rawResponse, response: result,
            duration: Math.round(performance.now() - startTime),
        });
        return result;
    } catch (err: any) {
        DebugLog.updateEntry(debugEntry, {
            loading: false, error: err.message || String(err),
            duration: Math.round(performance.now() - startTime),
        });
        throw err;
    }
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

    const curveSummary = curvesData.map((c: any) => ({
        effect: c.effect,
        polarity: c.polarity || 'higher_is_better',
        baseline: (c.baseline || []).filter((_: any, i: number) => i % 4 === 0),
        desired: (c.desired || []).filter((_: any, i: number) => i % 4 === 0),
    }));

    return interpolatePrompt(PROMPTS.sherlock, {
        userGoal,
        interventionSummary: JSON.stringify(interventions.map((iv: any) => ({
            key: iv.key, dose: iv.dose, timeMinutes: iv.timeMinutes,
            impacts: iv.impacts, rationale: iv.rationale,
        })), null, 1),
        interventionRationale: PhaseState.interventionResult?.rationale || '',
        selectedSubstanceInfo: JSON.stringify(selectedSubstanceInfo, null, 1),
        curveSummary: JSON.stringify(curveSummary, null, 1),
        substanceCount: String(interventions.length),
    });
}

export async function callSherlockModel(userGoal: any, interventions: any, curvesData: any) {
    const { model, type, provider, key } = getStageModel('sherlock');
    if (!key) throw new Error(`No API key configured for ${provider}.`);

    const systemPrompt = buildSherlockSystemPrompt(userGoal, interventions, curvesData);
    const userPrompts = [
        'Narrate the intervention protocol in Sherlock style. Lead each beat with the intended effect, then mention the substance. Respond with JSON only.',
        'Return ONLY a raw JSON object with "beats" array and "outro" string. No markdown fences, no explanation, no text outside the JSON. Start your response with { and end with }.',
    ];
    const debugEntry = DebugLog.addEntry({
        stage: 'Sherlock Narration', stageClass: 'sherlock-model',
        model, systemPrompt, userPrompt: userPrompts[0], loading: true,
    });
    const startTime = performance.now();

    let lastErr: any = null;
    let lastRaw: string | undefined;
    for (let attempt = 0; attempt < userPrompts.length; attempt++) {
        try {
            const result = await callGeneric(userPrompts[attempt], key, model, type, provider, systemPrompt, 2048);
            const requestBody = result._requestBody;
            const rawResponse = result._rawResponse;
            delete result._requestBody;
            delete result._rawResponse;
            DebugLog.updateEntry(debugEntry, {
                loading: false, requestBody, rawResponse, response: result,
                duration: Math.round(performance.now() - startTime),
            });
            SherlockState.narrationResult = result;
            return result;
        } catch (err: any) {
            lastErr = err;
            if (err._rawResponse) lastRaw = err._rawResponse;
            console.warn(`[Sherlock] Attempt ${attempt + 1} failed (${err.message})${lastRaw ? '\nRaw response: ' + lastRaw.substring(0, 500) : ''}`, err);
            if (attempt < userPrompts.length - 1) continue;
        }
    }
    DebugLog.updateEntry(debugEntry, {
        loading: false, error: lastErr?.message || String(lastErr),
        ...(lastRaw ? { rawResponse: lastRaw } : {}),
        duration: Math.round(performance.now() - startTime),
    });
    throw lastErr;
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
        originalInterventions: JSON.stringify(oldIvs.map((iv: any) => ({
            key: iv.key, dose: iv.dose, timeMinutes: iv.timeMinutes,
        })), null, 1),
        revisedInterventions: JSON.stringify(newIvs.map((iv: any) => ({
            key: iv.key, dose: iv.dose, timeMinutes: iv.timeMinutes,
        })), null, 1),
        revisionDiff: JSON.stringify(revisionDiff, null, 1),
        biometricSummary,
    });
}

export async function callSherlockRevisionModel(userGoal: any, oldIvs: any, newIvs: any, diff: any, curvesData: any) {
    const { model, type, provider, key } = getStageModel('sherlockRevision');
    if (!key) throw new Error(`No API key configured for ${provider}.`);

    const systemPrompt = buildSherlockRevisionSystemPrompt(userGoal, oldIvs, newIvs, diff, curvesData);
    const userPrompts = [
        'Narrate the protocol revision based on biometric feedback. Lead each beat with the intended correction effect, then mention the substance/action. Respond with JSON only.',
        'Return ONLY a raw JSON object with "beats" array and "outro" string. No markdown fences, no explanation, no text outside the JSON. Start your response with { and end with }.',
    ];
    const debugEntry = DebugLog.addEntry({
        stage: 'Sherlock (Revision)', stageClass: 'sherlock-revision-model',
        model, systemPrompt, userPrompt: userPrompts[0], loading: true,
    });
    const startTime = performance.now();

    let lastErr: any = null;
    let lastRaw: string | undefined;
    for (let attempt = 0; attempt < userPrompts.length; attempt++) {
        try {
            const result = await callGeneric(userPrompts[attempt], key, model, type, provider, systemPrompt, 2048);
            const requestBody = result._requestBody;
            const rawResponse = result._rawResponse;
            delete result._requestBody;
            delete result._rawResponse;
            DebugLog.updateEntry(debugEntry, {
                loading: false, requestBody, rawResponse, response: result,
                duration: Math.round(performance.now() - startTime),
            });
            SherlockState.revisionNarrationResult = result;
            return result;
        } catch (err: any) {
            lastErr = err;
            if (err._rawResponse) lastRaw = err._rawResponse;
            console.warn(`[Sherlock Revision] Attempt ${attempt + 1} failed (${err.message})${lastRaw ? '\nRaw response: ' + lastRaw.substring(0, 500) : ''}`, err);
            if (attempt < userPrompts.length - 1) continue;
        }
    }
    DebugLog.updateEntry(debugEntry, {
        loading: false, error: lastErr?.message || String(lastErr),
        ...(lastRaw ? { rawResponse: lastRaw } : {}),
        duration: Math.round(performance.now() - startTime),
    });
    throw lastErr;
}

export function guessDose(substance: any) {
    // Prefer the standardDose from the new database
    if (substance.standardDose) return substance.standardDose;
    const doses: any = {
        caffeine: '200mg', theanine: '400mg', rhodiola: '500mg', ashwagandha: '600mg',
        tyrosine: '1000mg', citicoline: '500mg', alphaGPC: '600mg', lionsMane: '1000mg',
        magnesium: '400mg', creatine: '5g', nac: '600mg', glycine: '3g',
        melatonin: '3mg', gaba: '750mg', apigenin: '50mg', taurine: '2g',
    };
    return doses[substance.name?.toLowerCase()] || doses[Object.keys(doses).find(k =>
        substance.name?.toLowerCase().includes(k)) as string] || '500mg';
}
