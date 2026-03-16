/**
 * Substance Wall — Dense mosaic of all substances rendered as SVG bars
 * inside the plot area of #phase-chart-svg, replacing the curves.
 * Uses the same visual style as the substance timeline pills.
 *
 * The wall is a "living dataset": bars pulsate with sinusoidal opacity
 * waves and randomly swap positions in a smooth animated shuffle,
 * conveying the impression of a continuously evolving model.
 *
 * Three-state toggle:
 *   Phase 0 — Off (curves visible)
 *   Phase 1 — Single flat wall with quantum fabric animation
 *   Phase 2 — 3D depth: front wall swivels, ~10 layers recede into horizon
 *
 * Exports: activateSubstanceWall, deactivateSubstanceWall, isWallActive,
 *          refreshWallRxFilter, getWallPhase, expandWallDepth
 * Depends on: constants, utils, substances
 */

import { PHASE_CHART, TIMELINE_ZONE } from './constants';
import { svgEl, clamp } from './utils';
import { SUBSTANCE_DB, getActiveSubstances } from './substances';

// ============================================
// Constants
// ============================================

const WALL_GROUP_ID = 'phase-substance-wall';
const BAR_H = TIMELINE_ZONE.laneH; // same height as timeline pills
const BAR_GAP = 2;
const BAR_RX = TIMELINE_ZONE.pillRx; // same rounding as timeline pills

// SVG groups we hide while wall is active
const HIDDEN_GROUPS = [
    'phase-baseline-curves',
    'phase-desired-curves',
    'phase-lx-curves',
    'phase-substance-timeline',
    'phase-lx-bands',
];

// ============================================
// Module state
// ============================================

interface WallTile {
    group: Element;
    bar: Element;
    label: Element;
    clipRect: Element;
    isActive: boolean;
    key: string;
    color: string;
    /** Current grid slot index (changes on swap). */
    slotIdx: number;
}

interface WallState {
    active: boolean;
    /** 0 = off, 1 = flat wall, 2 = 3D depth perspective */
    wallPhase: 0 | 1 | 2;
    tiles: WallTile[];
    activeKeys: Set<string>;
    fluxRafId: number | null;
    wallGroup: Element | null;
    /** Depth-layer <g> elements created during phase 2. */
    depthLayers: Element[];
    /** Depth bars indexed by tile slot — each slot maps to bars across all layers. */
    depthBarMap: Element[][];
    /** Per-layer animation params for fan-in/out. */
    depthParams: { scale: number; tx: number; ty: number; opacity: number }[];
    /** VP coordinates used for depth transforms. */
    vpX: number;
    vpY: number;
    savedGroupVisibility: Map<string, string>;
    /** Mouse hover tracking (SVG coordinates). */
    mouseX: number;
    mouseY: number;
    mouseInSvg: boolean;
    mouseHandler: ((e: MouseEvent) => void) | null;
    mouseLeaveHandler: (() => void) | null;
    /** Grid layout info. */
    cols: number;
    colW: number;
    colGap: number;
    plotLeft: number;
    wallTopY: number;
    barStep: number;
}

const state: WallState = {
    active: false,
    wallPhase: 0,
    tiles: [],
    activeKeys: new Set(),
    fluxRafId: null,
    wallGroup: null,
    depthLayers: [],
    depthBarMap: [],
    depthParams: [],
    vpX: 0,
    vpY: 0,
    savedGroupVisibility: new Map(),
    mouseX: -9999,
    mouseY: -9999,
    mouseInSvg: false,
    mouseHandler: null,
    mouseLeaveHandler: null,
    cols: 6,
    colW: 120,
    colGap: 3,
    plotLeft: PHASE_CHART.padL,
    wallTopY: PHASE_CHART.padT + 4,
    barStep: BAR_H + BAR_GAP,
};

// ============================================
// Public API
// ============================================

export function isWallActive(): boolean {
    return state.active;
}

export function getWallPhase(): number {
    return state.wallPhase;
}

