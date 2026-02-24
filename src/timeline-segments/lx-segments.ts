// ============================================
// LX INTERVENTION SEGMENTS
// ============================================
// Transmute desired curves, per-substance sweep, cinematic playhead morph.

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { easeInOutCubic, easeOutCubic } from '../timeline-engine';
import { PHASE_CHART, PHASE_SMOOTH_PASSES, TIMELINE_ZONE } from '../constants';
import { svgEl, chartTheme, phaseChartX, phaseChartY } from '../utils';
import {
    smoothPhaseValues, phasePointsToPath, phasePointsToFillPath,
    phaseBandPath, buildProgressiveMorphPoints, interpolatePointsAtTime,
} from '../curve-utils';
import { getEffectSubGroup } from '../divider';
import { allocateTimelineLanes, transmuteDesiredCurves, animatePhaseChartViewBoxHeight } from '../lx-system';
import { placePeakDescriptors } from '../phase-chart';

function brightenTowardWhite(color: string, intensity: number): string {
    const t = Math.max(0, Math.min(1, intensity));
    const hex = color.startsWith('#') ? color.slice(1) : '';
    if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
            const br = Math.round(r + (255 - r) * t);
            const bg = Math.round(g + (255 - g) * t);
            const bb = Math.round(b + (255 - b) * t);
            return `rgb(${br},${bg},${bb})`;
        }
    }
    const rgbMatch = color.match(/[\d.]+/g);
    if (rgbMatch && rgbMatch.length >= 3) {
        const r = Math.round(+rgbMatch[0]);
        const g = Math.round(+rgbMatch[1]);
        const b = Math.round(+rgbMatch[2]);
        const br = Math.round(r + (255 - r) * t);
        const bg = Math.round(g + (255 - g) * t);
        const bb = Math.round(b + (255 - b) * t);
        return `rgb(${br},${bg},${bb})`;
    }
    return color;
}

// --- Transmute desired curves to ghost/dashed ---
export function createTransmuteDesiredSegment(startTime: number): AnimationSegment {
    return {
        id: 'transmute-desired',
        label: 'Dim Desired',
        category: 'transition',
        startTime,
        duration: 400,
        phaseIdx: 2,

        enter(ctx) {
            transmuteDesiredCurves(true);
        },

        render(t, ctx) {
            // CSS transition handles the visual over 600ms
        },

        exit(ctx) {
            transmuteDesiredCurves(false);
        },
    };
}

