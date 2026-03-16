import { describe, expect, it } from 'vitest';

import { diffInterventions } from '../../src/revision-animation';

describe('revision diff heuristics', () => {
    it('matches a same-slot stimulant swap as a replacement', () => {
        const oldIvs = [
            {
                key: 'caffeineIR',
                dose: '100mg',
                doseMultiplier: 1,
                timeMinutes: 480,
                impacts: { 'Focused Attention': 1, 'Sleep Pressure': -0.4 },
                substance: { class: 'Stimulant' },
            },
        ];
        const newIvs = [
            {
                key: 'theacrine',
                dose: '100mg',
                doseMultiplier: 1,
                timeMinutes: 510,
                impacts: { 'Focused Attention': 1, 'Sleep Pressure': -0.3 },
                substance: { class: 'Stimulant' },
            },
        ];

        const diff = diffInterventions(oldIvs as any, newIvs as any);

        expect(diff).toHaveLength(1);
        expect(diff[0].type).toBe('replaced');
        expect(diff[0].oldIv?.key).toBe('caffeineIR');
        expect(diff[0].newIv?.key).toBe('theacrine');
    });

    it('keeps distant unrelated changes as literal remove plus add', () => {
        const oldIvs = [
            {
                key: 'caffeineIR',
                dose: '100mg',
                doseMultiplier: 1,
                timeMinutes: 480,
                impacts: { 'Focused Attention': 1 },
                substance: { class: 'Stimulant' },
            },
        ];
        const newIvs = [
            {
                key: 'magnesiumGlycinate',
                dose: '400mg',
                doseMultiplier: 1,
                timeMinutes: 1320,
                impacts: { 'Sleep Pressure': 0.8 },
                substance: { class: 'Mineral/Electrolyte' },
            },
        ];

        const diff = diffInterventions(oldIvs as any, newIvs as any);

        expect(diff).toHaveLength(2);
        expect(diff.map((entry) => entry.type)).toEqual(['removed', 'added']);
    });
});
