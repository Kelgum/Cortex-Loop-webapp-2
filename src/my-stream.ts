/**
 * my-stream — SVG rendering engine for the My Stream element.
 * Renders 28 iconic half-cartridge wheels in an S-wave stagger pattern:
 * bottom halves anchored in a row, top halves offset right by one radius,
 * bridging between adjacent bottom halves to form the continuous wave.
 *
 * Substance fills distinguish capsules (>300mg, full-spoke oval) from
 * tablets (≤300mg, small dots, up to 5 per spoke).
 *
 * Exports: mountMyStream, refreshMyStream, animateStreamFill, teardownMyStream
 * Depends on: constants (MY_STREAM, SVG_NS), my-stream-store, utils
 */

import { MY_STREAM, SVG_NS } from './constants';
import { svgEl } from './utils';
import {
    getStreamProtocols,
    getDaySlots,
    getStreamSummary,
    getStreamCollapsed,
    setStreamCollapsed,
} from './my-stream-store';
import type { SlotFill } from './my-stream-store';

// ── Internal state ─────────────────────────────────────────────────

let _container: HTMLElement | null = null;
let _svgRoot: SVGSVGElement | null = null;
let _headerEl: HTMLElement | null = null;
let _summaryEl: HTMLElement | null = null;
let _stripEl: HTMLElement | null = null;

// ── Geometry helpers ───────────────────────────────────────────────

const { spokeCount, spokeDeg, cartridgeDiameter, spokeInnerR, hubDotR, gapY, emptySpokeDeg } = MY_STREAM;
const R = cartridgeDiameter / 2; // outer radius = 18
const spokeOuterR = R - 1; // spoke tip just inside circle edge
const step = 2 * R; // distance between adjacent cartridge centers (one diameter)

/** Spoke angle in degrees for index `i` (12 o'clock = -90°). */
function spokeAngle(i: number): number {
    return i * spokeDeg - 90;
}

/** Degrees → radians. */
function deg2rad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/** Is this spoke the mechanical empty slot? */
function isEmptySpoke(i: number): boolean {
    const angle = (i * spokeDeg) % 360;
    return Math.abs(angle - (emptySpokeDeg % 360)) < spokeDeg / 2;
}

/**
 * Get the inner and outer radii for a tablet radial band (0-4).
 * 5 bands evenly divide the spoke band from spokeInnerR to spokeOuterR.
 */
function bandRadii(slotPosition: number): { inner: number; outer: number } {
    const bandH = (spokeOuterR - spokeInnerR) / MY_STREAM.tabletsPerSpoke;
    return {
        inner: spokeInnerR + bandH * slotPosition,
        outer: spokeInnerR + bandH * (slotPosition + 1),
    };
}

/**
 * Build an SVG arc-segment path string (a curved wedge between two arcs).
 * startDeg/endDeg are in standard SVG angle space (degrees).
 * innerR/outerR are the two radii.
 */
function arcSegmentPath(startDeg: number, endDeg: number, innerR: number, outerR: number): string {
    const sr = deg2rad(startDeg);
    const er = deg2rad(endDeg);

    const ix1 = Math.cos(sr) * innerR;
    const iy1 = Math.sin(sr) * innerR;
    const ix2 = Math.cos(er) * innerR;
    const iy2 = Math.sin(er) * innerR;

    const ox1 = Math.cos(sr) * outerR;
    const oy1 = Math.sin(sr) * outerR;
    const ox2 = Math.cos(er) * outerR;
    const oy2 = Math.sin(er) * outerR;

    // M to inner-start, arc to inner-end, line to outer-end, arc back to outer-start, close
    return [
        `M ${ix1} ${iy1}`,
        `A ${innerR} ${innerR} 0 0 1 ${ix2} ${iy2}`,
        `L ${ox2} ${oy2}`,
        `A ${outerR} ${outerR} 0 0 0 ${ox1} ${oy1}`,
        'Z',
    ].join(' ');
}

// ── Build single cartridge icon SVG group ──────────────────────────

function buildCartridgeIcon(dayIndex: number): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.setAttribute('class', 'ms-cartridge');
    g.setAttribute('data-day', String(dayIndex));

    // Outer ring (cartridge perimeter)
    g.appendChild(
        svgEl('circle', {
            cx: 0,
            cy: 0,
            r: R,
            fill: 'none',
            stroke: MY_STREAM.spokeStroke,
            'stroke-width': 0.8,
        }),
    );

    // Inner ring (hub boundary — separates mechanism from substance band)
    g.appendChild(
        svgEl('circle', {
            cx: 0,
            cy: 0,
            r: spokeInnerR,
            fill: 'none',
            stroke: MY_STREAM.spokeStroke,
            'stroke-width': 0.4,
        }),
    );

    // Spokes from hub ring to outer ring
    for (let i = 0; i < spokeCount; i++) {
        const angleDeg = spokeAngle(i);
        const rad = deg2rad(angleDeg);
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        g.appendChild(
            svgEl('line', {
                x1: cosA * spokeInnerR,
                y1: sinA * spokeInnerR,
                x2: cosA * spokeOuterR,
                y2: sinA * spokeOuterR,
                stroke: MY_STREAM.spokeStroke,
                'stroke-width': 0.4,
            }),
        );
    }

    // Central hub dot (mechanism indicator)
    g.appendChild(
        svgEl('circle', {
            cx: 0,
            cy: 0,
            r: hubDotR,
            fill: MY_STREAM.hubColor,
            opacity: 0.6,
        }),
    );

    return g;
}