// --- Initialize Lx stroke + fill at baseline position ---
export function createLxCurvesInitSegment(startTime: number): AnimationSegment {
    return {
        id: 'lx-curves-init',
        label: 'Lx Init',
        category: 'transition',
        startTime,
        duration: 50,
        phaseIdx: 2,

        enter(ctx) {
            if (!ctx.curvesData) return;
            const lxGroup = ctx.groups['phase-lx-curves'];
            const bandsGroup = ctx.groups['phase-lx-bands'];
            if (!lxGroup) return;
            lxGroup.innerHTML = '';
            if (bandsGroup) bandsGroup.innerHTML = '';

            const baselinePts = ctx.curvesData.map((c: any) =>
                smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES));

            for (let ci = 0; ci < ctx.curvesData.length; ci++) {
                const curve = ctx.curvesData[ci];
                const initD = phasePointsToPath(baselinePts[ci], true);
                const initFillD = phasePointsToFillPath(baselinePts[ci], true);

                lxGroup.appendChild(svgEl('path', {
                    d: initFillD, fill: curve.color, 'fill-opacity': '0',
                    class: 'phase-lx-fill',
                }));
                lxGroup.appendChild(svgEl('path', {
                    d: initD, fill: 'none', stroke: curve.color,
                    'stroke-width': '2.2', 'stroke-opacity': '0.9',
                    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                    class: 'phase-lx-path',
                }));
            }

            // Dim baseline strokes
            const baseGroup = ctx.groups['phase-baseline-curves'];
            if (baseGroup) {
                baseGroup.querySelectorAll('.phase-baseline-path').forEach((s: any) => {
                    s.setAttribute('stroke-opacity', '0.25');
                });
            }

            // Setup timeline zone
            if (!ctx.interventions) return;
            const timelineGroup = ctx.groups['phase-substance-timeline'];
            if (!timelineGroup) return;
            timelineGroup.innerHTML = '';

            timelineGroup.appendChild(svgEl('line', {
                x1: String(PHASE_CHART.padL), y1: String(TIMELINE_ZONE.separatorY),
                x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(TIMELINE_ZONE.separatorY),
                class: 'timeline-separator',
            }));
            // Start collapsed; per-substance segments progressively expand lanes.
            void animatePhaseChartViewBoxHeight(ctx.svgRoot as SVGSVGElement, PHASE_CHART.viewH, 180);
        },

        render(t, ctx) {},

        exit(ctx) {
            const lxGroup = ctx.groups['phase-lx-curves'];
            const bandsGroup = ctx.groups['phase-lx-bands'];
            const timelineGroup = ctx.groups['phase-substance-timeline'];
            if (lxGroup) lxGroup.innerHTML = '';
            if (bandsGroup) bandsGroup.innerHTML = '';
            if (timelineGroup) timelineGroup.innerHTML = '';
            ctx.svgRoot.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} 500`);

            // Restore baseline strokes
            const baseGroup = ctx.groups['phase-baseline-curves'];
            if (baseGroup) {
                baseGroup.querySelectorAll('.phase-baseline-path').forEach((s: any) => {
                    s.setAttribute('stroke-opacity', '0.5');
                });
            }
        },
    };
}

// --- Per-substance playhead sweep ---
export function createSubstanceSweepSegment(
    startTime: number,
    stepIdx: number,
    substance: any,
    sourcePts: any[],      // Current Lx points per curve (before this substance)
    targetPts: any[],      // Lx points per curve (after this substance)
    curvesData: any[],
): AnimationSegment {
    const sweepDuration = Math.max(1200, 2500 - stepIdx * 250);
    const BLEND_WIDTH = 1.5;
    const startHour = PHASE_CHART.startHour;
    const endHour = PHASE_CHART.endHour;
    const hourRange = endHour - startHour;

    // Pre-compute time-warp LUT
    const WARP_SAMPLES = 256;
    const warpMult = new Float64Array(WARP_SAMPLES);
    warpMult.fill(1);
    const SLOWMO_FACTOR = 8;
    const SIGMA_ENTRY = 0.06;
    const SIGMA_EXIT = 0.10;

    const pharma = substance.substance?.pharma;
    if (pharma) {
        const onsetHour = (substance.timeMinutes + pharma.onset) / 60;
        const peakHour = (substance.timeMinutes + pharma.peak) / 60;
        const focusHour = (onsetHour + peakHour) / 2;
        const focusNorm = (focusHour - startHour) / hourRange;
        for (let i = 0; i < WARP_SAMPLES; i++) {
            const n = i / (WARP_SAMPLES - 1);
            const d = n - focusNorm;
            const sigma = d < 0 ? SIGMA_ENTRY : SIGMA_EXIT;
            const g = Math.exp(-(d * d) / (2 * sigma * sigma));
            warpMult[i] = Math.max(warpMult[i], 1 + (SLOWMO_FACTOR - 1) * g);
        }
    }
    const warpCum = new Float64Array(WARP_SAMPLES);
    warpCum[0] = 0;
    for (let i = 1; i < WARP_SAMPLES; i++) {
        warpCum[i] = warpCum[i - 1] + warpMult[i - 1];
    }
    const warpTotal = warpCum[WARP_SAMPLES - 1] + warpMult[WARP_SAMPLES - 1];

    function warpedHour(wallT: number): number {
        const targetCum = wallT * warpTotal;
        let lo = 0, hi = WARP_SAMPLES - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (warpCum[mid + 1] <= targetCum) lo = mid + 1; else hi = mid;
        }
        const segStart = warpCum[lo];
        const segLen = warpMult[lo];
        const frac = segLen > 0 ? (targetCum - segStart) / segLen : 0;
        const norm = (lo + frac) / (WARP_SAMPLES - 1);
        return startHour + hourRange * norm;
    }

    function slowmoIntensity(hour: number): number {
        const norm = (hour - startHour) / hourRange;
        const idx = Math.min(WARP_SAMPLES - 1, Math.max(0, Math.round(norm * (WARP_SAMPLES - 1))));
        return Math.min(1, (warpMult[idx] - 1) / (SLOWMO_FACTOR - 1));
    }

    let playheadGroup: SVGElement | null = null;
    let phLine: SVGElement | null = null;
    let phGlow: SVGElement | null = null;
    let chevronGroup: SVGElement | null = null;
    let chevFill: SVGElement | null = null;
    let chevron2Group: SVGElement | null = null;
    let chevFill2: SVGElement | null = null;
    let bandClipRect: SVGElement | null = null;
    let bandClipId = '';

    const curveTotals: { ci: number; total: number }[] = [];
    for (let ci = 0; ci < curvesData.length; ci++) {
        if (!sourcePts[ci] || !targetPts[ci]) continue;
        let totalDelta = 0;
        for (let j = 0; j < sourcePts[ci].length; j++) {
            totalDelta += Math.abs((targetPts[ci][j]?.value || 0) - (sourcePts[ci][j]?.value || 0));
        }
        curveTotals.push({ ci, total: totalDelta });
    }
    curveTotals.sort((a, b) => b.total - a.total);
    const bestCurveIdx = curveTotals[0]?.ci ?? 0;
    const secondCurveIdx = curveTotals[1]?.ci ?? null;

    return {
        id: `substance-${stepIdx}-sweep`,
        label: substance.substance?.name || substance.key,
        category: 'lx-reveal',
        startTime,
        duration: sweepDuration * (warpTotal / WARP_SAMPLES),
        phaseIdx: 2,

        enter(ctx) {
            const svg = ctx.svgRoot;

            // Create playhead
            playheadGroup = svgEl('g', { class: 'sequential-playhead' }) as SVGElement;
            phGlow = svgEl('rect', {
                x: String(PHASE_CHART.padL - 8), y: String(PHASE_CHART.padT),
                width: '18', height: String(PHASE_CHART.plotH),
                fill: 'rgba(245, 200, 80, 0.06)', rx: '9', 'pointer-events': 'none',
            }) as SVGElement;
            playheadGroup.appendChild(phGlow);
            phLine = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(PHASE_CHART.padT),
                width: '1.5', height: String(PHASE_CHART.plotH),
                fill: 'rgba(245, 200, 80, 0.55)', rx: '0.75', 'pointer-events': 'none',
            }) as SVGElement;
            playheadGroup.appendChild(phLine);

            chevronGroup = svgEl('g', { 'pointer-events': 'none' }) as SVGElement;
            const primaryChevColor = substance.substance?.color || curvesData[bestCurveIdx]?.color || '#f5c850';
            chevFill = svgEl('path', {
                d: 'M -8 -10 L 0 2 L 8 -10 Z',
                fill: primaryChevColor, 'pointer-events': 'none',
            }) as SVGElement;
            chevronGroup.appendChild(chevFill);
            playheadGroup.appendChild(chevronGroup);

            if (secondCurveIdx != null && secondCurveIdx !== bestCurveIdx) {
                chevron2Group = svgEl('g', { 'pointer-events': 'none' }) as SVGElement;
                chevFill2 = svgEl('path', {
                    d: 'M -8 -10 L 0 2 L 8 -10 Z',
                    fill: curvesData[secondCurveIdx]?.color || '#94a3b8',
                    'pointer-events': 'none',
                }) as SVGElement;
                chevron2Group.appendChild(chevFill2);
                playheadGroup.appendChild(chevron2Group);
            }
            svg.appendChild(playheadGroup);

            // Create AUC band clip
            bandClipId = `tl-band-clip-${stepIdx}`;
            const defs = svg.querySelector('defs')!;
            const clip = svgEl('clipPath', { id: bandClipId });
            bandClipRect = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: '0', width: '0', height: '1200',
            }) as SVGElement;
            clip.appendChild(bandClipRect);
            defs.appendChild(clip);

            // Create AUC bands
            const bandsGroup = ctx.groups['phase-lx-bands'];
            if (bandsGroup) {
                for (let ci = 0; ci < curvesData.length; ci++) {
                    const bandD = phaseBandPath(targetPts[ci], sourcePts[ci]);
                    if (!bandD) continue;
                    const substanceColor = substance.substance?.color || curvesData[ci].color;
                    bandsGroup.appendChild(svgEl('path', {
                        d: bandD, fill: substanceColor, 'fill-opacity': '0.18',
                        class: 'lx-auc-band',
                        'clip-path': `url(#${bandClipId})`,
                        'data-substance-key': String(substance.key || ''),
                        'data-step-idx': String(stepIdx),
                        'data-curve-idx': String(ci),
                    }));
                }
            }
        },

        render(t, ctx) {
            const playheadHour = warpedHour(t);
            const playheadX = phaseChartX(playheadHour * 60);
            const smo = slowmoIntensity(playheadHour);

            // Update playhead position
            if (phLine) {
                const lineW = 1.5 + smo * 1.5;
                const lineOp = 0.55 + smo * 0.35;
                phLine.setAttribute('x', (playheadX - lineW / 2).toFixed(1));
                phLine.setAttribute('width', lineW.toFixed(2));
                phLine.setAttribute('fill', `rgba(245, 200, 80, ${lineOp.toFixed(2)})`);
            }
            if (phGlow) {
                const glowOp = 0.06 + smo * 0.10;
                phGlow.setAttribute('x', (playheadX - 9).toFixed(1));
                phGlow.setAttribute('fill', `rgba(245, 200, 80, ${glowOp.toFixed(2)})`);
            }

            // Update AUC band clip
            if (bandClipRect) {
                bandClipRect.setAttribute('width', (playheadX - PHASE_CHART.padL).toFixed(1));
            }

            // Morph Lx strokes + fills
            const lxGroup = ctx.groups['phase-lx-curves'];
            if (!lxGroup) return;
            const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
            const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');

            for (let ci = 0; ci < curvesData.length; ci++) {
                if (!sourcePts[ci] || !targetPts[ci]) continue;
                const morphed = buildProgressiveMorphPoints(
                    sourcePts[ci], targetPts[ci], playheadHour, BLEND_WIDTH
                );
                const strokeD = phasePointsToPath(morphed, true);
                if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', strokeD);
                if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
            }

            // Primary chevron tracks the most impacted curve.
            if (chevronGroup && chevFill && sourcePts[bestCurveIdx] && targetPts[bestCurveIdx]) {
                const morphed = buildProgressiveMorphPoints(
                    sourcePts[bestCurveIdx], targetPts[bestCurveIdx], playheadHour, BLEND_WIDTH
                );
                const morphedVal = interpolatePointsAtTime(morphed, playheadHour);
                const curveY = phaseChartY(morphedVal);

                const srcVal = interpolatePointsAtTime(sourcePts[bestCurveIdx], playheadHour);
                const tgtVal = interpolatePointsAtTime(targetPts[bestCurveIdx], playheadHour);
                const delta = Math.abs(tgtVal - srcVal);
                const pushDown = tgtVal < srcVal;
                const flipY = pushDown ? 1 : -1;
                const chevY = flipY === 1 ? curveY - 2 : curveY + 2;
                const intensity = Math.min(1, delta / 3);

                const baseColor = substance.substance?.color || curvesData[bestCurveIdx]?.color || '#f5c850';
                chevFill.setAttribute('fill', brightenTowardWhite(baseColor, intensity));
                chevFill.setAttribute('fill-opacity', (0.38 + intensity * 0.62).toFixed(2));
                chevronGroup.setAttribute(
                    'transform',
                    `translate(${playheadX.toFixed(1)}, ${chevY.toFixed(1)}) scale(1, ${flipY})`,
                );
            }

            // Secondary chevron tracks the second-most impacted curve.
            if (chevron2Group && chevFill2 && secondCurveIdx != null && sourcePts[secondCurveIdx] && targetPts[secondCurveIdx]) {
                const morphed = buildProgressiveMorphPoints(
                    sourcePts[secondCurveIdx], targetPts[secondCurveIdx], playheadHour, BLEND_WIDTH
                );
                const morphedVal = interpolatePointsAtTime(morphed, playheadHour);
                const curveY = phaseChartY(morphedVal);

                const srcVal = interpolatePointsAtTime(sourcePts[secondCurveIdx], playheadHour);
                const tgtVal = interpolatePointsAtTime(targetPts[secondCurveIdx], playheadHour);
                const delta = Math.abs(tgtVal - srcVal);
                const pushDown = tgtVal < srcVal;
                const flipY = pushDown ? 1 : -1;
                const chevY = flipY === 1 ? curveY - 2 : curveY + 2;
                const intensity = Math.min(1, delta / 6);

                chevFill2.setAttribute('fill-opacity', (0.06 + intensity * 0.42).toFixed(2));
                chevron2Group.setAttribute(
                    'transform',
                    `translate(${playheadX.toFixed(1)}, ${chevY.toFixed(1)}) scale(1, ${flipY})`,
                );
            }
        },

        exit(ctx) {
            // Remove playhead
            if (playheadGroup) playheadGroup.remove();
            playheadGroup = null;
            phLine = null;
            phGlow = null;
            chevronGroup = null;
            chevFill = null;
            chevron2Group = null;
            chevFill2 = null;

            // Remove clip
            const svg = ctx.svgRoot;
            const clip = svg.querySelector(`#${bandClipId}`);
            if (clip) clip.remove();

            // Remove this substance's AUC band paths (so they don't persist on backward seek)
            const bandsGroup = ctx.groups['phase-lx-bands'];
            if (bandsGroup) {
                bandsGroup.querySelectorAll(`.lx-auc-band[data-step-idx="${stepIdx}"]`).forEach(el => el.remove());
            }

            // Revert Lx curves to the source state (pre-substance, for backward seek)
            const lxGroup = ctx.groups['phase-lx-curves'];
            if (lxGroup) {
                const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
                const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');
                for (let ci = 0; ci < curvesData.length; ci++) {
                    if (!sourcePts[ci]) continue;
                    if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(sourcePts[ci], true));
                    if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(sourcePts[ci], true));
                }
            }
            bandClipRect = null;
        },
    };
}

