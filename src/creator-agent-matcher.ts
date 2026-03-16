// ============================================
// Agent Matcher — Creator agent ranking, card UI, selection, VCR docking
// ============================================
// Exports: rankCreatorAgents, showAgentMatchPanel, hideAgentMatchPanel, resetAgentMatch, undockAgent
// Depends on: creator-agents/index, creator-agent-types, state, llm-pipeline, prompts, utils, types

import type { AgentConfig } from './creator-agent-types';
import type { WordCloudEffect, AgentMatchResult } from './types';
import { AGENT_DATABASE, getAgentById } from './creator-agents/index';
import { AgentMatchState } from './state';
import { runCachedStage } from './llm-pipeline';
import { PROMPTS } from './prompts';
import { interpolatePrompt, escapeHtml as esc } from './utils';
import { settingsStore } from './settings-store';

// ── DOM refs ────────────────────────────────────────────────────────
let _panel: HTMLElement | null = null;
let _floatingCard: HTMLElement | null = null;
let _floatingCapsule: HTMLElement | null = null;
let _floatingPlaceholder: HTMLElement | null = null;
let _dockTimers: number[] = [];

const DOCK_DISMISS_DELAY = 380;
const DOCK_STAGE_DURATION = 520;
const DOCK_MORPH_DURATION = 180;
const DOCK_SLIDE_DURATION = 340;
const DOCK_COCK_DURATION = 140;
const DOCK_COCK_DISTANCE = 14;
const DOCK_SHELL_UNDERLAP = 78;
const DOCK_CONTENT_START_GAP = 8;
const DOCK_SHELL_TAIL = 0;

/** Extract surname (last word) from a full name */
function surname(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts[parts.length - 1] || fullName;
}

interface DockVisuals {
    initial: string;
    surnameOnly: string;
    avatarUrl: string | null;
}

interface DockGeometry {
    stageLeft: number;
    stageTop: number;
    shellLeft: number;
    contentLeft: number;
    capsuleLeft: number;
    capsuleTop: number;
    capsuleWidth: number;
    capsuleHeight: number;
    shellWidth: number;
    contentWidth: number;
}

function getDockVisuals(agent: AgentConfig): DockVisuals {
    const initial =
        agent.meta.creatorName?.charAt(0)?.toUpperCase() || agent.meta.name?.charAt(0)?.toUpperCase() || '?';
    return {
        initial,
        surnameOnly: surname(agent.meta.creatorName || agent.meta.name),
        avatarUrl: agent.meta.avatarUrl || null,
    };
}

function buildAvatarMarkup(visuals: DockVisuals, imageClass: string): string {
    if (!visuals.avatarUrl) return visuals.initial;
    return `<img src="${esc(visuals.avatarUrl)}" onerror="this.parentElement.innerHTML='${visuals.initial}'" class="${imageClass}" />`;
}

function buildDockInnerHTML(agent: AgentConfig, avatarClass: string, nameClass: string, imageClass: string): string {
    const visuals = getDockVisuals(agent);
    return `
        <div class="${avatarClass}">${buildAvatarMarkup(visuals, imageClass)}</div>
        <span class="${nameClass}">${esc(visuals.surnameOnly)}</span>
    `;
}

function queueDockTimer(fn: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
        _dockTimers = _dockTimers.filter(id => id !== timer);
        fn();
    }, delay);
    _dockTimers.push(timer);
}

function clearDockTimers(): void {
    _dockTimers.forEach(id => window.clearTimeout(id));
    _dockTimers = [];
}

function releaseHiddenSourceCards(): void {
    document.querySelectorAll('.am-card-source-hidden').forEach(el => {
        el.classList.remove('am-card-source-hidden');
    });
}

function clearDockAnimationArtifacts(): void {
    clearDockTimers();
    _floatingCard?.remove();
    _floatingCapsule?.remove();
    _floatingPlaceholder?.remove();
    _floatingCard = null;
    _floatingCapsule = null;
    _floatingPlaceholder = null;
    releaseHiddenSourceCards();
}

