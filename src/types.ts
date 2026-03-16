// ============================================
// Core domain types — Cortex Loop
// ============================================

import type { Destroyable, PlayheadTracker, TaskGroupController, TimelineEngineHandle } from './contracts';

// -- Pipeline & Provider types --

export type PipelineStage =
    | 'fast'
    | 'curves'
    | 'intervention'
    | 'biometricRec'
    | 'biometricProfile'
    | 'biometricChannel'
    | 'biometric'
    | 'revision'
    | 'sherlock'
    | 'sherlockRevision'
    | 'strategistBio'
    | 'knight'
    | 'spotterDaily'
    | 'strategistBioDaily'
    | 'grandmasterDaily'
    | 'agentMatch';

export type Provider = 'anthropic' | 'openai' | 'grok' | 'gemini';

// -- Phase labels --

export type PhaseLabel =
    | 'idle'
    | 'loading'
    | 'scanning'
    | 'word-cloud'
    | 'word-cloud-dismiss'
    | 'axes-revealed'
    | 'baseline-shown'
    | 'curves-drawn'
    | 'lx-ready'
    | 'lx-sequential'
    | 'lx-rendered'
    | 'biometric-rendered'
    | 'bio-corrected'
    | 'revision-rendered'
    | 'week-loading'
    | 'week-playing'
    | 'week-complete';

export type BiometricPhase = 'idle' | 'selecting' | 'profiling' | 'loading' | 'rendered';

export type RevisionPhase = 'idle' | 'pending' | 'ready' | 'animating' | 'rendered';

export type CompilePhase = 'idle' | 'extracting' | 'assembling' | 'ready';

export type AgentMatchPhase = 'idle' | 'ranking' | 'matched' | 'selected' | 'docked';

export interface AgentMatchResult {
    agentId: string;
    score: number;
    reason: string;
}

export type SimulationPhase = 'idle' | 'running' | 'paused' | 'complete';

export type SherlockPhase = 'idle' | 'loading' | 'ready' | 'animating' | 'rendered';

export type ProfileDraftStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type ProfileSource = 'spotter' | 'fallback' | 'user-edited';

export type RxMode = 'off' | 'rx' | 'rx-only';

// -- Curve data (from LLM / phase chart) --

export interface CurvePoint {
    hour: number;
    value: number;
}

export interface CurveData {
    effect: string;
    color: string;
    baseline: CurvePoint[];
    desired: CurvePoint[];
    polarity?: 'higher_is_better' | 'higher_is_worse';
    levels?: CurveLevel[] | Record<string, string> | string[];
    directive?: 'improve' | 'keep';
}

// -- Lx overlay curves --

export interface LxCurvePoint {
    hour: number;
    value: number;
}

export interface LxCurve {
    points: LxCurvePoint[];
    desired: LxCurvePoint[];
    baseline: CurvePoint[];
}

// -- Interventions (from chess-player LLM) --

export interface BioTrigger {
    hour: number;
    channel: string;
    observation?: string;
}

export interface Intervention {
    key: string;
    timeMinutes: number;
    dose: string;
    substance: any; // resolved from SUBSTANCE_DB at runtime
    targetCurveIdx?: number | null;
    targetEffect?: string;
    rationale?: string;
    impacts?: Record<string, number>;
    doseMultiplier?: number;
    bioTrigger?: BioTrigger;
}

// -- Revision diff --

export type DiffType = 'moved' | 'resized' | 'retargeted' | 'replaced' | 'removed' | 'added';

export interface DiffEntry {
    type: DiffType;
    oldIv: Intervention | null;
    newIv: Intervention | null;
}

export interface RevisionCurveSeries {
    effect: string;
    polarity: 'higher_is_better' | 'higher_is_worse';
    points: CurvePoint[];
}

export interface RevisionGapWindow {
    startHour: number;
    endHour: number;
    durationMinutes: number;
    areaPointMinutes: number;
    peakGap: number;
    peakGapHour: number;
}

export interface RevisionGapPoint {
    hour: number;
    value: number;
    kind: 'under' | 'over' | 'aligned';
}

export interface RevisionAlignmentPoint {
    hour: number;
    absoluteError: number;
}

