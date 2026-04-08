// ============================================
// SHERLOCK — Narration Panel & Card Stack
// ============================================
// Cards are absolutely positioned within the panel.
// The active card sits at the vertical center of the SVG chart.
// When a new card arrives, older cards animate upward and fade out.
// The panel is appended to <body>, positioned via JS to the left of the SVG.

import { PHASE_CHART } from './constants';
import { SherlockState, TimelineState, isTurboActive } from './state';
import { formatMinutesAsClockTime } from './utils';
import { SUBSTANCE_DB } from './substances';
import type { Sherlock7DBeat } from './types';

let _panel: HTMLElement | null = null;
let _repositionRAF: number | null = null;
let _scrollSettleTimer: number | null = null;
const SHERLOCK_ENTER_MS = 400;
const SHERLOCK_SCROLL_SETTLE_MS = SHERLOCK_ENTER_MS + 60;
const CARD_STACK_GAP = 12;

let _scrollSyncRAF: number | null = null;
let _panelScrollHandler: ((e: Event) => void) | null = null;
let _boundScrollPanel: HTMLElement | null = null;
let _lastAnimatedPanelHeight = -1;
let _pendingScrollTarget: SherlockCardScrollTarget | null = null;
let _externalHoverLock = false;
let _clickedSubstanceKey: string | null = null;

interface SherlockCardScrollTarget {
    id?: string | null;
    substanceKey?: string | null;
    curveIdx?: number | null;
    timeMinutes?: number | null;
}

function clearScrollSettleTimer(): void {
    if (_scrollSettleTimer !== null) {
        window.clearTimeout(_scrollSettleTimer);
        _scrollSettleTimer = null;
    }
}

function clearScrollSyncRAF(): void {
    if (_scrollSyncRAF !== null) {
        cancelAnimationFrame(_scrollSyncRAF);
        _scrollSyncRAF = null;
    }
}

function parseCurveIdx(value: string | null): number | null {
    if (!value) return null;
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) return null;
    return n;
}

function parseTimeMinutes(value: string | null): number | null {
    if (value == null || value === '') return null;
    const n = parseFloat(value);
    if (!isFinite(n)) return null;
    return n;
}

function setCurveFocus(curveIdx: number | null): void {
    const focusIdx = curveIdx !== null && curveIdx >= 0 ? curveIdx : null;

    document.querySelectorAll('.timeline-pill-group').forEach(pill => {
        pill.classList.remove('pill-dim', 'pill-highlight');
        if (focusIdx === null) return;
        const marker = pill.querySelector('.timeline-curve-dot, .timeline-connector');
        const markerIdx = parseInt(marker?.getAttribute('data-curve-idx') || '-1', 10);
        if (markerIdx === focusIdx) pill.classList.add('pill-highlight');
        else pill.classList.add('pill-dim');
    });

    document.querySelectorAll('.lx-auc-band').forEach(band => {
        band.classList.remove('band-dim', 'band-highlight');
        if (focusIdx === null) return;
        const bandIdx = parseInt(band.getAttribute('data-curve-idx') || '-1', 10);
        if (bandIdx === focusIdx) band.classList.add('band-highlight');
        else band.classList.add('band-dim');
    });
}

function clearCurveFocus(): void {
    setCurveFocus(null);
}

/**
 * Apply band/pill highlight classes for a substance key (visual only).
 * Does NOT update click-tracking state — use _clickedSubstanceKey for that.
 */
function applyBandPillHighlight(substanceKey: string | null): void {
    const bands = document.querySelectorAll('.lx-auc-band');
    const pills = document.querySelectorAll('.timeline-pill-group');

    bands.forEach(band => {
        band.classList.remove('band-dim', 'band-highlight');
        if (substanceKey === null) return;
        if (band.getAttribute('data-substance-key') === substanceKey) {
            band.classList.add('band-highlight');
        } else {
            band.classList.add('band-dim');
        }
    });

    pills.forEach(pill => {
        pill.classList.remove('pill-dim', 'pill-highlight');
        if (substanceKey === null) return;
        if (pill.getAttribute('data-substance-key') === substanceKey) {
            pill.classList.add('pill-highlight');
        } else {
            pill.classList.add('pill-dim');
        }
    });
}

function clearSubstanceFocus(): void {
    _clickedSubstanceKey = null;
    applyBandPillHighlight(null);
}

function unbindScrollTracking(): void {
    clearScrollSyncRAF();
    if (_boundScrollPanel && _panelScrollHandler) {
        _boundScrollPanel.removeEventListener('scroll', _panelScrollHandler);
    }
    _boundScrollPanel = null;
    _panelScrollHandler = null;
}

function bindScrollTracking(panel: HTMLElement): void {
    if (_boundScrollPanel === panel) return;
    unbindScrollTracking();
    _panelScrollHandler = () => queueScrollableCenterSync();
    panel.addEventListener('scroll', _panelScrollHandler, { passive: true });
    _boundScrollPanel = panel;
}

function getCenteredCard(panel: HTMLElement): HTMLElement | null {
    const cards = Array.from(panel.querySelectorAll('.waze-card')) as HTMLElement[];
    if (cards.length === 0) return null;

    const rect = panel.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    let nearest = cards[0];
    let minDist = Infinity;

    cards.forEach(card => {
        const r = card.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - centerY);
        if (d < minDist) {
            minDist = d;
            nearest = card;
        }
    });
    return nearest;
}

