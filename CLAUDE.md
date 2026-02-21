# Cortex Loop — Application Spec

## Overview

Cortex Loop is a prompt-driven pharmacodynamic visualizer. The user describes a desired cognitive/physical outcome (e.g. "4 hours of deep focus"), and a multi-stage LLM pipeline: (1) identifies relevant pharmacodynamic effects, (2) models 24-hour baseline vs desired curves, (3) selects an optimal supplement intervention protocol, and (4) uses a Biometric Loop to adjust the intervention based on simulated physiological data — all visualized as animated SVG charts with interactive before/after comparison.

**Stack:** Vanilla HTML/CSS/TypeScript. Powered by Vite for local development and build. Single-page app served from `index.html`.

**Files:**
- `index.html` — Structure (prompt, phase chart SVG, legacy cartridge, footer, biometric strip UI)
- `styles.css` — Dark/light theme styling, animations, responsive layout
- `src/*.ts` — All logic separated into modules: state, substances, multi-model LLM pipeline, SVG rendering, animation engine, phase chart system, Lx intervention engine, biometric loop, and debug panel.
- `prompts.js` / `src/prompts.ts` — Externalized prompt templates with `{{placeholder}}` interpolation
- `biometric-device-ontology.json` / `biometricDevices.js` — Definitions of biometric devices and channels.
- `config.js` — (gitignored) Optional API key overrides

---

## Architecture

### Layout (3 zones)

```
┌──────────────────────────────────────────────┐
│  HEADER: Prompt input + Rx/Controlled toggles │
│  TOP-RIGHT: Theme toggle, Debug btn, Settings │
├──────────────────────────────────────────────┤
│   PHASE CHART (SVG 960×500)                   │
│   24-hour baseline/desired/Lx curves          │
│   + substance timeline swim lanes             │
│   + Optimize / Lx / Biometric buttons         │
│   + Biometric strips (oscilloscope view)      │
├──────────────────────────────────────────────┤
│  FOOTER: Summary pills (substance · dose)     │
└──────────────────────────────────────────────┘
```

Prompt input starts vertically centered. On submit, it slides to the top (`phase-centered` → `phase-top`) and the phase chart fades in below.

### Primary UI: Phase Chart

The main visualization is a full-width pharmacodynamic chart (SVG 960×500) showing 24-hour effect curves. The legacy cartridge system (SVG 800×800) exists in code but is hidden (`#cartridge-section.hidden`).

### Phase Chart SVG Structure

```
<svg id="phase-chart-svg" viewBox="0 0 960 500">
  <g id="phase-grid">              Vertical/horizontal grid lines
  <g id="phase-x-axis">            Time axis (6am–6am next day)
  <g id="phase-y-axis-left">       Left Y-axis (first effect)
  <g id="phase-y-axis-right">      Right Y-axis (second effect)
  <g id="phase-scan-line">         Animated vertical sweep line
  <g id="phase-word-cloud">        Effect word bubbles
  <g id="phase-baseline-curves">   Dashed baseline curves
  <g id="phase-desired-curves">    Solid desired curves + fill
  <g id="phase-lx-bands">          AUC bands representing substance impact
  <g id="phase-lx-curves">         Lx intervention overlay curves
  <g id="phase-lx-markers">        Dose markers on Lx curves
  <g id="phase-substance-timeline"> FCP-style substance swim lanes
  <g id="phase-mission-arrows">    Arrows showing baseline→desired gap
  <g id="phase-legend">            Curve legend
  <g id="phase-tooltip-overlay">   Hover tooltips
  <g id="phase-biometric-strips">  Oscilloscope-style biometric waveform strips
</svg>
```

### Top Controls

- **Theme toggle** — Light/dark mode switch (persisted in localStorage)
- **Debug button** — Opens LLM Pipeline debug panel (slide-in from right)
- **Settings gear** — Popover with model selector, effects count, API key input
- **Phase step controls** — `< >` chevrons to navigate between phases (appears after chart loads)

---

## Substance Database

77 substances across 8 categories:

