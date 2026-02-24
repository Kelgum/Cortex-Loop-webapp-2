// ============================================
// CURVE SEGMENTS
// ============================================
// Baseline reveal, baseline→desired morph, mission arrows, peak descriptors.

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { easeInOutCubic, easeOutCubic } from '../timeline-engine';
import { PHASE_CHART, PHASE_SMOOTH_PASSES } from '../constants';
import { svgEl, chartTheme, phaseChartX, phaseChartY } from '../utils';
import {
    smoothPhaseValues, phasePointsToPath, phasePointsToFillPath,
    findMaxDivergence,
} from '../curve-utils';
import { getEffectSubGroup, activateDivider, cleanupDivider } from '../divider';
import { placePeakDescriptors, renderYAxisTransitionIndicators } from '../phase-chart';

// --- Baseline curves fade-in ---
export function createBaselineCurvesSegment(startTime: number): AnimationSegment {
    const created: SVGElement[] = [];

    return {
        id: 'baseline-curves-reveal',
        label: 'Baseline',
        category: 'curves',
        startTime,
        duration: 1000, // 800ms + 200ms stagger
        phaseIdx: 0,

        enter(ctx) {
            if (!ctx.curvesData) return;
            const group = ctx.groups['phase-baseline-curves'];
            if (!group) return;
            group.innerHTML = '';
            created.length = 0;

            for (let i = 0; i < ctx.curvesData.length; i++) {
                const curve = ctx.curvesData[i];
                const pathD = phasePointsToPath(curve.baseline);
                if (!pathD) continue;

                const sub = getEffectSubGroup(group, i);

                const fillPath = svgEl('path', {
                    d: phasePointsToFillPath(curve.baseline),
                    fill: curve.color, 'fill-opacity': '0',
                }) as SVGElement;
                sub.appendChild(fillPath);
                created.push(fillPath);

                const strokePath = svgEl('path', {
                    d: pathD, fill: 'none', stroke: curve.color,
                    class: 'phase-baseline-path', opacity: '0',
                }) as SVGElement;
                sub.appendChild(strokePath);
                created.push(strokePath);
            }

            activateDivider(ctx.curvesData);
        },

        render(t, ctx) {
            if (!ctx.curvesData) return;
            // Stagger per curve: curve 0 fills 0..0.8, curve 1 fills 0.2..1.0
            const curveCount = ctx.curvesData.length;
            for (let i = 0; i < curveCount; i++) {
                const staggerT = Math.max(0, Math.min(1, (t - i * 0.2) / 0.8));
                const strokeEl = created[i * 2 + 1];
                const fillEl = created[i * 2];
                if (strokeEl) strokeEl.setAttribute('opacity', (0.5 * staggerT).toFixed(2));
                if (fillEl) fillEl.setAttribute('fill-opacity', (0.04 * staggerT).toFixed(3));
            }
        },

        exit(ctx) {
            const group = ctx.groups['phase-baseline-curves'];
            if (group) group.innerHTML = '';
            created.length = 0;
            // Remove the split-screen divider (activated in enter)
            cleanupDivider();
        },
    };
}

// --- Baseline peak descriptors ---
export function createBaselinePeakLabelsSegment(startTime: number): AnimationSegment {
    return {
        id: 'baseline-peak-labels',
        label: 'Peaks',
        category: 'curves',
        startTime,
        duration: 500,
        phaseIdx: 0,

        enter(ctx) {
            if (!ctx.curvesData) return;
            const group = ctx.groups['phase-baseline-curves'];
            if (!group) return;
            placePeakDescriptors(group, ctx.curvesData, 'baseline', 0);
            // Start fully transparent for the render() to fade in
            group.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                el.setAttribute('opacity', '0');
            });
        },

        render(t, ctx) {
            const group = ctx.groups['phase-baseline-curves'];
            if (!group) return;
            const ease = easeOutCubic(t);
            group.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                el.setAttribute('opacity', (0.85 * ease).toFixed(2));
            });
        },

        exit(ctx) {
            const group = ctx.groups['phase-baseline-curves'];
            if (!group) return;
            group.querySelectorAll('.peak-descriptor').forEach((el: any) => el.remove());
        },
    };
}

