#!/usr/bin/env node
// Generate LLM-authored simulated user reviews for every saved cycle.
//
// Reads saved-cycles/*.json, extracts metadata (prompt, effects, substance
// classes, creator, duration), calls the Claude API per card, and writes
// stream-comments-data.json keyed by cycle id.
//
// Output schema (per cycle):
//   { stars: number, text: string }[]
// The runtime generator (src/stream-comments.ts) overlays handle,
// displayName, daysAgo, helpfulCount, and verifiedStreamer deterministically
// from the cycle ID so we don't have to bake identity into the LLM output.
//
// Usage:
//   node scripts/generate-stream-comments.mjs             # missing only
//   node scripts/generate-stream-comments.mjs --force     # regenerate all
//   node scripts/generate-stream-comments.mjs <cycle-id>  # single card

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CYCLES_DIR = join(REPO_ROOT, 'saved-cycles');
const OUTPUT_PATH = join(REPO_ROOT, 'stream-comments-data.json');
const CONFIG_PATH = join(REPO_ROOT, 'config.js');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2400;
const CONCURRENCY = 4;
const RETRIES = 3;

// ── API key resolution ─────────────────────────────────────────────
function loadAnthropicKey() {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    if (!existsSync(CONFIG_PATH)) {
        throw new Error('No ANTHROPIC_API_KEY env var and no config.js found');
    }
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const m = raw.match(/anthropic:\s*['"]([^'"]+)['"]/);
    if (!m) throw new Error('Could not find anthropic key in config.js');
    return m[1];
}

// ── Cycle metadata ─────────────────────────────────────────────────
function loadCycles() {
    const files = readdirSync(CYCLES_DIR)
        .filter(f => f.startsWith('cycle-') && f.endsWith('.json'))
        .sort();
    const cycles = [];
    for (const f of files) {
        try {
            const raw = readFileSync(join(CYCLES_DIR, f), 'utf8');
            const c = JSON.parse(raw);
            cycles.push({
                id: c.id,
                prompt: c.prompt || '',
                title: c.overlayTitle || c.filename || '',
                hookSentence: c.hookSentence || '',
                topEffects: Array.isArray(c.topEffects) ? c.topEffects : [],
                substanceClasses: Array.isArray(c.substanceClasses) ? c.substanceClasses : [],
                creatorName: c.creatorName || '',
                creatorHandle: c.creatorHandle || '',
                durationDays: c.timeHorizon?.durationDays || null,
                rationale: c.timeHorizon?.rationale || '',
            });
        } catch (err) {
            console.error(`Skipping ${f}: ${err.message}`);
        }
    }
    return cycles;
}

function durationPhrase(days) {
    if (!days) return 'a few weeks';
    if (days <= 1) return 'a single day';
    if (days <= 3) return 'a few days';
    if (days <= 30) return `${days} days`;
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

// ── Prompt ─────────────────────────────────────────────────────────
// CANONICAL SOURCE: src/stream-comments-prompt.ts (used by the browser
// "Generate Comments" button). Keep this copy in sync if the prompt is
// updated. The two implementations produce identical output for the
// same context.
function buildPrompt(cycle) {
    const duration = durationPhrase(cycle.durationDays);
    const effects = cycle.topEffects.length ? cycle.topEffects.join(', ') : '(unspecified)';
    const primaryEffect = cycle.topEffects[0] || '(primary outcome)';
    const otherEffects = cycle.topEffects.slice(1).join(', ') || '(none)';
    const classes = cycle.substanceClasses.length ? cycle.substanceClasses.join(', ') : '(unspecified)';
    const creator = cycle.creatorName || '(uncredited)';

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

// ── API call with retry ────────────────────────────────────────────
async function callClaude(apiKey, prompt) {
    let lastErr;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: MODEL,
                    max_tokens: MAX_TOKENS,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            if (!res.ok) {
                const body = await res.text();
                throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
            }
            const json = await res.json();
            const text = json.content?.[0]?.text;
            if (!text) throw new Error('Empty response');
            return text;
        } catch (err) {
            lastErr = err;
            if (attempt < RETRIES) {
                const wait = 1000 * attempt;
                console.error(`  retry ${attempt}/${RETRIES} after ${wait}ms: ${err.message}`);
                await new Promise(r => setTimeout(r, wait));
            }
        }
    }
    throw lastErr;
}

function parseReviews(raw) {
    // Strip code fences if the model added them despite instructions.
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    }
    const parsed = JSON.parse(cleaned);
    if (!parsed.reviews || !Array.isArray(parsed.reviews)) {
        throw new Error('Missing reviews array');
    }
    const out = [];
    for (const r of parsed.reviews) {
        if (typeof r.stars !== 'number' || typeof r.text !== 'string') {
            throw new Error(`Bad review entry: ${JSON.stringify(r)}`);
        }
        out.push({ stars: r.stars, text: r.text.trim() });
    }
    if (out.length < 4) throw new Error(`Too few reviews: ${out.length}`);
    return out;
}

async function generateForCycle(apiKey, cycle) {
    const prompt = buildPrompt(cycle);
    const raw = await callClaude(apiKey, prompt);
    return parseReviews(raw);
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const onlyId = args.find(a => a.startsWith('cycle-'));

    const apiKey = loadAnthropicKey();
    const cycles = loadCycles();
    console.log(`Found ${cycles.length} cycles`);

    const existing = existsSync(OUTPUT_PATH)
        ? JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'))
        : {};

    const todo = cycles.filter(c => {
        if (onlyId) return c.id === onlyId;
        if (force) return true;
        return !existing[c.id];
    });
    console.log(`Generating for ${todo.length} cycles (skip existing: ${!force && !onlyId})`);

    let done = 0;
    let failed = 0;
    const queue = todo.slice();

    async function worker(id) {
        while (queue.length > 0) {
            const cycle = queue.shift();
            if (!cycle) return;
            const label = `[${cycle.id.slice(-4)}] ${cycle.title || cycle.prompt.slice(0, 40)}`;
            try {
                console.log(`worker ${id}: ${label}`);
                const reviews = await generateForCycle(apiKey, cycle);
                existing[cycle.id] = reviews;
                // Persist incrementally so a long run never loses progress.
                writeFileSync(OUTPUT_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');
                done++;
                console.log(`  ✓ ${label} — ${reviews.length} reviews`);
            } catch (err) {
                failed++;
                console.error(`  ✗ ${label}: ${err.message}`);
            }
        }
    }

    const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
    await Promise.all(workers);

    console.log(`\nDone. Generated: ${done}. Failed: ${failed}. Total cached: ${Object.keys(existing).length}`);
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
