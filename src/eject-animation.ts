/**
 * eject-animation — Radial substance clock transformation triggered by the VCR eject button.
 *
 * Flow:
 * 1. Absorb flanking docks (protocol streamer + biometric devices) into VCR center.
 * 2. Expand VCR envelope upward into a rounded square.
 * 3. Push substance strip pills aside as the square breaches the timeline.
 * 4. Wrap substances radially around the play button as a 24-hour dose clock.
 */
import { SVG_NS, TIMELINE_ZONE } from './constants';
import { easeOutCubic, easeOutBack } from './timeline-engine';
import { undockAllBioDevices } from './bio-device-dock';
import { undockAgent } from './creator-agent-matcher';
import { CompileState, MultiDayState } from './state';
import { TrackerClient, createFrameCapture, type TrackerUpdate } from './tracker-client';
import { LxPlayer3D, preloadLxPlayerModel, type ModelVariant } from './lx-player-3d';

/* ── Timing constants ──────────────────────────────────────── */

const ABSORB_DUR = 500;
const EXPAND_DUR = 700;
const EXPAND_DELAY = 200; // overlap with absorption
const BREACH_DUR = 700;
const BREACH_DELAY = 400;
const MIN_BAR = 50;
const MAX_BAR = 140;
const HUB_RADIUS = 42; // gap between play button edge and substance bars
// Max distance (SVG viewBox units) from center a bar tip may reach.
// Derived from camera math: 3D canvas (600px) / (2 × 2.14 fit multiplier) × 0.95 safety ≈ 133.
// Keeps bars inside the 3D device circle regardless of VCR pill width or eject timing.
const DEVICE_OUTER_RADIUS = 133;
const FAN_ANGLE = 8; // degrees offset for same-time substances
const FAN_BUCKET_MIN = 15; // minutes — pills within this window fan out
const LABEL_MAX_NAME_CHARS = 10; // truncate substance name beyond this, keep dose intact

/* ── Tracker constants ────────────────────────────────────── */

const TRACKER_CAPTURE_W = 640;
const TRACKER_CAPTURE_H = 480;
const TRACKER_SEND_INTERVAL = 50; // ~20fps
const EMA_ALPHA = 0.25;
const LOST_THRESHOLD = 15; // frames without quad before returning to center
const ALIGN_TOLERANCE = 80; // px — how close tracked quad center must be to device center
const COLOR_TRACKER = '#39FF14'; // neon green, matching compile-animation

/* ── Internal types ────────────────────────────────────────── */

interface SubstancePillData {
    key: string;
    color: string;
    dose: string;
    doseMg: number;
    timeMinutes: number;
    laneIdx: number;
    rect: DOMRect;
    svgGroup: SVGGElement;
}

interface RadialBar {
    pill: SubstancePillData;
    angle: number; // degrees
    barLength: number; // px
}

/* ── State ─────────────────────────────────────────────────── */

let _runId = 0;
let _active = false;
let _radialActive = false;
let _deliveryActive = false;

/* Tracker state */
let _tracker: TrackerClient | null = null;
let _trackerRafId = 0;
let _trackingLocked = false;
let _lostFrameCount = 0;
let _trackerOverlaySvg: SVGSVGElement | null = null;
let _trackerPanel: HTMLElement | null = null;

// Device center offset relative to panel origin (computed once when tracking starts)
let _bgOffX = 0;
let _bgOffY = 0;

// EMA-smoothed corners are in the homography section (_smoothCorners)
let _maxBarLen = MAX_BAR; // clamped at handoff to device radius

/* 3D device renderer */
let _player3d: LxPlayer3D | null = null;
let _currentVariant: ModelVariant = 'v1';
let _variantToggleBtn: HTMLButtonElement | null = null;

/* ── Helpers ───────────────────────────────────────────────── */

function wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function animate(
    duration: number,
    tick: (t: number) => void,
    easing: (t: number) => number = easeInOutCubic,
): Promise<void> {
    return new Promise(resolve => {
        const start = performance.now();
        const step = (now: number) => {
            const raw = Math.min(1, (now - start) / duration);
            tick(easing(raw));
            if (raw < 1) requestAnimationFrame(step);
            else resolve();
        };
        requestAnimationFrame(step);
    });
}

function parseDoseMg(doseStr: string): number {
    const m = doseStr.match(/(\d+(?:\.\d+)?)\s*(mcg|μg|mg|g|iu)/i);
    if (!m) return 100; // fallback
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 'mcg' || unit === 'μg') return val / 1000;
    if (unit === 'g') return val * 1000;
    if (unit === 'iu') return val / 10; // heuristic: 1000 IU → 100 "units"
    return val; // mg
}

/* ── Stage A: Dock Absorption ──────────────────────────────── */

async function absorbDocks(panel: HTMLElement, runId: number): Promise<void> {
    const agentDock = panel.querySelector('.vcr-wing-agent-dock') as HTMLElement | null;
    const bioItems = Array.from(panel.querySelectorAll('.vcr-wing-bio-dock-item')) as HTMLElement[];
    const bioShell = panel.querySelector('.vcr-shell-bio-dock') as HTMLElement | null;
    const leftWing = panel.querySelector('.vcr-wing-left') as HTMLElement | null;
    const rightWing = panel.querySelector('.vcr-wing-right') as HTMLElement | null;

    const targets = [agentDock, bioShell, ...bioItems, leftWing, rightWing].filter(Boolean) as HTMLElement[];

    // Snapshot initial transforms
    for (const el of targets) {
        el.style.transition = 'none';
    }

    await animate(ABSORB_DUR, t => {
        if (_runId !== runId) return;
        for (const el of targets) {
            const isRight = el === agentDock || el === rightWing;
            const dx = isRight ? lerp(0, -40, t) : lerp(0, 40, t);
            const s = lerp(1, 0.3, t);
            el.style.transform = `translateX(${dx}px) scale(${s})`;
            el.style.opacity = String(1 - t);
        }
    });

    if (_runId !== runId) return;

    // Clean up DOM
    try {
        undockAgent();
    } catch (_) {
        /* may already be undocked */
    }
    try {
        undockAllBioDevices();
    } catch (_) {
        /* may already be undocked */
    }

    // Hide wings
    if (leftWing) leftWing.style.display = 'none';
    if (rightWing) rightWing.style.display = 'none';
}

/* ── Stage B: VCR Square Expansion ────────────────────────── */

const ICON_PLAY =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>';

function createSquareBg(panel: HTMLElement): HTMLDivElement {
    const bg = document.createElement('div');
    bg.className = 'eject-square-bg';
    bg.style.opacity = '0'; // invisible — kept only for layout/positioning calculations
    panel.insertBefore(bg, panel.firstChild);
    return bg;
}

/** Create the 3D device canvas — starts small behind VCR, grows with the square */
function create3dDevice(panel: HTMLElement): void {
    _player3d?.dispose();
    _player3d = null;
    _currentVariant = 'v1';
    removeVariantToggle();

    // Large canvas so the device isn't clipped during tilt
    const size = 600;
    _player3d = new LxPlayer3D({ width: size, height: size });

    const canvas = _player3d.getCanvas();
    canvas.className = 'eject-device-canvas';
    canvas.style.position = 'absolute';
    canvas.style.zIndex = '2';
    canvas.style.pointerEvents = 'none';
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    // Fade in gently
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 600ms ease-in';

    // Center horizontally on the panel, vertically on the play button
    const playBtn = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    const panelRect = panel.getBoundingClientRect();
    // Always center horizontally
    canvas.style.left = `${panelRect.width / 2 - size / 2}px`;
    if (playBtn) {
        const btnRect = playBtn.getBoundingClientRect();
        const btnCenterY = btnRect.top + btnRect.height / 2 - panelRect.top;
        canvas.style.top = `${btnCenterY - size / 2}px`;
    } else {
        canvas.style.top = `${panelRect.height / 2 - size / 2}px`;
    }

    // Trigger fade-in
    requestAnimationFrame(() => {
        canvas.style.opacity = '1';
    });

    panel.insertBefore(canvas, panel.firstChild);

    // Load model — start at front view
    preloadLxPlayerModel().then(parts => {
        if (!_player3d) return;
        _player3d.loadModel(parts);
        _player3d.setCameraPreset('front');
        _player3d.startRenderLoop();
    });
}