| Category | Count | Color | Examples |
|----------|-------|-------|----------|
| Stimulant | 3 | `#ff6b4a` | Caffeine, Theacrine, Dynamine |
| Adaptogen | 9 | `#a855f7` | Theanine, Rhodiola, Ashwagandha |
| Nootropic | 12 | `#3b82f6` | Tyrosine, Citicoline, Lion's Mane |
| Mineral | 13 | `#22c55e` | Creatine, Magnesium, NAC, CoQ10 |
| Vitamin | 7 | `#eab308` | D3, B12, Omega-3 |
| Sleep | 9 | `#06d6a0` | Glycine, Melatonin, GABA |
| Rx | 13 | `#e11d48` | Modafinil, Methylphenidate (toggle-gated) |
| Controlled | 10 | `#f59e0b` | Psilocybin, LSD microdose (toggle-gated) |

Each substance has a **pharmacokinetic profile**:
```javascript
pharma: {
  onset: 20,      // minutes to feel effect
  peak: 45,       // minutes to reach peak
  duration: 300,  // total effect window (minutes)
  halfLife: 300,  // exponential decay rate (minutes)
  strength: 80,   // effect magnitude (0-100)
  rebound: 15     // post-duration crash depth (0-30)
}
```

Rx and Controlled substances are hidden by default. The user enables them via toggle pills below the prompt input.

---

## Multi-Model LLM Pipeline

### Model Tiers

**Fast Models** (effect identification — Stage 1, biometric — Stage 4, revision - Stage 5):
| Provider | Model |
|----------|-------|
| Anthropic | `claude-haiku-4-5-20251001` |
| OpenAI | `gpt-4.1-nano` |
| xAI | `grok-3-mini-fast` |
| Google | `gemini-2.5-flash-lite` |

**Main Models** (curve generation — Stage 2, intervention — Stage 3):
| Provider | Model |
|----------|-------|
| Anthropic (default) | `claude-opus-4-6` |
| OpenAI | `gpt-4o` |
| xAI | `grok-3` |
| Google | `gemini-2.0-flash` |

API keys stored in `localStorage` (`cortex_key_{provider}`). Model selection stored as `cortex_llm` and per-stage defaults. Falls back to `config.js` if present.

### Pipeline Stages

```
User prompt
  ├─→ Stage 1: Fast Model (effect identification)
  │     → returns {effects: [{name, relevance}, ...]}
  │     → triggers word cloud + scan line animation
  │
  └─→ Stage 2: Main Model (pharmacodynamic curves) [parallel with Stage 1]
        → returns {curves: [{effect, color, polarity, levels, baseline[], desired[]}, ...]}
        → triggers baseline → desired curve rendering

  [User clicks "Lx" button]
  └─→ Stage 3: Intervention Model (substance selection)
        → returns {interventions: [{key, dose, timeMinutes, targetEffect}, ...], rationale}
        → triggers Lx overlay + substance timeline

  [User clicks "Biometric Loop" button]
  ├─→ Stage 4: Biometric Model (simulate biometric data)
  │     → returns {channels: [{signal, data: [{hour, value}, ...]}, ...]}
  │     → triggers biometric strips (oscilloscope view)
  │
  └─→ Stage 5: Revision Model (Biometric-Informed Re-evaluation)
        → returns {interventions: [...revised], rationale}
        → triggers animated revision scan (pick-and-place animation)
```

Stages 1 and 2 run **in parallel**. Stage 3 may be pre-computed in the background while the user views Stages 1–2 results. Stage 4 and 5 run sequentially.

### Prompt Templates (`src/prompts.ts`)

Prompts are externalized in `src/prompts.ts` using `{{placeholder}}` syntax, interpolated at runtime by `interpolatePrompt()`.

| Template | Purpose |
|----------|---------|
| `PROMPTS.fastModel` | Stage 1: effect identification |
| `PROMPTS.curveModel` | Stage 2: baseline/desired curves |
| `PROMPTS.intervention` | Stage 3: substance selection |
| `PROMPTS.biometric` | Stage 4: biometric data simulation |
| `PROMPTS.revision` | Stage 5: intervention revision |

### JSON Parsing

A robust multi-JSON parser (`extractAndParseJSON`) handles markdown fences, conversational wrapping, trailing commas, unescaped quotes, and LLM self-corrections (returning multiple JSON objects).

---

## Phase Chart System

### Chart Configuration (SVG 960×500)

