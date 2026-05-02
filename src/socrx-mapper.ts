/**
 * SOCRx Mapper — pure resolver from LLM-produced SocrxPick[] to Intervention[]
 * that the existing Rx-SOC transform pipeline can consume.
 *
 * The LLM is constrained to pick `substanceKey` values from the palette we
 * send it, but we still defend against (a) invented keys, (b) out-of-range
 * targetCurveIdx, (c) out-of-range timeMinutes, and (d) missing doses.
 *
 * When the LLM names a substance that Chess Player already picked on day 0,
 * we clone that intervention's impact vectors so `computeLxOverlay` scales
 * correctly. When it's a drug Chess Player didn't pick, impacts are left
 * empty — `computeLxOverlay` falls back to the substance's pharma defaults.
 *
 * Pure — no DOM, no AppState. Safe to call from tests.
 */
import type { CurveData, Intervention, SocrxPick } from './types';
import { SUBSTANCE_DB } from './substances';

// Kept in sync with RX_SOC_MAX_SUBSTANCES in rx-soc-transform.ts.
// Duplicated here to avoid an import cycle (rx-soc-transform imports this mapper).
const SOCRX_MAX_SUBSTANCES = 2;

function clampTime(mins: number, fallback: number): number {
    const n = Number(mins);
    if (!Number.isFinite(n)) return fallback;
    if (n < 0) return 0;
    if (n > 1439) return 1439;
    return Math.round(n);
}

function cloneImpacts(src: Record<string, number> | undefined): Record<string, number> | undefined {
    if (!src || typeof src !== 'object') return undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(src)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = n;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Resolve LLM-produced SocrxPick[] against the substance DB and day-0 context.
 * Returns null when no valid picks survive (caller should fall back to the
 * deterministic `pruneToSoc` path).
 */
export function socrxPicksToInterventions(
    picks: SocrxPick[] | undefined | null,
    curvesData: CurveData[],
    day0: Intervention[],
): Intervention[] | null {
    if (!Array.isArray(picks) || picks.length === 0) return null;
    if (!Array.isArray(curvesData) || curvesData.length === 0) return null;

    const day0ByKey = new Map<string, Intervention>();
    for (const iv of day0 || []) {
        if (iv?.key && !day0ByKey.has(iv.key)) day0ByKey.set(iv.key, iv);
    }

    const out: Intervention[] = [];
    const seen = new Set<string>();

    for (const pick of picks) {
        if (!pick || typeof pick !== 'object') continue;
        const key = String(pick.substanceKey || '').trim();
        if (!key) continue;
        if (seen.has(key)) continue;

        const substance = SUBSTANCE_DB[key];
        if (!substance) continue;

        const targetCurveIdx = Number(pick.targetCurveIdx);
        if (!Number.isFinite(targetCurveIdx) || targetCurveIdx < 0 || targetCurveIdx >= curvesData.length) continue;
        const idx = Math.floor(targetCurveIdx);

        const day0Match = day0ByKey.get(key);
        const fallbackTime = day0Match?.timeMinutes ?? 8 * 60;
        const timeMinutes = clampTime(pick.timeMinutes, fallbackTime);

        const dose =
            typeof pick.dose === 'string' && pick.dose.trim().length > 0
                ? pick.dose.trim()
                : substance.standardDose || '';

        const targetEffect =
            typeof pick.targetEffect === 'string' && pick.targetEffect.trim().length > 0
                ? pick.targetEffect.trim()
                : curvesData[idx]?.effect || '';

        const rationale = typeof pick.rationale === 'string' ? pick.rationale : '';

        const iv: Intervention = {
            key,
            timeMinutes,
            dose,
            substance,
            targetCurveIdx: idx,
            targetEffect,
            rationale,
            impacts: cloneImpacts(day0Match?.impacts),
            doseMultiplier: 1,
            bioTrigger: undefined,
        };

        out.push(iv);
        seen.add(key);
        if (out.length >= SOCRX_MAX_SUBSTANCES) break;
    }

    return out.length > 0 ? out : null;
}
