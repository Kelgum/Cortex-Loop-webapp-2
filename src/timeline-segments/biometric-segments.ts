// ============================================
// BIOMETRIC SEGMENTS
// ============================================
// Strip clip-path reveal animation.

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { PHASE_CHART } from '../constants';

// --- Biometric strips clip-path reveal ---
export function createBiometricRevealSegment(startTime: number, stripCount: number): AnimationSegment {
    const STAGGER = 80; // ms per strip
    const REVEAL_DUR = 600;
    const totalDuration = REVEAL_DUR + (stripCount - 1) * STAGGER;

    return {
        id: 'biometric-strips-reveal',
        label: 'Bio Reveal',
        category: 'biometric',
        startTime,
        duration: totalDuration,
        phaseIdx: 3,

        enter(ctx) {
            // Strips are already created by renderBiometricStrips() which runs
            // as part of the biometric data pipeline. This segment just animates
            // the clip-path reveal.
        },

        render(t, ctx) {
            const group = ctx.groups['phase-biometric-strips'];
            if (!group) return;
            const svg = ctx.svgRoot;
            const defs = svg.querySelector('defs');
            if (!defs) return;

            const stripGroups = group.querySelectorAll('g[data-clip-id]');
            const totalMs = this.duration;
            const elapsedMs = t * totalMs;

            stripGroups.forEach((sg: any, i: number) => {
                const clipId = sg.dataset.clipId;
                const clip = defs.querySelector(`#${clipId}`);
                if (!clip) return;
                const rect = clip.querySelector('rect');
                if (!rect) return;

                const delay = i * STAGGER;
                if (elapsedMs < delay) {
                    rect.setAttribute('width', '0');
                    return;
                }

                const stripT = Math.min(1, (elapsedMs - delay) / REVEAL_DUR);
                // ease-in-out quadratic
                const ease = stripT < 0.5 ? 2 * stripT * stripT : 1 - Math.pow(-2 * stripT + 2, 2) / 2;
                rect.setAttribute('width', String(PHASE_CHART.plotW * ease));

                // After full reveal, remove clip
                if (stripT >= 1) {
                    sg.removeAttribute('clip-path');
                    clip.remove();
                }
            });
        },

        exit(ctx) {
            // On backward seek: restore clip-paths (re-hide strips)
            const group = ctx.groups['phase-biometric-strips'];
            if (group) group.innerHTML = '';
        },
    };
}
