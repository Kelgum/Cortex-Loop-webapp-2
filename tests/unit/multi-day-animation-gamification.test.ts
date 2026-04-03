import { describe, expect, it } from 'vitest';

import { computePeakFromData } from '../../src/gamification-overlay';
import { __testing as multiDayTesting } from '../../src/multi-day-animation';

function makePoints(values: number[], startHour = 6) {
    return values.map((value, idx) => ({ hour: startHour + idx, value }));
}

describe('multi-day gamification morph', () => {
    it('interpolates points, baseline, and desired together per effect', () => {
        const fromDay = {
            lxCurves: [
                {
                    baseline: makePoints([20, 25, 30]),
                    desired: makePoints([50, 56, 62]),
                    points: makePoints([36, 44, 52]),
                },
                {
                    baseline: makePoints([80, 78, 76]),
                    desired: makePoints([40, 38, 36]),
                    points: makePoints([60, 58, 56]),
                },
            ],
        } as any;
        const toDay = {
            lxCurves: [
                {
                    baseline: makePoints([28, 33, 38]),
                    desired: makePoints([58, 64, 70]),
                    points: makePoints([48, 56, 64]),
                },
                {
                    baseline: makePoints([30, 28, 26]),
                    desired: makePoints([18, 16, 14]),
                    points: makePoints([20, 18, 16]),
                },
            ],
        } as any;

        const morphed = multiDayTesting.buildMorphedGamificationCurves(fromDay, toDay, 0.5, 2);

        expect(morphed).toHaveLength(2);
        expect(morphed[0].points.map((point: any) => point.value)).toEqual([42, 50, 58]);
        expect(morphed[0].baseline.map((point: any) => point.value)).toEqual([24, 29, 34]);
        expect(morphed[0].desired.map((point: any) => point.value)).toEqual([54, 60, 66]);
        expect(morphed[1].points.map((point: any) => point.value)).toEqual([40, 38, 36]);
        expect(morphed[1].baseline.map((point: any) => point.value)).toEqual([55, 53, 51]);
        expect(morphed[1].desired.map((point: any) => point.value)).toEqual([29, 27, 25]);
    });

    it('preserves both effects through a dual-effect weekly morph when baselines shift', () => {
        const fromDay = {
            lxCurves: [
                {
                    baseline: makePoints([20, 25, 30, 35]),
                    desired: makePoints([48, 54, 62, 58]),
                    points: makePoints([38, 46, 55, 50]),
                },
                {
                    baseline: makePoints([80, 78, 76, 74]),
                    desired: makePoints([42, 40, 38, 36]),
                    points: makePoints([60, 58, 56, 54]),
                },
            ],
        } as any;
        const toDay = {
            lxCurves: [
                {
                    baseline: makePoints([28, 33, 38, 43]),
                    desired: makePoints([56, 62, 70, 66]),
                    points: makePoints([48, 56, 64, 60]),
                },
                {
                    baseline: makePoints([30, 28, 26, 24]),
                    desired: makePoints([18, 16, 14, 12]),
                    points: makePoints([20, 18, 16, 14]),
                },
            ],
        } as any;

        const morphed = multiDayTesting.buildMorphedGamificationCurves(fromDay, toDay, 0.5, 2);
        const mismatched = [
            {
                points: morphed[0].points,
                baseline: toDay.lxCurves[0].baseline,
            },
            {
                points: morphed[1].points,
                baseline: toDay.lxCurves[1].baseline,
            },
        ];

        expect(computePeakFromData(morphed[0].points, morphed[0].baseline, 'higher_is_better')).not.toBeNull();
        expect(computePeakFromData(morphed[1].points, morphed[1].baseline, 'higher_is_worse')).not.toBeNull();
        expect(computePeakFromData(mismatched[1].points, mismatched[1].baseline, 'higher_is_worse')).toBeNull();
    });
});
