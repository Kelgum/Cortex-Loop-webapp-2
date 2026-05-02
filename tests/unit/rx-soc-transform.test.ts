import { describe, expect, it } from 'vitest';

import {
    buildRxSocTwin,
    RX_SOC_DEFAULT_DOSE_TIME_MINUTES,
    RX_SOC_MAX_SUBSTANCES,
} from '../../src/rx-soc-transform';
import type { CurveData, DaySnapshot, Intervention, SocrxStageResult } from '../../src/types';
import type { SessionCacheBundle } from '../../src/llm-cache';

function makePoints(values: number[]) {
    return values.map((value, idx) => ({ hour: idx, value }));
}

function makeCurves(): CurveData[] {
    const baseline24 = (mean: number) =>
        Array.from({ length: 24 }, (_, h) => ({ hour: h, value: mean }));
    const desired24 = (peakHour: number, peakValue: number) =>
        Array.from({ length: 24 }, (_, h) => {
            const dist = Math.abs(h - peakHour);
            return { hour: h, value: Math.max(20, peakValue - dist * 4) };
        });
    return [
        {
            effect: 'Focus',
            color: '#60a5fa',
            baseline: baseline24(40),
            desired: desired24(12, 85),
            polarity: 'higher_is_better',
        },
        {
            effect: 'Sleep',
            color: '#a78bfa',
            baseline: baseline24(30),
            desired: desired24(22, 80),
            polarity: 'higher_is_better',
        },
    ];
}

function makeIntervention(
    key: string,
    timeMinutes: number,
    targetCurveIdx: number,
    impactKey: string,
    impactValue: number,
    dose = '100mg',
): Intervention {
    return {
        key,
        timeMinutes,
        dose,
        substance: null as any,
        targetCurveIdx,
        targetEffect: impactKey,
        rationale: 'test',
        impacts: { [impactKey]: impactValue },
    };
}

function makeBundle(day0Interventions: Intervention[]): SessionCacheBundle {
    const curves = makeCurves();
    const days: DaySnapshot[] = [];
    for (let d = 1; d <= 7; d++) {
        days.push({
            day: d,
            bioCorrectedBaseline: curves.map(c => [...c.baseline]),
            desiredCurves: curves.map(c => [...c.desired]),
            postInterventionBaseline: curves.map(c => [...c.baseline]),
            interventions: d === 1 ? day0Interventions : [],
            lxCurves: curves.map(c => ({
                points: makePoints(c.baseline.map(p => p.value)),
                desired: makePoints(c.desired.map(p => p.value)),
                baseline: [...c.baseline],
            })),
            biometricChannels: [],
            poiEvents: [],
            toleranceProfile: [],
            events: '',
            narrativeBeat: '',
            dayNarrative: '',
        });
    }
    return {
        __lxStudioCache: 2,
        runId: 'test-run',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        stages: {
            'runtime-replay-state': {
                meta: {
                    stageClass: 'runtime-replay-state',
                    cacheKey: 'session:runtime-replay-state',
                    cachedAt: new Date().toISOString(),
                },
                payload: {
                    schema: 1,
                    week: { days },
                },
            },
        },
    };
}

