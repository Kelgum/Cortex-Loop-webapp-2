import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    __testing,
    computePeakFromData,
    removeGamificationOverlay,
    renderGamificationOverlay,
    setStackingBarSweepProgress,
    updateGamificationCurveData,
} from '../../src/gamification-overlay';
import { PHASE_CHART } from '../../src/constants';
import { __testing as multiDayTesting } from '../../src/multi-day-animation';
import { DividerState, PhaseState } from '../../src/state';

type Point = { hour: number; value: number };

class FakeClassList {
    private classes = new Set<string>();

    constructor(initial: string[] = []) {
        for (const name of initial) this.classes.add(name);
    }

    add(...names: string[]): void {
        for (const name of names) this.classes.add(name);
    }

    remove(...names: string[]): void {
        for (const name of names) this.classes.delete(name);
    }

    contains(name: string): boolean {
        return this.classes.has(name);
    }
}

class FakeElement {
    tagName: string;
    children: FakeElement[] = [];
    parentNode: FakeElement | null = null;
    attributes = new Map<string, string>();
    classList = new FakeClassList();
    textContent = '';

    constructor(tagName: string) {
        this.tagName = tagName;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, String(value));
        if (name === 'class') {
            this.classList = new FakeClassList(String(value).split(/\s+/).filter(Boolean));
        }
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    appendChild<T extends FakeElement>(child: T): T {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild<T extends FakeElement>(child: T): T {
        this.children = this.children.filter(node => node !== child);
        child.parentNode = null;
        return child;
    }

    remove(): void {
        if (!this.parentNode) return;
        this.parentNode.removeChild(this);
    }

    querySelector(selector: string): FakeElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        const results: FakeElement[] = [];
        const matcher = createMatcher(selector);
        const walk = (node: FakeElement) => {
            for (const child of node.children) {
                if (matcher(child)) results.push(child);
                walk(child);
            }
        };
        walk(this);
        return results;
    }

    get firstChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    get isConnected(): boolean {
        return this.parentNode != null;
    }
}

class FakeDocument {
    body = new FakeElement('body');

    createElementNS(_ns: string, tagName: string): FakeElement {
        return new FakeElement(tagName);
    }

    getElementById(id: string): FakeElement | null {
        if (this.body.getAttribute('id') === id) return this.body;
        return this.body.querySelector(`#${id}`);
    }

    querySelectorAll(selector: string): FakeElement[] {
        return this.body.querySelectorAll(selector);
    }
}

function createMatcher(selector: string): (node: FakeElement) => boolean {
    if (selector.startsWith('#')) {
        const id = selector.slice(1);
        return node => node.getAttribute('id') === id;
    }
    if (selector.startsWith('.')) {
        const klass = selector.slice(1);
        return node => node.classList.contains(klass);
    }
    return node => node.tagName === selector;
}

function makePoints(values: number[], startHour = 6): Point[] {
    return values.map((value, idx) => ({ hour: startHour + idx, value }));
}

function parseTranslate(value: string | null): { x: number; y: number } | null {
    if (!value) return null;
    const match = value.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    if (!match) return null;
    return { x: Number(match[1]), y: Number(match[2]) };
}

function boxesOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const { width, height } = __testing.boxSize;
    return !(
        a.x + width <= b.x ||
        b.x + width <= a.x ||
        a.y + height <= b.y ||
        b.y + height <= a.y
    );
}

