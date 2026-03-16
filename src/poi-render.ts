/**
 * POI Render — Renders Points of Interest dots and connectors on biometric strips.
 * Extracted from biometric.ts to break the biometric ↔ multi-day-animation import cycle.
 * Exports: renderPoiDotsAndConnectors
 * Depends on: utils (svgEl, phaseChartX, clamp), types
 */
import { svgEl, phaseChartX, clamp } from './utils';
import type { PoiEvent, BiometricChannel, Intervention } from './types';

export function renderPoiDotsAndConnectors(
    poiEvents: PoiEvent[],
    channels: BiometricChannel[],
    interventions: Intervention[],
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

        // Connector line to substance pill (if connected)
        if (poi.connectedSubstanceKey && poiContainer && timelineGroup) {
            // Find the substance pill
            const pill = timelineGroup.querySelector(`[data-substance-key="${poi.connectedSubstanceKey}"]`);
            if (pill) {
                const pillRect = pill.getBoundingClientRect();
                const svgNode = document.getElementById('phase-chart-svg');
                if (!(svgNode instanceof SVGSVGElement)) continue;
                const svgRect = svgNode.getBoundingClientRect();
                const svgCTM = svgNode.getScreenCTM();
                if (svgCTM) {
                    // Convert pill center to SVG coordinates
                    const pillCX = (pillRect.left + pillRect.width / 2 - svgRect.left) / svgCTM.a;
                    const pillCY = (pillRect.top - svgRect.top) / svgCTM.d;

                    // Build bezier connector from dot to pill
                    const midY = (dotY + pillCY) / 2;
                    const connPath = svgEl('path', {
                        d: `M ${dotX} ${dotY} Q ${dotX} ${midY} ${pillCX} ${pillCY}`,
                        stroke: '#ff4444',
                        'stroke-width': '0.8',
                        'stroke-dasharray': '3 3',
                        fill: 'none',
                        opacity: '0.5',
                        class: 'poi-connector-weekly',
                    });
                    poiContainer.appendChild(connPath);
                }
            }
        }
    }
}
