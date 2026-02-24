import { PHASE_CHART, PHASE_SMOOTH_PASSES, TIMELINE_ZONE, BIOMETRIC_ZONE, DESCRIPTOR_LEVELS } from './constants';
import { AppState, PhaseState, DividerState, BiometricState } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY, sleep } from './utils';
import { smoothPhaseValues, phasePointsToPath, phasePointsToFillPath, findCurvePeak, findCurveTrough, nearestLevel, findMaxDivergence, normalizeLevels } from './curve-utils';
import { getEffectSubGroup, activateDivider, cleanupDivider } from './divider';
import { activateBaselineEditor, cleanupBaselineEditor , getLevelData } from './baseline-editor';


export function getChartLevelDesc(curve: any, val: number): string {
    const levelVal = nearestLevel(val);
    if (Array.isArray(curve.levels)) {
        const best = getLevelData(curve, val);
        if (best) return best.label;
    }
    return curve.levels?.[String(levelVal)] || '';
}

// ---- Module-level state ----
let scanLineAnimId: number | null = null;
let tlScanLineAnimId: number | null = null;
let bioScanLineAnimId: number | null = null;

// ---- Dependency injection for resetPhaseChart ----
let _resetDeps: any = null;

export function injectPhaseChartDeps(deps: {
    stopOrbitalRings: () => void;
    setOrbitalRingsState: (v: any) => void;
    setWordCloudPositions: (v: any[]) => void;
    cleanupMorphDrag: () => void;
    hideBiometricTrigger: () => void;
    hideInterventionPlayButton: () => void;
    hideRevisionPlayButton: () => void;
    BiometricState: any;
    RevisionState: any;
}): void {
    _resetDeps = deps;
}

// ============================================
// Phase Chart: X-Axis
// ============================================

export function buildPhaseXAxis(): void {
    const group = document.getElementById('phase-x-axis')!;
    group.innerHTML = '';
    const t = chartTheme();
    const isLight = document.body.classList.contains('light-mode');

    // Layout within padT=50px:
    //  [2..15]  — narrow tinted Day/Night bands
    //  [15..48] — time ruler: labels baseline y=36, ticks 38..47
    const bandTop    = 2;
    const bandBottom = 15;
    const labelY     = 36;
    const tickBaseY  = PHASE_CHART.padT - 3;   // 47
    const tallTickY  = labelY + 3;              // 39 — just below label baseline
    const shortTickY = labelY + 7;              // 43

    const day1StartX = phaseChartX(PHASE_CHART.startHour * 60);
    const midnightX  = phaseChartX(24 * 60);
    const day2EndX   = phaseChartX(PHASE_CHART.endHour * 60);

    // --- Bottom boundary of plot area ---
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL),
        y1: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW),
        y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: t.axisBoundary, 'stroke-width': '0.75',
    }));

    // --- Narrow tinted Day / Night bands ---
    group.appendChild(svgEl('rect', {
        x: day1StartX.toFixed(1), y: String(bandTop),
        width: (midnightX - day1StartX).toFixed(1),
        height: String(bandBottom - bandTop),
        fill: isLight ? 'rgba(210,155,40,0.09)' : 'rgba(210,155,40,0.10)',
        rx: '2', 'pointer-events': 'none',
    }));
    group.appendChild(svgEl('rect', {
        x: midnightX.toFixed(1), y: String(bandTop),
        width: (day2EndX - midnightX).toFixed(1),
        height: String(bandBottom - bandTop),
        fill: isLight ? 'rgba(80,110,185,0.09)' : 'rgba(90,120,200,0.12)',
        rx: '2', 'pointer-events': 'none',
    }));

    // Band labels — centred, very understated
    const dayFill   = isLight ? 'rgba(100,75,20,0.65)' : 'rgba(210,175,100,0.62)';
    const nightFill = isLight ? 'rgba(40,70,140,0.65)' : 'rgba(150,175,225,0.62)';
    group.appendChild(svgEl('text', {
        x: ((day1StartX + midnightX) / 2).toFixed(1),
        y: String(bandTop + 10),
        fill: dayFill,
        'text-anchor': 'middle', 'font-family': "'IBM Plex Mono', monospace",
        'font-size': '8.5', 'font-weight': '500', 'letter-spacing': '0.10em',
    })).textContent = 'Day';
    group.appendChild(svgEl('text', {
        x: ((midnightX + day2EndX) / 2).toFixed(1),
        y: String(bandTop + 10),
        fill: nightFill,
        'text-anchor': 'middle', 'font-family': "'IBM Plex Mono', monospace",
        'font-size': '8.5', 'font-weight': '500', 'letter-spacing': '0.10em',
    })).textContent = 'Night';

    // --- Midnight divider through the full chart ---
    group.appendChild(svgEl('line', {
        x1: midnightX.toFixed(1), y1: String(bandBottom + 1),
        x2: midnightX.toFixed(1), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: isLight ? 'rgba(90,120,180,0.18)' : 'rgba(140,170,230,0.16)',
        'stroke-width': '1', 'stroke-dasharray': '2 5',
    }));

    // --- Tick baseline ---
    group.appendChild(svgEl('line', {
        x1: String(PHASE_CHART.padL), y1: String(tickBaseY),
        x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: String(tickBaseY),
        stroke: isLight ? 'rgba(80,110,150,0.22)' : 'rgba(174,201,237,0.22)',
        'stroke-width': '0.5',
    }));

    // --- Odd-hour minor ticks ---
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h++) {
        if (h % 2 === 0) continue;
        const x = phaseChartX(h * 60);
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(shortTickY),
            x2: x.toFixed(1), y2: String(tickBaseY),
            stroke: t.tickNormal, 'stroke-width': '0.5',
        }));
    }

    // --- Even-hour ticks + labels every 2h in HH:00 format ---
    for (let h = PHASE_CHART.startHour; h <= PHASE_CHART.endHour; h += 2) {
        const x = phaseChartX(h * 60);
        const displayHour = h % 24;
        const isMidnight  = displayHour === 0;

        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(isMidnight ? bandBottom + 2 : tallTickY),
            x2: x.toFixed(1), y2: String(tickBaseY),
            stroke: t.tickNormal,
            'stroke-width': isMidnight ? '1' : '0.75',
        }));

        group.appendChild(svgEl('text', {
            x: x.toFixed(1), y: String(labelY),
            fill: t.labelNormal,
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': '9.5',
            'font-weight': '400',
            'text-anchor': 'middle',
        })).textContent = `${String(displayHour).padStart(2, '0')}:00`;
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
        'phase-baseline-curves', 'phase-desired-curves', 'phase-lx-curves',
        'phase-mission-arrows', 'phase-yaxis-indicators', 'phase-lx-markers',
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
                    sub.style.filter = (ei === activeIdx) ? boostFilter : dimFilter;
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
            if (curve.levels && Object.keys(curve.levels).length <= 5) {
                curve.levels = normalizeLevels(curve.levels);
            }
        }
    }
    const leftLevels = curvesData && curvesData[0] && curvesData[0].levels ? curvesData[0].levels : null;
    const rightLevels = curvesData && curvesData[1] && curvesData[1].levels ? curvesData[1].levels : null;
    if (effects.length >= 1) buildSingleYAxis(leftGroup, effects[0], 'left', cols[0], leftLevels, 0, effects.length);
    if (effects.length >= 2) buildSingleYAxis(rightGroup, effects[1], 'right', cols[1], rightLevels, 1, effects.length);
}

