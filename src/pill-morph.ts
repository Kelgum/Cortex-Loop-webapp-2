/**
 * Pill Morph Engine — shared pill animation primitives for day transitions and revision.
 *
 * Provides: types (PillGeometry, DoseMorphInfo, PillMorphPlan), matching, geometry
 * computation, pill node creation, and the core per-frame tick function.
 *
 * Used by: multi-day-animation.ts (7-day STREAM), revision-animation.ts (Phase 4 revision).
 */

import { PHASE_CHART, TIMELINE_ZONE, TELEPORT } from './constants';
import { svgEl, phaseChartX, phaseChartY, teleportInterpolation } from './utils';
import { interpolatePointsAtTime } from './curve-utils';
import { allocateTimelineLanes, computeDoseBarWidth, computeDisplayDose } from './lx-system';

// ============================================
// Types
// ============================================

export interface PillGeometry {
    x: number;
    y: number;
    width: number;
    laneIdx: number;
    timeH: number;
    targetCurveIdx: number;
    color: string;
    iv: any;
}

/** Parsed dose info for label interpolation during pill morph */
export interface DoseMorphInfo {
    oldNum: number;
    newNum: number;
    decimals: number;
    prefix: string; // text before number, e.g. "L-Theanine "
    suffix: string; // text after number+unit, e.g. "" or " ⚠️"
    unit: string; // "mg", "mcg", etc.
    isUp: boolean;
}

export interface PillMorphPlan {
    matched: Array<{
        from: PillGeometry;
        to: PillGeometry;
        el: SVGGElement;
        doseMorph: DoseMorphInfo | null;
        ghost: SVGGElement | null; // destination ghost for portal-distance moves
    }>;
    removed: Array<{ geo: PillGeometry; el: SVGGElement }>;
    added: Array<{ geo: PillGeometry; el: SVGGElement; doseMorph: DoseMorphInfo | null }>;
}

/** Lightweight curve context for tickPillMorph — avoids DaySnapshot dependency */
export interface PillMorphCurveCtx {
    fromLxPoints: Array<Array<{ hour: number; value: number }>>;
    toLxPoints: Array<Array<{ hour: number; value: number }>>;
}

/** Optional callbacks for customizing morph behavior */
export interface PillMorphOptions {
    /** Custom per-frame callback for removed pills (e.g. connector retraction in revision).
     *  When provided, replaces the default fade+shrink for removed pills. */
    onRemoveTick?: (el: SVGGElement, geo: PillGeometry, t: number) => void;
}

// ============================================
// Dose parsing
// ============================================

/** Parse dose from a single intervention as a 0 → finalDose morph (used for added pills). */
export function parseDoseFromZero(iv: any): DoseMorphInfo | null {
    const dose = computeDisplayDose(iv);
    if (!dose) return null;
    const m = dose.match(/^([\d.]+)\s*(mg|mcg|µg|μg|g|IU|ml)\b/i);
    if (!m) return null;
    const num = parseFloat(m[1]);
    if (!num) return null;
    const dec = m[1].includes('.') ? m[1].split('.')[1].length : 0;
    const sub = iv?.substance;
    const name = (sub && sub.name) || iv?.key || '';
    return {
        oldNum: 0,
        newNum: num,
        decimals: dec,
        prefix: name ? `${name} ` : '',
        suffix: '',
        unit: m[2],
        isUp: true,
    };
}

/** Parse dose from label text like "Caffeine (IR) 100mg" → parts for interpolation */
export function parseDoseMorph(fromIv: any, toIv: any): DoseMorphInfo | null {
    const fromDose = computeDisplayDose(fromIv);
    const toDose = computeDisplayDose(toIv);
    if (!fromDose || !toDose) return null;

    const fromMatch = fromDose.match(/^([\d.]+)\s*(mg|mcg|µg|μg|g|IU|ml)\b/i);
    const toMatch = toDose.match(/^([\d.]+)\s*(mg|mcg|µg|μg|g|IU|ml)\b/i);
    if (!fromMatch || !toMatch) return null;

    const oldNum = parseFloat(fromMatch[1]);
    const newNum = parseFloat(toMatch[1]);
    if (oldNum === newNum) return null; // no dose change

    const fromDec = fromMatch[1].includes('.') ? fromMatch[1].split('.')[1].length : 0;
    const toDec = toMatch[1].includes('.') ? toMatch[1].split('.')[1].length : 0;

    const sub = fromIv?.substance || toIv?.substance;
    const name = (sub && sub.name) || fromIv?.key || '';

    return {
        oldNum,
        newNum,
        decimals: Math.max(fromDec, toDec),
        prefix: name ? `${name} ` : '',
        suffix: '', // warning icons handled by full rebuild
        unit: toMatch[2],
        isUp: newNum > oldNum,
    };
}

