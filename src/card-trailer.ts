/**
 * card-trailer — Protocol trailer animation for expanded card modal.
 *
 * When the expanded card modal opens, the static hero thumbnail + frozen score
 * numbers turn into a "protocol trailer" that auto-plays: the hero SVG animates
 * through the Chess Player's substance-by-substance Lx build-up, a beat strip
 * narrates each addition, and the score numbers tick up in sync.
 *
 * Exports: initTrailer, stopTrailer
 * Depends on: lx-compute (computeIncrementalLxOverlay), effect-score (computeGapClosure),
 *             curve-utils (smoothPhaseValues), substances (SUBSTANCE_DB)
 */

import { computeIncrementalLxOverlay } from './lx-system';
import { computeGapClosure } from './effect-score';
import { smoothPhaseValues } from './curve-utils';
import { SUBSTANCE_DB } from './substances';
import { LxPlayer3D, preloadLxPlayerModel } from './lx-player-3d';
import { parseDoseMg } from './my-stream-store';
import { MY_STREAM } from './constants';
import { escapeHtml } from './utils';
import { easeOutCubic } from './timeline-engine';

// ── Interfaces ────────────────────────────────────────────────────

interface TrailerStep {
    dStrings: string[]; // SVG d-string per effect (0-1)
    lxPoints: Array<{ hour: number; value: number }>[]; // raw smoothed Lx points per effect (for interpolation)
    aucDStrings: string[]; // AUC fill d-string per effect (Lx-to-baseline)
    scores: number[]; // gap-closure % per effect
    substanceKey: string;
    substanceName: string;
    substanceColor: string;
    dose: string;
    timeMinutes: number;
    direction: 'up' | 'down' | 'neutral';
    beatText: string; // sherlock narration, may be ''
}

interface TrailerData {
    steps: TrailerStep[];
    baselineDStrings: string[]; // per effect
    baselinePoints: Array<{ hour: number; value: number }>[]; // raw baseline points per effect
    desiredDStrings: string[]; // per effect
    curveColors: string[]; // per effect
    numEffects: number;
}

// ── Constants ─────────────────────────────────────────────────────

const SVG_W = 200;
const SVG_H = 76;
const SVG_MARGIN_TOP = 4;
const SVG_MARGIN_BOT = 4;
const SVG_CURVE_H = SVG_H - SVG_MARGIN_TOP - SVG_MARGIN_BOT; // 68
const STEP_DURATION = 2000;
const MORPH_DURATION = 1500;
const AUC_FADE_MS = 800;
const SCORE_COUNT_MS = 400;
const LOOP_HOLD_MS = 3000;
const DEVICE_REVEAL_MS = 600;
const BEAT_CROSSFADE_MS = 400;
const HERO_CROSSFADE_MS = 520;
const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Coordinate mappers ────────────────────────────────────────────

const xForHour = (i: number, n: number) => (i / (n - 1)) * SVG_W;
const yForValue = (v: number) => SVG_MARGIN_TOP + SVG_CURVE_H - (v / 100) * SVG_CURVE_H;

// ── Module-level state ────────────────────────────────────────────

let _trailerActive = false;
let _activeStep = -1;
let _stepTimer: ReturnType<typeof setTimeout> | null = null;
let _startTimer: ReturnType<typeof setTimeout> | null = null;
const _counterRafIds: Set<number> = new Set();
let _trailerData: TrailerData | null = null;
let _svgEl: SVGSVGElement | null = null;
let _beatStripEl: HTMLElement | null = null;
let _scoreEls: HTMLElement[] = [];
let _cloneRef: HTMLElement | null = null;
let _loopTimer: ReturnType<typeof setTimeout> | null = null;
let _deviceContainerEl: HTMLElement | null = null;
let _player3d: LxPlayer3D | null = null;
let _beatSlotActive: 'a' | 'b' = 'a';
let _heroCrossfadeTimer: ReturnType<typeof setTimeout> | null = null;
let _sourceHeroSvgEl: SVGElement | null = null;

