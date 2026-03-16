export interface Destroyable {
    destroy(): void;
}

export interface TimelineContextLike {
    [key: string]: unknown;
}

export interface TimelineEngineHandle extends Destroyable {
    advanceTimeTo(timeMs: number): void;
    getContext(): TimelineContextLike;
    getCurrentTime(): number;
    getSegmentStartTime(segmentId: string): number | null;
    play(): void;
    resolveGate(gateId: string): void;
    seek(timeMs: number): void;
}

export interface PlayheadTracker {
    rafId: number | null;
    wallStart: number | null;
    timelineStart: number | null;
}

export interface TaskGroupController {
    cancelAll(): void;
    trackAnimationFrame(callback: FrameRequestCallback): number;
    trackTimeout(callback: () => void, delayMs: number): number;
}
