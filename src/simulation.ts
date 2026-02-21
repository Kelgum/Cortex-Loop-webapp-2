import {
    CENTER, CHART, EFFECT_TYPES, TIMING_HOURS,
    CartridgeConfig, shortestAngleDelta,
} from './constants';
import { AppState } from './state';
import { svgEl, sleep, sanitizeId } from './utils';
import { resolveSubstance } from './substances';
import {
    computeCartridgeLayout, rebuildCapsuleLayers, ensureCategoryGradient,
} from './cartridge';
import { substanceEffectAt } from './lx-system';

export { substanceEffectAt } from './lx-system';

// ============================================
// 15b. EFFECT CHART RENDERER (for simulation — existing)
// ============================================

export function chartX(minutes) {
    return CHART.padL + ((minutes - CHART.startMin) / CHART.totalMin) * CHART.plotW;
}

export function chartY(effectVal) {
    const clamped = Math.max(-20, Math.min(CHART.maxEffect, effectVal));
    return CHART.padT + CHART.plotH - (clamped / CHART.maxEffect) * CHART.plotH;
}

/**
 * Compute all effect curves from a stack.
 * Returns { effectType: { label, color, points: [{min, val}] }, ... }
 */
export function computeEffectCurves(stack) {
    const curves = {};

    // Build dose events: {substanceKey, doseTimeMinutes, pharma}
    const doseEvents = [];
    for (const item of stack) {
        const sub = resolveSubstance(item.key, item);
        const doseHour = TIMING_HOURS[item.timing] || 8;
        const doseMin = doseHour * 60;
        const pharma = sub.pharma || { onset: 30, peak: 60, duration: 240, halfLife: 120, strength: 40, rebound: 0 };
        const count = item.count || 1;
        for (let c = 0; c < count; c++) {
            doseEvents.push({ key: item.key, substanceClass: sub.class || 'unknown', doseMin, pharma });
        }
    }

    // Group dose events by effect type
    for (const [typeName, typeInfo] of Object.entries(EFFECT_TYPES)) {
        const relevant = doseEvents.filter(d => ((typeInfo as any).classes || []).includes(d.substanceClass));
        if (relevant.length === 0) continue;

        const points = [];
        for (let m = CHART.startMin; m <= CHART.endMin; m += CHART.sampleInterval) {
            let totalEffect = CHART.baselineLevel;
            for (const dose of relevant) {
                totalEffect += substanceEffectAt(m - dose.doseMin, dose.pharma);
            }
            points.push({ min: m, val: Math.min(totalEffect, CHART.maxEffect) });
        }

        curves[typeName] = {
            label: typeName,
            color: (typeInfo as any).color,
            glow: (typeInfo as any).glow,
            points,
        };
    }

    return curves;
}

/**
 * Convert points array to a smooth SVG path using cubic bezier approximation.
 */
export function pointsToPath(points) {
    if (points.length < 2) return '';
    const coords = points.map(p => ({ x: chartX(p.min), y: chartY(p.val) }));

    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        const cpx = (prev.x + curr.x) / 2;
        d += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    return d;
}

/**
 * Convert points to a closed fill path (area under curve down to baseline).
 */
export function pointsToFillPath(points) {
    const pathD = pointsToPath(points);
    if (!pathD) return '';
    const lastX = chartX(points[points.length - 1].min);
    const firstX = chartX(points[0].min);
    const baseY = chartY(0);
    return pathD + ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
}

/**
 * Build the chart grid, axes, and labels.
 */
