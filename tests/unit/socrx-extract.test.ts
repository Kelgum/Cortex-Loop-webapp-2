import { describe, expect, it } from 'vitest';

import { extractSocrxData } from '../../src/llm-response-shape';

describe('extractSocrxData', () => {
    it('returns null for non-object input', () => {
        expect(extractSocrxData(null)).toBeNull();
        expect(extractSocrxData(undefined)).toBeNull();
        expect(extractSocrxData('not an object')).toBeNull();
        expect(extractSocrxData(42)).toBeNull();
    });

    it('returns null when picks is missing or not an array', () => {
        expect(extractSocrxData({})).toBeNull();
        expect(extractSocrxData({ picks: 'nope' })).toBeNull();
        expect(extractSocrxData({ picks: null })).toBeNull();
    });

    it('parses a well-formed payload', () => {
        const raw = {
            conditionLabel: '  ADHD, adult  ',
            narrative: '  Vyvanse first-line.  ',
            picks: [
                {
                    substanceKey: 'vyvanse',
                    dose: '30mg',
                    timeMinutes: 480,
                    targetCurveIdx: 0,
                    targetEffect: 'Focus',
                    rationale: 'First-line adult ADHD.',
                },
            ],
        };
        const out = extractSocrxData(raw);
        expect(out).not.toBeNull();
        expect(out!.conditionLabel).toBe('ADHD, adult');
        expect(out!.narrative).toBe('Vyvanse first-line.');
        expect(out!.picks.length).toBe(1);
        expect(out!.picks[0].substanceKey).toBe('vyvanse');
    });

    it('clamps out-of-range timeMinutes into [0, 1439]', () => {
        const out = extractSocrxData({
            picks: [
                { substanceKey: 'a', timeMinutes: 99999, targetCurveIdx: 0 },
                { substanceKey: 'b', timeMinutes: -100, targetCurveIdx: 0 },
            ],
        });
        expect(out).not.toBeNull();
        expect(out!.picks[0].timeMinutes).toBe(1439);
        expect(out!.picks[1].timeMinutes).toBe(0);
    });

    it('drops pick entries without a substanceKey', () => {
        const out = extractSocrxData({
            picks: [
                { substanceKey: '', timeMinutes: 480, targetCurveIdx: 0 },
                { substanceKey: 'modafinil', timeMinutes: 480, targetCurveIdx: 0 },
                {},
                { substanceKey: '   ', timeMinutes: 480, targetCurveIdx: 0 },
            ],
        });
        expect(out).not.toBeNull();
        expect(out!.picks.length).toBe(1);
        expect(out!.picks[0].substanceKey).toBe('modafinil');
    });

    it('defaults missing optional fields to empty strings / sane defaults', () => {
        const out = extractSocrxData({
            picks: [{ substanceKey: 'modafinil' }],
        });
        expect(out).not.toBeNull();
        expect(out!.conditionLabel).toBe('');
        expect(out!.narrative).toBe('');
        expect(out!.picks[0].dose).toBe('');
        expect(out!.picks[0].targetEffect).toBe('');
        expect(out!.picks[0].rationale).toBe('');
        // Defaults per extractor: timeMinutes→480 (08:00), targetCurveIdx→0.
        expect(out!.picks[0].timeMinutes).toBe(480);
        expect(out!.picks[0].targetCurveIdx).toBe(0);
    });
});
