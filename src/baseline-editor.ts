import { PHASE_CHART, PHASE_SMOOTH_PASSES, DESCRIPTOR_LEVELS } from './constants';
import { DividerState } from './state';
import { svgEl, chartTheme, phaseChartX, phaseChartY } from './utils';
import {
    smoothPhaseValues, phasePointsToPath, phasePointsToFillPath,
    findCurvePeak, nearestLevel, interpolatePointsAtTime,
} from './curve-utils';
import { getEffectSubGroup } from './divider';

// ---- Module State ----

interface OdometerLevel {
    step: number;
    intensity_percent: number;
    label: string;
    full_context: string;
}

const DRAG_FALLOFF_WEIGHTS = [1, 0.78, 0.48, 0.22, 0.05];

interface ScrubberDrag {

    curveIdx: number;
    dotIdx: number;
    startSvgY: number;
    originalValue: number;
    originalBaseline: number[];
}

interface BaselineEditorState {
    active: boolean;
    // Peak label drag
    dragCurveIdx: number | null;
    dragDotIdx: number | null;
    dragStartSvgY: number | null;
    dragOriginalValue: number | null;
    dragOriginalBaseline: number[] | null;

    // Interactive universal scrubber
    activeScrubberCurveIdx: number | null;
    activeScrubberDotIdx: number | null;
    scrubberDrag: ScrubberDrag | null;

    suppressHover: boolean;
    hoverDebounceTimer: ReturnType<typeof setTimeout> | null;
    cleanupFns: (() => void)[];
}

const state: BaselineEditorState = {
    active: false,
    dragCurveIdx: null,
    dragDotIdx: null,
    dragStartSvgY: null,
    dragOriginalValue: null,
    dragOriginalBaseline: null,
    activeScrubberCurveIdx: null,
    activeScrubberDotIdx: null,
    scrubberDrag: null,
    suppressHover: false,
    hoverDebounceTimer: null,
    cleanupFns: [],
};

// Peak dot index tracking — suppress scrubber at these positions
let peakDotIndices: Map<number, number> = new Map(); // curveIdx → dotIdx

function getPeakDotIndices(curvesData: any[]): Map<number, number> {
    const map = new Map<number, number>();
    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;
        // Always track the visual peak (highest point), matching placeInteractivePeakLabels
        const keyPoint = findCurvePeak(curve.baseline);
        let peakDotIdx = 0;
        for (let j = 0; j < curve.baseline.length; j++) {
            if (Math.abs(curve.baseline[j].hour - keyPoint.hour) < Math.abs(curve.baseline[peakDotIdx].hour - keyPoint.hour)) {
                peakDotIdx = j;
            }
        }
        map.set(i, peakDotIdx);
    }
    return map;
}

// Global DOM refs for scrubber
let scrubberGroup: SVGGElement | null = null;
let scrubberStem: SVGLineElement | null = null;
let scrubberKnobGlow: SVGCircleElement | null = null;
let scrubberKnob: SVGCircleElement | null = null;
let scrubberHourLabel: SVGTextElement | null = null;
let scrubberDescLabel: SVGTextElement | null = null;

// Body-appended explainer elements (Sherlock-style positioning outside SVG)
let _leftExplainer: HTMLElement | null = null;
let _rightExplainer: HTMLElement | null = null;
let _explainerRAF: number | null = null;

// ============================================
// Public API
// ============================================

export function activateBaselineEditor(curvesData: any[]): void {
    cleanupBaselineEditor();
    ensureExplainerElements();
    placeInteractivePeakLabels(curvesData);
    setupScrubberHover(curvesData);
    startExplainerRepositionLoop();
    state.active = true;
}

export function cleanupBaselineEditor(): void {
    if (state.hoverDebounceTimer) {
        clearTimeout(state.hoverDebounceTimer);
        state.hoverDebounceTimer = null;
    }
    state.cleanupFns.forEach(fn => fn());
    state.cleanupFns = [];
    state.active = false;
    state.dragCurveIdx = null;
    state.dragDotIdx = null;
    state.dragStartSvgY = null;
    state.dragOriginalValue = null;
    state.dragOriginalBaseline = null;
    state.activeScrubberCurveIdx = null;
    state.activeScrubberDotIdx = null;
    state.scrubberDrag = null;
    state.suppressHover = false;
    setBaselineDragLock(false);

    scrubberGroup = null;
    scrubberStem = null;
    scrubberKnobGlow = null;
    scrubberKnob = null;
    scrubberHourLabel = null;
    scrubberDescLabel = null;

    const editorGroup = document.getElementById('phase-baseline-editor');
    if (editorGroup) editorGroup.innerHTML = '';

    // Remove body-appended explainer panels
    stopExplainerRepositionLoop();
    if (_leftExplainer) { _leftExplainer.remove(); _leftExplainer = null; }
    if (_rightExplainer) { _rightExplainer.remove(); _rightExplainer = null; }
}