- **X-axis**: Time of day, 06:00 to 06:00 next day (24 hours)
- **Y-axis**: Effect level, 0 to 100 (one per effect, left and/or right)
- **Grid**: Vertical lines every 2 hours, horizontal every 25%
- **Sample interval**: 15 minutes per curve point
- **Max effects**: 1 or 2 (user-configurable via settings dropdown)

### Y-Axis Level Descriptors

Each effect curve has 5 intensity descriptors (from LLM) mapped to the Y-axis. They appear as hoverable labels on the Y-axis ticks.

### Curve Types

| Curve | Style | Purpose |
|-------|-------|---------|
| Baseline | Dashed, subdued | Natural circadian state (no supplementation) |
| Desired | Solid, bright, with fill | Target state the user wants to achieve |
| Lx | Solid, glowing, with fill | Predicted state with optimal supplementation |

### Polarity

Each effect has a polarity (`higher_is_better` or `higher_is_worse`). Mission arrows and Lx interventions respect polarity direction.

### Split-Screen Effect Divider

When 2 effects are active, a draggable vertical divider splits the chart at ~6pm. Each side shows its "owned" effect at full opacity while the other fades to a ghost (12% opacity). SVG masks with linear gradients create a smooth 50px crossfade zone.

---

## Phase Flow & Animation Sequence

### State Machine

```
idle
  ↓ [submit prompt]
loading → prompt slides up, chart container fades in
  ↓
scanning → X-axis builds, scan line sweeps left→right
  ↓ [fast model returns effects]
word-cloud → effect bubbles appear in center (if ≥3 effects)
  ↓ [main model returns curves]
word-cloud-dismiss → orbital rings morph into baseline curve paths
  ↓
axes-revealed → Y-axes build (left/right per effect)
  ↓
baseline-shown → baseline curves render (PHASE 0)
  ↓
curves-drawn → baseline morphs to desired, arrows appear (PHASE 1)
  ↓ [user clicks Lx button]
lx-sequential → substance timeline animates in, incremental Lx overlay
  ↓
lx-rendered → final Lx state, playhead available (PHASE 2)
  ↓ [user starts Biometric Loop]
biometric-rendered → Biometric strips reveal (PHASE 3)
  ↓
revision-rendered → Revision diff applied to Lx (PHASE 4)
```

### Phase Step Controls

Five navigable phases via `< >` chevrons:
- **Phase 0** (`baseline-shown`): Natural circadian baseline
- **Phase 1** (`curves-drawn`): Baseline + desired improvement overlay
- **Phase 2** (`lx-rendered`): Lx intervention curves + substance timeline
- **Phase 3** (`biometric-rendered`): Biometric oscilloscope view
- **Phase 4** (`revision-rendered`): Revised Lx overlay post-biometric feedback

Users can step forward/backward between phases. State preserved when stepping back.

---

## Lx Intervention System

"Lx" is the intervention overlay that shows how supplements will modulate the user's pharmacodynamic curves.

### Pipeline

1. **Intervention Model** (`callInterventionModel()`) — LLM selects substances, doses, and exact timing (minutes-since-midnight) to close the gap between baseline and desired curves
2. **Validation** (`validateInterventions()`) — Maps each intervention to the substance database, confirms target effect axes, supports multi-vector impacts
3. **Overlay Computation** (`computeLxOverlay()`) — For each curve, sums pharmacokinetic effects of all interventions using `substanceEffectAt()`, applies scale factors, clamps to [0,100]
4. **Incremental Snapshots** (`computeIncrementalLxOverlay()`) — Pre-computes intermediate states showing cumulative effect as each substance is added
5. **Sequential Reveal** (`animateSequentialLxReveal()`) — Animates each substance's contribution one-by-one with timeline pills, AUC bands, and playhead sweeps.

### Pharmacokinetic Model (`substanceEffectAt`)

5-phase piecewise curve per substance dose: Ramp-up (quadratic), Rising (ease-out), Plateau, Decay (exponential), Post-duration (residual decay minus rebound).

### Substance Timeline

FCP (Final Cut Pro)-style swim lanes below the chart:
- Each substance gets a colored pill bar positioned at its dose time
- Bar width represents substance duration
- Connector line from pill to target effect curve with a dot
- Lane allocation avoids overlap (`allocateTimelineLanes()`)
- Hover dimming: siblings fade, hovered pill isolates (bidirectional with AUC bands)

### Playhead Morph Reveal

