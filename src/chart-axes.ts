/**
 * Chart Axes — X/Y axis rendering, grid lines, level descriptors, hover tooltips, curve highlight toggling, and week strip.
 * Exports: buildPhaseXAxis, buildPhaseYAxes, buildPhaseGrid, getChartLevelDesc, highlightCurve, renderYAxisTransitionIndicators, buildWeekStrip, updateWeekStripDay, hideWeekStrip
 * Depends on: constants (PHASE_CHART, DESCRIPTOR_LEVELS), state (PhaseState, DividerState, MultiDayState), utils, curve-utils, divider, baseline-editor
 */
import { PHASE_CHART, PHASE_SMOOTH_PASSES, DESCRIPTOR_LEVELS } from './constants';
import { PhaseState, DividerState, MultiDayState, isTurboActive } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY, isLightMode } from './utils';
import {
    smoothPhaseValues,
    findCurvePeak,
    findCurveTrough,
    nearestLevel,
    findMaxDivergence,
    normalizeLevels,
} from './curve-utils';
import { getEffectSubGroup } from './divider';
import { getLevelData } from './baseline-editor';

// ── X-axis label format (pluggable via A/B test) ────────────────────
interface XAxisFormat {
    format: (hour: number) => string;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    letterSpacing?: string;
    shouldLabel?: (hour: number) => boolean;
    secondaryLabel?: (hour: number) => string | null;
}

// Default: 24h military format (variant A)
const DEFAULT_X_AXIS_FORMAT: XAxisFormat = {
    format: h => `${String(h).padStart(2, '0')}:00`,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9.5,
    fontWeight: '400',
};

let _xAxisFormat: XAxisFormat = { ...DEFAULT_X_AXIS_FORMAT };

/** Replace the x-axis label format (used by A/B test variants) */
export function setXAxisFormat(fmt: XAxisFormat): void {
    _xAxisFormat = fmt;
}

/** Reset to the default 24h format */
export function resetXAxisFormat(): void {
    _xAxisFormat = { ...DEFAULT_X_AXIS_FORMAT };
}

/** Darken a hex color for readability on light backgrounds. */
function darkenForLightMode(hex: string): string {
    if (!hex || hex.charAt(0) !== '#' || hex.length < 7) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const f = 0.42; // darken by 58%
    return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

// ============================================
// Chart Level Descriptor
// ============================================

export function getChartLevelDesc(curve: any, val: number): string {
    const levelVal = nearestLevel(val);
    if (Array.isArray(curve.levels)) {
        const best = getLevelData(curve, val);
        if (best) return best.label;
    }
    return curve.levels?.[String(levelVal)] || '';
}

// ============================================
// Extended Chart: Axis Setup (day-level labels via setXAxisFormat)
// ============================================

/**
 * Configure the x-axis format for extended (multi-day) timelines.
 * Sets the label format to "Day N" and adjusts density based on duration.
 * Call resetXAxisFormat() to restore the default 24h format.
 */
export function renderExtendedAxes(durationDays: number): void {
    setXAxisFormat({
        format: (day) => `${day}`,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: durationDays > 14 ? 8 : 9.5,
        fontWeight: '400',
        shouldLabel: (day) => {
            if (durationDays <= 14) return true;
            // For 15-28 days, label odd days + last day
            return day % 2 === 1 || day === durationDays;
        },
        secondaryLabel: () => null,
    });
}

// ============================================
// Phase Chart: X-Axis
// ============================================

export function buildPhaseXAxis(): void {
    const group = document.getElementById('phase-x-axis')!;
    group.innerHTML = '';
    const t = chartTheme();
    const isLight = isLightMode();

    // Layout within padT=50px:
    //  [2..15]  — narrow tinted Day/Night bands
    //  [15..48] — time ruler: labels baseline y=36, ticks 38..47
    const bandTop = 2;
    const bandBottom = 15;
    const labelY = 36;
    const tickBaseY = PHASE_CHART.padT - 3; // 47
    const tallTickY = labelY + 3; // 39 — just below label baseline
    const shortTickY = labelY + 7; // 43

    const day1StartX = phaseChartX(PHASE_CHART.startHour * 60);
    const midnightX = phaseChartX(24 * 60);
    const day2EndX = phaseChartX(PHASE_CHART.endHour * 60);

    // --- Bottom boundary of plot area ---
    group.appendChild(
        svgEl('line', {
            x1: String(PHASE_CHART.padL),
            y1: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
            y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            stroke: t.axisBoundary,
            'stroke-width': '0.75',
        }),
    );

    // --- Narrow tinted Day / Night bands ---
    group.appendChild(
        svgEl('rect', {
            x: day1StartX.toFixed(1),
            y: String(bandTop),
            width: (midnightX - day1StartX).toFixed(1),
            height: String(bandBottom - bandTop),
            fill: isLight ? 'rgba(210,155,40,0.09)' : 'rgba(210,155,40,0.10)',
            rx: '2',
            'pointer-events': 'none',
        }),
    );
    group.appendChild(
        svgEl('rect', {
            x: midnightX.toFixed(1),
            y: String(bandTop),
            width: (day2EndX - midnightX).toFixed(1),
            height: String(bandBottom - bandTop),
            fill: isLight ? 'rgba(80,110,185,0.09)' : 'rgba(90,120,200,0.12)',
            rx: '2',
            'pointer-events': 'none',
        }),
    );

    // Band labels — centred, very understated
    const dayFill = isLight ? 'rgba(100,75,20,0.65)' : 'rgba(210,175,100,0.62)';
    const nightFill = isLight ? 'rgba(40,70,140,0.65)' : 'rgba(150,175,225,0.62)';
    group.appendChild(
        svgEl('text', {
            x: ((day1StartX + midnightX) / 2).toFixed(1),
            y: String(bandTop + 10),
            fill: dayFill,
            'text-anchor': 'middle',
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '8.5',
            'font-weight': '500',
            'letter-spacing': '0.10em',
        }),
    ).textContent = 'Day';
    group.appendChild(
        svgEl('text', {
            x: ((midnightX + day2EndX) / 2).toFixed(1),
            y: String(bandTop + 10),
            fill: nightFill,
            'text-anchor': 'middle',
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '8.5',
            'font-weight': '500',
            'letter-spacing': '0.10em',
        }),
    ).textContent = 'Night';

    // --- Midnight divider through the full chart ---
    group.appendChild(
        svgEl('line', {
            x1: midnightX.toFixed(1),
            y1: String(bandBottom + 1),
            x2: midnightX.toFixed(1),
            y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            stroke: isLight ? 'rgba(90,120,180,0.18)' : 'rgba(140,170,230,0.16)',
            'stroke-width': '1',
            'stroke-dasharray': '2 5',
        }),
    );

    // --- Tick baseline ---
    group.appendChild(
        svgEl('line', {
            x1: String(PHASE_CHART.padL),
            y1: String(tickBaseY),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
            y2: String(tickBaseY),
            stroke: isLight ? 'rgba(80,110,150,0.22)' : 'rgba(174,201,237,0.22)',
            'stroke-width': '0.5',
        }),
    );

    // --- Odd-hour minor ticks ---
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h++) {
        if (h % 2 === 0) continue;
        const x = phaseChartX(h * 60);
        group.appendChild(
            svgEl('line', {
                x1: x.toFixed(1),
                y1: String(shortTickY),
                x2: x.toFixed(1),
                y2: String(tickBaseY),
                stroke: t.tickNormal,
                'stroke-width': '0.5',
            }),
        );
    }

    // --- Even-hour ticks + labels every 2h ---
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 2) {
        const x = phaseChartX(h * 60);
        const displayHour = h % 24;
        const isMidnight = displayHour === 0;

        group.appendChild(
            svgEl('line', {
                x1: x.toFixed(1),
                y1: String(isMidnight ? bandBottom + 2 : tallTickY),
                x2: x.toFixed(1),
                y2: String(tickBaseY),
                stroke: t.tickNormal,
                'stroke-width': isMidnight ? '1' : '0.75',
            }),
        );

        const fmt = _xAxisFormat;
        // Skip hours that the current format doesn't want labeled
        if (fmt.shouldLabel && !fmt.shouldLabel(displayHour)) continue;

        group.appendChild(
            svgEl('text', {
                x: x.toFixed(1),
                y: String(labelY),
                fill: t.labelNormal,
                'font-family': fmt.fontFamily,
                'font-size': String(fmt.fontSize),
                'font-weight': fmt.fontWeight,
                'text-anchor': 'middle',
                'letter-spacing': fmt.letterSpacing || '0',
            }),
        ).textContent = fmt.format(displayHour);

        // Optional secondary label below (for contextual anchors)
        if (fmt.secondaryLabel) {
            const secondary = fmt.secondaryLabel(displayHour);
            if (secondary) {
                group.appendChild(
                    svgEl('text', {
                        x: x.toFixed(1),
                        y: String(labelY + 10),
                        fill: t.labelNormal,
                        'font-family': "'Space Grotesk', sans-serif",
                        'font-size': '7.5',
                        'font-weight': '600',
                        'text-anchor': 'middle',
                        'letter-spacing': '0.08em',
                        opacity: '0.5',
                    }),
                ).textContent = secondary;
            }
        }
    }
}

