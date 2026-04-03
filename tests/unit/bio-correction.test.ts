import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncGamificationOverlayFrame } = vi.hoisted(() => ({
    syncGamificationOverlayFrame: vi.fn(),
}));

vi.mock('../../src/gamification-overlay', () => ({
    syncGamificationOverlayFrame,
}));

import { computeBioCorrectionFrameData, renderBioCorrectionFrame } from '../../src/bio-correction';

describe('bio correction', () => {
    beforeEach(() => {
        syncGamificationOverlayFrame.mockReset();
    });

    it('interpolates corrected baselines and forwards rebased lx curves into overlay sync', () => {
        const oldBaseline = [
            { hour: 6, value: 40 },
            { hour: 7, value: 50 },
        ];
        const newBaseline = [
            { hour: 6, value: 50 },
            { hour: 7, value: 60 },
        ];
        const oldLxCurves = [
            {
                baseline: oldBaseline,
                desired: [
                    { hour: 6, value: 72 },
                    { hour: 7, value: 78 },
                ],
                points: [
                    { hour: 6, value: 60 },
                    { hour: 7, value: 70 },
                ],
            },
        ];
        const newLxCurves = [
            {
                baseline: newBaseline,
                desired: [
                    { hour: 6, value: 72 },
                    { hour: 7, value: 78 },
                ],
                points: [
                    { hour: 6, value: 70 },
                    { hour: 7, value: 80 },
                ],
            },
        ];
        const frameInput = {
            oldBaselines: [oldBaseline],
            newBaselines: [newBaseline],
            oldLxCurves,
            newLxCurves,
            oldIncrementalSnapshots: null,
            newIncrementalSnapshots: null,
        };
        const curvesData = [
            {
                effect: 'Focus',
                color: '#22c55e',
                baseline: oldBaseline,
                desired: [
                    { hour: 6, value: 72 },
                    { hour: 7, value: 78 },
                ],
                polarity: 'higher_is_better',
            },
        ];

        const frame = computeBioCorrectionFrameData(frameInput, 0.5);

        expect(frame.baselines[0].map(point => point.value)).toEqual([45, 55]);
        expect(frame.lxCurves[0].points.map(point => point.value)).toEqual([65, 75]);
        expect(frame.lxCurves[0].baseline).toEqual(frame.baselines[0]);

        renderBioCorrectionFrame(frameInput, curvesData as any, 0.5);

        expect(syncGamificationOverlayFrame).toHaveBeenCalledTimes(1);
        const [overlayCurves, overlaySourceCurves, overlaySource, overlayOptions] =
            syncGamificationOverlayFrame.mock.calls[0];
        expect(overlaySourceCurves).toBe(curvesData);
        expect(overlaySource).toBe('phase2');
        expect(overlayOptions).toEqual({ immediate: true, entranceProgress: 1 });
        expect(overlayCurves[0].baseline.map((point: any) => point.value)).toEqual([45, 55]);
        expect(overlayCurves[0].points.map((point: any) => point.value)).toEqual([65, 75]);
    });
});
