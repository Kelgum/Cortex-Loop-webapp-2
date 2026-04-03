import type {
    DaySnapshot,
    DiffEntry,
    Intervention,
    NarrationBeat,
    RevisionNarrationBeat,
    Sherlock7DBeat,
    Sherlock7DNarration,
    SherlockNarration,
    SherlockRevisionNarration,
} from './types';

export type SherlockNormalizationStatus = 'disabled-or-empty' | 'full-model' | 'partial-fallback' | 'full-fallback';

export interface SherlockNormalizationResult<T> {
    narration: T | null;
    status: SherlockNormalizationStatus;
    modelBeatCount: number;
    fallbackBeatCount: number;
}

const DEFAULT_SHERLOCK_OUTRO = 'Route locked. Execute the protocol.';
const DEFAULT_SHERLOCK_REVISION_OUTRO = 'Your body spoke. The protocol has adapted flawlessly.';

export function extractSherlockBeatText(beat: unknown): string {
    if (typeof beat === 'string') return beat.trim();
    if (!beat || typeof beat !== 'object') return '';
    const candidates = [(beat as any).text, (beat as any).line, (beat as any).narration, (beat as any).message];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return '';
}

function fallbackSherlockBeat(iv: Intervention | any): string {
    const substanceName = iv?.substance?.name || iv?.key || 'This move';
    const rationale = typeof iv?.rationale === 'string' ? iv.rationale.trim() : '';
    if (rationale) return rationale;

    const impacts =
        iv?.impacts && typeof iv.impacts === 'object'
            ? Object.entries(iv.impacts)
                  .map(([key, value]) => ({ key, abs: Math.abs(Number(value) || 0) }))
                  .sort((a, b) => b.abs - a.abs)
            : [];
    const topImpact = impacts[0]?.key;

    if (topImpact) {
        return `${topImpact} is the pressure point. ${substanceName} is deployed to correct it.`;
    }
    return `${substanceName} is now positioned to reinforce the target state.`;
}

