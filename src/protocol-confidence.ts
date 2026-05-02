/**
 * protocol-confidence — Aggregate protocol-level confidence from per-substance
 * dataConfidence values in the substance database.
 *
 * Uses a penalty-weighted floor model: a weighted average of per-substance
 * confidence tiers, pulled down by the weakest substance so one low-confidence
 * ingredient can't hide behind five clinical-grade ones.
 *
 * Exports:
 *   - CONFIDENCE_FORMULA_VERSION — schema version for cache invalidation
 *   - computeProtocolConfidence — pure function: intervention keys → aggregate score + tier
 */

import { SUBSTANCE_DB } from './substances';

/** Schema version. Bump when the formula changes to invalidate cached scores. */
export const CONFIDENCE_FORMULA_VERSION = 1;

/** Numeric weight per dataConfidence tier. */
const TIER_WEIGHT: Record<string, number> = {
    high: 1.0,
    medium: 0.65,
    estimated: 0.35,
    low: 0.1,
};

/** How much the weakest substance pulls down the average (0–1). */
const PENALTY_FACTOR = 0.3;

export interface ProtocolConfidenceResult {
    /** Aggregate score 0–100. */
    score: number;
    /** Human-readable tier label. */
    tier: 'Clinical' | 'Research' | 'Exploratory' | 'Open Run';
    /** Per-substance confidence: substanceKey → 'High'|'Medium'|'Estimated'|'Low'. */
    perSubstance: Record<string, string>;
}

function tierFromScore(score: number): ProtocolConfidenceResult['tier'] {
    if (score >= 85) return 'Clinical';
    if (score >= 60) return 'Research';
    if (score >= 35) return 'Exploratory';
    return 'Open Run';
}

/**
 * Compute an aggregate protocol confidence score from the intervention keys.
 * Returns null if no valid substances are found.
 */
export function computeProtocolConfidence(interventionKeys: string[]): ProtocolConfidenceResult | null {
    if (!interventionKeys || interventionKeys.length === 0) return null;

    const perSubstance: Record<string, string> = {};
    const weights: number[] = [];

    for (const key of interventionKeys) {
        const sub = (SUBSTANCE_DB as any)[key];
        if (!sub) continue;
        const rawConf: string = (sub.dataConfidence || 'estimated').toLowerCase();
        const w = TIER_WEIGHT[rawConf] ?? TIER_WEIGHT.estimated;
        weights.push(w);
        // Store display-cased version
        const displayConf =
            rawConf === 'high' ? 'High' : rawConf === 'medium' ? 'Medium' : rawConf === 'low' ? 'Low' : 'Estimated';
        perSubstance[key] = displayConf;
    }

    if (weights.length === 0) return null;

    const rawAvg = weights.reduce((a, b) => a + b, 0) / weights.length;
    const minW = Math.min(...weights);
    const penalty = (1 - minW) * PENALTY_FACTOR;
    const score = Math.round(Math.max(0, Math.min(100, rawAvg * (1 - penalty) * 100)));

    return { score, tier: tierFromScore(score), perSubstance };
}