/** Keep the 3D canvas vertically centered on the play button (horizontal stays locked) */
function sync3dToButton(panel: HTMLElement): void {
    if (!_player3d) return;
    const canvas = _player3d.getCanvas();
    const playBtn = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    if (!playBtn) return;

    const btnRect = playBtn.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const btnCenterY = btnRect.top + btnRect.height / 2 - panelRect.top;
    const size = parseFloat(canvas.style.width) || 600;

    // Only update vertical — horizontal stays centered on panel
    canvas.style.top = `${btnCenterY - size / 2}px`;
}

async function expandToSquare(panel: HTMLElement, bg: HTMLDivElement, runId: number): Promise<void> {
    // Hide the pill pseudo
    panel.classList.add('eject-active');

    // Grab the play/eject button and swap icon from eject → play
    const playBtn = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    if (playBtn) {
        playBtn.innerHTML = ICON_PLAY;
        playBtn.title = 'Play';
    }

    // Measure current pill width
    const pillW = parseFloat(getComputedStyle(panel).getPropertyValue('--pill-w')) || 84;
    const panelH = panel.offsetHeight;

    // Initial state: match pill dimensions
    bg.style.width = `${pillW}px`;
    bg.style.height = `${panelH}px`;
    bg.style.bottom = '0';
    bg.style.borderRadius = '999px';

    // Target: square (pillW × pillW), expanding upward
    const targetH = pillW;
    const targetRadius = 24; // rounded square — nicely arced edges

    // Compute how far the button needs to move upward to stay centered in the square.
    const btnOffsetY = -(targetH - panelH) / 2;

    // Compute how far the whole panel needs to move so the square's center
    // aligns with the vertical center of the substance strip.
    let panelLiftY = 0;
    const stripPills = document.querySelectorAll('.timeline-pill-group rect');
    if (stripPills.length > 0) {
        // Measure the vertical extent of all strip pill rects on screen
        let stripTop = Infinity;
        let stripBottom = -Infinity;
        stripPills.forEach(r => {
            const rect = r.getBoundingClientRect();
            if (rect.height < 1) return;
            if (rect.top < stripTop) stripTop = rect.top;
            if (rect.bottom > stripBottom) stripBottom = rect.bottom;
        });
        if (stripTop < stripBottom) {
            const stripCenterY = (stripTop + stripBottom) / 2;
            // Where the square's center will be after expansion (in screen coords)
            const panelRect = panel.getBoundingClientRect();
            const squareCenterY = panelRect.bottom - targetH / 2;
            panelLiftY = stripCenterY - squareCenterY;
        }
    }

    // Pull button above the grid so it can be positioned freely
    if (playBtn) {
        playBtn.style.position = 'relative';
        playBtn.style.zIndex = '5';
        playBtn.style.transition = 'none';
    }

    // Allow panel to move without clipping
    panel.style.overflow = 'visible';
    const panelParent = panel.parentElement;
    if (panelParent) panelParent.style.overflow = 'visible';

    // Pull panel out to body so it sits above the backdrop overlay
    const panelRect0 = panel.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.left = `${panelRect0.left}px`;
    panel.style.top = `${panelRect0.top}px`;
    panel.style.width = `${panelRect0.width}px`;
    panel.style.zIndex = '1001';
    document.body.appendChild(panel);

    // Start the tilt immediately (runs in parallel with the expand)
    const TILT_DUR = 1400;
    if (_player3d) {
        _player3d.animateTilt(TILT_DUR).then(() => {
            _player3d?.startSpin(0.3);
            showVariantToggle(panel);
        });
    }

    // Dark backdrop covering the entire chart SVG area
    const chartSvg = document.getElementById('phase-chart-svg');
    if (chartSvg) {
        const backdrop = document.createElement('div');
        backdrop.className = 'eject-chart-backdrop';
        const svgRect = chartSvg.getBoundingClientRect();
        backdrop.style.position = 'fixed';
        backdrop.style.left = `${svgRect.left - 20}px`;
        backdrop.style.top = `${svgRect.top - 20}px`;
        backdrop.style.width = `${svgRect.width + 40}px`;
        backdrop.style.height = `${svgRect.height + 40}px`;
        backdrop.style.background = 'rgba(10, 10, 15, 0.88)';
        backdrop.style.borderRadius = '12px';
        backdrop.style.pointerEvents = 'none';
        backdrop.style.zIndex = '999';
        backdrop.style.opacity = '0';
        backdrop.style.transition = `opacity ${TILT_DUR}ms ease-in-out`;
        document.body.appendChild(backdrop);
        requestAnimationFrame(() => {
            backdrop.style.opacity = '1';
        });
    }

    // Square bg is already invisible (opacity:0 from creation)

    await animate(
        TILT_DUR,
        t => {
            if (_runId !== runId) return;
            // Expand square (finish in first half)
            const expandT = Math.min(t * 2, 1);
            const eased = easeOutBack(expandT);
            const h = lerp(panelH, targetH, eased);
            const r = lerp(999, targetRadius, Math.min(eased * 1.5, 1));
            bg.style.height = `${h}px`;
            bg.style.borderRadius = `${r}px`;

            // Move button upward to track the expanding square's center
            if (playBtn) {
                playBtn.style.transform = `translateY(${lerp(0, btnOffsetY, eased)}px)`;
            }

            // Lift the entire panel smoothly over the full duration
            panel.style.transform = `translateY(${lerp(0, panelLiftY, easeInOutCubic(t))}px)`;

            // Keep the 3D canvas centered on the play button
            sync3dToButton(panel);
        },
        t => t, // linear — easing applied per-property above
    );

    sync3dToButton(panel);
}

/* ── Stage C: Substance Strip Breach ──────────────────────── */

async function breachSubstanceStrip(panel: HTMLElement, bg: HTMLDivElement, runId: number): Promise<void> {
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    const pillGroups = Array.from(svg.querySelectorAll('.timeline-pill-group')) as SVGGElement[];
    if (pillGroups.length === 0) return;

    // Get panel center in screen coords
    const bgRect = bg.getBoundingClientRect();
    const centerScreenX = bgRect.left + bgRect.width / 2;
    const halfSquareW = bgRect.width / 2 + 20; // 20px margin

    // Convert to SVG viewBox coords
    const svgRect = svg.getBoundingClientRect();
    const svgVB = svg.viewBox.baseVal;
    const scaleX = svgVB.width / svgRect.width;

    await animate(BREACH_DUR, t => {
        if (_runId !== runId) return;
        for (const g of pillGroups) {
            const bar = g.querySelector('rect');
            if (!bar) continue;
            const barRect = bar.getBoundingClientRect();
            const barCenterX = barRect.left + barRect.width / 2;
            const dist = barCenterX - centerScreenX;

            // Only push pills that are near the square horizontally
            if (Math.abs(dist) < halfSquareW) {
                const pushDir = dist >= 0 ? 1 : -1;
                const pushDist = (halfSquareW - Math.abs(dist)) * t * scaleX;
                g.setAttribute('transform', `translate(${pushDir * pushDist}, 0)`);
            }
        }
    });
}

/* ── Stage D: Radial Substance Wrap ───────────────────────── */