export function buildSingleYAxis(group: Element, effectLabel: string, side: 'left' | 'right', color: string, levels: any, curveIndex: number, totalCurves: number): void {
    const x = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
    const tickDir = side === 'left' ? -6 : 6;
    const textAnchor = side === 'left' ? 'end' : 'start';
    const labelOffset = side === 'left' ? -10 : 10;
    const t = chartTheme();
    const labelColor = color || t.yLabelDefault;

    // Axis line
    group.appendChild(svgEl('line', {
        x1: String(x), y1: String(PHASE_CHART.padT),
        x2: String(x), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: t.axisLine, 'stroke-width': '1.2',
    }));

    // Collect tick data for magnetic hit areas
    const ticks: number[] = [...DESCRIPTOR_LEVELS];

    // Tick marks + labels at each descriptor level
    const tickElements: any[] = []; // { v, y, numLabel, descriptor, guideLine, tipGroup }
    for (let ti = 0; ti < ticks.length; ti++) {
        const v = ticks[ti];
        const y = phaseChartY(v);
        // Major ticks at ~quarter marks (0,22,44,67,89,100), minor at others
        const isMajor = ti % 2 === 0 || v === 100;
        group.appendChild(svgEl('line', {
            x1: String(x), y1: y.toFixed(1),
            x2: String(x + (isMajor ? tickDir : tickDir * 0.6)), y2: y.toFixed(1),
            stroke: t.yTick, 'stroke-width': isMajor ? '1' : '0.6',
        }));

        // Show numeric label on alternating ticks to avoid crowding
        let numLabel: any = null;
        if (isMajor) {
            numLabel = svgEl('text', {
                x: String(x + labelOffset), y: (y + 3).toFixed(1),
                fill: t.yLabel,
                'font-family': "'IBM Plex Mono', monospace",
                'font-size': '9', 'text-anchor': textAnchor,
            });
            numLabel.textContent = String(v);
            group.appendChild(numLabel);
        }

        const entry: any = { v, y, numLabel, descriptor: null, guideLine: null, tipGroup: null };

        // Hover descriptor tooltip + guide line (rendered in topmost overlay)
        if (levels && levels[String(v)]) {
            const descriptor = levels[String(v)];
            entry.descriptor = descriptor;
            const overlay = document.getElementById('phase-tooltip-overlay')!;
            // Position descriptor inside the chart area
            const tooltipAnchor = side === 'left' ? 'start' : 'end';
            const tooltipX = side === 'left' ? x + 12 : x - 12;

            // Dotted guide line spanning the full chart width (hidden by default)
            const guideLine = svgEl('line', {
                x1: String(PHASE_CHART.padL), y1: y.toFixed(1),
                x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: y.toFixed(1),
                stroke: labelColor, 'stroke-width': '0.8',
                'stroke-dasharray': '4 4', 'stroke-opacity': '0',
                class: 'tick-guide-line', 'pointer-events': 'none',
            });
            overlay.appendChild(guideLine);
            entry.guideLine = guideLine;

            // Tooltip group with dark backdrop (hidden by default)
            const tipGroup = svgEl('g', { class: 'tick-tooltip', opacity: '0', 'pointer-events': 'none' });

            // Measure text for backdrop pill
            const tipTextW = descriptor.length * 7;
            const tipPillPadX = 8, tipPillPadY = 4;
            const tipPillW = tipTextW + tipPillPadX * 2;
            const tipPillH = 16 + tipPillPadY * 2;
            const tipPillX = side === 'left'
                ? tooltipX - tipPillPadX
                : tooltipX - tipPillW + tipPillPadX;

            const tipBackdrop = svgEl('rect', {
                x: tipPillX.toFixed(1),
                y: (y - tipPillH / 2 + 2).toFixed(1),
                width: tipPillW.toFixed(1),
                height: tipPillH.toFixed(1),
                rx: '5', ry: '5',
                fill: t.tooltipBg,
            });
            tipGroup.appendChild(tipBackdrop);

            const textEl = svgEl('text', {
                x: String(tooltipX), y: (y + 4).toFixed(1),
                fill: labelColor, 'fill-opacity': '0.92',
                'font-family': "'Space Grotesk', sans-serif",
                'font-size': '12', 'font-weight': '500',
                'text-anchor': tooltipAnchor,
                'letter-spacing': '0.02em',
            });
            textEl.textContent = descriptor;
            tipGroup.appendChild(textEl);

            overlay.appendChild(tipGroup);
            entry.tipGroup = tipGroup;
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
            x: String(side === 'left' ? x - 40 : x),
            y: hitTop.toFixed(1),
            width: '40', height: hitHeight.toFixed(1),
            fill: 'transparent',
            class: 'tick-hover-area',
            'pointer-events': 'all',
            cursor: 'default',
        });
        overlay.appendChild(hitArea);

        // Hover events — emphasize number, show descriptor, guide line, dim other curves
        let guideAnim: any = null;
        hitArea.addEventListener('mouseenter', () => {
            // Emphasize the number with curve color (if label exists for this tick)
            if (entry.numLabel) {
                entry.numLabel.setAttribute('fill', labelColor);
                entry.numLabel.setAttribute('font-weight', '600');
                entry.numLabel.style.filter = `drop-shadow(0 0 3px ${labelColor})`;
                entry.numLabel.style.transition = 'filter 150ms ease';
            }

            if (entry.tipGroup) {
                entry.tipGroup.setAttribute('opacity', '1');
            }

            // Animate guide line in from the axis side
            if (entry.guideLine) {
                const startX = side === 'left' ? PHASE_CHART.padL : PHASE_CHART.padL + PHASE_CHART.plotW;
                const endX = side === 'left' ? PHASE_CHART.padL + PHASE_CHART.plotW : PHASE_CHART.padL;
                entry.guideLine.setAttribute('x1', String(startX));
                entry.guideLine.setAttribute('x2', String(startX));
                entry.guideLine.setAttribute('stroke-opacity', '0.35');
                const animStart = performance.now();
                guideAnim = (function growLine() {
                    const t = Math.min(1, (performance.now() - animStart) / 350);
                    const ease = 1 - Math.pow(1 - t, 3);
                    entry.guideLine.setAttribute('x2', String(startX + (endX - startX) * ease));
                    if (t < 1) requestAnimationFrame(growLine);
                    return growLine;
                })();
            }

            // Dim the OTHER curve to make this one pop
            if (totalCurves >= 2) {
                highlightCurve(curveIndex, true);
            }
        });
        hitArea.addEventListener('mouseleave', () => {
            // Restore number to default (if label exists for this tick)
            if (entry.numLabel) {
                entry.numLabel.setAttribute('fill', 'rgba(167, 191, 223, 0.76)');
                entry.numLabel.setAttribute('font-weight', '400');
                entry.numLabel.style.filter = '';
            }

            if (entry.tipGroup) {
                entry.tipGroup.setAttribute('opacity', '0');
            }
            if (entry.guideLine) {
                entry.guideLine.setAttribute('stroke-opacity', '0');
            }
            guideAnim = null;

            // Restore all curves
            if (totalCurves >= 2) {
                highlightCurve(curveIndex, false);
            }
        });
    }

    // Effect label outside plot area, top-aligned to y-axis, larger bold text, word-wrapped to 2 lines
    const labelAnchor = side === 'left' ? 'start' : 'end';
    const labelX = side === 'left' ? 25 : PHASE_CHART.viewW - 25;
    const labelY = PHASE_CHART.padT + 16;
    const lineHeight = 18;
    const [line1, line2] = splitEffectLabelIntoTwoLines(effectLabel);

    const yLabel = svgEl('text', {
        x: String(labelX), y: String(labelY),
        fill: labelColor, 'fill-opacity': '0.9',
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '15', 'font-weight': '700', 'letter-spacing': '0.03em',
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
export function getYAxisLabelPosition(side: 'left' | 'right'): { x: number; y: number; anchor: string; baseline: string } {
    const x = side === 'left' ? 75 : PHASE_CHART.viewW - 75;
    return {
        x,
        y: PHASE_CHART.padT + 16,
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
        group.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(PHASE_CHART.padT),
            x2: x.toFixed(1), y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
            stroke: t.grid, 'stroke-width': '1',
        }));
    }
    for (let i = 0; i < DESCRIPTOR_LEVELS.length; i++) {
        const v = DESCRIPTOR_LEVELS[i];
        if (v === 0) continue;
        const y = phaseChartY(v);
        // Major lines at even indices (0,22,44,67,89,100), minor at odd
        const isMajor = i % 2 === 0 || v === 100;
        group.appendChild(svgEl('line', {
            x1: String(PHASE_CHART.padL), y1: y.toFixed(1),
            x2: String(PHASE_CHART.padL + PHASE_CHART.plotW), y2: y.toFixed(1),
            stroke: t.grid, 'stroke-width': isMajor ? '1' : '0.5',
            opacity: isMajor ? '1' : '0.4',
        }));
    }
}

