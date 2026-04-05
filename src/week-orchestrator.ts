/**
 * Week Orchestrator — Simplified 4-agent sequential pipeline:
 *   Knight → Spotter Daily → Strategist Bio Daily → Grandmaster Daily
 * Each agent produces all 7 days in a single LLM call.
 * Exports: runWeekPipeline
 * Depends on: state, llm-pipeline, lx-system, prompts
 */
import { BiometricState, PhaseState, MultiDayState } from './state';
import { interpolatePrompt, clamp } from './utils';
import { PROMPTS } from './prompts';
import { DebugLog } from './debug-panel';
import { getActiveSubstances } from './substances';
import { validateInterventions, computeLxOverlay, computeStackingPeaks, pruneConcurrentOverload } from './lx-system';
import { extractInterventionsData } from './llm-response-shape';
import { LLMCache } from './llm-cache';
import type {
    CurveData,
    CurvePoint,
    DaySnapshot,
    BiometricChannel,
    BioModulation,
    Intervention,
    PoiEvent,
    KnightOutput,
    SpotterDailyOutput,
    StrategistBioDailyOutput,
    GrandmasterDailyOutput,
    Sherlock7DNarration,
    Sherlock7DBeat,
} from './types';
import { callStageWithFallback, buildStackingCorrectionPrompt, STACKING_THRESHOLD } from './llm-pipeline';
import { reportRuntimeBug } from './runtime-error-banner';

// ── Generic call helper (mirrors llm-pipeline pattern) ──

async function callGenericForStage(
    stage: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    debugLabel: string,
    debugClass: string,
) {
    // Cache check using debugClass as stageClass
    if (LLMCache.isEnabled(debugClass) && LLMCache.hasData(debugClass)) {
        const cached = LLMCache.getWithMeta(debugClass);
        if (cached.payload == null) {
            LLMCache.clear(debugClass);
        } else {
            const inputMismatch =
                !!cached.meta &&
                ((typeof cached.meta.systemPrompt === 'string' && cached.meta.systemPrompt !== systemPrompt) ||
                    (typeof cached.meta.userPrompt === 'string' && cached.meta.userPrompt !== userPrompt));
            DebugLog.addEntry({
                stage: debugLabel,
                stageClass: debugClass,
                model: 'cached',
                provider: 'local',
                systemPrompt: cached.meta?.systemPrompt || systemPrompt,
                userPrompt: cached.meta?.userPrompt || userPrompt,
                requestBody: cached.meta?.requestBody ?? null,
                loading: false,
                response: cached.payload,
                duration: 0,
                cache: {
                    hit: true,
                    key: cached.meta?.cacheKey || `cortex_cache_${debugClass}`,
                    cachedAt: cached.meta?.cachedAt || '',
                    inputMismatch,
                },
            });
            return cached.payload;
        }
    }

    const result = await callStageWithFallback({
        stage,
        stageLabel: debugLabel,
        stageClass: debugClass,
        systemPrompt,
        userPrompt,
        maxTokens,
    });
    LLMCache.set(debugClass, result, {
        systemPrompt,
        userPrompt,
        requestBody: null,
    });
    return result;
}

// ── Agent 1: Knight — 7-day desired curve evolution ──

async function callKnight(userGoal: string, curvesData: CurveData[]): Promise<KnightOutput> {
    const day0Desired = curvesData.map(c => ({
        effect: c.effect,
        desired: c.desired,
    }));

    const day0Baselines = curvesData.map(c => ({
        effect: c.effect,
        baseline: c.baseline,
    }));

    const systemPrompt = interpolatePrompt(PROMPTS.knight, {
        userGoal,
        day0Desired: JSON.stringify(day0Desired),
        day0Baselines: JSON.stringify(day0Baselines),
        profileText: BiometricState.profileText || 'No profile available.',
    });

    const result = await callGenericForStage(
        'knight',
        systemPrompt,
        'Design the 7-day desired curve evolution. Respond with JSON only.',
        4096,
        'Knight',
        'knight-model',
    );

    const plan = result as any;

    // Ensure 7 days — pad missing with empty deltas
    if (!plan.days || !Array.isArray(plan.days)) plan.days = [];
    const existingDays = new Set(plan.days.map((d: any) => d.day));
    for (let d = 1; d <= 7; d++) {
        if (!existingDays.has(d)) {
            plan.days.push({ day: d, rationale: 'Maintained from day 0', deltas: [] });
        }
    }
    plan.days.sort((a: any, b: any) => a.day - b.day);

    // Post-process: reconstruct full desired curves from deltas
    // Day-1 deltas apply to day-0, day-2 to day-1 result, etc.
    let prevDesired = day0Desired.map(e => ({
        effect: e.effect,
        desired: e.desired.map((p: any) => ({ hour: p.hour, value: p.value })),
    }));

    for (const dayEntry of plan.days) {
        const deltas: any[] = dayEntry.deltas || [];
        if (dayEntry.desired && Array.isArray(dayEntry.desired) && dayEntry.desired.length > 0) {
            // LLM returned full curves (backward compat) — use as-is
            prevDesired = dayEntry.desired;
        } else if (deltas.length === 0) {
            // No changes — carry forward previous day
            dayEntry.desired = prevDesired.map((e: any) => ({
                effect: e.effect,
                desired: e.desired.map((p: any) => ({ hour: p.hour, value: p.value })),
            }));
        } else {
            // Apply deltas to previous day's curves
            dayEntry.desired = prevDesired.map((e: any) => {
                const effectDeltas = deltas.find((d: any) => d.effect === e.effect);
                if (!effectDeltas || !effectDeltas.changes || effectDeltas.changes.length === 0) {
                    return { effect: e.effect, desired: e.desired.map((p: any) => ({ ...p })) };
                }
                const newPts = e.desired.map((p: any) => {
                    let val = p.value;
                    for (const ch of effectDeltas.changes) {
                        if (p.hour >= ch.startHour && p.hour <= ch.endHour) {
                            // Smooth ramp: full delta at center, tapered at edges
                            const mid = (ch.startHour + ch.endHour) / 2;
                            const halfSpan = (ch.endHour - ch.startHour) / 2 || 0.5;
                            const dist = Math.abs(p.hour - mid) / halfSpan;
                            const weight = Math.max(0, 1 - dist * dist); // quadratic taper
                            val += (ch.delta || 0) * weight;
                        }
                    }
                    return { hour: p.hour, value: val };
                });
                return { effect: e.effect, desired: newPts };
            });
            prevDesired = dayEntry.desired;
        }
    }

    return plan as KnightOutput;
}

