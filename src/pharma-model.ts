// ============================================
// Pharmacokinetic Model — pure math, no DOM
// ============================================

/**
 * Compute the effect value of a single substance dose at a given time.
 * Uses a piecewise model: ramp up → peak → plateau → exponential decay → optional rebound.
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

    return effect;
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
