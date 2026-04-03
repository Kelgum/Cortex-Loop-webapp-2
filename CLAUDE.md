# Cortex Loop

## What This Is

**Investor demonstrator for Lx.health** — the first substance streaming infrastructure. From episodic Dx and static Rx, to learning Lx.

A user types a pharmacodynamic goal ("4 hours of deep focus"). A multi-agent LLM pipeline identifies effects, models 24-hour pharmacodynamic curves, prescribes a preliminary substance protocol from a substance database, simulates biometric wearable feedback with real-world perturbations, optionally assigns a 3rd-party agent to advise the protocol (injecting 3rd-party content into the LLM pipeline), and revises the substance protocol in response. Then a 7-day closed-loop protocol stream demonstrates continuous adaptation. Then a phygital transformation maps the substance strip onto a device with live camera overlays.

The demo walks investors through the full Lx.health intelligence pipeline — **Map → Design → Learn → Stream** — in real time:
- **Map** — understand the pharmacodynamic landscape (baseline biology vs. desired state)
- **Design** — engineer the intervention protocol (substance selection, timing, interactions)
- **Learn** — sense biometric reality, adapt the protocol to the actual day
- **Stream** — continuous multi-day optimization, the substance stream in action

**Stack:** Vanilla TypeScript + Vite. No frameworks. Single-page app. 100% client-side.

---

## Demo Modules

Every feature in this app exists to answer a specific investor question. Each module has two objectives:

- **Marketing objective** — written in the investor's internal voice: what they *think* after seeing the module. This is the north star; every design and implementation decision should serve it.
- **Functional objective** — what the code must do to deliver the marketing objective.

When making changes, ask: *does this serve the module's marketing objective?*

### Module 1 — INTENT
**Marketing objective:** *"This AI doesn't just search keywords — it understands complex, multi-dimensional health goals the way a clinician would. There's something intriguing happening here, even if I don't yet fully understand it"*
**Functional objective:** Decompose natural-language input into ranked pharmacodynamic effects with conflict detection.

The Scout agent parses a sentence into multi-dimensional pharmacodynamic effects, identifies hidden conflicts (e.g., "focus without wrecking sleep"), and ranks relevance. The word cloud serves a dual purpose: it mirrors the user's request back to them — they feel seen and understood — while buying time for the Strategist to complete the heavy pharmacodynamic analysis.

| | |
|---|---|
| **Agent** | Scout (Stage 1) |
| **Phase** | Pre-chart |
| **Visual** | Orbital word cloud → scan line → hook sentence |
| **Key files** | `prompts.ts` (Scout template), `word-cloud.ts`, `llm-pipeline.ts`, `llm-response-shape.ts` |

### Module 2 — MAP
**Marketing objective:** *"They just turned a vague health goal into quantitative curves I can read — a before and after, with the gap measured. I visually and intuitively where you are and where you want to be, the visuals are very intuitive. I'm continued to be intrigued, the flow is engaging."*
**Functional objective:** Generate a personalized pharmacodynamic terrain: population baseline curves, desired-state curves, and the quantified gap between them.

The Strategist agent maps the abstract goal onto quantifiable biology: a 24-hour pharmacodynamic landscape with population baseline (natural circadian state) vs. desired (target state). Each curve has 10 intensity levels with clinical meaning. The gap between baseline and desired — visualized as mission arrows — is the user's intent, quantified. This is the "Dx" layer: grounding a subjective goal into a measurable pharmacodynamic terrain.

| | |
|---|---|
| **Agent** | Strategist (Stage 2, parallel with Scout) |
| **Phase** | 0 (baseline) → 1 (desired overlay) |
| **Visual** | Baseline curves (dashed) morph to desired curves (solid) → mission arrows (the quantified intent) → Y-axis level descriptors → split-screen for 2 effects |
| **Key files** | `chart-curves.ts`, `chart-axes.ts`, `curve-utils.ts`, `baseline-editor.ts`, `divider.ts` |

### Module 3 — DESIGN
**Marketing objective:** *"It's not picking supplements from a list — it's thinking about what happens at 2pm when the morning dose wears off and the afternoon one kicks in. It's designing a protocol the way I'd expect a specialist to, but agentaically. But what maybe as mesmerizing, is the individual visual curve effect ∆ of each substance on my baseline, this really drives home what I expect to get."*
**Functional objective:** Select substances from the database, compute multi-vector pharmacodynamic impacts with effect timing profiles, and compose a protocol that closes the baseline→desired gap while minimizing collateral effects.

