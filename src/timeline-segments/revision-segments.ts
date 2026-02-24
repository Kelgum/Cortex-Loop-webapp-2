// ============================================
// REVISION SEGMENTS
// ============================================
// Target bracket lock-on, pick-and-place actions, Lx curve morph to revision.

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { easeInOutCubic, easeOutCubic } from '../timeline-engine';
import { PHASE_CHART, PHASE_SMOOTH_PASSES } from '../constants';
import { svgEl, phaseChartX, phaseChartY } from '../utils';
import { phasePointsToPath, phasePointsToFillPath } from '../curve-utils';
import { placePeakDescriptors } from '../phase-chart';

// --- Per-diff-entry revision bracket + action ---
export function createRevisionEntrySegment(
    startTime: number,
    entryIdx: number,
    entry: any, // { type, oldIv, newIv }
): AnimationSegment {
    // Bracket in: 350ms, action: 500ms, bracket out: 200ms
    const BRACKET_IN = 350;
    const ACTION_DUR = 500;
    const BRACKET_OUT = 200;
    const TOTAL = BRACKET_IN + ACTION_DUR + BRACKET_OUT;

    let bracketGroup: SVGElement | null = null;

    return {
        id: `revision-entry-${entryIdx}`,
        label: `Rev: ${entry.type}`,
        category: 'revision',
        startTime,
        duration: TOTAL,
        phaseIdx: 4,

        enter(ctx) {
            // Create bracket overlay group
            const svg = ctx.svgRoot;
            const isLight = document.body.classList.contains('light-mode');
            bracketGroup = svgEl('g', { class: 'revision-target-brackets', opacity: '0' }) as SVGElement;

            // Simplified brackets — in full implementation this would use createTargetBrackets
            const color = isLight ? '#b45309' : '#fbbf24';
            const iv = entry.oldIv || entry.newIv;
            const x = phaseChartX(iv.timeMinutes);
            const y = 460; // approximate timeline zone

            // Four corner brackets
            const bracket = svgEl('rect', {
                x: (x - 30).toFixed(1), y: (y - 15).toFixed(1),
                width: '60', height: '30',
                rx: '4', fill: 'none',
                stroke: color, 'stroke-width': '1.5', 'stroke-opacity': '0',
            }) as SVGElement;
            bracketGroup.appendChild(bracket);
            svg.appendChild(bracketGroup);
        },

        render(t, ctx) {
            if (!bracketGroup) return;
            const totalMs = TOTAL;
            const elapsedMs = t * totalMs;

            if (elapsedMs < BRACKET_IN) {
                // Bracket animate in
                const bracketT = elapsedMs / BRACKET_IN;
                const ease = easeOutCubic(bracketT);
                bracketGroup.setAttribute('opacity', ease.toFixed(2));
                bracketGroup.querySelector('rect')?.setAttribute('stroke-opacity', ease.toFixed(2));
            } else if (elapsedMs < BRACKET_IN + ACTION_DUR) {
                // Action phase — bracket fully visible
                bracketGroup.setAttribute('opacity', '1');
                bracketGroup.querySelector('rect')?.setAttribute('stroke-opacity', '1');
            } else {
                // Bracket dissolve
                const outT = (elapsedMs - BRACKET_IN - ACTION_DUR) / BRACKET_OUT;
                const ease = Math.min(1, outT);
                bracketGroup.setAttribute('opacity', (1 - ease).toFixed(2));
            }
        },

        exit(ctx) {
            if (bracketGroup) bracketGroup.remove();
            bracketGroup = null;
        },
    };
}

// --- Lx curves morph to revision ---
export function createLxMorphToRevisionSegment(startTime: number): AnimationSegment {
    return {
        id: 'lx-morph-to-revision',
        label: 'Lx Revise',
        category: 'revision',
        startTime,
        duration: 1200,
        phaseIdx: 4,

        enter(ctx) {},

        render(t, ctx) {
            if (!ctx.lxCurves || !ctx.curvesData) return;
            const newLxCurves = ctx._revisedLxCurves;
            if (!newLxCurves) return;

            const lxGroup = ctx.groups['phase-lx-curves'];
            if (!lxGroup) return;
            const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
            const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');

            // ease-in-out quadratic
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            for (let ci = 0; ci < ctx.curvesData.length; ci++) {
                const oldPts = ctx.lxCurves[ci]?.points || [];
                const newPts = newLxCurves[ci]?.points || [];
                const len = Math.min(oldPts.length, newPts.length);
                if (len === 0) continue;

                const morphed: any[] = [];
                for (let j = 0; j < len; j++) {
                    morphed.push({
                        hour: oldPts[j].hour,
                        value: oldPts[j].value + (newPts[j].value - oldPts[j].value) * ease,
                    });
                }

                if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
                if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
            }
        },

        exit(ctx) {
            // On forward exit: curves are at revision position. Update peak descriptors.
            if (ctx._revisedLxCurves && ctx.curvesData) {
                const baseGroup = ctx.groups['phase-baseline-curves'];
                const overlay = ctx.groups['phase-tooltip-overlay'];
                if (baseGroup) baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
                if (overlay) overlay.querySelectorAll('.peak-descriptor').forEach((el: any) => el.remove());

                const lxCurvesForLabels = ctx.curvesData.map((c: any, i: number) => ({
                    ...c,
                    desired: ctx._revisedLxCurves[i]?.points,
                }));
                if (baseGroup) placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
            }
        },
    };
}
