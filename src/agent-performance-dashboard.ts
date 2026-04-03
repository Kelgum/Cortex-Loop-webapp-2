/**
 * Agent Performance Dashboard — Full-screen overlay that visualizes persistent LLM call logs.
 * Exports: openDashboard, closeDashboard, initDashboard
 * Depends on: llm-failure-log (LLMLog)
 */
import { LLMLog } from './llm-failure-log';
import type { LLMLogSummary, LLMLogEntry, LLMErrorClass } from './llm-failure-log';

// ---------------------------------------------------------------------------
// Provider display names
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
    grok: 'Grok',
};

function providerLabel(provider: string): string {
    return PROVIDER_LABELS[provider] || provider;
}

/** Map stageClass → friendly agent name (mirrors debug-panel STAGES). */
const STAGE_AGENT_NAMES: Record<string, string> = {
    'fast-model': 'Scout',
    'main-model': 'Strategist',
    'intervention-model': 'Chess Player',
    'sherlock-model': 'Sherlock',
    'biometric-rec-model': 'Spotter (Device)',
    'biometric-profile-model': 'Spotter (Profile)',
    'biometric-channel-model': 'Spotter (Channel)',
    'biometric-model': 'Spotter (Sim)',
    'strategist-bio-model': 'Strategist Bio',
    'revision-model': 'Grandmaster',
    'sherlock-revision-model': 'Sherlock (Rev)',
    'knight-model': 'Knight',
    'spotter-daily-model': 'Spotter (7d)',
    'strategist-bio-daily-model': 'Strategist Bio (7d)',
    'grandmaster-daily-model': 'Grandmaster (7d)',
    'agent-match-model': 'Agent Match',
};

function agentName(stageClass: string, fallbackLabel: string): string {
    return STAGE_AGENT_NAMES[stageClass] || fallbackLabel || stageClass;
}

const ERROR_CLASS_LABELS: Record<LLMErrorClass, string> = {
    missing_key: 'Missing API Key',
    timeout: 'Timeout',
    rate_limit: 'Rate Limit',
    server_error: 'Server Error',
    truncated_json: 'Truncated JSON',
    parse_error: 'Parse Error',
    validation_error: 'Validation Error',
    network_error: 'Network Error',
    auth_error: 'Auth Error',
    unknown: 'Unknown',
};

// ---------------------------------------------------------------------------
// Dashboard state
// ---------------------------------------------------------------------------

let _overlay: HTMLElement | null = null;
let _bound = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initDashboard(): void {
    _overlay = document.getElementById('agent-perf-dashboard');
    if (!_overlay || _bound) return;
    _bound = true;
    _overlay.addEventListener('click', e => {
        if (e.target === _overlay) closeDashboard();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && _overlay && !_overlay.classList.contains('hidden')) {
            closeDashboard();
        }
    });
}

export function openDashboard(): void {
    if (!_overlay) _overlay = document.getElementById('agent-perf-dashboard');
    if (!_overlay) return;
    _overlay.innerHTML = '';
    _overlay.appendChild(buildDashboard());
    _overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

export function closeDashboard(): void {
    if (!_overlay) return;
    _overlay.classList.add('hidden');
    _overlay.innerHTML = '';
    document.body.style.overflow = '';
}

// ---------------------------------------------------------------------------
// Build dashboard DOM
// ---------------------------------------------------------------------------

function buildDashboard(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'apd-wrapper';

    // Header
    const header = document.createElement('div');
    header.className = 'apd-header';
    const title = document.createElement('h2');
    title.className = 'apd-title';
    title.textContent = 'Agent Performance Dashboard';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'apd-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close dashboard');
    closeBtn.addEventListener('click', closeDashboard);
    header.appendChild(closeBtn);
    wrapper.appendChild(header);

    // Body (scrollable)
    const body = document.createElement('div');
    body.className = 'apd-body';

    const summary = LLMLog.summarize();

    if (summary.totalCalls === 0) {
        const empty = document.createElement('div');
        empty.className = 'apd-empty';
        empty.textContent = 'No LLM calls logged yet. Run a prompt to start collecting data.';
        body.appendChild(empty);
    } else {
        body.appendChild(buildSummaryBar(summary));
        body.appendChild(buildProviderTable(summary));
        body.appendChild(buildStageTable(summary));
        body.appendChild(buildErrorBreakdown(summary));
        body.appendChild(buildRecentFailures(summary));
    }

    body.appendChild(buildActions());
    wrapper.appendChild(body);
    return wrapper;
}

// ---------------------------------------------------------------------------
// Summary bar (4 stat cards)
// ---------------------------------------------------------------------------

