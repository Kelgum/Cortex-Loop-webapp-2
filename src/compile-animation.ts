/**
 * compile-animation — VCR-centered "Stream" handoff sequence.
 *
 * Flow:
 * 1. Snapshot substance strip pills, create fixed-position HTML mirrors.
 * 2. Slide mirrors to center of the strip (horizontally, keeping lane Y).
 * 3. Drain pills one-by-one from bottom lane upward into the VCR button.
 * 4. Fade page, move VCR + cartridge to center, reveal delivery timer.
 */
import { COMPILE_ZONE, SVG_NS } from './constants';
import { getHtmlEl } from './dom';
import { buildCartridgeSlots, buildDosePlayerSvg, fillSlot, startAmbientPulse } from './dose-player';
import { CompileState } from './state';
import { easeInOutCubic, easeOutCubic, easeOutBack } from './timeline-engine';
import { TrackerClient, createFrameCapture, type TrackedObject } from './tracker-client';
import { svgEl } from './utils';

const PAGE_FADE_IDS = [
    'prompt-section',
    'top-controls',
    'top-controls-right',
    'agent-match-panel',
    'multi-day-ribbon',
    'phase-chart-container',
    'timeline-ribbon',
    'pipeline-timeline',
] as const;

const STAGE_GAP = 8;

/* ── Interfaces ─────────────────────────────────────────────── */

interface PillSnapshot {
    key: string;
    color: string;
    dose: string;
    label: string;
    laneIdx: number;
    x: number;
    y: number;
    w: number;
    h: number;
}

interface PillMirror {
    snap: PillSnapshot;
    el: HTMLDivElement;
    x: number;
    y: number;
}

interface LaneQueue {
    laneIdx: number;
    y: number;
    mirrors: PillMirror[];
}

interface VisibilitySnapshot {
    opacity: string;
    visibility: string;
    pointerEvents: string;
}

/* ── Low-level helpers ──────────────────────────────────────── */

function animate(runId: number, duration: number, tick: (t: number) => void): Promise<void> {
    return new Promise(resolve => {
        const start = performance.now();
        const loop = (now: number) => {
            if (CompileState.runId !== runId) {
                resolve();
                return;
            }
            const raw = Math.min(1, (now - start) / duration);
            tick(raw);
            if (raw < 1) requestAnimationFrame(loop);
            else resolve();
        };
        requestAnimationFrame(loop);
    });
}

function wait(runId: number, ms: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        window.setTimeout(() => resolve(CompileState.runId === runId), ms);
    });
}

function placeMirror(m: PillMirror): void {
    m.el.style.left = `${m.x.toFixed(1)}px`;
    m.el.style.top = `${m.y.toFixed(1)}px`;
}

function captureVisibility(el: HTMLElement | SVGElement): VisibilitySnapshot {
    return {
        opacity: el.style.opacity,
        visibility: el.style.visibility,
        pointerEvents: el.style.pointerEvents,
    };
}

function hideElement(el: HTMLElement | SVGElement): void {
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
}

function restoreVisibility(el: HTMLElement | SVGElement, snapshot: VisibilitySnapshot): void {
    el.style.opacity = snapshot.opacity;
    el.style.visibility = snapshot.visibility;
    el.style.pointerEvents = snapshot.pointerEvents;
}

/* ── Snapshot pills from SVG ────────────────────────────────── */

function snapshotPills(svg: SVGSVGElement): PillSnapshot[] {
    const groups = Array.from(svg.querySelectorAll('.timeline-pill-group')) as SVGGElement[];
    // Force-reveal so getBoundingClientRect returns real dimensions
    const saved = groups.map(g => g.getAttribute('opacity'));
    groups.forEach(g => g.setAttribute('opacity', '1'));

    const LANE_TOL = 8;
    const laneTops: number[] = [];

    const findOrAddLane = (top: number): number => {
        const idx = laneTops.findIndex(v => Math.abs(v - top) < LANE_TOL);
        if (idx >= 0) return idx;
        laneTops.push(top);
        laneTops.sort((a, b) => a - b);
        return laneTops.findIndex(v => Math.abs(v - top) < LANE_TOL);
    };

    const pills: PillSnapshot[] = [];
    for (const g of groups) {
        const bar =
            (g.querySelector('.timeline-bar') as SVGRectElement | null) ??
            (g.querySelector('rect') as SVGRectElement | null);
        if (!bar) continue;
        const r = bar.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const label =
            (
                (g.querySelector('.timeline-bar-label') as SVGTextElement | null) ??
                (g.querySelector('text') as SVGTextElement | null)
            )?.textContent?.trim() || '';
        pills.push({
            key: g.getAttribute('data-substance-key') || label || 'substance',
            color: bar.getAttribute('stroke') || bar.getAttribute('fill') || '#94a3b8',
            dose: label.match(/\d+\s*m?g/i)?.[0] || '',
            label: label || g.getAttribute('data-substance-key') || 'Substance',
            laneIdx: findOrAddLane(r.top),
            x: r.left,
            y: r.top,
            w: r.width,
            h: r.height,
        });
    }

    // Restore
    groups.forEach((g, i) => {
        if (saved[i] !== null) g.setAttribute('opacity', saved[i]!);
        else g.removeAttribute('opacity');
    });

    return pills.sort((a, b) => (a.laneIdx === b.laneIdx ? a.x - b.x : a.laneIdx - b.laneIdx));
}

/* ── Create fixed-position HTML mirror ──────────────────────── */

