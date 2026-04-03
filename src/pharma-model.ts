// ============================================
// Pharmacodynamic Model — pure math, no DOM
// ============================================

/**
 * Compute the pharmacodynamic effect of a single substance dose at a given time.
 * First computes the PK concentration curve (piecewise: ramp up → peak → plateau →
 * exponential decay → optional rebound), then applies a Hill equation (Sigmoid Emax)
 * transform to convert plasma concentration into biological effect.
 *
 * Hill params (per-substance, with defaults):
 *   ec50 — fraction of peak concentration at which 50% of max PD effect occurs
 *   hill — Hill coefficient controlling sigmoid steepness (cooperativity)
 */
export function substanceEffectAt(minutesSinceDose: any, pharma: any) {
    if (minutesSinceDose < 0) return 0;
    const { onset, peak, duration, halfLife, strength, rebound } = pharma;

    let effect = 0;
    if (minutesSinceDose <= onset) {
        // Ramp-up phase (ease-in)
        const t = minutesSinceDose / onset;
        effect = strength * t * t;
    } else if (minutesSinceDose <= peak) {
        // Rising to peak (ease-out)
        const t = (minutesSinceDose - onset) / (peak - onset);
        effect = strength * (0.7 + 0.3 * (1 - (1 - t) * (1 - t)));
    } else if (minutesSinceDose <= duration * 0.6) {
        // Plateau near peak
        const decay = (minutesSinceDose - peak) / (duration * 0.6 - peak);
        effect = strength * (1 - decay * 0.15);
    } else if (minutesSinceDose <= duration) {
        // Exponential decay
        const elapsed = minutesSinceDose - duration * 0.6;
        effect = strength * 0.85 * Math.pow(0.5, elapsed / halfLife);
    } else {
        // Post-duration: continued decay + rebound dip
        const elapsedAtDuration = duration - duration * 0.6;
        const valueAtDuration = strength * 0.85 * Math.pow(0.5, elapsedAtDuration / halfLife);
        const elapsed = minutesSinceDose - duration;
        const residual = valueAtDuration * Math.pow(0.5, elapsed / halfLife);
        const reboundDip = rebound * Math.exp(-elapsed / (halfLife * 0.5));
        effect = residual - reboundDip;
    }

    // ── PD Hill equation transform (Sigmoid Emax) ──
    // Converts PK concentration to PD biological effect via receptor occupancy sigmoid.
    // Only applies to positive values; rebound (negative) is already a PD phenomenon.
    if (effect > 0 && strength > 0) {
        const ec = pharma.ec50 ?? 0.5;
        const n = pharma.hill ?? 2.0;
        const f = effect / strength; // fraction of peak concentration (0-1)
        const fn = Math.pow(f, n);
        const en = Math.pow(ec, n);
        const norm = en + 1; // hill response at f=1 → normalizes so peak = strength
        effect = (strength * fn * norm) / (en + fn);
    }

    // ── Chronobiotic tail: persistent circadian phase-shift beyond PK clearance ──
    // Melatonin and other chronobiotic substances advance the circadian clock;
    // that phase shift persists long after the molecule clears.  Applied post-Hill
    // because this is already a PD phenomenon, not a PK concentration.
    if (pharma.chronobioticTail && minutesSinceDose > duration && strength > 0) {
        const elapsed = minutesSinceDose - duration;
        const tailHL = pharma.chronobioticHalfLife || halfLife * 10;
        const tailEffect = pharma.chronobioticTail * strength * Math.pow(0.5, elapsed / tailHL);
        effect = Math.max(effect, tailEffect);
    }

    return effect;
}

// ── Normalized shape (0-1) for gap-referenced overlay computation ──

/** Returns the PD effect value at peak time for a given pharma profile. */
export function peakEffectValue(pharma: any): number {
    return substanceEffectAt(pharma.peak, pharma);
}

/**
 * Returns the normalized PD shape at a given time: 1.0 at peak, tapering
 * toward 0 during onset/decay, and negative during rebound.  Used by the
 * gap-referenced overlay path so that impact vectors represent "fraction
 * of gap to fill at peak."
 */
export function normalizedEffectAt(minutesSinceDose: number, pharma: any): number {
    const raw = substanceEffectAt(minutesSinceDose, pharma);
    const peakVal = peakEffectValue(pharma);
    if (peakVal <= 0) return 0;
    return raw / peakVal;
}

// ── Tolerance modeling for multi-day substance cycling ──

/**
 * Compute tolerance multiplier for a substance used on consecutive days.
 * Returns 1.0 (no tolerance) down to 0.50 (50% floor).
 * 8% decay per consecutive day of use.
 */
export function computeToleranceMultiplier(consecutiveDays: number): number {
    return Math.max(0.5, 1.0 - 0.08 * consecutiveDays);
}
