/**
 * Rx Compare Badges — headline gap-closure % contrast cards shown during
 * Lx-vs-Rx compare mode. Two floating top-center badges: "Lx coverage Y%"
 * and "Rx coverage X%" with the per-curve labels and a delta chip.
 */
import type { RxSocTwin } from './rx-soc-transform';

const BADGE_HOST_ID = 'rx-compare-badges';

function formatPct(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return `${Math.round(value)}%`;
}

function averageScore(scores: number[] | undefined): number | null {
    if (!Array.isArray(scores) || scores.length === 0) return null;
    const valid = scores.filter(n => typeof n === 'number' && Number.isFinite(n));
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function buildBadgeHtml(
    lxScores: number[],
    rxScores: number[],
    effectLabels: string[],
): string {
    const lxAvg = averageScore(lxScores);
    const rxAvg = averageScore(rxScores);
    const delta = lxAvg != null && rxAvg != null ? lxAvg - rxAvg : null;

    const perEffect = effectLabels
        .map((label, i) => {
            const lx = lxScores[i];
            const rx = rxScores[i];
            return `
                <div class="rx-badge-effect-row">
                    <div class="rx-badge-effect-label">${label || `Effect ${i + 1}`}</div>
                    <div class="rx-badge-effect-scores">
                        <span class="rx-badge-score rx-badge-score-lx">${formatPct(lx)}</span>
                        <span class="rx-badge-score-sep">vs</span>
                        <span class="rx-badge-score rx-badge-score-rx">${formatPct(rx)}</span>
                    </div>
                </div>
            `;
        })
        .join('');

    return `
        <div class="rx-badge-card rx-badge-lx">
            <div class="rx-badge-header">
                <span class="rx-badge-title">Lx</span>
                <span class="rx-badge-subtitle">adaptive</span>
            </div>
            <div class="rx-badge-avg">${formatPct(lxAvg ?? undefined)}</div>
            <div class="rx-badge-avg-label">avg coverage</div>
        </div>
        <div class="rx-badge-delta">
            ${delta != null ? `+${Math.round(delta)}pp` : ''}
            <div class="rx-badge-delta-label">gap</div>
        </div>
        <div class="rx-badge-card rx-badge-rx">
            <div class="rx-badge-header">
                <span class="rx-badge-title">Rx</span>
                <span class="rx-badge-subtitle">static SOC</span>
            </div>
            <div class="rx-badge-avg">${formatPct(rxAvg ?? undefined)}</div>
            <div class="rx-badge-avg-label">avg coverage</div>
        </div>
        ${perEffect ? `<div class="rx-badge-effects">${perEffect}</div>` : ''}
    `;
}

export function renderCompareBadges(
    twin: RxSocTwin,
    lxScores: number[],
    effectLabels: string[],
): void {
    clearCompareBadges();
    const host = document.createElement('div');
    host.id = BADGE_HOST_ID;
    host.className = 'rx-compare-badges';
    host.setAttribute('role', 'status');
    host.innerHTML = buildBadgeHtml(lxScores || [], twin.effectScores || [], effectLabels || []);
    document.body.appendChild(host);
}

export function clearCompareBadges(): void {
    const existing = document.getElementById(BADGE_HOST_ID);
    if (existing) existing.remove();
}