export function activateSubstanceWall(activeInterventions: any[]): void {
    if (state.active) return;

    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    state.active = true;
    state.wallPhase = 1;
    state.activeKeys = new Set((activeInterventions || []).map((iv: any) => iv.key).filter(Boolean));

    // Hide the curve groups so the wall replaces the plot area
    state.savedGroupVisibility.clear();
    for (const id of HIDDEN_GROUPS) {
        const g = document.getElementById(id);
        if (g) {
            state.savedGroupVisibility.set(id, g.getAttribute('opacity') || '');
            g.setAttribute('opacity', '0');
            g.style.pointerEvents = 'none';
        }
    }

    // Create (or reclaim) our dedicated wall group
    let wallGroup = document.getElementById(WALL_GROUP_ID);
    if (!wallGroup) {
        wallGroup = svgEl('g', { id: WALL_GROUP_ID });
        svg.appendChild(wallGroup);
    }
    wallGroup.innerHTML = '';
    state.wallGroup = wallGroup;

    // Build the wall inside the plot area
    buildWall(svg);

    // Start ambient flux + position swaps
    startQuantumFabric();

    // Mouse hover tracking (SVG coordinates)
    const mouseHandler = (e: MouseEvent) => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const inv = ctm.inverse();
        state.mouseX = e.clientX * inv.a + e.clientY * inv.c + inv.e;
        state.mouseY = e.clientX * inv.b + e.clientY * inv.d + inv.f;
        state.mouseInSvg = true;
    };
    const mouseLeaveHandler = () => {
        state.mouseInSvg = false;
        state.mouseX = -9999;
        state.mouseY = -9999;
    };
    svg.addEventListener('mousemove', mouseHandler);
    svg.addEventListener('mouseleave', mouseLeaveHandler);
    state.mouseHandler = mouseHandler;
    state.mouseLeaveHandler = mouseLeaveHandler;
}

export function deactivateSubstanceWall(): void {
    if (!state.active) return;

    const wasDepth = state.wallPhase === 2;
    state.wallPhase = 0; // stop depth cascade in quantum fabric; tick keeps running

    // Remove mouse listeners immediately
    removeMouseListeners();

    // Begin 3D tilt reset
    const svg = document.getElementById('phase-chart-svg');
    if (svg) {
        svg.classList.remove('wall-depth-tilt');
        svg.classList.add('wall-depth-reset');
    }

    if (wasDepth) {
        animateFanIn(() => animateFadeOut(() => finishDeactivation()));
    } else {
        animateFadeOut(() => finishDeactivation());
    }
}

function removeMouseListeners(): void {
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (svg) {
        if (state.mouseHandler) svg.removeEventListener('mousemove', state.mouseHandler);
        if (state.mouseLeaveHandler) svg.removeEventListener('mouseleave', state.mouseLeaveHandler);
    }
    state.mouseHandler = null;
    state.mouseLeaveHandler = null;
    state.mouseInSvg = false;
    state.mouseX = -9999;
    state.mouseY = -9999;
}

/** Animate depth layers collapsing back onto the front wall. */
function animateFanIn(onComplete: () => void): void {
    const start = performance.now();
    const DURATION = 700;
    const vpX = state.vpX;
    const vpY = state.vpY;
    const swivelOriginX = state.plotLeft;

    // Each layer's fully-expanded params for interpolation
    const layerTargets = state.depthLayers.map(layer => {
        const idx = parseInt(layer.getAttribute('data-depth') || '1');
        const depth = idx / (DEPTH_LAYER_COUNT + 1);
        return {
            scale: 1 - depth * 0.5,
            tx: idx * 30,
            ty: -idx * 6,
            opacity: Math.max(0.04, 0.55 - (idx - 1) * 0.045),
        };
    });

    function step() {
        if (!state.wallGroup || !state.wallGroup.parentNode) {
            onComplete();
            return;
        }

        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / DURATION);
        const ease = t * t; // ease-in quadratic (accelerate into the wall)

        // Reverse front wall swivel
        const scaleX = 1 - (1 - ease) * 0.15;
        const offsetX = (1 - ease) * 14;
        if (state.wallGroup) {
            state.wallGroup.setAttribute(
                'transform',
                `translate(${(swivelOriginX + offsetX).toFixed(1)},0) ` +
                    `scale(${scaleX.toFixed(3)},1) ` +
                    `translate(${(-swivelOriginX).toFixed(1)},0)`,
            );
        }

        // Fan layers back to front wall position
        for (let d = 0; d < state.depthLayers.length; d++) {
            const layer = state.depthLayers[d];
            const tgt = layerTargets[d];
            const rev = 1 - ease;
            const curScale = tgt.scale + (1 - tgt.scale) * ease;
            const curTx = tgt.tx * rev;
            const curTy = tgt.ty * rev;

            layer.setAttribute(
                'transform',
                `translate(${vpX.toFixed(1)},${vpY.toFixed(1)}) ` +
                    `scale(${curScale.toFixed(3)}) ` +
                    `translate(${(-vpX + curTx).toFixed(1)},${(-vpY + curTy).toFixed(1)})`,
            );
            layer.setAttribute('opacity', (tgt.opacity * rev).toFixed(3));
        }

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            onComplete();
        }
    }

    requestAnimationFrame(step);
}

