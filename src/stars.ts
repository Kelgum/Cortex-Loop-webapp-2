// ── Stars — efficacy score rendering ─────────────────────────────────
// Pure helpers that turn a 0–5 score into HTML for a row of 5 stars.
// Half-stars are produced by clipping a filled star to ~50% width via inline style.

export type StarSize = 'sm' | 'md' | 'lg';

const FILLED = '★'; // ★
const EMPTY = '☆'; // ☆

const SIZE_PX: Record<StarSize, number> = {
    sm: 12,
    md: 16,
    lg: 20,
};

const GAP_PX: Record<StarSize, number> = {
    sm: 1,
    md: 2,
    lg: 3,
};

/** Render a 5-star row for a 0–5 score. Supports half-stars. */
export function renderStars(rawScore: number, size: StarSize = 'sm'): string {
    const score = clamp(Number.isFinite(rawScore) ? rawScore : 0, 0, 5);
    const fontPx = SIZE_PX[size];
    const gapPx = GAP_PX[size];
    const cells: string[] = [];

    for (let i = 0; i < 5; i++) {
        const fillForCell = clamp(score - i, 0, 1); // 0..1 portion of this star to fill
        if (fillForCell >= 0.875) {
            cells.push(`<span class="lx-star lx-star-full">${FILLED}</span>`);
        } else if (fillForCell >= 0.25) {
            // half star — render an empty star with a filled overlay clipped to ~50%
            cells.push(
                `<span class="lx-star lx-star-half">${EMPTY}` +
                    `<span class="lx-star-half-fill" aria-hidden="true">${FILLED}</span>` +
                    `</span>`,
            );
        } else {
            cells.push(`<span class="lx-star lx-star-empty">${EMPTY}</span>`);
        }
    }

    const styleAttr = `style="font-size:${fontPx}px;letter-spacing:${gapPx}px"`;
    const a11y = `aria-label="${formatScore(score)} out of 5 stars"`;
    return `<span class="lx-stars lx-stars-${size}" ${styleAttr} role="img" ${a11y}>${cells.join('')}</span>`;
}

/** Format a score as a short string: 4.5, 3, 4.0 → 4. Clamps to 0–5. */
export function formatScore(rawScore: number): string {
    const score = clamp(Number.isFinite(rawScore) ? rawScore : 0, 0, 5);
    const fixed = score.toFixed(1);
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
}
