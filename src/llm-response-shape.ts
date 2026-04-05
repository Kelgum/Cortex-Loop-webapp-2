import type {
    BiometricStageResult,
    Intervention,
    PipelineStage,
    SpotterChannelPickResult,
    SpotterDeviceRecommendationResult,
    SpotterProfileDraftResult,
    StrategistCurve,
    StrategistStageResult,
    TimeHorizon,
    TimeHorizonMode,
} from './types';
import { SUBSTANCE_DB } from './substances';
import { reportRuntimeBug } from './runtime-error-banner';
import { parseDoseToMg } from './utils';

const VALID_TIME_HORIZON_MODES: TimeHorizonMode[] = ['daily', 'weekly', 'cyclical', 'program'];
const DEFAULT_TIME_HORIZON: TimeHorizon = {
    mode: 'daily',
    durationDays: 1,
    rationale: 'Default — no extended timeline detected',
    dailyPatternRepeats: false,
};

export function extractTimeHorizon(raw: unknown): TimeHorizon {
    if (!raw || typeof raw !== 'object') return DEFAULT_TIME_HORIZON;
    const obj = raw as Record<string, any>;
    const mode = obj.mode;
    if (typeof mode !== 'string' || !VALID_TIME_HORIZON_MODES.includes(mode as TimeHorizonMode)) {
        return DEFAULT_TIME_HORIZON;
    }
    const durationDays = typeof obj.durationDays === 'number' && obj.durationDays >= 1
        ? Math.min(Math.round(obj.durationDays), 28)
        : mode === 'daily' ? 1 : mode === 'weekly' ? 7 : 28;
    return {
        mode: mode as TimeHorizonMode,
        durationDays,
        rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
        dailyPatternRepeats: typeof obj.dailyPatternRepeats === 'boolean' ? obj.dailyPatternRepeats : false,
    };
}

export function isCurveLike(item: unknown): item is StrategistCurve {
    if (!item || typeof item !== 'object') return false;
    const maybeCurve = item as StrategistCurve;
    if (typeof maybeCurve.effect !== 'string' || maybeCurve.effect.trim().length === 0) return false;
    if (!Array.isArray(maybeCurve.baseline) || !Array.isArray(maybeCurve.desired)) return false;
    return true;
}

export function extractCurvesData(raw: unknown): StrategistCurve[] {
    if (Array.isArray(raw)) {
        const arr = raw.filter(isCurveLike);
        if (arr.length > 0) {
            warnCurveDrop(raw.length, arr.length);
            return arr;
        }
    }

    if (!raw || typeof raw !== 'object') return [];

    const rawObject = raw as Record<string, unknown>;
    const candidates = [rawObject.curves, rawObject.data, rawObject.pharmacodynamic_curves, rawObject.effectRoster];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            const arr = candidate.filter(isCurveLike);
            if (arr.length > 0) {
                warnCurveDrop(candidate.length, arr.length);
                return arr;
            }
        }
    }

    if (isCurveLike(raw)) return [raw];

    const objectValues = Object.values(raw);
    const flatCurves = objectValues.filter(isCurveLike) as StrategistCurve[];
    if (flatCurves.length > 0) return flatCurves;

    return [];
}

function warnCurveDrop(inputCount: number, outputCount: number): void {
    if (inputCount > 0 && outputCount < inputCount) {
        const dropped = inputCount - outputCount;
        const dropRate = dropped / inputCount;
        const msg = `[extractCurvesData] ${dropped}/${inputCount} curves failed validation`;
        if (dropRate > 0.5) {
            console.error(msg + ' — majority lost.');
            reportRuntimeBug({ stage: 'curves', message: msg + ' — majority lost.' });
        } else {
            console.warn(msg);
        }
    }
}