/** Fade the entire wall (front + any remaining depth layers) to transparent. */
function animateFadeOut(onComplete: () => void): void {
    const start = performance.now();
    const DURATION = 400;

    function step() {
        if (!state.wallGroup || !state.wallGroup.parentNode) {
            onComplete();
            return;
        }

        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / DURATION);
        const alpha = (1 - t).toFixed(3);

        if (state.wallGroup) state.wallGroup.setAttribute('opacity', alpha);
        for (const layer of state.depthLayers) {
            layer.setAttribute('opacity', alpha);
        }

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            onComplete();
        }
    }

    requestAnimationFrame(step);
}

/** Final cleanup after all close animations complete. */
function finishDeactivation(): void {
    state.active = false;
    state.wallPhase = 0;

    // Stop quantum fabric
    if (state.fluxRafId != null) {
        cancelAnimationFrame(state.fluxRafId);
        state.fluxRafId = null;
    }

    // Remove depth layers
    for (const layer of state.depthLayers) {
        layer.remove();
    }
    state.depthLayers = [];
    state.depthBarMap = [];
    state.depthParams = [];

    // Remove wall group content and reset transforms/opacity
    if (state.wallGroup) {
        state.wallGroup.removeAttribute('transform');
        state.wallGroup.setAttribute('opacity', '1');
        state.wallGroup.innerHTML = '';
    }

    // Clean up clip-paths + remove tilt classes
    const svg = document.getElementById('phase-chart-svg');
    if (svg) {
        const defs = svg.querySelector('defs');
        if (defs) defs.querySelectorAll('[id^="sw-clip-"]').forEach(el => el.remove());
        svg.classList.remove('wall-depth-tilt');
        setTimeout(() => svg.classList.remove('wall-depth-reset'), 700);
    }

    // Restore hidden curve groups
    for (const [id, opacity] of state.savedGroupVisibility) {
        const g = document.getElementById(id);
        if (g) {
            g.setAttribute('opacity', opacity || '1');
            g.style.pointerEvents = '';
        }
    }
    state.savedGroupVisibility.clear();

    state.tiles = [];
}

/** Re-render tiles when Rx mode changes while wall is active. */
export function refreshWallRxFilter(): void {
    if (!state.active || !state.wallGroup) return;
    if (state.fluxRafId != null) {
        cancelAnimationFrame(state.fluxRafId);
        state.fluxRafId = null;
    }

    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (!svg) return;

    // Clean up depth layers if in depth mode
    const wasDepth = state.wallPhase === 2;
    for (const layer of state.depthLayers) {
        layer.remove();
    }
    state.depthLayers = [];
    state.depthBarMap = [];

    // Reset swivel transform
    state.wallGroup.removeAttribute('transform');

    // Clean up old clip-paths
    const defs = svg.querySelector('defs');
    if (defs) defs.querySelectorAll('[id^="sw-clip-"]').forEach(el => el.remove());

    state.wallGroup.innerHTML = '';
    state.tiles = [];
    state.wallPhase = 1;
    buildWall(svg);
    startQuantumFabric();

    // Re-expand depth if we were in depth mode
    if (wasDepth) {
        setTimeout(() => expandWallDepth(), 200);
    }
}

// ============================================
// 3D Depth expansion (Phase 2)
//
// Creates ~10 clone layers behind the front wall, each progressively
// smaller and more transparent, converging toward a vanishing point.
// The front wall gets a slight horizontal compression ("swivel")
// to reveal the depth layers behind it.
// ============================================

const DEPTH_LAYER_COUNT = 10;