function syncScrollableCenterState(): void {
    if (_externalHoverLock) return;
    if (!_panel || !_panel.classList.contains('scrollable')) return;
    const cards = Array.from(_panel.querySelectorAll('.waze-card')) as HTMLElement[];
    if (cards.length === 0) {
        clearCurveFocus();
        return;
    }

    const centerCard = getCenteredCard(_panel);
    cards.forEach(card => {
        card.classList.toggle('sherlock-scroll-active', card === centerCard);
    });
}

function queueScrollableCenterSync(): void {
    if (_externalHoverLock) return;
    if (!_panel || !_panel.classList.contains('scrollable')) return;
    if (_scrollSyncRAF !== null) return;
    _scrollSyncRAF = requestAnimationFrame(() => {
        _scrollSyncRAF = null;
        syncScrollableCenterState();
    });
}

export function setSherlockHoverLock(locked: boolean): void {
    _externalHoverLock = locked;
    if (!locked) {
        queueScrollableCenterSync();
    }
}

// ── Positioning ─────────────────────────────────────────────

function repositionPanel(): void {
    if (!_panel) return;
    const svg = document.getElementById('phase-chart-svg') as unknown as SVGSVGElement | null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    const panelWidth = 280;
    const gap = 16;
    let leftPos = rect.left - panelWidth - gap;
    if (leftPos < 4) leftPos = 4;

    _panel.style.left = `${leftPos}px`;

    const vb = svg.viewBox?.baseVal;
    const viewBoxHeight = vb && vb.height > 0 ? vb.height : PHASE_CHART.viewH;
    const scaleY = rect.height / Math.max(1, viewBoxHeight);
    const plotTop = rect.top + window.scrollY + PHASE_CHART.padT * scaleY;
    const plotHeight = PHASE_CHART.plotH * scaleY;
    const fullTop = rect.top + window.scrollY;
    const fullHeight = rect.height;

    if (_panel.classList.contains('scrollable')) {
        _panel.style.top = `${fullTop}px`;
        _panel.style.height = `${fullHeight}px`;
        _panel.style.setProperty('--sherlock-scroll-pad', `${Math.max(28, Math.round(fullHeight * 0.42))}px`);
        _lastAnimatedPanelHeight = -1;
        queueScrollableCenterSync();
    } else {
        _panel.style.top = `${plotTop}px`;
        _panel.style.height = `${plotHeight}px`;
        _panel.style.removeProperty('--sherlock-scroll-pad');
        const h = _panel.clientHeight || 0;
        if (Math.abs(h - _lastAnimatedPanelHeight) > 0.5) {
            _lastAnimatedPanelHeight = h;
            requestAnimationFrame(() => {
                if (!_panel || _panel.classList.contains('scrollable')) return;
                layoutAnimatedStack(_panel);
            });
        }
    }
}

function startRepositionLoop(): void {
    if (_repositionRAF !== null) return;
    const tick = () => {
        repositionPanel();
        _repositionRAF = requestAnimationFrame(tick);
    };
    _repositionRAF = requestAnimationFrame(tick);
}

function stopRepositionLoop(): void {
    if (_repositionRAF !== null) {
        cancelAnimationFrame(_repositionRAF);
        _repositionRAF = null;
    }
}

function layoutAnimatedStack(panel: HTMLElement): void {
    const allCards = panel.querySelectorAll('.waze-card') as NodeListOf<HTMLElement>;
    if (allCards.length === 0) return;

    const centerY = panel.clientHeight / 2;
    const activeEl = allCards[allCards.length - 1];
    const activeH = activeEl.offsetHeight;
    const activeTop = centerY - activeH / 2;
    activeEl.style.top = `${activeTop}px`;

    let cumulativeOffset = 0;
    for (let i = allCards.length - 2; i >= 0; i--) {
        const cardEl = allCards[i];
        cumulativeOffset += cardEl.offsetHeight + CARD_STACK_GAP;
        cardEl.style.top = `${activeTop - cumulativeOffset}px`;
    }
}

// ── Panel lifecycle ─────────────────────────────────────────

export function ensureNarrationPanel(): HTMLElement {
    if (_panel) return _panel;

    const panel = document.createElement('div');
    panel.id = 'sherlock-narration-panel';
    panel.className = 'sherlock-narration-panel';

    // Title header
    const header = document.createElement('div');
    header.className = 'sherlock-panel-header';
    header.innerHTML = '<span class="sherlock-panel-label">Live Narration</span>';
    panel.appendChild(header);

    document.body.appendChild(panel);
    _panel = panel;
    repositionPanel();
    return panel;
}

export function showNarrationPanel(): void {
    const panel = ensureNarrationPanel();
    void panel.offsetWidth;
    panel.classList.add('visible');
    startRepositionLoop();
    repositionPanel();
}

