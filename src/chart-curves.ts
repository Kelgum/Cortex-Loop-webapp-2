/**
 * Chart Curves — Baseline/desired curve SVG rendering, morph animations, peak descriptor labels, and phase legend.
 * Exports: renderBaselineCurves, renderBaselineCurvesInstant, morphToDesiredCurves, renderPhaseLegend, placePeakDescriptors
 * Depends on: constants (PHASE_CHART), state (DividerState), utils, curve-utils, divider, baseline-editor, chart-axes
 */
import { PHASE_CHART, PHASE_SMOOTH_PASSES } from './constants';
import { DividerState, isTurboActive } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY, sleep } from './utils';
import {
    smoothPhaseValues,
    phasePointsToPath,
    phasePointsToFillPath,
    findCurvePeak,
    findCurveTrough,
    nearestLevel,
    findMaxDivergence,
} from './curve-utils';
import { getEffectSubGroup, activateDivider, cleanupDivider } from './divider';
import { activateBaselineEditor, cleanupBaselineEditor } from './baseline-editor';
import { getChartLevelDesc, renderYAxisTransitionIndicators } from './chart-axes';

// ============================================
// Phase Chart: Bullseye — persistent marker at the desired curve's max-divergence point
// ============================================

/**
 * Place the 🎯 at the tip of the baseline→desired arrow (max divergence point).
 * Anchor coords are stored as data-attributes so repositionBullseye() can
 * adjust for label overlap without needing curvesData again.
 */
export function placeBullseye(curvesData: any[]): void {
    const svgRoot = document.getElementById('phase-chart-svg');
    if (!svgRoot) return;

    svgRoot.querySelectorAll('.bullseye-emoji').forEach(el => el.remove());

    const curve = curvesData?.[0];
    if (!curve?.desired?.length) return;

    // Anchor = max divergence point (same point the arrow targets)
    const div = findMaxDivergence(curve);
    if (!div) return;

    const px = phaseChartX(div.hour * 60);
    const restY = phaseChartY(div.value) - 18; // snug above the curve

    const bullseye = svgEl('text', {
        x: px.toFixed(1),
        y: restY.toFixed(1),
        class: 'bullseye-emoji',
        'font-size': '27',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'data-rest-y': restY.toFixed(1),
        'data-anchor-x': px.toFixed(1),
    });
    bullseye.textContent = '\u{1F3AF}';
    svgRoot.appendChild(bullseye);

    // Immediately adjust for any existing labels
    repositionBullseye();
}

/**
 * Re-evaluate the bullseye Y position relative to current peak-descriptor labels.
 * If a label overlaps, slide above it; otherwise return to rest position on the curve.
 * Called after every placePeakDescriptors so the bullseye reacts to label changes.
 */
export function repositionBullseye(): void {
    const svgRoot = document.getElementById('phase-chart-svg');
    if (!svgRoot) return;
    const bullseye = svgRoot.querySelector('.bullseye-emoji') as SVGElement | null;
    if (!bullseye) return;

    const px = parseFloat(bullseye.getAttribute('data-anchor-x') || '0');
    const restY = parseFloat(bullseye.getAttribute('data-rest-y') || '0');

    let y = restY;
    const emojiHalfW = 14;

    svgRoot.querySelectorAll('.peak-descriptor').forEach(desc => {
        const backdrop = desc.querySelector('rect');
        if (!backdrop) return;
        const rx = parseFloat(backdrop.getAttribute('x') || '0');
        const rw = parseFloat(backdrop.getAttribute('width') || '0');
        const ry = parseFloat(backdrop.getAttribute('y') || '0');

        // Horizontal overlap?
        if (px + emojiHalfW > rx && px - emojiHalfW < rx + rw) {
            // Would the bullseye overlap the label?
            if (y + 14 > ry) {
                y = ry - 16;
            }
        }
    });

    y = Math.max(PHASE_CHART.padT + 2, y);
    bullseye.setAttribute('y', y.toFixed(1));
}

// ============================================
// Phase Chart: Peak Descriptor Labels
// ============================================

