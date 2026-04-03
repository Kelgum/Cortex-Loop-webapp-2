import { describe, expect, it } from 'vitest';

import { teleportInterpolation } from '../../src/utils';

describe('teleportInterpolation (parallel portal)', () => {
    const drift = 0.12;

    it('at t=0: origin at start with full opacity, destination near end with zero opacity', () => {
        const tf = teleportInterpolation(0, drift);
        expect(tf.originPos).toBe(0);
        expect(tf.originOpacity).toBe(1);
        expect(tf.destPos).toBeCloseTo(1 - drift);
        expect(tf.destOpacity).toBe(0);
    });

    it('at t=0.5: both halves visible — origin half-faded, destination half-faded', () => {
        const tf = teleportInterpolation(0.5, drift);
        expect(tf.originPos).toBeCloseTo(drift * 0.5);
        expect(tf.originOpacity).toBeCloseTo(0.5);
        expect(tf.destPos).toBeCloseTo((1 - drift) + drift * 0.5);
        expect(tf.destOpacity).toBeCloseTo(0.5);
    });

    it('at t=1: origin fully faded at drift position, destination at final position fully opaque', () => {
        const tf = teleportInterpolation(1, drift);
        expect(tf.originPos).toBeCloseTo(drift);
        expect(tf.originOpacity).toBe(0);
        expect(tf.destPos).toBeCloseTo(1);
        expect(tf.destOpacity).toBe(1);
    });

    it('origin and destination never overlap in position space', () => {
        for (let t = 0; t <= 1; t += 0.01) {
            const tf = teleportInterpolation(t, drift);
            expect(tf.originPos).toBeLessThanOrEqual(drift + 0.001);
            expect(tf.destPos).toBeGreaterThanOrEqual(1 - drift - 0.001);
        }
    });

    it('opacities are complementary (sum to 1) at all times', () => {
        for (let t = 0; t <= 1; t += 0.05) {
            const tf = teleportInterpolation(t, drift);
            expect(tf.originOpacity + tf.destOpacity).toBeCloseTo(1, 5);
        }
    });

    it('clamps t to [0, 1]', () => {
        const below = teleportInterpolation(-0.5, drift);
        expect(below.originOpacity).toBe(1);
        expect(below.destOpacity).toBe(0);

        const above = teleportInterpolation(1.5, drift);
        expect(above.originOpacity).toBe(0);
        expect(above.destOpacity).toBe(1);
    });

    it('works with zero drift fraction (instant snap)', () => {
        const tf = teleportInterpolation(0.5, 0);
        expect(tf.originPos).toBe(0);
        expect(tf.destPos).toBe(1);
        expect(tf.originOpacity).toBeCloseTo(0.5);
        expect(tf.destOpacity).toBeCloseTo(0.5);
    });
});
