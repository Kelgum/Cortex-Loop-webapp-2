/**
 * Pipeline Timeline — LLM agent timeline lane UI showing API call durations, status badges, and elapsed time.
 * Exports: PipelineTimeline, PipelineLaneId, PipelineStatus, PipelineEvent
 * Depends on: debug-panel (DebugLog), utils (isLightMode, formatMsAsTimestamp, formatDuration)
 */
import { DebugLog } from './debug-panel';
import { settingsStore, STORAGE_KEYS } from './settings-store';
import { isLightMode, formatMsAsTimestamp, formatDuration, escapeHtml, clamp } from './utils';

export type PipelineLaneId =
    | 'scout'
    | 'strategist'
    | 'chess-player'
    | 'sherlock'
    | 'spotter'
    | 'grandmaster'
    | 'strategist-bio'
    | 'knight'
    | 'spotter-daily'
    | 'strategist-bio-daily'
    | 'grandmaster-daily'
    | 'referee'
    | 'agent-match';

export type PipelineStatus = 'queued' | 'running' | 'done' | 'error';

export interface PipelineEvent {
    id: string;
    laneId: PipelineLaneId;
    substep: string;
    stageLabel: string;
    status: PipelineStatus;
    startOffsetMs: number;
    endOffsetMs: number | null;
    startedAt: number;
    endedAt: number | null;
    durationMs: number | null;
    provider: string;
    model: string;
    error: string | null;
    inputText: string;
    outputText: string;
}

const LANE_ORDER: PipelineLaneId[] = [
    'scout',
    'agent-match',
    'strategist',
    'chess-player',
    'sherlock',
    'spotter',
    'strategist-bio',
    'grandmaster',
    'knight',
    'spotter-daily',
    'strategist-bio-daily',
    'grandmaster-daily',
    'referee',
];

const LANE_LABELS: Record<PipelineLaneId, string> = {
    scout: 'Scout',
    'agent-match': 'Agent Match',
    strategist: 'Strategist',
    'chess-player': 'Chess Player',
    sherlock: 'Sherlock',
    spotter: 'Spotter',
    grandmaster: 'Grandmaster',
    'strategist-bio': 'Strategist Bio',
    knight: 'Knight',
    'spotter-daily': 'Spotter (7d)',
    'strategist-bio-daily': 'Strategist Bio (7d)',
    'grandmaster-daily': 'Grandmaster (7d)',
    referee: 'Referee',
};

const LANE_COLORS: Record<PipelineLaneId, { dark: string; light: string }> = {
    scout: { dark: '#fbbf24', light: '#d97706' },
    'agent-match': { dark: '#fb923c', light: '#ea580c' },
    strategist: { dark: '#c084fc', light: '#7c3aed' },
    'chess-player': { dark: '#22c55e', light: '#15803d' },
    sherlock: { dark: '#a855f7', light: '#7e22ce' },
    spotter: { dark: '#ef4444', light: '#dc2626' },
    grandmaster: { dark: '#60a5fa', light: '#2563eb' },
    'strategist-bio': { dark: '#4ade80', light: '#16a34a' },
    knight: { dark: '#f472b6', light: '#db2777' },
    'spotter-daily': { dark: '#ef4444', light: '#dc2626' },
    'strategist-bio-daily': { dark: '#4ade80', light: '#16a34a' },
    'grandmaster-daily': { dark: '#60a5fa', light: '#2563eb' },
    referee: { dark: '#fbbf24', light: '#d97706' },
};

const MAX_LANE_SLOTS = 12;

type PipelineDebugEvent = 'add' | 'update' | 'clear';

interface LaneRenderRect {
    y: number;
    h: number;
    slots: number;
}

interface RenderedEventLayout {
    event: PipelineEvent;
    slot: number;
}

// Time formatting moved to utils.ts — use formatMsAsTimestamp, formatDuration

type PayloadLineTone = 'muted' | 'human' | 'heading';

const HUMAN_READABLE_KEY_PATTERN =
    /"(?:systemPrompt|userPrompt|prompt|text|rationale|reasoning|summary|intro|outro|description|message|hookSentence|profileText|analysis|narration|error|revisionLevers|tensionDirectives)"\s*:/i;

