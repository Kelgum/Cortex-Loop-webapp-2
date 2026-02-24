// ============================================
// WORD CLOUD SEGMENTS
// ============================================
// Word entrance, float, orbital rings, dismiss, ring→curve morph.

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { easeInOutCubic, easeOutBack, easeOutCubic } from '../timeline-engine';
import { PHASE_CHART, PHASE_SMOOTH_PASSES, WORD_CLOUD_PALETTE } from '../constants';
import { AppState } from '../state';
import { svgEl, chartTheme, phaseChartX, phaseChartY } from '../utils';
import { smoothPhaseValues, interpolatePointsAtTime } from '../curve-utils';

// --- Word cloud entrance + float ---
export function createWordCloudEntranceSegment(startTime: number, duration: number): AnimationSegment {
    const wordEls: { el: SVGTextElement; cx: number; cy: number; targetX: number; targetY: number; opacity: number; staggerDelay: number }[] = [];
    const STAGGER = 180;
    const SLIDE_DUR_FRAC = 0.3; // fraction of total duration per word slide

    return {
        id: 'word-cloud-entrance',
        label: 'Word Cloud',
        category: 'word-cloud',
        startTime,
        duration,
        phaseIdx: 0,

        enter(ctx) {
            const group = ctx.groups['phase-word-cloud'];
            if (!group || !ctx.wordCloudEffects) return;
            // Don't clear — orbital rings may already be here

            const cx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
            const cy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
            const cloudRx = PHASE_CHART.plotW / 2 - 20;
            const cloudRy = PHASE_CHART.plotH / 2 - 20;
            const effects = ctx.wordCloudEffects;
            const sorted = [...effects].sort((a: any, b: any) => b.relevance - a.relevance);
            const maxRel = sorted[0]?.relevance || 100;

            wordEls.length = 0;
            const placed: { x: number; y: number; w: number; h: number }[] = [];
            const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
            const PAD = 2;

            for (let i = 0; i < sorted.length; i++) {
                const eff = sorted[i];
                const relFrac = eff.relevance / maxRel;
                const fontSize = 12 + Math.pow(relFrac, 0.7) * 28;
                const color = WORD_CLOUD_PALETTE[i % WORD_CLOUD_PALETTE.length];
                const opacity = 0.82 + relFrac * 0.18;

                const textEl = svgEl('text', {
                    x: cx.toFixed(1), y: cy.toFixed(1),
                    fill: color,
                    'font-size': fontSize.toFixed(1),
                    'font-weight': relFrac > 0.55 ? '700' : '600',
                    'letter-spacing': relFrac > 0.55 ? '-0.04em' : '-0.02em',
                    class: 'word-cloud-word',
                    opacity: '0',
                    'text-anchor': 'middle',
                    'dominant-baseline': 'central',
                }) as SVGTextElement;
                textEl.textContent = eff.name;
                group.appendChild(textEl);

                const bbox = textEl.getBBox();

                // Golden angle spiral placement
                let bestX = cx, bestY = cy;
                if (i > 0) {
                    let found = false;
                    for (let rNorm = 0.05; rNorm <= 1; rNorm += 0.04) {
                        const angSteps = Math.min(48, Math.max(16, Math.floor(24 * rNorm)));
                        for (let ai = 0; ai < angSteps; ai++) {
                            const angle = i * GOLDEN_ANGLE + (ai / angSteps) * Math.PI * 2;
                            const tx = cx + cloudRx * rNorm * Math.cos(angle);
                            const ty = cy + cloudRy * rNorm * Math.sin(angle);
                            if ((tx - cx) ** 2 / (cloudRx ** 2) + (ty - cy) ** 2 / (cloudRy ** 2) > 1) continue;
                            const collides = placed.some(p =>
                                tx - bbox.width / 2 - PAD < p.x + p.w / 2 &&
                                tx + bbox.width / 2 + PAD > p.x - p.w / 2 &&
                                ty - bbox.height / 2 - PAD < p.y + p.h / 2 &&
                                ty + bbox.height / 2 + PAD > p.y - p.h / 2
                            );
                            if (!collides) { bestX = tx; bestY = ty; found = true; break; }
                        }
                        if (found) break;
                    }
                }

                placed.push({ x: bestX, y: bestY, w: bbox.width, h: bbox.height });
                wordEls.push({
                    el: textEl, cx, cy,
                    targetX: bestX, targetY: bestY,
                    opacity,
                    staggerDelay: i * STAGGER,
                });
            }
        },

        render(t, ctx) {
            const totalMs = this.duration;
            const elapsedMs = t * totalMs;

            for (const w of wordEls) {
                const wordStart = w.staggerDelay;
                const wordEnd = wordStart + totalMs * SLIDE_DUR_FRAC;
                if (elapsedMs < wordStart) {
                    w.el.setAttribute('opacity', '0');
                    continue;
                }
                const wordT = Math.min(1, (elapsedMs - wordStart) / (totalMs * SLIDE_DUR_FRAC));
                const ease = easeOutBack(wordT);
                const x = w.cx + (w.targetX - w.cx) * ease;
                const y = w.cy + (w.targetY - w.cy) * ease;
                w.el.setAttribute('x', x.toFixed(1));
                w.el.setAttribute('y', y.toFixed(1));
                w.el.setAttribute('opacity', (w.opacity * Math.min(1, wordT * 2.5)).toFixed(2));

                // Float wobble for arrived words
                if (wordT >= 1) {
                    const floatT = (elapsedMs - wordEnd) / 1000;
                    const phase = w.targetX * 0.037 + w.targetY * 0.029;
                    const dx = Math.sin(floatT * 0.5 + phase) * 3.5;
                    const dy = Math.cos(floatT * 0.4 + phase * 1.3) * 2.5;
                    w.el.setAttribute('x', (w.targetX + dx).toFixed(1));
                    w.el.setAttribute('y', (w.targetY + dy).toFixed(1));
                }
            }
        },

        exit(ctx) {
            const group = ctx.groups['phase-word-cloud'];
            if (group) {
                group.querySelectorAll('.word-cloud-word').forEach(el => el.remove());
            }
            wordEls.length = 0;
        },
    };
}

