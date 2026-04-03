import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/gamification-overlay', () => ({
    removeGamificationOverlay: vi.fn(),
    syncGamificationOverlayFrame: vi.fn(),
}));

vi.mock('../../src/sherlock', () => ({
    hideNarrationPanel: vi.fn(),
}));

vi.mock('../../src/divider', () => ({
    cleanupDivider: vi.fn(),
}));

vi.mock('../../src/phase-chart', () => ({
    placePeakDescriptors: vi.fn(),
}));

import { phasePointsToPath } from '../../src/curve-utils';
import { createBioCorrectionMorphSegment } from '../../src/timeline-segments/biometric-segments';
import { TimelineEngine, type AnimationSegment } from '../../src/timeline-engine';

class FakeClassList {
    private classes = new Set<string>();

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

    constructor(tagName: string) {
        this.tagName = tagName;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, String(value));
        if (name === 'class') {
            this.classList = new FakeClassList();
            for (const klass of String(value).split(/\s+/).filter(Boolean)) {
                this.classList.add(klass);
            }
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

    insertBefore<T extends FakeElement>(child: T, before: FakeElement | null): T {
        child.parentNode = this;
        if (!before) {
            this.children.push(child);
            return child;
        }
        const idx = this.children.indexOf(before);
        if (idx < 0) {
            this.children.push(child);
            return child;
        }
        this.children.splice(idx, 0, child);
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
        const selectors = selector
            .split(',')
            .map(part => part.trim())
            .filter(Boolean);
        const results: FakeElement[] = [];
        const walk = (node: FakeElement) => {
            for (const child of node.children) {
                if (selectors.some(sel => createMatcher(sel)(child))) {
                    results.push(child);
                }
                walk(child);
            }
        };
        walk(this);
        return results;
    }

    getElementById(id: string): FakeElement | null {
        if (this.getAttribute('id') === id) return this;
        return this.querySelector(`#${id}`);
    }

    get innerHTML(): string {
        return '';
    }

    set innerHTML(_value: string) {
        for (const child of this.children) {
            child.parentNode = null;
        }
        this.children = [];
    }
}

class FakeDocument {
    body = new FakeElement('body');

    createElementNS(_ns: string, tagName: string): FakeElement {
        return new FakeElement(tagName);
    }

    getElementById(id: string): FakeElement | null {
        if (this.body.getAttribute('id') === id) return this.body;
        return this.body.getElementById(id);
    }