// ============================================
// Phase Chart: Scanning Line
// ============================================

export function startScanLine(): void {
    const group = document.getElementById('phase-scan-line')!;
    group.innerHTML = '';

    const startX = PHASE_CHART.padL;

    // Glow behind line
    const t = chartTheme();
    const glow = svgEl('rect', {
        id: 'scan-line-glow',
        x: String(startX - 4), y: String(PHASE_CHART.padT),
        width: '10', height: String(PHASE_CHART.plotH),
        fill: t.scanGlow, rx: '5',
    });
    group.appendChild(glow);

    // Main scan line
    const line = svgEl('rect', {
        id: 'scan-line-rect',
        x: String(startX), y: String(PHASE_CHART.padT),
        width: '2', height: String(PHASE_CHART.plotH),
        fill: 'url(#scan-line-grad)', opacity: '0.7',
    });
    group.appendChild(line);

    let direction = 1;
    let position = 0;
    const range = PHASE_CHART.plotW;
    const speed = range / 1.25; // traverse in 1.25 seconds
    let lastTime = performance.now();

    function tick(now: number) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        position += direction * speed * dt;
        if (position >= range) { position = range; direction = -1; }
        if (position <= 0) { position = 0; direction = 1; }
        const currentX = PHASE_CHART.padL + position;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        scanLineAnimId = requestAnimationFrame(tick);
    }
    scanLineAnimId = requestAnimationFrame(tick);
}

export function stopScanLine(): void {
    if (scanLineAnimId) {
        cancelAnimationFrame(scanLineAnimId);
        scanLineAnimId = null;
    }
    const line = document.getElementById('scan-line-rect');
    const glow = document.getElementById('scan-line-glow');
    if (line) line.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
    setTimeout(() => {
        const group = document.getElementById('phase-scan-line');
        if (group) group.innerHTML = '';
    }, 450);
}

// ---- Timeline Scan Line ----

