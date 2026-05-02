import { describe, expect, it } from 'vitest';

import { phasePointsToFillPath } from '../../src/curve-utils';
import { phaseChartX } from '../../src/utils';
import { sanitizeWeekDaySnapshots } from '../../src/week-snapshot-utils';
import type { CurveData, DaySnapshot } from '../../src/types';

function makePoints(startHour: number, values: number[]) {
    return values.map((value, idx) => ({ hour: startHour + idx, value }));
}

describe('week snapshot sanitization', () => {
    it('falls back to the canonical chart grid when a saved day drifts left', () => {
        const curvesData: CurveData[] = [
            {
                effect: 'Vasomotor Stability',
                color: '#fb7185',
                baseline: makePoints(6, [20, 22, 24, 26]),
                desired: makePoints(6, [30, 32, 34, 36]),
                polarity: 'higher_is_better',
            },
        ];

        const driftingDay: DaySnapshot = {
            day: 3,
            bioCorrectedBaseline: [makePoints(6, [20, 22, 24, 26])],
            desiredCurves: [makePoints(6, [30, 32, 34, 36])],
            postInterventionBaseline: [makePoints(5, [18, 20, 22, 24])],
            interventions: [],
            lxCurves: [
                {
                    baseline: makePoints(5, [18, 20, 22, 24]),
                    desired: makePoints(6, [30, 32, 34, 36]),
                    points: makePoints(5, [18, 20, 22, 24]),
                },
            ],
            biometricChannels: [],
            poiEvents: [],
            toleranceProfile: [],
            events: '',
            narrativeBeat: '',
            dayNarrative: '',
        };

        const [sanitized] = sanitizeWeekDaySnapshots([driftingDay], curvesData);

        expect(sanitized.postInterventionBaseline[0].map(point => point.hour)).toEqual([6, 7, 8, 9]);
        expect(sanitized.postInterventionBaseline[0].map(point => point.value)).toEqual([20, 22, 24, 26]);
        expect(sanitized.lxCurves[0].points.map(point => point.hour)).toEqual([6, 7, 8, 9]);
    });
});

describe('phasePointsToFillPath', () => {
    it('anchors fills to the in-range points instead of off-chart samples', () => {
        const drifting = makePoints(5, [10, 20, 30, 40]);
        const fillPath = phasePointsToFillPath(drifting, true);
        const offscreenX = phaseChartX(5 * 60).toFixed(1);

        expect(fillPath).not.toContain(` ${offscreenX} `);
    });
});