export function buildChartGrid() {
    const gridGroup = document.getElementById('chart-grid');
    const axesGroup = document.getElementById('chart-axes');
    const baselineGroup = document.getElementById('chart-baseline');
    gridGroup.innerHTML = '';
    axesGroup.innerHTML = '';
    baselineGroup.innerHTML = '';

    // Vertical grid lines (every 2 hours)
    for (let h = CHART.startHour; h <= CHART.endHour; h += 2) {
        const x = chartX(h * 60);
        gridGroup.appendChild(svgEl('line', {
            x1: x.toFixed(1), y1: String(CHART.padT),
            x2: x.toFixed(1), y2: String(CHART.padT + CHART.plotH),
            stroke: 'rgba(255,255,255,0.04)', 'stroke-width': '1',
        }));
        // Time labels
        const label = svgEl('text', {
            x: x.toFixed(1), y: String(CHART.padT + CHART.plotH + 18),
            fill: 'rgba(255,255,255,0.3)',
            'font-family': "'JetBrains Mono', monospace",
            'font-size': '8', 'text-anchor': 'middle',
        });
        label.textContent = `${String(h).padStart(2, '0')}:00`;
        axesGroup.appendChild(label);
    }

    // Horizontal grid lines (every 25% effect)
    for (let v = 0; v <= 100; v += 25) {
        const y = chartY(v);
        gridGroup.appendChild(svgEl('line', {
            x1: String(CHART.padL), y1: y.toFixed(1),
            x2: String(CHART.padL + CHART.plotW), y2: y.toFixed(1),
            stroke: 'rgba(255,255,255,0.03)', 'stroke-width': '1',
        }));
        if (v > 0) {
            const label = svgEl('text', {
                x: String(CHART.padL - 8), y: (y + 3).toFixed(1),
                fill: 'rgba(255,255,255,0.2)',
                'font-family': "'JetBrains Mono', monospace",
                'font-size': '7', 'text-anchor': 'end',
            });
            label.textContent = String(v);
            axesGroup.appendChild(label);
        }
    }

    // Baseline reference line
    const blY = chartY(CHART.baselineLevel);
    baselineGroup.appendChild(svgEl('line', {
        x1: String(CHART.padL), y1: blY.toFixed(1),
        x2: String(CHART.padL + CHART.plotW), y2: blY.toFixed(1),
        stroke: 'rgba(255,255,255,0.12)', 'stroke-width': '1',
        'stroke-dasharray': '4 4',
    }));
    const blLabel = svgEl('text', {
        x: String(CHART.padL - 8), y: (blY + 3).toFixed(1),
        fill: 'rgba(255,255,255,0.25)',
        'font-family': "'JetBrains Mono', monospace",
        'font-size': '7', 'text-anchor': 'end',
    });
    blLabel.textContent = 'base';
    axesGroup.appendChild(blLabel);

    // Axes lines
    axesGroup.appendChild(svgEl('line', {
        x1: String(CHART.padL), y1: String(CHART.padT),
        x2: String(CHART.padL), y2: String(CHART.padT + CHART.plotH),
        stroke: 'rgba(255,255,255,0.1)', 'stroke-width': '1',
    }));
    axesGroup.appendChild(svgEl('line', {
        x1: String(CHART.padL), y1: String(CHART.padT + CHART.plotH),
        x2: String(CHART.padL + CHART.plotW), y2: String(CHART.padT + CHART.plotH),
        stroke: 'rgba(255,255,255,0.1)', 'stroke-width': '1',
    }));

    // Y-axis label
    const yLabel = svgEl('text', {
        x: '14', y: String(CHART.padT + CHART.plotH / 2),
        fill: 'rgba(255,255,255,0.2)',
        'font-family': "'Inter', sans-serif",
        'font-size': '8', 'text-anchor': 'middle',
        transform: `rotate(-90, 14, ${CHART.padT + CHART.plotH / 2})`,
    });
    yLabel.textContent = 'Effect';
    axesGroup.appendChild(yLabel);

    // X-axis label
    const xLabel = svgEl('text', {
        x: String(CHART.padL + CHART.plotW / 2), y: String(CHART.viewH - 6),
        fill: 'rgba(255,255,255,0.2)',
        'font-family': "'Inter', sans-serif",
        'font-size': '8', 'text-anchor': 'middle',
    });
    xLabel.textContent = 'Time of Day';
    axesGroup.appendChild(xLabel);
}

/**
 * Render effect curves onto the chart.
 */