function extractPillData(svg: SVGSVGElement): SubstancePillData[] {
    const groups = Array.from(svg.querySelectorAll('.timeline-pill-group')) as SVGGElement[];

    // Force-reveal for measurement
    const saved = groups.map(g => g.getAttribute('opacity'));
    groups.forEach(g => g.setAttribute('opacity', '1'));

    const LANE_TOL = 8;
    const laneTops: number[] = [];
    const findLane = (top: number): number => {
        const idx = laneTops.findIndex(v => Math.abs(v - top) < LANE_TOL);
        if (idx >= 0) return idx;
        laneTops.push(top);
        laneTops.sort((a, b) => a - b);
        return laneTops.findIndex(v => Math.abs(v - top) < LANE_TOL);
    };

    const pills: SubstancePillData[] = [];
    for (const g of groups) {
        const bar =
            (g.querySelector('.timeline-bar') as SVGRectElement | null) ??
            (g.querySelector('rect') as SVGRectElement | null);
        if (!bar) continue;
        const r = bar.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;

        const label =
            (g.querySelector('.timeline-bar-label') as SVGTextElement | null)?.textContent?.trim() ??
            (g.querySelector('text') as SVGTextElement | null)?.textContent?.trim() ??
            '';
        const doseStr = label.match(/\d+(?:\.\d+)?\s*(?:m?g|mcg|μg|iu)/i)?.[0] || '100mg';
        const timeMins = parseInt(g.getAttribute('data-time-minutes') || '480', 10);

        pills.push({
            key: g.getAttribute('data-substance-key') || label || 'substance',
            color: bar.getAttribute('stroke') || bar.getAttribute('fill') || '#94a3b8',
            dose: doseStr,
            doseMg: parseDoseMg(doseStr),
            timeMinutes: timeMins,
            laneIdx: findLane(r.top),
            rect: r,
            svgGroup: g,
        });
    }

    // Restore
    groups.forEach((g, i) => {
        if (saved[i] !== null) g.setAttribute('opacity', saved[i]!);
        else g.removeAttribute('opacity');
    });

    return pills.sort((a, b) => a.timeMinutes - b.timeMinutes);
}

function computeRadialBars(pills: SubstancePillData[], maxBar = MAX_BAR): RadialBar[] {
    if (pills.length === 0) return [];
    const maxDose = Math.max(...pills.map(p => p.doseMg), 1);

    // Group by time bucket
    const buckets: SubstancePillData[][] = [];
    let currentBucket: SubstancePillData[] = [];
    let bucketTime = -Infinity;

    for (const p of pills) {
        if (p.timeMinutes - bucketTime > FAN_BUCKET_MIN || currentBucket.length === 0) {
            currentBucket = [p];
            buckets.push(currentBucket);
            bucketTime = p.timeMinutes;
        } else {
            currentBucket.push(p);
        }
    }

    const bars: RadialBar[] = [];
    for (const bucket of buckets) {
        const baseAngle = (bucket[0].timeMinutes / 1440) * 360 - 90;
        for (let i = 0; i < bucket.length; i++) {
            const pill = bucket[i];
            // Fan out: 0, +FAN, -FAN, +2*FAN, -2*FAN, ...
            let fanOffset = 0;
            if (bucket.length > 1) {
                const half = Math.ceil((i + 1) / 2);
                fanOffset = (i % 2 === 0 ? 1 : -1) * half * FAN_ANGLE;
            }
            bars.push({
                pill,
                angle: baseAngle + fanOffset,
                barLength: MIN_BAR + (pill.doseMg / maxDose) * (maxBar - MIN_BAR),
            });
        }
    }
    return bars;
}

/* ── Model Variant Toggle ─────────────────────────────────── */

function showVariantToggle(panel: HTMLElement): void {
    if (_variantToggleBtn) return; // already showing

    const btn = document.createElement('button');
    btn.className = 'eject-variant-toggle';
    btn.textContent = 'V2';
    btn.title = 'Switch device model';
    Object.assign(btn.style, {
        position: 'fixed',
        top: '80px',
        right: '24px',
        zIndex: '1100',
        padding: '6px 14px',
        borderRadius: '16px',
        border: '1px solid rgba(160, 220, 255, 0.3)',
        background: 'rgba(15, 20, 30, 0.7)',
        color: 'rgba(160, 220, 255, 0.85)',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '12px',
        fontWeight: '600',
        letterSpacing: '0.08em',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        transition: 'opacity 0.3s ease, background 0.2s ease',
        opacity: '0',
    });

    document.body.appendChild(btn);
    _variantToggleBtn = btn;

    // Fade in
    requestAnimationFrame(() => {
        btn.style.opacity = '1';
    });

    btn.addEventListener('click', async () => {
        if (!_player3d) return;
        const nextVariant: ModelVariant = _currentVariant === 'v1' ? 'v2' : 'v1';
        btn.textContent = nextVariant === 'v1' ? 'V2' : 'V1';
        btn.style.pointerEvents = 'none';

        const parts = await preloadLxPlayerModel(nextVariant);
        _player3d.loadModel(parts, nextVariant);
        _player3d.setCameraPreset('top');
        _player3d.startSpin(0.3);
        _currentVariant = nextVariant;
        btn.style.pointerEvents = '';
    });
}

function removeVariantToggle(): void {
    if (_variantToggleBtn) {
        _variantToggleBtn.remove();
        _variantToggleBtn = null;
    }
}

/** Pill dimensions matching the substance timeline strip. */
const PILL_H = TIMELINE_ZONE.laneH; // 20
const PILL_RX = TIMELINE_ZONE.pillRx; // 3

function createRadialSvg(panel: HTMLElement, bars: RadialBar[]): { svg: SVGSVGElement; pillGroups: SVGGElement[] } {
    const size = 300;
    const ns = SVG_NS;
    const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'eject-radial-svg');
    svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'visible';
    svg.style.zIndex = '3';

    const pillGroups: SVGGElement[] = [];
    for (const bar of bars) {
        pillGroups.push(
            createRadialPillGroup(svg, bar.angle, bar.barLength, bar.pill.color, bar.pill.key, bar.pill.dose, 0),
        );
    }

    return { svg, pillGroups };
}

/** Truncate substance name but always keep dose un-truncated at the end. */
function formatRadialLabel(name: string, dose: string): string {
    if (!dose) return name.length > LABEL_MAX_NAME_CHARS ? name.slice(0, LABEL_MAX_NAME_CHARS) + '…' : name;
    const truncName = name.length > LABEL_MAX_NAME_CHARS ? name.slice(0, LABEL_MAX_NAME_CHARS) + '…' : name;
    return `${truncName} ${dose}`;
}

/** Build dose label with interpolated number for animated transitions. */
function formatInterpolatedDose(num: number, unit: string, hasDecimals: boolean): string {
    return hasDecimals ? `${num.toFixed(1)}${unit}` : `${Math.round(num)}${unit}`;
}

/** Create a single radial pill group: rotated <g> with rect + text, matching timeline strip style. */
function createRadialPillGroup(
    parent: SVGElement,
    angle: number,
    barLength: number,
    color: string,
    label: string,
    dose: string,
    initialOpacity: number,
): SVGGElement {
    const ns = SVG_NS;
    const g = document.createElementNS(ns, 'g') as SVGGElement;
    g.setAttribute('class', 'eject-radial-bar');
    g.setAttribute('opacity', String(initialOpacity));
    g.setAttribute('transform', `rotate(${angle})`);

    // Pill rect — starts at HUB_RADIUS from center, extends outward by barLength
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', String(HUB_RADIUS));
    rect.setAttribute('y', String(-PILL_H / 2));
    rect.setAttribute('width', String(barLength));
    rect.setAttribute('height', String(PILL_H));
    rect.setAttribute('rx', String(PILL_RX));
    rect.setAttribute('ry', String(PILL_RX));
    rect.setAttribute('fill', color);
    rect.setAttribute('fill-opacity', '0.67');
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-opacity', '0.90');
    rect.setAttribute('stroke-width', '0.75');
    rect.setAttribute('class', 'eject-radial-rect');
    g.appendChild(rect);

    // Text label — substance name (truncated) + dose (always full), same font as timeline-bar-label
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(HUB_RADIUS + 5));
    text.setAttribute('y', '3.5'); // vertically centered in pill (PILL_H/2 = 10, baseline offset ~3.5)
    text.setAttribute('class', 'eject-radial-pill-label');
    text.textContent = formatRadialLabel(label, dose);
    g.appendChild(text);

    parent.appendChild(g);
    return g;
}

