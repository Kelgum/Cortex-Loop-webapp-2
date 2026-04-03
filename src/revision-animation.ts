/**
 * Revision Animation — Revision diff animation: pill move/resize/flip/add/remove, scan line sweep.
 * Exports: diffInterventions, animateRevisionScan
 * Depends on: constants (PHASE_CHART, TIMELINE_ZONE), state (BiometricState), utils, svg-animate, lx-system, sherlock
 */
import { PHASE_CHART, TIMELINE_ZONE, TELEPORT } from './constants';
import { BiometricState, isTurboActive } from './state';
import { easeInOutCubic, easeOutCubic } from './timeline-engine';
import { svgEl, phaseChartX, sleep, isLightMode, clamp, teleportInterpolation } from './utils';
import { animateSvgOpacity } from './svg-animate';
import {
    renderSubstanceTimeline,
    preserveBiometricStrips,
    revealTimelinePillsInstant,
    getBioSeparatorEffectiveY,
    getTimelineBottomY,
    slideBiometricZoneDown,
    animatePhaseChartViewBoxHeight,
} from './lx-system';
import { showNarrationPanel, showSherlockStack, enableSherlockScrollMode } from './sherlock';
import { buildSherlockRevisionCards } from './timeline-segments/sherlock-segments';
import { updateGamificationCurveData } from './gamification-overlay';

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
    const supportClasses = new Set(['Mineral/Electrolyte', 'Vitamin/Amino']);
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

/** Check if two pill bounding boxes overlap spatially (same lane + overlapping X span). */
function _boxesOverlap(a: BarRect, b: BarRect): boolean {
    if (a.width <= 0 || b.width <= 0 || a.height <= 0 || b.height <= 0) return false;
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

interface BarRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

// ---- Pill Helpers ----

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

// ---- Animation Primitives ----

/**
 * Move a pill from one position to another via a smooth path.
 * Animates bar + label positions directly (not via group transform)
 * so only the visible bar unit moves — connector and dot stay hidden.
 */
function animateMove(
    pill: Element | null,
    from: BarRect,
    to: BarRect,
    duration = 1100,
    targetLabelPos?: { x: number; y: number } | null,
): Promise<void> {
    if (!pill) return Promise.resolve();
    if (isTurboActive()) {
        snapPillToTarget(pill, to);
        return Promise.resolve();
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dw = to.width - from.width;

    // Determine if this move is large enough to warrant a portal effect
    const teleportThresholdPx = (TELEPORT.thresholdMin / PHASE_CHART.totalMin) * PHASE_CHART.plotW;
    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const laneDist = Math.abs(dy) / laneStep;
    const isTeleport = Math.abs(dx) > teleportThresholdPx || laneDist >= TELEPORT.thresholdLanes;

    const { bar, label, connector, dot } = getPillParts(pill);
    pill.setAttribute('opacity', '1');

    // Read initial positions for label, connector, and dot so we can move them with the bar
    const labelStartX = label ? parseFloat(label.getAttribute('x') || '0') : 0;
    const labelStartY = label ? parseFloat(label.getAttribute('y') || '0') : 0;
    // If target label position provided, compute independent label deltas
    // (old and new pills may use different label offsets relative to their bars)
    const labelDx = targetLabelPos ? targetLabelPos.x - labelStartX : dx;
    const labelDy = targetLabelPos ? targetLabelPos.y - labelStartY : dy;
    const connStartX1 = connector ? parseFloat(connector.getAttribute('x1') || '0') : 0;
    const connStartX2 = connector ? parseFloat(connector.getAttribute('x2') || '0') : 0;
    const connStartY2 = connector ? parseFloat(connector.getAttribute('y2') || '0') : 0;
    const connBaseOpacity = connector ? parseFloat(connector.getAttribute('stroke-opacity') || '0.25') : 0.25;
    const dotStartCx = dot ? parseFloat(dot.getAttribute('cx') || '0') : 0;
    const dotBaseOpacity = dot ? parseFloat(dot.getAttribute('fill-opacity') || '0.65') : 0.65;

    // Also move clip-path rect if present
    const clippedG = pill.querySelector('[clip-path]');
    let clipRect: SVGRectElement | null = null;
    let clipStartX = 0;
    let clipStartY = 0;
    let clipStartW = 0;
    if (clippedG) {
        const clipUrl = clippedG.getAttribute('clip-path') || '';
        const m = clipUrl.match(/url\(#([^)]+)\)/);
        if (m) {
            clipRect = document.querySelector(`#${m[1]} rect`) as SVGRectElement | null;
            if (clipRect) {
                clipStartX = parseFloat(clipRect.getAttribute('x') || '0');
                clipStartY = parseFloat(clipRect.getAttribute('y') || '0');
                clipStartW = parseFloat(clipRect.getAttribute('width') || '0');
            }
        }
    }

    // ── Portal mode: create a destination ghost that fades in simultaneously ──
    let ghost: Element | null = null;
    let ghostParts: ReturnType<typeof getPillParts> = { bar: null, label: null, connector: null, dot: null };
    if (isTeleport && pill.parentNode) {
        ghost = pill.cloneNode(true) as Element;
        // Remove clip-path IDs from clone to avoid duplicate IDs
        ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        ghost.querySelectorAll('[clip-path]').forEach(el => el.removeAttribute('clip-path'));
        ghost.setAttribute('opacity', '0');
        pill.parentNode.insertBefore(ghost, pill.nextSibling);
        ghostParts = getPillParts(ghost);
        // Position ghost bar/label/connector/dot at the destination approach point
        const destStartFrac = 1 - TELEPORT.driftFraction;
        if (ghostParts.bar) {
            ghostParts.bar.setAttribute('x', (from.x + dx * destStartFrac).toFixed(1));
            ghostParts.bar.setAttribute('y', (from.y + dy * destStartFrac).toFixed(1));
            ghostParts.bar.setAttribute('width', to.width.toFixed(1));
        }
        if (ghostParts.label) {
            ghostParts.label.setAttribute('x', (labelStartX + labelDx * destStartFrac).toFixed(1));
            ghostParts.label.setAttribute('y', (labelStartY + labelDy * destStartFrac).toFixed(1));
        }
        if (ghostParts.connector) {
            ghostParts.connector.setAttribute('x1', (connStartX1 + dx * destStartFrac).toFixed(1));
            ghostParts.connector.setAttribute('x2', (connStartX2 + dx * destStartFrac).toFixed(1));
        }
        if (ghostParts.dot) {
            ghostParts.dot.setAttribute('cx', (dotStartCx + dx * destStartFrac).toFixed(1));
        }
    }

    return new Promise<void>(resolve => {
        const startTs = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTs) / duration);
            const ease = easeInOutCubic(rawT);

            if (isTeleport) {
                // ── Portal: origin fades out + drifts, destination fades in + drifts — in parallel ──
                const tf = teleportInterpolation(ease, TELEPORT.driftFraction);

                // Origin pill: drift slightly toward destination, fade out
                pill.setAttribute('opacity', tf.originOpacity.toFixed(3));
                if (bar) {
                    bar.setAttribute('x', (from.x + dx * tf.originPos).toFixed(1));
                    bar.setAttribute('y', (from.y + dy * tf.originPos).toFixed(1));
                }
                if (label) {
                    label.setAttribute('x', (labelStartX + labelDx * tf.originPos).toFixed(1));
                    label.setAttribute('y', (labelStartY + labelDy * tf.originPos).toFixed(1));
                }
                if (connector) {
                    connector.setAttribute('x1', (connStartX1 + dx * tf.originPos).toFixed(1));
                    connector.setAttribute('x2', (connStartX2 + dx * tf.originPos).toFixed(1));
                    connector.setAttribute('stroke-opacity', (connBaseOpacity * tf.originOpacity).toFixed(3));
                }
                if (dot) {
                    dot.setAttribute('cx', (dotStartCx + dx * tf.originPos).toFixed(1));
                    dot.setAttribute('fill-opacity', (dotBaseOpacity * tf.originOpacity).toFixed(3));
                }

                // Destination ghost: drift into final position, fade in
                if (ghost) {
                    ghost.setAttribute('opacity', tf.destOpacity.toFixed(3));
                    if (ghostParts.bar) {
                        ghostParts.bar.setAttribute('x', (from.x + dx * tf.destPos).toFixed(1));
                        ghostParts.bar.setAttribute('y', (from.y + dy * tf.destPos).toFixed(1));
                    }
                    if (ghostParts.label) {
                        ghostParts.label.setAttribute('x', (labelStartX + labelDx * tf.destPos).toFixed(1));
                        ghostParts.label.setAttribute('y', (labelStartY + labelDy * tf.destPos).toFixed(1));
                    }
                    if (ghostParts.connector) {
                        ghostParts.connector.setAttribute('x1', (connStartX1 + dx * tf.destPos).toFixed(1));
                        ghostParts.connector.setAttribute('x2', (connStartX2 + dx * tf.destPos).toFixed(1));
                        ghostParts.connector.setAttribute(
                            'stroke-opacity',
                            (connBaseOpacity * tf.destOpacity).toFixed(3),
                        );
                    }
                    if (ghostParts.dot) {
                        ghostParts.dot.setAttribute('cx', (dotStartCx + dx * tf.destPos).toFixed(1));
                        ghostParts.dot.setAttribute('fill-opacity', (dotBaseOpacity * tf.destOpacity).toFixed(3));
                    }
                }
            } else {
                // ── Normal smooth glide ──
                if (bar) {
                    bar.setAttribute('x', (from.x + dx * ease).toFixed(1));
                    bar.setAttribute('y', (from.y + dy * ease).toFixed(1));
                }
                if (bar && Math.abs(dw) > 0.5) {
                    bar.setAttribute('width', Math.max(1, from.width + dw * ease).toFixed(1));
                }
                if (label) {
                    label.setAttribute('x', (labelStartX + labelDx * ease).toFixed(1));
                    label.setAttribute('y', (labelStartY + labelDy * ease).toFixed(1));
                }
                if (clipRect) {
                    clipRect.setAttribute('x', (clipStartX + dx * ease).toFixed(1));
                    clipRect.setAttribute('y', (clipStartY + dy * ease).toFixed(1));
                    if (Math.abs(dw) > 0.5) {
                        const clipDw = to.width + 40 - clipStartW;
                        clipRect.setAttribute('width', (clipStartW + clipDw * ease).toFixed(1));
                    }
                }
                if (connector) {
                    connector.setAttribute('x1', (connStartX1 + dx * ease).toFixed(1));
                    connector.setAttribute('x2', (connStartX2 + dx * ease).toFixed(1));
                    connector.setAttribute('y2', (connStartY2 + dy * ease).toFixed(1));
                }
                if (dot) {
                    dot.setAttribute('cx', (dotStartCx + dx * ease).toFixed(1));
                }
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                // Clean up ghost and snap original to target
                if (ghost) ghost.remove();
                snapPillToTarget(pill, to);
                pill.setAttribute('opacity', '1');
                if (connector) connector.setAttribute('stroke-opacity', connBaseOpacity.toFixed(3));
                if (dot) dot.setAttribute('fill-opacity', dotBaseOpacity.toFixed(3));
                resolve();
            }
        })(performance.now());
    });
}

