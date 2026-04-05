/**
 * Chart Extended — Day-level chart rendering for extended timelines (7-28 days).
 * Renders into the existing #phase-chart-svg at the same dimensions.
 * Exports: renderExtendedChart, clearExtendedChart
 * Depends on: constants, utils, types, substances
 */
import { PHASE_CHART, getExtendedChartConfig } from './constants';
import { svgEl, extendedChartX, extendedChartY, isLightMode } from './utils';
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

function buildSmoothPath(
    points: { day: number; value: number }[],
    config: ExtendedChartConfig,
): string {
    if (points.length === 0) return '';
    const mapped = points.map(p => ({
        x: extendedChartX(p.day, config),
        y: extendedChartY(p.value, config),
    }));
    if (mapped.length === 1) return `M${mapped[0].x.toFixed(1)},${mapped[0].y.toFixed(1)}`;

    // Catmull-Rom to cubic Bezier for smooth curves
    let d = `M${mapped[0].x.toFixed(1)},${mapped[0].y.toFixed(1)}`;
    for (let i = 0; i < mapped.length - 1; i++) {
        const p0 = mapped[Math.max(0, i - 1)];
        const p1 = mapped[i];
        const p2 = mapped[i + 1];
        const p3 = mapped[Math.min(mapped.length - 1, i + 2)];

        const tension = 0.35;
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

    // ── 3. Protocol phase bands (above the chart, in the header area) ──
    const phases = protocolPhases || phaseSpotlights;
    const phaseBandY = 4;
    const phaseBandH = 14;
    for (const phase of phases) {
        const x1 = extendedChartX(phase.startDay - 0.5, config);
        const x2 = extendedChartX(phase.endDay + 0.5, config);
        const w = Math.max(0, Math.min(x2, config.padL + config.plotW) - Math.max(x1, config.padL));
        const color = phase.color || '#60a5fa';
        gPhaseBands.appendChild(
            svgEl('rect', {
                x: String(Math.max(x1, config.padL)),
                y: String(phaseBandY),
                width: String(w),
                height: String(phaseBandH),
                fill: color,
                opacity: isLight ? '0.15' : '0.2',
                rx: '3',
                'pointer-events': 'none',
            }),
        );
        // Phase label centered
        const cx = Math.max(x1, config.padL) + w / 2;
        if (w > 30) {
            gPhaseBands.appendChild(
                svgEl('text', {
                    x: String(cx),
                    y: String(phaseBandY + 10),
                    fill: isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)',
                    'text-anchor': 'middle',
                    'font-family': "'IBM Plex Mono', monospace",
                    'font-size': '8',
                    'font-weight': '600',
                    'letter-spacing': '0.06em',
                    'text-transform': 'uppercase',
                }),
            ).textContent = ('name' in phase ? (phase as ProtocolPhase).name : phase.phase).toUpperCase();
        }
    }

    // ── 4. X-axis: day labels (at TOP, just below phase bands) ──
    const axisY = config.padT + config.plotH;
    const dayLabelY = phaseBandY + phaseBandH + 14; // just below phase bands, above plot area

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

    // ── 6. Curves — clean phase-scoped rendering ──
    // Only desired curves + AUC fill in spotlight zones. No baselines, no ghosts.

    // Ensure a <defs> element exists for clip-paths
    let defs = svg.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svg.insertBefore(defs, svg.firstChild);
    }

    for (let ei = 0; ei < effectRoster.length; ei++) {
        const curve = effectRoster[ei];
        const effectName = curve.effect;

        // Find which phases spotlight this effect
        const spotlightRanges = phaseSpotlights
            .filter(ps => ps.effects.includes(effectName))
            .map(ps => ({ start: ps.startDay, end: ps.endDay }));

        if (spotlightRanges.length === 0) continue; // not spotlighted — don't render at all

        // Build paths
        const desiredPath = buildSmoothPath(curve.desired, config);
        if (!desiredPath) continue;

        // Create clip-path covering only the spotlight day ranges
        const clipId = `ext-spotlight-clip-${ei}`;
        const oldClip = defs.querySelector(`#${clipId}`);
        if (oldClip) oldClip.remove();

        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.id = clipId;
        for (const range of spotlightRanges) {
            const x1 = extendedChartX(range.start - 0.5, config);
            const x2 = extendedChartX(range.end + 0.5, config);
            clipPath.appendChild(
                svgEl('rect', {
                    x: String(Math.max(x1, config.padL)),
                    y: '0',
                    width: String(Math.min(x2, config.padL + config.plotW) - Math.max(x1, config.padL)),
                    height: String(config.padT + config.plotH + 60),
                }),
            );
        }
        defs.appendChild(clipPath);

        // AUC fill between baseline and desired — clipped to spotlight ranges
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
                    'clip-path': `url(#${clipId})`,
                    'pointer-events': 'none',
                }),
            );
        }

        // Glow layer — thicker, blurred behind the main curve for depth
        gCurves.appendChild(
            svgEl('path', {
                d: desiredPath,
                fill: 'none',
                stroke: curve.color,
                'stroke-width': '6',
                opacity: '0.12',
                'clip-path': `url(#${clipId})`,
                'pointer-events': 'none',
            }),
        );

        // Main desired curve — solid, thick, clipped to spotlight ranges
        gCurves.appendChild(
            svgEl('path', {
                d: desiredPath,
                fill: 'none',
                stroke: curve.color,
                'stroke-width': '3',
                opacity: '1',
                'clip-path': `url(#${clipId})`,
                'pointer-events': 'none',
            }),
        );

        // Effect label — positioned at the midpoint of the first spotlight range
        const firstRange = spotlightRanges[0];
        const midDay = Math.round((firstRange.start + firstRange.end) / 2);
        const labelPt = curve.desired.reduce((best, p) =>
            Math.abs(p.day - midDay) < Math.abs(best.day - midDay) ? p : best,
        );
        if (labelPt) {
            // Find peak value in the spotlight range for better positioning
            const peakPt = curve.desired
                .filter(p => p.day >= firstRange.start && p.day <= firstRange.end)
                .reduce((best, p) => (p.value > best.value ? p : best), labelPt);

            const labelX = extendedChartX(midDay, config);
            const labelYPos = extendedChartY(peakPt.value, config) - 10;
            gCurves.appendChild(
                svgEl('text', {
                    x: String(labelX),
                    y: String(Math.max(labelYPos, config.padT + 8)),
                    fill: curve.color,
                    'text-anchor': 'middle',
                    'font-family': "'Space Grotesk', sans-serif",
                    'font-size': '11',
                    'font-weight': '600',
                    opacity: '0.85',
                }),
            ).textContent = curve.effect;
        }
    }

    // ── 7. Substance timeline (24h-style rich pills) ──
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
            const y = barAreaTop + rowIdx * laneStep;

            // Resolve substance from DB for rich info
            const sub = resolveSubstance(key, {});
            const subName = sub ? sub.name : key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const subColor = sub ? (sub.color || '#60a5fa') : '#60a5fa';
            const regStatus = sub ? ((sub as any).regulatoryStatus || '').toLowerCase() : '';
            const dose = entries[0]?.dose || (sub ? (sub as any).standardDose : '') || '';

            // Lane stripe (alternating odd rows)
            if (rowIdx % 2 === 1) {
                gSubstanceBars.appendChild(
                    svgEl('rect', {
                        x: String(config.padL),
                        y: String(y),
                        width: String(config.plotW),
                        height: String(laneH),
                        fill: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)',
                        'pointer-events': 'none',
                    }),
                );
            }

            // Determine active days for this substance
            const activeDays = new Set<number>();
            for (const entry of entries) {
                const endDay = protocolPhases
                    ? (protocolPhases.find(p => p.name === entry.phase)?.endDay || durationDays)
                    : durationDays;
                for (let d = entry.day; d <= endDay; d++) {
                    if (entry.frequency === 'alternate' && (d - entry.day) % 2 !== 0) continue;
                    activeDays.add(d);
                }
            }

            // Find contiguous runs and render pill bars
            const sortedDays = [...activeDays].sort((a, b) => a - b);
            if (sortedDays.length === 0) { rowIdx++; continue; }
            let runStart = sortedDays[0];
            let runEnd = sortedDays[0];
            let firstBarX1 = 0;
            let firstBarW = 0;
            let isFirstRun = true;

            for (let i = 1; i <= sortedDays.length; i++) {
                if (i < sortedDays.length && sortedDays[i] === runEnd + 1) {
                    runEnd = sortedDays[i];
                } else {
                    const x1 = extendedChartX(runStart - 0.4, config);
                    const x2 = extendedChartX(runEnd + 0.4, config);
                    const barW = Math.max(4, x2 - x1);

                    if (isFirstRun) {
                        firstBarX1 = x1;
                        firstBarW = barW;
                        isFirstRun = false;
                    }

                    // Pill bar: fill + stroke layering (matching 24h style)
                    gSubstanceBars.appendChild(
                        svgEl('rect', {
                            x: String(x1),
                            y: String(y),
                            width: String(barW),
                            height: String(laneH),
                            rx: String(pillRx),
                            ry: String(pillRx),
                            fill: subColor,
                            'fill-opacity': '0.22',
                            stroke: subColor,
                            'stroke-opacity': '0.45',
                            'stroke-width': '0.75',
                            'pointer-events': 'none',
                        }),
                    );

                    if (i < sortedDays.length) {
                        runStart = sortedDays[i];
                        runEnd = sortedDays[i];
                    }
                }
            }

            // Clip-path for label (extends to cover the full first bar + overflow)
            const clipId = `ext-tl-clip-${rowIdx}`;
            const oldClip = defs.querySelector(`#${clipId}`);
            if (oldClip) oldClip.remove();
            const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clip.id = clipId;
            const labelOverflow = Math.max(0, config.padL + config.plotW - (firstBarX1 + firstBarW));
            clip.appendChild(
                svgEl('rect', {
                    x: String(firstBarX1),
                    y: String(y),
                    width: String(firstBarW + labelOverflow),
                    height: String(laneH),
                    rx: String(pillRx),
                    ry: String(pillRx),
                }),
            );
            defs.appendChild(clip);

            // Rich label inside the first pill bar
            const contentG = svgEl('g', { 'clip-path': `url(#${clipId})` });
            const label = svgEl('text', {
                x: String(firstBarX1 + 5),
                y: String(y + laneH / 2 + 3),
                fill: isLight ? 'rgba(20,30,50,0.95)' : 'rgba(255,255,255,0.92)',
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': '9',
                'font-weight': '500',
                'letter-spacing': '0.02em',
            });

            const displayText = dose ? `${subName} ${dose}` : subName;
            label.textContent = displayText;

            // Rx badge as inline tspan
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
            gSubstanceBars.appendChild(contentG);

            // Substance name label on the left (outside chart area)
            const shortName = subName.length > 16 ? subName.slice(0, 14) + '..' : subName;
            gSubstanceBars.appendChild(
                svgEl('text', {
                    x: String(config.padL - 6),
                    y: String(y + laneH / 2 + 3),
                    fill: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(200,218,245,0.6)',
                    'text-anchor': 'end',
                    'font-family': "'IBM Plex Mono', monospace",
                    'font-size': '8',
                    'font-weight': '500',
                }),
            ).textContent = shortName;

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
