// ── Stream Comments Prompt — shared by the Node generator script and
//    the browser-side Generate Comments button. Single source of truth
//    for what we ask the LLM when authoring simulated user reviews.
//
// Inputs are the minimum metadata to describe a cycle. Both call sites
// project their own data shape down to this interface before calling
// buildStreamCommentsPrompt.

export interface StreamCommentsPromptContext {
    prompt: string;
    title?: string;
    hookSentence?: string;
    topEffects?: string[];
    substanceClasses?: string[];
    creatorName?: string;
    durationDays?: number | null;
}

export function durationPhrase(days: number | null | undefined): string {
    if (!days) return 'a few weeks';
    if (days <= 1) return 'a single day';
    if (days <= 3) return 'a few days';
    if (days <= 30) return `${days} days`;
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

export function buildStreamCommentsPrompt(cycle: StreamCommentsPromptContext): string {
    const duration = durationPhrase(cycle.durationDays ?? null);
    const top = cycle.topEffects ?? [];
    const primaryEffect = top[0] || '(primary outcome)';
    const otherEffects = top.slice(1).join(', ') || '(none)';
    const classes = (cycle.substanceClasses ?? []).length
        ? (cycle.substanceClasses ?? []).join(', ')
        : '(unspecified)';
    const creator = (cycle.creatorName ?? '').trim() || '(uncredited)';

    return `You're writing simulated user reviews for a specific protocol streamed on Lx.health. These reviews appear in an investor-demo UI under the protocol card.

═══════════════════════════════════════════════════════════════
WHAT LX.HEALTH IS — INTERNALIZE THIS BEFORE WRITING
═══════════════════════════════════════════════════════════════

Lx is a substance-streaming infrastructure, not a supplement subscription. The product:

• Lx.Player — a pocket-sized substance streamer the user owns ($99, one-time). Single-touch dispense at the scheduled moment. No pillbox. No alarms to set. No bottles to manage.
• Smart Cartridge — a 25-chamber circular dosing assembly that snaps onto the Player. Arrives PRE-COMPILED for THIS user's protocol — already loaded, already sequenced, already timed.
• Lx.Cloud — fractal robotic fulfillment network that compiles each user's authored protocol into a cartridge and ships it. "Substance × hardware × software compiled into a single cartridge."
• The Lx Runtime — DESIGN → COMPILE → PLAY → LEARN. The user states intent ("4 hours of focus, no sleep impact"). A multi-agent LLM pipeline (Scout / Strategist / Chess Player / Sherlock / Spotter / Grandmaster + Knight / Spotter Daily / Strategist Bio Daily / Grandmaster Daily) designs and compiles the protocol. The cartridge plays it. Biometrics + a brief outcome label before the next dose feed the next iteration.
• Daily closed-loop adaptation — when the day diverges from plan (poor sleep, a stressful meeting, a missed workout), the Spotter detects the perturbation and the Grandmaster revises the rest of the day's protocol automatically. The user does nothing. The cartridge dispense schedule shifts on its own.
• Creator agents — KOL-authored philosophies (Andrew Huberman, Stacy Sims, Tim Spector, Peter Attia, Rhonda Patrick, Sara Gottfried, James Fadiman, Bryan Johnson, etc.) inject their mandate, substance palette, optimization weights, and guardrails into the agent pipeline. Picking a creator agent shapes the actual protocol output, not just the UI.
• Biological RLHF — every dispense generates an outcome event. A short subjective prompt before the next dose closes the loop. This is the data moat; users are aware they're contributing to it.
• $29/mo membership; substances at near-cost. Lx margin is on bits, not atoms.

Roadmap (mention only as roadmap, if at all):
• Acoustic biometrics — "anatomic IP address" verifying ingestion at the mouth via resonance signature. NOT in the current Player.
• Phase II Rx unlock — same device, Class II 510(k), dynamic polypharmacy. Today is Phase I.

═══════════════════════════════════════════════════════════════
THE FRICTION LX REMOVES — REVIEWS MUST NOT COMPLAIN ABOUT THESE
═══════════════════════════════════════════════════════════════

These are EXACTLY the problems Lx exists to solve. Complaints about them break the entire pitch. Do not write reviews that complain about:

✗ Pill counting, pillboxes, organizers, AM/PM compartments
✗ Setting alarms or reminders to take doses
✗ Forgetting a dose, missing the timing window
✗ Scheduling around lunch / school / work / commute / activities
✗ Measuring powders, eyeballing scoops, mixing drinks
✗ Buying multiple bottles, brand-mixing, tracking expiration dates
✗ "Hard to be consistent" / "annoying to manage" / "uneven results because schedule"
✗ Capsule size, swallowing pills, gagging on tablets
✗ Stacking multiple supplements manually
✗ Coordinating refills, running out

The cartridge IS the consistency. The Player IS the timing. Lx.Cloud IS the refill. Reviews that complain about any of the above are reviews of a product Lx is not.

═══════════════════════════════════════════════════════════════
WHAT REVIEWS MAY LEGITIMATELY DISCUSS
═══════════════════════════════════════════════════════════════

Positive themes:
• How the protocol's biological effect actually felt — the primary outcome
• The "stream" experience — doses arriving on time without thought; the device dispensing at the right minute
• The single-touch dispense moment / the cartridge satisfying click
• Daily adaptation when their day didn't go to plan — "had a terrible night, the afternoon doses rebalanced themselves"
• The creator agent's voice / philosophy coming through in how the protocol was shaped (mention creator NAME in at most one review)
• The outcome-labeling prompt before next dose — being asked, contributing to something
• Snapping in a new cartridge and forgetting about it for the rest of the day
• Coming off a manual stack of 8 bottles and the relief of one device
• Trust in the compiled protocol vs. their prior DIY attempts
• Protective effects were respected (a focus protocol that left sleep alone, a libido protocol that didn't blunt mood)

Legitimate critique surface (use for the 1-2★ slot):
• Non-responder — the protocol's biological effect didn't land for them
• Wrong-fit — a substance category clashed with their biology / a medication / a sensitivity
• Felt a side effect from a substance category and had to swap protocols
• Creator agent's philosophy didn't match their lived reality after a few cycles
• Substance library gap — wanted something not yet in Lx's catalog
• Cartridge arrived later than expected (Lx.Cloud fulfillment latency)
• Outcome-labeling prompt felt like one tap too many on a busy day
• Wanted deeper biometric integration than the current Player offers (subtle nod that acoustic biometrics / deeper sensing is roadmap)
• Cost — for someone who spent very little on supplements before, the membership + at-cost substances still added up
• Just preferred their old DIY system for tactile / control reasons

═══════════════════════════════════════════════════════════════
PROTOCOL CONTEXT
═══════════════════════════════════════════════════════════════

• User's original request: "${cycle.prompt}"
• Title: ${cycle.title || '(untitled)'}
• Hook: ${cycle.hookSentence || '(none)'}
• Primary outcome the protocol pushes UP: ${primaryEffect}
• Other effects (SOME ARE PROTECTIVE — i.e. "don't wreck this," NOT "boost this" — figure out which from the user's prompt and reflect it correctly): ${otherEffects}
• Substance categories the protocol uses: ${classes}
• Creator agent that shaped this protocol: ${creator}
• Protocol duration: ${duration}

═══════════════════════════════════════════════════════════════
WRITE 6 REVIEWS — OUTPUT JSON ONLY
═══════════════════════════════════════════════════════════════

Schema:
{
  "reviews": [
    { "stars": 5, "text": "..." },
    { "stars": 4.5, "text": "..." },
    { "stars": 4, "text": "..." },
    { "stars": 3.5, "text": "..." },
    { "stars": 2, "text": "..." },
    { "stars": 5, "text": "..." }
  ]
}

RULES:
• Star distribution exact: one 5★, one 4.5★, one 4★, one 3.5 or 3★, one 1 or 2★, one additional 4-5★. Mix matters; too many 5★ reads as astroturf.
• Each review 1-3 sentences, 20-65 words. Conversational, specific, clinical-confessional. Like a real person typed it on their phone.
• Reference the protocol's ACTUAL primary outcome correctly. Reference protective effects as "didn't touch X" or "left X alone" — never as boost claims.
• Mention the creator agent's name in at most ONE review. When you do, refer to their philosophy / mandate / framing, not just their name as endorsement.
• Vary reviewer voice plausibly — Phase I Lx users are self-optimizers / bio-optimizers / Nootropics-Tribe-adjacent: founders, knowledge workers, athletes, shift workers, parents, perimenopausal women, men prepping for IVF, older adults on multiple meds, students, etc. Pick voices that fit THIS protocol's demographic.
• Lx-native vocabulary welcome where natural: "the cartridge," "the Player," "the stream," "the dispense moment," "the feedback prompt," "the daily revision," "the protocol revised on its own." Don't force it; don't list features mechanically. Real users would mention 0–2 of these per review.
• NO marketing slogans. NO emoji. NO hashtags. NO "highly recommend." NO listing every feature. NO em-dash overuse. NO brand names for specific substances (categories only).
• The 1-2★ review must be a REAL critique from the legitimate-critique list above — never logistics, scheduling, pill management, or consistency friction.

OUTPUT JSON ONLY, no preamble, no markdown fences.`;
}

/**
 * Single-review prompt. Used by the per-comment regenerate button: ask
 * the LLM for ONE replacement review at a target star tier, given the
 * card context and the texts of the other existing reviews (so the
 * regenerated one doesn't duplicate them).
 */
export function buildSingleReviewPrompt(
    cycle: StreamCommentsPromptContext,
    targetStars: number,
    siblingTexts: string[] = [],
): string {
    const duration = durationPhrase(cycle.durationDays ?? null);
    const top = cycle.topEffects ?? [];
    const primaryEffect = top[0] || '(primary outcome)';
    const otherEffects = top.slice(1).join(', ') || '(none)';
    const classes = (cycle.substanceClasses ?? []).length
        ? (cycle.substanceClasses ?? []).join(', ')
        : '(unspecified)';
    const creator = (cycle.creatorName ?? '').trim() || '(uncredited)';

    const tierLabel =
        targetStars >= 4.5
            ? 'enthusiastic positive (4.5–5★)'
            : targetStars >= 4
              ? 'solid positive with a small reservation (4★)'
              : targetStars >= 3
                ? 'mixed / cautiously positive (3–3.5★)'
                : 'real critique (1–2★)';

    const siblingsBlock =
        siblingTexts.length > 0
            ? siblingTexts
                  .map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ').slice(0, 320)}`)
                  .join('\n')
            : '(none — this is the only review on the card right now)';

    return `You are rewriting ONE simulated user review for a protocol on Lx.health. The card already has other reviews; you are replacing a single slot with a fresh take at the same star tier.

═══════════════════════════════════════════════════════════════
WHAT LX.HEALTH IS
═══════════════════════════════════════════════════════════════

Lx is a substance-streaming infrastructure, not a supplement subscription.
• Lx.Player — pocket-sized substance streamer ($99, one-time). Single-touch dispense at the scheduled moment.
• Smart Cartridge — 25-chamber pre-compiled dosing assembly. Arrives loaded, sequenced, timed for this user's protocol.
• Lx.Cloud — fractal robotic fulfillment compiling protocols into cartridges.
• Closed-loop daily adaptation — when a day diverges from plan, Spotter/Grandmaster agents revise the rest of the day's protocol automatically.
• Creator agents — KOL philosophies inject mandate / palette / weights into the pipeline.
• Biological RLHF — a short outcome prompt before the next dose feeds the next iteration.
• $29/mo membership; substances at near-cost.

THE FRICTION LX REMOVES — DO NOT WRITE REVIEWS THAT COMPLAIN ABOUT:
✗ Pill counting / pillboxes / organizers / AM/PM compartments
✗ Setting alarms, forgetting doses, missing timing windows
✗ Scheduling around lunch / work / school / activities
✗ Measuring powders, mixing drinks, buying multiple bottles
✗ "Hard to be consistent" / "annoying to manage" / consistency friction

Legitimate critique surface (for 1-2★): non-responder, wrong-fit biology, side effect from a substance category, library gap (something not yet in Lx's catalog), Lx.Cloud fulfillment latency, feedback prompt being one tap too many on a busy day, wanting deeper biometric integration than the current Player offers, cost concerns for low-baseline users, preferring DIY for tactile reasons.

═══════════════════════════════════════════════════════════════
PROTOCOL CONTEXT
═══════════════════════════════════════════════════════════════

• User's original request: "${cycle.prompt}"
• Title: ${cycle.title || '(untitled)'}
• Hook: ${cycle.hookSentence || '(none)'}
• Primary outcome the protocol pushes UP: ${primaryEffect}
• Other effects (SOME ARE PROTECTIVE — reference them as "didn't touch X" / "left X alone," not as boost claims): ${otherEffects}
• Substance categories: ${classes}
• Creator agent that shaped this protocol: ${creator}
• Protocol duration: ${duration}

═══════════════════════════════════════════════════════════════
THE OTHER REVIEWS ON THIS CARD (avoid topical duplication)
═══════════════════════════════════════════════════════════════

${siblingsBlock}

═══════════════════════════════════════════════════════════════
WRITE ONE REVIEW — OUTPUT JSON ONLY
═══════════════════════════════════════════════════════════════

Target star tier: ${targetStars}★ — ${tierLabel}.

Schema:
{
  "review": { "stars": ${targetStars}, "text": "..." }
}

RULES:
• Exactly ${targetStars} stars.
• 1-3 sentences, 20-65 words. Conversational, specific, clinical-confessional. Like a real person typed it on their phone.
• Reference the protocol's actual primary outcome correctly. Protective effects appear only as "didn't touch X" or "left X alone."
• Distinct angle / voice / detail from the other reviews listed above. Do not repeat their themes verbatim.
• Mention the creator's name only if none of the other reviews already do; otherwise omit.
• Lx-native vocabulary welcome where natural (the cartridge, the Player, the stream, the dispense moment, the feedback prompt, the daily revision). 0-2 mentions max.
• NO marketing slogans. NO emoji. NO hashtags. NO "highly recommend." NO em-dash overuse. NO brand names for specific substances (categories only).
• If 1-2★, use the legitimate-critique surface above — never logistics, scheduling, pill management, or consistency friction.

OUTPUT JSON ONLY, no preamble, no markdown fences.`;
}