// ── Biometric Modulation Engine ──

/** Apply modulation descriptors to day-0 biometric channels to produce full 97-point curves. */
function applyBioModulations(day0Channels: BiometricChannel[], modulations: BioModulation[]): BiometricChannel[] {
    return day0Channels.map((ch, chIdx) => {
        const data = (ch.data || []).map(p => ({ hour: p.hour, value: p.value }));
        const chMods = modulations.filter(m => m.channelIdx === chIdx);
        for (const mod of chMods) {
            const center = (mod.startHour + mod.endHour) / 2;
            const sigma = Math.max(0.25, (mod.endHour - mod.startHour) / 4);
            for (const pt of data) {
                if (pt.hour < mod.startHour - sigma * 3 || pt.hour > mod.endHour + sigma * 3) continue;
                let delta = 0;
                if (mod.type === 'spike' || mod.type === 'dip') {
                    delta = mod.magnitude * Math.exp(-((pt.hour - center) ** 2) / (2 * sigma ** 2));
                } else if (mod.type === 'shift') {
                    // Smooth ramp: 0→1 over first quarter, hold, 1→0 over last quarter
                    const rampIn = Math.min(1, Math.max(0, (pt.hour - mod.startHour) / (sigma * 0.5)));
                    const rampOut = Math.min(1, Math.max(0, (mod.endHour - pt.hour) / (sigma * 0.5)));
                    delta = mod.magnitude * Math.min(rampIn, rampOut);
                } else if (mod.type === 'noise') {
                    if (pt.hour >= mod.startHour && pt.hour <= mod.endHour) {
                        // Deterministic pseudo-random from hour + channelIdx + day
                        const seed = Math.sin(pt.hour * 127.1 + chIdx * 311.7 + mod.startHour * 73.3) * 43758.5453;
                        delta = mod.magnitude * ((seed - Math.floor(seed)) * 2 - 1);
                    }
                }
                pt.value += delta;
            }
        }
        // Clamp to channel range
        const [lo, hi] = ch.range || [0, 100];
        for (const pt of data) {
            pt.value = Math.max(lo, Math.min(hi, +pt.value.toFixed(1)));
        }
        return { ...ch, data };
    });
}

// ── Agent 2: Spotter Daily — 7-day biometric perturbations ──

