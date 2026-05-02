/**
 * card-expander — Inline card expansion UI for 28-day program cards.
 * Shows substance details + "Add to Stream" button when a wide card is clicked.
 *
 * Uses FLIP animation (First-Last-Invert-Play) for smooth 60fps expansion:
 * the clone is created at its final layout immediately, then a transform
 * animation makes it appear to fly out from the card position.
 *
 * Exports: expandCard, collapseExpandedCard, isCardExpanded
 * Depends on: cycle-store, substances, my-stream-store, my-stream, constants
 */

import { loadCycleBundle, type SavedCycleIndexEntry, type SessionCacheBundle } from './cycle-store';
import { SUBSTANCE_DB } from './substances';
import { addToStream, removeFromStream, isInStream, type SubstanceInput } from './my-stream-store';
import { refreshMyStream, animateStreamFill } from './my-stream';
import { BIOMETRIC_DEVICES } from './biometric-devices';
import { getAgentById } from './creator-agents';
import { initTrailer, stopTrailer } from './card-trailer';
import { escapeHtml } from './utils';

// ── State ──────────────────────────────────────────────────────────

let _originalCardEl: HTMLElement | null = null; // the real card in the row (kept hidden in place)
let _cloneCardEl: HTMLElement | null = null; // the deep clone that animates over the page
let _expandedPanelEl: HTMLElement | null = null;
let _expandedCycleId: string | null = null;
let _backdropEl: HTMLElement | null = null;
let _outsideClickHandler: ((e: MouseEvent) => void) | null = null;
let _keyHandler: ((e: KeyboardEvent) => void) | null = null;
let _outsideClickAttachTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingTrailerBundle: SessionCacheBundle | null = null;
let _pendingTrailerCycleId: string | null = null;
let _expandSessionToken = 0;
let _activeFlipAnimation: Animation | null = null;

// ── Constants ─────────────────────────────────────────────────────

const FLIP_EXPAND_MS = 400;
const FLIP_COLLAPSE_MS = 300;
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CONTENT_FADE_IN_DELAY = 150;
const CONTENT_HIDE_MS = 120;

// ── Helpers ───────────────────────────────────────────────────────

function clearOutsideClickAttachTimer(): void {
    if (_outsideClickAttachTimer == null) return;
    clearTimeout(_outsideClickAttachTimer);
    _outsideClickAttachTimer = null;
}

/**
 * FLIP animation: animates an element from `fromRect` to its current position
 * using only transform + opacity (compositor-only, zero layout recalculation).
 */
function flipAnimate(
    el: HTMLElement,
    fromRect: DOMRect,
    toRect: DOMRect,
    durationMs: number,
    easing: string,
    fromBorderRadius: string,
): Animation {
    const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
    const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
    const sx = fromRect.width / toRect.width;
    const sy = fromRect.height / toRect.height;

    return el.animate(
        [
            {
                transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
                opacity: 0.85,
                borderRadius: fromBorderRadius,
            },
            {
                transform: 'none',
                opacity: 1,
                borderRadius: '6px',
            },
        ],
        { duration: durationMs, easing, fill: 'none' },
    );
}

function clearQueuedTrailer(): void {
    _pendingTrailerBundle = null;
    _pendingTrailerCycleId = null;
}

function queueTrailerInit(cycleId: string, bundle: SessionCacheBundle): void {
    _pendingTrailerBundle = bundle;
    _pendingTrailerCycleId = cycleId;
}

function maybeStartQueuedTrailer(cycleId: string): void {
    const clone = _cloneCardEl;
    if (!clone || _expandedCycleId !== cycleId) return;
    if (clone.dataset.expandState !== 'open') return;
    if (_pendingTrailerCycleId !== cycleId || !_pendingTrailerBundle) return;
    const bundle = _pendingTrailerBundle;
    clearQueuedTrailer();
    initTrailer(clone, bundle, cycleId);
}