// ============================================
// Phase Chart: Curve highlight on Y-axis hover
// ============================================

// Uses CSS filter (not opacity) because Web Animations API fill:'forwards'
// overrides inline style.opacity in the cascade.
export function highlightCurve(activeIdx: number, active: boolean): void {
    if (!PhaseState.curvesData || PhaseState.curvesData.length < 2) return;
    const activeColor = PhaseState.curvesData[activeIdx].color;

    const dimFilter = 'saturate(0.1) brightness(0.25)';
    const boostFilter = 'brightness(1.15) drop-shadow(0 0 6px currentColor)';
    const transitionStyle = 'filter 200ms ease';

    const allGroupIds = [
        'phase-baseline-curves',
        'phase-desired-curves',
        'phase-lx-curves',
        'phase-mission-arrows',
        'phase-yaxis-indicators',
        'phase-lx-markers',
    ];

    for (const id of allGroupIds) {
        const g = document.getElementById(id);
        if (!g) continue;

        // If per-effect sub-groups exist, apply filter at the sub-group level
        const sub0 = g.querySelector(`#${id}-e0`);
        if (sub0 && PhaseState.curvesData && PhaseState.curvesData.length >= 2) {
            for (let ei = 0; ei < PhaseState.curvesData.length; ei++) {
                const sub = g.querySelector(`#${id}-e${ei}`) as HTMLElement | null;
                if (!sub) continue;
                if (active) {
                    sub.style.transition = transitionStyle;
                    sub.style.filter = ei === activeIdx ? boostFilter : dimFilter;
                } else {
                    sub.style.filter = '';
                }
            }
        } else {
            // Fallback: original per-child color matching (1-effect mode)
            for (const child of Array.from(g.children)) {
                const stroke = child.getAttribute('stroke');
                const fill = child.getAttribute('fill');
                const belongsToActive = stroke === activeColor || fill === activeColor;

                if (active) {
                    (child as HTMLElement).style.transition = transitionStyle;
                    (child as HTMLElement).style.filter = belongsToActive ? boostFilter : dimFilter;
                } else {
                    (child as HTMLElement).style.filter = '';
                }
            }
        }
    }
}

// ============================================
// Phase Chart: Y-Axes
// ============================================

/** Split effect label into max 2 lines for word wrapping */
function splitEffectLabelIntoTwoLines(text: string): [string, string] {
    const trimmed = text.trim();
    if (!trimmed) return ['', ''];
    const words = trimmed.split(/\s+/);
    if (words.length === 1) {
        if (words[0].length <= 14) return [words[0], ''];
        const mid = Math.ceil(words[0].length / 2);
        return [words[0].slice(0, mid), words[0].slice(mid)];
    }
    let bestSplit = 1;
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
        const l1 = words.slice(0, i).join(' ');
        const l2 = words.slice(i).join(' ');
        const diff = Math.abs(l1.length - l2.length);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestSplit = i;
        }
    }
    const line1 = words.slice(0, bestSplit).join(' ');
    const line2 = words.slice(bestSplit).join(' ');
    return [line1, line2];
}

function getYAxisHoverCopy(curve: any, val: number): { shortLabel: string; detailText: string } | null {
    if (!curve?.levels) return null;
    const level = getLevelData(curve, val);
    const shortLabel = String(level?.label || '').trim();
    const detailText = String(level?.full_context || shortLabel).trim();
    if (!shortLabel && !detailText) return null;
    return {
        shortLabel: shortLabel || detailText,
        detailText: detailText || shortLabel,
    };
}

function estimateTextWidth(text: string, fontSize: number, widthFactor: number = 0.58): number {
    return text.length * fontSize * widthFactor;
}

export function buildPhaseYAxes(effects: string[], colors: string[], curvesData: any[]): void {
    const leftGroup = document.getElementById('phase-y-axis-left')!;
    const rightGroup = document.getElementById('phase-y-axis-right')!;
    const tooltipOverlay = document.getElementById('phase-tooltip-overlay')!;
    leftGroup.innerHTML = '';
    rightGroup.innerHTML = '';
    tooltipOverlay.innerHTML = '';

    const cols = colors || [];
    // Normalize 5-level descriptors to 10-level format if needed
    if (curvesData) {
        for (const curve of curvesData) {
            if (curve.levels && !Array.isArray(curve.levels) && Object.keys(curve.levels).length <= 5) {
                curve.levels = normalizeLevels(curve.levels);
            }
        }
    }
    const leftCurve = curvesData && curvesData[0] ? curvesData[0] : null;
    const rightCurve = curvesData && curvesData[1] ? curvesData[1] : null;
    if (effects.length >= 1) buildSingleYAxis(leftGroup, effects[0], 'left', cols[0], leftCurve, 0, effects.length);
    if (effects.length >= 2) buildSingleYAxis(rightGroup, effects[1], 'right', cols[1], rightCurve, 1, effects.length);
}

