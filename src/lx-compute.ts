// ============================================
// Lx OVERLAY COMPUTATION
// ============================================

import {
    PHASE_CHART,
    PHASE_SMOOTH_PASSES,
    LX_GAP_COVERAGE,
    CLASS_PALETTE,
    substanceColorFromIndex,
    BACKGROUND_DURATION_THRESHOLD,
    CONCURRENT_SUBSTANCE_MAX,
    CONCURRENT_KEEP_THRESHOLD,
    DAILY_SUBSTANCE_MAX,
    SUBSTANCE_MIN,
} from './constants';
import { SUBSTANCE_DB, getActiveSubstances, resolveSubstance } from './substances';
import { smoothPhaseValues } from './curve-utils';
import { substanceEffectAt, normalizedEffectAt, computeToleranceMultiplier } from './pharma-model';
import { reportRuntimeBug } from './runtime-error-banner';
import { clamp } from './utils';

export function validateInterventions(interventions: any, curvesData: any) {
    if (!Array.isArray(interventions)) return [];
    const inputCount = interventions.length;
    const active = getActiveSubstances();
    const dropped: string[] = [];
    const result = interventions.filter((iv: any) => {
        if (!iv.key || iv.timeMinutes == null) {
            dropped.push(iv?.key || '(no key)');
            return false;
        }
        // Resolve substance from active set or full DB
        const sub = active[iv.key] || SUBSTANCE_DB[iv.key];
        if (!sub) {
            dropped.push(iv.key);
            return false;
        }
        iv.substance = sub;
        iv.timeMinutes = Math.max(PHASE_CHART.startMin, Math.min(PHASE_CHART.endMin, iv.timeMinutes));

        // Resolve primary target curve for connector line drawing
        // Multi-vector: find the impact key with the highest absolute vector
        if (curvesData && iv.impacts && typeof iv.impacts === 'object') {
            let bestKey: any = null,
                bestAbs = 0;
            for (const [effectKey, vec] of Object.entries(iv.impacts) as [string, any][]) {
                if (Math.abs(vec) > bestAbs) {
                    bestAbs = Math.abs(vec);
                    bestKey = effectKey;
                }
            }
            if (bestKey) {
                const idx = curvesData.findIndex(
                    (c: any) => c.effect && matchImpactToCurve({ [bestKey]: 1 }, c.effect) !== 0,
                );
                iv.targetCurveIdx = idx >= 0 ? idx : null;
            }
        }
        // Legacy fallback: single targetEffect string
        if (iv.targetCurveIdx == null && curvesData && iv.targetEffect) {
            const idx = curvesData.findIndex(
                (c: any) => c.effect && matchImpactToCurve({ [iv.targetEffect]: 1 }, c.effect) !== 0,
            );
            iv.targetCurveIdx = idx >= 0 ? idx : null;
        }
        if (iv.targetCurveIdx == null && curvesData) {
            iv.targetCurveIdx = mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
        }

        return true;
    });
    // Guard: warn loudly if >50% of interventions were dropped during validation
    if (inputCount > 0 && dropped.length > 0) {
        const dropRate = dropped.length / inputCount;
        const msg = `[validateInterventions] Dropped ${dropped.length}/${inputCount} interventions: ${dropped.join(', ')}`;
        if (dropRate > 0.5) {
            console.error(msg + ' — majority lost, likely an LLM key-naming issue.');
            reportRuntimeBug({
                stage: 'intervention',
                message: msg + ' — majority lost, likely an LLM key-naming issue.',
            });
        } else {
            console.warn(msg);
        }
    }
    spreadSubstanceColors(result);
    return result;
}

/** Reassign substance colors so that the N substances actually on screen
 *  are spread maximally across the class palette.
 *  e.g. 2 nootropics → palette[0] and palette[7] (max distance),
 *       3 nootropics → palette[0], palette[3], palette[7]. */
function spreadSubstanceColors(interventions: any[]) {
    const byClass: Record<string, any[]> = {};
    for (const iv of interventions) {
        if (!iv.substance) continue;
        const cls = iv.substance.class || 'unknown';
        if (!byClass[cls]) byClass[cls] = [];
        // Deduplicate: only add each substance once (same key can appear multiple times)
        if (!byClass[cls].some((s: any) => s === iv.substance)) {
            byClass[cls].push(iv.substance);
        }
    }
    for (const [cls, subs] of Object.entries(byClass)) {
        const palette = CLASS_PALETTE[cls] || CLASS_PALETTE['unknown'];
        const n = subs.length;
        if (n === 1) {
            subs[0].color = palette[0]; // solo substance gets hero
        } else {
            subs.forEach((sub, i) => {
                // Spread across ~half the palette so same-class substances still feel related
                const maxSlot = Math.ceil((palette.length - 1) * 0.5);
                const slot = Math.round((i * maxSlot) / (n - 1));
                sub.color = slot < palette.length ? palette[slot] : substanceColorFromIndex(cls, slot);
            });
        }
    }
}