function attachDismissHandlers(clone: HTMLElement, sessionToken: number): void {
    // Outside click handler — collapse if click lands outside the CLONE
    clearOutsideClickAttachTimer();
    _outsideClickAttachTimer = window.setTimeout(() => {
        _outsideClickAttachTimer = null;
        if (sessionToken !== _expandSessionToken || _cloneCardEl !== clone) return;
        _outsideClickHandler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (_cloneCardEl && !_cloneCardEl.contains(target)) {
                e.stopPropagation();
                e.preventDefault();
                collapseExpandedCard();
            }
        };
        document.addEventListener('click', _outsideClickHandler, true);
    }, 50);

    // Escape key to close
    _keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') collapseExpandedCard();
    };
    document.addEventListener('keydown', _keyHandler);
}

function detachDismissHandlers(): void {
    clearOutsideClickAttachTimer();
    if (_outsideClickHandler) {
        document.removeEventListener('click', _outsideClickHandler, true);
        _outsideClickHandler = null;
    }
    if (_keyHandler) {
        document.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
    }
}

// ── Public API ─────────────────────────────────────────────────────

/** Expand a wide card inline, showing details + Add button. */
export function expandCard(cardEl: HTMLElement, entry: SavedCycleIndexEntry): void {
    // If same card is already expanded, collapse it
    if (_expandedCycleId === entry.id) {
        collapseExpandedCard();
        return;
    }

    // Collapse any previously expanded card
    collapseExpandedCard();
    const sessionToken = ++_expandSessionToken;

    _originalCardEl = cardEl;
    _expandedCycleId = entry.id;
    clearQueuedTrailer();

    // ── FIRST: record card's current position ──────────────────────
    const fromRect = cardEl.getBoundingClientRect();
    const fromBorderRadius = getComputedStyle(cardEl).borderRadius || '6px';

    // ── Build expand panel ─────────────────────────────────────────
    const panel = buildExpandPanel(entry);
    _expandedPanelEl = panel;

    // ── Blurred backdrop ───────────────────────────────────────────
    const backdrop = document.createElement('div');
    backdrop.className = 'cg-card-backdrop';
    document.body.appendChild(backdrop);
    _backdropEl = backdrop;
    requestAnimationFrame(() => backdrop.classList.add('cg-card-backdrop--on'));

    // ── Deep clone the card — always in final Netflix-style layout ─
    const clone = cardEl.cloneNode(true) as HTMLElement;
    clone.classList.add('cg-card-expanded');
    clone.removeAttribute('data-cycle-id');
    _cloneCardEl = clone;

    // ── Pre-build the 3-column score grid so the layout is stable from
    //    the start. The trailer fills these placeholders later; this avoids
    //    the score % jumping horizontally when initTrailer() restructures. ─
    const scoreLine = clone.querySelector('.cg-card-score-line') as HTMLElement | null;
    if (scoreLine) {
        const scoreCenter = document.createElement('div');
        scoreCenter.className = 'cg-trailer-score-center';
        while (scoreLine.firstChild) scoreCenter.appendChild(scoreLine.firstChild);
        const beatsPlaceholder = document.createElement('div');
        beatsPlaceholder.className = 'cg-trailer-beats-left';
        beatsPlaceholder.style.opacity = '0';
        const hookPlaceholder = document.createElement('div');
        hookPlaceholder.className = 'cg-expand-hook';
        hookPlaceholder.style.opacity = '0';
        scoreLine.append(beatsPlaceholder, scoreCenter, hookPlaceholder);
    }

    // ── Build and append close button ──────────────────────────────
    const closeBtn = buildCloseButton();

    // Append panel + close to clone immediately (no deferred append)
    clone.append(panel, closeBtn);

    // ── Hide original card (flex slot preserved) ───────────────────
    cardEl.style.visibility = 'hidden';

    // ── LAST: Position clone at final size/position ────────────────
    const maxW = Math.min(960, window.innerWidth - 48);
    const targetW = Math.max(Math.min(maxW, 900), Math.min(fromRect.width * 4, maxW));
    const finalH = Math.min(window.innerHeight - 48, 960);
    const finalLeft = Math.max(24, (window.innerWidth - targetW) / 2);
    const finalTop = Math.max(24, (window.innerHeight - finalH) / 2);

    clone.style.cssText =
        `position:fixed;` +
        `top:${finalTop}px;left:${finalLeft}px;` +
        `width:${targetW}px;height:${finalH}px;` +
        `margin:0;z-index:2001;` +
        `overflow:hidden;will-change:transform;` +
        `transform-origin:center center;`;
    document.body.appendChild(clone);

    // ── Read the clone's actual rect for FLIP calculation ──────────
    const toRect = clone.getBoundingClientRect();

    // ── INVERT + PLAY: FLIP animation ──────────────────────────────
    const anim = flipAnimate(clone, fromRect, toRect, FLIP_EXPAND_MS, FLIP_EASING, fromBorderRadius);
    _activeFlipAnimation = anim;

    // Reveal panel content partway through the FLIP
    setTimeout(() => {
        if (sessionToken !== _expandSessionToken || _cloneCardEl !== clone) return;
        clone.classList.add('cg-expand--revealed');
    }, CONTENT_FADE_IN_DELAY);

    // On FLIP completion: mark as open, start trailer
    anim.finished
        .then(() => {
            if (sessionToken !== _expandSessionToken || _cloneCardEl !== clone) return;
            _activeFlipAnimation = null;
            clone.dataset.expandState = 'open';
            maybeStartQueuedTrailer(entry.id);
        })
        .catch(() => {
            // Animation was cancelled (e.g. rapid collapse) — safe to ignore
        });

    // ── Wire interactive elements ──────────────────────────────────
    wireAddButton(panel, entry, cardEl);
    wireDesignLink(panel, entry, cardEl);

    // ── Async enrichment (loads bundle while FLIP plays) ───────────
    void loadAndEnrich(entry.id, panel);

    // ── Dismiss handlers ───────────────────────────────────────────
    attachDismissHandlers(clone, sessionToken);
}