export function hideNarrationPanel(): void {
    _pendingScrollTarget = null;
    _externalHoverLock = false;
    if (!_panel) return;
    clearScrollSettleTimer();
    unbindScrollTracking();
    clearSubstanceFocus();
    clearCurveFocus();
    _panel.classList.remove('visible');
    _panel.classList.remove('scrollable');
    _panel.style.removeProperty('--sherlock-scroll-pad');
    stopRepositionLoop();
    _lastAnimatedPanelHeight = -1;
}

// ── Card data types ─────────────────────────────────────────

export interface SherlockCardData {
    id: string;
    text: string;
    substanceKey?: string;
    substanceName?: string;
    substanceColor?: string;
    dose?: string;
    direction?: 'up' | 'down' | 'neutral';
    curveIdx?: number;
    timeMinutes?: number;
    dayLabel?: string;
}

// ── Card rendering helpers ──────────────────────────────────

function getArrowSvg(dir?: 'up' | 'down' | 'neutral' | 'finish'): string {
    if (dir === 'finish') {
        // Checkered flag design
        return `<div class="waze-arrow-icon" style="font-size: 20px; display: flex; align-items: center; justify-content: center; opacity: 0.9;">🏁</div>`;
    }
    if (dir === 'up') {
        return `<svg class="waze-arrow-icon" style="color: rgba(74,222,128,0.9);" viewBox="0 0 24 24"><path stroke-width="2" stroke="currentColor" fill="none" d="M12 19V5M5 12l7-7 7 7"/></svg>`;
    } else if (dir === 'down') {
        return `<svg class="waze-arrow-icon" style="color: rgba(248,113,113,0.9);" viewBox="0 0 24 24"><path stroke-width="2" stroke="currentColor" fill="none" d="M12 5v14M5 12l7 7 7-7"/></svg>`;
    }
    // Neutral arrow (right-facing to indicate "staying in lane/maintaining")
    return `<svg class="waze-arrow-icon" style="color: rgba(96,165,250,0.9);" viewBox="0 0 24 24"><path stroke-width="2" stroke="currentColor" fill="none" d="M5 12h14M12 5l7 7-7 7"/></svg>`;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSubstance(text: string, name?: string, color?: string): string {
    if (!name) return text;
    const hl = (s: string) =>
        `<span class="waze-highlight" style="color: ${color || 'var(--text-accent)'}">${s}</span>`;
    const alts = new Set<string>();
    alts.add(escapeRegex(name));

    // Extract parenthetical qualifier: "Nicotine (gum)" → qualifier = "gum"
    const parenMatch = name.match(/\s*\(([^)]+)\)\s*$/);
    const qualifier = parenMatch ? parenMatch[1].trim() : '';
    const stripped = name.replace(/\s*\([^)]*\)\s*$/, '').trim();

    if (stripped !== name) {
        alts.add(escapeRegex(stripped));
        // "Nicotine (gum)" → also try "Nicotine gum" (qualifier without parens)
        if (qualifier) alts.add(escapeRegex(`${stripped} ${qualifier}`));
        // "Nicotine (patch)" → also try "patch" alone (qualifier ≥ 3 chars)
        if (qualifier.length >= 3) alts.add(escapeRegex(qualifier));
    }

    // Collapsed form (strip hyphens/spaces): "Alpha-GPC" → "AlphaGPC"
    // Handles LLM variations that merge segments into one word.
    const collapsed = stripped.replace(/[\s-]+/g, '');
    if (collapsed !== stripped && collapsed.length >= 4) alts.add(escapeRegex(collapsed));

    // Generate acronym from multi-segment names:
    //   "N-Acetyl cysteine"  → ["N","Acetyl","cysteine"] → "NAC"
    //   "Alpha-GPC"          → ["Alpha","GPC"] → "AG" (too short, skipped)
    const segments = stripped.split(/[\s-]+/).filter(s => s.length > 0);
    if (segments.length >= 2) {
        const acronym = segments.map(s => s[0].toUpperCase()).join('');
        if (acronym.length >= 2) alts.add(escapeRegex(acronym));
    }

    // Sort by length descending to match longest possible phrase first
    let pattern = [...alts].sort((a, b) => b.length - a.length).join('|');
    // Use a lookahead for the trailing boundary so names ending with ')' still match
    // (standard \b fails between ')' and whitespace since both are non-word chars).
    let regex = new RegExp(`\\b(${pattern})(?=\\b|[)\\]}>,.;:!?\\s]|$)`, 'gi');

    // Test if any of the above match
    if (regex.test(text)) {
        regex.lastIndex = 0;
        return text.replace(regex, m => hl(m));
    }

    // FALLBACK: words > 3 chars from the base name
    //   "L-Theanine" → strip leading letter-prefix → "Theanine"
    //   "Rhodiola Rosea" → ["Rhodiola", "Rosea"]
    const words = stripped.replace(/^[A-Za-z]-/, '').split(/[\s-]+/);
    for (const w of words) {
        if (w.length > 3) alts.add(escapeRegex(w));
    }
    pattern = [...alts].sort((a, b) => b.length - a.length).join('|');
    regex = new RegExp(`\\b(${pattern})(?=\\b|[)\\]}>,.;:!?\\s]|$)`, 'gi');
    return text.replace(regex, m => hl(m));
}

// Time formatting moved to utils.ts — use formatMinutesAsClockTime

