// ============================================
// TIMELINE RIBBON UI
// ============================================
// Canvas-based bottom ribbon showing colored animation segments,
// phase markers, and the live playhead.

import { TimelineEngine, SEGMENT_COLORS, type AnimationSegment } from './timeline-engine';
import { settingsStore, STORAGE_KEYS } from './settings-store';
import { isLightMode, formatMsAsTimestamp } from './utils';

const RIBBON_HEIGHT = 64;
const TRACK_HEIGHT = 14;
const TRACK_PAD_TOP = 4;
const PLAYHEAD_W = 2;
const LABEL_FONT = '10px "IBM Plex Mono", monospace';

export class TimelineRibbon {
    private container: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private playBtn: HTMLButtonElement;
    private speedBtn: HTMLButtonElement;
    private timeDisplay: HTMLSpanElement;
    private toggleBtn: HTMLButtonElement;
    private collapsed: boolean = settingsStore.getBoolean(STORAGE_KEYS.ribbonCollapsed, false);

    private engine: TimelineEngine;
    private dpr = 1;
    private canvasW = 0;
    private canvasH = RIBBON_HEIGHT;

    private trackLeft = 0;
    private trackRight = 0;
    private trackW = 0;
    private trackY = TRACK_PAD_TOP;

    private hoveredSegment: AnimationSegment | null = null;
    private tooltipX = 0;
    private tooltipY = 0;
    private hoverPlayheadX = -1;
    private renderedBlocks: { seg: AnimationSegment; x: number; y: number; w: number; h: number }[] = [];
    private liveHorizonTime = 0;

    private unsubscribe: (() => void) | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(engine: TimelineEngine) {
        this.engine = engine;

        this.container = document.getElementById('timeline-ribbon') as HTMLDivElement;
        if (!this.container) throw new Error('Missing #timeline-ribbon');

        this.playBtn = this.container.querySelector('#ribbon-play-pause') as HTMLButtonElement;
        this.speedBtn = this.container.querySelector('#ribbon-speed') as HTMLButtonElement;
        this.timeDisplay = this.container.querySelector('#ribbon-time') as HTMLSpanElement;
        this.toggleBtn = this.container.querySelector('#ribbon-toggle') as HTMLButtonElement;
        this.canvas = this.container.querySelector('#ribbon-canvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;

        this.setupCanvas();
        this.bindEvents();
        this.refreshControls();

        this.unsubscribe = engine.on((event, data) => {
            switch (event) {
                case 'time-update':
                    this.onTimeUpdate(data.time, data.total);
                    break;
                case 'seek':
                    this.onTimeUpdate(data.time, this.getEffectiveTotal());
                    break;
                case 'segment-change':
                case 'duration-resolved':
                    this.updateTimeDisplay(engine.getCurrentTime(), this.getEffectiveTotal());
                    this.redraw();
                    break;
                case 'play-state':
                    this.updatePlayButton();
                    if (data?.rate !== undefined) this.updateSpeedButton();
                    break;
                case 'gate-hit':
                    this.updatePlayButton();
                    break;
            }
        });
    }

    show(): void {
        this.container.classList.add('visible');
        this.refreshControls();

        if (this.collapsed) {
            this.container.classList.add('collapsed');
            document.body.classList.add('timeline-collapsed');
            this.toggleBtn.setAttribute('aria-label', 'Show timeline');
        } else {
            document.body.classList.add('timeline-active');
        }

        setTimeout(() => this.setupCanvas(), 350);
    }

    hide(): void {
        this.container.classList.remove('visible');
        document.body.classList.remove('timeline-active');
        document.body.classList.remove('timeline-collapsed');
    }

    toggleCollapse(): void {
        this.collapsed = !this.collapsed;
        this.container.classList.toggle('collapsed', this.collapsed);
        document.body.classList.toggle('timeline-collapsed', this.collapsed);
        settingsStore.setString(STORAGE_KEYS.ribbonCollapsed, String(this.collapsed));

        if (this.collapsed) {
            document.body.classList.remove('timeline-active');
        } else {
            document.body.classList.add('timeline-active');
            setTimeout(() => this.setupCanvas(), 350);
        }

        this.toggleBtn.setAttribute('aria-label', this.collapsed ? 'Show timeline' : 'Hide timeline');
    }

    destroy(): void {
        this.unbindEvents();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.hide();
    }

    private setupCanvas(): void {
        this.dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvasW = rect.width;
        this.canvasH = rect.height || RIBBON_HEIGHT;
        this.canvas.width = this.canvasW * this.dpr;
        this.canvas.height = this.canvasH * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        this.trackLeft = 8;
        this.trackRight = this.canvasW - 8;
        this.trackW = this.trackRight - this.trackLeft;
        this.trackY = Math.max(TRACK_PAD_TOP, this.canvasH - TRACK_HEIGHT - 2);

        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => this.setupCanvas());
            this.resizeObserver.observe(this.canvas);
        }