// ── Deferred 3D device init ───────────────────────────────────────
// The 3D device is heavy: ~10 MB JSON model, ~600 BufferGeometry instances,
// antialiased Three.js renderer at devicePixelRatio. Initializing it
// immediately after the FLIP introduces a 250-500ms sync block plus a
// concurrent render loop competing with the trailer's SVG morph rAFs.
// We defer creation until the user hovers the device slot OR the panel
// has been idle long enough that init can happen without disturbing the
// trailer playback. Tablet reveals that fire before init lands are
// queued and replayed once the player is ready.
interface PendingTabletReveal {
    idx: number;
    color: string;
    capsule: boolean;
    duration: number;
}
let _device3DSlotEl: HTMLElement | null = null;
let _device3DInitArmed = false;
let _device3DPendingTablets: PendingTabletReveal[] = [];
let _device3DHoverHandler: (() => void) | null = null;
let _device3DIdleId: number | null = null;
let _device3DIdleTimer: ReturnType<typeof setTimeout> | null = null;

// ── Utility ───────────────────────────────────────────────────────

function formatTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(Math.round(m)).padStart(2, '0')}`;
}

/**
 * Monotone cubic interpolation path builder for the trailer SVG.
 * Takes raw {hour, value} points in domain coords, transforms to SVG coords,
 * and returns a smooth SVG `d` string using Fritsch-Carlson method.
 */
function trailerPath(rawPoints: Array<{ hour: number; value: number }>): string {
    if (!rawPoints || rawPoints.length < 2) return '';

    const coords = rawPoints.map((p, i) => ({
        x: xForHour(i, rawPoints.length),
        y: yForValue(p.value),
    }));

    const n = coords.length;
    if (n === 2) {
        return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`;
    }

    // Verify strict x ordering
    for (let i = 0; i < n - 1; i++) {
        if (!(coords[i + 1].x > coords[i].x)) {
            let linear = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
            for (let j = 1; j < n; j++) {
                linear += ` L ${coords[j].x.toFixed(1)} ${coords[j].y.toFixed(1)}`;
            }
            return linear;
        }
    }

    // Fritsch-Carlson monotone cubic
    const dx = new Array(n - 1);
    const dy = new Array(n - 1);
    const m = new Array(n - 1);
    const t = new Array(n);

    for (let i = 0; i < n - 1; i++) {
        dx[i] = coords[i + 1].x - coords[i].x;
        dy[i] = coords[i + 1].y - coords[i].y;
        m[i] = dy[i] / dx[i];
    }

    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
        if (m[i - 1] === 0 || m[i] === 0 || m[i - 1] * m[i] <= 0) {
            t[i] = 0;
        } else {
            const w1 = 2 * dx[i] + dx[i - 1];
            const w2 = dx[i] + 2 * dx[i - 1];
            t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
        }
    }

    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
        const p0 = coords[i];
        const p1 = coords[i + 1];
        const h = dx[i];
        const cp1x = p0.x + h / 3;
        const cp1y = p0.y + (t[i] * h) / 3;
        const cp2x = p1.x - h / 3;
        const cp2y = p1.y - (t[i + 1] * h) / 3;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }

    return d;
}

/**
 * Build a closed AUC fill path between the Lx curve (top) and baseline (bottom).
 * Traces the Lx curve left-to-right, then the baseline right-to-left, then closes.
 */
function trailerAucPath(
    lxPoints: Array<{ hour: number; value: number }>,
    blPoints: Array<{ hour: number; value: number }>,
): string {
    if (!lxPoints || !blPoints || lxPoints.length < 2 || blPoints.length < 2) return '';

    const n = Math.min(lxPoints.length, blPoints.length);

    // Forward trace: Lx curve
    let d = `M ${xForHour(0, n).toFixed(1)} ${yForValue(lxPoints[0].value).toFixed(1)}`;
    for (let i = 1; i < n; i++) {
        d += ` L ${xForHour(i, n).toFixed(1)} ${yForValue(lxPoints[i].value).toFixed(1)}`;
    }

    // Backward trace: baseline
    for (let i = n - 1; i >= 0; i--) {
        d += ` L ${xForHour(i, n).toFixed(1)} ${yForValue(blPoints[i].value).toFixed(1)}`;
    }

    return d + ' Z';
}

// ── Arrow SVGs ────────────────────────────────────────────────────

const ARROW_UP =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(74,222,128,0.9)" stroke-width="2.5" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const ARROW_DOWN =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.9)" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
const ARROW_NEUTRAL =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.9)" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>';

function directionFromImpacts(impacts: any): 'up' | 'down' | 'neutral' {
    if (!impacts || typeof impacts !== 'object') return 'neutral';
    let sum = 0;
    for (const v of Object.values(impacts)) {
        if (typeof v === 'number') sum += v;
    }
    if (sum > 0.01) return 'up';
    if (sum < -0.01) return 'down';
    return 'neutral';
}