function buildCardHTML(c: SherlockCardData): string {
    let headerLabel = '';
    if (typeof c.timeMinutes === 'number' && isFinite(c.timeMinutes)) {
        headerLabel = `<span class="waze-card-time">${formatMinutesAsClockTime(c.timeMinutes)}</span>`;
    } else if (c.dayLabel) {
        headerLabel = `<span class="waze-card-day-label">${c.dayLabel}</span>`;
    }
    return `
        ${headerLabel}
        <div class="waze-col-left">
            ${getArrowSvg(c.direction)}
        </div>
        <div class="waze-col-right">
            ${c.dose ? `<div class="waze-dose">${c.dose}</div>` : ''}
            <div class="waze-text">${highlightSubstance(c.text, c.substanceName, c.substanceColor)}</div>
        </div>
    `;
}

// ── Hover listeners for curve highlighting ──────────────────

function attachHoverListeners(cardEl: Element): void {
    cardEl.addEventListener('mouseenter', e => {
        const el = e.currentTarget as HTMLElement;
        const cIdxStr = el.getAttribute('data-curve-idx');
        setCurveFocus(parseCurveIdx(cIdxStr));

        // Temporarily highlight this card's substance bands/pills on hover
        // (visual only — does NOT update _clickedSubstanceKey)
        const key = el.getAttribute('data-substance-key');
        if (key) applyBandPillHighlight(key);
    });

    cardEl.addEventListener('mouseleave', () => {
        // Restore to clicked card's highlight (if any), otherwise clear
        applyBandPillHighlight(_clickedSubstanceKey);

        clearCurveFocus();
    });

    cardEl.addEventListener('click', () => {
        const el = cardEl as HTMLElement;
        const id = el.getAttribute('data-id');
        const key = el.getAttribute('data-substance-key');
        const curveIdx = parseCurveIdx(el.getAttribute('data-curve-idx'));
        const timeMinutes = parseTimeMinutes(el.getAttribute('data-time-minutes'));

        // Clicking should center the card (even if it has no substance metadata).
        // Also release any external hover lock so center-sync can mark it active.
        setSherlockHoverLock(false);
        scrollSherlockCardToCenter({ id, substanceKey: key, curveIdx, timeMinutes });

        if (key) {
            // Toggle: clicking the same substance again clears the highlight
            if (_clickedSubstanceKey === key) {
                _clickedSubstanceKey = null;
                applyBandPillHighlight(null);
            } else {
                _clickedSubstanceKey = key;
                applyBandPillHighlight(key);
            }
        }

        // Also set curve focus to match this card
        setCurveFocus(curveIdx);
    });
}

// ── Main stack renderer ─────────────────────────────────────
// Layout: the panel is position:relative with overflow:hidden.
// All cards are position:absolute. The active card is placed at
// the vertical center. Older cards are stacked above it with
// increasing upward offset and decreasing opacity.

function createCardElement(card: SherlockCardData): HTMLElement {
    const el = document.createElement('div');
    el.className = 'waze-card';
    el.setAttribute('data-id', card.id);
    if (card.substanceKey) el.setAttribute('data-substance-key', String(card.substanceKey));
    else el.removeAttribute('data-substance-key');
    if (typeof card.curveIdx === 'number' && card.curveIdx >= 0) {
        el.setAttribute('data-curve-idx', String(card.curveIdx));
    } else {
        el.removeAttribute('data-curve-idx');
    }
    if (typeof card.timeMinutes === 'number' && isFinite(card.timeMinutes)) {
        el.setAttribute('data-time-minutes', String(card.timeMinutes));
    } else {
        el.removeAttribute('data-time-minutes');
    }
    el.innerHTML = buildCardHTML(card);
    attachHoverListeners(el);
    return el;
}

function applyAnimatedCardState(el: HTMLElement, stepsFromActive: number): void {
    el.classList.remove('sherlock-scroll-active');
    if (stepsFromActive === 0) {
        el.classList.add('sherlock-active');
        el.classList.remove('sherlock-stale');
        el.style.opacity = '1';
    } else {
        el.classList.remove('sherlock-active');
        el.classList.add('sherlock-stale');
        // Progressive fade: 1 step = 0.32 opacity, 2 steps = 0.17, 3+ floors at 0.08
        const opacity = Math.max(0.08, 0.47 - stepsFromActive * 0.15);
        el.style.opacity = String(opacity.toFixed(2));
    }
}

function enterAnimatedCardMode(panel: HTMLElement): void {
    clearScrollSettleTimer();
    panel.classList.remove('scrollable');
    panel.style.removeProperty('--sherlock-scroll-pad');
    panel.scrollTop = 0;
    unbindScrollTracking();
    clearCurveFocus();
}

