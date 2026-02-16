# Cortex Loop — Application Spec

## Overview

Cortex Loop is a prompt-driven pharmacodynamic visualizer. The user describes a desired cognitive/physical outcome (e.g. "4 hours of deep focus"), and a multi-stage LLM pipeline: (1) identifies relevant pharmacodynamic effects, (2) models 24-hour baseline vs desired curves, and (3) selects an optimal supplement intervention protocol — all visualized as animated SVG charts with interactive before/after comparison.

**Stack:** Vanilla HTML/CSS/JS. No frameworks, no build step. Single-page app served from `index.html`.

**Files:**
- `index.html` — Structure (prompt, phase chart SVG, legacy cartridge, footer)
- `styles.css` — Dark/light theme styling, animations, responsive layout
- `app.js` — All logic (~6200 lines): substance database, multi-model LLM pipeline, SVG rendering, animation engine, phase chart system, Lx intervention engine
- `prompts.js` — Externalized prompt templates with `{{placeholder}}` interpolation
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
│   + Optimize / Lx buttons                     │
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
  <g id="phase-lx-curves">         Lx intervention overlay curves
  <g id="phase-lx-markers">        Dose markers on Lx curves
  <g id="phase-substance-timeline"> FCP-style substance swim lanes
  <g id="phase-mission-arrows">    Arrows showing baseline→desired gap
  <g id="phase-legend">            Curve legend
  <g id="phase-tooltip-overlay">   Hover tooltips
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

**Fast Models** (effect identification — Stage 1):
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

API keys stored in `localStorage` (`cortex_key_{provider}`). Model selection stored as `cortex_llm`. Falls back to `config.js` if present.

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
```

Stages 1 and 2 run **in parallel**. Stage 3 may be pre-computed in the background while the user views Stages 1–2 results.

### Prompt Templates (prompts.js)

Prompts are externalized in `prompts.js` using `{{placeholder}}` syntax, interpolated at runtime by `interpolatePrompt()`.

| Template | Purpose | Key Placeholders |
|----------|---------|------------------|
| `PROMPTS.fastModel` | Stage 1: effect identification | `{{maxEffects}}` |
| `PROMPTS.curveModel` | Stage 2: baseline/desired curves | `{{maxEffects}}`, `{{maxEffectsPlural}}` |
| `PROMPTS.intervention` | Stage 3: substance selection | `{{substanceList}}`, `{{curveSummary}}` |

### Fallback Engine

If no API key or API call fails, algorithmic fallbacks generate plausible results without an LLM:
- `generateStackFallback()` — keyword-based stack building
- `generateInterventionFallback()` — gap-direction-based substance selection

---

## Phase Chart System

### Chart Configuration (SVG 960×500)

- **X-axis**: Time of day, 06:00 to 06:00 next day (24 hours)
- **Y-axis**: Effect level, 0 to 100 (one per effect, left and/or right)
- **Grid**: Vertical lines every 2 hours, horizontal every 25%
- **Sample interval**: 15 minutes per curve point
- **Max effects**: 1 or 2 (user-configurable via settings dropdown)

### Y-Axis Level Descriptors

Each effect curve has 5 intensity descriptors (from LLM) mapped to the Y-axis:
- `0%` — e.g. "No focus"
- `25%` — e.g. "Easily distracted"
- `50%` — e.g. "Steady awareness"
- `75%` — e.g. "Deep concentration"
- `100%` — e.g. "Flow state"

These appear as hoverable labels on the Y-axis ticks.

### Curve Types

| Curve | Style | Purpose |
|-------|-------|---------|
| Baseline | Dashed, subdued | Natural circadian state (no supplementation) |
| Desired | Solid, bright, with fill | Target state the user wants to achieve |
| Lx | Solid, glowing, with fill | Predicted state with optimal supplementation |

### Polarity

Each effect has a polarity:
- `higher_is_better` — Focus, Energy, Resilience (desired > baseline = improvement)
- `higher_is_worse` — Anxiety, Pain, Reactivity (desired < baseline = improvement)

Mission arrows and Lx interventions respect polarity direction.

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
```

### Phase Step Controls

Three navigable phases via `< >` chevrons:
- **Phase 0** (`baseline-shown`): Natural circadian baseline
- **Phase 1** (`curves-drawn`): Baseline + desired improvement overlay
- **Phase 2** (`lx-rendered`): Lx intervention curves + substance timeline

Users can step forward/backward between phases. State preserved when stepping back.

### Animation Inventory