describe('buildRxSocTwin', () => {
    it('returns null when the bundle lacks week data', () => {
        const emptyBundle: SessionCacheBundle = {
            __lxStudioCache: 2,
            runId: 'r',
            createdAt: 'x',
            completedAt: 'x',
            stages: {},
        };
        expect(buildRxSocTwin(emptyBundle, makeCurves())).toBeNull();
    });

    it('returns null when curvesData is empty', () => {
        const bundle = makeBundle([]);
        expect(buildRxSocTwin(bundle, [])).toBeNull();
    });

    it('prunes to at most RX_SOC_MAX_SUBSTANCES (one per curve), preferring Rx-tier', () => {
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.8), // OTC
            makeIntervention('modafinil', 10 * 60, 0, 'Focus', 0.6), // Controlled
            makeIntervention('bacopaMonnieri', 12 * 60, 0, 'Focus', 0.4),
            makeIntervention('melatoninIR', 22 * 60, 1, 'Sleep', 0.7),
        ];
        const twin = buildRxSocTwin(makeBundle(interventions), makeCurves());
        expect(twin).not.toBeNull();
        expect(twin!.interventions7D[0].length).toBeLessThanOrEqual(RX_SOC_MAX_SUBSTANCES);
        // Controlled modafinil beats OTC caffeine for Focus (Rx-tier preference)
        // even though caffeine has the higher raw impact coefficient.
        const keys = twin!.interventions7D[0].map(iv => iv.key).sort();
        expect(keys).toEqual(['melatoninIR', 'modafinil']);
    });

    it('tie-breaks by lower existing dose count when impact magnitudes tie', () => {
        // Both caffeineIR and modafinil have impact 0.5 on Focus.
        // caffeineIR appears 3 times in day-0 (more pills), modafinil once.
        // Expect modafinil to win (fewer pills = more SOC-like).
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.5),
            makeIntervention('caffeineIR', 12 * 60, 0, 'Focus', 0.5),
            makeIntervention('caffeineIR', 16 * 60, 0, 'Focus', 0.5),
            makeIntervention('modafinil', 9 * 60, 0, 'Focus', 0.5),
        ];
        const twin = buildRxSocTwin(makeBundle(interventions), makeCurves());
        expect(twin).not.toBeNull();
        const keys = twin!.interventions7D[0].map(iv => iv.key);
        expect(keys).toContain('modafinil');
        expect(keys).not.toContain('caffeineIR');
    });

    it('flattens all doses to 08:00 once daily', () => {
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 14 * 60, 0, 'Focus', 0.9),
            makeIntervention('melatoninIR', 23 * 60, 1, 'Sleep', 0.9),
        ];
        const twin = buildRxSocTwin(makeBundle(interventions), makeCurves());
        expect(twin).not.toBeNull();
        for (const iv of twin!.interventions7D[0]) {
            expect(iv.timeMinutes).toBe(RX_SOC_DEFAULT_DOSE_TIME_MINUTES);
            expect(iv.doseMultiplier).toBe(1);
            expect(iv.bioTrigger).toBeUndefined();
        }
    });

    it('replicates the same interventions across all 7 days', () => {
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9),
        ];
        const twin = buildRxSocTwin(makeBundle(interventions), makeCurves());
        expect(twin).not.toBeNull();
        expect(twin!.interventions7D.length).toBe(7);

        const day1Keys = twin!.interventions7D[0].map(iv => `${iv.key}@${iv.timeMinutes}`);
        for (let d = 1; d < 7; d++) {
            const dKeys = twin!.interventions7D[d].map(iv => `${iv.key}@${iv.timeMinutes}`);
            expect(dKeys).toEqual(day1Keys);
        }
    });

    it('produces a well-formed twin with effect scores aligned to curves', () => {
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9),
            makeIntervention('melatoninIR', 22 * 60, 1, 'Sleep', 0.9),
        ];
        const curves = makeCurves();
        const twin = buildRxSocTwin(makeBundle(interventions), curves);
        expect(twin).not.toBeNull();
        expect(twin!.version).toBeGreaterThan(0);
        expect(Array.isArray(twin!.effectScores)).toBe(true);
        expect(twin!.effectScores.length).toBe(curves.length);
        expect(twin!.lxCurves7D.length).toBe(7);
        expect(twin!.transformRules.adaptive).toBe(false);
        expect(twin!.transformRules.doseTimeMinutes).toBe(RX_SOC_DEFAULT_DOSE_TIME_MINUTES);
        expect(twin!.transformRules.maxSubstances).toBe(RX_SOC_MAX_SUBSTANCES);
    });

    it('handles an empty day-0 intervention list gracefully', () => {
        const twin = buildRxSocTwin(makeBundle([]), makeCurves());
        expect(twin).not.toBeNull();
        expect(twin!.interventions7D.every(d => d.length === 0)).toBe(true);
    });

    it('keeps the intervention protocol static across all 7 days (no adaptation)', () => {
        // The protocol (substances/doses/times) is the SOC "static" contract —
        // it does NOT change day-to-day. The overlay curve itself is allowed
        // to adapt to the shifting bio-corrected baseline, but the prescription
        // stays put.
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9),
            makeIntervention('melatoninIR', 22 * 60, 1, 'Sleep', 0.9),
        ];
        const twin = buildRxSocTwin(makeBundle(interventions), makeCurves());
        expect(twin).not.toBeNull();
        expect(twin!.interventions7D.length).toBe(7);

        const day0Keys = twin!.interventions7D[0]
            .map(iv => `${iv.key}@${iv.timeMinutes}:${iv.dose}`)
            .sort();
        for (let d = 1; d < 7; d++) {
            const dKeys = twin!.interventions7D[d]
                .map(iv => `${iv.key}@${iv.timeMinutes}:${iv.dose}`)
                .sort();
            expect(dKeys).toEqual(day0Keys);
        }
    });

    it('re-computes the Rx overlay per day against that day\'s post-intervention baseline', () => {
        // The Rx overlay should track the SAME shifting baseline the Lx panel
        // renders (postInterventionBaseline) — a day whose PIB shifts yields a
        // different overlay, even though the protocol is identical. That's what
        // makes the Rx thick stroke visually ride on the dashed baseline line.
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9),
        ];
        const curves = makeCurves();
        const bundle = makeBundle(interventions);
        // Mutate day-3's post-intervention baseline so it differs from day-0's.
        const days = (bundle.stages as any)['runtime-replay-state'].payload.week.days as DaySnapshot[];
        days[3].postInterventionBaseline = curves.map(c =>
            c.baseline.map(p => ({ hour: p.hour, value: p.value + 20 })),
        );

        const twin = buildRxSocTwin(bundle, curves);
        expect(twin).not.toBeNull();
        const day0Points = twin!.lxCurves7D[0][0].points || [];
        const day3Points = twin!.lxCurves7D[3][0].points || [];
        expect(day0Points.length).toBe(day3Points.length);
        const anyDifferent = day0Points.some((p, i) => Math.abs(p.value - (day3Points[i]?.value ?? p.value)) > 0.5);
        expect(anyDifferent).toBe(true);
    });

    it('deep-clones per-day Rx points so mutation on one day does not leak into others', () => {
        const interventions: Intervention[] = [
            makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9),
        ];
        const twin = buildRxSocTwin(makeBundle(interventions), makeCurves());
        expect(twin).not.toBeNull();
        const day0Points = twin!.lxCurves7D[0][0].points!;
        const day3Points = twin!.lxCurves7D[3][0].points!;
        expect(day0Points).not.toBe(day3Points);
        expect(day0Points[0]).not.toBe(day3Points[0]);
        const originalValue = day3Points[0].value;
        day0Points[0].value = -999;
        expect(day3Points[0].value).toBe(originalValue);
    });
});

