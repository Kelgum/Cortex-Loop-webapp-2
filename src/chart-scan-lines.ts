/**
 * Chart Scan Lines — Animated vertical scan line effects for the phase chart, timeline zone, and biometric zone.
 * Exports: startScanLine, stopScanLine, startTimelineScanLine, stopTimelineScanLine, startBioScanLine, stopBioScanLine
 * Depends on: constants (PHASE_CHART, TIMELINE_ZONE, BIOMETRIC_ZONE), state (BiometricState), utils, biometric-devices
 */
import { PHASE_CHART, TIMELINE_ZONE, BIOMETRIC_ZONE } from './constants';
import { getSvgEl, mustGetSvgEl } from './dom';
import { BiometricState, isTurboActive } from './state';
import { svgEl, chartTheme } from './utils';
import { BIOMETRIC_DEVICES, type BiometricDevice } from './biometric-devices';

// ---- Module-level state ----
let scanLineAnimId: number | null = null;
let tlScanLineAnimId: number | null = null;
let bioScanLineAnimId: number | null = null;

export type MainScanLineElements = {
    glow: SVGRectElement;
    line: SVGRectElement;
    geodesicGlow: SVGPathElement;
    geodesicWash: SVGPathElement;
    geodesicSpecular: SVGPathElement;
    geodesic: SVGPathElement;
};

export type MainScanMotionState = {
    centerX: number | null;
    centerY: number | null;
    radiusX: number | null;
    radiusY: number | null;
};

type OrbitalRingField = {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
};

type ScanPoint = { x: number; y: number };

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const MAIN_SCAN_SAMPLE_COUNT = 42;
const MAIN_SCAN_RING_SAMPLE_COUNT = 96;
const MAIN_SCAN_LATITUDE_EXPONENT = 1 / GOLDEN_RATIO;
const MAIN_SCAN_SMOOTHING = 0.085;

export const MAIN_SCAN_LOOP_PERIOD = 2200 * GOLDEN_RATIO;

export function createMainScanMotionState(): MainScanMotionState {
    return {
        centerX: null,
        centerY: null,
        radiusX: null,
        radiusY: null,
    };
}

export function resetMainScanMotionState(state: MainScanMotionState): void {
    state.centerX = null;
    state.centerY = null;
    state.radiusX = null;
    state.radiusY = null;
}

function smoothToward(current: number | null, target: number, alpha = MAIN_SCAN_SMOOTHING): number {
    if (current == null || !Number.isFinite(current)) return target;
    return current + (target - current) * alpha;
}