// --- Mission arrows grow from baseline → desired ---
export function createMissionArrowsSegment(startTime: number): AnimationSegment {
    const arrowElements: { line: SVGElement; glow: SVGElement; y1: number; y2: number }[] = [];

    return {
        id: 'mission-arrows-grow',
        label: 'Arrows',
        category: 'curves',
        startTime,
        duration: 900,
        phaseIdx: 1,

        enter(ctx) {
            if (!ctx.curvesData) return;
            const arrowGroup = ctx.groups['phase-mission-arrows'];
            if (!arrowGroup) return;
            arrowGroup.innerHTML = '';
            arrowElements.length = 0;

            for (let i = 0; i < ctx.curvesData.length; i++) {
                const curve = ctx.curvesData[i];
                const div = findMaxDivergence(curve);
                if (!div || Math.abs(div.diff) < 5) continue;

                const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
                const match = blSmoothed.reduce((a: any, b: any) =>
                    Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a);

                const arrowSub = getEffectSubGroup(arrowGroup, i);
                const x = phaseChartX(div.hour * 60);
                const y1 = phaseChartY(match.value);
                const y2 = phaseChartY(div.value);

                const glowLine = svgEl('line', {
                    x1: x.toFixed(1), y1: y1.toFixed(1),
                    x2: x.toFixed(1), y2: y1.toFixed(1),
                    stroke: curve.color, 'stroke-width': '4', 'stroke-opacity': '0',
                    'stroke-linecap': 'round', fill: 'none', 'pointer-events': 'none',
                }) as SVGElement;
                arrowSub.appendChild(glowLine);

                const arrowLine = svgEl('line', {
                    x1: x.toFixed(1), y1: y1.toFixed(1),
                    x2: x.toFixed(1), y2: y1.toFixed(1),
                    stroke: curve.color, class: 'mission-arrow', opacity: '0',
                }) as SVGElement;
                arrowSub.appendChild(arrowLine);

                arrowElements.push({ line: arrowLine, glow: glowLine, y1, y2 });
            }
        },

        render(t, ctx) {
            const ease = easeOutCubic(t);
            for (const { line, glow, y1, y2 } of arrowElements) {
                const curY = y1 + (y2 - y1) * ease;
                const opacity = 0.7 * Math.min(1, t * 2.5);
                line.setAttribute('opacity', opacity.toFixed(2));
                line.setAttribute('y2', curY.toFixed(1));
                glow.setAttribute('stroke-opacity', (0.15 * Math.min(1, t * 2.5)).toFixed(2));
                glow.setAttribute('y2', curY.toFixed(1));
            }
        },

        exit(ctx) {
            const arrowGroup = ctx.groups['phase-mission-arrows'];
            if (arrowGroup) arrowGroup.innerHTML = '';
            arrowElements.length = 0;
        },
    };
}

// --- Morph baseline → desired curves ---
export function createMorphToDesiredSegment(startTime: number): AnimationSegment {
    const strokeEls: SVGElement[] = [];
    const fillEls: SVGElement[] = [];
    let blSmoothedArr: any[] = [];
    let dsSmoothedArr: any[] = [];

    return {
        id: 'morph-baseline-to-desired',
        label: 'Desired',
        category: 'curves',
        startTime,
        duration: 1200,
        phaseIdx: 1,

        enter(ctx) {
            if (!ctx.curvesData) return;
            const desiredGroup = ctx.groups['phase-desired-curves'];
            if (!desiredGroup) return;
            desiredGroup.innerHTML = '';
            strokeEls.length = 0;
            fillEls.length = 0;
            blSmoothedArr = [];
            dsSmoothedArr = [];

            for (let i = 0; i < ctx.curvesData.length; i++) {
                const curve = ctx.curvesData[i];
                const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
                const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
                blSmoothedArr.push(blSmoothed);
                dsSmoothedArr.push(dsSmoothed);

                const basePathD = phasePointsToPath(blSmoothed, true);
                const baseFillD = phasePointsToFillPath(blSmoothed, true);
                if (!basePathD) continue;

                const desiredSub = getEffectSubGroup(desiredGroup, i);

                const fillPath = svgEl('path', {
                    d: baseFillD, fill: curve.color, 'fill-opacity': '0',
                    class: 'phase-desired-fill',
                }) as SVGElement;
                desiredSub.appendChild(fillPath);
                fillEls.push(fillPath);

                const strokePath = svgEl('path', {
                    d: basePathD, fill: 'none', stroke: curve.color,
                    class: 'phase-desired-path', opacity: '1',
                }) as SVGElement;
                desiredSub.appendChild(strokePath);
                strokeEls.push(strokePath);
            }
        },

        render(t, ctx) {
            const ease = easeInOutCubic(t);
            for (let i = 0; i < blSmoothedArr.length; i++) {
                const bl = blSmoothedArr[i];
                const ds = dsSmoothedArr[i];
                if (!bl || !ds) continue;

                const len = Math.min(bl.length, ds.length);
                const morphed: any[] = [];
                for (let j = 0; j < len; j++) {
                    morphed.push({
                        hour: bl[j].hour,
                        value: bl[j].value + (ds[j].value - bl[j].value) * ease,
                    });
                }

                const morphPathD = phasePointsToPath(morphed, true);
                const morphFillD = phasePointsToFillPath(morphed, true);
                if (strokeEls[i]) strokeEls[i].setAttribute('d', morphPathD);
                if (fillEls[i]) fillEls[i].setAttribute('fill-opacity', (0.08 * t).toFixed(3));
                if (fillEls[i]) fillEls[i].setAttribute('d', morphFillD);
            }
        },

        exit(ctx) {
            // On forward exit: leave curves at desired position (persist)
            // On backward exit: remove desired curves
            const desiredGroup = ctx.groups['phase-desired-curves'];
            if (desiredGroup) desiredGroup.innerHTML = '';
            strokeEls.length = 0;
            fillEls.length = 0;
            blSmoothedArr = [];
            dsSmoothedArr = [];
        },
    };
}