function measureDockContent(agent: AgentConfig): { width: number; height: number } {
    const probe = document.createElement('div');
    probe.className = 'vcr-wing-agent-dock am-dock-measure';
    probe.innerHTML = buildDockInnerHTML(agent, 'vcr-agent-dock-avatar', 'vcr-agent-dock-name', 'vcr-agent-dock-img');
    document.body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    return {
        width: Math.max(96, Math.ceil(rect.width)),
        height: Math.max(56, Math.ceil(rect.height)),
    };
}

function computePillRightRelative(panel: HTMLElement): number {
    const styles = window.getComputedStyle(panel);
    const pillWidth = parseFloat(styles.getPropertyValue('--pill-w')) || 84;
    const pillOffset = parseFloat(styles.getPropertyValue('--pill-offset')) || 0;
    const panelWidth = panel.clientWidth || panel.getBoundingClientRect().width || 0;
    return panelWidth / 2 + pillOffset + pillWidth / 2;
}

function computeDockGeometry(panel: HTMLElement, agent: AgentConfig, cardRect: DOMRect): DockGeometry {
    const panelRect = panel.getBoundingClientRect();
    const measured = measureDockContent(agent);
    const pillRightRel = computePillRightRelative(panel);
    const pillRightAbs = panelRect.left + pillRightRel;
    const shellLeft = pillRightAbs - DOCK_SHELL_UNDERLAP;
    const contentLeft = pillRightAbs + DOCK_CONTENT_START_GAP;
    const capsuleLeft = contentLeft;
    const capsuleTop = panelRect.top + (panelRect.height - measured.height) / 2;
    const stageLeft = cardRect.left;
    const stageTop = panelRect.top + (panelRect.height - cardRect.height) / 2;
    return {
        stageLeft,
        stageTop,
        shellLeft,
        contentLeft,
        capsuleLeft,
        capsuleTop,
        capsuleWidth: measured.width,
        capsuleHeight: measured.height,
        contentWidth: measured.width,
        shellWidth: contentLeft - shellLeft + measured.width + DOCK_SHELL_TAIL,
    };
}

function createFloatingCapsule(agent: AgentConfig): HTMLElement {
    const capsule = document.createElement('div');
    capsule.className = 'am-morph-capsule';
    capsule.innerHTML = buildDockInnerHTML(agent, 'am-morph-avatar', 'am-morph-name', 'am-morph-img');
    return capsule;
}

// ============================================
// LLM-Assisted Ranking
// ============================================

function buildAgentRoster(): string {
    const saved = settingsStore.getJson<AgentConfig[]>('cortex_saved_agents', []);
    const all = [...AGENT_DATABASE, ...saved];
    return all
        .map(a => {
            const weights = a.optimizationWeights;
            const topWeights = Object.entries(weights)
                .sort(([, va], [, vb]) => (vb as number) - (va as number))
                .slice(0, 3)
                .map(([k, v]) => `${k}:${v}`)
                .join(', ');
            const sigs = (a.signatureInterventions ?? [])
                .slice(0, 3)
                .map(s => `${s.substance ?? s.substanceKey ?? '?'} (${s.timing})`)
                .join('; ');
            return `${a.id} | ${a.meta.creatorHandle} "${a.meta.name}" | tags: ${a.meta.domainTags.join(', ')} | ${a.meta.tagline} | weights: ${topWeights} | interventions: ${sigs}`;
        })
        .join('\n');
}

function buildEffectList(effects: WordCloudEffect[]): string {
    return effects
        .slice(0, 10)
        .map(e => `${e.name} (relevance: ${e.relevance})`)
        .join(', ');
}