export function buildSingleYAxis(
    group: Element,
    effectLabel: string,
    side: 'left' | 'right',
    color: string,
    curve: any,
    curveIndex: number,
    totalCurves: number,
): void {
    const x = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
    const tickDir = side === 'left' ? -6 : 6;
    const textAnchor = side === 'left' ? 'end' : 'start';
    const labelOffset = side === 'left' ? -10 : 10;
    const t = chartTheme();
    const rawColor = color || t.yLabelDefault;
    const labelColor = isLightMode() && color ? darkenForLightMode(color) : rawColor;

    // Axis line
    group.appendChild(
        svgEl('line', {
            x1: String(x),
            y1: String(PHASE_CHART.padT),
            x2: String(x),
            y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            stroke: t.axisLine,
            'stroke-width': '1.2',
        }),
    );

    // Collect tick data for magnetic hit areas
    const ticks: number[] = [...DESCRIPTOR_LEVELS];

    // Tick marks + labels at each descriptor level
    const tickElements: any[] = []; // { v, y, numLabel, tickLine, hoverCopy, guideGlow, guideLine, detailGroup, sideLabelGroup }
    for (let ti = 0; ti < ticks.length; ti++) {
        const v = ticks[ti];
        const y = phaseChartY(v);
        // Major ticks at ~quarter marks (0,22,44,67,89,100), minor at others
        const isMajor = ti % 2 === 0 || v === 100;
        const tickLine = svgEl('line', {
            x1: String(x),
            y1: y.toFixed(1),
            x2: String(x + (isMajor ? tickDir : tickDir * 0.6)),
            y2: y.toFixed(1),
            stroke: t.yTick,
            'stroke-width': isMajor ? '1' : '0.6',
        });
        group.appendChild(tickLine);

        // Show numeric label on alternating ticks to avoid crowding
        let numLabel: any = null;
        if (isMajor) {
            numLabel = svgEl('text', {
                x: String(x + labelOffset),
                y: (y + 3).toFixed(1),
                fill: t.yLabel,
                class: 'y-tick-num',
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': '9',
                'text-anchor': textAnchor,
            });
            numLabel.textContent = String(v);
            group.appendChild(numLabel);
        }

        const entry: any = {
            v,
            y,
            numLabel,
            tickLine,
            hoverCopy: null,
            guideGlow: null,
            guideLine: null,
            detailGroup: null,
            sideLabelGroup: null,
        };

        // Hover slice, detailed context, and short outside label (rendered in topmost overlay)
        const hoverCopy = getYAxisHoverCopy(curve, v);
        if (hoverCopy) {
            entry.hoverCopy = hoverCopy;
            const overlay = document.getElementById('phase-tooltip-overlay')!;
            const detailCenterX = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
            const detailMaxW = PHASE_CHART.plotW - 96;
            const detailTextW = estimateTextWidth(hoverCopy.detailText, 11.5, 0.56);
            const detailBoxW = Math.max(220, Math.min(detailMaxW, detailTextW + 28));
            const detailBoxH = 24;
            const sideLabelAnchor = side === 'left' ? 'end' : 'start';
            const sideTextX = side === 'left' ? x - 18 : x + 18;
            const sideTextW = estimateTextWidth(hoverCopy.shortLabel, 10.5, 0.6);
            const sideBoxW = Math.max(52, Math.min(PHASE_CHART.padL - 24, sideTextW + 18));
            const sideBoxH = 20;
            const sideBoxX = side === 'left' ? sideTextX - sideBoxW + 10 : sideTextX - 10;

            const guideGlow = svgEl('line', {
                x1: String(PHASE_CHART.padL),
                y1: y.toFixed(1),
                x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
                y2: y.toFixed(1),
                stroke: labelColor,
                'stroke-width': '8',
                'stroke-opacity': '0',
                'stroke-linecap': 'round',
                class: 'tick-guide-glow',
                'pointer-events': 'none',
            });
            overlay.appendChild(guideGlow);
            entry.guideGlow = guideGlow;

            const guideLine = svgEl('line', {
                x1: String(PHASE_CHART.padL),
                y1: y.toFixed(1),
                x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
                y2: y.toFixed(1),
                stroke: labelColor,
                'stroke-width': '1.2',
                'stroke-opacity': '0',
                'stroke-linecap': 'round',
                class: 'tick-guide-line',
                'pointer-events': 'none',
            });
            overlay.appendChild(guideLine);
            entry.guideLine = guideLine;

            const detailGroup = svgEl('g', { class: 'tick-tooltip', opacity: '0', 'pointer-events': 'none' });
            detailGroup.appendChild(
                svgEl('rect', {
                    x: (detailCenterX - detailBoxW / 2).toFixed(1),
                    y: (y - detailBoxH / 2).toFixed(1),
                    width: detailBoxW.toFixed(1),
                    height: String(detailBoxH),
                    rx: '12',
                    ry: '12',
                    fill: t.tooltipBg,
                    'fill-opacity': isLightMode() ? '0.92' : '0.82',
                }),
            );
            const detailText = svgEl('text', {
                x: detailCenterX.toFixed(1),
                y: y.toFixed(1),
                fill: labelColor,
                'fill-opacity': '0.92',
                'font-family': "'Space Grotesk', sans-serif",
                'font-size': '11.5',
                'font-weight': '500',
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                'letter-spacing': '0.02em',
            });
            if (detailTextW > detailBoxW - 20) {
                detailText.setAttribute('textLength', (detailBoxW - 20).toFixed(1));
                detailText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            }
            detailText.textContent = hoverCopy.detailText;
            detailGroup.appendChild(detailText);
            overlay.appendChild(detailGroup);
            entry.detailGroup = detailGroup;

            // Topmost tick (v=100): lower descriptor to avoid overlap with Y-axis effect label
            const sideLabelY = v === 100 ? y + 22 : y;
            const sideLabelGroup = svgEl('g', { class: 'tick-tooltip', opacity: '0', 'pointer-events': 'none' });
            sideLabelGroup.appendChild(
                svgEl('rect', {
                    x: sideBoxX.toFixed(1),
                    y: (sideLabelY - sideBoxH / 2).toFixed(1),
                    width: sideBoxW.toFixed(1),
                    height: String(sideBoxH),
                    rx: '10',
                    ry: '10',
                    fill: t.tooltipBg,
                    'fill-opacity': isLightMode() ? '0.92' : '0.86',
                }),
            );
            const sideLabelText = svgEl('text', {
                x: String(sideTextX),
                y: sideLabelY.toFixed(1),
                fill: labelColor,
                'fill-opacity': '0.95',
                'font-family': "'Space Grotesk', sans-serif",
                'font-size': '10.5',
                'font-weight': '700',
                'text-anchor': sideLabelAnchor,
                'dominant-baseline': 'middle',
                'letter-spacing': '0.03em',
            });
            sideLabelText.textContent = hoverCopy.shortLabel;
            sideLabelGroup.appendChild(sideLabelText);
            overlay.appendChild(sideLabelGroup);
            entry.sideLabelGroup = sideLabelGroup;
        }

        tickElements.push(entry);
    }

    // Build magnetic hit areas that span the full gap between ticks (no dead zones)
    const overlay = document.getElementById('phase-tooltip-overlay')!;
    const axisTop = PHASE_CHART.padT;
    const axisBot = PHASE_CHART.padT + PHASE_CHART.plotH;
    // Note: tick y values are inverted (higher value = lower y pixel)
    // ticks are 0,25,50,75,100 but y pixels go from axisBot (v=0) to axisTop (v=100)

    for (let ti = 0; ti < tickElements.length; ti++) {
        const entry = tickElements[ti];

        // Compute the vertical range this tick "owns" (midpoints to neighbors, clamped to axis)
        let hitTop: number, hitBot: number;
        if (ti === tickElements.length - 1) {
            // Topmost tick (v=100, lowest y pixel) — extend to axis top
            hitTop = axisTop;
        } else {
            hitTop = (entry.y + tickElements[ti + 1].y) / 2;
        }
        if (ti === 0) {
            // Bottommost tick (v=0, highest y pixel) — extend to axis bottom
            hitBot = axisBot;
        } else {
            hitBot = (entry.y + tickElements[ti - 1].y) / 2;
        }

        const hitHeight = hitBot - hitTop;
        const hitArea = svgEl('rect', {
            x: String(side === 'left' ? x - 88 : x),
            y: hitTop.toFixed(1),
            width: '88',
            height: hitHeight.toFixed(1),
            fill: 'transparent',
            class: 'tick-hover-area',
            'pointer-events': 'all',
            cursor: 'default',
        });
        overlay.appendChild(hitArea);

        // Hover events — emphasize the hovered band, show full-context copy, dim the other curve
        hitArea.addEventListener('mouseenter', () => {
            entry.tickLine.setAttribute('stroke', labelColor);
            entry.tickLine.setAttribute('stroke-width', '1.6');

            // Emphasize the number with curve color (if label exists for this tick)
            if (entry.numLabel) {
                entry.numLabel.setAttribute('fill', labelColor);
                entry.numLabel.setAttribute('font-weight', '600');
                entry.numLabel.style.filter = `drop-shadow(0 0 3px ${labelColor})`;
                entry.numLabel.style.transition = 'filter 150ms ease';
            }

            // Re-append to overlay so these paint on top of gamification boxes
            if (entry.detailGroup) {
                entry.detailGroup.parentElement?.appendChild(entry.detailGroup);
                entry.detailGroup.setAttribute('opacity', '1');
            }
            if (entry.sideLabelGroup) {
                entry.sideLabelGroup.parentElement?.appendChild(entry.sideLabelGroup);
                entry.sideLabelGroup.setAttribute('opacity', '1');
            }

            if (entry.guideGlow) {
                entry.guideGlow.setAttribute('stroke-opacity', '0.14');
            }
            if (entry.guideLine) {
                entry.guideLine.setAttribute('stroke-opacity', '0.68');
            }

            // Dim the OTHER curve to make this one pop
            if (totalCurves >= 2) {
                highlightCurve(curveIndex, true);
            }
        });
        hitArea.addEventListener('mouseleave', () => {
            entry.tickLine.setAttribute('stroke', t.yTick);
            entry.tickLine.setAttribute('stroke-width', entry.numLabel ? '1' : '0.6');

            // Restore number to default (if label exists for this tick)
            if (entry.numLabel) {
                entry.numLabel.setAttribute('fill', t.yLabel);
                entry.numLabel.setAttribute('font-weight', '400');
                entry.numLabel.style.filter = '';
            }

            if (entry.detailGroup) {
                entry.detailGroup.setAttribute('opacity', '0');
            }
            if (entry.sideLabelGroup) {
                entry.sideLabelGroup.setAttribute('opacity', '0');
            }
            if (entry.guideGlow) {
                entry.guideGlow.setAttribute('stroke-opacity', '0');
            }
            if (entry.guideLine) {
                entry.guideLine.setAttribute('stroke-opacity', '0');
            }

            // Restore all curves
            if (totalCurves >= 2) {
                highlightCurve(curveIndex, false);
            }
        });
    }

    // Effect label above plot area, elevated to avoid overlap with numeric tick labels
    const labelAnchor = side === 'left' ? 'start' : 'end';
    const labelX = side === 'left' ? 25 : PHASE_CHART.viewW - 25;
    const labelYPos = PHASE_CHART.padT - 24;
    const lineHeight = 18;
    const [line1, line2] = splitEffectLabelIntoTwoLines(effectLabel);

    const yLabel = svgEl('text', {
        x: String(labelX),
        y: String(labelYPos),
        fill: labelColor,
        'fill-opacity': '0.9',
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '15',
        'font-weight': '700',
        'letter-spacing': '0.03em',
        'text-anchor': labelAnchor,
    });
    const tspan1 = svgEl('tspan', { x: String(labelX), dy: '0' });
    tspan1.textContent = line1;
    yLabel.appendChild(tspan1);
    if (line2) {
        const tspan2 = svgEl('tspan', { x: String(labelX), dy: String(lineHeight) });
        tspan2.textContent = line2;
        yLabel.appendChild(tspan2);
    }
    group.appendChild(yLabel);
}