// --- Orbital rings (looping, runs concurrently with word cloud) ---
export function createOrbitalRingsSegment(startTime: number, duration: number): AnimationSegment {
    let ring1: SVGPathElement | null = null;
    let ring2: SVGPathElement | null = null;
    const ghostLayers: SVGPathElement[] = [];
    let RX1 = 0, RY1 = 0, RX2 = 0, RY2 = 0;
    let cx = 0, cy = 0;
    const NPTS = 72;
    const bandStep = 10;

    function computeD(t: number, rx: number, ry: number, phase: number): string {
        const breathe = 1 + 0.018 * Math.sin(t * 1.2 + phase);
        let d = '';
        for (let i = 0; i <= NPTS; i++) {
            const angle = (i / NPTS) * Math.PI * 2;
            const wobble = 1 + 0.035 * Math.sin(angle * 2 + t * 0.8 + phase)
                + 0.022 * Math.sin(angle * 3 + t * 1.3 + phase * 0.7);
            const px = cx + rx * breathe * wobble * Math.cos(angle);
            const py = cy + ry * breathe * wobble * Math.sin(angle);
            d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
        }
        return d + 'Z';
    }

    return {
        id: 'orbital-rings',
        label: 'Rings',
        category: 'word-cloud',
        startTime,
        duration,
        phaseIdx: 0,
        loopPeriod: 6000, // Slow ring animation cycle

        enter(ctx) {
            const group = ctx.groups['phase-word-cloud'];
            if (!group) return;

            cx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
            cy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
            const singleRing = AppState.maxEffects === 1;
            const pad = 12;
            const wobbleMax = 1.08;
            const maxRy = (cy - PHASE_CHART.padT) / wobbleMax;
            RX1 = PHASE_CHART.plotW / 2 - pad;
            RY1 = Math.min(PHASE_CHART.plotH / 2 - pad, maxRy);
            RX2 = RX1 + 14;
            RY2 = Math.min(RY1 + 8, maxRy);

            const ot = chartTheme();
            ghostLayers.length = 0;

            // Ghost layers for ring 1
            for (let i = -2; i <= 2; i++) {
                if (i === 0) continue;
                const ghost = svgEl('path', {
                    fill: 'none', stroke: ot.orbitalRing1,
                    'stroke-width': '6', opacity: '0.18',
                    filter: 'url(#orbital-ghost)',
                    class: 'orbital-ring',
                }) as SVGPathElement;
                group.insertBefore(ghost, group.firstChild);
                ghostLayers.push(ghost);
            }

            ring1 = svgEl('path', {
                fill: 'none', stroke: ot.orbitalRing1,
                'stroke-width': '2.5', opacity: '0.5',
                class: 'orbital-ring',
            }) as SVGPathElement;
            group.insertBefore(ring1, group.firstChild);

            if (!singleRing) {
                for (let i = -2; i <= 2; i++) {
                    if (i === 0) continue;
                    const ghost = svgEl('path', {
                        fill: 'none', stroke: ot.orbitalRing2,
                        'stroke-width': '6', opacity: '0.18',
                        filter: 'url(#orbital-ghost)',
                        class: 'orbital-ring',
                    }) as SVGPathElement;
                    group.insertBefore(ghost, group.firstChild);
                    ghostLayers.push(ghost);
                }
                ring2 = svgEl('path', {
                    fill: 'none', stroke: ot.orbitalRing2,
                    'stroke-width': '2.5', opacity: '0.5',
                    class: 'orbital-ring',
                }) as SVGPathElement;
                group.insertBefore(ring2, group.firstChild);
            }
        },

        render(t, ctx) {
            // t is the loop fraction [0,1] repeating
            const elapsed = t * (this.loopPeriod! / 1000);

            // Update ghost layers
            const ghostPhases = [0, 0.6, 1.2, 1.8, 2.4];
            let gIdx = 0;
            for (let i = -2; i <= 2; i++) {
                if (i === 0) continue;
                if (ghostLayers[gIdx]) {
                    ghostLayers[gIdx].setAttribute('d', computeD(elapsed, RX1 + i * bandStep, RY1 + i * (bandStep * 0.5), ghostPhases[i + 2]));
                }
                gIdx++;
            }
            if (ring2) {
                for (let i = -2; i <= 2; i++) {
                    if (i === 0) continue;
                    if (ghostLayers[gIdx]) {
                        ghostLayers[gIdx].setAttribute('d', computeD(elapsed, RX2 + i * bandStep, RY2 + i * (bandStep * 0.5), ghostPhases[i + 2] + Math.PI * 0.3));
                    }
                    gIdx++;
                }
            }

            if (ring1) ring1.setAttribute('d', computeD(elapsed, RX1, RY1, 0));
            if (ring2) ring2.setAttribute('d', computeD(elapsed, RX2, RY2, Math.PI));
        },

        exit(ctx) {
            for (const g of ghostLayers) g.remove();
            ghostLayers.length = 0;
            if (ring1) ring1.remove();
            if (ring2) ring2.remove();
            ring1 = null;
            ring2 = null;
        },
    };
}

