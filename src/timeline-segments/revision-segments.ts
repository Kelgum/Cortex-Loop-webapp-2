// ============================================
// REVISION SEGMENTS
// ============================================
// Per-entry timing markers and Lx curve morph to revision.

import type { AnimationSegment } from '../timeline-engine';
import { phasePointsToPath, phasePointsToFillPath } from '../curve-utils';
import { syncGamificationOverlayFrame } from '../gamification-overlay';
import { placePeakDescriptors } from '../phase-chart';

// --- Per-diff-entry revision timing marker ---
export function createRevisionEntrySegment(
    startTime: number,
    entryIdx: number,
    entry: any, // { type, oldIv, newIv }
): AnimationSegment {
    // Timing marker for timeline ribbon — actual animation is imperative in animateRevisionScan
    const TOTAL = 900;

    return {
        id: `revision-entry-${entryIdx}`,
        label: `Rev: ${entry.type}`,
        category: 'revision',
        startTime,
        duration: TOTAL,
        phaseIdx: 4,

        enter() {},
        render() {},
        exit() {},
    };
}

// --- Lx curves morph to revision ---
export function createLxMorphToRevisionSegment(startTime: number): AnimationSegment {
    let _cachedStrokes: NodeListOf<Element> | null = null;
    let _cachedFills: NodeListOf<Element> | null = null;

    return {
        id: 'lx-morph-to-revision',
        label: 'Lx Execute',
        category: 'revision',
        startTime,
        duration: 1200,
        phaseIdx: 4,

        enter() {
            _cachedStrokes = null;
            _cachedFills = null;
        },

        render(t, ctx) {
            const sourceCurvesData = ctx.bioCorrectedCurvesData ?? ctx.curvesData;
            const sourceLxCurves = ctx.bioCorrectedLxCurves ?? ctx.lxCurves;
            if (!sourceLxCurves || !sourceCurvesData) return;
            const newLxCurves = ctx._revisedLxCurves;
            if (!newLxCurves) return;

            const lxGroup = ctx.groups['phase-lx-curves'];
            if (!lxGroup) return;
            if (!_cachedStrokes) _cachedStrokes = lxGroup.querySelectorAll('.phase-lx-path');
            if (!_cachedFills) _cachedFills = lxGroup.querySelectorAll('.phase-lx-fill');
            const lxStrokes = _cachedStrokes;
            const lxFills = _cachedFills;

            // ease-in-out quadratic
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const morphedCurves: any[] = [];

            for (let ci = 0; ci < sourceCurvesData.length; ci++) {
                const oldPts = sourceLxCurves[ci]?.points || [];
                const newPts = newLxCurves[ci]?.points || [];
                const len = Math.min(oldPts.length, newPts.length);
                if (len === 0) continue;

                const morphed: any[] = [];
                for (let j = 0; j < len; j++) {
                    morphed.push({
                        hour: oldPts[j].hour,
                        value: oldPts[j].value + (newPts[j].value - oldPts[j].value) * ease,
                    });
                }

                if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(morphed, true));
                if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(morphed, true));
                morphedCurves.push({
                    ...newLxCurves[ci],
                    baseline: newLxCurves[ci]?.baseline ?? ctx.lxCurves[ci]?.baseline,
                    points: morphed,
                });
            }

            syncGamificationOverlayFrame(morphedCurves, sourceCurvesData, 'phase4', {
                immediate: true,
                entranceProgress: 1,
            });
        },

        exit(ctx) {
            // On forward exit: curves are at revision position. Update peak descriptors.
            const sourceCurvesData = ctx.bioCorrectedCurvesData ?? ctx.curvesData;
            if (ctx._revisedLxCurves && sourceCurvesData) {
                const baseGroup = ctx.groups['phase-baseline-curves'];
                const overlay = ctx.groups['phase-tooltip-overlay'];
                if (baseGroup) baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
                if (overlay) overlay.querySelectorAll('.peak-descriptor').forEach((el: any) => el.remove());

                const lxCurvesForLabels = sourceCurvesData.map((c: any, i: number) => ({
                    ...c,
                    desired: ctx._revisedLxCurves[i]?.points,
                }));
                if (baseGroup) placePeakDescriptors(baseGroup, lxCurvesForLabels, 'desired', 0);
            }
        },
    };
}
