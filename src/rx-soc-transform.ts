/**
 * Rx-SOC Transform — deterministic derivation of a "standard-of-care Rx"
 * protocol from an existing Lx cycle bundle, for side-by-side investor-demo
 * contrast.
 *
 * SOC friction rules applied to the cycle's day-0 Lx interventions, then
 * replicated across all 7 days (no real-time adaptation):
 *   - Polypharmaceutical friction: prune to at most 1 substance per curve
 *     (max 2 total); keep the highest net-impact substance per curve.
 *   - Chronopharmaceutic friction: flatten timing to a single 08:00 dose
 *     per surviving substance.
 *   - No real-time adaptation: identical interventions for days 1–7.
 *
 * Pure — no DOM, no AppState mutation. Safe to call from tests.
 */
import type { CurveData, DaySnapshot, Intervention, LxCurve, SocrxStageResult } from './types';
import type { SessionCacheBundle } from './llm-cache';
import { computeLxOverlay } from './lx-compute';
import { compute7DEffectScores, EFFECT_SCORE_FORMULA_VERSION } from './effect-score';
import { SUBSTANCE_DB } from './substances';
import { socrxPicksToInterventions } from './socrx-mapper';

export const RX_SOC_TWIN_SCHEMA_VERSION = 6;

/**
 * Rank of regulatory tiers as a standard-of-care prescriber would weight
 * them — a doctor treating ADHD picks Vyvanse, not magnesium, regardless
 * of which has the higher per-impact coefficient in the LLM's Lx plan.
 * Higher number = more prescribable.
 */
const RX_TIER_RANK: Record<string, number> = {
    Controlled: 3,
    Prescription: 3,
    OTC: 2,
    Supplement: 1,
};

function rxTierRank(iv: Intervention): number {
    const sub = iv.substance || SUBSTANCE_DB[iv.key];
    const status = sub?.regulatoryStatus;
    return RX_TIER_RANK[status as string] ?? 0;
}
export const RX_SOC_DEFAULT_DOSE_TIME_MINUTES = 8 * 60; // 08:00
/** @deprecated use RX_SOC_DEFAULT_DOSE_TIME_MINUTES */
export const RX_SOC_DOSE_TIME_MINUTES = RX_SOC_DEFAULT_DOSE_TIME_MINUTES;
export const RX_SOC_MAX_SUBSTANCES = 2;

export interface RxSocTransformRules {
    maxSubstances: number;
    doseTimeMinutes: number;
    adaptive: false;
    notes: string;
}

export interface RxSocTwin {
    version: number;
    generatedAt: string;
    transformRules: RxSocTransformRules;
    /** Identical Intervention[] replicated across 7 days (index 0..6 = day 1..7). */
    interventions7D: Intervention[][];
    /** Lx curves for each of the 7 days under the SOC protocol. */
    lxCurves7D: LxCurve[][];
    /** Per-curve gap-closure % averaged across 7 days. */
    effectScores: number[];
    effectScoresVersion: number;
    /** LLM-provided short label like "ADHD, adult, uncomplicated" (SOCRx path). */
    conditionLabel?: string;
    /** 1–2 sentence clinician-voice byline (SOCRx path). */
    narrative?: string;
    /** Set when deterministic `pruneToSoc` fallback was used. */
    socrxFallbackReason?: 'llm_unavailable' | 'no_valid_picks';
    /** True when the twin was built with per-drug LLM-picked timeMinutes. */
    perDrugTimes?: boolean;
}

interface ExtractedWeek {
    days: DaySnapshot[];
    day0Interventions: Intervention[];
}

function cloneInterventions(ivs: Intervention[]): Intervention[] {
    return ivs.map(iv => JSON.parse(JSON.stringify(iv)) as Intervention);
}

function extractWeekFromBundle(bundle: SessionCacheBundle): ExtractedWeek | null {
    const replayPayload = (bundle?.stages as any)?.['runtime-replay-state']?.payload;
    const days: DaySnapshot[] | undefined = replayPayload?.week?.days;
    if (!Array.isArray(days) || days.length === 0) return null;
    const day0 = days[0];
    // Deep clone so downstream mutations (validateInterventions resolves
    // substance refs, spreads colors, clamps timeMinutes) never touch the
    // caller's bundle.
    const day0Interventions = Array.isArray(day0?.interventions)
        ? (JSON.parse(JSON.stringify(day0.interventions)) as Intervention[])
        : [];
    return { days, day0Interventions };
}

/**
 * Aggregate a substance's impact magnitude on the given target curve's
 * effect name. Returns 0 when none of the intervention's impacts match —
 * so a substance that only affects collateral curves never wins the pick
 * for a curve it doesn't target.
 */