export function mapSubstanceToEffectAxis(substanceKey: any, curvesData: any) {
    const sub = resolveSubstance(substanceKey, {});
    if (!sub) return [0];

    const cls = sub.class || 'unknown';

    // Map substance class to curve indices based on polarity and effect type
    const mapping: number[] = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const polarity = curve.polarity || 'higher_is_better';

        // Stimulants & nootropics → positive effects (higher_is_better)
        if (['Stimulant', 'Nootropic'].includes(cls) && polarity === 'higher_is_better') {
            mapping.push(i);
        }
        // Adaptogens → both positive effects and negative effect reduction
        else if (cls === 'Adaptogen') {
            mapping.push(i);
        }
        // Sleep/Depressants → sedation or negative effect reduction
        else if (
            cls === 'Depressant/Sleep' &&
            (polarity === 'higher_is_worse' || curve.effect?.toLowerCase().includes('sleep'))
        ) {
            mapping.push(i);
        }
        // Minerals/Vitamins → general support, affects all
        else if (['Mineral/Electrolyte', 'Vitamin/Amino'].includes(cls)) {
            mapping.push(i);
        }
    }

    return mapping.length > 0 ? mapping : [0];
}

/**
 * Fuzzy-match an impact key from the LLM to a curve effect name.
 * Handles exact match, substring containment, and word overlap.
 * Returns the impact value if matched, 0 otherwise.
 */
export function matchImpactToCurve(impacts: any, curveName: any) {
    if (!impacts || typeof impacts !== 'object') return 0;
    const cn = curveName.toLowerCase().trim();
    const cnWords = cn.split(/\s+/);

    // Pass 1: exact match
    for (const [key, vec] of Object.entries(impacts) as [string, any][]) {
        if (key.toLowerCase().trim() === cn) return vec;
    }
    // Pass 2: substring containment (either direction)
    for (const [key, vec] of Object.entries(impacts) as [string, any][]) {
        const kn = key.toLowerCase().trim();
        if (cn.includes(kn) || kn.includes(cn)) return vec;
    }
    // Pass 3: any significant word overlap (ignore short words)
    for (const [key, vec] of Object.entries(impacts) as [string, any][]) {
        const kWords = key.toLowerCase().trim().split(/\s+/);
        const overlap = kWords.filter(
            (w: any) => w.length > 3 && cnWords.some((cw: any) => cw.length > 3 && (cw.includes(w) || w.includes(cw))),
        );
        if (overlap.length > 0) return vec;
    }
    return 0;
}

function buildCurveInfo(curvesData: any) {
    return curvesData.map((curve: any) => {
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const polarity = curve.polarity || 'higher_is_better';

        // maxDesiredGap computed from smoothed curves — must match the smoothed
        // rendering context so the scale factor doesn't overshoot the visual gap.
        let maxDesiredGap = 0;
        const len = Math.min(blSmoothed.length, dsSmoothed.length);
        for (let j = 0; j < len; j++) {
            maxDesiredGap = Math.max(maxDesiredGap, Math.abs(dsSmoothed[j].value - blSmoothed[j].value));
        }
        if (maxDesiredGap < 1) maxDesiredGap = 1;

        return { blSmoothed, dsSmoothed, polarity, maxDesiredGap };
    });
}

function ivRawEffectAt(iv: any, curveIdx: number, sampleMin: number, curvesData: any) {
    const sub = iv.substance;
    if (!sub || !sub.pharma) return 0;
    const curveName = curvesData[curveIdx].effect || '';

    if (iv.impacts && typeof iv.impacts === 'object') {
        const impactValue = matchImpactToCurve(iv.impacts, curveName);
        if (impactValue === 0) return 0;
        const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
        return baseWave * (iv.doseMultiplier || 1.0) * impactValue;
    }

    const targetIdx =
        iv.targetCurveIdx != null ? iv.targetCurveIdx : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
    if (targetIdx !== curveIdx) return 0;

    const baseWave = substanceEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
    return baseWave * (iv.doseMultiplier || 1.0);
}

/**
 * Gap-normalized effect: returns a "gap-fraction" at a given time point.
 * 0.6 means "this substance fills 60% of the gap at this moment."
 * Uses the normalized pharma shape (0-1 at peak) × doseMultiplier × impactValue.
 */
