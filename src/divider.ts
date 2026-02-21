import { PHASE_CHART } from './constants';
import { AppState, DividerState } from './state';
import { svgEl, chartTheme } from './utils';

/** Get or create a per-effect sub-group within a parent SVG group */
export function getEffectSubGroup(parentGroup: Element, effectIdx: number): Element {
    const id = `${parentGroup.id}-e${effectIdx}`;
    let sub = parentGroup.querySelector(`#${id}`);
    if (!sub) {
        sub = svgEl('g', { id });
        if (DividerState.active) {
            sub.setAttribute('mask',
                effectIdx === 0 ? 'url(#divider-mask-left)' : 'url(#divider-mask-right)');
        }
        parentGroup.appendChild(sub);
    }
    return sub;
}

/** Install SVG mask + gradient pairs into <defs> for the 2-effect divider */
export function installDividerMasks(): void {
    const svg = document.getElementById('phase-chart-svg')!;
    const defs = svg.querySelector('defs')!;
    const minOp = DividerState.minOpacity;

    // Left gradient: opaque on left, fades to dim at divider
    const leftGrad = svgEl('linearGradient', {
        id: 'divider-grad-left', gradientUnits: 'userSpaceOnUse',
        x1: '0', y1: '0', x2: String(PHASE_CHART.viewW), y2: '0',
    });
    leftGrad.appendChild(svgEl('stop', { offset: '0', 'stop-color': 'white', 'stop-opacity': '1' }));
    leftGrad.appendChild(svgEl('stop', { offset: '0.45', 'stop-color': 'white', 'stop-opacity': '1' }));
    leftGrad.appendChild(svgEl('stop', { offset: '0.55', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    leftGrad.appendChild(svgEl('stop', { offset: '1', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    defs.appendChild(leftGrad);

    // Right gradient: dim on left, fades to opaque at divider
    const rightGrad = svgEl('linearGradient', {
        id: 'divider-grad-right', gradientUnits: 'userSpaceOnUse',
        x1: '0', y1: '0', x2: String(PHASE_CHART.viewW), y2: '0',
    });
    rightGrad.appendChild(svgEl('stop', { offset: '0', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    rightGrad.appendChild(svgEl('stop', { offset: '0.45', 'stop-color': 'white', 'stop-opacity': String(minOp) }));
    rightGrad.appendChild(svgEl('stop', { offset: '0.55', 'stop-color': 'white', 'stop-opacity': '1' }));
    rightGrad.appendChild(svgEl('stop', { offset: '1', 'stop-color': 'white', 'stop-opacity': '1' }));
    defs.appendChild(rightGrad);

    // Left mask
    const leftMask = svgEl('mask', {
        id: 'divider-mask-left', maskUnits: 'userSpaceOnUse',
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
    });
    leftMask.appendChild(svgEl('rect', {
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
        fill: 'url(#divider-grad-left)',
    }));
    defs.appendChild(leftMask);

    // Right mask
    const rightMask = svgEl('mask', {
        id: 'divider-mask-right', maskUnits: 'userSpaceOnUse',
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
    });
    rightMask.appendChild(svgEl('rect', {
        x: '0', y: '0', width: String(PHASE_CHART.viewW), height: '600',
        fill: 'url(#divider-grad-right)',
    }));
    defs.appendChild(rightMask);

    DividerState.masks = { leftGrad, rightGrad };
}

/** Update mask gradient stop offsets based on divider x position */
export function updateDividerMasks(x: number): void {
    if (!DividerState.masks) return;
    const { leftGrad, rightGrad } = DividerState.masks;
    const halfFade = DividerState.fadeWidth / 2;
    const viewW = PHASE_CHART.viewW;

    const fadeStart = Math.max(0, (x - halfFade) / viewW);
    const fadeEnd = Math.min(1, (x + halfFade) / viewW);

    // Left gradient: 1,1 → minOp,minOp
    const ls = leftGrad.children;
    ls[1].setAttribute('offset', String(fadeStart));
    ls[2].setAttribute('offset', String(fadeEnd));

    // Right gradient: minOp,minOp → 1,1
    const rs = rightGrad.children;
    rs[1].setAttribute('offset', String(fadeStart));
    rs[2].setAttribute('offset', String(fadeEnd));
}

/** Create the visual divider line + drag handle */
export function createDividerVisual(): void {
    const svg = document.getElementById('phase-chart-svg')!;
    const tooltipOverlay = document.getElementById('phase-tooltip-overlay')!;
    const t = chartTheme();
    const x = DividerState.x;
    const plotTop = PHASE_CHART.padT;
    const plotH = PHASE_CHART.plotH;

    const group = svgEl('g', { id: 'effect-divider' });

    // Subtle glow backdrop
    const glow = svgEl('rect', {
        x: String(x - 8), y: String(plotTop),
        width: '16', height: String(plotH),
        fill: t.scanGlow, rx: '8', 'pointer-events': 'none',
    });
    group.appendChild(glow);

    // Thin divider line
    const line = svgEl('rect', {
        x: String(x - 0.75), y: String(plotTop),
        width: '1.5', height: String(plotH),
        fill: t.axisLine, 'fill-opacity': '0.35',
        rx: '0.75', 'pointer-events': 'none', class: 'divider-line',
    });
    group.appendChild(line);

    // Diamond handle at vertical center
    const cy = plotTop + plotH / 2;
    const diamond = svgEl('polygon', {
        points: `${x},${cy - 7} ${x + 4.5},${cy} ${x},${cy + 7} ${x - 4.5},${cy}`,
        fill: 'rgba(200, 210, 230, 0.2)', stroke: t.axisLine,
        'stroke-width': '0.75', 'stroke-opacity': '0.45',
        'pointer-events': 'none',
    });
    group.appendChild(diamond);

    // Invisible hit area for drag
    const hitArea = svgEl('rect', {
        x: String(x - 15), y: String(plotTop),
        width: '30', height: String(plotH),
        fill: 'transparent', cursor: 'col-resize',
        'pointer-events': 'all',
        class: 'divider-hit-area',
    });
    group.appendChild(hitArea);

    svg.insertBefore(group, tooltipOverlay);
    DividerState.elements = { group, line, glow, diamond, hitArea };
}

/** Move all divider visual elements and update masks */
export function updateDividerPosition(x: number): void {
    const { line, glow, diamond, hitArea } = DividerState.elements;
    const plotTop = PHASE_CHART.padT;
    const plotH = PHASE_CHART.plotH;
    const cy = plotTop + plotH / 2;

    line.setAttribute('x', String(x - 0.75));
    glow.setAttribute('x', String(x - 8));
    hitArea.setAttribute('x', String(x - 15));
    diamond.setAttribute('points',
        `${x},${cy - 7} ${x + 4.5},${cy} ${x},${cy + 7} ${x - 4.5},${cy}`);

    updateDividerMasks(x);

    // Fade Y-axis labels based on divider position
    const leftAxis = document.getElementById('phase-y-axis-left') as HTMLElement | null;
    const rightAxis = document.getElementById('phase-y-axis-right') as HTMLElement | null;
    if (leftAxis && rightAxis) {
        const norm = (x - PHASE_CHART.padL) / PHASE_CHART.plotW; // 0=far left, 1=far right
        leftAxis.style.transition = 'opacity 150ms ease';
        rightAxis.style.transition = 'opacity 150ms ease';
        leftAxis.style.opacity = String(0.3 + 0.7 * Math.min(1, norm * 2));
        rightAxis.style.opacity = String(0.3 + 0.7 * Math.min(1, (1 - norm) * 2));
    }
}

/** Attach drag handlers for the divider */
export function setupDividerDrag(): void {
    const { hitArea } = DividerState.elements;
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement;
    const minX = PHASE_CHART.padL;
    const maxX = PHASE_CHART.padL + PHASE_CHART.plotW;

    function onDown(e: Event) {
        e.preventDefault();
        DividerState.dragging = true;
        DividerState.elements.line.setAttribute('fill-opacity', '0.55');
    }

    function onMove(e: MouseEvent | TouchEvent) {
        if (!DividerState.dragging) return;
        e.preventDefault();
        const clientX = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
        const m = svg.getScreenCTM();
        if (!m) return;
        const svgX = (clientX - m.e) / m.a;
        const clampedX = Math.max(minX, Math.min(maxX, svgX));
        DividerState.x = clampedX;
        updateDividerPosition(clampedX);
    }

    function onUp() {
        if (!DividerState.dragging) return;
        DividerState.dragging = false;
        DividerState.elements.line.setAttribute('fill-opacity', '0.35');
    }

    hitArea.addEventListener('mousedown', onDown);
    hitArea.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove as EventListener);
    document.addEventListener('touchmove', onMove as EventListener, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    DividerState.dragCleanup = () => {
        hitArea.removeEventListener('mousedown', onDown);
        hitArea.removeEventListener('touchstart', onDown);
        document.removeEventListener('mousemove', onMove as EventListener);
        document.removeEventListener('touchmove', onMove as EventListener);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchend', onUp);
    };
}

/** Apply divider masks to any existing sub-groups */
export function applyDividerMasksToExistingGroups(): void {
    if (!DividerState.active) return;
    const groupIds = [
        'phase-baseline-curves', 'phase-desired-curves',
        'phase-lx-curves', 'phase-mission-arrows', 'phase-yaxis-indicators',
    ];
    for (const gid of groupIds) {
        const g = document.getElementById(gid);
        if (!g) continue;
        for (let ei = 0; ei < 2; ei++) {
            const sub = g.querySelector(`#${gid}-e${ei}`);
            if (sub) {
                sub.setAttribute('mask',
                    ei === 0 ? 'url(#divider-mask-left)' : 'url(#divider-mask-right)');
            }
        }
    }
}

/** Activate the 2-effect divider if conditions are met */
export function activateDivider(curvesData: any[]): void {
    if (AppState.maxEffects < 2 || !curvesData || curvesData.length < 2) return;

    DividerState.active = true;
    DividerState.x = PHASE_CHART.padL + PHASE_CHART.plotW / 2; // center = ~6pm

    installDividerMasks();
    applyDividerMasksToExistingGroups();
    createDividerVisual();
    setupDividerDrag();
    updateDividerPosition(DividerState.x);

    // Fade in
    DividerState.elements.group.style.opacity = '0';
    DividerState.elements.group.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 600, fill: 'forwards' }
    );
}

/** Clean up divider on chart reset */
export function cleanupDivider(): void {
    if (DividerState.dragCleanup) DividerState.dragCleanup();
    DividerState.dragCleanup = null;

    const el = document.getElementById('effect-divider');
    if (el) el.remove();

    const svg = document.getElementById('phase-chart-svg');
    if (svg) {
        const defs = svg.querySelector('defs');
        if (defs) {
            ['divider-mask-left', 'divider-mask-right',
             'divider-grad-left', 'divider-grad-right'].forEach(id => {
                const node = defs.querySelector(`#${id}`);
                if (node) node.remove();
            });
        }
    }

    // Reset Y-axis opacity
    const leftAxis = document.getElementById('phase-y-axis-left') as HTMLElement | null;
    const rightAxis = document.getElementById('phase-y-axis-right') as HTMLElement | null;
    if (leftAxis) leftAxis.style.opacity = '';
    if (rightAxis) rightAxis.style.opacity = '';

    DividerState.active = false;
    DividerState.elements = null;
    DividerState.masks = null;
    DividerState.dragging = false;
}