function createMirror(snap: PillSnapshot, overlay: HTMLElement): PillMirror {
    const el = document.createElement('div');
    el.className = 'compile-pill-mirror';
    el.style.setProperty('--compile-pill-color', snap.color);
    el.style.width = `${snap.w.toFixed(1)}px`;
    el.style.height = `${snap.h.toFixed(1)}px`;
    el.innerHTML = `<span class="compile-pill-label">${snap.label}</span>`;
    overlay.appendChild(el);

    const m: PillMirror = { snap, el, x: snap.x, y: snap.y };
    placeMirror(m);
    return m;
}

/* ── Lane helpers ───────────────────────────────────────────── */

function buildLanes(mirrors: PillMirror[]): LaneQueue[] {
    const byLane = new Map<number, LaneQueue>();
    for (const m of mirrors) {
        const li = m.snap.laneIdx;
        const existing = byLane.get(li);
        if (existing) {
            existing.mirrors.push(m);
            existing.y = Math.min(existing.y, m.y);
        } else {
            byLane.set(li, { laneIdx: li, y: m.y, mirrors: [m] });
        }
    }
    return [...byLane.values()]
        .map(l => ({ ...l, mirrors: l.mirrors.sort((a, b) => a.x - b.x) }))
        .sort((a, b) => a.laneIdx - b.laneIdx);
}

/**
 * Compute per-lane queue positions with a single staging slot at `centerX`.
 * The first pill in the lane owns the center slot; later pills line up behind it.
 */
export function computeLaneQueuePositions(
    widths: readonly number[],
    centerX: number,
    gap: number = STAGE_GAP,
): number[] {
    if (widths.length === 0) return [];

    const positions: number[] = [centerX - widths[0] / 2];
    let queueEdge = positions[0] - gap;
    for (let idx = 1; idx < widths.length; idx += 1) {
        const width = widths[idx];
        const left = queueEdge - width;
        positions.push(left);
        queueEdge = left - gap;
    }
    return positions;
}

function computeLaneQueueTargets(lane: LaneQueue, centerX: number): Map<PillMirror, number> {
    const positions = computeLaneQueuePositions(
        lane.mirrors.map(m => m.snap.w),
        centerX,
    );
    const targets = new Map<PillMirror, number>();
    lane.mirrors.forEach((m, idx) => {
        targets.set(m, positions[idx] ?? m.x);
    });
    return targets;
}

/* ── VCR clone ──────────────────────────────────────────────── */

interface VcrClone {
    panel: HTMLElement;
    button: HTMLElement;
    cx: number;
    cy: number;
}

function parsePxVar(style: CSSStyleDeclaration, name: string, fallback = 0): number {
    const v = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
}

function createVcrClone(panel: HTMLElement, overlay: HTMLElement): VcrClone | null {
    const playBtn = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    if (!playBtn) return null;

    const panelRect = panel.getBoundingClientRect();
    const playRect = playBtn.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const pillW = Math.max(parsePxVar(cs, '--pill-w', playRect.width + 72), playRect.width + 72);
    const pillOff = parsePxVar(cs, '--pill-offset', 0);
    const lwW = parsePxVar(cs, '--vcr-left-wing-w', 0);
    const rwW = parsePxVar(cs, '--vcr-right-wing-w', 0);
    const lt = (panel.querySelector('.vcr-step-left')?.textContent || '').trim();
    const rt = (panel.querySelector('.vcr-step-right')?.textContent || 'STREAM').trim();

    const clone = document.createElement('div');
    clone.className = 'vcr-control-panel visible compile-vcr-clone';
    clone.style.setProperty('--pill-w', `${pillW}px`);
    clone.style.setProperty('--pill-offset', `${pillOff}px`);
    clone.style.setProperty('--vcr-left-wing-w', `${lwW}px`);
    clone.style.setProperty('--vcr-right-wing-w', `${rwW}px`);
    clone.style.left = `${playRect.left - pillW / 2}px`;
    clone.style.top = `${panelRect.top}px`;
    clone.style.width = `${pillW}px`;
    clone.style.height = `${panelRect.height}px`;
    clone.innerHTML = `
        <div class="vcr-wing vcr-wing-left">
            <span class="vcr-step-label vcr-step-left${lt ? ' vcr-label-visible' : ''}">${lt}</span>
        </div>
        <button class="vcr-btn vcr-play intervention-play-btn vcr-play-stream" type="button" tabindex="-1" disabled>
            <span class="vcr-play-copy">Lx</span>
        </button>
        <div class="vcr-wing vcr-wing-right">
            <span class="vcr-step-label vcr-step-right vcr-label-visible">${rt || 'STREAM'}</span>
        </div>
    `;
    overlay.appendChild(clone);

    const cloneBtn = clone.querySelector('.intervention-play-btn') as HTMLElement | null;
    if (!cloneBtn) {
        clone.remove();
        return null;
    }
    const br = cloneBtn.getBoundingClientRect();
    return { panel: clone, button: cloneBtn, cx: br.left + br.width / 2, cy: br.top + br.height / 2 };
}

/* ── Page fade ──────────────────────────────────────────────── */

function applyPageFade(opacity: number): void {
    for (const id of PAGE_FADE_IDS) {
        const el = getHtmlEl(id);
        if (!el) continue;
        el.style.transition = 'opacity 0.55s ease';
        el.style.opacity = `${opacity}`;
    }
}

/* ── Overlay SVG setup ──────────────────────────────────────── */

function setupOverlay(overlay: HTMLElement): SVGSVGElement {
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
    overlay.querySelector('#compile-svg')?.remove();

    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('id', 'compile-svg');
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;pointer-events:none';
    overlay.insertBefore(svg, overlay.firstChild);
    return svg;
}

/* ── Delivery timer ─────────────────────────────────────────── */

