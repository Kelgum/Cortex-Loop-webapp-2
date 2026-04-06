/**
 * Chart Extended — Day-level chart rendering for extended timelines (7-28 days).
 * Renders into the existing #phase-chart-svg at the same dimensions.
 * Exports: renderExtendedChart, clearExtendedChart
 * Depends on: constants, utils, types, substances
 */
import { PHASE_CHART, getExtendedChartConfig } from './constants';
import { svgEl, extendedChartX, extendedChartY, isLightMode, parseDoseToMg } from './utils';
import { resolveSubstance } from './substances';
import type {
    ExtendedCurveData,
    ExtendedChartConfig,
    PhaseSpotlight,
    ProtocolPhase,
    ExtendedInterventionEntry,
} from './types';

// ── SVG group IDs used by extended chart ──
const GROUP_IDS = {
    axes: 'extended-x-axis',
    dayBands: 'extended-day-bands',
    phaseBands: 'extended-phase-bands',
    curves: 'extended-curves',
    substanceBars: 'extended-substance-bars',
    yAxis: 'extended-y-axis',
};

// ── Helpers ──

function ensureGroup(svg: SVGSVGElement, id: string): SVGGElement {
    let g = svg.getElementById(id) as SVGGElement | null;
    if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.id = id;
        svg.appendChild(g);
    }
    g.replaceChildren();
    return g;
}

/** Cubic interpolation between day-level data points for silky-smooth curves. */
function upsamplePoints(
    points: { day: number; value: number }[],
    samplesPerDay: number = 4,
): { day: number; value: number }[] {
    if (points.length < 2) return points;
    const result: { day: number; value: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        for (let s = 0; s < samplesPerDay; s++) {
            const t = s / samplesPerDay;
            const t2 = t * t;
            const t3 = t2 * t;
            // Catmull-Rom interpolation
            const v = 0.5 * (
                (2 * p1.value) +
                (-p0.value + p2.value) * t +
                (2 * p0.value - 5 * p1.value + 4 * p2.value - p3.value) * t2 +
                (-p0.value + 3 * p1.value - 3 * p2.value + p3.value) * t3
            );
            result.push({ day: p1.day + (p2.day - p1.day) * t, value: v });
        }
    }
    result.push(points[points.length - 1]);
    return result;
}

