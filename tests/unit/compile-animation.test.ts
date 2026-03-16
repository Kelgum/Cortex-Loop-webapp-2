import { describe, expect, it } from 'vitest';

import { computeLaneQueuePositions } from '../../src/compile-animation';

describe('computeLaneQueuePositions', () => {
    it('keeps the lead pill centered and queues the rest behind it', () => {
        const widths = [60, 44, 32];
        const positions = computeLaneQueuePositions(widths, 500, 8);

        expect(positions).toHaveLength(3);
        expect(positions[0] + widths[0] / 2).toBe(500);
        expect(positions[1] + widths[1] + 8).toBe(positions[0]);
        expect(positions[2] + widths[2] + 8).toBe(positions[1]);
    });

    it('promotes the next pill into the center slot after the lead is removed', () => {
        const remainingWidths = [44, 32];
        const positions = computeLaneQueuePositions(remainingWidths, 500, 8);

        expect(positions[0] + remainingWidths[0] / 2).toBe(500);
        expect(positions[1] + remainingWidths[1] + 8).toBe(positions[0]);
    });

    it('returns no positions for an empty lane', () => {
        expect(computeLaneQueuePositions([], 500)).toEqual([]);
    });
});
