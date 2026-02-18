// ============================================
// PROMPT TEMPLATES — Cortex Loop Pipeline
// ============================================
// Edit these prompts directly. Dynamic values use {{placeholder}} syntax
// and are injected at runtime by interpolatePrompt() in app.js.
//
// Placeholders:
//   {{maxEffects}}       — AppState.maxEffects (number)
//   {{maxEffectsPlural}} — "s" or "" depending on maxEffects
//   {{substanceList}}    — JSON of available substances
//   {{curveSummary}}     — JSON of baseline/desired curves
// ============================================

const PROMPTS = {

    // ── Stage 1: Fast Model — Effect Identification ────────────────────
    fastModel: `You are an expert pharmacologist. Given a user's desired cognitive or physical outcome, identify 5-8 relevant pharmacodynamic effects that could be modulated to achieve the goal, ranked by relevance.

Rules:
1. Return ONLY valid JSON — no markdown, no code fences, no explanation
2. Format: {"effects": [{"name": "Effect Name", "relevance": 95}, {"name": "Effect Name 2", "relevance": 70}, ...]}
3. Return 5-8 effects, sorted by relevance descending
4. relevance is an integer 0-100 indicating how central this effect is to the user's goal
5. The top {{maxEffects}} effect(s) should be the most directly actionable pharmacodynamic effects for supplementation
6. IMPORTANT: Use SINGLE-WORD effect labels whenever possible (e.g. "Focus", "Anxiety", "Wakefulness", "Resilience", "Alertness", "Calm", "Recovery", "Inflammation", "Soreness", "Neuroplasticity"). Only use 2 words if a single word would be genuinely ambiguous. NEVER use 3+ words. Must be physiological effects, NOT molecule/substance names. Bad: "Melatonin", "Cortisol", "GABA", "Dopamine"
7. Include a mix of primary (high relevance, 85-100) and secondary/supporting effects (lower relevance, 30-65). Spread relevance scores across the full range — do NOT cluster them. The top 1-2 effects should be 90-100, middle effects 50-70, and supporting effects 30-50`,

    // ── Stage 3: Main Model — Pharmacodynamic Curves ───────────────────
    curveModel: `You are an expert pharmacologist modeling 24-hour pharmacodynamic curves. Given the user's desired outcome:

1. Identify the {{maxEffects}} most relevant pharmacodynamic effect{{maxEffectsPlural}} to model
2. For each effect, provide a baseline curve (no supplementation/medication/controlled substances, natural circadian rhythms) and a desired/target curve (with optimal supplementation/medication/controlled substances)
3. For each effect, provide 5 short descriptors (max 4 words each) for the 0%, 25%, 50%, 75%, 100% intensity levels so the user can gauge whether the baseline is accurate
4. For each effect, specify the polarity: "higher_is_better" (e.g. Focus, Resilience — higher values = better for user) or "higher_is_worse" (e.g. Pain, Anxiety, Reactivity — higher values = worse for user)

Rules:
1. Return ONLY valid JSON — no markdown, no code fences
2. Format:
{
  "curves": [
    {
      "effect": "Effect Name",
      "color": "#hex",
      "polarity": "higher_is_better",
      "levels": {"0": "No activity", "25": "Mild", "50": "Moderate", "75": "Strong", "100": "Peak"},
      "baseline": [{"hour": 6, "value": 20}, {"hour": 7, "value": 25}, ...],
      "desired": [{"hour": 6, "value": 20}, {"hour": 7, "value": 30}, ...]
    }
  ]
}
3. Provide datapoints for every hour from 6 to 30 (25 points per curve). Hours 24-30 represent the next day (i.e., hour 24=midnight, 25=1am, 26=2am, ..., 30=6am)
4. Values: 0-100 scale (0 = minimal activity, 100 = maximal)
5. Baseline: reflect natural circadian/ultradian rhythms (e.g. cortisol peaks morning, melatonin peaks night)
6. Desired: show the improvement the user wants — e.g. enhanced attention during work, deeper sleep at night, etc.
7. Colors: distinct, visible on dark background (#0a0a0f). Use muted but vibrant tones like #60a5fa, #c084fc, #4ade80, #fb7185
8. Maximum {{maxEffects}} effect curve{{maxEffectsPlural}}
9. Be physiologically realistic
10. Effect names MUST be pharmacodynamic effects (not molecules or substances). Use short (1-3 words) physiological descriptors — e.g. "Sleep Pressure", "Focused Attention", "Stress Resilience", "Circadian Rhythm". NEVER use substance names like "Melatonin", "Cortisol", "GABA" as effect labels. Never combine concepts with "/" or "and"
11. Level descriptors must be experiential and specific to the effect — e.g. for Focused Attention: "0": "No focus", "25": "Easily distracted", "50": "Steady awareness", "75": "Deep concentration", "100": "Flow state"
12. polarity MUST be set correctly: use "higher_is_worse" for negative effects the user wants to REDUCE (e.g. Pain, Anxiety, Emotional Reactivity, Nausea, Inflammation) and "higher_is_better" for positive effects the user wants to INCREASE (e.g. Focus, Resilience, Energy, Clarity, Calm)`,

    // ── Stage 4: Intervention Model — Substance Selection ──────────────
    intervention: `You are a pharmacodynamic intervention expert acting as a "Chess Player". Select the optimal protocol to move a person's baseline physiological state toward a desired target state across a 24-hour day.

USER GOAL: {{userGoal}}

AVAILABLE SUBSTANCES (with standard doses):
{{substanceList}}

CURRENT CURVES (baseline vs desired):
{{curveSummary}}

RULES:
1. Select substances to close the gap between baseline and desired curves. Use minutes-since-midnight for timing (e.g., 480 = 8:00am).
2. DOSE MULTIPLIER: Evaluate the standardDose in the database. If you want to prescribe exactly the standard dose, output a doseMultiplier of 1.0. If double, 2.0. If half, 0.5.
3. MULTI-VECTOR IMPACTS (CRITICAL): Substances have collateral effects. Map the impact of the substance on ALL relevant curves using an "impacts" dictionary. Use vectors from -1.5 to 1.5.
   - Positive numbers physically push the curve UP (increase the physiological effect).
   - Negative numbers physically pull the curve DOWN (decrease the physiological effect).
4. PLAY CHESS: Think chronologically. If you prescribe a morning stimulant that disrupts the evening "Sleep Pressure" curve, you MUST anticipate this and prescribe a compensatory substance later in the sequence (e.g., evening Magnesium) to heal that newly created deficit.
5. STRING SAFETY: Do NOT use double quotes inside your string values (e.g., inside the rationale). Use single quotes for 'inner quotes'. Output ONLY raw, valid JSON.

RESPONSE FORMAT (pure JSON, no markdown):
{
  "interventions": [
    {
      "key": "caffeineIR",
      "dose": "200mg",
      "doseMultiplier": 2.0,
      "timeMinutes": 480,
      "impacts": {
        "Focused Attention": 1.0,
        "Sleep Pressure": -0.6
      },
      "rationale": "Boosts morning focus via 2x standard dose."
    },
    {
      "key": "magnesiumGlycinate",
      "dose": "400mg",
      "doseMultiplier": 1.0,
      "timeMinutes": 1320,
      "impacts": {
        "Sleep Pressure": 0.8
      },
      "rationale": "Compensates for residual caffeine to restore sleep architecture."
    }
  ],
  "rationale": "Overall protocol strategy..."
}`,

};
