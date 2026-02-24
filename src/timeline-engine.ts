// ============================================
// GLOBAL ANIMATION TIMELINE ENGINE
// ============================================
// Single rAF loop driving all animations as declarative segments.
// Each segment is a pure function of progress (0..1) → visual state.

import { cleanupDivider } from './divider';
import { hideNarrationPanel } from './sherlock';

export type SegmentCategory =
    | 'word-cloud'
    | 'scan-line'
    | 'curves'
    | 'lx-reveal'
    | 'sherlock'
    | 'biometric'
    | 'revision'
    | 'transition'
    | 'gate';

export const SEGMENT_COLORS: Record<SegmentCategory, { dark: string; light: string }> = {
    'word-cloud': { dark: '#6ec8ff', light: '#2563eb' },
    'scan-line': { dark: '#06b6d4', light: '#0891b2' },
    'curves': { dark: '#22c55e', light: '#16a34a' },
    'lx-reveal': { dark: '#f5c850', light: '#d97706' },
    'sherlock': { dark: '#c084fc', light: '#7e3af2' },
    'biometric': { dark: '#ff4d4d', light: '#dc2626' },
    'revision': { dark: '#a855f7', light: '#9333ea' },
    'transition': { dark: '#64748b', light: '#94a3b8' },
    'gate': { dark: '#f59e0b', light: '#d97706' },
};

export interface SegmentContext {
    svgRoot: SVGSVGElement;
    groups: Record<string, SVGGElement>;
    // Data populated progressively as LLM calls complete
    curvesData: any | null;
    interventions: any[] | null;
    lxCurves: any[] | null;
    incrementalSnapshots: any[] | null;
    biometricChannels: any[] | null;
    revisionDiff: any[] | null;
    wordCloudEffects: any[] | null;
    // Sherlock narration data
    sherlockNarration: { intro: string; beats: any[]; outro: string } | null;
    sherlockRevisionNarration: { intro: string; beats: any[]; outro: string } | null;
    // Shared references for cross-segment coordination
    [key: string]: any;
}

export interface AnimationSegment {
    id: string;
    label: string;
    category: SegmentCategory;
    startTime: number;      // ms offset on global timeline
    duration: number;       // ms, 0 for instant, Infinity for variable
    phaseIdx: number;       // which pipeline phase (0-4) this belongs to

    // Lifecycle
    enter(ctx: SegmentContext): void;
    render(progress: number, ctx: SegmentContext): void;
    exit(ctx: SegmentContext): void;

    // Internal tracking (set by engine)
    _entered?: boolean;
    _exited?: boolean;

    // For looping segments (scan lines): progress wraps every loopPeriod ms
    loopPeriod?: number;
}

export type TimelineEventType =
    | 'time-update'     // every frame
    | 'segment-change'  // segment added/removed/resolved
    | 'play-state'      // play/pause
    | 'seek'            // manual seek
    | 'gate-hit'        // playback paused at a gate
    | 'gate-resolved'   // gate resolved, playback continues
    | 'duration-resolved'; // variable segment resolved

export type TimelineListener = (event: TimelineEventType, data?: any) => void;

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

export class TimelineEngine {
    private segments: AnimationSegment[] = [];
    private currentTime: number = 0;
    private playing: boolean = false;
    private playbackRate: number = 1.0;
    private speedIndex: number = 2; // default 1x
    private rafId: number | null = null;
    private lastFrameTime: number = 0;
    private context: SegmentContext;
    private listeners: TimelineListener[] = [];

    // Gate management: when playback hits a gate, it pauses
    private pendingGates: Set<string> = new Set();
    private pausedAtGate: string | null = null;

    // Record-only mode: during first-run, imperative code owns visuals.
    // The engine only tracks currentTime for the ribbon playhead.
    // Once the pipeline completes, this flips to false and seek/play
    // drives visuals via segment enter()/render()/exit().
    private _recordOnly: boolean = true;

    constructor(svgRoot: SVGSVGElement) {
        const groupIds = [
            'phase-grid', 'phase-x-axis', 'phase-y-axis-left', 'phase-y-axis-right',
            'phase-scan-line', 'phase-word-cloud', 'phase-baseline-curves',
            'phase-desired-curves', 'phase-lx-bands', 'phase-lx-curves',
            'phase-lx-markers', 'phase-substance-timeline', 'phase-mission-arrows',
            'phase-yaxis-indicators', 'phase-legend', 'phase-tooltip-overlay',
            'phase-biometric-strips',
        ];
        const groups: Record<string, SVGGElement> = {};
        for (const id of groupIds) {
            const el = svgRoot.getElementById(id) || svgRoot.querySelector(`#${id}`);
            if (el) groups[id] = el as SVGGElement;
        }

        this.context = {
            svgRoot,
            groups,
            curvesData: null,
            interventions: null,
            lxCurves: null,
            incrementalSnapshots: null,
            biometricChannels: null,
            revisionDiff: null,
            wordCloudEffects: null,
            sherlockNarration: null,
            sherlockRevisionNarration: null,
        };
    }