// ============================================
// Interactive Peak Labels (Modernized)
// ============================================


// ============================================
// Odometer Logic
// ============================================

export function getLevelData(curve: any, val: number): OdometerLevel {
    const levelVal = nearestLevel(val);
    if (Array.isArray(curve.levels) && curve.levels.length > 0 && typeof curve.levels[0] === 'object') {
        let best = curve.levels[0];
        for (const l of curve.levels) {
            if (Math.abs(l.intensity_percent - val) < Math.abs(best.intensity_percent - val)) best = l;
        }
        // Support both new `label` format and legacy `slot_1/slot_2/slot_3` format
        const obj = best as any;
        const label = obj.label || [obj.slot_1, obj.slot_2, obj.slot_3].filter(Boolean).join(' ') || 'Baseline';
        return {
            step: obj.step,
            intensity_percent: obj.intensity_percent,
            label,
            full_context: obj.full_context || label,
        };
    }

    // Fallback for plain-string levels object
    const rawString = curve.levels?.[String(levelVal)] || 'Baseline';
    return {
        step: DESCRIPTOR_LEVELS.indexOf(levelVal) + 1,
        intensity_percent: levelVal,
        label: rawString,
        full_context: rawString,
    };
}

function getLevelDataFromStep(curve: any, step: number): OdometerLevel | null {
    if (!Array.isArray(curve.levels)) return null;
    const raw = curve.levels.find((l: any) => l.step === step);
    if (!raw) return null;
    const label = raw.label || [raw.slot_1, raw.slot_2, raw.slot_3].filter(Boolean).join(' ') || 'Baseline';
    return { step: raw.step, intensity_percent: raw.intensity_percent, label, full_context: raw.full_context || label };
}

function placeInteractivePeakLabels(curvesData: any[]): void {
    const editorGroup = document.getElementById('phase-baseline-editor')!;
    editorGroup.querySelectorAll('.baseline-peak-label').forEach(el => el.remove());

    for (let i = 0; i < curvesData.length; i++) {
        const curve = curvesData[i];
        if (!curve.levels) continue;

        // Always place the label at the visual peak of the curve (highest point),
        // regardless of polarity. The descriptor will reflect the correct intensity.
        const keyPoint = findCurvePeak(curve.baseline);

        // Fallback or Array support check
        const level = nearestLevel(keyPoint.value);
        let descriptor = '';
        if (Array.isArray(curve.levels)) {
            descriptor = getLevelData(curve, keyPoint.value).full_context;
        } else {
            descriptor = curve.levels[String(level)];
            if (!descriptor) continue;
        }

        let peakDotIdx = 0;
        for (let j = 0; j < curve.baseline.length; j++) {
            if (Math.abs(curve.baseline[j].hour - keyPoint.hour) < Math.abs(curve.baseline[peakDotIdx].hour - keyPoint.hour)) {
                peakDotIdx = j;
            }
        }

        const px = phaseChartX(keyPoint.hour * 60);
        const py = phaseChartY(keyPoint.value);

        renderPeakLabel(editorGroup, curve, i, descriptor, px, py, peakDotIdx, curvesData);
    }
}

function renderPeakLabel(
    parent: Element, curve: any, curveIdx: number,
    descriptor: string, px: number, py: number, peakDotIdx: number, curvesData: any[],
): void {
    const sub = (DividerState.active && curvesData.length >= 2)
        ? getEffectSubGroup(parent, curveIdx) : parent;

    const labelGroup = svgEl('g', {
        class: 'baseline-peak-label',
        'data-curve-idx': String(curveIdx),
        cursor: 'grab'
    }) as SVGGElement;

    const cyOffset = 22;
    const pyLabel = py - cyOffset;

    // Chevrons
    const upChevron = svgEl('path', {
        d: `M${px - 4},${pyLabel - 10} L${px},${pyLabel - 15} L${px + 4},${pyLabel - 10}`,
        fill: 'none', stroke: curve.color, 'stroke-width': '2.5',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-opacity': '0.3', cursor: 'pointer', class: 'baseline-chevron-up'
    }) as SVGElement;
    labelGroup.appendChild(upChevron);

    // Label text — single SVG text element for the descriptor
    const labelText = svgEl('text', {
        x: px.toFixed(1),
        y: (pyLabel + 1).toFixed(1),
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: curve.color,
        'font-family': "'Space Grotesk', sans-serif",
        'font-size': '11',
        'font-weight': '500',
        'letter-spacing': '0.03em',
        'pointer-events': 'none',
        class: 'peak-label-text',
        opacity: '0.85',
    }) as SVGTextElement;
    labelGroup.appendChild(labelText);

    const downChevron = svgEl('path', {
        d: `M${px - 4},${pyLabel + 10} L${px},${pyLabel + 15} L${px + 4},${pyLabel + 10}`,
        fill: 'none', stroke: curve.color, 'stroke-width': '2.5',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-opacity': '0.3', cursor: 'pointer', class: 'baseline-chevron-down'
    }) as SVGElement;
    labelGroup.appendChild(downChevron);

    // Transparent drag backdrop — on TOP of everything in the group
    const backdrop = svgEl('rect', {
        x: (px - 60).toFixed(1), y: (pyLabel - 18).toFixed(1),
        width: '120', height: '36', fill: 'transparent',
        class: 'baseline-label-backdrop',
        cursor: 'grab',
    });
    labelGroup.appendChild(backdrop);

    sub.appendChild(labelGroup);

    setupChevronClick(upChevron, curveIdx, 1, curvesData);
    setupChevronClick(downChevron, curveIdx, -1, curvesData);
    setupLabelDrag(labelGroup, backdrop, curveIdx, peakDotIdx, curvesData);
    setupPeakHover(backdrop, curveIdx);

    labelGroup.style.transition = 'opacity 0.4s ease-out, transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
    labelGroup.setAttribute('opacity', '0');
    requestAnimationFrame(() => {
        labelGroup.setAttribute('opacity', '1');
        updateOdometerLogic(labelGroup, px, py, curve, curve.baseline[peakDotIdx].value);
    });
}