// ============================================
// Intervention matching
// ============================================

/** Match interventions across days/states by substance key + chronological order */
export function matchInterventions(
    fromIvs: any[],
    toIvs: any[],
): { matched: Array<{ from: any; to: any }>; removed: any[]; added: any[] } {
    const fromByKey = new Map<string, any[]>();
    const toByKey = new Map<string, any[]>();

    fromIvs.forEach((iv: any) => {
        const key = iv?.key || '';
        if (!fromByKey.has(key)) fromByKey.set(key, []);
        fromByKey.get(key)!.push(iv);
    });
    toIvs.forEach((iv: any) => {
        const key = iv?.key || '';
        if (!toByKey.has(key)) toByKey.set(key, []);
        toByKey.get(key)!.push(iv);
    });

    // Sort within each key by timeMinutes
    for (const arr of fromByKey.values()) arr.sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);
    for (const arr of toByKey.values()) arr.sort((a: any, b: any) => a.timeMinutes - b.timeMinutes);

    const matched: Array<{ from: any; to: any }> = [];
    const matchedFromSet = new Set<any>();
    const matchedToSet = new Set<any>();

    const allKeys = new Set([...fromByKey.keys(), ...toByKey.keys()]);
    for (const key of allKeys) {
        const fromGroup = fromByKey.get(key) || [];
        const toGroup = toByKey.get(key) || [];
        const pairCount = Math.min(fromGroup.length, toGroup.length);
        for (let i = 0; i < pairCount; i++) {
            matched.push({ from: fromGroup[i], to: toGroup[i] });
            matchedFromSet.add(fromGroup[i]);
            matchedToSet.add(toGroup[i]);
        }
    }

    const removed = fromIvs.filter((iv: any) => !matchedFromSet.has(iv));
    const added = toIvs.filter((iv: any) => !matchedToSet.has(iv));

    return { matched, removed, added };
}

// ============================================
// Geometry computation
// ============================================

/** Compute pill geometry from an allocation result */
export function computePillGeometry(allocated: any[]): Map<any, PillGeometry> {
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const result = new Map<any, PillGeometry>();

    for (const item of allocated) {
        const { iv, laneIdx, startMin } = item;
        const sub = iv.substance;
        const x = phaseChartX(startMin);
        const width = Math.min(computeDoseBarWidth(iv), plotRight - x);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const color = sub ? sub.color : 'rgba(245,180,60,0.7)';
        const targetCurveIdx = iv.targetCurveIdx != null ? iv.targetCurveIdx : 0;

        result.set(iv, { x, y, width, laneIdx, timeH: iv.timeMinutes / 60, targetCurveIdx, color, iv });
    }
    return result;
}

/** Compute lane count from an allocation result */
export function computeLaneCount(allocated: any[]): number {
    return allocated.reduce((max: number, a: any) => Math.max(max, (a.laneIdx || 0) + 1), 0);
}

// ============================================
// Pill node creation
// ============================================