/** Y-axis effect label position — used by word cloud dismiss to fly words precisely */
export function getYAxisLabelPosition(side: 'left' | 'right'): {
    x: number;
    y: number;
    anchor: string;
    baseline: string;
} {
    const x = side === 'left' ? 75 : PHASE_CHART.viewW - 75;
    return {
        x,
        y: PHASE_CHART.padT - 24,
        anchor: side === 'left' ? 'start' : 'end',
        baseline: 'alphabetic',
    };
}

// ============================================
// Phase Chart: Grid
// ============================================

export function buildPhaseGrid(): void {
    const group = document.getElementById('phase-grid')!;
    group.innerHTML = '';
    const t = chartTheme();

    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 2) {
        const x = phaseChartX(h * 60);
        group.appendChild(
            svgEl('line', {
                x1: x.toFixed(1),
                y1: String(PHASE_CHART.padT),
                x2: x.toFixed(1),
                y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
                stroke: t.grid,
                'stroke-width': '1',
            }),
        );
    }
    for (let i = 0; i < DESCRIPTOR_LEVELS.length; i++) {
        const v = DESCRIPTOR_LEVELS[i];
        if (v === 0) continue;
        const y = phaseChartY(v);
        // Major lines at even indices (0,22,44,67,89,100), minor at odd
        const isMajor = i % 2 === 0 || v === 100;
        group.appendChild(
            svgEl('line', {
                x1: String(PHASE_CHART.padL),
                y1: y.toFixed(1),
                x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
                y2: y.toFixed(1),
                stroke: t.grid,
                'stroke-width': isMajor ? '1' : '0.5',
                opacity: isMajor ? '1' : '0.4',
            }),
        );
    }
}