export function showSherlockStack(cards: SherlockCardData[], activeIdx: number): void {
    if (!SherlockState.enabled) return;
    const panel = ensureNarrationPanel();
    const activeCards = cards.slice(0, activeIdx + 1);
    if (activeCards.length === 0) {
        panel.innerHTML = '';
        clearCurveFocus();
        return;
    }

    const wasScrollable = panel.classList.contains('scrollable');
    enterAnimatedCardMode(panel);

    const currentNodes = Array.from(panel.querySelectorAll('.waze-card')) as HTMLElement[];
    let samePrefix = true;
    const prefixLen = Math.min(currentNodes.length, activeCards.length);
    for (let i = 0; i < prefixLen; i++) {
        if (currentNodes[i].getAttribute('data-id') !== activeCards[i].id) {
            samePrefix = false;
            break;
        }
    }

    const isExactMatch = samePrefix && currentNodes.length === activeCards.length;
    if (isExactMatch) {
        if (wasScrollable) {
            _lastAnimatedPanelHeight = -1;
            repositionPanel();
            requestAnimationFrame(() => {
                if (!_panel || panel !== _panel || panel.classList.contains('scrollable')) return;
                layoutAnimatedStack(panel);
            });
        }
        return;
    }

    // Remove any non-card elements (e.g. "Plotting course..." loading indicator)
    // before appending real cards, so the loading state is always cleared.
    Array.from(panel.children).forEach(child => {
        if (!child.classList.contains('waze-card')) child.remove();
    });

    const canAppendOnly = samePrefix && currentNodes.length < activeCards.length;
    if (!canAppendOnly) {
        panel.innerHTML = '';
        activeCards.forEach(card => panel.appendChild(createCardElement(card)));
    } else {
        for (let i = currentNodes.length; i < activeCards.length; i++) {
            panel.appendChild(createCardElement(activeCards[i]));
        }
    }

    const allCards = Array.from(panel.querySelectorAll('.waze-card')) as HTMLElement[];
    allCards.forEach((el, idx) => {
        const card = activeCards[idx];
        if (!card) return;
        if (card.substanceKey) el.setAttribute('data-substance-key', String(card.substanceKey));
        else el.removeAttribute('data-substance-key');
        if (typeof card.curveIdx === 'number' && card.curveIdx >= 0) {
            el.setAttribute('data-curve-idx', String(card.curveIdx));
        } else {
            el.removeAttribute('data-curve-idx');
        }
        if (typeof card.timeMinutes === 'number' && isFinite(card.timeMinutes)) {
            el.setAttribute('data-time-minutes', String(card.timeMinutes));
        } else {
            el.removeAttribute('data-time-minutes');
        }
        const stepsFromActive = allCards.length - 1 - idx;
        applyAnimatedCardState(el, stepsFromActive);
    });

    _lastAnimatedPanelHeight = -1;
    repositionPanel();
    requestAnimationFrame(() => {
        if (!_panel || panel !== _panel || panel.classList.contains('scrollable')) return;
        layoutAnimatedStack(panel);
    });
}

function findCardByTarget(panel: HTMLElement, target: SherlockCardScrollTarget): HTMLElement | null {
    const cards = Array.from(panel.querySelectorAll('.waze-card')) as HTMLElement[];
    if (cards.length === 0) return null;

    const id = (target.id || '').trim();
    const substanceKey = (target.substanceKey || '').trim().toLowerCase();
    const curveIdx = target.curveIdx != null && target.curveIdx >= 0 ? target.curveIdx : null;
    const timeMinutes =
        target.timeMinutes != null && isFinite(target.timeMinutes) ? Math.round(target.timeMinutes) : null;

    if (id) {
        const exact = cards.find(card => (card.getAttribute('data-id') || '') === id);
        if (exact) return exact;
    }

    if (substanceKey && timeMinutes != null) {
        const exact = cards.find(card => {
            const cardKey = (card.getAttribute('data-substance-key') || '').trim().toLowerCase();
            const cardTime = parseTimeMinutes(card.getAttribute('data-time-minutes'));
            return cardKey === substanceKey && cardTime != null && Math.round(cardTime) === timeMinutes;
        });
        if (exact) return exact;
    }

    if (substanceKey) {
        const byKey = cards.filter(
            card => (card.getAttribute('data-substance-key') || '').trim().toLowerCase() === substanceKey,
        );
        if (byKey.length > 0) return byKey[byKey.length - 1];
    }

    if (curveIdx != null) {
        const byCurve = cards.filter(card => parseCurveIdx(card.getAttribute('data-curve-idx')) === curveIdx);
        if (byCurve.length > 0) return byCurve[byCurve.length - 1];
    }

    return null;
}

function centerCardInPanel(panel: HTMLElement, card: HTMLElement): void {
    const targetCenter = card.offsetTop + card.offsetHeight / 2;
    const top = Math.max(0, targetCenter - panel.clientHeight / 2);
    panel.scrollTo({ top, behavior: 'smooth' });
    queueScrollableCenterSync();
    setTimeout(() => queueScrollableCenterSync(), 220);
}

export function scrollSherlockCardToCenter(target: SherlockCardScrollTarget): boolean {
    if (!_panel) return false;
    const panel = _panel;
    const card = findCardByTarget(panel, target);
    if (!card) return false;

    if (!panel.classList.contains('scrollable')) {
        _pendingScrollTarget = target;
        enableSherlockScrollMode();
        return true;
    }

    centerCardInPanel(panel, card);
    return true;
}