/** Fallback: estimate outcome success rate without LLM (produces 60-97 range) */
function fallbackRank(prompt: string, effects: WordCloudEffect[]): AgentMatchResult[] {
    const saved = settingsStore.getJson<AgentConfig[]>('cortex_saved_agents', []);
    const all = [...AGENT_DATABASE, ...saved];
    const promptLower = prompt.toLowerCase();
    const effectNames = effects.map(e => e.name.toLowerCase());

    const scored = all.map(agent => {
        let raw = 0;
        const tags = agent.meta.domainTags.map(t => t.toLowerCase());

        // Domain tag overlap with effects (0-35)
        let tagHits = 0;
        for (const effect of effectNames) {
            if (tags.some(tag => effect.includes(tag) || tag.includes(effect))) tagHits++;
        }
        raw += Math.min(35, (tagHits / Math.max(1, tags.length)) * 35);

        // Keyword match against prompt (0-25)
        const keywords = agent.domainMatchKeywords ?? [];
        let kwHits = 0;
        for (const kw of keywords) {
            if (promptLower.includes(kw.toLowerCase())) kwHits++;
        }
        raw += Math.min(25, (kwHits / Math.max(1, keywords.length)) * 50);

        // Signature intervention relevance (0-25)
        // Check if the agent's actual substances target the needed effects
        const sigs = agent.signatureInterventions ?? [];
        let sigHits = 0;
        for (const sig of sigs) {
            const sigText = `${sig.substance ?? sig.substanceKey ?? ''} ${sig.rationale}`.toLowerCase();
            for (const effect of effectNames) {
                if (sigText.includes(effect)) {
                    sigHits++;
                    break;
                }
            }
            // Also match against prompt keywords
            if (promptLower.split(/\s+/).some(w => w.length > 3 && sigText.includes(w))) sigHits++;
        }
        raw += Math.min(25, (sigHits / Math.max(1, sigs.length * 2)) * 50);

        // Efficacy baseline (0-15)
        raw += ((agent.efficacyScore ?? 3) / 5) * 15;

        // Map raw score (0-100) into realistic success-rate range (60-97)
        const pct = 60 + Math.round((Math.min(100, raw) / 100) * 37);

        return { agentId: agent.id, score: pct, reason: agent.meta.tagline.slice(0, 60) };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, 10);
}

/** Rank creator agents via fast LLM call. Falls back to keyword scoring on failure. */
export async function rankCreatorAgents(prompt: string, effects: WordCloudEffect[]): Promise<AgentMatchResult[]> {
    try {
        const systemPrompt = interpolatePrompt(PROMPTS.agentMatch, {
            userGoal: prompt,
            effectList: buildEffectList(effects),
            agentRoster: buildAgentRoster(),
        });

        const result = await runCachedStage<{ ranked: AgentMatchResult[] }>({
            stage: 'agentMatch',
            stageLabel: 'Agent Match',
            stageClass: 'agent-match-model',
            systemPrompt,
            userPrompt: 'Rank the top 10 creator agents for this user goal. Respond with JSON only.',
            maxTokens: 512,
        });

        const ranked = result?.ranked;
        if (!Array.isArray(ranked) || ranked.length === 0) {
            return fallbackRank(prompt, effects);
        }

        // Validate agent IDs exist
        return ranked
            .filter(r => getAgentById(r.agentId))
            .slice(0, 10)
            .map(r => ({
                agentId: r.agentId,
                score: typeof r.score === 'number' ? Math.max(60, Math.min(97, r.score)) : 80,
                reason: typeof r.reason === 'string' ? r.reason : '',
            }));
    } catch (err) {
        console.warn('[AgentMatcher] LLM ranking failed, using fallback:', (err as Error).message);
        return fallbackRank(prompt, effects);
    }
}

// ============================================
// Card UI — Right-side agent match panel
// ============================================

function getPanel(): HTMLElement {
    if (!_panel) {
        _panel = document.getElementById('agent-match-panel');
    }
    return _panel!;
}

function renderCard(agent: AgentConfig, result: AgentMatchResult, idx: number): string {
    const initial =
        agent.meta.creatorName?.charAt(0)?.toUpperCase() || agent.meta.name?.charAt(0)?.toUpperCase() || '?';
    const avatarInner = agent.meta.avatarUrl
        ? `<img src="${esc(agent.meta.avatarUrl)}" onerror="this.parentElement.innerHTML='${initial}'" />`
        : initial;

    const displayName = agent.meta.creatorName || agent.meta.name;
    const tags = (agent.meta.domainTags ?? [])
        .slice(0, 2)
        .map(t => `<span class="am-card-tag">${esc(t)}</span>`)
        .join('');

    return `
        <div class="am-card" data-agent-id="${esc(agent.id)}" style="transition-delay: ${idx * 150}ms">
            <div class="am-card-row">
                <div class="am-card-avatar">${avatarInner}</div>
                <div class="am-card-info">
                    <div class="am-card-creator-name">${esc(displayName)}</div>
                    <div class="am-card-handle">${esc(agent.meta.creatorHandle)}</div>
                </div>
                <div class="am-card-score">${result.score}%</div>
            </div>
            <div class="am-card-reason">${esc(result.reason)}</div>
            <div class="am-card-tags">${tags}</div>
        </div>`;
}

export function showAgentMatchPanel(): void {
    const panel = getPanel();
    if (!panel) return;

    const { matchedAgents, matchResults } = AgentMatchState;
    if (matchedAgents.length === 0) return;

    clearDockAnimationArtifacts();

    const cards = matchedAgents
        .map((agent, i) => {
            const result = matchResults[i] || { agentId: agent.id, score: 0, reason: '' };
            return renderCard(agent, result, i);
        })
        .join('');

    panel.innerHTML =
        `<div class="am-panel-header">
            <span class="am-panel-label">Protocol Streamers</span>
            <span class="am-panel-count">${matchedAgents.length}</span>
        </div>` + cards;
    panel.classList.remove('hidden');
    panel.style.pointerEvents = '';

    // Stagger reveal after layout
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            panel.classList.add('visible');
            const cardEls = panel.querySelectorAll('.am-card');
            cardEls.forEach((card, i) => {
                setTimeout(() => card.classList.add('revealed'), i * 150);
            });
        });
    });

    // Click delegation
    panel.addEventListener('click', _handleCardClick);
}