// ============================================
// Private: Y-Axis Transition Indicators
// ============================================

const HALO_DARK = 'rgba(14,22,36,0.95)';
const HALO_LIGHT = 'rgba(235,240,248,0.90)';

function haloColor(): string {
    return isLightMode() ? HALO_LIGHT : HALO_DARK;
}

function indicatorLayout(side: 'left' | 'right', axisX: number) {
    const pad = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padR;
    const arrowX = side === 'left' ? axisX - 20 : axisX + 20;
    const labelX = side === 'left' ? pad * 0.38 : PHASE_CHART.viewW - pad * 0.38;
    const maxLabelW = (pad - 30) * 0.92;
    return { arrowX, labelX, maxLabelW };
}

function splitLabel(text: string, maxCharsPerLine: number): string[] {
    if (text.length <= maxCharsPerLine) return [text];
    const words = text.split(/\s+/);
    if (words.length === 1) return [text];
    let bestSplit = 1,
        bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
        const l1 = words.slice(0, i).join(' ').length;
        const l2 = words.slice(i).join(' ').length;
        const diff = Math.abs(l1 - l2);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestSplit = i;
        }
    }
    return [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
}

function placeLabel(
    parent: Element,
    text: string,
    labelX: number,
    centerY: number,
    maxLabelW: number,
    color: string,
    fontSize: number,
    weight: string,
    opacity: number,
): void {
    const charW = fontSize * 0.65;
    const maxChars = Math.max(6, Math.floor(maxLabelW / charW));
    const lines = splitLabel(text, maxChars);
    const lineH = fontSize * 1.4;
    const totalH = lines.length * lineH;
    const startY = centerY - totalH / 2 + fontSize * 0.38;

    const fillColor = isLightMode() ? darkenForLightMode(color) : color;

    const el = svgEl('text', {
        fill: fillColor,
        'fill-opacity': String(opacity),
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': String(fontSize),
        'font-weight': weight,
        'text-anchor': 'middle',
        'letter-spacing': '0.01em',
    });

    for (let i = 0; i < lines.length; i++) {
        const tspan = svgEl('tspan', {
            x: labelX.toFixed(1),
            y: (startY + i * lineH).toFixed(1),
        });
        tspan.textContent = lines[i];
        el.appendChild(tspan);
    }

    parent.appendChild(el);
}

export function renderYAxisTransitionIndicators(curvesData: any[], animDelay: number = 0): void {
    const group = document.getElementById('phase-yaxis-indicators');
    if (!group) return;
    group.innerHTML = '';
    (group as HTMLElement).style.opacity = '1';

    const t = chartTheme();

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;

        const side: 'left' | 'right' = i === 0 ? 'left' : 'right';
        const axisX = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;

        const isKeep = curve.directive === 'keep';
        const div = findMaxDivergence(curve);
        const isChange = !isKeep && div && Math.abs(div.diff) >= 5;

        const sub = getEffectSubGroup(group, i);

        if (isChange) {
            renderChangeIndicator(sub, curve, i, div, side, axisX, t, animDelay + i * 300);
        } else {
            renderKeepIndicator(sub, curve, i, side, axisX, t, animDelay + i * 300);
        }
    }
}

