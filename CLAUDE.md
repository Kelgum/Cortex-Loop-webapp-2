# Cortex Loop

## Purpose

Prompt-driven pharmacodynamic visualizer. User describes a cognitive/physical goal ("4 hours of deep focus"), a 5-stage LLM pipeline identifies effects, models 24-hour curves, prescribes supplements, simulates biometric feedback, and revises the protocol.

**Stack:** Vanilla TypeScript + Vite. No frameworks. Single-page app. 100% client-side.

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
  substances.ts         77-substance database with pharma profiles
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

  timeline-engine.ts    Segment-based animation engine (play/pause/seek)
  timeline-ribbon.ts    Canvas timeline control bar
  timeline-builder.ts   Builds segments from phase data
  timeline-segments/    8 segment modules (curves, lx, biometric, sherlock, etc.)

  sherlock.ts           Card stack narration panel
  word-cloud.ts         Orbital effect bubbles
  baseline-editor.ts    Interactive baseline curve scrubber
  debug-panel.ts        LLM pipeline inspector
  divider.ts            Split-screen divider for 2-effect mode

scripts/
  check-architecture.mjs  Import graph validation (no cycles, barrel boundaries)

tests/
  unit/                 Vitest unit tests
  e2e/                  Playwright E2E tests
```

**Deep reference:** `AGENTS.md` is the authoritative 35KB architecture spec. Read it before making structural changes.

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

## Key Concepts

### 5-Stage LLM Pipeline
| Stage | Agent | Role |
|-------|-------|------|
| 1 | Scout | Effect identification → word cloud |
| 2 | Strategist | Pharmacodynamic curves (baseline vs desired) |
| 3 | Chess Player | Substance selection → intervention protocol |
| 4 | Spotter | Biometric simulation → wearable strips |
| 5 | Grandmaster | Protocol revision based on biometric gaps |

Stages 1 & 2 run in parallel. Per-stage model selection via `AppState.stageModels`.

### Phase Navigation (0–4)
Phase 0: baseline curves → Phase 1: desired overlay → Phase 2: Lx interventions + timeline → Phase 3: biometric strips → Phase 4: revision diff. State is preserved when stepping backward.

### Pharmacokinetic Model
`pharma-model.ts` computes `substanceEffectAt(t)` as a 5-phase piecewise curve: ramp-up → rising → plateau → exponential decay → post-duration. Each substance has onset, peak, duration, halfLife, strength, and rebound params.
