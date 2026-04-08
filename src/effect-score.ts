/**
 * effect-score — 7D average gap-closure % per effect for wide stream cards.
 *
 * Semantics: "What percentage of the baseline→desired gap does the protocol
 * actually close?" Computed as Σ(lx - baseline) / Σ(desired - baseline) * 100
 * over the hours where the gap is meaningful. This is bounded, stable, and
 * semantically sharp — unlike a raw peak ratio, it cannot explode on low-
 * baseline points where the denominator approaches zero.
 *
 * Earlier versions used `computeEffectImprovement` (peak ratio shift / baseline),
 * which produced pathological values like 1200% when a stimulant lifted a
 * near-zero sleep-hour baseline. Gap closure fixes that by construction.
 *
 * Exports:
 *   - EFFECT_SCORE_FORMULA_VERSION — schema version to invalidate old caches
 *   - compute7DEffectScores — from live runtime state (DaySnapshot[] + CurveData[])
 *   - compute7DScoresFromBundle — from a saved bundle (lazy migration path)
 *   - computeDesignEffectScores — from single-day (24h) design state
 */

import type { CurveData, CurvePoint, DaySnapshot, LxCurve } from './types';
import type { SessionCacheBundle } from './cycle-store';

/**
 * Schema version for cached effect scores. Bumped when the formula changes
 * so old cached scores can be invalidated and recomputed.
 *
 * v1: peak ratio (computeEffectImprovement) — pathological at low baselines
 * v2: gap closure — Σ(lx - baseline) / Σ(desired - baseline) * 100
 */
export const EFFECT_SCORE_FORMULA_VERSION = 2;

/** Hours to skip at chart edges (avoids wrap-around artifacts at h0 / h24). */
const EDGE_SKIP = 1;
/** Minimum meaningful gap magnitude (ignore baseline≈desired hours). */
const MIN_GAP_MAGNITUDE = 3;
/** Clamp scores so outliers can't still dominate averages. */
const SCORE_CAP = 150;

/**
 * Gap-closure metric for a single curve: what fraction of the baseline→desired
 * gap does the lx overlay actually close, across the hours where the gap is
 * meaningful? Returns null if no meaningful-gap hours exist.
 *
 * Formula: Σ(lx - baseline) / Σ(desired - baseline) * 100
 *   - higher_is_better: positive lx shift toward desired counts as progress
 *   - higher_is_worse:  both numerator and denominator flip sign, yielding
 *                       the same "% of gap closed" semantics.
 *
 * Clamped to [0, SCORE_CAP] so a protocol that overshoots target returns
 * at most SCORE_CAP%, and undershoots stay nonnegative.
 */
export function computeGapClosure(
    lxPoints: CurvePoint[],
    baseline: CurvePoint[],
    desired: CurvePoint[],
    polarity: string | undefined,
): number | null {
    if (!lxPoints?.length || !baseline?.length || !desired?.length) return null;
    const len = Math.min(lxPoints.length, baseline.length, desired.length);
    if (len <= EDGE_SKIP * 2) return null;

    const higherIsWorse = polarity === 'higher_is_worse';
    let num = 0;
    let den = 0;
    let counted = 0;

    for (let i = EDGE_SKIP; i < len - EDGE_SKIP; i++) {
        const b = baseline[i]?.value;
        const d = desired[i]?.value;
        const lx = lxPoints[i]?.value;
        if (b == null || d == null || lx == null) continue;

        // gap: how much the desired state wants you to move from baseline
        const gap = higherIsWorse ? b - d : d - b;
        if (Math.abs(gap) < MIN_GAP_MAGNITUDE) continue;

        // shift: how much the protocol actually moved you
        const shift = higherIsWorse ? b - lx : lx - b;

        num += shift;
        den += gap;
        counted++;
    }

    if (counted === 0 || den <= 0) return null;
    const pct = (num / den) * 100;
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(SCORE_CAP, pct));
}

/**
 * Compute per-effect gap-closure % from a single-day (24h) design state.
 * Used for 24h cards that don't run the 7D multi-day pipeline.
 */