function ivNormalizedEffectAt(iv: any, curveIdx: number, sampleMin: number, curvesData: any) {
    const sub = iv.substance;
    if (!sub || !sub.pharma) return 0;
    const curveName = curvesData[curveIdx].effect || '';

    if (iv.impacts && typeof iv.impacts === 'object') {
        const impactValue = matchImpactToCurve(iv.impacts, curveName);
        if (impactValue === 0) return 0;
        const normWave = normalizedEffectAt(sampleMin - iv.timeMinutes, sub.pharma);
        return normWave * (iv.doseMultiplier || 1.0) * impactValue;
    }

    // Legacy fallback (no impacts dict)
    const targetIdx =
        iv.targetCurveIdx != null ? iv.targetCurveIdx : mapSubstanceToEffectAxis(iv.key, curvesData)[0] || 0;
    if (targetIdx !== curveIdx) return 0;
    return normalizedEffectAt(sampleMin - iv.timeMinutes, sub.pharma) * (iv.doseMultiplier || 1.0);
}

export function computeLxScaleFactors(interventions: any, curvesData: any, curveInfoOverride?: any[]) {
    const curveInfo = curveInfoOverride || buildCurveInfo(curvesData);
    const sorted = Array.isArray(interventions)
        ? [...interventions].sort((a: any, b: any) => (a.timeMinutes || 0) - (b.timeMinutes || 0))
        : [];

    return curveInfo.map((ci: any, curveIdx: number) => {
        let maxRawEffect = 0;
        for (let j = 0; j < ci.blSmoothed.length; j++) {
            const sampleMin = ci.blSmoothed[j].hour * 60;
            let rawEffect = 0;
            for (const iv of sorted) {
                rawEffect += ivRawEffectAt(iv, curveIdx, sampleMin, curvesData);
            }
            maxRawEffect = Math.max(maxRawEffect, Math.abs(rawEffect));
        }
        const ceiling = ci.maxDesiredGap * LX_GAP_COVERAGE;
        return maxRawEffect > 0 ? ceiling / maxRawEffect : 0;
    });
}

export function computeLxScaleFactorsFromReference(
    interventions: any,
    curvesData: any,
    referenceLxCurves: any,
    curveInfoOverride?: any[],
) {
    const curveInfo = curveInfoOverride || buildCurveInfo(curvesData);
    const sorted = Array.isArray(interventions)
        ? [...interventions].sort((a: any, b: any) => (a.timeMinutes || 0) - (b.timeMinutes || 0))
        : [];
    const fallbackScaleFactors = computeLxScaleFactors(sorted, curvesData, curveInfo);

    return curveInfo.map((ci: any, curveIdx: number) => {
        const referencePoints = referenceLxCurves?.[curveIdx]?.points;
        if (!Array.isArray(referencePoints) || referencePoints.length === 0) {
            return fallbackScaleFactors[curveIdx] ?? 0;
        }

        let numerator = 0;
        let denominator = 0;
        const len = Math.min(ci.blSmoothed.length, referencePoints.length);
        for (let j = 0; j < len; j++) {
            const sampleMin = ci.blSmoothed[j].hour * 60;
            let rawEffect = 0;
            for (const iv of sorted) {
                rawEffect += ivRawEffectAt(iv, curveIdx, sampleMin, curvesData);
            }
            if (Math.abs(rawEffect) < 1e-6) continue;

            const displayedEffect =
                Number(referencePoints[j]?.value ?? ci.blSmoothed[j].value) - Number(ci.blSmoothed[j].value);
            numerator += rawEffect * displayedEffect;
            denominator += rawEffect * rawEffect;
        }

        if (denominator <= 1e-6) {
            return fallbackScaleFactors[curveIdx] ?? 0;
        }
        return numerator / denominator;
    });
}

