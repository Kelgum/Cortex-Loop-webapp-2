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

### Agent Naming Scheme

The pipeline uses **agents** as the generic term for each LLM-powered stage (not "model" or "LLM"). The collection of agents is referred to as **The Cortex** or **The Loop**.

**Individual agent names** (Chess/Strategy theme):

| Stage | Agent Name | Role |
|-------|------------|------|
| 1 | **Scout** | Effect identification — scouts relevant pharmacodynamic effects |
| 2 | **Strategist** | Pharmacodynamic curves — maps baseline vs desired 24-hour landscape |
| 3 | **Chess Player** | Substance selection — prescribes protocol, anticipates interactions |
| 4 | **Spotter** | Biometric simulation — spots/simulates wearable data |
| 5 | **Grandmaster** | Protocol revision — re-evaluates based on biometric feedback |

These names appear in the Debug Panel (e.g. "Scout", "Chess Player") and in documentation. Use "agent" when referring to the unit generically: "the Scout agent", "each pipeline agent".

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
  ├─→ Stage 1: Scout (effect identification)
  │     → returns {effects: [{name, relevance}, ...]}
  │     → triggers word cloud + scan line animation
  │
  └─→ Stage 2: Strategist (pharmacodynamic curves) [parallel with Stage 1]
        → returns {curves: [{effect, color, polarity, levels, baseline[], desired[]}, ...]}
        → triggers baseline → desired curve rendering

  [User clicks "Lx" button]
  └─→ Stage 3: Chess Player (substance selection)
        → returns {interventions: [{key, dose, timeMinutes, targetEffect}, ...], rationale}
        → triggers Lx overlay + substance timeline

  [User clicks "Biometric Loop" button]
  ├─→ Stage 4: Spotter (simulate biometric data)
  │     → returns {channels: [{signal, data: [{hour, value}, ...]}, ...]}
  │     → triggers biometric strips (oscilloscope view)
  │
  └─→ Stage 5: Grandmaster (Biometric-Informed Re-evaluation)
        → returns {interventions: [...revised], rationale}
        → triggers animated revision scan (pick-and-place animation)
```

Stages 1 and 2 run **in parallel**. Stage 3 may be pre-computed in the background while the user views Stages 1–2 results. Stage 4 and 5 run sequentially.

### Prompt Templates (`src/prompts.ts`)

Prompts are externalized in `src/prompts.ts` using `{{placeholder}}` syntax, interpolated at runtime by `interpolatePrompt()`.

| Template | Agent | Purpose |
|----------|-------|---------|
| `PROMPTS.fastModel` | Scout | Stage 1: effect identification |
| `PROMPTS.curveModel` | Strategist | Stage 2: baseline/desired curves |
| `PROMPTS.intervention` | Chess Player | Stage 3: substance selection |
| `PROMPTS.biometric` | Spotter | Stage 4: biometric data simulation |
| `PROMPTS.revision` | Grandmaster | Stage 5: intervention revision |

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

## Global Animation Timeline Engine

All animations are managed by a single `TimelineEngine` that owns one `requestAnimationFrame` loop. Every animation is a declarative **segment** on a scrubable timeline. A fixed-bottom ribbon UI shows colored segments, phase boundaries, and a draggable playhead. Seeking to any position reconstructs the exact visual state.

### Architecture Overview

```
src/timeline-engine.ts      — Core engine: single rAF loop, segment registry, play/pause/seek
src/timeline-ribbon.ts      — Canvas-based bottom ribbon UI (colored segments, playhead, tooltips)
src/timeline-builder.ts     — Assembles segments in temporal order, registers with engine
src/timeline-segments/      — Segment implementations by category:
  ├── curves-segments.ts       Baseline reveal, morph to desired, arrows, peak labels, Y-axis indicators
  ├── word-cloud-segments.ts   Word entrance, float, dismiss, ring morph
  ├── lx-segments.ts           Transmute, per-substance sweep, cinematic playhead, pills
  ├── biometric-segments.ts    Biometric strip reveals
  ├── revision-segments.ts     Bracket lock-on, pick-and-place, Lx morph
  ├── scan-line-segments.ts    Looping scan line loading indicators
  └── transition-segments.ts   Prompt slide, axis builds, gate markers