export function computeDesignEffectScores(lxCurves: LxCurve[], curvesData: CurveData[]): number[] {
    if (!Array.isArray(lxCurves) || !Array.isArray(curvesData)) return [];
    const n = Math.min(lxCurves.length, curvesData.length, 2);
    const scores: number[] = [];
    for (let i = 0; i < n; i++) {
        const lx = lxCurves[i]?.points;
        const baseline = curvesData[i]?.baseline || [];
        const desired = curvesData[i]?.desired || [];
        const polarity = curvesData[i]?.polarity;
        if (!lx?.length || !baseline.length || !desired.length) {
            scores.push(0);
            continue;
        }
        const closure = computeGapClosure(lx, baseline, desired, polarity);
        scores.push(closure != null ? closure : 0);
    }
    return scores;
}

/**
 * Average the per-day gap-closure % for each effect in curvesData.
 * Returns an array aligned to curvesData indices. Entries where every day
 * was null are set to 0 (caller can filter if desired).
 */
export function compute7DEffectScores(days: DaySnapshot[], curvesData: CurveData[]): number[] {
    if (!Array.isArray(days) || days.length === 0) return [];
    if (!Array.isArray(curvesData) || curvesData.length === 0) return [];

    const effectCount = Math.min(curvesData.length, 2);
    const scores: number[] = [];

    for (let effectIdx = 0; effectIdx < effectCount; effectIdx++) {
        const polarity = curvesData[effectIdx]?.polarity;
        const fallbackDesired = curvesData[effectIdx]?.desired || [];
        const perDay: number[] = [];

        for (const day of days) {
            const lxCurve = day.lxCurves?.[effectIdx];
            const baseline = day.bioCorrectedBaseline?.[effectIdx];
            const desired = day.desiredCurves?.[effectIdx] || fallbackDesired;

            if (!lxCurve?.points || !baseline || !desired.length) continue;

            const closure = computeGapClosure(lxCurve.points, baseline, desired, polarity);
            if (closure != null) perDay.push(closure);
        }

        if (perDay.length === 0) {
            scores.push(0);
        } else {
            const avg = perDay.reduce((a, b) => a + b, 0) / perDay.length;
            scores.push(Math.max(0, avg));
        }
    }

    return scores;
}

/**
 * Reconstruct scores from a saved bundle — for cycles saved before this
 * feature existed, for extended program cycles, or for 24h cycles.
 *
 * Path priority:
 *   1. runtime-replay-state.week → exact DaySnapshot[] (7D multi-day runs)
 *   2. grandmaster-daily-model + strategist-bio-daily-model → rebuild DaySnapshots
 *   3. runtime-replay-state.design → 24h lxCurves vs baseline (single-day runs)
 *   4. main-model.curves → peak baseline→desired gap (extended / pattern cycles)
 *
 * Returns null if the bundle has no usable curves data.
 */
