// ============================================
// SHERLOCK — Narration Panel & Card Stack
// ============================================
// Cards are absolutely positioned within the panel.
// The active card sits at the vertical center of the SVG chart.
// When a new card arrives, older cards animate upward and fade out.
// The panel is appended to <body>, positioned via JS to the left of the SVG.

import { PHASE_CHART } from './constants';
import { SherlockState, TimelineState } from './state';

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

    const lxGroup = document.getElementById('phase-lx-curves');
    if (lxGroup) {
        lxGroup.querySelectorAll('.phase-lx-path').forEach((p, i) => {
            (p as SVGElement).style.opacity = (focusIdx === null || i === focusIdx) ? '1' : '0.15';
        });
        lxGroup.querySelectorAll('.phase-lx-fill').forEach((f, i) => {
            (f as SVGElement).style.opacity = (focusIdx === null || i === focusIdx) ? '1' : '0.05';
        });
    }

    document.querySelectorAll('.timeline-curve-dot').forEach(dot => {
        const dotIdx = parseInt(dot.getAttribute('data-curve-idx') || '-1', 10);
        (dot as SVGElement).style.opacity = (focusIdx === null || dotIdx === focusIdx) ? '1' : '0.15';
    });

    document.querySelectorAll('.timeline-connector').forEach(conn => {
        const connIdx = parseInt(conn.getAttribute('data-curve-idx') || '-1', 10);
        (conn as SVGElement).style.opacity = (focusIdx === null || connIdx === focusIdx) ? '1' : '0.15';
    });

    document.querySelectorAll('.timeline-pill-group').forEach((pill) => {
        pill.classList.remove('pill-dim', 'pill-highlight');
        if (focusIdx === null) return;
        const marker = pill.querySelector('.timeline-curve-dot, .timeline-connector');
        const markerIdx = parseInt(marker?.getAttribute('data-curve-idx') || '-1', 10);
        if (markerIdx === focusIdx) pill.classList.add('pill-highlight');
        else pill.classList.add('pill-dim');
    });

    document.querySelectorAll('.lx-auc-band').forEach((band) => {
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

    bands.forEach((band) => {
        band.classList.remove('band-dim', 'band-highlight');
        if (substanceKey === null) return;
        if (band.getAttribute('data-substance-key') === substanceKey) {
            band.classList.add('band-highlight');
        } else {
            band.classList.add('band-dim');
        }
    });

    pills.forEach((pill) => {
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

    cards.forEach((card) => {
        const r = card.getBoundingClientRect();
        const d = Math.abs((r.top + r.height / 2) - centerY);
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
    setCurveFocus(parseCurveIdx(centerCard?.getAttribute('data-curve-idx') || null));
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

    setCurveFocus(parseCurveIdx(activeEl.getAttribute('data-curve-idx')));
}

// ── Panel lifecycle ─────────────────────────────────────────

export function ensureNarrationPanel(): HTMLElement {
    if (_panel) return _panel;

    const panel = document.createElement('div');
    panel.id = 'sherlock-narration-panel';
    panel.className = 'sherlock-narration-panel';
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
    const hl = (s: string) => `<span class="waze-highlight" style="color: ${color || 'var(--text-accent)'}">${s}</span>`;
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
    let regex = new RegExp(`\\b(${pattern})\\b`, 'gi');

    // Test if any of the above match
    if (regex.test(text)) {
        regex.lastIndex = 0;
        return text.replace(regex, (m) => hl(m));
    }

    // FALLBACK: words > 3 chars from the base name
    //   "L-Theanine" → strip leading letter-prefix → "Theanine"
    //   "Rhodiola Rosea" → ["Rhodiola", "Rosea"]
    const words = stripped.replace(/^[A-Za-z]-/, '').split(/[\s-]+/);
    for (const w of words) {
        if (w.length > 3) alts.add(escapeRegex(w));
    }
    pattern = [...alts].sort((a, b) => b.length - a.length).join('|');
    regex = new RegExp(`\\b(${pattern})\\b`, 'gi');
    return text.replace(regex, (m) => hl(m));
}

function formatTimeMinutes(min: number): string {
    const h = Math.floor(min / 60) % 24;
    const m = Math.round(min % 60);
    const suffix = h < 12 ? 'am' : 'pm';
    const hour = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    const minStr = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
    return `${hour}${minStr}${suffix}`;
}

function buildCardHTML(c: SherlockCardData): string {
    const timeLabel = typeof c.timeMinutes === 'number' && isFinite(c.timeMinutes)
        ? `<span class="waze-card-time">${formatTimeMinutes(c.timeMinutes)}</span>`
        : '';
    return `
        ${timeLabel}
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
    cardEl.addEventListener('mouseenter', (e) => {
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

        if (_panel && _panel.classList.contains('scrollable')) {
            queueScrollableCenterSync();
        } else {
            const active = _panel?.querySelector('.waze-card.sherlock-active') as HTMLElement | null;
            setCurveFocus(parseCurveIdx(active?.getAttribute('data-curve-idx') || null));
        }
    });

    cardEl.addEventListener('click', () => {
        const el = cardEl as HTMLElement;
        const key = el.getAttribute('data-substance-key');
        if (!key) return;

        // Toggle: clicking the same substance again clears the highlight
        if (_clickedSubstanceKey === key) {
            _clickedSubstanceKey = null;
            applyBandPillHighlight(null);
        } else {
            _clickedSubstanceKey = key;
            applyBandPillHighlight(key);
        }

        // Also set curve focus to match this card
        setCurveFocus(parseCurveIdx(el.getAttribute('data-curve-idx')));
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
        const stepsFromActive = (allCards.length - 1) - idx;
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

    const substanceKey = (target.substanceKey || '').trim().toLowerCase();
    const curveIdx = target.curveIdx != null && target.curveIdx >= 0 ? target.curveIdx : null;
    const timeMinutes = target.timeMinutes != null && isFinite(target.timeMinutes)
        ? Math.round(target.timeMinutes)
        : null;

    if (substanceKey && timeMinutes != null) {
        const exact = cards.find((card) => {
            const cardKey = (card.getAttribute('data-substance-key') || '').trim().toLowerCase();
            const cardTime = parseTimeMinutes(card.getAttribute('data-time-minutes'));
            return cardKey === substanceKey && cardTime != null && Math.round(cardTime) === timeMinutes;
        });
        if (exact) return exact;
    }

    if (substanceKey) {
        const byKey = cards.filter((card) => (
            (card.getAttribute('data-substance-key') || '').trim().toLowerCase() === substanceKey
        ));
        if (byKey.length > 0) return byKey[byKey.length - 1];
    }

    if (curveIdx != null) {
        const byCurve = cards.filter((card) => parseCurveIdx(card.getAttribute('data-curve-idx')) === curveIdx);
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
let _currentStep = 0;
let _totalSteps = 0;
let _vcrUpdateCallback: (() => void) | null = null;

export function setVcrUpdateCallback(fn: (() => void) | null) {
    _vcrUpdateCallback = fn;
}

function emitLxStepWait(waiting: boolean): void {
    const cb = (window as any).__onLxStepWait;
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
        // Pause — will take effect at the next substance boundary
        _pauseRequested = true;
        _stepperMode = 'stepping';
        updateControlBarState();
    } else if (_stepperMode === 'ready' || _stepperMode === 'stepping') {
        doPlay();
    }
}

/** Programmatic play — same as clicking the Sherlock play button. Used by VCR panel. */
export function triggerLxPlay(): void {
    if (_stepperMode === 'playing') {
        _pauseRequested = true;
        _stepperMode = 'stepping';
        updateControlBarState();
    } else if (_stepperMode === 'ready' || _stepperMode === 'stepping') {
        doPlay();
    }
}

function doPlay(): void {
    _stepperMode = 'playing';
    _pauseRequested = false;
    updateControlBarState();
    if (_stepResolver) {
        const resolve = _stepResolver;
        _stepResolver = null;
        resolve();
    }
}

/** Programmatic next — same as clicking next track. Used by VCR panel. */
export function triggerLxNext(): void {
    if (_stepperMode === 'ready') {
        _stepperMode = 'stepping';
    }
    if (_stepResolver) {
        const resolve = _stepResolver;
        _stepResolver = null;
        resolve();
    }
    updateControlBarState();
}

/** Programmatic prev — seek to previous substance. Used by VCR panel. */
export function triggerLxPrev(): void {
    if (_currentStep <= 0) return;
    if (TimelineState.interactionLocked) return;

    const targetGateId = `substance-gate-${_currentStep - 1}`;
    const engine = TimelineState.engine || (window as any).__timelineEngine;
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
    if (_totalSteps === total && (_stepperMode === 'ready' || _stepperMode === 'stepping' || _stepperMode === 'playing')) {
        updateControlBarState();
        return;
    }
    _totalSteps = total;
    _currentStep = 0;
    _stepperMode = _vcrUpdateCallback ? 'ready' : 'playing';
    _pauseRequested = false;
    _stepResolver = null;
    updateControlBarState();
}

/**
 * Reset stepper when Lx animation ends. VCR panel stays visible.
 */
export function hideLxStepControls(): void {
    _stepperMode = 'complete';
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
    _currentStep = stepIdx;
    _totalSteps = total;
    updateControlBarState();

    // Single substance or controls not shown — proceed immediately
    if (total <= 1 || _stepperMode === 'idle' || _stepperMode === 'complete') {
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