async function revealDeliveryTimer(runId: number, overlay: HTMLElement, top: number): Promise<void> {
    const delivery = overlay.querySelector('.compile-delivery') as HTMLElement | null;
    if (!delivery) return;
    delivery.style.top = `${Math.round(top)}px`;
    delivery.classList.add('visible');

    if (!(await wait(runId, 500))) return;

    const tagline = overlay.querySelector('.compile-tagline') as HTMLElement | null;
    tagline?.classList.add('visible');

    if (CompileState.countdownTimer !== null) {
        clearInterval(CompileState.countdownTimer);
        CompileState.countdownTimer = null;
    }

    const etaText = overlay.querySelector('.compile-eta-text');
    const barFill = overlay.querySelector('.compile-delivery-bar-fill') as HTMLElement | null;
    if (!etaText || !barFill) return;

    let minutes = 30;
    barFill.style.width = '0%';
    CompileState.countdownTimer = window.setInterval(() => {
        minutes = Math.max(0, minutes - 1);
        const strong = etaText.querySelector('strong');
        if (strong) strong.textContent = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        barFill.style.width = `${((30 - minutes) / 30) * 100}%`;
        if (minutes <= 0 && CompileState.countdownTimer !== null) {
            clearInterval(CompileState.countdownTimer);
            CompileState.countdownTimer = null;
            if (strong) strong.textContent = 'Delivered';
        }
    }, 2000);
}

/* ── Cartridge spin ─────────────────────────────────────────── */

function startCartridgeSpin(cartridge: SVGGElement): () => void {
    let rafId = 0;
    const tick = (now: number) => {
        cartridge.setAttribute('transform', `rotate(${((now / 60) % 360).toFixed(2)})`);
        rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
}

/* ── Camera feed ───────────────────────────────────────────── */

async function acquireCameraFeed(overlay: HTMLElement): Promise<{ video: HTMLVideoElement; stream: MediaStream }> {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.createElement('video');
    video.id = 'compile-camera-feed';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    overlay.insertBefore(video, overlay.firstChild);
    return { video, stream };
}

function destroyCameraFeed(overlay: HTMLElement): void {
    const vid = overlay.querySelector('#compile-camera-feed') as HTMLVideoElement | null;
    if (!vid) return;
    const src = vid.srcObject as MediaStream | null;
    src?.getTracks().forEach(t => t.stop());
    vid.remove();
}

/* ── Camera toggle button (5-click, cycles) ──────────────── */

type CameraToggleState = 0 | 1 | 2 | 3 | 4 | 5;

interface SubstanceInfo {
    name: string;
    color: string;
    dose: string;
}

interface CameraToggleContext {
    btn: HTMLButtonElement;
    state: CameraToggleState;
    video: HTMLVideoElement | null;
    stream: MediaStream | null;
    backdrop: HTMLElement;
    overlaySvg: SVGSVGElement;
    vcrClone: HTMLElement;
    delivery: HTMLElement | null;
    substances: SubstanceInfo[];
    centerX: number;
    centerY: number;
    spokesContainer: SVGGElement | null;
    // Tracker integration
    tracker: TrackerClient | null;
    trackerRafId: number;
    trackerOverlaySvg: SVGSVGElement | null;
}

const TOGGLE_LABELS: Record<CameraToggleState, string> = {
    0: '◐',
    1: '◑',
    2: '✕',
    3: '✕',
    4: '⌘',
    5: '↺',
};

const TOGGLE_TITLES: Record<CameraToggleState, string> = {
    0: 'Show camera (dimmed)',
    1: 'Show camera (full)',
    2: 'Dismiss device',
    3: 'Dismiss timer',
    4: 'Show substances',
    5: 'Reset',
};

/* ── Tracker overlay rendering ────────────────────────────── */

const TRACKER_CAPTURE_W = 640;
const TRACKER_CAPTURE_H = 480;
const TRACKER_SEND_INTERVAL = 50; // ms (~20fps)
const COLOR_DISPENSER = '#39FF14';
const COLOR_WATCH = '#FF6B00';

function createTrackerOverlaySvg(overlay: HTMLElement): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('id', 'compile-tracker-overlay');
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;pointer-events:none;z-index:6';
    overlay.appendChild(svg);
    return svg;
}