export function compute7DScoresFromBundle(bundle: SessionCacheBundle): number[] | null {
    if (!bundle?.stages) return null;

    const replayPayload = (bundle.stages as any)['runtime-replay-state']?.payload;
    const replayDays: DaySnapshot[] | undefined = replayPayload?.week?.days;
    const replayCurves: CurveData[] | undefined = replayPayload?.design?.curvesData;
    const replayDesignLx: LxCurve[] | undefined = replayPayload?.design?.lxCurves;
    const replayBioLx: LxCurve[] | undefined = replayPayload?.bioCorrected?.lxCurves;
    const replayRevisionLx: LxCurve[] | undefined = replayPayload?.revision?.lxCurves;

    // Path 1: runtime replay has everything pre-computed
    if (Array.isArray(replayDays) && replayDays.length >= 2 && Array.isArray(replayCurves) && replayCurves.length > 0) {
        return compute7DEffectScores(replayDays, replayCurves);
    }

    // Path 3 (24h): runtime replay has design.lxCurves + design.curvesData (revision/bio preferred)
    if (Array.isArray(replayCurves) && replayCurves.length > 0) {
        const bestLx = replayRevisionLx || replayBioLx || replayDesignLx;
        if (Array.isArray(bestLx) && bestLx.length > 0) {
            const scores = computeDesignEffectScores(bestLx, replayCurves);
            if (scores.some(s => s > 0)) return scores;
        }
    }

    // Path 2/3 both need main-model curves for polarity + fallback
    const mainPayload = (bundle.stages as any)['main-model']?.payload;
    const curvesRaw: any[] = mainPayload?.curves || [];
    if (curvesRaw.length === 0) return null;

    const curvesData: CurveData[] = curvesRaw.slice(0, 2).map((c: any) => ({
        effect: c.effect || '',
        color: c.color || '#60a5fa',
        baseline: c.baseline || [],
        desired: c.desired || [],
        polarity: c.polarity === 'higher_is_worse' ? 'higher_is_worse' : 'higher_is_better',
    }));

    // Path 2: rebuild DaySnapshots from the multi-day pipeline stages
    const knightPayload = (bundle.stages as any)['knight-model']?.payload;
    const stratBioPayload = (bundle.stages as any)['strategist-bio-daily-model']?.payload;
    const gmPayload = (bundle.stages as any)['grandmaster-daily-model']?.payload;

    if (knightPayload?.days && stratBioPayload?.days && gmPayload?.days) {
        const days: DaySnapshot[] = [];
        for (let dayNum = 1; dayNum <= 7; dayNum++) {
            const knightDay = (knightPayload.days as any[]).find((d: any) => d.day === dayNum);
            const stratDay = (stratBioPayload.days as any[]).find((d: any) => d.day === dayNum);
            const gmDay = (gmPayload.days as any[]).find((d: any) => d.day === dayNum);
            if (!stratDay || !gmDay) continue;

            const bioCorrectedBaseline: CurvePoint[][] = curvesData.map(c => {
                const match = (stratDay.correctedBaseline || []).find((e: any) => e.effect === c.effect);
                return match?.baseline || c.baseline || [];
            });

            const desiredCurves: CurvePoint[][] = curvesData.map(c => {
                const match = (knightDay?.desired || []).find((e: any) => e.effect === c.effect);
                return match?.desired || c.desired || [];
            });

            const postIv = gmDay.postInterventionBaseline;
            if (!Array.isArray(postIv) || postIv.length === 0) continue;

            const lxCurves: LxCurve[] = curvesData.map((c, idx) => {
                const match = postIv.find((e: any) => e.effect === c.effect);
                return {
                    points: match?.baseline || bioCorrectedBaseline[idx] || [],
                    desired: desiredCurves[idx] || [],
                    baseline: bioCorrectedBaseline[idx] || [],
                };
            });

            days.push({
                day: dayNum,
                bioCorrectedBaseline,
                desiredCurves,
                postInterventionBaseline: bioCorrectedBaseline,
                interventions: [],
                lxCurves,
                biometricChannels: [],
                poiEvents: [],
                toleranceProfile: [],
                events: '',
                narrativeBeat: '',
                dayNarrative: '',
            });
        }

        if (days.length >= 2) {
            return compute7DEffectScores(days, curvesData);
        }
    }

    // Path 4: extended / pattern cycles — no lx overlay available, fall back to
    // the strategist's peak baseline→desired gap. This is the program's target
    // improvement (what the LLM committed to achieving), not a measured outcome,
    // but it's the closest analogue for a card badge when no runtime is stored.
    // Uses gap closure with desired-as-lx, so it always returns ~100% when data
    // is coherent — effectively a "target set" indicator.
    const scores: number[] = [];
    for (const c of curvesData) {
        if (!c.baseline?.length || !c.desired?.length) {
            scores.push(0);
            continue;
        }
        const closure = computeGapClosure(c.desired, c.baseline, c.desired, c.polarity);
        scores.push(closure != null ? closure : 0);
    }
    return scores.some(s => s > 0) ? scores : null;
}