export function placePeakDescriptors(group: Element, curvesData: any[], pointsKey: string, baseDelay: number): void {
    // Clear any existing peak descriptors to prevent label stacking
    // (multiple call-sites may invoke this on the same group during the pipeline)
    group.querySelectorAll('.peak-descriptor').forEach(el => el.remove());

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
                    Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a,
                );
                keyPoint = { hour: match.hour, value: match.value };
            } else {
                // Target value at divergence time (already in div)
                keyPoint = div;
            }
        } else {
            // Fallback if no divergence data
            keyPoint = isBaseline ? findCurveTrough(curve[pointsKey]) : findCurvePeak(curve[pointsKey]);
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
    // High values (low py) -> label above; Low values (high py) -> label below
    for (const item of items) {
        const isHighValue = item.peakVal >= 50;
        item.labelY = isHighValue ? item.py - 14 : item.py + 18;
    }

    // Collision avoidance for 2 labels
    if (items.length === 2) {
        const dx = Math.abs(items[0].px - items[1].px);
        const dy = Math.abs(items[0].labelY - items[1].labelY);
        // Estimate text width ~7px per char
        const w0 = (items[0].descriptor.length * 7) / 2;
        const w1 = (items[1].descriptor.length * 7) / 2;
        const xOverlap = dx < w0 + w1 + 10;
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
        const pillPadX = 8,
            pillPadY = 4;
        const pillW = estTextW + pillPadX * 2;
        const pillH = 16 + pillPadY * 2;

        // Container group for backdrop + text
        const labelGroup = svgEl('g', {
            class: 'peak-descriptor',
            opacity: '0',
            'data-effect-idx': String(curveIdx),
        });

        // Backdrop pill
        const backdrop = svgEl('rect', {
            x: (px - pillW / 2).toFixed(1),
            y: (labelY - pillH / 2 - 2).toFixed(1),
            width: pillW.toFixed(1),
            height: pillH.toFixed(1),
            rx: '6',
            ry: '6',
            fill: dt.tooltipBg,
        });
        labelGroup.appendChild(backdrop);

        const label = svgEl('text', {
            x: px.toFixed(1),
            y: (labelY + 1).toFixed(1),
            fill: curve.color,
            'font-family': "'Space Grotesk', sans-serif",
            'font-size': '11',
            'font-weight': '600',
            'text-anchor': 'middle',
            'letter-spacing': '0.03em',
            'dominant-baseline': 'middle',
        });
        label.textContent = descriptor;
        labelGroup.appendChild(label);

        // Append to per-effect sub-group if divider is active, otherwise to parent
        const targetGroup = DividerState.active && curvesData.length >= 2 ? getEffectSubGroup(group, curveIdx) : group;
        targetGroup.appendChild(labelGroup);

        if (isTurboActive()) {
            labelGroup.setAttribute('opacity', '0.85');
        } else {
            const startTime = performance.now();
            (function fadeIn() {
                const elapsed = performance.now() - startTime;
                if (elapsed < delayMs) {
                    requestAnimationFrame(fadeIn);
                    return;
                }
                const t = Math.min(1, (elapsed - delayMs) / 500);
                const ease = 1 - Math.pow(1 - t, 3);
                labelGroup.setAttribute('opacity', String(0.85 * ease));
                if (t < 1) requestAnimationFrame(fadeIn);
            })();
        }
    }

    // Reposition bullseye relative to newly-placed (or removed) labels
    repositionBullseye();
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
            fill: curve.color,
            'fill-opacity': '0', // animate in
        });
        sub.appendChild(fillPath);

        // Dashed stroke
        const strokePath = svgEl('path', {
            d: pathD,
            fill: 'none',
            stroke: curve.color,
            class: 'phase-baseline-path',
            opacity: '0',
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

/** Instant baseline curves — no animation, used after ring->curve morph */
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
            fill: curve.color,
            'fill-opacity': '0.04',
        });
        sub.appendChild(fillPath);

        const strokePath = svgEl('path', {
            d: pathD,
            fill: 'none',
            stroke: curve.color,
            class: 'phase-baseline-path',
            opacity: '0.5',
        });
        sub.appendChild(strokePath);
    }

    // Activate interactive baseline editor (replaces static peak descriptors)
    activateBaselineEditor(curvesData);

    // Activate split-screen divider for 2-effect mode
    activateDivider(curvesData);
}

// ============================================
// Phase Chart: Morph baseline -> desired with arrows
// ============================================

