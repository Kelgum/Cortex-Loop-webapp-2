// ── Stream Comments — simulated user reviews for expanded stream cards ──
// Deterministic per cycle ID: the same stream always renders the same reviews.
// Templates reference the cycle's own substances/effects so comments read as
// authored to the protocol, not boilerplate.

import type { SavedCycleIndexEntry } from './cycle-store';
import { getAgentByHandle } from './creator-agents';
// LLM-authored reviews per cycle. The JSON file is the seed snapshot
// (50 pre-generated cards baked into the repo). At runtime the map can
// be augmented via setLLMReviewsFor() when a user generates reviews for
// a new cycle through the in-app "Generate Comments" button. The Vite
// stream-comments storage plugin persists those additions to the same
// JSON file so they survive reloads.
import LLM_COMMENT_DATA from '../stream-comments-data.json';

export interface LLMReview {
    stars: number;
    text: string;
}
const LLM_REVIEWS: Record<string, LLMReview[]> = {
    ...(LLM_COMMENT_DATA as Record<string, LLMReview[]>),
};

/** True when this cycle has LLM-authored reviews (either seeded or just generated). */
export function hasLLMComments(cycleId: string | undefined | null): boolean {
    if (!cycleId) return false;
    const reviews = LLM_REVIEWS[cycleId];
    return Array.isArray(reviews) && reviews.length > 0;
}

/**
 * Register newly-generated reviews for a cycle. Clears the per-cycle
 * memoization in _commentsCache so the next read picks up the new data.
 * Callers are expected to persist to the filesystem JSON separately via
 * the /__stream-comments/:id Vite endpoint.
 */
export function setLLMReviewsFor(cycleId: string, reviews: LLMReview[]): void {
    if (!cycleId || !Array.isArray(reviews) || reviews.length === 0) return;
    LLM_REVIEWS[cycleId] = reviews.slice();
    _commentsCache.delete(cycleId);
}

/**
 * Return a defensive copy of the raw LLM reviews (stars + text only —
 * no identity overlay) for a cycle, or null if none are cached. Used by
 * the per-comment regenerate flow so it can mutate one entry and PUT the
 * full array back.
 */
export function getLLMReviewsFor(cycleId: string | undefined | null): LLMReview[] | null {
    if (!cycleId) return null;
    const reviews = LLM_REVIEWS[cycleId];
    if (!Array.isArray(reviews) || reviews.length === 0) return null;
    return reviews.map(r => ({ stars: r.stars, text: r.text }));
}

export interface StreamComment {
    handle: string;
    displayName: string;
    stars: number;
    text: string;
    daysAgo: number;
    helpfulCount: number;
    verifiedStreamer: boolean;
}

// ── Deterministic RNG ───────────────────────────────────────────────

function fnv1a(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
    return arr[Math.floor(rand() * arr.length)];
}

function rangeInt(rand: () => number, lo: number, hi: number): number {
    return Math.floor(rand() * (hi - lo + 1)) + lo;
}

// ── Comment pools ──────────────────────────────────────────────────
//
// IMPORTANT: The GENERAL pools must never bake in claims about specific
// outcomes (sleep, energy, mood, focus, 3pm crash, kids, coworkers, etc.)
// — that contradicts cards whose target is something else entirely. They
// reference only the user's own {{effect}}/{{substance}}/{{creator}}/
// {{duration}} placeholders. Topic-specific pools below are where the
// outcome-laden phrasing lives.

// Positive tier — 4.5 to 5 stars. Specific, enthusiastic, but
// outcome-agnostic.
const POSITIVE_TEMPLATES: string[] = [
    "Honestly didn't expect much. Ran it for {{duration}} as written. The {{effect}} lift is real and the {{substance}} dose feels dialed-in, not aggressive.",
    "I've tried six different stacks targeting {{effect}}. This is the first one where I noticed the change without having to convince myself.",
    'Day 11. {{substance}} is doing exactly what the protocol says it should. No jitters, no overshoot. The {{effect}} curve tracks the description.',
    "I'm a skeptic and I'm telling you: ran this for {{duration}} and the {{effect}} change is not placebo.",
    'Switched from a much more aggressive stack to this. Less is more — {{substance}} at this timing beats everything I was doing before.',
    'Three weeks. {{substance}} feels foundational, not optional. This is the new baseline I want to build on.',
    'Followed it to the letter for {{duration}}. The {{effect}} curve they describe is exactly what I felt. Buying in for the long haul.',
    "{{creator}}'s reasoning in the protocol notes is what sold me — the {{substance}} pairing makes mechanistic sense once you read it.",
    "Was on the fence about {{substance}} but the dosing here is more sensible than what I'd seen elsewhere. Confident now.",
    '{{substance}} hit harder than I expected on day 3 and then leveled out. Exactly like the onboarding warned. Appreciate the honesty.',
    "If you've bounced off other {{effect}} protocols, the difference here is the restraint. Fewer compounds, better timing.",
    'Have been streaming this for {{duration}} and the consistency is the part that surprised me. No off days.',
    "Bought it half-expecting to refund. Three weeks later I'm renewing — the {{effect}} change is real.",
    '{{creator}} earned the credentials on this one. Every choice has a reason and the reasons hold up.',
    "What I appreciate: it doesn't try to do everything. It targets {{effect}} and gets out of the way. {{substance}} dose is conservative and that's the right call.",
    "Tracking HRV daily through {{duration}}. {{substance}} hasn't moved it in a bad direction once. Sustainable is the word.",
    "The {{effect}} change shows up on day 4 or 5 — not instant, but consistent. {{substance}} timing matters more than I'd realized.",
    'Felt the {{effect}} shift quietly. Not a slap-in-the-face change, more like the background got cleaner.',
    'Re-read the protocol three times before starting. {{creator}} thought through the edge cases — the {{substance}} sequencing has clear rationale.',
];

// Mid tier — 3 to 4 stars. Cautiously positive with real caveats.
const MID_TEMPLATES: string[] = [
    "Works, but not as dramatically as the marketing suggested. I'd call it a 15% improvement on {{effect}}, not a transformation.",
    'Decent. {{substance}} timing is the real innovation here. Wish it had more guidance for non-standard schedules.',
    'The {{substance}} works for me but I had to cut the dose in half. Sensitive responder. Protocol could use a low-dose variant.',
    "Halfway through {{duration}} and I'm getting maybe 60% of what {{creator}} promised. Not bad — just not magic.",
    'I like the framework, the {{effect}} gains are real, but the {{substance}} stocking is expensive. Three stars for value.',
    'Honest review: works on weekdays, falls apart on weekends when my schedule shifts. {{substance}} timing is fragile.',
    'Good baseline protocol. The {{effect}} change is there but subtle. Probably better for people starting from scratch than for tinkerers like me.',
    "Solid {{effect}} lift but {{substance}} hits me harder than expected — had to drop the second dose. Still glad I'm running it.",
];