export function renderEffectCurves(curves) {
    const curvesGroup = document.getElementById('chart-curves');
    const legendGroup = document.getElementById('chart-legend');
    curvesGroup.innerHTML = '';
    legendGroup.innerHTML = '';

    let legendIdx = 0;
    for (const [typeName, curve] of Object.entries(curves)) {
        // Area fill
        const fillPath = svgEl('path', {
            d: pointsToFillPath((curve as any).points),
            fill: (curve as any).color,
            'fill-opacity': '0.08',
            'clip-path': 'none',
        });
        curvesGroup.appendChild(fillPath);

        // Stroke line
        const strokePath = svgEl('path', {
            d: pointsToPath((curve as any).points),
            fill: 'none',
            stroke: (curve as any).color,
            'stroke-width': '2',
            'stroke-opacity': '0.8',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
        });

        // Animate line drawing
        const totalLength = strokePath.getTotalLength ? 0 : 1000; // will set after append
        curvesGroup.appendChild(strokePath);

        // Set up clip for simulation progressive reveal
        strokePath.dataset.effectType = typeName;
        fillPath.dataset.effectType = typeName;

        // Legend entry
        const lx = CHART.padL + CHART.plotW - 10;
        const ly = CHART.padT + 12 + legendIdx * 16;

        const legendDot = svgEl('circle', {
            cx: String(lx), cy: String(ly),
            r: '3', fill: (curve as any).color,
        });
        legendGroup.appendChild(legendDot);

        const legendText = svgEl('text', {
            x: String(lx - 8), y: String(ly + 3),
            fill: (curve as any).color,
            'font-family': "'Inter', sans-serif",
            'font-size': '8', 'font-weight': '500',
            'text-anchor': 'end', 'fill-opacity': '0.8',
        });
        legendText.textContent = typeName;
        legendGroup.appendChild(legendText);

        legendIdx++;
    }
}

/**
 * Build and display the full effect chart for a stack.
 */
export function buildEffectChart(stack) {
    buildChartGrid();
    const curves = computeEffectCurves(stack);
    renderEffectCurves(curves);

    // Store curves for simulation use
    AppState.effectCurves = curves;

    return curves;
}

/**
 * Show/hide the chart panel with animation.
 */
export function showChartPanel() {
    const section = document.getElementById('cartridge-section');
    const panel = document.getElementById('effect-chart-panel');
    section.classList.add('split-view');
    // Force reflow before adding visible class for transition
    panel.offsetHeight;
    panel.style.display = 'block';
    requestAnimationFrame(() => {
        panel.classList.add('visible');
    });
}

export function hideChartPanel() {
    const section = document.getElementById('cartridge-section');
    const panel = document.getElementById('effect-chart-panel');
    panel.classList.remove('visible');
    setTimeout(() => {
        section.classList.remove('split-view');
        panel.style.display = 'none';
    }, 600);
}

// ============================================
// 16. PLAY BUTTON
// ============================================

export function showPlayButton() {
    const hub = document.getElementById('center-hub');
    // Remove existing play button if any
    const existing = hub.querySelector('.play-btn-group');
    if (existing) existing.remove();

    const hubText = document.getElementById('hub-text');
    if (hubText) hubText.setAttribute('opacity', '0');

    const g = svgEl('g', { class: 'play-btn-group' });

    // Pulse ring
    const pulse = svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '42',
        fill: 'none', stroke: 'rgba(160,160,255,0.25)', 'stroke-width': '1.5',
        class: 'play-pulse-ring',
    });
    g.appendChild(pulse);

    // Background circle
    const bg = svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '38',
        class: 'play-btn-bg',
    });
    g.appendChild(bg);

    // Play triangle (right-facing, centered at CENTER)
    const triSize = 16;
    const x1 = CENTER - triSize * 0.4;
    const y1 = CENTER - triSize;
    const x2 = CENTER + triSize * 0.8;
    const y2 = CENTER;
    const x3 = CENTER - triSize * 0.4;
    const y3 = CENTER + triSize;

    const tri = svgEl('polygon', {
        points: `${x1},${y1} ${x2},${y2} ${x3},${y3}`,
        class: 'play-btn-icon',
    });
    g.appendChild(tri);

    g.addEventListener('click', () => {
        startSimulation();
    });

    hub.appendChild(g);
}