After Lx renders, a draggable vertical playhead line appears:
- **Left of playhead**: shows desired curves (what user wants)
- **Right of playhead**: shows Lx curves (what supplements achieve)
- **At playhead**: smooth cubic interpolation blending both
- Dots, connectors, and arrows update in real-time during drag

---

## Biometric Loop & Revision

The app can simulate biometric feedback based on the prescribed stack and user profile, then dynamically adjust the stack.

### Biometric Strips
- User selects virtual devices (e.g. Apple Watch, Whoop) and provides a profile context.
- LLM generates 24-hour time-series data for signals (e.g. HR, HRV, Stress, Sleep Score).
- Strips are rendered as oscilloscope-style waveforms below the timeline using monotone cubic interpolation.

### Revision Animation
- LLM re-evaluates the stack based on biometric gaps.
- A mechanistic pick-and-place animation (`animateRevisionScan()`) highlights the changes (moved, resized, replaced, removed, added).
- "Target brackets" lock onto pills before the action fires, creating an intelligent scanning feel.
- Lx curves morph to the revised state.

---

## Visual Effects

- **Scan Line**: Animated vertical gradient line sweeps during model calls.
- **Word Cloud & Orbital Rings**: Effect names wobble, then morph into baseline curve paths over 1400ms.
- **Mission Arrows**: Point from baseline to desired curve at peak divergence points.
- **Peak Descriptors**: Labels placed at curve maxima/minima.
- **AUC Bands**: Shaded areas showing the cumulative impact of an intervention.

---

## Code Structure (Vite & TypeScript)

The codebase has been refactored into a modern Vite + TypeScript setup.

- `src/main.ts`: Entry point, event handlers, phase flow orchestration
- `src/state.ts`: Global state definitions (`AppState`, `PhaseState`, `BiometricState`, `RevisionState`, `DividerState`)
- `src/substances.ts`: Substance database and resolution logic
- `src/llm-pipeline.ts`: LLM API wrappers, generic fetch logic, JSON parsing
- `src/curve-utils.ts`: Monotone cubic interpolation, morphing math
- `src/lx-system.ts`: Pharmacokinetics, overlay computation, FCP timeline layout, sequential animation
- `src/biometric.ts`: Biometric data simulation, strip rendering, revision pick-and-place animation
- `src/phase-chart.ts`: SVG building, axes, grid, labels, morph transitions
- `src/phase-controls.ts`: Phase stepper (`< >`) logic
- `src/word-cloud.ts`: Word cloud and orbital rings
- `src/divider.ts`: Split-screen effect divider logic
- `src/debug-panel.ts`: LLM Pipeline inspector slide-in
- `src/prompts.ts`: Prompt templates
- `src/utils.ts`: SVG element creation, throttling, DOM helpers, chart theming

---

## Debug Panel

Slide-in panel (right side, 480px wide) showing the full LLM pipeline.
- Entry types: User Input, Fast Model, Main Model, Intervention Model, Biometric Model, Revision Model, Error
- Includes elapsed time, request/response bodies, and raw JSON toggle.
- Allows exporting biometric logs to a JSON file.

---

## Theme System

Light/dark mode toggle persisted in `localStorage`. Chart colors dynamically computed via `chartTheme()`.

---

## Responsive Behavior

- Desktop (>768px): Full width, max 1120px
- Tablet (<768px): Reduced padding, stacked layout
- Mobile (<480px): Tighter spacing

---

## Legacy Cartridge System

The original cartridge system remains in code (`src/cartridge.ts`, `#cartridge-section`) but is hidden. The active 5-stage pipeline is the primary flow.

---

## Key Design Decisions

1. **Pure SVG** for all visualizations — no Canvas, no external chart libs
2. **Multi-stage LLM pipeline** — parallel execution where possible, separated concerns.
3. **Robust JSON extraction** — custom parser to handle LLM quirks.
4. **requestAnimationFrame** for all continuous animations (scan line, playhead drag, morphing)
5. **Incremental Lx reveal** — substances animate in showing cumulative effect via AUC bands.
6. **Playhead morph** — draggable before/after comparison.
7. **Biometric Loop** — simulates feedback, applies a pick-and-place animated revision.
8. **Split-Screen Divider** — intuitive handling of 2-effect visualizations.
9. **TypeScript & Modules** — organized codebase without a heavy framework, using Vite.