async function callSpotterDaily(
    userGoal: string,
    curvesData: CurveData[],
    biometricChannels: BiometricChannel[],
    highlights: any[],
    knightNarrative: string,
): Promise<SpotterDailyOutput> {
    // Summarize day-0 biometric channels (sample data for context, not full 97 points)
    const day0BiometricChannels = biometricChannels.map(ch => {
        const data = ch.data || [];
        const vals = data.map((p: any) => p.value);
        const sample = data
            .filter((_: any, i: number) => i % 8 === 0)
            .map((p: any) => ({ hour: p.hour, value: p.value }));
        return {
            signal: ch.signal,
            device: ch.device,
            unit: ch.unit,
            range: ch.range,
            avg: vals.length > 0 ? +(vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1) : 0,
            sample,
        };
    });

    const day0Baselines = curvesData.map(c => ({
        effect: c.effect,
        baseline: c.baseline,
    }));

    const channelSpec = (BiometricState.channelSpec || biometricChannels).map(ch => ({
        signal: ch.signal,
        device: ch.device,
        unit: ch.unit,
        range: ch.range,
        color: ch.color,
    }));

    const systemPrompt = interpolatePrompt(PROMPTS.spotterDaily, {
        userGoal,
        day0BiometricChannels: JSON.stringify(day0BiometricChannels),
        day0Baselines: JSON.stringify(day0Baselines),
        day0Highlights: JSON.stringify(highlights || []),
        knightNarrative: knightNarrative || '',
        profileText: BiometricState.profileText || 'No profile available.',
        channelSpec: JSON.stringify(channelSpec),
    });

    const result = await callGenericForStage(
        'spotterDaily',
        systemPrompt,
        'Generate 7 days of biometric modulations. Respond with JSON only.',
        8192,
        'Spotter (7d)',
        'spotter-daily-model',
    );

    const output = result as SpotterDailyOutput;

    // Validate and pad to 7 days
    if (output.days && Array.isArray(output.days)) {
        const existingDays = new Set(output.days.map((d: any) => d.day));
        for (let d = 1; d <= 7; d++) {
            if (!existingDays.has(d)) {
                output.days.push({
                    day: d,
                    events: 'Standard day — routine maintained.',
                    narrativeBeat: 'A steady day of consolidation.',
                    modulations: [],
                    biometricChannels: [],
                    externalEvents: [],
                    poiEvents: [],
                });
            }
        }
        output.days.sort((a: any, b: any) => a.day - b.day);

        // Compute full biometric curves from day-0 + modulations
        // (strip any LLM-generated biometricChannels — we compute these from modulations)
        for (const dayEntry of output.days) {
            delete (dayEntry as any).biometricChannels;
            const mods: BioModulation[] = (dayEntry.modulations || []).filter(
                (m: any) => m.channelIdx != null && m.startHour != null && m.endHour != null && m.magnitude != null,
            );
            dayEntry.modulations = mods;
            const computed = applyBioModulations(biometricChannels, mods);
            dayEntry.biometricChannels = computed.map(ch => ({
                signal: ch.signal,
                data: (ch.data || []).map((p: any) => ({ hour: p.hour, value: p.value })),
            }));
        }
    }

    return output;
}

// ── Agent 3: Strategist Bio Daily — 7-day baseline correction ──

async function callStrategistBioDaily(
    userGoal: string,
    curvesData: CurveData[],
    spotterOutput: SpotterDailyOutput,
): Promise<StrategistBioDailyOutput> {
    const day0Baselines = curvesData.map(c => ({
        effect: c.effect,
        baseline: c.baseline,
    }));

    // Build per-day biometric summary (stats only, not raw 97-point arrays)
    const spotterBioSummary = (spotterOutput.days || []).map(dayEntry => {
        const channelStats = (dayEntry.biometricChannels || []).map(ch => {
            const vals = (ch.data || []).map((p: any) => p.value);
            const avg =
                vals.length > 0 ? +(vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1) : 0;
            const min = vals.length > 0 ? +Math.min(...vals).toFixed(0) : 0;
            const max = vals.length > 0 ? +Math.max(...vals).toFixed(0) : 0;
            return { signal: ch.signal, avg, min, max };
        });
        const anomalies = (dayEntry.poiEvents || []).map(p => p.label).join('; ');
        return {
            day: dayEntry.day,
            events: dayEntry.events,
            channels: channelStats,
            anomalies,
        };
    });

    const systemPrompt = interpolatePrompt(PROMPTS.strategistBioDaily, {
        userGoal,
        day0Baselines: JSON.stringify(day0Baselines),
        spotterBioSummary: JSON.stringify(spotterBioSummary),
    });

    const result = await callGenericForStage(
        'strategistBioDaily',
        systemPrompt,
        'Correct baselines for all 7 days. Respond with JSON only.',
        8192,
        'Strategist Bio (7d)',
        'strategist-bio-daily-model',
    );

    const output = result as StrategistBioDailyOutput;

    // Pad missing days with day-0 baselines
    if (output.days && Array.isArray(output.days)) {
        const existingDays = new Set(output.days.map((d: any) => d.day));
        for (let d = 1; d <= 7; d++) {
            if (!existingDays.has(d)) {
                output.days.push({
                    day: d,
                    correctedBaseline: day0Baselines.map(b => ({
                        effect: b.effect,
                        baseline: [...b.baseline],
                    })),
                    rationale: 'No correction data — using day-0 baseline',
                });
            }
        }
        output.days.sort((a: any, b: any) => a.day - b.day);
    }

    return output;
}

// ── Agent 4: Grandmaster Daily — 7-day intervention protocols ──

