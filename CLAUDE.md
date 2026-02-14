# Cortex Loop — Application Spec

## Overview

Cortex Loop is a prompt-driven supplement protocol visualizer. The user describes a desired cognitive/physical outcome (e.g. "4 hours of deep focus"), an LLM formulates an optimal supplement stack, and the app visualizes it as an animated circular capsule cartridge with a pharmacokinetic effect chart and real-time dispensation simulation.

**Stack:** Vanilla HTML/CSS/JS. No frameworks, no build step. Single-page app served from `index.html`.

**Files:**
- `index.html` — Structure (prompt, SVG cartridge, chart panel, footer)
- `styles.css` — Dark-theme styling, animations, responsive layout
- `app.js` — All logic (~2300 lines): substance database, LLM integration, SVG rendering, animation engine, chart renderer, simulation engine
- `config.js` — (gitignored) Optional API key overrides

---

## Architecture

### Layout (3 zones)

```
┌─────────────────────────────────────────────┐
│  HEADER: Prompt input + Rx/Controlled toggles │
├──────────────────┬──────────────────────────┤
│   CARTRIDGE      │   EFFECT CHART           │
│   (SVG 800×800)  │   (SVG 520×360)          │
│   circular wheel │   XY time-vs-effect      │
│   + center hub   │   + cursor + markers     │
├──────────────────┴──────────────────────────┤
│  FOOTER: Summary pills (substance · dose)    │
└─────────────────────────────────────────────┘
```

Initially only the cartridge is visible (centered). After a prompt is submitted, the layout enters **split-view**: cartridge slides left, effect chart slides in from the right.

### SVG Cartridge Structure

```
<svg viewBox="0 0 800 800">
  <g id="timing-arcs">      4 colored arcs (MORNING/MIDDAY/EVENING/BEDTIME)
  <g id="timing-labels">    Arc labels at radius 375
  <g id="connector-lines">  Dashed lines from capsules to labels
  <g id="label-ring">       Substance name + dose text at radius 310
  <g id="capsule-wheel">    ← Rotatable wrapper
    <g id="back-layer">     13 capsules, 30% opacity, blur filter
    <g id="front-layer">    13 capsules, full opacity, glow on day-1
  </g>
  <g id="center-hub">       Hub circles + "READY" text / play button
</svg>
```

Center: (400, 400). Front/back capsule radius: 220px. Labels at 310px. Timing arcs at 355px.

### Capsule Geometry

Each capsule is a `<g class="capsule-group">` containing:
- `<rect class="capsule-outline">` — Empty border
- `<rect class="capsule-fill">` — Colored gradient fill

Capsules are positioned using polar coordinates. Angular spacing = 360° / capsulesPerLayer. Each capsule group is `translate(x, y) rotate(angle)` to align tangentially with the circle.

### 5-Day Cartridge System

Each substance in the stack gets `count × 5` capsules (one per day for 5 days). Day-1 capsules are full opacity with glow; days 2-5 are 25% opacity and dimmed. Total capacity: 40 capsules (20 per layer max).

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

## LLM Integration

### Supported Models
- **Anthropic Claude Opus 4.6** (default)
- **OpenAI GPT-4o**
- **Grok-3** (xAI)
- **Gemini 2.0 Flash** (Google)

API keys stored in `localStorage` (`cortex_key_{provider}`). Model selection stored as `cortex_llm`. Falls back to `config.js` if present.

### System Prompt

Dynamically built via `buildSystemPrompt()`. Includes:
- Full list of active substance keys (varies by Rx/Controlled toggle state)
- Category breakdown
- Dosing rules: max 8 substances, 1-3 capsules each, valid timings only
- Instruction to return pure JSON array
- Mode notes for Rx/Controlled when enabled

### Expected LLM Response Format

```json
[
  { "key": "caffeine", "name": "Caffeine", "category": "stimulant", "dose": "100mg", "timing": "morning", "count": 1 },
  { "key": "theanine", "name": "L-Theanine", "category": "adaptogen", "dose": "200mg", "timing": "morning", "count": 1 }
]
```

The parser handles markdown code fences and extra wrapping text. Unknown substances are dynamically registered.

### Fallback Engine

If no API key or API call fails, `generateStackFallback(prompt)` uses keyword detection (focus, energy, calm, sleep, memory, duration) to build a sensible stack without an LLM.

---

## Effect Chart System

### Chart Layout (SVG 520×360)

- **X-axis**: Time of day, 06:00 to 24:00 (18 hours)
- **Y-axis**: Effect level, 0 to 100
- **Baseline**: Dashed line at effect level 15
- **Grid**: Vertical lines every 2 hours, horizontal every 25%

### Effect Type Groupings

Substances are grouped into effect curves by category:

| Effect Curve | Categories | Color |
|-------------|------------|-------|
| Focus & Cognition | stimulant, nootropic | `#60a5fa` |
| Stress Resilience | adaptogen | `#c084fc` |
| Baseline Support | mineral, vitamin | `#4ade80` |
| Sedation | sleep | `#2dd4bf` |
| Rx Effect | rx | `#fb7185` |
| Altered State | controlled | `#fbbf24` |

### Pharmacokinetic Model (`substanceEffectAt`)

5-phase piecewise curve per substance dose:

1. **Onset** (0 → onset min): Quadratic ramp `strength × t²`
2. **Rising** (onset → peak): Ease-out to peak `strength × (0.7 + 0.3 × easeOut)`
3. **Plateau** (peak → 60% duration): Gradual decline `strength × (1 - decay × 0.15)`
4. **Decay** (60% → 100% duration): Exponential `strength × 0.85 × 0.5^(t/halfLife)`
5. **Post-duration** (beyond): Residual decay minus rebound dip (can go below baseline)

