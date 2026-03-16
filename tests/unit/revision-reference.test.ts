import { describe, expect, it } from 'vitest';

import { buildRevisionSystemPrompt } from '../../src/llm-pipeline';
import {
    buildRevisionCurrentStateSummary,
    buildRevisionReferenceBundle,
} from '../../src/revision-reference';
import type { CurveData, LxCurve } from '../../src/types';

function buildPoints(hourToValue: (hour: number) => number) {
    return Array.from({ length: 25 }, (_, idx) => {
        const hour = 6 + idx;
        return { hour, value: hourToValue(hour) };
    });
}

function buildCurvesData(): CurveData[] {
    return [
        {
            effect: 'Focused Attention',
            color: '#60a5fa',
            polarity: 'higher_is_better',
            baseline: buildPoints(() => 32),
            desired: buildPoints((hour) => (hour >= 9 && hour <= 16 ? 76 : 32)),
        },
        {
            effect: 'Sleep Pressure',
            color: '#4ade80',
            polarity: 'higher_is_better',
            baseline: buildPoints((hour) => (hour >= 22 ? 50 : 24)),
            desired: buildPoints((hour) => (hour >= 22 ? 56 : 24)),
        },
    ];
}

function buildCurrentLxCurves(): LxCurve[] {
    return [
        {
            baseline: buildPoints(() => 32),
            desired: buildPoints((hour) => (hour >= 9 && hour <= 16 ? 76 : 32)),
            points: buildPoints((hour) => {
                if (hour >= 9 && hour <= 12) return 54;
                if (hour > 12 && hour <= 16) return 61;
                return 34;
            }),
        },
        {
            baseline: buildPoints((hour) => (hour >= 22 ? 50 : 24)),
            desired: buildPoints((hour) => (hour >= 22 ? 56 : 24)),
            points: buildPoints((hour) => (hour >= 22 ? 52 : 24)),
        },
    ];
}

describe('revision-reference', () => {
    it('builds a reference bundle even without bio correction or current Lx curves', () => {
        const bundle = buildRevisionReferenceBundle({
            curvesData: buildCurvesData(),
            currentLxCurves: null,
            currentInterventions: [],
            bioCorrectionApplied: false,
        });

        expect(bundle.bioCorrectionApplied).toBe(false);
        expect(bundle.baselineCurves).toHaveLength(2);
        expect(bundle.currentLxCurves[0].points).toHaveLength(97);
        expect(bundle.currentLxCurves[0].points[0].value).toBe(bundle.baselineCurves[0].points[0].value);
    });

    it('derives deterministic mission and under-target windows from corrected current Lx', () => {
        const bundle = buildRevisionReferenceBundle({
            curvesData: buildCurvesData(),
            currentLxCurves: buildCurrentLxCurves(),
            currentInterventions: [
                {
                    key: 'caffeineIR',
                    dose: '100mg',
                    doseMultiplier: 1,
                    timeMinutes: 480,
                    impacts: { 'Focused Attention': 1 },
                    rationale: 'Morning stimulant.',
                    substance: { class: 'Stimulant' },
                },
            ] as any,
            bioCorrectionApplied: true,
        });

        expect(bundle.gapSummary.effects).toHaveLength(2);
        expect(bundle.gapSummary.effects[0].missionWindows.length).toBeGreaterThan(0);
        expect(bundle.gapSummary.effects[0].topUnderTargetWindows.length).toBeGreaterThan(0);
        expect(bundle.gapSummary.effects[0].totalUnderArea).toBeGreaterThan(0);
        expect(bundle.gapSummary.effects[0].topOverTargetWindows).toHaveLength(0);
        expect(bundle.gapSummary.totalUnderArea).toBeGreaterThan(bundle.gapSummary.effects[1].totalUnderArea);
    });

    it('downsamples the current-state summary and uses corrected-state inputs in the revision prompt', () => {
        const bundle = buildRevisionReferenceBundle({
            curvesData: buildCurvesData(),
            currentLxCurves: buildCurrentLxCurves(),
            currentInterventions: [
                {
                    key: 'aniracetam',
                    dose: '750mg',
                    doseMultiplier: 1,
                    timeMinutes: 780,
                    impacts: { 'Focused Attention': 0.8 },
                    rationale: 'Late-morning nootropic.',
                    substance: { class: 'Nootropic' },
                },
            ] as any,
            bioCorrectionApplied: true,
        });

        const summary = buildRevisionCurrentStateSummary(bundle);
        const prompt = buildRevisionSystemPrompt('4 hours of deep focus, no sleep impact', bundle);

        expect(summary[0].baseline).toHaveLength(17);
        expect(summary[0].currentLx).toHaveLength(17);
        expect(prompt).toContain('CURRENT CORRECTED INTERVENTION PROTOCOL');
        expect(prompt).toContain('"currentLx"');
        expect(prompt).toContain('"topUnderTargetWindows"');
        expect(prompt).not.toContain('ORIGINAL INTERVENTION PROTOCOL');
    });
});
