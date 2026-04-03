/**
 * POI Render — Renders Points of Interest dots and connectors on biometric strips.
 * Extracted from biometric.ts to break the biometric ↔ multi-day-animation import cycle.
 * Exports: renderPoiDotsAndConnectors, animatePoiWeekly
 * Depends on: utils (svgEl, phaseChartX, clamp), types
 */
import { svgEl, phaseChartX, clamp } from './utils';
import type { PoiEvent, BiometricChannel, Intervention } from './types';

/** Find the best matching pill element for a POI event. Tries exact match first, then
 *  case-insensitive / substring, then falls back to closest pill by time. */
function findPillForPoi(poi: PoiEvent, timelineGroup: Element): Element | null {
    const pills = Array.from(timelineGroup.querySelectorAll('.timeline-pill-group[data-substance-key]'));
    if (pills.length === 0) return null;

    const key = poi.connectedSubstanceKey;
    if (key) {
        // 1. Exact match
        const exact = pills.find(p => p.getAttribute('data-substance-key') === key);
        if (exact) return exact;

        // 2. Case-insensitive match
        const lower = key.toLowerCase();
        const ciMatch = pills.find(p => (p.getAttribute('data-substance-key') || '').toLowerCase() === lower);
        if (ciMatch) return ciMatch;

        // 3. Substring / startsWith match (e.g. LLM says "caffeine", pill has "caffeineIR")
        const subMatch = pills.find(p => {
            const pk = (p.getAttribute('data-substance-key') || '').toLowerCase();
            return pk.startsWith(lower) || lower.startsWith(pk) || pk.includes(lower) || lower.includes(pk);
        });
        if (subMatch) return subMatch;
    }

    // 4. No key or no match — find closest pill by time
    const poiMinutes = poi.hour * 60;
    let best: Element | null = null;
    let bestDist = Infinity;
    for (const p of pills) {
        const tm = parseFloat(p.getAttribute('data-time-minutes') || '');
        if (isNaN(tm)) continue;
        const dist = Math.abs(tm - poiMinutes);
        if (dist < bestDist) {
            bestDist = dist;
            best = p;
        }
    }
    // Only accept time-based fallback if within 2 hours
    return bestDist <= 120 ? best : null;
}

export function renderPoiDotsAndConnectors(
    poiEvents: PoiEvent[],
    channels: BiometricChannel[],
    interventions: Intervention[],
    bioOffsetY = 0,
) {
    const spotterGroup = document.getElementById('phase-spotter-highlights');
    const poiContainer = document.getElementById('phase-poi-connectors');
    if (spotterGroup) spotterGroup.innerHTML = '';
    if (poiContainer) poiContainer.innerHTML = '';

    if (!poiEvents || poiEvents.length === 0) return;

    const timelineGroup = document.getElementById('phase-substance-timeline');

    for (const poi of poiEvents) {
        const ch = channels[poi.channelIdx];
        if (!ch) continue;

        const renderY = (ch as any)._renderY;
        const renderH = (ch as any)._renderH;
        if (renderY == null || renderH == null) continue;

        // Find the value at this hour
        const data = ch.data || [];
        const closest = data.reduce(
            (best: any, pt: any) => (Math.abs(pt.hour - poi.hour) < Math.abs(best.hour - poi.hour) ? pt : best),
            data[0] || { hour: poi.hour, value: 50 },
        );

        const [lo, hi] = ch.range || [0, 100];
        const span = hi - lo || 1;
        const normVal = clamp((closest.value - lo) / span, 0, 1);
        const dotX = phaseChartX(poi.hour * 60);
        const dotY = renderY + renderH - normVal * renderH;

        // Red dot on the biometric curve
        if (spotterGroup) {
            const dot = svgEl('circle', {
                cx: String(dotX),
                cy: String(dotY),
                r: '3',
                fill: '#ff4444',
                class: 'poi-weekly-dot',
                opacity: '0.9',
            });
            spotterGroup.appendChild(dot);

            // Pulse ring
            const ring = svgEl('circle', {
                cx: String(dotX),
                cy: String(dotY),
                r: '3',
                fill: 'none',
                stroke: '#ff4444',
                'stroke-width': '1',
                class: 'poi-weekly-ring',
                opacity: '0.5',
            });
            // Add pulse animation via CSS class
            ring.style.animation = 'poi-pulse 2s ease-in-out infinite';
            spotterGroup.appendChild(ring);
        }

        // Connector line to substance pill
        if (poiContainer && timelineGroup) {
            const pill = findPillForPoi(poi, timelineGroup);
            if (pill) {
                // Read pill bar position directly from SVG attributes (no viewport conversion needed)
                const bar = pill.querySelector('.timeline-bar');
                if (!bar) continue;
                const barX = parseFloat(bar.getAttribute('x') || '0');
                const barY = parseFloat(bar.getAttribute('y') || '0');
                const barW = parseFloat(bar.getAttribute('width') || '0');
                const barH = parseFloat(bar.getAttribute('height') || '0');
                if (barW === 0) continue;

                const pillCX = barX + barW / 2;
                const pillCY = barY + barH / 2;

                // Build circuit-style (right-angle) connector from dot to pill
                const adjDotY = dotY + bioOffsetY;
                const midY = (adjDotY + pillCY) / 2;

                // Connector group (for animation targeting)
                const g = svgEl('g', {
                    class: 'poi-connector-weekly-group',
                    opacity: '0',
                });

                const connPath = svgEl('path', {
                    d: `M ${dotX} ${adjDotY} L ${dotX} ${midY} L ${pillCX} ${midY} L ${pillCX} ${pillCY}`,
                    stroke: '#ff4444',
                    'stroke-width': '1.2',
                    fill: 'none',
                    'stroke-opacity': '0.45',
                    class: 'poi-connector-weekly',
                });
                g.appendChild(connPath);

                // Small dot at pill end
                const pillDot = svgEl('circle', {
                    cx: String(pillCX),
                    cy: String(pillCY),
                    r: '1.5',
                    fill: '#ff4444',
                    'fill-opacity': '0.6',
                    class: 'poi-pill-dot',
                });
                g.appendChild(pillDot);

                poiContainer.appendChild(g);
            }
        }
    }
}

