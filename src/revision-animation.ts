/**
 * Revision Animation — Revision diff animation: pill move/resize/flip/add/remove, scan line sweep.
 * Exports: diffInterventions, animateRevisionScan
 * Depends on: constants (PHASE_CHART, TIMELINE_ZONE), state (BiometricState), utils, svg-animate, lx-system, sherlock
 */
import { PHASE_CHART, TIMELINE_ZONE, TELEPORT } from './constants';
import { BiometricState, isTurboActive } from './state';
import { easeInOutCubic } from './timeline-engine';
import { svgEl, phaseChartX, sleep, isLightMode, clamp } from './utils';
import { animateSvgOpacity } from './svg-animate';
import {
    renderSubstanceTimeline,
    preserveBiometricStrips,
    revealTimelinePillsInstant,
    getBioSeparatorEffectiveY,
    getTimelineBottomY,
    slideBiometricZoneDown,
    animatePhaseChartViewBoxHeight,
    allocateTimelineLanes,
} from './lx-system';
import { showNarrationPanel, showSherlockStack, enableSherlockScrollMode } from './sherlock';
import { buildSherlockRevisionCards } from './timeline-segments/sherlock-segments';
import { updateGamificationCurveData } from './gamification-overlay';
import {
    type PillMorphPlan,
    type PillMorphCurveCtx,
    type PillGeometry,
    computePillGeometry,
    computeLaneCount,
    buildMorphPillNode,
    parseDoseMorph,
    parseDoseFromZero,
    tickPillMorph,
} from './pill-morph';

interface RevisionAnimationOptions {
    morphLxStep?: (entry: any, entryIdx: number, durationMs: number) => Promise<void> | void;
}

// ---- Diffing Logic ----

function interventionDoseSignature(iv: any): string {
    return `${iv?.dose || ''}|${iv?.doseMultiplier ?? 1}`;
}