export function computeLxOverlay(interventions: any, curvesData: any, fixedScaleFactors?: number[] | null) {
    const curveInfo = buildCurveInfo(curvesData);
    const lxCurves = curveInfo.map((info: any) => ({
        baseline: info.blSmoothed,
        desired: info.dsSmoothed,
        polarity: info.polarity,
        maxDesiredGap: info.maxDesiredGap,
        points: [] as any[],
    }));

    // Legacy path: when fixedScaleFactors are explicitly provided (revision animation),
    // use the old global-scale approach for backward compatibility.
    const useLegacyScaling = Array.isArray(fixedScaleFactors) && fixedScaleFactors.length === curvesData.length;

    const scaleFactors = useLegacyScaling ? fixedScaleFactors! : null; // normalized path — no global scale factor

    for (let ci = 0; ci < curvesData.length; ci++) {
        const lx = lxCurves[ci];
        const curveName = (curvesData[ci].effect || '').toLowerCase();

        // Diagnostic: log which interventions match this curve
        const matchLog = interventions
            .map((iv: any) => {
                if (!iv.impacts || typeof iv.impacts !== 'object') return null;
                const val = matchImpactToCurve(iv.impacts, curveName);
                if (val === 0) return null;
                return `${iv.key}(${JSON.stringify(iv.impacts)}) → ${val}`;
            })
            .filter(Boolean);
        if (matchLog.length > 0) {
            console.log(`[Lx] Curve "${curveName}" matched:`, matchLog);
        } else {
            console.warn(
                `[Lx] Curve "${curveName}" — NO interventions matched. Impacts:`,
                interventions.map((iv: any) => ({ key: iv.key, impacts: iv.impacts })),
            );
        }

        if (useLegacyScaling) {
            // ── Legacy path: global scale factor ──
            const points: any[] = [];
            let maxRawEffect = 0;
            for (let j = 0; j < lx.baseline.length; j++) {
                const hourVal = lx.baseline[j].hour;
                const sampleMin = hourVal * 60;
                let rawEffect = 0;
                for (const iv of interventions) {
                    rawEffect += ivRawEffectAt(iv, ci, sampleMin, curvesData);
                }
                maxRawEffect = Math.max(maxRawEffect, Math.abs(rawEffect));
                points.push({ hour: hourVal, rawEffect });
            }
            const ceiling = curveInfo[ci].maxDesiredGap * LX_GAP_COVERAGE;
            const scaleFactor = scaleFactors![ci] ?? (maxRawEffect > 0 ? ceiling / maxRawEffect : 0);
            lx.points = points.map((p: any, j: number) => {
                const baseVal = lx.baseline[j].value;
                const scaledEffect = p.rawEffect * scaleFactor;
                const value = baseVal + scaledEffect;
                return { hour: p.hour, value: clamp(value, 0, 100) };
            });
        } else {
            // ── Normalized path: impact vectors × local gap ──
            // Split positive (gap-filling) and negative (collateral) contributions:
            // - Positive impacts adapt to gap direction (normSum × localGap)
            // - Negative impacts have a FIXED direction (normSum × |localGap|)
            // Without this split, a stimulant's negative Sleep Pressure impact
            // would visually INCREASE sleep pressure when localGap is also negative.
            lx.points = lx.baseline.map((bp: any, j: number) => {
                const sampleMin = bp.hour * 60;
                let posSum = 0;
                let negSum = 0;
                for (const iv of interventions) {
                    const contrib = ivNormalizedEffectAt(iv, ci, sampleMin, curvesData);
                    if (contrib >= 0) posSum += contrib;
                    else negSum += contrib;
                }
                const localGap = lx.desired[j].value - bp.value;
                const scaledEffect = posSum * localGap + negSum * Math.abs(localGap);
                const value = bp.value + scaledEffect;
                return { hour: bp.hour, value: clamp(value, 0, 100) };
            });
        }
    }

    return lxCurves;
}

/**
 * Compute incremental Lx curve snapshots — one per substance "step".
 * Returns: [ { lxCurves: [...], step: [intervention, ...] }, ... ]
 */
export function computeIncrementalLxOverlay(interventions: any, curvesData: any, fixedScaleFactors?: number[] | null) {
    const sorted = [...interventions].sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);
    const steps = sorted.map((iv: any) => [iv]);
    const curveInfo = buildCurveInfo(curvesData);

    const useLegacyScaling = Array.isArray(fixedScaleFactors) && fixedScaleFactors.length === curvesData.length;
    const globalScaleFactors = useLegacyScaling ? fixedScaleFactors! : null;

    const snapshots: any[] = [];
    for (let k = 0; k < steps.length; k++) {
        const activeInterventions = steps.slice(0, k + 1).flat();

        const lxCurves = curveInfo.map((ci: any, curveIdx: number) => {
            const points = ci.blSmoothed.map((bp: any, j: number) => {
                const sampleMin = bp.hour * 60;

                if (useLegacyScaling) {
                    // Legacy path: global scale factor
                    let rawEffect = 0;
                    for (const iv of activeInterventions) {
                        rawEffect += ivRawEffectAt(iv, curveIdx, sampleMin, curvesData);
                    }
                    const scaledEffect = rawEffect * globalScaleFactors![curveIdx];
                    const value = bp.value + scaledEffect;
                    return { hour: bp.hour, value: clamp(value, 0, 100) };
                } else {
                    // Split positive (gap-filling) and negative (collateral) contributions
                    let posSum = 0;
                    let negSum = 0;
                    for (const iv of activeInterventions) {
                        const contrib = ivNormalizedEffectAt(iv, curveIdx, sampleMin, curvesData);
                        if (contrib >= 0) posSum += contrib;
                        else negSum += contrib;
                    }
                    const localGap = ci.dsSmoothed[j].value - bp.value;
                    const scaledEffect = posSum * localGap + negSum * Math.abs(localGap);
                    const value = bp.value + scaledEffect;
                    return { hour: bp.hour, value: clamp(value, 0, 100) };
                }
            });
            return {
                baseline: ci.blSmoothed,
                desired: ci.dsSmoothed,
                polarity: ci.polarity,
                maxDesiredGap: ci.maxDesiredGap,
                points,
            };
        });

        snapshots.push({ lxCurves, step: steps[k] });
    }

    return snapshots;
}

// ============================================
// Stacking analysis — used by the LLM correction loop
// ============================================

