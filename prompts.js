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
    intervention: `You are a pharmacodynamic intervention expert. Your task is to select the optimal supplement protocol to move a person's baseline physiological state toward a desired target state across the ENTIRE 24-hour day.

AVAILABLE SUBSTANCES (with pharmacokinetic profiles):
{{substanceList}}

CURRENT CURVES (baseline vs desired):
{{curveSummary}}

RULES:
1. Select substances and precise doses to close the gap between baseline and desired curves
2. Use minutes-since-midnight for timing (e.g., 480 = 8:00am, 720 = 12:00pm, 840 = 2:00pm, 1260 = 9:00pm, 1380 = 11:00pm)
3. Be bold with dosing — use clinically effective doses, not conservative microdoses
4. You may split doses 30-60 minutes apart if it helps nail the pharmacodynamic target
5. Maximum 8 unique substances total
6. Each intervention must use a substance key from the AVAILABLE SUBSTANCES list
7. For "higher_is_worse" effects (e.g. Pain, Anxiety), interventions should REDUCE the curve
8. For "higher_is_better" effects (e.g. Focus, Energy), interventions should INCREASE the curve
9. Consider onset, peak, duration, and halfLife when choosing timing
10. Provide a brief rationale
11. Each intervention must include "targetEffect" — the exact effect name from CURRENT CURVES that it primarily targets
12. CRITICAL: Distribute substances across the FULL day to address ALL time windows where baseline diverges from desired. Look at the curves from 6am through to midnight and beyond. If the desired curve shows improvement needed in the evening or at night (e.g. sleep quality, relaxation, recovery), you MUST include evening/nighttime substances (e.g. magnesium at 9pm, glycine at 10pm, melatonin at 11pm). Do NOT cluster all substances in the morning — cover every gap in the timeline.
13. Scan the curves hour by hour: wherever desired differs significantly from baseline, there should be at least one substance timed to cover that window.

RESPONSE FORMAT (pure JSON, no markdown):
{
  "interventions": [
    {"key": "caffeine", "dose": "200mg", "timeMinutes": 480, "targetEffect": "Focused Attention"},
    {"key": "theanine", "dose": "400mg", "timeMinutes": 480, "targetEffect": "Focused Attention"},
    {"key": "magnesium", "dose": "400mg", "timeMinutes": 1260, "targetEffect": "Sleep Pressure"},
    {"key": "glycine", "dose": "3g", "timeMinutes": 1350, "targetEffect": "Sleep Pressure"}
  ],
  "rationale": "Brief explanation of the protocol strategy"
}`,

};