        this.redraw();
    }

    private bindEvents(): void {
        this.playBtn.addEventListener('click', this.onPlayClick);
        this.speedBtn.addEventListener('click', this.onSpeedClick);
        this.toggleBtn.addEventListener('click', this.onToggleClick);
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    }

    private unbindEvents(): void {
        this.playBtn.removeEventListener('click', this.onPlayClick);
        this.speedBtn.removeEventListener('click', this.onSpeedClick);
        this.toggleBtn.removeEventListener('click', this.onToggleClick);
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    }

    private onPlayClick = (e: MouseEvent): void => {
        e.preventDefault();
    };

    private onSpeedClick = (e: MouseEvent): void => {
        e.preventDefault();
    };

    private onToggleClick = (): void => {
        this.toggleCollapse();
    };

    private onMouseMove = (e: MouseEvent): void => {
        const x = e.offsetX;
        const y = e.offsetY;

        if (y >= 0 && y <= this.canvasH) {
            this.hoverPlayheadX = x;
            this.updateHover(x, y);
        } else {
            const hadHover = this.hoveredSegment !== null || this.hoverPlayheadX >= 0;
            this.hoveredSegment = null;
            this.hoverPlayheadX = -1;
            if (hadHover) this.redraw();
        }
    };

    private onMouseLeave = (): void => {
        const hadHover = this.hoveredSegment !== null || this.hoverPlayheadX >= 0;
        this.hoveredSegment = null;
        this.hoverPlayheadX = -1;
        if (hadHover) this.redraw();
    };

    private updateHover(canvasX: number, canvasY: number): void {
        const total = this.getEffectiveTotal();
        if (total <= 0) return;

        let found: AnimationSegment | null = null;
        for (let i = this.renderedBlocks.length - 1; i >= 0; i--) {
            const block = this.renderedBlocks[i];
            const padX = block.seg.duration === 0 ? 4 : 0;
            if (
                canvasX >= block.x - padX &&
                canvasX <= block.x + block.w + padX &&
                canvasY >= block.y &&
                canvasY <= block.y + block.h
            ) {
                found = block.seg;
                break;
            }
        }

        if (found !== this.hoveredSegment) {
            this.hoveredSegment = found;
            this.tooltipX = canvasX;
            this.tooltipY = found ? canvasY : this.trackY - 4;
        }

        this.redraw();
    }

    private getEffectiveTotal(): number {
        if (!this.engine.isRecordOnly()) {
            return this.engine.getTotalDuration();
        }
        return Math.max(3000, this.getLiveHorizonTime());
    }

    private liveSegDuration(seg: AnimationSegment): number {
        return Math.max(0, this.getLiveHorizonTime() - seg.startTime);
    }

    private onTimeUpdate(time: number, _total: number): void {
        this.liveHorizonTime = Math.max(this.liveHorizonTime, time);
        const effectiveTotal = this.getEffectiveTotal();
        this.updateTimeDisplay(time, effectiveTotal);
        this.redraw();
    }

    private updateTimeDisplay(time: number, total: number): void {
        this.timeDisplay.textContent = `${formatMsAsTimestamp(time)} / ${formatMsAsTimestamp(total)}`;
    }

    private updatePlayButton(): void {
        const playing = this.engine.isPlaying();
        this.playBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
        this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    private updateSpeedButton(): void {
        const rate = this.engine.getPlaybackRate();
        this.speedBtn.textContent = rate === 1 ? '1x' : `${rate}x`;
    }

    redraw(): void {
        this.refreshControls();

        const { ctx, canvasW, canvasH } = this;
        const isLight = isLightMode();

        ctx.clearRect(0, 0, canvasW, canvasH);

        const total = this.getEffectiveTotal();
        const isLive = this.engine.isRecordOnly();
        const currentTime = this.engine.getCurrentTime();
        const liveRenderTime = isLive ? this.getLiveHorizonTime() : currentTime;

        if (total <= 0) {
            ctx.fillStyle = isLight ? '#94a3b8' : '#475569';
            ctx.font = LABEL_FONT;
            ctx.textAlign = 'center';
            ctx.fillText('No animation data', canvasW / 2, canvasH / 2 + 3);
            return;
        }

        const ROW_STEP = 16;
        const segmentInfo: {
            seg: AnimationSegment;
            w: number;
            x: number;
            endX: number;
            duration: number;
            row: number;
        }[] = [];
        const rows: { startX: number; endX: number }[][] = [[], [], []];

        this.renderedBlocks = [];

        for (const seg of this.engine.getSegments()) {
            if (isLive && seg.startTime > liveRenderTime) continue;

            const isInfinity = seg.duration === Infinity;
            if (isInfinity && !isLive) continue;

            let segDuration: number;
            if (isInfinity) {
                segDuration = this.liveSegDuration(seg);
                if (segDuration <= 0) continue;
            } else if (isLive) {
                const elapsed = liveRenderTime - seg.startTime;
                if (elapsed <= 0 && seg.duration > 0) continue;
                segDuration = Math.min(Math.max(0, elapsed), seg.duration);
            } else {
                segDuration = seg.duration;
            }

            const x = this.timeToX(seg.startTime, total);
            const endX = segDuration === 0 ? x + 2 : this.timeToX(seg.startTime + segDuration, total);
            const w = Math.max(1, endX - x);

            let r = 0;
            const padX = seg.duration === 0 ? 0 : 4;
            while (
                rows[r] &&
                rows[r].some(rSeg => Math.max(x - padX, rSeg.startX) < Math.min(endX + padX, rSeg.endX))
            ) {
                r++;
            }
            if (!rows[r]) rows[r] = [];
            rows[r].push({ startX: x - padX, endX: endX + padX });

            segmentInfo.push({ seg, w, x, endX, duration: segDuration, row: r });
        }

        for (const info of segmentInfo) {
            const { seg, w, x } = info;
            const isInfinity = seg.duration === Infinity;
            const colors = SEGMENT_COLORS[seg.category];
            const color = isLight ? colors.light : colors.dark;
            const y = this.trackY - info.row * ROW_STEP;

            this.renderedBlocks.push({ seg, x, y, w, h: TRACK_HEIGHT });

            if (seg.category === 'gate') {
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.6;
                ctx.fillRect(x, y - 2, 2, TRACK_HEIGHT + 4);
                ctx.globalAlpha = 1;
            } else {
                const isHovered = seg === this.hoveredSegment;
                ctx.fillStyle = color;
                if (isInfinity) {
                    const pulse = 0.55 + 0.15 * Math.sin(Date.now() / 400);
                    ctx.globalAlpha = isHovered ? 1.0 : pulse;
                } else {
                    ctx.globalAlpha = isHovered ? 1.0 : 0.7;
                }

                ctx.beginPath();
                ctx.roundRect(x, y, w, TRACK_HEIGHT, 2);
                ctx.fill();
                ctx.globalAlpha = 1;

                if (w > 30) {
                    ctx.fillStyle = isLight ? '#fff' : '#0a0e15';
                    ctx.font = LABEL_FONT;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x + 2, y, w - 4, TRACK_HEIGHT);
                    ctx.clip();
                    ctx.fillText(seg.label, x + w / 2, y + TRACK_HEIGHT / 2);
                    ctx.restore();
                }
            }
        }

        const boundaries = this.engine.getPhaseBoundaries();
        for (const bound of boundaries) {
            const x = this.timeToX(bound.startTime, total);
            ctx.strokeStyle = isLight ? 'rgba(30,50,80,0.5)' : 'rgba(200,220,255,0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 8);
            ctx.lineTo(x, canvasH - 6);
            ctx.stroke();

            ctx.fillStyle = isLight ? 'rgba(30,50,80,0.8)' : 'rgba(200,220,255,0.7)';
            ctx.beginPath();
            ctx.roundRect(x + 2, 8, 18, 14, 2);
            ctx.fill();

            ctx.fillStyle = isLight ? '#fff' : '#0a0e15';
            ctx.font = LABEL_FONT;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`P${bound.phaseIdx}`, x + 4, 15);
        }

        if (this.hoverPlayheadX >= this.trackLeft && this.hoverPlayheadX <= this.trackRight) {
            const hx = this.hoverPlayheadX;
            ctx.fillStyle = isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.25)';
            ctx.fillRect(hx, 8, 1, canvasH - 14);

            const hoverTime = ((hx - this.trackLeft) / this.trackW) * total;
            ctx.fillStyle = isLight ? 'rgba(30,50,80,0.7)' : 'rgba(200,220,255,0.7)';
            ctx.font = LABEL_FONT;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(formatMsAsTimestamp(hoverTime), hx, 8);
        }

        const playheadX = this.timeToX(currentTime, total);

        ctx.fillStyle = isLight ? 'rgba(217, 119, 6, 0.15)' : 'rgba(245, 200, 80, 0.12)';
        ctx.fillRect(playheadX - 6, 8, 12, canvasH - 14);

        ctx.fillStyle = isLight ? '#d97706' : '#f5c850';
        ctx.fillRect(playheadX - 1, 8, PLAYHEAD_W, canvasH - 14);

        ctx.beginPath();
        ctx.moveTo(playheadX - 5, 8);
        ctx.lineTo(playheadX + 5, 8);
        ctx.lineTo(playheadX, 13);
        ctx.closePath();
        ctx.fill();

        if (this.hoveredSegment) {
            this.drawTooltip(this.hoveredSegment, this.tooltipX, isLight);
        }
    }

    private getLiveHorizonTime(): number {
        return Math.max(this.liveHorizonTime, this.engine.getCurrentTime());
    }

    private drawTooltip(seg: AnimationSegment, x: number, isLight: boolean): void {
        const { ctx, canvasW } = this;
        const displayDur = seg.duration === Infinity ? this.liveSegDuration(seg) : seg.duration;
        const text = `${seg.label}  (${formatMsAsTimestamp(displayDur)})`;
        ctx.font = LABEL_FONT;
        const metrics = ctx.measureText(text);
        const padH = 6;
        const padV = 4;
        const tw = metrics.width + padH * 2;
        const th = 16 + padV;
        const tx = Math.max(4, Math.min(canvasW - tw - 4, x - tw / 2));
        const ty = Math.max(1, this.tooltipY - th - 6);

        ctx.fillStyle = isLight ? 'rgba(255,255,255,0.92)' : 'rgba(15,20,30,0.92)';
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, th, 3);
        ctx.fill();

        ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isLight ? '#1a2333' : '#eef4ff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + padH, ty + th / 2);
    }

    private timeToX(time: number, total: number): number {
        return this.trackLeft + (time / total) * this.trackW;
    }

    private refreshControls(): void {
        this.playBtn.disabled = true;
        this.speedBtn.disabled = true;
        this.playBtn.title = 'Replay disabled';
        this.speedBtn.title = 'Replay disabled';
        this.canvas.style.opacity = '1';
        this.canvas.style.cursor = 'default';
    }
}

// Time formatting moved to utils.ts — use formatMsAsTimestamp

const PLAY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
const PAUSE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