const STACKING_SAMPLE_HOURS = [
    6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
];

export interface StackingBreakdown {
    key: string;
    contribution: number;
}
export interface StackingReport {
    curve: string;
    peakNormSum: number;
    peakHour: number;
    breakdown: StackingBreakdown[];
}

/**
 * Compute peak stacked normSum per curve across the 24h window.
 * At the peak hour, records each substance's individual contribution.
 * Used by the LLM correction loop to detect and report overshoot.
 *
 * Interventions must already be validated (iv.substance resolved).
 */
export function computeStackingPeaks(interventions: any[], curvesData: any[]): StackingReport[] {
    return curvesData.map((curve: any, ci: number) => {
        const curveName = curve.effect || '';
        let peakNormSum = 0;
        let peakHour = 0;
        let peakBreakdown: StackingBreakdown[] = [];

        for (const hour of STACKING_SAMPLE_HOURS) {
            const sampleMin = hour * 60;
            let normSum = 0;
            const breakdown: StackingBreakdown[] = [];

            for (const iv of interventions) {
                const contrib = ivNormalizedEffectAt(iv, ci, sampleMin, curvesData);
                if (Math.abs(contrib) > 1e-6) {
                    normSum += contrib;
                    breakdown.push({ key: iv.key, contribution: Math.round(contrib * 1000) / 1000 });
                }
            }

            if (Math.abs(normSum) > Math.abs(peakNormSum)) {
                peakNormSum = normSum;
                peakHour = hour;
                peakBreakdown = breakdown;
            }
        }

        return {
            curve: curveName,
            peakNormSum: Math.round(peakNormSum * 100) / 100,
            peakHour,
            breakdown: peakBreakdown,
        };
    });
}

/**
 * Compute each substance's share of total protocol effect (0-100).
 * Integrates ivNormalizedEffectAt across the day for every intervention,
 * then expresses each substance as a percentage of the total positive contribution.
 * Averaged across all curves (effects).
 */
export function computeSubstanceContributions(
    interventions: any[],
    curvesData: any[],
): Map<string, number> {
    const result = new Map<string, number>();
    if (!interventions?.length || !curvesData?.length) return result;

    const totals = new Map<string, number>();
    let grandTotal = 0;

    for (const iv of interventions) {
        let ivTotal = 0;
        for (let ci = 0; ci < curvesData.length; ci++) {
            for (const hour of STACKING_SAMPLE_HOURS) {
                const contrib = ivNormalizedEffectAt(iv, ci, hour * 60, curvesData);
                if (contrib > 0) ivTotal += contrib;
            }
        }
        const key = iv.key || iv.substanceKey || '';
        totals.set(key, (totals.get(key) || 0) + ivTotal);
        grandTotal += ivTotal;
    }

    if (grandTotal <= 0) return result;
    for (const [key, total] of totals) {
        result.set(key, Math.round((total / grandTotal) * 100));
    }
    return result;
}

// ============================================
// Cluster-based concurrent density pruning
// ============================================

interface ActiveZone {
    iv: any;
    start: number; // minutes-since-midnight
    end: number;
}

interface Cluster {
    start: number;
    end: number;
    members: any[];
}

interface PruneResult {
    pruned: any[];
    removed: Array<{ key: string; reason: string; peakContribution: number }>;
}

/**
 * Classify interventions into background (long-acting, plateau >= threshold)
 * and tactical (time-targeted, shorter plateau).
 */
function classifySubstances(interventions: any[]): { background: any[]; tactical: any[] } {
    const background: any[] = [];
    const tactical: any[] = [];
    for (const iv of interventions) {
        const pharma = iv.substance?.pharma;
        if (!pharma) {
            tactical.push(iv);
            continue;
        }
        const plateauDuration = pharma.duration * 0.6;
        if (plateauDuration >= BACKGROUND_DURATION_THRESHOLD) {
            background.push(iv);
        } else {
            tactical.push(iv);
        }
    }
    return { background, tactical };
}

/**
 * Compute active zones for tactical interventions and merge overlapping
 * zones into clusters via interval merging.
 */
function detectClusters(tacticalInterventions: any[]): Cluster[] {
    if (tacticalInterventions.length === 0) return [];

    // Build active zones: [doseTime + onset, doseTime + duration * 0.6]
    const zones: ActiveZone[] = tacticalInterventions.map((iv) => {
        const pharma = iv.substance?.pharma || { onset: 30, duration: 240 };
        const doseMin = iv.timeMinutes || 0;
        return {
            iv,
            start: doseMin + pharma.onset,
            end: doseMin + pharma.duration * 0.6,
        };
    });

    // Sort by start time
    zones.sort((a, b) => a.start - b.start);

    // Interval merge
    const clusters: Cluster[] = [];
    let current: Cluster = { start: zones[0].start, end: zones[0].end, members: [zones[0].iv] };

    for (let i = 1; i < zones.length; i++) {
        if (zones[i].start <= current.end) {
            // Overlapping — extend cluster
            current.end = Math.max(current.end, zones[i].end);
            current.members.push(zones[i].iv);
        } else {
            // Gap — finalize current, start new
            clusters.push(current);
            current = { start: zones[i].start, end: zones[i].end, members: [zones[i].iv] };
        }
    }
    clusters.push(current);

    return clusters;
}