function arrowSvg(dir: 'up' | 'down' | 'neutral'): string {
    if (dir === 'up') return ARROW_UP;
    if (dir === 'down') return ARROW_DOWN;
    return ARROW_NEUTRAL;
}

function buildCinematicBeatHtml(step: TrailerStep): string {
    return (
        `<div class="cg-trailer-beat cg-trailer-beat-cinematic">` +
        `<div class="cg-trailer-beat-head">` +
        `<span class="cg-trailer-beat-arrow">${arrowSvg(step.direction)}</span>` +
        `<span class="cg-trailer-beat-name" style="color:${step.substanceColor}">${escapeHtml(step.substanceName)}</span>` +
        `</div>` +
        `<div class="cg-trailer-beat-meta">` +
        `<span class="cg-trailer-beat-time">${formatTime(step.timeMinutes)}</span>` +
        `<span class="cg-trailer-beat-sep">&middot;</span>` +
        `<span class="cg-trailer-beat-dose">${escapeHtml(step.dose)}</span>` +
        `</div>` +
        (step.beatText
            ? `<div class="cg-trailer-beat-text" style="opacity:0">${escapeHtml(step.beatText)}</div>`
            : '') +
        `</div>`
    );
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Initialize the protocol trailer for an expanded card.
 * Called from `loadAndEnrich()` in `card-expander.ts` after the bundle loads.
 */
export function initTrailer(clone: HTMLElement, bundle: any, _cycleId: string): void {
    // Tear down any previous trailer
    stopTrailer();
    clone.removeAttribute('data-trailer-title');

    // 1. Extract data from bundle
    const interventions: any[] = bundle?.stages?.['intervention-model']?.payload?.interventions;
    if (!Array.isArray(interventions) || interventions.length === 0) return;

    const curvesData: any[] = bundle?.stages?.['main-model']?.payload?.curves;
    if (!Array.isArray(curvesData) || curvesData.length === 0) return;

    const beats: any[] = bundle?.stages?.['sherlock-model']?.payload?.beats || [];

    // 2. Compute incremental snapshots
    const snapshots = computeIncrementalLxOverlay(interventions, curvesData);
    if (!Array.isArray(snapshots) || snapshots.length === 0) return;

    const numEffects = Math.min(curvesData.length, 2);

    // Sort interventions by timeMinutes (same order as snapshots)
    const sortedIvs = [...interventions].sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);

    // 3. Precompute per-step data
    // Baseline and desired d-strings (same for all steps)
    const baselineDStrings: string[] = [];
    const baselinePoints: Array<{ hour: number; value: number }>[] = [];
    const desiredDStrings: string[] = [];
    const curveColors: string[] = [];

    for (let e = 0; e < numEffects; e++) {
        const blRaw = snapshots[0].lxCurves[e]?.baseline || curvesData[e]?.baseline || [];
        const dsRaw = snapshots[0].lxCurves[e]?.desired || curvesData[e]?.desired || [];
        const blSmoothed = smoothPhaseValues(blRaw);
        baselineDStrings.push(trailerPath(blSmoothed));
        baselinePoints.push(blSmoothed);
        desiredDStrings.push(trailerPath(dsRaw));
        curveColors.push(curvesData[e]?.color || '#60a5fa');
    }

    // Per-step data
    const steps: TrailerStep[] = [];
    for (let k = 0; k < snapshots.length; k++) {
        const snap = snapshots[k];
        const iv = sortedIvs[k] || snap.step?.[0] || {};
        const key: string = iv.key || '';
        const dbEntry = SUBSTANCE_DB[key];

        // Per-effect curve and score data
        const dStrings: string[] = [];
        const stepLxPoints: Array<{ hour: number; value: number }>[] = [];
        const aucDStrings: string[] = [];
        const scores: number[] = [];

        for (let e = 0; e < numEffects; e++) {
            const lxCurve = snap.lxCurves[e];
            if (!lxCurve) {
                dStrings.push('');
                stepLxPoints.push([]);
                aucDStrings.push('');
                scores.push(0);
                continue;
            }

            // Smooth the Lx points and compute path
            const smoothed = smoothPhaseValues(lxCurve.points);
            dStrings.push(trailerPath(smoothed));
            stepLxPoints.push(smoothed);

            // Incremental AUC fill: area between THIS step's Lx and the PREVIOUS step's Lx
            // (or baseline for the first step). This gives each substance its own colored band.
            let bottomPts: Array<{ hour: number; value: number }>;
            if (k === 0) {
                bottomPts = lxCurve.baseline || curvesData[e]?.baseline || [];
            } else {
                const prevSnap = snapshots[k - 1];
                const prevLx = prevSnap?.lxCurves[e];
                bottomPts = prevLx
                    ? smoothPhaseValues(prevLx.points)
                    : lxCurve.baseline || curvesData[e]?.baseline || [];
            }
            aucDStrings.push(trailerAucPath(smoothed, bottomPts));

            // Gap-closure score
            const gc = computeGapClosure(
                lxCurve.points,
                lxCurve.baseline || curvesData[e]?.baseline || [],
                lxCurve.desired || curvesData[e]?.desired || [],
                lxCurve.polarity || curvesData[e]?.polarity,
            );
            scores.push(gc != null ? gc : 0);
        }

        // Match sherlock beat by substanceKey
        let beatText = '';
        for (const b of beats) {
            if (b?.substanceKey === key) {
                beatText = b.text || '';
                break;
            }
        }

        steps.push({
            dStrings,
            lxPoints: stepLxPoints,
            aucDStrings,
            scores,
            substanceKey: key,
            substanceName: dbEntry?.name || key,
            substanceColor: dbEntry?.color || '#60a5fa',
            dose: iv.dose || dbEntry?.standardDose || '',
            timeMinutes: typeof iv.timeMinutes === 'number' ? iv.timeMinutes : 480,
            direction: directionFromImpacts(iv.impacts),
            beatText,
        });
    }

    _trailerData = { steps, baselineDStrings, baselinePoints, desiredDStrings, curveColors, numEffects };

    // 4. Build the dynamic hero SVG
    const iconEl = clone.querySelector('.cg-card-icon');
    if (!iconEl) return;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.classList.add('cg-trailer-hero-svg');

    // Background
    const bgRect = document.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('width', String(SVG_W));
    bgRect.setAttribute('height', String(SVG_H));
    bgRect.setAttribute('fill', '#0e1118');
    svg.appendChild(bgRect);

    // Per-effect static paths (baseline + desired) and dynamic paths (Lx + per-step AUC bands)
    for (let e = 0; e < numEffects; e++) {
        const color = curveColors[e];

        // Baseline (dashed)
        const blPath = document.createElementNS(SVG_NS, 'path');
        blPath.setAttribute('d', baselineDStrings[e]);
        blPath.setAttribute('fill', 'none');
        blPath.setAttribute('stroke', color);
        blPath.setAttribute('stroke-opacity', '0.3');
        blPath.setAttribute('stroke-dasharray', '2 2');
        blPath.setAttribute('stroke-width', '0.5');
        svg.appendChild(blPath);

        // Desired (dotted)
        const dsPath = document.createElementNS(SVG_NS, 'path');
        dsPath.setAttribute('d', desiredDStrings[e]);
        dsPath.setAttribute('fill', 'none');
        dsPath.setAttribute('stroke', color);
        dsPath.setAttribute('stroke-opacity', '0.15');
        dsPath.setAttribute('stroke-dasharray', '1 2');
        dsPath.setAttribute('stroke-width', '0.8');
        svg.appendChild(dsPath);

        // Per-step AUC bands — one path per substance per effect, each with its own color.
        // Pre-created hidden; revealed incrementally by _stepTrailer().
        for (let k = 0; k < steps.length; k++) {
            const aucPath = document.createElementNS(SVG_NS, 'path');
            aucPath.setAttribute('d', '');
            aucPath.setAttribute('fill', steps[k].substanceColor);
            aucPath.setAttribute('fill-opacity', '0');
            aucPath.setAttribute('data-trailer-auc-step', `${e}-${k}`);
            svg.appendChild(aucPath);
        }

        // Lx overlay — starts at the LAST step's curve (matching the source
        // thumbnail) so the hero crossfade is seamless. _beginHeroCrossfade()
        // will morph it back to baseline before the substance build-up starts.
        const lastStepD = steps.length > 0 ? steps[steps.length - 1].dStrings[e] : baselineDStrings[e];
        const lxPath = document.createElementNS(SVG_NS, 'path');
        lxPath.setAttribute('d', lastStepD || baselineDStrings[e]);
        lxPath.setAttribute('fill', 'none');
        lxPath.setAttribute('stroke', color);
        lxPath.setAttribute('stroke-width', '1.5');
        lxPath.setAttribute('data-trailer-lx', String(e));
        svg.appendChild(lxPath);
    }

    const existingHeroSvg = Array.from(iconEl.children).find(child => child.tagName.toLowerCase() === 'svg') as
        | SVGElement
        | undefined;
    if (existingHeroSvg) {
        existingHeroSvg.classList.add('cg-trailer-source-svg');
        _sourceHeroSvgEl = existingHeroSvg;
        iconEl.appendChild(svg);
    } else {
        iconEl.prepend(svg);
        _sourceHeroSvgEl = null;
    }
    _svgEl = svg;

    // The 3D device is the heaviest piece of post-FLIP work. Don't init it
    // up front — show a placeholder slot, then bring up Three.js on the
    // first hover OR after a long idle window. Tablet reveals that fire
    // before init lands are queued and replayed.
    const panelEl = clone.querySelector('.cg-card-expand-panel');
    if (panelEl) {
        const slotEl = panelEl.querySelector('.cg-trailer-device-slot') as HTMLElement | null;
        if (slotEl) {
            slotEl.classList.add('cg-trailer-device-slot--pending');
            _device3DSlotEl = slotEl;
            _device3DInitArmed = true;
            _device3DPendingTablets = [];
            _scheduleDeferredDeviceInit(slotEl);
        }
    }

    // 5. Populate the pre-built score grid (3-column structure was created
    //    in card-expander.ts to keep the layout stable from the start).
    //    We just fill in the beat slots and hook text, then fade them in.
    const beatsLeft = clone.querySelector('.cg-trailer-beats-left') as HTMLElement | null;
    if (beatsLeft) {
        const slotA = document.createElement('div');
        slotA.className = 'cg-trailer-beat-slot cg-trailer-beat-slot-a';
        const slotB = document.createElement('div');
        slotB.className = 'cg-trailer-beat-slot cg-trailer-beat-slot-b';
        slotB.style.opacity = '0';
        beatsLeft.appendChild(slotA);
        beatsLeft.appendChild(slotB);
        _beatStripEl = beatsLeft;

        // Fade in beats
        requestAnimationFrame(() => {
            beatsLeft.style.opacity = '1';
        });
    }

    const hookEl = clone.querySelector('.cg-expand-hook') as HTMLElement | null;
    if (hookEl) {
        const hookText: string = bundle?.stages?.['fast-model']?.payload?.hookSentence || '';
        if (hookText) hookEl.textContent = hookText;
        requestAnimationFrame(() => {
            hookEl.style.opacity = '1';
        });
    }

    // Collect score value elements
    _scoreEls = Array.from(clone.querySelectorAll('.cg-card-score-entry-value'));

    _cloneRef = clone;
    _trailerActive = true;
    _activeStep = -1;

    // 6. Start auto-play after a short beat (card is already in final layout)
    _startTimer = setTimeout(() => {
        _startTimer = null;
        _beginHeroCrossfade();
        // Stagger device reveal 300ms after hero crossfade begins
        setTimeout(_revealDevice, 300);
        _stepTimer = setTimeout(() => {
            _stepTimer = null;
            _advanceStep();
        }, HERO_CROSSFADE_MS + 80);
    }, 200);
}