function addDescriptorObstacle(doc: FakeDocument, x: number, y: number, width: number, height: number, effectIdx = 0): void {
    const chartSvg = doc.getElementById('phase-chart-svg') ?? doc.createElementNS('svg', 'svg');
    if (!chartSvg.parentNode) {
        chartSvg.setAttribute('id', 'phase-chart-svg');
        doc.body.appendChild(chartSvg);
    }

    const descriptor = doc.createElementNS('svg', 'g');
    descriptor.setAttribute('class', 'peak-descriptor');
    descriptor.setAttribute('data-effect-idx', String(effectIdx));
    const rect = doc.createElementNS('svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    descriptor.appendChild(rect);
    chartSvg.appendChild(descriptor);
}

function ensureChartSvg(doc: FakeDocument): FakeElement {
    const existing = doc.getElementById('phase-chart-svg');
    if (existing) return existing;
    const chartSvg = doc.createElementNS('svg', 'svg');
    chartSvg.setAttribute('id', 'phase-chart-svg');
    doc.body.appendChild(chartSvg);
    return chartSvg;
}

function addChartObstacle(doc: FakeDocument, klass: string, x: number, y: number, width: number, height: number): void {
    const chartSvg = ensureChartSvg(doc);
    const el = doc.createElementNS('svg', 'rect');
    el.setAttribute('class', klass);
    el.setAttribute('x', String(x));
    el.setAttribute('y', String(y));
    el.setAttribute('width', String(width));
    el.setAttribute('height', String(height));
    chartSvg.appendChild(el);
}

function addTimelineObstacle(doc: FakeDocument, x: number, y: number, width: number, height: number, effectIdx = 0): void {
    const timelineGroup = doc.getElementById('phase-substance-timeline') ?? doc.createElementNS('svg', 'g');
    if (!timelineGroup.parentNode) {
        timelineGroup.setAttribute('id', 'phase-substance-timeline');
        doc.body.appendChild(timelineGroup);
    }
    const pill = doc.createElementNS('svg', 'g');
    pill.setAttribute('class', 'timeline-pill-group');
    pill.setAttribute('data-curve-idx', String(effectIdx));
    const rect = doc.createElementNS('svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    pill.appendChild(rect);
    timelineGroup.appendChild(pill);
}

const dividerSnapshot = {
    active: DividerState.active,
    x: DividerState.x,
    fadeWidth: DividerState.fadeWidth,
    onUpdate: DividerState.onUpdate,
};

const phaseSnapshot = {
    interventionResult: PhaseState.interventionResult,
};

let originalDocument: any;
let originalRaf: any;
let originalCancelRaf: any;
let rafCallback: FrameRequestCallback | null = null;

afterEach(() => {
    removeGamificationOverlay();
    DividerState.active = dividerSnapshot.active;
    DividerState.x = dividerSnapshot.x;
    DividerState.fadeWidth = dividerSnapshot.fadeWidth;
    DividerState.onUpdate = dividerSnapshot.onUpdate;
    PhaseState.interventionResult = phaseSnapshot.interventionResult;

    (globalThis as any).document = originalDocument;
    (globalThis as any).requestAnimationFrame = originalRaf;
    (globalThis as any).cancelAnimationFrame = originalCancelRaf;
    rafCallback = null;
    vi.restoreAllMocks();
});

describe('gamification overlay', () => {
    it('finds the strongest positive gain for higher_is_better and higher_is_worse effects', () => {
        const baseline = makePoints([50, 50, 50, 50]);
        const focusGain = makePoints([50, 58, 64, 52]);
        const stressReduction = makePoints([50, 46, 39, 47]);

        const higherIsBetterPeak = computePeakFromData(focusGain, baseline, 'higher_is_better');
        const higherIsWorsePeak = computePeakFromData(stressReduction, baseline, 'higher_is_worse');

        expect(higherIsBetterPeak?.peakHour).toBe(8);
        expect(higherIsBetterPeak?.peakGain).toBe(14);
        expect(higherIsWorsePeak?.peakHour).toBe(8);
        expect(higherIsWorsePeak?.peakGain).toBe(11);
    });

    it('anchors to the true lx apex inside the improved region instead of the earliest strongest gain shoulder', () => {
        const baseline = makePoints([10, 30, 70, 70]);
        const lx = makePoints([10, 55, 76, 78]);

        const peak = computePeakFromData(lx, baseline, 'higher_is_better');

        expect(peak?.peakHour).toBe(9);
        expect(peak?.peakGain).toBe(25);
    });

    it('chooses a cleaner upper basin when the local peak area is crowded', () => {
        const fakeDocument = new FakeDocument();
        addDescriptorObstacle(fakeDocument, 350, 90, 300, 90, 0);
        originalDocument = (globalThis as any).document;
        (globalThis as any).document = fakeDocument;

        const result = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 24,
                peakHour: 8.3,
                anchorX: 430,
                anchorY: 192,
            },
            0,
            1,
            null,
            undefined,
            undefined,
            __testing.createEmptyPlacementMemory(),
            0,
        );

        expect(result.placement.upperBand).toBe(true);
        expect(
            result.placement.box.x + __testing.boxSize.width <= 350 ||
                650 <= result.placement.box.x ||
                result.placement.box.y + __testing.boxSize.height <= 90 ||
                180 <= result.placement.box.y,
        ).toBe(true);
    });

    it('keeps dual-effect boxes on their owned divider side and avoids overlap', () => {
        DividerState.active = true;
        DividerState.x = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        DividerState.fadeWidth = 50;

        const left = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 22,
                peakHour: 8,
                anchorX: 390,
                anchorY: 176,
            },
            0,
            2,
            null,
            undefined,
            undefined,
            __testing.createEmptyPlacementMemory(),
            0,
        ).placement;

        const right = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 18,
                peakHour: 20,
                anchorX: 720,
                anchorY: 172,
            },
            1,
            2,
            left,
            undefined,
            undefined,
            __testing.createEmptyPlacementMemory(),
            0,
        ).placement;

        const halfFade = DividerState.fadeWidth / 2;
        expect(left.box.x + __testing.boxSize.width).toBeLessThanOrEqual(DividerState.x - halfFade + 0.001);
        expect(right.box.x).toBeGreaterThanOrEqual(DividerState.x + halfFade - 0.001);
        expect(boxesOverlap(left.box, right.box)).toBe(false);
    });

    it('keeps the same basin and only nudges the centroid for small layout changes', () => {
        const first = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 18,
                peakHour: 8.1,
                anchorX: 410,
                anchorY: 188,
            },
            0,
            1,
            null,
            undefined,
            undefined,
            __testing.createEmptyPlacementMemory(),
            0,
        );

        const second = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 18,
                peakHour: 8.25,
                anchorX: 425,
                anchorY: 194,
            },
            0,
            1,
            null,
            undefined,
            undefined,
            first.memory,
            60,
        );

        expect(Math.hypot(second.placement.box.x - first.placement.box.x, second.placement.box.y - first.placement.box.y)).toBeLessThan(24);
        expect(second.memory.pendingBasinSince).toBeNull();
    });

    it('only switches to a better competing basin after the hold window', () => {
        const fakeDocument = new FakeDocument();
        addDescriptorObstacle(fakeDocument, 470, 62, 140, 180, 0);
        originalDocument = (globalThis as any).document;
        (globalThis as any).document = fakeDocument;

        const morning = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 24,
                peakHour: 7.5,
                anchorX: 250,
                anchorY: 196,
            },
            0,
            1,
            null,
            undefined,
            undefined,
            __testing.createEmptyPlacementMemory(),
            0,
        );

        const challengerEarly = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 24,
                peakHour: 20.5,
                anchorX: 830,
                anchorY: 196,
            },
            0,
            1,
            null,
            undefined,
            undefined,
            morning.memory,
            80,
        );

        const challengerLate = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 24,
                peakHour: 20.5,
                anchorX: 830,
                anchorY: 196,
            },
            0,
            1,
            null,
            undefined,
            undefined,
            challengerEarly.memory,
            300,
        );

        expect(challengerEarly.placement.box).toEqual(morning.placement.box);
        expect(challengerEarly.memory.pendingBasinSince).toBe(80);
        expect(challengerLate.placement.box).not.toEqual(morning.placement.box);
    });

    it('switches immediately when the current basin becomes invalid', () => {
        const first = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 18,
                peakHour: 8,
                anchorX: 320,
                anchorY: 190,
            },
            0,
            1,
            null,
            undefined,
            undefined,
            __testing.createEmptyPlacementMemory(),
            0,
        );

        const next = __testing.resolveBoxPlacement(
            {
                type: 'concentrated',
                peakGain: 18,
                peakHour: 8,
                anchorX: 320,
                anchorY: 190,
            },
            0,
            1,
            first.placement,
            undefined,
            undefined,
            first.memory,
            30,
        );

        expect(next.placement.box).not.toEqual(first.placement.box);
    });

    it('keeps a crowded right-side dual-effect placement available instead of dropping the box', () => {
        const fakeDocument = new FakeDocument();
        ensureChartSvg(fakeDocument);
        addDescriptorObstacle(fakeDocument, 760, 82, 210, 54, 1);
        addChartObstacle(fakeDocument, 'bullseye-emoji', 820, 138, 26, 26);
        addChartObstacle(fakeDocument, 'yaxis-change-indicator', 980, 126, 24, 136);
        addTimelineObstacle(fakeDocument, 748, 350, 250, 42, 1);

        originalDocument = (globalThis as any).document;
        (globalThis as any).document = fakeDocument;

        DividerState.active = true;
        DividerState.x = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        DividerState.fadeWidth = 50;

        const profile = {
            type: 'concentrated' as const,
            peakGain: 26,
            peakHour: 18.2,
            anchorX: 834,
            anchorY: 168,
        };

        const { field } = __testing.buildPlacementField(profile, 1, 2, null, undefined, undefined);
        const placement = __testing.resolveBoxPlacement(
            profile,
            1,
            2,
            null,
            undefined,
            undefined,
            __testing.createEmptyPlacementMemory(),
            0,
        ).placement;

        const halfFade = DividerState.fadeWidth / 2;
        expect(field?.cells.some(cell => cell.valid)).toBe(true);
        expect(placement.box.x).not.toBe(-9999);
        expect(placement.box.y).not.toBe(-9999);
        expect(placement.box.x).toBeGreaterThanOrEqual(DividerState.x + halfFade - 0.001);
    });

    it('keeps the live box stable while the connector follows a modest peak shift', () => {
        const fakeDocument = new FakeDocument();
        const tooltipOverlay = fakeDocument.createElementNS('svg', 'g');
        tooltipOverlay.setAttribute('id', 'phase-tooltip-overlay');
        fakeDocument.body.appendChild(tooltipOverlay);

        originalDocument = (globalThis as any).document;
        originalRaf = (globalThis as any).requestAnimationFrame;
        originalCancelRaf = (globalThis as any).cancelAnimationFrame;
        (globalThis as any).document = fakeDocument;
        (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
            rafCallback = cb;
            return 1;
        };
        (globalThis as any).cancelAnimationFrame = () => {
            rafCallback = null;
        };

        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        const baseline = [
            { hour: 6, value: 32 },
            { hour: 7, value: 38 },
            { hour: 8, value: 42 },
            { hour: 8.5, value: 42 },
            { hour: 9, value: 36 },
        ];
        const desired = [
            { hour: 6, value: 32 },
            { hour: 7, value: 56 },
            { hour: 8, value: 72 },
            { hour: 8.5, value: 72 },
            { hour: 9, value: 36 },
        ];
        const firstCurves = [
            {
                baseline,
                points: [
                    { hour: 6, value: 32 },
                    { hour: 7, value: 50 },
                    { hour: 8, value: 68 },
                    { hour: 8.5, value: 64 },
                    { hour: 9, value: 36 },
                ],
            },
        ];
        const shiftedCurves = [
            {
                baseline,
                points: [
                    { hour: 6, value: 32 },
                    { hour: 7, value: 50 },
                    { hour: 8, value: 66 },
                    { hour: 8.5, value: 69 },
                    { hour: 9, value: 36 },
                ],
            },
        ];
        const curvesData = [{ baseline, desired, polarity: 'higher_is_better', color: '#22c55e' }];

        renderGamificationOverlay(firstCurves, curvesData, 'phase2');

        const boxBefore = fakeDocument.body.querySelector('.gamification-box');
        const connectorBefore = fakeDocument.body.querySelector('.gamification-connector');
        const anchorBefore = fakeDocument.body.querySelector('.gamification-anchor-dot');
        const initialPct = boxBefore?.children[2]?.textContent;
        const initialSnapshot = __testing.getTrackedPlacementSnapshot()[0];
        const initialTransform = parseTranslate(boxBefore?.getAttribute('transform') ?? null);
        const initialConnectorPath = connectorBefore?.getAttribute('d');
        const initialAnchorX = anchorBefore?.getAttribute('cx');

        now = 90;
        updateGamificationCurveData(shiftedCurves);
        rafCallback?.(now);

        const boxAfter = fakeDocument.body.querySelector('.gamification-box');
        const connectorAfter = fakeDocument.body.querySelector('.gamification-connector');
        const anchorAfter = fakeDocument.body.querySelector('.gamification-anchor-dot');
        const updatedPct = boxAfter?.children[2]?.textContent;
        const updatedSnapshot = __testing.getTrackedPlacementSnapshot()[0];
        const updatedTransform = parseTranslate(boxAfter?.getAttribute('transform') ?? null);

        expect(initialPct).toBe('+62%');
        expect(updatedPct).toBe('+64%');
        expect(Math.hypot((updatedSnapshot?.target?.x ?? 0) - (initialSnapshot?.target?.x ?? 0), (updatedSnapshot?.target?.y ?? 0) - (initialSnapshot?.target?.y ?? 0))).toBeLessThan(24);
        expect(connectorAfter?.getAttribute('d')).not.toBe(initialConnectorPath);
        expect(anchorAfter?.getAttribute('cx')).not.toBe(initialAnchorX);
        expect(Math.hypot((updatedTransform?.x ?? 0) - (initialTransform?.x ?? 0), (updatedTransform?.y ?? 0) - (initialTransform?.y ?? 0))).toBeLessThan(18);
    });

    it('keeps both dual-effect boxes mounted during a weekly morph when baselines shift', () => {
        const fakeDocument = new FakeDocument();
        const tooltipOverlay = fakeDocument.createElementNS('svg', 'g');
        tooltipOverlay.setAttribute('id', 'phase-tooltip-overlay');
        fakeDocument.body.appendChild(tooltipOverlay);

        originalDocument = (globalThis as any).document;
        originalRaf = (globalThis as any).requestAnimationFrame;
        originalCancelRaf = (globalThis as any).cancelAnimationFrame;
        (globalThis as any).document = fakeDocument;
        (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
            rafCallback = cb;
            return 1;
        };
        (globalThis as any).cancelAnimationFrame = () => {
            rafCallback = null;
        };

        DividerState.active = true;
        DividerState.x = PHASE_CHART.padL + PHASE_CHART.plotW / 2;
        DividerState.fadeWidth = 50;

        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        const fromDay = {
            lxCurves: [
                {
                    baseline: makePoints([20, 25, 30, 35, 40]),
                    desired: makePoints([48, 54, 62, 58, 46]),
                    points: makePoints([38, 46, 55, 50, 42]),
                },
                {
                    baseline: makePoints([80, 78, 76, 74, 72]),
                    desired: makePoints([42, 40, 38, 36, 34]),
                    points: makePoints([60, 58, 56, 54, 52]),
                },
            ],
        } as any;
        const toDay = {
            lxCurves: [
                {
                    baseline: makePoints([28, 33, 38, 43, 48]),
                    desired: makePoints([56, 62, 70, 66, 54]),
                    points: makePoints([48, 56, 64, 60, 52]),
                },
                {
                    baseline: makePoints([30, 28, 26, 24, 22]),
                    desired: makePoints([18, 16, 14, 12, 10]),
                    points: makePoints([20, 18, 16, 14, 12]),
                },
            ],
        } as any;
        const morphedCurves = multiDayTesting.buildMorphedGamificationCurves(fromDay, toDay, 0.5, 2);
        const curvesData = [
            {
                baseline: fromDay.lxCurves[0].baseline,
                desired: fromDay.lxCurves[0].desired,
                polarity: 'higher_is_better',
                color: '#22c55e',
            },
            {
                baseline: fromDay.lxCurves[1].baseline,
                desired: fromDay.lxCurves[1].desired,
                polarity: 'higher_is_worse',
                color: '#fb7185',
            },
        ];

        renderGamificationOverlay(fromDay.lxCurves, curvesData, 'phase2');
        expect(fakeDocument.body.querySelectorAll('.gamification-box')).toHaveLength(2);

        now = 120;
        updateGamificationCurveData(morphedCurves);
        rafCallback?.(now);

        const boxes = fakeDocument.body.querySelectorAll('.gamification-box');
        const connectors = fakeDocument.body.querySelectorAll('.gamification-connector');
        const snapshots = __testing.getTrackedPlacementSnapshot();

        expect(boxes).toHaveLength(2);
        expect(connectors).toHaveLength(2);
        expect(snapshots).toHaveLength(2);
        expect(snapshots[0]?.box).not.toBeNull();
        expect(snapshots[1]?.box).not.toBeNull();
        expect(snapshots[0]?.peak).not.toBeNull();
        expect(snapshots[1]?.peak).not.toBeNull();
    });

    it('keeps future stacking-bar segments hidden between sequential sweeps', () => {
        const fakeDocument = new FakeDocument();
        const tooltipOverlay = fakeDocument.createElementNS('svg', 'g');
        tooltipOverlay.setAttribute('id', 'phase-tooltip-overlay');
        fakeDocument.body.appendChild(tooltipOverlay);

        originalDocument = (globalThis as any).document;
        originalRaf = (globalThis as any).requestAnimationFrame;
        originalCancelRaf = (globalThis as any).cancelAnimationFrame;
        (globalThis as any).document = fakeDocument;
        (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
            rafCallback = cb;
            return 1;
        };
        (globalThis as any).cancelAnimationFrame = () => {
            rafCallback = null;
        };

        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        PhaseState.interventionResult = {
            interventions: [
                {
                    key: 'caffeine',
                    timeMinutes: 7 * 60,
                    targetCurveIdx: 0,
                    substance: {
                        color: '#f97316',
                        pharma: {
                            onset: 0,
                            peak: 60,
                            duration: 240,
                            halfLife: 240,
                            strength: 80,
                            rebound: 0,
                        },
                    },
                },
                {
                    key: 'theanine',
                    timeMinutes: 8 * 60,
                    targetCurveIdx: 0,
                    substance: {
                        color: '#22c55e',
                        pharma: {
                            onset: 0,
                            peak: 60,
                            duration: 240,
                            halfLife: 240,
                            strength: 70,
                            rebound: 0,
                        },
                    },
                },
            ],
        } as any;

        const baseline = [
            { hour: 6, value: 32 },
            { hour: 7, value: 36 },
            { hour: 8, value: 40 },
            { hour: 9, value: 42 },
            { hour: 10, value: 40 },
            { hour: 11, value: 36 },
        ];
        const curvesData = [
            {
                effect: 'Focus',
                baseline,
                desired: [
                    { hour: 6, value: 40 },
                    { hour: 7, value: 48 },
                    { hour: 8, value: 56 },
                    { hour: 9, value: 60 },
                    { hour: 10, value: 54 },
                    { hour: 11, value: 44 },
                ],
                polarity: 'higher_is_better',
                color: '#38bdf8',
            },
        ];
        const lxCurves = [
            {
                baseline,
                desired: curvesData[0].desired,
                points: [
                    { hour: 6, value: 32 },
                    { hour: 7, value: 42 },
                    { hour: 8, value: 52 },
                    { hour: 9, value: 58 },
                    { hour: 10, value: 50 },
                    { hour: 11, value: 40 },
                ],
            },
        ];

        renderGamificationOverlay(lxCurves as any, curvesData as any, 'phase2');

        now = 16;
        setStackingBarSweepProgress(0.5, 8.5, 0);
        rafCallback?.(now);

        const stackingBar = fakeDocument.body.querySelector('.gamification-stacking-bar');
        expect(stackingBar?.children).toHaveLength(1);
        expect(Number(stackingBar?.children[0]?.getAttribute('height') || '0')).toBeGreaterThan(0);

        now = 32;
        setStackingBarSweepProgress(1);
        rafCallback?.(now);

        expect(stackingBar?.children).toHaveLength(1);

        now = 48;
        setStackingBarSweepProgress(0.25, 9.5, 1);
        rafCallback?.(now);

        expect(stackingBar?.children).toHaveLength(2);
        expect(Number(stackingBar?.children[1]?.getAttribute('height') || '0')).toBeGreaterThan(0);
    });
});