// Critical tier — 1 to 2 stars. Real critique, no specific-outcome
// boilerplate that conflicts with the card's target.
const CRITICAL_TEMPLATES: string[] = [
    "Didn't notice anything on the {{effect}} side after three weeks. {{substance}} gave me a stomach ache. Maybe my biology, but not for me.",
    "I think this one assumes a level of baseline health I don't have. The {{substance}} dose felt aggressive from day 1.",
    "Burned through the {{substance}} budget for {{duration}} and nothing happened. The {{effect}} claim didn't hold up for me. Refunding.",
    'Got a headache by day 4 every single time on the {{substance}}. Tried two restarts. Done.',
    'Was hoping for the {{effect}} change everyone raves about. Just felt off and irritable. Different bodies, different results I guess.',
    '{{substance}} stacked badly with my existing medication. Protocol should warn more loudly about interactions.',
    "I followed it precisely. Nothing happened. Maybe I'm a non-responder to {{substance}}. Either way, not what I signed up for.",
    "Felt great for week one then it stopped working. {{substance}} tolerance built up fast for me. Wouldn't recommend without a cycling plan.",
];

// ── Topic-specific pools ───────────────────────────────────────────
// Each topic has its own positive/mid/critical pool. Templates here can
// reference the topic's domain (sleep architecture, cognitive load,
// menopausal symptoms, etc.) because the detector only routes the right
// cards to the right pool.

// — COGNITIVE: focus, memory, alertness, attention, cognition, ADHD
const COGNITIVE_POSITIVE_TEMPLATES: string[] = [
    "Two weeks in and the {{effect}} window is genuinely longer. {{substance}} timing alone fixed my mid-afternoon fade — first protocol that actually held attention past lunch.",
    'Run cognitive tests on myself weekly. Measurable lift on the {{effect}} side after day 9. Real numbers, not vibes.',
    "Found this after burning out on harsh stims. The {{substance}} + timing combo is gentler and somehow gets me further into deep work.",
    'Day 6 of {{duration}}. {{effect}} is more sustained — fewer context-switches, fewer tabs open. The cognitive cleanup is real.',
    "Knowledge worker, screen all day. The {{substance}} dosing kept {{effect}} steady through back-to-back meetings without the jittery overshoot stims usually give me.",
    "Was skeptical of any 'cognitive enhancer' framing but {{creator}} nailed it — {{effect}} feels earned, not borrowed. No rebound either.",
    'My focus blocks used to be 45 minutes. After {{duration}} on this, 90+ minute deep work sessions are routine. {{substance}} is doing real work.',
    "Studied for finals on this. The {{effect}} edge was modest but the lack of crash at the end of the day is what won me over.",
];

const COGNITIVE_MID_TEMPLATES: string[] = [
    'The {{effect}} improvement is real but smaller than I expected. {{substance}} works fine in the morning, less so after 3pm.',
    'Solid for focus but I had to skip the second {{substance}} dose — felt over-stimulated by mid-afternoon. Protocol works for steadier baselines than mine.',
    "Decent {{effect}} lift on heavy work days, barely noticeable on light ones. Maybe that's the right behavior, but I'd hoped for more punch.",
];

const COGNITIVE_CRITICAL_TEMPLATES: string[] = [
    'Was hoping for a step change in {{effect}}. Got jittery and unfocused instead. {{substance}} may not pair well with my baseline coffee intake.',
    "I followed it precisely for {{duration}}. No measurable {{effect}} change on the tasks I actually care about. Maybe I'm a non-responder.",
    "{{substance}} made me wired but not productive. Stared at the same paragraph for an hour. Opposite of what was advertised.",
];

// — SLEEP: sleep, REM, deep-sleep, sleep onset, architecture, continuity
const SLEEP_POSITIVE_TEMPLATES: string[] = [
    "Wearable confirms it: deep sleep is up roughly 18% across {{duration}} on this protocol. {{substance}} timing is the lever.",
    'First thing in {{duration}} that actually moved my REM. Wake up groggy-free, dreaming again, the works.',
    "Used to wake at 3am like clockwork. {{substance}} at this dose finally broke that cycle — straight through to morning more nights than not.",
    "Tried magnesium, tried melatonin, tried glycine. This {{substance}} combo is the first that improved {{effect}} without the next-day fog.",
    "The architecture matters more than the duration — {{creator}} gets that. After {{duration}}, deep sleep blocks are denser, not just longer.",
    'Sleep onset down to under 12 minutes. {{substance}} timing relative to bedtime is the key, and the protocol gets it right.',
    "Eight nights tracked. Average HRV up, resting heart rate down, {{effect}} score up. {{substance}} is doing the work.",
    "Was a chronic 5-hour-sleeper. {{duration}} in and I'm sleeping 7 most nights — the {{substance}} doesn't sedate, it just lets sleep happen.",
];

const SLEEP_MID_TEMPLATES: string[] = [
    "Sleep onset is faster, REM is up, but I'm waking once around 4am still. Net positive — just hoping the next iteration nails the second half of the night.",
    'Works on stress-free nights, less reliable on high-cortisol ones. {{substance}} alone clearly isn\'t enough when the day has been wild.',
    "Wearable says deep sleep is up. Subjective feel says about the same. Decent, not transformative.",
];

const SLEEP_CRITICAL_TEMPLATES: string[] = [
    "Slept the same or worse for {{duration}}. {{substance}} gave me vivid dreams that left me more tired, not less. Stopped after day 9.",
    'Sleep onset got worse, not better. Felt wired at bedtime on the {{substance}}. Wrong protocol for my biology.',
    "Was hoping the {{effect}} numbers would move. Wearable didn't budge. Refunding.",
];

// — CALM: calm, anxiety, GABA, de-arousal, presence, stress, resilience
const CALM_POSITIVE_TEMPLATES: string[] = [
    "Anxiety baseline dropped noticeably by week two. {{substance}} doesn't sedate — it just lifts the noise floor.",
    'High-pressure job. Used to grind my jaw all night. {{substance}} at this timing made the {{effect}} state actually accessible during the day.',
    "Family said I seemed less wound up by the second week. Whatever {{creator}} is doing with the {{substance}} sequencing, it's working.",
    "The {{effect}} part shows up without making me dull — that's the trick most stress protocols miss. {{substance}} is gentle but real.",
    'Had a panic-prone month. {{substance}} took the edge off enough that I could actually use my coping tools. Foundational, not a band-aid.',
    "Read {{creator}}'s notes twice. The {{substance}} pairing for {{effect}} makes sense and the result lines up — calmer without flat.",
    "{{effect}} on demand is the dream. After {{duration}}, it's not on demand, but the baseline is lower and that's most of the battle.",
    'Public-facing role. Used to dread Mondays. {{substance}} timing keeps me even, and the {{effect}} part is what makes hard conversations easier.',
];