function classifyPayloadLine(line: string): PayloadLineTone {
    const trimmed = line.trim();
    if (!trimmed) return 'muted';
    if (/^(System Prompt|User Prompt|Request Body|Raw Response|Response|Parsed|Error)\b/i.test(trimmed)) {
        return 'heading';
    }
    if (/^-{4,}$/.test(trimmed)) return 'muted';
    if (HUMAN_READABLE_KEY_PATTERN.test(trimmed)) return 'human';
    if (/:\s*"(?:[^"\\]|\\.){24,}"/.test(trimmed)) return 'human';
    if (!/^[[\]{},"':0-9.\-+_]+$/.test(trimmed) && /[A-Za-z]{3,}/.test(trimmed)) return 'human';
    return 'muted';
}

function renderPayloadWithReadability(rawText: string): string {
    let text = String(rawText || '');
    const trimmed = text.trim();

    // If payload is dense single-line JSON, pretty print for readable line-level emphasis.
    if (!text.includes('\n') && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try {
            text = JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch {
            // Keep original text if parsing fails.
        }
    }

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    return lines
        .map(line => {
            const tone = classifyPayloadLine(line);
            const safe = line.length ? escapeHtml(line) : '&nbsp;';
            return `<span class="pipeline-payload-line ${tone}">${safe}</span>`;
        })
        .join('');
}

function payloadToText(payload: any): string {
    if (payload == null) return '';
    if (typeof payload === 'string') return payload.trim();
    try {
        return JSON.stringify(payload, null, 2);
    } catch {
        return String(payload);
    }
}

function buildInputText(entry: any): string {
    const requestBody = payloadToText(entry?.requestBody);
    if (requestBody) return requestBody;

    const sections: string[] = [];
    const systemPrompt = String(entry?.systemPrompt || '').trim();
    const userPrompt = String(entry?.userPrompt || '').trim();
    if (systemPrompt) sections.push(`System Prompt\n\n${systemPrompt}`);
    if (userPrompt) sections.push(`User Prompt\n\n${userPrompt}`);
    if (sections.length > 0) return sections.join('\n\n--------------------\n\n');
    return 'No input payload captured yet for this call.';
}

function buildOutputText(entry: any): string {
    const rawResponse = payloadToText(entry?.rawResponse);
    if (rawResponse) return rawResponse;

    const response = payloadToText(entry?.response);
    if (response) return response;

    const parsed = payloadToText(entry?.parsed);
    if (parsed) return parsed;

    if (entry?.loading) return 'Waiting for response...';
    if (entry?.error) return String(entry.error);
    return 'No output payload captured yet for this call.';
}

function inferProvider(entry: any): string {
    if (typeof entry?.provider === 'string' && entry.provider) return entry.provider;
    const model = String(entry?.model || '').toLowerCase();
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gpt') || model.startsWith('o')) return 'openai';
    if (model.startsWith('grok')) return 'grok';
    if (model.startsWith('gemini')) return 'gemini';
    return 'unknown';
}

function mapLane(stageClass: string): PipelineLaneId | null {
    switch (stageClass) {
        case 'fast-model':
            return 'scout';
        case 'main-model':
            return 'strategist';
        case 'intervention-model':
            return 'chess-player';
        case 'sherlock-model':
        case 'sherlock-revision-model':
        case 'sherlock7d-model':
            return 'sherlock';
        case 'biometric-rec-model':
        case 'biometric-profile-model':
        case 'biometric-channel-model':
        case 'biometric-model':
            return 'spotter';
        case 'revision-model':
            return 'grandmaster';
        case 'strategist-bio-model':
            return 'strategist-bio';
        case 'knight-model':
            return 'knight';
        case 'spotter-daily-model':
            return 'spotter-daily';
        case 'strategist-bio-daily-model':
            return 'strategist-bio-daily';
        case 'grandmaster-daily-model':
            return 'grandmaster-daily';
        case 'referee-model':
            return 'referee';
        case 'agent-match-model':
            return 'agent-match';
        default:
            return null;
    }
}

function mapSubstep(entry: any): string {
    const stageClass = String(entry?.stageClass || '');
    const stage = String(entry?.stage || '');
    if (stageClass === 'fast-model') return 'Effect ID';
    if (stageClass === 'main-model') return 'Curves';
    if (stageClass === 'intervention-model') return 'Protocol';
    if (stageClass === 'sherlock-model') return 'Narration';
    if (stageClass === 'sherlock-revision-model') return 'Revision Narration';
    if (stageClass === 'sherlock7d-model') return '7D Narration';
    if (stageClass === 'biometric-rec-model') return 'Device Rec';
    if (stageClass === 'biometric-profile-model') return 'Profile Draft';
    if (stageClass === 'biometric-channel-model') return 'Channel Pick';
    if (stageClass === 'biometric-model') return 'Biometric Sim';
    if (stageClass === 'revision-model') return 'Protocol Revision';
    if (stageClass === 'strategist-bio-model') return 'Bio Correction';
    if (stageClass === 'knight-model') return 'Curve Targets';
    if (stageClass === 'spotter-daily-model') return 'Bio Perturb';
    if (stageClass === 'strategist-bio-daily-model') return 'Bio Correct';
    if (stageClass === 'grandmaster-daily-model') return 'Protocols';
    if (stageClass === 'referee-model') return 'Stacking Fix';
    return stage || 'Step';
}

function toEpochMs(value: any): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
}

export class PipelineTimeline {
    private container: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private statusEl: HTMLSpanElement;
    private tooltipEl: HTMLDivElement;
    private scrollEl: HTMLDivElement | null = null;

    private dpr: number = 1;
    private canvasW: number = 0;
    private canvasH: number = 0;
    private resizeObserver: ResizeObserver | null = null;
    private laneHeightPx: number = 22;
    private visibleLaneCount: number = 5;
    private lastTotalUnits: number = LANE_ORDER.length;

    private events = new Map<string, PipelineEvent>();
    private renderedBlocks: Array<{ event: PipelineEvent; x: number; y: number; w: number; h: number }> = [];

    private compressedOffsetMs: number = 0;
    private activeClockWallStartMs: number | null = null;
    private runStartMs: number | null = null;
    private frozen: boolean = false;
    private frozenOffset: number = 0;
    private rafId: number | null = null;

    private hoverEventId: string | null = null;
    private pointerX: number = 0;
    private pointerY: number = 0;

    private modalOverlay: HTMLDivElement;
    private modalTitleEl: HTMLHeadingElement;
    private modalMetaEl: HTMLDivElement;
    private modalInputEl: HTMLPreElement;
    private modalOutputEl: HTMLPreElement;
    private modalOpenEventId: string | null = null;

    private unsubDebug: (() => void) | null = null;
    private toggleBtn: HTMLButtonElement | null = null;
    private _collapsed: boolean = settingsStore.getBoolean(STORAGE_KEYS.pipelineCollapsed, false);

    constructor() {
        this.container = document.getElementById('pipeline-timeline') as HTMLDivElement;
        this.canvas = document.getElementById('pipeline-timeline-canvas') as HTMLCanvasElement;
        this.toggleBtn = document.getElementById('pipeline-toggle') as HTMLButtonElement | null;
        this.statusEl = document.getElementById('pipeline-timeline-status') as HTMLSpanElement;
        this.tooltipEl = document.getElementById('pipeline-timeline-tooltip') as HTMLDivElement;
        this.scrollEl = document.getElementById('pipeline-timeline-scroll') as HTMLDivElement | null;
        if (!this.container || !this.canvas || !this.statusEl || !this.tooltipEl || !this.scrollEl) {
            throw new Error('Missing pipeline timeline DOM elements.');
        }
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to create pipeline timeline canvas context.');
        this.ctx = ctx;
        const modal = this.createModal();
        this.modalOverlay = modal.overlay;
        this.modalTitleEl = modal.title;
        this.modalMetaEl = modal.meta;
        this.modalInputEl = modal.input;
        this.modalOutputEl = modal.output;

        this.setupCanvas();
        this.bindEvents();
        this.unsubDebug = DebugLog.subscribe((event: PipelineDebugEvent, payload?: any) => {
            this.onDebugEvent(event, payload?.entry || null);
        });

        for (const entry of DebugLog.entries) {
            this.ingestEntry(entry);
        }
        this.redraw();
    }

    private readLaneHeight(): number {
        const styles = getComputedStyle(document.documentElement);
        const parsed = parseFloat(styles.getPropertyValue('--pipeline-lane-height'));
        if (Number.isFinite(parsed) && parsed > 4) return parsed;
        return 22;
    }

    private readVisibleLaneCount(): number {
        const styles = getComputedStyle(document.documentElement);
        const parsed = parseInt(styles.getPropertyValue('--pipeline-visible-lanes'), 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        return 5;
    }

    private desiredCanvasHeight(totalUnits: number): number {
        const laneTop = 2;
        const laneBottomPad = 2;
        const minUnits = Math.max(this.visibleLaneCount, 1);
        const units = Math.max(totalUnits, minUnits);
        return laneTop + laneBottomPad + units * this.laneHeightPx;
    }

    private resizeCanvas(totalUnits: number): void {
        const desiredH = this.desiredCanvasHeight(totalUnits);
        const rect = this.canvas.getBoundingClientRect();
        const desiredW = rect.width;
        const needsResize = Math.abs(desiredH - this.canvasH) > 0.5 || Math.abs(desiredW - this.canvasW) > 0.5;
        if (!needsResize) return;

        this.canvas.style.height = `${desiredH}px`;
        this.canvasW = desiredW;
        this.canvasH = desiredH;
        this.canvas.width = Math.max(1, Math.floor(this.canvasW * this.dpr));
        this.canvas.height = Math.max(1, Math.floor(this.canvasH * this.dpr));
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    private ensureRunningLanesVisible(
        values: PipelineEvent[],
        laneRects: Record<PipelineLaneId, LaneRenderRect>,
    ): void {
        if (this._collapsed || !this.scrollEl) return;
        const running = values.filter(value => value.status === 'running');
        if (running.length === 0) return;

        const activeLaneIds = Array.from(new Set(running.map(value => value.laneId)));
        const activeRects = activeLaneIds
            .map(laneId => laneRects[laneId])
            .filter((rect): rect is LaneRenderRect => !!rect);
        if (activeRects.length === 0) return;

        let targetTop = activeRects.reduce((acc, rect) => Math.min(acc, rect.y), Number.POSITIVE_INFINITY);
        let targetBottom = activeRects.reduce((acc, rect) => Math.max(acc, rect.y + rect.h), 0);
        const viewportH = this.scrollEl.clientHeight;
        if (viewportH <= 0) return;

        // If active lanes cannot all fit in the viewport, keep the most recently started one centered.
        if (targetBottom - targetTop > viewportH) {
            let latestRunning = running[0];
            for (const event of running) {
                if (event.startedAt > latestRunning.startedAt) latestRunning = event;
            }
            const focusRect = laneRects[latestRunning.laneId];
            if (focusRect) {
                targetTop = focusRect.y;
                targetBottom = focusRect.y + focusRect.h;
            }
        }

        const pad = 6;
        const currentTop = this.scrollEl.scrollTop;
        const currentBottom = currentTop + viewportH;
        let nextTop = currentTop;

        if (targetTop < currentTop + pad) {
            nextTop = targetTop - pad;
        } else if (targetBottom > currentBottom - pad) {
            nextTop = targetBottom - viewportH + pad;
        }

        const maxScroll = Math.max(0, this.scrollEl.scrollHeight - viewportH);
        nextTop = clamp(nextTop, 0, maxScroll);
        if (Math.abs(nextTop - currentTop) > 0.5) {
            this.scrollEl.scrollTop = nextTop;
        }
    }

    show(): void {
        this.container.classList.add('visible');
        document.body.classList.add('pipeline-timeline-active');
        if (this._collapsed) {
            this.container.classList.add('collapsed');
            document.body.classList.add('pipeline-timeline-collapsed');
            this.toggleBtn?.setAttribute('aria-label', 'Show pipeline');
        } else {
            this.toggleBtn?.setAttribute('aria-label', 'Hide pipeline');
        }
        this.updateFreezeState();
        this.syncLoopState();
        this.redraw();
        setTimeout(() => this.setupCanvas(), 350);
    }

    hide(): void {
        this.container.classList.remove('visible', 'collapsed');
        document.body.classList.remove('pipeline-timeline-active', 'pipeline-timeline-collapsed');
        this.stopLoop();
        this.hideTooltip();
    }

    toggleCollapse(): void {
        this._collapsed = !this._collapsed;
        this.container.classList.toggle('collapsed', this._collapsed);
        document.body.classList.toggle('pipeline-timeline-collapsed', this._collapsed);
        settingsStore.setString(STORAGE_KEYS.pipelineCollapsed, String(this._collapsed));
        this.toggleBtn?.setAttribute('aria-label', this._collapsed ? 'Show pipeline' : 'Hide pipeline');
        if (!this._collapsed) {
            setTimeout(() => this.setupCanvas(), 350);
        }
    }

    destroy(): void {
        this.unbindEvents();
        this.unsubDebug?.();
        this.unsubDebug = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.closeModal();
        this.modalOverlay.remove();
        this.stopLoop();
        this.hide();
        this.events.clear();
        this.runStartMs = null;
        this.renderedBlocks = [];
    }

    private setupCanvas(): void {
        this.dpr = window.devicePixelRatio || 1;
        this.laneHeightPx = this.readLaneHeight();
        this.visibleLaneCount = this.readVisibleLaneCount();
        this.resizeCanvas(Math.max(this.lastTotalUnits, LANE_ORDER.length));

        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                this.dpr = window.devicePixelRatio || 1;
                this.laneHeightPx = this.readLaneHeight();
                this.visibleLaneCount = this.readVisibleLaneCount();
                this.resizeCanvas(Math.max(this.lastTotalUnits, LANE_ORDER.length));
            });
            this.resizeObserver.observe(this.canvas);
        }
        this.redraw();
    }

    private bindEvents(): void {
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseleave', this.onMouseLeave);
        this.canvas.addEventListener('click', this.onCanvasClick);
        this.modalOverlay.addEventListener('click', this.onModalOverlayClick);
        window.addEventListener('keydown', this.onWindowKeyDown);
        this.toggleBtn?.addEventListener('click', this.onToggleClick);
    }

    private unbindEvents(): void {
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
        this.canvas.removeEventListener('click', this.onCanvasClick);
        this.modalOverlay.removeEventListener('click', this.onModalOverlayClick);
        window.removeEventListener('keydown', this.onWindowKeyDown);
        this.toggleBtn?.removeEventListener('click', this.onToggleClick);
    }

    private onToggleClick = (): void => {
        this.toggleCollapse();
    };

    private onMouseMove = (e: MouseEvent): void => {
        this.pointerX = e.offsetX;
        this.pointerY = e.offsetY;
        let hovered: string | null = null;
        for (let i = this.renderedBlocks.length - 1; i >= 0; i--) {
            const b = this.renderedBlocks[i];
            if (
                this.pointerX >= b.x &&
                this.pointerX <= b.x + b.w &&
                this.pointerY >= b.y &&
                this.pointerY <= b.y + b.h
            ) {
                hovered = b.event.id;
                break;
            }
        }
        if (hovered !== this.hoverEventId) {
            this.hoverEventId = hovered;
            if (!hovered) {
                this.hideTooltip();
            } else {
                const event = this.events.get(hovered);
                if (event) this.showTooltip(event, this.pointerX, this.pointerY);
            }
            this.redraw();
            return;
        }
        if (hovered) {
            const event = this.events.get(hovered);
            if (event) this.showTooltip(event, this.pointerX, this.pointerY);
        }
    };

    private onMouseLeave = (): void => {
        this.hoverEventId = null;
        this.hideTooltip();
        this.redraw();
    };

    private onCanvasClick = (e: MouseEvent): void => {
        const hit = this.findEventAt(e.offsetX, e.offsetY);
        if (!hit) return;
        this.openModal(hit);
    };

    private onModalOverlayClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target === this.modalOverlay || target.closest('.pipeline-llm-modal-close')) {
            this.closeModal();
        }
    };

    private onWindowKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && !this.modalOverlay.classList.contains('hidden')) {
            this.closeModal();
        }
    };

    private onDebugEvent(event: PipelineDebugEvent, entry: any): void {
        if (event === 'clear') {
            this.events.clear();
            this.compressedOffsetMs = 0;
            this.activeClockWallStartMs = null;
            this.runStartMs = null;
            this.frozen = false;
            this.frozenOffset = 0;
            this.hoverEventId = null;
            this.hideTooltip();
            this.closeModal();
            this.syncLoopState();
            this.redraw();
            return;
        }

        if (!entry) return;
        const eventId = this.ingestEntry(entry);
        this.updateFreezeState();
        this.syncLoopState();
        if (eventId && this.modalOpenEventId === eventId) {
            const next = this.events.get(eventId);
            if (next) this.renderModal(next);
        }
        this.redraw();
    }

    private ingestEntry(entry: any): string | null {
        const stageClass = String(entry?.stageClass || '');
        const laneId = mapLane(stageClass);
        const startedAt = toEpochMs(entry?.timestamp);
        const nowOffset = this.getNowOffset();

        if (stageClass === 'user-input') {
            this.runStartMs = startedAt;
            this.compressedOffsetMs = 0;
            this.activeClockWallStartMs = null;
            this.frozen = false;
            this.frozenOffset = 0;
            return null;
        }

        if (!laneId) return null;
        if (this.runStartMs == null) this.runStartMs = startedAt;

        const durationMs = Number.isFinite(entry?.duration) ? Math.max(0, Number(entry.duration)) : null;
        const loading = !!entry?.loading;
        const hasError = typeof entry?.error === 'string' && entry.error.length > 0;
        const status: PipelineStatus = loading ? 'running' : hasError ? 'error' : 'done';
        const endedAt = status === 'running' ? null : durationMs != null ? startedAt + durationMs : startedAt;

        const id = String(entry?._debugId ?? `${stageClass}:${startedAt}:${entry?.stage || ''}`);
        const prev = this.events.get(id) || null;
        const startOffsetMs = prev ? prev.startOffsetMs : nowOffset;
        let endOffsetMs: number | null = null;
        if (status !== 'running') {
            if (durationMs != null) {
                endOffsetMs = startOffsetMs + durationMs;
            } else if (prev?.endOffsetMs != null) {
                endOffsetMs = prev.endOffsetMs;
            } else {
                endOffsetMs = nowOffset;
            }
        }
        const next: PipelineEvent = {
            id,
            laneId,
            substep: mapSubstep(entry),
            stageLabel: String(entry?.stage || mapSubstep(entry)),
            status,
            startOffsetMs,
            endOffsetMs,
            startedAt,
            endedAt,
            durationMs,
            provider: inferProvider(entry),
            model: String(entry?.model || 'unknown'),
            error: hasError ? String(entry.error) : null,
            inputText: buildInputText(entry),
            outputText: buildOutputText(entry),
        };
        this.events.set(id, next);
        return id;
    }

    private startLoop(): void {
        if (this.rafId != null) return;
        const frame = () => {
            this.updateFreezeState();
            this.redraw();
            this.rafId = requestAnimationFrame(frame);
        };
        this.rafId = requestAnimationFrame(frame);
    }

    private stopLoop(): void {
        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private startCompressedClock(): void {
        if (this.activeClockWallStartMs != null) return;
        this.activeClockWallStartMs = Date.now();
    }

    private pauseCompressedClock(): void {
        if (this.activeClockWallStartMs == null) return;
        const elapsed = Math.max(0, Date.now() - this.activeClockWallStartMs);
        this.compressedOffsetMs += elapsed;
        this.activeClockWallStartMs = null;
    }

    private hasRunningCalls(): boolean {
        for (const event of this.events.values()) {
            if (event.status === 'running') return true;
        }
        return false;
    }

    private syncLoopState(): void {
        if (!this.container.classList.contains('visible')) {
            this.stopLoop();
            return;
        }
        if (this.hasRunningCalls()) {
            this.startCompressedClock();
            this.startLoop();
        } else {
            this.pauseCompressedClock();
            this.stopLoop();
        }
    }

    private updateFreezeState(): void {
        if (this.runStartMs == null || this.events.size === 0) {
            this.frozen = false;
            this.frozenOffset = 0;
            return;
        }
        const values = Array.from(this.events.values());
        const hasRunning = values.some(e => e.status === 'running');
        if (hasRunning) {
            this.frozen = false;
            this.frozenOffset = 0;
            return;
        }
        const maxEnded = values.reduce((acc, ev) => {
            const end = ev.endOffsetMs ?? ev.startOffsetMs;
            return Math.max(acc, end);
        }, 0);
        this.frozen = true;
        this.frozenOffset = Math.max(this.getNowOffset(), maxEnded);
    }

    private getNowOffset(): number {
        if (this.activeClockWallStartMs == null) {
            return Math.max(0, this.compressedOffsetMs);
        }
        return Math.max(0, this.compressedOffsetMs + (Date.now() - this.activeClockWallStartMs));
    }

    private redraw(): void {
        const isLight = isLightMode();

        if (this.runStartMs == null || this.events.size === 0) {
            this.resizeCanvas(Math.max(this.lastTotalUnits, this.visibleLaneCount));
            const { ctx } = this;
            ctx.clearRect(0, 0, this.canvasW, this.canvasH);
            this.statusEl.textContent = 'IDLE';
            this.statusEl.classList.remove('frozen');
            this.statusEl.classList.add('idle');
            ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
            ctx.font = '10px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Awaiting agent activity', this.canvasW / 2, this.canvasH / 2);
            return;
        }

        const nowOffset = this.getNowOffset();
        const laneTop = 2;
        const laneBottomPad = 2;

        const values = Array.from(this.events.values()).sort((a, b) => {
            if (a.startOffsetMs !== b.startOffsetMs) return a.startOffsetMs - b.startOffsetMs;
            return a.startedAt - b.startedAt;
        });
        const maxOffset = values.reduce((acc, ev) => {
            const start = Math.max(0, ev.startOffsetMs);
            const end = ev.endOffsetMs != null ? Math.max(start, ev.endOffsetMs) : Math.max(start, nowOffset);
            return Math.max(acc, end);
        }, nowOffset);
        const total = Math.max(5000, maxOffset + 600, nowOffset + 240);

        const laneSlots = {} as Record<PipelineLaneId, number>;
        const laneSlotEnds = {} as Record<PipelineLaneId, number[]>;
        for (const laneId of LANE_ORDER) {
            laneSlots[laneId] = 1;
            laneSlotEnds[laneId] = [];
        }

        const eventLayouts: RenderedEventLayout[] = [];
        for (const ev of values) {
            const start = Math.max(0, ev.startOffsetMs);
            const end = ev.endOffsetMs != null ? Math.max(start, ev.endOffsetMs) : Math.max(start + 1, nowOffset);
            const slotEnds = laneSlotEnds[ev.laneId];
            let slot = -1;
            for (let i = 0; i < slotEnds.length; i++) {
                if (start >= slotEnds[i]) {
                    slot = i;
                    break;
                }
            }
            if (slot < 0) slot = slotEnds.length;
            slotEnds[slot] = end;
            laneSlots[ev.laneId] = Math.max(laneSlots[ev.laneId], slot + 1);
            eventLayouts.push({ event: ev, slot });
        }

        const laneUnits = {} as Record<PipelineLaneId, number>;
        for (const laneId of LANE_ORDER) {
            laneUnits[laneId] = Math.max(1, Math.min(MAX_LANE_SLOTS, laneSlots[laneId]));
        }
        const laneRows = LANE_ORDER.length;
        this.lastTotalUnits = laneRows;
        this.resizeCanvas(laneRows);

        const canvasW = this.canvasW;
        const canvasH = this.canvasH;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, canvasW, canvasH);

        const trackLeft = 92;
        const trackRight = Math.max(trackLeft + 20, canvasW - 8);
        const trackW = trackRight - trackLeft;
        const availableLaneH = Math.max(8, canvasH - laneTop - laneBottomPad);
        const baseLaneH = availableLaneH / Math.max(1, laneRows);
        let laneCursorY = laneTop;
        const laneRects = {} as Record<PipelineLaneId, LaneRenderRect>;
        for (let i = 0; i < LANE_ORDER.length; i++) {
            const laneId = LANE_ORDER[i];
            const isLastLane = i === LANE_ORDER.length - 1;
            const laneH = isLastLane ? Math.max(8, laneTop + availableLaneH - laneCursorY) : baseLaneH;
            laneRects[laneId] = { y: laneCursorY, h: laneH, slots: laneUnits[laneId] };
            laneCursorY += laneH;
        }
        const lanesBottom = laneCursorY;
        this.ensureRunningLanesVisible(values, laneRects);

        // Lane backgrounds + labels.
        for (let i = 0; i < LANE_ORDER.length; i++) {
            const laneId = LANE_ORDER[i];
            const laneRect = laneRects[laneId];
            const y = laneRect.y;
            const h = laneRect.h;
            if (i % 2 === 0) {
                ctx.fillStyle = isLight ? 'rgba(100,116,139,0.05)' : 'rgba(148,163,184,0.05)';
                ctx.fillRect(0, y, canvasW, h);
            }
            ctx.strokeStyle = isLight ? 'rgba(80,110,150,0.12)' : 'rgba(148,163,184,0.14)';
            ctx.beginPath();
            ctx.moveTo(trackLeft, y + h - 0.5);
            ctx.lineTo(trackRight, y + h - 0.5);
            ctx.stroke();

            if (laneRect.slots > 1) {
                ctx.strokeStyle = isLight ? 'rgba(100,116,139,0.12)' : 'rgba(148,163,184,0.1)';
                for (let slot = 1; slot < laneRect.slots; slot++) {
                    const slotY = y + (h * slot) / laneRect.slots;
                    ctx.beginPath();
                    ctx.moveTo(trackLeft, slotY);
                    ctx.lineTo(trackRight, slotY);
                    ctx.stroke();
                }
            }

            ctx.fillStyle = isLight ? '#334155' : '#cbd5e1';
            ctx.font = '10px "IBM Plex Mono", monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(LANE_LABELS[laneId], 4, y + h / 2);
        }

        this.renderedBlocks = [];

        for (const layout of eventLayouts) {
            const ev = layout.event;
            const laneRect = laneRects[ev.laneId];
            if (!laneRect) continue;
            const slotCount = Math.max(1, laneRect.slots);
            const slotIndex = Math.min(layout.slot, slotCount - 1);
            const slotH = laneRect.h / slotCount;
            const slotY = laneRect.y + slotIndex * slotH;
            const barPad = slotCount <= 1 ? 2 : slotCount <= 3 ? 1 : 0.2;
            const barY = slotY + barPad;
            const minBarH = slotCount <= 1 ? 7 : slotCount <= 3 ? 4 : 1;
            const barH = Math.max(minBarH, slotH - barPad * 2);

            const start = Math.max(0, ev.startOffsetMs);
            const end = ev.endOffsetMs != null ? Math.max(start, ev.endOffsetMs) : Math.max(start, nowOffset);
            const x = trackLeft + (start / total) * trackW;
            const minRun = ev.status === 'running' ? 180 : 1;
            const endVisual = Math.max(end, start + minRun);
            const endX = trackLeft + (endVisual / total) * trackW;
            const w = Math.max(4, endX - x);

            // Queued marker.
            const qx = Math.max(trackLeft, x - 2);
            ctx.fillStyle = isLight ? 'rgba(100,116,139,0.55)' : 'rgba(148,163,184,0.55)';
            ctx.fillRect(qx, barY - 1, 1, barH + 2);

            const laneColor = isLight ? LANE_COLORS[ev.laneId].light : LANE_COLORS[ev.laneId].dark;
            const isHovered = this.hoverEventId === ev.id;
            const pulse = 0.58 + 0.28 * Math.sin(Date.now() / 320);

            if (ev.status === 'error') {
                ctx.fillStyle = isLight ? 'rgba(220, 38, 38, 0.82)' : 'rgba(239, 68, 68, 0.84)';
                ctx.globalAlpha = isHovered ? 1 : 0.94;
                ctx.fillRect(x, barY, w, barH);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = isLight ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.28)';
                ctx.lineWidth = 1;
                for (let hx = x - barH; hx < x + w; hx += 6) {
                    ctx.beginPath();
                    ctx.moveTo(hx, barY + barH);
                    ctx.lineTo(hx + barH, barY);
                    ctx.stroke();
                }
            } else if (ev.status === 'running') {
                ctx.fillStyle = laneColor;
                ctx.globalAlpha = isHovered ? 1 : pulse;
                ctx.fillRect(x, barY, w, barH);
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = laneColor;
                ctx.globalAlpha = isHovered ? 1 : 0.86;
                ctx.fillRect(x, barY, w, barH);
                ctx.globalAlpha = 1;
            }

            if (w >= 38 && barH >= 7) {
                ctx.fillStyle = isLight ? '#f8fafc' : '#0b1220';
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(ev.substep, x + 3, barY + barH / 2);
            }

            if ((ev.status === 'done' || ev.status === 'error') && w >= 58 && barH >= 7 && ev.durationMs != null) {
                const tag = formatDuration(ev.durationMs);
                ctx.fillStyle = isLight ? 'rgba(15,23,42,0.65)' : 'rgba(2,6,23,0.65)';
                ctx.font = '8px "IBM Plex Mono", monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(tag, x + w - 3, barY + barH / 2);
            }

            this.renderedBlocks.push({ event: ev, x, y: barY, w, h: barH });
        }

        // Live cursor.
        const nowX = trackLeft + (clamp(nowOffset, 0, total) / total) * trackW;
        ctx.fillStyle = isLight ? 'rgba(15,23,42,0.2)' : 'rgba(226,232,240,0.2)';
        ctx.fillRect(nowX, laneTop, 1, Math.max(0, lanesBottom - laneTop));
        ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('NOW', nowX, laneTop + 10);

        const hasRunning = values.some(v => v.status === 'running');
        this.statusEl.classList.remove('idle', 'frozen');
        if (hasRunning) {
            this.statusEl.textContent = 'LIVE';
        } else if (this.frozen) {
            this.statusEl.textContent = 'FROZEN';
            this.statusEl.classList.add('frozen');
        } else {
            this.statusEl.textContent = 'IDLE';
            this.statusEl.classList.add('idle');
        }
    }

    private showTooltip(event: PipelineEvent, x: number, y: number): void {
        const startOffset = Math.max(0, event.startOffsetMs);
        const nowOffset = this.getNowOffset();
        const liveDuration = event.status === 'running' ? Math.max(0, nowOffset - startOffset) : event.durationMs;

        const lines = [
            `<div class="pipeline-tooltip-title">${LANE_LABELS[event.laneId]} · ${event.substep}</div>`,
            `<div class="pipeline-tooltip-line">Model: ${event.provider} · ${event.model}</div>`,
            `<div class="pipeline-tooltip-line">Start: ${formatMsAsTimestamp(startOffset)}</div>`,
            `<div class="pipeline-tooltip-line">Duration: ${formatDuration(liveDuration)}</div>`,
            `<div class="pipeline-tooltip-line">Status: ${event.status.toUpperCase()}</div>`,
        ];
        if (event.error) {
            lines.push(`<div class="pipeline-tooltip-line error">Error: ${event.error}</div>`);
        }

        this.tooltipEl.innerHTML = lines.join('');
        this.tooltipEl.classList.remove('hidden');

        const canvasOriginX = this.scrollEl ? this.scrollEl.offsetLeft - this.scrollEl.scrollLeft : 0;
        const canvasOriginY = this.scrollEl ? this.scrollEl.offsetTop - this.scrollEl.scrollTop : 0;
        const pointerX = canvasOriginX + x;
        const pointerY = canvasOriginY + y;
        const containerW = this.container.clientWidth;
        const containerRect = this.container.getBoundingClientRect();
        const tooltipRect = this.tooltipEl.getBoundingClientRect();
        let left = pointerX + 14;
        const viewportPadding = 8;
        const minLeft = viewportPadding - containerRect.left;
        const maxLeft = window.innerWidth - containerRect.left - tooltipRect.width - viewportPadding;

        // Always bias upward from the hovered bar to avoid bottom-edge clipping.
        let top = pointerY - tooltipRect.height - 10;
        if (left + tooltipRect.width > containerW - 8) {
            left = Math.max(8, pointerX - tooltipRect.width - 12);
        }
        if (maxLeft >= minLeft) {
            left = Math.max(minLeft, Math.min(maxLeft, left));
        }

        const minTop = viewportPadding - containerRect.top;
        const maxTop = window.innerHeight - containerRect.top - tooltipRect.height - viewportPadding;
        if (maxTop >= minTop) {
            top = Math.max(minTop, Math.min(maxTop, top));
        } else {
            top = minTop;
        }

        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${top}px`;
    }

    private hideTooltip(): void {
        this.tooltipEl.classList.add('hidden');
    }

    private findEventAt(x: number, y: number): PipelineEvent | null {
        for (let i = this.renderedBlocks.length - 1; i >= 0; i--) {
            const b = this.renderedBlocks[i];
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                return b.event;
            }
        }
        return null;
    }

    private openModal(event: PipelineEvent): void {
        this.modalOpenEventId = event.id;
        this.renderModal(event);
        this.modalOverlay.classList.remove('hidden');
        document.body.classList.add('pipeline-llm-modal-open');
    }

    private closeModal(): void {
        this.modalOpenEventId = null;
        this.modalOverlay.classList.add('hidden');
        document.body.classList.remove('pipeline-llm-modal-open');
    }

    private renderModal(event: PipelineEvent): void {
        this.modalTitleEl.textContent = `${LANE_LABELS[event.laneId]} · ${event.substep}`;
        const nowOffset = this.getNowOffset();
        const elapsed = event.status === 'running' ? Math.max(0, nowOffset - event.startOffsetMs) : event.durationMs;
        this.modalMetaEl.textContent = `${event.provider} · ${event.model} · ${event.status.toUpperCase()} · start ${formatMsAsTimestamp(event.startOffsetMs)} · duration ${formatDuration(elapsed)}`;
        this.modalInputEl.innerHTML = renderPayloadWithReadability(event.inputText);
        this.modalOutputEl.innerHTML = renderPayloadWithReadability(event.outputText);
    }

    private createModal(): {
        overlay: HTMLDivElement;
        title: HTMLHeadingElement;
        meta: HTMLDivElement;
        input: HTMLPreElement;
        output: HTMLPreElement;
    } {
        const overlay = document.createElement('div');
        overlay.className = 'pipeline-llm-modal-overlay hidden';

        const card = document.createElement('div');
        card.className = 'pipeline-llm-modal';

        const header = document.createElement('div');
        header.className = 'pipeline-llm-modal-header';

        const title = document.createElement('h3');
        title.className = 'pipeline-llm-modal-title';
        title.textContent = 'LLM Call';
        header.appendChild(title);

        const close = document.createElement('button');
        close.className = 'pipeline-llm-modal-close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Close LLM payload window');
        close.textContent = '×';
        header.appendChild(close);

        const meta = document.createElement('div');
        meta.className = 'pipeline-llm-modal-meta';

        const body = document.createElement('div');
        body.className = 'pipeline-llm-modal-body';

        const inputPanel = document.createElement('section');
        inputPanel.className = 'pipeline-llm-modal-panel';
        const inputLabel = document.createElement('div');
        inputLabel.className = 'pipeline-llm-modal-panel-label';
        inputLabel.textContent = 'Input';
        const inputPre = document.createElement('pre');
        inputPre.className = 'pipeline-llm-modal-pre';
        inputPanel.appendChild(inputLabel);
        inputPanel.appendChild(inputPre);

        const outputPanel = document.createElement('section');
        outputPanel.className = 'pipeline-llm-modal-panel';
        const outputLabel = document.createElement('div');
        outputLabel.className = 'pipeline-llm-modal-panel-label';
        outputLabel.textContent = 'Output';
        const outputPre = document.createElement('pre');
        outputPre.className = 'pipeline-llm-modal-pre';
        outputPanel.appendChild(outputLabel);
        outputPanel.appendChild(outputPre);

        body.appendChild(inputPanel);
        body.appendChild(outputPanel);

        card.appendChild(header);
        card.appendChild(meta);
        card.appendChild(body);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        return {
            overlay,
            title,
            meta,
            input: inputPre,
            output: outputPre,
        };
    }
}