/** Collapse any expanded card. */
export function collapseExpandedCard(): void {
    _expandSessionToken += 1;
    const original = _originalCardEl;
    const clone = _cloneCardEl;
    const backdrop = _backdropEl;

    // Stop trailer animation before clearing state
    stopTrailer();
    clearQueuedTrailer();

    // Clear module refs up front so re-entrancy is safe
    _originalCardEl = null;
    _cloneCardEl = null;
    _expandedPanelEl = null;
    _expandedCycleId = null;
    _backdropEl = null;

    // Cancel any running FLIP animation
    if (_activeFlipAnimation) {
        _activeFlipAnimation.cancel();
        _activeFlipAnimation = null;
    }

    detachDismissHandlers();

    // Unhide the original card immediately
    if (original) original.style.visibility = '';

    // Fade backdrop
    if (backdrop) backdrop.classList.remove('cg-card-backdrop--on');

    if (!clone) {
        if (backdrop) backdrop.remove();
        return;
    }

    // Trigger panel content fade-out
    clone.classList.remove('cg-expand--revealed');
    clone.classList.add('cg-expand--collapsing');
    clone.style.overflow = 'hidden';

    const cleanup = () => {
        if (clone.parentElement) clone.remove();
        if (backdrop?.parentElement) backdrop.remove();
    };

    // Get current positions for reverse FLIP
    const cloneRect = clone.getBoundingClientRect();
    const targetRect = original ? original.getBoundingClientRect() : cloneRect;
    const targetBorderRadius = original ? getComputedStyle(original).borderRadius || '6px' : '6px';

    // Reverse FLIP: animate from current position back to card
    const anim = clone.animate(
        [
            {
                transform: 'none',
                opacity: 1,
                borderRadius: '6px',
            },
            {
                transform: `translate(${targetRect.left + targetRect.width / 2 - (cloneRect.left + cloneRect.width / 2)}px, ${targetRect.top + targetRect.height / 2 - (cloneRect.top + cloneRect.height / 2)}px) scale(${targetRect.width / cloneRect.width}, ${targetRect.height / cloneRect.height})`,
                opacity: 0.85,
                borderRadius: targetBorderRadius,
            },
        ],
        { duration: FLIP_COLLAPSE_MS, easing: FLIP_EASING, fill: 'forwards' },
    );

    anim.finished.then(cleanup).catch(cleanup);
}

/** Check if a card is currently expanded. */
export function isCardExpanded(cycleId: string): boolean {
    return _expandedCycleId === cycleId;
}

// ── Panel building ────────────────────────────────────────────────