// -- Change indicator: aspirational arrow --
function renderChangeIndicator(
    group: Element,
    curve: any,
    curveIdx: number,
    div: any,
    side: 'left' | 'right',
    axisX: number,
    _theme: any,
    delay: number,
): void {
    const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    const blMatch = blSmoothed.reduce((a: any, b: any) =>
        Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a,
    );

    const baseLevel = nearestLevel(blMatch.value);
    const desiredLevel = nearestLevel(div.value);
    const baseDesc = getChartLevelDesc(curve, baseLevel);
    const desiredDesc = getChartLevelDesc(curve, desiredLevel);
    if (!baseDesc || !desiredDesc || baseLevel === desiredLevel) return;

    const baseY = phaseChartY(baseLevel);
    const desiredY = phaseChartY(desiredLevel);
    const { arrowX, labelX, maxLabelW } = indicatorLayout(side, axisX);
    const tipDir = desiredY < baseY ? -1 : 1;

    const container = svgEl('g', {
        class: 'yaxis-change-indicator',
        opacity: '0',
        'data-effect-idx': String(curveIdx),
    });

    // -- Gradient --
    const gradId = `yaxis-arrow-grad-${curveIdx}`;
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', {
        id: gradId,
        x1: '0',
        y1: String(Math.min(baseY, desiredY)),
        x2: '0',
        y2: String(Math.max(baseY, desiredY)),
        gradientUnits: 'userSpaceOnUse',
    });
    grad.appendChild(
        svgEl('stop', {
            offset: desiredY < baseY ? '0%' : '100%',
            'stop-color': curve.color,
            'stop-opacity': '1',
        }),
    );
    grad.appendChild(
        svgEl('stop', {
            offset: desiredY < baseY ? '100%' : '0%',
            'stop-color': curve.color,
            'stop-opacity': '0.18',
        }),
    );
    defs.appendChild(grad);
    container.appendChild(defs);

    // -- Glow --
    const glowLine = svgEl('line', {
        x1: String(arrowX),
        y1: baseY.toFixed(1),
        x2: String(arrowX),
        y2: baseY.toFixed(1),
        stroke: curve.color,
        'stroke-width': '14',
        'stroke-opacity': '0',
        'stroke-linecap': 'round',
        'pointer-events': 'none',
    });
    container.appendChild(glowLine);

    // -- Shaft --
    const shaft = svgEl('line', {
        x1: String(arrowX),
        y1: baseY.toFixed(1),
        x2: String(arrowX),
        y2: baseY.toFixed(1),
        stroke: `url(#${gradId})`,
        'stroke-width': '3',
        'stroke-linecap': 'round',
    });
    container.appendChild(shaft);

    // -- Arrowhead --
    const headH = 12,
        headW = 7;
    const arrowHead = svgEl('path', {
        d: `M${arrowX} ${desiredY} L${arrowX - headW} ${desiredY - tipDir * headH} L${arrowX + headW} ${desiredY - tipDir * headH} Z`,
        fill: curve.color,
        'fill-opacity': '0',
    });
    container.appendChild(arrowHead);

    // -- Origin dot --
    const originDot = svgEl('circle', {
        cx: String(arrowX),
        cy: baseY.toFixed(1),
        r: '3.5',
        fill: curve.color,
        'fill-opacity': '0',
    });
    container.appendChild(originDot);

    // -- FROM label (centered in margin, subdued) --
    const baseLabelY = baseLevel === 100 ? baseY + 22 : baseY;
    placeLabel(container, baseDesc, labelX, baseLabelY, maxLabelW, curve.color, 11, '600', 0.72);

    // -- TO label (centered in margin, bold — animated reveal) --
    const toLabelY = desiredLevel === 100 ? desiredY + 22 : desiredY;
    const toLabelWrap = svgEl('g', { opacity: '0' });
    placeLabel(toLabelWrap, desiredDesc, labelX, toLabelY, maxLabelW, curve.color, 13, '700', 1.0);
    container.appendChild(toLabelWrap);

    group.appendChild(container);

    // Turbo: show final state immediately
    if (isTurboActive()) {
        container.setAttribute('opacity', '1');
        shaft.setAttribute('y2', desiredY.toFixed(1));
        glowLine.setAttribute('y2', desiredY.toFixed(1));
        glowLine.setAttribute('stroke-opacity', '0.10');
        originDot.setAttribute('fill-opacity', '0.6');
        arrowHead.setAttribute('fill-opacity', '0.9');
        toLabelWrap.setAttribute('opacity', '1');
        return;
    }

    // -- Animation --
    const startTime = performance.now();
    const fadeInDur = 350;
    const arrowGrowDur = 900;

    (function animate() {
        const elapsed = performance.now() - startTime;
        if (elapsed < delay) {
            requestAnimationFrame(animate);
            return;
        }
        const localT = elapsed - delay;

        const fadeT = Math.min(1, localT / fadeInDur);
        container.setAttribute('opacity', String(1 - Math.pow(1 - fadeT, 3)));

        if (localT > 250) {
            const arrowT = Math.min(1, (localT - 250) / arrowGrowDur);
            const ease = 1 - Math.pow(1 - arrowT, 3);
            const curY = baseY + (desiredY - baseY) * ease;

            shaft.setAttribute('y2', curY.toFixed(1));
            glowLine.setAttribute('y2', curY.toFixed(1));
            glowLine.setAttribute('stroke-opacity', String(0.1 * Math.min(1, arrowT * 2)));
            originDot.setAttribute('fill-opacity', String(0.6 * Math.min(1, arrowT * 3)));

            if (arrowT > 0.75) {
                const reveal = (arrowT - 0.75) / 0.25;
                const revEase = 1 - Math.pow(1 - reveal, 2);
                arrowHead.setAttribute('fill-opacity', String(0.9 * revEase));
                toLabelWrap.setAttribute('opacity', String(revEase));
            }
        }

        if (localT < 250 + arrowGrowDur + 200) {
            requestAnimationFrame(animate);
        }
    })();
}