The Chess Player agent is the protocol designer. It selects substances from the database, accounts for effect timing profiles (onset-to-peak latencies, duration, decay half-lives), computes multi-vector pharmacodynamic impacts across all effect axes, and anticipates collateral effects — prescribing compensatory substances where needed. The Lx overlay curve shows the predicted state with the intervention. Substances animate in one-by-one, showing cumulative effect — investors see "moves on a chessboard."

| | |
|---|---|
| **Agent** | Chess Player (Stage 3) |
| **Phase** | 2 (Lx interventions + substance timeline) |
| **Visual** | Lx overlay curves → substance timeline swim lanes → AUC bands → sequential reveal → playhead morph (draggable before/after) |
| **Key files** | `lx-compute.ts`, `pharma-model.ts`, `lx-render.ts`, `substance-timeline.ts`, `substances.ts` |

### Cross-Cutting — Sherlock (Narration Layer)
**Marketing objective:** *"I can follow exactly what's happening — each substance gets explained as it comes in with directional arrows and dose info. It's like having Dr. House (tv series) walk me through the protocol step by step, making understand there's high intelligence behind every move I can trust and feel I'm in good hands."*
**Functional objective:** Render an animated card-stack narration panel that steps through each substance intervention with timing, dose, and directional effect indicators, synchronized to the Lx animation.

The Sherlock panel appears to the left of the phase chart during DESIGN (Phase 2) and LEARN (Phase 4). Cards animate from a hidden stack upward to center, with decreasing opacity for unfocused cards. Each card shows a time label, directional SVG arrow (up/down/neutral), dose, and highlighted narration text. Hovering a card focuses its Lx curve band; clicking toggles substance highlighting across all timeline pills and bands. VCR play/pause/next/prev controls drive the per-substance animation loop.

| | |
|---|---|
| **Phase** | 2 (Lx reveal) and 4 (revision) |
| **Visual** | Left-side panel (280px), animated card stack, substance highlighting, VCR step controls |
| **Key files** | `sherlock.ts`, `sherlock-narration.ts` |

### Cross-Cutting — Protocol Streamers (KOL Agent Marketplace)
**Marketing objective:** *"So Huberman or Attia could encode their protocol philosophy into an agent, and a user could select it before the pipeline runs? That's a marketplace — that's an 'App Store for Health' play. The official huberman agent takes point on leading my protocol!"*
**Functional objective:** Provide a browsable gallery of KOL-authored protocol agents (20 bundled: Huberman, Attia, Sinclair, Ferriss, etc.) with a full-page designer for encoding new agents. The selected agent's philosophy, substance palette, and optimization weights are injected into the LLM pipeline to bias protocol generation.

Users browse or create protocol streamer agents before the pipeline runs. Each agent encodes a KOL's approach: domain tags, target population, substance preferences, optimization weights, guardrails, and signature interventions. After the Scout produces a word cloud, the matcher LLM-ranks agents against the user's goal and displays the top match as a floating docked card that morphs into a capsule on the timeline.

| | |
|---|---|
| **Phase** | Pre-pipeline (optional selection) → influences Stages 3–5 |
| **Visual** | Grid gallery of agent cards → full-page designer form → floating docked card (morphs to capsule) |
| **Key files** | `creator-agent-browser.ts`, `creator-agent-designer.ts`, `creator-agent-matcher.ts`, `creator-agent-types.ts`, `creator-agents/` (20 KOL agent configs) |

### Module 4 — LEARN
**Marketing objective:** *"Wait — it just changed the protocol because the person slept badly? A normal prescription can't do that. This is the part where it stops being a recommendation engine and starts being something new."*
**Functional objective:** Simulate exogenous biometric perturbations, quantify the gap between what the protocol assumed and what the day actually delivers, and revise the protocol in response.

This is where the demo proves Lx.health's core differentiator: the progression from episodic Dx and static Rx to learning Lx.

The Chess Player designed the protocol in a vacuum — assuming a perfect day. But days aren't perfect. The **Spotter** agent introduces the real world: exogenous perturbations that the protocol wasn't designed for. Poor sleep last night (HRV crashed), an intense morning workout (cortisol spike), a stressful meeting at 2pm (sympathetic activation), a skipped breakfast (glucose dip). These are simulated as wearable biometric data across the 24-hour window.