async function radialWrap(
    panel: HTMLElement,
    pills: SubstancePillData[],
    runId: number,
): Promise<{ radialSvg: SVGSVGElement; pillGroups: SVGGElement[]; bars: RadialBar[] } | null> {
    // Cap bar length so the tip never exceeds the 3D device circle.
    // DEVICE_OUTER_RADIUS is a fixed constant derived from the camera/canvas geometry,
    // so the result is independent of eject timing or VCR pill width.
    const cappedMaxBar = DEVICE_OUTER_RADIUS - HUB_RADIUS; // 133 - 42 = 91
    // Store globally so the continuous loop respects the same cap
    _maxBarLen = cappedMaxBar;

    const bars = computeRadialBars(pills, cappedMaxBar);
    if (bars.length === 0) return null;

    // Create radial SVG and position at play button center
    const { svg: radialSvg, pillGroups } = createRadialSvg(panel, bars);

    const playBtn = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    const playBtnRect = (playBtn ?? panel).getBoundingClientRect();
    const centerX = playBtnRect.left + playBtnRect.width / 2;
    const centerY = playBtnRect.top + playBtnRect.height / 2;

    if (playBtn) {
        const panelRect = panel.getBoundingClientRect();
        const cx = playBtnRect.left + playBtnRect.width / 2 - panelRect.left;
        const cy = playBtnRect.top + playBtnRect.height / 2 - panelRect.top;
        radialSvg.style.left = `${cx}px`;
        radialSvg.style.top = `${cy}px`;
        radialSvg.style.transform = 'translate(-50%, -50%)';
    }
    panel.appendChild(radialSvg);

    // For each bar, compute the starting transform that places the SVG pill group
    // at its original strip position (in the radial SVG's coordinate space).
    // The radial SVG is centered at (centerX, centerY) in screen coords.
    // The SVG viewBox is centered at (0, 0).
    // We need to convert each strip pill's screen position into the SVG's local coords.
    const svgScreenRect = radialSvg.getBoundingClientRect();
    const svgScale = parseFloat(radialSvg.getAttribute('width') || '300') / svgScreenRect.width;

    interface MorphState {
        startTx: number;
        startTy: number;
        startW: number;
        targetAngle: number;
        targetW: number;
    }

    const morphStates: MorphState[] = bars.map(bar => {
        const pill = bar.pill;
        const pillCx = pill.rect.left + pill.rect.width / 2;
        const pillCy = pill.rect.top + pill.rect.height / 2;
        const localX = (pillCx - centerX) * svgScale;
        const localY = (pillCy - centerY) * svgScale;
        const startW = pill.rect.width * svgScale;
        return {
            startTx: localX - HUB_RADIUS - startW / 2,
            startTy: localY,
            startW,
            targetAngle: bar.angle,
            targetW: bar.barLength,
        };
    });

    // All radial pill groups start hidden; revealed after their mirror arrives
    pillGroups.forEach(g => g.setAttribute('opacity', '0'));

    const targetX = centerX;
    const targetY = centerY;

    const FLY_DUR = 350;
    const SNAP_DUR = 280;
    const STAGGER = 140;

    // Track plucked substance keys so we can re-hide them if the multi-day
    // loop recreates them via renderSubstanceTimeline (innerHTML='').
    const pluckedKeys = new Set<string>();

    /** Find live strip pill by substance key, hide it + re-hide previously plucked. */
    function pluckLivePill(key: string): { rect: DOMRect; label: string } | null {
        const chartSvg = document.getElementById('phase-chart-svg');
        if (!chartSvg) return null;

        // Re-hide any previously plucked pills that the multi-day loop recreated
        for (const pKey of pluckedKeys) {
            const reborn = chartSvg.querySelector(
                `.timeline-pill-group[data-substance-key="${pKey}"]`,
            ) as SVGGElement | null;
            if (reborn) reborn.style.display = 'none';
        }

        // Find the current pill by key
        const liveGroup = chartSvg.querySelector(
            `.timeline-pill-group[data-substance-key="${key}"]`,
        ) as SVGGElement | null;
        if (!liveGroup) return null;

        const barEl =
            (liveGroup.querySelector('.timeline-bar') as SVGRectElement | null) ??
            (liveGroup.querySelector('rect') as SVGRectElement | null);
        const rect = barEl?.getBoundingClientRect();
        if (!rect || rect.width < 1) return null;

        const label =
            (liveGroup.querySelector('.timeline-bar-label') as SVGTextElement | null)?.textContent?.trim() ?? key;

        liveGroup.style.display = 'none';
        pluckedKeys.add(key);
        return { rect, label };
    }

    for (let i = 0; i < bars.length; i++) {
        if (_runId !== runId) return null;
        const bar = bars[i];
        const pill = bar.pill;
        const g = pillGroups[i];
        const radialRect = g.querySelector('.eject-radial-rect') as SVGRectElement | null;

        // Find the live strip pill fresh from the DOM
        const live = pluckLivePill(pill.key);
        const freshRect = live?.rect ?? pill.rect;
        const stripLabel = live?.label ?? `${pill.key} ${pill.dose}`;

        // Create an HTML mirror at the exact screen position
        const mirror = document.createElement('div');
        mirror.className = 'eject-pill-mirror';
        mirror.textContent = stripLabel;
        mirror.style.setProperty('--eject-pill-color', pill.color);
        mirror.style.left = `${freshRect.left}px`;
        mirror.style.top = `${freshRect.top}px`;
        mirror.style.width = `${freshRect.width}px`;
        mirror.style.height = `${freshRect.height}px`;
        document.body.appendChild(mirror);

        const startX = freshRect.left;
        const startY = freshRect.top;
        const startW = freshRect.width;
        const startH = freshRect.height;
        const endX = targetX - bar.barLength / 2;
        const endY = targetY - PILL_H / 2;
        const endW = bar.barLength;
        const endH = PILL_H;

        const flyPromise = animate(
            FLY_DUR,
            t => {
                mirror.style.left = `${lerp(startX, endX, t)}px`;
                mirror.style.top = `${lerp(startY, endY, t)}px`;
                mirror.style.width = `${lerp(startW, endW, t)}px`;
                mirror.style.height = `${lerp(startH, endH, t)}px`;
            },
            easeInOutCubic,
        ).then(() => {
            // Mirror arrived — remove it and reveal the radial SVG bar
            mirror.remove();
            g.setAttribute('opacity', '1');
            g.setAttribute('transform', `rotate(0)`);
            if (radialRect) radialRect.setAttribute('width', String(bar.barLength));

            // Snap-rotate into radial angle
            return animate(
                SNAP_DUR,
                t => {
                    const angle = lerp(0, bar.angle, t);
                    g.setAttribute('transform', `rotate(${angle})`);
                },
                easeOutBack,
            );
        });

        if (i < bars.length - 1) {
            await wait(STAGGER);
        } else {
            await flyPromise;
        }
    }

    // Hide entire strip now that all pills have been plucked
    const tlGroup = document.getElementById('phase-substance-timeline');
    if (tlGroup) tlGroup.style.display = 'none';

    // Snap all radial bars to final state
    pillGroups.forEach((g, i) => {
        g.setAttribute('transform', `rotate(${bars[i].angle})`);
        g.setAttribute('opacity', '1');
        const rect = g.querySelector('.eject-radial-rect') as SVGRectElement | null;
        if (rect) rect.setAttribute('width', String(bars[i].barLength));
    });

    return { radialSvg, pillGroups, bars };
}

/* ── Continuous radial day interpolation ───────────────────── */

/** Pre-computed radial state for one day's interventions. */
interface DayRadialBar {
    angle: number;
    barLength: number;
    color: string;
    key: string;
    label: string;
    dose: string;
    doseNum: number; // numeric value for interpolation (e.g. 200)
    doseUnit: string; // unit string (e.g. "mg")
}

interface DayRadialState {
    bars: DayRadialBar[];
}

/** Parse dose string into numeric value and unit. */
function parseDoseComponents(doseStr: string): { num: number; unit: string } {
    const m = doseStr.match(/(\d+(?:\.\d+)?)\s*(mcg|μg|mg|g|iu)/i);
    if (!m) return { num: 100, unit: 'mg' };
    return { num: parseFloat(m[1]), unit: m[2] };
}

