import { describe, expect, it } from 'vitest';

import { socrxPicksToInterventions } from '../../src/socrx-mapper';
import { SUBSTANCE_DB } from '../../src/substances';
import type { CurveData, Intervention, SocrxPick } from '../../src/types';

function makeCurves(): CurveData[] {
    const baseline = (v: number) => Array.from({ length: 24 }, (_, h) => ({ hour: h, value: v }));
    return [
        { effect: 'Focus', color: '#60a5fa', baseline: baseline(40), desired: baseline(80), polarity: 'higher_is_better' },
        { effect: 'Sleep', color: '#a78bfa', baseline: baseline(30), desired: baseline(75), polarity: 'higher_is_better' },
    ];
}

function pick(overrides: Partial<SocrxPick>): SocrxPick {
    return {
        substanceKey: 'modafinil',
        dose: '100mg',
        timeMinutes: 8 * 60,
        targetCurveIdx: 0,
        targetEffect: 'Focus',
        rationale: '',
        ...overrides,
    };
}

describe('socrxPicksToInterventions', () => {
    it('returns null for empty input', () => {
        expect(socrxPicksToInterventions([], makeCurves(), [])).toBeNull();
        expect(socrxPicksToInterventions(null, makeCurves(), [])).toBeNull();
        expect(socrxPicksToInterventions(undefined, makeCurves(), [])).toBeNull();
    });

    it('resolves a valid pick into an Intervention with substance filled from the DB', () => {
        const out = socrxPicksToInterventions([pick({})], makeCurves(), []);
        expect(out).not.toBeNull();
        expect(out!.length).toBe(1);
        expect(out![0].key).toBe('modafinil');
        expect(out![0].substance).toBe(SUBSTANCE_DB.modafinil);
        expect(out![0].dose).toBe('100mg');
        expect(out![0].timeMinutes).toBe(8 * 60);
    });

    it('drops picks whose substanceKey is not in SUBSTANCE_DB', () => {
        const out = socrxPicksToInterventions(
            [pick({ substanceKey: 'notARealSubstance' })],
            makeCurves(),
            [],
        );
        expect(out).toBeNull();
    });

    it('drops picks with out-of-range targetCurveIdx', () => {
        const out = socrxPicksToInterventions(
            [pick({ targetCurveIdx: 99 }), pick({ targetCurveIdx: -1 })],
            makeCurves(),
            [],
        );
        expect(out).toBeNull();
    });

    it('clamps timeMinutes to [0, 1439]', () => {
        const out = socrxPicksToInterventions(
            [
                pick({ substanceKey: 'modafinil', timeMinutes: 9999 }),
                pick({ substanceKey: 'melatoninIR', targetCurveIdx: 1, timeMinutes: -50 }),
            ],
            makeCurves(),
            [],
        );
        expect(out).not.toBeNull();
        const byKey = new Map(out!.map(iv => [iv.key, iv.timeMinutes]));
        expect(byKey.get('modafinil')).toBe(1439);
        expect(byKey.get('melatoninIR')).toBe(0);
    });

    it('falls back to substance.standardDose when dose is missing', () => {
        const out = socrxPicksToInterventions([pick({ dose: '' })], makeCurves(), []);
        expect(out).not.toBeNull();
        expect(out![0].dose).toBe(SUBSTANCE_DB.modafinil.standardDose);
    });

    it('clones impact vectors from day-0 interventions when the key matches', () => {
        const day0: Intervention[] = [
            {
                key: 'modafinil',
                timeMinutes: 9 * 60,
                dose: '200mg',
                substance: SUBSTANCE_DB.modafinil,
                targetCurveIdx: 0,
                targetEffect: 'Focus',
                impacts: { Focus: 0.7, Sleep: -0.2 },
            },
        ];
        const out = socrxPicksToInterventions([pick({})], makeCurves(), day0);
        expect(out).not.toBeNull();
        expect(out![0].impacts).toEqual({ Focus: 0.7, Sleep: -0.2 });
        // Must be a clone, not a reference back to day-0.
        expect(out![0].impacts).not.toBe(day0[0].impacts);
    });

    it('leaves impacts undefined when no day-0 match exists', () => {
        const out = socrxPicksToInterventions([pick({})], makeCurves(), []);
        expect(out).not.toBeNull();
        expect(out![0].impacts).toBeUndefined();
    });

    it('caps output at 2 substances even if 3 valid picks are supplied', () => {
        const out = socrxPicksToInterventions(
            [
                pick({ substanceKey: 'modafinil' }),
                pick({ substanceKey: 'melatoninIR', targetCurveIdx: 1 }),
                pick({ substanceKey: 'caffeineIR' }),
            ],
            makeCurves(),
            [],
        );
        expect(out).not.toBeNull();
        expect(out!.length).toBeLessThanOrEqual(2);
    });

    it('de-duplicates picks with the same substanceKey', () => {
        const out = socrxPicksToInterventions(
            [pick({ substanceKey: 'modafinil' }), pick({ substanceKey: 'modafinil', timeMinutes: 10 * 60 })],
            makeCurves(),
            [],
        );
        expect(out).not.toBeNull();
        expect(out!.length).toBe(1);
    });
});
