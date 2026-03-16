// ============================================
// Lx OVERLAY COMPUTATION
// ============================================

import { PHASE_CHART, PHASE_SMOOTH_PASSES, LX_GAP_COVERAGE, CLASS_PALETTE, substanceColorFromIndex } from './constants';
import { SUBSTANCE_DB, getActiveSubstances, resolveSubstance } from './substances';
import { smoothPhaseValues } from './curve-utils';
import { substanceEffectAt } from './pharma-model';
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

    const scaleFactors =
        Array.isArray(fixedScaleFactors) && fixedScaleFactors.length === curvesData.length
            ? fixedScaleFactors
            : computeLxScaleFactors(interventions, curvesData, curveInfo);

    // Compute raw pharmacokinetic contribution per curve using multi-vector impacts
    for (let ci = 0; ci < curvesData.length; ci++) {
        const lx = lxCurves[ci];
        const curveName = (curvesData[ci].effect || '').toLowerCase();
        const points: any[] = [];
        let maxRawEffect = 0;

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

        // Normalize and apply to baseline
        const ceiling = curveInfo[ci].maxDesiredGap * LX_GAP_COVERAGE;
        const scaleFactor = scaleFactors[ci] ?? (maxRawEffect > 0 ? ceiling / maxRawEffect : 0);

        lx.points = points.map((p: any, j: number) => {
            const baseVal = lx.baseline[j].value;
            const scaledEffect = p.rawEffect * scaleFactor;
            // Impact vectors from the LLM already encode direction (positive=up, negative=down),
            // so we always ADD — no polarity flip needed.
            const value = baseVal + scaledEffect;
            return { hour: p.hour, value: clamp(value, 0, 100) };
        });
    }

    return lxCurves;
}

/**
 * Compute incremental Lx curve snapshots — one per substance "step" (grouped by dose time).
 * Uses a GLOBAL scale factor from the full intervention set so the Y-axis scale stays consistent.
 * Returns: [ { lxCurves: [...], step: [intervention, ...] }, ... ]
 */
export function computeIncrementalLxOverlay(interventions: any, curvesData: any, fixedScaleFactors?: number[] | null) {
    // 1. Sort by time
    const sorted = [...interventions].sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);

    // 2. Each intervention is its own step (no grouping)
    const steps = sorted.map((iv: any) => [iv]);

    const curveInfo = buildCurveInfo(curvesData);

    // 4. Compute GLOBAL scale factor using ALL interventions
    const globalScaleFactors =
        Array.isArray(fixedScaleFactors) && fixedScaleFactors.length === curvesData.length
            ? fixedScaleFactors
            : computeLxScaleFactors(sorted, curvesData, curveInfo);

    // 5. For each step, compute cumulative curves
    const snapshots: any[] = [];
    for (let k = 0; k < steps.length; k++) {
        const activeInterventions = steps.slice(0, k + 1).flat();

        const lxCurves = curveInfo.map((ci: any, curveIdx: number) => {
            const points = ci.blSmoothed.map((bp: any, j: number) => {
                const sampleMin = bp.hour * 60;
                let rawEffect = 0;
                for (const iv of activeInterventions) {
                    rawEffect += ivRawEffectAt(iv, curveIdx, sampleMin, curvesData);
                }
                const scaledEffect = rawEffect * globalScaleFactors[curveIdx];
                // Impact vectors already encode direction — always ADD.
                const value = bp.value + scaledEffect;
                return { hour: bp.hour, value: clamp(value, 0, 100) };
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