function buildSummaryBar(summary: LLMLogSummary): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'apd-summary-bar';

    const cards: { label: string; value: string; sub?: string; cls?: string }[] = [
        { label: 'Total Calls', value: String(summary.totalCalls) },
        {
            label: 'Success Rate',
            value: `${(summary.successRate * 100).toFixed(1)}%`,
            cls: summary.successRate >= 0.9 ? 'good' : summary.successRate >= 0.7 ? 'warn' : 'bad',
        },
        {
            label: 'Avg Latency',
            value: `${(summary.avgLatencyMs / 1000).toFixed(1)}s`,
            sub: `p95: ${(summary.p95LatencyMs / 1000).toFixed(1)}s`,
        },
        {
            label: 'Total Failures',
            value: String(summary.totalFailure),
            cls: summary.totalFailure > 0 ? 'bad' : 'good',
        },
    ];

    for (const card of cards) {
        const el = document.createElement('div');
        el.className = `apd-stat-card${card.cls ? ` ${card.cls}` : ''}`;
        const val = document.createElement('div');
        val.className = 'apd-stat-value';
        val.textContent = card.value;
        el.appendChild(val);
        const lbl = document.createElement('div');
        lbl.className = 'apd-stat-label';
        lbl.textContent = card.label;
        el.appendChild(lbl);
        if (card.sub) {
            const sub = document.createElement('div');
            sub.className = 'apd-stat-sub';
            sub.textContent = card.sub;
            el.appendChild(sub);
        }
        bar.appendChild(el);
    }

    return bar;
}

// ---------------------------------------------------------------------------
// Provider reliability table
// ---------------------------------------------------------------------------