function buildExpandPanel(entry: SavedCycleIndexEntry): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'cg-card-expand-panel';

    const classesHtml = buildSubstanceClassesHtml(entry.substanceClasses || []);
    const effectsHtml = buildEffectsHtml(entry.topEffects || []);
    const durationText = buildDurationText(entry);
    const effectCountText = entry.maxEffects === 2 ? '2 effects' : '1 effect';
    const savedDate = formatDate(entry.savedAt);
    const devicesHtml = buildDeviceIconsHtml(entry.recommendedDevices);

    panel.innerHTML = `
        <div class="cg-expand-actions-row">
            <button class="cg-expand-add" data-cycle-id="${escapeHtml(entry.id)}" aria-label="Add to Stream">
                ${isInStream(entry.id) ? checkSvg() : plusSvg()}
                <span class="cg-expand-add-label">${isInStream(entry.id) ? 'In Stream' : 'Add to Stream'}</span>
            </button>
            <button class="cg-expand-design-link" data-cycle-id="${escapeHtml(entry.id)}">
                Open in Studio
            </button>
            <span class="cg-expand-prompt-inline">${escapeHtml(entry.prompt || '')}</span>
        </div>
        <div class="cg-expand-agent-row">
            <div class="cg-expand-agent-strip"></div>
            <span class="cg-expand-duration">${escapeHtml(durationText)}</span>
            <div class="cg-expand-agent-tags-row">${effectsHtml}</div>
        </div>
        <div class="cg-expand-body">
            <div class="cg-expand-col cg-expand-col-left">
                <div class="cg-trailer-device-slot" aria-hidden="true"></div>
            </div>
            <div class="cg-expand-col cg-expand-col-right">
                <div class="cg-expand-meta-row">
                    <span class="cg-expand-section-label">Substances</span>
                    <div class="cg-expand-substances">${classesHtml}</div>
                </div>
                ${devicesHtml ? `<div class="cg-expand-meta-row"><span class="cg-expand-section-label">Biometrics</span><div class="cg-expand-devices">${devicesHtml}</div></div>` : ''}
                <div class="cg-expand-meta-row">
                    <span class="cg-expand-section-label">This Protocol Is</span>
                    <span class="cg-expand-tags">${escapeHtml(effectCountText)}${savedDate ? ' · Saved ' + escapeHtml(savedDate) : ''}</span>
                </div>
            </div>
        </div>
    `;

    return panel;
}

function wireAddButton(panel: HTMLElement, entry: SavedCycleIndexEntry, cardEl: HTMLElement): void {
    const addBtn = panel.querySelector('.cg-expand-add') as HTMLButtonElement;
    addBtn.addEventListener('click', e => {
        e.stopPropagation();
        handleAddToggle(entry, addBtn);
    });

    if (isInStream(entry.id)) {
        addBtn.classList.add('cg-expand-add-active');
        cardEl.classList.add('cg-card-in-stream');
    }
}

function wireDesignLink(panel: HTMLElement, entry: SavedCycleIndexEntry, cardEl: HTMLElement): void {
    const designLink = panel.querySelector('.cg-expand-design-link') as HTMLButtonElement;
    designLink.addEventListener('click', e => {
        e.stopPropagation();
        cardEl.dispatchEvent(new CustomEvent('card-open-design', { bubbles: true, detail: { id: entry.id } }));
    });
}

function buildCloseButton(): HTMLButtonElement {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cg-expand-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
        '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        collapseExpandedCard();
    });
    return closeBtn;
}

// ── Add/Remove toggle ──────────────────────────────────────────────

async function handleAddToggle(entry: SavedCycleIndexEntry, btn: HTMLButtonElement): Promise<void> {
    const inStream = isInStream(entry.id);

    if (inStream) {
        // Remove from stream
        removeFromStream(entry.id);
        btn.innerHTML = plusSvg();
        btn.classList.remove('cg-expand-add-active');
        _originalCardEl?.classList.remove('cg-card-in-stream');
        refreshMyStream();
    } else {
        // Add to stream — need to load full bundle for substance data
        btn.classList.add('cg-expand-add-loading');
        btn.disabled = true;

        try {
            const bundle = await loadCycleBundle(entry.id);
            if (!bundle) {
                btn.classList.remove('cg-expand-add-loading');
                btn.disabled = false;
                return;
            }

            const daySubstances = extractDaySubstances(bundle, entry);
            addToStream(entry.id, entry.filename, daySubstances);

            btn.innerHTML = checkSvg();
            btn.classList.add('cg-expand-add-active');
            btn.classList.remove('cg-expand-add-loading');
            btn.disabled = false;
            _originalCardEl?.classList.add('cg-card-in-stream');

            // Animate the stream fill
            animateStreamFill(entry.id);
        } catch {
            btn.classList.remove('cg-expand-add-loading');
            btn.disabled = false;
        }
    }
}