export function startTimelineScanLine(laneCount) {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;

    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const zoneTop = TIMELINE_ZONE.separatorY;
    const zoneH = Math.max(30, laneCount * laneStep + TIMELINE_ZONE.bottomPad);

    const glow = svgEl('rect', {
        id: 'tl-scan-glow',
        x: String(PHASE_CHART.padL - 4), y: String(zoneTop),
        width: '10', height: String(zoneH),
        fill: 'rgba(245, 200, 80, 0.08)', rx: '5',
    });
    group.appendChild(glow);

    const line = svgEl('rect', {
        id: 'tl-scan-rect',
        x: String(PHASE_CHART.padL), y: String(zoneTop),
        width: '2', height: String(zoneH),
        fill: 'url(#tl-scan-line-grad)', opacity: '0.7',
    });
    group.appendChild(line);

    let direction = 1;
    let position = 0;
    const range = PHASE_CHART.plotW;
    const speed = range / 1.5;
    let lastTime = performance.now();

    function tick(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        position += direction * speed * dt;
        if (position >= range) { position = range; direction = -1; }
        if (position <= 0) { position = 0; direction = 1; }
        const currentX = PHASE_CHART.padL + position;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        tlScanLineAnimId = requestAnimationFrame(tick);
    }
    tlScanLineAnimId = requestAnimationFrame(tick);
}

export function stopTimelineScanLine(): void {
    if (tlScanLineAnimId) {
        cancelAnimationFrame(tlScanLineAnimId);
        tlScanLineAnimId = null;
    }
    const line = document.getElementById('tl-scan-rect');
    const glow = document.getElementById('tl-scan-glow');
    if (line) line.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    setTimeout(() => {
        if (line) line.remove();
        if (glow) glow.remove();
    }, 350);
}

// ---- Biometric Scan Line ----

declare const BIOMETRIC_DEVICES: any;

export function startBioScanLine() {
    const svg = document.getElementById('phase-chart-svg');
    const group = document.getElementById('phase-biometric-strips');
    if (!svg || !group) return;

    group.innerHTML = '';

    const currentVB = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const currentH = currentVB[3];
    (svg as any).dataset.preBioScanH = String(currentH);

    const estimatedChannels = (BiometricState.selectedDevices || []).reduce((sum: number, dKey: string) => {
        const dev = (typeof BIOMETRIC_DEVICES !== 'undefined') ? BIOMETRIC_DEVICES.devices?.find((d: any) => d.key === dKey) : null;
        return sum + (dev ? dev.displayChannels.length : 0);
    }, 0);
    const zoneH = Math.max(80, estimatedChannels * (BIOMETRIC_ZONE.laneH + BIOMETRIC_ZONE.laneGap) + BIOMETRIC_ZONE.separatorPad * 2 + BIOMETRIC_ZONE.bottomPad);

    const newH = currentH + zoneH;
    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${newH}`);

    const zoneTop = currentH + BIOMETRIC_ZONE.separatorPad;
    const zoneBottom = newH - BIOMETRIC_ZONE.bottomPad;
    const zoneHeight = zoneBottom - zoneTop;

    const bg = svgEl('rect', {
        x: String(PHASE_CHART.padL), y: String(zoneTop),
        width: String(PHASE_CHART.plotW), height: String(zoneHeight),
        fill: 'rgba(255, 77, 77, 0.02)', rx: '2',
    });
    group.appendChild(bg);

    const glow = svgEl('rect', {
        id: 'bio-scan-glow',
        x: String(PHASE_CHART.padL - 4), y: String(zoneTop),
        width: '10', height: String(zoneHeight),
        fill: 'rgba(255, 77, 77, 0.12)', rx: '5',
    });
    group.appendChild(glow);

    const line = svgEl('rect', {
        id: 'bio-scan-rect',
        x: String(PHASE_CHART.padL), y: String(zoneTop),
        width: '2', height: String(zoneHeight),
        fill: 'url(#bio-scan-line-grad)', opacity: '0.8',
    });
    group.appendChild(line);

    let direction = 1;
    let position = 0;
    const range = PHASE_CHART.plotW;
    const speed = range / 1.8;
    let lastTime = performance.now();

    function tick(now: number) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        position += direction * speed * dt;
        if (position >= range) { position = range; direction = -1; }
        if (position <= 0) { position = 0; direction = 1; }
        const currentX = PHASE_CHART.padL + position;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        bioScanLineAnimId = requestAnimationFrame(tick);
    }
    bioScanLineAnimId = requestAnimationFrame(tick);
}

export function stopBioScanLine(): void {
    if (bioScanLineAnimId) {
        cancelAnimationFrame(bioScanLineAnimId);
        bioScanLineAnimId = null;
    }
    const line = document.getElementById('bio-scan-rect');
    const glow = document.getElementById('bio-scan-glow');
    if (line) line.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });
    setTimeout(() => {
        const group = document.getElementById('phase-biometric-strips');
        if (group) group.innerHTML = '';
        // Restore viewBox to pre-scan height so renderBiometricStrips starts clean
        const svg = document.getElementById('phase-chart-svg');
        if (svg && (svg as any).dataset.preBioScanH) {
            svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${(svg as any).dataset.preBioScanH}`);
            delete (svg as any).dataset.preBioScanH;
        }
    }, 400);
}

// ============================================
// Phase Chart: Peak Descriptor Labels
// ============================================