// -- Keep indicator: clean line-dot with peak zone labels --
function renderKeepIndicator(
    group: Element,
    curve: any,
    curveIdx: number,
    side: 'left' | 'right',
    axisX: number,
    _theme: any,
    delay: number,
): void {
    const isHigherBetter = curve.polarity !== 'higher_is_worse';
    const peak = isHigherBetter
        ? findCurvePeak(curve.desired || curve.baseline)
        : findCurveTrough(curve.desired || curve.baseline);
    const peakLevel = nearestLevel(peak.value);

    const zoneLevels = [0, 25, 50, 75, 100];
    const peakIdx = zoneLevels.indexOf(peakLevel);
    let topLevel: number, botLevel: number;
    if (isHigherBetter) {
        topLevel = peakLevel;
        botLevel = peakIdx > 0 ? zoneLevels[peakIdx - 1] : peakLevel;
    } else {
        botLevel = peakLevel;
        topLevel = peakIdx < zoneLevels.length - 1 ? zoneLevels[peakIdx + 1] : peakLevel;
    }

    const topDesc = curve.levels ? getChartLevelDesc(curve, topLevel) : null;
    const botDesc = curve.levels ? getChartLevelDesc(curve, botLevel) : null;
    if (!topDesc && !botDesc) return;

    const topY = phaseChartY(topLevel);
    const botY = phaseChartY(botLevel);
    const centerY = (topY + botY) / 2;
    const hasRange = topLevel !== botLevel;
    const { arrowX, labelX, maxLabelW } = indicatorLayout(side, axisX);

    const container = svgEl('g', {
        class: 'yaxis-keep-indicator',
        opacity: '0',
        'data-effect-idx': String(curveIdx),
    });

    // -- Labels (centered in margin) — lower top label when at max level to avoid Y-axis effect label overlap --
    const topLabelY = topLevel === 100 ? topY + 22 : topY;
    if (hasRange) {
        if (topDesc) placeLabel(container, topDesc, labelX, topLabelY, maxLabelW, curve.color, 11, '600', 0.85);
        if (botDesc) placeLabel(container, botDesc, labelX, botY, maxLabelW, curve.color, 11, '600', 0.85);
    } else {
        const desc = topDesc || botDesc || '';
        const singleLabelY = topLevel === 100 ? centerY + 22 : centerY;
        placeLabel(container, desc, labelX, singleLabelY, maxLabelW, curve.color, 11, '600', 0.85);
    }

    // -- Horizontal line with center dot --
    const hw = 14;

    container.appendChild(
        svgEl('line', {
            x1: (arrowX - hw).toFixed(1),
            y1: centerY.toFixed(1),
            x2: (arrowX + hw).toFixed(1),
            y2: centerY.toFixed(1),
            stroke: curve.color,
            'stroke-width': '6',
            'stroke-opacity': '0.08',
            'stroke-linecap': 'round',
        }),
    );
    container.appendChild(
        svgEl('line', {
            x1: (arrowX - hw).toFixed(1),
            y1: centerY.toFixed(1),
            x2: (arrowX + hw).toFixed(1),
            y2: centerY.toFixed(1),
            stroke: curve.color,
            'stroke-width': '1.5',
            'stroke-opacity': '0.5',
            'stroke-linecap': 'round',
        }),
    );
    container.appendChild(
        svgEl('circle', {
            cx: String(arrowX),
            cy: centerY.toFixed(1),
            r: '6',
            fill: curve.color,
            'fill-opacity': '0.08',
        }),
    );
    container.appendChild(
        svgEl('circle', {
            cx: String(arrowX),
            cy: centerY.toFixed(1),
            r: '3.5',
            fill: curve.color,
            'fill-opacity': '0.75',
        }),
    );

    group.appendChild(container);

    if (isTurboActive()) {
        container.setAttribute('opacity', '0.92');
        return;
    }

    const startTime = performance.now();
    const dur = 500;
    (function animate() {
        const elapsed = performance.now() - startTime;
        if (elapsed < delay) {
            requestAnimationFrame(animate);
            return;
        }
        const t = Math.min(1, (elapsed - delay) / dur);
        container.setAttribute('opacity', String(0.92 * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(animate);
    })();
}

// ============================================
// Week Day Strip — replaces Day/Night bands during multi-day sequence
// ============================================

const WEEKDAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Build a 7-day week strip that replaces the Day/Night bands above the X-axis.
 * Each day cell spans `plotW / totalDays` and is labeled with the weekday abbreviation.
 * @param totalDays Number of days in the sequence (typically 7: Mon–Sun)
 */
export function buildWeekStrip(totalDays: number = 7): void {
    const group = document.getElementById('phase-week-strip');
    if (!group) return;
    group.innerHTML = '';

    const isLight = isLightMode();
    const startWeekday = MultiDayState.startWeekday || 'Monday';
    const startIdx = WEEKDAY_FULL.findIndex(d => d.toLowerCase() === startWeekday.toLowerCase());
    const baseIdx = startIdx === -1 ? 1 : startIdx; // default Monday

    const stripTop = 0;
    const stripH = 24;
    const plotL = PHASE_CHART.padL;
    const plotW = PHASE_CHART.plotW;
    const cellW = plotW / totalDays;

    // Background strip spanning full plot width
    group.appendChild(
        svgEl('rect', {
            x: String(plotL),
            y: String(stripTop),
            width: String(plotW),
            height: String(stripH),
            fill: isLight ? 'rgba(180,190,210,0.08)' : 'rgba(100,120,160,0.08)',
            rx: '3',
            'pointer-events': 'none',
        }),
    );

    // Day cells + labels
    for (let i = 0; i < totalDays; i++) {
        const weekdayIdx = (baseIdx + i) % 7;
        const abbrev = WEEKDAY_ABBREVS[weekdayIdx];
        const x = plotL + i * cellW;

        // Cell background (alternating subtle tint)
        const isWeekend = weekdayIdx === 0 || weekdayIdx === 6;
        const cellFill = isWeekend
            ? isLight
                ? 'rgba(80,110,185,0.06)'
                : 'rgba(90,120,200,0.07)'
            : isLight
              ? 'rgba(210,155,40,0.05)'
              : 'rgba(210,155,40,0.05)';

        group.appendChild(
            svgEl('rect', {
                x: x.toFixed(1),
                y: String(stripTop),
                width: cellW.toFixed(1),
                height: String(stripH),
                fill: cellFill,
                'pointer-events': 'none',
                class: 'week-strip-cell',
                'data-day-index': String(i),
            }),
        );

        // Separator line between cells (skip first)
        if (i > 0) {
            group.appendChild(
                svgEl('line', {
                    x1: x.toFixed(1),
                    y1: String(stripTop),
                    x2: x.toFixed(1),
                    y2: String(stripTop + stripH),
                    stroke: isLight ? 'rgba(80,100,140,0.15)' : 'rgba(140,160,200,0.12)',
                    'stroke-width': '0.5',
                    'pointer-events': 'none',
                }),
            );
        }

        // Day label
        const labelColor = isLight ? 'rgba(60,70,90,0.55)' : 'rgba(180,195,220,0.50)';
        group.appendChild(
            svgEl('text', {
                x: (x + cellW / 2).toFixed(1),
                y: String(stripTop + stripH / 2 + 1),
                fill: labelColor,
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': '9',
                'font-weight': '500',
                'letter-spacing': '0.06em',
                'pointer-events': 'none',
                class: 'week-strip-label',
                'data-day-index': String(i),
            }),
        ).textContent = abbrev;
    }

    // ClipPath so the highlight rect(s) get clipped to the strip bounds.
    // This enables the "portal" wrap-around effect: the rect slides off the
    // right edge (clipped) while a ghost copy enters from the left edge.
    const clipId = 'week-strip-clip';
    const clipPath = svgEl('clipPath', { id: clipId });
    clipPath.appendChild(
        svgEl('rect', {
            x: String(plotL),
            y: String(stripTop - 2),
            width: String(plotW),
            height: String(stripH + 4),
        }),
    );
    group.appendChild(clipPath);

    // Clipped group containing the highlight rect + its ghost clone
    const hlGroup = svgEl('g', { 'clip-path': `url(#${clipId})`, 'pointer-events': 'none' });

    const highlightAttrs = {
        x: String(plotL),
        y: String(stripTop),
        width: cellW.toFixed(1),
        height: String(stripH),
        fill: isLight ? 'rgba(30,144,255,0.12)' : 'rgba(30,144,255,0.15)',
        stroke: isLight ? 'rgba(30,144,255,0.45)' : 'rgba(30,144,255,0.50)',
        'stroke-width': '1.5',
        rx: '3',
        'pointer-events': 'none',
        opacity: '0',
    };

    // Ghost highlight — visible only during wrap-around portal transition
    const ghostRect = svgEl('rect', { ...highlightAttrs, id: 'week-strip-highlight-ghost', opacity: '0' });
    hlGroup.appendChild(ghostRect);

    // Active day highlight rect (no label inside — cell labels bold on overlap)
    const highlightRect = svgEl('rect', { ...highlightAttrs, id: 'week-strip-highlight' });
    hlGroup.appendChild(highlightRect);

    group.appendChild(hlGroup);

    // Inline play icon — small triangle centered in the highlight, hidden by default
    const playIconSize = 8;
    const playCX = plotL + cellW / 2;
    const playCY = stripTop + stripH / 2;
    const playIcon = svgEl('polygon', {
        id: 'week-strip-play-icon',
        points: `${(playCX - playIconSize * 0.4).toFixed(1)},${(playCY - playIconSize * 0.5).toFixed(1)} ${(playCX + playIconSize * 0.6).toFixed(1)},${playCY.toFixed(1)} ${(playCX - playIconSize * 0.4).toFixed(1)},${(playCY + playIconSize * 0.5).toFixed(1)}`,
        fill: isLight ? 'rgba(30,100,200,0.75)' : 'rgba(180,215,255,0.80)',
        'pointer-events': 'none',
        opacity: '0',
    });
    group.appendChild(playIcon);

    // Transparent interaction hit area — captures pointer events for drag-to-scrub
    const hitRect = svgEl('rect', {
        id: 'week-strip-hit',
        x: String(plotL),
        y: String(stripTop),
        width: String(plotW),
        height: String(stripH),
        fill: 'transparent',
        'pointer-events': 'all',
        cursor: 'grab',
    });
    group.appendChild(hitRect);

    // Hide the original Day/Night bands
    _hideDayNightBands(true);
}

/**
 * Update the week strip to highlight the current day (instant snap).
 * @param dayIndex 0-based day index in the sequence
 * @param totalDays total days (must match what was passed to buildWeekStrip)
 */
export function updateWeekStripDay(dayIndex: number, totalDays: number = 7): void {
    interpolateWeekStripHighlight(dayIndex, dayIndex, 0, totalDays);
}

/**
 * Smoothly interpolate the week strip highlight between two day positions.
 * Called per-frame during day-to-day transitions for continuous sliding motion.
 * @param fromDayIndex source day (0-based)
 * @param toDayIndex target day (0-based)
 * @param t interpolation factor 0..1
 * @param totalDays total days in the sequence
 */
export function interpolateWeekStripHighlight(
    fromDayIndex: number,
    toDayIndex: number,
    t: number,
    totalDays: number = 7,
): void {
    const group = document.getElementById('phase-week-strip');
    if (!group) return;

    const plotL = PHASE_CHART.padL;
    const plotW = PHASE_CHART.plotW;
    const cellW = plotW / totalDays;
    const isLight = isLightMode();

    const highlight = document.getElementById('week-strip-highlight');
    const ghost = document.getElementById('week-strip-highlight-ghost');

    // ── Portal wrap-around: highlight continues rightward off the right edge
    //    while a ghost copy enters from the left edge (both clipped to strip bounds).
    const isWrapAround = toDayIndex < fromDayIndex && fromDayIndex !== toDayIndex;
    let curX: number;

    if (isWrapAround) {
        // Virtual rightward travel distance (cells) going forward through the right edge
        const virtualTravel = totalDays - fromDayIndex + toDayIndex;
        const virtualPos = fromDayIndex + virtualTravel * t;
        // Primary rect: continues rightward (may extend past strip — clipped)
        curX = plotL + virtualPos * cellW;
        // Ghost rect: same position but shifted left by the full strip width
        const ghostX = curX - plotW;

        if (highlight) {
            highlight.setAttribute('x', curX.toFixed(1));
            highlight.setAttribute('width', cellW.toFixed(1));
            highlight.setAttribute('opacity', '1');
        }
        if (ghost) {
            ghost.setAttribute('x', ghostX.toFixed(1));
            ghost.setAttribute('width', cellW.toFixed(1));
            ghost.setAttribute('opacity', '1');
        }
    } else {
        // Normal forward slide
        const fromX = plotL + fromDayIndex * cellW;
        const toX = plotL + toDayIndex * cellW;
        curX = fromX + (toX - fromX) * t;

        if (highlight) {
            highlight.setAttribute('x', curX.toFixed(1));
            highlight.setAttribute('width', cellW.toFixed(1));
            highlight.setAttribute('opacity', '1');
        }
        // Hide ghost when not wrapping
        if (ghost) ghost.setAttribute('opacity', '0');
    }

    // Bold the cell label that has majority overlap from the highlight
    // (use the effective visual position — for wrap-around, consider both rects)
    const dimColor = isLight ? 'rgba(60,70,90,0.55)' : 'rgba(180,195,220,0.50)';
    const boldColor = isLight ? 'rgba(20,80,180,0.92)' : 'rgba(100,180,255,0.95)';
    const labels = group.querySelectorAll('.week-strip-label');
    labels.forEach((el: Element) => {
        const idx = parseInt(el.getAttribute('data-day-index') || '-1', 10);
        if (idx < 0) return;

        const cellLeft = plotL + idx * cellW;
        const cellRight = cellLeft + cellW;

        // Overlap from primary highlight
        let overlap = Math.max(0, Math.min(cellRight, curX + cellW) - Math.max(cellLeft, curX)) / cellW;

        // During wrap-around, also check overlap with the ghost
        if (isWrapAround) {
            const ghostX = curX - plotW;
            const ghostOverlap = Math.max(0, Math.min(cellRight, ghostX + cellW) - Math.max(cellLeft, ghostX)) / cellW;
            overlap = Math.max(overlap, ghostOverlap);
        }

        if (overlap > 0.5) {
            el.setAttribute('fill', boldColor);
            el.setAttribute('font-weight', '700');
            el.setAttribute('font-size', '10.5');
        } else {
            el.setAttribute('fill', dimColor);
            el.setAttribute('font-weight', '500');
            el.setAttribute('font-size', '9');
        }
    });
}

/**
 * Show/hide the inline play icon inside the week strip highlight.
 * When visible, it's centered within the current highlight rect position.
 */
export function showWeekStripPlayIcon(visible: boolean): void {
    const icon = document.getElementById('week-strip-play-icon');
    if (!icon) return;

    if (visible) {
        // Reposition to the current highlight center
        const highlight = document.getElementById('week-strip-highlight');
        if (highlight) {
            const hx = parseFloat(highlight.getAttribute('x') || '0');
            const hw = parseFloat(highlight.getAttribute('width') || '0');
            const stripH = 24;
            const cx = hx + hw / 2;
            const cy = stripH / 2;
            const sz = 8;
            icon.setAttribute(
                'points',
                `${(cx - sz * 0.4).toFixed(1)},${(cy - sz * 0.5).toFixed(1)} ` +
                    `${(cx + sz * 0.6).toFixed(1)},${cy.toFixed(1)} ` +
                    `${(cx - sz * 0.4).toFixed(1)},${(cy + sz * 0.5).toFixed(1)}`,
            );
        }
        icon.setAttribute('opacity', '1');
    } else {
        icon.setAttribute('opacity', '0');
    }
}

/**
 * Remove the week strip and restore the Day/Night bands.
 */
export function hideWeekStrip(): void {
    const group = document.getElementById('phase-week-strip');
    if (group) group.innerHTML = '';
    _hideDayNightBands(false);
}

/** Toggle visibility of the Day/Night bands in the x-axis group */
function _hideDayNightBands(hide: boolean): void {
    const xAxisGroup = document.getElementById('phase-x-axis');
    if (!xAxisGroup) return;
    // The Day/Night bands are the first few rect children (the tinted bands) and the Day/Night text labels.
    // We identify them by the y attribute (bandTop=2) and text content.
    for (const child of Array.from(xAxisGroup.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'rect') {
            const y = parseFloat(child.getAttribute('y') || '999');
            if (y <= 15) {
                (child as HTMLElement).style.opacity = hide ? '0' : '';
            }
        }
        if (tag === 'text') {
            const text = child.textContent?.trim() || '';
            if (text === 'Day' || text === 'Night') {
                (child as HTMLElement).style.opacity = hide ? '0' : '';
            }
        }
    }
}

// ── A/B test: x-axis time label format ──────────────────────────────

function activateTimeLabelsA() {
    resetXAxisFormat();
    const group = document.getElementById('phase-x-axis');
    if (group && group.children.length > 0) buildPhaseXAxis();
}
function deactivateTimeLabelsA() {
    /* noop */
}