export function enableSherlockScrollMode(): void {
    if (!_panel) return;
    const panel = _panel;
    const cardCount = panel.querySelectorAll('.waze-card').length;
    if (cardCount === 0) return;

    clearScrollSettleTimer();
    _scrollSettleTimer = window.setTimeout(() => {
        _scrollSettleTimer = null;
        if (!_panel || panel !== _panel) return;
        panel.classList.add('scrollable');
        bindScrollTracking(panel);
        repositionPanel();

        const cards = Array.from(panel.querySelectorAll('.waze-card')) as HTMLElement[];
        const activeCard = cards[cards.length - 1];
        if (activeCard) {
            const targetCenter = activeCard.offsetTop + activeCard.offsetHeight / 2;
            panel.scrollTop = Math.max(0, targetCenter - panel.clientHeight / 2);
        }

        queueScrollableCenterSync();

        if (_pendingScrollTarget) {
            const target = _pendingScrollTarget;
            _pendingScrollTarget = null;
            const matched = findCardByTarget(panel, target);
            if (matched) centerCardInPanel(panel, matched);
        }
    }, SHERLOCK_SCROLL_SETTLE_MS);
}

export function showNarrationLoading(): void {
    const panel = ensureNarrationPanel();
    clearScrollSettleTimer();
    _pendingScrollTarget = null;
    _externalHoverLock = false;
    unbindScrollTracking();
    clearSubstanceFocus();
    clearCurveFocus();
    panel.classList.remove('scrollable');
    panel.style.removeProperty('--sherlock-scroll-pad');
    if (panel.children.length === 1 && panel.children[0].classList.contains('waze-loading-card')) return;
    panel.innerHTML = `
        <div class="waze-loading-card">
            <div class="sherlock-loading">Plotting course<span>.</span><span>.</span><span>.</span></div>
        </div>
    `;
}

export function clearNarration(): void {
    clearScrollSettleTimer();
    _pendingScrollTarget = null;
    _externalHoverLock = false;
    unbindScrollTracking();
    clearSubstanceFocus();
    clearCurveFocus();
    stopRepositionLoop();
    hideLxStepControls();
    if (_panel) {
        _panel.classList.remove('visible');
        _panel.classList.remove('scrollable');
        _panel.remove();
        _panel = null;
    }
    _lastAnimatedPanelHeight = -1;
    SherlockState.narrationResult = null;
    SherlockState.revisionNarrationResult = null;
    SherlockState.phase = 'idle';
}

// ── Lx Step Controls ───────────────────────────────────────
// Play/Pause + Prev/Next for substance-by-substance stepping.
// Separate <body> element so `showSherlockStack()` clearing
// the panel innerHTML doesn't destroy the controls.

type StepperMode = 'idle' | 'ready' | 'stepping' | 'playing' | 'complete';

let _stepperMode: StepperMode = 'idle';
let _stepResolver: (() => void) | null = null;
let _pauseRequested = false;
let _skipSweepRequested = false;
let _sweepPaused = false;
let _queuedAdvanceRequests = 0;
let _stepSkipArmed = false;
let _currentStep = 0;
let _totalSteps = 0;
let _vcrUpdateCallback: (() => void) | null = null;
let _sleepResolver: (() => void) | null = null;

/** Check and consume the sweep-skip flag (used by playhead sweep animation). */
export function consumeSkipSweep(): boolean {
    if (isTurboActive()) return true;
    if (_skipSweepRequested) {
        _skipSweepRequested = false;
        return true;
    }
    return false;
}

/** True while user has paused an in-flight sweep animation. */
export function isLxSweepPaused(): boolean {
    return _sweepPaused;
}

/** Request that the current playhead sweep jump to completion immediately. */
export function requestSkipSweep(): void {
    _skipSweepRequested = true;
    _stepSkipArmed = true;
}

/**
 * Sleep that resolves immediately when skip/next is pressed.
 * Use instead of `sleep()` inside the per-substance animation loop.
 */
export function skippableSleep(ms: number): Promise<void> {
    if (isTurboActive()) return Promise.resolve();
    return new Promise<void>(resolve => {
        const timer = setTimeout(() => {
            _sleepResolver = null;
            resolve();
        }, ms);
        _sleepResolver = () => {
            clearTimeout(timer);
            _sleepResolver = null;
            resolve();
        };
    });
}

/** Cancel any pending skippable sleep (called by skip/next). */
function cancelPendingSleep(): void {
    if (_sleepResolver) {
        _sleepResolver();
    }
}

export function setVcrUpdateCallback(fn: (() => void) | null) {
    _vcrUpdateCallback = fn;
}

function emitLxStepWait(waiting: boolean): void {
    const cb = TimelineState.onLxStepWait;
    if (typeof cb === 'function') cb(waiting);
}