function substanceImpactOnCurve(iv: Intervention, curve: CurveData | undefined): number {
    if (!iv.impacts || typeof iv.impacts !== 'object') return 0;
    if (!curve) return 0;
    const effectName = (curve.effect || '').toLowerCase();
    if (!effectName) return 0;
    let onCurve = 0;
    for (const [k, v] of Object.entries(iv.impacts)) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        const keyLower = String(k).toLowerCase();
        if (keyLower === effectName || keyLower.includes(effectName) || effectName.includes(keyLower)) {
            onCurve += Math.abs(n);
        }
    }
    return onCurve;
}

/**
 * Prune day-0 interventions to at most one per target curve (max total =
 * RX_SOC_MAX_SUBSTANCES). Within each curve's candidate set, rank by the
 * substance's impact on THAT curve's effect (not global magnitude) so we
 * never pick a substance that targets a non-rendered side effect. Tie-break
 * by lower existing dose count (fewer pills = more SOC-like); then
 * alphabetical on key for determinism.
 */
function pruneToSoc(day0: Intervention[], curvesData: CurveData[]): Intervention[] {
    if (!Array.isArray(day0) || day0.length === 0) return [];

    // Group by target curve idx. Interventions with no idx fall to -1 and
    // get scored against curve 0 as a best-effort fallback.
    const byCurve = new Map<number, Intervention[]>();
    for (const iv of day0) {
        const idx = typeof iv.targetCurveIdx === 'number' && iv.targetCurveIdx >= 0 ? iv.targetCurveIdx : 0;
        if (!byCurve.has(idx)) byCurve.set(idx, []);
        byCurve.get(idx)!.push(iv);
    }

    const doseCountByKey = new Map<string, number>();
    for (const iv of day0) {
        doseCountByKey.set(iv.key, (doseCountByKey.get(iv.key) || 0) + 1);
    }

    const picked: Intervention[] = [];
    const seenKeys = new Set<string>();
    const curveIdxs = Array.from(byCurve.keys()).sort((a, b) => a - b);
    for (const idx of curveIdxs) {
        const curve = curvesData[idx];
        const candidates = byCurve.get(idx)!;
        const bestPerKey = new Map<string, Intervention>();
        for (const iv of candidates) {
            const prev = bestPerKey.get(iv.key);
            if (!prev || substanceImpactOnCurve(iv, curve) > substanceImpactOnCurve(prev, curve)) {
                bestPerKey.set(iv.key, iv);
            }
        }
        const uniqueCandidates = Array.from(bestPerKey.values());
        uniqueCandidates.sort((a, b) => {
            // Prefer higher Rx tier first — a prescriber picks the
            // Controlled/Prescription drug over a supplement for the same
            // target even if the supplement's Lx impact coefficient is
            // comparable. That's what makes this a "SOC Rx" story.
            const tierDiff = rxTierRank(b) - rxTierRank(a);
            if (tierDiff !== 0) return tierDiff;
            const impDiff = substanceImpactOnCurve(b, curve) - substanceImpactOnCurve(a, curve);
            if (Math.abs(impDiff) > 1e-9) return impDiff;
            const countDiff = (doseCountByKey.get(a.key) || 0) - (doseCountByKey.get(b.key) || 0);
            if (countDiff !== 0) return countDiff;
            return a.key.localeCompare(b.key);
        });
        const best = uniqueCandidates[0];
        if (best && !seenKeys.has(best.key)) {
            picked.push(best);
            seenKeys.add(best.key);
        }
        if (picked.length >= RX_SOC_MAX_SUBSTANCES) break;
    }

    return picked;
}

/**
 * Flatten all surviving interventions to a single 08:00 dose (deterministic
 * fallback path). Clears multipliers and bioTriggers — SOC has no intra-day
 * adaptation.
 */
function flattenTimingAllMorning(ivs: Intervention[]): Intervention[] {
    return ivs.map(iv => {
        const out = JSON.parse(JSON.stringify(iv)) as Intervention;
        out.timeMinutes = RX_SOC_DEFAULT_DOSE_TIME_MINUTES;
        out.doseMultiplier = 1;
        out.bioTrigger = undefined;
        return out;
    });
}

/**
 * Normalize SOC timing for the LLM-hint path: preserves per-drug fixed
 * daily time (already clamped by the mapper), but still clears multipliers
 * and bioTriggers so the Rx side stays non-adaptive.
 */
function normalizeSocTiming(ivs: Intervention[]): Intervention[] {
    return ivs.map(iv => {
        const out = JSON.parse(JSON.stringify(iv)) as Intervention;
        out.doseMultiplier = 1;
        out.bioTrigger = undefined;
        return out;
    });
}