// --- Word cloud dismiss ---
export function createWordCloudDismissSegment(startTime: number): AnimationSegment {
    const FLY_DUR = 650;
    const BURST_DUR = 480;
    const TOTAL = Math.max(FLY_DUR + 100, BURST_DUR + 50);

    // Snapshot original word positions on first render call for idempotent animation
    let wordSnapshots: { el: SVGElement; startX: number; startY: number; startOpacity: number; dx: number; dy: number }[] | null = null;

    function captureSnapshots(group: SVGGElement) {
        const words = group.querySelectorAll('.word-cloud-word');
        const cx = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        const cy = PHASE_CHART.padT + PHASE_CHART.plotH / 2;
        wordSnapshots = [];

        words.forEach((word: any) => {
            const x = parseFloat(word.getAttribute('x') || String(cx));
            const y = parseFloat(word.getAttribute('y') || String(cy));
            const opacity = parseFloat(word.getAttribute('opacity') || '1');
            let dx = x - cx;
            let dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const burstDist = 220;
            dx = (dx / dist) * burstDist;
            dy = (dy / dist) * burstDist;

            wordSnapshots!.push({ el: word as SVGElement, startX: x, startY: y, startOpacity: opacity, dx, dy });
        });
    }

    return {
        id: 'word-cloud-dismiss',
        label: 'Dismiss',
        category: 'word-cloud',
        startTime,
        duration: TOTAL,
        phaseIdx: 0,

        enter(ctx) {
            // Elements already exist from the entrance segment.
            // Capture their positions for idempotent animation.
            wordSnapshots = null;
        },

        render(t, ctx) {
            const group = ctx.groups['phase-word-cloud'];
            if (!group) return;

            // Capture original positions once on first render
            if (!wordSnapshots) captureSnapshots(group);
            if (!wordSnapshots || wordSnapshots.length === 0) return;

            const ease = easeInOutCubic(t);
            for (const snap of wordSnapshots) {
                snap.el.setAttribute('x', (snap.startX + snap.dx * ease).toFixed(1));
                snap.el.setAttribute('y', (snap.startY + snap.dy * ease).toFixed(1));
                snap.el.setAttribute('opacity', Math.max(0, snap.startOpacity * (1 - t * 1.8)).toFixed(2));
            }
        },

        exit(ctx) {
            // Don't remove word elements — they belong to the entrance segment.
            // Don't reset positions either — entrance's render() will set them.
            // Just clear snapshots so they're re-captured on next enter.
            wordSnapshots = null;
        },
    };
}

