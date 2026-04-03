import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LLMCache } from '../../src/llm-cache';
import {
    getRuntimeReplaySnapshot,
    recordDesignReplayState,
    recordWeekReplayState,
    resetRuntimeReplaySnapshotDraft,
} from '../../src/replay-snapshot';

describe('runtime replay snapshot', () => {
    beforeEach(() => {
        resetRuntimeReplaySnapshotDraft();
        LLMCache.clearAll();
        LLMCache.startLiveFlow();
    });

    afterEach(() => {
        resetRuntimeReplaySnapshotDraft();
        LLMCache.clearAll();
    });

    it('merges per-phase records into one saved snapshot bundle', () => {
        recordDesignReplayState({
            curvesData: [
                {
                    effect: 'Focus',
                    color: '#60a5fa',
                    baseline: [{ hour: 6, value: 42 }],
                    desired: [{ hour: 6, value: 68 }],
                },
            ],
            interventionResult: {
                interventions: [{ key: 'caffeine', timeMinutes: 480, dose: '100mg' } as any],
            },
            lxCurves: [
                {
                    baseline: [{ hour: 6, value: 42 }],
                    desired: [{ hour: 6, value: 68 }],
                    points: [{ hour: 6, value: 59 }],
                },
            ],
            incrementalSnapshots: [
                {
                    step: [{ key: 'caffeine', timeMinutes: 480, dose: '100mg' } as any],
                    lxCurves: [
                        {
                            baseline: [{ hour: 6, value: 42 }],
                            desired: [{ hour: 6, value: 68 }],
                            points: [{ hour: 6, value: 59 }],
                        },
                    ],
                },
            ],
        });

        recordWeekReplayState([
            {
                day: 0,
                bioCorrectedBaseline: [[{ hour: 6, value: 42 }]],
                desiredCurves: [[{ hour: 6, value: 68 }]],
                interventions: [{ key: 'caffeine', timeMinutes: 480, dose: '100mg' } as any],
                lxCurves: [
                    {
                        baseline: [{ hour: 6, value: 42 }],
                        desired: [{ hour: 6, value: 68 }],
                        points: [{ hour: 6, value: 59 }],
                    },
                ],
                biometricChannels: [],
                poiEvents: [],
                toleranceProfile: [],
                events: 'Day 0',
                narrativeBeat: 'Steady',
                dayNarrative: 'Steady',
            },
            {
                day: 1,
                bioCorrectedBaseline: [[{ hour: 6, value: 43 }]],
                desiredCurves: [[{ hour: 6, value: 69 }]],
                interventions: [{ key: 'caffeine', timeMinutes: 480, dose: '100mg' } as any],
                lxCurves: [
                    {
                        baseline: [{ hour: 6, value: 43 }],
                        desired: [{ hour: 6, value: 69 }],
                        points: [{ hour: 6, value: 60 }],
                    },
                ],
                biometricChannels: [],
                poiEvents: [],
                toleranceProfile: [],
                events: 'Day 1',
                narrativeBeat: 'Up',
                dayNarrative: 'Up',
            },
        ] as any);

        LLMCache.markFlowComplete();

        const snapshot = getRuntimeReplaySnapshot();
        expect(snapshot?.design?.curvesData?.[0]?.baseline?.[0]?.value).toBe(42);
        expect(snapshot?.week?.days?.[1]?.day).toBe(1);
    });
});