function setupChevronClick(chevron: SVGElement, curveIdx: number, direction: 1 | -1, curvesData: any[]): void {
    chevron.addEventListener('mouseenter', () => chevron.setAttribute('stroke-opacity', '1'));
    chevron.addEventListener('mouseleave', () => chevron.setAttribute('stroke-opacity', '0.3'));
    chevron.addEventListener('mousedown', (e) => e.stopPropagation());
    chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        shiftBaselineCurve(curveIdx, direction, curvesData);
    });
}

function shiftBaselineCurve(curveIdx: number, direction: 1 | -1, curvesData: any[]): void {
    const curve = curvesData[curveIdx];
    if (!curve) return;
    const step = DESCRIPTOR_LEVELS[1] - DESCRIPTOR_LEVELS[0];
    const shift = direction * step;
    curve.baseline = curve.baseline.map((pt: any) => ({
        ...pt,
        value: Math.max(0, Math.min(100, pt.value + shift)),
    }));
    rerenderBaselineCurve(curveIdx, curvesData);
    placeInteractivePeakLabels(curvesData);

    // Snaps actively grabbed scrubber to layout correctly
    if (state.activeScrubberCurveIdx === curveIdx && state.activeScrubberDotIdx !== null) {
        updateScrubberPosition(curveIdx, state.activeScrubberDotIdx, curvesData);
    }
}

function updateOdometerLogic(
    labelGroup: Element, px: number, pyTarget: number, curve: any, targetVal: number
): void {
    const labelText = labelGroup.querySelector('.peak-label-text') as SVGTextElement | null;
    if (!labelText) return;

    const pyLabel = pyTarget - 22;

    // Update label text position
    labelText.setAttribute('x', px.toFixed(1));
    labelText.setAttribute('y', (pyLabel + 1).toFixed(1));

    let odState = (labelGroup as any).__odometerState;
    if (!odState) {
        odState = { activeStep: null, lastVal: targetVal };
        (labelGroup as any).__odometerState = odState;
    }

    // --- Boundary Hysteresis (Anti-Jitter Lock) ---
    let stepObj = getLevelData(curve, targetVal);
    if (odState.activeStep !== null && odState.activeStep !== stepObj.step) {
        const prevObj = getLevelDataFromStep(curve, odState.activeStep);
        if (prevObj) {
            const diffFromPrevBoundary = Math.abs(targetVal - prevObj.intensity_percent);
            const boundaryEdge = Math.abs(prevObj.intensity_percent - stepObj.intensity_percent) / 2;
            if (diffFromPrevBoundary < boundaryEdge + 1.5) {
                stepObj = prevObj;
            }
        }
    }

    // Update label text when step changes
    if (stepObj.step !== odState.activeStep) {
        labelText.textContent = stepObj.label;
        odState.activeStep = stepObj.step;

        // Update the HTML explainer overlay outside the SVG
        const curveIdx = parseInt(labelGroup.getAttribute('data-curve-idx') || '0', 10);
        updateExplainerOverlay(curveIdx, stepObj.full_context, pyLabel, curve.color);
    }

    odState.lastVal = targetVal;

    // Reposition chevrons + backdrop
    const upChevron = labelGroup.querySelector('.baseline-chevron-up');
    if (upChevron) upChevron.setAttribute('d', `M${px - 4},${pyLabel - 10} L${px},${pyLabel - 15} L${px + 4},${pyLabel - 10}`);
    const backdrop = labelGroup.querySelector('.baseline-label-backdrop');
    if (backdrop) { backdrop.setAttribute('x', (px - 60).toFixed(1)); backdrop.setAttribute('y', (pyLabel - 18).toFixed(1)); }
    const downChevron = labelGroup.querySelector('.baseline-chevron-down');
    if (downChevron) downChevron.setAttribute('d', `M${px - 4},${pyLabel + 10} L${px},${pyLabel + 15} L${px + 4},${pyLabel + 10}`);
}