const CALM_MID_TEMPLATES: string[] = [
    "Calmer, yes. But on high-stress days I'm still pretty reactive. {{substance}} helps but I needed therapy in parallel.",
    'Solid {{effect}} on light weeks. Less effective when life gets noisy. Protocol probably needs a high-stress variant.',
    "{{substance}} pushed me slightly past calm into low motivation a few afternoons. Tweaked the timing and it's better. Three stars while I tune it.",
];

const CALM_CRITICAL_TEMPLATES: string[] = [
    "{{substance}} flattened me. {{effect}} achieved, but at the cost of caring about anything. Not the trade I wanted.",
    'Anxiety got worse before any reduction. {{substance}} interacted with my baseline stress in ways the protocol did not anticipate.',
    "Was hoping {{creator}} had cracked the anxiety puzzle. Felt nothing for {{duration}}, then got headaches. Not it.",
];

// — INTIMACY: libido, arousal, sexual, desire
const INTIMACY_POSITIVE_TEMPLATES: string[] = [
    'Evenings finally feel like evenings again. The {{substance}} timing makes the {{effect}} part show up without forcing it — that nuance matters at my age.',
    "I'm in my 40s and was ready to chalk this up to hormones. {{duration}} on this protocol and my {{effect}} is genuinely back. Partner noticed before I did.",
    'What I appreciate: nothing about this feels like an erection-pill marketing line. It treats {{effect}} like a slow signal you rebuild, not a switch you flip.',
    "Three weeks in. The {{substance}} doesn't rush anything — it just clears the static. I feel more present, which is most of the work.",
    "{{creator}}'s read on hormonal context is what made me trust this. The {{effect}} lift is real but the bigger win is feeling less defended in my own body.",
    'Postpartum, late 30s, was sure this part of me was gone. The {{substance}} brought {{effect}} back gently over {{duration}}.',
    'Was skeptical of the evening framing but it changes everything — {{substance}} at the right hour means I actually want to be close instead of just managing the day.',
    'Stress was eating my {{effect}}. The {{substance}} took the edge off without numbing me out. Subtle, sustainable, real.',
];

const INTIMACY_MID_TEMPLATES: string[] = [
    "Decent. The {{effect}} change is there but it's mood-dependent for me — works on calm weeks, less on stressful ones.",
    "Solid baseline for {{effect}} but I needed to add my own wind-down ritual on top. {{substance}} alone wasn't enough.",
    "Halfway through {{duration}} and I'd say I'm 60% of where {{creator}} promised. Probably my own stress baseline, not the protocol.",
];

const INTIMACY_CRITICAL_TEMPLATES: string[] = [
    "Didn't move the needle on {{effect}} for me. Suspect this works better for people whose issue is purely hormonal — mine is more relational.",
    "{{substance}} gave me weird dreams and didn't touch {{effect}}. Probably the wrong protocol for my biology.",
    "Felt nothing after {{duration}}. Disappointing because the framing around {{effect}} was the first one that felt honest.",
];

// — METABOLIC: glucose, insulin, metabolism, stamina, energy when paired
//   with metabolic effects, appetite/weight as adjacent territory.
const METABOLIC_POSITIVE_TEMPLATES: string[] = [
    "CGM trace flattened by week two. {{substance}} timing relative to meals is the lever — post-meal {{effect}} curve is barely a bump now.",
    "Lost 6 lbs over {{duration}} without trying. {{substance}} dosing kept hunger steady — the {{effect}} side fixed itself.",
    'Glucose variability dropped from 22 to 14 mg/dL. {{substance}} is doing exactly what {{creator}} claimed in the notes.',
    "Stamina at the end of long workouts is noticeably better on the {{substance}}. {{effect}} part holds through hour two.",
    "Pre-diabetic numbers, doctor flagged me. After {{duration}} on this, fasting {{effect}} is back in range. Real results.",
    'No more 3pm crash. {{substance}} timing right after lunch keeps me even — the metabolic case is real.',
    'Down a belt notch in {{duration}}. {{substance}} curbed grazing without killing appetite at meals. Right ratio.',
];

const METABOLIC_MID_TEMPLATES: string[] = [
    "Glucose curves are flatter but the effect plateaus around week three. {{substance}} dose may need to escalate gently.",
    'Decent metabolic shift but I have to be strict on diet for it to show. {{substance}} alone won\'t outrun bad meals.',
    "Appetite control is solid; stamina lift is more modest than I'd hoped. Net positive, just less dramatic than the framing suggests.",
];

const METABOLIC_CRITICAL_TEMPLATES: string[] = [
    'No change in my CGM trace over {{duration}}. {{substance}} did nothing measurable for {{effect}}. Numbers don\'t lie.',
    'Felt more hungry, not less, on the {{substance}}. Wrong protocol for whatever my hormonal baseline is doing.',
    "Weight didn't move. {{effect}} didn't move. Spent the money, kept the problem.",
];

// — HORMONAL_WOMEN: menopause, perimenopause, hormonal, hot flashes,
//   menstrual, vasomotor, lactation, postpartum. Templates aim to fit
//   the range of female hormonal stages without being menopause-only.
const HORMONAL_WOMEN_POSITIVE_TEMPLATES: string[] = [
    "{{creator}}'s framing for women in this stage of life is the first one that didn't talk down to me. The protocol works because the model is right.",
    'Cycle finally tracked predictably for the first time in two years. {{substance}} dose is gentle, the {{effect}} restoration is steady.',
    "{{duration}} on this and my body feels like mine again. The {{effect}} part is what I missed most. {{creator}} understands this phase.",
    "PMS week used to wreck me. {{substance}} smooths the {{effect}} curve across the cycle so the peak isn't a cliff.",
    "Doctor was conservative about HRT. This {{substance}} protocol gave me {{effect}} relief I'd given up on.",
    "Postpartum at 7 months. {{effect}} was flat for a long time. The {{substance}} brought me back gently, no feeding interactions.",
    "Hot flashes down from 6+ a day to maybe 1. {{substance}} timing was the missing piece — HRT alone wasn't cutting it.",
    'Night sweats stopped by week three. Sleeping in pajamas again. {{substance}} is gentle, no estrogen guesswork required.',
    "What I appreciate: it actually accounts for cycle phase. Most protocols treat women like static systems. {{creator}} doesn't.",
    "The {{effect}} shift across {{duration}} is the most lined-up I've felt with my body in years. {{substance}} is steady, not aggressive.",
];