export function placePeakDescriptors(group: Element, curvesData: any[], pointsKey: string, baseDelay: number): void {
    // Both baseline and target labels anchor at the max divergence point —
    // the time where the intervention matters most to the user.
    // Baseline label: shows the baseline value at that critical time
    // Target label: shows the target value at that critical time
    const isBaseline = pointsKey === 'baseline';

    const items: any[] = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;

        // Find the max divergence point (most impactful time)
        const div = findMaxDivergence(curve);
        let keyPoint: any;
        if (div) {
            if (isBaseline) {
                // Read the baseline value at the divergence time
                const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
                const match = blSmoothed.reduce((a: any, b: any) =>
                    Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a);
                keyPoint = { hour: match.hour, value: match.value };
            } else {
                // Target value at divergence time (already in div)
                keyPoint = div;
            }
        } else {
            // Fallback if no divergence data
            keyPoint = isBaseline
                ? findCurveTrough(curve[pointsKey])
                : findCurvePeak(curve[pointsKey]);
        }

        const level = nearestLevel(keyPoint.value);
        const descriptor = getChartLevelDesc(curve, keyPoint.value);
        if (!descriptor) continue;
        const px = phaseChartX(keyPoint.hour * 60);
        const py = phaseChartY(keyPoint.value);
        items.push({ curve, curveIdx: i, descriptor, px, py, peakVal: keyPoint.value, labelY: 0 });
    }
    if (items.length === 0) return;

    // Default placement: label goes on the side with more space
    // High values (low py) → label above; Low values (high py) → label below
    for (const item of items) {
        const isHighValue = item.peakVal >= 50;
        item.labelY = isHighValue ? item.py - 14 : item.py + 18;
    }

    // Collision avoidance for 2 labels
    if (items.length === 2) {
        const dx = Math.abs(items[0].px - items[1].px);
        const dy = Math.abs(items[0].labelY - items[1].labelY);
        // Estimate text width ~7px per char
        const w0 = items[0].descriptor.length * 7 / 2;
        const w1 = items[1].descriptor.length * 7 / 2;
        const xOverlap = dx < (w0 + w1 + 10);
        const yOverlap = dy < 18;

        if (xOverlap && yOverlap) {
            // Put the higher-peak label above, lower-peak label below its curve
            const higher = items[0].peakVal >= items[1].peakVal ? 0 : 1;
            const lower = 1 - higher;
            items[higher].labelY = items[higher].py - 16;
            items[lower].labelY = items[lower].py + 16;
        }
    }

    // Clamp within chart bounds
    for (const item of items) {
        item.labelY = Math.max(PHASE_CHART.padT + 12, Math.min(PHASE_CHART.padT + PHASE_CHART.plotH - 8, item.labelY));
    }

    // Create and animate labels with backdrop for readability over curves
    const dt = chartTheme();
    for (let i = 0; i < items.length; i++) {
        const { curve, curveIdx, descriptor, px, labelY } = items[i];
        const delayMs = baseDelay + i * 200;

        // Estimate text dimensions for backdrop pill
        const estTextW = descriptor.length * 6.5;
        const pillPadX = 8, pillPadY = 4;
        const pillW = estTextW + pillPadX * 2;
        const pillH = 16 + pillPadY * 2;

        // Container group for backdrop + text
        const labelGroup = svgEl('g', {
            class: 'peak-descriptor', opacity: '0',
            'data-effect-idx': String(curveIdx),
        });

        // Backdrop pill
        const backdrop = svgEl('rect', {
            x: (px - pillW / 2).toFixed(1),
            y: (labelY - pillH / 2 - 2).toFixed(1),
            width: pillW.toFixed(1),
            height: pillH.toFixed(1),
            rx: '6', ry: '6',
            fill: dt.tooltipBg,
        });
        labelGroup.appendChild(backdrop);

        const label = svgEl('text', {
            x: px.toFixed(1), y: (labelY + 1).toFixed(1),
            fill: curve.color,
            'font-family': "'Space Grotesk', sans-serif",
            'font-size': '11', 'font-weight': '600',
            'text-anchor': 'middle', 'letter-spacing': '0.03em',
            'dominant-baseline': 'middle',
        });
        label.textContent = descriptor;
        labelGroup.appendChild(label);
        // Append to per-effect sub-group if divider is active, otherwise to parent
        const targetGroup = (DividerState.active && curvesData.length >= 2)
            ? getEffectSubGroup(group, curveIdx)
            : group;
        targetGroup.appendChild(labelGroup);

        const startTime = performance.now();
        (function fadeIn() {
            const elapsed = performance.now() - startTime;
            if (elapsed < delayMs) { requestAnimationFrame(fadeIn); return; }
            const t = Math.min(1, (elapsed - delayMs) / 500);
            const ease = 1 - Math.pow(1 - t, 3);
            labelGroup.setAttribute('opacity', String(0.85 * ease));
            if (t < 1) requestAnimationFrame(fadeIn);
        })();
    }
}

// ============================================
// Private: Y-Axis Transition Indicators
// ============================================

const HALO_DARK = 'rgba(8,10,16,0.95)';
const HALO_LIGHT = 'rgba(235,240,248,0.90)';

function haloColor(): string {
    return document.body.classList.contains('light-mode') ? HALO_LIGHT : HALO_DARK;
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
    let bestSplit = 1, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
        const l1 = words.slice(0, i).join(' ').length;
        const l2 = words.slice(i).join(' ').length;
        const diff = Math.abs(l1 - l2);
        if (diff < bestDiff) { bestDiff = diff; bestSplit = i; }
    }
    return [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
}