/**
 * Gently introduce a pill — 7% zoom-in + fade. Exact inverse of animateRemove.
 * The pill must already be rendered at its final position.
 */
function animateAdd(pill: Element | null, duration = 600): Promise<void> {
    if (!pill) return Promise.resolve();
    if (isTurboActive()) {
        pill.setAttribute('opacity', '1');
        pill.removeAttribute('transform');
        return Promise.resolve();
    }

    const box = getPillBBox(pill);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const pillEl = pill as SVGElement;
    pillEl.classList.remove('pill-highlight', 'pill-dim');
    pillEl.style.setProperty('transition', 'none', 'important');
    pillEl.style.setProperty('opacity', '0', 'important');

    return new Promise<void>(resolve => {
        const startTs = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTs) / duration);
            const ease = easeInOutCubic(rawT);

            // 7% zoom-in centered on pill midpoint (0.93 → 1.0)
            const scale = 0.93 + 0.07 * ease;
            const tx = cx * (1 - scale);
            const ty = cy * (1 - scale);
            pill.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${scale.toFixed(4)})`);

            // Linear fade-in (inverse of remove's linear fade-out)
            pillEl.style.setProperty('opacity', rawT.toFixed(3), 'important');

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                pill.removeAttribute('transform');
                pillEl.style.removeProperty('opacity');
                pill.setAttribute('opacity', '1');
                resolve();
            }
        })(performance.now());
    });
}

/**
 * Gently retire a pill — 7% zoom-out + fade, bar and text as one unit.
 */
function animateRemove(pill: Element | null, duration = 600): Promise<void> {
    if (!pill) return Promise.resolve();
    if (isTurboActive()) {
        pill.setAttribute('opacity', '0');
        pill.remove();
        return Promise.resolve();
    }

    const { connector, dot } = getPillParts(pill);
    const box = getPillBBox(pill);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Move connector + dot OUT of the pill group so they animate independently
    // of the group's opacity fade and transform. This lets the retraction be
    // visible while the pill bar/text dissolve.
    const parentG = pill.parentElement;
    const connY1 = connector ? parseFloat(connector.getAttribute('y1') || '0') : 0;
    const connY2 = connector ? parseFloat(connector.getAttribute('y2') || '0') : 0;
    const connDist = connY2 - connY1;
    const connStartOpacity = connector ? parseFloat(connector.getAttribute('stroke-opacity') || '0.25') : 0.25;
    const dotStartOpacity = dot ? parseFloat(dot.getAttribute('fill-opacity') || '0.6') : 0.6;
    if (connector && parentG) parentG.insertBefore(connector, pill);
    if (dot && parentG) parentG.insertBefore(dot, pill);

    // Strip CSS classes that set opacity with !important (pill-highlight, pill-dim)
    // and kill any CSS transition so the rAF loop has sole authority over opacity.
    const pillEl = pill as SVGElement;
    pillEl.classList.remove('pill-highlight', 'pill-dim');
    pillEl.style.setProperty('transition', 'none', 'important');
    pill.removeAttribute('opacity');

    return new Promise<void>(resolve => {
        const startTs = performance.now();
        (function tick(now: number) {
            const rawT = Math.min(1, (now - startTs) / duration);
            const ease = easeInOutCubic(rawT);

            // 7% zoom-out centered on pill midpoint (1.0 → 0.93)
            const scale = 1 - 0.07 * ease;
            const tx = cx * (1 - scale);
            const ty = cy * (1 - scale);
            pill.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${scale.toFixed(4)})`);

            // Fade the pill bar+text uniformly via inline style !important
            const fadeVal = 1 - rawT;
            pillEl.style.setProperty('opacity', fadeVal.toFixed(3), 'important');

            // Retract connector bottom endpoint toward curve dot (y1)
            // like a tentacle snapping back to its source.
            // Phase 1 (0–20%): brighten connector so retraction is clearly visible.
            // Phase 2 (20–80%): retract y2 toward y1 at full brightness.
            // Phase 3 (80–100%): fade connector out.
            if (connector) {
                const BRIGHTEN_END = 0.2;
                const RETRACT_END = 0.8;
                const peakOpacity = 0.55;
                let connOpacity: number;
                let retractEase: number;
                if (rawT < BRIGHTEN_END) {
                    // Brighten
                    const bt = rawT / BRIGHTEN_END;
                    connOpacity = connStartOpacity + (peakOpacity - connStartOpacity) * bt;
                    retractEase = 0;
                } else if (rawT < RETRACT_END) {
                    // Retract at peak brightness
                    connOpacity = peakOpacity;
                    retractEase = easeInOutCubic((rawT - BRIGHTEN_END) / (RETRACT_END - BRIGHTEN_END));
                } else {
                    // Fade out
                    const ft = (rawT - RETRACT_END) / (1 - RETRACT_END);
                    connOpacity = peakOpacity * (1 - ft);
                    retractEase = 1;
                }
                const curY2 = connY2 - connDist * retractEase;
                connector.setAttribute('y2', curY2.toFixed(1));
                connector.setAttribute('stroke-opacity', connOpacity.toFixed(3));
                // Thicken line during retraction for visibility
                connector.setAttribute('stroke-width', (0.75 + 1.25 * (1 - retractEase)).toFixed(2));
                // Remove dash pattern during retraction for solid tentacle look
                if (retractEase > 0) connector.removeAttribute('stroke-dasharray');
            }
            // Fade curve dot in last 40%
            if (dot) {
                const dotFadeT = clamp((rawT - 0.6) * 2.5, 0, 1);
                dot.setAttribute('fill-opacity', (dotStartOpacity * (1 - dotFadeT)).toFixed(3));
            }

            if (rawT < 1) {
                requestAnimationFrame(tick);
            } else {
                pill.remove();
                if (connector?.isConnected) connector.remove();
                if (dot?.isConnected) dot.remove();
                resolve();
            }
        })(performance.now());
    });
}