const HORMONAL_WOMEN_MID_TEMPLATES: string[] = [
    'Symptoms reduced, not gone. {{substance}} dosing helps but the worst weeks still happen. Mostly happy.',
    "Cycle is more predictable but ovulation week is still rough. Protocol could use a mid-cycle variant. Solid otherwise.",
    "Halfway through {{duration}}. The {{effect}} part is improving but slower than {{creator}} suggested. Hopeful.",
    "{{substance}} is helping but the second half of my cycle is still harder. Need to keep tuning.",
];

const HORMONAL_WOMEN_CRITICAL_TEMPLATES: string[] = [
    "Tried {{duration}} of the protocol. Symptoms unchanged. {{substance}} didn't touch the {{effect}} side at all.",
    'Felt bloated and irritable on the {{substance}}. Stopped after a week. Wrong fit for my hormonal baseline.',
    "Hoped this would help me avoid HRT. It didn't. {{effect}} relief was minimal. Back to my doctor.",
];

// — WITHDRAWAL: quit smoking/vaping/caffeine/alcohol, taper SSRIs
const WITHDRAWAL_POSITIVE_TEMPLATES: string[] = [
    "Quit nicotine three times before this. {{substance}} timing kept the cravings at bay long enough for the {{effect}} part to actually fade.",
    'Tapering Sertraline. {{substance}} smoothed the rebound — no zaps, no rage. {{creator}} thought through the brain chemistry properly.',
    'Off caffeine entirely in {{duration}}. The {{substance}} step-down replaced the ritual; the {{effect}} headache never showed up.',
    "Cut alcohol from daily to twice a week. {{substance}} took the edge off the {{effect}} that used to drive me to pour at 7pm.",
    "Quitting was the goal, sanity was the bonus. {{substance}} kept my mood even through the worst week.",
    "{{creator}}'s framing of withdrawal as a curve, not a wall, changed how I approached it. {{substance}} is the scaffolding.",
    'Vaped daily for six years. {{duration}} in and the cravings are intermittent, not constant. {{substance}} timing matters a lot here.',
];

const WITHDRAWAL_MID_TEMPLATES: string[] = [
    'Cravings are down but not gone. {{substance}} helps in the morning, less so in the evening when habits are strongest.',
    'Tapering is going. Weeks 1-2 were rough despite the {{substance}}. Things stabilized by week 3. Mixed but useful.',
    "Halfway through and I'm holding the line. {{substance}} isn't magic but it's the difference between trying and succeeding.",
];

const WITHDRAWAL_CRITICAL_TEMPLATES: string[] = [
    "Relapsed in week two. {{substance}} didn't blunt the cravings enough for me. Probably need a more aggressive protocol.",
    "{{substance}} gave me nausea on top of withdrawal symptoms — opposite of helpful. Stopped after day 6.",
    "Was hoping {{creator}}'s approach would be the difference. It wasn't. Withdrawal {{effect}} was as bad as past attempts.",
];

// — EXPERIENCE: psychedelic, sensory, immersion, creativity, microdose,
//   visual/auditory perception, neuroplasticity for experience
const EXPERIENCE_POSITIVE_TEMPLATES: string[] = [
    "Listened to the album twice through on this stack. The {{effect}} layering was unreal — heard parts of the mix I'd missed for years.",
    'Microdose week paired with the {{substance}} timing here — {{effect}} at work was sharp, not weird. Best creative output in months.',
    'The trek was transcendent. {{substance}} dosing was tuned exactly right — peak {{effect}} hit at the ridge, came down gently for the descent.',
    "{{creator}}'s framing of {{effect}} as something to design around, not chase, is the right model. Best psychedelic experience I've had.",
    'Movie hit different on this. {{substance}} sequencing made the {{effect}} part bloom at the right moments — the score has dimensions.',
    'Set, setting, and substance. {{creator}} treats all three seriously. The {{effect}} part of the protocol unlocked the room.',
    'Creative block dissolved in {{duration}}. The {{substance}} microdose plus the {{effect}} framing is a real tool for knowledge work.',
];

const EXPERIENCE_MID_TEMPLATES: string[] = [
    "Good not great. {{effect}} was present but didn't peak when I expected. Probably my own anxiety getting in the way.",
    'The {{substance}} timing was off for my body — peak came late. Re-running with adjusted timing next time.',
    "Decent {{effect}} window but the comedown was longer than {{creator}} described. {{substance}} maybe a touch high for me.",
];

const EXPERIENCE_CRITICAL_TEMPLATES: string[] = [
    'Anxious through the whole thing. {{substance}} dosing was too aggressive for my baseline. Wished the protocol asked more about prior experience.',
    "{{effect}} never really arrived. Maybe a non-responder, maybe the set was wrong. Either way, a long night for nothing.",
    "Got nauseous, didn't get the {{effect}} payoff. Wrong substance for my biology.",
];

// — SKIN: elasticity, collagen, sebum, acne, dermal recovery
const SKIN_POSITIVE_TEMPLATES: string[] = [
    "Skin is visibly clearer at week four. {{substance}} is gentle and the {{effect}} side responded — first thing that didn't dry me out.",
    "Lost weight, my skin looked the part. {{duration}} on this and {{effect}} is genuinely better — pictures don't lie.",
    'Three months of acne progress in three weeks. {{substance}} approach is gentler than any retinoid I tried.',
    "Texture, tone, the works — by week three friends started asking what changed. {{substance}} is the lever, the {{effect}} numbers back it up.",
    "Inflammation came down before the texture did. {{substance}} clearly addresses the upstream cause, not just the symptom.",
    "Was on tretinoin for years. Switched to this for {{duration}} and the {{effect}} held without the peeling.",
    "Sebum production calmed within two weeks. {{substance}} dose is conservative — exactly what {{creator}}'s notes promised.",
];

const SKIN_MID_TEMPLATES: string[] = [
    'Skin is somewhat better. {{substance}} works on hormonal breakouts more than cystic ones. Wish it were broader.',
    "Some {{effect}} improvement, slower than I'd hoped. May take longer than {{duration}} to fully show.",
    'Texture is improving but cystic breakouts still come during my cycle. {{substance}} helps but isn\'t the whole answer.',
];