function placeLabel(
    parent: Element, text: string, labelX: number, centerY: number,
    maxLabelW: number, color: string, fontSize: number, weight: string, opacity: number,
): void {
    const charW = fontSize * 0.65;
    const maxChars = Math.max(6, Math.floor(maxLabelW / charW));
    const lines = splitLabel(text, maxChars);
    const lineH = fontSize * 1.4;
    const totalH = lines.length * lineH;
    const startY = centerY - totalH / 2 + fontSize * 0.38;

    const el = svgEl('text', {
        fill: color, 'fill-opacity': String(opacity),
        stroke: haloColor(), 'stroke-width': '4', 'paint-order': 'stroke',
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': String(fontSize), 'font-weight': weight,
        'text-anchor': 'middle', 'letter-spacing': '0.01em',
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

// ── Change indicator: aspirational arrow ──
function renderChangeIndicator(
    group: Element, curve: any, curveIdx: number, div: any,
    side: 'left' | 'right', axisX: number, _theme: any, delay: number,
): void {
    const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    const blMatch = blSmoothed.reduce((a: any, b: any) =>
        Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a);

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
        class: 'yaxis-change-indicator', opacity: '0',
        'data-effect-idx': String(curveIdx),
    });

    // ── Gradient ──
    const gradId = `yaxis-arrow-grad-${curveIdx}`;
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', {
        id: gradId, x1: '0', y1: String(Math.min(baseY, desiredY)),
        x2: '0', y2: String(Math.max(baseY, desiredY)),
        gradientUnits: 'userSpaceOnUse',
    });
    grad.appendChild(svgEl('stop', {
        offset: desiredY < baseY ? '0%' : '100%',
        'stop-color': curve.color, 'stop-opacity': '1',
    }));
    grad.appendChild(svgEl('stop', {
        offset: desiredY < baseY ? '100%' : '0%',
        'stop-color': curve.color, 'stop-opacity': '0.18',
    }));
    defs.appendChild(grad);
    container.appendChild(defs);

    // ── Glow ──
    const glowLine = svgEl('line', {
        x1: String(arrowX), y1: baseY.toFixed(1),
        x2: String(arrowX), y2: baseY.toFixed(1),
        stroke: curve.color, 'stroke-width': '14', 'stroke-opacity': '0',
        'stroke-linecap': 'round', 'pointer-events': 'none',
    });
    container.appendChild(glowLine);

    // ── Shaft ──
    const shaft = svgEl('line', {
        x1: String(arrowX), y1: baseY.toFixed(1),
        x2: String(arrowX), y2: baseY.toFixed(1),
        stroke: `url(#${gradId})`, 'stroke-width': '3',
        'stroke-linecap': 'round',
    });
    container.appendChild(shaft);

    // ── Arrowhead ──
    const headH = 12, headW = 7;
    const arrowHead = svgEl('path', {
        d: `M${arrowX} ${desiredY} L${arrowX - headW} ${desiredY - tipDir * headH} L${arrowX + headW} ${desiredY - tipDir * headH} Z`,
        fill: curve.color, 'fill-opacity': '0',
    });
    container.appendChild(arrowHead);

    // ── Origin dot ──
    const originDot = svgEl('circle', {
        cx: String(arrowX), cy: baseY.toFixed(1),
        r: '3.5', fill: curve.color, 'fill-opacity': '0',
    });
    container.appendChild(originDot);

    // ── FROM label (centered in margin, subdued) ──
    placeLabel(container, baseDesc, labelX, baseY, maxLabelW, curve.color, 10, '500', 0.50);

    // ── TO label (centered in margin, bold — animated reveal) ──
    const toLabelWrap = svgEl('g', { opacity: '0' });
    placeLabel(toLabelWrap, desiredDesc, labelX, desiredY, maxLabelW, curve.color, 12, '700', 1.0);
    container.appendChild(toLabelWrap);

    group.appendChild(container);

    // ── Animation ──
    const startTime = performance.now();
    const fadeInDur = 350;
    const arrowGrowDur = 900;

    (function animate() {
        const elapsed = performance.now() - startTime;
        if (elapsed < delay) { requestAnimationFrame(animate); return; }
        const localT = elapsed - delay;

        const fadeT = Math.min(1, localT / fadeInDur);
        container.setAttribute('opacity', String(1 - Math.pow(1 - fadeT, 3)));

        if (localT > 250) {
            const arrowT = Math.min(1, (localT - 250) / arrowGrowDur);
            const ease = 1 - Math.pow(1 - arrowT, 3);
            const curY = baseY + (desiredY - baseY) * ease;

            shaft.setAttribute('y2', curY.toFixed(1));
            glowLine.setAttribute('y2', curY.toFixed(1));
            glowLine.setAttribute('stroke-opacity', String(0.10 * Math.min(1, arrowT * 2)));
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

// ── Keep indicator: clean line-dot with peak zone labels ──
function renderKeepIndicator(
    group: Element, curve: any, curveIdx: number,
    side: 'left' | 'right', axisX: number, _theme: any, delay: number,
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
        class: 'yaxis-keep-indicator', opacity: '0',
        'data-effect-idx': String(curveIdx),
    });

    // ── Labels (centered in margin) ──
    if (hasRange) {
        if (topDesc) placeLabel(container, topDesc, labelX, topY, maxLabelW, curve.color, 10, '500', 0.72);
        if (botDesc) placeLabel(container, botDesc, labelX, botY, maxLabelW, curve.color, 10, '500', 0.72);
    } else {
        const desc = topDesc || botDesc || '';
        placeLabel(container, desc, labelX, centerY, maxLabelW, curve.color, 10, '500', 0.72);
    }

    // ── Horizontal line with center dot ──
    const hw = 14;

    container.appendChild(svgEl('line', {
        x1: (arrowX - hw).toFixed(1), y1: centerY.toFixed(1),
        x2: (arrowX + hw).toFixed(1), y2: centerY.toFixed(1),
        stroke: curve.color, 'stroke-width': '6', 'stroke-opacity': '0.08',
        'stroke-linecap': 'round',
    }));
    container.appendChild(svgEl('line', {
        x1: (arrowX - hw).toFixed(1), y1: centerY.toFixed(1),
        x2: (arrowX + hw).toFixed(1), y2: centerY.toFixed(1),
        stroke: curve.color, 'stroke-width': '1.5', 'stroke-opacity': '0.5',
        'stroke-linecap': 'round',
    }));
    container.appendChild(svgEl('circle', {
        cx: String(arrowX), cy: centerY.toFixed(1),
        r: '6', fill: curve.color, 'fill-opacity': '0.08',
    }));
    container.appendChild(svgEl('circle', {
        cx: String(arrowX), cy: centerY.toFixed(1),
        r: '3.5', fill: curve.color, 'fill-opacity': '0.75',
    }));

    group.appendChild(container);

    const startTime = performance.now();
    const dur = 500;
    (function animate() {
        const elapsed = performance.now() - startTime;
        if (elapsed < delay) { requestAnimationFrame(animate); return; }
        const t = Math.min(1, (elapsed - delay) / dur);
        container.setAttribute('opacity', String(0.92 * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(animate);
    })();
}

// ============================================
// Phase Chart: Render Baseline Curves
// ============================================

export async function renderBaselineCurves(curvesData: any[]): Promise<void> {
    const group = document.getElementById('phase-baseline-curves')!;
    group.innerHTML = '';

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const pathD = phasePointsToPath(curve.baseline);
        if (!pathD) continue;

        const sub = getEffectSubGroup(group, i);

        // Area fill
        const fillPath = svgEl('path', {
            d: phasePointsToFillPath(curve.baseline),
            fill: curve.color, 'fill-opacity': '0', // animate in
        });
        sub.appendChild(fillPath);

        // Dashed stroke
        const strokePath = svgEl('path', {
            d: pathD, fill: 'none', stroke: curve.color,
            class: 'phase-baseline-path', opacity: '0',
        });
        sub.appendChild(strokePath);

        // Animate fade-in
        strokePath.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: 800, fill: 'forwards' });
        fillPath.animate([{ fillOpacity: 0 }, { fillOpacity: 0.04 }], { duration: 800, fill: 'forwards' });

            await sleep(200);
    }

    // Activate interactive baseline editor (replaces static peak descriptors)
    activateBaselineEditor(curvesData);

    // Activate split-screen divider for 2-effect mode
    activateDivider(curvesData);
}