function buildProviderTable(summary: LLMLogSummary): HTMLElement {
    const section = document.createElement('div');
    section.className = 'apd-section';
    const heading = document.createElement('h3');
    heading.className = 'apd-section-title';
    heading.textContent = 'Provider Reliability';
    section.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'apd-table';

    const thead = document.createElement('thead');
    thead.innerHTML =
        '<tr><th>Provider</th><th>Calls</th><th>Success</th><th>Failures</th><th>Success %</th><th>Avg Latency</th><th>Top Errors</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const providers = Object.keys(summary.byProvider).sort();
    for (const pid of providers) {
        const p = summary.byProvider[pid];
        const rate = p.calls > 0 ? ((p.successes / p.calls) * 100).toFixed(1) : '—';
        const topErrors =
            Object.entries(p.errorBreakdown)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .slice(0, 3)
                .map(([cls, count]) => `${ERROR_CLASS_LABELS[cls as LLMErrorClass] || cls} (${count})`)
                .join(', ') || '—';

        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="apd-provider-name">${providerLabel(pid)}</td><td>${p.calls}</td><td>${p.successes}</td><td>${p.failures}</td><td class="${rateClass(p.successes, p.calls)}">${rate}%</td><td>${p.avgMs > 0 ? (p.avgMs / 1000).toFixed(1) + 's' : '—'}</td><td class="apd-errors-cell">${topErrors}</td>`;
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
}

// ---------------------------------------------------------------------------
// Stage performance table
// ---------------------------------------------------------------------------

function buildStageTable(summary: LLMLogSummary): HTMLElement {
    const section = document.createElement('div');
    section.className = 'apd-section';
    const heading = document.createElement('h3');
    heading.className = 'apd-section-title';
    heading.textContent = 'Stage Performance';
    section.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'apd-table';

    const thead = document.createElement('thead');
    thead.innerHTML =
        '<tr><th>Stage</th><th>Calls</th><th>Success</th><th>Failures</th><th>Fallbacks</th><th>Success %</th><th>Avg Latency</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const stages = Object.keys(summary.byStage);
    for (const sid of stages) {
        const s = summary.byStage[sid];
        const rate = s.calls > 0 ? ((s.successes / s.calls) * 100).toFixed(1) : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="apd-stage-name">${agentName(sid, s.label)}</td><td>${s.calls}</td><td>${s.successes}</td><td>${s.failures}</td><td>${s.fallbackCount}</td><td class="${rateClass(s.successes, s.calls)}">${rate}%</td><td>${s.avgMs > 0 ? (s.avgMs / 1000).toFixed(1) + 's' : '—'}</td>`;
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
}

// ---------------------------------------------------------------------------
// Error type breakdown
// ---------------------------------------------------------------------------

function buildErrorBreakdown(summary: LLMLogSummary): HTMLElement {
    const section = document.createElement('div');
    section.className = 'apd-section';
    const heading = document.createElement('h3');
    heading.className = 'apd-section-title';
    heading.textContent = 'Error Breakdown';
    section.appendChild(heading);

    const entries = Object.entries(summary.byErrorClass).sort((a, b) => (b[1] as number) - (a[1] as number));
    if (entries.length === 0) {
        const none = document.createElement('div');
        none.className = 'apd-empty-section';
        none.textContent = 'No errors recorded.';
        section.appendChild(none);
        return section;
    }

    const maxCount = Math.max(...entries.map(([, c]) => c as number), 1);
    const list = document.createElement('div');
    list.className = 'apd-error-bars';

    for (const [cls, count] of entries) {
        const row = document.createElement('div');
        row.className = 'apd-error-row';

        const label = document.createElement('span');
        label.className = 'apd-error-label';
        label.textContent = ERROR_CLASS_LABELS[cls as LLMErrorClass] || cls;
        row.appendChild(label);

        const barWrap = document.createElement('div');
        barWrap.className = 'apd-error-bar-wrap';
        const bar = document.createElement('div');
        bar.className = `apd-error-bar ${cls}`;
        bar.style.width = `${((count as number) / maxCount) * 100}%`;
        barWrap.appendChild(bar);
        row.appendChild(barWrap);

        const countEl = document.createElement('span');
        countEl.className = 'apd-error-count';
        countEl.textContent = String(count);
        row.appendChild(countEl);

        list.appendChild(row);
    }

    section.appendChild(list);
    return section;
}

// ---------------------------------------------------------------------------
// Recent failures timeline
// ---------------------------------------------------------------------------

function buildRecentFailures(summary: LLMLogSummary): HTMLElement {
    const section = document.createElement('div');
    section.className = 'apd-section';
    const heading = document.createElement('h3');
    heading.className = 'apd-section-title';
    heading.textContent = 'Recent Failures';
    section.appendChild(heading);

    if (summary.recentFailures.length === 0) {
        const none = document.createElement('div');
        none.className = 'apd-empty-section';
        none.textContent = 'No failures recorded.';
        section.appendChild(none);
        return section;
    }

    const list = document.createElement('div');
    list.className = 'apd-failure-list';

    for (const entry of summary.recentFailures) {
        list.appendChild(buildFailureCard(entry));
    }

    section.appendChild(list);
    return section;
}

function buildFailureCard(entry: LLMLogEntry): HTMLElement {
    const card = document.createElement('div');
    card.className = `apd-failure-card${entry.resolved ? ' resolved' : ''}`;

    const headerRow = document.createElement('div');
    headerRow.className = 'apd-failure-header';

    const stageBadge = document.createElement('span');
    stageBadge.className = 'apd-failure-stage';
    stageBadge.textContent = agentName(entry.stage, entry.label);
    headerRow.appendChild(stageBadge);

    const providerBadge = document.createElement('span');
    providerBadge.className = 'apd-failure-provider';
    providerBadge.textContent = `${providerLabel(entry.provider)} · ${entry.model}`;
    headerRow.appendChild(providerBadge);

    const time = document.createElement('span');
    time.className = 'apd-failure-time';
    time.textContent = formatTimestamp(entry.ts);
    headerRow.appendChild(time);

    card.appendChild(headerRow);

    const detailRow = document.createElement('div');
    detailRow.className = 'apd-failure-detail';

    const errBadge = document.createElement('span');
    errBadge.className = `apd-err-badge ${entry.err || 'unknown'}`;
    errBadge.textContent = ERROR_CLASS_LABELS[entry.err || 'unknown'] || entry.err || 'Unknown';
    detailRow.appendChild(errBadge);

    if (entry.http > 0) {
        const httpBadge = document.createElement('span');
        httpBadge.className = 'apd-http-badge';
        httpBadge.textContent = `HTTP ${entry.http}`;
        detailRow.appendChild(httpBadge);
    }

    if (entry.ms > 0) {
        const dur = document.createElement('span');
        dur.className = 'apd-failure-dur';
        dur.textContent = `${(entry.ms / 1000).toFixed(1)}s`;
        detailRow.appendChild(dur);
    }

    if (entry.resolved && entry.resolvedBy) {
        const resolvedBadge = document.createElement('span');
        resolvedBadge.className = 'apd-resolved-badge';
        resolvedBadge.textContent = `Resolved by ${providerLabel(entry.resolvedBy)}`;
        detailRow.appendChild(resolvedBadge);
    }

    card.appendChild(detailRow);

    if (entry.msg) {
        const msgEl = document.createElement('div');
        msgEl.className = 'apd-failure-msg';
        msgEl.textContent = entry.msg;
        card.appendChild(msgEl);
    }

    return card;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function buildActions(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'apd-actions';

    const exportBtn = document.createElement('button');
    exportBtn.className = 'apd-action-btn export';
    exportBtn.textContent = 'Export Log';
    exportBtn.addEventListener('click', () => {
        LLMLog.exportToFile();
    });
    section.appendChild(exportBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'apd-action-btn clear';
    clearBtn.textContent = 'Clear Log';
    clearBtn.addEventListener('click', () => {
        LLMLog.clear();
        // Re-render dashboard
        openDashboard();
    });
    section.appendChild(clearBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'apd-action-btn close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeDashboard);
    section.appendChild(closeBtn);

    return section;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rateClass(successes: number, total: number): string {
    if (total === 0) return '';
    const rate = successes / total;
    if (rate >= 0.9) return 'apd-rate-good';
    if (rate >= 0.7) return 'apd-rate-warn';
    return 'apd-rate-bad';
}

function formatTimestamp(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return iso;
    }
}
