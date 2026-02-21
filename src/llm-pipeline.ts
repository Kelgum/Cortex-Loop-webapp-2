import { API_ENDPOINTS } from './constants';
import { AppState, PhaseState, BiometricState, getStageModel } from './state';
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
                systemPrompt, maxTokens);
        case 'gemini':
            return callGeminiGeneric(userPrompt, key, model, systemPrompt, maxTokens);
        default:
            return callOpenAIGeneric(userPrompt, key, model, API_ENDPOINTS.openai, systemPrompt, maxTokens);
    }
}

/**
 * Robust JSON extraction + sanitization for LLM responses.
 * Handles markdown fences, conversational wrapping, trailing commas,
 * and unescaped double quotes inside string values.
 */
export function extractAndParseJSON(rawText: any) {
    let text = (rawText || '').trim();

    // 1. Strip markdown fences
    text = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```\s*/g, '').trim();

    // 2. Extract the FIRST complete JSON object/array by matching braces/brackets.
    //    This handles LLM self-correction responses that contain multiple JSON objects.
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let startIdx = -1;
    let openChar: any, closeChar: any;
    if (firstBrace >= 0 && (firstBracket < 0 || firstBrace <= firstBracket)) {
        startIdx = firstBrace;
        openChar = '{'; closeChar = '}';
    } else if (firstBracket >= 0) {
        startIdx = firstBracket;
        openChar = '['; closeChar = ']';
    }
    if (startIdx < 0) {
        console.error('[extractAndParseJSON] No JSON found in:', rawText);
        throw new Error('LLM returned no valid JSON. Check debug panel for raw response.');
    }
    // Walk forward from startIdx matching braces, respecting strings
    let depth = 0;
    let inString = false;
    let endIdx = -1;
    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; continue; } // skip escaped char
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) { endIdx = i; break; }
        }
    }
    if (endIdx < 0) {
        console.error('[extractAndParseJSON] Unmatched braces in:', rawText);
        throw new Error('LLM returned no valid JSON. Check debug panel for raw response.');
    }
    text = text.substring(startIdx, endIdx + 1);

    // 3. Fix trailing commas before } or ]
    text = text.replace(/,\s*([}\]])/g, '$1');

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
            // 7. Third pass: also fix unescaped newlines
            try {
                let fixed = fixUnescapedQuotes(text);
                fixed = fixed.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
                return JSON.parse(fixed);
            } catch (e3) {
                console.error('[extractAndParseJSON] PARSE FAILED.\nError:', e1.message, '\nCleaned text:', text);
                throw new Error('JSON parse error: ' + e1.message);
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
    const response = await fetch(API_ENDPOINTS.anthropic, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const parsed = parseJSONObjectResponse(data.content[0].text);
    parsed._requestBody = requestBody;
    parsed._rawResponse = data.content[0].text;
    return parsed;
}

export async function callOpenAIGeneric(userPrompt: any, apiKey: any, model: any, endpoint: any, systemPrompt: any, maxTokens: any) {
    const requestBody = {
        model,
        max_tokens: maxTokens,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    };
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const parsed = parseJSONObjectResponse(data.choices[0].message.content);
    parsed._requestBody = requestBody;
    parsed._rawResponse = data.choices[0].message.content;
    return parsed;
}

export async function callGeminiGeneric(userPrompt: any, apiKey: any, model: any, systemPrompt: any, maxTokens: any) {
    const requestBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
    };
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        }
    );
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const parsed = parseJSONObjectResponse(data.candidates[0].content.parts[0].text);
    parsed._requestBody = requestBody;
    parsed._rawResponse = data.candidates[0].content.parts[0].text;
    return parsed;
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
        const result = await callGeneric(prompt, key, model, type, provider, systemPrompt, 256);
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
        const result = await callGeneric(prompt, key, model, type, provider, systemPrompt, 2048);
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

    return interpolatePrompt(PROMPTS.intervention, {
        userGoal: userGoal,
        substanceList: JSON.stringify(substanceList, null, 1),
        curveSummary: JSON.stringify(curveSummary, null, 1),
    });
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
    return interpolatePrompt(PROMPTS.revision, {
        userGoal,
        originalInterventions,
        biometricSummary: buildBiometricSummary(),
        curveSummary: JSON.stringify(curveSummary),
        substanceList: JSON.stringify(substanceList),
    });
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