function buildSmoothPath(points: ScanPoint[]): string {
    if (points.length === 0) return '';
    if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

    let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    const tension = 6.5;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        d +=
            ` C${(p1.x + (p2.x - p0.x) / tension).toFixed(1)},${(p1.y + (p2.y - p0.y) / tension).toFixed(1)}` +
            ` ${(p2.x - (p3.x - p1.x) / tension).toFixed(1)},${(p2.y - (p3.y - p1.y) / tension).toFixed(1)}` +
            ` ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
}

function measurePolylineLength(points: ScanPoint[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return total;
}

export function queryPrimaryOrbitalRings(root: ParentNode = document): SVGPathElement[] {
    const all = Array.from(root.querySelectorAll('path.orbital-ring')) as SVGPathElement[];
    return all.filter(ring => {
        const strokeWidth = parseFloat(ring.getAttribute('stroke-width') || '0');
        return strokeWidth > 0 && strokeWidth <= 3.5;
    });
}

function sampleOrbitalRingField(rings: SVGPathElement[]): OrbitalRingField | null {
    if (rings.length === 0) return null;

    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;

    for (const ring of rings) {
        const total = ring.getTotalLength?.();
        if (!total || !Number.isFinite(total) || total <= 0) continue;

        for (let i = 0; i <= MAIN_SCAN_RING_SAMPLE_COUNT; i++) {
            const point = ring.getPointAtLength((i / MAIN_SCAN_RING_SAMPLE_COUNT) * total);
            if (point.x < left) left = point.x;
            if (point.x > right) right = point.x;
            if (point.y < top) top = point.y;
            if (point.y > bottom) bottom = point.y;
        }
    }

    if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
        return null;
    }

    return {
        centerX: (left + right) * 0.5,
        centerY: (top + bottom) * 0.5,
        radiusX: Math.max(12, (right - left) * 0.5),
        radiusY: Math.max(12, (bottom - top) * 0.5),
    };
}

export function createMainScanLineElements(group: SVGGElement): MainScanLineElements {
    const parent = group.parentElement instanceof SVGElement ? group.parentElement : null;
    if (parent) parent.appendChild(group);
    group.innerHTML = '';

    const startX = PHASE_CHART.padL;
    const t = chartTheme();

    const glow = svgEl('rect', {
        id: 'scan-line-glow',
        x: String(startX - 4),
        y: String(PHASE_CHART.padT),
        width: '10',
        height: String(PHASE_CHART.plotH),
        fill: t.scanGlow,
        rx: '5',
    }) as SVGRectElement;
    group.appendChild(glow);

    const line = svgEl('rect', {
        id: 'scan-line-rect',
        x: String(startX),
        y: String(PHASE_CHART.padT),
        width: '2',
        height: String(PHASE_CHART.plotH),
        fill: 'url(#scan-line-grad)',
        opacity: '0.64',
    }) as SVGRectElement;
    group.appendChild(line);

    const geodesicGlow = svgEl('path', {
        id: 'scan-line-geodesic-glow',
        d: '',
        fill: 'none',
        stroke: t.scanGlow,
        'stroke-width': '12',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: '0',
    }) as SVGPathElement;
    group.appendChild(geodesicGlow);

    const geodesicWash = svgEl('path', {
        id: 'scan-line-geodesic-wash',
        d: '',
        fill: 'none',
        stroke: 'rgba(136, 196, 255, 0.20)',
        'stroke-width': '18',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: '0',
    }) as SVGPathElement;
    group.appendChild(geodesicWash);

    const geodesicSpecular = svgEl('path', {
        id: 'scan-line-geodesic-specular',
        d: '',
        fill: 'none',
        stroke: 'rgba(232, 244, 255, 0.88)',
        'stroke-width': '3.8',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: '0',
    }) as SVGPathElement;
    group.appendChild(geodesicSpecular);

    const geodesic = svgEl('path', {
        id: 'scan-line-geodesic',
        d: '',
        fill: 'none',
        stroke: 'url(#scan-line-grad)',
        'stroke-width': '2.1',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: '0',
    }) as SVGPathElement;
    group.appendChild(geodesic);

    return { glow, line, geodesicGlow, geodesicWash, geodesicSpecular, geodesic };
}

export function renderMainScanLineFrame(
    elapsedMs: number,
    elements: MainScanLineElements,
    motionState: MainScanMotionState,
    ringsRoot: ParentNode | null = document,
): void {
    const progress = 0.5 - 0.5 * Math.cos(((elapsedMs % MAIN_SCAN_LOOP_PERIOD) / MAIN_SCAN_LOOP_PERIOD) * 2 * Math.PI);
    const currentX = PHASE_CHART.padL + progress * PHASE_CHART.plotW;
    const rings = ringsRoot ? queryPrimaryOrbitalRings(ringsRoot) : [];
    const field = sampleOrbitalRingField(rings);

    if (!field) {
        resetMainScanMotionState(motionState);
        const breath = 0.56 + 0.08 * Math.sin(elapsedMs * 0.00072);
        elements.line.setAttribute('opacity', breath.toFixed(3));
        elements.glow.setAttribute('opacity', (breath + 0.16).toFixed(3));
        elements.line.setAttribute('x', currentX.toFixed(1));
        elements.glow.setAttribute('x', (currentX - 4).toFixed(1));
        elements.geodesicGlow.setAttribute('opacity', '0');
        elements.geodesicWash.setAttribute('opacity', '0');
        elements.geodesicSpecular.setAttribute('opacity', '0');
        elements.geodesic.setAttribute('opacity', '0');
        elements.geodesicSpecular.removeAttribute('stroke-dasharray');
        elements.geodesicSpecular.removeAttribute('stroke-dashoffset');
        return;
    }

    motionState.centerX = smoothToward(motionState.centerX, field.centerX);
    motionState.centerY = smoothToward(motionState.centerY, field.centerY);
    motionState.radiusX = smoothToward(motionState.radiusX, field.radiusX);
    motionState.radiusY = smoothToward(motionState.radiusY, field.radiusY);

    const centerX = motionState.centerX ?? field.centerX;
    const centerY = motionState.centerY ?? field.centerY;
    const radiusX = motionState.radiusX ?? field.radiusX;
    const radiusY = motionState.radiusY ?? field.radiusY;

    const longitude = Math.sin((progress - 0.5) * Math.PI * 0.96);
    const frontness = Math.sqrt(Math.max(0, 1 - longitude * longitude));
    const breath = 0.5 + 0.5 * Math.sin(elapsedMs * 0.00054 + progress * GOLDEN_RATIO);
    const curveBreath = 1 + 0.012 * Math.sin(elapsedMs * 0.00044 + longitude * GOLDEN_RATIO);
    const sheenLoop =
        0.5 -
        0.5 *
            Math.cos(
                ((elapsedMs % (MAIN_SCAN_LOOP_PERIOD * GOLDEN_RATIO)) / (MAIN_SCAN_LOOP_PERIOD * GOLDEN_RATIO)) *
                    2 *
                    Math.PI,
            );
    const equatorDrift = radiusX * 0.014 * Math.sin(elapsedMs * 0.00028 + progress * Math.PI);

    const points: ScanPoint[] = [];
    for (let i = 0; i <= MAIN_SCAN_SAMPLE_COUNT; i++) {
        const latT = i / MAIN_SCAN_SAMPLE_COUNT;
        const theta = Math.PI * latT;
        const latitudeProfile = Math.pow(Math.sin(theta), MAIN_SCAN_LATITUDE_EXPONENT);
        const equatorBlend = 1 - Math.min(1, Math.abs(latT - 0.5) * 2);
        const ribbon =
            radiusX *
            0.009 *
            Math.sin(theta * (GOLDEN_RATIO + 1) - elapsedMs * 0.00038) *
            latitudeProfile *
            equatorBlend *
            (0.35 + 0.65 * frontness);
        points.push({
            x: centerX + radiusX * longitude * latitudeProfile + equatorDrift * equatorBlend + ribbon,
            y: centerY - radiusY * curveBreath * Math.cos(theta),
        });
    }

    const d = buildSmoothPath(points);
    const pathLength = Math.max(1, measurePolylineLength(points));
    const highlightLength = Math.max(54, pathLength * (0.16 + 0.03 * frontness));
    const highlightGap = Math.max(90, pathLength * 1.35);
    const dashOffset = -pathLength * (0.18 + 0.62 * sheenLoop);

    elements.glow.setAttribute('opacity', '0');
    elements.line.setAttribute('opacity', '0');
    elements.geodesicGlow.setAttribute('d', d);
    elements.geodesicWash.setAttribute('d', d);
    elements.geodesicSpecular.setAttribute('d', d);
    elements.geodesic.setAttribute('d', d);

    elements.geodesic.setAttribute('opacity', (0.54 + 0.12 * frontness + 0.06 * breath).toFixed(3));
    elements.geodesicGlow.setAttribute('opacity', (0.08 + 0.06 * breath).toFixed(3));
    elements.geodesicWash.setAttribute('opacity', (0.04 + 0.06 * frontness * (0.45 + 0.55 * breath)).toFixed(3));
    elements.geodesicSpecular.setAttribute('opacity', (0.12 + 0.18 * frontness).toFixed(3));

    elements.geodesic.setAttribute('stroke-width', (1.95 + 0.35 * frontness + 0.08 * breath).toFixed(2));
    elements.geodesicGlow.setAttribute('stroke-width', (10.5 + 2.0 * breath).toFixed(2));
    elements.geodesicWash.setAttribute('stroke-width', (16 + 5.5 * frontness + 1.5 * breath).toFixed(2));
    elements.geodesicSpecular.setAttribute('stroke-width', (3.1 + 0.9 * frontness).toFixed(2));
    elements.geodesicSpecular.setAttribute(
        'stroke-dasharray',
        `${highlightLength.toFixed(1)} ${highlightGap.toFixed(1)}`,
    );
    elements.geodesicSpecular.setAttribute('stroke-dashoffset', dashOffset.toFixed(1));
}

// ============================================
// Phase Chart: Scanning Line
// ============================================

export function startScanLine(): void {
    const group = mustGetSvgEl<SVGGElement>('phase-scan-line');
    const elements = createMainScanLineElements(group);
    const motionState = createMainScanMotionState();
    const animStartTime = performance.now();
    const ringsRoot = document.getElementById('phase-word-cloud');

    function tick(now: number) {
        renderMainScanLineFrame(now - animStartTime, elements, motionState, ringsRoot);
        scanLineAnimId = requestAnimationFrame(tick);
    }
    scanLineAnimId = requestAnimationFrame(tick);
}

export function stopScanLine(): void {
    if (scanLineAnimId) {
        cancelAnimationFrame(scanLineAnimId);
        scanLineAnimId = null;
    }
    const line = getSvgEl('scan-line-rect');
    const glow = getSvgEl('scan-line-glow');
    const geodesic = getSvgEl('scan-line-geodesic');
    const geodesicGlow = getSvgEl('scan-line-geodesic-glow');
    const geodesicWash = getSvgEl('scan-line-geodesic-wash');
    const geodesicSpecular = getSvgEl('scan-line-geodesic-specular');
    if (isTurboActive()) {
        const group = document.getElementById('phase-scan-line');
        if (group) group.innerHTML = '';
        return;
    }
    if (line)
        line.animate([{ opacity: parseFloat(line.getAttribute('opacity') || '0.64') }, { opacity: 0 }], {
            duration: 400,
            fill: 'forwards',
        });
    if (glow)
        glow.animate([{ opacity: parseFloat(glow.getAttribute('opacity') || '1') }, { opacity: 0 }], {
            duration: 400,
            fill: 'forwards',
        });
    if (geodesic)
        geodesic.animate([{ opacity: parseFloat(geodesic.getAttribute('opacity') || '0.7') }, { opacity: 0 }], {
            duration: 400,
            fill: 'forwards',
        });
    if (geodesicGlow)
        geodesicGlow.animate(
            [{ opacity: parseFloat(geodesicGlow.getAttribute('opacity') || '0.14') }, { opacity: 0 }],
            { duration: 400, fill: 'forwards' },
        );
    if (geodesicWash)
        geodesicWash.animate([{ opacity: parseFloat(geodesicWash.getAttribute('opacity') || '0.1') }, { opacity: 0 }], {
            duration: 420,
            fill: 'forwards',
        });
    if (geodesicSpecular)
        geodesicSpecular.animate(
            [{ opacity: parseFloat(geodesicSpecular.getAttribute('opacity') || '0.2') }, { opacity: 0 }],
            { duration: 360, fill: 'forwards' },
        );
    setTimeout(() => {
        const group = document.getElementById('phase-scan-line');
        if (group) group.innerHTML = '';
    }, 450);
}

// ---- Timeline Scan Line ----

export function startTimelineScanLine(laneCount: number) {
    const group = document.getElementById('phase-substance-timeline');
    if (!group) return;

    const laneStep = TIMELINE_ZONE.laneH + TIMELINE_ZONE.laneGap;
    const zoneTop = TIMELINE_ZONE.separatorY;
    const zoneH = Math.max(30, laneCount * laneStep + TIMELINE_ZONE.bottomPad);

    const glow = svgEl('rect', {
        id: 'tl-scan-glow',
        x: String(PHASE_CHART.padL - 4),
        y: String(zoneTop),
        width: '10',
        height: String(zoneH),
        fill: 'rgba(245, 200, 80, 0.08)',
        rx: '5',
    });
    group.appendChild(glow);

    const line = svgEl('rect', {
        id: 'tl-scan-rect',
        x: String(PHASE_CHART.padL),
        y: String(zoneTop),
        width: '2',
        height: String(zoneH),
        fill: 'url(#tl-scan-line-grad)',
        opacity: '0.7',
    });
    group.appendChild(line);

    const range = PHASE_CHART.plotW;
    const tlStartTime = performance.now();
    const TL_PERIOD = 3800; // slightly slower than main scan for visual rhythm offset

    function tick(now: number) {
        const elapsed = now - tlStartTime;
        const loopT = (elapsed % TL_PERIOD) / TL_PERIOD;
        const progress = 0.5 - 0.5 * Math.cos(loopT * 2 * Math.PI);
        const currentX = PHASE_CHART.padL + progress * range;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        tlScanLineAnimId = requestAnimationFrame(tick);
    }
    tlScanLineAnimId = requestAnimationFrame(tick);
}

export function stopTimelineScanLine(): void {
    if (tlScanLineAnimId) {
        cancelAnimationFrame(tlScanLineAnimId);
        tlScanLineAnimId = null;
    }
    const line = document.getElementById('tl-scan-rect');
    const glow = document.getElementById('tl-scan-glow');
    if (isTurboActive()) {
        if (line) line.remove();
        if (glow) glow.remove();
        return;
    }
    if (line) line.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    setTimeout(() => {
        if (line) line.remove();
        if (glow) glow.remove();
    }, 350);
}

// ---- Biometric Scan Line ----

export function startBioScanLine() {
    const svg = document.querySelector<SVGSVGElement>('#phase-chart-svg');
    const group = document.getElementById('phase-biometric-strips');
    if (!svg || !group) return;

    group.innerHTML = '';

    const currentVB = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const currentH = currentVB[3];
    svg.setAttribute('data-pre-bio-scan-h', String(currentH));

    const estimatedChannels = (BiometricState.selectedDevices || []).reduce((sum: number, dKey: string) => {
        const dev = BIOMETRIC_DEVICES.devices?.find((d: BiometricDevice) => d.key === dKey) ?? null;
        return sum + (dev ? dev.displayChannels.length : 0);
    }, 0);
    const zoneH = Math.max(
        80,
        estimatedChannels * (BIOMETRIC_ZONE.laneH + BIOMETRIC_ZONE.laneGap) +
            BIOMETRIC_ZONE.separatorPad * 2 +
            BIOMETRIC_ZONE.bottomPad,
    );

    const newH = currentH + zoneH;
    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${newH}`);

    const zoneTop = currentH + BIOMETRIC_ZONE.separatorPad;
    const zoneBottom = newH - BIOMETRIC_ZONE.bottomPad;
    const zoneHeight = zoneBottom - zoneTop;

    const bg = svgEl('rect', {
        x: String(PHASE_CHART.padL),
        y: String(zoneTop),
        width: String(PHASE_CHART.plotW),
        height: String(zoneHeight),
        fill: 'rgba(255, 77, 77, 0.02)',
        rx: '2',
    });
    group.appendChild(bg);

    const glow = svgEl('rect', {
        id: 'bio-scan-glow',
        x: String(PHASE_CHART.padL - 4),
        y: String(zoneTop),
        width: '10',
        height: String(zoneHeight),
        fill: 'rgba(255, 77, 77, 0.12)',
        rx: '5',
    });
    group.appendChild(glow);

    const line = svgEl('rect', {
        id: 'bio-scan-rect',
        x: String(PHASE_CHART.padL),
        y: String(zoneTop),
        width: '2',
        height: String(zoneHeight),
        fill: 'url(#bio-scan-line-grad)',
        opacity: '0.8',
    });
    group.appendChild(line);

    const range = PHASE_CHART.plotW;
    const bioStartTime = performance.now();
    const BIO_PERIOD = 4200; // deliberate, unhurried rhythm

    function tick(now: number) {
        const elapsed = now - bioStartTime;
        const loopT = (elapsed % BIO_PERIOD) / BIO_PERIOD;
        const progress = 0.5 - 0.5 * Math.cos(loopT * 2 * Math.PI);
        const currentX = PHASE_CHART.padL + progress * range;
        line.setAttribute('x', currentX.toFixed(1));
        glow.setAttribute('x', (currentX - 4).toFixed(1));
        bioScanLineAnimId = requestAnimationFrame(tick);
    }
    bioScanLineAnimId = requestAnimationFrame(tick);
}