export function hidePlayButton() {
    const hub = document.getElementById('center-hub');
    const btn = hub.querySelector('.play-btn-group');
    if (btn) {
        btn.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        setTimeout(() => btn.remove(), 200);
    }
}

// ============================================
// 17. CAPSULE WHEEL ROTATION (JS-animated SVG)
// ============================================

/**
 * Set the capsule wheel rotation instantly (no animation).
 * Uses SVG transform attribute with rotate(deg, cx, cy) which
 * always rotates around the SVG viewBox center — immune to CSS scaling issues.
 */
export function setWheelRotation(deg) {
    const wheel = document.getElementById('capsule-wheel');
    if (wheel) {
        wheel.setAttribute('transform', `rotate(${deg.toFixed(2)}, ${CENTER}, ${CENTER})`);
    }
}

/**
 * Animate the capsule wheel from its current rotation to a target rotation.
 * Returns a promise that resolves when done.
 */
export function animateWheelRotation(fromDeg, toDeg, durationMs = 800) {
    return new Promise<void>(resolve => {
        const wheel = document.getElementById('capsule-wheel');
        if (!wheel) { resolve(); return; }

        const startTime = performance.now();

        function tick(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / durationMs, 1);
            // Cubic ease-out
            const eased = 1 - Math.pow(1 - t, 3);
            const current = fromDeg + (toDeg - fromDeg) * eased;
            wheel.setAttribute('transform', `rotate(${current.toFixed(2)}, ${CENTER}, ${CENTER})`);

            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(tick);
    });
}

// ============================================
// 18. PROTOCOL SIMULATION ENGINE
// ============================================

export const Simulation = {
    isPlaying: false,
    currentTimeMin: 0,
    endTimeMin: 24 * 60,
    startTimeMin: 6 * 60,
    speed: 60 / 3,
    animFrameId: null as number | null,
    lastTimestamp: 0,
    doseEvents: [] as any[],
    nextDoseIdx: 0,
    wheelRotation: 0,
    isPausedForDose: false,
};

/**
 * Build dose events from the current stack, mapped to front-layer capsule slots.
 */
export function buildDoseEvents(stack) {
    const events = [];
    const groups = CartridgeConfig.capsuleGroups;

    for (let i = 0; i < groups.length; i++) {
        const capsule = groups[i];
        if (!capsule.isToday) continue;  // Only simulate day 1

        const sub = resolveSubstance(capsule.key, capsule);
        const doseHour = TIMING_HOURS[capsule.timing] || 8;
        const doseMin = doseHour * 60;

        events.push({
            timeMin: doseMin,
            key: capsule.key,
            dose: capsule.dose,
            timing: capsule.timing,
            globalSlot: capsule.globalSlot,
            substance: sub,
            dispensed: false,
        });
    }

    // Sort by time
    events.sort((a, b) => a.timeMin - b.timeMin);
    return events;
}

/**
 * Start the protocol simulation.
 */