/** Build radial state from a day's interventions (no SVG needed). */
function radialStateFromInterventions(interventions: any[]): DayRadialState {
    const pills: SubstancePillData[] = interventions.map((iv: any) => {
        const doseStr = iv.dose || '100mg';
        return {
            key: iv.key || 'substance',
            color: iv.substance?.color || '#94a3b8',
            dose: doseStr,
            doseMg: parseDoseMg(doseStr),
            timeMinutes: iv.timeMinutes ?? 480,
            laneIdx: 0,
            rect: new DOMRect(),
            svgGroup: null as any,
        };
    });
    const computed = computeRadialBars(pills, _maxBarLen);
    return {
        bars: computed.map(b => {
            const { num, unit } = parseDoseComponents(b.pill.dose);
            return {
                angle: b.angle,
                barLength: b.barLength,
                color: b.pill.color,
                key: b.pill.key,
                label: b.pill.key,
                dose: b.pill.dose,
                doseNum: num,
                doseUnit: unit,
            };
        }),
    };
}

/** Interpolate angle in the shortest-arc direction. */
function lerpAngle(a: number, b: number, t: number): number {
    const diff = ((b - a + 540) % 360) - 180; // shortest arc
    return a + diff * t;
}

/**
 * Continuous rAF loop that smoothly interpolates radial pill groups across all days.
 * Each pill group is a rotated <g> containing a rect + text label matching the
 * substance timeline strip style. The rotation angle, rect width, label text,
 * and colors interpolate smoothly between day snapshots.
 */
function startContinuousRadialLoop(radialSvg: SVGSVGElement, runId: number): void {
    const days = MultiDayState.days;
    if (days.length < 2) return;

    // Pre-compute radial states for every day
    const dayStates: DayRadialState[] = days.map(d => radialStateFromInterventions(d.interventions));

    // Find the max bar count across all days so we can pre-allocate SVG groups
    const maxBars = Math.max(...dayStates.map(s => s.bars.length));
    const groups = Array.from(radialSvg.querySelectorAll('.eject-radial-bar')) as SVGGElement[];

    // Ensure enough pill groups exist
    while (groups.length < maxBars) {
        groups.push(createRadialPillGroup(radialSvg, 0, MIN_BAR, '#94a3b8', '', '', 0));
    }

    // Each day transition = 3000ms (matches multi-day-animation baseDuration)
    const DAY_DUR = 3000;
    const totalCycleDur = days.length * DAY_DUR;
    const startTime = performance.now();

    const tick = (now: number) => {
        if (_runId !== runId) return;

        const elapsed = (now - startTime) * (MultiDayState.speed || 1);
        const cycleT = (elapsed % totalCycleDur) / totalCycleDur;
        const continuousDay = cycleT * days.length;
        const dayFloor = Math.floor(continuousDay) % days.length;
        const dayNext = (dayFloor + 1) % days.length;
        const frac = easeInOutCubic(continuousDay - Math.floor(continuousDay));

        const fromState = dayStates[dayFloor];
        const toState = dayStates[dayNext];
        const barCount = Math.max(fromState.bars.length, toState.bars.length);

        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (i >= barCount) {
                g.setAttribute('opacity', '0');
                continue;
            }

            const from = fromState.bars[i];
            const to = toState.bars[i];
            const rect = g.querySelector('.eject-radial-rect') as SVGRectElement | null;
            const text = g.querySelector('.eject-radial-pill-label') as SVGTextElement | null;

            if (from && to) {
                const angle = lerpAngle(from.angle, to.angle, frac);
                const barLen = Math.min(lerp(from.barLength, to.barLength, frac), _maxBarLen);
                const color = frac < 0.5 ? from.color : to.color;
                g.setAttribute('transform', `rotate(${angle})`);
                g.setAttribute('opacity', '1');
                if (rect) {
                    rect.setAttribute('width', String(barLen));
                    rect.setAttribute('fill', color);
                    rect.setAttribute('stroke', color);
                }
                if (text) {
                    const lbl = frac < 0.5 ? from : to;
                    const truncName =
                        lbl.label.length > LABEL_MAX_NAME_CHARS
                            ? lbl.label.slice(0, LABEL_MAX_NAME_CHARS) + '…'
                            : lbl.label;
                    const doseChanged = Math.abs(from.doseNum - to.doseNum) > 0.1;

                    if (doseChanged) {
                        // Interpolate dose numerically
                        const curDose = lerp(from.doseNum, to.doseNum, frac);
                        const hasDecimals = from.doseNum % 1 !== 0 || to.doseNum % 1 !== 0;
                        const unit = frac < 0.5 ? from.doseUnit : to.doseUnit;
                        const doseStr = formatInterpolatedDose(curDose, unit, hasDecimals);

                        // Build label with tspans: name → dose (pulsed) → arrow
                        text.textContent = '';
                        text.appendChild(document.createTextNode(`${truncName} `));

                        const numSpan = document.createElementNS(SVG_NS, 'tspan');
                        numSpan.textContent = doseStr;
                        // Font-size pulse: 0 → +18% → 0
                        const baseFontSize = 10;
                        const pulse = Math.sin(Math.PI * frac);
                        numSpan.setAttribute('font-size', (baseFontSize * (1 + 0.18 * pulse)).toFixed(1));
                        text.appendChild(numSpan);

                        // Arrow indicator (▲ green / ▼ red)
                        if (frac > 0.01 && frac < 0.99) {
                            const isUp = to.doseNum > from.doseNum;
                            const arrowSpan = document.createElementNS(SVG_NS, 'tspan');
                            arrowSpan.setAttribute('fill', isUp ? '#4ade80' : '#f87171');
                            arrowSpan.setAttribute('dx', '2');
                            arrowSpan.setAttribute('fill-opacity', String(Math.min(1, frac / 0.4)));
                            arrowSpan.textContent = isUp ? ' \u25B2' : ' \u25BC';
                            text.appendChild(arrowSpan);
                        }
                    } else {
                        text.textContent = formatRadialLabel(lbl.label, lbl.dose);
                    }
                }
            } else if (from && !to) {
                const barLen = Math.min(lerp(from.barLength, 0, frac), _maxBarLen);
                g.setAttribute('transform', `rotate(${from.angle})`);
                g.setAttribute('opacity', String(1 - frac));
                if (rect) {
                    rect.setAttribute('width', String(Math.max(barLen, 0.1)));
                    rect.setAttribute('fill', from.color);
                    rect.setAttribute('stroke', from.color);
                }
                if (text) {
                    text.textContent = formatRadialLabel(from.label, from.dose);
                }
            } else if (!from && to) {
                const barLen = Math.min(lerp(0, to.barLength, frac), _maxBarLen);
                g.setAttribute('transform', `rotate(${to.angle})`);
                g.setAttribute('opacity', String(frac));
                if (rect) {
                    rect.setAttribute('width', String(Math.max(barLen, 0.1)));
                    rect.setAttribute('fill', to.color);
                    rect.setAttribute('stroke', to.color);
                }
                if (text) {
                    text.textContent = formatRadialLabel(to.label, to.dose);
                }
            }
        }

        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
}

/* ── Tracker: video coordinate mapping ─────────────────────── */

interface VideoMapping {
    scaleX: number;
    scaleY: number;
    offX: number;
    offY: number;
}

/** Map tracker coords (640×480) to screen coords, accounting for object-fit:cover. */
function computeVideoMapping(video: HTMLVideoElement): VideoMapping {
    const videoW = video.videoWidth || TRACKER_CAPTURE_W;
    const videoH = video.videoHeight || TRACKER_CAPTURE_H;
    const elemW = video.clientWidth;
    const elemH = video.clientHeight;

    const videoAspect = videoW / videoH;
    const elemAspect = elemW / elemH;
    let renderW: number, renderH: number, cropX: number, cropY: number;

    if (elemAspect > videoAspect) {
        renderW = elemW;
        renderH = elemW / videoAspect;
        cropX = 0;
        cropY = (renderH - elemH) / 2;
    } else {
        renderH = elemH;
        renderW = elemH * videoAspect;
        cropX = (renderW - elemW) / 2;
        cropY = 0;
    }

    const scaleX = renderW / TRACKER_CAPTURE_W;
    const scaleY = renderH / TRACKER_CAPTURE_H;

    const videoRect = video.getBoundingClientRect();
    return {
        scaleX,
        scaleY,
        offX: videoRect.left - cropX,
        offY: videoRect.top - cropY,
    };
}