/**
 * Compute each substance's contribution within a cluster's time window,
 * as a percentage of total positive effect in that window.
 */
function computeClusterContributions(
    members: any[],
    clusterStart: number,
    clusterEnd: number,
    curvesData: any[],
): Map<any, number> {
    const totals = new Map<any, number>();
    let grandTotal = 0;

    // Sample at 15-min intervals within the cluster
    const sampleMinutes: number[] = [];
    for (let m = clusterStart; m <= clusterEnd; m += 15) {
        sampleMinutes.push(m);
    }
    if (sampleMinutes.length === 0) sampleMinutes.push(clusterStart);

    for (const iv of members) {
        let ivTotal = 0;
        for (let ci = 0; ci < curvesData.length; ci++) {
            for (const m of sampleMinutes) {
                const contrib = ivNormalizedEffectAt(iv, ci, m, curvesData);
                if (contrib > 0) ivTotal += contrib;
            }
        }
        totals.set(iv, ivTotal);
        grandTotal += ivTotal;
    }

    const result = new Map<any, number>();
    if (grandTotal <= 0) return result;
    for (const [iv, total] of totals) {
        result.set(iv, Math.round((total / grandTotal) * 100));
    }
    return result;
}

/**
 * Prune interventions that violate concurrent density rules.
 *
 * 1. Classify substances into background (long-acting) and tactical (time-targeted)
 * 2. Detect temporal clusters among tactical substances via interval merging
 * 3. For each cluster exceeding CONCURRENT_SUBSTANCE_MAX, remove weakest members
 *    (unless each contributes >= CONCURRENT_KEEP_THRESHOLD %)
 * 4. Apply DAILY_SUBSTANCE_MAX cap on total substances
 * 5. Rescale surviving substances' impacts to absorb freed budget
 *
 * Interventions must already be validated (iv.substance resolved).
 */
