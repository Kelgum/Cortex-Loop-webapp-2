/**
 * Multi-Day Animation — Smooth day-to-day transitions for the 8-day cycle.
 * Features: desired curve morphing, delayed Lx catchup, simultaneous substance
 * pill animation, POI re-rendering per day, enhanced day labels.
 * Exports: playMultiDaySequence, seekToDay, pauseMultiDay, resumeMultiDay, renderDayState
 * Depends on: state, curve-utils, lx-system, poi-render, revision-animation
 */
import { MultiDayState, PhaseState, BiometricState } from './state';
import {
    interpolatePointArrays,
    phasePointsToPath,
    phasePointsToFillPath,
    smoothPhaseValues,
    interpolatePointsAtTime,
} from './curve-utils';
import { PHASE_SMOOTH_PASSES, PHASE_CHART, BIOMETRIC_ZONE, TIMELINE_ZONE } from './constants';
import {
    renderSubstanceTimeline,
    revealTimelinePillsInstant,
    preserveBiometricStrips,
    renderLxBandsStatic,
    allocateTimelineLanes,
} from './lx-system';
// easeInOutCubic removed — linear easing for continuous day-to-day flow
import { svgEl, phaseChartX, phaseChartY, clamp } from './utils';
import { renderPoiDotsAndConnectors } from './poi-render';
import type { CurveData, CurvePoint, DaySnapshot } from './types';

const interpolatePoints = interpolatePointArrays;

// ── Substance pill morph helpers ──

interface PillGeometry {
    x: number;
    y: number;
    width: number;
    laneIdx: number;
    timeH: number;
    targetCurveIdx: number;
    color: string;
    iv: any;
}

interface PillMorphPlan {
    matched: Array<{ from: PillGeometry; to: PillGeometry; el: SVGGElement }>;
    removed: Array<{ geo: PillGeometry; el: SVGGElement }>;
    added: Array<{ geo: PillGeometry; el: SVGGElement }>;
}