// ============================================
// Body-Appended Explainer Panels (Sherlock-style)
// ============================================

/** Create explainer elements on <body>, positioned by JS like Sherlock panels */
function ensureExplainerElements(): void {
    if (!_leftExplainer) {
        _leftExplainer = document.createElement('div');
        _leftExplainer.id = 'level-explainer-left';
        _leftExplainer.className = 'level-explainer level-explainer-left';
        document.body.appendChild(_leftExplainer);
    }
    if (!_rightExplainer) {
        _rightExplainer = document.createElement('div');
        _rightExplainer.id = 'level-explainer-right';
        _rightExplainer.className = 'level-explainer level-explainer-right';
        document.body.appendChild(_rightExplainer);
    }
}

/** Reposition explainers relative to SVG bounding rect (like Sherlock repositionPanel) */
function repositionExplainers(): void {
    const svg = document.getElementById('phase-chart-svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    const explainerWidth = 180;
    const gap = 14;
    const centerY = rect.top + window.scrollY + rect.height / 2;

    if (_leftExplainer) {
        const leftEdge = rect.left - explainerWidth - gap;
        _leftExplainer.style.left = `${Math.max(4, leftEdge)}px`;
        _leftExplainer.style.top = `${centerY}px`;
        _leftExplainer.style.width = `${explainerWidth}px`;
    }

    if (_rightExplainer) {
        const rightEdge = rect.right + gap;
        _rightExplainer.style.left = `${rightEdge}px`;
        _rightExplainer.style.top = `${centerY}px`;
        _rightExplainer.style.width = `${explainerWidth}px`;
    }
}

function startExplainerRepositionLoop(): void {
    if (_explainerRAF !== null) return;
    const tick = () => {
        repositionExplainers();
        _explainerRAF = requestAnimationFrame(tick);
    };
    _explainerRAF = requestAnimationFrame(tick);
}

function stopExplainerRepositionLoop(): void {
    if (_explainerRAF !== null) {
        cancelAnimationFrame(_explainerRAF);
        _explainerRAF = null;
    }
}

/** Update the explainer text and color */
function updateExplainerOverlay(curveIdx: number, text: string, _svgY: number, color: string): void {
    const el = curveIdx === 0 ? _leftExplainer : _rightExplainer;
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color;
}

/** Show the overlay (on hover over peak label) */
function showExplainerOverlay(curveIdx: number): void {
    const el = curveIdx === 0 ? _leftExplainer : _rightExplainer;
    if (el) el.classList.add('visible');
}

/** Hide the overlay (on hover leave) */
function hideExplainerOverlay(curveIdx: number): void {
    const el = curveIdx === 0 ? _leftExplainer : _rightExplainer;
    if (el) el.classList.remove('visible');
}

/** Show explainer on hover over peak label backdrop, hide on leave */
function setupPeakHover(backdrop: Element, curveIdx: number): void {
    backdrop.addEventListener('mouseenter', () => {
        showExplainerOverlay(curveIdx);
    });
    backdrop.addEventListener('mouseleave', () => {
        // Only hide if not actively dragging
        if (state.dragCurveIdx === null) {
            hideExplainerOverlay(curveIdx);
        }
    });
}

function repositionLabelGroup(labelGroup: Element, px: number, py: number, curve: any, descriptorValue?: number): void {
    // Forward to new logic
    let targetVal = descriptorValue;
    if (typeof targetVal !== 'number') {
        const smoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const isHigherBetter = curve.polarity !== 'higher_is_worse';
        let peakVal = smoothed[0].value;
        for (const p of smoothed) {
            if (isHigherBetter ? p.value > peakVal : p.value < peakVal) peakVal = p.value;
        }
        targetVal = peakVal;
    }
    updateOdometerLogic(labelGroup, px, py, curve, targetVal);
}

function setupLabelDrag(labelGroup: Element, hitNode: Element, curveIdx: number, peakDotIdx: number, curvesData: any[]): void {
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement;

    // Pointer Events + setPointerCapture ensures drag tracks even when cursor leaves SVG/window
    function onDown(e: PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        state.suppressHover = true;
        hideScrubber();
        setBaselineDragLock(true);
        state.dragCurveIdx = curveIdx;
        state.dragDotIdx = peakDotIdx;
        state.dragOriginalValue = curvesData[curveIdx].baseline[peakDotIdx].value;
        state.dragOriginalBaseline = curvesData[curveIdx].baseline.map((pt: any) => Number(pt.value));

        const m = svg.getScreenCTM();
        if (!m) return;
        state.dragStartSvgY = (e.clientY - m.f) / m.d;
        hitNode.setAttribute('cursor', 'grabbing');
        showExplainerOverlay(curveIdx);
    }

    function onMove(e: PointerEvent) {
        if (state.dragCurveIdx !== curveIdx || state.dragDotIdx !== peakDotIdx) return;
        e.preventDefault();

        const m = svg.getScreenCTM();
        if (!m) return;

        const currentSvgY = (e.clientY - m.f) / m.d;
        const newValue = valueFromSvgY(currentSvgY);
        const originalBaseline = state.dragOriginalBaseline;
        if (!originalBaseline) return;
        applyLocalDragSmoothing(curvesData[curveIdx].baseline, originalBaseline, peakDotIdx, newValue);

        rerenderBaselineCurve(curveIdx, curvesData);

        const rendered = smoothPhaseValues(curvesData[curveIdx].baseline, PHASE_SMOOTH_PASSES);
        const renderedValue = rendered[peakDotIdx]?.value ?? curvesData[curveIdx].baseline[peakDotIdx].value;
        const newPy = phaseChartY(renderedValue);
        const px = phaseChartX(curvesData[curveIdx].baseline[peakDotIdx].hour * 60);
        repositionLabelGroup(labelGroup, px, newPy, curvesData[curveIdx], renderedValue);
    }

    function onUp(e: PointerEvent) {
        if (state.dragCurveIdx !== curveIdx || state.dragDotIdx !== peakDotIdx) return;
        try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
        state.dragCurveIdx = null;
        state.dragDotIdx = null;
        state.dragOriginalValue = null;
        state.dragOriginalBaseline = null;
        state.dragStartSvgY = null;
        state.suppressHover = false;
        setBaselineDragLock(false);
        hitNode.setAttribute('cursor', 'grab');
        hideExplainerOverlay(curveIdx);
    }

    hitNode.addEventListener('pointerdown', onDown as EventListener);
    hitNode.addEventListener('pointermove', onMove as EventListener);
    hitNode.addEventListener('pointerup', onUp as EventListener);
    hitNode.addEventListener('pointercancel', onUp as EventListener);

    state.cleanupFns.push(() => {
        hitNode.removeEventListener('pointerdown', onDown as EventListener);
        hitNode.removeEventListener('pointermove', onMove as EventListener);
        hitNode.removeEventListener('pointerup', onUp as EventListener);
        hitNode.removeEventListener('pointercancel', onUp as EventListener);
    });
}

// ============================================
// Global Universal Scrubber (Clean UX)
// ============================================

function initScrubberElements(editorGroup: Element) {
    if (scrubberGroup) return;

    scrubberGroup = svgEl('g', { id: 'baseline-universal-scrubber', class: 'universal-scrubber' }) as SVGGElement;
    scrubberGroup.style.transition = 'opacity 0.15s ease-out';
    scrubberGroup.setAttribute('opacity', '0');

    scrubberStem = svgEl('line', {
        y2: String(PHASE_CHART.padT + PHASE_CHART.plotH),
        stroke: '#fff', 'stroke-width': '1.5', 'stroke-opacity': '0.3',
        'stroke-dasharray': '3 4', 'pointer-events': 'none'
    }) as SVGLineElement;

    scrubberKnobGlow = svgEl('circle', {
        r: '18', fill: '#fff', 'fill-opacity': '0.12',
        cursor: 'ns-resize', 'pointer-events': 'all'
    }) as SVGCircleElement;

    scrubberKnob = svgEl('circle', {
        r: '5', fill: '#000', stroke: '#fff', 'stroke-width': '2.5',
        'pointer-events': 'none'
    }) as SVGCircleElement;

    scrubberHourLabel = svgEl('text', {
        'font-family': "'IBM Plex Mono', monospace", 'font-size': '10',
        'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'pointer-events': 'none',
        'font-weight': '600', 'letter-spacing': '0.5'
    }) as SVGTextElement;

    scrubberDescLabel = svgEl('text', {
        'font-family': "'Space Grotesk', sans-serif", 'font-size': '12',
        'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'fill-opacity': '0.9',
        'pointer-events': 'none', 'font-weight': '600'
    }) as SVGTextElement;

    // Apply strict non-interactability to group, enable interactability only on glow knob
    scrubberGroup.style.pointerEvents = 'none';
    scrubberKnobGlow.style.pointerEvents = 'auto';

    scrubberGroup.appendChild(scrubberStem);
    scrubberGroup.appendChild(scrubberKnobGlow);
    scrubberGroup.appendChild(scrubberKnob);
    scrubberGroup.appendChild(scrubberHourLabel);
    scrubberGroup.appendChild(scrubberDescLabel);

    editorGroup.appendChild(scrubberGroup);
}

function setupScrubberHover(curvesData: any[]): void {
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement;
    const editorGroup = document.getElementById('phase-baseline-editor')!;

    initScrubberElements(editorGroup);
    peakDotIndices = getPeakDotIndices(curvesData);

    const hitRect = svgEl('rect', {
        x: String(PHASE_CHART.padL),
        y: String(PHASE_CHART.padT),
        width: String(PHASE_CHART.plotW),
        height: String(PHASE_CHART.plotH),
        fill: 'transparent',
        'pointer-events': 'all',
        class: 'baseline-hover-hit',
        cursor: 'crosshair',
    });
    editorGroup.insertBefore(hitRect, editorGroup.firstChild);

    const onMove = (e: MouseEvent | TouchEvent) => {
        if (state.suppressHover || state.dragCurveIdx !== null || state.scrubberDrag) return;
        const m = svg.getScreenCTM();
        if (!m) return;
        const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
        const svgX = (clientX - m.e) / m.a;
        const svgY = (clientY - m.f) / m.d;

        if (isNearPeakLabel(editorGroup, svgX, svgY)) {
            hideScrubber();
            return;
        }

        const timeMin = ((svgX - PHASE_CHART.padL) / PHASE_CHART.plotW) * PHASE_CHART.totalMin + PHASE_CHART.startMin;
        const timeH = timeMin / 60;

        // Find closest hour dot (index) by comparing svgX to phaseChartX(hour*60)
        let activeHourIdx = 0;
        let closestXDist = Infinity;
        const curveForX = curvesData[0]; // Assuming all curves have the same hour layout
        for (let j = 0; j < curveForX.baseline.length; j++) {
            const pt = curveForX.baseline[j];
            const cx = phaseChartX(pt.hour * 60);
            const xDist = Math.abs(cx - svgX);
            if (xDist < closestXDist) {
                closestXDist = xDist;
                activeHourIdx = j;
            }
        }

        let closestCurve = 0;
        let closestDist = Infinity;
        for (let i = 0; i < curvesData.length; i++) {
            const smoothed = smoothPhaseValues(curvesData[i].baseline, PHASE_SMOOTH_PASSES);
            const curveValAtX = interpolatePointsAtTime(smoothed, timeH);
            const curveY = phaseChartY(curveValAtX);
            const dist = Math.abs(svgY - curveY);
            if (dist < closestDist) {
                closestDist = dist;
                closestCurve = i;
            }
        }

        // Suppress scrubber at peak dot indices — the peak label is already there
        const peakIdx = peakDotIndices.get(closestCurve);
        if (peakIdx !== undefined && activeHourIdx === peakIdx) {
            hideScrubber();
            return;
        }

        state.activeScrubberCurveIdx = closestCurve;
        state.activeScrubberDotIdx = activeHourIdx;
        updateScrubberPosition(closestCurve, activeHourIdx, curvesData);
    };

    const onEnter = () => {
        if (state.hoverDebounceTimer) {
            clearTimeout(state.hoverDebounceTimer);
            state.hoverDebounceTimer = null;
        }
    };

    const onLeave = (e: MouseEvent) => {
        // Suppress hide if we entered the knob
        if (e.relatedTarget === scrubberKnobGlow) {
            return;
        }

        if (state.hoverDebounceTimer) clearTimeout(state.hoverDebounceTimer);
        state.hoverDebounceTimer = setTimeout(() => {
            state.hoverDebounceTimer = null;
            if (!state.scrubberDrag && state.dragCurveIdx === null) {
                hideScrubber();
            }
        }, 150);
    };

    hitRect.addEventListener('mousemove', onMove);
    hitRect.addEventListener('touchmove', onMove, { passive: true });
    hitRect.addEventListener('mouseenter', onEnter);
    hitRect.addEventListener('mouseleave', onLeave);

    // Pointer Events + setPointerCapture for scrubber drag (tracks beyond SVG/window)
    const onScrubberDown = (e: PointerEvent) => {
        if (state.activeScrubberCurveIdx === null || state.activeScrubberDotIdx === null) return;
        e.preventDefault();
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        state.suppressHover = true;
        setBaselineDragLock(true);

        const m = svg.getScreenCTM();
        if (!m) return;
        const startSvgY = (e.clientY - m.f) / m.d;

        const curveIdx = state.activeScrubberCurveIdx;
        const dotIdx = state.activeScrubberDotIdx;

        state.scrubberDrag = {
            curveIdx,
            dotIdx,
            startSvgY,
            originalValue: curvesData[curveIdx].baseline[dotIdx].value,
            originalBaseline: curvesData[curveIdx].baseline.map((pt: any) => Number(pt.value)),
        };

        if (scrubberKnobGlow) {
            scrubberKnobGlow.setAttribute('fill-opacity', '0.28');
            scrubberKnobGlow.setAttribute('r', '24');
        }
    };

    const onScrubberMove = (e: PointerEvent) => {
        if (!state.scrubberDrag) return;
        e.preventDefault();

        const m = svg.getScreenCTM();
        if (!m) return;
        const currentSvgY = (e.clientY - m.f) / m.d;

        const newValue = valueFromSvgY(currentSvgY);
        const { curveIdx, dotIdx, originalBaseline } = state.scrubberDrag;
        if (!originalBaseline) return;

        applyLocalDragSmoothing(curvesData[curveIdx].baseline, originalBaseline, dotIdx, newValue);

        rerenderBaselineCurve(curveIdx, curvesData);
        updateScrubberPosition(curveIdx, dotIdx, curvesData);

        // --- Peak label follows the curve in real-time ---
        const edGroup = document.getElementById('phase-baseline-editor');
        if (edGroup) {
            const labelGroups = edGroup.querySelectorAll('.baseline-peak-label');
            for (const lg of Array.from(labelGroups)) {
                const ci = parseInt(lg.getAttribute('data-curve-idx') || '0', 10);
                const c = curvesData[ci];
                if (!c) continue;
                const smoothed = smoothPhaseValues(c.baseline, PHASE_SMOOTH_PASSES);
                const kp = findCurvePeak(smoothed);
                const npx = phaseChartX(kp.hour * 60);
                const npy = phaseChartY(kp.value);
                repositionLabelGroup(lg, npx, npy, c, kp.value);
            }
        }

        // Clamp scrubber knob to cursor Y for 1:1 feel
        const clampedSvgY = Math.max(PHASE_CHART.padT, Math.min(PHASE_CHART.padT + PHASE_CHART.plotH, currentSvgY));
        if (scrubberKnobGlow) scrubberKnobGlow.setAttribute('cy', clampedSvgY.toFixed(1));
        if (scrubberKnob) scrubberKnob.setAttribute('cy', clampedSvgY.toFixed(1));
        if (scrubberStem) scrubberStem.setAttribute('y1', clampedSvgY.toFixed(1));
    };

    const onScrubberUp = (e: PointerEvent) => {
        if (!state.scrubberDrag) return;
        try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
        state.scrubberDrag = null;
        state.suppressHover = false;
        setBaselineDragLock(false);

        if (scrubberKnobGlow) {
            scrubberKnobGlow.setAttribute('fill-opacity', '0.12');
            scrubberKnobGlow.setAttribute('r', '18');
        }

        placeInteractivePeakLabels(curvesData);
        peakDotIndices = getPeakDotIndices(curvesData);
    };

    if (scrubberKnobGlow) {
        // Drag events use pointer capture for cross-boundary tracking
        scrubberKnobGlow.addEventListener('pointerdown', onScrubberDown as EventListener);
        scrubberKnobGlow.addEventListener('pointermove', onScrubberMove as EventListener);
        scrubberKnobGlow.addEventListener('pointerup', onScrubberUp as EventListener);
        scrubberKnobGlow.addEventListener('pointercancel', onScrubberUp as EventListener);

        // Hover events stay as mouse events for debounce timer
        scrubberKnobGlow.addEventListener('mouseenter', (e: MouseEvent) => {
            if (state.hoverDebounceTimer) {
                clearTimeout(state.hoverDebounceTimer);
                state.hoverDebounceTimer = null;
            }
            e.stopPropagation();
        });

        scrubberKnobGlow.addEventListener('mouseleave', (e: MouseEvent) => {
            // Only start the fade if they've fully left into non-hitRect territory
            if (e.relatedTarget !== hitRect) {
                onLeave(e);
            }
        });
    }

    state.cleanupFns.push(() => {
        hitRect.removeEventListener('mousemove', onMove);
        hitRect.removeEventListener('touchmove', onMove);
        hitRect.removeEventListener('mouseenter', onEnter);
        hitRect.removeEventListener('mouseleave', onLeave);
        hitRect.remove();

        if (scrubberKnobGlow) {
            scrubberKnobGlow.removeEventListener('pointerdown', onScrubberDown as EventListener);
            scrubberKnobGlow.removeEventListener('pointermove', onScrubberMove as EventListener);
            scrubberKnobGlow.removeEventListener('pointerup', onScrubberUp as EventListener);
            scrubberKnobGlow.removeEventListener('pointercancel', onScrubberUp as EventListener);
        }
    });
}

function updateScrubberPosition(curveIdx: number, dotIdx: number, curvesData: any[]): void {
    if (!scrubberGroup || !scrubberStem || !scrubberKnob || !scrubberKnobGlow || !scrubberHourLabel || !scrubberDescLabel) return;

    const curve = curvesData[curveIdx];
    const pt = curve.baseline[dotIdx];
    const smoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
    const displayValue = smoothed[dotIdx]?.value ?? pt.value;

    const cx = phaseChartX(pt.hour * 60);
    const cy = phaseChartY(displayValue);

    if (scrubberGroup.getAttribute('opacity') === '0') {
        scrubberGroup.setAttribute('opacity', '1');
    }

    const dt = chartTheme();
    scrubberStem.setAttribute('stroke', curve.color);
    scrubberKnobGlow.setAttribute('fill', curve.color);
    scrubberKnob.setAttribute('stroke', curve.color);
    scrubberKnob.setAttribute('fill', dt.tooltipBg);

    scrubberStem.setAttribute('x1', cx.toFixed(1));
    scrubberStem.setAttribute('x2', cx.toFixed(1));
    scrubberStem.setAttribute('y1', cy.toFixed(1));

    scrubberKnobGlow.setAttribute('cx', cx.toFixed(1));
    scrubberKnobGlow.setAttribute('cy', cy.toFixed(1));

    scrubberKnob.setAttribute('cx', cx.toFixed(1));
    scrubberKnob.setAttribute('cy', cy.toFixed(1));

    const isTop = cy < PHASE_CHART.padT + 60;
    const labelY = cy + (isTop ? +32 : -32);

    scrubberHourLabel.setAttribute('x', cx.toFixed(1));
    scrubberHourLabel.setAttribute('y', (labelY).toFixed(1));
    scrubberHourLabel.textContent = `${String(pt.hour % 24).padStart(2, '0')}:00`;
    scrubberHourLabel.setAttribute('fill', curve.color);

    const levelData = getLevelData(curve, displayValue);
    const shortDesc = levelData.label;

    scrubberDescLabel.setAttribute('x', cx.toFixed(1));
    scrubberDescLabel.setAttribute('y', (labelY + 14).toFixed(1));
    scrubberDescLabel.textContent = shortDesc;
    scrubberDescLabel.setAttribute('fill', curve.color);
}

function hideScrubber(): void {
    if (scrubberGroup) {
        scrubberGroup.setAttribute('opacity', '0');
    }
    state.activeScrubberCurveIdx = null;
    state.activeScrubberDotIdx = null;
}

function isNearPeakLabel(editorGroup: Element, svgX: number, svgY: number): boolean {
    const pad = 25;
    const labels = editorGroup.querySelectorAll('.baseline-peak-label');
    for (const node of Array.from(labels)) {
        const labelGroup = node as SVGGElement;
        let box: DOMRect | SVGRect;
        try {
            box = labelGroup.getBBox();
        } catch {
            continue;
        }
        if (
            svgX >= box.x - pad &&
            svgX <= box.x + box.width + pad &&
            svgY >= box.y - pad &&
            svgY <= box.y + box.height + pad
        ) {
            return true;
        }
    }
    return false;
}

function valueFromSvgY(svgY: number): number {
    const top = PHASE_CHART.padT;
    const bottom = PHASE_CHART.padT + PHASE_CHART.plotH;
    const clampedY = Math.max(top, Math.min(bottom, svgY));
    const ratio = (bottom - clampedY) / PHASE_CHART.plotH;
    return Math.max(0, Math.min(100, ratio * 100));
}

function applyLocalDragSmoothing(
    baseline: any[],
    originalValues: number[],
    centerIdx: number,
    centerTarget: number,
): void {
    const centerOriginal = originalValues[centerIdx];
    const delta = centerTarget - centerOriginal;
    const radius = DRAG_FALLOFF_WEIGHTS.length - 1;
    for (let i = 0; i < baseline.length; i++) {
        const dist = Math.abs(i - centerIdx);
        const weight = dist <= radius ? DRAG_FALLOFF_WEIGHTS[dist] : 0;
        const next = originalValues[i] + delta * weight;
        baseline[i].value = Math.max(0, Math.min(100, next));
    }
}

function setBaselineDragLock(active: boolean): void {
    document.body.classList.toggle('baseline-drag-lock', active);
    if (active) {
        try {
            window.getSelection?.()?.removeAllRanges();
        } catch { }
    }
}

// ============================================
// Shared: Re-render Baseline Curve Path
// ============================================

function rerenderBaselineCurve(curveIdx: number, curvesData: any[]): void {
    const curve = curvesData[curveIdx];
    const baseGroup = document.getElementById('phase-baseline-curves')!;
    const sub = baseGroup.querySelector(`#phase-baseline-curves-e${curveIdx}`) || baseGroup;

    const strokePath = sub.querySelector('.phase-baseline-path') as SVGPathElement | null;
    if (strokePath) {
        const newD = phasePointsToPath(curve.baseline);
        strokePath.setAttribute('d', newD);
    }

    const paths = sub.querySelectorAll('path');
    for (const p of Array.from(paths)) {
        if (!p.classList.contains('phase-baseline-path') && !p.classList.contains('baseline-hover-hit')) {
            p.setAttribute('d', phasePointsToFillPath(curve.baseline));
            break;
        }
    }
}
