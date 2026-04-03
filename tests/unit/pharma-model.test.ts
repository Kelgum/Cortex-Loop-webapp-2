import { describe, expect, it } from 'vitest';
import { substanceEffectAt } from '../../src/pharma-model';

describe('substanceEffectAt — Hill PD transform', () => {
    const basePharma = {
        onset: 20,
        peak: 60,
        duration: 240,
        halfLife: 300,
        strength: 40,
        rebound: 10,
        ec50: 0.5,
        hill: 2.0,
    };

    it('at peak, effect equals strength regardless of Hill params', () => {
        const steepPharma = { ...basePharma, ec50: 0.45, hill: 3.0 };
        const gradualPharma = { ...basePharma, ec50: 0.25, hill: 1.2 };
        const atPeakSteep = substanceEffectAt(60, steepPharma);
        const atPeakGradual = substanceEffectAt(60, gradualPharma);
        expect(atPeakSteep).toBeCloseTo(40, 0);
        expect(atPeakGradual).toBeCloseTo(40, 0);
    });

    it('steep hill (3.0) drops off faster than shallow hill (1.2)', () => {
        const steepPharma = { ...basePharma, ec50: 0.5, hill: 3.0 };
        const shallowPharma = { ...basePharma, ec50: 0.5, hill: 1.2 };
        // Well past duration, into decay tail
        const t = 300;
        const steepEffect = substanceEffectAt(t, steepPharma);
        const shallowEffect = substanceEffectAt(t, shallowPharma);
        expect(steepEffect).toBeLessThan(shallowEffect);
    });

    it('defaults (no ec50/hill) match explicit ec50=0.5, hill=2.0', () => {
        const noHill = { onset: 20, peak: 60, duration: 240, halfLife: 300, strength: 40, rebound: 10 };
        const withHill = { ...noHill, ec50: 0.5, hill: 2.0 };
        const t = 120;
        expect(substanceEffectAt(t, noHill)).toBeCloseTo(substanceEffectAt(t, withHill), 6);
    });

    it('rebound (negative effect) passes through unchanged', () => {
        // Use high-rebound, short-halfLife params to guarantee negative zone
        const reboundPharma = {
            onset: 15,
            peak: 60,
            duration: 180,
            halfLife: 60,
            strength: 40,
            rebound: 30,
            ec50: 0.5,
            hill: 2.0,
        };
        // Shortly after duration, rebound dip (30) overwhelms the tiny residual
        const t = reboundPharma.duration + 10;
        const effect = substanceEffectAt(t, reboundPharma);
        expect(effect).toBeLessThan(0);
    });

    it('strength=0 produces zero at all time points', () => {
        const zeroPharma = { ...basePharma, strength: 0 };
        expect(substanceEffectAt(60, zeroPharma)).toBe(0);
        expect(substanceEffectAt(120, zeroPharma)).toBe(0);
    });

    it('negative time returns 0', () => {
        expect(substanceEffectAt(-10, basePharma)).toBe(0);
    });

    it('CBD-like substance (low hill, low ec50) has attenuated but present tail', () => {
        const cbdPharma = {
            onset: 60,
            peak: 180,
            duration: 360,
            halfLife: 1080,
            strength: 25,
            rebound: 0,
            ec50: 0.30,
            hill: 1.5,
        };
        const effectAt5h = substanceEffectAt(300, cbdPharma);
        expect(effectAt5h).toBeGreaterThan(5);
        expect(effectAt5h).toBeLessThan(25);

        // At 24h (1440 min), effect should be present but below peak
        // With hill=1.5, ec50=0.30, the sigmoid boosts low-concentration effects
        // relative to raw PK, but still well below peak strength of 25
        const effectAt24h = substanceEffectAt(1440, cbdPharma);
        expect(effectAt24h).toBeGreaterThan(0);
        expect(effectAt24h).toBeLessThan(20);
    });

    it('hill=1.0 with low ec50 produces near-linear response', () => {
        const linearPharma = { ...basePharma, ec50: 0.2, hill: 1.0 };
        // At plateau (just past peak), effect should be close to strength
        const atPlateau = substanceEffectAt(80, linearPharma);
        expect(atPlateau).toBeGreaterThan(30);
    });

    it('high ec50 attenuates sub-peak effects more strongly', () => {
        const lowEc50 = { ...basePharma, ec50: 0.2, hill: 2.0 };
        const highEc50 = { ...basePharma, ec50: 0.6, hill: 2.0 };
        // During ramp-up (sub-peak), high ec50 should produce lower effect
        const t = 15; // during ramp-up
        expect(substanceEffectAt(t, highEc50)).toBeLessThan(substanceEffectAt(t, lowEc50));
    });
});

describe('substanceEffectAt — chronobiotic tail', () => {
    const melatoninPharma = {
        onset: 30,
        peak: 60,
        duration: 120,
        halfLife: 45,
        strength: 40,
        rebound: 0,
        ec50: 0.55,
        hill: 2.5,
        chronobioticTail: 0.15,
        chronobioticHalfLife: 600,
    };

    it('at peak, effect equals strength (tail condition is false before duration)', () => {
        const atPeak = substanceEffectAt(60, melatoninPharma);
        expect(atPeak).toBeCloseTo(40, 0);
    });

    it('well past duration, chronobiotic tail sustains a floor above zero', () => {
        // 4h (240min) past duration — PK residual is negligible at halfLife=45min
        const t = melatoninPharma.duration + 240;
        const effect = substanceEffectAt(t, melatoninPharma);
        // Tail: 0.15 * 40 * 0.5^(240/600) ≈ 4.5
        expect(effect).toBeGreaterThan(3);
        expect(effect).toBeLessThan(7);
    });

    it('tail decays slowly over time but remains positive', () => {
        const t1 = melatoninPharma.duration + 120; // 2h post-duration
        const t2 = melatoninPharma.duration + 480; // 8h post-duration
        const e1 = substanceEffectAt(t1, melatoninPharma);
        const e2 = substanceEffectAt(t2, melatoninPharma);
        expect(e1).toBeGreaterThan(e2); // decays over time
        expect(e2).toBeGreaterThan(0); // still positive at 8h
    });

    it('substance without chronobiotic params is unchanged (backward compat)', () => {
        const noChrono = { ...melatoninPharma };
        delete (noChrono as any).chronobioticTail;
        delete (noChrono as any).chronobioticHalfLife;
        // Well past duration, effect should be near zero without the tail
        const t = melatoninPharma.duration + 240;
        const effect = substanceEffectAt(t, noChrono);
        expect(effect).toBeLessThan(1);
    });

    it('strength=0 produces zero even with chronobiotic params', () => {
        const zeroPharma = { ...melatoninPharma, strength: 0 };
        expect(substanceEffectAt(melatoninPharma.duration + 120, zeroPharma)).toBe(0);
    });
});