export async function morphToDesiredCurves(curvesData: any[]): Promise<void> {
    const baseGroup = document.getElementById('phase-baseline-curves')!;
    const desiredGroup = document.getElementById('phase-desired-curves')!;
    const arrowGroup = document.getElementById('phase-mission-arrows')!;
    desiredGroup.innerHTML = '';
    arrowGroup.innerHTML = '';

    // Turbo: jump to final desired state instantly
    if (isTurboActive()) {
        for (let i = 0; i < curvesData.length; i++) {
            const curve = curvesData[i];
            const dsSmoothed = smoothPhaseValues(curve.desired, PHASE_SMOOTH_PASSES);
            const desiredPathD = phasePointsToPath(dsSmoothed, true);
            const desiredFillD = phasePointsToFillPath(dsSmoothed, true);
            if (!desiredPathD) continue;
            const desiredSub = getEffectSubGroup(desiredGroup, i);
            desiredSub.appendChild(
                svgEl('path', {
                    d: desiredFillD,
                    fill: curve.color,
                    'fill-opacity': '0.08',
                    class: 'phase-desired-fill',
                }),
            );
            desiredSub.appendChild(
                svgEl('path', {
                    d: desiredPathD,
                    fill: 'none',
                    stroke: curve.color,
                    class: 'phase-desired-path',
                    opacity: '1',
                }),
            );
        }
        baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.setAttribute('opacity', '0'));
        renderYAxisTransitionIndicators(curvesData, 0);
        placePeakDescriptors(desiredGroup, curvesData, 'desired', 0);
        placeBullseye(curvesData);
        return;
    }

    // Compute one arrow per curve at the point of maximum divergence
    const allArrows: any[] = [];
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        const div = findMaxDivergence(curve);
        if (!div || Math.abs(div.diff) < 5) continue;
        // Get baseline value at the same hour
        const blSmoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const match = blSmoothed.reduce((a: any, b: any) =>
            Math.abs(b.hour - div.hour) < Math.abs(a.hour - div.hour) ? b : a,
        );
        allArrows.push({
            curve,
            idx: i,
            arrow: { hour: div.hour, baseVal: match.value, desiredVal: div.value, diff: div.diff },
        });
    }

    // Phase 1: Grow elegant arrows from baseline -> desired (900ms)
    for (const { curve, idx, arrow } of allArrows) {
        const arrowSub = getEffectSubGroup(arrowGroup, idx);
        const x = phaseChartX(arrow.hour * 60);
        const y1 = phaseChartY(arrow.baseVal);
        const y2 = phaseChartY(arrow.desiredVal);

        // Subtle glow behind the arrow shaft
        const glowLine = svgEl('line', {
            x1: x.toFixed(1),
            y1: y1.toFixed(1),
            x2: x.toFixed(1),
            y2: y1.toFixed(1),
            stroke: curve.color,
            'stroke-width': '4',
            'stroke-opacity': '0',
            'stroke-linecap': 'round',
            fill: 'none',
            'pointer-events': 'none',
        });
        arrowSub.appendChild(glowLine);

        // Main arrow shaft
        const arrowLine = svgEl('line', {
            x1: x.toFixed(1),
            y1: y1.toFixed(1),
            x2: x.toFixed(1),
            y2: y1.toFixed(1),
            stroke: curve.color,
            class: 'mission-arrow',
            opacity: '0',
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

    // Phase 2: Morph baseline paths -> desired paths (1200ms)
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
            fill: curve.color,
            'fill-opacity': '0',
            class: 'phase-desired-fill',
        });
        desiredSub.appendChild(fillPath);
        fillPath.animate([{ fillOpacity: 0 }, { fillOpacity: 0.08 }], { duration: morphDuration, fill: 'forwards' });

        // Desired stroke — starts at baseline path, morphs to desired
        const strokePath = svgEl('path', {
            d: basePathD,
            fill: 'none',
            stroke: curve.color,
            class: 'phase-desired-path',
            opacity: '0',
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
    placeBullseye(curvesData);
}

// ============================================
// Phase Chart: Legend
// ============================================

export function renderPhaseLegend(curvesData: any[], mode: string): void {
    // Legend removed — labels are now outside the chart (baseline/target below X-axis)
    const group = document.getElementById('phase-legend')!;
    group.innerHTML = '';
}