// ── Bundle extraction ──────────────────────────────────────────────

/**
 * Extract per-day substance inputs from a cycle bundle.
 * For multi-day programs, uses grandmaster-daily-model days.
 * For single-day patterns, uses intervention-model and tiles.
 */
function extractDaySubstances(bundle: SessionCacheBundle, entry: SavedCycleIndexEntry): SubstanceInput[][] {
    const days: SubstanceInput[][] = [];

    // Try multi-day data first (grandmaster-daily-model)
    const gmPayload = (bundle.stages as any)?.['grandmaster-daily-model']?.payload;
    if (gmPayload?.days && Array.isArray(gmPayload.days) && gmPayload.days.length > 0) {
        for (const dayData of gmPayload.days) {
            const ivs = extractInterventionsFromPayload(dayData);
            days.push(ivs.map(ivToSubstanceInput));
        }
        return days;
    }

    // Fall back to single-day intervention-model
    const ivPayload =
        (bundle.stages as any)?.['intervention-model']?.payload ||
        (bundle.stages as any)?.['extended-intervention']?.payload;
    if (ivPayload) {
        const ivs = extractInterventionsFromPayload(ivPayload);
        const subs = ivs.map(ivToSubstanceInput);
        // Tile to fill days based on timeHorizon
        const patternDays = entry.timeHorizon?.dailyPatternRepeats ? 1 : (entry.timeHorizon?.durationDays ?? 28);
        for (let d = 0; d < patternDays; d++) {
            days.push(subs);
        }
        return days;
    }

    // No data — return empty
    return [[]];
}

function extractInterventionsFromPayload(payload: any): any[] {
    if (!payload) return [];
    // Grandmaster daily format: payload.interventions or payload directly
    if (Array.isArray(payload.interventions)) return payload.interventions;
    if (Array.isArray(payload)) return payload;
    return [];
}

function ivToSubstanceInput(iv: any): SubstanceInput {
    const dbEntry = SUBSTANCE_DB[iv.key];
    return {
        name: dbEntry?.name || iv.key || 'Unknown',
        color: dbEntry?.color || iv.substance?.color || '#60a5fa',
        dose: iv.dose || dbEntry?.standardDose || '',
        timeMinutes: typeof iv.timeMinutes === 'number' ? iv.timeMinutes : 480,
    };
}

// ── Async enrichment ───────────────────────────────────────────────

async function loadAndEnrich(cycleId: string, panel: HTMLElement): Promise<void> {
    const substancesEl = panel.querySelector('.cg-expand-substances');
    const agentStripEl = panel.querySelector('.cg-expand-agent-strip');

    try {
        const bundle = await loadCycleBundle(cycleId);
        if (!bundle || _expandedCycleId !== cycleId) return; // card was closed

        // Substance list enrichment
        const ivPayload =
            (bundle.stages as any)?.['intervention-model']?.payload ||
            (bundle.stages as any)?.['extended-intervention']?.payload;
        const ivList: any[] = ivPayload?.interventions || [];
        if (ivList.length > 0 && substancesEl) {
            substancesEl.innerHTML = buildSubstanceListHtml(ivList);
        }

        // Matched KOL strip — top-1 headliner from agent-match-model
        if (agentStripEl) {
            const agentPayload = (bundle.stages as any)?.['agent-match-model']?.payload;
            const top = agentPayload?.ranked?.[0];
            if (top?.agentId) {
                const agent = getAgentById(top.agentId);
                if (agent) {
                    agentStripEl.innerHTML = buildAgentStripHtml(agent, top.score, agentPayload.categoryTitle);
                }
            }
        }

        // Protocol trailer — auto-play curve build-up + beat strip + score counter
        queueTrailerInit(cycleId, bundle);
        maybeStartQueuedTrailer(cycleId);
    } catch {
        // Keep the default views
    }
}

// ── HTML builders ──────────────────────────────────────────────────