// --- Substance pill reveal (per substance) ---
export function createSubstancePillSegment(
    startTime: number,
    stepIdx: number,
    substance: any,
    allocated: any[],
    curvesData: any[],
    lxCurves: any[],
): AnimationSegment {
    let pillG: SVGElement | null = null;

    return {
        id: `substance-${stepIdx}-pill`,
        label: `${substance.substance?.name || substance.key} pill`,
        category: 'lx-reveal',
        startTime,
        duration: 350,
        phaseIdx: 2,

        enter(ctx) {
            const timelineGroup = ctx.groups['phase-substance-timeline'];
            if (!timelineGroup) return;

            const alloc = allocated.find((a: any) => a.iv === substance);
            if (!alloc) return;
            const { laneIdx, startMin, endMin } = alloc;
            const sub = substance.substance;
            const color = sub ? sub.color : 'rgba(245,180,60,0.7)';
            const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
            const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;

            // Expand the strip only as far as currently revealed substances require.
            const visibleLaneCount = allocated
                .slice(0, stepIdx + 1)
                .reduce((max: number, a: any) => Math.max(max, a.laneIdx + 1), 0);
            const neededH = TIMELINE_ZONE.top + visibleLaneCount * laneStep + TIMELINE_ZONE.bottomPad;
            void animatePhaseChartViewBoxHeight(ctx.svgRoot as SVGSVGElement, Math.max(PHASE_CHART.viewH, neededH), 260);

            // Add lane stripes incrementally as lanes appear.
            const stripeFill = document.body.classList.contains('light-mode')
                ? 'rgba(0,0,0,0.03)'
                : 'rgba(255,255,255,0.02)';
            for (let idx = 1; idx < visibleLaneCount; idx += 2) {
                if (timelineGroup.querySelector(`.timeline-lane-stripe[data-lane-idx="${idx}"]`)) continue;
                timelineGroup.appendChild(svgEl('rect', {
                    x: String(PHASE_CHART.padL),
                    y: (TIMELINE_ZONE.top + idx * laneStep).toFixed(1),
                    width: String(PHASE_CHART.plotW),
                    height: String(TIMELINE_ZONE.laneH),
                    fill: stripeFill,
                    class: 'timeline-lane-stripe',
                    'data-lane-idx': String(idx),
                    'pointer-events': 'none',
                }));
            }

            const x1 = phaseChartX(startMin);
            const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
            const barW = Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - x1), plotRight - x1);
            const y = TIMELINE_ZONE.top + laneIdx * laneStep;
            const h = TIMELINE_ZONE.laneH;
            const rx = TIMELINE_ZONE.pillRx;

            pillG = svgEl('g', {
                class: 'timeline-pill-group', opacity: '0',
                'data-substance-key': substance.key,
                'data-time-minutes': String(substance.timeMinutes),
            }) as SVGElement;

            // Connector + dot
            const targetIdx = substance.targetCurveIdx ?? 0;
            const curveColor = curvesData[targetIdx]?.color || color;
            const timeH = substance.timeMinutes / 60;
            const desiredVal = lxCurves[targetIdx]
                ? interpolatePointsAtTime(lxCurves[targetIdx].desired, timeH) : 50;
            const connectorTopY = phaseChartY(desiredVal);

            pillG.appendChild(svgEl('line', {
                x1: x1.toFixed(1), y1: connectorTopY.toFixed(1),
                x2: x1.toFixed(1), y2: String(y),
                stroke: curveColor, 'stroke-opacity': '0.25', 'stroke-width': '0.75',
                'stroke-dasharray': '2 3',
                class: 'timeline-connector', 'pointer-events': 'none',
                'data-curve-idx': String(targetIdx), 'data-time-h': timeH.toFixed(3),
            }));

            pillG.appendChild(svgEl('circle', {
                cx: x1.toFixed(1), cy: connectorTopY.toFixed(1), r: '2.5',
                fill: curveColor, 'fill-opacity': '0.6',
                class: 'timeline-curve-dot', 'pointer-events': 'none',
                'data-curve-idx': String(targetIdx), 'data-time-h': timeH.toFixed(3),
            }));

            // Bar
            pillG.appendChild(svgEl('rect', {
                x: x1.toFixed(1), y: y.toFixed(1),
                width: barW.toFixed(1), height: String(h),
                rx: String(rx), fill: color, 'fill-opacity': '0.18',
                stroke: color, 'stroke-opacity': '0.35', 'stroke-width': '0.75',
                class: 'timeline-bar',
            }));

            // Label
            const name = sub?.name || substance.key;
            const dose = substance.dose || sub?.standardDose || '';
            const label = svgEl('text', {
                x: (x1 + 6).toFixed(1), y: (y + h / 2 + 3.5).toFixed(1),
                class: 'timeline-bar-label', fill: color, 'font-size': '9',
            });
            label.textContent = dose ? `${name} ${dose}` : name;
            // Rx badge as inline tspan after label text
            const regStatus = sub ? (sub.regulatoryStatus || '').toLowerCase() : '';
            if (regStatus === 'rx' || regStatus === 'controlled') {
                const rxSpan = svgEl('tspan', {
                    fill: '#e11d48', 'font-size': '7', 'font-weight': '700',
                    dy: '-0.5',
                });
                rxSpan.textContent = ' Rx';
                label.appendChild(rxSpan);
            }
            pillG.appendChild(label);

            timelineGroup.appendChild(pillG);
        },

        render(t, ctx) {
            if (!pillG) return;
            const ease = easeOutCubic(t);
            pillG.setAttribute('opacity', ease.toFixed(2));
        },

        exit(ctx) {
            if (pillG) pillG.remove();
            const timelineGroup = ctx.groups['phase-substance-timeline'];
            if (timelineGroup) {
                const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
                const remainingLaneCount = allocated
                    .slice(0, stepIdx)
                    .reduce((max: number, a: any) => Math.max(max, a.laneIdx + 1), 0);
                const neededH = TIMELINE_ZONE.top + remainingLaneCount * laneStep + TIMELINE_ZONE.bottomPad;
                void animatePhaseChartViewBoxHeight(ctx.svgRoot as SVGSVGElement, Math.max(PHASE_CHART.viewH, neededH), 220);

                timelineGroup.querySelectorAll('.timeline-lane-stripe').forEach((el: any) => {
                    const idx = parseInt(el.getAttribute('data-lane-idx') || '-1', 10);
                    if (Number.isFinite(idx) && idx >= remainingLaneCount) el.remove();
                });
            }
            pillG = null;
        },
    };
}