    // --- Public API ---

    getContext(): SegmentContext {
        return this.context;
    }

    getSegments(): readonly AnimationSegment[] {
        return this.segments;
    }

    getCurrentTime(): number {
        return this.currentTime;
    }

    getTotalDuration(): number {
        if (this.segments.length === 0) return 0;
        let max = 0;
        for (const seg of this.segments) {
            if (seg.duration === Infinity) continue;
            const end = seg.startTime + seg.duration;
            if (end > max) max = end;
        }
        return max;
    }

    isPlaying(): boolean {
        return this.playing;
    }

    getPlaybackRate(): number {
        return this.playbackRate;
    }

    addSegment(seg: AnimationSegment): void {
        seg._entered = false;
        seg._exited = false;
        this.segments.push(seg);
        // Keep sorted by startTime for predictable iteration
        this.segments.sort((a, b) => a.startTime - b.startTime);
        this.emit('segment-change', { added: seg.id });
    }

    /** Look up a segment's start time by ID (used by Prev button for seek targets) */
    getSegmentStartTime(id: string): number | null {
        const seg = this.segments.find(s => s.id === id);
        return seg ? seg.startTime : null;
    }

    removeSegment(id: string): void {
        const idx = this.segments.findIndex(s => s.id === id);
        if (idx < 0) return;
        const seg = this.segments[idx];
        // Clean up if entered
        if (seg._entered && !seg._exited) {
            seg.exit(this.context);
            seg._exited = true;
        }
        this.segments.splice(idx, 1);
        this.emit('segment-change', { removed: id });
    }

    /**
     * Resolve a variable-duration segment (e.g., scan line ending when LLM returns).
     * Sets the actual duration and shifts all subsequent segments by the delta.
     */
    resolveDuration(segmentId: string, actualDurationMs: number): void {
        const seg = this.segments.find(s => s.id === segmentId);
        if (!seg || seg.duration !== Infinity) return;

        const oldEnd = seg.startTime; // Was Infinity, so no "old end"
        seg.duration = actualDurationMs;
        const newEnd = seg.startTime + actualDurationMs;

        // Find all segments that were marked as "after" this one
        // and shift them so they start after this segment's resolved end
        this.recomputeStartTimes();
        this.emit('duration-resolved', { id: segmentId, duration: actualDurationMs });
    }

    /**
     * Register a gate that must be resolved before playback continues past it.
     */
    addGate(gateId: string): void {
        this.pendingGates.add(gateId);
    }

    /**
     * Resolve a gate (e.g., user clicked Optimize button).
     * If playback was paused at this gate, it resumes.
     */
    resolveGate(gateId: string): void {
        this.pendingGates.delete(gateId);
        if (this.pausedAtGate === gateId) {
            this.pausedAtGate = null;
            this.emit('gate-resolved', { id: gateId });
            if (this.playing) {
                this.lastFrameTime = performance.now();
                this.scheduleFrame();
            }
        }
    }

    play(): void {
        if (this.playing) return;
        // Gates are only for first-run imperative code, not engine-driven replay
        this.pausedAtGate = null;
        // Auto-transition to engine-driven mode if still in record-only
        if (this._recordOnly) {
            this.transitionToEngineDriven();
        }
        this.playing = true;
        this.lastFrameTime = performance.now();
        this.scheduleFrame();
        this.emit('play-state', { playing: true });
    }

    pause(): void {
        if (!this.playing) return;
        this.playing = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.emit('play-state', { playing: false });
    }

    togglePlay(): void {
        if (this.playing) this.pause();
        else this.play();
    }

    seek(timeMs: number): void {
        // Auto-transition to engine-driven mode if still in record-only
        if (this._recordOnly) {
            this.transitionToEngineDriven();
        }
        const clamped = Math.max(0, Math.min(this.getTotalDuration(), timeMs));
        this.currentTime = clamped;
        this.renderAtTime(clamped);
        this.emit('seek', { time: clamped });
    }