// ── Build the full 28-cartridge S-wave strip ───────────────────────

function buildStripSvg(): SVGSVGElement {
    // S-wave layout:
    //   Bottom half i centered at x = R + i * step
    //   Top half i    centered at x = R + i * step + R  (offset right by R)
    //   step = 2 * R (one diameter)
    //
    // Total width: R + 27*step + R + R = R + 27*2R + 2R = R(1 + 54 + 2) = 57R
    const totalW = step * MY_STREAM.days + R;
    const baseY = R + 2; // center Y for the split line (room for top halves above)
    const totalH = 2 * R + gapY + 14; // room for both halves + gap + day labels

    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svg.setAttribute('class', 'ms-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Clip path definitions (in local group coords, center at 0,0)
    const defs = document.createElementNS(SVG_NS, 'defs');

    const clipTop = document.createElementNS(SVG_NS, 'clipPath');
    clipTop.id = 'ms-clip-top';
    clipTop.appendChild(svgEl('rect', { x: -R - 1, y: -R - 1, width: 2 * R + 2, height: R + 1 }));
    defs.appendChild(clipTop);

    const clipBottom = document.createElementNS(SVG_NS, 'clipPath');
    clipBottom.id = 'ms-clip-bottom';
    clipBottom.appendChild(svgEl('rect', { x: -R - 1, y: 0, width: 2 * R + 2, height: R + 1 }));
    defs.appendChild(clipBottom);

    svg.appendChild(defs);

    for (let d = 0; d < MY_STREAM.days; d++) {
        const bottomCx = R + d * step;
        const topCx = bottomCx + R; // offset right by R

        // Bottom half (anchored row)
        const bottomGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        bottomGroup.setAttribute('transform', `translate(${bottomCx}, ${baseY})`);
        bottomGroup.setAttribute('clip-path', 'url(#ms-clip-bottom)');
        bottomGroup.appendChild(buildCartridgeIcon(d));
        svg.appendChild(bottomGroup);

        // Top half (shifted right by R to bridge between adjacent bottom halves)
        const topGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        topGroup.setAttribute('transform', `translate(${topCx}, ${baseY - gapY})`);
        topGroup.setAttribute('clip-path', 'url(#ms-clip-top)');
        topGroup.appendChild(buildCartridgeIcon(d));
        svg.appendChild(topGroup);

        // Day label below the bottom half
        const labelX = (bottomCx + topCx) / 2; // centered between bottom and top centers
        svg.appendChild(
            (() => {
                const label = svgEl('text', {
                    x: labelX,
                    y: baseY + R + 8,
                    'text-anchor': 'middle',
                    'font-family': "'IBM Plex Mono', monospace",
                    'font-size': 6,
                    fill: 'rgba(255,255,255,0.2)',
                    class: 'ms-day-label',
                });
                label.textContent = String(d + 1);
                return label;
            })(),
        );
    }

    return svg;
}

// ── Build header + summary ─────────────────────────────────────────

function buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'ms-header';

    const label = document.createElement('span');
    label.className = 'ms-header-label';
    label.textContent = 'My Stream';

    const chevron = document.createElement('button');
    chevron.className = 'ms-collapse-btn';
    chevron.setAttribute('aria-label', 'Toggle My Stream');
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.addEventListener('click', () => {
        const collapsed = !getStreamCollapsed();
        setStreamCollapsed(collapsed);
        _container?.classList.toggle('ms-collapsed', collapsed);
    });

    const count = document.createElement('span');
    count.className = 'ms-header-count';

    header.appendChild(label);
    header.appendChild(count);
    header.appendChild(chevron);

    return header;
}

function buildSummary(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ms-summary';
    return el;
}

// ── Mount / Refresh / Teardown ─────────────────────────────────────

export function mountMyStream(container: HTMLElement): void {
    _container = container;

    _headerEl = buildHeader();
    _stripEl = document.createElement('div');
    _stripEl.className = 'ms-strip';
    _summaryEl = buildSummary();

    _container.appendChild(_headerEl);
    _container.appendChild(_stripEl);
    _container.appendChild(_summaryEl);

    _svgRoot = buildStripSvg();
    _stripEl.appendChild(_svgRoot);

    const collapsed = getStreamCollapsed();
    _container.classList.toggle('ms-collapsed', collapsed);
    updateVisibility();
    applySlotFills();
    updateSummary();
}

