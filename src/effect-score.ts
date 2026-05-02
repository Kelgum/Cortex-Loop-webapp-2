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
import { computeLxOverlay } from './lx-compute';
import { computeEffectImprovement } from './gamification-overlay';

/**
 * Schema version for cached effect scores. Bumped when the formula changes
 * so old cached scores can be invalidated and recomputed.
 *
 * v1: peak ratio (computeEffectImprovement) — pathological at low baselines
 * v2: gap closure — Σ(lx - baseline) / Σ(desired - baseline) * 100
 * v3: gap closure, uncapped — true 7D average, no per-day ceiling
 * v4: peak Cmax-shift ratio (computeEffectImprovement), averaged across days.
 *     Matches the per-day gamification box score exactly — the 7D card shows
 *     the average of the 7 daily peak scores.
 * v5: same formula as v4. Invalidates v4 cache entries that were incorrectly
 *     stamped during the v3→v4 HMR transition (version bumped before formula
 *     swap landed, leaving stale gap-closure values under a v4 tag).
 * v6: reads lxCurve.baseline (the smoothed baseline that the runtime
 *     gamification box actually uses) instead of day.bioCorrectedBaseline
 *     (the raw pre-smoothing version, which can dip to near-zero and cause
 *     Cmax ratios to explode to 1000%+). v5 cache invalidated because it
 *     was computed against the raw baseline.
 * v7: adds a baseline-peak-relative denominator floor inside
 *     computeEffectImprovement (gamification-overlay.ts). v6 only guarded
 *     |b| < 2, which still admitted legitimate low-baseline hours like
 *     idx 23 on a Sleep Maintenance curve (b≈3, lx≈32 → 974% per day,
 *     1535% 7D average for "Toddler Proof Sleep"). v7 skips hours where
 *     b < 20% of the baseline's own peak, so off-hour residuals can't
 *     blow up the ratio. v6 cache invalidated.
 */
export const EFFECT_SCORE_FORMULA_VERSION = 8;

/** Hours to skip at chart edges (avoids wrap-around artifacts at h0 / h24). */
const EDGE_SKIP = 1;
/** Minimum meaningful gap magnitude (ignore baseline≈desired hours). */
const MIN_GAP_MAGNITUDE = 3;

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
 * Lower-bounded at 0 so undershoots stay nonnegative. No upper cap — a
 * protocol that overshoots target returns its true overshoot, so the 7D
 * average reflects the real gap-closure distribution.
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
    return Math.max(0, pct);
}

