import { LLMCache } from './llm-cache';
import type { CurveData, DaySnapshot, InterventionStageResult, LxCurve, LxSnapshot } from './types';

export const RUNTIME_REPLAY_STAGE_CLASS = 'runtime-replay-state';
const RUNTIME_REPLAY_SCHEMA = 1;

export interface RuntimeReplaySnapshot {
    schema: number;
    design?: {
        curvesData?: CurveData[];
        interventionResult?: InterventionStageResult | null;
        lxCurves?: LxCurve[] | null;
        incrementalSnapshots?: LxSnapshot[] | null;
    };
    bioCorrected?: {
        curvesData?: CurveData[];
        lxCurves?: LxCurve[] | null;
        incrementalSnapshots?: LxSnapshot[] | null;
    };
    revision?: {
        interventionResult?: InterventionStageResult | null;
        lxCurves?: LxCurve[] | null;
        incrementalSnapshots?: LxSnapshot[] | null;
    };
    week?: {
        days?: DaySnapshot[];
    };
}

let _draftSnapshot: RuntimeReplaySnapshot | null = null;

function cloneSerializable<T>(value: T): T {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRuntimeReplaySnapshot(value: unknown): value is RuntimeReplaySnapshot {
    return (
        !!value &&
        typeof value === 'object' &&
        Number((value as RuntimeReplaySnapshot).schema) === RUNTIME_REPLAY_SCHEMA
    );
}

function readPersistedSnapshot(): RuntimeReplaySnapshot | null {
    const payload = LLMCache.get(RUNTIME_REPLAY_STAGE_CLASS);
    return isRuntimeReplaySnapshot(payload) ? cloneSerializable(payload) : null;
}

function getWritableSnapshot(): RuntimeReplaySnapshot {
    if (_draftSnapshot) return cloneSerializable(_draftSnapshot);
    const persisted = readPersistedSnapshot();
    return persisted || { schema: RUNTIME_REPLAY_SCHEMA };
}

function writeSnapshot(snapshot: RuntimeReplaySnapshot): void {
    if (LLMCache.getState().enabled) return;
    const normalized = cloneSerializable({
        ...snapshot,
        schema: RUNTIME_REPLAY_SCHEMA,
    });
    _draftSnapshot = normalized;
    LLMCache.set(RUNTIME_REPLAY_STAGE_CLASS, normalized, {
        systemPrompt: 'runtime replay snapshot',
        userPrompt: 'runtime replay snapshot',
        requestBody: null,
    });
}

export function resetRuntimeReplaySnapshotDraft(): void {
    _draftSnapshot = null;
}

export function getRuntimeReplaySnapshot(): RuntimeReplaySnapshot | null {
    if (LLMCache.getState().enabled) {
        return readPersistedSnapshot();
    }
    if (_draftSnapshot) return cloneSerializable(_draftSnapshot);
    return readPersistedSnapshot();
}

export function isRuntimeReplayActive(): boolean {
    return LLMCache.getState().enabled && !!readPersistedSnapshot();
}

export function recordDesignReplayState(state: {
    curvesData: CurveData[];
    interventionResult: InterventionStageResult | null;
    lxCurves: LxCurve[] | null;
    incrementalSnapshots: LxSnapshot[] | null;
}): void {
    const snapshot = getWritableSnapshot();
    snapshot.design = {
        curvesData: cloneSerializable(state.curvesData),
        interventionResult: cloneSerializable(state.interventionResult),
        lxCurves: cloneSerializable(state.lxCurves),
        incrementalSnapshots: cloneSerializable(state.incrementalSnapshots),
    };
    writeSnapshot(snapshot);
}

export function recordBioCorrectedReplayState(state: {
    curvesData: CurveData[];
    lxCurves: LxCurve[] | null;
    incrementalSnapshots: LxSnapshot[] | null;
}): void {
    const snapshot = getWritableSnapshot();
    snapshot.bioCorrected = {
        curvesData: cloneSerializable(state.curvesData),
        lxCurves: cloneSerializable(state.lxCurves),
        incrementalSnapshots: cloneSerializable(state.incrementalSnapshots),
    };
    writeSnapshot(snapshot);
}

export function recordRevisionReplayState(state: {
    interventionResult: InterventionStageResult | null;
    lxCurves: LxCurve[] | null;
    incrementalSnapshots: LxSnapshot[] | null;
}): void {
    const snapshot = getWritableSnapshot();
    snapshot.revision = {
        interventionResult: cloneSerializable(state.interventionResult),
        lxCurves: cloneSerializable(state.lxCurves),
        incrementalSnapshots: cloneSerializable(state.incrementalSnapshots),
    };
    writeSnapshot(snapshot);
}

export function recordWeekReplayState(days: DaySnapshot[]): void {
    const snapshot = getWritableSnapshot();
    snapshot.week = {
        days: cloneSerializable(days),
    };
    writeSnapshot(snapshot);
}