const SKIN_CRITICAL_TEMPLATES: string[] = [
    "Broke out worse on the {{substance}} in the first two weeks. Stopped. Wrong protocol for my skin type.",
    "Hoped this would replace what my dermatologist recommended. It didn't. {{effect}} was unimproved.",
    "No visible change in {{effect}} after {{duration}}. {{substance}} did nothing measurable for my skin.",
];

// — LONGEVITY: B12, blood pressure, coagulation, vascular, cardio,
//   homeostasis, chronobiology — aging / labs-driven protocols.
const LONGEVITY_POSITIVE_TEMPLATES: string[] = [
    'BP is stable in range. {{substance}} timing alongside my meds, no interactions. {{creator}} clearly knows the older population.',
    'Vegetarian, B12 was low. Numbers normalized in {{duration}} and the {{effect}} side picked up correspondingly. Bloodwork backs it.',
    'Inflammation markers down on bloodwork after {{duration}}. {{substance}} is doing real work, not vibes.',
    'Joints feel better. {{effect}} numbers improved on labs. {{substance}} is the kind of protocol I want to age on.',
    "{{creator}} treats labs as the source of truth, not vibes. {{effect}} numbers moved in the right direction over {{duration}}.",
    "Cardiologist asked what I'd changed. {{substance}} dosing fits cleanly alongside my existing medications.",
    "Resting HR down 6 beats. {{effect}} markers improved. The {{substance}} schedule is sustainable at my age.",
    "Fasting numbers are back where they were in my 40s. {{substance}} consistency over {{duration}} did it.",
];

const LONGEVITY_MID_TEMPLATES: string[] = [
    "Bloodwork moved a bit. {{substance}} probably needs more time than {{duration}} to fully show.",
    "Numbers are trending in the right direction but slowly. {{substance}} may need a higher dose for my body weight.",
    "{{effect}} improvement is real but modest. Worth running it longer before drawing conclusions.",
];

const LONGEVITY_CRITICAL_TEMPLATES: string[] = [
    "No measurable change in {{effect}} after {{duration}}. {{substance}} did nothing for me. Bloodwork unchanged.",
    "Felt dizzy on the {{substance}} — possibly a BP interaction. Stopped. Protocol should warn more loudly.",
    "Hoped this would let me reduce one of my prescriptions. It didn't move the needle enough to discuss with my doctor.",
];

// — PERFORMANCE: keynote, negotiation, combat/flight, jetlag, high-stakes
//   moments where the goal is peak state at a specific time.
const PERFORMANCE_POSITIVE_TEMPLATES: string[] = [
    "Closed the deal. {{substance}} timing put me at peak {{effect}} exactly when I walked into the room. {{creator}} engineered this perfectly.",
    'Keynote landed. The {{effect}} part held for the full 45 minutes without the jittery edge I usually fight on stage.',
    'Red-eye landed at 6am, presented at 11. {{substance}} reset my circadian enough that {{effect}} was actually accessible. Saved the trip.',
    "Negotiation went 3 hours. {{substance}} pacing held my {{effect}} the whole time — no fade, no overshoot.",
    'The flight was textbook. Peak {{effect}} at the right minute, smooth comedown afterward. {{substance}} timing is exactly as advertised.',
    "{{creator}} clearly designs for the moment, not just the day. {{substance}} window matched my schedule to the hour.",
];

const PERFORMANCE_MID_TEMPLATES: string[] = [
    "Peak hit a little early — {{effect}} was great in the lobby, slightly fading by the close. {{substance}} timing needs tightening for me.",
    "Solid performance day. {{effect}} was there but not transcendent. {{substance}} did its job — I just wanted more headroom.",
    "Got through the event clean. The {{substance}} comedown afterward was bigger than {{creator}} described. Three stars while I tune it.",
];

const PERFORMANCE_CRITICAL_TEMPLATES: string[] = [
    "Bombed the moment. {{substance}} made me too wired and {{effect}} read as anxiety, not confidence. Wrong calibration for me.",
    'Crashed mid-presentation. {{substance}} peak was 90 minutes too early. Protocol should account for prep nerves shifting the curve.',
    "Couldn't sleep the night before because of the prep dose. Started behind, finished worse. {{effect}} part never arrived.",
];

// — DIGESTIVE: GLP-1 side effects, nausea, gastric
const DIGESTIVE_POSITIVE_TEMPLATES: string[] = [
    'GLP-1 nausea was making me miserable. {{substance}} timing cut it by 80% within a week. {{creator}} understands the mechanism.',
    'Stomach finally tolerated meals again. {{substance}} is gentle, the {{effect}} side cleared without compromising the GLP-1 benefit.',
    "{{duration}} in and I haven't skipped a dose because of side effects. {{substance}} is the buffer I needed.",
    'Hydration plus the {{substance}} fixed my gastric issues. {{effect}} curve is back to baseline.',
    "Was about to quit the GLP-1. {{substance}} kept me on it. {{effect}} improvement is meaningful.",
];

const DIGESTIVE_MID_TEMPLATES: string[] = [
    "Some relief on {{effect}}. Worst days are still rough but tolerable. {{substance}} helps more than nothing.",
    'Nausea improved on the {{substance}}, but reflux showed up. Protocol could address the trade-off.',
    "Halfway through {{duration}}. {{effect}} is better in the morning, worse after dinner. Tuning timing.",
];

const DIGESTIVE_CRITICAL_TEMPLATES: string[] = [
    'Nausea got worse on the {{substance}}. Opposite of what I needed.',
    "{{substance}} didn't touch the GLP-1 side effects for me. Spent {{duration}} feeling the same.",
    "Cramps after every dose. {{effect}} unchanged. Wrong protocol for my gut.",
];

// ── Author personas ────────────────────────────────────────────────