export interface RevisionGapEffectSummary {
    effect: string;
    polarity: 'higher_is_better' | 'higher_is_worse';
    missionWindows: RevisionGapWindow[];
    topUnderTargetWindows: RevisionGapWindow[];
    topOverTargetWindows: RevisionGapWindow[];
    totalUnderArea: number;
    totalOverArea: number;
    worstPointGap: RevisionGapPoint;
    bestAchievedAlignment: RevisionAlignmentPoint;
}

export interface RevisionGapSummary {
    effects: RevisionGapEffectSummary[];
    totalUnderArea: number;
    totalOverArea: number;
}

export interface RevisionFitMetricEffect {
    effect: string;
    totalUnderArea: number;
    totalOverArea: number;
    worstPointGap: number;
    bestAchievedAlignment: number;
}

export interface RevisionFitMetrics {
    totalUnderArea: number;
    totalOverArea: number;
    totalAbsoluteArea: number;
    peakShortfall: number;
    peakOvershoot: number;
    effects: RevisionFitMetricEffect[];
}

export interface RevisionReferenceBundle {
    baselineCurves: RevisionCurveSeries[];
    desiredCurves: RevisionCurveSeries[];
    currentLxCurves: RevisionCurveSeries[];
    currentInterventions: Intervention[];
    gapSummary: RevisionGapSummary;
    bioCorrectionApplied: boolean;
}

// -- Incremental Lx snapshots --

export interface LxSnapshot {
    lxCurves: LxCurve[];
    step: Intervention[];
}

// -- Spotter highlight (external life event) --

export interface SpotterHighlight {
    hour: number; // 6–30 (time of event)
    label: string; // "Baby woke up", "HIIT session"
    channel: string; // primary affected channel signal (e.g. "hr_bpm")
    impact: string; // brief note: "HR spiked to 165bpm"
    icon: string; // emoji: "🏋️", "👶", "😤", "🍽️"
}

// -- Biometric channel --

export interface BiometricChannel {
    signal: string;
    displayName: string;
    device?: string;
    deviceName?: string;
    color: string;
    range: [number, number];
    unit: string;
    stripHeight?: number;
    data?: CurvePoint[];
    metric?: string;
    _compositeGroup?: string;
    _compositeLabel?: string;
    _renderY?: number;
    _renderH?: number;
}

// -- Narration (Sherlock) --

export interface NarrationBeat {
    substanceKey: string;
    text: string;
}

export interface RevisionNarrationBeat {
    action: string;
    substanceKey: string;
    text: string;
}

export interface SherlockNarration {
    intro: string;
    beats: NarrationBeat[];
    outro: string;
}

export interface SherlockRevisionNarration {
    intro: string;
    beats: RevisionNarrationBeat[];
    outro: string;
}

// -- Word cloud effect --

export interface WordCloudEffect {
    name: string;
    relevance: number;
}

// -- Stage results --

export interface ScoutStageResult {
    effects: WordCloudEffect[];
    hookSentence?: string;
    cycleFilename?: string;
}

export interface CurveLevel {
    step: number;
    intensity_percent: number;
    label: string;
    full_context: string;
}

export interface StrategistCurve extends CurveData {
    levels?: CurveLevel[] | Record<string, string> | string[];
    directive?: 'improve' | 'keep';
}

export interface StrategistStageResult {
    curves: StrategistCurve[];
}

export interface InterventionStageResult {
    interventions: Intervention[];
    rationale?: string;
}

export interface SpotterDeviceReasoning {
    device: string;
    rank: string;
    rationale: string;
}

export interface SpotterDeviceRecommendationResult {
    recommended: string[];
    reasoning: SpotterDeviceReasoning[];
}

export interface SpotterProfileDraftResult {
    profileText: string;
    tensionDirectives: string[];
    revisionLevers?: string[];
}

export interface SpotterChannelPick {
    signal: string;
    weight?: number;
    rationale?: string;
    device?: string;
}

export interface SpotterChannelPickResult {
    channels: SpotterChannelPick[];
}

export interface BiometricStageResult {
    channels: BiometricChannel[];
    highlights?: SpotterHighlight[];
}

export interface DailySimulationBaselineEntry {
    effect: string;
    baseline: CurvePoint[];
}

export interface DailySimulationResult {
    correctedBaseline: DailySimulationBaselineEntry[];
    interventions: Intervention[];
    biometricChannels: BiometricChannel[];
    narrativeBeat?: string;
}