/** Instant baseline curves — no animation, used after ring→curve morph */
export function renderBaselineCurvesInstant(curvesData: any[]): void {
    const group = document.getElementById('phase-baseline-curves')!;
    group.innerHTML = '';

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const pathD = phasePointsToPath(curve.baseline);
        if (!pathD) continue;

        const sub = getEffectSubGroup(group, i);

        const fillPath = svgEl('path', {
            d: phasePointsToFillPath(curve.baseline),
            fill: curve.color, 'fill-opacity': '0.04',
        });
        sub.appendChild(fillPath);

        const strokePath = svgEl('path', {
            d: pathD, fill: 'none', stroke: curve.color,
            class: 'phase-baseline-path', opacity: '0.5',
        });
        sub.appendChild(strokePath);
    }

    // Activate interactive baseline editor (replaces static peak descriptors)
    activateBaselineEditor(curvesData);

    // Activate split-screen divider for 2-effect mode
    activateDivider(curvesData);
}

// ============================================
// Phase Chart: Morph baseline → desired with arrows
// ============================================

export async function morphToDesiredCurves(curvesData: any[]): Promise<void> {
    const baseGroup = document.getElementById('phase-baseline-curves')!;
    const desiredGroup = document.getElementById('phase-desired-curves')!;
    const arrowGroup = document.getElementById('phase-mission-arrows')!;
    desiredGroup.innerHTML = '';
    arrowGroup.innerHTML = '';

    // Compute one arrow per curve at the point of maximum divergence
    const allArrows: any[] = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const div = findMaxDivergence(curve);
        if (!div || Math.abs(div.diff) < 5) continue;
        // Get baseline value at the same hour
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const match = blSmoothed.reduce((a: any, b: any) => Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a);
        allArrows.push({ curve, idx: i, arrow: { hour: div.hour, baseVal: match.value, desiredVal: div.value, diff: div.diff } });
    }

    // Phase 1: Grow elegant arrows from baseline → desired (900ms)
    for (const { curve, idx, arrow } of allArrows) {
        const arrowSub = getEffectSubGroup(arrowGroup, idx);
        const x = phaseChartX(arrow.hour * 60);
        const y1 = phaseChartY(arrow.baseVal);
        const y2 = phaseChartY(arrow.desiredVal);

        // Subtle glow behind the arrow shaft
        const glowLine = svgEl('line', {
            x1: x.toFixed(1), y1: y1.toFixed(1),
            x2: x.toFixed(1), y2: y1.toFixed(1),
            stroke: curve.color, 'stroke-width': '4', 'stroke-opacity': '0',
            'stroke-linecap': 'round', fill: 'none', 'pointer-events': 'none',
        });
        arrowSub.appendChild(glowLine);

        // Main arrow shaft
        const arrowLine = svgEl('line', {
            x1: x.toFixed(1), y1: y1.toFixed(1),
            x2: x.toFixed(1), y2: y1.toFixed(1),
            stroke: curve.color, class: 'mission-arrow', opacity: '0',
        });
        arrowSub.appendChild(arrowLine);

        // Animate both shaft and glow
        const startTime = performance.now();
        const animDur = 900;
        (function animateArrow() {
            const t = Math.min(1, (performance.now() - startTime) / animDur);
            const ease = 1 - Math.pow(1 - t, 3);
            const curY = y1 + (y2 - y1) * ease;
            const opacity = 0.7 * Math.min(1, t * 2.5);
            arrowLine.setAttribute('opacity', String(opacity));
            arrowLine.setAttribute('y2', curY.toFixed(1));
            glowLine.setAttribute('stroke-opacity', String(0.15 * Math.min(1, t * 2.5)));
            glowLine.setAttribute('y2', curY.toFixed(1));
            if (t < 1) requestAnimationFrame(animateArrow);
        })();
    }

    // Y-axis margin indicators (change arrows / keep markers) — concurrent with mission arrows
    renderYAxisTransitionIndicators(curvesData, 0);

    await sleep(400);

    // Phase 2: Morph baseline paths → desired paths (1200ms)
    const morphDuration = 1200;

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];

        // Create desired stroke + fill that start at baseline shape
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
        const basePathD = phasePointsToPath(blSmoothed, true);
        const desiredPathD = phasePointsToPath(dsSmoothed, true);
        const baseFillD = phasePointsToFillPath(blSmoothed, true);

        if (!basePathD || !desiredPathD) continue;

        const desiredSub = getEffectSubGroup(desiredGroup, i);

        // Desired fill
        const fillPath = svgEl('path', {
            d: baseFillD,
            fill: curve.color, 'fill-opacity': '0',
            class: 'phase-desired-fill',
        });
        desiredSub.appendChild(fillPath);
        fillPath.animate([{ fillOpacity: 0 }, { fillOpacity: 0.08 }], { duration: morphDuration, fill: 'forwards' });

        // Desired stroke — starts at baseline path, morphs to desired
        const strokePath = svgEl('path', {
            d: basePathD, fill: 'none', stroke: curve.color,
            class: 'phase-desired-path', opacity: '0',
        });
        desiredSub.appendChild(strokePath);
        strokePath.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });

        // Interpolate smoothed points for morph (matches rendered curve positions)
        const startTime = performance.now();
        (function animateMorph() {
            const t = Math.min(1, (performance.now() - startTime) / morphDuration);
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // Interpolate each smoothed point
            const morphedPoints: any[] = [];
            const len = Math.min(blSmoothed.length, dsSmoothed.length);
            for (let j = 0; j < len; j++) {
                morphedPoints.push({
                    hour: blSmoothed[j].hour,
                    value: blSmoothed[j].value + (dsSmoothed[j].value - blSmoothed[j].value) * ease,
                });
            }

            const morphPathD = phasePointsToPath(morphedPoints, true);
            const morphFillD = phasePointsToFillPath(morphedPoints, true);
            strokePath.setAttribute('d', morphPathD);
            fillPath.setAttribute('d', morphFillD);

            if (t < 1) requestAnimationFrame(animateMorph);
        })();
    }

    // Fade out baseline peak descriptors
    baseGroup.querySelectorAll('.peak-descriptor').forEach(el => {
        const fadeStart = performance.now();
        (function fadeOut() {
            const t = Math.min(1, (performance.now() - fadeStart) / 400);
            el.setAttribute('opacity', String(0.8 * (1 - t)));
            if (t < 1) requestAnimationFrame(fadeOut);
        })();
    });

    // Place peak descriptors on desired curves after morph settles
    await sleep(morphDuration + 200);

    // Place peak descriptors at each target curve's peak (batch for collision avoidance)
    placePeakDescriptors(desiredGroup, curvesData, 'desired', 0);
}