/**
 * Animate POI weekly connectors with a staggered stroke-dash draw effect.
 * Call after renderPoiDotsAndConnectors(). Skippable for instant seeks.
 */
export function animatePoiWeekly(duration = 800): void {
    const poiContainer = document.getElementById('phase-poi-connectors');
    const spotterGroup = document.getElementById('phase-spotter-highlights');
    if (!poiContainer && !spotterGroup) return;

    const groups = poiContainer ? Array.from(poiContainer.querySelectorAll('.poi-connector-weekly-group')) : [];
    const dots = spotterGroup ? Array.from(spotterGroup.querySelectorAll('.poi-weekly-dot')) : [];
    const rings = spotterGroup ? Array.from(spotterGroup.querySelectorAll('.poi-weekly-ring')) : [];

    // If no connectors or dots, nothing to animate — just show dots statically
    if (groups.length === 0 && dots.length === 0) return;

    // Hide dots initially for animation
    dots.forEach(d => d.setAttribute('opacity', '0'));
    rings.forEach(r => r.setAttribute('opacity', '0'));

    const connectorCount = Math.max(groups.length, dots.length);
    const stagger = Math.min(100, Math.max(50, duration / Math.max(connectorCount * 2, 1)));
    const drawDuration = Math.max(300, duration - stagger * Math.max(0, connectorCount - 1));

    // Animate each connector group + corresponding dot
    for (let i = 0; i < connectorCount; i++) {
        const g = groups[i] as SVGElement | undefined;
        const dot = dots[i] as SVGElement | undefined;
        const ring = rings[i] as SVGElement | undefined;

        window.setTimeout(() => {
            // Set up stroke-dash for path draw
            const path = g?.querySelector('path') as SVGPathElement | null;
            const pillDot = g?.querySelector('.poi-pill-dot') as SVGElement | null;
            let pathLength = 0;

            if (path) {
                try {
                    pathLength = path.getTotalLength();
                } catch {
                    pathLength = 0;
                }
                if (pathLength > 0) {
                    path.style.strokeDasharray = `${pathLength}`;
                    path.style.strokeDashoffset = `${pathLength}`;
                }
            }

            // Show the group
            if (g) g.setAttribute('opacity', '1');
            if (pillDot) pillDot.setAttribute('opacity', '0');

            const start = performance.now();
            const tick = (now: number) => {
                const rawT = Math.min(1, (now - start) / drawDuration);
                const ease = 1 - Math.pow(1 - rawT, 3); // ease-out cubic

                // Draw path
                if (path && pathLength > 0) {
                    path.style.strokeDashoffset = `${pathLength * (1 - ease)}`;
                }

                // Fade in bio dot
                if (dot) {
                    const dotT = Math.min(1, rawT / 0.35);
                    dot.setAttribute('opacity', (0.9 * dotT).toFixed(3));
                    dot.setAttribute('r', (2 + 1 * dotT).toFixed(2));
                }

                // Pulse ring
                if (ring) {
                    const pulseT = clamp((rawT - 0.1) / 0.7, 0, 1);
                    ring.setAttribute('opacity', (0.5 * pulseT).toFixed(3));
                    ring.setAttribute('r', (3 + 5 * pulseT).toFixed(2));
                }

                // Pill-end dot
                if (pillDot) {
                    const pillT = clamp((rawT - 0.5) / 0.5, 0, 1);
                    pillDot.setAttribute('opacity', (0.6 * pillT).toFixed(3));
                }

                if (rawT < 1) {
                    requestAnimationFrame(tick);
                    return;
                }

                // Final state
                if (path) {
                    path.style.strokeDasharray = '';
                    path.style.strokeDashoffset = '';
                }
                if (dot) {
                    dot.setAttribute('opacity', '0.9');
                    dot.setAttribute('r', '3');
                }
                if (ring) {
                    ring.setAttribute('opacity', '0.5');
                    ring.setAttribute('r', '3');
                    ring.style.animation = 'poi-pulse 2s ease-in-out infinite';
                }
                if (pillDot) {
                    pillDot.setAttribute('opacity', '0.6');
                }
            };

            requestAnimationFrame(tick);
        }, i * stagger);
    }
}
