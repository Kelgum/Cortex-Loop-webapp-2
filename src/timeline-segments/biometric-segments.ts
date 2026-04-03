// ============================================
// BIOMETRIC SEGMENTS
// ============================================
// Strip clip-path reveal animation.

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import { PHASE_CHART } from '../constants';
import {
    BIO_CORRECTION_MORPH_MS,
    finalizeBioCorrectionPeakDescriptors,
    renderBioCorrectionFrame,
    restorePreBioCorrectionPeakDescriptors,
} from '../bio-correction';

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

export function createBioCorrectionMorphSegment(startTime: number): AnimationSegment {
    let finalized = false;

    const clearCorrectedLabels = (ctx: SegmentContext) => {
        ctx.groups['phase-baseline-curves']?.querySelectorAll('.peak-descriptor').forEach((el: any) => el.remove());
        ctx.groups['phase-tooltip-overlay']?.querySelectorAll('.peak-descriptor').forEach((el: any) => el.remove());
    };

    return {
        id: 'bio-correction-morph',
        label: 'Bio Apply',
        category: 'biometric',
        startTime,
        duration: BIO_CORRECTION_MORPH_MS,
        phaseIdx: 3,

        enter() {
            finalized = false;
        },

        render(t, ctx) {
            if (!ctx.curvesData || !ctx.lxCurves || !ctx.bioCorrectedCurvesData || !ctx.bioCorrectedLxCurves) return;

            if (finalized && t < 1) {
                clearCorrectedLabels(ctx);
                restorePreBioCorrectionPeakDescriptors(ctx.curvesData);
                finalized = false;
            }

            renderBioCorrectionFrame(
                {
                    oldBaselines: ctx.curvesData.map((curve: any) => curve?.baseline || []),
                    newBaselines: ctx.bioCorrectedCurvesData.map((curve: any) => curve?.baseline || []),
                    oldLxCurves: ctx.lxCurves,
                    newLxCurves: ctx.bioCorrectedLxCurves,
                    oldIncrementalSnapshots: ctx.incrementalSnapshots,
                    newIncrementalSnapshots: ctx.bioCorrectedIncrementalSnapshots,
                },
                ctx.curvesData,
                t,
            );

            if (t >= 1 && !finalized) {
                finalizeBioCorrectionPeakDescriptors(ctx.bioCorrectedCurvesData, ctx.bioCorrectedLxCurves);
                finalized = true;
            }
        },

        exit(ctx) {
            clearCorrectedLabels(ctx);
            if (ctx.curvesData) {
                restorePreBioCorrectionPeakDescriptors(ctx.curvesData);
            }
            finalized = false;
        },
    };
}