async function callGrandmasterDaily(
    userGoal: string,
    curvesData: CurveData[],
    stratBioOutput: StrategistBioDailyOutput,
    knightOutput: KnightOutput,
    day0Interventions: Intervention[],
    prebuiltSystemPrompt?: string,
): Promise<GrandmasterDailyOutput> {
    const systemPrompt =
        prebuiltSystemPrompt ||
        buildGrandmasterDailySystemPrompt(userGoal, curvesData, stratBioOutput, knightOutput, day0Interventions);

    const day0Protocol = day0Interventions.map(iv => ({
        key: iv.key,
        dose: iv.dose,
        timeMinutes: iv.timeMinutes,
        doseMultiplier: iv.doseMultiplier,
        impacts: iv.impacts,
    }));

    const result = await callGenericForStage(
        'grandmasterDaily',
        systemPrompt,
        'Create intervention protocols for all 7 days. Respond with JSON only.',
        16384,
        'Grandmaster (7d)',
        'grandmaster-daily-model',
    );

    const output = result as any;

    // Ensure 7 days — pad missing with empty changes
    if (!output.days || !Array.isArray(output.days)) output.days = [];
    const existingDays = new Set(output.days.map((d: any) => d.day));
    for (let d = 1; d <= 7; d++) {
        if (!existingDays.has(d)) {
            output.days.push({ day: d, changes: [], dayNarrative: 'Protocol held steady.' });
        }
    }
    output.days.sort((a: any, b: any) => a.day - b.day);

    // Post-process: reconstruct full intervention lists from diff changes.
    // Day-1 changes apply to day-0, day-2 to day-1 result, etc.
    let prevInterventions = day0Protocol.map(iv => ({
        key: iv.key,
        dose: iv.dose,
        doseMultiplier: iv.doseMultiplier,
        timeMinutes: iv.timeMinutes,
        impacts: iv.impacts || {},
        rationale: 'From day-0 protocol',
    }));

    for (const dayEntry of output.days) {
        const changes: any[] = dayEntry.changes || [];
        if (dayEntry.interventions && Array.isArray(dayEntry.interventions) && dayEntry.interventions.length > 0) {
            // LLM returned full interventions (backward compat) — use as-is
            prevInterventions = dayEntry.interventions;
        } else if (changes.length === 0) {
            // No changes — carry forward previous day
            dayEntry.interventions = prevInterventions.map((iv: any) => ({ ...iv }));
        } else {
            // Apply diff changes to previous day's protocol
            const result: any[] = prevInterventions.map((iv: any) => ({ ...iv }));

            for (const ch of changes) {
                if (ch.action === 'remove') {
                    const idx = result.findIndex((iv: any) => iv.key === ch.key);
                    if (idx >= 0) result.splice(idx, 1);
                } else if (ch.action === 'adjust_dose') {
                    const idx = result.findIndex((iv: any) => iv.key === ch.key);
                    if (idx >= 0) {
                        if (ch.dose != null) result[idx].dose = ch.dose;
                        if (ch.doseMultiplier != null) result[idx].doseMultiplier = ch.doseMultiplier;
                        if (ch.timeMinutes != null) result[idx].timeMinutes = ch.timeMinutes;
                        if (ch.impacts) result[idx].impacts = ch.impacts;
                        if (ch.rationale) result[idx].rationale = ch.rationale;
                    }
                } else if (ch.action === 'add') {
                    result.push({
                        key: ch.key,
                        dose: ch.dose || '100mg',
                        doseMultiplier: ch.doseMultiplier || 1.0,
                        timeMinutes: ch.timeMinutes || 480,
                        impacts: ch.impacts || {},
                        rationale: ch.rationale || '',
                    });
                }
                // 'keep' — no action needed
            }

            dayEntry.interventions = result;
            prevInterventions = result;
        }
    }

    return output as GrandmasterDailyOutput;
}

// ── Shared helper: build day-specific curvesData from agent outputs ──

function buildDayCurvesData(
    dayNumber: number,
    curvesData: CurveData[],
    knightOutput: KnightOutput,
    stratBioOutput: StrategistBioDailyOutput,
    gmDay: any | undefined,
): {
    tempCurvesData: CurveData[];
    desiredCurves: CurvePoint[][];
    correctedBaselines: CurvePoint[][];
    postInterventionBaseline: CurvePoint[][];
} {
    // ── Desired curves from Knight ──
    const knightDay = (knightOutput.days || []).find((d: any) => d.day === dayNumber);
    const desiredCurves: CurvePoint[][] = [];
    for (const curve of curvesData) {
        const match = (knightDay?.desired || []).find(
            (d: any) =>
                d.effect &&
                (d.effect.toLowerCase() === curve.effect.toLowerCase() ||
                    curve.effect.toLowerCase().includes(d.effect.toLowerCase()) ||
                    d.effect.toLowerCase().includes(curve.effect.toLowerCase())),
        );
        if (match && Array.isArray(match.desired) && match.desired.length >= 10) {
            desiredCurves.push(
                match.desired.map((p: any) => ({
                    hour: Number(p.hour),
                    value: clamp(Number(p.value), 0, 100),
                })),
            );
        } else {
            desiredCurves.push([...curve.desired]);
        }
    }

    // ── Corrected baselines from Strategist Bio ──
    const stratDay = (stratBioOutput.days || []).find((d: any) => d.day === dayNumber);
    const correctedBaselines: CurvePoint[][] = [];
    for (const curve of curvesData) {
        const match = (stratDay?.correctedBaseline || []).find(
            (cb: any) =>
                cb.effect &&
                (cb.effect.toLowerCase() === curve.effect.toLowerCase() ||
                    curve.effect.toLowerCase().includes(cb.effect.toLowerCase()) ||
                    cb.effect.toLowerCase().includes(curve.effect.toLowerCase())),
        );
        if (match && Array.isArray(match.baseline) && match.baseline.length >= 10) {
            correctedBaselines.push(
                match.baseline.map((p: any) => ({
                    hour: Number(p.hour),
                    value: clamp(Number(p.value), 0, 100),
                })),
            );
        } else {
            correctedBaselines.push([...curve.baseline]);
        }
    }

    // ── Post-intervention baseline from Grandmaster (cumulative chronobiotic shift) ──
    const postInterventionBaseline: CurvePoint[][] = [];
    for (let ci = 0; ci < curvesData.length; ci++) {
        const curve = curvesData[ci];
        const match = (gmDay?.postInterventionBaseline || []).find(
            (pb: any) =>
                pb.effect &&
                (pb.effect.toLowerCase() === curve.effect.toLowerCase() ||
                    curve.effect.toLowerCase().includes(pb.effect.toLowerCase()) ||
                    pb.effect.toLowerCase().includes(curve.effect.toLowerCase())),
        );
        if (match && Array.isArray(match.baseline) && match.baseline.length >= 10) {
            postInterventionBaseline.push(
                match.baseline.map((p: any) => ({
                    hour: Number(p.hour),
                    value: clamp(Number(p.value), 0, 100),
                })),
            );
        } else {
            postInterventionBaseline.push(correctedBaselines[ci]);
        }
    }

    const tempCurvesData = curvesData.map((c, i) => ({
        ...c,
        baseline: postInterventionBaseline[i] || correctedBaselines[i],
        desired: desiredCurves[i] || c.desired,
    }));

    return { tempCurvesData, desiredCurves, correctedBaselines, postInterventionBaseline };
}

