// ============================================
// SCAN LINE SEGMENTS (Looping)
// ============================================
// Loading indicator scan lines that ping-pong across chart zones.

import type { AnimationSegment } from '../timeline-engine';
import { PHASE_CHART, TIMELINE_ZONE, BIOMETRIC_ZONE } from '../constants';
import { svgEl } from '../utils';
import {
    MAIN_SCAN_LOOP_PERIOD,
    createMainScanLineElements,
    createMainScanMotionState,
    renderMainScanLineFrame,
    resetMainScanMotionState,
    type MainScanLineElements,
    type MainScanMotionState,
} from '../chart-scan-lines';

// --- Shared scan line logic ---
function scanLinePosition(loopProgress: number): number {
    // Smooth sinusoidal ease: decelerates at edges, accelerates through center
    return 0.5 - 0.5 * Math.cos(loopProgress * 2 * Math.PI);
}

// --- Main chart scan line ---
export function createMainScanLineSegment(startTime: number, duration: number): AnimationSegment {
    let elements: MainScanLineElements | null = null;
    let motionState: MainScanMotionState = createMainScanMotionState();

    return {
        id: 'main-scan-line',
        label: 'Scan',
        category: 'scan-line',
        startTime,
        duration,
        phaseIdx: 0,
        loopPeriod: MAIN_SCAN_LOOP_PERIOD,

        enter(ctx) {
            const group = ctx.groups['phase-scan-line'];
            if (!group) return;
            motionState = createMainScanMotionState();
            elements = createMainScanLineElements(group);
        },

        render(t, ctx) {
            if (!elements) return;
            const elapsedMs = t >= 1 && Number.isFinite(this.duration) ? this.duration : t * MAIN_SCAN_LOOP_PERIOD;
            renderMainScanLineFrame(elapsedMs, elements, motionState, ctx.groups['phase-word-cloud']);
        },

        exit(ctx) {
            const group = ctx.groups['phase-scan-line'];
            if (group) group.innerHTML = '';
            elements = null;
            resetMainScanMotionState(motionState);
        },
    };
}

// --- Scan line fade-out (when LLM returns) ---
export function createScanLineFadeSegment(startTime: number): AnimationSegment {
    let baseOpacities = new Map<SVGElement, number>();

    return {
        id: 'scan-line-fade',
        label: 'Fade',
        category: 'transition',
        startTime,
        duration: 400,
        phaseIdx: 0,

        enter(ctx) {
            baseOpacities = new Map<SVGElement, number>();
            const group = ctx.groups['phase-scan-line'];
            if (!group) return;
            group.querySelectorAll('rect, path').forEach(el => {
                const svgEl = el as SVGElement;
                baseOpacities.set(svgEl, parseFloat(svgEl.getAttribute('opacity') || '1'));
            });
        },

        render(t, _ctx) {
            baseOpacities.forEach((baseOpacity, el) => {
                el.setAttribute('opacity', (baseOpacity * (1 - t)).toFixed(3));
            });
        },

        exit(_ctx) {
            baseOpacities.forEach((baseOpacity, el) => {
                el.setAttribute('opacity', baseOpacity.toFixed(3));
            });
            baseOpacities.clear();
        },
    };
}