const AUTHORS: { handle: string; name: string }[] = [
    { handle: '@biohack_kev', name: 'Kevin R.' },
    { handle: '@deepworkdaily', name: 'Mira S.' },
    { handle: '@founder_grind', name: 'Daniel P.' },
    { handle: '@grad_brain', name: 'Aisha K.' },
    { handle: '@nightshift_nurse', name: 'Holly T.' },
    { handle: '@trail_runner_42', name: 'Jordan W.' },
    { handle: '@morning_pages', name: 'Lila C.' },
    { handle: '@pm_chaos', name: 'Reza A.' },
    { handle: '@founder_mom', name: 'Sophie L.' },
    { handle: '@late_blooming_lifter', name: 'Marcus E.' },
    { handle: '@quietquant', name: 'Henry V.' },
    { handle: '@cellosolo', name: 'Priya N.' },
    { handle: '@cold_plunge_cody', name: 'Cody B.' },
    { handle: '@second_brain_2k', name: 'Theo M.' },
    { handle: '@sleeptracker_sam', name: 'Sam D.' },
    { handle: '@uxresearcher_eve', name: 'Evelyn H.' },
    { handle: '@dad_of_three', name: 'Ben K.' },
    { handle: '@phd_caffeinated', name: 'Yuki O.' },
    { handle: '@trial_and_error', name: 'Nina F.' },
    { handle: '@ten_year_athlete', name: 'Marco S.' },
    { handle: '@startup_cto', name: 'Anand J.' },
    { handle: '@ultraendurance', name: 'Greta P.' },
    { handle: '@medstudent_maya', name: 'Maya R.' },
    { handle: '@swim_at_5', name: 'Ines G.' },
    { handle: '@productivity_pete', name: 'Pete H.' },
    { handle: '@calm_engineer', name: 'Vikram T.' },
    { handle: '@returning_to_form', name: 'Ola B.' },
    { handle: '@nightowl_nora', name: 'Nora F.' },
    { handle: '@first_responder', name: 'Eli M.' },
    { handle: '@writes_in_cafes', name: 'Camille D.' },
    { handle: '@40s_and_focused', name: 'Tom W.' },
    { handle: '@designer_din', name: 'Dina Q.' },
    { handle: '@grass_fed_guy', name: 'Brett J.' },
    { handle: '@trauma_recovery', name: 'Lou A.' },
    { handle: '@athlete_in_remission', name: 'Sara L.' },
    { handle: '@two_kids_one_dog', name: 'Will C.' },
    { handle: '@early_career_neuro', name: 'Hana Z.' },
    { handle: '@silicon_burnout', name: 'Naomi I.' },
    { handle: '@second_career_dev', name: 'Frank O.' },
    { handle: '@coffee_then_sun', name: 'Iris B.' },
];

// ── Fallbacks for placeholders ─────────────────────────────────────

const FALLBACK_SUBSTANCES = ['the stack', 'the morning dose', 'the protocol', 'the combo'];
const FALLBACK_EFFECTS = ['focus', 'energy', 'recovery', 'sleep quality'];
const FALLBACK_CREATORS = ['the creator', 'this team', 'whoever designed this'];

// ── Star distribution ──────────────────────────────────────────────
// Quotas: ensure realistic spread including critical reviews so the
// section feels honest rather than astroturfed.

interface StarSlot {
    tier: 'positive' | 'mid' | 'critical';
    stars: number;
}

function buildStarPlan(rand: () => number, count: number): StarSlot[] {
    const slots: StarSlot[] = [];
    // Guaranteed shape for a 5-slot baseline:
    //   1 × 5★, 2 × (4–5★), 1 × (3–4★), 1 × (1–2★)
    slots.push({ tier: 'positive', stars: 5 });
    slots.push({ tier: 'positive', stars: rand() < 0.5 ? 5 : 4.5 });
    slots.push({ tier: 'positive', stars: rand() < 0.65 ? 4.5 : 4 });
    slots.push({ tier: 'mid', stars: rand() < 0.55 ? 3.5 : 3 });
    slots.push({ tier: 'critical', stars: rand() < 0.55 ? 2 : 1 });

    // Remaining slots skew positive but allow occasional mid.
    while (slots.length < count) {
        const r = rand();
        if (r < 0.65) {
            slots.push({ tier: 'positive', stars: rand() < 0.45 ? 5 : 4.5 });
        } else if (r < 0.9) {
            slots.push({ tier: 'positive', stars: 4 });
        } else {
            slots.push({ tier: 'mid', stars: rand() < 0.5 ? 3.5 : 3 });
        }
    }

    // Shuffle slot order so the layout doesn't always lead with 5★.
    for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    return slots;
}

type Topic =
    | 'intimacy'
    | 'hormonal_women'
    | 'withdrawal'
    | 'experience'
    | 'performance'
    | 'cognitive'
    | 'sleep'
    | 'calm'
    | 'metabolic'
    | 'digestive'
    | 'skin'
    | 'longevity'
    | 'general';

// Priority-ordered detector. Specificity matters — e.g. a menopause card
// also touches sleep/calm, but hormonal_women is the better fit so it
// wins. Each topic has its own regex; first match wins.
function detectTopic(effects: string[], substanceClasses: string[], prompt: string): Topic {
    const fxHay = effects.join(' ').toLowerCase();
    const pHay = prompt.toLowerCase();
    // `all` includes substance classes — useful for topics where the
    // class is a strong signal (Metabolic, Cardiovascular, Nootropic).
    // `effPrompt` excludes classes — used for topics where classes
    // mislead (e.g. a calm protocol that uses a Psychedelic-class
    // anxiolytic is not an "experience" card).
    const effPrompt = (fxHay + ' ' + pHay).trim();
    const all = (effPrompt + ' ' + substanceClasses.join(' ').toLowerCase()).trim();

    // Order matters: most specific first.
    // Intimacy uses a negative lookbehind so "de-arousal" (the opposite
    // of arousal — used on calm/presence cards) doesn't trigger it.
    // "androgen" is intentionally absent because it appears on skin/acne
    // cards too; sperm-specific keywords still route fertility cards here.
    if (
        /\b(libido|sexual|intimacy|erotic|desire|spermatogenesis|sperm)\b|(?<![-a-z])arousal\b/.test(
            all,
        )
    ) {
        return 'intimacy';
    }
    if (
        /\b(menopause|perimenopause|menopausal|vasomotor|estrogen|menstrual|hormonal|hot flash|lactation|postpartum|breastfeed)\b/.test(
            all,
        )
    ) {
        return 'hormonal_women';
    }
    if (
        /\b(withdrawal|craving|nicotine|vape|vaping|smoking|quit|taper|sertraline|ssri|alcohol|caffeine)\b/.test(
            all,
        )
    ) {
        return 'withdrawal';
    }
    // Digestive BEFORE experience — GLP-1 anti-nausea protocols sometimes
    // use Psychedelic/Atypical-class substances (e.g. ondansetron-style),
    // so substanceClasses alone can mislead. Effect/prompt keywords decide.
    if (/\b(glp-?1|nausea|gastric|reflux|hydration)\b/.test(all)) {
        return 'digestive';
    }
    // Experience uses effects+prompt only — a Psychedelic-class
    // anxiolytic on a calm/presence protocol shouldn't trigger this.
    if (
        /\b(psychedelic|microdose|immersion|immersive|sensory|visual perception|auditory|trip|trek|tesseract|creativity|creative|neuroplastic)\b/.test(
            effPrompt,
        )
    ) {
        return 'experience';
    }
    if (
        /\b(keynote|negotiation|combat|fighter pilot|red-?eye|jetlag|jet lag|presentation|on stage|board meeting|deal|charisma)\b/.test(
            all,
        )
    ) {
        return 'performance';
    }
    // Skin BEFORE metabolic — "after losing 30 pounds" can mislead.
    if (/\b(skin|elasticity|collagen|sebum|acne)\b/.test(all)) {
        return 'skin';
    }
    // Longevity for bloodwork/aging-driven protocols. Kept distinct
    // from skin so cardio cards don't pull dermatology language.
    if (
        /\b(b12|blood pressure|coagulation|vascular|cardio|longevity|homeostasis|chronobiology)\b/.test(
            all,
        )
    ) {
        return 'longevity';
    }
    if (/\b(glucose|insulin|metabolism|metabolic|glycemia|glycogen|stamina|satiety|appetite|weight|10kg|15 pounds|lose .* (?:kg|lbs|pounds))\b/.test(all)) {
        return 'metabolic';
    }
    if (
        /\b(focus|memory|alertness|attention|cognition|cognitive|adhd|deep work|mental focus|concentration|consolidation)\b/.test(
            all,
        )
    ) {
        return 'cognitive';
    }
    if (
        /\b(sleep|rem|deep-?sleep|architecture|onset|continuity|adenosine|grogginess|wakefulness|circadian|chronobiology|sleep pressure)\b/.test(
            all,
        )
    ) {
        return 'sleep';
    }
    if (
        /\b(anxiety|calm|relaxation|de-?arousal|presence|stress|resilience|gabaergic|gaba|mood|stability|impulse|emotional|serotonin|panic)\b/.test(
            all,
        )
    ) {
        return 'calm';
    }
    return 'general';
}