/* ── Tracker: homography → matrix3d ────────────────────────── */

/** Device reference rectangle — set once at handoff. */
let _deviceW = 0;
let _deviceH = 0;

/** EMA-smoothed screen-space quad corners (8 values: 4 × [x,y]). */
let _smoothCorners: number[] = [];

function emaLerp(prev: number, next: number, alpha: number): number {
    return prev + alpha * (next - prev);
}

/**
 * Map tracked quad corners to screen space.
 * Returns 4 [x,y] pairs: TL, TR, BR, BL.
 */
function mapCornersToScreen(corners: [number, number][], mapping: VideoMapping): number[][] {
    return corners.map(([x, y]) => [mapping.offX + x * mapping.scaleX, mapping.offY + y * mapping.scaleY]);
}

/**
 * Scale a screen-space quad so its average edge size matches the device assembly,
 * preserving shape (tilt, perspective distortion) and center position.
 */
function normalizeQuadSize(sc: number[][]): number[][] {
    if (_deviceW <= 0 || _deviceH <= 0) return sc;

    // Center
    const cx = (sc[0][0] + sc[1][0] + sc[2][0] + sc[3][0]) / 4;
    const cy = (sc[0][1] + sc[1][1] + sc[2][1] + sc[3][1]) / 4;

    // Average width & height of the quad
    const topLen = Math.hypot(sc[1][0] - sc[0][0], sc[1][1] - sc[0][1]);
    const botLen = Math.hypot(sc[2][0] - sc[3][0], sc[2][1] - sc[3][1]);
    const leftLen = Math.hypot(sc[3][0] - sc[0][0], sc[3][1] - sc[0][1]);
    const rightLen = Math.hypot(sc[2][0] - sc[1][0], sc[2][1] - sc[1][1]);
    const avgW = (topLen + botLen) / 2;
    const avgH = (leftLen + rightLen) / 2;

    if (avgW < 1 || avgH < 1) return sc;

    // Scale factor to match device size
    const scaleW = _deviceW / avgW;
    const scaleH = _deviceH / avgH;
    const scale = (scaleW + scaleH) / 2; // uniform scale to preserve aspect

    return sc.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale]);
}

/**
 * Compute a CSS matrix3d that warps a source rectangle to a destination quadrilateral.
 *
 * Uses the closed-form homography from the unit square to a quad,
 * composed with a pre-scale from the source rectangle to the unit square.
 *
 * src: [TL, TR, BR, BL] — source rectangle corners (panel-local coords)
 * dst: [TL, TR, BR, BL] — destination quad corners (screen coords)
 *
 * Since panel is at left:0 top:0 transform-origin:0 0, panel-local = screen.
 */
function computeMatrix3dFromQuad(srcW: number, srcH: number, srcOx: number, srcOy: number, dst: number[][]): string {
    // Source corners (the device rectangle centered at srcOx, srcOy)
    const sx0 = srcOx - srcW / 2,
        sy0 = srcOy - srcH / 2; // TL
    const sx1 = srcOx + srcW / 2,
        sy1 = srcOy - srcH / 2; // TR
    const sx2 = srcOx + srcW / 2,
        sy2 = srcOy + srcH / 2; // BR
    const sx3 = srcOx - srcW / 2,
        sy3 = srcOy + srcH / 2; // BL

    // Destination corners
    const [dx0, dy0] = dst[0]; // TL
    const [dx1, dy1] = dst[1]; // TR
    const [dx2, dy2] = dst[2]; // BR
    const [dx3, dy3] = dst[3]; // BL

    // Step 1: Compute homography from unit square to destination quad
    // Unit square: (0,0) (1,0) (1,1) (0,1) → (dx0,dy0) (dx1,dy1) (dx2,dy2) (dx3,dy3)
    const dxA = dx1 - dx2,
        dxB = dx3 - dx2,
        dxC = dx0 - dx1 + dx2 - dx3;
    const dyA = dy1 - dy2,
        dyB = dy3 - dy2,
        dyC = dy0 - dy1 + dy2 - dy3;
    const denom = dxA * dyB - dxB * dyA;
    if (Math.abs(denom) < 1e-10) {
        // Degenerate quad — fall back to simple translate
        const cx = (dx0 + dx1 + dx2 + dx3) / 4;
        const cy = (dy0 + dy1 + dy2 + dy3) / 4;
        return `translate(${cx - srcOx}px, ${cy - srcOy}px)`;
    }

    const g = (dxC * dyB - dxB * dyC) / denom;
    const h = (dxA * dyC - dxC * dyA) / denom;

    // Homography H maps (u,v,1) → (x*w, y*w, w) where u,v ∈ [0,1]
    const H00 = dx1 - dx0 + g * dx1;
    const H01 = dx3 - dx0 + h * dx3;
    const H02 = dx0;
    const H10 = dy1 - dy0 + g * dy1;
    const H11 = dy3 - dy0 + h * dy3;
    const H12 = dy0;
    const H20 = g;
    const H21 = h;
    const H22 = 1;

    // Step 2: Pre-transform from source rect to unit square
    // Maps (sx,sy) → (u,v) where u = (sx - sx0) / srcW, v = (sy - sy0) / srcH
    // So the composite is: H * S where S maps source rect to unit square
    const invW = 1 / srcW;
    const invH = 1 / srcH;

    // Composite: C = H * [invW, 0, -sx0*invW; 0, invH, -sy0*invH; 0, 0, 1]
    const C00 = H00 * invW;
    const C01 = H01 * invH;
    const C02 = H02 - H00 * sx0 * invW - H01 * sy0 * invH;
    const C10 = H10 * invW;
    const C11 = H11 * invH;
    const C12 = H12 - H10 * sx0 * invW - H11 * sy0 * invH;
    const C20 = H20 * invW;
    const C21 = H21 * invH;
    const C22 = H22 - H20 * sx0 * invW - H21 * sy0 * invH;

    // Step 3: Convert 3×3 homography to CSS matrix3d (column-major, 4×4)
    // Embedding: row/col 2 is identity (z-axis), rest maps from H
    // CSS matrix3d(m11,m21,m31,m41, m12,m22,m32,m42, m13,m23,m33,m43, m14,m24,m34,m44)
    return `matrix3d(${C00}, ${C10}, 0, ${C20}, ${C01}, ${C11}, 0, ${C21}, 0, 0, 1, 0, ${C02}, ${C12}, 0, ${C22})`;
}

/**
 * Apply tracked transform using homography-based matrix3d.
 * Smooths the destination quad corners via EMA, then computes the matrix.
 */
function applyTrackedTransform(panel: HTMLElement, screenCorners: number[][]): void {
    // Flatten for EMA
    const flat = screenCorners.flatMap(c => c);

    if (_smoothCorners.length !== flat.length) {
        _smoothCorners = flat.slice();
    } else {
        for (let i = 0; i < flat.length; i++) {
            _smoothCorners[i] = emaLerp(_smoothCorners[i], flat[i], EMA_ALPHA);
        }
    }

    // Unflatten back to corner pairs
    const smoothed = [
        [_smoothCorners[0], _smoothCorners[1]],
        [_smoothCorners[2], _smoothCorners[3]],
        [_smoothCorners[4], _smoothCorners[5]],
        [_smoothCorners[6], _smoothCorners[7]],
    ];

    const matrix = computeMatrix3dFromQuad(_deviceW, _deviceH, _bgOffX, _bgOffY, smoothed);
    panel.style.transform = matrix;
}

/* ── Tracker: quad overlay rendering ───────────────────────── */

function createTrackerOverlay(overlay: HTMLElement): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('id', 'eject-tracker-overlay');
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;pointer-events:none;z-index:6';
    overlay.appendChild(svg);
    return svg;
}