function renderTrackerObjects(svg: SVGSVGElement, objects: TrackedObject[], video: HTMLVideoElement): void {
    svg.innerHTML = '';

    // Scale from tracker coords (640×480) to video element display size
    const scaleX = video.clientWidth / TRACKER_CAPTURE_W;
    const scaleY = video.clientHeight / TRACKER_CAPTURE_H;

    // Video element offset within the overlay
    const videoRect = video.getBoundingClientRect();
    const parentRect = (svg.parentElement as HTMLElement).getBoundingClientRect();
    const offX = videoRect.left - parentRect.left;
    const offY = videoRect.top - parentRect.top;

    let dispenserCenter: { x: number; y: number } | null = null;
    let watchCenter: { x: number; y: number } | null = null;

    for (const obj of objects) {
        if (obj.mode !== 'tracking') continue;

        if (obj.type === 'quad' && obj.corners && obj.name === 'dispenser') {
            // Draw perspective quad for dispenser
            const scaled = obj.corners.map(([x, y]) => [offX + x * scaleX, offY + y * scaleY]);
            const points = scaled.map(([x, y]) => `${x},${y}`).join(' ');

            // Semi-transparent fill
            const poly = document.createElementNS(SVG_NS, 'polygon');
            poly.setAttribute('points', points);
            poly.setAttribute('fill', `${COLOR_DISPENSER}30`);
            poly.setAttribute('stroke', COLOR_DISPENSER);
            poly.setAttribute('stroke-width', '2');
            poly.setAttribute('class', 'tracker-dispenser-quad');
            svg.appendChild(poly);

            // Glow border
            const polyGlow = document.createElementNS(SVG_NS, 'polygon');
            polyGlow.setAttribute('points', points);
            polyGlow.setAttribute('fill', 'none');
            polyGlow.setAttribute('stroke', COLOR_DISPENSER);
            polyGlow.setAttribute('stroke-width', '4');
            polyGlow.setAttribute('filter', 'url(#tracker-glow-green)');
            svg.appendChild(polyGlow);

            // Corner dots
            for (const [cx, cy] of scaled) {
                const dot = document.createElementNS(SVG_NS, 'circle');
                dot.setAttribute('cx', String(cx));
                dot.setAttribute('cy', String(cy));
                dot.setAttribute('r', '4');
                dot.setAttribute('fill', COLOR_DISPENSER);
                svg.appendChild(dot);
            }

            dispenserCenter = {
                x: scaled.reduce((s, p) => s + p[0], 0) / 4,
                y: scaled.reduce((s, p) => s + p[1], 0) / 4,
            };
        } else if (obj.type === 'bbox' && obj.x != null && obj.y != null && obj.w != null && obj.h != null) {
            const bx = offX + obj.x * scaleX;
            const by = offY + obj.y * scaleY;
            const bw = obj.w * scaleX;
            const bh = obj.h * scaleY;
            const color = obj.name === 'watch' ? COLOR_WATCH : COLOR_DISPENSER;

            // Bounding box
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(bx));
            rect.setAttribute('y', String(by));
            rect.setAttribute('width', String(bw));
            rect.setAttribute('height', String(bh));
            rect.setAttribute('fill', 'none');
            rect.setAttribute('stroke', color);
            rect.setAttribute('stroke-width', '2');
            rect.setAttribute('class', `tracker-${obj.name}-bbox`);
            svg.appendChild(rect);

            // Glow border
            const rectGlow = document.createElementNS(SVG_NS, 'rect');
            rectGlow.setAttribute('x', String(bx));
            rectGlow.setAttribute('y', String(by));
            rectGlow.setAttribute('width', String(bw));
            rectGlow.setAttribute('height', String(bh));
            rectGlow.setAttribute('fill', 'none');
            rectGlow.setAttribute('stroke', color);
            rectGlow.setAttribute('stroke-width', '4');
            rectGlow.setAttribute(
                'filter',
                obj.name === 'watch' ? 'url(#tracker-glow-orange)' : 'url(#tracker-glow-green)',
            );
            svg.appendChild(rectGlow);

            // Label
            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('x', String(bx + 4));
            label.setAttribute('y', String(by - 6));
            label.setAttribute('fill', color);
            label.setAttribute('font-size', '12');
            label.setAttribute('font-family', 'monospace');
            label.setAttribute('class', 'tracker-label');
            label.textContent = obj.name;
            svg.appendChild(label);

            if (obj.name === 'watch') {
                watchCenter = { x: bx + bw / 2, y: by + bh / 2 };
            }
            if (obj.name === 'dispenser' && !dispenserCenter) {
                dispenserCenter = { x: bx + bw / 2, y: by + bh / 2 };
            }
        }
    }

    // Connector line between dispenser and watch
    if (dispenserCenter && watchCenter) {
        // Curved path with gradient
        const midX = (dispenserCenter.x + watchCenter.x) / 2;
        const midY = (dispenserCenter.y + watchCenter.y) / 2 - 30; // slight arc
        const d = `M${dispenserCenter.x},${dispenserCenter.y} Q${midX},${midY} ${watchCenter.x},${watchCenter.y}`;

        // Glow layer
        const pathGlow = document.createElementNS(SVG_NS, 'path');
        pathGlow.setAttribute('d', d);
        pathGlow.setAttribute('fill', 'none');
        pathGlow.setAttribute('stroke', 'url(#tracker-connector-gradient)');
        pathGlow.setAttribute('stroke-width', '4');
        pathGlow.setAttribute('opacity', '0.4');
        pathGlow.setAttribute('filter', 'url(#tracker-glow-green)');
        svg.appendChild(pathGlow);

        // Crisp animated dash layer
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'url(#tracker-connector-gradient)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '8 4');
        path.setAttribute('class', 'tracker-connector');
        svg.appendChild(path);

        // Endpoint dots
        for (const pt of [dispenserCenter, watchCenter]) {
            const dot = document.createElementNS(SVG_NS, 'circle');
            dot.setAttribute('cx', String(pt.x));
            dot.setAttribute('cy', String(pt.y));
            dot.setAttribute('r', '5');
            dot.setAttribute('fill', pt === dispenserCenter ? COLOR_DISPENSER : COLOR_WATCH);
            dot.setAttribute('opacity', '0.8');
            svg.appendChild(dot);
        }
    }

    // Ensure SVG defs exist (filters + gradient)
    ensureTrackerDefs(svg);
}

function ensureTrackerDefs(svg: SVGSVGElement): void {
    if (svg.querySelector('#tracker-defs')) return;

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.id = 'tracker-defs';

    // Green glow filter
    defs.innerHTML = `
        <filter id="tracker-glow-green" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="tracker-glow-orange" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="tracker-connector-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${COLOR_DISPENSER}"/>
            <stop offset="100%" stop-color="${COLOR_WATCH}"/>
        </linearGradient>
    `;

    svg.insertBefore(defs, svg.firstChild);
}