describe('buildRxSocTwin with socrx hints', () => {
    it('uses the LLM-picked substanceKey over the deterministic heuristic', () => {
        // Day-0 Lx selected caffeine. Without a hint the fallback picks
        // caffeine as the Focus drug. With a hint naming modafinil, the
        // Rx side should prescribe modafinil instead.
        const day0: Intervention[] = [makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9)];
        const hints: SocrxStageResult = {
            conditionLabel: 'Focus deficit, adult',
            narrative: 'First-line modafinil once daily.',
            picks: [
                {
                    substanceKey: 'modafinil',
                    dose: '100mg',
                    timeMinutes: 7 * 60,
                    targetCurveIdx: 0,
                    targetEffect: 'Focus',
                    rationale: 'Test.',
                },
            ],
        };
        const twin = buildRxSocTwin(makeBundle(day0), makeCurves(), hints);
        expect(twin).not.toBeNull();
        expect(twin!.interventions7D[0].map(iv => iv.key)).toContain('modafinil');
        expect(twin!.interventions7D[0].map(iv => iv.key)).not.toContain('caffeineIR');
        expect(twin!.conditionLabel).toBe('Focus deficit, adult');
        expect(twin!.narrative).toBe('First-line modafinil once daily.');
        expect(twin!.perDrugTimes).toBe(true);
        expect(twin!.socrxFallbackReason).toBeUndefined();
    });

    it('preserves per-drug LLM-picked timeMinutes (no 08:00 flattening)', () => {
        const day0: Intervention[] = [makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9)];
        const hints: SocrxStageResult = {
            conditionLabel: 'Test',
            narrative: 'Test.',
            picks: [
                {
                    substanceKey: 'modafinil',
                    dose: '100mg',
                    timeMinutes: 7 * 60 + 30, // 07:30
                    targetCurveIdx: 0,
                    targetEffect: 'Focus',
                    rationale: '',
                },
                {
                    substanceKey: 'melatoninIR',
                    dose: '3mg',
                    timeMinutes: 22 * 60, // 22:00
                    targetCurveIdx: 1,
                    targetEffect: 'Sleep',
                    rationale: '',
                },
            ],
        };
        const twin = buildRxSocTwin(makeBundle(day0), makeCurves(), hints);
        expect(twin).not.toBeNull();
        const byKey = new Map(twin!.interventions7D[0].map(iv => [iv.key, iv.timeMinutes]));
        expect(byKey.get('modafinil')).toBe(7 * 60 + 30);
        expect(byKey.get('melatoninIR')).toBe(22 * 60);
    });

    it('caps LLM picks to RX_SOC_MAX_SUBSTANCES even when the hint has more', () => {
        const hints: SocrxStageResult = {
            conditionLabel: 'Test',
            narrative: '',
            picks: [
                { substanceKey: 'modafinil', dose: '', timeMinutes: 8 * 60, targetCurveIdx: 0, targetEffect: 'Focus', rationale: '' },
                { substanceKey: 'melatoninIR', dose: '', timeMinutes: 22 * 60, targetCurveIdx: 1, targetEffect: 'Sleep', rationale: '' },
                { substanceKey: 'caffeineIR', dose: '', timeMinutes: 8 * 60, targetCurveIdx: 0, targetEffect: 'Focus', rationale: '' },
            ],
        };
        const twin = buildRxSocTwin(makeBundle([]), makeCurves(), hints);
        expect(twin).not.toBeNull();
        expect(twin!.interventions7D[0].length).toBeLessThanOrEqual(RX_SOC_MAX_SUBSTANCES);
    });

    it('replicates LLM-picked interventions across all 7 days', () => {
        const hints: SocrxStageResult = {
            conditionLabel: 'Test',
            narrative: '',
            picks: [
                { substanceKey: 'modafinil', dose: '100mg', timeMinutes: 8 * 60, targetCurveIdx: 0, targetEffect: 'Focus', rationale: '' },
            ],
        };
        const twin = buildRxSocTwin(makeBundle([]), makeCurves(), hints);
        expect(twin).not.toBeNull();
        expect(twin!.interventions7D.length).toBe(7);
        const day1 = twin!.interventions7D[0].map(iv => `${iv.key}@${iv.timeMinutes}`);
        for (let d = 1; d < 7; d++) {
            expect(twin!.interventions7D[d].map(iv => `${iv.key}@${iv.timeMinutes}`)).toEqual(day1);
        }
    });

    it('falls back to pruneToSoc with no_valid_picks when all LLM picks are unknown keys', () => {
        const day0: Intervention[] = [makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9)];
        const hints: SocrxStageResult = {
            conditionLabel: 'Test',
            narrative: '',
            picks: [
                {
                    substanceKey: 'notARealDrug',
                    dose: '100mg',
                    timeMinutes: 8 * 60,
                    targetCurveIdx: 0,
                    targetEffect: 'Focus',
                    rationale: '',
                },
            ],
        };
        const twin = buildRxSocTwin(makeBundle(day0), makeCurves(), hints);
        expect(twin).not.toBeNull();
        expect(twin!.socrxFallbackReason).toBe('no_valid_picks');
        expect(twin!.interventions7D[0].map(iv => iv.key)).toContain('caffeineIR');
        // Fallback path flattens to 08:00 — not perDrugTimes.
        expect(twin!.perDrugTimes).toBeUndefined();
        for (const iv of twin!.interventions7D[0]) {
            expect(iv.timeMinutes).toBe(RX_SOC_DEFAULT_DOSE_TIME_MINUTES);
        }
    });

    it('marks the twin as llm_unavailable when null hints are passed', () => {
        const day0: Intervention[] = [makeIntervention('caffeineIR', 8 * 60, 0, 'Focus', 0.9)];
        const twin = buildRxSocTwin(makeBundle(day0), makeCurves(), null);
        expect(twin).not.toBeNull();
        expect(twin!.socrxFallbackReason).toBe('llm_unavailable');
    });
});