/**
 * Stop the trailer: cancel all timers and rAF loops, clear state.
 */
export function stopTrailer(): void {
    _trailerActive = false;
    _activeStep = -1;

    if (_stepTimer != null) {
        clearTimeout(_stepTimer);
        _stepTimer = null;
    }
    if (_startTimer != null) {
        clearTimeout(_startTimer);
        _startTimer = null;
    }
    if (_loopTimer != null) {
        clearTimeout(_loopTimer);
        _loopTimer = null;
    }
    for (const id of _counterRafIds) cancelAnimationFrame(id);
    _counterRafIds.clear();
    if (_heroCrossfadeTimer != null) {
        clearTimeout(_heroCrossfadeTimer);
        _heroCrossfadeTimer = null;
    }

    _trailerData = null;
    _svgEl = null;
    _cloneRef?.removeAttribute('data-trailer-title');
    _sourceHeroSvgEl = null;
    _clearDevice3DSchedule();
    _device3DPendingTablets = [];
    _device3DSlotEl = null;
    if (_player3d) {
        _player3d.stopRenderLoop();
        _player3d.dispose();
        _player3d = null;
    }
    _deviceContainerEl = null;
    _beatSlotActive = 'a';
    _beatStripEl = null;
    _scoreEls = [];
    _cloneRef = null;
}