function _handleCardClick(e: Event): void {
    const card = (e.target as HTMLElement).closest('.am-card') as HTMLElement | null;
    if (!card) return;
    const agentId = card.dataset.agentId;
    if (!agentId) return;
    handleAgentSelection(agentId);
}

export function hideAgentMatchPanel(): void {
    const panel = getPanel();
    if (!panel) return;
    panel.removeEventListener('click', _handleCardClick);
    panel.style.pointerEvents = '';
    panel.classList.remove('visible');
    const cards = panel.querySelectorAll('.am-card');
    cards.forEach(c => c.classList.remove('revealed'));
    releaseHiddenSourceCards();
    setTimeout(() => {
        panel.classList.add('hidden');
        panel.innerHTML = '';
    }, 400);
}

// ============================================
// Selection & Dock Animation
// ============================================

function handleAgentSelection(agentId: string): void {
    const agent = getAgentById(agentId);
    if (!agent) return;

    AgentMatchState.selectedAgent = agent;
    AgentMatchState.phase = 'selected';

    const panel = getPanel();
    if (!panel) return;
    panel.removeEventListener('click', _handleCardClick);
    panel.style.pointerEvents = 'none';

    // Dismiss non-selected cards
    const cards = panel.querySelectorAll('.am-card') as NodeListOf<HTMLElement>;
    let selectedCard: HTMLElement | null = null;
    let dismissIdx = 0;

    cards.forEach(card => {
        if (card.dataset.agentId === agentId) {
            selectedCard = card;
            card.classList.add('am-card-selected');
        } else {
            card.style.transitionDelay = `${dismissIdx * 100}ms`;
            card.classList.add('am-card-dismissing');
            dismissIdx++;
        }
    });

    // After dismissal, animate selected card to VCR dock
    queueDockTimer(() => {
        if (selectedCard) {
            animateDock(selectedCard, agent);
        }
    }, DOCK_DISMISS_DELAY);
}