function startTrackerCapture(ctx: CameraToggleContext, overlay: HTMLElement): void {
    if (!ctx.video || ctx.tracker) return;

    const tracker = new TrackerClient();
    ctx.tracker = tracker;

    // Create overlay SVG for tracker visuals
    const trackerSvg = createTrackerOverlaySvg(overlay);
    ctx.trackerOverlaySvg = trackerSvg;

    const captureFrame = createFrameCapture(ctx.video);
    let lastSend = 0;

    tracker.onUpdate(update => {
        if (!ctx.video || !ctx.trackerOverlaySvg) return;
        renderTrackerObjects(ctx.trackerOverlaySvg, update.objects, ctx.video);
    });

    tracker.onStatus(status => {
        console.log(`[Compile] Tracker: ${status}`);
    });

    tracker.connect();
    tracker.startTracking('both');

    // Frame capture loop
    const tick = async (now: number) => {
        if (!ctx.tracker) return;
        if (now - lastSend >= TRACKER_SEND_INTERVAL) {
            lastSend = now;
            const blob = await captureFrame();
            if (blob && ctx.tracker?.isConnected) {
                ctx.tracker.sendFrame(blob);
            }
        }
        ctx.trackerRafId = requestAnimationFrame(tick);
    };
    ctx.trackerRafId = requestAnimationFrame(tick);
}

function stopTrackerCapture(ctx: CameraToggleContext): void {
    if (ctx.trackerRafId) {
        cancelAnimationFrame(ctx.trackerRafId);
        ctx.trackerRafId = 0;
    }
    if (ctx.tracker) {
        ctx.tracker.stopTracking();
        ctx.tracker.disconnect();
        ctx.tracker = null;
    }
    if (ctx.trackerOverlaySvg) {
        ctx.trackerOverlaySvg.remove();
        ctx.trackerOverlaySvg = null;
    }
}

/* ── Substance spoke explosion ────────────────────────────── */

function buildSpokeExplosion(substances: SubstanceInfo[], cx: number, cy: number): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.setAttribute('class', 'compile-spoke-explosion');

    const unique = substances.filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i);
    const count = unique.length;
    if (count === 0) return g;

    const angleStep = 360 / count;
    const innerR = 40;
    const outerR = Math.min(window.innerWidth, window.innerHeight) * 0.36;
    const jointR = 3;

    for (let i = 0; i < count; i++) {
        const sub = unique[i];
        const angleDeg = i * angleStep - 90;
        const angleRad = (angleDeg * Math.PI) / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        const x0 = cx + cosA * innerR;
        const y0 = cy + sinA * innerR;
        const midR = innerR + (outerR - innerR) * 0.45;
        const xm = cx + cosA * midR;
        const ym = cy + sinA * midR;
        const x1 = cx + cosA * outerR;
        const y1 = cy + sinA * outerR;

        const spokeG = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        spokeG.setAttribute('class', 'compile-spoke-arm');
        spokeG.setAttribute('data-substance', sub.name);
        spokeG.style.setProperty('--spoke-delay', `${i * 60}ms`);
        spokeG.style.transformOrigin = `${cx}px ${cy}px`;

        // Inner segment — dashed, techy
        spokeG.appendChild(
            svgEl('line', {
                x1: x0.toFixed(1),
                y1: y0.toFixed(1),
                x2: xm.toFixed(1),
                y2: ym.toFixed(1),
                stroke: sub.color,
                'stroke-width': '1',
                'stroke-opacity': '0.35',
                'stroke-dasharray': '4 3',
            }),
        );

        // Outer segment — solid, brighter
        spokeG.appendChild(
            svgEl('line', {
                x1: xm.toFixed(1),
                y1: ym.toFixed(1),
                x2: x1.toFixed(1),
                y2: y1.toFixed(1),
                stroke: sub.color,
                'stroke-width': '1.5',
                'stroke-opacity': '0.7',
            }),
        );

        // Joint node at midpoint
        spokeG.appendChild(
            svgEl('circle', {
                cx: xm.toFixed(1),
                cy: ym.toFixed(1),
                r: String(jointR),
                fill: 'none',
                stroke: sub.color,
                'stroke-width': '1.2',
                'stroke-opacity': '0.6',
            }),
        );
        // Inner dot in joint
        spokeG.appendChild(
            svgEl('circle', {
                cx: xm.toFixed(1),
                cy: ym.toFixed(1),
                r: '1.2',
                fill: sub.color,
                opacity: '0.8',
            }),
        );

        // Terminal node (diamond shape at end)
        const dSize = 4;
        const dPath = `M${x1},${y1 - dSize} L${x1 + dSize},${y1} L${x1},${y1 + dSize} L${x1 - dSize},${y1} Z`;
        spokeG.appendChild(
            svgEl('path', {
                d: dPath,
                fill: sub.color,
                opacity: '0.9',
            }),
        );

        // Substance label at endpoint
        const labelOffset = 10;
        const lx = cx + cosA * (outerR + labelOffset);
        const ly = cy + sinA * (outerR + labelOffset);
        const anchor = cosA < -0.3 ? 'end' : cosA > 0.3 ? 'start' : 'middle';
        const doseStr = sub.dose ? ` ${sub.dose}` : '';

        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', lx.toFixed(1));
        label.setAttribute('y', ly.toFixed(1));
        label.setAttribute('text-anchor', anchor);
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('class', 'compile-spoke-label');
        label.setAttribute('fill', sub.color);
        label.textContent = `${sub.name}${doseStr}`;
        spokeG.appendChild(label);

        g.appendChild(spokeG);
    }

    return g;
}

function removeSpokeExplosion(ctx: CameraToggleContext): void {
    if (ctx.spokesContainer) {
        ctx.spokesContainer.classList.add('compile-spoke-fadeout');
        const el = ctx.spokesContainer;
        setTimeout(() => el.remove(), 800);
        ctx.spokesContainer = null;
    }
}