// ============================================
// Phase Chart: Legend
// ============================================

export function renderPhaseLegend(curvesData: any[], mode: string): void {
    // Legend removed — labels are now outside the chart (baseline/target below X-axis)
    const group = document.getElementById('phase-legend')!;
    group.innerHTML = '';
}

// ============================================
// Phase Chart: Error display
// ============================================

export function showPromptError(message: string): void {
    const hint = document.getElementById('prompt-hint');
    if (!hint) return;
    hint.textContent = message;
    hint.classList.add('error');
    hint.style.opacity = '1';
}

export function clearPromptError(): void {
    const hint = document.getElementById('prompt-hint');
    if (!hint) return;
    hint.textContent = 'e.g. "4 hours of deep focus, no sleep impact"';
    hint.classList.remove('error');
    hint.style.opacity = '';
}

// ============================================
// Phase Chart: Reset
// ============================================

export function resetPhaseChart(): void {
    cleanupBaselineEditor();
    cleanupDivider();
    ['phase-x-axis', 'phase-y-axis-left', 'phase-y-axis-right', 'phase-grid',
     'phase-scan-line', 'phase-word-cloud', 'phase-baseline-curves', 'phase-baseline-editor',
     'phase-desired-curves',
     'phase-lx-bands', 'phase-lx-curves', 'phase-lx-markers', 'phase-substance-timeline',
     'phase-biometric-strips', 'phase-mission-arrows', 'phase-yaxis-indicators',
     'phase-legend', 'phase-tooltip-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = '';
            el.classList.remove('revealed');
        }
    });
    const optimizeBtn = document.getElementById('phase-optimize-btn');
    if (optimizeBtn) {
        optimizeBtn.classList.remove('visible');
        optimizeBtn.classList.add('hidden');
    }
    const lxBtn = document.getElementById('phase-lx-btn');
    if (lxBtn) {
        lxBtn.classList.remove('visible');
        lxBtn.classList.add('hidden');
    }
    PhaseState.interventionPromise = null;
    PhaseState.interventionResult = null;
    PhaseState.lxCurves = null;
    PhaseState.wordCloudEffects = [];
    PhaseState.incrementalSnapshots = null;
    _resetDeps?.setWordCloudPositions([]);
    _resetDeps?.stopOrbitalRings();
    _resetDeps?.setOrbitalRingsState(null);

    // Remove any lingering substance step labels
    document.querySelectorAll('.substance-step-label').forEach(el => el.remove());
    document.querySelectorAll('.sequential-playhead').forEach(el => el.remove());

    // Clean up morph playhead and drag state
    _resetDeps?.cleanupMorphDrag();

    PhaseState.maxPhaseReached = -1;
    PhaseState.viewingPhase = -1;

    // Clear any inline opacity/transition/filter styles left by phase stepping
    ['phase-desired-curves', 'phase-mission-arrows', 'phase-yaxis-indicators', 'phase-lx-curves', 'phase-lx-markers'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.opacity = '';
            el.style.transition = '';
            el.style.filter = '';
        }
    });

    // Clear transmutation state (dashed desired curves)
    const desiredGroup = document.getElementById('phase-desired-curves');
    if (desiredGroup) {
        desiredGroup.querySelectorAll('.phase-desired-path').forEach(p => {
            p.removeAttribute('stroke-dasharray');
        });
    }

    // Clear substance timeline
    const timeline = document.getElementById('phase-substance-timeline');
    if (timeline) timeline.innerHTML = '';

    // Clean up timeline defs + restore viewBox
    const svg = document.getElementById('phase-chart-svg');
    if (svg) {
        svg.querySelectorAll('defs [id^="tl-grad-"], defs [id^="tl-clip-"], defs [id^="bio-clip-"], defs [id^="lx-band-clip-"]').forEach(el => el.remove());
        svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${PHASE_CHART.viewH}`);
    }

    // Reset scan lines and biometric state
    stopTimelineScanLine();
    stopBioScanLine();
    _resetDeps?.hideBiometricTrigger();
    const bioStripUI = document.getElementById('biometric-strip-ui');
    if (bioStripUI) {
        bioStripUI.classList.remove('visible');
        bioStripUI.classList.add('hidden');
    }
    if (_resetDeps?.BiometricState) {
        _resetDeps.BiometricState.selectedDevices = [];
        _resetDeps.BiometricState.profileText = '';
        _resetDeps.BiometricState.biometricResult = null;
        _resetDeps.BiometricState.channels = [];
        _resetDeps.BiometricState.phase = 'idle';
    }

    // Reset play buttons
    _resetDeps?.hideInterventionPlayButton();
    _resetDeps?.hideRevisionPlayButton();
    if (_resetDeps?.RevisionState) {
        _resetDeps.RevisionState.revisionPromise = null;
        _resetDeps.RevisionState.revisionResult = null;
        _resetDeps.RevisionState.oldInterventions = null;
        _resetDeps.RevisionState.newInterventions = null;
        _resetDeps.RevisionState.diff = null;
        _resetDeps.RevisionState.newLxCurves = null;
        _resetDeps.RevisionState.phase = 'idle';
    }
}
