import { describe, expect, it } from 'vitest';

import {
    extractCurvesData,
    extractInterventionsData,
    parseInterventionTime,
    validateStageResponseShape,
} from '../../src/llm-response-shape';

const HOURS = Array.from({ length: 25 }, (_, idx) => 6 + idx);

function buildCurve(effect: string, color: string) {
    return {
        effect,
        color,
        baseline: HOURS.map((hour, idx) => ({ hour, value: 30 + idx })),
        desired: HOURS.map((hour, idx) => ({ hour, value: 45 + idx })),
    };
}

describe('llm-response-shape', () => {
    it('extracts strategist curves from wrapped payloads', () => {
        const curves = extractCurvesData({
            curves: [buildCurve('Focus', '#60a5fa'), buildCurve('Calm', '#34d399')],
        });

        expect(curves).toHaveLength(2);
        expect(curves[0]?.effect).toBe('Focus');
    });

    it('parses intervention times from numeric and clock formats', () => {
        expect(parseInterventionTime(510)).toBe(510);
        expect(parseInterventionTime('08:30')).toBe(510);
        expect(parseInterventionTime('8:30pm')).toBe(20 * 60 + 30);
        expect(parseInterventionTime('')).toBeNull();
    });

    it('normalizes nested intervention payloads', () => {
        const interventions = extractInterventionsData({
            plan: {
                interventions: [
                    {
                        substanceKey: 'lTheanine',
                        time: '08:15',
                        amount: '200mg',
                        reason: 'Smooth the stimulant edge',
                    },
                ],
            },
        });

        expect(interventions).toHaveLength(1);
        expect(interventions[0]).toMatchObject({
            key: 'lTheanine',
            timeMinutes: 495,
            dose: '200mg',
            rationale: 'Smooth the stimulant edge',
        });
    });

    it('validates stage response shapes', () => {
        expect(() => validateStageResponseShape('intervention', { interventions: [] })).toThrow(
            /expected at least one intervention/i,
        );

        expect(
            validateStageResponseShape('curves', { curves: [buildCurve('Focus', '#60a5fa')] }),
        ).toEqual({ curves: [buildCurve('Focus', '#60a5fa')] });
    });
});