The **Grandmaster** agent then reads the gaps between what the protocol assumed and what the perturbed day actually delivers, and revises the protocol accordingly. This is not "fixing a bad protocol" — it's **adapting a good protocol to the messy reality of a real day**. The pick-and-place revision animation makes the "what changed and why" viscerally clear.

The biometric perturbations represent *input conditions* (external reality), not drug responses. When the Grandmaster changes the protocol, the external reality doesn't change — your bad sleep and stressful meeting still happened. Only the protocol's response to them changes.

| | |
|---|---|
| **Agents** | Spotter (Stage 4) + Grandmaster (Stage 5) |
| **Phase** | 3 (biometric strips) → 4 (revision diff) |
| **Visual** | Biometric oscilloscope strips → bio-correction of baselines → revision scan animation (pick-and-place) → before/after fit metrics |
| **Key files** | `biometric.ts`, `biometric-devices.ts`, `bio-correction.ts`, `revision-animation.ts`, `revision-reference.ts` |

### Module 5 — STREAM
**Marketing objective:** *"Ok, now I get the 'streaming' thing. Day 3 looks different from day 1 because Tuesday was different from Sunday. It's not repeating the same prescription — it's actually learning. That's a fundamentally different product category. That's how I want my health to be managed"*
**Functional objective:** Run a 7-day multi-agent cycle where daily biometric context (sleep debt, tolerance, life events) drives per-day protocol adaptation, demonstrating the substance stream across time.

This is the money shot. When we say Lx is streaming substances, the non-intuitive temporal dimension is that it's like video streaming but at a slower frame rate — measured in hours rather than seconds. Each day is a frame.

Four multi-day agents evolve the protocol over a 7-day cycle. The **Knight** maintains the desired curves from the original user goal, adjusting them only if the week's context demands it — otherwise the target state stays constant, and only the protocol adapts. The **Spotter Daily** introduces day-specific perturbations: accumulated sleep debt, tolerance buildup, a rest day vs. a workout day, weekend stress patterns. The **Strategist Bio Daily** corrects baselines from biometric evidence. The **Grandmaster Daily** adapts the intervention protocol — same logic as Module 4 (adapt a good protocol to a real day), but now iterated across a week where each day's context differs.

| | |
|---|---|
| **Agents** | Knight, Spotter Daily, Strategist Bio Daily, Grandmaster Daily |
| **Phase** | Post-Phase 4 (multi-day) |
| **Visual** | 7-day animated transitions → curves morph day-to-day → substance pills morph across days |
| **Key files** | `week-orchestrator.ts`, `multi-day-animation.ts`, `pharma-model.ts` |

### Module 6 — DELIVER
**Marketing objective:** *"So all of that intelligence actually ends up in a physical cartridge in a real device. This isn't a SaaS pitch — there's hardware, there's a unit economics story. They can ship this."*
**Functional objective:** Animate the phygital transformation: substance strip pills drain into the VCR module, the VCR morphs into the dose.player device with cartridge, and a live camera overlay grounds it in the real world.

The substance strip pills flow into the VCR button, the page fades, and the device + cartridge emerge at center screen. Cartridge slots fill one-by-one with substance colors. A 5-state camera toggle cycles through: device overlay on live webcam → cartridge close-up → full AR view. Investors see the complete journey from typed intent to physical hardware.

| | |
|---|---|
| **Phase** | Post-multi-day (compile animation) |
| **Visual** | Pill drain into VCR → page fade → device + cartridge reveal → camera feed with AR overlay |
| **Key files** | `compile-animation.ts`, `dose-player.ts` |

### Cross-Cutting — Animation Engine
**Marketing objective:** *"This is polished. I can scrub back and re-examine anything. The attention to detail here signals a serious team."*
**Functional objective:** Provide a segment-based animation engine with a scrubable playhead, colored phase indicators, and re-entrant rendering.

The timeline engine delivers cinematic presentation: scrubable playhead, replayable segments, phase boundaries, colored segment bars. Makes the demo memorable and allows investors to pause, rewind, and re-examine any moment.

| | |
|---|---|
| **Key files** | `timeline-engine.ts`, `timeline-ribbon.ts`, `timeline-builder.ts`, `timeline-segments/` (8 segment modules) |

---

## Repo Map