/**
 * Build the full Rx-SOC twin from a cycle bundle + canonical curves.
 *
 * Returns null if the bundle has no usable week data (e.g. single-day
 * cycles that never ran the multi-day pipeline).
 */
export function buildRxSocTwin(
    bundle: SessionCacheBundle,
    curvesData: CurveData[],
    hints?: SocrxStageResult | null,
): RxSocTwin | null {
    if (!bundle || !Array.isArray(curvesData) || curvesData.length === 0) return null;

    const extracted = extractWeekFromBundle(bundle);
    if (!extracted || extracted.days.length < 2) return null;

    let socInterventions: Intervention[];
    let fallbackReason: 'llm_unavailable' | 'no_valid_picks' | undefined;
    let perDrugTimes = false;

    if (hints && Array.isArray(hints.picks) && hints.picks.length > 0) {
        const mapped = socrxPicksToInterventions(hints.picks, curvesData, extracted.day0Interventions);
        if (mapped && mapped.length > 0) {
            socInterventions = normalizeSocTiming(mapped);
            perDrugTimes = true;
        } else {
            const pruned = pruneToSoc(extracted.day0Interventions, curvesData);
            socInterventions = flattenTimingAllMorning(pruned);
            fallbackReason = 'no_valid_picks';
        }
    } else {
        const pruned = pruneToSoc(extracted.day0Interventions, curvesData);
        socInterventions = flattenTimingAllMorning(pruned);
        if (hints === null) fallbackReason = 'llm_unavailable';
    }

    const interventions7D: Intervention[][] = [];
    const lxCurves7D: LxCurve[][] = [];
    const synthesizedDays: DaySnapshot[] = [];

    // Rx protocol itself is static (same substances, same doses, same times
    // every day — that's the SOC contrast). But the Rx overlay must ride on
    // the same shifting baseline the Lx overlay rides on: use the day's
    // postInterventionBaseline (what the Lx panel renders) so the thick Rx
    // stroke sits directly on the same dashed baseline the user sees on both
    // panels. Fall back to bioCorrectedBaseline, then canonical.
    const dayCount = Math.min(extracted.days.length, 7);
    for (let i = 0; i < dayCount; i++) {
        const day = extracted.days[i];
        const dayInterventions = cloneInterventions(socInterventions);

        const dayCurvesData: CurveData[] = curvesData.map((c, idx) => {
            const pib = day.postInterventionBaseline?.[idx];
            const bcb = day.bioCorrectedBaseline?.[idx];
            return {
                ...c,
                baseline: pib?.length ? pib : bcb?.length ? bcb : c.baseline,
                desired: day.desiredCurves?.[idx]?.length ? day.desiredCurves[idx] : c.desired,
            };
        });
        const lxCurves = computeLxOverlay(cloneInterventions(dayInterventions), dayCurvesData) as LxCurve[];

        interventions7D.push(dayInterventions);
        lxCurves7D.push(lxCurves);

        synthesizedDays.push({
            day: day.day || i + 1,
            bioCorrectedBaseline: day.bioCorrectedBaseline || [],
            desiredCurves: day.desiredCurves || [],
            postInterventionBaseline: day.postInterventionBaseline?.length
                ? day.postInterventionBaseline
                : day.bioCorrectedBaseline || [],
            interventions: dayInterventions,
            lxCurves,
            biometricChannels: [],
            poiEvents: [],
            toleranceProfile: [],
            events: '',
            narrativeBeat: '',
            dayNarrative: '',
        });
    }

    const effectScores = compute7DEffectScores(synthesizedDays, curvesData);

    const twin: RxSocTwin = {
        version: RX_SOC_TWIN_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        transformRules: {
            maxSubstances: RX_SOC_MAX_SUBSTANCES,
            doseTimeMinutes: RX_SOC_DEFAULT_DOSE_TIME_MINUTES,
            adaptive: false,
            notes: perDrugTimes
                ? 'SOCRx: LLM-picked substance(s), per-drug fixed daily time, no adaptation'
                : 'SOC: max 2 substances, single 08:00 dose, no daily adaptation',
        },
        interventions7D,
        lxCurves7D,
        effectScores,
        effectScoresVersion: EFFECT_SCORE_FORMULA_VERSION,
    };

    if (perDrugTimes && hints) {
        if (typeof hints.conditionLabel === 'string' && hints.conditionLabel.trim().length > 0) {
            twin.conditionLabel = hints.conditionLabel.trim();
        }
        if (typeof hints.narrative === 'string' && hints.narrative.trim().length > 0) {
            twin.narrative = hints.narrative.trim();
        }
        twin.perDrugTimes = true;
    }
    if (fallbackReason) twin.socrxFallbackReason = fallbackReason;

    return twin;
}