function restoreToggleState(ctx: CameraToggleContext, overlay: HTMLElement): void {
    // Remove spokes
    removeSpokeExplosion(ctx);

    // Stop tracker
    stopTrackerCapture(ctx);

    // Stop camera
    destroyCameraFeed(overlay);
    ctx.video = null;
    ctx.stream = null;

    // Restore backdrop
    ctx.backdrop.style.opacity = '1';

    // Restore cartridge SVG
    ctx.overlaySvg.style.transition = 'opacity 0.6s ease';
    ctx.overlaySvg.style.opacity = '1';

    // Restore VCR clone
    ctx.vcrClone.style.transition = 'opacity 0.6s ease';
    ctx.vcrClone.style.opacity = '1';

    // Restore delivery timer
    if (ctx.delivery) {
        ctx.delivery.classList.remove('compile-delivery-fluorescent');
        ctx.delivery.style.transition = 'opacity 0.6s ease';
        ctx.delivery.style.opacity = '1';
    }
}

function createCameraToggleButton(overlay: HTMLElement, ctx: CameraToggleContext): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.id = 'compile-camera-toggle';
    btn.type = 'button';
    btn.textContent = TOGGLE_LABELS[0];
    btn.title = TOGGLE_TITLES[0];
    overlay.appendChild(btn);

    btn.addEventListener('click', async () => {
        const next = (ctx.state >= 5 ? 0 : ctx.state + 1) as CameraToggleState;

        if (next === 0) {
            // Cycle back: restore everything
            restoreToggleState(ctx, overlay);
        } else if (next === 1) {
            // Click 1: start camera behind backdrop, backdrop to 70% opacity
            try {
                const { video, stream } = await acquireCameraFeed(overlay);
                ctx.video = video;
                ctx.stream = stream;
                video.classList.add('visible');
                ctx.backdrop.style.opacity = '0.7';
                // Start object tracking
                startTrackerCapture(ctx, overlay);
            } catch (err) {
                console.warn('[Compile] Camera feed unavailable:', err);
                ctx.state = 2 as CameraToggleState;
                btn.textContent = TOGGLE_LABELS[2];
                btn.title = TOGGLE_TITLES[2];
                return;
            }
        } else if (next === 2) {
            // Click 2: backdrop to 0% — camera fully visible
            ctx.backdrop.style.opacity = '0';
        } else if (next === 3) {
            // Click 3: fade out cartridge + VCR clone, delivery stays with fluorescent color
            ctx.overlaySvg.style.transition = 'opacity 0.8s ease';
            ctx.overlaySvg.style.opacity = '0';
            ctx.vcrClone.style.transition = 'opacity 0.8s ease';
            ctx.vcrClone.style.opacity = '0';
            ctx.delivery?.classList.add('compile-delivery-fluorescent');
        } else if (next === 4) {
            // Click 4: fade out delivery timer
            if (ctx.delivery) {
                ctx.delivery.style.transition = 'opacity 0.8s ease';
                ctx.delivery.style.opacity = '0';
            }
        } else if (next === 5) {
            // Click 5: substance spoke explosion from cartridge center
            const spokes = buildSpokeExplosion(ctx.substances, ctx.centerX, ctx.centerY);
            // Insert into a new SVG that sits above the camera
            let spokeSvg = overlay.querySelector('#compile-spokes-svg') as SVGSVGElement | null;
            if (!spokeSvg) {
                spokeSvg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
                spokeSvg.setAttribute('id', 'compile-spokes-svg');
                spokeSvg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
                spokeSvg.style.cssText =
                    'width:100%;height:100%;position:absolute;inset:0;pointer-events:none;z-index:5';
                overlay.appendChild(spokeSvg);
            }
            spokeSvg.innerHTML = '';
            spokeSvg.appendChild(spokes);
            ctx.spokesContainer = spokes;
        }

        ctx.state = next;
        btn.textContent = TOGGLE_LABELS[next];
        btn.title = TOGGLE_TITLES[next];
    });

    ctx.btn = btn;
    return btn;
}

/* ════════════════════════════════════════════════════════════════
   Main sequence
   ════════════════════════════════════════════════════════════════ */