export function stopBioScanLine(): void {
    if (bioScanLineAnimId) {
        cancelAnimationFrame(bioScanLineAnimId);
        bioScanLineAnimId = null;
    }
    const line = document.getElementById('bio-scan-rect');
    const glow = document.getElementById('bio-scan-glow');

    if (isTurboActive()) {
        // Turbo: immediately clean scan elements and restore viewBox (no delay)
        if (line) line.remove();
        if (glow) glow.remove();
        // Remove the scan BG rect but DON'T clear the entire group (strips may already be rendered)
        const group = document.getElementById('phase-biometric-strips');
        if (group) {
            group.querySelectorAll('rect[fill="rgba(255, 77, 77, 0.02)"]').forEach(el => el.remove());
        }
        const svg = document.querySelector<SVGSVGElement>('#phase-chart-svg');
        if (svg) svg.removeAttribute('data-pre-bio-scan-h');
        return;
    }

    if (line) line.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });
    if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });
    setTimeout(() => {
        const group = document.getElementById('phase-biometric-strips');
        if (group) group.innerHTML = '';
        // Restore viewBox to pre-scan height so renderBiometricStrips starts clean
        const svg = document.querySelector<SVGSVGElement>('#phase-chart-svg');
        const preBioScanH = svg?.getAttribute('data-pre-bio-scan-h');
        if (svg && preBioScanH) {
            svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${preBioScanH}`);
            svg.removeAttribute('data-pre-bio-scan-h');
        }
    }, 400);
}