// --- Timeline zone scan line (during intervention model wait) ---
export function createTimelineScanLineSegment(
    startTime: number,
    duration: number,
    laneCount: number,
): AnimationSegment {
    let glow: SVGElement | null = null;
    let line: SVGElement | null = null;

    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const zoneH = Math.max(30, laneCount * laneStep + TIMELINE_ZONE.bottomPad);

    return {
        id: 'timeline-scan-line',
        label: 'TL Scan',
        category: 'scan-line',
        startTime,
        duration,
        phaseIdx: 1,
        loopPeriod: 3000, // 1.5s per traverse × 2

        enter(ctx) {
            const group = ctx.groups['phase-substance-timeline'];
            if (!group) return;
            glow = svgEl('rect', {
                x: String(PHASE_CHART.padL - 4),
                y: String(TIMELINE_ZONE.separatorY),
                width: '10',
                height: String(zoneH),
                fill: 'rgba(245, 200, 80, 0.08)',
                rx: '5',
            });
            group.appendChild(glow);
            line = svgEl('rect', {
                x: String(PHASE_CHART.padL),
                y: String(TIMELINE_ZONE.separatorY),
                width: '2',
                height: String(zoneH),
                fill: 'url(#tl-scan-line-grad)',
                opacity: '0.7',
            });
            group.appendChild(line);
        },

        render(t, _ctx) {
            if (!line || !glow) return;
            const pos = scanLinePosition(t);
            const x = PHASE_CHART.padL + pos * PHASE_CHART.plotW;
            line.setAttribute('x', x.toFixed(1));
            glow.setAttribute('x', (x - 4).toFixed(1));
        },

        exit(_ctx) {
            if (line) line.remove();
            if (glow) glow.remove();
            line = null;
            glow = null;
        },
    };
}

// --- Biometric zone scan line ---
export function createBioScanLineSegment(startTime: number, duration: number, channelCount: number): AnimationSegment {
    let glow: SVGElement | null = null;
    let line: SVGElement | null = null;
    let bg: SVGElement | null = null;
    let savedViewBoxH: number = 0;

    const zoneH = Math.max(
        80,
        channelCount * (BIOMETRIC_ZONE.laneH + BIOMETRIC_ZONE.laneGap) +
            BIOMETRIC_ZONE.separatorPad * 2 +
            BIOMETRIC_ZONE.bottomPad,
    );

    return {
        id: 'bio-scan-line',
        label: 'Bio Scan',
        category: 'scan-line',
        startTime,
        duration,
        phaseIdx: 3,
        loopPeriod: 3600, // 1.8s per traverse × 2

        enter(ctx) {
            const svg = ctx.svgRoot;
            const group = ctx.groups['phase-biometric-strips'];
            if (!svg || !group) return;

            group.innerHTML = '';
            const vb = svg.getAttribute('viewBox')!.split(' ').map(Number);
            savedViewBoxH = vb[3];
            const newH = savedViewBoxH + zoneH;
            svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${newH}`);

            const zoneTop = savedViewBoxH + BIOMETRIC_ZONE.separatorPad;
            const zoneHeight = zoneH - BIOMETRIC_ZONE.separatorPad - BIOMETRIC_ZONE.bottomPad;

            bg = svgEl('rect', {
                x: String(PHASE_CHART.padL),
                y: String(zoneTop),
                width: String(PHASE_CHART.plotW),
                height: String(zoneHeight),
                fill: 'rgba(255, 77, 77, 0.02)',
                rx: '2',
            });
            group.appendChild(bg);

            glow = svgEl('rect', {
                x: String(PHASE_CHART.padL - 4),
                y: String(zoneTop),
                width: '10',
                height: String(zoneHeight),
                fill: 'rgba(255, 77, 77, 0.12)',
                rx: '5',
            });
            group.appendChild(glow);

            line = svgEl('rect', {
                x: String(PHASE_CHART.padL),
                y: String(zoneTop),
                width: '2',
                height: String(zoneHeight),
                fill: 'url(#bio-scan-line-grad)',
                opacity: '0.8',
            });
            group.appendChild(line);
        },

        render(t, _ctx) {
            if (!line || !glow) return;
            const pos = scanLinePosition(t);
            const x = PHASE_CHART.padL + pos * PHASE_CHART.plotW;
            line.setAttribute('x', x.toFixed(1));
            glow.setAttribute('x', (x - 4).toFixed(1));
        },

        exit(ctx) {
            const svg = ctx.svgRoot;
            const group = ctx.groups['phase-biometric-strips'];
            if (group) group.innerHTML = '';
            if (svg && savedViewBoxH > 0) {
                svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${savedViewBoxH}`);
            }
            glow = null;
            line = null;
            bg = null;
        },
    };
}