export function refreshMyStream(): void {
    if (!_container) return;
    updateVisibility();
    applySlotFills();
    updateSummary();
}

export function animateStreamFill(cycleId: string): void {
    if (!_container) return;

    _container.classList.remove('ms-collapsed');
    setStreamCollapsed(false);

    const protocols = getStreamProtocols();
    const protocol = protocols.find(p => p.cycleId === cycleId);
    if (!protocol) return;

    let delay = 0;
    for (const dayAlloc of protocol.days) {
        for (const slot of dayAlloc.slots) {
            const d = delay;
            setTimeout(() => fillSlotElements(dayAlloc.day, slot), d);
            delay += MY_STREAM.fillDelay;
        }
    }

    updateSummary();
}

export function teardownMyStream(): void {
    _container = null;
    _svgRoot = null;
    _headerEl = null;
    _summaryEl = null;
    _stripEl = null;
}

// ── Internal helpers ───────────────────────────────────────────────

function updateVisibility(): void {
    // Always visible — even when empty, the stream strip shows the 28 empty cartridges
}

function updateSummary(): void {
    if (!_summaryEl) return;
    const { protocols, substances, cartridges } = getStreamSummary();
    if (protocols === 0) {
        _summaryEl.textContent = '';
    } else {
        _summaryEl.textContent =
            `${protocols} protocol${protocols !== 1 ? 's' : ''}` +
            ` · ${substances} substance${substances !== 1 ? 's' : ''}` +
            ` · ${cartridges} cartridge${cartridges === '1' ? '' : 's'}`;
    }
    const countEl = _headerEl?.querySelector('.ms-header-count');
    if (countEl) countEl.textContent = protocols > 0 ? String(protocols) : '';
}

function applySlotFills(): void {
    if (!_svgRoot) return;

    // Clear all dynamic fills (capsule ovals + tablet dots) from previous renders
    _svgRoot.querySelectorAll('.ms-capsule-fill, .ms-tablet-fill').forEach(el => el.remove());

    // Reset structural slot outlines
    _svgRoot.querySelectorAll<SVGElement>('.ms-slot').forEach(el => {
        el.setAttribute('fill', 'none');
        el.setAttribute('fill-opacity', '0');
        el.setAttribute('stroke', MY_STREAM.emptySlotStroke);
        el.setAttribute('stroke-opacity', '1');
    });

    // Fill from store
    for (let d = 0; d < MY_STREAM.days; d++) {
        const slots = getDaySlots(d);
        for (const slot of slots) {
            fillSlotElements(d, slot);
        }
    }
}

/**
 * Render a single slot fill (capsule or tablet) into the SVG as an arc-segment
 * wedge, matching the Lx.Player Virtualizer's carousel geometry.
 *
 * - Tablet: curved wedge spanning one radial band and ~70% of a spoke-width
 * - Capsule: tall wedge spanning all 5 radial bands (full spoke depth)
 */
function fillSlotElements(day: number, slot: SlotFill): void {
    if (!_svgRoot) return;

    const groups = _svgRoot.querySelectorAll<SVGGElement>(`.ms-cartridge[data-day="${day}"]`);
    const centerDeg = spokeAngle(slot.spokeIndex);
    const halfSpan = MY_STREAM.tabletHalfSpan;

    for (const g of groups) {
        if (slot.isCapsule) {
            // Capsule: arc-segment spanning all 5 bands (full spoke depth)
            const d = arcSegmentPath(
                centerDeg - halfSpan,
                centerDeg + halfSpan,
                spokeInnerR + 0.3,
                spokeOuterR - 0.2,
            );
            const el = svgEl('path', {
                d,
                fill: slot.substanceColor,
                'fill-opacity': String(MY_STREAM.fillOpacity + 0.1),
                stroke: slot.substanceColor,
                'stroke-opacity': '0.5',
                'stroke-width': 0.15,
                class: 'ms-capsule-fill',
            });
            g.appendChild(el);
        } else {
            // Tablet: arc-segment wedge in one radial band
            const { inner, outer } = bandRadii(slot.slotPosition);
            const d = arcSegmentPath(
                centerDeg - halfSpan,
                centerDeg + halfSpan,
                inner + 0.1,
                outer - 0.1,
            );
            const el = svgEl('path', {
                d,
                fill: slot.substanceColor,
                'fill-opacity': String(MY_STREAM.fillOpacity),
                stroke: slot.substanceColor,
                'stroke-opacity': '0.6',
                'stroke-width': 0.1,
                class: 'ms-tablet-fill',
            });
            g.appendChild(el);
        }
    }
}