interface PathMorphTrack {
    el: SVGPathElement;
    from: Array<{ hour: number; value: number }>;
    to: Array<{ hour: number; value: number }>;
}

/**
 * Drive multiple SVG path morphs from one shared rAF callback instead of
 * spawning a separate rAF chain per effect. Cuts scheduling overhead and
 * keeps all path writes in a single frame batch.
 */
function _runMultiPathMorph(tracks: PathMorphTrack[], durationMs: number): void {
    if (tracks.length === 0) return;
    const start = performance.now();
    const tick = () => {
        if (!_trailerActive) return;
        const elapsed = performance.now() - start;
        const raw = Math.min(1, elapsed / durationMs);
        const t = easeOutCubic(raw);
        for (let k = 0; k < tracks.length; k++) {
            const track = tracks[k];
            const from = track.from;
            const to = track.to;
            const n = Math.min(from.length, to.length);
            const interp: Array<{ hour: number; value: number }> = new Array(n);
            for (let i = 0; i < n; i++) {
                interp[i] = {
                    hour: from[i].hour + (to[i].hour - from[i].hour) * t,
                    value: from[i].value + (to[i].value - from[i].value) * t,
                };
            }
            track.el.setAttribute('d', trailerPath(interp));
        }
        if (raw < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/**
 * Wire hover-to-init and a long idle-callback fallback for the 3D device.
 * The first of the two to fire triggers the actual scene build; the other
 * is cancelled by stopTrailer or by _ensureDevice3DInit itself.
 */
function _scheduleDeferredDeviceInit(slotEl: HTMLElement): void {
    const fire = () => {
        if (!_device3DInitArmed) return;
        _device3DInitArmed = false;
        _ensureDevice3DInit();
    };
    _device3DHoverHandler = fire;
    slotEl.addEventListener('mouseenter', fire, { once: true });
    const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
        _device3DIdleId = w.requestIdleCallback(
            () => {
                _device3DIdleId = null;
                fire();
            },
            { timeout: 2500 },
        );
    } else {
        _device3DIdleTimer = setTimeout(fire, 1500);
    }
}

function _clearDevice3DSchedule(): void {
    const w = window as unknown as { cancelIdleCallback?: (id: number) => void };
    if (_device3DIdleId != null && typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(_device3DIdleId);
    }
    _device3DIdleId = null;
    if (_device3DIdleTimer != null) {
        clearTimeout(_device3DIdleTimer);
        _device3DIdleTimer = null;
    }
    if (_device3DSlotEl && _device3DHoverHandler) {
        _device3DSlotEl.removeEventListener('mouseenter', _device3DHoverHandler);
    }
    _device3DHoverHandler = null;
    _device3DInitArmed = false;
}

/**
 * Actually build the Three.js scene and replace the placeholder. Safe to
 * call multiple times — only the first call does work. Tablet reveals
 * queued during the deferred window are flushed once the model loads.
 */
function _ensureDevice3DInit(): void {
    if (_player3d) return;
    const slotEl = _device3DSlotEl;
    if (!slotEl || !_trailerActive) return;
    _clearDevice3DSchedule();
    try {
        const deviceContainer = document.createElement('div');
        deviceContainer.className = 'cg-trailer-device';

        const slotWidth = Math.round(slotEl.getBoundingClientRect().width || 0);
        const devSize = Math.round(Math.min(560, Math.max(320, slotWidth || 420)) * 1.4);
        const player = new LxPlayer3D({ width: devSize, height: devSize });
        const canvas = player.getCanvas();
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.opacity = '0';
        deviceContainer.appendChild(canvas);

        slotEl.classList.remove('cg-trailer-device-slot--pending');
        slotEl.replaceChildren(deviceContainer);

        _deviceContainerEl = deviceContainer;
        _player3d = player;

        void preloadLxPlayerModel('v1').then(parts => {
            if (!_trailerActive || !_player3d) return;
            _player3d.loadModel(parts, 'v1');
            _player3d.prepareTabletsHidden();
            _player3d.setCameraPreset('isometric');
            _player3d.startRenderLoop();

            // Fade the canvas in and start the spin now that the scene is
            // ready (the trailer's _revealDevice timer fired earlier and
            // was a no-op while _player3d was null).
            const c = _player3d.getCanvas();
            c.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration: DEVICE_REVEAL_MS,
                easing: 'ease-out',
                fill: 'forwards',
            });
            _player3d.startSpin(0.3, DEVICE_REVEAL_MS + 250);

            // Flush any tablet reveals that happened before init landed.
            const pending = _device3DPendingTablets;
            _device3DPendingTablets = [];
            for (const t of pending) {
                _player3d.revealTablet(t.idx, t.color, t.capsule, t.duration);
            }
        });
    } catch {
        if (_player3d) {
            (_player3d as LxPlayer3D).dispose();
            _player3d = null;
        }
        _deviceContainerEl = null;
    }
}