| Animation | Duration | Trigger |
|-----------|----------|---------|
| Prompt slide up | 700ms | Prompt submit |
| Chart fade in | 650ms | After prompt slides |
| X-axis reveal | 500ms | Chart visible |
| Scan line sweep | Continuous | During model calls |
| Word cloud appear | 400ms staggered | Fast model returns |
| Orbital rings | Continuous (rAF) | Word cloud shown |
| Ring→curve morph | 1400ms | Main model returns |
| Y-axis build | 400-500ms | After morph |
| Baseline curves | 800ms clip reveal | Axes done |
| Baseline→desired morph | 1200ms | After baseline shown |
| Mission arrows | 600ms stagger | During morph |
| Peak descriptors | 300ms stagger | After morph |
| Lx sequential reveal | 400ms per substance | After intervention model |
| Substance timeline pills | 400ms stagger | During Lx reveal |
| Playhead morph | Real-time (drag) | After Lx rendered |
| Phase step transition | 400ms | Step < > click |

---

## Lx Intervention System

"Lx" is the intervention overlay that shows how supplements will modulate the user's pharmacodynamic curves.

### Pipeline

1. **Intervention Model** (`callInterventionModel()`) — LLM selects substances, doses, and exact timing (minutes-since-midnight) to close the gap between baseline and desired curves
2. **Validation** (`validateInterventions()`) — Maps each intervention to the substance database, confirms target effect axes
3. **Overlay Computation** (`computeLxOverlay()`) — For each curve, sums pharmacokinetic effects of all interventions using `substanceEffectAt()`, applies polarity, clamps to [0,100]
4. **Incremental Snapshots** (`computeIncrementalLxOverlay()`) — Pre-computes intermediate states showing cumulative effect as each substance is added
5. **Sequential Reveal** (`animateSequentialLxReveal()`) — Animates each substance's contribution one-by-one with timeline pills

### Pharmacokinetic Model (`substanceEffectAt`)

5-phase piecewise curve per substance dose:

1. **Onset** (0 → onset min): Quadratic ramp `strength × t²`
2. **Rising** (onset → peak): Ease-out to peak `strength × (0.7 + 0.3 × easeOut)`
3. **Plateau** (peak → 60% duration): Gradual decline `strength × (1 - decay × 0.15)`
4. **Decay** (60% → 100% duration): Exponential `strength × 0.85 × 0.5^(t/halfLife)`
5. **Post-duration** (beyond): Residual decay minus rebound dip

### Substance Timeline

FCP (Final Cut Pro)-style swim lanes below the chart:
- Each substance gets a colored pill bar positioned at its dose time
- Bar width represents substance duration
- Connector line from pill to target effect curve
- Lane allocation avoids overlap (`allocateTimelineLanes()`)
- Hover dimming: siblings fade, hovered pill isolates

### Playhead Morph Reveal

After Lx renders, a draggable vertical playhead line appears:
- **Left of playhead**: shows desired curves (what user wants)
- **Right of playhead**: shows Lx curves (what supplements achieve)
- **At playhead**: smooth cubic interpolation blending both
- Dots, connectors, and arrows update in real-time during drag

---

## Visual Effects

### Scan Line
Animated vertical gradient line (`rgba(160,160,255,0.6)`) that sweeps left→right across the chart during model calls. Mix-blend-mode: screen.

### Word Cloud
Effect names from the fast model rendered as text bubbles in a circular layout. Font size proportional to relevance score. Animated scale/opacity entrance.

### Orbital Rings
Two tilted SVG ellipses that wobble around the word cloud using `requestAnimationFrame`. When curves arrive, ring points map to curve paths and morph over 1400ms.

### Mission Arrows
Arrow markers (with arrowhead) pointing from baseline to desired curve at peak divergence points. Color-matched to effect. Fade out when Lx overlay takes over.

### Peak Descriptors
Labels placed at curve peaks (maxima) and troughs (minima) showing the hour and effect level. Background boxes are theme-aware.

---

## State Management

### `AppState` (global)
```
currentStack       — Parsed stack array from LLM
isLoading          — API call in progress
isAnimating        — Fill/eject animation active
capsuleElements    — { front: [], back: [] } SVG group refs
filledSlots        — Map<globalSlot, substanceKey>
effectCurves       — Computed curve data for chart
includeRx          — Rx toggle state
includeControlled  — Controlled toggle state
maxEffects         — Number of effects to model (1 or 2)
selectedLLM        — 'anthropic' | 'openai' | 'grok' | 'gemini'
apiKeys            — { anthropic, openai, grok, gemini }
```

### `PhaseState` (global)
```
isProcessing       — Pipeline in progress
effects            — Parsed effects from fast model
wordCloudEffects   — [{name, relevance}, ...] for word cloud
curvesData         — Parsed curves from main model
phase              — Current phase string (see state machine above)
interventionPromise — Promise for background intervention computation
interventionResult  — Parsed intervention result
lxCurves           — Computed Lx overlay curves
incrementalSnapshots — Array of per-substance Lx snapshots
maxPhaseReached    — Highest completed phase index (0/1/2)
viewingPhase       — Currently displayed phase index
```