function buildSubstanceClassesHtml(classes: string[]): string {
    if (classes.length === 0) return '<span class="cg-expand-loading">Loading substances...</span>';
    return classes
        .map(cls => {
            const palette = getClassHeroColor(cls);
            return `<span class="cg-expand-class-badge" style="--badge-color:${palette}">
                <span class="cg-expand-class-dot" style="background:${palette}"></span>${escapeHtml(cls)}
            </span>`;
        })
        .join('');
}

function buildSubstanceListHtml(interventions: any[]): string {
    // Deduplicate by key, show name + dose + color dot
    const seen = new Set<string>();
    const items: string[] = [];
    for (const iv of interventions) {
        if (seen.has(iv.key)) continue;
        seen.add(iv.key);
        const db = SUBSTANCE_DB[iv.key];
        const name = db?.name || iv.key;
        const color = db?.color || '#60a5fa';
        const dose = iv.dose || db?.standardDose || '';
        items.push(
            `<span class="cg-expand-substance-item">
                <span class="cg-expand-substance-dot" style="background:${color}"></span>
                <span class="cg-expand-substance-name">${escapeHtml(name)}</span>
                ${dose ? `<span class="cg-expand-substance-dose">${escapeHtml(dose)}</span>` : ''}
            </span>`,
        );
    }
    return items.join('');
}

function buildAgentStripHtml(agent: any, _score: number, categoryTitle: string): string {
    const displayName: string = agent.meta.creatorName || agent.meta.name || 'Protocol Streamer';
    const initial = (displayName[0] || '?').toUpperCase();
    const avatarUrl = escapeHtml(agent.meta.avatarUrl || '');
    const handle = escapeHtml(agent.meta.creatorHandle || '');
    const category = escapeHtml(categoryTitle || 'Protocol Streamer');

    return `
        <div class="cg-expand-agent-avatar">
            <img src="${avatarUrl}" alt="${escapeHtml(displayName)}" onerror="this.parentElement.innerHTML='${escapeHtml(initial)}'" />
        </div>
        <div class="cg-expand-agent-info">
            <div class="cg-expand-agent-category">${category}</div>
            <div class="cg-expand-agent-name-row">
                <span class="cg-expand-agent-name">${escapeHtml(displayName)}</span>
                <span class="cg-expand-agent-handle">${handle}</span>
            </div>
        </div>
    `;
}

function buildEffectsHtml(effects: string[]): string {
    return effects
        .slice(0, 4)
        .map(e => `<span class="cg-expand-effect-tag">${escapeHtml(e)}</span>`)
        .join('');
}

function buildDurationText(entry: SavedCycleIndexEntry): string {
    const th = entry.timeHorizon;
    if (!th) return '28-day program';
    const days = th.durationDays ?? 28;
    const mode = th.mode ?? 'program';
    return `${days}-day ${mode}${th.dailyPatternRepeats ? ' (repeating)' : ''}`;
}

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

const _deviceMap = new Map(BIOMETRIC_DEVICES.devices.map(d => [d.key, d]));

function buildDeviceIconsHtml(devices: string[] | undefined): string {
    if (!devices || devices.length === 0) return '';
    const light = document.body.classList.contains('light-mode');
    const icons = devices
        .map(key => {
            const dev = _deviceMap.get(key);
            if (!dev) return '';
            const src = light ? dev.iconLight : dev.iconDark;
            return `<img class="cg-expand-device-icon" src="${src}" data-src-dark="${dev.iconDark}" data-src-light="${dev.iconLight}" alt="${escapeHtml(dev.name)}" title="${escapeHtml(dev.name)}" width="20" height="20" />`;
        })
        .filter(Boolean)
        .join('');
    return icons;
}

function getClassHeroColor(className: string): string {
    const palettes: Record<string, string> = {
        Stimulant: '#ff4757',
        'Depressant/Sleep': '#778beb',
        Nootropic: '#1e90ff',
        Adaptogen: '#2ed573',
        'Psychedelic/Atypical': '#9b59b6',
        'Mineral/Electrolyte': '#ffa502',
        'Vitamin/Amino': '#eccc68',
        'Essential Fatty Acid': '#00b8d4',
        'Psychiatric/Other': '#747d8c',
    };
    return palettes[className] || '#94a3b8';
}

function plusSvg(): string {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}

function checkSvg(): string {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}
