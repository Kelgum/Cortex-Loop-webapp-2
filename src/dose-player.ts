/**
 * dose-player — SVG generation for the dose.player device and circular cartridge.
 * Exports: buildDosePlayerSvg, buildCartridgeSlots
 * Depends on: constants (COMPILE_ZONE, SVG_NS)
 */
import { COMPILE_ZONE, SVG_NS } from './constants';
import { svgEl } from './utils';

export interface CartridgeSlot {
    /** Substance name */
    name: string;
    /** Substance color from the timeline pill */
    color: string;
    /** Dose string (e.g. "100mg") */
    dose: string;
    /** Angle in degrees for this slot position */
    angle: number;
}

/**
 * Compute slot layout for N substances evenly around the cartridge ring.
 */
export function buildCartridgeSlots(
    substances: { name: string; color: string; dose: string }[],
    totalSlots = substances.length,
): CartridgeSlot[] {
    if (substances.length === 0 || totalSlots <= 0) return [];
    const n = Math.max(1, totalSlots);
    const angleStep = 360 / n;
    return Array.from({ length: n }, (_, i) => {
        const source = substances[i % substances.length];
        return {
            name: source.name,
            color: source.color,
            dose: source.dose,
            angle: i * angleStep - 90, // start at 12 o'clock
        };
    });
}

/**
 * Build the full dose.player SVG group, centered at (0, 0).
 * Returns { root, slotGroups } so the caller can animate slot fills.
 */
export function buildDosePlayerSvg(
    slots: CartridgeSlot[],
    opts?: { showBody?: boolean; showLabel?: boolean },
): { root: SVGGElement; slotGroups: SVGGElement[]; hubDot: SVGElement } {
    const { ringRadius, hubRadius, slotW, slotH, slotRx, spokeWidth, deviceW, deviceH, deviceRx } = COMPILE_ZONE;
    const showBody = opts?.showBody ?? true;
    const showLabel = opts?.showLabel ?? true;

    const root = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    root.setAttribute('class', 'dose-player-device');

    // Device body
    if (showBody) {
        const body = svgEl('rect', {
            class: 'dp-body',
            x: -deviceW / 2,
            y: -deviceH / 2,
            width: deviceW,
            height: deviceH,
            rx: deviceRx,
            fill: '#0d1117',
            stroke: '#2a3040',
            'stroke-width': 1.5,
            opacity: 0,
        });
        root.appendChild(body);
    }

    // Cartridge group
    const cartridge = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    cartridge.setAttribute('class', 'dp-cartridge');
    root.appendChild(cartridge);

    // Outer ring track
    const ring = svgEl('circle', {
        class: 'dp-ring',
        cx: 0,
        cy: 0,
        r: ringRadius,
        fill: 'none',
        stroke: '#2a3040',
        'stroke-width': 2,
        opacity: 0,
    });
    cartridge.appendChild(ring);

    // Central hub
    const hub = svgEl('circle', {
        class: 'dp-hub',
        cx: 0,
        cy: 0,
        r: hubRadius,
        fill: '#1a1f2e',
        opacity: 0,
    });
    cartridge.appendChild(hub);

    // Hub accent dot
    const hubDot = svgEl('circle', {
        class: 'dp-hub-dot',
        cx: 0,
        cy: 0,
        r: 4,
        fill: '#10b981',
        opacity: 0,
    });
    cartridge.appendChild(hubDot);

    // Spokes and slots
    const slotGroups: SVGGElement[] = [];
    for (const slot of slots) {
        const rad = (slot.angle * Math.PI) / 180;
        const sx = Math.cos(rad) * ringRadius;
        const sy = Math.sin(rad) * ringRadius;

        // Spoke line
        const spoke = svgEl('line', {
            class: 'dp-spoke',
            x1: 0,
            y1: 0,
            x2: sx,
            y2: sy,
            stroke: '#2a3040',
            'stroke-width': spokeWidth,
            opacity: 0,
        });
        cartridge.appendChild(spoke);

        // Slot group (rotated to tangent)
        const sg = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        sg.setAttribute('class', 'dp-slot');
        sg.setAttribute('data-substance', slot.name);
        sg.setAttribute('transform', `rotate(${slot.angle}) translate(${ringRadius}, 0)`);
        sg.setAttribute('opacity', '0');

        // Slot rect (empty — just outline)
        const slotRect = svgEl('rect', {
            class: 'dp-slot-rect',
            x: -slotW / 2,
            y: -slotH / 2,
            width: slotW,
            height: slotH,
            rx: slotRx,
            fill: 'none',
            stroke: slot.color,
            'stroke-opacity': 0.3,
            'stroke-width': 1,
        });
        sg.appendChild(slotRect);

        slotGroups.push(sg);
        cartridge.appendChild(sg);
    }

    // Label
    if (showLabel) {
        const label = svgEl('text', {
            class: 'dp-label',
            x: 0,
            y: deviceH / 2 - 30,
            'text-anchor': 'middle',
            'font-family': "'IBM Plex Mono', monospace",
            'font-size': 11,
            'letter-spacing': '0.12em',
            fill: '#64748b',
            opacity: 0,
        });
        label.textContent = 'dose.player';
        root.appendChild(label);
    }

    return { root, slotGroups, hubDot };
}

/**
 * Fill a slot with its substance color (used during cartridge loading animation).
 */
export function fillSlot(slotGroup: SVGGElement, color: string): void {
    const rect = slotGroup.querySelector('.dp-slot-rect');
    if (rect) {
        rect.setAttribute('fill', color);
        rect.setAttribute('fill-opacity', '0.7');
        rect.setAttribute('stroke-opacity', '0.9');
    }
}

/**
 * Start the ambient glow-pulse animation cycling around the cartridge ring.
 * Returns a cleanup function to stop the animation.
 */
export function startAmbientPulse(slotGroups: SVGGElement[]): () => void {
    let rafId: number;
    const n = slotGroups.length;

    function tick() {
        const t = (performance.now() / 2000) % 1; // 2s per full cycle
        for (let i = 0; i < n; i++) {
            const slotT = (t - i / n + 1) % 1;
            const glow = slotT < 0.15 ? Math.sin((slotT / 0.15) * Math.PI) * 0.4 : 0;
            const rect = slotGroups[i].querySelector('.dp-slot-rect');
            if (rect) {
                const baseOpacity = 0.7;
                rect.setAttribute('fill-opacity', String(baseOpacity + glow));
            }
        }
        rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
}