function _beginHeroCrossfade(): void {
    if (!_svgEl || !_trailerData) return;
    const data = _trailerData;

    _cloneRef?.setAttribute('data-trailer-title', 'expanded');
    requestAnimationFrame(() => {
        _svgEl?.classList.add('cg-trailer-hero-svg--visible');
        _sourceHeroSvgEl?.classList.add('cg-trailer-source-svg--fade');
    });

    // Simultaneously morph Lx curves from last-step (matching thumbnail) → baseline.
    // This keeps the crossfade seamless: the trailer SVG starts at the same visual
    // state as the source thumbnail, then "deflates" to baseline before the build-up.
    const tracks: PathMorphTrack[] = [];
    for (let e = 0; e < data.numEffects; e++) {
        const lxEl = _svgEl.querySelector(`[data-trailer-lx="${e}"]`) as SVGPathElement | null;
        if (!lxEl) continue;

        const fromPts = data.steps.length > 0 ? data.steps[data.steps.length - 1].lxPoints[e] : data.baselinePoints[e];
        const toPts = data.baselinePoints[e];
        if (!fromPts || !toPts || fromPts.length === 0 || toPts.length === 0) continue;

        tracks.push({ el: lxEl, from: fromPts, to: toPts });
    }
    _runMultiPathMorph(tracks, HERO_CROSSFADE_MS);

    if (_heroCrossfadeTimer != null) {
        clearTimeout(_heroCrossfadeTimer);
    }
    _heroCrossfadeTimer = setTimeout(() => {
        if (_sourceHeroSvgEl?.isConnected) {
            _sourceHeroSvgEl.remove();
        }
        _sourceHeroSvgEl = null;
        _heroCrossfadeTimer = null;
    }, HERO_CROSSFADE_MS + 100);
}

