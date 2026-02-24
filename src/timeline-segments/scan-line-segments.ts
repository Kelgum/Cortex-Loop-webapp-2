// ============================================
// SCAN LINE SEGMENTS (Looping)
// ============================================
// Loading indicator scan lines that ping-pong across chart zones.

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { PHASE_CHART, TIMELINE_ZONE, BIOMETRIC_ZONE } from '../constants';
import { svgEl, chartTheme } from '../utils';

// --- Shared scan line logic ---
function scanLinePosition(loopProgress: number): number {
    // ping-pong: 0→1→0 over one loop period
    const pingPong = loopProgress <= 0.5
        ? loopProgress * 2
        : 2 - loopProgress * 2;
    return pingPong;
}

// --- Main chart scan line ---
export function createMainScanLineSegment(startTime: number, duration: number): AnimationSegment {
    let glow: SVGElement | null = null;
    let line: SVGElement | null = null;

    return {
        id: 'main-scan-line',
        label: 'Scan',
        category: 'scan-line',
        startTime,
        duration,
        phaseIdx: 0,
        loopPeriod: 2500, // 1.25s per traverse × 2 for round trip

        enter(ctx) {
            const group = ctx.groups['phase-scan-line'];
            if (!group) return;
            group.innerHTML = '';
            const t = chartTheme();
            glow = svgEl('rect', {
                x: String(PHASE_CHART.padL - 4), y: String(PHASE_CHART.padT),
                width: '10', height: String(PHASE_CHART.plotH),
                fill: t.scanGlow, rx: '5',
            });
            group.appendChild(glow);
            line = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(PHASE_CHART.padT),
                width: '2', height: String(PHASE_CHART.plotH),
                fill: 'url(#scan-line-grad)', opacity: '0.7',
            });
            group.appendChild(line);
        },

        render(t, ctx) {
            if (!line || !glow) return;
            const pos = scanLinePosition(t);
            const x = PHASE_CHART.padL + pos * PHASE_CHART.plotW;
            line.setAttribute('x', x.toFixed(1));
            glow.setAttribute('x', (x - 4).toFixed(1));
        },

        exit(ctx) {
            const group = ctx.groups['phase-scan-line'];
            if (group) group.innerHTML = '';
            glow = null;
            line = null;
        },
    };
}

// --- Scan line fade-out (when LLM returns) ---
export function createScanLineFadeSegment(startTime: number): AnimationSegment {
    return {
        id: 'scan-line-fade',
        label: 'Fade',
        category: 'transition',
        startTime,
        duration: 400,
        phaseIdx: 0,

        enter(ctx) {},

        render(t, ctx) {
            const group = ctx.groups['phase-scan-line'];
            if (!group) return;
            const opacity = 0.7 * (1 - t);
            group.querySelectorAll('rect').forEach((el: any) => {
                el.setAttribute('opacity', opacity.toFixed(2));
            });
        },

        exit(ctx) {
            // Don't clear the group — scan line elements belong to the main scan line segment.
            // Just restore opacity on any scan line elements that may still exist.
            const group = ctx.groups['phase-scan-line'];
            if (group) {
                group.querySelectorAll('rect').forEach((el: any) => {
                    el.setAttribute('opacity', '0.7');
                });
            }
        },
    };
}

// --- Timeline zone scan line (during intervention model wait) ---
export function createTimelineScanLineSegment(startTime: number, duration: number, laneCount: number): AnimationSegment {
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
                x: String(PHASE_CHART.padL - 4), y: String(TIMELINE_ZONE.separatorY),
                width: '10', height: String(zoneH),
                fill: 'rgba(245, 200, 80, 0.08)', rx: '5',
            });
            group.appendChild(glow);
            line = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(TIMELINE_ZONE.separatorY),
                width: '2', height: String(zoneH),
                fill: 'url(#tl-scan-line-grad)', opacity: '0.7',
            });
            group.appendChild(line);
        },

        render(t, ctx) {
            if (!line || !glow) return;
            const pos = scanLinePosition(t);
            const x = PHASE_CHART.padL + pos * PHASE_CHART.plotW;
            line.setAttribute('x', x.toFixed(1));
            glow.setAttribute('x', (x - 4).toFixed(1));
        },

        exit(ctx) {
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

    const zoneH = Math.max(80, channelCount * (BIOMETRIC_ZONE.laneH + BIOMETRIC_ZONE.laneGap)
        + BIOMETRIC_ZONE.separatorPad * 2 + BIOMETRIC_ZONE.bottomPad);

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
                x: String(PHASE_CHART.padL), y: String(zoneTop),
                width: String(PHASE_CHART.plotW), height: String(zoneHeight),
                fill: 'rgba(255, 77, 77, 0.02)', rx: '2',
            });
            group.appendChild(bg);

            glow = svgEl('rect', {
                x: String(PHASE_CHART.padL - 4), y: String(zoneTop),
                width: '10', height: String(zoneHeight),
                fill: 'rgba(255, 77, 77, 0.12)', rx: '5',
            });
            group.appendChild(glow);

            line = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(zoneTop),
                width: '2', height: String(zoneHeight),
                fill: 'url(#bio-scan-line-grad)', opacity: '0.8',
            });
            group.appendChild(line);
        },

        render(t, ctx) {
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