export function pruneConcurrentOverload(
    interventions: any[],
    curvesData: any[],
    opts?: {
        concurrentMax?: number;
        keepThreshold?: number;
        dailyMax?: number;
        minSubstances?: number;
    },
): PruneResult {
    const concurrentMax = opts?.concurrentMax ?? CONCURRENT_SUBSTANCE_MAX;
    const keepThreshold = opts?.keepThreshold ?? CONCURRENT_KEEP_THRESHOLD;
    const dailyMax = opts?.dailyMax ?? DAILY_SUBSTANCE_MAX;
    const minSubstances = opts?.minSubstances ?? SUBSTANCE_MIN;

    if (!interventions?.length || !curvesData?.length) {
        return { pruned: [...interventions], removed: [] };
    }

    const { background, tactical } = classifySubstances(interventions);
    const removedSet = new Set<any>();
    const removedInfo: PruneResult['removed'] = [];

    // Log background classification
    for (const iv of background) {
        const plateau = Math.round((iv.substance?.pharma?.duration || 0) * 0.6);
        console.log(
            `[Density] Background: ${iv.key} (plateau ${plateau}min >= ${BACKGROUND_DURATION_THRESHOLD}min) — excluded from clusters`,
        );
    }

    // Detect clusters among tactical substances
    const clusters = detectClusters(tactical);

    // For each over-dense cluster, prune weakest members
    for (const cluster of clusters) {
        if (cluster.members.length <= concurrentMax) {
            const startH = (cluster.start / 60).toFixed(1);
            const endH = (cluster.end / 60).toFixed(1);
            console.log(
                `[Density] Cluster ${startH}h-${endH}h: ${cluster.members.length} tactical substances — OK`,
            );
            continue;
        }

        const contributions = computeClusterContributions(
            cluster.members,
            cluster.start,
            cluster.end,
            curvesData,
        );

        // Sort by contribution ascending (weakest first)
        const sorted = [...cluster.members]
            .filter((iv) => !removedSet.has(iv))
            .sort((a, b) => (contributions.get(a) || 0) - (contributions.get(b) || 0));

        const activeInCluster = sorted.filter((iv) => !removedSet.has(iv));
        let excess = activeInCluster.length - concurrentMax;

        for (const iv of sorted) {
            if (excess <= 0) break;
            if (removedSet.has(iv)) continue;

            const contrib = contributions.get(iv) || 0;
            if (contrib >= keepThreshold) {
                // This substance earns its slot — skip
                continue;
            }

            // Don't prune below minimum total
            const totalRemaining = interventions.length - removedSet.size;
            if (totalRemaining <= minSubstances) break;

            removedSet.add(iv);
            removedInfo.push({
                key: iv.key,
                reason: `cluster density (${contrib}% < ${keepThreshold}% threshold)`,
                peakContribution: contrib,
            });
            excess--;
        }

        const startH = (cluster.start / 60).toFixed(1);
        const endH = (cluster.end / 60).toFixed(1);
        const removedInCluster = cluster.members.filter((iv) => removedSet.has(iv));
        if (removedInCluster.length > 0) {
            const removedNames = removedInCluster
                .map((iv) => `${iv.key} (${contributions.get(iv) || 0}%)`)
                .join(', ');
            console.log(
                `[Density] Cluster ${startH}h-${endH}h: ${cluster.members.length} tactical, cap=${concurrentMax} → removing ${removedNames}`,
            );
        } else {
            console.log(
                `[Density] Cluster ${startH}h-${endH}h: ${cluster.members.length} tactical, cap=${concurrentMax} → all above ${keepThreshold}% threshold, keeping all`,
            );
        }
    }

    // Combine surviving substances
    let surviving = interventions.filter((iv) => !removedSet.has(iv));

    // Apply daily max cap (background + tactical combined)
    if (surviving.length > dailyMax) {
        const globalContribs = computeSubstanceContributions(surviving, curvesData);
        const byContrib = [...surviving].sort(
            (a, b) => (globalContribs.get(a.key) || 0) - (globalContribs.get(b.key) || 0),
        );
        while (surviving.length > dailyMax && byContrib.length > 0) {
            const weakest = byContrib.shift()!;
            if (surviving.length <= minSubstances) break;
            removedSet.add(weakest);
            removedInfo.push({
                key: weakest.key,
                reason: `daily cap (${surviving.length} > ${dailyMax})`,
                peakContribution: globalContribs.get(weakest.key) || 0,
            });
            surviving = surviving.filter((iv) => iv !== weakest);
        }
    }

    // Rescale surviving substances to absorb freed budget
    if (removedInfo.length > 0 && surviving.length > 0) {
        rescaleSurvivors(surviving, interventions, curvesData);
        console.log(
            `[Density] Rescaled ${surviving.length} surviving substances to absorb freed budget`,
        );
    }

    const totalBg = surviving.filter((iv) => background.includes(iv)).length;
    const totalTac = surviving.length - totalBg;
    console.log(
        `[Density] Total: ${surviving.length} substances (${totalBg} background + ${totalTac} tactical), daily cap=${dailyMax} — ${surviving.length <= dailyMax ? 'OK' : 'OVER'}`,
    );

    return {
        pruned: surviving,
        removed: removedInfo,
    };
}

/**
 * After pruning, rescale surviving substances' impacts proportionally
 * so the total stacking budget at each crowded hour is preserved.
 * Uses per-hour rescaling to avoid global overshoot.
 */
function rescaleSurvivors(surviving: any[], original: any[], curvesData: any[]): void {
    // For each sample hour, compute old total and new total, then scale up survivors
    for (let ci = 0; ci < curvesData.length; ci++) {
        for (const hour of STACKING_SAMPLE_HOURS) {
            const sampleMin = hour * 60;
            let oldSum = 0;
            let newSum = 0;

            for (const iv of original) {
                const contrib = ivNormalizedEffectAt(iv, ci, sampleMin, curvesData);
                if (contrib > 0) oldSum += contrib;
            }
            for (const iv of surviving) {
                const contrib = ivNormalizedEffectAt(iv, ci, sampleMin, curvesData);
                if (contrib > 0) newSum += contrib;
            }

            // If we lost meaningful effect at this hour, scale up survivors
            if (oldSum > 0.01 && newSum > 0.01 && newSum < oldSum * 0.95) {
                const scaleFactor = oldSum / newSum;
                const curveName = curvesData[ci].effect || '';
                for (const iv of surviving) {
                    if (!iv.impacts || typeof iv.impacts !== 'object') continue;
                    const impactValue = matchImpactToCurve(iv.impacts, curveName);
                    if (impactValue <= 0) continue;

                    const normWave = normalizedEffectAt(sampleMin - iv.timeMinutes, iv.substance?.pharma);
                    if (normWave < 0.1) continue; // Only scale substances active at this hour

                    // Find the matching impact key and scale it, capping at 1.0
                    for (const effectKey of Object.keys(iv.impacts)) {
                        if (matchImpactToCurve({ [effectKey]: 1 }, curveName) !== 0) {
                            iv.impacts[effectKey] = Math.min(
                                1.0,
                                iv.impacts[effectKey] * scaleFactor,
                            );
                        }
                    }
                }
                // Only apply rescaling once per curve (at the hour with biggest loss)
                break;
            }
        }
    }
}