    /**
     * Advance currentTime without calling renderAtTime().
     * Used during first-run: imperative code drives visuals,
     * this just moves the ribbon playhead.
     */
    advanceTimeTo(timeMs: number): void {
        const target = Math.max(0, timeMs);

        // In record-only mode, variable-duration segments (Infinity) are not counted
        // by getTotalDuration(). Clamping here freezes the playhead while those
        // segments are still actively animating.
        if (this._recordOnly) {
            this.currentTime = target;
            const total = this.getTotalDuration();
            this.emit('time-update', { time: this.currentTime, total: Math.max(total, this.currentTime) });
            return;
        }

        const total = this.getTotalDuration();
        this.currentTime = total > 0 ? Math.min(total, target) : target;
        this.emit('time-update', { time: this.currentTime, total });
    }

    /**
     * Switch between record-only mode (first-run) and engine-driven mode (replay/seek).
     * When switching OUT of record-only mode, resets all segment lifecycle flags
     * so renderAtTime() can properly reconstruct visual state.
     */
    setRecordOnly(recordOnly: boolean): void {
        if (this._recordOnly && !recordOnly) {
            // Transitioning to engine-driven mode: reset all segment entered/exited flags
            for (const seg of this.segments) {
                seg._entered = false;
                seg._exited = false;
            }
        }
        this._recordOnly = recordOnly;
    }

    isRecordOnly(): boolean {
        return this._recordOnly;
    }

    /**
     * Transition from record-only mode to engine-driven mode.
     * Clears all SVG groups so segments can rebuild from scratch,
     * resets segment lifecycle flags, and renders the current time position.
     */
    transitionToEngineDriven(): void {
        if (!this._recordOnly) return; // Already in engine-driven mode

        // Clear all SVG groups that segments will rebuild
        for (const [_id, group] of Object.entries(this.context.groups)) {
            if (group && group.innerHTML !== undefined) {
                group.innerHTML = '';
                group.classList.remove('revealed');
            }
        }

        // Also remove stray elements created by imperative code
        document.querySelectorAll('.substance-step-label, .sequential-playhead').forEach(el => el.remove());

        // Clean up the split-screen divider (lives outside SVG groups —
        // #effect-divider element, mask/gradient defs, drag handlers, DividerState)
        cleanupDivider();

        // Clean up the Sherlock narration panel (lives on <body>, outside SVG groups)
        hideNarrationPanel();

        // Reset SVG viewBox to default — segments will expand as needed in enter().
        // Read viewW from the current viewBox to avoid hardcoding dimensions.
        const currentVB = this.context.svgRoot.getAttribute('viewBox')?.split(' ').map(Number) || [0, 0, 1120, 500];
        const defaultW = currentVB[2] || 1120;
        this.context.svgRoot.setAttribute('viewBox', `0 0 ${defaultW} 500`);

        // Reset segment lifecycle
        for (const seg of this.segments) {
            seg._entered = false;
            seg._exited = false;
        }

        this._recordOnly = false;

        // Render the visual state at the current time position
        this.renderAtTime(this.currentTime);
    }

    /**
     * Seek to the end of a phase — shows that phase's fully-rendered state.
     * We seek to the last segment's end time in the phase (minus 1ms to stay "in" the phase).
     */
    seekToPhase(phaseIdx: number): void {
        const boundaries = this.getPhaseBoundaries();
        const phase = boundaries.find(b => b.phaseIdx === phaseIdx);
        if (phase) {
            // Seek to the end of this phase (minus 1ms so the phase's final segments are "past")
            this.seek(Math.max(0, phase.endTime - 1));
        }
    }

    cycleSpeed(): number {
        this.speedIndex = (this.speedIndex + 1) % SPEED_OPTIONS.length;
        this.playbackRate = SPEED_OPTIONS[this.speedIndex];
        this.emit('play-state', { rate: this.playbackRate });
        return this.playbackRate;
    }

    setPlaybackRate(rate: number): void {
        this.playbackRate = rate;
        const idx = SPEED_OPTIONS.indexOf(rate);
        if (idx >= 0) this.speedIndex = idx;
    }