export function expandWallDepth(): void {
    if (state.wallPhase !== 1) return;
    state.wallPhase = 2;

    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (!svg || !state.wallGroup) return;

    // Apply 3D tilt to the SVG element
    svg.classList.remove('wall-depth-reset');
    svg.classList.add('wall-depth-tilt');

    // Vanishing point: center-top of plot area
    const vpX = PHASE_CHART.padL + PHASE_CHART.plotW * 0.5;
    const vpY = PHASE_CHART.padT + PHASE_CHART.plotH * 0.15;
    state.vpX = vpX;
    state.vpY = vpY;

    // Create depth layers starting at the front wall position (identity)
    for (let i = DEPTH_LAYER_COUNT; i >= 1; i--) {
        const layerG = svgEl('g', {
            class: 'sw-depth-layer',
            'data-depth': String(i),
            opacity: '0',
        });

        // Clone front wall tiles into this layer
        const pillGroups = state.wallGroup.querySelectorAll('.sw-pill-group');
        pillGroups.forEach(pill => {
            const clone = pill.cloneNode(true) as Element;
            clone.setAttribute('opacity', '1');
            layerG.appendChild(clone);
        });

        // Start at identity (same position as front wall — layers will fan out)
        layerG.setAttribute(
            'transform',
            `translate(${vpX.toFixed(1)},${vpY.toFixed(1)}) scale(1) translate(${(-vpX).toFixed(1)},${(-vpY).toFixed(1)})`,
        );

        // Insert behind the front wall group
        svg.insertBefore(layerG, state.wallGroup);
        state.depthLayers.push(layerG);

        // Cache bar elements indexed by tile slot for unified animation
        const bars = layerG.querySelectorAll('.sw-bar');
        bars.forEach((bar, bIdx) => {
            if (!state.depthBarMap[bIdx]) state.depthBarMap[bIdx] = [];
            state.depthBarMap[bIdx].push(bar);
        });
    }

    // Animate: layers fan out from front wall to final depth positions + swivel
    const startTime = performance.now();
    const ANIM_DURATION = 900;
    const swivelOriginX = state.plotLeft;

    function animateExpand() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / ANIM_DURATION);
        const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

        // Swivel front wall: compress horizontally around left edge
        const scaleX = 1 - ease * 0.15;
        const offsetX = ease * 14;
        if (state.wallGroup) {
            state.wallGroup.setAttribute(
                'transform',
                `translate(${(swivelOriginX + offsetX).toFixed(1)},0) ` +
                    `scale(${scaleX.toFixed(3)},1) ` +
                    `translate(${(-swivelOriginX).toFixed(1)},0)`,
            );
        }

        // Fan each layer from identity to its final depth position
        for (let d = 0; d < state.depthLayers.length; d++) {
            const layer = state.depthLayers[d];
            const layerIdx = parseInt(layer.getAttribute('data-depth') || '1');
            const depth = layerIdx / (DEPTH_LAYER_COUNT + 1);

            // Stagger: closer layers start moving earlier
            const stagger = (layerIdx - 1) * 0.05;
            const lt = clamp((t - stagger) / Math.max(0.01, 1 - stagger), 0, 1);
            const layerEase = 1 - Math.pow(1 - lt, 2);

            // Interpolate from identity (scale=1, tx=0, ty=0) to final
            const finalScale = 1 - depth * 0.5;
            const finalTx = layerIdx * 30;
            const finalTy = -layerIdx * 6;
            const curScale = 1 + (finalScale - 1) * layerEase;
            const curTx = finalTx * layerEase;
            const curTy = finalTy * layerEase;

            layer.setAttribute(
                'transform',
                `translate(${vpX.toFixed(1)},${vpY.toFixed(1)}) ` +
                    `scale(${curScale.toFixed(3)}) ` +
                    `translate(${(-vpX + curTx).toFixed(1)},${(-vpY + curTy).toFixed(1)})`,
            );

            // Opacity: fade in as they fan out
            const targetOpacity = Math.max(0.04, 0.55 - (layerIdx - 1) * 0.045);
            layer.setAttribute('opacity', (layerEase * targetOpacity).toFixed(3));
        }

        if (t < 1 && state.wallPhase === 2) {
            requestAnimationFrame(animateExpand);
        }
    }

    requestAnimationFrame(animateExpand);
}

// ============================================
// Grid position helpers
// ============================================

function slotToXY(slotIdx: number): { x: number; y: number } {
    const col = slotIdx % state.cols;
    const row = Math.floor(slotIdx / state.cols);
    return {
        x: state.plotLeft + col * (state.colW + state.colGap),
        y: state.wallTopY + row * state.barStep,
    };
}

