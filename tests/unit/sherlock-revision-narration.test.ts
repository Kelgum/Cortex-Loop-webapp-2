import { describe, expect, it } from 'vitest';

import {
    normalizeSherlockRevisionNarration,
} from '../../src/sherlock-narration';
import { buildSherlockRevisionCards } from '../../src/timeline-segments/sherlock-segments';

function buildIntervention(overrides: Record<string, any>) {
    return {
        key: 'caffeineIR',
        timeMinutes: 540,
        dose: '150mg',
        doseMultiplier: 1,
        targetCurveIdx: 0,
        substance: {
            name: 'Caffeine',
            color: '#f97316',
        },
        ...overrides,
    };
}

function buildDiff() {
    return [
        {
            type: 'moved',
            oldIv: buildIntervention({
                key: 'caffeineIR',
                timeMinutes: 510,
            }),
            newIv: buildIntervention({
                key: 'caffeineIR',
                timeMinutes: 540,
            }),
        },
        {
            type: 'removed',
            oldIv: buildIntervention({
                key: 'glycine',
                timeMinutes: 1320,
                dose: '3g',
                targetCurveIdx: 1,
                substance: {
                    name: 'Glycine',
                    color: '#06d6a0',
                },
            }),
            newIv: null,
        },
    ];
}

describe('normalizeSherlockRevisionNarration', () => {
    it('falls back for every diff entry when the raw narration is missing', () => {
        const diff = buildDiff();
        const result = normalizeSherlockRevisionNarration(null, diff as any, true);

        expect(result.status).toBe('full-fallback');
        expect(result.modelBeatCount).toBe(0);
        expect(result.fallbackBeatCount).toBe(2);
        expect(result.narration?.beats).toHaveLength(2);
        expect(result.narration?.beats[0]).toMatchObject({
            action: 'moved',
            substanceKey: 'caffeineIR',
        });
        expect(result.narration?.beats[1]).toMatchObject({
            action: 'removed',
            substanceKey: 'glycine',
        });
        expect(result.narration?.outro).toBeTruthy();
    });

    it('backfills only the missing revision beats', () => {
        const diff = buildDiff();
        const result = normalizeSherlockRevisionNarration({
            beats: [
                {
                    substanceKey: 'caffeineIR',
                    text: 'The morning stimulant has been delayed to fit the signal.',
                },
                {
                    substanceKey: 'glycine',
                    message: '   ',
                },
            ],
            outro: '',
        }, diff as any, true);

        expect(result.status).toBe('partial-fallback');
        expect(result.modelBeatCount).toBe(1);
        expect(result.fallbackBeatCount).toBe(1);
        expect(result.narration?.beats[0]?.text).toBe('The morning stimulant has been delayed to fit the signal.');
        expect(result.narration?.beats[1]?.text).toContain('Glycine');
        expect(result.narration?.outro).toBeTruthy();
    });

    it('reorders raw beats by substance key to match the diff order', () => {
        const diff = buildDiff();
        const result = normalizeSherlockRevisionNarration({
            beats: [
                {
                    substanceKey: 'glycine',
                    text: 'The late sedative has been removed after the overnight readout.',
                },
                {
                    substanceKey: 'caffeineIR',
                    text: 'The stimulant now lands later to match the real pattern.',
                },
            ],
            outro: 'Locked in.',
        }, diff as any, true);

        expect(result.status).toBe('full-model');
        expect(result.narration?.beats.map((beat) => beat.text)).toEqual([
            'The stimulant now lands later to match the real pattern.',
            'The late sedative has been removed after the overnight readout.',
        ]);
        expect(result.narration?.beats.map((beat) => beat.substanceKey)).toEqual([
            'caffeineIR',
            'glycine',
        ]);
    });
});

describe('buildSherlockRevisionCards', () => {
    it('binds revision cards to real intervention metadata', () => {
        const diff = buildDiff();
        const narration = normalizeSherlockRevisionNarration({
            beats: [
                {
                    substanceKey: 'caffeineIR',
                    text: 'The stimulant now lands later to match the real pattern.',
                },
                {
                    substanceKey: 'glycine',
                    text: 'The late sedative has been removed after the overnight readout.',
                },
            ],
            outro: 'Locked in.',
        }, diff as any, true).narration;

        const cards = buildSherlockRevisionCards({
            sherlockRevisionNarration: narration,
            revisionDiff: diff,
            curvesData: [
                { effect: 'Focus' },
                { effect: 'Sleep' },
            ],
        } as any);

        expect(cards[0]).toMatchObject({
            substanceKey: 'caffeineIR',
            substanceName: 'Caffeine',
            substanceColor: '#f97316',
            dose: '150mg',
            curveIdx: 0,
            timeMinutes: 540,
            direction: 'neutral',
        });
        expect(cards[1]).toMatchObject({
            substanceKey: 'glycine',
            substanceName: 'Glycine',
            substanceColor: '#06d6a0',
            dose: '3g',
            curveIdx: 1,
            timeMinutes: 1320,
            direction: 'down',
        });
    });
});