// ── Referee: validate Grandmaster 7D stacking and correct overshoots ──

async function refereeCorrectDay(
    dayNumber: number,
    interventions: any[],
    curvesData: CurveData[],
    systemPrompt: string,
): Promise<any[]> {
    if (interventions.length < 2) return interventions;

    const validated = validateInterventions(JSON.parse(JSON.stringify(interventions)), curvesData);
    if (validated.length === 0) return interventions;

    // Concurrent density pruning — always runs, even if stacking is OK
    const { pruned: densityPruned, removed: densityRemoved } = pruneConcurrentOverload(validated, curvesData);
    const postDensityIvs = densityRemoved.length > 0 ? densityPruned : interventions;

    const correctionPrompt = buildStackingCorrectionPrompt(
        densityRemoved.length > 0 ? validateInterventions(JSON.parse(JSON.stringify(densityPruned)), curvesData) : validated,
        curvesData,
    );
    if (!correctionPrompt) {
        console.log(`[Referee] Day ${dayNumber} — stacking OK`);
        return postDensityIvs;
    }

    console.warn(`[Referee] Day ${dayNumber} — stacking overshoot detected, calling LLM for correction`);

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
        `Day ${dayNumber} protocol:\n\`\`\`json\n${originalJson}\n\`\`\`\n\n` +
        correctionPrompt +
        '\n\nReturn ONLY the corrected interventions array as JSON: {"interventions": [...]}';

    try {
        const corrected = await callStageWithFallback<any>({
            stage: 'grandmasterDaily',
            stageLabel: `Referee (day ${dayNumber} stacking correction)`,
            stageClass: 'referee-model',
            systemPrompt,
            userPrompt: correctionUserPrompt,
            maxTokens: 8192,
            validateResult: (result: unknown) => {
                const ivs = extractInterventionsData(result);
                if (ivs.length < 2) throw new Error('Referee correction must return at least 2 interventions.');
                return result;
            },
        });

        const correctedIvs = extractInterventionsData(corrected);
        if (correctedIvs.length >= 2) {
            const revalidated = validateInterventions(JSON.parse(JSON.stringify(correctedIvs)), curvesData);

            // Apply density pruning to the corrected result too
            const { pruned: postPruned, removed: postRemoved } = pruneConcurrentOverload(revalidated, curvesData);
            const finalIvs = postRemoved.length > 0 ? postPruned : correctedIvs;

            const finalValidated = validateInterventions(JSON.parse(JSON.stringify(finalIvs)), curvesData);
            const newReports = computeStackingPeaks(finalValidated, curvesData);
            for (const r of newReports) {
                const status = Math.abs(r.peakNormSum) > STACKING_THRESHOLD ? 'STILL HIGH' : 'OK';
                console.log(
                    `[Referee] Day ${dayNumber} corrected "${r.curve}" peakNormSum=${r.peakNormSum} at ${r.peakHour}:00 — ${status}`,
                );
            }
            return finalIvs;
        }

        console.warn(`[Referee] Day ${dayNumber} correction produced < 2 interventions — keeping original`);
        return postDensityIvs;
    } catch (err: any) {
        console.warn(`[Referee] Day ${dayNumber} correction call failed — keeping original:`, err.message);
        return postDensityIvs;
    }
}

async function runRefereePass(
    grandmasterOutput: GrandmasterDailyOutput,
    curvesData: CurveData[],
    knightOutput: KnightOutput,
    stratBioOutput: StrategistBioDailyOutput,
    systemPrompt: string,
    onProgress?: (msg: string) => void,
): Promise<void> {
    let correctedCount = 0;

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayNumber = dayIdx + 1;
        const gmDay = (grandmasterOutput.days || []).find((d: any) => d.day === dayNumber);
        if (!gmDay || !gmDay.interventions || gmDay.interventions.length < 2) continue;

        const { tempCurvesData } = buildDayCurvesData(dayNumber, curvesData, knightOutput, stratBioOutput, gmDay);

        onProgress?.(`Referee: validating day ${dayNumber}…`);
        const corrected = await refereeCorrectDay(dayNumber, gmDay.interventions, tempCurvesData, systemPrompt);

        if (corrected !== gmDay.interventions) {
            gmDay.interventions = corrected;
            correctedCount++;
        }
    }

    console.log(`[Referee] Pass complete — ${correctedCount} of 7 days required correction`);
}

