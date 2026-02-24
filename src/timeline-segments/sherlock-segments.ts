// ============================================
// SHERLOCK NARRATION SEGMENTS
// ============================================
// Declarative timeline segments for the Sherlock narration panel.
// Each segment maps to a narration beat (intro, per-substance, outro).
//
// Lifecycle rules (from CLAUDE.md):
// - enter() must be re-entrant (safe to call multiple times)
// - render(t) must be idempotent — pure function of t, no accumulated state
// - render(1) = the completed visual state for past segments
// - exit() undoes everything enter() created (backward seek cleanup)

import type { AnimationSegment, SegmentContext } from '../timeline-engine';
import {
    ensureNarrationPanel, showNarrationPanel, hideNarrationPanel,
    showSherlockStack, SherlockCardData
} from '../sherlock';

function extractBeatText(beat: any): string {
    if (typeof beat === 'string') return beat.trim();
    if (!beat || typeof beat !== 'object') return '';
    const candidates = [beat.text, beat.line, beat.narration, beat.message];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return '';
}

export function buildSherlockCards(ctx: SegmentContext): SherlockCardData[] {
    const cards: SherlockCardData[] = [];
    if (!ctx.sherlockNarration) return cards;
    const beats = ctx.sherlockNarration.beats;
    if (!Array.isArray(beats) || beats.length === 0) return cards;

    beats.forEach((beat: any, i: number) => {
        const beatStr = extractBeatText(beat);
        if (!beatStr) return;
        let matchedSubstance: any = null;
        let matchedIv: any = null;
        let curveIdx: number = -1;

        const iv = ctx.interventions[i];
        if (iv) {
            matchedSubstance = iv.substance;
            matchedIv = iv;
            curveIdx = ctx.curvesData?.findIndex((c: any) => c.key === iv.key) ?? -1;
        }

        let direction: 'up' | 'down' | 'neutral' = 'neutral';
        if (matchedIv && matchedIv.impacts) {
            const impactSum = Object.values(matchedIv.impacts).reduce((sum: number, val: any) => sum + Number(val), 0) as number;
            if (impactSum > 0) direction = 'up';
            else if (impactSum < 0) direction = 'down';
        }

        cards.push({
            id: `beat-${i}-${beatStr.substring(0, 16)}`,
            text: beatStr,
            substanceKey: matchedIv ? matchedIv.key : undefined,
            substanceName: matchedSubstance ? matchedSubstance.name : undefined,
            substanceColor: matchedSubstance ? matchedSubstance.color : undefined,
            dose: matchedIv && matchedIv.dose ? String(matchedIv.dose) : undefined,
            direction,
            curveIdx: curveIdx >= 0 ? curveIdx : undefined,
            timeMinutes: matchedIv && Number.isFinite(matchedIv.timeMinutes) ? matchedIv.timeMinutes : undefined
        });
    });

    // Sort substance cards to chronological order (by timeMinutes).
    // The animation loop and timeline segments iterate snapshots in chronological
    // order (computeIncrementalLxOverlay sorts by timeMinutes), so cards[k] must
    // match snapshot[k]. The LLM may return beats in a different order.
    cards.sort((a, b) => (a.timeMinutes ?? Infinity) - (b.timeMinutes ?? Infinity));

    if (ctx.sherlockNarration.outro) {
        cards.push({
            id: 'beat-outro',
            text: "You have reached your destination.",
            direction: 'finish' as any // Using 'finish' to trigger checkered flag
        });
    }
    return cards;
}

export function buildSherlockRevisionCards(ctx: SegmentContext): SherlockCardData[] {
    const cards: SherlockCardData[] = [];
    if (!ctx.sherlockRevisionNarration) return cards;

    const beats = ctx.sherlockRevisionNarration.beats || [];
    const diffEntries = ctx.revisionDiff || [];

    beats.forEach((beat: any, i: number) => {
        const beatStr = extractBeatText(beat);
        if (!beatStr) return;
        const diff = diffEntries[i];
        let direction: 'up' | 'down' | 'neutral' = 'neutral';
        let curveIdx = -1;

        if (diff) {
            if (diff.type === 'added' || diff.type === 'increased') direction = 'up';
            else if (diff.type === 'removed' || diff.type === 'decreased') direction = 'down';

            const tempIv = diff.newIv || diff.oldIv;
            if (tempIv) curveIdx = ctx.curvesData?.findIndex((c: any) => c.key === tempIv.key) ?? -1;
        }

        // Attempt formatting the name if it's just an id
        let formatName = diff?.substanceId || '';
        if (formatName.length > 0) {
            formatName = formatName.charAt(0).toUpperCase() + formatName.slice(1);
        }

        cards.push({
            id: `rev-${i}-${beatStr.substring(0, 16) || i}`,
            text: beatStr,
            substanceKey: diff?.newIv?.key || diff?.oldIv?.key || diff?.substanceId,
            substanceName: formatName,
            substanceColor: '#c084fc', // generic purple fallback for revisions
            dose: diff?.newDose || diff?.oldDose,
            direction,
            curveIdx: curveIdx >= 0 ? curveIdx : undefined,
            timeMinutes: Number.isFinite(diff?.newIv?.timeMinutes)
                ? diff.newIv.timeMinutes
                : (Number.isFinite(diff?.oldIv?.timeMinutes) ? diff.oldIv.timeMinutes : undefined)
        });
    });

    if (ctx.sherlockRevisionNarration.outro) {
        cards.push({
            id: 'rev-outro',
            text: "You have reached your destination.",
            direction: 'finish' as any
        });
    }
    return cards;
}