// ============================================
// EXTENDED LX OVERLAY — Day-Level Computation
// ============================================

/**
 * Compute day-level Lx overlay curves for extended (multi-day) timelines.
 *
 * For each effect in the roster, iterates over days 1..N and sums the
 * pharmacodynamic contributions of all active substances on that day,
 * applying tolerance decay for consecutive-day usage.
 *
 * Returns one overlay point array per effect in the roster, representing
 * the predicted state with supplementation at each day.
 */
export function computeExtendedLxOverlay(
    effectRoster: {
        effect: string;
        baseline: { day: number; value: number }[];
        desired: { day: number; value: number }[];
        polarity?: string;
    }[],
    interventions: {
        key: string;
        day: number;
        dose?: string;
        doseMultiplier?: number;
        frequency?: 'daily' | 'alternate' | 'weekdays' | 'as-needed';
        impacts?: Record<string, number>;
        phase?: string;
    }[],
    durationDays: number,
): { effect: string; overlay: { day: number; value: number }[] }[] {
    return effectRoster.map((curve) => {
        const effectName = (curve.effect || '').toLowerCase().trim();
        const overlay: { day: number; value: number }[] = [];

        // Build a baseline lookup for interpolation
        const baselineByDay = new Map<number, number>();
        for (const pt of curve.baseline) baselineByDay.set(pt.day, pt.value);

        // Build a desired lookup for gap calculation
        const desiredByDay = new Map<number, number>();
        for (const pt of curve.desired) desiredByDay.set(pt.day, pt.value);

        // Track consecutive days per substance for tolerance
        const consecutiveDays = new Map<string, number>();

        for (let day = 1; day <= durationDays; day++) {
            const bl = baselineByDay.get(day) ?? interpolateDay(curve.baseline, day);
            const ds = desiredByDay.get(day) ?? interpolateDay(curve.desired, day);
            const gap = ds - bl;

            // Sum substance contributions for this day
            let totalEffect = 0;
            const activeKeys = new Set<string>();

            for (const iv of interventions) {
                if (!isActiveOnDay(iv, day, durationDays)) continue;

                // Match this intervention to the current effect curve
                const impactValue = iv.impacts
                    ? matchImpactToCurve(iv.impacts, effectName)
                    : 0;
                if (impactValue === 0) continue;

                activeKeys.add(iv.key);

                // Count consecutive days for tolerance
                const prevConsec = consecutiveDays.get(iv.key) || 0;
                const daysSinceStart = day - iv.day;
                const consec = daysSinceStart >= 0 ? daysSinceStart : 0;
                const toleranceMult = computeToleranceMultiplier(consec);

                totalEffect += impactValue * (iv.doseMultiplier || 1.0) * toleranceMult;
            }

            // Scale the total effect to map onto the gap
            // Normalized so that a total effect of ~1.0 covers LX_GAP_COVERAGE of the gap
            const scaledEffect = gap !== 0 ? totalEffect * Math.abs(gap) * LX_GAP_COVERAGE : 0;
            const overlayValue = clamp(bl + scaledEffect, 0, 100);

            overlay.push({ day, value: overlayValue });

            // Update consecutive day tracking
            for (const [key, prev] of consecutiveDays) {
                if (!activeKeys.has(key)) consecutiveDays.set(key, 0);
            }
            for (const key of activeKeys) {
                consecutiveDays.set(key, (consecutiveDays.get(key) || 0) + 1);
            }
        }

        return { effect: curve.effect, overlay };
    });
}

/** Check if an intervention is active on a given day based on its start day and frequency. */
function isActiveOnDay(
    iv: { day: number; frequency?: string },
    day: number,
    _durationDays: number,
): boolean {
    if (day < iv.day) return false;
    const freq = iv.frequency || 'daily';
    if (freq === 'daily') return true;
    if (freq === 'alternate') return (day - iv.day) % 2 === 0;
    if (freq === 'weekdays') {
        // Approximate: days 6,7,13,14,... are weekends (assuming day 1 = Monday)
        const dayOfWeek = ((day - 1) % 7) + 1;
        return dayOfWeek <= 5;
    }
    return true; // 'as-needed' treated as daily for overlay purposes
}

/** Linear interpolation for day-level curve values. */
function interpolateDay(points: { day: number; value: number }[], targetDay: number): number {
    if (points.length === 0) return 50;
    if (points.length === 1) return points[0].value;
    if (targetDay <= points[0].day) return points[0].value;
    if (targetDay >= points[points.length - 1].day) return points[points.length - 1].value;
    for (let i = 0; i < points.length - 1; i++) {
        if (targetDay >= points[i].day && targetDay <= points[i + 1].day) {
            const t = (targetDay - points[i].day) / (points[i + 1].day - points[i].day);
            return points[i].value + t * (points[i + 1].value - points[i].value);
        }
    }
    return points[points.length - 1].value;
}