```

### Two Operating Modes

1. **Record-only mode** (first run): Imperative code in `main.ts` drives all visuals directly. The engine only tracks `currentTime` for the ribbon playhead. Segments are registered for their timing/layout but `renderAtTime()` is not called.
2. **Engine-driven mode** (scrub/replay): When the user clicks the ribbon or presses play, `transitionToEngineDriven()` clears all SVG groups, resets segment lifecycle flags, and `renderAtTime()` reconstructs the visual state purely from segments.

### The AnimationSegment Interface

Every animation must implement this interface:

```typescript
interface AnimationSegment {
  id: string;                  // Unique identifier
  label: string;               // Display name on ribbon
  category: SegmentCategory;   // Color category (see below)
  startTime: number;           // ms offset on global timeline
  duration: number;            // ms (0 = instant, Infinity = variable)
  phaseIdx: number;            // Pipeline phase (0-4)

  enter(ctx: SegmentContext): void;    // Create SVG elements
  render(progress: 0..1, ctx: SegmentContext): void;  // Update visual state
  exit(ctx: SegmentContext): void;     // Remove elements (backward seek cleanup)

  loopPeriod?: number;         // For looping segments (scan lines)
}
```

### Segment Lifecycle Rules (CRITICAL)

The engine calls segment methods based on the current seek time:

| Condition | Calls | Purpose |
|-----------|-------|---------|
| **Active** (`startTime <= time < endTime`) | `enter()` then `render(progress)` | Show animation at current progress |
| **Past** (`time >= endTime`) | `enter()` then `render(1)` | Show completed final state |
| **Future** (`time < startTime`) | `exit()` | Clean up for backward seek |

**Key rules for writing segments:**

1. **`enter()` must be re-entrant.** It will be called again after `exit()` during forward-then-backward-then-forward scrubbing. Always clear/reset state at the start of `enter()`.

2. **`render(t)` must be idempotent.** Calling `render(0.5)` after `render(0.8)` must produce the correct visual for `t=0.5`. Never accumulate state across `render()` calls — always compute from the progress value `t` alone.

3. **`exit()` must undo everything `enter()` created.** This is the backward-seek cleanup. If `enter()` creates SVG elements, `exit()` must remove them. If `enter()` modifies existing elements, `exit()` must restore them.

4. **Segment ownership:** Each segment's `exit()` must ONLY clean up elements that IT created in `enter()`. Never remove elements belonging to other segments. For example, a "fade" segment should restore opacity on elements it dimmed, not remove elements created by a "create" segment.

5. **Non-group artifacts:** If a segment creates elements OUTSIDE tracked SVG groups (e.g., the divider creates `#effect-divider` and `<defs>` entries), those must be explicitly cleaned up in `exit()` because `transitionToEngineDriven()` only clears tracked groups via `innerHTML = ''`.

6. **`render(1)` = the completed visual state.** Past segments are NOT exited — they stay at `render(1)`. This means `render(1)` must produce a complete, stable visual. Don't rely on `exit()` to finalize anything for forward playback.

7. **Snapshot pattern for non-idempotent data:** If your animation reads current DOM positions (which change over time), capture them once on the first `render()` call and interpolate from the snapshot. Example:
   ```typescript
   let snapshots: {...}[] | null = null;
   render(t, ctx) {
     if (!snapshots) snapshots = captureCurrentPositions();
     // Interpolate from snapshots[i] using t
   }
   exit(ctx) { snapshots = null; }
   ```

### Segment Categories (Ribbon Colors)

| Category | Dark Color | Light Color | Used For |
|----------|-----------|-------------|----------|
| `word-cloud` | `#6ec8ff` | `#2563eb` | Word entrance, float, dismiss, ring morph |
| `scan-line` | `#06b6d4` | `#0891b2` | Loading indicator scan lines |
| `curves` | `#22c55e` | `#16a34a` | Baseline, desired, arrows, peak labels, Y-axis indicators |
| `lx-reveal` | `#f5c850` | `#d97706` | Transmute, substance sweeps, cinematic playhead |
| `biometric` | `#ff4d4d` | `#dc2626` | Biometric strip reveals |
| `revision` | `#a855f7` | `#9333ea` | Revision diff entries, Lx morph |
| `transition` | `#64748b` | `#94a3b8` | Prompt slide, axis builds, transmute |
| `gate` | `#f59e0b` | `#d97706` | User interaction pauses (zero-width markers) |

### SegmentContext

Segments receive a shared context object with references to SVG groups and pipeline data:

```typescript
interface SegmentContext {
  svgRoot: SVGSVGElement;
  groups: Record<string, SVGGElement>;  // All #phase-* groups
  curvesData: any | null;               // From Stage 2 (Strategist)
  interventions: any[] | null;          // Validated interventions
  lxCurves: any[] | null;               // Final Lx overlay curves
  incrementalSnapshots: any[] | null;   // Per-substance Lx states
  biometricChannels: any[] | null;      // Biometric strip data
  revisionDiff: any[] | null;           // Revision diff entries
  wordCloudEffects: any[] | null;       // Effect names from Scout
}
```

Context data is populated progressively as LLM calls complete. Check for `null` before using.

### Variable-Duration Segments

Scan lines run until an LLM returns. Register with `duration: Infinity`. When the LLM returns, call `engine.resolveDuration(segmentId, actualMs)`. This shifts all subsequent segments. On replay, the recorded duration is used.

### Gate Segments

User interaction pauses (Optimize button, Play button, Biometric trigger) are **zero-width markers** (`duration: 0`). During first playthrough, the engine pauses at gates until `engine.resolveGate(id)` is called. On scrub/replay, gates are skipped.

### First-Run Playhead Tracking Contract (MUST FOLLOW)

First run is hybrid: visuals are imperative, timeline is record-only. Any new feature/animation added to first run MUST follow these rules:

1. **Record-only playhead is never authoritative for visuals.** It only mirrors time in the ribbon.
2. **Each async animation window must have explicit playhead behavior:**
   - running continuously (its own rAF tracker), or
   - explicitly paused at a gate/wait.
3. **Do not let wall-clock playhead advance during user waits.**
   - If a flow waits for user input (stepper/confirmation), pause tracking at current timeline time.
   - Resume by rebasing from `engine.getCurrentTime()` when wait ends.
4. **All tracker rAF IDs must be globally discoverable and cleaned up** on resubmit/abort/phase handoff.
5. **Never call `engine.seek()` / `engine.play()` while `TimelineState.interactionLocked` is true.**
   - This forces engine-driven mode mid-imperative run and desyncs state.
   - Any UI control that can seek/play (e.g. stepper "Prev") must be disabled/guarded during lock.
6. **Replay pre-segmentation estimates must be data-driven.**
   - If a segment is pre-added before final data exists (e.g. biometric scan lanes), estimate from real selected devices/input, then resolve with actual duration/count when data returns.

### Timing Parity Rules (Imperative vs Segment Timeline)

Imperative animation timing and `timeline-builder.ts` timing must match exactly.

- If imperative flow has a fixed delay/gap, timeline segments must encode the same value.
- If timeline builder uses `GAP_BETWEEN_SUBSTANCES = 200`, runtime stepper/autoplay waits must also use 200ms.
- If reveal duration is computed (example: `600 + (channels - 1) * 80`), use the same formula for playhead tracking and segment durations.
- Any mismatch causes cumulative ribbon drift even when visuals look correct.

### Phase Index & Boundary Rules

- `phaseIdx` must match the logical phase that owns the segment.
- Gates at phase boundaries must be tagged to the destination phase consistently (example: biometric gate belongs to phase 3 boundary, not phase 2).
- Wrong `phaseIdx` breaks `seekToPhase()` boundary math and causes stepper jumps to land in the wrong visual state.

### Resubmit / Teardown Safety Checklist

Before starting a new prompt run:

1. Stop all playhead trackers (prompt, biometric scan, biometric reveal, revision if active).
2. Clear any cross-module wait hooks/callbacks used for pausing/resuming trackers.
3. Destroy old `TimelineEngine` and `TimelineRibbon`.
4. Ensure ribbon `destroy()` removes all window/canvas/button listeners (no listener leaks across runs).
5. Reset transient timeline state (`_bioScanWallStart`, `_bioScanTimelineStart`, etc.).

### Adding a New Segment — Step by Step

1. **Create the segment factory** in the appropriate file under `src/timeline-segments/`:
   ```typescript
   export function createMyNewSegment(startTime: number, ...data): AnimationSegment {
     let myElements: SVGElement[] = [];  // Track what you create

     return {
       id: 'my-new-segment',
       label: 'My Segment',
       category: 'curves',  // Pick from SegmentCategory
       startTime,
       duration: 1000,      // ms
       phaseIdx: 1,         // Which pipeline phase (0-4)

       enter(ctx) {
         const group = ctx.groups['phase-my-group'];
         if (!group) return;
         group.innerHTML = '';       // Clear previous state (re-entrant!)
         myElements = [];

         // Create SVG elements
         const el = svgEl('path', { d: '...', fill: 'red' });
         group.appendChild(el);
         myElements.push(el);
       },

       render(t, ctx) {
         // Pure function of t (0..1) — no accumulated state!
         const ease = easeOutCubic(t);
         for (const el of myElements) {
           el.setAttribute('opacity', ease.toFixed(2));
         }
       },

       exit(ctx) {
         // Undo everything enter() did
         const group = ctx.groups['phase-my-group'];
         if (group) group.innerHTML = '';
         myElements = [];
       },
     };
   }
   ```