function animateDock(card: HTMLElement, agent: AgentConfig): void {
    const vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement | null;
    if (!vcrPanel) {
        dockAgentToVcr(agent);
        hideAgentMatchPanel();
        return;
    }

    clearDockAnimationArtifacts();

    const cardRect = card.getBoundingClientRect();
    const geometry = computeDockGeometry(vcrPanel, agent, cardRect);
    const floatingCard = card.cloneNode(true) as HTMLElement;
    const placeholder = document.createElement('div');
    placeholder.className = 'am-card-placeholder';
    placeholder.style.height = `${cardRect.height.toFixed(1)}px`;
    placeholder.style.width = `${cardRect.width.toFixed(1)}px`;
    card.replaceWith(placeholder);
    _floatingPlaceholder = placeholder;
    floatingCard.classList.add('am-dock-card-clone');
    floatingCard.style.left = `${cardRect.left.toFixed(1)}px`;
    floatingCard.style.top = `${cardRect.top.toFixed(1)}px`;
    floatingCard.style.width = `${cardRect.width.toFixed(1)}px`;
    floatingCard.style.height = `${cardRect.height.toFixed(1)}px`;
    floatingCard.style.transitionDelay = '0ms';
    document.body.appendChild(floatingCard);
    _floatingCard = floatingCard;

    requestAnimationFrame(() => {
        floatingCard.style.transition = [
            `top ${DOCK_STAGE_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            `box-shadow ${DOCK_STAGE_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            `border-color ${DOCK_STAGE_DURATION}ms ease`,
        ].join(', ');
        floatingCard.style.top = `${geometry.stageTop.toFixed(1)}px`;
        floatingCard.style.boxShadow = '0 24px 48px rgba(2, 8, 20, 0.34)';
        floatingCard.style.borderColor = 'rgba(245, 200, 80, 0.28)';
    });

    queueDockTimer(() => {
        if (!_floatingCard) return;
        const landedRect = _floatingCard.getBoundingClientRect();
        const capsule = createFloatingCapsule(agent);
        const morphStartLeft =
            landedRect.left + Math.max(14, Math.min(30, (landedRect.width - geometry.capsuleWidth) * 0.18));
        const glideTargetX = geometry.capsuleLeft - DOCK_COCK_DISTANCE - morphStartLeft;
        const dockTargetX = geometry.capsuleLeft - morphStartLeft;
        capsule.style.left = `${morphStartLeft.toFixed(1)}px`;
        capsule.style.top = `${geometry.capsuleTop.toFixed(1)}px`;
        capsule.style.width = `${geometry.capsuleWidth.toFixed(1)}px`;
        capsule.style.height = `${geometry.capsuleHeight.toFixed(1)}px`;
        document.body.appendChild(capsule);
        _floatingCapsule = capsule;

        requestAnimationFrame(() => {
            _floatingCard?.classList.add('am-dock-card-clone-fading');
            capsule.classList.add('visible');
        });

        queueDockTimer(() => {
            _floatingCard?.remove();
            _floatingCard = null;
        }, DOCK_MORPH_DURATION);

        queueDockTimer(() => {
            if (!_floatingCapsule) return;
            _floatingCapsule.style.transition = [
                `transform ${DOCK_SLIDE_DURATION}ms cubic-bezier(0.18, 0.96, 0.32, 1)`,
                'opacity 140ms ease',
                'filter 180ms ease',
                'box-shadow 220ms ease',
            ].join(', ');
            _floatingCapsule.style.transform = `translate3d(${glideTargetX.toFixed(1)}px, 0, 0) scale(1)`;
        }, DOCK_MORPH_DURATION + 12);

        queueDockTimer(
            () => {
                if (!_floatingCapsule) return;
                _floatingCapsule.style.transition = [
                    `transform ${DOCK_COCK_DURATION}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
                    'opacity 120ms ease',
                    'filter 140ms ease',
                    'box-shadow 180ms ease',
                ].join(', ');
                _floatingCapsule.style.transform = `translate3d(${dockTargetX.toFixed(1)}px, 0, 0) scale(0.985)`;
                _floatingCapsule.style.boxShadow = '0 9px 20px rgba(2, 8, 20, 0.16)';
            },
            DOCK_MORPH_DURATION + DOCK_SLIDE_DURATION + 12,
        );

        queueDockTimer(
            () => {
                dockAgentToVcr(agent, geometry);
                if (_floatingCapsule) {
                    _floatingCapsule.style.transition = 'opacity 90ms ease, filter 110ms ease';
                    _floatingCapsule.style.opacity = '0';
                    _floatingCapsule.style.filter = 'blur(1.5px)';
                }
            },
            DOCK_MORPH_DURATION + DOCK_SLIDE_DURATION + DOCK_COCK_DURATION,
        );

        queueDockTimer(
            () => {
                clearDockAnimationArtifacts();
                hideAgentMatchPanel();
            },
            DOCK_MORPH_DURATION + DOCK_SLIDE_DURATION + DOCK_COCK_DURATION + 100,
        );
    }, DOCK_STAGE_DURATION);
}

function dockAgentToVcr(agent: AgentConfig, geometry?: DockGeometry): void {
    AgentMatchState.phase = 'docked';

    // Remove any existing dock widget
    undockAgent();

    const vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement | null;
    if (!vcrPanel) return;
    const target = geometry ?? computeDockGeometry(vcrPanel, agent, vcrPanel.getBoundingClientRect());
    vcrPanel.style.setProperty('--vcr-pill-right', `${computePillRightRelative(vcrPanel).toFixed(1)}px`);
    vcrPanel.style.setProperty('--vcr-agent-dock-shell-width', `${target.shellWidth.toFixed(1)}px`);
    vcrPanel.style.setProperty('--vcr-agent-dock-content-width', `${target.contentWidth.toFixed(1)}px`);
    vcrPanel.style.setProperty('--vcr-agent-dock-height', `${target.capsuleHeight.toFixed(1)}px`);

    const dockWing = document.createElement('div');
    dockWing.className = 'vcr-wing-agent-dock';
    dockWing.innerHTML = buildDockInnerHTML(
        agent,
        'vcr-agent-dock-avatar',
        'vcr-agent-dock-name',
        'vcr-agent-dock-img',
    );

    vcrPanel.appendChild(dockWing);
    vcrPanel.classList.add('vcr-agent-docked');

    // Animate in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            vcrPanel.classList.add('vcr-agent-dock-visible');
            dockWing.classList.add('visible');
        });
    });
}

export function undockAgent(): void {
    const existing = document.querySelector('.vcr-wing-agent-dock');
    if (existing) existing.remove();
    const vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement | null;
    vcrPanel?.classList.remove('vcr-agent-docked', 'vcr-agent-dock-visible');
    vcrPanel?.style.removeProperty('--vcr-agent-dock-shell-width');
    vcrPanel?.style.removeProperty('--vcr-agent-dock-content-width');
    vcrPanel?.style.removeProperty('--vcr-agent-dock-height');
}

// ============================================
// Reset
// ============================================

export function resetAgentMatch(): void {
    AgentMatchState.matchedAgents = [];
    AgentMatchState.matchResults = [];
    AgentMatchState.selectedAgent = null;
    AgentMatchState.phase = 'idle';
    clearDockAnimationArtifacts();
    undockAgent();
    hideAgentMatchPanel();
}