/** Build a lightweight SVG pill node for morphing */
export function buildMorphPillNode(geo: PillGeometry, lxCurves: any[]): SVGGElement {
    const h = TIMELINE_ZONE.laneH;
    const rx = TIMELINE_ZONE.pillRx;
    const sub = geo.iv.substance;
    const curveColor = geo.color;

    const g = svgEl('g', {
        class: 'timeline-pill-group morph-added',
        opacity: '0',
        'data-substance-key': geo.iv.key || '',
        'data-time-minutes': String(geo.iv.timeMinutes),
    }) as SVGGElement;

    // Connector top Y
    const hasLx = lxCurves && lxCurves[geo.targetCurveIdx];
    let connY = PHASE_CHART.padT + PHASE_CHART.plotH;
    if (hasLx) {
        const val = interpolatePointsAtTime(
            lxCurves[geo.targetCurveIdx].desired || lxCurves[geo.targetCurveIdx].points,
            geo.timeH,
        );
        connY = phaseChartY(val);
    }

    // Dashed connector
    g.appendChild(
        svgEl('line', {
            x1: geo.x.toFixed(1),
            y1: connY.toFixed(1),
            x2: geo.x.toFixed(1),
            y2: String(geo.y),
            stroke: curveColor,
            'stroke-opacity': '0.25',
            'stroke-width': '0.75',
            'stroke-dasharray': '2 3',
            class: 'timeline-connector',
            'pointer-events': 'none',
        }),
    );

    // Dot on curve
    if (hasLx) {
        g.appendChild(
            svgEl('circle', {
                cx: geo.x.toFixed(1),
                cy: connY.toFixed(1),
                r: '3',
                fill: curveColor,
                'fill-opacity': '0.65',
                stroke: curveColor,
                'stroke-opacity': '0.9',
                'stroke-width': '0.5',
                class: 'timeline-curve-dot',
                'pointer-events': 'none',
            }),
        );
    }

    // Colored bar
    g.appendChild(
        svgEl('rect', {
            x: geo.x.toFixed(1),
            y: geo.y.toFixed(1),
            width: geo.width.toFixed(1),
            height: String(h),
            rx: String(rx),
            ry: String(rx),
            fill: curveColor,
            'fill-opacity': '0.22',
            stroke: curveColor,
            'stroke-opacity': '0.45',
            'stroke-width': '0.75',
            class: 'timeline-bar',
        }),
    );

    // Simple label
    const name = sub ? sub.name : geo.iv.key;
    const dose = geo.iv.dose || (sub ? sub.standardDose : '') || '';
    const label = svgEl('text', {
        x: (geo.x + 5).toFixed(1),
        y: (geo.y + h / 2 + 3).toFixed(1),
        class: 'timeline-bar-label',
    });
    label.textContent = dose ? `${name} ${dose}` : name;
    g.appendChild(label);

    return g;
}

// ============================================
// Per-frame pill interpolation
// ============================================

/**
 * Animate ALL pills in a single frame tick.
 * Called from both multi-day and revision animation rAF loops.
 *
 * @param plan - The morph plan (matched, removed, added)
 * @param lxEase - Eased progress [0, 1]
 * @param curveCtx - Lx curve points for connector tracking
 * @param options - Optional callbacks (e.g. custom remove animation)
 */
