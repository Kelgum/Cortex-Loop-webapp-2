import { describe, expect, it } from 'vitest';
import { resolveVcrNavState } from '../../src/biometric';

describe('resolveVcrNavState', () => {
    it('returns preplay mapping for ready mode', () => {
        const nav = resolveVcrNavState({
            mode: 'ready',
            currentStep: 0,
            totalSteps: 3,
            bioMode: false,
            canonActionActive: false,
        });

        expect(nav.preplay).toBe(true);
        expect(nav.stepperActive).toBe(true);
        expect(nav.showPrev).toBe(false);
        expect(nav.showNext).toBe(true);
        expect(nav.prevDisabled).toBe(true);
        expect(nav.nextDisabled).toBe(false);
        expect(nav.prevFaded).toBe(false);
    });

    it('dims prev only on first playing step', () => {
        const nav = resolveVcrNavState({
            mode: 'playing',
            currentStep: 0,
            totalSteps: 3,
            bioMode: false,
            canonActionActive: false,
        });

        expect(nav.preplay).toBe(false);
        expect(nav.showPrev).toBe(true);
        expect(nav.showNext).toBe(true);
        expect(nav.prevDisabled).toBe(true);
        expect(nav.nextDisabled).toBe(false);
        expect(nav.prevFaded).toBe(true);
    });

    it('enables both prev and next after first step during playback', () => {
        const nav = resolveVcrNavState({
            mode: 'playing',
            currentStep: 1,
            totalSteps: 3,
            bioMode: false,
            canonActionActive: false,
        });

        expect(nav.showPrev).toBe(true);
        expect(nav.showNext).toBe(true);
        expect(nav.prevDisabled).toBe(false);
        expect(nav.nextDisabled).toBe(false);
        expect(nav.prevFaded).toBe(false);
    });

    it('hides navigation when complete', () => {
        const nav = resolveVcrNavState({
            mode: 'complete',
            currentStep: 2,
            totalSteps: 3,
            bioMode: false,
            canonActionActive: false,
        });

        expect(nav.stepperActive).toBe(false);
        expect(nav.preplay).toBe(false);
        expect(nav.showPrev).toBe(false);
        expect(nav.showNext).toBe(false);
        expect(nav.prevDisabled).toBe(true);
        expect(nav.nextDisabled).toBe(true);
    });
});