export function parseInterventionTime(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;

    const hhmm = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
    if (!hhmm) return null;
    let hours = Number(hhmm[1]);
    const mins = Number(hhmm[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(mins) || mins < 0 || mins > 59) return null;
    const meridiem = (hhmm[3] || '').toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    if (hours < 0 || hours > 23) return null;
    return hours * 60 + mins;
}

export function looksInterventionLike(item: unknown): boolean {
    if (!item || typeof item !== 'object') return false;
    const maybeIntervention = item as Record<string, unknown>;
    const key = maybeIntervention.key || maybeIntervention.substanceKey || maybeIntervention.substance_id;
    const timeVal =
        maybeIntervention.timeMinutes ??
        maybeIntervention.time_min ??
        maybeIntervention.timeMinute ??
        maybeIntervention.minute ??
        maybeIntervention.time;
    return !!key && parseInterventionTime(timeVal) !== null;
}

/** Max dose per substance per administration — Lx device holds 1g capsules, max 5 per substance. */
const MAX_DOSE_MG = 5000;

export function normalizeIntervention(item: unknown): Intervention | null {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, any>;
    const key = raw.key || raw.substanceKey || raw.substance_id;
    const timeVal = raw.timeMinutes ?? raw.time_min ?? raw.timeMinute ?? raw.minute ?? raw.time;
    const timeMinutes = parseInterventionTime(timeVal);
    if (!key || timeMinutes === null) return null;

    const normalized: Intervention = {
        ...(raw as Intervention),
        key,
        timeMinutes,
    };

    if (normalized.dose == null && raw.amount != null) normalized.dose = String(raw.amount);
    if (normalized.impacts == null && raw.impactVector && typeof raw.impactVector === 'object') {
        normalized.impacts = raw.impactVector as Record<string, number>;
    }
    if (normalized.rationale == null && typeof raw.reason === 'string') normalized.rationale = raw.reason;
    if (normalized.rationale == null && typeof raw.explanation === 'string') normalized.rationale = raw.explanation;

    // Clamp dose to capsule ceiling (5g / 5000mg per substance per administration)
    const sub = SUBSTANCE_DB[normalized.key];
    if (sub && normalized.doseMultiplier) {
        const baseDoseStr = normalized.dose || sub.standardDose;
        const baseMg = parseDoseToMg(String(baseDoseStr));
        if (baseMg !== null) {
            const totalMg = baseMg * normalized.doseMultiplier;
            if (totalMg > MAX_DOSE_MG) {
                const clampedMultiplier = Math.floor((MAX_DOSE_MG / baseMg) * 100) / 100;
                console.warn(
                    `[DoseCap] ${sub.name}: ${totalMg}mg exceeds ${MAX_DOSE_MG}mg cap → clamping multiplier from ${normalized.doseMultiplier} to ${clampedMultiplier}`,
                );
                normalized.doseMultiplier = Math.max(0.1, clampedMultiplier);
                normalized.dose = `${Math.round(baseMg * normalized.doseMultiplier)}mg`;
            }
        }
    }

    return normalized;
}

export function extractInterventionsData(raw: unknown): Intervention[] {
    const candidates: unknown[] = [];
    if (Array.isArray(raw)) candidates.push(raw);
    if (raw && typeof raw === 'object') {
        const objectRaw = raw as Record<string, any>;
        if (Array.isArray(objectRaw.interventions)) candidates.push(objectRaw.interventions);
        if (Array.isArray(objectRaw.protocol)) candidates.push(objectRaw.protocol);
        if (Array.isArray(objectRaw.actions)) candidates.push(objectRaw.actions);
        if (objectRaw.plan && typeof objectRaw.plan === 'object' && Array.isArray(objectRaw.plan.interventions)) {
            candidates.push(objectRaw.plan.interventions);
        }
        if (looksInterventionLike(raw)) candidates.push([raw]);
    }

    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        const normalized = candidate.map(iv => normalizeIntervention(iv)).filter((iv): iv is Intervention => !!iv);
        if (normalized.length > 0) {
            if (candidate.length > 0 && normalized.length < candidate.length) {
                const dropRate = (candidate.length - normalized.length) / candidate.length;
                const msg = `[extractInterventionsData] ${candidate.length - normalized.length}/${candidate.length} items failed normalization`;
                if (dropRate > 0.5) {
                    console.error(msg + ' — majority lost.');
                    reportRuntimeBug({ stage: 'intervention', message: msg + ' — majority lost.' });
                } else {
                    console.warn(msg);
                }
            }
            return normalized;
        }
    }

    if (raw && typeof raw === 'object') {
        const values = Object.values(raw);
        const normalized = values.map(iv => normalizeIntervention(iv)).filter((iv): iv is Intervention => !!iv);
        if (normalized.length > 0) return normalized;
    }

    return [];
}