export interface StrategistBioStageResult {
    correctedBaselines: DailySimulationBaselineEntry[];
}

export interface StageResultMap {
    fast: ScoutStageResult;
    curves: StrategistStageResult;
    intervention: InterventionStageResult;
    biometricRec: SpotterDeviceRecommendationResult;
    biometricProfile: SpotterProfileDraftResult;
    biometricChannel: SpotterChannelPickResult;
    biometric: BiometricStageResult;
    revision: InterventionStageResult;
    sherlock: SherlockNarration;
    sherlockRevision: SherlockRevisionNarration;
    strategistBio: StrategistBioStageResult;
    knight: KnightOutput;
    spotterDaily: SpotterDailyOutput;
    strategistBioDaily: StrategistBioDailyOutput;
    grandmasterDaily: GrandmasterDailyOutput;
    agentMatch: { ranked: AgentMatchResult[] };
}

export type StageRunner<TStage extends keyof StageResultMap> = (...args: unknown[]) => Promise<StageResultMap[TStage]>;

// -- Divider elements --

export interface DividerElements {
    group: SVGGElement;
    line: SVGElement;
    glow: SVGElement;
    diamond: SVGElement;
    hitArea: SVGElement;
}

export interface DividerMasks {
    leftGrad: SVGLinearGradientElement;
    rightGrad: SVGLinearGradientElement;
}

// -- State interfaces --

export interface IAppState {
    currentStack: any;
    isLoading: boolean;
    isAnimating: boolean;
    capsuleElements: { front: SVGGElement[]; back: SVGGElement[] };
    filledSlots: Map<number, string>;
    tooltip: any;
    effectCurves: any;
    rxMode: RxMode;
    maxEffects: number;
    selectedLLM: string;
    apiKeys: Record<string, string>;
    stageProviders: Record<PipelineStage, string>;
    stageModels: Record<PipelineStage, string>;
    turboTargetPhase: number;
}

export interface IPhaseState {
    isProcessing: boolean;
    effects: string[];
    wordCloudEffects: WordCloudEffect[];
    curvesData: CurveData[] | null;
    phase: PhaseLabel;
    interventionPromise: Promise<any> | null;
    interventionResult: InterventionStageResult | null;
    lxCurves: LxCurve[] | null;
    incrementalSnapshots: LxSnapshot[] | null;
    hookSentence: string | null;
    maxPhaseReached: number;
    viewingPhase: number;
    userGoal: string | null;
    cycleFilename: string | null;
    loadedCycleId: string | null;
}

export interface IBiometricState {
    selectedDevices: string[];
    profileText: string;
    profileDraftText: string;
    profileDraftStatus: ProfileDraftStatus;
    profileDraftError: string | null;
    profileDirty: boolean;
    profileSource: ProfileSource;
    profileDraftTensionDirectives: string[];
    biometricResult: BiometricStageResult | null;
    channels: BiometricChannel[];
    channelSpec?: BiometricChannel[];
    phase: BiometricPhase;
    spotterHighlights: SpotterHighlight[];
}

export interface ISimulationState {
    phase: SimulationPhase;
    progress: number;
    speed: number;
    rafId: number | null;
    schedule: unknown[];
}

export interface IRevisionState {
    revisionPromise: Promise<any> | null;
    revisionResult: InterventionStageResult | null;
    oldInterventions: Intervention[] | null;
    newInterventions: Intervention[] | null;
    diff: DiffEntry[] | null;
    newLxCurves: LxCurve[] | null;
    referenceBundle: RevisionReferenceBundle | null;
    fitMetricsBefore: RevisionFitMetrics | null;
    fitMetricsAfter: RevisionFitMetrics | null;
    phase: RevisionPhase;
}

export interface ITimelineState {
    engine: TimelineEngineHandle | null;
    ribbon: Destroyable | null;
    pipelineTimeline: Destroyable | null;
    active: boolean;
    cursor: number;
    interactionLocked: boolean;
    onLxStepWait: ((waiting: boolean) => void) | null;
    onLxStepWaitOwner: TimelineEngineHandle | null;
    playheadTrackers: {
        prompt: PlayheadTracker;
        bioScan: PlayheadTracker;
        bioReveal: PlayheadTracker;
    };
    runTasks: TaskGroupController | null;
}