2. **Register the segment** in `src/timeline-builder.ts` within the appropriate `buildPhaseNSegments()` function:
   ```typescript
   import { createMyNewSegment } from './timeline-segments/my-segments';

   export function buildPhase1Segments(engine, startTime) {
     let t = startTime;
     // ... existing segments ...
     engine.addSegment(createMyNewSegment(t, ...data));
     t += 1000; // advance cursor by segment duration
     return t;
   }
   ```

3. **If the segment needs new data from an LLM call**, add the field to `SegmentContext` in `timeline-engine.ts` and populate it in `main.ts` before building the segments:
   ```typescript
   engine.getContext().myNewData = result;
   ```

4. **If the segment uses a new SVG group**, add the group to `index.html` inside `#phase-chart-svg` and add its ID to the `groupIds` array in the `TimelineEngine` constructor.

5. **If the segment creates elements outside tracked groups** (like the divider does), ensure those are cleaned up in both:
   - The segment's own `exit()` method
   - `transitionToEngineDriven()` in `timeline-engine.ts` (for the first transition from record-only mode)

### Common Pitfalls

- **Non-idempotent render():** Reading current DOM state and pushing further each frame. Use the snapshot pattern instead.
- **Cross-segment cleanup:** A "dismiss" segment removing elements created by an "entrance" segment. Each segment owns only its own elements.
- **Missing exit() cleanup:** If `enter()` modifies shared groups (e.g., dimming baseline strokes), `exit()` must restore them.
- **Forgetting to clear in enter():** Always `group.innerHTML = ''` or reset tracking arrays at the start of `enter()` — it may be called multiple times during scrubbing.
- **Elements outside groups:** The `#effect-divider`, mask definitions in `<defs>`, and similar standalone elements are NOT cleared by `transitionToEngineDriven()` unless explicitly handled.
- **viewBox expansion:** If your segment expands the SVG viewBox (e.g., for timeline lanes or biometric strips), `exit()` must restore the previous viewBox height.
- **Timing drift:** Imperative delay constants diverging from `timeline-builder.ts` durations/gaps.
- **Wait-state drift:** Letting playhead tracking continue while waiting for user input (stepper/gate UI).
- **Mode race:** Triggering timeline seek/play from custom controls while `TimelineState.interactionLocked` is true.
- **Hardcoded pre-estimates:** Using fixed lane/strip counts for variable data (biometric/device-driven segments).

### Timeline Ribbon UI

The ribbon is a fixed 76px bar at the bottom of the viewport (`#timeline-ribbon`). It contains:
- **Play/Pause** button and **Speed** selector (0.25x–4x)
- **Time display** (current / total)
- **Canvas** showing colored segment blocks, phase boundary markers (P0–P4), a draggable playhead, hover tooltips, and a hover playhead (FCP-style thin line following cursor)

The ribbon appears when the pipeline starts and hides on reset. CSS class `body.timeline-active` adjusts the chart's max-height to make room.

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

Slide-in panel (right side, 480px wide) showing the full pipeline (The Cortex).
- **Agent entries**: Scout, Strategist, Chess Player, Spotter, Grandmaster (see Agent Naming Scheme)
- User Input and Error entries for bookends
- Includes elapsed time, request/response bodies, and raw JSON toggle
- Allows exporting biometric logs to a JSON file

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
2. **Multi-stage LLM pipeline** — parallel execution where possible, separated concerns
3. **Agent naming** — "agent" as generic term; Chess theme (Scout, Strategist, Chess Player, Spotter, Grandmaster); "The Cortex" or "The Loop" for the collection
4. **Robust JSON extraction** — custom parser to handle LLM quirks
5. **requestAnimationFrame** for all continuous animations (scan line, playhead drag, morphing)
6. **Incremental Lx reveal** — substances animate in showing cumulative effect via AUC bands
7. **Playhead morph** — draggable before/after comparison
8. **Biometric Loop** — simulates feedback, applies a pick-and-place animated revision
9. **Split-Screen Divider** — intuitive handling of 2-effect visualizations
10. **TypeScript & Modules** — organized codebase without a heavy framework, using Vite