    querySelectorAll(selector: string): FakeElement[] {
        return this.body.querySelectorAll(selector);
    }
}

function createMatcher(selector: string): (node: FakeElement) => boolean {
    if (selector === 'path:not(.phase-baseline-path):not(.peak-descriptor)') {
        return node =>
            node.tagName === 'path' &&
            !node.classList.contains('phase-baseline-path') &&
            !node.classList.contains('peak-descriptor');
    }
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

function createPhaseChartDom(doc: FakeDocument): FakeElement {
    const svg = doc.createElementNS('svg', 'svg');
    svg.setAttribute('id', 'phase-chart-svg');
    svg.setAttribute('viewBox', '0 0 960 500');

    const groupIds = [
        'phase-grid',
        'phase-x-axis',
        'phase-y-axis-left',
        'phase-y-axis-right',
        'phase-scan-line',
        'phase-word-cloud',
        'phase-baseline-curves',
        'phase-desired-curves',
        'phase-lx-bands',
        'phase-lx-curves',
        'phase-lx-markers',
        'phase-substance-timeline',
        'phase-mission-arrows',
        'phase-yaxis-indicators',
        'phase-legend',
        'phase-biometric-strips',
        'phase-tooltip-overlay',
    ];

    for (const id of groupIds) {
        const group = doc.createElementNS('svg', 'g');
        group.setAttribute('id', id);
        svg.appendChild(group);
    }

    doc.body.appendChild(svg);
    return svg;
}

function createSetupSegment(
    curvesData: any[],
    lxCurves: any[],
): AnimationSegment {
    return {
        id: 'setup-curves',
        label: 'Setup',
        category: 'curves',
        startTime: 0,
        duration: 1,
        phaseIdx: 2,

        enter(ctx) {
            const baseGroup = ctx.groups['phase-baseline-curves'];
            const lxGroup = ctx.groups['phase-lx-curves'];
            if (!baseGroup || !lxGroup) return;
            baseGroup.innerHTML = '';
            lxGroup.innerHTML = '';

            curvesData.forEach((curve: any, curveIdx: number) => {
                baseGroup.appendChild(
                    createPath('phase-baseline-path', phasePointsToPath(curve.baseline, true)),
                );
                lxGroup.appendChild(createPath('phase-lx-fill', phasePointsToPath(lxCurves[curveIdx].points, true)));
                lxGroup.appendChild(createPath('phase-lx-path', phasePointsToPath(lxCurves[curveIdx].points, true)));
            });
        },

        render(_progress, ctx) {
            const basePaths = ctx.groups['phase-baseline-curves']?.querySelectorAll('.phase-baseline-path') || [];
            const lxPaths = ctx.groups['phase-lx-curves']?.querySelectorAll('.phase-lx-path') || [];
            curvesData.forEach((curve: any, curveIdx: number) => {
                basePaths[curveIdx]?.setAttribute('d', phasePointsToPath(curve.baseline, true));
                lxPaths[curveIdx]?.setAttribute('d', phasePointsToPath(lxCurves[curveIdx].points, true));
            });
        },

        exit(ctx) {
            ctx.groups['phase-baseline-curves']!.innerHTML = '';
            ctx.groups['phase-lx-curves']!.innerHTML = '';
        },
    };
}

function createPath(className: string, d: string): FakeElement {
    const path = new FakeElement('path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    return path;
}

let originalDocument: any;

afterEach(() => {
    (globalThis as any).document = originalDocument;
    vi.restoreAllMocks();
});

describe('bio correction timeline replay', () => {
    it('reconstructs corrected curves after engine-driven transition and phase-3 seek', () => {
        const fakeDocument = new FakeDocument();
        const svg = createPhaseChartDom(fakeDocument);
        originalDocument = (globalThis as any).document;
        (globalThis as any).document = fakeDocument;

        const originalBaseline = [
            { hour: 6, value: 40 },
            { hour: 7, value: 48 },
        ];
        const correctedBaseline = [
            { hour: 6, value: 52 },
            { hour: 7, value: 60 },
        ];
        const originalCurves = [
            {
                effect: 'Focus',
                color: '#22c55e',
                baseline: originalBaseline,
                desired: [
                    { hour: 6, value: 72 },
                    { hour: 7, value: 78 },
                ],
                polarity: 'higher_is_better',
            },
        ];
        const correctedCurves = [
            {
                ...originalCurves[0],
                baseline: correctedBaseline,
            },
        ];
        const originalLxCurves = [
            {
                baseline: originalBaseline,
                desired: originalCurves[0].desired,
                points: [
                    { hour: 6, value: 62 },
                    { hour: 7, value: 70 },
                ],
            },
        ];
        const correctedLxCurves = [
            {
                baseline: correctedBaseline,
                desired: originalCurves[0].desired,
                points: [
                    { hour: 6, value: 74 },
                    { hour: 7, value: 82 },
                ],
            },
        ];

        const engine = new TimelineEngine(svg as unknown as SVGSVGElement);
        engine.getContext().curvesData = originalCurves;
        engine.getContext().lxCurves = originalLxCurves;
        engine.getContext().incrementalSnapshots = null;
        engine.getContext().bioCorrectedCurvesData = correctedCurves;
        engine.getContext().bioCorrectedLxCurves = correctedLxCurves;
        engine.getContext().bioCorrectedIncrementalSnapshots = null;

        const correctionStart = 100;
        const correctionEnd = correctionStart + 1500;

        engine.addSegment(createSetupSegment(originalCurves, originalLxCurves));
        engine.addSegment({
            id: 'bio-reveal-stub',
            label: 'Bio Reveal',
            category: 'biometric',
            startTime: 50,
            duration: 40,
            phaseIdx: 3,
            enter() {},
            render() {},
            exit() {},
        });
        engine.addSegment(createBioCorrectionMorphSegment(correctionStart));

        engine.advanceTimeTo(correctionEnd);
        engine.transitionToEngineDriven();

        const baselinePath = fakeDocument.getElementById('phase-baseline-curves')?.querySelector('.phase-baseline-path');
        expect(baselinePath?.getAttribute('d')).toBe(phasePointsToPath(correctedBaseline, true));

        engine.seek(correctionStart - 1);
        expect(baselinePath?.getAttribute('d')).toBe(phasePointsToPath(originalBaseline, true));

        engine.seek(correctionEnd - 1);
        expect(baselinePath?.getAttribute('d')).toBe(phasePointsToPath(correctedBaseline, true));
    });
});