/**
 * Compute per-effect peak-improvement % from a single-day (24h) design state.
 * Uses the SAME formula as the per-day gamification box (Cmax shift from
 * baseline), so a 24h card reflects the exact number a user would see if
 * they opened the day in the gamification overlay.
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
        const peak = computeEffectImprovement(lx, baseline, desired, polarity);
        scores.push(peak != null ? peak : 0);
    }
    return scores;
}

/**
 * Average the per-day peak-improvement % for each effect in curvesData.
 * Each day's number is the exact same Cmax-shift score shown in the
 * per-day gamification box; the 7D card shows the mean across all days.
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
            // Use the SMOOTHED baseline that the runtime gamification box reads
            // (lxCurve.baseline), not the raw bio-corrected baseline. The raw
            // version can dip to pathological lows (e.g. 2) that blow up the
            // Cmax ratio to 2000%+, while the on-screen box reads the smoothed
            // version (min ~12) and shows sane values like 106%. Reading
            // lxCurve.baseline here guarantees the 7D card average matches the
            // sum of the per-day boxes exactly.
            const baseline = (lxCurve as any)?.baseline || day.bioCorrectedBaseline?.[effectIdx];
            const desired = day.desiredCurves?.[effectIdx] || fallbackDesired;

            if (!lxCurve?.points || !baseline || !desired.length) continue;

            const peak = computeEffectImprovement(lxCurve.points, baseline, desired, polarity);
            if (peak != null) perDay.push(peak);
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

    // ── Program-mode path ──────────────────────────────────────────────
    // Program-mode cycles (extended-strategist) store effectRoster with
    // DAILY data points ({day, value} over N days), not hourly 24h curves.
    // Compute the peak Cmax-shift metric across days, using the same
    // semantics as the 24h gamification box: peak |(desired - baseline)| /
    // |baseline| * 100, averaged across the program duration.
    // This must run BEFORE the hourly paths which would misinterpret the
    // day indices as hours and produce nonsensical scores.
    const rosterRaw: any[] = (bundle.stages as any)['extended-strategist']?.payload?.effectRoster || [];
    if (rosterRaw.length > 0 && rosterRaw[0]?.baseline?.[0]?.day != null) {
        const scores: number[] = [];
        const count = Math.min(rosterRaw.length, 2);
        for (let i = 0; i < count; i++) {
            const r = rosterRaw[i];
            const bl: any[] = r.baseline || [];
            const des: any[] = r.desired || [];
            const higherIsWorse = r.polarity === 'higher_is_worse';
            if (bl.length === 0 || des.length === 0) {
                scores.push(0);
                continue;
            }
            // Find the peak baseline value to use as denominator floor
            const blPeak = bl.reduce((mx: number, p: any) => Math.max(mx, Math.abs(p?.value ?? 0)), 0);
            const blFloor = blPeak * 0.2;
            // Compute per-day peak shift, then average
            const len = Math.min(bl.length, des.length);
            let peakShift = 0;
            let counted = 0;
            for (let d = 0; d < len; d++) {
                const bv = bl[d]?.value;
                const dv = des[d]?.value;
                if (bv == null || dv == null) continue;
                const absBv = Math.abs(bv);
                if (absBv < blFloor) continue; // skip low-baseline days
                const shift = higherIsWorse ? bv - dv : dv - bv;
                if (shift <= 0) continue;
                const pct = (shift / absBv) * 100;
                if (pct > peakShift) peakShift = pct;
                counted++;
            }
            scores.push(counted > 0 ? Math.max(0, peakShift) : 0);
        }
        if (scores.some(s => s > 0)) return scores;
    }

    // Path 2/3 both need curves for polarity + fallback.
    // Program-mode cycles store the complete effect roster (2 effects) in
    // extended-strategist; main-model may only have 1 curve. Prefer the
    // roster when it has more effects.
    const mainPayload = (bundle.stages as any)['main-model']?.payload;
    const mainCurvesRaw: any[] = mainPayload?.curves || [];

    // Pick the source with more curves (roster usually has 2, main-model may have 1)
    const curvesRaw: any[] = rosterRaw.length > mainCurvesRaw.length ? rosterRaw : mainCurvesRaw;
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

    // Path 4: extended / pattern cycles — no runtime lx stored, but we have
    // the main-model curves + the Chess Player's intervention list. Recompute
    // a fresh 24h lx overlay from those and measure real gap closure against
    // it. Previously this path used desired-as-lx, which trivially returned
    // 100% for every card and made the "cap at 100%" look real.
    const ivPayload =
        (bundle.stages as any)['extended-intervention']?.payload ||
        (bundle.stages as any)['intervention-model']?.payload;
    const interventions: any[] =
        (Array.isArray(ivPayload?.interventions) && ivPayload.interventions) ||
        (Array.isArray(ivPayload) && ivPayload) ||
        [];

    if (interventions.length > 0) {
        try {
            const lxCurves = computeLxOverlay(interventions, curvesData) as LxCurve[];
            if (Array.isArray(lxCurves) && lxCurves.length > 0) {
                const scores = computeDesignEffectScores(lxCurves, curvesData);
                if (scores.some(s => s > 0)) return scores;
            }
        } catch {
            // fall through to legacy target-set indicator
        }
    }

    // Final fallback: no interventions available — use desired-as-lx as a
    // "target set" indicator so the card still shows a score.
    const scores: number[] = [];
    for (const c of curvesData) {
        if (!c.baseline?.length || !c.desired?.length) {
            scores.push(0);
            continue;
        }
        const peak = computeEffectImprovement(c.desired, c.baseline, c.desired, c.polarity);
        scores.push(peak != null ? peak : 0);
    }
    return scores.some(s => s > 0) ? scores : null;
}
