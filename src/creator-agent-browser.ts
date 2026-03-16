// ── Protocol Agents Browser — grid gallery of agent cards ────────────
import type { AgentConfig } from './creator-agent-types';
import { DOSING_LABELS } from './creator-agent-types';
import { BUNDLED_AGENTS } from './creator-agents/index';
import { openAgentDesigner, renderAgentCard } from './creator-agent-designer';
import { settingsStore } from './settings-store';
import { escapeHtml as esc } from './utils';

// ── DOM refs ─────────────────────────────────────────────────────────
let page: HTMLElement;
let contentEl: HTMLElement;
let backBtn: HTMLElement;
let searchInput: HTMLInputElement;

let allAgents: AgentConfig[] = [];
const bundledIds = new Set(BUNDLED_AGENTS.map(a => a.id));

// ── Public API ───────────────────────────────────────────────────────

export function initAgentBrowser(): void {
    page = document.getElementById('agent-browser-page')!;
    contentEl = document.getElementById('agent-browser-content')!;
    backBtn = document.getElementById('agent-browser-back')!;
    searchInput = document.getElementById('agent-search-input') as HTMLInputElement;

    const browserBtn = document.getElementById('agent-browser-btn');
    browserBtn?.addEventListener('click', () => openAgentBrowser());

    backBtn.addEventListener('click', () => closeAgentBrowser());

    searchInput.addEventListener('input', () => {
        renderGrid(filterAgents(searchInput.value));
    });
}

export function openAgentBrowser(): void {
    // Merge bundled + saved agents
    const saved = settingsStore.getJson<AgentConfig[]>('cortex_saved_agents', []);
    allAgents = [...BUNDLED_AGENTS, ...saved];

    searchInput.value = '';
    renderGrid(allAgents);

    page.classList.remove('hidden');
    void page.offsetHeight; // force reflow so transition triggers
    page.classList.add('visible');
}

export function closeAgentBrowser(afterClose?: () => void): void {
    page.classList.remove('visible');
    setTimeout(() => {
        page.classList.add('hidden');
        if (afterClose) afterClose();
    }, 360);
}

// ── Grid rendering ───────────────────────────────────────────────────

function renderGrid(agents: AgentConfig[]): void {
    if (agents.length === 0) {
        contentEl.innerHTML = '<div class="ab-empty">No agents found</div>';
        return;
    }

    const cards = agents.map((agent, idx) => cardHtml(agent, idx)).join('');
    contentEl.innerHTML = `<div class="ab-grid">${cards}</div>`;

    // Card click delegation
    contentEl.querySelector('.ab-grid')?.addEventListener('click', e => {
        // Delete button intercept
        const deleteBtn = (e.target as HTMLElement).closest('.ab-card-delete') as HTMLElement | null;
        if (deleteBtn) {
            e.stopPropagation();
            const agentId = deleteBtn.dataset.agentId;
            if (agentId) deleteAgent(agentId);
            return;
        }

        const card = (e.target as HTMLElement).closest('.ab-card') as HTMLElement | null;
        if (!card) return;
        const agentIdx = parseInt(card.dataset.agentIdx ?? '', 10);
        const agent = agents[agentIdx];
        if (agent) {
            closeAgentBrowser(() => openAgentDesigner(agent, true, () => openAgentBrowser()));
        }
    });
}

function cardHtml(agent: AgentConfig, idx: number): string {
    const initial =
        agent.meta.creatorName?.charAt(0)?.toUpperCase() || agent.meta.name?.charAt(0)?.toUpperCase() || '?';
    const avatarInner = agent.meta.avatarUrl
        ? `<img src="${esc(agent.meta.avatarUrl)}" onerror="this.parentElement.innerHTML='${initial}'" />`
        : initial;

    const displayName = agent.meta.creatorName || agent.meta.name;
    const tags = (agent.meta.domainTags ?? [])
        .slice(0, 4)
        .map(t => `<span class="ab-card-tag">${esc(t)}</span>`)
        .join('');

    const dosingIdx = Math.min(4, Math.round(agent.substancePalette.dosingPhilosophy * 4));
    const dosingLabel = DOSING_LABELS[dosingIdx] ?? 'Moderate';

    const isSaved = !bundledIds.has(agent.id);
    const deleteBtn = isSaved
        ? `<button class="ab-card-delete" data-agent-id="${esc(agent.id)}" title="Delete agent" aria-label="Delete agent">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                   <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                   <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
               </svg>
           </button>`
        : '';

    return `
        <div class="ab-card" data-agent-idx="${idx}">
            ${deleteBtn}
            <div class="ab-card-header">
                <div class="ab-card-avatar">${avatarInner}</div>
                <div class="ab-card-identity">
                    <div class="ab-card-creator-name">${esc(displayName)}</div>
                    <div class="ab-card-handle">${esc(agent.meta.creatorHandle)}</div>
                </div>
            </div>
            <h3 class="ab-card-name">${esc(agent.meta.name)}</h3>
            <p class="ab-card-tagline">${esc(agent.meta.tagline)}</p>
            <div class="ab-card-tags">${tags}</div>
            <div class="ab-card-footer">
                <span class="ab-card-dosing">${esc(dosingLabel)}</span>
            </div>
        </div>`;
}

// ── Delete agent ─────────────────────────────────────────────────────

function deleteAgent(agentId: string): void {
    const agent = allAgents.find(a => a.id === agentId);
    const name = agent?.meta.name ?? agentId;
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    // Remove from localStorage
    const saved = settingsStore.getJson<AgentConfig[]>('cortex_saved_agents', []);
    const updated = saved.filter(a => a.id !== agentId);
    settingsStore.setJson('cortex_saved_agents', updated);

    // Remove from in-memory list and re-render
    allAgents = allAgents.filter(a => a.id !== agentId);
    renderGrid(filterAgents(searchInput.value));
}

// ── Search filter ────────────────────────────────────────────────────

function filterAgents(query: string): AgentConfig[] {
    const q = query.toLowerCase().trim();
    if (!q) return allAgents;

    return allAgents.filter(a => {
        const haystack = [
            a.meta.name,
            a.meta.creatorHandle,
            a.meta.tagline,
            a.meta.targetPopulation,
            ...a.meta.domainTags,
        ]
            .join(' ')
            .toLowerCase();
        return haystack.includes(q);
    });
}

// Re-export renderAgentCard for external use (unused import prevention)
export { renderAgentCard };