// --- Desired peak descriptors ---
export function createDesiredPeakLabelsSegment(startTime: number): AnimationSegment {
    return {
        id: 'desired-peak-labels',
        label: 'Labels',
        category: 'curves',
        startTime,
        duration: 500,
        phaseIdx: 1,

        enter(ctx) {
            if (!ctx.curvesData) return;
            const desiredGroup = ctx.groups['phase-desired-curves'];
            if (!desiredGroup) return;
            // Fade out baseline peaks first
            const baseGroup = ctx.groups['phase-baseline-curves'];
            if (baseGroup) {
                baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                    el.setAttribute('opacity', '0');
                });
            }
            placePeakDescriptors(desiredGroup, ctx.curvesData, 'desired', 0);
            desiredGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                el.setAttribute('opacity', '0');
            });
        },

        render(t, ctx) {
            const desiredGroup = ctx.groups['phase-desired-curves'];
            if (!desiredGroup) return;
            const ease = easeOutCubic(t);
            desiredGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                el.setAttribute('opacity', (0.85 * ease).toFixed(2));
            });
        },

        exit(ctx) {
            const desiredGroup = ctx.groups['phase-desired-curves'];
            if (desiredGroup) {
                desiredGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => el.remove());
            }
            // Restore baseline peaks
            const baseGroup = ctx.groups['phase-baseline-curves'];
            if (baseGroup) {
                baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                    el.setAttribute('opacity', '0.85');
                });
            }
        },
    };
}

// --- Y-axis transition indicators (keep/change arrows in axis margins) ---
export function createYAxisIndicatorsSegment(startTime: number): AnimationSegment {
    return {
        id: 'yaxis-indicators',
        label: 'Indicators',
        category: 'curves',
        startTime,
        duration: 1250,
        phaseIdx: 1,

        enter(ctx) {
            if (!ctx.curvesData) return;
            // renderYAxisTransitionIndicators creates elements with their own rAF animations.
            // For timeline replay, we render them with animDelay=0 so they animate instantly.
            renderYAxisTransitionIndicators(ctx.curvesData, 0);
        },

        render(t, ctx) {
            // The indicators have their own internal CSS/rAF animation.
            // For engine-driven mode, just ensure final state at t=1.
            if (t >= 1) {
                const group = ctx.groups['phase-yaxis-indicators'];
                if (group) {
                    group.querySelectorAll('.yaxis-change-indicator, .yaxis-keep-indicator').forEach((el: any) => {
                        el.setAttribute('opacity', '1');
                    });
                }
            }
        },

        exit(ctx) {
            const group = ctx.groups['phase-yaxis-indicators'];
            if (group) {
                group.innerHTML = '';
                (group as any).style.opacity = '';
                (group as any).style.filter = '';
            }
        },
    };
}