    /**
     * Subscribe to timeline events.
     */
    on(listener: TimelineListener): () => void {
        this.listeners.push(listener);
        return () => {
            const idx = this.listeners.indexOf(listener);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    }

    /**
     * Tear down: stop playback, exit all segments, remove listeners.
     */
    destroy(): void {
        this.pause();
        for (const seg of this.segments) {
            if (seg._entered && !seg._exited) {
                seg.exit(this.context);
                seg._exited = true;
            }
        }
        this.segments = [];
        this.listeners = [];
    }

    // --- Phase boundary helpers ---

    /**
     * Get the time range for each phase (0-4).
     */
    getPhaseBoundaries(): { phaseIdx: number; startTime: number; endTime: number }[] {
        const phases: Map<number, { start: number; end: number }> = new Map();
        for (const seg of this.segments) {
            if (seg.duration === Infinity) continue;
            const end = seg.startTime + seg.duration;
            const existing = phases.get(seg.phaseIdx);
            if (!existing) {
                phases.set(seg.phaseIdx, { start: seg.startTime, end });
            } else {
                existing.start = Math.min(existing.start, seg.startTime);
                existing.end = Math.max(existing.end, end);
            }
        }
        return Array.from(phases.entries())
            .map(([phaseIdx, { start, end }]) => ({ phaseIdx, startTime: start, endTime: end }))
            .sort((a, b) => a.phaseIdx - b.phaseIdx);
    }

    // --- Internal ---

    private emit(event: TimelineEventType, data?: any): void {
        for (const listener of this.listeners) {
            listener(event, data);
        }
    }

    private scheduleFrame(): void {
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(this.tick);
    }

    private tick = (now: number): void => {
        this.rafId = null;

        const dt = (now - this.lastFrameTime) * this.playbackRate;
        this.lastFrameTime = now;

        const total = this.getTotalDuration();
        const newTime = Math.min(total, this.currentTime + dt);
        this.currentTime = newTime;

        // Check for gate collisions - wait, gates should be skipped on scrub/replay!
        // During first run (_recordOnly), gates are handled imperatively in main.ts via pausePlayhead().
        // So we do NOT pause at gates here in engine-driven mode.


        if (!this._recordOnly) {
            this.renderAtTime(newTime);
        }
        this.emit('time-update', { time: newTime, total });

        if (this.playing && newTime < total) {
            this.scheduleFrame();
        } else if (newTime >= total) {
            this.playing = false;
            this.emit('play-state', { playing: false });
        }
    };

    /**
     * Core render loop: for each segment, determine if it's active/past/future
     * and call the appropriate lifecycle methods.
     */
    private renderAtTime(time: number): void {
        for (const seg of this.segments) {
            const segEnd = seg.duration === Infinity
                ? Infinity
                : seg.startTime + seg.duration;

            const isActive = time >= seg.startTime && time < segEnd;
            const isPast = seg.duration !== Infinity && time >= segEnd;
            const isFuture = time < seg.startTime;

            if (isActive) {
                // Ensure entered
                if (!seg._entered) {
                    seg.enter(this.context);
                    seg._entered = true;
                    seg._exited = false;
                }
                // Was previously exited (backward seek past, then forward again)?
                if (seg._exited) {
                    seg.enter(this.context);
                    seg._entered = true;
                    seg._exited = false;
                }

                let progress: number;
                if (seg.duration === 0 || seg.duration === Infinity) {
                    progress = seg.duration === 0 ? 1 : 0;
                } else if (seg.loopPeriod) {
                    // Looping segment: progress oscillates
                    const elapsed = time - seg.startTime;
                    const loopT = (elapsed % seg.loopPeriod) / seg.loopPeriod;
                    progress = loopT; // The segment's render() handles ping-pong
                } else {
                    progress = (time - seg.startTime) / seg.duration;
                }
                seg.render(Math.min(1, Math.max(0, progress)), this.context);

            } else if (isPast) {
                // Ensure entered and rendered at final state.
                // NOTE: We do NOT call exit() for past segments.
                // exit() is reserved for backward-seek cleanup only.
                // render(1) represents the completed visual state.
                if (!seg._entered || seg._exited) {
                    seg.enter(this.context);
                    seg._entered = true;
                    seg._exited = false;
                }
                seg.render(1, this.context);

            } else if (isFuture) {
                // Backward seek: clean up if previously entered
                if (seg._entered && !seg._exited) {
                    seg.exit(this.context);
                    seg._exited = true;
                }
                seg._entered = false;
            }
        }
    }

    /**
     * Recompute start times for segments that depend on variable-duration predecessors.
     * Called after resolveDuration(). Uses a simple sequential accumulator
     * for segments marked with _sequentialAfter.
     */
    private recomputeStartTimes(): void {
        // Re-sort after duration changes
        this.segments.sort((a, b) => a.startTime - b.startTime);
    }
}

// --- Easing functions ---

export function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
}

export function easeInCubic(t: number): number {
    return t * t * t;
}

export function easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function linear(t: number): number {
    return t;
}

/**
 * Smoothstep: S-curve with zero derivatives at 0 and 1.
 */
export function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
}