/** Match interventions across days by substance key + chronological order */
function matchDayInterventions(
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

/** Compute pill geometry from an allocation result */
function computePillGeometry(allocated: any[]): Map<any, PillGeometry> {
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const plotRight = PHASE_CHART.padL + PHASE_CHART.plotW;
    const result = new Map<any, PillGeometry>();

    for (const item of allocated) {
        const { iv, laneIdx, startMin, endMin } = item;
        const sub = iv.substance;
        const x = phaseChartX(startMin);
        const x2raw = phaseChartX(Math.min(endMin, PHASE_CHART.endMin));
        const width = Math.min(Math.max(TIMELINE_ZONE.minBarW, x2raw - x), plotRight - x);
        const y = TIMELINE_ZONE.top + laneIdx * laneStep;
        const color = sub ? sub.color : 'rgba(245,180,60,0.7)';
        const targetCurveIdx = iv.targetCurveIdx != null ? iv.targetCurveIdx : 0;

        result.set(iv, { x, y, width, laneIdx, timeH: iv.timeMinutes / 60, targetCurveIdx, color, iv });
    }
    return result;
}

/** Build a lightweight SVG pill node for "added" substances during morph */
function buildMorphPillNode(geo: PillGeometry, lxCurves: any[]): SVGGElement {
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

/** Prepare the morph plan: match pills, compute from/to geometries, find/create DOM elements */
function preparePillMorph(fromDay: DaySnapshot, toDay: DaySnapshot, _curvesData: CurveData[]): PillMorphPlan | null {
    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (!timelineGroup) return null;

    const fromAlloc = allocateTimelineLanes(fromDay.interventions || []);
    const toAlloc = allocateTimelineLanes(toDay.interventions || []);
    const fromGeoMap = computePillGeometry(fromAlloc);
    const toGeoMap = computePillGeometry(toAlloc);

    const { matched, removed, added } = matchDayInterventions(fromDay.interventions || [], toDay.interventions || []);

    // Find existing DOM pill elements
    const existingPills = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group'));
    function findPillEl(iv: any): SVGGElement | null {
        const key = iv?.key || '';
        const time = String(iv?.timeMinutes ?? '');
        return (
            (existingPills.find(
                (el: Element) =>
                    el.getAttribute('data-substance-key') === key && el.getAttribute('data-time-minutes') === time,
            ) as SVGGElement | null) ?? null
        );
    }

    const plan: PillMorphPlan = { matched: [], removed: [], added: [] };

    for (const { from, to } of matched) {
        const fromGeo = fromGeoMap.get(from);
        const toGeo = toGeoMap.get(to);
        const el = findPillEl(from);
        if (fromGeo && toGeo && el) {
            plan.matched.push({ from: fromGeo, to: toGeo, el });
        }
    }

    for (const iv of removed) {
        const geo = fromGeoMap.get(iv);
        const el = findPillEl(iv);
        if (geo && el) {
            plan.removed.push({ geo, el });
        }
    }

    for (const iv of added) {
        const geo = toGeoMap.get(iv);
        if (geo) {
            const el = buildMorphPillNode(geo, toDay.lxCurves);
            timelineGroup.appendChild(el);
            plan.added.push({ geo, el });
        }
    }

    return plan;
}

/** Animate pills during a single rAF tick. Called from animateDayTransition. */
function tickPillMorph(plan: PillMorphPlan, lxEase: number, fromDay: DaySnapshot, toDay: DaySnapshot) {
    // ── Matched pills: glide to new position ──
    for (const { from, to, el } of plan.matched) {
        const dx = (to.x - from.x) * lxEase;
        const dy = (to.y - from.y) * lxEase;
        el.setAttribute('transform', `translate(${dx.toFixed(2)}, ${dy.toFixed(2)})`);
        el.setAttribute('opacity', '1');

        // Interpolate bar width
        const bar = el.querySelector('.timeline-bar') as SVGRectElement | null;
        if (bar) {
            const w = from.width + (to.width - from.width) * lxEase;
            bar.setAttribute('width', w.toFixed(1));
        }

        // Interpolate connector + dot to track morphing Lx curves
        const connector = el.querySelector('.timeline-connector') as SVGLineElement | null;
        const dot = el.querySelector('.timeline-curve-dot') as SVGCircleElement | null;
        if (connector || dot) {
            const morphTimeH = from.timeH + (to.timeH - from.timeH) * lxEase;
            const ci = to.targetCurveIdx;
            const fromLxPts = fromDay.lxCurves[ci]?.points || [];
            const toLxPts = toDay.lxCurves[ci]?.points || [];
            let curveY = PHASE_CHART.padT + PHASE_CHART.plotH;
            if (fromLxPts.length > 0 && toLxPts.length > 0) {
                const fromVal = interpolatePointsAtTime(fromLxPts, morphTimeH);
                const toVal = interpolatePointsAtTime(toLxPts, morphTimeH);
                const morphVal = fromVal + (toVal - fromVal) * lxEase;
                curveY = phaseChartY(morphVal);
            }
            if (connector) {
                connector.setAttribute('y1', curveY.toFixed(1));
            }
            if (dot) {
                dot.setAttribute('cy', curveY.toFixed(1));
            }
        }
    }

    // ── Removed pills: fade out + slight shrink ──
    for (const { geo, el } of plan.removed) {
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

    // ── Added pills: fade in + slight grow ──
    for (const { geo, el } of plan.added) {
        if (lxEase < 0.3) {
            el.setAttribute('opacity', '0');
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
        }
    }
}

// ── Weekday name helpers ──

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDayLabel(dayNumber: number): string {
    const startWeekday = MultiDayState.startWeekday || 'Monday';
    const startIdx = WEEKDAYS.findIndex(d => d.toLowerCase() === startWeekday.toLowerCase());
    if (startIdx === -1) return `Day ${dayNumber}`;
    const dayIdx = (startIdx + dayNumber) % 7;
    return WEEKDAYS[dayIdx];
}

// ── Animate a single day-to-day transition with delayed Lx catchup ──

async function animateDayTransition(
    fromDay: DaySnapshot,
    toDay: DaySnapshot,
    curvesData: CurveData[],
    durationMs: number,
    onComplete?: () => void,
): Promise<void> {
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const lxGroup = document.getElementById('phase-lx-curves');
    const bioGroup = document.getElementById('phase-biometric-strips');

    // Get SVG elements
    const baselineStrokes = baseGroup ? Array.from(baseGroup.querySelectorAll('.phase-baseline-path')) : [];
    const desiredStrokes = desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-path')) : [];
    const desiredFills = desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-fill')) : [];
    const lxStrokes = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-path')) : [];
    const lxFills = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-fill')) : [];
    const bioStrokePaths = bioGroup ? Array.from(bioGroup.querySelectorAll('.bio-strip-path')) : [];
    const bioFillPaths = bioGroup ? Array.from(bioGroup.querySelectorAll('.bio-strip-fill')) : [];
    const bandsGroup = document.getElementById('phase-lx-bands');

    // Smooth baselines for path generation
    const fromBaselines = fromDay.bioCorrectedBaseline.map(bl => smoothPhaseValues(bl, PHASE_SMOOTH_PASSES));
    const toBaselines = toDay.bioCorrectedBaseline.map(bl => smoothPhaseValues(bl, PHASE_SMOOTH_PASSES));

    // Prepare per-pill morph plan before the rAF loop
    const pillPlan = preparePillMorph(fromDay, toDay, curvesData);
    let bandsRendered = false;

    await new Promise<void>(resolve => {
        const startTime = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTime) / durationMs);

            // ── Linear easing for continuous seamless flow across day boundaries ──
            const baselineEase = rawT;
            const desiredEase = rawT;
            const lxEase = rawT;
            const bioEase = rawT;

            // ── Morph baseline curves ──
            for (let ci = 0; ci < curvesData.length; ci++) {
                const fromBl = fromBaselines[ci] || [];
                const toBl = toBaselines[ci] || [];
                if (fromBl.length > 0 && toBl.length > 0) {
                    const morphed = interpolatePoints(fromBl, toBl, baselineEase);
                    if (baselineStrokes[ci]) {
                        baselineStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
                    }
                }
            }

            // ── Morph desired curves ──
            if (fromDay.desiredCurves && toDay.desiredCurves) {
                for (let ci = 0; ci < curvesData.length; ci++) {
                    const fromDes = fromDay.desiredCurves[ci] || [];
                    const toDes = toDay.desiredCurves[ci] || [];
                    if (fromDes.length > 0 && toDes.length > 0) {
                        const morphed = interpolatePoints(fromDes, toDes, desiredEase);
                        const smoothed = smoothPhaseValues(morphed, PHASE_SMOOTH_PASSES);
                        if (desiredStrokes[ci]) {
                            desiredStrokes[ci].setAttribute('d', phasePointsToPath(smoothed, true));
                        }
                        if (desiredFills[ci]) {
                            desiredFills[ci].setAttribute('d', phasePointsToFillPath(smoothed, true));
                        }
                    }
                }
            }

            // ── Morph Lx curves (delayed catchup) ──
            for (let ci = 0; ci < curvesData.length; ci++) {
                const fromPts = fromDay.lxCurves[ci]?.points || [];
                const toPts = toDay.lxCurves[ci]?.points || [];
                if (fromPts.length > 0 && toPts.length > 0) {
                    const morphed = interpolatePoints(fromPts, toPts, lxEase);
                    if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
                    if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
                }
            }

            // ── Per-pill substance morph synchronized with Lx curves ──
            if (pillPlan) {
                tickPillMorph(pillPlan, lxEase, fromDay, toDay);
            }

            // ── Cross-fade AUC bands synchronized with Lx morph ──
            if (bandsGroup && lxEase > 0) {
                if (!bandsRendered && lxEase >= 0.4) {
                    bandsRendered = true;
                    const toDayCurves = curvesData.map((c: CurveData, i: number) => ({
                        ...c,
                        baseline: toDay.bioCorrectedBaseline[i] || c.baseline,
                    }));
                    renderLxBandsStatic(toDay.interventions, toDayCurves);
                    bandsGroup
                        .querySelectorAll('.lx-auc-band')
                        .forEach((el: Element) => el.setAttribute('fill-opacity', '0'));
                }
                if (!bandsRendered) {
                    const fadeOut = Math.max(0, 1 - lxEase / 0.4);
                    bandsGroup
                        .querySelectorAll('.lx-auc-band')
                        .forEach((el: Element) => el.setAttribute('fill-opacity', String((0.18 * fadeOut).toFixed(4))));
                } else {
                    const fadeIn = Math.min(1, (lxEase - 0.4) / 0.4);
                    bandsGroup
                        .querySelectorAll('.lx-auc-band')
                        .forEach((el: Element) => el.setAttribute('fill-opacity', String((0.18 * fadeIn).toFixed(4))));
                }
            }

            // ── Morph biometric waveforms ──
            const initialChannels = BiometricState.channels || [];
            const minChannels = Math.min(
                fromDay.biometricChannels.length,
                toDay.biometricChannels.length,
                bioStrokePaths.length,
            );
            for (let ch = 0; ch < minChannels; ch++) {
                const fromData = fromDay.biometricChannels[ch]?.data || [];
                const toData = toDay.biometricChannels[ch]?.data || [];
                if (fromData.length > 0 && toData.length > 0) {
                    const morphedData = interpolatePoints(fromData, toData, bioEase);
                    const strokePath = bioStrokePaths[ch];
                    const fillPath = bioFillPaths[ch];
                    if (strokePath) {
                        const range = toDay.biometricChannels[ch].range || [0, 100];
                        const renderCh = initialChannels[ch];
                        const stripY = renderCh?._renderY ?? 0;
                        const stripH =
                            renderCh?._renderH ?? (toDay.biometricChannels[ch].stripHeight || BIOMETRIC_ZONE.laneH);
                        const [lo, hi] = range;
                        const span = hi - lo || 1;
                        let strokeD = '';
                        for (let i = 0; i < morphedData.length; i++) {
                            const x = phaseChartX(morphedData[i].hour * 60);
                            const normVal = clamp((morphedData[i].value - lo) / span, 0, 1);
                            const y = stripY + stripH - normVal * stripH;
                            strokeD += (i === 0 ? 'M ' : ' L ') + x.toFixed(1) + ' ' + y.toFixed(1);
                        }
                        if (strokeD) {
                            strokePath.setAttribute('d', strokeD);
                            if (fillPath) {
                                const baseY = stripY + stripH;
                                const lastX = phaseChartX(morphedData[morphedData.length - 1].hour * 60);
                                const firstX = phaseChartX(morphedData[0].hour * 60);
                                const fillD =
                                    strokeD +
                                    ` L ${lastX.toFixed(1)} ${baseY.toFixed(1)}` +
                                    ` L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
                                fillPath.setAttribute('d', fillD);
                            }
                        }
                    }
                }
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                // Run DOM rebuild in the same frame as the final animation
                if (onComplete) onComplete();
                resolve();
            }
        })(performance.now());
    });
}

// ── Update day counter display with weekday name and narrative ──

function updateDayCounter(day: number, narrativeBeat?: string) {
    const counter = document.getElementById('day-number');
    if (counter) counter.textContent = String(day);

    // Update SVG overlay with weekday label
    const svgCounter = document.getElementById('phase-day-counter');
    if (svgCounter) {
        const weekday = getDayLabel(day);
        svgCounter.textContent = `Day ${day} — ${weekday}`;
    }

    // Update narrative beat display
    const narrativeEl = document.getElementById('day-narrative-beat');
    if (narrativeEl && narrativeBeat) {
        narrativeEl.textContent = narrativeBeat;
        narrativeEl.style.opacity = '1';
    }

    // Update scrubber
    const scrubber = document.getElementById('day-scrubber') as HTMLInputElement;
    if (scrubber) scrubber.value = String(day);
}

// ── Render a specific day state instantly (for seeking) ──

export function renderDayState(day: DaySnapshot, curvesData: CurveData[]) {
    const baseGroup = document.getElementById('phase-baseline-curves');
    const desiredGroup = document.getElementById('phase-desired-curves');
    const lxGroup = document.getElementById('phase-lx-curves');

    // Render baseline curves
    const baselineStrokes = baseGroup ? Array.from(baseGroup.querySelectorAll('.phase-baseline-path')) : [];
    for (let ci = 0; ci < curvesData.length; ci++) {
        const bl = smoothPhaseValues(day.bioCorrectedBaseline[ci] || curvesData[ci].baseline, PHASE_SMOOTH_PASSES);
        if (baselineStrokes[ci] && bl.length > 0) {
            baselineStrokes[ci].setAttribute('d', phasePointsToPath(bl, true));
        }
    }

    // Render desired curves (new!)
    if (day.desiredCurves) {
        const desiredStrokes = desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-path')) : [];
        const desiredFills = desiredGroup ? Array.from(desiredGroup.querySelectorAll('.phase-desired-fill')) : [];
        for (let ci = 0; ci < curvesData.length; ci++) {
            const des = day.desiredCurves[ci];
            if (des && des.length > 0) {
                const smoothed = smoothPhaseValues(des, PHASE_SMOOTH_PASSES);
                if (desiredStrokes[ci]) desiredStrokes[ci].setAttribute('d', phasePointsToPath(smoothed, true));
                if (desiredFills[ci]) desiredFills[ci].setAttribute('d', phasePointsToFillPath(smoothed, true));
            }
        }
    }

    // Render Lx curves
    const lxStrokes = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-path')) : [];
    const lxFills = lxGroup ? Array.from(lxGroup.querySelectorAll('.phase-lx-fill')) : [];
    for (let ci = 0; ci < curvesData.length; ci++) {
        const pts = day.lxCurves[ci]?.points || [];
        if (pts.length > 0) {
            if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(pts, true));
            if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(pts, true));
        }
    }

    // Render substance timeline pills + AUC bands (instant swap)
    const mdPhase = MultiDayState.phase as string;
    const isMultiDay = mdPhase !== 'idle';
    if (day.interventions.length > 0 || isMultiDay) {
        renderSubstanceTimeline(day.interventions, day.lxCurves, curvesData);
        // Update per-substance AUC bands with this day's corrected baselines
        const dayCurves = curvesData.map((c: CurveData, i: number) => ({
            ...c,
            baseline: day.bioCorrectedBaseline[i] || c.baseline,
        }));
        renderLxBandsStatic(day.interventions, dayCurves);
        if (!isMultiDay) {
            preserveBiometricStrips();
        }
        revealTimelinePillsInstant();
    }

    // Render POI dots and connectors
    if (day.poiEvents && day.poiEvents.length > 0) {
        renderPoiDotsAndConnectors(day.poiEvents, day.biometricChannels, day.interventions);
    } else {
        // Clear POIs for days without them
        const spotterGroup = document.getElementById('phase-spotter-highlights');
        const poiContainer = document.getElementById('phase-poi-connectors');
        if (spotterGroup) spotterGroup.innerHTML = '';
        if (poiContainer) poiContainer.innerHTML = '';
    }

    updateDayCounter(day.day, day.narrativeBeat);
    MultiDayState.currentDay = day.day;
}

// ── Seek to a specific day (instant) ──

export function seekToDay(dayIndex: number) {
    const { days } = MultiDayState;
    if (dayIndex < 0 || dayIndex >= days.length) return;

    const curvesData = PhaseState.curvesData;
    if (!curvesData) return;

    renderDayState(days[dayIndex], curvesData);
}

// ── Play multi-day sequence ──

export async function playMultiDaySequence(days: DaySnapshot[], curvesData: CurveData[]): Promise<void> {
    if (days.length < 2) return;

    MultiDayState.phase = 'playing';
    PhaseState.phase = 'week-playing';

    const baseDuration = 3000; // ms per day transition

    // Continuous loop: Day 0→7→0→7... until paused
    while (MultiDayState.phase === 'playing') {
        for (let i = 0; i < days.length - 1; i++) {
            // Check for pause
            const currentPhase = MultiDayState.phase as string;
            if (currentPhase === 'paused') {
                await new Promise<void>(resolve => {
                    const checkResume = () => {
                        if (MultiDayState.phase === 'playing') {
                            resolve();
                        } else if (MultiDayState.phase === 'idle') {
                            resolve();
                        } else {
                            setTimeout(checkResume, 100);
                        }
                    };
                    checkResume();
                });
                if ((MultiDayState.phase as string) === 'idle') return;
            }
            // Exit loop if no longer playing (paused then set to idle externally)
            if (MultiDayState.phase !== 'playing') break;

            const duration = baseDuration / MultiDayState.speed;
            updateDayCounter(days[i + 1].day, days[i + 1].narrativeBeat);

            // Notify VCR stepper to animate day label transit
            const advanceCb = (MultiDayState as any).onDayAdvance;
            if (typeof advanceCb === 'function') advanceCb();

            const nextDay = days[i + 1];
            await animateDayTransition(days[i], nextDay, curvesData, duration, () => {
                // Rebuild DOM in final animation frame — no visible gap between days
                MultiDayState.currentDay = nextDay.day;
                renderSubstanceTimeline(nextDay.interventions, nextDay.lxCurves, curvesData);
                revealTimelinePillsInstant();
                const dayCurves = curvesData.map((c: CurveData, ci: number) => ({
                    ...c,
                    baseline: nextDay.bioCorrectedBaseline[ci] || c.baseline,
                }));
                renderLxBandsStatic(nextDay.interventions, dayCurves);
                if (nextDay.poiEvents && nextDay.poiEvents.length > 0) {
                    renderPoiDotsAndConnectors(nextDay.poiEvents, nextDay.biometricChannels, nextDay.interventions);
                }
            });
        }

        // Loop back: seamlessly transition Day 7 → Day 0
        if (MultiDayState.phase === 'playing' && days.length >= 2) {
            const duration = baseDuration / MultiDayState.speed;
            const lastDay = days[days.length - 1];
            const firstDay = days[0];
            updateDayCounter(firstDay.day, firstDay.narrativeBeat);

            const advanceCb = (MultiDayState as any).onDayAdvance;
            if (typeof advanceCb === 'function') advanceCb();

            await animateDayTransition(lastDay, firstDay, curvesData, duration, () => {
                MultiDayState.currentDay = 0;
                renderSubstanceTimeline(firstDay.interventions, firstDay.lxCurves, curvesData);
                revealTimelinePillsInstant();
                const resetCurves = curvesData.map((c: CurveData, ci: number) => ({
                    ...c,
                    baseline: firstDay.bioCorrectedBaseline[ci] || c.baseline,
                }));
                renderLxBandsStatic(firstDay.interventions, resetCurves);
                if (firstDay.poiEvents && firstDay.poiEvents.length > 0) {
                    renderPoiDotsAndConnectors(firstDay.poiEvents, firstDay.biometricChannels, firstDay.interventions);
                }
            });
        }
    }

    MultiDayState.phase = 'complete';
    PhaseState.phase = 'week-complete';
}

// ── Pause / Resume controls ──

export function pauseMultiDay() {
    if (MultiDayState.phase === 'playing') {
        MultiDayState.phase = 'paused';
    }
}

export function resumeMultiDay() {
    if (MultiDayState.phase === 'paused') {
        MultiDayState.phase = 'playing';
    }
}

// ── Toggle speed ──

export function cycleMultiDaySpeed() {
    const speeds = [0.5, 1, 2];
    const idx = speeds.indexOf(MultiDayState.speed);
    MultiDayState.speed = speeds[(idx + 1) % speeds.length];
    const btn = document.getElementById('day-speed-btn');
    if (btn) btn.textContent = `${MultiDayState.speed}x`;
}

// ── Initialize day controls event listeners ──

export function initMultiDayControls() {
    const scrubber = document.getElementById('day-scrubber') as HTMLInputElement;
    if (scrubber) {
        scrubber.addEventListener('input', () => {
            const day = parseInt(scrubber.value, 10);
            if (MultiDayState.phase === 'playing') pauseMultiDay();
            seekToDay(day);
        });
    }

    const playPauseBtn = document.getElementById('day-play-pause');
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            if (MultiDayState.phase === 'playing') {
                pauseMultiDay();
                playPauseBtn.innerHTML = playSvgIcon();
            } else if (MultiDayState.phase === 'paused') {
                resumeMultiDay();
                playPauseBtn.innerHTML = pauseSvgIcon();
            } else if (MultiDayState.phase === 'complete') {
                const curvesData = PhaseState.curvesData;
                if (curvesData && MultiDayState.days.length > 0) {
                    seekToDay(0);
                    playPauseBtn.innerHTML = pauseSvgIcon();
                    playMultiDaySequence(MultiDayState.days, curvesData).then(() => {
                        playPauseBtn.innerHTML = playSvgIcon();
                    });
                }
            }
        });
    }

    const speedBtn = document.getElementById('day-speed-btn');
    if (speedBtn) {
        speedBtn.addEventListener('click', cycleMultiDaySpeed);
    }
}

function playSvgIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 14 14"><polygon points="3,1 12,7 3,13" fill="currentColor"/></svg>';
}

function pauseSvgIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="0.5" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" rx="0.5" fill="currentColor"/></svg>';
}