export async function startSimulation() {
    if (Simulation.isPlaying) return;
    if (!AppState.currentStack) return;

    Simulation.isPlaying = true;
    Simulation.currentTimeMin = Simulation.startTimeMin;
    Simulation.nextDoseIdx = 0;
    Simulation.isPausedForDose = false;
    Simulation.wheelRotation = 0;

    hidePlayButton();

    // Restore capsules if this is a replay
    setWheelRotation(0);

    // Rebuild capsule layers to restore any dispensed capsules
    const stack = AppState.currentStack;
    const layout = computeCartridgeLayout(stack);
    CartridgeConfig.recalculate(layout.capsulesPerLayer);
    CartridgeConfig.capsuleGroups = layout.capsuleGroups;
    rebuildCapsuleLayers();

    // Quick refill without the slow animation
    const groups = CartridgeConfig.capsuleGroups;
    for (let i = 0; i < groups.length; i++) {
        const capsule = groups[i];
        const substance = resolveSubstance(capsule.key, capsule);
        if (!substance) continue;
        ensureCategoryGradient(substance.class || 'unknown');

        let layerKey, capsuleIndex;
        if (capsule.globalSlot < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = capsule.globalSlot;
        } else {
            layerKey = 'back';
            capsuleIndex = capsule.globalSlot - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (!capsuleGroup) continue;

        const fillRect = capsuleGroup.querySelector('.capsule-fill');
        const outlineRect = capsuleGroup.querySelector('.capsule-outline');
        const targetOpacity = capsule.isToday ? 1 : 0.25;

        fillRect.setAttribute('fill', `url(#grad-${sanitizeId(substance.class || 'unknown')})`);
        fillRect.setAttribute('opacity', String(targetOpacity));

        if (capsule.isToday) {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-width', '2');
            if (layerKey === 'front') {
                capsuleGroup.setAttribute('filter', 'url(#capsule-glow)');
            }
        } else {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-opacity', '0.2');
            outlineRect.setAttribute('stroke-width', '1');
            capsuleGroup.classList.add('dimmed');
        }

        capsuleGroup.classList.add('filled');
        capsuleGroup.dataset.substance = capsule.key;
        capsuleGroup.dataset.dose = capsule.dose;
        capsuleGroup.dataset.timing = capsule.timing;
        capsuleGroup.dataset.day = String(capsule.dayIndex + 1);
        AppState.filledSlots.set(capsule.globalSlot, capsule.key);
    }

    Simulation.doseEvents = buildDoseEvents(AppState.currentStack);

    // Clear previous dose markers
    const markersGroup = document.getElementById('chart-dose-markers');
    markersGroup.innerHTML = '';

    // Create time cursor on chart
    const cursorGroup = document.getElementById('chart-cursor');
    cursorGroup.innerHTML = '';

    const cursorLine = svgEl('line', {
        x1: String(chartX(Simulation.startTimeMin)),
        y1: String(CHART.padT),
        x2: String(chartX(Simulation.startTimeMin)),
        y2: String(CHART.padT + CHART.plotH),
        class: 'chart-cursor-line',
        id: 'sim-cursor-line',
    });
    cursorGroup.appendChild(cursorLine);

    const cursorDot = svgEl('circle', {
        cx: String(chartX(Simulation.startTimeMin)),
        cy: String(CHART.padT - 6),
        r: '4',
        class: 'chart-cursor-dot',
        id: 'sim-cursor-dot',
    });
    cursorGroup.appendChild(cursorDot);

    const cursorTime = svgEl('text', {
        x: String(chartX(Simulation.startTimeMin)),
        y: String(CHART.padT - 14),
        class: 'chart-cursor-time',
        id: 'sim-cursor-time',
        'text-anchor': 'middle',
    });
    cursorTime.textContent = '06:00';
    cursorGroup.appendChild(cursorTime);

    // Show time in hub
    updateSimHubTime(Simulation.currentTimeMin);

    // Set up clip paths for progressive curve reveal
    setupProgressiveReveal();

    Simulation.lastTimestamp = performance.now();
    Simulation.animFrameId = requestAnimationFrame(simulationTick);
}

/**
 * Set up clip rectangles to progressively reveal curves.
 */
export function setupProgressiveReveal() {
    const svg = document.getElementById('effect-chart-svg');
    let clipDef = svg.querySelector('#sim-clip-rect');
    if (!clipDef) {
        const defs = svg.querySelector('defs');
        const clipPath = svgEl('clipPath', { id: 'sim-reveal-clip' });
        const rect = svgEl('rect', {
            id: 'sim-clip-rect',
            x: String(CHART.padL), y: '0',
            width: '0', height: String(CHART.viewH),
        });
        clipPath.appendChild(rect);
        defs.appendChild(clipPath);
    }

    const curvesGroup = document.getElementById('chart-curves');
    curvesGroup.setAttribute('clip-path', 'url(#sim-reveal-clip)');

    // Reset clip to start position
    const rect = svg.querySelector('#sim-clip-rect');
    rect.setAttribute('width', String(chartX(Simulation.startTimeMin) - CHART.padL));
}

/**
 * Main simulation tick driven by requestAnimationFrame.
 */
export function simulationTick(timestamp) {
    if (!Simulation.isPlaying) return;

    const deltaMs = timestamp - Simulation.lastTimestamp;
    Simulation.lastTimestamp = timestamp;

    if (Simulation.isPausedForDose) {
        Simulation.animFrameId = requestAnimationFrame(simulationTick);
        return;
    }

    // Advance time
    const deltaMin = (deltaMs / 1000) * Simulation.speed;
    Simulation.currentTimeMin += deltaMin;

    if (Simulation.currentTimeMin >= Simulation.endTimeMin) {
        Simulation.currentTimeMin = Simulation.endTimeMin;
        updateCursorPosition(Simulation.currentTimeMin);
        updateClipReveal(Simulation.currentTimeMin);
        endSimulation();
        return;
    }

    updateCursorPosition(Simulation.currentTimeMin);
    updateClipReveal(Simulation.currentTimeMin);
    updateSimHubTime(Simulation.currentTimeMin);

    // Check for dose events
    while (Simulation.nextDoseIdx < Simulation.doseEvents.length) {
        const dose = Simulation.doseEvents[Simulation.nextDoseIdx];
        if (dose.timeMin <= Simulation.currentTimeMin && !dose.dispensed) {
            // Collect all doses at the same time
            const simultaneousDoses = [];
            while (
                Simulation.nextDoseIdx < Simulation.doseEvents.length &&
                Simulation.doseEvents[Simulation.nextDoseIdx].timeMin <= Simulation.currentTimeMin &&
                !Simulation.doseEvents[Simulation.nextDoseIdx].dispensed
            ) {
                simultaneousDoses.push(Simulation.doseEvents[Simulation.nextDoseIdx]);
                Simulation.nextDoseIdx++;
            }
            dispenseCapsules(simultaneousDoses);
            break;
        } else {
            break;
        }
    }

    Simulation.animFrameId = requestAnimationFrame(simulationTick);
}

export function updateCursorPosition(timeMin) {
    const x = chartX(timeMin);
    const line = document.getElementById('sim-cursor-line');
    const dot = document.getElementById('sim-cursor-dot');
    const timeText = document.getElementById('sim-cursor-time');

    if (line) {
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('x2', x.toFixed(1));
    }
    if (dot) dot.setAttribute('cx', x.toFixed(1));
    if (timeText) {
        timeText.setAttribute('x', x.toFixed(1));
        const hours = Math.floor(timeMin / 60);
        const mins = Math.floor(timeMin % 60);
        timeText.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
}

export function updateClipReveal(timeMin) {
    const rect = document.querySelector('#sim-clip-rect');
    if (rect) {
        const width = chartX(timeMin) - CHART.padL;
        rect.setAttribute('width', String(Math.max(0, width)));
    }
}

export function updateSimHubTime(timeMin) {
    const hubText = document.getElementById('hub-text');
    if (!hubText) return;
    hubText.setAttribute('opacity', '1');
    hubText.setAttribute('fill', 'rgba(160,160,255,0.7)');
    hubText.setAttribute('font-size', '14');
    const hours = Math.floor(timeMin / 60);
    const mins = Math.floor(timeMin % 60);
    hubText.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Rotate the capsule wheel and dispense capsules.
 */
export async function dispenseCapsules(doses) {
    Simulation.isPausedForDose = true;

    for (const dose of doses) {
        // Calculate the angular position of this capsule
        const slotIndex = dose.globalSlot;
        let capsuleAngle;
        if (slotIndex < CartridgeConfig.capsulesPerLayer) {
            capsuleAngle = -90 + slotIndex * CartridgeConfig.angularSpacing;
        } else {
            capsuleAngle = -90 + CartridgeConfig.halfSpacing + (slotIndex - CartridgeConfig.capsulesPerLayer) * CartridgeConfig.angularSpacing;
        }

        // Rotate wheel so this capsule goes to 12 o'clock (-90°)
        // Target: capsuleAngle + wheelRotation = -90 (mod 360)
        const targetRotation = -capsuleAngle - 90;
        // Use shortestAngleDelta for shortest CW/CCW path
        const delta = shortestAngleDelta(Simulation.wheelRotation, targetRotation);
        const prevRotation = Simulation.wheelRotation;
        // Accumulate without normalizing — allows angles beyond 360° so
        // animateWheelRotation always interpolates the short way around
        Simulation.wheelRotation += delta;
        await animateWheelRotation(prevRotation, Simulation.wheelRotation, 800);

        // Dispensation animation
        let layerKey, capsuleIndex;
        if (slotIndex < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = slotIndex;
        } else {
            layerKey = 'back';
            capsuleIndex = slotIndex - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (capsuleGroup) {
            // Pulse bright
            const fillRect = capsuleGroup.querySelector('.capsule-fill');
            const color = dose.substance.color;

            fillRect.animate([
                { filter: 'brightness(1)', transform: 'scale(1) translateY(0)' },
                { filter: 'brightness(2)', transform: 'scale(1.3) translateY(-5px)' },
                { filter: 'brightness(1.5)', transform: 'scale(1.1) translateY(-20px)', opacity: '0.8' },
                { filter: 'brightness(0.5)', transform: 'scale(0.3) translateY(-50px)', opacity: '0' },
            ], {
                duration: 800,
                easing: 'ease-out',
                fill: 'forwards',
            });

            // Spawn particles
            spawnDispenseParticles(capsuleGroup, color);

            // Add dose marker on chart
            addDoseMarker(dose);
        }

        dose.dispensed = true;
        await sleep(600);
    }

    Simulation.isPausedForDose = false;
}

/**
 * Spawn dissolving particle effects from a capsule position.
 */
export function spawnDispenseParticles(capsuleGroup, color) {
    const svg = document.getElementById('cartridge-svg');
    const transform = capsuleGroup.getAttribute('transform');
    // Extract translate coordinates from the capsule group
    const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
    if (!match) return;
    const cx = parseFloat(match[1]);
    const cy = parseFloat(match[2]);

    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5;
        const dist = 20 + Math.random() * 40;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - 30; // Bias upward
        const r = 2 + Math.random() * 3;
        const dur = 600 + Math.random() * 400;

        const particle = svgEl('circle', {
            cx: String(cx), cy: String(cy),
            r: String(r),
            fill: color,
            opacity: '0',
        });
        svg.appendChild(particle);

        // Use SMIL-style animation via animate elements
        const animCx = svgEl('animate', {
            attributeName: 'cx',
            from: String(cx), to: String(cx + dx),
            dur: `${dur}ms`, fill: 'freeze',
        });
        const animCy = svgEl('animate', {
            attributeName: 'cy',
            from: String(cy), to: String(cy + dy),
            dur: `${dur}ms`, fill: 'freeze',
        });
        const animOp = svgEl('animate', {
            attributeName: 'opacity',
            from: '0.7', to: '0',
            dur: `${dur}ms`, fill: 'freeze',
        });
        const animR = svgEl('animate', {
            attributeName: 'r',
            from: String(r), to: '0.5',
            dur: `${dur}ms`, fill: 'freeze',
        });

        particle.appendChild(animCx);
        particle.appendChild(animCy);
        particle.appendChild(animOp);
        particle.appendChild(animR);

        // Trigger animations
        particle.setAttribute('opacity', '0.7');

        setTimeout(() => particle.remove(), dur + 100);
    }
}

/**
 * Add a dose marker dot on the chart timeline.
 */
export function addDoseMarker(dose) {
    const markersGroup = document.getElementById('chart-dose-markers');
    const x = chartX(dose.timeMin);
    const baseY = chartY(0);

    // Vertical marker line
    const line = svgEl('line', {
        x1: x.toFixed(1), y1: String(CHART.padT),
        x2: x.toFixed(1), y2: String(CHART.padT + CHART.plotH),
        stroke: dose.substance.color,
        'stroke-width': '1',
        'stroke-opacity': '0.25',
        'stroke-dasharray': '2 4',
    });
    markersGroup.appendChild(line);

    // Substance dot
    const dot = svgEl('circle', {
        cx: x.toFixed(1), cy: String(CHART.padT + CHART.plotH + 6),
        r: '3', fill: dose.substance.color, opacity: '0',
    });
    markersGroup.appendChild(dot);
    dot.animate([{ opacity: 0, r: 0 }, { opacity: 0.8, r: 3 }], {
        duration: 300, fill: 'forwards',
    });

    // Tiny label
    const label = svgEl('text', {
        x: x.toFixed(1), y: String(CHART.padT + CHART.plotH + 28),
        fill: dose.substance.color,
        'font-family': "'JetBrains Mono', monospace",
        'font-size': '6', 'text-anchor': 'middle',
        'fill-opacity': '0.6',
    });
    label.textContent = dose.substance.name.length > 8
        ? dose.substance.name.substring(0, 8) + '.'
        : dose.substance.name;
    markersGroup.appendChild(label);
}

/**
 * End the simulation — show completion state and replay button.
 */
export function endSimulation() {
    Simulation.isPlaying = false;
    if (Simulation.animFrameId) {
        cancelAnimationFrame(Simulation.animFrameId);
        Simulation.animFrameId = null;
    }

    // Show "COMPLETE" in hub briefly, then show play button for replay
    const hubText = document.getElementById('hub-text');
    if (hubText) {
        hubText.textContent = 'COMPLETE';
        hubText.setAttribute('fill', 'rgba(160,160,255,0.5)');
        hubText.setAttribute('font-size', '10');
    }

    // Remove clip from curves to show full chart
    const curvesGroup = document.getElementById('chart-curves');
    curvesGroup.removeAttribute('clip-path');

    setTimeout(() => {
        showPlayButton();
    }, 1500);
}

/**
 * Reset the simulation state and restore capsules.
 */
export function resetSimulation() {
    Simulation.isPlaying = false;
    if (Simulation.animFrameId) {
        cancelAnimationFrame(Simulation.animFrameId);
        Simulation.animFrameId = null;
    }
    Simulation.wheelRotation = 0;
    setWheelRotation(0);

    // Clear simulation UI
    const cursorGroup = document.getElementById('chart-cursor');
    if (cursorGroup) cursorGroup.innerHTML = '';
    const markersGroup = document.getElementById('chart-dose-markers');
    if (markersGroup) markersGroup.innerHTML = '';

    // Remove clip
    const curvesGroup = document.getElementById('chart-curves');
    if (curvesGroup) curvesGroup.removeAttribute('clip-path');
}

// ============================================
// 19. TOOLTIP SYSTEM
// ============================================

export function initTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'capsule-tooltip';
    tooltip.innerHTML = `
        <div class="tooltip-name"></div>
        <div class="tooltip-detail"></div>
        <div class="tooltip-warning"></div>
    `;
    document.body.appendChild(tooltip);
    AppState.tooltip = tooltip;

    const svg = document.getElementById('cartridge-svg');

    svg.addEventListener('mousemove', (e) => {
        const capsule = (e.target as Element).closest('.capsule-group.filled');
        if (capsule) {
            const key = (capsule as HTMLElement).dataset.substance;
            const substance = resolveSubstance(key, {});
            if (!substance) return;

            tooltip.querySelector('.tooltip-name').textContent = substance.name;
            (tooltip.querySelector('.tooltip-name') as HTMLElement).style.color = substance.color;

            const classLabel = substance.class || '';
            const doseLabel = substance.standardDose || (capsule as HTMLElement).dataset.dose || '';
            const dayLabel = (capsule as HTMLElement).dataset.day ? `Day ${(capsule as HTMLElement).dataset.day}` : '';
            const parts = [classLabel, doseLabel, (capsule as HTMLElement).dataset.timing, dayLabel].filter(Boolean);
            tooltip.querySelector('.tooltip-detail').textContent = parts.join(' · ');

            // Data confidence warning
            const warningEl = tooltip.querySelector('.tooltip-warning') as HTMLElement;
            const conf = (substance.dataConfidence || '').toLowerCase();
            if (conf === 'estimated' || conf === 'medium') {
                warningEl.textContent = `\u26A0\uFE0F ${substance.dataNote || 'Clinical estimation'}`;
                warningEl.style.display = '';
            } else {
                warningEl.textContent = '';
                warningEl.style.display = 'none';
            }

            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY - 10}px`;
            tooltip.classList.add('visible');
        } else {
            tooltip.classList.remove('visible');
        }
    });

    svg.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
    });
}