// ── Build Grandmaster Daily system prompt (shared by Grandmaster + Referee) ──

function buildGrandmasterDailySystemPrompt(
    userGoal: string,
    curvesData: CurveData[],
    stratBioOutput: StrategistBioDailyOutput,
    knightOutput: KnightOutput,
    day0Interventions: Intervention[],
): string {
    const active = getActiveSubstances();
    const substanceList = Object.entries(active).map(([key, s]: [string, any]) => ({
        key,
        name: s.name,
        class: s.class,
        standardDose: s.standardDose,
    }));

    const day0Protocol = day0Interventions.map(iv => ({
        key: iv.key,
        dose: iv.dose,
        timeMinutes: iv.timeMinutes,
        doseMultiplier: iv.doseMultiplier,
        impacts: iv.impacts,
    }));

    const correctedBaselines = (stratBioOutput.days || []).map(d => ({
        day: d.day,
        baselines: d.correctedBaseline,
    }));

    const desiredCurves = (knightOutput.days || []).map(d => ({
        day: d.day,
        desired: d.desired,
    }));

    return interpolatePrompt(PROMPTS.grandmasterDaily, {
        userGoal,
        correctedBaselines: JSON.stringify(correctedBaselines),
        desiredCurves: JSON.stringify(desiredCurves),
        day0Protocol: JSON.stringify(day0Protocol),
        substanceList: JSON.stringify(substanceList),
        profileText: BiometricState.profileText || 'No profile available.',
    });
}

// ── Assemble DaySnapshots from all 4 agent outputs ──

function assembleDaySnapshots(
    curvesData: CurveData[],
    knightOutput: KnightOutput,
    spotterOutput: SpotterDailyOutput,
    stratBioOutput: StrategistBioDailyOutput,
    grandmasterOutput: GrandmasterDailyOutput,
): DaySnapshot[] {
    const snapshots: DaySnapshot[] = [];
    const channelSpecs = BiometricState.channelSpec || BiometricState.channels || [];

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayNumber = dayIdx + 1;

        const gmDay = (grandmasterOutput.days || []).find((d: any) => d.day === dayNumber);
        const { tempCurvesData, desiredCurves, correctedBaselines, postInterventionBaseline } = buildDayCurvesData(
            dayNumber,
            curvesData,
            knightOutput,
            stratBioOutput,
            gmDay,
        );

        const rawIvs = extractInterventionsData(gmDay || { interventions: [] });
        const validatedIvs = validateInterventions(JSON.parse(JSON.stringify(rawIvs)), tempCurvesData);

        // ── Lx overlay (computed against post-intervention baseline) ──
        const lxCurves = computeLxOverlay(validatedIvs, tempCurvesData);

        // ── Biometric channels from Spotter (merged with day-0 specs for display metadata) ──
        const spotterDay = (spotterOutput.days || []).find((d: any) => d.day === dayNumber);
        const biometricChannels: BiometricChannel[] = (spotterDay?.biometricChannels || []).map(
            (ch: any, idx: number) => {
                const spec = channelSpecs.find((s: any) => s.signal === ch.signal) || channelSpecs[idx] || {};
                return {
                    signal: ch.signal || (spec as any).signal || '',
                    displayName: (spec as any).displayName || (spec as any).metric || ch.signal || '',
                    device: (spec as any).device || '',
                    color: (spec as any).color || '#ff6b6b',
                    range: (spec as any).range || [0, 100],
                    unit: (spec as any).unit || '',
                    data: (ch.data || []).map((p: any) => ({
                        hour: Number(p.hour),
                        value: Number(p.value),
                    })),
                };
            },
        );

        // ── POI events from Spotter ──
        const poiEvents: PoiEvent[] = (spotterDay?.poiEvents || [])
            .map((p: any) => ({
                hour: Number(p.hour) || 12,
                channelIdx: Number(p.channelIdx) || 0,
                label: String(p.label || ''),
                connectedSubstanceKey: p.connectedSubstanceKey || undefined,
            }))
            .slice(0, 8);

        snapshots.push({
            day: dayNumber,
            bioCorrectedBaseline: correctedBaselines,
            desiredCurves,
            postInterventionBaseline,
            interventions: validatedIvs,
            lxCurves,
            biometricChannels,
            poiEvents,
            toleranceProfile: [],
            events: spotterDay?.events || '',
            narrativeBeat: spotterDay?.narrativeBeat || '',
            dayNarrative: gmDay?.dayNarrative || '',
        });
    }

    return snapshots;
}

// ── Run Full Week Pipeline (4-agent sequential) ──