// ============================================
// Wall construction — SVG bars in the plot area
// ============================================

function buildWall(svg: SVGSVGElement): void {
    const wallGroup = state.wallGroup;
    if (!wallGroup) return;

    const activePool = getActiveSubstances();
    const allKeys = Object.keys(SUBSTANCE_DB);

    // Sort: active (in-protocol) first, then alphabetical
    const sortedKeys = allKeys
        .filter(k => k in activePool)
        .sort((a, b) => {
            const aActive = state.activeKeys.has(a) ? 0 : 1;
            const bActive = state.activeKeys.has(b) ? 0 : 1;
            if (aActive !== bActive) return aActive - bActive;
            return (SUBSTANCE_DB[a].name || a).localeCompare(SUBSTANCE_DB[b].name || b);
        });

    // Layout: fill the plot area (where curves normally live)
    const plotW = PHASE_CHART.plotW;
    const plotH = PHASE_CHART.plotH;

    // Calculate columns to fill the plot area height nicely
    const totalN = sortedKeys.length;
    // Target: fill vertically within plotH
    const maxRows = Math.floor(plotH / (BAR_H + BAR_GAP));
    const cols = Math.max(3, Math.ceil(totalN / maxRows));
    const colGap = 3;
    const colW = (plotW - (cols - 1) * colGap) / cols;

    // Store layout params for swap animation
    state.cols = cols;
    state.colW = colW;
    state.colGap = colGap;
    state.plotLeft = PHASE_CHART.padL;
    state.wallTopY = PHASE_CHART.padT + 4;
    state.barStep = BAR_H + BAR_GAP;

    // Defs for clip-paths
    const defs = svg.querySelector('defs')!;
    defs.querySelectorAll('[id^="sw-clip-"]').forEach(el => el.remove());

    state.tiles = [];

    for (let i = 0; i < sortedKeys.length; i++) {
        const key = sortedKeys[i];
        const sub = SUBSTANCE_DB[key];
        const isActive = state.activeKeys.has(key);
        const color = sub.color || '#6ee7ff';

        const { x, y } = slotToXY(i);

        // Use a <g> with transform for animated swapping
        const pillG = svgEl('g', {
            class: 'sw-pill-group' + (isActive ? ' sw-pill--active' : ''),
            'data-substance-key': key,
            transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`,
            opacity: '0',
        });

        // Tooltip
        const titleEl = svgEl('title');
        const pharma = sub.pharma || {};
        const doseStr = sub.standardDose || '';
        const paramsStr = [
            pharma.onset != null ? `Onset: ${pharma.onset}m` : '',
            pharma.duration != null ? `Duration: ${pharma.duration}m` : '',
            pharma.strength != null ? `Strength: ${pharma.strength}%` : '',
        ]
            .filter(Boolean)
            .join(', ');
        titleEl.textContent = `${sub.name || key} — ${sub.class || ''}\n${doseStr ? `Dose: ${doseStr}` : ''}${paramsStr ? `\n${paramsStr}` : ''}`;
        pillG.appendChild(titleEl);

        // Clip-path for label (positioned at origin since group is translated)
        const clipId = `sw-clip-${i}`;
        const clip = svgEl('clipPath', { id: clipId });
        const clipRect = svgEl('rect', {
            x: '0',
            y: '0',
            width: colW.toFixed(1),
            height: String(BAR_H),
            rx: String(BAR_RX),
            ry: String(BAR_RX),
        });
        clip.appendChild(clipRect);
        defs.appendChild(clip);

        // Colored bar (positioned at 0,0 within the group)
        const fillOpacity = isActive ? '0.35' : '0.15';
        const strokeOpacity = isActive ? '0.7' : '0.3';
        const strokeWidth = isActive ? '1.2' : '0.75';
        const bar = svgEl('rect', {
            x: '0',
            y: '0',
            width: colW.toFixed(1),
            height: String(BAR_H),
            rx: String(BAR_RX),
            ry: String(BAR_RX),
            fill: color,
            'fill-opacity': fillOpacity,
            stroke: color,
            'stroke-opacity': strokeOpacity,
            'stroke-width': strokeWidth,
            class: 'sw-bar',
        });
        pillG.appendChild(bar);

        // Clipped label inside bar
        const contentG = svgEl('g', { 'clip-path': `url(#${clipId})` });
        const label = svgEl('text', {
            x: '5',
            y: (BAR_H / 2 + 3).toFixed(1),
            class: 'timeline-bar-label',
        });
        label.textContent = sub.name || key;

        // Rx badge
        const regStatus = (sub.regulatoryStatus || '').toLowerCase();
        if (regStatus === 'rx' || regStatus === 'controlled') {
            const rxSpan = svgEl('tspan', {
                fill: '#e11d48',
                'font-size': '7',
                'font-weight': '700',
                dy: '-0.5',
            });
            rxSpan.textContent = ' Rx';
            label.appendChild(rxSpan);
        }

        contentG.appendChild(label);
        pillG.appendChild(contentG);

        wallGroup.appendChild(pillG);
        state.tiles.push({
            group: pillG,
            bar,
            label,
            clipRect,
            isActive,
            key,
            color,
            slotIdx: i,
        });
    }

    // Staggered entrance animation
    for (let i = 0; i < state.tiles.length; i++) {
        const tile = state.tiles[i];
        const delay = i * 10;
        setTimeout(() => {
            if (state.active) {
                tile.group.setAttribute('opacity', '1');
            }
        }, delay);
    }
}

// ============================================
// Quantum fabric animation
//
// Each tile has its own phase offsets computed from a seeded hash.
// The combined effect is:
//   1. Opacity ripple — travelling diagonal waves of brightness
//   2. Micro-drift — tiles breathe with subtle x/y translation
//   3. Pulse cascade — random tiles briefly flare to full brightness
//      then fade back, as if data is flowing through them
// ============================================

/** Per-tile random seeds (stable across frames). */
function hashSeed(i: number): number {
    let h = i * 2654435761;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    return (h >>> 0) / 0xffffffff; // 0..1
}

function startQuantumFabric(): void {
    if (state.fluxRafId != null) cancelAnimationFrame(state.fluxRafId);

    // Pre-compute per-tile phase seeds
    const seeds = state.tiles.map((_, i) => hashSeed(i));
    // Grid coordinates for diagonal wave
    const cols = state.cols;
    const tileCols = state.tiles.map((_, i) => i % cols);
    const tileRows = state.tiles.map((_, i) => Math.floor(i / cols));

    // Pulse cascade state: queue of tiles currently flaring
    const pulseQueue: { idx: number; startTime: number }[] = [];
    const PULSE_DURATION = 800;
    let nextPulseTime = performance.now() + 400;

    function tick() {
        const now = performance.now();
        const tiles = state.tiles;
        const n = tiles.length;

        // In depth mode: more frequent, larger pulse batches across the stack
        const inDepth = state.wallPhase === 2;
        const pulseBatch = inDepth ? 4 : 2;
        const pulseInterval = inDepth ? 200 : 250;

        // Schedule new pulses
        if (now >= nextPulseTime) {
            for (let p = 0; p < pulseBatch; p++) {
                const idx = Math.floor(Math.random() * n);
                pulseQueue.push({ idx, startTime: now });
            }
            nextPulseTime = now + pulseInterval + Math.random() * (inDepth ? 150 : 200);
        }

        // Build pulse intensity map
        const pulseIntensity = new Float32Array(n);
        for (let p = pulseQueue.length - 1; p >= 0; p--) {
            const pulse = pulseQueue[p];
            const age = now - pulse.startTime;
            if (age > PULSE_DURATION) {
                pulseQueue.splice(p, 1);
                continue;
            }
            // Triangle envelope: ramp up then down
            const t = age / PULSE_DURATION;
            const intensity = t < 0.3 ? t / 0.3 : (1 - t) / 0.7;
            pulseIntensity[pulse.idx] = Math.max(pulseIntensity[pulse.idx], intensity);
        }

        for (let i = 0; i < n; i++) {
            const tile = tiles[i];
            const seed = seeds[i];
            const col = tileCols[i];
            const row = tileRows[i];

            // 1. Diagonal travelling wave (opacity ripple)
            const diag = (col + row) * 0.4;
            const wave1 = Math.sin(now / 2200 + diag + seed * Math.PI * 2);
            const wave2 = Math.sin(now / 3600 - diag * 0.7 + seed * 4.5);
            const wave3 = Math.sin(now / 5000 + seed * 7.1) * 0.4;

            // 2. Micro-drift (subtle position breathing)
            const driftX = Math.sin(now / 3200 + seed * 6.28) * 1.2;
            const driftY = Math.cos(now / 2800 + seed * 4.71) * 0.8;

            // 3. Pulse overlay
            const pulse = pulseIntensity[i];

            // Composite opacity
            const baseActive = tile.isActive;
            let fillOp: number;
            let strokeOp: number;

            if (baseActive) {
                fillOp = 0.22 + 0.1 * wave1 + 0.04 * wave2 + 0.03 * wave3 + 0.25 * pulse;
                strokeOp = 0.45 + 0.18 * wave1 + 0.06 * wave2 + 0.04 * wave3 + 0.3 * pulse;
            } else {
                fillOp = 0.06 + 0.06 * wave1 + 0.03 * wave2 + 0.02 * wave3 + 0.2 * pulse;
                strokeOp = 0.15 + 0.1 * wave1 + 0.05 * wave2 + 0.03 * wave3 + 0.25 * pulse;
            }

            const clampedFill = clamp(fillOp, 0, 1).toFixed(3);
            const clampedStroke = clamp(strokeOp, 0, 1).toFixed(3);
            tile.bar.setAttribute('fill-opacity', clampedFill);
            tile.bar.setAttribute('stroke-opacity', clampedStroke);

            // Cascade: mirror the same highlight to depth layer bars at this slot
            if (inDepth && state.depthBarMap[i]) {
                const depthBars = state.depthBarMap[i];
                for (let d = 0; d < depthBars.length; d++) {
                    depthBars[d].setAttribute('fill-opacity', clampedFill);
                    depthBars[d].setAttribute('stroke-opacity', clampedStroke);
                }
            }

            // Apply micro-drift + mouse hover growth via transform
            const pos = slotToXY(tile.slotIdx);
            let hoverScale = 1;
            if (state.mouseInSvg) {
                const cx = pos.x + state.colW * 0.5;
                const cy = pos.y + BAR_H * 0.5;
                const hdx = state.mouseX - cx;
                const hdy = state.mouseY - cy;
                const dist = Math.sqrt(hdx * hdx + hdy * hdy);
                const radius = 80;
                if (dist < radius) {
                    const proximity = 1 - dist / radius;
                    hoverScale = 1 + proximity * 0.3;
                }
            }

            const halfW = state.colW * 0.5;
            const halfH = BAR_H * 0.5;
            if (hoverScale > 1.001) {
                tile.group.setAttribute(
                    'transform',
                    `translate(${(pos.x + driftX).toFixed(2)},${(pos.y + driftY).toFixed(2)}) ` +
                        `translate(${halfW.toFixed(1)},${halfH.toFixed(1)}) ` +
                        `scale(${hoverScale.toFixed(3)}) ` +
                        `translate(${(-halfW).toFixed(1)},${(-halfH).toFixed(1)})`,
                );
                // Grow random depth bars at this slot across layers
                if (inDepth && state.depthBarMap[i]) {
                    const depthBars = state.depthBarMap[i];
                    for (let d = 0; d < depthBars.length; d++) {
                        const r = hashSeed(i * 97 + d * 31 + Math.floor(now / 400));
                        if (r > 0.4) {
                            const dScale = hoverScale * (0.8 + r * 0.4);
                            depthBars[d].setAttribute(
                                'transform',
                                `translate(${halfW.toFixed(1)},${halfH.toFixed(1)}) ` +
                                    `scale(${dScale.toFixed(3)}) ` +
                                    `translate(${(-halfW).toFixed(1)},${(-halfH).toFixed(1)})`,
                            );
                        } else {
                            depthBars[d].removeAttribute('transform');
                        }
                    }
                }
            } else {
                tile.group.setAttribute(
                    'transform',
                    `translate(${(pos.x + driftX).toFixed(2)},${(pos.y + driftY).toFixed(2)})`,
                );
                // Reset any depth bar hover transforms
                if (inDepth && state.depthBarMap[i]) {
                    for (const dBar of state.depthBarMap[i]) {
                        if (dBar.hasAttribute('transform')) dBar.removeAttribute('transform');
                    }
                }
            }
        }

        if (state.active) {
            state.fluxRafId = requestAnimationFrame(tick);
        }
    }

    state.fluxRafId = requestAnimationFrame(tick);
}