// --- Cinematic playhead morph (4500ms sweep) ---
export function createCinematicPlayheadSegment(startTime: number): AnimationSegment {
    let playheadGroup: SVGElement | null = null;
    let phLine: SVGElement | null = null;
    let phGlow: SVGElement | null = null;

    return {
        id: 'cinematic-playhead-morph',
        label: 'Playhead',
        category: 'lx-reveal',
        startTime,
        duration: 4500,
        phaseIdx: 2,

        enter(ctx) {
            const svg = ctx.svgRoot;
            playheadGroup = svgEl('g', { id: 'morph-playhead' }) as SVGElement;
            phGlow = svgEl('rect', {
                x: String(PHASE_CHART.padL - 8), y: String(PHASE_CHART.padT),
                width: '18', height: String(PHASE_CHART.plotH),
                fill: 'rgba(245, 200, 80, 0.06)', rx: '9', 'pointer-events': 'none',
            }) as SVGElement;
            playheadGroup.appendChild(phGlow);
            phLine = svgEl('rect', {
                x: String(PHASE_CHART.padL), y: String(PHASE_CHART.padT),
                width: '1.5', height: String(PHASE_CHART.plotH),
                fill: 'rgba(245, 200, 80, 0.55)', rx: '0.75', 'pointer-events': 'none',
            }) as SVGElement;
            playheadGroup.appendChild(phLine);

            const tooltipOverlay = ctx.groups['phase-tooltip-overlay'];
            if (tooltipOverlay) {
                svg.insertBefore(playheadGroup, tooltipOverlay);
            } else {
                svg.appendChild(playheadGroup);
            }
        },

        render(t, ctx) {
            if (!ctx.lxCurves || !ctx.curvesData) return;
            const ease = easeInOutCubic(t);
            const startHour = PHASE_CHART.startHour;
            const endHour = PHASE_CHART.endHour;
            const playheadHour = startHour + (endHour - startHour) * ease;
            const playheadX = phaseChartX(playheadHour * 60);

            if (phLine) phLine.setAttribute('x', (playheadX - 0.75).toFixed(1));
            if (phGlow) phGlow.setAttribute('x', (playheadX - 9).toFixed(1));

            // Morph desired paths to show Lx left of playhead, desired right of playhead
            const desiredGroup = ctx.groups['phase-desired-curves'];
            if (!desiredGroup) return;
            const strokePaths = desiredGroup.querySelectorAll('.phase-desired-path');
            const BLEND_WIDTH = 1.5;
            const morphedByCurve: any[] = [];

            for (let i = 0; i < ctx.lxCurves.length; i++) {
                const lxPts = ctx.lxCurves[i]?.points;
                const desiredPts = ctx.lxCurves[i]?.desired;
                if (!lxPts || !desiredPts || !strokePaths[i]) continue;

                const morphed = buildProgressiveMorphPoints(desiredPts, lxPts, playheadHour, BLEND_WIDTH);
                strokePaths[i].setAttribute('d', phasePointsToPath(morphed, true));
                morphedByCurve[i] = morphed;
            }

            // Keep timeline dots/connectors attached to the currently morphed curve state.
            const timelineGroup = ctx.groups['phase-substance-timeline'];
            if (timelineGroup) {
                timelineGroup.querySelectorAll('.timeline-curve-dot').forEach((dot: any) => {
                    const ci = parseInt(dot.getAttribute('data-curve-idx') || '-1');
                    const timeH = parseFloat(dot.getAttribute('data-time-h') || '');
                    if (Number.isNaN(ci) || Number.isNaN(timeH) || !morphedByCurve[ci]) return;
                    const val = interpolatePointsAtTime(morphedByCurve[ci], timeH);
                    dot.setAttribute('cy', phaseChartY(val).toFixed(1));
                });
                timelineGroup.querySelectorAll('.timeline-connector').forEach((line: any) => {
                    const ci = parseInt(line.getAttribute('data-curve-idx') || '-1');
                    const timeH = parseFloat(line.getAttribute('data-time-h') || '');
                    if (Number.isNaN(ci) || Number.isNaN(timeH) || !morphedByCurve[ci]) return;
                    const val = interpolatePointsAtTime(morphedByCurve[ci], timeH);
                    line.setAttribute('y1', phaseChartY(val).toFixed(1));
                });
            }

            // Fade arrows
            const arrowGroup = ctx.groups['phase-mission-arrows'];
            if (arrowGroup) {
                const arrowOp = Math.max(0, 0.7 * (1 - ease * 1.5));
                Array.from(arrowGroup.children).forEach((a: any) =>
                    a.setAttribute('opacity', arrowOp.toFixed(3)));
            }
        },

        exit(ctx) {
            if (playheadGroup) playheadGroup.remove();
            playheadGroup = null;
            phLine = null;
            phGlow = null;
        },
    };
}