function renderTrackerQuad(svg: SVGSVGElement, corners: [number, number][], mapping: VideoMapping): void {
    svg.innerHTML = '';
    const scaled = corners.map(([x, y]) => [mapping.offX + x * mapping.scaleX, mapping.offY + y * mapping.scaleY]);
    const points = scaled.map(([x, y]) => `${x},${y}`).join(' ');

    // Semi-transparent fill
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', points);
    poly.setAttribute('fill', `${COLOR_TRACKER}20`);
    poly.setAttribute('stroke', COLOR_TRACKER);
    poly.setAttribute('stroke-width', '2');
    svg.appendChild(poly);

    // Corner dots
    for (const [cx, cy] of scaled) {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(cx));
        dot.setAttribute('cy', String(cy));
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', COLOR_TRACKER);
        svg.appendChild(dot);
    }
}

/* ── Tracker: alignment detection ──────────────────────────── */

function quadCenter(corners: [number, number][], mapping: VideoMapping): { x: number; y: number } {
    let sx = 0,
        sy = 0;
    for (const [x, y] of corners) {
        sx += mapping.offX + x * mapping.scaleX;
        sy += mapping.offY + y * mapping.scaleY;
    }
    return { x: sx / 4, y: sy / 4 };
}

function checkAlignment(qc: { x: number; y: number }, dc: { x: number; y: number }): boolean {
    return Math.hypot(qc.x - dc.x, qc.y - dc.y) < ALIGN_TOLERANCE;
}

/* ── Tracker: return to center on tracking lost ────────────── */

function returnToCenter(panel: HTMLElement): void {
    // Animate smooth corners from current position to a centered rectangle
    const startCorners = _smoothCorners.slice();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const hw = _deviceW / 2;
    const hh = _deviceH / 2;
    // Target: axis-aligned rectangle centered on screen
    const targetCorners = [cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh];

    animate(
        500,
        t => {
            for (let i = 0; i < _smoothCorners.length; i++) {
                _smoothCorners[i] = lerp(startCorners[i], targetCorners[i], t);
            }
            const smoothed = [
                [_smoothCorners[0], _smoothCorners[1]],
                [_smoothCorners[2], _smoothCorners[3]],
                [_smoothCorners[4], _smoothCorners[5]],
                [_smoothCorners[6], _smoothCorners[7]],
            ];
            const matrix = computeMatrix3dFromQuad(_deviceW, _deviceH, _bgOffX, _bgOffY, smoothed);
            panel.style.transform = matrix;
        },
        easeInOutCubic,
    );
}

/* ── Tracker: main capture loop (two-phase) ────────────────── */

function startEjectTrackerCapture(panel: HTMLElement, video: HTMLVideoElement): void {
    console.log('[Eject] Starting tracker capture');
    if (_tracker) return;

    const overlay = document.getElementById('compile-overlay');
    if (!overlay) return;

    // Compute device center = play button center, relative to panel origin
    const panelRect = panel.getBoundingClientRect();
    const playBtn = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    const bg = panel.querySelector('.eject-square-bg') as HTMLElement | null;
    if (!bg) return;
    const bgRect = bg.getBoundingClientRect();
    const anchor = playBtn ?? bg;
    const anchorRect = anchor.getBoundingClientRect();
    _bgOffX = anchorRect.left + anchorRect.width / 2 - panelRect.left;
    _bgOffY = anchorRect.top + anchorRect.height / 2 - panelRect.top;

    // Create tracker overlay SVG for alignment phase
    _trackerOverlaySvg = createTrackerOverlay(overlay);
    _trackerPanel = panel;

    // Create tracker client
    const tracker = new TrackerClient();
    _tracker = tracker;
    const captureFrame = createFrameCapture(video);

    _trackingLocked = false;
    _lostFrameCount = 0;

    let alignmentDone = false;

    tracker.onUpdate((update: TrackerUpdate) => {
        const dispenser = update.objects.find(
            o => o.name === 'dispenser' && o.type === 'quad' && o.corners && o.mode === 'tracking',
        );

        if (!dispenser || !dispenser.corners) {
            // No quad — clear overlay, track lost frames
            if (_trackerOverlaySvg && !alignmentDone) _trackerOverlaySvg.innerHTML = '';
            if (alignmentDone) {
                _lostFrameCount++;
                if (_lostFrameCount > LOST_THRESHOLD && _trackingLocked) {
                    _trackingLocked = false;
                    returnToCenter(panel);
                }
            }
            return;
        }

        _lostFrameCount = 0;
        const mapping = computeVideoMapping(video);

        if (!alignmentDone) {
            // Phase A: Alignment — render green quad, check proximity
            renderTrackerQuad(_trackerOverlaySvg!, dispenser.corners as [number, number][], mapping);

            const qc = quadCenter(dispenser.corners as [number, number][], mapping);
            const dc = {
                x: anchorRect.left + anchorRect.width / 2,
                y: anchorRect.top + anchorRect.height / 2,
            };

            if (checkAlignment(qc, dc)) {
                // Phase B: Handoff — dissolve square, remove overlay, engage tracking
                alignmentDone = true;

                // Remove tracker overlay (green polygon disappears)
                _trackerOverlaySvg?.remove();
                _trackerOverlaySvg = null;

                // Square bg already invisible — no dissolve needed

                // Cache device dimensions for homography
                _deviceW = bgRect.width;
                _deviceH = bgRect.height;

                // Add dark circle backdrop (65% of original square size)
                const circleSize = Math.max(_deviceW, _deviceH);
                const circle = document.createElement('div');
                circle.className = 'eject-tracking-circle';
                circle.style.width = `${circleSize}px`;
                circle.style.height = `${circleSize}px`;
                circle.style.left = `${_bgOffX - circleSize / 2}px`;
                circle.style.top = `${_bgOffY - circleSize / 2}px`;
                panel.appendChild(circle);

                // Normalize panel positioning for transform-driven movement
                panel.style.left = '0px';
                panel.style.top = '0px';
                panel.style.transformOrigin = '0px 0px';
                panel.classList.add('eject-tracking');

                // Clamp bar lengths to device radius
                _maxBarLen = Math.max(Math.max(_deviceW, _deviceH) / 2 - HUB_RADIUS, MIN_BAR);
                const maxBarLen = _maxBarLen;
                const radialBars = panel.querySelectorAll('.eject-radial-rect');
                radialBars.forEach(r => {
                    const w = parseFloat(r.getAttribute('width') || '0');
                    if (w > maxBarLen) r.setAttribute('width', String(maxBarLen));
                });

                // Initialize smooth corners from current tracked quad
                const screenCorners = normalizeQuadSize(
                    mapCornersToScreen(dispenser.corners as [number, number][], mapping),
                );
                _smoothCorners = screenCorners.flatMap(c => c);
                _trackingLocked = true;

                // Apply initial transform
                applyTrackedTransform(panel, screenCorners);
            }
        } else {
            // Phase C: Continuous tracking via homography matrix3d
            _trackingLocked = true;
            const screenCorners = normalizeQuadSize(
                mapCornersToScreen(dispenser.corners as [number, number][], mapping),
            );
            applyTrackedTransform(panel, screenCorners);
        }
    });

    tracker.onStatus(status => {
        console.log(`[Eject] Tracker: ${status}`);
    });

    tracker.connect();
    tracker.startTracking('dispenser');

    // Frame send loop
    let lastSend = 0;
    const tick = async (now: number) => {
        if (!_tracker) return;
        if (now - lastSend >= TRACKER_SEND_INTERVAL) {
            lastSend = now;
            const blob = await captureFrame();
            if (blob && _tracker?.isConnected) {
                _tracker.sendFrame(blob);
            }
        }
        _trackerRafId = requestAnimationFrame(tick);
    };
    _trackerRafId = requestAnimationFrame(tick);
}

/* ── Tracker: cleanup ──────────────────────────────────────── */

function stopEjectTrackerCapture(): void {
    if (_trackerRafId) {
        cancelAnimationFrame(_trackerRafId);
        _trackerRafId = 0;
    }
    if (_tracker) {
        _tracker.stopTracking();
        _tracker.disconnect();
        _tracker = null;
    }
    _trackerOverlaySvg?.remove();
    _trackerOverlaySvg = null;
    _trackingLocked = false;
    _trackerPanel?.classList.remove('eject-tracking');
    _trackerPanel = null;
}