### `CartridgeConfig` (global, legacy)
```
capsulesPerLayer   — Dynamically computed based on stack size
totalCapsules      — capsulesPerLayer × 2
angularSpacing     — 360 / capsulesPerLayer
capsuleGroups      — Flat array of all capsule metadata
frontCapsule       — { width, height, rx } scaled to fit
backCapsule        — Smaller version (77% width, 80% height)
```

---

## Data Flow Summary

```
User prompt
  ├─→ callFastModel()                    [Stage 1: fast model, parallel]
  │     → {effects: [{name, relevance}]}
  │     → renderWordCloud()
  │     → startOrbitalRings()
  │
  └─→ callMainModelForCurves()           [Stage 2: main model, parallel]
        → {curves: [{effect, polarity, levels, baseline[], desired[]}]}
        → stopScanLine()
        → morphRingsToCurves()           (orbital rings → curve paths)
        → dismissWordCloud()
        → buildPhaseYAxes()
        → buildPhaseGrid()
        → renderBaselineCurves()          ← PHASE 0
        → morphToDesiredCurves()          ← PHASE 1
        → placePeakDescriptors()
        → showLxButton()
        → [user clicks Lx]
        → callInterventionModel()         [Stage 3: intervention model]
        → computeLxOverlay()
        → computeIncrementalLxOverlay()
        → animateSequentialLxReveal()     ← PHASE 2
        → renderSubstanceTimeline()
        → showDraggablePlayhead()
```

---

## Debug Panel

Slide-in panel (right side, 480px wide) showing the full LLM pipeline:
- **Entry types**: User Input, Fast Model, Main Model, Intervention Model, Fallback, Error
- Each entry shows: stage badge, model name, duration, system prompt (collapsible), user prompt, response (toggleable raw/parsed view)
- Color-coded badges: blue (user), yellow (fast), purple (main), teal (intervention), red (error)
- Auto-scrolls as new entries appear
- Toggle between raw JSON and formatted response view

---

## Theme System

Light/dark mode toggle persisted in `localStorage`:

| Token | Dark | Light |
|-------|------|-------|
| `--bg-base` | `#070b11` | `#f0f3f7` |
| `--bg-surface` | `#111924` | `#ffffff` |
| `--text-primary` | `#eef4ff` | `#1a2333` |
| `--text-accent` | `#6ee7ff` | `#0891b2` |

Chart colors are dynamically computed via `chartTheme()` which returns a full palette object based on `body.light-mode` class presence.

---

## Responsive Behavior

| Breakpoint | Chart | Layout |
|-----------|-------|--------|
| Desktop (>768px) | Full width, max 1120px | Phase chart centered |
| Tablet (<768px) | Reduced padding, 14px border-radius | Stacked, smaller text |
| Mobile (<480px) | Further border-radius reduction | Tighter spacing |

---

## Legacy Cartridge System (Present but Hidden)

The original cartridge system remains in code but is not active in the current UI flow. It includes:

- **SVG Cartridge** (800×800) — circular capsule wheel with front/back layers
- **5-Day System** — each substance × 5 days, day-1 highlighted
- **Timing Arcs** — MORNING/MIDDAY/EVENING/BEDTIME quadrants
- **Simulation Engine** — 18-hour playback with wheel rotation, capsule ejection, particles
- **Effect Chart** (520×360) — category-grouped pharmacokinetic curves with cursor
- **Split-View Layout** — cartridge left, chart right

The cartridge section is hidden (`#cartridge-section.hidden`) and its initialization is commented out. The simulation engine, wheel rotation, and capsule animation code remain intact for potential future use.

The legacy stack LLM pipeline has been removed: `PROMPTS.stack`, `buildSystemPrompt()`, `callLLM()`, `parseJSONResponse()`, per-provider callers (`callAnthropic/OpenAI/Grok/Gemini` for stack), `sortStack()`, and `handlePromptSubmitCartridge()`. The active 3-stage pipeline (`callFastModel` → `callMainModelForCurves` → `callInterventionModel`) is unaffected.

---

## Key Design Decisions

1. **Pure SVG** for all visualizations — no Canvas, no external chart libs
2. **Multi-stage LLM pipeline** — fast model for effects, main model for curves, intervention model for substances. Parallel execution where possible
3. **Externalized prompts** (`prompts.js`) — editable templates with `{{placeholder}}` interpolation
4. **requestAnimationFrame** for all continuous animations — scan line, orbital rings, playhead drag
5. **Orbital ring → curve morphing** — smooth visual transition from word cloud to data visualization
6. **Incremental Lx reveal** — substances animate in one-by-one showing cumulative effect
7. **Playhead morph** — draggable before/after comparison for desired vs Lx curves
8. **Phase stepping** — user can navigate between baseline, desired, and Lx views
9. **Theme-aware rendering** — `chartTheme()` returns full color palette for dark/light mode
10. **Fallback engines** ensure the app works without API keys
11. **Dynamic substance resolution** — LLM can return any substance; unknown ones get registered at runtime
12. **Debug transparency** — full LLM pipeline visible in debug panel