export interface ISherlockState {
    enabled: boolean;
    narrationResult: SherlockNarration | null;
    revisionNarrationResult: SherlockRevisionNarration | null;
    phase: SherlockPhase;
}

export interface IDividerState {
    active: boolean;
    x: number;
    fadeWidth: number;
    minOpacity: number;
    elements: DividerElements | null;
    masks: DividerMasks | null;
    dragging: boolean;
    dragCleanup: (() => void) | null;
}

// -- Multi-day iteration types --

export type MultiDayPhase = 'idle' | 'loading' | 'computing' | 'playing' | 'paused' | 'complete';

// -- POI (Point of Interest) events for weekly biometric red dots --

export interface PoiEvent {
    hour: number;
    channelIdx: number;
    label: string;
    connectedSubstanceKey?: string;
}

// -- Tolerance tracking for multi-day substance cycling --

export interface ToleranceEntry {
    substanceKey: string;
    consecutiveDays: number;
    toleranceMultiplier: number; // 1.0 = no tolerance, 0.5 = 50% reduced (floor)
}

// -- Knight output: 7 days of desired curve evolution --

export interface KnightDayEntry {
    day: number;
    rationale: string;
    desired: { effect: string; desired: CurvePoint[] }[];
}

export interface KnightOutput {
    startWeekday: string;
    weekNarrative: string;
    days: KnightDayEntry[];
}

// -- Spotter Daily output: 7 days of biometric perturbations --

export interface SpotterDailyExternalEvent {
    hour: number;
    label: string;
    impact: string;
    icon: string;
    channelIdx: number;
}

export interface BioModulation {
    channelIdx: number;
    type: 'spike' | 'dip' | 'shift' | 'noise';
    startHour: number;
    endHour: number;
    magnitude: number;
    rationale?: string;
}

export interface SpotterDailyDayEntry {
    day: number;
    events: string;
    narrativeBeat: string;
    modulations: BioModulation[];
    biometricChannels: { signal: string; data: CurvePoint[] }[];
    externalEvents: SpotterDailyExternalEvent[];
    poiEvents: PoiEvent[];
}

export interface SpotterDailyOutput {
    days: SpotterDailyDayEntry[];
}

// -- Strategist Bio Daily output: 7 bio-corrected baseline sets --

export interface StrategistBioDayEntry {
    day: number;
    correctedBaseline: { effect: string; baseline: CurvePoint[] }[];
    rationale: string;
}

export interface StrategistBioDailyOutput {
    days: StrategistBioDayEntry[];
}

// -- Grandmaster Daily output: 7 intervention protocols --

export interface GrandmasterDayEntry {
    day: number;
    interventions: {
        key: string;
        dose: string;
        doseMultiplier?: number;
        timeMinutes: number;
        impacts: Record<string, number>;
        rationale: string;
    }[];
    dayNarrative: string;
}

export interface GrandmasterDailyOutput {
    days: GrandmasterDayEntry[];
}

export interface DaySnapshot {
    day: number;
    bioCorrectedBaseline: CurvePoint[][];
    desiredCurves: CurvePoint[][];
    interventions: Intervention[];
    lxCurves: LxCurve[];
    biometricChannels: BiometricChannel[];
    poiEvents: PoiEvent[];
    toleranceProfile: ToleranceEntry[];
    events: string;
    narrativeBeat: string;
    dayNarrative: string;
}

export interface IAgentMatchState {
    matchedAgents: import('./creator-agent-types').AgentConfig[];
    matchResults: AgentMatchResult[];
    selectedAgent: import('./creator-agent-types').AgentConfig | null;
    phase: AgentMatchPhase;
}

export interface ICompileState {
    phase: CompilePhase;
    countdownTimer: number | null;
    runId: number;
    cleanup: (() => void) | null;
}

export interface IMultiDayState {
    phase: MultiDayPhase;
    days: DaySnapshot[];
    currentDay: number;
    animationRafId: number | null;
    speed: number;
    knightOutput: KnightOutput | null;
    startWeekday: string | null;
    bioCorrectedBaseline: CurvePoint[][] | null;
    lockedViewBoxHeight: number | null;
    maxTimelineLanes: number;
}