export async function runWeekPipeline(
    curvesData: CurveData[],
    interventions: Intervention[],
    onProgress?: (msg: string) => void,
): Promise<DaySnapshot[]> {
    const userGoal = PhaseState.userGoal || '';
    const biometricChannels = BiometricState.channels;
    const highlights = (BiometricState as any).spotterHighlights || [];

    // Day 0 snapshot from current state
    const day0: DaySnapshot = {
        day: 0,
        bioCorrectedBaseline: curvesData.map(c => [...c.baseline]),
        desiredCurves: curvesData.map(c => [...c.desired]),
        postInterventionBaseline: curvesData.map(c => [...c.baseline]),
        interventions: [...interventions],
        lxCurves: PhaseState.lxCurves ? [...PhaseState.lxCurves] : computeLxOverlay(interventions, curvesData),
        biometricChannels: [...biometricChannels],
        poiEvents: [],
        toleranceProfile: [],
        events: 'Day 0 — baseline protocol applied.',
        narrativeBeat: 'The protocol begins. Baseline established.',
        dayNarrative: 'Initial protocol deployed with biometric monitoring active.',
    };

    const days: DaySnapshot[] = [day0];

    // Step 1: Knight — desired curve evolution
    onProgress?.('Knight: designing curve targets…');
    console.log('[WeekPipeline] Calling Knight...');

    let knightOutput: KnightOutput;
    try {
        knightOutput = await callKnight(userGoal, curvesData);
        MultiDayState.knightOutput = knightOutput;
        MultiDayState.startWeekday = knightOutput.startWeekday || 'Monday';
        console.log('[WeekPipeline] Knight output received:', knightOutput.startWeekday, knightOutput.weekNarrative);
    } catch (err: any) {
        console.error('[WeekPipeline] Knight failed:', err.message);
        throw new Error('Knight agent failed: ' + err.message);
    }

    // Step 2: Spotter Daily — biometric perturbations
    onProgress?.('Spotter: simulating biometrics…');
    console.log('[WeekPipeline] Calling Spotter Daily...');

    let spotterOutput: SpotterDailyOutput;
    try {
        spotterOutput = await callSpotterDaily(
            userGoal,
            curvesData,
            biometricChannels,
            highlights,
            knightOutput.weekNarrative || '',
        );
        console.log('[WeekPipeline] Spotter output received:', spotterOutput.days?.length, 'days');
    } catch (err: any) {
        console.error('[WeekPipeline] Spotter Daily failed:', err.message);
        throw new Error('Spotter Daily agent failed: ' + err.message);
    }

    // Step 3: Strategist Bio Daily — baseline correction
    onProgress?.('Strategist: correcting baselines…');
    console.log('[WeekPipeline] Calling Strategist Bio Daily...');

    let stratBioOutput: StrategistBioDailyOutput;
    try {
        stratBioOutput = await callStrategistBioDaily(userGoal, curvesData, spotterOutput);
        console.log('[WeekPipeline] Strategist Bio output received:', stratBioOutput.days?.length, 'days');
    } catch (err: any) {
        console.error('[WeekPipeline] Strategist Bio Daily failed:', err.message);
        throw new Error('Strategist Bio Daily agent failed: ' + err.message);
    }

    // Step 4: Grandmaster Daily — intervention protocols
    onProgress?.('Grandmaster: optimizing protocols…');
    console.log('[WeekPipeline] Calling Grandmaster Daily...');

    // Build system prompt once — shared by Grandmaster + Referee
    const gmSystemPrompt = buildGrandmasterDailySystemPrompt(
        userGoal,
        curvesData,
        stratBioOutput,
        knightOutput,
        interventions,
    );

    // Check cache before calling — Referee skips correction for cached results
    const gmIsCached = LLMCache.isEnabled('grandmaster-daily-model') && LLMCache.hasData('grandmaster-daily-model');

    let grandmasterOutput: GrandmasterDailyOutput;
    try {
        grandmasterOutput = await callGrandmasterDaily(
            userGoal,
            curvesData,
            stratBioOutput,
            knightOutput,
            interventions,
            gmSystemPrompt,
        );
        console.log('[WeekPipeline] Grandmaster output received:', grandmasterOutput.days?.length, 'days');
    } catch (err: any) {
        console.error('[WeekPipeline] Grandmaster Daily failed:', err.message);
        throw new Error('Grandmaster Daily agent failed: ' + err.message);
    }

    // Step 4.5: Referee — validate stacking per day and correct overshoots
    if (!gmIsCached) {
        onProgress?.('Referee: validating pharmacodynamic stacking…');
        console.log('[WeekPipeline] Running Referee pass...');
        try {
            await runRefereePass(
                grandmasterOutput,
                curvesData,
                knightOutput,
                stratBioOutput,
                gmSystemPrompt,
                onProgress,
            );
            console.log('[WeekPipeline] Referee pass complete');
        } catch (err: any) {
            console.warn('[WeekPipeline] Referee pass failed (non-fatal):', err.message);
        }
    } else {
        console.log('[WeekPipeline] Skipping Referee — Grandmaster output is cached');
    }

    // Step 5: Assemble DaySnapshots (computeLxOverlay per day)
    onProgress?.('Computing pharmacokinetic overlays…');

    const assembled = assembleDaySnapshots(curvesData, knightOutput, spotterOutput, stratBioOutput, grandmasterOutput);
    days.push(...assembled);

    // Sort by day number
    days.sort((a, b) => a.day - b.day);

    console.log(`[WeekPipeline] Assembled ${days.length} day snapshots`);
    return days;
}