```
index.html              App shell (prompt input, phase chart SVG, controls)
styles.css              Dark/light theme, animations, responsive (CSS custom properties)
config.js               (gitignored) Optional API key overrides

src/
  main.ts               Entry point — bootstrap, prompt submit, phase orchestration
  state.ts              Global state (AppState, PhaseState, BiometricState, RevisionState)
  types.ts              Domain interfaces (CurveData, Intervention, etc.)
  constants.ts          Layout, colors, model configs, API endpoints
  substances.ts         101-substance database with pharma profiles
  dom.ts                Cached DOM registry
  settings-store.ts     Typed localStorage/sessionStorage accessors

  llm-pipeline.ts       Multi-provider LLM calls + retry (Anthropic, OpenAI, xAI, Google)
  prompts.ts            Prompt templates ({{placeholder}} interpolation)
  llm-response-shape.ts Response normalization + validation
  llm-cache.ts          Stage cache envelopes + toggles

  phase-chart.ts        Barrel → chart-axes, chart-curves, chart-scan-lines, phase-chart-ui
  lx-system.ts          Barrel → pharma-model, lx-compute, lx-render, substance-timeline

  biometric.ts          Device selection, profile drafting, strip rendering, revision
  biometric-devices.ts  10 wearable device definitions + signal metadata
  bio-correction.ts     Biometric preprocessing
  revision-animation.ts Pick-and-place diff animation
  revision-reference.ts Reference bundle + fit metrics for revision

  timeline-engine.ts    Segment-based animation engine (play/pause/seek)
  timeline-ribbon.ts    Canvas timeline control bar
  timeline-builder.ts   Builds segments from phase data
  timeline-segments/    8 segment modules (curves, lx, biometric, sherlock, etc.)

  week-orchestrator.ts  7-day multi-agent pipeline (Knight, Spotter, Strategist, Grandmaster)
  multi-day-animation.ts Day-to-day morph and pill transitions

  compile-animation.ts  Phygital handoff: pill drain → device reveal → camera overlay
  dose-player.ts        SVG generation for dose.player device + circular cartridge

  sherlock.ts           Narration card stack panel (VCR step controls, substance highlighting)
  sherlock-narration.ts Narration shape normalization + fallback beat generation
  word-cloud.ts         Orbital effect bubbles
  baseline-editor.ts    Interactive baseline curve scrubber
  debug-panel.ts        LLM pipeline inspector
  pipeline-timeline.ts  LLM agent call timeline (debug lane diagram)
  divider.ts            Split-screen divider for 2-effect mode

  creator-agent-browser.ts   KOL agent gallery (browse, search, preview)
  creator-agent-designer.ts  Full-page agent encoding form (JSON export)
  creator-agent-matcher.ts   LLM-rank agents against word cloud, floating docked card
  creator-agent-types.ts     AgentConfig, AgentMeta interfaces + domain constants
  creator-agents/            20 bundled KOL agent configs (Huberman, Attia, Sinclair, etc.)

scripts/
  check-architecture.mjs  Import graph validation (no cycles, barrel boundaries)

tests/
  unit/                 Vitest unit tests
  e2e/                  Playwright E2E tests
```

**Deep reference:** `AGENTS.md` is the authoritative deep technical spec. Read it before making structural changes. CLAUDE.md is the strategic + operational guide (why + what); AGENTS.md is the blueprint (how).

**App screenshots:** `/Users/perry/Downloads/Chrome_Grabber_Videos/Snapshots` — reference screenshots of the running app. Check these when you need visual context for how the UI looks.

---

## Rules

### Code Style
- **Prettier:** 4-space indent, single quotes, trailing commas, 120-char lines, semicolons
- **ESLint:** `@typescript-eslint/recommended`. `no-var` is error, `no-console` and `no-explicit-any` are warnings
- **TypeScript:** ES2020 target, strict:false. `any` is warned but allowed
- Run `npm run format` after edits to ensure consistency

### Architecture Boundaries
- **Barrel exports:** `phase-chart.ts` and `lx-system.ts` are barrel modules. External code imports from the barrel, not from internal files
- **No import cycles.** `npm run architecture:check` validates the import graph
- **Global state lives in `state.ts` only.** Don't scatter mutable state across modules
- **Prompts live in `prompts.ts` only.** Don't embed prompt text in pipeline code
- **Substance data lives in `substances.ts` only**

### Animation Engine Contract
- Segments must be **re-entrant and idempotent** — `render(progress)` can be called at any time
- Segments must implement `enter()`, `render(t)`, and `exit()` (cleanup for backward seek)
- Timing in `timeline-builder.ts` must match the imperative code in the originating module