/* ── Page fade (mirrors compile-animation.ts applyPageFade) ── */

const PAGE_FADE_IDS = [
    'prompt-section',
    'top-controls',
    'top-controls-right',
    'agent-match-panel',
    'multi-day-ribbon',
    'phase-chart-container',
    'timeline-ribbon',
    'pipeline-timeline',
    'sherlock-narration-panel',
] as const;

function applyPageFade(opacity: number): void {
    for (const id of PAGE_FADE_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.transition = 'opacity 0.55s ease';
        el.style.opacity = `${opacity}`;
    }
}

/* ── Delivery sequence (play pressed after radial) ─────────── */

const DELIVERY_MOVE_DUR = 900;

/* ── Camera feed helpers ──────────────────────────────────── */

let _cameraStream: MediaStream | null = null;

async function acquireCameraFeed(container: HTMLElement): Promise<HTMLVideoElement | null> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        _cameraStream = stream;
        const video = document.createElement('video');
        video.id = 'eject-camera-feed';
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        container.insertBefore(video, container.firstChild);
        // Fade in after a brief delay for the stream to start
        requestAnimationFrame(() => video.classList.add('visible'));
        return video;
    } catch (err) {
        console.warn('[Eject] Camera feed unavailable:', err);
        return null;
    }
}

function destroyEjectCamera(): void {
    stopEjectTrackerCapture();
    const vid = document.getElementById('eject-camera-feed') as HTMLVideoElement | null;
    if (vid) {
        const src = vid.srcObject as MediaStream | null;
        src?.getTracks().forEach(t => t.stop());
        vid.remove();
    }
    if (_cameraStream) {
        _cameraStream.getTracks().forEach(t => t.stop());
        _cameraStream = null;
    }
}

async function runDeliverySequence(panel: HTMLElement): Promise<void> {
    const bg = panel.querySelector('.eject-square-bg') as HTMLElement | null;
    if (!bg) return;

    // Keep radial loop alive — do NOT bump _runId

    // Compute where the device center is now (square bg center) in screen coords
    const bgRect = bg.getBoundingClientRect();
    const curCx = bgRect.left + bgRect.width / 2;
    const curCy = bgRect.top + bgRect.height / 2;

    // Target: viewport center
    const vpCx = window.innerWidth / 2;
    const vpCy = window.innerHeight / 2;
    const dx = vpCx - curCx;
    const dy = vpCy - curCy;

    // Fade all page elements (chart, sherlock, ribbons, etc.)
    applyPageFade(0);

    // Panel is already on body (moved there during eject phase).
    // Re-snapshot its rect and ensure delivery styling.
    const panelRect = panel.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.left = `${panelRect.left}px`;
    panel.style.top = `${panelRect.top}px`;
    panel.style.width = `${panelRect.width}px`;
    panel.style.right = 'auto';
    panel.style.opacity = '1';
    panel.style.pointerEvents = 'none';
    panel.style.zIndex = '1001'; // above compile-overlay (z:1000) so device sits over camera

    // Re-enable pointer events on the play button so 3rd press (camera) works
    const playBtnForEvents = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    if (playBtnForEvents) playBtnForEvents.style.pointerEvents = 'auto';

    // Animate panel so that the device center lands at viewport center
    await animate(
        DELIVERY_MOVE_DUR,
        t => {
            const x = lerp(0, dx, t);
            const y = lerp(0, dy, t);
            panel.style.transform = `translate(${x}px, ${y}px)`;
        },
        easeInOutCubic,
    );

    // Show the compile overlay and delivery timer
    const overlay = document.getElementById('compile-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('visible');

        // Position delivery timer below the device
        const delivery = overlay.querySelector('.compile-delivery') as HTMLElement | null;
        if (delivery) {
            const finalBgRect = bg.getBoundingClientRect();
            delivery.style.top = `${Math.round(finalBgRect.bottom + 30)}px`;
            delivery.classList.add('visible');
        }

        // Show tagline after a short delay
        await wait(500);
        const tagline = overlay.querySelector('.compile-tagline') as HTMLElement | null;
        tagline?.classList.add('visible');

        // Start countdown timer
        if (CompileState.countdownTimer !== null) {
            clearInterval(CompileState.countdownTimer);
            CompileState.countdownTimer = null;
        }

        const etaText = overlay.querySelector('.compile-eta-text');
        const barFill = overlay.querySelector('.compile-delivery-bar-fill') as HTMLElement | null;
        if (etaText && barFill) {
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
    }

    // Swap play icon to "Lx" branding now that device is front and center
    const lxBtn = panel.querySelector('.intervention-play-btn') as HTMLElement | null;
    if (lxBtn) {
        lxBtn.innerHTML =
            '<span style="font-family:\'Space Grotesk\',sans-serif;font-weight:600;font-size:20px;letter-spacing:-0.5px">Lx</span>';
    }

    // Mark delivery as active — next play-button press will start camera
    _deliveryActive = true;
}

/* ── Main entry ────────────────────────────────────────────── */

export async function runEjectAnimation(panel: HTMLElement): Promise<void> {
    // Third press: delivery done, device centered → start camera + tracker
    if (_deliveryActive) {
        _deliveryActive = false;
        const overlay = document.getElementById('compile-overlay');
        if (overlay) {
            const video = await acquireCameraFeed(overlay);
            if (video) {
                const startTracker = () => startEjectTrackerCapture(panel, video);
                // Video may already be playing (autoplay), or not yet
                if (video.readyState >= 2) {
                    startTracker();
                } else {
                    video.addEventListener('playing', startTracker, { once: true });
                }
            }
        }
        return;
    }

    // Second press: radial mode already active → trigger delivery sequence
    if (_radialActive) {
        _radialActive = false;
        runDeliverySequence(panel);
        return;
    }

    if (_active) return;
    _active = true;
    _runId += 1;
    const runId = _runId;

    // Switch multi-day speed to x3 on eject
    MultiDayState.speed = 4;
    const speedBtn = document.getElementById('day-speed-btn');
    if (speedBtn) speedBtn.textContent = '4x';

    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;

    // Create 3D device behind VCR module (front face visible)
    create3dDevice(panel);

    // Create square background element (will fade out during tilt)
    const bg = createSquareBg(panel);

    // Stage A: Absorb docks (don't await — overlap with B)
    const absorbPromise = absorbDocks(panel, runId);

    // Stage B: Expand to square (starts after EXPAND_DELAY)
    await wait(EXPAND_DELAY);
    if (_runId !== runId) {
        _active = false;
        return;
    }

    const expandPromise = expandToSquare(panel, bg, runId);

    // Stage C: Breach substance strip (starts after BREACH_DELAY from beginning)
    const breachStartDelay = Math.max(0, BREACH_DELAY - EXPAND_DELAY);
    await wait(breachStartDelay);
    if (_runId !== runId) {
        _active = false;
        return;
    }

    const breachPromise = breachSubstanceStrip(panel, bg, runId);

    // Wait for A, B, C to finish
    await Promise.all([absorbPromise, expandPromise, breachPromise]);
    if (_runId !== runId) {
        _active = false;
        return;
    }

    // Extract pill data NOW — right before radial wrap — so refs are fresh.
    // The multi-day loop keeps running (curves keep animating); we handle
    // stale pill refs inside radialWrap by querying the live DOM per-pill.
    const pills = svg ? extractPillData(svg) : [];

    // Stage D: Radial wrap
    const result = await radialWrap(panel, pills, runId);
    if (!result || _runId !== runId) {
        _active = false;
        return;
    }

    // Stage E: Continuous radial animation — bars flow smoothly across all 7 days
    startContinuousRadialLoop(result.radialSvg, runId);

    _radialActive = true;
    _active = false;
}

function showNoLabels() {
    document.querySelectorAll('.eject-radial-pill-label').forEach(el => {
        (el as SVGElement).style.display = 'none';
    });
}
function hideNoLabels() {
    document.querySelectorAll('.eject-radial-pill-label').forEach(el => {
        (el as SVGElement).style.display = '';
    });
}
