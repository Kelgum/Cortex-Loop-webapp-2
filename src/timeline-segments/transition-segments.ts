// ============================================
// TRANSITION & GATE SEGMENTS
// ============================================
// Prompt slide, axis builds, gates (user interaction pauses)

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { PHASE_CHART } from '../constants';
import { svgEl, chartTheme, phaseChartX } from '../utils';
import { buildPhaseXAxis, buildPhaseYAxes, buildPhaseGrid } from '../phase-chart';

// --- Prompt slide-up segment ---
export function createPromptSlideSegment(startTime: number): AnimationSegment {
    return {
        id: 'prompt-slide',
        label: 'Prompt',
        category: 'transition',
        startTime,
        duration: 350,
        phaseIdx: 0,
        enter(ctx) {
            const promptSection = document.getElementById('prompt-section');
            const chartContainer = document.getElementById('phase-chart-container');
            if (promptSection) {
                promptSection.classList.remove('phase-centered');
                promptSection.classList.add('phase-top');
            }
            if (chartContainer) chartContainer.classList.add('visible');
        },
        render(t, ctx) {
            // CSS transition handles the visual — nothing to interpolate
        },
        exit(ctx) {
            // On backward seek: restore centered state
            if (!this._entered) return;
            const promptSection = document.getElementById('prompt-section');
            const chartContainer = document.getElementById('phase-chart-container');
            if (promptSection) {
                promptSection.classList.remove('phase-top');
                promptSection.classList.add('phase-centered');
            }
            if (chartContainer) chartContainer.classList.remove('visible');
        },
    };
}

// --- X-axis build (instant) ---
export function createXAxisBuildSegment(startTime: number): AnimationSegment {
    return {
        id: 'x-axis-build',
        label: 'X-Axis',
        category: 'transition',
        startTime,
        duration: 50, // Near-instant but non-zero for visibility on ribbon
        phaseIdx: 0,
        enter(ctx) {
            buildPhaseXAxis();
            const xAxis = document.getElementById('phase-x-axis');
            if (xAxis) xAxis.classList.add('revealed');
        },
        render(t, ctx) {},
        exit(ctx) {
            const xAxis = document.getElementById('phase-x-axis');
            if (xAxis) {
                xAxis.classList.remove('revealed');
                xAxis.innerHTML = '';
            }
        },
    };
}

// --- Y-axes + Grid build (instant) ---
export function createYAxesGridSegment(startTime: number): AnimationSegment {
    return {
        id: 'y-axes-grid-build',
        label: 'Axes',
        category: 'transition',
        startTime,
        duration: 50,
        phaseIdx: 0,
        enter(ctx) {
            if (!ctx.curvesData) return;
            const effects = ctx.curvesData.map((c: any) => c.effect);
            const colors = ctx.curvesData.map((c: any) => c.color);
            buildPhaseYAxes(effects, colors, ctx.curvesData);
            const yLeft = document.getElementById('phase-y-axis-left');
            const yRight = document.getElementById('phase-y-axis-right');
            if (yLeft) yLeft.classList.add('revealed');
            if (yRight && effects.length > 1) yRight.classList.add('revealed');
            buildPhaseGrid();
        },
        render(t, ctx) {},
        exit(ctx) {
            const yLeft = document.getElementById('phase-y-axis-left');
            const yRight = document.getElementById('phase-y-axis-right');
            const grid = document.getElementById('phase-grid');
            const tooltipOverlay = document.getElementById('phase-tooltip-overlay');
            if (yLeft) { yLeft.classList.remove('revealed'); yLeft.innerHTML = ''; }
            if (yRight) { yRight.classList.remove('revealed'); yRight.innerHTML = ''; }
            if (grid) grid.innerHTML = '';
            if (tooltipOverlay) tooltipOverlay.innerHTML = '';
        },
    };
}

// --- Gate segment (user interaction pause) ---
export function createGateSegment(id: string, label: string, startTime: number, phaseIdx: number): AnimationSegment {
    return {
        id,
        label,
        category: 'gate',
        startTime,
        duration: 0,
        phaseIdx,
        enter(ctx) {},
        render(t, ctx) {},
        exit(ctx) {},
    };
}