export function tickPillMorph(
    plan: PillMorphPlan,
    lxEase: number,
    curveCtx: PillMorphCurveCtx,
    options?: PillMorphOptions,
): void {
    // ── Matched pills: glide to new position + interpolate dose ──
    for (const { from, to, el, doseMorph, ghost } of plan.matched) {
        const totalDx = to.x - from.x;
        const totalDy = to.y - from.y;

        if (ghost) {
            // ── Portal: origin fades out + drifts, destination ghost fades in + drifts — in parallel ──
            const tf = teleportInterpolation(lxEase, TELEPORT.driftFraction);

            // Origin element: drift slightly toward destination, fade out
            const originDx = totalDx * tf.originPos;
            const originDy = totalDy * tf.originPos;
            el.setAttribute('transform', `translate(${originDx.toFixed(2)}, ${originDy.toFixed(2)})`);
            el.setAttribute('opacity', tf.originOpacity.toFixed(3));

            // Origin connector + dot fade
            const connector = el.querySelector('.timeline-connector') as SVGLineElement | null;
            const dot = el.querySelector('.timeline-curve-dot') as SVGCircleElement | null;
            if (connector) connector.setAttribute('stroke-opacity', (0.25 * tf.originOpacity).toFixed(3));
            if (dot) dot.setAttribute('fill-opacity', (0.65 * tf.originOpacity).toFixed(3));

            // Destination ghost: drift into final position, fade in
            const ghostDriftDx = totalDx * (tf.destPos - 1);
            const ghostDriftDy = totalDy * (tf.destPos - 1);
            ghost.setAttribute('transform', `translate(${ghostDriftDx.toFixed(2)}, ${ghostDriftDy.toFixed(2)})`);
            ghost.setAttribute('opacity', tf.destOpacity.toFixed(3));

            // Ghost connector + dot fade
            const gConn = ghost.querySelector('.timeline-connector') as SVGLineElement | null;
            const gDot = ghost.querySelector('.timeline-curve-dot') as SVGCircleElement | null;
            if (gConn) gConn.setAttribute('stroke-opacity', (0.25 * tf.destOpacity).toFixed(3));
            if (gDot) gDot.setAttribute('fill-opacity', (0.65 * tf.destOpacity).toFixed(3));

            // Dose label on ghost during fade-in
            if (doseMorph && lxEase > 0.01) {
                _tickDoseLabel(ghost, doseMorph, lxEase);
            }
        } else {
            // ── Normal smooth glide ──
            const dx = totalDx * lxEase;
            const dy = totalDy * lxEase;
            el.setAttribute('transform', `translate(${dx.toFixed(2)}, ${dy.toFixed(2)})`);
            el.setAttribute('opacity', '1');

            // Interpolate bar width
            const bar = el.querySelector('.timeline-bar') as SVGRectElement | null;
            if (bar) {
                const w = from.width + (to.width - from.width) * lxEase;
                bar.setAttribute('width', w.toFixed(1));
            }

            // Interpolate dose label
            if (doseMorph) {
                _tickDoseLabel(el, doseMorph, lxEase);
            }

            // Interpolate connector + dot to track morphing Lx curves
            const connector = el.querySelector('.timeline-connector') as SVGLineElement | null;
            const dot = el.querySelector('.timeline-curve-dot') as SVGCircleElement | null;
            if (connector || dot) {
                const morphTimeH = from.timeH + (to.timeH - from.timeH) * lxEase;
                const ci = to.targetCurveIdx;
                const fromLxPts = curveCtx.fromLxPoints[ci] || [];
                const toLxPts = curveCtx.toLxPoints[ci] || [];
                let curveY = PHASE_CHART.padT + PHASE_CHART.plotH;
                if (fromLxPts.length > 0 && toLxPts.length > 0) {
                    const fromVal = interpolatePointsAtTime(fromLxPts, morphTimeH);
                    const toVal = interpolatePointsAtTime(toLxPts, morphTimeH);
                    const morphVal = fromVal + (toVal - fromVal) * lxEase;
                    curveY = phaseChartY(morphVal);
                }
                if (connector) connector.setAttribute('y1', curveY.toFixed(1));
                if (dot) dot.setAttribute('cy', curveY.toFixed(1));
            }
        }
    }

    // ── Removed pills: fade out + slight shrink (or custom callback) ──
    for (const { geo, el } of plan.removed) {
        if (options?.onRemoveTick) {
            options.onRemoveTick(el, geo, lxEase);
        } else {
            const fadeProgress = Math.min(1, lxEase / 0.5);
            const opacity = Math.max(0, 1 - fadeProgress);
            const scale = 1 - 0.15 * fadeProgress;
            const cx = geo.x + geo.width / 2;
            const cy = geo.y + TIMELINE_ZONE.laneH / 2;
            el.setAttribute('opacity', opacity.toFixed(3));
            el.setAttribute(
                'transform',
                `translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) scale(${scale.toFixed(3)}) translate(${(-cx).toFixed(1)}, ${(-cy).toFixed(1)})`,
            );
        }
    }

    // ── Added pills: fade in + slight grow + dose count from 0 ──
    for (const { geo, el, doseMorph } of plan.added) {
        if (lxEase < 0.3) {
            el.setAttribute('opacity', '0');
            if (doseMorph) {
                const label = el.querySelector('.timeline-bar-label') as SVGTextElement | null;
                if (label) label.textContent = `${doseMorph.prefix}0${doseMorph.unit}`;
            }
        } else {
            const fadeIn = Math.min(1, (lxEase - 0.3) / 0.55);
            const scale = 0.85 + 0.15 * fadeIn;
            const cx = geo.x + geo.width / 2;
            const cy = geo.y + TIMELINE_ZONE.laneH / 2;
            el.setAttribute('opacity', fadeIn.toFixed(3));
            el.setAttribute(
                'transform',
                `translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) scale(${scale.toFixed(3)}) translate(${(-cx).toFixed(1)}, ${(-cy).toFixed(1)})`,
            );

            // Animate dose label from 0 → final dose synchronized with fade-in
            if (doseMorph) {
                const label = el.querySelector('.timeline-bar-label') as SVGTextElement | null;
                if (label) {
                    const doseT = fadeIn;

                    if (doseT >= 1) {
                        const finalDisplay =
                            doseMorph.decimals > 0
                                ? doseMorph.newNum.toFixed(doseMorph.decimals)
                                : String(Math.round(doseMorph.newNum));
                        label.textContent = `${doseMorph.prefix}${finalDisplay}${doseMorph.unit}`;
                    } else {
                        const cur = doseMorph.newNum * doseT;
                        const display =
                            doseMorph.decimals > 0 ? cur.toFixed(doseMorph.decimals) : String(Math.round(cur));
                        const arrowColor = '#4ade80'; // always up (0 → dose)

                        label.textContent = '';
                        label.appendChild(document.createTextNode(doseMorph.prefix));

                        const numSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                        numSpan.textContent = `${display}${doseMorph.unit}`;
                        label.appendChild(numSpan);

                        const baseFontSize = 11;
                        const pulse = Math.sin(Math.PI * doseT);
                        const pulsedSize = baseFontSize * (1 + 0.18 * pulse);
                        numSpan.setAttribute('font-size', pulsedSize.toFixed(1));

                        if (doseT > 0.01) {
                            const arrowSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                            arrowSpan.setAttribute('fill', arrowColor);
                            arrowSpan.setAttribute('dx', '2');
                            arrowSpan.setAttribute('fill-opacity', Math.min(1, doseT / 0.4).toFixed(2));
                            arrowSpan.textContent = ' \u25B2';
                            label.appendChild(arrowSpan);
                        }
                    }
                }
            }
        }
    }
}