function normalizeSubstanceKey(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getRevisionEntryCanonicalKey(entry: DiffEntry | any): string {
    return String(entry?.newIv?.key || entry?.oldIv?.key || '').trim();
}

function getRevisionEntryMatchKeys(entry: DiffEntry | any): string[] {
    const keys = new Set<string>();
    const add = (value: unknown) => {
        const normalized = normalizeSubstanceKey(value);
        if (normalized) keys.add(normalized);
    };
    add(entry?.newIv?.key);
    add(entry?.oldIv?.key);
    return [...keys];
}

export function deriveSherlockRevisionAction(entry: DiffEntry | any): string {
    const type = String(entry?.type || '')
        .trim()
        .toLowerCase();
    if (type === 'resized') {
        const oldMultiplier = Number(entry?.oldIv?.doseMultiplier ?? 1);
        const newMultiplier = Number(entry?.newIv?.doseMultiplier ?? 1);
        if (Number.isFinite(oldMultiplier) && Number.isFinite(newMultiplier)) {
            if (newMultiplier > oldMultiplier) return 'increased';
            if (newMultiplier < oldMultiplier) return 'decreased';
        }
        return 'resized';
    }
    if (type === 'added' || type === 'removed' || type === 'replaced' || type === 'moved') {
        return type;
    }
    return type || 'adjusted';
}

function fallbackSherlockRevisionBeat(entry: DiffEntry | any): RevisionNarrationBeat {
    const action = deriveSherlockRevisionAction(entry);
    const key = getRevisionEntryCanonicalKey(entry);
    const name = String(entry?.newIv?.substance?.name || entry?.oldIv?.substance?.name || key || 'This move').trim();

    let text = `${name} has been adjusted to fit the biometric reality.`;
    switch (action) {
        case 'added':
            text = `${name} has been added to close the biometric gap.`;
            break;
        case 'removed':
            text = `${name} has been withdrawn after the biometric strain it exposed.`;
            break;
        case 'replaced':
            text = `${name} replaces the weaker move the biometrics ruled out.`;
            break;
        case 'moved':
            text = `${name} has been retimed to match the biometric pattern.`;
            break;
        case 'increased':
            text = `${name} is strengthened to answer the biometric shortfall.`;
            break;
        case 'decreased':
            text = `${name} is reduced to relieve the biometric strain.`;
            break;
        case 'resized':
            text = `${name} has been resized to fit the biometric reality.`;
            break;
    }

    return {
        action,
        substanceKey: key,
        text,
    };
}

function normalizeOutro(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function normalizeSherlockNarration(
    raw: unknown,
    interventions: Intervention[] | any[],
    enabled: boolean,
): SherlockNormalizationResult<SherlockNarration> {
    const base = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
    const rawBeats = Array.isArray(base.beats) ? base.beats : [];

    let beats: NarrationBeat[] = rawBeats
        .map((beat: unknown, idx: number) => {
            const text = extractSherlockBeatText(beat);
            if (!text) return null;
            const objBeat = beat && typeof beat === 'object' ? (beat as Record<string, any>) : null;
            const substanceKey =
                typeof objBeat?.substanceKey === 'string' ? objBeat.substanceKey : interventions[idx]?.key;
            return { substanceKey, text };
        })
        .filter(Boolean) as NarrationBeat[];

    let status: SherlockNormalizationStatus = 'disabled-or-empty';
    if (beats.length === 0 && enabled && interventions.length > 0) {
        beats = interventions.map((iv: Intervention | any) => ({
            substanceKey: iv?.key,
            text: fallbackSherlockBeat(iv),
        }));
        status = 'full-fallback';
    } else if (beats.length > 0) {
        status = 'full-model';
    }

    if (beats.length === 0) {
        return {
            narration: null,
            status,
            modelBeatCount: 0,
            fallbackBeatCount: 0,
        };
    }

    return {
        narration: {
            intro: typeof base.intro === 'string' ? base.intro.trim() : '',
            beats,
            outro: normalizeOutro(base.outro, DEFAULT_SHERLOCK_OUTRO),
        },
        status,
        modelBeatCount: status === 'full-fallback' ? 0 : beats.length,
        fallbackBeatCount: status === 'full-fallback' ? beats.length : 0,
    };
}

export function normalizeSherlockRevisionNarration(
    raw: unknown,
    diff: DiffEntry[] | any[],
    enabled: boolean,
): SherlockNormalizationResult<SherlockRevisionNarration> {
    if (!enabled || diff.length === 0) {
        return {
            narration: null,
            status: 'disabled-or-empty',
            modelBeatCount: 0,
            fallbackBeatCount: 0,
        };
    }

    const base = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
    const rawBeats = Array.isArray(base.beats) ? base.beats : [];
    const assigned = new Map<number, RevisionNarrationBeat>();
    const claimedRawBeatIdx = new Set<number>();

    const normalizedRawBeats = rawBeats
        .map((beat: unknown, rawIdx: number) => {
            const text = extractSherlockBeatText(beat);
            if (!text) return null;
            const objBeat = beat && typeof beat === 'object' ? (beat as Record<string, any>) : null;
            return {
                rawIdx,
                text,
                substanceKey: normalizeSubstanceKey(objBeat?.substanceKey),
            };
        })
        .filter(Boolean) as Array<{ rawIdx: number; text: string; substanceKey: string }>;

    for (const beat of normalizedRawBeats) {
        if (!beat.substanceKey) continue;
        const matchIdx = diff.findIndex(
            (entry, idx) => !assigned.has(idx) && getRevisionEntryMatchKeys(entry).includes(beat.substanceKey),
        );
        if (matchIdx < 0) continue;
        assigned.set(matchIdx, {
            action: deriveSherlockRevisionAction(diff[matchIdx]),
            substanceKey: getRevisionEntryCanonicalKey(diff[matchIdx]),
            text: beat.text,
        });
        claimedRawBeatIdx.add(beat.rawIdx);
    }

    for (const beat of normalizedRawBeats) {
        if (claimedRawBeatIdx.has(beat.rawIdx)) continue;
        if (beat.rawIdx >= diff.length || assigned.has(beat.rawIdx)) continue;
        assigned.set(beat.rawIdx, {
            action: deriveSherlockRevisionAction(diff[beat.rawIdx]),
            substanceKey: getRevisionEntryCanonicalKey(diff[beat.rawIdx]),
            text: beat.text,
        });
        claimedRawBeatIdx.add(beat.rawIdx);
    }

    const beats: RevisionNarrationBeat[] = diff.map((entry, idx) => {
        const matched = assigned.get(idx);
        return matched || fallbackSherlockRevisionBeat(entry);
    });

    const modelBeatCount = assigned.size;
    const fallbackBeatCount = Math.max(0, diff.length - modelBeatCount);
    const status: SherlockNormalizationStatus =
        modelBeatCount === 0 ? 'full-fallback' : fallbackBeatCount === 0 ? 'full-model' : 'partial-fallback';

    return {
        narration: {
            intro: '',
            beats,
            outro: normalizeOutro(base.outro, DEFAULT_SHERLOCK_REVISION_OUTRO),
        },
        status,
        modelBeatCount,
        fallbackBeatCount,
    };
}

// ── Sherlock 7D normalization ──

const DEFAULT_SHERLOCK_7D_OUTRO = 'Seven days of adaptation. The protocol has learned your rhythm.';

export function normalizeSherlock7DNarration(
    raw: unknown,
    days: DaySnapshot[],
    enabled: boolean,
): SherlockNormalizationResult<Sherlock7DNarration> {
    if (!enabled || !raw) {
        return { narration: null, status: 'disabled-or-empty', modelBeatCount: 0, fallbackBeatCount: 0 };
    }

    const base = raw as any;
    const rawBeats: unknown[] = Array.isArray(base.beats) ? base.beats : [];

    let modelBeatCount = 0;
    let fallbackBeatCount = 0;

    // Build beats for days 1-7 (skip day 0)
    const beats: Sherlock7DBeat[] = [];
    for (let i = 1; i < days.length; i++) {
        const day = days[i];
        const rawBeat = rawBeats.find((b: any) => b && b.day === day.day) || rawBeats[i - 1];

        if (rawBeat && typeof rawBeat === 'object') {
            const rb = rawBeat as any;
            const text = extractSherlockBeatText(rb);
            if (text) {
                modelBeatCount++;
                beats.push({
                    day: day.day,
                    weekday: rb.weekday || `Day ${day.day}`,
                    text,
                    direction: rb.direction === 'up' || rb.direction === 'down' ? rb.direction : 'neutral',
                    keyChanges: typeof rb.keyChanges === 'string' ? rb.keyChanges : 'Protocol adjusted',
                    topSubstanceKey: rb.topSubstanceKey || undefined,
                    topSubstanceName: rb.topSubstanceName || undefined,
                });
                continue;
            }
        }

        // Fallback: use existing narrative from DaySnapshot
        fallbackBeatCount++;
        beats.push({
            day: day.day,
            weekday: `Day ${day.day}`,
            text: day.dayNarrative || day.narrativeBeat || `Day ${day.day} protocol adaptation.`,
            direction: 'neutral',
            keyChanges: 'Protocol adjusted',
            topSubstanceKey: day.interventions[0]?.key,
            topSubstanceName: day.interventions[0]?.substance?.name,
        });
    }

    if (beats.length === 0) {
        return { narration: null, status: 'disabled-or-empty', modelBeatCount: 0, fallbackBeatCount: 0 };
    }

    const status: SherlockNormalizationStatus =
        modelBeatCount === 0 ? 'full-fallback' : fallbackBeatCount === 0 ? 'full-model' : 'partial-fallback';

    return {
        narration: {
            beats,
            outro: normalizeOutro(base.outro, DEFAULT_SHERLOCK_7D_OUTRO),
        },
        status,
        modelBeatCount,
        fallbackBeatCount,
    };
}
