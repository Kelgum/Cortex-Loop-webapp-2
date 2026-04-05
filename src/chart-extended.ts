/**
 * Chart Extended — Day-level chart rendering for extended timelines (7-28 days).
 * Renders into the existing #phase-chart-svg at the same dimensions.
 * Exports: renderExtendedChart, clearExtendedChart
 * Depends on: constants, utils, types
 */
import { PHASE_CHART, getExtendedChartConfig } from './constants';
import { svgEl, extendedChartX, extendedChartY, isLightMode } from './utils';
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

    // ── 4. X-axis: day labels ──
    const axisY = config.padT + config.plotH;
    // Bottom boundary line
    gAxes.appendChild(
        svgEl('line', {
            x1: String(config.padL),
            y1: String(axisY),
            x2: String(config.padL + config.plotW),
            y2: String(axisY),
            stroke: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(174,201,237,0.22)',
            'stroke-width': '0.75',
        }),
    );
    // Day labels
    const skipEvery = durationDays > 21 ? 2 : durationDays > 14 ? 2 : 1;
    for (let d = config.startUnit; d <= config.endUnit; d++) {
        if (skipEvery > 1 && d % skipEvery !== 1 && d !== config.endUnit) continue;
        const x = extendedChartX(d, config);
        // Tick
        gAxes.appendChild(
            svgEl('line', {
                x1: String(x),
                y1: String(axisY),
                x2: String(x),
                y2: String(axisY + 5),
                stroke: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(174,201,237,0.3)',
                'stroke-width': '0.5',
            }),
        );
        // Label
        gAxes.appendChild(
            svgEl('text', {
                x: String(x),
                y: String(axisY + 16),
                fill: isLight ? 'rgba(0,0,0,0.55)' : 'rgba(174,201,237,0.7)',
                'text-anchor': 'middle',
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': durationDays > 14 ? '8' : '9',
                'font-weight': '400',
            }),
        ).textContent = `${d}`;
    }
    // "Day" label centered below
    gAxes.appendChild(
        svgEl('text', {
            x: String(config.padL + config.plotW / 2),
            y: String(axisY + 30),
            fill: isLight ? 'rgba(0,0,0,0.35)' : 'rgba(174,201,237,0.45)',
            'text-anchor': 'middle',
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '9',
            'font-weight': '500',
            'letter-spacing': '0.08em',
        }),
    ).textContent = 'DAY';

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

    // ── 6. Curves — render all effects, spotlight ones at full opacity ──
    // Build a set of currently spotlighted effect names (union across all phases)
    const allSpotlightEffects = new Set<string>();
    for (const ps of phaseSpotlights) {
        for (const eff of ps.effects) allSpotlightEffects.add(eff);
    }

    for (const curve of effectRoster) {
        const isSpotlight = allSpotlightEffects.has(curve.effect);
        const opacity = isSpotlight ? '1' : '0.12';

        // Baseline (dashed)
        const baselinePath = buildSmoothPath(curve.baseline, config);
        if (baselinePath) {
            gCurves.appendChild(
                svgEl('path', {
                    d: baselinePath,
                    fill: 'none',
                    stroke: curve.color,
                    'stroke-width': isSpotlight ? '1.5' : '1',
                    'stroke-dasharray': '4 3',
                    opacity,
                    'pointer-events': 'none',
                }),
            );
        }

        // Desired (solid)
        const desiredPath = buildSmoothPath(curve.desired, config);
        if (desiredPath) {
            gCurves.appendChild(
                svgEl('path', {
                    d: desiredPath,
                    fill: 'none',
                    stroke: curve.color,
                    'stroke-width': isSpotlight ? '2.5' : '1',
                    opacity,
                    'pointer-events': 'none',
                }),
            );
        }

        // AUC fill between baseline and desired for spotlight effects
        if (isSpotlight && curve.baseline.length > 0 && curve.desired.length > 0) {
            const fillPath = buildSmoothPath(curve.desired, config)
                + ' L' + extendedChartX(curve.baseline[curve.baseline.length - 1].day, config).toFixed(1)
                + ',' + extendedChartY(curve.baseline[curve.baseline.length - 1].value, config).toFixed(1)
                + ' ' + buildSmoothPath([...curve.baseline].reverse(), config).replace(/^M/, 'L')
                + ' Z';
            gCurves.appendChild(
                svgEl('path', {
                    d: fillPath,
                    fill: curve.color,
                    opacity: '0.06',
                    'pointer-events': 'none',
                }),
            );
        }

        // Effect label at right edge
        if (isSpotlight && curve.desired.length > 0) {
            const lastPt = curve.desired[curve.desired.length - 1];
            gCurves.appendChild(
                svgEl('text', {
                    x: String(config.padL + config.plotW + 8),
                    y: String(extendedChartY(lastPt.value, config) + 3),
                    fill: curve.color,
                    'font-family': "'Space Grotesk', sans-serif",
                    'font-size': '10',
                    'font-weight': '600',
                    opacity: '0.8',
                }),
            ).textContent = curve.effect;
        }
    }

    // ── 7. Substance calendar bars (if interventions provided) ──
    if (interventions && interventions.length > 0) {
        const barAreaTop = axisY + 38;
        const barH = 10;
        const barGap = 3;

        // Group interventions by substance key
        const substanceMap = new Map<string, ExtendedInterventionEntry[]>();
        for (const iv of interventions) {
            const list = substanceMap.get(iv.key) || [];
            list.push(iv);
            substanceMap.set(iv.key, list);
        }

        let rowIdx = 0;
        for (const [key, entries] of substanceMap) {
            const y = barAreaTop + rowIdx * (barH + barGap);

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

            // Find contiguous runs for bar rendering
            const sortedDays = [...activeDays].sort((a, b) => a - b);
            let runStart = sortedDays[0];
            let runEnd = sortedDays[0];
            const color = entries[0].impacts
                ? (effectRoster.find(e => Object.keys(entries[0].impacts!).includes(e.effect))?.color || '#60a5fa')
                : '#60a5fa';

            for (let i = 1; i <= sortedDays.length; i++) {
                if (i < sortedDays.length && sortedDays[i] === runEnd + 1) {
                    runEnd = sortedDays[i];
                } else {
                    const x1 = extendedChartX(runStart - 0.4, config);
                    const x2 = extendedChartX(runEnd + 0.4, config);
                    gSubstanceBars.appendChild(
                        svgEl('rect', {
                            x: String(x1),
                            y: String(y),
                            width: String(Math.max(2, x2 - x1)),
                            height: String(barH),
                            fill: color,
                            opacity: isLight ? '0.25' : '0.3',
                            rx: '2',
                            'pointer-events': 'none',
                        }),
                    );
                    if (i < sortedDays.length) {
                        runStart = sortedDays[i];
                        runEnd = sortedDays[i];
                    }
                }
            }

            // Substance label
            const displayName = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            gSubstanceBars.appendChild(
                svgEl('text', {
                    x: String(config.padL - 6),
                    y: String(y + barH - 1),
                    fill: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(200,218,245,0.6)',
                    'text-anchor': 'end',
                    'font-family': "'IBM Plex Mono', monospace",
                    'font-size': '8',
                    'font-weight': '500',
                }),
            ).textContent = displayName.length > 18 ? displayName.slice(0, 16) + '..' : displayName;

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
}