// ── Private dose label interpolation helper ──

function _tickDoseLabel(el: Element, doseMorph: DoseMorphInfo, lxEase: number): void {
    const label = el.querySelector('.timeline-bar-label') as SVGTextElement | null;
    if (!label) return;

    if (lxEase >= 1) {
        const finalDisplay =
            doseMorph.decimals > 0
                ? doseMorph.newNum.toFixed(doseMorph.decimals)
                : String(Math.round(doseMorph.newNum));
        label.textContent = `${doseMorph.prefix}${finalDisplay}${doseMorph.unit}${doseMorph.suffix}`;
    } else {
        const cur = doseMorph.oldNum + (doseMorph.newNum - doseMorph.oldNum) * lxEase;
        const display = doseMorph.decimals > 0 ? cur.toFixed(doseMorph.decimals) : String(Math.round(cur));
        const arrowChar = doseMorph.isUp ? ' \u25B2' : ' \u25BC';
        const arrowColor = doseMorph.isUp ? '#4ade80' : '#f87171';

        label.textContent = '';
        label.appendChild(document.createTextNode(doseMorph.prefix));

        const numSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        numSpan.textContent = `${display}${doseMorph.unit}${doseMorph.suffix}`;
        label.appendChild(numSpan);

        const baseFontSize = 11;
        const pulse = Math.sin(Math.PI * lxEase);
        const pulsedSize = baseFontSize * (1 + 0.18 * pulse);
        numSpan.setAttribute('font-size', pulsedSize.toFixed(1));

        if (lxEase > 0.01) {
            const arrowSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            arrowSpan.setAttribute('fill', arrowColor);
            arrowSpan.setAttribute('dx', '2');
            arrowSpan.setAttribute('fill-opacity', Math.min(1, lxEase / 0.4).toFixed(2));
            arrowSpan.textContent = arrowChar;
            label.appendChild(arrowSpan);
        }
    }
}