function interventionImpactSignature(impacts: any): string {
    if (!impacts || typeof impacts !== 'object') return '';
    return Object.entries(impacts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${Number(value)}`)
        .join('|');
}

function interventionSemanticSignature(iv: any): string {
    return `${interventionImpactSignature(iv?.impacts)}|${iv?.targetCurveIdx ?? ''}`;
}

function normalizeImpactKey(key: unknown): string {
    return String(key || '')
        .trim()
        .toLowerCase();
}

function impactEntries(iv: any): Array<[string, number]> {
    if (!iv?.impacts || typeof iv.impacts !== 'object') return [];
    return Object.entries(iv.impacts)
        .map(([key, value]) => [normalizeImpactKey(key), Math.abs(Number(value) || 0)] as [string, number])
        .filter(([key, value]) => key.length > 0 && value > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function dominantImpactKey(iv: any): string {
    return impactEntries(iv)[0]?.[0] || '';
}

function impactOverlapScore(oldIv: any, newIv: any): number {
    const oldEntries = impactEntries(oldIv);
    const newEntries = impactEntries(newIv);
    if (oldEntries.length === 0 || newEntries.length === 0) return 0;

    const newMap = new Map(newEntries);
    const overlap = oldEntries.reduce((sum, [key, value]) => sum + Math.min(value, newMap.get(key) || 0), 0);
    const oldTotal = oldEntries.reduce((sum, [, value]) => sum + value, 0);
    const newTotal = newEntries.reduce((sum, [, value]) => sum + value, 0);
    const normalizer = Math.max(oldTotal, newTotal, 1);
    return overlap / normalizer;
}

function interventionClass(iv: any): string {
    return String(iv?.substance?.class || '').trim();
}

function classesCompatible(oldIv: any, newIv: any): boolean {
    const oldClass = interventionClass(oldIv);
    const newClass = interventionClass(newIv);
    if (!oldClass || !newClass) return false;
    if (oldClass === newClass) return true;

    const focusClasses = new Set(['Stimulant', 'Nootropic']);
    const supportClasses = new Set(['Mineral/Electrolyte', 'Vitamin/Amino', 'Essential Fatty Acid']);
    const calmingClasses = new Set(['Adaptogen', 'Depressant/Sleep']);

    return (
        (focusClasses.has(oldClass) && focusClasses.has(newClass)) ||
        (supportClasses.has(oldClass) && supportClasses.has(newClass)) ||
        (calmingClasses.has(oldClass) && calmingClasses.has(newClass))
    );
}

function doseDistanceScore(oldIv: any, newIv: any): number {
    if (interventionDoseSignature(oldIv) === interventionDoseSignature(newIv)) return 0;
    const oldMultiplier = Number(oldIv?.doseMultiplier ?? 1);
    const newMultiplier = Number(newIv?.doseMultiplier ?? 1);
    return 10 + Math.abs(oldMultiplier - newMultiplier) * 20;
}

function replacementMatchScore(oldIv: any, newIv: any): number | null {
    const timeDelta = Math.abs((oldIv?.timeMinutes || 0) - (newIv?.timeMinutes || 0));
    if (timeDelta > 120) return null;

    const dominantOld = dominantImpactKey(oldIv);
    const dominantNew = dominantImpactKey(newIv);
    const dominantMatches = dominantOld.length > 0 && dominantOld === dominantNew;
    const overlap = impactOverlapScore(oldIv, newIv);
    const compatibleClass = classesCompatible(oldIv, newIv);

    if (!dominantMatches && overlap < 0.25 && !compatibleClass) {
        return null;
    }

    let score = timeDelta + doseDistanceScore(oldIv, newIv);
    if (dominantMatches) score -= 30;
    score -= overlap * 40;
    if (compatibleClass) score -= 20;
    if (oldIv?.key === newIv?.key) score -= 15;

    return score;
}

function ensureRevisionStableIds(interventions: any[], prefix: string): void {
    const seen = new Map<string, number>();
    interventions.forEach((iv: any, idx: number) => {
        if (!iv || iv._revisionStableId) return;
        const fingerprint = [
            iv.key || 'iv',
            iv.timeMinutes ?? '',
            interventionDoseSignature(iv),
            interventionSemanticSignature(iv),
        ].join('|');
        const occurrence = seen.get(fingerprint) || 0;
        seen.set(fingerprint, occurrence + 1);
        iv._revisionStableId = `${prefix}:${fingerprint}:${occurrence}:${idx}`;
    });
}

function sortInterventionItems(items: Array<{ iv: any; idx: number }>) {
    return [...items].sort(
        (a, b) =>
            (a.iv?.timeMinutes || 0) - (b.iv?.timeMinutes || 0) ||
            interventionDoseSignature(a.iv).localeCompare(interventionDoseSignature(b.iv)) ||
            interventionSemanticSignature(a.iv).localeCompare(interventionSemanticSignature(b.iv)) ||
            a.idx - b.idx,
    );
}

function hasSemanticChange(oldIv: any, newIv: any): boolean {
    return interventionSemanticSignature(oldIv) !== interventionSemanticSignature(newIv);
}

function classifyMatchedIntervention(oldIv: any, newIv: any): string | null {
    const timeDelta = Math.abs((oldIv?.timeMinutes || 0) - (newIv?.timeMinutes || 0));
    const doseDiff = interventionDoseSignature(oldIv) !== interventionDoseSignature(newIv);
    const semanticDiff = hasSemanticChange(oldIv, newIv);

    if (timeDelta > 15 && doseDiff) return 'moved+resized';
    if (timeDelta > 15) return 'moved';
    if (doseDiff) return 'resized';
    if (semanticDiff) return 'retargeted';
    return 'unchanged';
}

export function diffInterventions(oldIvs: any, newIvs: any) {
    ensureRevisionStableIds(oldIvs, 'old');
    ensureRevisionStableIds(newIvs, 'new');

    const diff: any[] = [];
    const matched = new Set<number>();
    const usedNew = new Set<number>();
    const keyedOld = new Map<string, Array<{ iv: any; idx: number }>>();
    const keyedNew = new Map<string, Array<{ iv: any; idx: number }>>();

    oldIvs.forEach((iv: any, idx: number) => {
        const key = iv?.key || '';
        if (!keyedOld.has(key)) keyedOld.set(key, []);
        keyedOld.get(key)!.push({ iv, idx });
    });
    newIvs.forEach((iv: any, idx: number) => {
        const key = iv?.key || '';
        if (!keyedNew.has(key)) keyedNew.set(key, []);
        keyedNew.get(key)!.push({ iv, idx });
    });

    // Pass 1: pair same-key interventions chronologically so duplicate doses stay aligned.
    const keys = new Set<string>([...keyedOld.keys(), ...keyedNew.keys()]);
    for (const key of keys) {
        const oldGroup = sortInterventionItems(keyedOld.get(key) || []);
        const newGroup = sortInterventionItems(keyedNew.get(key) || []);
        const pairCount = Math.min(oldGroup.length, newGroup.length);

        for (let pairIdx = 0; pairIdx < pairCount; pairIdx++) {
            const oldItem = oldGroup[pairIdx];
            const newItem = newGroup[pairIdx];
            matched.add(oldItem.idx);
            usedNew.add(newItem.idx);
            if (oldItem.iv?._revisionStableId) {
                newItem.iv._revisionStableId = oldItem.iv._revisionStableId;
            }

            const type = classifyMatchedIntervention(oldItem.iv, newItem.iv);
            if (type) {
                diff.push({ type, oldIv: oldItem.iv, newIv: newItem.iv });
            }
        }
    }

    // Pass 2: Unmatched old → replacement or removal
    for (let oi = 0; oi < oldIvs.length; oi++) {
        if (matched.has(oi)) continue;
        let bestNi = -1;
        let bestScore = Infinity;
        for (let ni = 0; ni < newIvs.length; ni++) {
            if (usedNew.has(ni)) continue;
            const score = replacementMatchScore(oldIvs[oi], newIvs[ni]);
            if (score == null) continue;
            if (score < bestScore) {
                bestScore = score;
                bestNi = ni;
            }
        }
        if (bestNi >= 0) {
            if (oldIvs[oi]?._revisionStableId) {
                newIvs[bestNi]._revisionStableId = oldIvs[oi]._revisionStableId;
            }
            diff.push({ type: 'replaced', oldIv: oldIvs[oi], newIv: newIvs[bestNi] });
            matched.add(oi);
            usedNew.add(bestNi);
        } else {
            diff.push({ type: 'removed', oldIv: oldIvs[oi], newIv: null });
            matched.add(oi);
        }
    }

    // Pass 3: Unmatched new → additions
    for (let ni = 0; ni < newIvs.length; ni++) {
        if (usedNew.has(ni)) continue;
        diff.push({ type: 'added', oldIv: null, newIv: newIvs[ni] });
    }

    // Sort chronologically by the relevant intervention's time
    diff.sort((a, b) => {
        const tA = (a.oldIv || a.newIv).timeMinutes;
        const tB = (b.oldIv || b.newIv).timeMinutes;
        return tA - tB;
    });
    return diff;
}

// ---- Pill Matching ----

export function findPillByIntervention(iv: any, timelineGroup: any, silent = false) {
    if (!iv || !timelineGroup) return null;

    const stableId = iv._revisionStableId;
    if (stableId) {
        const exactStableMatch = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group')).find(
            (pill: any) => pill.getAttribute('data-revision-stable-id') === stableId,
        );
        if (exactStableMatch) return exactStableMatch;
    }

    // Match by data-substance-key AND data-time-minutes proximity
    const candidates = timelineGroup.querySelectorAll(`.timeline-pill-group[data-substance-key="${iv.key}"]`);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
        // Multiple pills with same key — match by closest time
        let best: any = null,
            bestDelta = Infinity;
        for (const c of candidates) {
            const t = parseInt(c.getAttribute('data-time-minutes') || '0');
            const delta = Math.abs(t - iv.timeMinutes);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = c;
            }
        }
        if (best) return best;
    }

    // Fallback: match by name text + X proximity
    const name = iv.substance?.name || iv.key;
    const targetX = phaseChartX(iv.timeMinutes);
    const pills = timelineGroup.querySelectorAll('.timeline-pill-group');
    for (const pill of pills) {
        const label = pill.querySelector('.timeline-bar-label');
        if (!label) continue;
        const labelText = label.textContent || '';
        if (!labelText.toLowerCase().includes(name.toLowerCase())) continue;
        const bar = pill.querySelector('rect[rx]') || pill.querySelector('.timeline-bar');
        if (bar && Math.abs(parseFloat(bar.getAttribute('x')) - targetX) < 30) return pill;
    }
    if (!silent) {
        console.warn('[Revision] Could not find pill for:', iv.key, '@', iv.timeMinutes, 'min');
    }
    return null;
}

// ---- Pill Helpers ----

interface BarRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function getPillParts(pill: Element | null) {
    if (!pill) return { bar: null, label: null, connector: null, dot: null };
    return {
        bar: pill.querySelector('.timeline-bar') as SVGRectElement | null,
        label: pill.querySelector('.timeline-bar-label') as SVGTextElement | null,
        connector: pill.querySelector('.timeline-connector') as SVGLineElement | null,
        dot: pill.querySelector('.timeline-curve-dot') as SVGCircleElement | null,
    };
}

export function getPillBBox(pill: Element | any): BarRect {
    const { bar } = getPillParts(pill);
    if (!bar) return { x: 0, y: 0, width: 0, height: 0 };
    return {
        x: parseFloat(bar.getAttribute('x') || '0'),
        y: parseFloat(bar.getAttribute('y') || '0'),
        width: parseFloat(bar.getAttribute('width') || '0'),
        height: parseFloat(bar.getAttribute('height') || '0'),
    };
}

function getPillPoiAnchor(pill: any) {
    if (!pill) {
        return { x: PHASE_CHART.padL, y: TIMELINE_ZONE.top + TIMELINE_ZONE.laneH / 2 };
    }
    const { bar } = getPillParts(pill);
    if (bar) {
        const x = parseFloat(bar.getAttribute('x') || '0');
        const y = parseFloat(bar.getAttribute('y') || '0');
        const h = parseFloat(bar.getAttribute('height') || String(TIMELINE_ZONE.laneH));
        return { x, y: y + h / 2 };
    }
    const box = getPillBBox(pill);
    return { x: box.x, y: box.y + box.height / 2 };
}

// ---- Pill Morph Plan Builder ----

function prepareRevisionPillMorph(
    diff: any[],
    oldInterventions: any[],
    newInterventions: any[],
    tempGroup: Element,
    timelineGroup: Element,
    newLxCurves: any[],
): PillMorphPlan {
    const oldAlloc = allocateTimelineLanes(oldInterventions);
    const newAlloc = allocateTimelineLanes(newInterventions);
    const oldGeoMap = computePillGeometry(oldAlloc);
    const newGeoMap = computePillGeometry(newAlloc);

    const plan: PillMorphPlan = { matched: [], removed: [], added: [] };
    const teleportThresholdPx = (TELEPORT.thresholdMin / PHASE_CHART.totalMin) * PHASE_CHART.plotW;

    for (const entry of diff) {
        const type = entry.type;

        if (
            type === 'unchanged' ||
            type === 'lane-shifted' ||
            type === 'moved' ||
            type === 'resized' ||
            type === 'moved+resized' ||
            type === 'retargeted'
        ) {
            // Matched: old pill interpolates to new position
            const oldPill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup) : null;
            const oldGeo = entry.oldIv ? oldGeoMap.get(entry.oldIv) : null;
            const newGeo = entry.newIv ? newGeoMap.get(entry.newIv) : null;
            if (oldPill && oldGeo && newGeo) {
                const doseMorph = parseDoseMorph(entry.oldIv, entry.newIv);
                // Portal ghost for large moves
                let ghost: SVGGElement | null = null;
                const laneDist = Math.abs(newGeo.laneIdx - oldGeo.laneIdx);
                if (Math.abs(newGeo.x - oldGeo.x) > teleportThresholdPx || laneDist >= TELEPORT.thresholdLanes) {
                    ghost = buildMorphPillNode(newGeo, newLxCurves);
                    ghost.setAttribute('opacity', '0');
                    ghost.removeAttribute('data-substance-key');
                    ghost.removeAttribute('data-time-minutes');
                    (tempGroup.parentElement || tempGroup).appendChild(ghost);
                }
                plan.matched.push({
                    from: oldGeo,
                    to: newGeo,
                    el: oldPill as SVGGElement,
                    doseMorph,
                    ghost,
                });
            }
            // Remove the corresponding new pill from timelineGroup (we'll use the old pill's DOM)
            const newPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup, true) : null;
            if (newPill) newPill.remove();
        } else if (type === 'removed') {
            const oldPill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup) : null;
            const oldGeo = entry.oldIv ? oldGeoMap.get(entry.oldIv) : null;
            if (oldPill && oldGeo) {
                plan.removed.push({ geo: oldGeo, el: oldPill as SVGGElement });
            }
        } else if (type === 'added') {
            const newGeo = entry.newIv ? newGeoMap.get(entry.newIv) : null;
            if (newGeo) {
                // Find the pre-rendered pill from renderSubstanceTimeline
                const existingPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup, true) : null;
                if (existingPill) {
                    const doseMorph = parseDoseFromZero(entry.newIv);
                    plan.added.push({ geo: newGeo, el: existingPill as SVGGElement, doseMorph });
                } else {
                    // Build a new pill node
                    const el = buildMorphPillNode(newGeo, newLxCurves);
                    timelineGroup.appendChild(el);
                    const doseMorph = parseDoseFromZero(entry.newIv);
                    plan.added.push({ geo: newGeo, el, doseMorph });
                }
            }
        } else if (type === 'replaced') {
            // Old pill removed, new pill added
            const oldPill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup) : null;
            const oldGeo = entry.oldIv ? oldGeoMap.get(entry.oldIv) : null;
            if (oldPill && oldGeo) {
                plan.removed.push({ geo: oldGeo, el: oldPill as SVGGElement });
            }
            const newGeo = entry.newIv ? newGeoMap.get(entry.newIv) : null;
            if (newGeo) {
                const existingPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup, true) : null;
                if (existingPill) {
                    const doseMorph = parseDoseFromZero(entry.newIv);
                    plan.added.push({ geo: newGeo, el: existingPill as SVGGElement, doseMorph });
                } else {
                    const el = buildMorphPillNode(newGeo, newLxCurves);
                    timelineGroup.appendChild(el);
                    const doseMorph = parseDoseFromZero(entry.newIv);
                    plan.added.push({ geo: newGeo, el, doseMorph });
                }
            }
        }
    }

    return plan;
}

// ---- Revision Remove Tick (connector retraction callback) ----

function revisionRemoveTick(el: SVGGElement, geo: PillGeometry, t: number): void {
    // Fade + shrink pill bar (same as default but with connector retraction)
    const fadeProgress = Math.min(1, t / 0.5);
    const opacity = Math.max(0, 1 - fadeProgress);
    const scale = 1 - 0.15 * fadeProgress;
    const cx = geo.x + geo.width / 2;
    const cy = geo.y + TIMELINE_ZONE.laneH / 2;
    el.setAttribute('opacity', opacity.toFixed(3));
    el.setAttribute(
        'transform',
        `translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) scale(${scale.toFixed(3)}) translate(${(-cx).toFixed(1)}, ${(-cy).toFixed(1)})`,
    );

    // 3-phase connector retraction
    const connector = el.querySelector('.timeline-connector') as SVGLineElement | null;
    const dot = el.querySelector('.timeline-curve-dot') as SVGCircleElement | null;
    if (connector) {
        const connY1 = parseFloat(connector.getAttribute('y1') || '0');
        const origY2 = parseFloat(connector.getAttribute('data-orig-y2') || connector.getAttribute('y2') || '0');
        const connDist = origY2 - connY1;
        const connStartOpacity = 0.25;
        const BRIGHTEN_END = 0.2;
        const RETRACT_END = 0.8;
        const peakOpacity = 0.55;
        let connOpacity: number;
        let retractEase: number;
        if (t < BRIGHTEN_END) {
            connOpacity = connStartOpacity + (peakOpacity - connStartOpacity) * (t / BRIGHTEN_END);
            retractEase = 0;
        } else if (t < RETRACT_END) {
            connOpacity = peakOpacity;
            retractEase = easeInOutCubic((t - BRIGHTEN_END) / (RETRACT_END - BRIGHTEN_END));
        } else {
            connOpacity = peakOpacity * (1 - (t - RETRACT_END) / (1 - RETRACT_END));
            retractEase = 1;
        }
        connector.setAttribute('y2', (origY2 - connDist * retractEase).toFixed(1));
        connector.setAttribute('stroke-opacity', connOpacity.toFixed(3));
        connector.setAttribute('stroke-width', (0.75 + 1.25 * (1 - retractEase)).toFixed(2));
        if (retractEase > 0) connector.removeAttribute('stroke-dasharray');
    }
    if (dot) {
        const dotFadeT = clamp((t - 0.6) * 2.5, 0, 1);
        dot.setAttribute('fill-opacity', (0.6 * (1 - dotFadeT)).toFixed(3));
    }
}

// ---- Scan Line ----

function createRevisionDayScanLine(svg: any, timelineLayer: any, oldLayer: any, newLayer: any) {
    const isLight = isLightMode();
    const lineColor = isLight ? 'rgba(180, 83, 9, 0.85)' : 'rgba(251, 191, 36, 0.9)';
    const coreColor = isLight ? 'rgba(146, 64, 14, 0.92)' : 'rgba(253, 224, 71, 0.95)';
    const glowColor = isLight ? 'rgba(180, 83, 9, 0.18)' : 'rgba(251, 191, 36, 0.2)';
    const markerColor = isLight ? '#b45309' : '#fbbf24';
    const HALO_BASE = 0.24;
    const SWEEP_SPEED_PX_PER_MS = 0.036; // ~22.8s across full plot width (40% slower than 0.06)

    const boxes: any[] = [];
    const collect = (layer: any) => {
        if (!layer) return;
        layer.querySelectorAll('.timeline-pill-group').forEach((pill: any) => {
            const box = getPillBBox(pill);
            if (Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.height)) {
                boxes.push(box);
            }
        });
    };
    collect(oldLayer);
    collect(newLayer);

    const top = boxes.length > 0 ? Math.min(...boxes.map((b: any) => b.y)) - 12 : TIMELINE_ZONE.top - 12;
    const bottom =
        boxes.length > 0
            ? Math.max(...boxes.map((b: any) => b.y + b.height)) + 12
            : TIMELINE_ZONE.top + 6 * (TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap);
    const zoneH = Math.max(28, bottom - top);
    const dotY = top - 6;

    const g = svgEl('g', {
        class: 'revision-day-scan',
        opacity: '0',
        'pointer-events': 'none',
    });
    const glow = svgEl('rect', {
        class: 'revision-day-scan-glow',
        x: (PHASE_CHART.padL - 6).toFixed(1),
        y: top.toFixed(1),
        width: '14',
        height: zoneH.toFixed(1),
        fill: glowColor,
        rx: '7',
        opacity: '0.9',
    });
    const line = svgEl('rect', {
        class: 'revision-day-scan-line',
        x: (PHASE_CHART.padL - 1).toFixed(1),
        y: top.toFixed(1),
        width: '2',
        height: zoneH.toFixed(1),
        fill: lineColor,
        opacity: '0.9',
    });
    const core = svgEl('rect', {
        class: 'revision-day-scan-core',
        x: (PHASE_CHART.padL - 0.5).toFixed(1),
        y: top.toFixed(1),
        width: '1',
        height: zoneH.toFixed(1),
        fill: coreColor,
        opacity: '0.9',
    });
    const marker = svgEl('circle', {
        class: 'revision-day-scan-marker',
        cx: PHASE_CHART.padL.toFixed(1),
        cy: dotY.toFixed(1),
        r: '3.4',
        fill: markerColor,
        opacity: '0.92',
    });
    const halo = svgEl('circle', {
        class: 'revision-day-scan-halo',
        cx: PHASE_CHART.padL.toFixed(1),
        cy: dotY.toFixed(1),
        r: '7',
        fill: markerColor,
        opacity: String(HALO_BASE),
    });
    g.appendChild(glow);
    g.appendChild(line);
    g.appendChild(core);
    g.appendChild(marker);
    g.appendChild(halo);
    timelineLayer.appendChild(g);

    let currentX = PHASE_CHART.padL;
    const setX = (x: number) => {
        glow.setAttribute('x', (x - 7).toFixed(1));
        line.setAttribute('x', (x - 1).toFixed(1));
        core.setAttribute('x', (x - 0.5).toFixed(1));
        marker.setAttribute('cx', x.toFixed(1));
        halo.setAttribute('cx', x.toFixed(1));
    };

    return {
        setX,
        async intro() {
            await animateSvgOpacity(g, 0, 1, 220);
        },
        async primeWithSleepContext(hasSleepContext: boolean) {
            if (!hasSleepContext) return;
            await this.pulse(280);
            await sleep(110);
            await this.pulse(220);
            await sleep(80);
        },
        async moveTo(x: number) {
            const targetX = Number.isFinite(x) ? x : currentX;
            if (isTurboActive()) {
                setX(targetX);
                currentX = targetX;
                return;
            }
            const dist = Math.abs(targetX - currentX);
            if (dist < 0.6) {
                setX(targetX);
                currentX = targetX;
                return;
            }

            const duration = Math.max(120, Math.min(1300, dist / SWEEP_SPEED_PX_PER_MS));
            const start = performance.now();
            const fromX = currentX;

            await new Promise<void>(resolve => {
                (function tick(now: number) {
                    const rawT = Math.min(1, (now - start) / duration);
                    const xPos = fromX + (targetX - fromX) * rawT; // linear for scan feel
                    setX(xPos);
                    if (rawT < 1) requestAnimationFrame(tick);
                    else resolve();
                })(performance.now());
            });

            currentX = targetX;
        },
        pulse(duration = 240) {
            if (isTurboActive()) return Promise.resolve();
            return new Promise<void>(resolve => {
                const start = performance.now();
                (function tick(now: number) {
                    const rawT = Math.min(1, (now - start) / duration);
                    const pulseT = rawT < 0.5 ? rawT / 0.5 : (1 - rawT) / 0.5;
                    const haloR = 7 + 9 * pulseT;
                    const haloOp = HALO_BASE + 0.58 * pulseT;
                    const lineOp = 0.72 + 0.26 * pulseT;
                    const glowOp = 0.78 + 0.22 * pulseT;
                    const glowW = 14 + 7 * pulseT;

                    halo.setAttribute('r', haloR.toFixed(2));
                    halo.setAttribute('opacity', haloOp.toFixed(3));
                    line.setAttribute('opacity', lineOp.toFixed(3));
                    core.setAttribute('opacity', Math.min(1, lineOp + 0.06).toFixed(3));
                    glow.setAttribute('opacity', glowOp.toFixed(3));
                    glow.setAttribute('width', glowW.toFixed(2));
                    glow.setAttribute('x', (currentX - glowW / 2).toFixed(1));

                    if (rawT < 1) {
                        requestAnimationFrame(tick);
                    } else {
                        halo.setAttribute('r', '7');
                        halo.setAttribute('opacity', String(HALO_BASE));
                        line.setAttribute('opacity', '0.9');
                        core.setAttribute('opacity', '0.9');
                        glow.setAttribute('opacity', '0.9');
                        glow.setAttribute('width', '14');
                        glow.setAttribute('x', (currentX - 7).toFixed(1));
                        resolve();
                    }
                })(performance.now());
            });
        },
        async sweepToDayEnd() {
            await this.moveTo(PHASE_CHART.padL + PHASE_CHART.plotW);
        },
        /**
         * Continuous sweep from current X to plotRight at constant speed.
         * Returns a promise that resolves when sweep completes.
         * Calls onCross(scanX) each time the line passes a registered X position.
         */
        sweepFull(targetX: number, durationMs: number): Promise<void> {
            if (isTurboActive()) {
                setX(targetX);
                currentX = targetX;
                return Promise.resolve();
            }
            const fromX = currentX;
            const start = performance.now();
            return new Promise<void>(resolve => {
                (function tick(now: number) {
                    const rawT = Math.min(1, (now - start) / durationMs);
                    const xPos = fromX + (targetX - fromX) * rawT;
                    setX(xPos);
                    currentX = xPos;
                    if (rawT < 1) requestAnimationFrame(tick);
                    else resolve();
                })(performance.now());
            });
        },
        async outro() {
            const from = parseFloat(g.getAttribute('opacity') || '1');
            await animateSvgOpacity(g, from, 0, 220);
            g.remove();
        },
        remove() {
            g.remove();
        },
    };
}

// ---- Pill Visual Opacity + POI Helpers ----

function getPillVisualOpacity(pill: any): number {
    if (!pill) return 0;
    const attrOpacity = parseFloat(pill.getAttribute('opacity') || '1');
    const styleOpacity = parseFloat(window.getComputedStyle(pill).opacity || '1');
    const groupOpacity = Number.isFinite(attrOpacity) ? attrOpacity : 1;
    const resolvedOpacity = Number.isFinite(styleOpacity) ? Math.min(groupOpacity, styleOpacity) : groupOpacity;
    return clamp(resolvedOpacity, 0, 1);
}

function setPoiEntryAnchor(entry: any, pill: any | null) {
    const pois = (BiometricState as any)._pois || [];
    for (const poi of pois) {
        if ((entry?.oldIv && poi._oldIv === entry.oldIv) || (entry?.newIv && poi._newIv === entry.newIv)) {
            poi._activePill = pill;
        }
    }
}

function resolvePoiAnchorPill(poi: any, oldLayer: any, newLayer: any) {
    if (poi?._activePill && poi._activePill.isConnected) {
        return { pill: poi._activePill, opacity: getPillVisualOpacity(poi._activePill) };
    }
    const oldPill = poi._oldIv ? findPillByIntervention(poi._oldIv, oldLayer, true) : null;
    const newPill = poi._newIv ? findPillByIntervention(poi._newIv, newLayer, true) : null;
    const oldOpacity = getPillVisualOpacity(oldPill);
    const newOpacity = getPillVisualOpacity(newPill);

    if (newPill && (newOpacity > oldOpacity + 0.08 || oldOpacity <= 0.02)) {
        return { pill: newPill, opacity: newOpacity };
    }
    if (oldPill && oldOpacity > 0.02) {
        return { pill: oldPill, opacity: oldOpacity };
    }
    if (newPill) {
        return { pill: newPill, opacity: newOpacity };
    }
    return { pill: oldPill, opacity: oldOpacity };
}

function updatePoiConnectorPath(g: SVGElement, poi: any, pillX: number, pillY: number) {
    const path = g.querySelector('path');
    if (!path) return;

    const isBezier = path.classList.contains('poi-line-bezier');
    let pathD = '';
    if (isBezier) {
        const midX = (poi.bioSvgX + pillX) / 2;
        const midY = (poi.bioSvgY + pillY) / 2 - 20;
        pathD = `M${poi.bioSvgX},${poi.bioSvgY} Q${midX},${midY} ${pillX},${pillY}`;
    } else {
        const midY = (poi.bioSvgY + pillY) / 2;
        pathD = `M${poi.bioSvgX},${poi.bioSvgY} L${poi.bioSvgX},${midY} L${pillX},${midY} L${pillX},${pillY}`;
    }
    path.setAttribute('d', pathD);
}

function updatePoiConnectorVisuals(container: SVGElement, oldLayer: any, newLayer: any): void {
    const pois = (BiometricState as any)._pois || [];
    if (pois.length === 0) return;

    const groups = Array.from(container.querySelectorAll('.poi-connector-group'));
    if (groups.length !== pois.length) return;

    for (let i = 0; i < pois.length; i++) {
        const poi = pois[i];
        const g = groups[i] as SVGElement;
        const { pill, opacity } = resolvePoiAnchorPill(poi, oldLayer, newLayer);
        if (!pill) continue;

        const anchor = getPillPoiAnchor(pill);
        const pillX = anchor.x;
        const pillY = anchor.y;
        poi.pillSvgX = pillX;
        poi.pillSvgY = pillY;

        updatePoiConnectorPath(g, poi, pillX, pillY);

        const path = g.querySelector('path') as SVGPathElement | null;
        const pillDot = Array.from(g.querySelectorAll('circle')).find(
            el => !el.classList.contains('poi-dot') && !el.classList.contains('poi-pulse-ring'),
        ) as SVGCircleElement | null;
        const pathBaseOpacity = parseFloat(
            path?.dataset.baseStrokeOpacity || path?.getAttribute('stroke-opacity') || '0.45',
        );
        const connectorOpacity = Math.max(0.12, Math.min(1, opacity));

        if (path) {
            path.dataset.baseStrokeOpacity = String(pathBaseOpacity);
            path.setAttribute('stroke-opacity', (pathBaseOpacity * (0.2 + 0.8 * connectorOpacity)).toFixed(3));
        }
        if (pillDot) {
            pillDot.setAttribute('cx', pillX.toFixed(1));
            pillDot.setAttribute('cy', pillY.toFixed(1));
            pillDot.setAttribute('opacity', connectorOpacity.toFixed(3));
        }
    }
}

function startPoiConnectorTracking(oldLayer: any, newLayer: any) {
    const container = document.getElementById('phase-poi-connectors') as unknown as SVGElement | null;
    if (!container || !((BiometricState as any)._pois || []).length) {
        return () => {};
    }

    let rafId: number | null = null;
    let stopped = false;

    const tick = () => {
        if (stopped) return;
        updatePoiConnectorVisuals(container, oldLayer, newLayer);
        rafId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
        stopped = true;
        if (rafId != null) cancelAnimationFrame(rafId);
        updatePoiConnectorVisuals(container, oldLayer, newLayer);
    };
}

// ---- Main Revision Animation ----

export async function animateRevisionScan(
    diff: any,
    newInterventions: any,
    newLxCurves: any,
    curvesData: any,
    narration?: { intro: string; beats: any[]; outro: string } | null,
    options: RevisionAnimationOptions = {},
) {
    const svg = document.getElementById('phase-chart-svg');
    const timelineGroup = document.getElementById('phase-substance-timeline');
    if (!svg || !timelineGroup) return;

    if (diff.length === 0) {
        renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
        preserveBiometricStrips();
        revealTimelinePillsInstant();
        return;
    }

    console.log(
        '[RevAnim] Diff summary: ' +
            diff
                .map(
                    (e: any) =>
                        `${e.type}: ${e.oldIv?.key ?? '—'}@${e.oldIv?.timeMinutes ?? '—'} → ${e.newIv?.key ?? '—'}@${e.newIv?.timeMinutes ?? '—'}`,
                )
                .join(', '),
    );

    revealTimelinePillsInstant();
    timelineGroup.classList.add('revision-animating');

    // Phase 0a: Snapshot OLD pills into temp group
    const tempGroup = svgEl('g', { id: 'phase-substance-timeline-old' });
    const oldPills = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group'));
    // Collect old interventions from the pills for lane counting
    const oldInterventions = diff
        .filter((e: any) => e.oldIv)
        .map((e: any) => e.oldIv)
        .filter((v: any, i: number, a: any[]) => a.indexOf(v) === i); // dedupe

    oldPills.forEach(pill => {
        const clippedG = pill.querySelector('[clip-path]');
        if (clippedG) clippedG.removeAttribute('clip-path');
        tempGroup.appendChild(pill);
    });
    svg.insertBefore(tempGroup, timelineGroup);

    // Phase 0b: Render NEW layout invisibly
    const svgEl_ = svg as unknown as SVGSVGElement;
    const savedViewBox = svgEl_.getAttribute('viewBox');
    renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
    if (savedViewBox) {
        const parsed = savedViewBox.trim().split(/\s+/).map(Number);
        if (parsed.length === 4 && parsed.every(n => Number.isFinite(n))) {
            animatePhaseChartViewBoxHeight(svgEl_, parsed[3], 0);
        }
    }
    const newPills = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group'));
    newPills.forEach((pill: any) => {
        pill.setAttribute('opacity', '0');
        pill.setAttribute('visibility', 'hidden');
        pill.classList.add('revision-prehidden');
    });

    preserveBiometricStrips(false);

    // Phase 0c: Build pill morph plan using shared engine
    // Stash original y2 on removed pill connectors for retraction animation
    for (const entry of diff) {
        if (entry.type === 'removed' || entry.type === 'replaced') {
            const pill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup, true) : null;
            if (pill) {
                const conn = pill.querySelector('.timeline-connector') as SVGLineElement | null;
                if (conn) conn.setAttribute('data-orig-y2', conn.getAttribute('y2') || '0');
            }
        }
    }

    const pillPlan = prepareRevisionPillMorph(
        diff,
        oldInterventions,
        newInterventions,
        tempGroup,
        timelineGroup,
        newLxCurves,
    );

    // Build curve context for connector tracking
    const curveCtx: PillMorphCurveCtx = {
        fromLxPoints: (curvesData || []).map((c: any, i: number) => {
            // Use the current Lx curves (pre-revision) as "from"
            const existing = (window as any).__phaseState?.lxCurves?.[i]?.points;
            return existing || newLxCurves[i]?.points || [];
        }),
        toLxPoints: (newLxCurves || []).map((lx: any) => lx?.points || []),
    };

    // Compute bio shift (lane delta between old and new layout)
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const oldLaneCount = computeLaneCount(allocateTimelineLanes(oldInterventions));
    const newLaneCount = computeLaneCount(allocateTimelineLanes(newInterventions));
    const bioGroupEl = document.getElementById('phase-biometric-strips');
    const spotterGroupEl = document.getElementById('phase-spotter-highlights');
    let bioStartTY = 0;
    if (bioGroupEl) {
        const m = (bioGroupEl.getAttribute('transform') || '').match(
            /translate\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)\s*\)/,
        );
        bioStartTY = m ? parseFloat(m[1]) || 0 : 0;
    }
    const bioDeltaY = (newLaneCount - oldLaneCount) * laneStep;
    const savedVBParts = (svgEl_.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
    const startViewBoxH = savedVBParts.length === 4 ? savedVBParts[3] : 500;

    // Build Sherlock narration
    const refinedDiff = diff
        .map((entry: any, origIdx: number) => ({ ...entry, _origIdx: origIdx }))
        .filter((entry: any) => entry.type !== 'unchanged' && entry.type !== 'lane-shifted');
    const refinedNarration = narration
        ? { ...narration, beats: refinedDiff.map((entry: any) => narration.beats[entry._origIdx]).filter(Boolean) }
        : null;
    const sherlockCtx = {
        sherlockRevisionNarration: refinedNarration,
        revisionDiff: refinedDiff,
        curvesData,
    } as any;
    const cards = buildSherlockRevisionCards(sherlockCtx);
    if (cards.length > 0) showNarrationPanel();

    // Build Sherlock trigger X positions sorted left-to-right
    const sherlockTriggers = refinedDiff
        .map((e: any, idx: number) => ({
            x: phaseChartX((e.oldIv || e.newIv)?.timeMinutes ?? PHASE_CHART.startMin),
            cardIdx: idx,
        }))
        .sort((a: any, b: any) => a.x - b.x);

    // Build morphLxStep entries
    const morphEntries = refinedDiff
        .filter((e: any) => e.type !== 'unchanged' && e.type !== 'lane-shifted')
        .sort((a: any, b: any) => (a._origIdx ?? 0) - (b._origIdx ?? 0));
    const morphDurPerEntry = Math.max(200, Math.floor(2400 / Math.max(1, morphEntries.length)));

    // POI + scan line setup
    const dayScan = createRevisionDayScanLine(svg, timelineGroup, tempGroup, timelineGroup);
    const stopPoiTracking = startPoiConnectorTracking(tempGroup, timelineGroup);

    // Set POI anchors for all entries before animation
    for (const entry of diff) {
        const pill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup, true) : null;
        const newPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup, true) : null;
        setPoiEntryAnchor(entry, pill || newPill);
    }

    let cursorClosed = false;

    try {
        // Scan line intro
        const hasSleepContext = (BiometricState.channels || []).some((ch: any) => {
            const sig = String(ch?.signal || '').toLowerCase();
            return sig.startsWith('sleep_') || sig.includes('sleep');
        });
        await dayScan.intro();
        await dayScan.primeWithSleepContext(hasSleepContext);

        // Turbo: skip animation
        if (isTurboActive()) {
            tickPillMorph(pillPlan, 1, curveCtx, { onRemoveTick: revisionRemoveTick });
            cards.forEach((_: any, i: number) => {
                if (cards.length > i) showSherlockStack(cards, i);
            });
            for (let mi = 0; mi < morphEntries.length; mi++) {
                await Promise.resolve(options.morphLxStep?.(morphEntries[mi], morphEntries[mi]._origIdx ?? mi, 0));
            }
            if (bioGroupEl && bioDeltaY !== 0) {
                const finalTY = bioStartTY + bioDeltaY;
                bioGroupEl.setAttribute('transform', `translate(0,${finalTY.toFixed(2)})`);
                if (spotterGroupEl) spotterGroupEl.setAttribute('transform', `translate(0,${finalTY.toFixed(2)})`);
            }
            svgEl_.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${startViewBoxH + bioDeltaY}`);
        } else {
            // Move scan line to first trigger position
            const firstX = sherlockTriggers.length > 0 ? sherlockTriggers[0].x - 8 : PHASE_CHART.padL;
            await dayScan.moveTo(firstX);

            // ── SINGLE rAF LOOP — constant speed, 5 seconds ──
            const plotStartX = firstX;
            const plotEndX = PHASE_CHART.padL + PHASE_CHART.plotW;
            const visualSweepDist = Math.max(1, plotEndX - plotStartX);

            // Each pill's animation completes over this many px after the scan line touches it
            const PILL_ANIM_WINDOW_PX = Math.max(55, visualSweepDist * 0.17);

            // Extend effective sweep so rightmost pills have runway to complete animation
            const sweepDist = visualSweepDist + PILL_ANIM_WINDOW_PX;
            const DURATION = 5000;

            let nextCard = 0;
            let nextMorph = 0;
            const morphPromises: Promise<void>[] = [];

            // Build sorted X positions for morphLxStep triggers (same order as morphEntries)
            const morphTriggerXs = morphEntries.map((e: any) =>
                phaseChartX((e.oldIv || e.newIv)?.timeMinutes ?? PHASE_CHART.startMin),
            );

            // Bio strip: smooth 400ms ease-out animation + POI connector tracking
            const BIO_ANIM_DUR = 400;
            const pois: any[] = (BiometricState as any)._pois || [];
            const poiContainer = document.getElementById('phase-poi-connectors');
            const poiGroups = poiContainer ? Array.from(poiContainer.querySelectorAll('.poi-connector-group')) : [];
            const poiBioStartYs = pois.map((p: any) => p.bioSvgY as number);

            await new Promise<void>(resolve => {
                const startTs = performance.now();

                (function tick(now: number) {
                    const rawT = Math.min(1, (now - startTs) / DURATION);

                    // 1. Advance scan line at constant speed
                    const scanX = plotStartX + sweepDist * rawT;
                    dayScan.setX(Math.min(scanX, plotEndX));

                    // 2. Per-pill easing: each pill animates from when scanX reaches it
                    const easeForX = (pillX: number) => {
                        const localT = clamp((scanX - pillX) / PILL_ANIM_WINDOW_PX, 0, 1);
                        // Apply easeInOutCubic to the local progress for smooth feel
                        return easeInOutCubic(localT);
                    };
                    tickPillMorph(pillPlan, rawT, curveCtx, {
                        onRemoveTick: revisionRemoveTick,
                        easeForX,
                    });

                    // 3. Fire Sherlock cards as scan crosses X thresholds
                    while (nextCard < sherlockTriggers.length && scanX >= sherlockTriggers[nextCard].x) {
                        if (cards.length > nextCard) showSherlockStack(cards, nextCard);
                        nextCard++;
                    }

                    // 4. Fire morphLxStep as scan crosses each substance's X position
                    while (nextMorph < morphEntries.length) {
                        const triggerX = morphTriggerXs[nextMorph];
                        if (scanX >= triggerX) {
                            const entry = morphEntries[nextMorph];
                            morphPromises.push(
                                Promise.resolve(
                                    options.morphLxStep?.(entry, entry._origIdx ?? nextMorph, morphDurPerEntry),
                                ),
                            );
                            nextMorph++;
                        } else {
                            break;
                        }
                    }

                    // 5. Smooth bio strip slide (400ms ease-out at start of scan) + POI tracking
                    if (bioDeltaY !== 0) {
                        const bioT = Math.min(1, (now - startTs) / BIO_ANIM_DUR);
                        const bioEase = 1 - Math.pow(1 - bioT, 3); // ease-out cubic
                        const bioDelta = bioDeltaY * bioEase;
                        const ty = bioStartTY + bioDelta;
                        if (bioGroupEl) bioGroupEl.setAttribute('transform', `translate(0,${ty.toFixed(2)})`);
                        if (spotterGroupEl) spotterGroupEl.setAttribute('transform', `translate(0,${ty.toFixed(2)})`);
                        const newH = startViewBoxH + bioDelta;
                        svgEl_.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${newH.toFixed(1)}`);

                        // Shift POI bio-side dots + connector paths to track bio strip
                        for (let pi = 0; pi < pois.length; pi++) {
                            const poi = pois[pi];
                            poi.bioSvgY = poiBioStartYs[pi] + bioDelta;
                            if (pi >= poiGroups.length) continue;
                            const pg = poiGroups[pi] as SVGElement;
                            const dot = pg.querySelector('.poi-dot') as SVGCircleElement | null;
                            if (dot) dot.setAttribute('cy', poi.bioSvgY.toFixed(1));
                            const pulse = pg.querySelector('.poi-pulse-ring') as SVGCircleElement | null;
                            if (pulse) pulse.setAttribute('cy', poi.bioSvgY.toFixed(1));
                        }
                    }

                    if (rawT < 1) {
                        requestAnimationFrame(tick);
                    } else {
                        resolve();
                    }
                })(performance.now());
            });

            // Wait for any remaining morph steps
            await Promise.all(morphPromises);
        }

        // Scan sweep already covers full plot + pill animation runway; no separate sweepToDayEnd needed

        // Cleanup: remove tempGroup, finalize pills
        Array.from(tempGroup.children).forEach((pill: any) => {
            if (pill.classList?.contains('timeline-pill-group')) {
                pill.remove();
            }
        });

        // Move matched pills from tempGroup to timelineGroup and clear transforms
        for (const { el, ghost } of pillPlan.matched) {
            el.removeAttribute('transform');
            el.setAttribute('opacity', '1');
            if (el.parentElement !== timelineGroup && el.isConnected) {
                timelineGroup.appendChild(el);
            }
            if (ghost) ghost.remove();
        }
        // Remove removed pills
        for (const { el } of pillPlan.removed) {
            el.remove();
        }
        // Finalize added pills
        for (const { el } of pillPlan.added) {
            el.removeAttribute('transform');
            (el as SVGElement).style.removeProperty('opacity');
            el.setAttribute('opacity', '1');
            el.classList.remove('revision-prehidden');
            el.removeAttribute('visibility');
        }

        // Final DOM rebuild: render the definitive new timeline so positions are exact.
        // Lock the viewBox height so the re-render doesn't cause a visual jump.
        const preRenderVB = svgEl_.getAttribute('viewBox');
        renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
        if (preRenderVB) {
            const parts = preRenderVB.trim().split(/\s+/).map(Number);
            if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
                animatePhaseChartViewBoxHeight(svgEl_, parts[3], 0);
            }
        }
        revealTimelinePillsInstant();

        // Leave bio strip & spotter group transforms from the animation loop
        // in place. Calling preserveBiometricStrips here would do a full DOM
        // teardown + rebuild of the bio strips, causing a visible jitter/pop.
        // The transforms position everything correctly already.

        if (narration?.outro && cards.length > 0) {
            showSherlockStack(cards, cards.length - 1);
        }

        await dayScan.outro();
        if (cards.length > 0) enableSherlockScrollMode();
        updateGamificationCurveData(newLxCurves);
        cursorClosed = true;
    } finally {
        timelineGroup.classList.remove('revision-animating');
        Array.from(timelineGroup.querySelectorAll('.timeline-pill-group')).forEach((pill: any) => {
            pill.classList.remove('revision-prehidden');
            pill.removeAttribute('visibility');
            pill.style.removeProperty('opacity');
            const currentOp = parseFloat(pill.getAttribute('opacity') || '1');
            if (currentOp < 0.5) pill.setAttribute('opacity', '1');
        });
        stopPoiTracking();
        if (!cursorClosed) dayScan.remove();
        tempGroup.remove();
        if (!cursorClosed) preserveBiometricStrips(true, true);
    }
}