// ---- Dose Change Animation ----

/** Generic rAF animation loop. Calls onFrame(t) where t goes 0→1. */
function _animTick(durationMs: number, onFrame: (t: number) => void): Promise<void> {
    if (isTurboActive()) {
        onFrame(1);
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const start = performance.now();
        (function tick(now: number) {
            const t = Math.min(1, (now - start) / durationMs);
            onFrame(t);
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

/** Strip Rx badge and contribution-% text that tspans render separately. */
function stripTspanText(text: string): string {
    return text.replace(/\s*Rx\b/, '').replace(/\s+\d+%/, '');
}

/** Clone the Rx-badge and %-contribution tspans from a label so they survive textContent wipes. */
function saveLabelTspans(label: Element): SVGTSpanElement[] {
    return Array.from(label.querySelectorAll('tspan'))
        .filter(ts => {
            const t = ts.textContent || '';
            return t.includes('Rx') || t.includes('%');
        })
        .map(ts => ts.cloneNode(true) as SVGTSpanElement);
}

/** Re-append previously saved tspans to a label. */
function restoreLabelTspans(label: Element, tspans: SVGTSpanElement[]) {
    tspans.forEach(ts => label.appendChild(ts));
}

/** Parse dose from label text like "Caffeine (IR) 100mg" → { prefix, number, unit } */
function parseLabelDose(text: string): { prefix: string; number: string; unit: string } | null {
    const m = text.match(/^(.*?)([\d.]+)\s*(mg|mcg|µg|μg|g|IU|ml)\b/i);
    if (!m) return null;
    return { prefix: m[1], number: m[2], unit: m[3] };
}

/**
 * Animate a dose change with a smooth counting transition and direction arrow.
 *
 * The number in the label counts up/down from old value to new value in place,
 * keeping the text naturally rendered (no overlays, no clipping, no positioning
 * math). Much more robust than per-digit rolling.
 *
 * Flow: count number up/down → arrow fade-in → cleanup.
 */
async function animateDoseChange(
    pill: Element,
    oldLabelText: string,
    newLabelText: string,
    barBox: BarRect,
): Promise<void> {
    const oldDose = parseLabelDose(oldLabelText);
    const newDose = parseLabelDose(newLabelText);
    if (!oldDose || !newDose || oldDose.number === newDose.number) return;
    if (isTurboActive()) return;

    const { label } = getPillParts(pill);
    if (!label) return;

    // Preserve styled Rx-badge and %-contribution tspans before we wipe the label
    const preservedTspans = saveLabelTspans(label);

    const isUp = parseFloat(newDose.number) > parseFloat(oldDose.number);
    const oldNum = parseFloat(oldDose.number);
    const newNum = parseFloat(newDose.number);

    // Determine decimal formatting from original text
    const oldDec = oldDose.number.includes('.') ? oldDose.number.split('.')[1].length : 0;
    const newDec = newDose.number.includes('.') ? newDose.number.split('.')[1].length : 0;
    const decimals = Math.max(oldDec, newDec);

    // Build the suffix after the number (e.g. " mg …"), stripping Rx/% text
    // that is rendered separately by tspans
    const restAfterNum = stripTspanText(
        oldLabelText.slice(oldDose.prefix.length + oldDose.number.length),
    );

    // Read font size for arrow sizing
    const cs = getComputedStyle(label);
    const fontSize = parseFloat(cs.fontSize) || 12.5;
    const arrowColor = isUp ? '#4ade80' : '#f87171';

    // ---- Count number + arrow bob (700ms) ----
    // Build label with tspans: prefix (plain text) → number+unit (pulsed) → arrow (bobbing).
    // Everything flows inline in SVG so horizontal alignment stays natural.
    label.textContent = '';
    label.appendChild(document.createTextNode(oldDose.prefix));
    const numSpan = svgEl('tspan', {}) as SVGTSpanElement;
    numSpan.textContent = oldDose.number + restAfterNum;
    label.appendChild(numSpan);

    const arrowFontSize = Math.round(fontSize * 1.2);
    const arrowSpan = svgEl('tspan', {
        fill: arrowColor,
        'font-size': String(arrowFontSize),
        dx: '2',
        'fill-opacity': '0',
    }) as SVGTSpanElement;
    arrowSpan.textContent = isUp ? ' ▲' : ' ▼';
    label.appendChild(arrowSpan);

    await _animTick(1100, t => {
        // Number counting (easeOut — fast start, gentle landing)
        const ease = easeOutCubic(t);
        const cur = oldNum + (newNum - oldNum) * ease;
        const display = decimals > 0 ? cur.toFixed(decimals) : String(Math.round(cur));
        numSpan.textContent = display + restAfterNum;

        // Font-size pulse on number+unit: 0 → +18% → 0
        const pulse = Math.sin(Math.PI * t);
        const pulsedSize = fontSize * (1 + 0.18 * pulse);
        numSpan.setAttribute('font-size', pulsedSize.toFixed(1));

        // Arrow: fade in over first 20%, then bob vertically with damping
        const arrowOpacity = Math.min(1, t * 5);
        arrowSpan.setAttribute('fill-opacity', arrowOpacity.toFixed(2));

        // Gentle vertical sway that decays toward the end
        const bobAmp = fontSize * 0.3 * (1 - t);
        const bob = Math.sin(t * Math.PI * 4) * bobAmp;
        const dy = isUp ? -Math.abs(bob) : Math.abs(bob);
        arrowSpan.setAttribute('dy', dy.toFixed(1));
    });

    // Settle: restore final state (strip Rx/% — they come back via preserved tspans)
    label.textContent = stripTspanText(newLabelText);
    restoreLabelTspans(label, preservedTspans);
    const finalArrow = svgEl('tspan', {
        fill: arrowColor,
        'font-size': String(arrowFontSize),
        dx: '2',
    });
    finalArrow.textContent = isUp ? ' ▲' : ' ▼';
    label.appendChild(finalArrow);
}

/**
 * Snap a pill's child elements to absolute target positions.
 * Called after a transform-based move animation completes.
 */
function snapPillToTarget(pill: Element, target: BarRect): void {
    const { bar, label, connector, dot } = getPillParts(pill);
    // Compute label offset relative to current bar before snapping, so we
    // preserve the actual label placement instead of hard-coding offsets.
    let labelOffX = 6;
    let labelOffY = target.height / 2 + 3;
    if (bar && label) {
        const bx = parseFloat(bar.getAttribute('x') || '0');
        const by = parseFloat(bar.getAttribute('y') || '0');
        const lx = parseFloat(label.getAttribute('x') || '0');
        const ly = parseFloat(label.getAttribute('y') || '0');
        labelOffX = lx - bx;
        labelOffY = ly - by;
    }
    if (bar) {
        bar.setAttribute('x', target.x.toFixed(1));
        bar.setAttribute('y', target.y.toFixed(1));
        bar.setAttribute('width', target.width.toFixed(1));
        bar.setAttribute('height', target.height.toFixed(1));
    }
    if (label) {
        label.setAttribute('x', (target.x + labelOffX).toFixed(1));
        label.setAttribute('y', (target.y + labelOffY).toFixed(1));
    }
    if (connector) {
        connector.setAttribute('x1', target.x.toFixed(1));
        connector.setAttribute('x2', target.x.toFixed(1));
        connector.setAttribute('y2', target.y.toFixed(1));
    }
    if (dot) {
        dot.setAttribute('cx', target.x.toFixed(1));
    }
    // Update clip-path rect if present
    const clippedG = pill.querySelector('[clip-path]');
    if (clippedG) {
        const clipUrl = clippedG.getAttribute('clip-path') || '';
        const m = clipUrl.match(/url\(#([^)]+)\)/);
        if (m) {
            const clipRect = document.querySelector(`#${m[1]} rect`) as SVGRectElement | null;
            if (clipRect) {
                clipRect.setAttribute('x', target.x.toFixed(1));
                clipRect.setAttribute('y', target.y.toFixed(1));
                clipRect.setAttribute('width', target.width.toFixed(1));
                clipRect.setAttribute('height', target.height.toFixed(1));
            }
        }
    }
}

/**
 * Pre-flight lane shift — smoothly slide a pill from its old Y to a new Y.
 * Used before the scan starts to clear lanes for incoming portal animations,
 * preventing visual overlaps between old pills and newly-added pills.
 */
function animateLaneShiftPreflight(oldPill: Element, newPill: Element, duration = 300): Promise<void> {
    const oldBar = oldPill.querySelector('.timeline-bar') as SVGRectElement | null;
    const newBar = newPill.querySelector('.timeline-bar') as SVGRectElement | null;
    if (!oldBar || !newBar) return Promise.resolve();

    const oldY = parseFloat(oldBar.getAttribute('y') || '0');
    const newY = parseFloat(newBar.getAttribute('y') || '0');
    const deltaY = newY - oldY;
    if (Math.abs(deltaY) < 1) return Promise.resolve();

    // Gather all Y-animated elements
    const connector = oldPill.querySelector('.timeline-connector') as SVGLineElement | null;
    const label = oldPill.querySelector('.timeline-bar-label') as SVGTextElement | null;

    // Find clip-path rect associated with this pill's label
    const clipRef = oldPill.querySelector('[clip-path]');
    let clipRect: SVGRectElement | null = null;
    if (clipRef) {
        const clipUrl = clipRef.getAttribute('clip-path') || '';
        const m = clipUrl.match(/url\(#([^)]+)\)/);
        if (m) {
            clipRect = document.querySelector(`#${m[1]} rect`) as SVGRectElement | null;
        }
    }

    const connY2Start = connector ? parseFloat(connector.getAttribute('y2') || '0') : 0;
    const labelYStart = label ? parseFloat(label.getAttribute('y') || '0') : 0;
    const clipYStart = clipRect ? parseFloat(clipRect.getAttribute('y') || '0') : 0;

    if (isTurboActive() || duration <= 0) {
        console.log(
            `[Pre-flight] ${newPill.getAttribute('data-substance-key')} snap Y: ${oldY} -> ${newY} | Check X before: ${oldBar.getAttribute('x')}`,
        );
        oldBar.setAttribute('y', newY.toFixed(1));
        if (connector) connector.setAttribute('y2', (connY2Start + deltaY).toFixed(1));
        if (label) label.setAttribute('y', (labelYStart + deltaY).toFixed(1));
        if (clipRect) clipRect.setAttribute('y', (clipYStart + deltaY).toFixed(1));
        console.log(
            `[Pre-flight] ${newPill.getAttribute('data-substance-key')} snap done | Check X after: ${oldBar.getAttribute('x')}`,
        );
        return Promise.resolve();
    }

    console.log(
        `[Pre-flight] ${newPill.getAttribute('data-substance-key')} animating Y: ${oldY} -> ${newY} | Check X start: ${oldBar.getAttribute('x')}`,
    );
    return new Promise<void>(resolve => {
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const ease = easeInOutCubic(t);
            const curY = oldY + deltaY * ease;

            oldBar.setAttribute('y', curY.toFixed(1));
            if (connector) connector.setAttribute('y2', (connY2Start + deltaY * ease).toFixed(1));
            if (label) label.setAttribute('y', (labelYStart + deltaY * ease).toFixed(1));
            if (clipRect) clipRect.setAttribute('y', (clipYStart + deltaY * ease).toFixed(1));

            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                resolve();
            }
        };
        requestAnimationFrame(tick);
    });
}

function copyPillVisualState(fromPill: any, toPill: any, skipLabelText = false) {
    if (!fromPill || !toPill) return;

    const fromTitle = fromPill.querySelector('title');
    const toTitle = toPill.querySelector('title');
    if (fromTitle && toTitle) {
        toTitle.textContent = fromTitle.textContent || '';
    }

    const { bar: fromBar, label: fromLabel } = getPillParts(fromPill);
    const { bar: toBar, label: toLabel } = getPillParts(toPill);
    if (fromBar && toBar) {
        // Copy position/size only — NOT fill/stroke colors. The pill keeps its
        // original color so it doesn't abruptly change hue after a move.
        ['x', 'y', 'width', 'height', 'fill-opacity', 'stroke-opacity'].forEach(attr => {
            const value = fromBar.getAttribute(attr);
            if (value != null) toBar.setAttribute(attr, value);
        });
    }
    if (fromLabel && toLabel) {
        if (!skipLabelText) {
            // Clone full child-node structure (text nodes + styled tspans) instead
            // of copying flat textContent, which would strip Rx-badge and % styling.
            toLabel.textContent = '';
            Array.from(fromLabel.childNodes).forEach(node => {
                toLabel.appendChild(node.cloneNode(true));
            });
        }
        ['x', 'y', 'fill', 'opacity'].forEach(attr => {
            const value = fromLabel.getAttribute(attr);
            if (value != null) toLabel.setAttribute(attr, value);
        });
    }

    const fromConnector = fromPill.querySelector('.timeline-connector');
    const toConnector = toPill.querySelector('.timeline-connector');
    if (fromConnector && toConnector) {
        // Copy position + data attrs only — not stroke-opacity so connector
        // doesn't visually jump between rendering-path opacity differences.
        ['x1', 'y1', 'x2', 'y2', 'data-curve-idx', 'data-time-h'].forEach(attr => {
            const value = fromConnector.getAttribute(attr);
            if (value != null) toConnector.setAttribute(attr, value);
        });
    }

    const fromDot = fromPill.querySelector('.timeline-curve-dot');
    const toDot = toPill.querySelector('.timeline-curve-dot');
    if (fromDot && toDot) {
        ['cx', 'cy', 'r', 'data-curve-idx', 'data-time-h'].forEach(attr => {
            const value = fromDot.getAttribute(attr);
            if (value != null) toDot.setAttribute(attr, value);
        });
    }

    ['data-substance-key', 'data-time-minutes', 'data-revision-stable-id'].forEach(attr => {
        const value = fromPill.getAttribute(attr);
        if (value != null) toPill.setAttribute(attr, value);
    });
    toPill.setAttribute('opacity', fromPill.getAttribute('opacity') || '1');
}
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
        /**
         * Sweep continuously from current position through sorted trigger X positions,
         * firing each trigger's callback as the scan line crosses it.
         * Co-located pills get a minimum gap between fires (scan pauses briefly).
         */
        sweepWithTriggers(
            triggers: Array<{ x: number; fire: () => void }>,
            opts: { minGapMs?: number } = {},
        ): Promise<void> {
            if (triggers.length === 0) return Promise.resolve();

            const MIN_GAP = opts.minGapMs ?? 120;
            const sorted = [...triggers].sort((a, b) => a.x - b.x);
            const startX = currentX;
            const endX = sorted[sorted.length - 1].x + 20;

            // Turbo: fire all immediately
            if (isTurboActive()) {
                sorted.forEach(t => t.fire());
                setX(endX);
                currentX = endX;
                return Promise.resolve();
            }

            const dist = Math.max(1, endX - startX);
            const baseDuration = clamp(dist / SWEEP_SPEED_PX_PER_MS, 300, 4000);

            let nextIdx = 0;
            // For co-located triggers, stagger fire() via setTimeout
            // so the scan line never stops moving.
            let pendingStagger = 0;

            return new Promise<void>(resolve => {
                const sweepStart = performance.now();

                (function tick(now: number) {
                    const elapsed = now - sweepStart;
                    const rawT = Math.min(1, elapsed / baseDuration);
                    const xPos = startX + dist * rawT;
                    setX(xPos);
                    currentX = xPos;

                    // Fire triggers whose X we've reached
                    while (nextIdx < sorted.length && xPos >= sorted[nextIdx].x) {
                        const trigger = sorted[nextIdx];
                        nextIdx++;
                        // Check if next trigger is co-located (same X within 2px)
                        const prevX = nextIdx >= 2 ? (sorted[nextIdx - 2]?.x ?? -Infinity) : -Infinity;
                        const isColocated = Math.abs(trigger.x - prevX) < 2;
                        if (isColocated) {
                            // Stagger co-located triggers without pausing scan
                            pendingStagger++;
                            const delay = pendingStagger * MIN_GAP;
                            const fn = trigger.fire;
                            setTimeout(fn, delay);
                        } else {
                            pendingStagger = 0;
                            trigger.fire();
                        }
                    }

                    if (rawT < 1) {
                        requestAnimationFrame(tick);
                    } else {
                        // Fire any remaining triggers
                        while (nextIdx < sorted.length) {
                            sorted[nextIdx].fire();
                            nextIdx++;
                        }
                        resolve();
                    }
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

/**
 * Build sorted trigger list for a phase — entries ordered left-to-right by SVG X.
 */
function buildPhaseTriggers(
    entries: any[],
    findPill: (entry: any) => Element | null,
    getX: (entry: any) => number,
): { entry: any; x: number; pill: Element | null }[] {
    return entries
        .map(entry => ({
            entry,
            x: getX(entry),
            pill: findPill(entry),
        }))
        .sort((a, b) => a.x - b.x);
}

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

/**
 * Main revision animation — phase-based parallel execution.
 *
 * Flow:
 *   Phase 0: Snapshot old pills, render new layout invisibly, pre-flight unchanged/lane-shifted.
 *   Phase 1: Removals — all removed + old pills from replaced entries fade out in parallel.
 *   Phase 2: Moves — all moved/resized/retargeted entries animate in parallel.
 *   Phase 3: Additions — all added + new pills from replaced entries zoom in.
 *   Cleanup: finalize pill positions, sweep scan line, enable narration scroll.
 */
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

    const _rl = (msg: string) => {
        console.log(msg);
    };
    _rl(
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
    oldPills.forEach(pill => {
        const clippedG = pill.querySelector('[clip-path]');
        if (clippedG) clippedG.removeAttribute('clip-path');
        tempGroup.appendChild(pill);
    });
    svg.insertBefore(tempGroup, timelineGroup);

    // Phase 0b: Render NEW layout invisibly
    // Save viewBox before re-render — renderSubstanceTimeline fires an animated
    // viewBox height change which would cause all pills to visually scale/shift
    // before the revision animation is ready. Restore it immediately and let the
    // revision animation manage height changes itself.
    const svgEl_ = svg as unknown as SVGSVGElement;
    const savedViewBox = svgEl_.getAttribute('viewBox');
    renderSubstanceTimeline(newInterventions, newLxCurves, curvesData);
    if (savedViewBox) {
        // Cancel the rAF animation that renderSubstanceTimeline started and
        // restore the original viewBox so nothing shifts during setup.
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

    // Phase 0c: Pre-flight — snap only pills that stay in the same lane.
    // Pills that need a lane change are deferred to the scan-line sweep so they
    // animate at the right time (when the scan line reaches them) and don't
    // overlap other pills prematurely.
    const deferredLaneShifts: any[] = [];
    for (const entry of diff) {
        if (entry.type !== 'unchanged' && entry.type !== 'lane-shifted') continue;
        const oldPill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup) : null;
        const newPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup) : null;
        if (!oldPill || !newPill) continue;

        // Detect actual Y delta to decide snap vs defer
        const oldBarEl = oldPill.querySelector('.timeline-bar') as SVGRectElement | null;
        const newBarEl = newPill.querySelector('.timeline-bar') as SVGRectElement | null;
        const actualYDelta =
            oldBarEl && newBarEl
                ? Math.abs(
                      parseFloat(oldBarEl.getAttribute('y') || '0') - parseFloat(newBarEl.getAttribute('y') || '0'),
                  )
                : 0;

        if (entry.type === 'lane-shifted' || actualYDelta >= 1) {
            // Defer to scan sweep — keep pill in tempGroup at old position for now
            deferredLaneShifts.push({ ...entry, _deferredOldPill: oldPill, _deferredNewPill: newPill });
            continue;
        }

        // No lane change — instant snap
        animateLaneShiftPreflight(oldPill, newPill, 0);
        oldPill.setAttribute('opacity', '1');
        oldPill.setAttribute('data-handled', 'true');
        oldPill.setAttribute('data-time-minutes', String(entry.newIv?.timeMinutes ?? entry.oldIv?.timeMinutes ?? ''));
        if (entry.newIv?._revisionStableId) {
            oldPill.setAttribute('data-revision-stable-id', String(entry.newIv._revisionStableId));
        }
        timelineGroup.appendChild(oldPill);
        if (newPill?.isConnected) newPill.remove();
    }

    // Build refined diff (excludes unchanged/lane-shifted that were snapped, includes deferred lane shifts)
    const refinedDiff = diff
        .map((entry: any, origIdx: number) => ({ ...entry, _origIdx: origIdx }))
        .filter((entry: any) => entry.type !== 'unchanged' && entry.type !== 'lane-shifted');

    // Sherlock narration setup
    const refinedNarration = narration
        ? {
              ...narration,
              beats: refinedDiff.map((entry: any) => narration.beats[entry._origIdx]).filter(Boolean),
          }
        : null;
    const sherlockCtx = { sherlockRevisionNarration: refinedNarration, revisionDiff: refinedDiff, curvesData } as any;
    const cards = buildSherlockRevisionCards(sherlockCtx);
    if (cards.length > 0) showNarrationPanel();

    // Slide bio strips DOWN if new layout needs more lanes (don't slide up yet —
    // old pills are still visible; upward adjustment happens after revision completes)
    let maxLaneBottom = 0;
    timelineGroup.querySelectorAll('.timeline-pill-group').forEach((pill: any) => {
        const box = getPillBBox(pill);
        const bottom = box.y + box.height + TIMELINE_ZONE.bottomPad;
        if (bottom > maxLaneBottom) maxLaneBottom = bottom;
    });
    const bioSepY = getBioSeparatorEffectiveY();
    if (maxLaneBottom > bioSepY) await slideBiometricZoneDown(maxLaneBottom, 280);

    // Scan line + POI tracking
    const dayScan = createRevisionDayScanLine(svg, timelineGroup, tempGroup, timelineGroup);
    const stopPoiTracking = startPoiConnectorTracking(tempGroup, timelineGroup);
    await dayScan.intro();
    let cursorClosed = false;

    // Partition diff entries by phase
    const removalEntries = refinedDiff.filter((e: any) => e.type === 'removed');
    const replacedEntries = refinedDiff.filter((e: any) => e.type === 'replaced');
    const moveEntries = refinedDiff.filter(
        (e: any) => e.type === 'moved' || e.type === 'resized' || e.type === 'moved+resized',
    );
    const retargetedEntries = refinedDiff.filter((e: any) => e.type === 'retargeted');
    const addEntries = refinedDiff.filter((e: any) => e.type === 'added');

    try {
        const hasSleepContext = (BiometricState.channels || []).some((ch: any) => {
            const sig = String(ch?.signal || '').toLowerCase();
            return sig.startsWith('sleep_') || sig.includes('sleep');
        });
        await dayScan.primeWithSleepContext(hasSleepContext);

        let cardIdx = 0;

        // ---- Build unified trigger list across all phases ----
        // One continuous left-to-right sweep. Each trigger knows its action type.
        // Sorted by X position; at the same X, removals fire before moves before additions.
        const REMOVE_DUR = 1200;
        const MOVE_DUR = 1100;
        const ADD_DUR = 900;

        interface UnifiedTrigger {
            x: number;
            phase: number; // 0 = removal, 1 = move, 2 = addition (sort priority at same X)
            fire: () => void;
        }
        const allTriggers: UnifiedTrigger[] = [];
        const inflight: Promise<void>[] = [];

        // --- Spatial conflict detection ---
        // For each addition, find old pills that currently occupy the same space.
        // Those old pills must clear (remove/move away) before the addition appears.
        const oldPillCleared = new Map<Element, { promise: Promise<void>; resolve: () => void }>();
        const addConflicts = new Map<any, Element[]>();

        const allAddEntries = [...addEntries, ...replacedEntries];
        for (const entry of allAddEntries) {
            const newPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup, true) : null;
            if (!newPill) continue;
            const newBox = getPillBBox(newPill);
            if (newBox.width <= 0) continue;

            const conflicts: Element[] = [];
            tempGroup.querySelectorAll('.timeline-pill-group').forEach((oldPillEl: any) => {
                if (oldPillEl.getAttribute('data-handled') === 'true') return;
                const oldBox = getPillBBox(oldPillEl);
                if (_boxesOverlap(oldBox, newBox)) {
                    conflicts.push(oldPillEl);
                    if (!oldPillCleared.has(oldPillEl)) {
                        let resolve!: () => void;
                        const promise = new Promise<void>(r => {
                            resolve = r;
                        });
                        oldPillCleared.set(oldPillEl, { promise, resolve });
                    }
                }
            });
            if (conflicts.length > 0) {
                addConflicts.set(entry, conflicts);
                _rl(
                    `[RevAnim] spatial conflict: ${entry.newIv?.key ?? '?'} blocked by ${conflicts.length} old pill(s)`,
                );
            }
        }

        // Phase 1 triggers: removals + old side of replaced
        const phase1Entries = [...removalEntries, ...replacedEntries];
        for (const entry of phase1Entries) {
            const oldPill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup) : null;
            const x = phaseChartX((entry.oldIv || entry.newIv)?.timeMinutes ?? PHASE_CHART.startMin);
            allTriggers.push({
                x,
                phase: 0,
                fire: () => {
                    const bbox = oldPill ? getPillBBox(oldPill) : null;
                    _rl(
                        `[RevAnim] remove: ${entry.oldIv?.key ?? '?'} pill=${!!oldPill} bbox=${bbox ? `(${bbox.x.toFixed(0)},${bbox.y.toFixed(0)},w=${bbox.width.toFixed(0)})` : 'null'}`,
                    );
                    setPoiEntryAnchor(entry, oldPill);
                    if (cards.length > cardIdx) showSherlockStack(cards, cardIdx++);
                    if (oldPill) {
                        oldPill.setAttribute('data-action-type', 'removed');
                        oldPill.setAttribute('data-handled', 'true');
                    }
                    const removeP = animateRemove(oldPill, REMOVE_DUR);
                    inflight.push(removeP);
                    if (oldPill && oldPillCleared.has(oldPill)) {
                        removeP.then(() => oldPillCleared.get(oldPill)!.resolve());
                    }
                },
            });
        }

        // Phase 2 triggers: moves + retargets
        const phase2Entries = [...moveEntries, ...retargetedEntries];
        for (const entry of phase2Entries) {
            const oldPill = entry.oldIv ? findPillByIntervention(entry.oldIv, tempGroup) : null;
            const x = phaseChartX((entry.oldIv || entry.newIv)?.timeMinutes ?? PHASE_CHART.startMin);
            allTriggers.push({
                x,
                phase: 1,
                fire: () => {
                    const newPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup) : null;
                    setPoiEntryAnchor(entry, oldPill || newPill);
                    if (cards.length > cardIdx) showSherlockStack(cards, cardIdx++);

                    if (entry.type === 'retargeted') {
                        const oldLabelRetarget = oldPill ? getPillParts(oldPill).label?.textContent || '' : '';
                        if (oldPill && newPill) {
                            copyPillVisualState(newPill, oldPill);
                            newPill.remove();
                        }
                        if (oldPill) {
                            if (entry.newIv?._revisionStableId) {
                                oldPill.setAttribute('data-revision-stable-id', String(entry.newIv._revisionStableId));
                            }
                            if (oldPill.parentElement !== timelineGroup) timelineGroup.appendChild(oldPill);
                            oldPill.setAttribute('data-handled', 'true');
                        }
                        if (oldPill) {
                            const newLabelRetarget = getPillParts(oldPill).label?.textContent || '';
                            if (
                                oldLabelRetarget !== newLabelRetarget &&
                                parseLabelDose(oldLabelRetarget) &&
                                parseLabelDose(newLabelRetarget)
                            ) {
                                const retargetBox = getPillBBox(oldPill);
                                inflight.push(
                                    animateDoseChange(oldPill, oldLabelRetarget, newLabelRetarget, retargetBox),
                                );
                            }
                        }
                    } else if (oldPill && newPill) {
                        const from = getPillBBox(oldPill);
                        const to = getPillBBox(newPill);
                        const oldLabelText = getPillParts(oldPill).label?.textContent || '';
                        const newLabelText = getPillParts(newPill).label?.textContent || '';
                        const hasDoseChange =
                            oldLabelText !== newLabelText &&
                            !!parseLabelDose(oldLabelText) &&
                            !!parseLabelDose(newLabelText);
                        // Read new pill's exact label position so the label
                        // arrives precisely where it belongs (avoids offset
                        // mismatch between old and new rendering paths).
                        const newLabel = getPillParts(newPill).label;
                        const targetLabelPos = newLabel
                            ? {
                                  x: parseFloat(newLabel.getAttribute('x') || '0'),
                                  y: parseFloat(newLabel.getAttribute('y') || '0'),
                              }
                            : null;
                        newPill.setAttribute('opacity', '0');
                        newPill.setAttribute('visibility', 'hidden');

                        const pillAnims: Promise<void>[] = [animateMove(oldPill, from, to, MOVE_DUR, targetLabelPos)];
                        if (hasDoseChange) {
                            pillAnims.push(animateDoseChange(oldPill, oldLabelText, newLabelText, to));
                        }

                        inflight.push(
                            Promise.all(pillAnims).then(() => {
                                copyPillVisualState(newPill, oldPill, hasDoseChange);
                                // Ensure moved pill stays visible — newPill was hidden
                                // (opacity 0) so copyPillVisualState copied that value.
                                oldPill.setAttribute('opacity', '1');
                                oldPill.setAttribute(
                                    'data-time-minutes',
                                    String(entry.newIv?.timeMinutes ?? entry.oldIv?.timeMinutes ?? ''),
                                );
                                if (entry.newIv?.key) {
                                    oldPill.setAttribute('data-substance-key', String(entry.newIv.key));
                                }
                                if (entry.newIv?._revisionStableId) {
                                    oldPill.setAttribute(
                                        'data-revision-stable-id',
                                        String(entry.newIv._revisionStableId),
                                    );
                                }
                                if (oldPill.parentElement !== timelineGroup) timelineGroup.appendChild(oldPill);
                                if (newPill.isConnected) newPill.remove();
                                oldPill.setAttribute('data-handled', 'true');
                                setPoiEntryAnchor(entry, oldPill);
                                // Resolve spatial conflict — old pill has vacated its original position
                                if (oldPillCleared.has(oldPill)) {
                                    oldPillCleared.get(oldPill)!.resolve();
                                }
                            }),
                        );
                    } else if (newPill) {
                        newPill.classList.remove('revision-prehidden');
                        newPill.removeAttribute('visibility');
                        inflight.push(
                            animateAdd(newPill, ADD_DUR).then(() => {
                                newPill.setAttribute('data-handled', 'true');
                            }),
                        );
                    } else if (oldPill) {
                        oldPill.setAttribute('data-action-type', 'removed');
                        oldPill.setAttribute('data-handled', 'true');
                        const fallbackRemoveP = animateRemove(oldPill, 500);
                        inflight.push(fallbackRemoveP);
                        if (oldPillCleared.has(oldPill)) {
                            fallbackRemoveP.then(() => oldPillCleared.get(oldPill)!.resolve());
                        }
                    }
                },
            });
        }

        // Deferred lane-shift triggers: unchanged/lane-shifted pills that need Y animation.
        // Fire at phase 1 priority (same as moves) so they animate with the scan line.
        const LANE_SHIFT_DUR = 400;
        for (const entry of deferredLaneShifts) {
            const oldPill = entry._deferredOldPill as Element;
            const newPill = entry._deferredNewPill as Element;
            const x = phaseChartX((entry.oldIv || entry.newIv)?.timeMinutes ?? PHASE_CHART.startMin);
            allTriggers.push({
                x,
                phase: 1,
                fire: () => {
                    oldPill.setAttribute('opacity', '1');
                    if (oldPill.parentElement !== timelineGroup) timelineGroup.appendChild(oldPill);
                    inflight.push(
                        animateLaneShiftPreflight(oldPill, newPill, LANE_SHIFT_DUR).then(() => {
                            oldPill.setAttribute('data-handled', 'true');
                            oldPill.setAttribute(
                                'data-time-minutes',
                                String(entry.newIv?.timeMinutes ?? entry.oldIv?.timeMinutes ?? ''),
                            );
                            if (entry.newIv?._revisionStableId) {
                                oldPill.setAttribute('data-revision-stable-id', String(entry.newIv._revisionStableId));
                            }
                            if (newPill?.isConnected) (newPill as Element).remove();
                            // Resolve spatial conflict — pill has moved to its new lane
                            if (oldPillCleared.has(oldPill)) {
                                oldPillCleared.get(oldPill)!.resolve();
                            }
                        }),
                    );
                },
            });
        }

        // Phase 3 triggers: additions + new side of replaced
        const phase3Entries = [...addEntries, ...replacedEntries];
        for (const entry of phase3Entries) {
            const x = phaseChartX((entry.newIv || entry.oldIv)?.timeMinutes ?? PHASE_CHART.startMin);
            allTriggers.push({
                x,
                phase: 2,
                fire: () => {
                    const newPill = entry.newIv ? findPillByIntervention(entry.newIv, timelineGroup) : null;
                    setPoiEntryAnchor(entry, newPill);
                    if (cards.length > cardIdx) showSherlockStack(cards, cardIdx++);

                    // Gate: wait for any old pill occupying this position to clear first
                    const conflicts = addConflicts.get(entry) || [];
                    const gatePromises = conflicts
                        .map(pill => oldPillCleared.get(pill)?.promise)
                        .filter(Boolean) as Promise<void>[];

                    const doReveal = () => {
                        if (newPill) {
                            newPill.classList.remove('revision-prehidden');
                            newPill.removeAttribute('visibility');
                        }
                        return animateAdd(newPill, ADD_DUR).then(() => {
                            if (newPill) newPill.setAttribute('data-handled', 'true');
                        });
                    };

                    if (gatePromises.length > 0) {
                        inflight.push(Promise.all(gatePromises).then(doReveal));
                    } else {
                        inflight.push(doReveal());
                    }
                },
            });
        }

        // Sort: by X ascending, then phase priority (removals → moves → additions)
        allTriggers.sort((a, b) => a.x - b.x || a.phase - b.phase);

        // ---- Single continuous left-to-right sweep ----
        if (allTriggers.length > 0) {
            await dayScan.moveTo(allTriggers[0].x - 8);

            // Lx morph chain runs in parallel with the sweep — smooth curve evolution.
            // Collect all entries sorted by _origIdx, fire sequentially.
            const allMorphEntries = refinedDiff
                .filter((e: any) => e.type !== 'unchanged' && e.type !== 'lane-shifted')
                .sort((a: any, b: any) => (a._origIdx ?? 0) - (b._origIdx ?? 0));
            const morphDurPerEntry = Math.max(200, Math.floor(2400 / Math.max(1, allMorphEntries.length)));
            const morphChain = (async () => {
                for (const entry of allMorphEntries) {
                    const origIdx = entry._origIdx ?? 0;
                    await Promise.resolve(options.morphLxStep?.(entry, origIdx, morphDurPerEntry));
                }
            })();

            // Sweep and fire pill triggers
            await dayScan.sweepWithTriggers(allTriggers, { minGapMs: 180 });

            // Safety: resolve any orphaned spatial-conflict gate promises.
            // A gate promise can remain unresolved when `findPillByIntervention`
            // fails to semantically match an old pill that was detected as a
            // spatial conflict (by bounding-box overlap). Without this, the
            // addition gated on the unresolved promise would hang forever,
            // deadlocking the entire revision animation.
            for (const [pill, entry] of oldPillCleared) {
                entry.resolve();
            }

            // Slide bio strips to match reduced lane count — starts AFTER sweep
            // so pills are already fading out and won't be overlaid.
            const bioSlide = slideBiometricZoneDown(getTimelineBottomY(), 800);

            // Wait for all pill animations + Lx morphs + bio slide still in flight.
            // Safety ceiling: if any animation stalls (e.g. rAF throttled in a
            // background tab), force-continue after 15 seconds so the UI never
            // permanently freezes.
            const allAnimations = Promise.all([...inflight, morphChain, bioSlide]);
            const ceiling = new Promise<void>(r => setTimeout(r, 15_000));
            await Promise.race([allAnimations, ceiling]);

            // Check for remaining removed-key pills
            const removedKeys = phase1Entries.map((e: any) => e.oldIv?.key).filter(Boolean);
            if (removedKeys.length > 0) {
                const dupsInTimeline = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group')).filter(
                    (p: any) => removedKeys.includes(p.getAttribute('data-substance-key')),
                );
                if (dupsInTimeline.length > 0) {
                    _rl(
                        `[RevAnim] WARNING: ${dupsInTimeline.length} removed-key pills still in timelineGroup: ${dupsInTimeline.map((p: any) => p.getAttribute('data-substance-key')).join(', ')}`,
                    );
                }
            }
        }

        // Sweep scan to day end
        await dayScan.sweepToDayEnd();

        // Cleanup: remaining pills in tempGroup are old pills.
        // Handled ones (moved to timelineGroup during animation) are already gone.
        // Unhandled ones are either failed lookups for removed/replaced entries,
        // or genuinely orphaned — either way, remove them (new pills are the source of truth).
        Array.from(tempGroup.children).forEach((pill: any) => {
            if (pill.classList?.contains('timeline-pill-group')) {
                pill.setAttribute('opacity', '0');
                pill.remove();
                // Safety: resolve any unresolved spatial conflict deferreds
                if (oldPillCleared.has(pill)) {
                    oldPillCleared.get(pill)!.resolve();
                }
            }
        });

        const cleanupAnims: Promise<any>[] = [];
        Array.from(timelineGroup.querySelectorAll('.timeline-pill-group')).forEach((pill: any) => {
            const op = parseFloat(pill.getAttribute('opacity') || '0');
            if (op < 1) cleanupAnims.push(animateSvgOpacity(pill, op, 1, 180));
            pill.classList.remove('revision-prehidden');
            pill.removeAttribute('visibility');
            pill.removeAttribute('data-handled');
            pill.removeAttribute('data-action-type');
        });
        await Promise.all(cleanupAnims);

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
            if (pill.getAttribute('data-action-type') !== 'removed') {
                const currentOp = parseFloat(pill.getAttribute('opacity') || '1');
                if (currentOp < 0.5) pill.setAttribute('opacity', '1');
            } else {
                pill.remove();
            }
        });
        stopPoiTracking();
        if (!cursorClosed) dayScan.remove();
        tempGroup.remove();
        preserveBiometricStrips(true, true);
    }
}