/** Show panel + render stack */
function applyStack(cards: SherlockCardData[], activeIdx: number): void {
    if (cards.length === 0 || activeIdx < 0) return;
    showNarrationPanel();
    showSherlockStack(cards, activeIdx);
}

/** Hide panel entirely */
function clearStack(): void {
    // When clearing, we just hide the panel. Next applyStack will update contents anyway.
    hideNarrationPanel();
}

// ── Phase 2: Lx Intervention Narration ──────────────────────

export function createSherlockIntroSegment(startTime: number): AnimationSegment {
    return {
        id: 'sherlock-intro',
        label: 'Sherlock Intro',
        category: 'sherlock',
        startTime,
        duration: 400,
        phaseIdx: 2,

        enter(ctx) {
            const cards = buildSherlockCards(ctx);
            if (cards.length > 0) ensureNarrationPanel();
        },

        render(t, ctx) {
            const cards = buildSherlockCards(ctx);
            if (cards.length === 0) return;
            if (t > 0) applyStack(cards, 0); // Intro is always index 0
        },

        exit(_ctx) {
            hideNarrationPanel();
        },
    };
}

export function createSherlockBeatSegment(
    startTime: number,
    stepIdx: number,
    beatDuration: number,
): AnimationSegment {
    return {
        id: `sherlock-beat-${stepIdx}`,
        label: `Sherlock ${stepIdx + 1}`,
        category: 'sherlock',
        startTime,
        duration: beatDuration,
        phaseIdx: 2,

        enter(ctx) {
            const cards = buildSherlockCards(ctx);
            if (cards.length > 0) ensureNarrationPanel();
        },

        render(t, ctx) {
            const cards = buildSherlockCards(ctx);
            if (cards.length === 0) return;
            if (t > 0) applyStack(cards, stepIdx);
        },

        exit(_ctx) {
            // Do not hide the whole panel on exit. The previous segment (either intro or previous beat) 
            // will just re-render its stack state when seeking backwards.
            // Timeline engine handles that seamlessly!
        },
    };
}

export function createSherlockOutroSegment(startTime: number): AnimationSegment {
    return {
        id: 'sherlock-outro',
        label: 'Sherlock Outro',
        category: 'sherlock',
        startTime,
        duration: 2500,
        phaseIdx: 2,

        enter(ctx) {
            const cards = buildSherlockCards(ctx);
            if (cards.length > 0) ensureNarrationPanel();
        },

        render(t, ctx) {
            const cards = buildSherlockCards(ctx);
            if (cards.length === 0) return;
            // The outro is the last card in the stack
            if (t > 0) applyStack(cards, cards.length - 1);
        },

        exit(_ctx) {
            // Again, no hide needed here for backwards scrub
        },
    };
}

// ── Phase 4: Revision Narration ─────────────────────────────

export function createSherlockRevisionIntroSegment(startTime: number): AnimationSegment {
    return {
        id: 'sherlock-rev-intro',
        label: 'Sherlock Rev Intro',
        category: 'sherlock',
        startTime,
        duration: 400,
        phaseIdx: 4,

        enter(ctx) {
            const cards = buildSherlockRevisionCards(ctx);
            if (cards.length > 0) ensureNarrationPanel();
        },

        render(t, ctx) {
            const cards = buildSherlockRevisionCards(ctx);
            if (cards.length === 0) return;
            if (t > 0) applyStack(cards, 0);
        },

        exit(ctx) {
            hideNarrationPanel();
        },
    };
}

export function createSherlockRevisionBeatSegment(
    startTime: number,
    entryIdx: number,
    beatDuration: number,
): AnimationSegment {
    return {
        id: `sherlock-rev-beat-${entryIdx}`,
        label: `Sherlock Rev ${entryIdx + 1}`,
        category: 'sherlock',
        startTime,
        duration: beatDuration,
        phaseIdx: 4,

        enter(ctx) {
            const cards = buildSherlockRevisionCards(ctx);
            if (cards.length > 0) ensureNarrationPanel();
        },

        render(t, ctx) {
            const cards = buildSherlockRevisionCards(ctx);
            if (cards.length === 0) return;
            if (t > 0) applyStack(cards, entryIdx);
        },

        exit(_ctx) {
        },
    };
}

export function createSherlockRevisionOutroSegment(startTime: number): AnimationSegment {
    return {
        id: 'sherlock-rev-outro',
        label: 'Sherlock Rev Outro',
        category: 'sherlock',
        startTime,
        duration: 2500,
        phaseIdx: 4,

        enter(ctx) {
            const cards = buildSherlockRevisionCards(ctx);
            if (cards.length > 0) ensureNarrationPanel();
        },

        render(t, ctx) {
            const cards = buildSherlockRevisionCards(ctx);
            if (cards.length === 0) return;
            if (t > 0) applyStack(cards, cards.length - 1);
        },

        exit(_ctx) {
        },
    };
}