// ── Internal stepping ─────────────────────────────────────────────

function _revealDevice(): void {
    if (!_player3d) return;
    const canvas = _player3d.getCanvas();
    canvas.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: DEVICE_REVEAL_MS,
        easing: 'ease-out',
        fill: 'forwards',
    });
    _player3d.startSpin(0.3, DEVICE_REVEAL_MS + 250);
}

function _advanceStep(): void {
    if (!_trailerActive || !_trailerData) return;

    _activeStep++;

    if (_activeStep >= _trailerData.steps.length) {
        _finishTrailerPlayback();
        return;
    }

    _stepTrailer();
}

function _stepTrailer(): void {
    if (!_trailerActive || !_trailerData || !_svgEl) return;

    const data = _trailerData;
    const stepIdx = _activeStep;
    const step = data.steps[stepIdx];
    if (!step) return;

    // ── 1. Smooth curve morph (point-by-point interpolation over MORPH_DURATION) ──
    // Build the per-effect track list, then run all morphs from a single
    // shared rAF callback rather than N parallel chains.

    const stepTracks: PathMorphTrack[] = [];
    for (let e = 0; e < data.numEffects; e++) {
        const lxEl = _svgEl.querySelector(`[data-trailer-lx="${e}"]`) as SVGPathElement | null;
        if (!lxEl) continue;

        const nextPts = step.lxPoints[e];
        if (!nextPts || nextPts.length === 0) continue;

        // Get the previous step's points (or baseline for step 0)
        const prevPts =
            stepIdx > 0 ? data.steps[stepIdx - 1]?.lxPoints[e] || data.baselinePoints[e] : data.baselinePoints[e];

        if (!prevPts || prevPts.length === 0) {
            lxEl.setAttribute('d', step.dStrings[e]);
            continue;
        }

        stepTracks.push({ el: lxEl, from: prevPts, to: nextPts });
    }
    _runMultiPathMorph(stepTracks, MORPH_DURATION);

    // ── 2. AUC bands — reveal this step's incremental band (previous bands stay visible) ──

    for (let e = 0; e < data.numEffects; e++) {
        const aucEl = _svgEl.querySelector(`[data-trailer-auc-step="${e}-${stepIdx}"]`) as SVGPathElement | null;
        if (!aucEl) continue;

        const aucD = step.aucDStrings[e];
        if (!aucD) continue;

        aucEl.setAttribute('d', aucD);

        // Fade in this substance's band — previous bands remain at 0.25
        aucEl.animate([{ fillOpacity: 0 }, { fillOpacity: 0.25 }], {
            duration: AUC_FADE_MS,
            easing: 'ease-out',
            fill: 'forwards',
        });
    }

    // ── 3. Tablet reveal — load this step's substance into the cartridge ──
    //    Capsule (>300mg) = full-height mesh; tablet (≤300mg) = 1/5 height.
    //    If the 3D scene hasn't initialized yet (deferred to hover/idle),
    //    queue the reveal so it plays back once the player is ready.

    if (_trailerData) {
        const isCapsule = parseDoseMg(step.dose) > MY_STREAM.capsuleThresholdMg;
        if (_player3d) {
            _player3d.revealTablet(_activeStep, step.substanceColor, isCapsule, 500);
        } else if (_device3DInitArmed) {
            _device3DPendingTablets.push({
                idx: _activeStep,
                color: step.substanceColor,
                capsule: isCapsule,
                duration: 500,
            });
        }
    }

    // ── 4. Beat strip — single cinematic cross-fade ─────────────────

    if (_beatStripEl) {
        const activeClass = `cg-trailer-beat-slot-${_beatSlotActive}`;
        const nextSlotId = _beatSlotActive === 'a' ? 'b' : 'a';
        const nextClass = `cg-trailer-beat-slot-${nextSlotId}`;

        const activeSlotEl = _beatStripEl.querySelector(`.${activeClass}`) as HTMLElement | null;
        const nextSlotEl = _beatStripEl.querySelector(`.${nextClass}`) as HTMLElement | null;

        if (nextSlotEl) {
            nextSlotEl.innerHTML = buildCinematicBeatHtml(step);
        }

        // Cross-fade: active out, next in
        if (activeSlotEl && stepIdx > 0) {
            activeSlotEl.animate(
                [
                    { opacity: 1, transform: 'translateY(0)' },
                    { opacity: 0, transform: 'translateY(-12px)' },
                ],
                { duration: BEAT_CROSSFADE_MS, easing: 'ease-in', fill: 'forwards' },
            );
        }
        if (nextSlotEl) {
            nextSlotEl.style.opacity = '0';
            nextSlotEl.animate(
                [
                    { opacity: 0, transform: 'translateY(12px)' },
                    { opacity: 1, transform: 'translateY(0)' },
                ],
                { duration: BEAT_CROSSFADE_MS, easing: 'ease-out', fill: 'forwards' },
            );

            // Reveal beat text after a short delay — direct style.opacity, no WAAPI
            setTimeout(() => {
                if (!_trailerActive) return;
                const textEl = nextSlotEl.querySelector('.cg-trailer-beat-text') as HTMLElement | null;
                if (textEl) textEl.style.opacity = '1';
            }, 250);
        }

        _beatSlotActive = nextSlotId;
    }

    // ── 5. Score counter ─────────────────────────────────────────

    if (_scoreEls.length > 0) {
        for (let e = 0; e < Math.min(_scoreEls.length, data.numEffects); e++) {
            const el = _scoreEls[e];
            if (!el) continue;

            const prevScore = stepIdx > 0 ? (data.steps[stepIdx - 1]?.scores[e] ?? 0) : 0;
            const nextScore = step.scores[e] ?? 0;

            _animateCounter(el, prevScore, nextScore, SCORE_COUNT_MS);
        }
    }

    // ── Schedule next step ───────────────────────────────────────

    _stepTimer = setTimeout(() => {
        _stepTimer = null;
        _advanceStep();
    }, STEP_DURATION);
}

/**
 * Animate a score counter element from one value to another.
 */
function _animateCounter(el: HTMLElement, from: number, to: number, durationMs: number): void {
    const start = performance.now();

    const tick = () => {
        if (!_trailerActive) return;
        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / durationMs);
        const eased = easeOutCubic(t);
        const current = from + (to - from) * eased;
        el.textContent = `+${Math.round(current)}%`;

        if (t < 1) {
            const id = requestAnimationFrame(tick);
            _counterRafIds.add(id);
        }
    };

    const id = requestAnimationFrame(tick);
    _counterRafIds.add(id);
}

/**
 * Hold the finished state briefly, then let the device settle into a static pose.
 */
function _finishTrailerPlayback(): void {
    if (!_trailerActive) return;
    _loopTimer = setTimeout(() => {
        if (!_trailerActive) return;
        _loopTimer = null;
        _player3d?.stopSpin();
    }, LOOP_HOLD_MS);
}