### Do Not
- Add external UI frameworks or charting libraries — this is pure SVG + vanilla DOM
- Commit API keys (use `config.js` which is gitignored, or localStorage)
- Modify `check-architecture.mjs` to bypass import rules — fix the violation instead
- Add `strict: true` to tsconfig without a migration plan

---

## Commands

```bash
npm run dev              # Vite dev server on :5173 (HMR)
npm run build            # Production build → /dist
npm run preview          # Serve /dist on :4173
npm run check            # Full suite: typecheck + lint + test + architecture + build
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint
npm run format           # Prettier --write src/
npm run test:unit        # Vitest
npm run test:e2e         # Playwright (starts vite on :4173)
npm run architecture:check  # Import graph validation
```

**Always run `npm run check` before considering work complete.** It catches type errors, lint violations, test failures, import boundary violations, and build errors in one pass.

---

## Key Concepts

### 16-Agent LLM Pipeline (all agents, execution order)

**Main Pipeline (Phases 0–4):**

| # | Agent | Stage ID | Module | Tier | Role |
|---|-------|----------|--------|------|------|
| 1 | Scout | `fast` | INTENT | Fast | Effect identification → word cloud |
| 2 | Strategist | `curves` | MAP | Main | Pharmacodynamic landscape (baseline vs desired) |
| 3 | Agent Matcher | `agentMatch` | KOL | Fast | LLM-ranks creator agents against user goal |
| 4 | Chess Player | `intervention` | DESIGN | Main | Protocol engineering → intervention selection |
| 5 | Sherlock | `sherlock` | Narration | Fast | Narrates intervention protocol (card stack) |
| 6 | Spotter (Device) | `biometricRec` | LEARN | Fast | Recommends wearable devices for the goal |
| 7 | Spotter (Profile) | `biometricProfile` | LEARN | Fast | Generates biometric profile + tension directives |
| 8 | Spotter (Channel) | `biometricChannel` | LEARN | Fast | Picks 5 best biometric channels from devices |
| 9 | Spotter (Sim) | `biometric` | LEARN | Fast | Simulates 24h biometric perturbations as wearable data |
| 10 | Strategist Bio | `strategistBio` | LEARN | Fast | Corrects baseline curves from biometric evidence |
| 11 | Grandmaster | `revision` | LEARN | Main | Revises protocol in response to perturbed reality |
| 12 | Sherlock (Rev) | `sherlockRevision` | Narration | Fast | Narrates protocol revisions |

Stages 1 & 2 run in parallel. Agent Matcher runs after Scout. Per-stage model selection via `AppState.stageModels`.

**Multi-Day Pipeline (STREAM, post-Phase 4):**

| # | Agent | Stage ID | Tier | Role |
|---|-------|----------|------|------|
| 13 | Knight | `knight` | Main | Maintains desired curves from original goal (adjusts only if week context demands) |
| 14 | Spotter Daily | `spotterDaily` | Fast | Day-specific biometric perturbations (sleep debt, life events, tolerance) |
| 15 | Strategist Bio Daily | `strategistBioDaily` | Fast | Baseline correction from biometric evidence |
| 16 | Grandmaster Daily | `grandmasterDaily` | Main | Per-day intervention protocol adaptation |

### Phase Navigation (0–4)
Phase 0: baseline curves → Phase 1: desired overlay → Phase 2: Lx interventions + timeline → Phase 3: biometric strips → Phase 4: revision diff. State is preserved when stepping backward.

### Pharmacokinetic Model
`pharma-model.ts` computes `substanceEffectAt(t)` as a 5-phase piecewise curve: ramp-up (quadratic ease-in) → rising (ease-out) → plateau (gentle linear decay) → exponential decay → post-duration (residual minus rebound). Each substance has onset, peak, duration, halfLife, strength, and rebound params.

### Lx Overlay Computation
`lx-compute.ts` computes the predicted pharmacodynamic state with supplementation:
1. **Validate** interventions against substance database (resolve keys, assign colors)
2. **Sum** all substance contributions per time point via `ivRawEffectAt()` (multi-vector impacts)
3. **Scale** so peak effect covers 95% of the baseline→desired gap (`LX_GAP_COVERAGE = 0.95`)
4. **Overlay** = smoothed baseline + scaled pharmacokinetic effect, clamped to [0, 100]