Multiple substances in the same effect group are **summed** then clamped to 100.

### Curve Rendering

Points sampled every 10 minutes. Converted to smooth cubic bezier SVG paths via `pointsToPath()`. Each curve gets a semi-transparent area fill and a stroked line. Legend in top-right corner.

---

## Simulation Engine

### Timing
- **Speed**: 20 simulated minutes per real second (~54 seconds for full 18-hour day)
- **Range**: 06:00 to 24:00
- Driven by `requestAnimationFrame` loop

### Dose Events

Built from the stack's day-1 capsules. Each event has:
```javascript
{ timeMin, key, dose, timing, globalSlot, substance, dispensed }
```

Sorted chronologically. Timing mapping: morning=08:00, midday=12:00, evening=17:00, bedtime=21:00.

### Simulation Flow

1. **Play button pressed** → capsules restored, wheel reset, cursor created
2. **Time cursor advances** across chart (vertical dashed line + HH:MM label)
3. **Curves reveal progressively** via expanding SVG clip-path
4. **At each dose time**:
   - Simulation pauses (`isPausedForDose = true`)
   - Capsule wheel **rotates** (shortest CW/CCW path) to bring target capsule to 12 o'clock
   - Capsule **ejects upward + dissolves** (brightness pulse → scale up → fade out)
   - **8 particles** spawn radially from capsule position (SMIL-animated, drift + fade)
   - **Dose marker** appears on chart (vertical line + substance dot + label)
   - Simulation resumes after 600ms
5. **At 24:00**: hub shows "COMPLETE", full chart revealed, play button reappears for replay

### Wheel Rotation

Uses SVG `transform` attribute: `rotate(deg, 400, 400)`. Animated with JS `requestAnimationFrame` (cubic ease-out, 800ms). Always rotates via shortest path (normalized ±180° delta). Immune to CSS scaling — rotation center is specified in SVG viewBox coordinates.

---

## Animation Inventory

| Animation | Duration | Trigger |
|-----------|----------|---------|
| Capsule fill | 420ms (day-1) / 250ms (other) | Stack load, staggered 70ms/25ms |
| Capsule eject | 250ms | New prompt (reverse order) |
| Label fade-in | 200ms | After fill, staggered 40ms |
| Chart slide-in | 600ms | After LLM response |
| Cartridge shrink | 600ms | Split-view transition |
| Play pulse ring | 2s infinite | While play button visible |
| Wheel rotation | 800ms | Each dose dispensation |
| Capsule dispense | 800ms | Dose event reached |
| Particles | 600-1000ms | After dispense |
| Cursor advance | Continuous | During simulation |
| Curve reveal | Continuous | During simulation (clip-path) |

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
selectedLLM        — 'anthropic' | 'openai' | 'grok' | 'gemini'
apiKeys            — { anthropic, openai, grok, gemini }
```

### `Simulation` (global)
```
isPlaying          — Animation loop running
currentTimeMin     — Current simulated time (minutes since midnight)
speed              — 20 min/sec simulated
doseEvents         — Sorted dose event queue
nextDoseIdx        — Pointer into doseEvents
wheelRotation      — Current wheel angle (degrees, can accumulate beyond 360)
isPausedForDose    — True during dispensation sequence
```

### `CartridgeConfig` (global)
```
capsulesPerLayer   — Dynamically computed based on stack size
totalCapsules      — capsulesPerLayer × 2
angularSpacing     — 360 / capsulesPerLayer
capsuleGroups      — Flat array of all capsule metadata (key, dose, timing, dayIndex, globalSlot)
frontCapsule       — { width, height, rx } scaled to fit
backCapsule        — Smaller version (77% width, 80% height)
```

---

## Data Flow Summary

```
User prompt → LLM call (or fallback)
           → JSON stack [{key, dose, timing, count}]
           → resolveSubstance (map to database)
           → sortStack (by timing)
           → computeCartridgeLayout (expand to 5-day grid)
           → rebuildCapsuleLayers (empty SVG capsules)
           → animateFillSequence (color + animate each capsule)
           → animateLabels (radial text + connectors)
           → buildEffectChart (pharmacokinetic curves)
           → showChartPanel (split-view slide)
           → showPlayButton (center hub)
           → [user clicks play]
           → startSimulation (cursor + clip reveal + dose loop)
           → dispenseCapsules (rotate wheel + eject + particles + markers)
           → endSimulation ("COMPLETE" + replay option)
```

---

## Responsive Behavior

| Breakpoint | Cartridge | Chart | Layout |
|-----------|-----------|-------|--------|
| Desktop (>768px) | min(44vw, 440px) in split | flex: 1, max 520px | Side by side |
| Tablet (<768px) | min(70vw, 340px) | max 94vw | Stacked vertically |
| Mobile (<480px) | Smaller border radius | Scaled down | Stacked, tighter spacing |

---

## Key Design Decisions

1. **Pure SVG** for both cartridge and chart — no Canvas, no external chart libs
2. **SVG `transform` attribute** for wheel rotation (not CSS transforms) — immune to scaling issues when the cartridge housing resizes in split-view
3. **SMIL animations** for particles — SVG `<animate>` elements for reliable cx/cy/r/opacity interpolation
4. **Web Animations API** for capsule fill/eject/label transitions
5. **requestAnimationFrame** for simulation tick and wheel rotation — smooth, frame-synced
6. **Progressive curve reveal** via SVG `<clipPath>` with expanding width
7. **Fallback engine** ensures the app works without API keys
8. **Dynamic substance resolution** — LLM can return any substance; unknown ones get registered at runtime