export async function animateCompileSequence(svg: SVGSVGElement): Promise<void> {
    CompileState.cleanup?.();
    CompileState.runId += 1;
    const runId = CompileState.runId;
    CompileState.phase = 'extracting';

    const overlay = getHtmlEl('compile-overlay');
    const livePanel = document.querySelector('.phase-svg-wrapper .vcr-control-panel') as HTMLElement | null;
    if (!overlay || !livePanel) {
        CompileState.phase = 'idle';
        return;
    }

    const pills = snapshotPills(svg);
    if (pills.length === 0) {
        CompileState.phase = 'idle';
        return;
    }

    const overlaySvg = setupOverlay(overlay);
    const vcr = createVcrClone(livePanel, overlay);
    if (!vcr) {
        overlay.classList.remove('visible');
        overlay.classList.add('hidden');
        CompileState.phase = 'idle';
        return;
    }

    // Create mirrors (fixed-size, no morphing)
    const mirrors = pills.map(s => createMirror(s, overlay));
    const lanes = buildLanes(mirrors);

    // Hide originals
    const livePanelStyle = captureVisibility(livePanel);
    hideElement(livePanel);

    const allSvgPills = Array.from(svg.querySelectorAll('.timeline-pill-group')) as SVGGElement[];
    const pillStyles = new Map<SVGGElement, VisibilitySnapshot>();
    allSvgPills.forEach(g => {
        pillStyles.set(g, captureVisibility(g));
        hideElement(g);
    });

    // Also hide the entire substance timeline group (lane stripes, separator, etc.)
    const timelineGroup = svg.querySelector('#phase-substance-timeline') as SVGGElement | null;
    const timelineGroupStyle = timelineGroup ? captureVisibility(timelineGroup) : null;
    if (timelineGroup) hideElement(timelineGroup);

    // Hide biometric strips and spotter highlights so they can be restored after compile
    const bioGroup = svg.querySelector('#phase-biometric-strips') as SVGGElement | null;
    const bioGroupStyle = bioGroup ? captureVisibility(bioGroup) : null;
    if (bioGroup) hideElement(bioGroup);

    const spotterGroup = svg.querySelector('#phase-spotter-highlights') as SVGGElement | null;
    const spotterGroupStyle = spotterGroup ? captureVisibility(spotterGroup) : null;
    if (spotterGroup) hideElement(spotterGroup);

    let ambientCleanup: (() => void) | null = null;
    let spinCleanup: (() => void) | null = null;

    const cleanup = () => {
        if (CompileState.countdownTimer !== null) {
            clearInterval(CompileState.countdownTimer);
            CompileState.countdownTimer = null;
        }
        ambientCleanup?.();
        spinCleanup?.();
        destroyCameraFeed(overlay);
        overlay.querySelector('#compile-tracker-overlay')?.remove();
        overlay.querySelector('#compile-camera-backdrop')?.remove();
        overlay.querySelector('#compile-camera-toggle')?.remove();
        overlay.querySelector('#compile-spokes-svg')?.remove();
        overlay.classList.remove('visible');
        overlay.classList.add('hidden');
        overlay.querySelector('#compile-svg')?.remove();
        overlay.querySelectorAll('.compile-pill-mirror, .compile-vcr-clone').forEach(el => el.remove());
        overlay
            .querySelectorAll('.compile-delivery, .compile-tagline')
            .forEach(el => el.classList.remove('visible', 'compile-delivery-fluorescent'));
        const deliveryEl = overlay.querySelector('.compile-delivery') as HTMLElement | null;
        if (deliveryEl) {
            deliveryEl.classList.remove('compile-delivery-fluorescent');
            deliveryEl.style.removeProperty('top');
            deliveryEl.style.removeProperty('opacity');
        }
        const bf = overlay.querySelector('.compile-delivery-bar-fill') as HTMLElement | null;
        if (bf) bf.style.width = '0%';
        const strong = overlay.querySelector('.compile-eta-text strong');
        if (strong) strong.textContent = '30 minutes';

        restoreVisibility(livePanel, livePanelStyle);
        allSvgPills.forEach(g => {
            const snapshot = pillStyles.get(g);
            if (snapshot) restoreVisibility(g, snapshot);
        });
        if (timelineGroup && timelineGroupStyle) restoreVisibility(timelineGroup, timelineGroupStyle);
        if (bioGroup && bioGroupStyle) restoreVisibility(bioGroup, bioGroupStyle);
        if (spotterGroup && spotterGroupStyle) restoreVisibility(spotterGroup, spotterGroupStyle);
        applyPageFade(1);
        CompileState.cleanup = null;
        CompileState.phase = 'idle';
    };
    CompileState.cleanup = cleanup;

    // Build cartridge data
    const allSnaps = lanes.flatMap(l => l.mirrors.map(m => m.snap));
    const slots = buildCartridgeSlots(
        allSnaps.map(s => ({ name: s.key, color: s.color, dose: s.dose })),
        26,
    );
    const { root, slotGroups, hubDot } = buildDosePlayerSvg(slots, { showBody: true, showLabel: false });
    root.setAttribute('transform', `translate(${vcr.cx}, ${vcr.cy}) scale(0.32)`);
    overlaySvg.appendChild(root);

    // Hide all cartridge parts initially
    const body = root.querySelector('.dp-body') as SVGElement | null;
    const ring = root.querySelector('.dp-ring') as SVGElement | null;
    const hub = root.querySelector('.dp-hub') as SVGElement | null;
    const spokes = root.querySelectorAll('.dp-spoke') as NodeListOf<SVGElement>;
    const cartridge = root.querySelector('.dp-cartridge') as SVGGElement | null;
    [body, ring, hub, hubDot].forEach(el => el?.setAttribute('opacity', '0'));
    spokes.forEach(s => s.setAttribute('opacity', '0'));
    slotGroups.forEach((sg, i) => {
        fillSlot(sg, slots[i].color);
        sg.setAttribute('opacity', '0');
    });

    /* ── Phase 1: Pack pills to center of strip ────────────── */

    // Compute staged queue targets per lane (only X moves, Y stays).
    // Each lane gets one center slot; extra pills queue behind that slot.
    const packTargets = new Map<PillMirror, number>();
    for (const lane of lanes) {
        computeLaneQueueTargets(lane, vcr.cx).forEach((tx, m) => packTargets.set(m, tx));
    }

    await animate(runId, 1200, rawT => {
        const t = easeInOutCubic(rawT);
        for (const m of mirrors) {
            const tx = packTargets.get(m);
            if (tx === undefined) continue;
            m.x = m.snap.x + (tx - m.snap.x) * t;
            // Y stays at original lane position — no vertical change
            placeMirror(m);
        }
    });
    if (CompileState.runId !== runId) return;

    if (!(await wait(runId, 500))) return;

    /* ── Phase 2: Drain pills into VCR button ──────────────── */

    // Drain bottom lane first, then upward
    while (true) {
        // Pick bottom-most non-empty lane
        let activeLane: LaneQueue | null = null;
        for (let i = lanes.length - 1; i >= 0; i--) {
            if (lanes[i].mirrors.length > 0) {
                activeLane = lanes[i];
                break;
            }
        }
        if (!activeLane) break;

        const lead = activeLane.mirrors[0];
        if (!lead) break;

        const startX = lead.x;
        const startY = lead.y;

        // Drop the staged pill straight down into the VCR. X is already centered
        // from Phase 1, so this leg is vertical only.
        const targetX = vcr.cx - lead.snap.w / 2;
        const targetY = vcr.cy - lead.snap.h / 2;
        await animate(runId, 600, rawT => {
            const t = easeInOutCubic(rawT);
            lead.x = startX + (targetX - startX) * t;
            lead.y = startY + (targetY - startY) * t;
            lead.el.style.opacity = `${1 - t * 0.88}`;
            lead.el.style.transform = 'none';
            placeMirror(lead);
        });
        if (CompileState.runId !== runId) return;

        lead.el.remove();
        activeLane.mirrors.shift();

        // Re-center remaining pills in this lane
        if (activeLane.mirrors.length > 0) {
            const newTargets = computeLaneQueueTargets(activeLane, vcr.cx);
            const startPositions = activeLane.mirrors.map(m => ({ m, sx: m.x }));
            await animate(runId, 300, rawT => {
                const t = easeOutCubic(rawT);
                for (const { m, sx } of startPositions) {
                    const tx = newTargets.get(m);
                    if (tx === undefined) continue;
                    m.x = sx + (tx - sx) * t;
                    placeMirror(m);
                }
            });
            if (CompileState.runId !== runId) return;
        }

        if (!(await wait(runId, 60))) return;
    }

    /* ── Phase 3: Assembly — fade page, move VCR + cartridge to center ── */

    CompileState.phase = 'assembling';
    if (!(await wait(runId, 300))) return;

    const cloneRect = vcr.panel.getBoundingClientRect();
    const btnRect = vcr.button.getBoundingClientRect();
    const btnOffX = btnRect.left - cloneRect.left + btnRect.width / 2;
    const btnOffY = btnRect.top - cloneRect.top + btnRect.height / 2;
    const finalCX = window.innerWidth / 2;
    const finalCY = Math.max(220, Math.min(window.innerHeight * 0.44, window.innerHeight / 2));
    const startPL = cloneRect.left;
    const startPT = cloneRect.top;
    const endPL = finalCX - btnOffX;
    const endPT = finalCY - btnOffY;

    await animate(runId, 1500, rawT => {
        const t = easeInOutCubic(rawT);
        const mt = easeOutBack(rawT);

        applyPageFade(1 - t);

        vcr.panel.style.left = `${startPL + (endPL - startPL) * mt}px`;
        vcr.panel.style.top = `${startPT + (endPT - startPT) * mt}px`;
        vcr.panel.style.transform = `scale(${(1 + 0.06 * mt).toFixed(3)})`;

        const cx = vcr.cx + (finalCX - vcr.cx) * mt;
        const cy = vcr.cy + (finalCY - vcr.cy) * mt;
        const sc = 0.32 + (COMPILE_ZONE.heroScale - 0.32) * mt;
        root.setAttribute('transform', `translate(${cx.toFixed(2)}, ${cy.toFixed(2)}) scale(${sc.toFixed(3)})`);

        const reveal = Math.max(0, (rawT - 0.16) / 0.84);
        if (body) body.setAttribute('opacity', String(0.84 * reveal));
        if (ring) ring.setAttribute('opacity', String(reveal));
        if (hub) hub.setAttribute('opacity', String(0.95 * reveal));
        if (hubDot) hubDot.setAttribute('opacity', String(reveal));
        spokes.forEach(s => s.setAttribute('opacity', String(0.56 * reveal)));
        slotGroups.forEach(sg => sg.setAttribute('opacity', String(reveal)));
    });
    if (CompileState.runId !== runId) return;

    if (cartridge) spinCleanup = startCartridgeSpin(cartridge);
    ambientCleanup = startAmbientPulse(slotGroups);
    CompileState.phase = 'ready';

    const deliveryTop = finalCY + (COMPILE_ZONE.deviceH * COMPILE_ZONE.heroScale) / 2 + 40;
    await revealDeliveryTimer(runId, overlay, deliveryTop);

    // Dark backdrop sits between camera (z:0) and cartridge content (z:auto)
    const backdrop = document.createElement('div');
    backdrop.id = 'compile-camera-backdrop';
    // Insert after the camera slot (first child) but before SVG/VCR/delivery
    const firstOverlayChild = overlay.querySelector('#compile-svg') || overlay.firstChild;
    if (firstOverlayChild) overlay.insertBefore(backdrop, firstOverlayChild);
    else overlay.appendChild(backdrop);

    // Camera toggle button — 5-click progressive reveal + substance spokes
    const delivery = overlay.querySelector('.compile-delivery') as HTMLElement | null;
    const substanceInfos: SubstanceInfo[] = allSnaps.map(s => ({ name: s.key, color: s.color, dose: s.dose }));
    const toggleCtx: CameraToggleContext = {
        btn: null as unknown as HTMLButtonElement,
        state: 0,
        video: null,
        stream: null,
        backdrop,
        overlaySvg,
        vcrClone: vcr.panel,
        delivery,
        substances: substanceInfos,
        centerX: finalCX,
        centerY: finalCY,
        spokesContainer: null,
        tracker: null,
        trackerRafId: 0,
        trackerOverlaySvg: null,
    };
    createCameraToggleButton(overlay, toggleCtx);
}