interface TopicPools {
    positive: readonly string[];
    mid: readonly string[];
    critical: readonly string[];
}

const TOPIC_POOLS: Record<Exclude<Topic, 'general'>, TopicPools> = {
    intimacy: {
        positive: INTIMACY_POSITIVE_TEMPLATES,
        mid: INTIMACY_MID_TEMPLATES,
        critical: INTIMACY_CRITICAL_TEMPLATES,
    },
    hormonal_women: {
        positive: HORMONAL_WOMEN_POSITIVE_TEMPLATES,
        mid: HORMONAL_WOMEN_MID_TEMPLATES,
        critical: HORMONAL_WOMEN_CRITICAL_TEMPLATES,
    },
    withdrawal: {
        positive: WITHDRAWAL_POSITIVE_TEMPLATES,
        mid: WITHDRAWAL_MID_TEMPLATES,
        critical: WITHDRAWAL_CRITICAL_TEMPLATES,
    },
    experience: {
        positive: EXPERIENCE_POSITIVE_TEMPLATES,
        mid: EXPERIENCE_MID_TEMPLATES,
        critical: EXPERIENCE_CRITICAL_TEMPLATES,
    },
    performance: {
        positive: PERFORMANCE_POSITIVE_TEMPLATES,
        mid: PERFORMANCE_MID_TEMPLATES,
        critical: PERFORMANCE_CRITICAL_TEMPLATES,
    },
    cognitive: {
        positive: COGNITIVE_POSITIVE_TEMPLATES,
        mid: COGNITIVE_MID_TEMPLATES,
        critical: COGNITIVE_CRITICAL_TEMPLATES,
    },
    sleep: {
        positive: SLEEP_POSITIVE_TEMPLATES,
        mid: SLEEP_MID_TEMPLATES,
        critical: SLEEP_CRITICAL_TEMPLATES,
    },
    calm: {
        positive: CALM_POSITIVE_TEMPLATES,
        mid: CALM_MID_TEMPLATES,
        critical: CALM_CRITICAL_TEMPLATES,
    },
    metabolic: {
        positive: METABOLIC_POSITIVE_TEMPLATES,
        mid: METABOLIC_MID_TEMPLATES,
        critical: METABOLIC_CRITICAL_TEMPLATES,
    },
    digestive: {
        positive: DIGESTIVE_POSITIVE_TEMPLATES,
        mid: DIGESTIVE_MID_TEMPLATES,
        critical: DIGESTIVE_CRITICAL_TEMPLATES,
    },
    skin: {
        positive: SKIN_POSITIVE_TEMPLATES,
        mid: SKIN_MID_TEMPLATES,
        critical: SKIN_CRITICAL_TEMPLATES,
    },
    longevity: {
        positive: LONGEVITY_POSITIVE_TEMPLATES,
        mid: LONGEVITY_MID_TEMPLATES,
        critical: LONGEVITY_CRITICAL_TEMPLATES,
    },
};

function poolForTier(tier: StarSlot['tier'], topic: Topic, rand: () => number): readonly string[] {
    // Bias topic-specific cards heavily toward topic templates (~85%) so
    // comments stay pertinent. The remaining 15% can pull from the
    // outcome-agnostic general pool — those templates only reference the
    // user's own effect/substance/duration so they're safe on any card.
    if (topic !== 'general' && rand() < 0.85) {
        const pools = TOPIC_POOLS[topic];
        if (tier === 'critical') return pools.critical;
        if (tier === 'mid') return pools.mid;
        return pools.positive;
    }
    if (tier === 'critical') return CRITICAL_TEMPLATES;
    if (tier === 'mid') return MID_TEMPLATES;
    return POSITIVE_TEMPLATES;
}

// ── Template fill ──────────────────────────────────────────────────

function fillTemplate(
    template: string,
    rand: () => number,
    ctx: { substances: string[]; effects: string[]; creator: string; duration: string },
): string {
    const filled = template
        .replace(/\{\{substance\}\}/g, () => pick(rand, ctx.substances))
        .replace(/\{\{effect\}\}/g, () => pick(rand, ctx.effects))
        .replace(/\{\{creator\}\}/g, () => ctx.creator)
        .replace(/\{\{duration\}\}/g, () => ctx.duration);
    return capitalizeSentenceStarts(filled);
}

// Capitalize the first alphabetic character of the string and of any
// sentence that follows a terminator (. ! ?). Em-dashes and ellipses are
// intentionally left alone since they don't end a sentence. Idempotent —
// already-capitalized words pass through unchanged.
function capitalizeSentenceStarts(s: string): string {
    return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, prefix, ch) => prefix + ch.toUpperCase());
}