// --- Ring morph into baseline curves ---
export function createRingsToCurvesMorphSegment(startTime: number): AnimationSegment {
    return {
        id: 'rings-to-curves-morph',
        label: 'Ring Morph',
        category: 'word-cloud',
        startTime,
        duration: 1400,
        phaseIdx: 0,

        enter(ctx) {
            // Rings exist from orbital segment. We'll morph them in render().
        },

        render(t, ctx) {
            if (!ctx.curvesData) return;
            const group = ctx.groups['phase-word-cloud'];
            if (!group) return;
            const rings = group.querySelectorAll('.orbital-ring:not([filter])');
            // This is a simplified version — in production we'd sample ring and curve points
            // and interpolate. For now, fade rings out as curves fade in.
            const ease = easeInOutCubic(t);
            rings.forEach((ring: any) => {
                ring.setAttribute('opacity', (0.5 * (1 - ease)).toFixed(2));
            });
            // Ghost layers fade faster
            group.querySelectorAll('.orbital-ring[filter]').forEach((ghost: any) => {
                ghost.setAttribute('opacity', (0.18 * (1 - ease * 1.5)).toFixed(2));
            });
        },

        exit(ctx) {
            // Don't remove orbital ring elements — they belong to the orbital rings segment.
            // Just reset opacity to pre-morph state (undo the fade).
            const group = ctx.groups['phase-word-cloud'];
            if (!group) return;
            group.querySelectorAll('.orbital-ring:not([filter])').forEach((ring: any) => {
                ring.setAttribute('opacity', '0.5');
            });
            group.querySelectorAll('.orbital-ring[filter]').forEach((ghost: any) => {
                ghost.setAttribute('opacity', '0.18');
            });
        },
    };
}