function buildSmoothPath(
    points: { day: number; value: number }[],
    config: ExtendedChartConfig,
): string {
    if (points.length === 0) return '';

    // Upsample for silky curves — 4 sub-samples per day gap
    const upsampled = upsamplePoints(points, 4);
    const mapped = upsampled.map(p => ({
        x: extendedChartX(p.day, config),
        y: extendedChartY(p.value, config),
    }));
    if (mapped.length === 1) return `M${mapped[0].x.toFixed(1)},${mapped[0].y.toFixed(1)}`;

    // Catmull-Rom to cubic Bezier for smooth rendering
    let d = `M${mapped[0].x.toFixed(1)},${mapped[0].y.toFixed(1)}`;
    for (let i = 0; i < mapped.length - 1; i++) {
        const p0 = mapped[Math.max(0, i - 1)];
        const p1 = mapped[i];
        const p2 = mapped[i + 1];
        const p3 = mapped[Math.min(mapped.length - 1, i + 2)];

        const tension = 0.25;
        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;

        d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
}

// ── Main render function ──

export function renderExtendedChart(opts: {
    svg: SVGSVGElement;
    durationDays: number;
    effectRoster: ExtendedCurveData[];
    phaseSpotlights: PhaseSpotlight[];
    interventions?: ExtendedInterventionEntry[];
    protocolPhases?: ProtocolPhase[];
}): void {
    const { svg, durationDays, effectRoster, phaseSpotlights, interventions, protocolPhases } = opts;
    const config = getExtendedChartConfig(durationDays);
    const isLight = isLightMode();

    // Expand viewBox to fit substance lanes below the plot area
    const substanceCount = interventions
        ? new Set(interventions.map(iv => iv.key)).size
        : 0;
    const laneH = 16;
    const laneGap = 2;
    const substanceAreaHeight = substanceCount > 0 ? 10 + substanceCount * (laneH + laneGap) : 0;
    const requiredHeight = config.padT + config.plotH + substanceAreaHeight + 10;
    const viewH = Math.max(PHASE_CHART.viewH as number, requiredHeight);
    svg.setAttribute('viewBox', `0 0 ${config.viewW} ${viewH}`);

    // Create/clear groups
    const gDayBands = ensureGroup(svg, GROUP_IDS.dayBands);
    const gPhaseBands = ensureGroup(svg, GROUP_IDS.phaseBands);
    const gAxes = ensureGroup(svg, GROUP_IDS.axes);
    const gYAxis = ensureGroup(svg, GROUP_IDS.yAxis);
    const gCurves = ensureGroup(svg, GROUP_IDS.curves);
    const gSubstanceBars = ensureGroup(svg, GROUP_IDS.substanceBars);

    // ── 1. Alternating day column bands ──
    for (let d = config.startUnit; d <= config.endUnit; d++) {
        const x1 = extendedChartX(d - 0.5, config);
        const x2 = extendedChartX(d + 0.5, config);
        const w = Math.max(0, x2 - x1);
        if (d % 2 === 0) {
            gDayBands.appendChild(
                svgEl('rect', {
                    x: String(Math.max(x1, config.padL)),
                    y: String(config.padT),
                    width: String(Math.min(w, config.padL + config.plotW - Math.max(x1, config.padL))),
                    height: String(config.plotH),
                    fill: isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.02)',
                    'pointer-events': 'none',
                }),
            );
        }
    }

    // ── 2. Week dividers (every 7 days for 14+ day modes) ──
    if (durationDays > 7) {
        for (let d = 7; d < durationDays; d += 7) {
            const x = extendedChartX(d + 0.5, config);
            gDayBands.appendChild(
                svgEl('line', {
                    x1: String(x),
                    y1: String(config.padT),
                    x2: String(x),
                    y2: String(config.padT + config.plotH),
                    stroke: isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)',
                    'stroke-width': '1.5',
                    'stroke-dasharray': '4 4',
                    'pointer-events': 'none',
                }),
            );
            // Week label
            const weekNum = Math.floor(d / 7);
            gDayBands.appendChild(
                svgEl('text', {
                    x: String(x + 4),
                    y: String(config.padT + 12),
                    fill: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.25)',
                    'font-family': "'IBM Plex Mono', monospace",
                    'font-size': '8',
                    'font-weight': '500',
                }),
            ).textContent = `Wk ${weekNum + 1}`;
        }
    }

    // ── 3. Protocol phase bands with effect indicators ──
    const phases = protocolPhases || phaseSpotlights;
    const phaseBandY = 2;
    const phaseBandH = 14;

    for (const phase of phases) {
        const x1 = extendedChartX(phase.startDay - 0.5, config);
        const x2 = extendedChartX(phase.endDay + 0.5, config);
        const phaseXL = Math.max(x1, config.padL);
        const phaseXR = Math.min(x2, config.padL + config.plotW);
        const w = Math.max(0, phaseXR - phaseXL);
        const color = phase.color || '#60a5fa';

        // Phase band
        gPhaseBands.appendChild(
            svgEl('rect', {
                x: String(phaseXL),
                y: String(phaseBandY),
                width: String(w),
                height: String(phaseBandH),
                fill: color,
                opacity: isLight ? '0.12' : '0.18',
                rx: '3',
                'pointer-events': 'none',
            }),
        );

        // Phase name + effect dots on one line
        const spotEffects = 'effects' in phase ? (phase as PhaseSpotlight).effects : [];
        const cx = phaseXL + w / 2;
        if (w > 30) {
            const phaseName = ('name' in phase ? (phase as ProtocolPhase).name : phase.phase).toUpperCase();
            gPhaseBands.appendChild(
                svgEl('text', {
                    x: String(cx),
                    y: String(phaseBandY + 10),
                    fill: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.65)',
                    'text-anchor': 'middle',
                    'font-family': "'IBM Plex Mono', monospace",
                    'font-size': '7',
                    'font-weight': '600',
                    'letter-spacing': '0.05em',
                }),
            ).textContent = phaseName;

            // Small colored dots for active effects (right of phase name)
            const dotStartX = cx + phaseName.length * 2.2 + 6;
            for (let si = 0; si < spotEffects.length; si++) {
                const effCurve = effectRoster.find(c => c.effect === spotEffects[si]);
                const effColor = effCurve?.color || color;
                gPhaseBands.appendChild(
                    svgEl('circle', {
                        cx: String(dotStartX + si * 8),
                        cy: String(phaseBandY + 7),
                        r: '2.5',
                        fill: effColor,
                        opacity: '0.7',
                        'pointer-events': 'none',
                    }),
                );
            }
        }
    }

    // ── 4. X-axis: day labels (at TOP, just below phase bands) ──
    const axisY = config.padT + config.plotH;
    const dayLabelY = phaseBandY + phaseBandH + 12; // just below phase bands, above plot area

    // Bottom boundary line of plot area
    gAxes.appendChild(
        svgEl('line', {
            x1: String(config.padL),
            y1: String(axisY),
            x2: String(config.padL + config.plotW),
            y2: String(axisY),
            stroke: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(174,201,237,0.12)',
            'stroke-width': '0.5',
        }),
    );
    // Top boundary line (day labels sit on this)
    gAxes.appendChild(
        svgEl('line', {
            x1: String(config.padL),
            y1: String(config.padT),
            x2: String(config.padL + config.plotW),
            y2: String(config.padT),
            stroke: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(174,201,237,0.12)',
            'stroke-width': '0.5',
        }),
    );
    // Day labels at top
    const skipEvery = durationDays > 21 ? 2 : durationDays > 14 ? 2 : 1;
    for (let d = config.startUnit; d <= config.endUnit; d++) {
        if (skipEvery > 1 && d % skipEvery !== 1 && d !== config.endUnit) continue;
        const x = extendedChartX(d, config);
        // Tick mark (above plot area)
        gAxes.appendChild(
            svgEl('line', {
                x1: String(x),
                y1: String(config.padT - 4),
                x2: String(x),
                y2: String(config.padT),
                stroke: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(174,201,237,0.2)',
                'stroke-width': '0.5',
            }),
        );
        // Day number label
        gAxes.appendChild(
            svgEl('text', {
                x: String(x),
                y: String(dayLabelY),
                fill: isLight ? 'rgba(0,0,0,0.45)' : 'rgba(174,201,237,0.55)',
                'text-anchor': 'middle',
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': durationDays > 14 ? '7.5' : '8.5',
                'font-weight': '400',
            }),
        ).textContent = `${d}`;
    }

    // ── 5. Y-axis (0-100 effect scale) ──
    const ySteps = [0, 25, 50, 75, 100];
    for (const val of ySteps) {
        const y = extendedChartY(val, config);
        // Grid line
        gYAxis.appendChild(
            svgEl('line', {
                x1: String(config.padL),
                y1: String(y),
                x2: String(config.padL + config.plotW),
                y2: String(y),
                stroke: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(174,201,237,0.06)',
                'stroke-width': '0.5',
                'pointer-events': 'none',
            }),
        );
        // Label
        gYAxis.appendChild(
            svgEl('text', {
                x: String(config.padL - 8),
                y: String(y + 3),
                fill: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(174,201,237,0.5)',
                'text-anchor': 'end',
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': '8',
                'font-weight': '400',
            }),
        ).textContent = String(val);
    }

    // ── 6. Curves — full-span with smooth emphasis modulation ──
    // Both curves always visible across all 28 days.
    // Spotlight phases get emphasis via SVG <mask> with gradient fade edges.

    // Ensure a <defs> element exists
    let defs = svg.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svg.insertBefore(defs, svg.firstChild);
    }

    const fadeDays = 2; // days over which emphasis fades in/out
    const maskH = config.padT + config.plotH + 60;

    for (let ei = 0; ei < effectRoster.length; ei++) {
        const curve = effectRoster[ei];
        const effectName = curve.effect;

        const desiredPath = buildSmoothPath(curve.desired, config);
        if (!desiredPath) continue;

        // Find which phases spotlight this effect
        const spotlightRanges = phaseSpotlights
            .filter(ps => ps.effects.includes(effectName))
            .map(ps => ({ start: ps.startDay, end: ps.endDay }));

        // Build a gradient mask for smooth fade transitions
        const maskId = `ext-emphasis-mask-${ei}`;
        const oldMask = defs.querySelector(`#${maskId}`);
        if (oldMask) oldMask.remove();

        if (spotlightRanges.length > 0) {
            const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
            mask.id = maskId;
            mask.setAttribute('maskUnits', 'userSpaceOnUse');
            mask.setAttribute('x', '0');
            mask.setAttribute('y', '0');
            mask.setAttribute('width', String(config.viewW));
            mask.setAttribute('height', String(maskH));

            for (let ri = 0; ri < spotlightRanges.length; ri++) {
                const range = spotlightRanges[ri];
                const solidX1 = extendedChartX(range.start, config);
                const solidX2 = extendedChartX(range.end, config);
                const fadeInX = extendedChartX(Math.max(1, range.start - fadeDays), config);
                const fadeOutX = extendedChartX(Math.min(durationDays, range.end + fadeDays), config);

                // Fade-in gradient
                const fadeInId = `ext-fi-${ei}-${ri}`;
                const fiGrad = svgEl('linearGradient', {
                    id: fadeInId,
                    x1: String(fadeInX), y1: '0',
                    x2: String(solidX1), y2: '0',
                    gradientUnits: 'userSpaceOnUse',
                });
                fiGrad.appendChild(svgEl('stop', { offset: '0', 'stop-color': 'white', 'stop-opacity': '0' }));
                fiGrad.appendChild(svgEl('stop', { offset: '1', 'stop-color': 'white', 'stop-opacity': '1' }));
                defs.appendChild(fiGrad);
                mask.appendChild(svgEl('rect', {
                    x: String(fadeInX), y: '0',
                    width: String(Math.max(1, solidX1 - fadeInX)), height: String(maskH),
                    fill: `url(#${fadeInId})`,
                }));

                // Solid spotlight zone
                mask.appendChild(svgEl('rect', {
                    x: String(solidX1), y: '0',
                    width: String(Math.max(1, solidX2 - solidX1)), height: String(maskH),
                    fill: 'white',
                }));

                // Fade-out gradient
                const fadeOutId = `ext-fo-${ei}-${ri}`;
                const foGrad = svgEl('linearGradient', {
                    id: fadeOutId,
                    x1: String(solidX2), y1: '0',
                    x2: String(fadeOutX), y2: '0',
                    gradientUnits: 'userSpaceOnUse',
                });
                foGrad.appendChild(svgEl('stop', { offset: '0', 'stop-color': 'white', 'stop-opacity': '1' }));
                foGrad.appendChild(svgEl('stop', { offset: '1', 'stop-color': 'white', 'stop-opacity': '0' }));
                defs.appendChild(foGrad);
                mask.appendChild(svgEl('rect', {
                    x: String(solidX2), y: '0',
                    width: String(Math.max(1, fadeOutX - solidX2)), height: String(maskH),
                    fill: `url(#${fadeOutId})`,
                }));
            }
            defs.appendChild(mask);
        }

        // ── Base layer: full 28-day curve at reduced emphasis (same width, just dimmer) ──
        gCurves.appendChild(
            svgEl('path', {
                d: desiredPath,
                fill: 'none',
                stroke: curve.color,
                'stroke-width': '3',
                opacity: '0.2',
                'pointer-events': 'none',
            }),
        );

        // ── Emphasis layer: masked with gradient fades ──
        if (spotlightRanges.length > 0) {
            const maskRef = `url(#${maskId})`;

            // AUC fill
            if (curve.baseline.length > 0 && curve.desired.length > 0) {
                const fillPath =
                    buildSmoothPath(curve.desired, config) +
                    ' L' + extendedChartX(curve.baseline[curve.baseline.length - 1].day, config).toFixed(1) +
                    ',' + extendedChartY(curve.baseline[curve.baseline.length - 1].value, config).toFixed(1) +
                    ' ' + buildSmoothPath([...curve.baseline].reverse(), config).replace(/^M/, 'L') +
                    ' Z';
                gCurves.appendChild(
                    svgEl('path', {
                        d: fillPath,
                        fill: curve.color,
                        opacity: '0.10',
                        mask: maskRef,
                        'pointer-events': 'none',
                    }),
                );
            }

            // Glow layer
            gCurves.appendChild(
                svgEl('path', {
                    d: desiredPath,
                    fill: 'none',
                    stroke: curve.color,
                    'stroke-width': '6',
                    opacity: '0.12',
                    mask: maskRef,
                    'pointer-events': 'none',
                }),
            );

            // Thick emphasized curve
            gCurves.appendChild(
                svgEl('path', {
                    d: desiredPath,
                    fill: 'none',
                    stroke: curve.color,
                    'stroke-width': '3',
                    opacity: '0.9',
                    mask: maskRef,
                    'pointer-events': 'none',
                }),
            );
        }

        // Effect label at chart right edge
        if (curve.desired.length > 0) {
            const lastPt = curve.desired[curve.desired.length - 1];
            gCurves.appendChild(
                svgEl('text', {
                    x: String(config.padL + config.plotW + 8),
                    y: String(extendedChartY(lastPt.value, config) + 3),
                    fill: curve.color,
                    'font-family': "'Space Grotesk', sans-serif",
                    'font-size': '11',
                    'font-weight': '600',
                    opacity: '0.85',
                }),
            ).textContent = curve.effect;
        }
    }

    // ── 7. Substance timeline — dose envelope (FCP volume curve style) ──
    if (interventions && interventions.length > 0) {
        const laneH = 16;
        const laneGap = 2;
        const pillRx = 3;
        const barAreaTop = axisY + 6;

        // Separator line between chart and substance timeline
        gSubstanceBars.appendChild(
            svgEl('line', {
                x1: String(config.padL),
                y1: String(axisY + 1),
                x2: String(config.padL + config.plotW),
                y2: String(axisY + 1),
                stroke: isLight ? 'rgba(80,110,150,0.3)' : 'rgba(146,186,255,0.2)',
                'stroke-width': '0.75',
                'pointer-events': 'none',
            }),
        );

        // Group interventions by substance key
        const substanceMap = new Map<string, ExtendedInterventionEntry[]>();
        for (const iv of interventions) {
            const list = substanceMap.get(iv.key) || [];
            list.push(iv);
            substanceMap.set(iv.key, list);
        }

        const laneStep = laneH + laneGap;
        let rowIdx = 0;
        for (const [key, entries] of substanceMap) {
            const laneY = barAreaTop + rowIdx * laneStep;

            // Resolve substance from DB
            const sub = resolveSubstance(key, {});
            const subName = sub ? sub.name : key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const subColor = sub ? (sub.color || '#60a5fa') : '#60a5fa';
            const regStatus = sub ? ((sub as any).regulatoryStatus || '').toLowerCase() : '';

            // Lane stripe (alternating odd rows)
            if (rowIdx % 2 === 1) {
                gSubstanceBars.appendChild(
                    svgEl('rect', {
                        x: String(config.padL),
                        y: String(laneY),
                        width: String(config.plotW),
                        height: String(laneH),
                        fill: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)',
                        'pointer-events': 'none',
                    }),
                );
            }

            // ── Build dose-per-day map ──
            // Sort entries by start day so later entries override earlier for overlapping days
            const sorted = [...entries].sort((a, b) => a.day - b.day);
            const doseAtDay = new Map<number, { doseMg: number; label: string }>();
            let maxDoseMg = 0;

            for (const entry of sorted) {
                const baseMg = parseDoseToMg(entry.dose || '') ?? 100;
                const effectiveMg = baseMg * (entry.doseMultiplier || 1.0);
                const endDay = protocolPhases
                    ? (protocolPhases.find(p => p.name === entry.phase)?.endDay || durationDays)
                    : durationDays;
                for (let d = entry.day; d <= endDay; d++) {
                    if (entry.frequency === 'alternate' && (d - entry.day) % 2 !== 0) continue;
                    doseAtDay.set(d, { doseMg: effectiveMg, label: entry.dose || '' });
                }
                if (effectiveMg > maxDoseMg) maxDoseMg = effectiveMg;
            }
            if (maxDoseMg <= 0) maxDoseMg = 100;

            // ── Find contiguous runs and render dose envelopes ──
            const activeDays = [...doseAtDay.keys()].sort((a, b) => a - b);
            if (activeDays.length === 0) { rowIdx++; continue; }

            const laneBottom = laneY + laneH;
            const doseAnnotations: { x: number; y: number; label: string }[] = [];
            let firstBarX1 = 0;
            let isFirstRun = true;

            // Split into contiguous runs
            const runs: number[][] = [];
            let currentRun = [activeDays[0]];
            for (let i = 1; i < activeDays.length; i++) {
                if (activeDays[i] === activeDays[i - 1] + 1) {
                    currentRun.push(activeDays[i]);
                } else {
                    runs.push(currentRun);
                    currentRun = [activeDays[i]];
                }
            }
            runs.push(currentRun);

            // Clip-path for pill-shaped rounding of the whole lane
            const clipId = `ext-env-clip-${rowIdx}`;
            const oldClip = defs.querySelector(`#${clipId}`);
            if (oldClip) oldClip.remove();

            for (const run of runs) {
                const runStartDay = run[0];
                const runEndDay = run[run.length - 1];
                const x1 = extendedChartX(runStartDay - 0.4, config);
                const x2 = extendedChartX(runEndDay + 0.4, config);
                if (isFirstRun) { firstBarX1 = x1; isFirstRun = false; }

                // Build top-edge points for envelope
                const topPoints: { x: number; y: number }[] = [];
                let prevDoseMg = -1;
                let lastAnnotatedLabel = '';

                for (const day of run) {
                    const info = doseAtDay.get(day)!;
                    const fraction = 0.25 + 0.75 * (info.doseMg / maxDoseMg);
                    const topY = laneY + laneH * (1 - fraction);
                    const dayX = extendedChartX(day, config);
                    // Clamp annotation Y to stay within the lane (3px from top, never below lane)
                    const annY = Math.min(topY + 9, laneY + laneH - 2);

                    // At dose transitions, insert a ramp point
                    if (prevDoseMg >= 0 && Math.abs(info.doseMg - prevDoseMg) > 0.01) {
                        // Ramp: start diagonal 0.5 days before this point
                        const rampX = extendedChartX(day - 0.5, config);
                        const prevFrac = 0.25 + 0.75 * (prevDoseMg / maxDoseMg);
                        const prevTopY = laneY + laneH * (1 - prevFrac);
                        topPoints.push({ x: rampX, y: prevTopY });

                        // Only annotate if the dose label actually changed
                        if (info.label !== lastAnnotatedLabel) {
                            doseAnnotations.push({ x: dayX, y: annY, label: info.label });
                            lastAnnotatedLabel = info.label;
                        }
                    } else if (day === runStartDay) {
                        // First day: annotate starting dose
                        doseAnnotations.push({ x: dayX + 4, y: annY, label: info.label });
                        lastAnnotatedLabel = info.label;
                    }

                    topPoints.push({ x: dayX, y: topY });
                    prevDoseMg = info.doseMg;
                }

                // Build closed envelope path: vertical walls at start/end, top edge varies
                if (topPoints.length === 0) continue;
                const firstTopY = topPoints[0].y;
                const lastTopY = topPoints[topPoints.length - 1].y;

                // Start at bottom-left, vertical wall up to first dose height
                let fillD = `M${x1.toFixed(1)},${laneBottom.toFixed(1)}`;
                fillD += ` L${x1.toFixed(1)},${firstTopY.toFixed(1)}`;
                // Along top edge through all points
                for (const pt of topPoints) {
                    fillD += ` L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                }
                // Vertical wall down at the end, back along bottom, close
                fillD += ` L${x2.toFixed(1)},${lastTopY.toFixed(1)}`;
                fillD += ` L${x2.toFixed(1)},${laneBottom.toFixed(1)} Z`;

                // Top-edge-only open path (for stroke) — includes vertical walls
                let strokeD = `M${x1.toFixed(1)},${laneBottom.toFixed(1)}`;
                strokeD += ` L${x1.toFixed(1)},${firstTopY.toFixed(1)}`;
                for (const pt of topPoints) {
                    strokeD += ` L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                }
                strokeD += ` L${x2.toFixed(1)},${lastTopY.toFixed(1)}`;
                strokeD += ` L${x2.toFixed(1)},${laneBottom.toFixed(1)}`;

                // Render filled envelope
                gSubstanceBars.appendChild(
                    svgEl('path', {
                        d: fillD,
                        fill: subColor,
                        'fill-opacity': '0.22',
                        'pointer-events': 'none',
                    }),
                );

                // Render top-edge stroke
                gSubstanceBars.appendChild(
                    svgEl('path', {
                        d: strokeD,
                        fill: 'none',
                        stroke: subColor,
                        'stroke-opacity': '0.55',
                        'stroke-width': '0.75',
                        'pointer-events': 'none',
                    }),
                );

                // Bottom baseline stroke
                gSubstanceBars.appendChild(
                    svgEl('line', {
                        x1: String(x1),
                        y1: String(laneBottom),
                        x2: String(x2),
                        y2: String(laneBottom),
                        stroke: subColor,
                        'stroke-opacity': '0.15',
                        'stroke-width': '0.5',
                        'pointer-events': 'none',
                    }),
                );
            }

            // ── Dose annotations at transition points ──
            for (const ann of doseAnnotations) {
                gSubstanceBars.appendChild(
                    svgEl('text', {
                        x: String(ann.x),
                        y: String(ann.y),
                        fill: isLight ? 'rgba(20,30,50,0.8)' : 'rgba(255,255,255,0.75)',
                        'font-family': "'IBM Plex Mono', monospace",
                        'font-size': '7',
                        'font-weight': '500',
                        'pointer-events': 'none',
                    }),
                ).textContent = ann.label;
            }

            // ── Left-side substance pill label (24h style) ──
            const pillW = config.padL - 20;
            const pillX = 10;
            const shortName = subName.length > 16 ? subName.slice(0, 14) + '..' : subName;

            // Pill background: fill + stroke layering (matching 24h substance-timeline.ts)
            gSubstanceBars.appendChild(
                svgEl('rect', {
                    x: String(pillX),
                    y: String(laneY),
                    width: String(pillW),
                    height: String(laneH),
                    rx: String(3),
                    ry: String(3),
                    fill: subColor,
                    'fill-opacity': '0.22',
                    stroke: subColor,
                    'stroke-opacity': '0.45',
                    'stroke-width': '0.75',
                    'pointer-events': 'none',
                }),
            );

            // Label text inside pill
            const nameLabel = svgEl('text', {
                x: String(pillX + 5),
                y: String(laneY + laneH / 2 + 3),
                fill: isLight ? 'rgba(20,30,50,0.95)' : 'rgba(255,255,255,0.92)',
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': '9',
                'font-weight': '500',
                'letter-spacing': '0.02em',
                'pointer-events': 'none',
            });
            nameLabel.textContent = shortName;
            // Rx badge
            if (regStatus === 'rx' || regStatus === 'controlled') {
                const rxSpan = svgEl('tspan', {
                    fill: '#e11d48',
                    'font-size': '7',
                    'font-weight': '700',
                    dy: '-0.5',
                });
                rxSpan.textContent = ' Rx';
                nameLabel.appendChild(rxSpan);
            }
            gSubstanceBars.appendChild(nameLabel);

            rowIdx++;
        }
    }
}

/** Remove all extended chart groups from the SVG. */
export function clearExtendedChart(svg: SVGSVGElement): void {
    for (const id of Object.values(GROUP_IDS)) {
        const g = svg.getElementById(id);
        if (g) g.remove();
    }
    // Clean up clip-paths from defs
    const defs = svg.querySelector('defs');
    if (defs) {
        defs.querySelectorAll('[id^="ext-"]').forEach(el => el.remove());
    }
    // Restore original viewBox
    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${PHASE_CHART.viewH}`);
}