function durationPhrase(entry: SavedCycleIndexEntry): string {
    const th = entry.timeHorizon;
    if (!th || !th.durationDays) return 'a few weeks';
    const days = th.durationDays;
    if (days <= 1) return 'a single day';
    if (days <= 3) return 'a few days';
    if (days <= 30) return `${days} days`;
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

// ── Public API ─────────────────────────────────────────────────────

// Generation is deterministic per entry.id (FNV-1a seed → mulberry32), so
// re-expanding the same card recomputes identical output. Memoize so the
// 5–8 template fills × star renders only happen once per card.
const _commentsCache = new Map<string, StreamComment[]>();

/**
 * Returns the LLM-authored reviews for this cycle with identity overlay
 * (handle, displayName, daysAgo, helpfulCount, verifiedStreamer applied
 * deterministically from the cycle id).
 *
 * Returns `null` when the cycle has no cached reviews — callers should
 * render the "Generate Comments" UI instead of inventing template-based
 * mock reviews. Mock comments on a freshly-saved cycle would mislead the
 * viewer into thinking the protocol has a history of real users.
 */
export function generateStreamComments(entry: SavedCycleIndexEntry): StreamComment[] | null {
    const cacheKey = entry.id || 'unknown-cycle';
    const cached = _commentsCache.get(cacheKey);
    if (cached) return cached;

    const llmReviews = LLM_REVIEWS[cacheKey];
    if (!llmReviews || llmReviews.length === 0) return null;

    const result = _attachIdentitiesToLLMReviews(entry, llmReviews);
    _commentsCache.set(cacheKey, result);
    return result;
}

// Overlay deterministic handle/displayName/daysAgo/helpfulCount/verifiedStreamer
// onto LLM-authored review text + stars. Identity assignment is seeded from
// the cycle id so the same card always shows the same reviewer for a given
// review slot.
function _attachIdentitiesToLLMReviews(
    entry: SavedCycleIndexEntry,
    reviews: LLMReview[],
): StreamComment[] {
    const seed = fnv1a(entry.id || 'unknown-cycle');
    const rand = mulberry32(seed);

    // Shuffle a copy of the author pool without replacement.
    const authorPool = AUTHORS.slice();
    for (let i = authorPool.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [authorPool[i], authorPool[j]] = [authorPool[j], authorPool[i]];
    }

    const comments: StreamComment[] = [];
    for (let i = 0; i < reviews.length; i++) {
        const r = reviews[i];
        const author = authorPool[i % authorPool.length];
        const tierLabel: StarSlot['tier'] = r.stars >= 4 ? 'positive' : r.stars >= 3 ? 'mid' : 'critical';
        const daysAgo = rangeInt(rand, 1 + i * 2, 7 + i * 14);
        const helpfulCount = rangeInt(rand, 0, tierLabel === 'positive' ? 240 : 60);
        const verifiedStreamer = rand() < 0.4;
        comments.push({
            handle: author.handle,
            displayName: author.name,
            stars: r.stars,
            text: r.text,
            daysAgo,
            helpfulCount,
            verifiedStreamer,
        });
    }
    return comments;
}

function _generateStreamCommentsImpl(entry: SavedCycleIndexEntry): StreamComment[] {
    const seed = fnv1a(entry.id || 'unknown-cycle');
    const rand = mulberry32(seed);

    const count = rangeInt(rand, 5, 8);

    // Substance class labels like "Mineral/Electrolyte" read like category
    // headings; trim to the first segment for natural prose.
    const substances =
        entry.substanceClasses && entry.substanceClasses.length > 0
            ? entry.substanceClasses.map(s => s.split('/')[0].trim())
            : FALLBACK_SUBSTANCES;
    // Effects stay in original casing so they read correctly at sentence
    // start as well as mid-sentence.
    const effects =
        entry.topEffects && entry.topEffects.length > 0 ? entry.topEffects : FALLBACK_EFFECTS;

    let creator = '';
    if (entry.creatorName && entry.creatorName.trim().length > 0) {
        creator = entry.creatorName.trim();
    } else if (entry.creatorHandle) {
        const agent = getAgentByHandle(entry.creatorHandle);
        creator = agent?.meta.creatorName || agent?.meta.name || '';
    }
    if (!creator) creator = pick(rand, FALLBACK_CREATORS);

    const duration = durationPhrase(entry);
    const ctx = { substances, effects, creator, duration };
    const topic = detectTopic(effects, entry.substanceClasses || [], entry.prompt || '');

    const plan = buildStarPlan(rand, count);

    // Sample authors without replacement.
    const authorPool = AUTHORS.slice();
    for (let i = authorPool.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [authorPool[i], authorPool[j]] = [authorPool[j], authorPool[i]];
    }

    // Sample templates without replacement per tier so a single card never
    // repeats the same text twice.
    const usedTemplates: Record<StarSlot['tier'], Set<string>> = {
        positive: new Set(),
        mid: new Set(),
        critical: new Set(),
    };

    const comments: StreamComment[] = [];
    for (let i = 0; i < plan.length; i++) {
        const slot = plan[i];
        const pool = poolForTier(slot.tier, topic, rand);
        let template = pick(rand, pool);
        let safety = 0;
        while (usedTemplates[slot.tier].has(template) && safety < 6 && usedTemplates[slot.tier].size < pool.length) {
            template = pick(rand, pool);
            safety++;
        }
        usedTemplates[slot.tier].add(template);

        const text = fillTemplate(template, rand, ctx);
        const author = authorPool[i % authorPool.length];

        // Older comments for the back of the list, fresher up top.
        const daysAgo = rangeInt(rand, 1 + i * 2, 7 + i * 14);
        const helpfulCount = rangeInt(rand, 0, slot.tier === 'positive' ? 240 : 60);
        const verifiedStreamer = rand() < 0.4;

        comments.push({
            handle: author.handle,
            displayName: author.name,
            stars: slot.stars,
            text,
            daysAgo,
            helpfulCount,
            verifiedStreamer,
        });
    }
    return comments;
}

export function summarizeStreamComments(comments: StreamComment[]): { avg: number; count: number } {
    if (comments.length === 0) return { avg: 0, count: 0 };
    const sum = comments.reduce((s, c) => s + c.stars, 0);
    return { avg: sum / comments.length, count: comments.length };
}

export function formatRelativeDays(daysAgo: number): string {
    if (daysAgo < 1) return 'today';
    if (daysAgo === 1) return '1d ago';
    if (daysAgo < 7) return `${daysAgo}d ago`;
    if (daysAgo < 30) return `${Math.round(daysAgo / 7)}w ago`;
    if (daysAgo < 365) return `${Math.round(daysAgo / 30)}mo ago`;
    return `${Math.round(daysAgo / 365)}y ago`;
}