function hasValidBiometricChannels(result: unknown): result is BiometricStageResult {
    const maybeBiometric = result as { channels?: unknown[] } | null;
    if (!maybeBiometric || !Array.isArray(maybeBiometric.channels) || maybeBiometric.channels.length === 0)
        return false;
    const biometricResult = result as BiometricStageResult;
    const valid = biometricResult.channels.filter(
        ch => ch && ch.data && Array.isArray(ch.data) && ch.data.length >= 10 && ch.signal,
    );
    return valid.length > 0;
}

function ensure<T>(condition: boolean, message: string, result: T): T {
    if (!condition) throw new Error(message);
    return result;
}

export function validateStageResponseShape(stage: PipelineStage | string, result: unknown): unknown {
    switch (stage) {
        case 'fast':
            return ensure(
                Array.isArray((result as any)?.effects) && (result as any).effects.length > 0,
                'Invalid Scout response: expected non-empty effects array.',
                result,
            );
        case 'curves':
            return ensure(
                extractCurvesData(result).length > 0,
                'Invalid Strategist response: expected at least one curve object.',
                result,
            );
        case 'intervention':
            return ensure(
                extractInterventionsData(result).length > 0,
                'Invalid Chess Player response: expected at least one intervention.',
                result,
            );
        case 'biometricRec':
            return ensure(
                Array.isArray((result as SpotterDeviceRecommendationResult | null)?.recommended) &&
                    (result as SpotterDeviceRecommendationResult).recommended.length > 0,
                'Invalid Spotter device response: expected non-empty recommended array.',
                result,
            );
        case 'biometricProfile':
            return ensure(
                typeof (result as SpotterProfileDraftResult | null)?.profileText === 'string' &&
                    (result as SpotterProfileDraftResult).profileText.trim().length > 0,
                'Invalid Spotter profile response: expected non-empty profileText.',
                result,
            );
        case 'biometricChannel':
            return ensure(
                Array.isArray((result as SpotterChannelPickResult | null)?.channels) &&
                    (result as SpotterChannelPickResult).channels.length > 0,
                'Invalid Spotter channel response: expected non-empty channels array.',
                result,
            );
        case 'revision':
            return ensure(
                extractInterventionsData(result).length >= 2,
                'Invalid Revision response: expected at least 2 interventions (got ' +
                    extractInterventionsData(result).length +
                    '). Possible truncated response.',
                result,
            );
        case 'biometric':
            return ensure(
                hasValidBiometricChannels(result),
                'Invalid Spotter biometric response: expected non-empty valid channels data.',
                result,
            );
        case 'knight':
            return ensure(
                !!result && Array.isArray((result as any).days) && (result as any).days.length > 0,
                'Invalid Knight response: expected non-empty days array.',
                result,
            );
        case 'spotterDaily':
            return ensure(
                !!result && Array.isArray((result as any).days) && (result as any).days.length > 0,
                'Invalid Spotter Daily response: expected non-empty days array.',
                result,
            );
        case 'strategistBioDaily':
            return ensure(
                !!result && Array.isArray((result as any).days) && (result as any).days.length > 0,
                'Invalid Strategist Bio Daily response: expected non-empty days array.',
                result,
            );
        case 'grandmasterDaily':
            return ensure(
                !!result && Array.isArray((result as any).days) && (result as any).days.length > 0,
                'Invalid Grandmaster Daily response: expected non-empty days array.',
                result,
            );
        case 'strategistBio':
            return ensure(
                !!result &&
                    Array.isArray((result as any).correctedBaselines) &&
                    (result as any).correctedBaselines.length > 0,
                'Invalid Strategist Bio response: expected non-empty correctedBaselines array.',
                result,
            );
        case 'sherlock':
            return ensure(
                !!result && Array.isArray((result as any).beats) && (result as any).beats.length > 0,
                'Invalid Sherlock response: expected non-empty beats array.',
                result,
            );
        case 'sherlockRevision':
            return ensure(
                !!result && Array.isArray((result as any).beats) && (result as any).beats.length > 0,
                'Invalid Sherlock Revision response: expected non-empty beats array.',
                result,
            );
        case 'sherlock7d':
            return ensure(
                !!result && Array.isArray((result as any).beats) && (result as any).beats.length > 0,
                'Invalid Sherlock 7D response: expected non-empty beats array.',
                result,
            );
        default:
            return result;
    }
}