// ── Sherlock 7D — Per-day summary narration for STREAM ──

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getWeekdayName(dayNumber: number): string {
    const startWeekday = MultiDayState.startWeekday || 'Monday';
    const startIdx = WEEKDAYS.findIndex(d => d.toLowerCase() === startWeekday.toLowerCase());
    if (startIdx === -1) return `Day ${dayNumber}`;
    return WEEKDAYS[(startIdx + dayNumber - 1) % 7];
}

/** Compute a compact diff summary between two intervention arrays. */
export function buildInterventionDiffSummary(prevIvs: Intervention[], newIvs: Intervention[]): string {
    const prevMap = new Map<string, Intervention[]>();
    for (const iv of prevIvs) prevMap.set(iv.key, [...(prevMap.get(iv.key) || []), iv]);

    const newMap = new Map<string, Intervention[]>();
    for (const iv of newIvs) newMap.set(iv.key, [...(newMap.get(iv.key) || []), iv]);

    const parts: string[] = [];

    // Added substances
    for (const [key, ivs] of newMap) {
        if (!prevMap.has(key)) {
            const iv = ivs[0];
            parts.push(`+${iv.substance?.name || key} ${iv.dose || ''}`);
        }
    }

    // Removed substances
    for (const [key, ivs] of prevMap) {
        if (!newMap.has(key)) {
            const iv = ivs[0];
            parts.push(`-${iv.substance?.name || key}`);
        }
    }

    // Dose changes
    for (const [key, newList] of newMap) {
        const prevList = prevMap.get(key);
        if (!prevList) continue;
        const prevDose = prevList[0]?.dose || '';
        const newDose = newList[0]?.dose || '';
        if (prevDose !== newDose && prevDose && newDose) {
            parts.push(`${newList[0].substance?.name || key} ${prevDose}->${newDose}`);
        }
    }

    return parts.length > 0 ? parts.join(', ') : 'Protocol held steady';
}

/** Build the compact week summary string for the Sherlock 7D prompt. */
function buildWeekSummary(days: DaySnapshot[]): string {
    const lines: string[] = [];
    for (let i = 1; i < days.length; i++) {
        const day = days[i];
        const prev = days[i - 1];
        const weekday = getWeekdayName(day.day);
        const diff = buildInterventionDiffSummary(prev.interventions, day.interventions);
        lines.push(
            `Day ${day.day} (${weekday}): ${day.events || 'No notable events.'}` +
                `\n  Narrative: ${day.dayNarrative || day.narrativeBeat || 'Steady state.'}` +
                `\n  Changes: ${diff}`,
        );
    }
    return lines.join('\n\n');
}

/** Call the Sherlock 7D LLM agent to produce per-day summary narration. */
export async function callSherlock7D(days: DaySnapshot[], userGoal: string): Promise<Sherlock7DNarration> {
    const weekSummary = buildWeekSummary(days);
    const systemPrompt = interpolatePrompt(PROMPTS.sherlock7d, { userGoal, weekSummary });
    const userPrompt = 'Narrate each day of the 7-day protocol adaptation in Sherlock style. Respond with JSON only.';

    const result = (await callGenericForStage(
        'sherlock7d',
        systemPrompt,
        userPrompt,
        2048,
        'Sherlock 7D',
        'sherlock7d-model',
    )) as Sherlock7DNarration;

    return result;
}

/** Build fallback Sherlock 7D narration from existing DaySnapshot narratives. */
export function buildFallbackSherlock7D(days: DaySnapshot[]): Sherlock7DNarration {
    const beats: Sherlock7DBeat[] = [];
    for (let i = 1; i < days.length; i++) {
        const day = days[i];
        const prev = days[i - 1];
        const weekday = getWeekdayName(day.day);
        const diff = buildInterventionDiffSummary(prev.interventions, day.interventions);

        // Derive direction from intervention count delta
        const countDelta = day.interventions.length - prev.interventions.length;
        const direction: 'up' | 'down' | 'neutral' = countDelta > 0 ? 'up' : countDelta < 0 ? 'down' : 'neutral';

        // Find most-changed substance
        const prevKeys = new Set(prev.interventions.map(iv => iv.key));
        const newKeys = new Set(day.interventions.map(iv => iv.key));
        const addedIv = day.interventions.find(iv => !prevKeys.has(iv.key));
        const removedIv = prev.interventions.find(iv => !newKeys.has(iv.key));
        const topIv = addedIv || removedIv || day.interventions[0];

        beats.push({
            day: day.day,
            weekday,
            text: day.dayNarrative || day.narrativeBeat || `Day ${day.day} protocol adaptation.`,
            direction,
            keyChanges: diff,
            topSubstanceKey: topIv?.key,
            topSubstanceName: topIv?.substance?.name,
        });
    }
    return {
        beats,
        outro: 'Seven days of adaptation. The protocol has learned your rhythm.',
    };
}