// SVG icon strings (small, inline)
const ICON_PLAY = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><polygon points="6,4 20,12 6,20"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/></svg>`;
// Previous track: skip-back style (triangle + bar)
const ICON_PREV = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><polygon points="14,4 2,12 14,20"/><rect x="18" y="6" width="2" height="12" rx="0.5"/></svg>`;
// Next track: skip-forward style (bar + triangle)
const ICON_NEXT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="4" y="6" width="2" height="12" rx="0.5"/><polygon points="10,4 22,12 10,20"/></svg>`;

function updateControlBarState(): void {
    _vcrUpdateCallback?.();
}

function onPlayPauseClick(): void {
    if (_stepperMode === 'playing') {
        // Pause immediately (freeze in-flight sweep at current position)
        _sweepPaused = true;
        _stepperMode = 'stepping';
        updateControlBarState();
        emitLxStepWait(true);
        cancelPendingSleep();
    } else if (_stepperMode === 'ready' || _stepperMode === 'stepping') {
        doPlay();
    }
}

/** Programmatic play — same as clicking the Sherlock play button. Used by VCR panel. */
export function triggerLxPlay(): void {
    if (_stepperMode === 'playing') {
        _sweepPaused = true;
        _stepperMode = 'stepping';
        updateControlBarState();
        // Immediately pause the playhead/scanning line (don't wait for next awaitLxStep)
        emitLxStepWait(true);
        cancelPendingSleep();
    } else if (_stepperMode === 'ready' || _stepperMode === 'stepping') {
        doPlay();
    }
}

function doPlay(): void {
    const wasSweepPaused = _sweepPaused;
    _stepperMode = 'playing';
    _sweepPaused = false;
    _pauseRequested = false;
    updateControlBarState();
    if (wasSweepPaused) {
        // Resume first-run playhead immediately if we were frozen mid-sweep.
        emitLxStepWait(false);
    }
    if (_stepResolver) {
        const resolve = _stepResolver;
        _stepResolver = null;
        resolve();
    }
}

/** Programmatic next — same as clicking next track. Used by VCR panel. */
export function triggerLxNext(): void {
    if (_stepperMode === 'idle' || _stepperMode === 'complete') return;
    if (_totalSteps <= 0) return;
    const wasPauseRequested = _pauseRequested;
    const waitingForBoundary = _stepResolver !== null;
    const alreadyArmed = _stepSkipArmed;

    if (!_stepSkipArmed) {
        // First Next tap for this step fast-forwards the current step.
        _skipSweepRequested = true;
        _stepSkipArmed = true;
    }
    // Cancel any inter-step sleep so we advance immediately
    cancelPendingSleep();

    if (_sweepPaused) {
        _sweepPaused = false;
        emitLxStepWait(false);
    }

    if (_stepperMode === 'playing') {
        // Skip current auto-advance delay — pause at the next step
        _pauseRequested = true;
    }
    if (_stepperMode === 'ready') {
        _stepperMode = 'stepping';
    }
    if (_stepResolver) {
        const resolve = _stepResolver;
        _stepResolver = null;
        resolve();
    } else {
        // Queue only if user taps again during the same active step.
        // This avoids single-click over-queue that can jump the step index ahead.
        const shouldQueue = alreadyArmed && !waitingForBoundary && (_stepperMode !== 'playing' || wasPauseRequested);
        if (shouldQueue) _queuedAdvanceRequests += 1;
    }
    updateControlBarState();
}

/** Programmatic prev — seek to previous substance. Used by VCR panel. */
export function triggerLxPrev(): void {
    if (_currentStep <= 0) return;
    if (TimelineState.interactionLocked) return;

    const targetGateId = `substance-gate-${_currentStep - 1}`;
    const engine = TimelineState.engine;
    if (engine && typeof engine.getSegmentStartTime === 'function') {
        const seekTime = engine.getSegmentStartTime(targetGateId);
        if (seekTime !== null) {
            _stepResolver = null;
            _stepperMode = 'idle';
            _vcrUpdateCallback?.();
            engine.seek(seekTime);
            engine.play();
        }
    }
}

export function getLxStepperState(): { currentStep: number; totalSteps: number; mode: StepperMode } {
    return { currentStep: _currentStep, totalSteps: _totalSteps, mode: _stepperMode };
}

/**
 * Initialize stepper state for Lx animation. VCR panel is owned by biometric module.
 */
export function showLxStepControls(total: number): void {
    if (total <= 1) return;
    if (
        _totalSteps === total &&
        (_stepperMode === 'ready' || _stepperMode === 'stepping' || _stepperMode === 'playing')
    ) {
        updateControlBarState();
        return;
    }
    _totalSteps = total;
    _currentStep = 0;
    _stepperMode = isTurboActive() || !_vcrUpdateCallback ? 'playing' : 'ready';
    _pauseRequested = false;
    _skipSweepRequested = false;
    _sweepPaused = false;
    _queuedAdvanceRequests = 0;
    _stepSkipArmed = false;
    _stepResolver = null;
    updateControlBarState();
}

/**
 * Reset stepper when Lx animation ends. VCR panel stays visible.
 */
export function hideLxStepControls(): void {
    _stepperMode = 'complete';
    _pauseRequested = false;
    _skipSweepRequested = false;
    _sweepPaused = false;
    _queuedAdvanceRequests = 0;
    _stepSkipArmed = false;
    _stepResolver = null;
    emitLxStepWait(false);
    _vcrUpdateCallback?.();
}

/**
 * Await user action before animating the next substance.
 * In playing mode: resolves after a short breathing delay.
 * In stepping/ready mode: waits for user click (Next or Play).
 */
export function awaitLxStep(stepIdx: number, total: number): Promise<void> {
    _stepSkipArmed = false;
    _currentStep = stepIdx;
    _totalSteps = total;
    updateControlBarState();

    // Turbo mode: resolve instantly
    if (isTurboActive()) {
        emitLxStepWait(false);
        return Promise.resolve();
    }

    // Single substance or controls not shown — proceed immediately
    if (total <= 1 || _stepperMode === 'idle' || _stepperMode === 'complete') {
        emitLxStepWait(false);
        return Promise.resolve();
    }

    if (_queuedAdvanceRequests > 0) {
        _queuedAdvanceRequests -= 1;
        // Queued "next" should fast-forward this step's sweep too.
        _skipSweepRequested = true;
        _stepSkipArmed = true;
        emitLxStepWait(false);
        return Promise.resolve();
    }

    // Playing mode — auto-advance with small breathing room
    if (_stepperMode === 'playing' && !_pauseRequested) {
        emitLxStepWait(false);
        return new Promise(resolve => setTimeout(resolve, 200));
    }

    // Pause was requested while playing — transition to stepping
    if (_pauseRequested) {
        _stepperMode = 'stepping';
        _pauseRequested = false;
        updateControlBarState();
    }

    // Ready or stepping — wait for user action
    emitLxStepWait(true);
    return new Promise<void>(resolve => {
        _stepResolver = () => {
            emitLxStepWait(false);
            resolve();
        };
    });
}

// ── Sherlock 7D — Circular carousel for STREAM sequence ──

let _7dCardsBuilt = false;

/**
 * Display all 7D beats as a circular carousel.
 * Active card at the usual vertical center; previous days above, next days below.
 * All cards visible with fading based on distance from active.
 * CSS transitions on `.waze-card` handle the smooth slide as active day changes.
 */
export function showSherlock7DStack(beats: Sherlock7DBeat[], activeDayIdx: number): void {
    if (!SherlockState.enabled || beats.length === 0) return;
    const panel = ensureNarrationPanel();
    const n = beats.length;
    const activeIdx = Math.max(0, Math.min(activeDayIdx, n - 1));

    // Build card DOM once — reuse on subsequent calls (only positions/opacity change)
    const existingCards = panel.querySelectorAll('.waze-card');
    if (!_7dCardsBuilt || existingCards.length !== n) {
        // Remove existing cards but keep the header
        existingCards.forEach(el => el.remove());

        const cards: SherlockCardData[] = beats.map(beat => {
            const subColor = beat.topSubstanceKey ? SUBSTANCE_DB[beat.topSubstanceKey]?.color : undefined;
            return {
                id: `day7d-${beat.day}`,
                text: beat.text,
                direction: beat.direction || 'neutral',
                dose: undefined,
                substanceName: beat.topSubstanceName || undefined,
                substanceKey: beat.topSubstanceKey || undefined,
                substanceColor: subColor,
                dayLabel: `Day ${beat.day} — ${beat.weekday}`,
            };
        });
        cards.forEach(card => panel.appendChild(createCardElement(card)));
        _7dCardsBuilt = true;

        // Ensure animated card mode (absolute positioning, no scroll)
        panel.classList.remove('scrollable');
        panel.style.removeProperty('--sherlock-scroll-pad');
    }

    // Position all cards relative to the active one
    const allCards = Array.from(panel.querySelectorAll('.waze-card')) as HTMLElement[];
    if (allCards.length === 0) return;

    const centerY = panel.clientHeight / 2;
    const gap = CARD_STACK_GAP;

    // Measure each card's height
    const cardH = allCards.map(el => el.offsetHeight || 60);
    const activeH = cardH[activeIdx];
    const activeTop = centerY - activeH / 2;

    // For each card compute signed offset from active (-3..+3 for 7 cards)
    const half = Math.floor(n / 2);

    allCards.forEach((el, i) => {
        let offset = i - activeIdx;
        if (offset > half) offset -= n;
        else if (offset < -half) offset += n;

        // Accumulate position from center
        let top: number;
        if (offset === 0) {
            top = activeTop;
        } else if (offset > 0) {
            // Below active
            let y = activeTop + activeH + gap;
            for (let s = 1; s < offset; s++) {
                const si = (((activeIdx + s) % n) + n) % n;
                y += cardH[si] + gap;
            }
            top = y;
        } else {
            // Above active
            let y = activeTop;
            for (let s = -1; s >= offset; s--) {
                const si = (((activeIdx + s) % n) + n) % n;
                y -= cardH[si] + gap;
            }
            top = y;
        }

        el.style.top = `${top}px`;

        // Opacity based on distance from active
        const dist = Math.abs(offset);
        if (dist === 0) {
            el.classList.add('sherlock-active');
            el.classList.remove('sherlock-stale');
            el.style.opacity = '1';
        } else {
            el.classList.remove('sherlock-active');
            el.classList.add('sherlock-stale');
            el.style.opacity = Math.max(0.08, 0.47 - dist * 0.15).toFixed(2);
        }
    });
}

/** Reset 7D card build state (call when leaving STREAM mode). */
export function reset7DCardState(): void {
    _7dCardsBuilt = false;
}

/** Hide the Sherlock 7D panel and clear 7D narration state. */
export function hideSherlock7D(): void {
    reset7DCardState();
    hideNarrationPanel();
}
