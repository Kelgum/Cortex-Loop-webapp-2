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
import { getAgentById, getAgentByHandle } from './creator-agents';
import { initTrailer, stopTrailer } from './card-trailer';
import { renderStars, formatScore } from './stars';
import {
    generateStreamComments,
    summarizeStreamComments,
    formatRelativeDays,
    setLLMReviewsFor,
    getLLMReviewsFor,
    type StreamComment,
    type LLMReview,
} from './stream-comments';
import { buildStreamCommentsPrompt, buildSingleReviewPrompt } from './stream-comments-prompt';
import { callGenericRouted, extractAndParseJSON } from './llm-pipeline';
import { MODEL_OPTIONS } from './constants';
import { AppState } from './state';
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
let _pendingCommentsIdleId: number | null = null;
let _pendingCommentsTimeoutId: ReturnType<typeof setTimeout> | null = null;

function cancelPendingComments(): void {
    const w = window as unknown as { cancelIdleCallback?: (id: number) => void };
    if (_pendingCommentsIdleId != null && typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(_pendingCommentsIdleId);
    }
    _pendingCommentsIdleId = null;
    if (_pendingCommentsTimeoutId != null) {
        clearTimeout(_pendingCommentsTimeoutId);
        _pendingCommentsTimeoutId = null;
    }
}

/**
 * Cycle card hero icons are built with SMIL `<animate repeatCount="indefinite">`
 * elements (see cycle-icon.ts). When a card is `cloneNode(true)`-d, those
 * SMIL animations come along inside the moving clone and keep ticking
 * during the FLIP — each tick invalidates the clone's compositor layer.
 * On top of that, the 50+ source cards behind the backdrop continue
 * animating even though they're invisible.
 *
 * Pause all of them while a card is expanded and restore on collapse.
 * SVGSVGElement.pauseAnimations()/unpauseAnimations() is the standard
 * way to freeze SMIL without touching the markup.
 */
function _pauseGridSmil(): void {
    document.querySelectorAll<SVGSVGElement>('.stream-grid .cg-card-icon svg').forEach(svg => {
        try {
            if (typeof svg.pauseAnimations === 'function') svg.pauseAnimations();
        } catch {
            // Some browsers can throw if the SVG document isn't fully ready
        }
    });
}

function _unpauseGridSmil(): void {
    document.querySelectorAll<SVGSVGElement>('.stream-grid .cg-card-icon svg').forEach(svg => {
        try {
            if (typeof svg.unpauseAnimations === 'function') svg.unpauseAnimations();
        } catch {
            // ignore
        }
    });
}

function _pauseSmilInTree(root: HTMLElement): void {
    root.querySelectorAll<SVGSVGElement>('svg').forEach(svg => {
        try {
            if (typeof svg.pauseAnimations === 'function') svg.pauseAnimations();
        } catch {
            // ignore
        }
    });
}

function scheduleCommentsFill(panel: HTMLElement, entry: SavedCycleIndexEntry, sessionToken: number): void {
    cancelPendingComments();
    const run = () => {
        _pendingCommentsIdleId = null;
        _pendingCommentsTimeoutId = null;
        if (sessionToken !== _expandSessionToken) return;
        if (!panel.isConnected) return;
        populateCommentsSection(panel, entry);
    };
    const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
        _pendingCommentsIdleId = w.requestIdleCallback(run, { timeout: 200 });
    } else {
        _pendingCommentsTimeoutId = setTimeout(run, 80);
    }
}

// ── Constants ─────────────────────────────────────────────────────

const FLIP_EXPAND_MS = 400;
const FLIP_COLLAPSE_MS = 300;
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CONTENT_FADE_IN_DELAY = 150;
const CONTENT_HIDE_MS = 120;
// The backdrop's CSS opacity transition runs 0.6s, the reverse FLIP runs
// 0.3s. Defer backdrop removal by ~the remainder of its fade-out so we
// don't yank it out of the DOM while still partially visible.
const BACKDROP_REMOVE_DELAY_MS = 350;

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
    document.body.classList.add('cg-expand-active');
    requestAnimationFrame(() => backdrop.classList.add('cg-card-backdrop--on'));

    // ── Freeze grid SMIL animations ──────────────────────────────
    // The 50+ stream cards are hidden behind the backdrop but their
    // indefinite `<animate>` elements keep ticking and repainting their
    // compositor layers every frame. Pause them for the duration of
    // the modal; unpause on collapse.
    _pauseGridSmil();

    // ── Deep clone the card — always in final Netflix-style layout ─
    const clone = cardEl.cloneNode(true) as HTMLElement;
    clone.classList.add('cg-card-expanded');
    clone.removeAttribute('data-cycle-id');
    _cloneCardEl = clone;

    // Pause SMIL in the clone too — the cloned `<animate>` elements
    // restart from begin=0 on insertion and would repaint the moving
    // clone every frame during the FLIP. The trailer adds its own
    // animated SVG on top and crossfades this static thumbnail away.
    _pauseSmilInTree(clone);

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

    // ── Build and append close + options buttons ───────────────────
    const optionsBtn = buildOptionsButton(clone);
    const closeBtn = buildCloseButton();

    // Append panel + controls to clone immediately (no deferred append)
    clone.append(panel, optionsBtn, closeBtn);

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
        `transform-origin:center center;` +
        `pointer-events:none;`;
    document.body.appendChild(clone);

    // ── Build the toRect from the constants we just wrote — no need
    //    to read getBoundingClientRect a second time (avoids a forced
    //    layout right before the animation starts). ─────────────────
    const toRect = new DOMRect(finalLeft, finalTop, targetW, finalH);

    // ── INVERT + PLAY: FLIP animation ──────────────────────────────
    const anim = flipAnimate(clone, fromRect, toRect, FLIP_EXPAND_MS, FLIP_EASING, fromBorderRadius);
    _activeFlipAnimation = anim;

    // Reveal panel content partway through the FLIP
    setTimeout(() => {
        if (sessionToken !== _expandSessionToken || _cloneCardEl !== clone) return;
        clone.classList.add('cg-expand--revealed');
    }, CONTENT_FADE_IN_DELAY);

    // On FLIP completion: mark as open, restore heavy effects, kick off
    // async enrichment, defer comments to idle, then start trailer.
    anim.finished
        .then(() => {
            if (sessionToken !== _expandSessionToken || _cloneCardEl !== clone) return;
            _activeFlipAnimation = null;
            clone.dataset.expandState = 'open';
            // Restore the full shadow and re-enable interaction.
            clone.classList.add('cg-expand--settled');
            clone.style.pointerEvents = '';
            // Promote the backdrop to its blurred state now that nothing
            // is animating across the viewport.
            if (_backdropEl === backdrop) {
                backdrop.classList.add('cg-card-backdrop--rest');
            }
            // Enrichment was previously kicked off in parallel with the
            // FLIP; doing it here avoids any async .innerHTML = ... writes
            // landing inside the animating element.
            void loadAndEnrich(entry.id, panel);
            // Reviews are heavy to generate; let them slot into idle time.
            scheduleCommentsFill(panel, entry, sessionToken);
            maybeStartQueuedTrailer(entry.id);
        })
        .catch(() => {
            // Animation was cancelled (e.g. rapid collapse) — safe to ignore
        });

    // ── Wire interactive elements ──────────────────────────────────
    wireAddButton(panel, entry, cardEl);
    wireDesignLink(panel, entry, cardEl);

    // ── Dismiss handlers ───────────────────────────────────────────
    attachDismissHandlers(clone, sessionToken);
}

/** Collapse any expanded card. */
export function collapseExpandedCard(): void {
    const collapseSession = ++_expandSessionToken;
    const original = _originalCardEl;
    const clone = _cloneCardEl;
    const backdrop = _backdropEl;

    // Stop trailer animation before clearing state
    stopTrailer();
    clearQueuedTrailer();
    cancelPendingComments();

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

    // Fade backdrop. The blur (`--rest`) is dropped immediately so the
    // compositor isn't blurring the viewport during the reverse FLIP; the
    // tint fades via the CSS opacity transition (0.6s). Keep the
    // `cg-expand-active` body class and the grid SMIL pause until the
    // reverse FLIP completes — otherwise 4,674 indefinite animations
    // restart and repaint behind the backdrop for the full 300ms collapse.
    if (backdrop) {
        backdrop.classList.remove('cg-card-backdrop--on');
        backdrop.classList.remove('cg-card-backdrop--rest');
    }

    // Helper: only unwind global state if no new modal has opened since.
    const releaseGlobalState = () => {
        if (collapseSession !== _expandSessionToken) return;
        document.body.classList.remove('cg-expand-active');
        _unpauseGridSmil();
    };

    if (!clone) {
        if (backdrop) backdrop.remove();
        releaseGlobalState();
        return;
    }

    // Drop the settled class so the in-flight (cheap) shadow is used during
    // the reverse FLIP — same perf rationale as the expand path.
    clone.classList.remove('cg-expand--settled');

    // Freeze everything inside the clone so the reverse FLIP only has to
    // composite a static bitmap:
    //  - Cancel any leftover WAAPI animations (trailer AUC fades, beat
    //    crossfades, counter ticks).
    //  - Pause SMIL in any SVG that was added after the initial pause
    //    (the trailer's hero SVG, for instance).
    //  - Add `cg-expand--frozen` so child CSS transitions are suppressed
    //    for the duration of the collapse.
    try {
        // getAnimations({ subtree: true }) returns child WAAPI animations
        // and any in-flight CSS transitions. The reverse FLIP animation
        // itself is created below, so cancelling here is safe.
        const cloneEl = clone as HTMLElement & {
            getAnimations(opts?: { subtree?: boolean }): Animation[];
        };
        for (const a of cloneEl.getAnimations({ subtree: true })) {
            try {
                a.cancel();
            } catch {
                // ignore
            }
        }
    } catch {
        // ignore
    }
    _pauseSmilInTree(clone);
    clone.classList.add('cg-expand--frozen');

    // Trigger panel content fade-out
    clone.classList.remove('cg-expand--revealed');
    clone.classList.add('cg-expand--collapsing');
    clone.style.overflow = 'hidden';

    const cleanup = () => {
        // Clone has faded to opacity 0 in the last frames of the reverse
        // FLIP — removing it is invisible (no pop into the source card
        // underneath).
        if (clone.parentElement) clone.remove();
        // The backdrop's own CSS opacity transition (0.6s) is longer than
        // the FLIP (0.3s), so at this point it's still mid-fade. Defer
        // removal until that transition completes — otherwise the
        // backdrop snaps from ~50% opacity straight to gone, which reads
        // as a jolt right when the card lands. Capture the ref so a
        // rapid re-expand can't accidentally point this at the new modal.
        if (backdrop?.parentElement) {
            const bd = backdrop;
            setTimeout(() => {
                if (bd.parentElement) bd.remove();
            }, BACKDROP_REMOVE_DELAY_MS);
        }
        releaseGlobalState();
    };

    // Get current positions for reverse FLIP
    const cloneRect = clone.getBoundingClientRect();
    const targetRect = original ? original.getBoundingClientRect() : cloneRect;
    const targetBorderRadius = original ? getComputedStyle(original).borderRadius || '6px' : '6px';

    // Reverse FLIP: animate from current position back to card. End opacity
    // is 0 (not 0.85) so the clone cross-fades into invisibility as it
    // reaches the source card's slot. The source card is already visible
    // underneath, so the user sees a smooth crossfade rather than a hard
    // swap on removal.
    const anim = clone.animate(
        [
            {
                transform: 'none',
                opacity: 1,
                borderRadius: '6px',
            },
            {
                transform: `translate(${targetRect.left + targetRect.width / 2 - (cloneRect.left + cloneRect.width / 2)}px, ${targetRect.top + targetRect.height / 2 - (cloneRect.top + cloneRect.height / 2)}px) scale(${targetRect.width / cloneRect.width}, ${targetRect.height / cloneRect.height})`,
                opacity: 0,
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

    // Seed the agent strip from the index entry's persisted creator metadata
    // when available, so the hero renders synchronously. The async bundle
    // load may later replace this with a richer version (with categoryTitle).
    let initialStrip = '';
    if (entry.creatorHandle) {
        const agent = getAgentByHandle(entry.creatorHandle);
        if (agent) initialStrip = buildAgentStripHtml(agent, 0, 'Protocol Streamer');
    }

    // Comments section is built later via requestIdleCallback so the
    // synchronous panel build stays light. A placeholder reserves vertical
    // space so the scroll height doesn't jump when reviews arrive.
    panel.innerHTML = `
        <div class="cg-expand-hero">
            <div class="cg-expand-agent-strip">${initialStrip}</div>
            <div class="cg-expand-hero-meta">
                <span class="cg-expand-duration">${escapeHtml(durationText)}</span>
                <div class="cg-expand-agent-tags-row">${effectsHtml}</div>
            </div>
        </div>
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
        <div class="cg-expand-comments-placeholder cg-expand-comments-list-placeholder" data-cycle-id="${escapeHtml(entry.id)}"></div>
    `;

    return panel;
}

/** Fill the deferred comments placeholder with reviews — or the generator UI. */
function populateCommentsSection(panel: HTMLElement, entry: SavedCycleIndexEntry): void {
    const placeholder = panel.querySelector<HTMLElement>('.cg-expand-comments-placeholder');
    if (!placeholder) return;
    const comments = generateStreamComments(entry);
    if (comments && comments.length > 0) {
        placeholder.outerHTML = buildCommentsSectionHtml(entry, comments);
        wireCommentsEditorControls(panel, entry);
    } else {
        placeholder.outerHTML = buildGenerateCommentsHtml(entry);
        // Wire the generator after DOM replace — we need the freshly-rendered nodes.
        wireGenerateCommentsControls(panel, entry);
    }
}

function buildCommentsSectionHtml(entry: SavedCycleIndexEntry, comments: StreamComment[]): string {
    const { avg, count } = summarizeStreamComments(comments);
    const rows = comments
        .map((c, idx) => renderCommentRowHtml(c, idx, entry.id))
        .join('');
    return `
        <div class="cg-expand-comments-section" data-cycle-id="${escapeHtml(entry.id)}">
            <div class="cg-expand-comments-header">
                <span class="cg-expand-section-label">Reviews</span>
                <span class="cg-expand-comments-summary">
                    ${renderStars(avg, 'sm')}
                    <span class="cg-expand-comments-avg">${formatScore(avg)}</span>
                    <span class="cg-expand-comments-count">· ${count} reviews</span>
                </span>
            </div>
            ${buildCommentsEditorRowHtml(entry)}
            <ul class="cg-expand-comments-list">${rows}</ul>
        </div>
    `;
}

/**
 * Editor row rendered above the comments list. Hidden by default; CSS
 * makes it visible only when the expanded card has the cg-edit-mode
 * class (toggled by the triple-dot options button). Lets the user pick
 * which provider+model to use for any per-comment regeneration.
 */
function buildCommentsEditorRowHtml(entry: SavedCycleIndexEntry): string {
    const defaultProvider = (AppState.selectedLLM || 'anthropic') as ProviderEntry['id'];
    const providerOptions = PROVIDER_LABELS.map(
        p =>
            `<option value="${p.id}"${p.id === defaultProvider ? ' selected' : ''}>${escapeHtml(p.label)}</option>`,
    ).join('');
    const modelOptions = buildModelOptionsHtml(defaultProvider);
    return `
        <div class="cg-expand-comments-editor" data-cycle-id="${escapeHtml(entry.id)}">
            <label class="cg-expand-comments-gen-field">
                <span class="cg-expand-comments-gen-label">Provider</span>
                <select class="cg-expand-comments-provider">${providerOptions}</select>
            </label>
            <label class="cg-expand-comments-gen-field">
                <span class="cg-expand-comments-gen-label">Model</span>
                <select class="cg-expand-comments-model">${modelOptions}</select>
            </label>
            <button type="button" class="cg-expand-comments-regen-all-btn"
                    data-cycle-id="${escapeHtml(entry.id)}"
                    title="Regenerate the full set of reviews from scratch">
                Regenerate All
            </button>
            <div class="cg-expand-comments-editor-status" role="status" aria-live="polite"></div>
        </div>
    `;
}

// ── Generate Comments UI (for cycles without cached reviews) ───────
//
// Replaces the auto-generated mock reviews path for newly-saved cycles.
// Shows a model picker + Generate button; on click, calls the LLM via
// the app's existing multi-provider pipeline, persists the result to
// stream-comments-data.json via the Vite plugin, and refreshes the
// section in place with the real reviews.

interface ProviderEntry {
    id: 'anthropic' | 'openai' | 'grok' | 'gemini';
    label: string;
}
const PROVIDER_LABELS: ProviderEntry[] = [
    { id: 'anthropic', label: 'Claude' },
    { id: 'openai', label: 'ChatGPT' },
    { id: 'grok', label: 'Grok' },
    { id: 'gemini', label: 'Gemini' },
];

function buildGenerateCommentsHtml(entry: SavedCycleIndexEntry): string {
    // Default to the user's current global provider so the picker feels
    // continuous with the rest of the app's model selectors.
    const defaultProvider = (AppState.selectedLLM || 'anthropic') as ProviderEntry['id'];
    const providerOptions = PROVIDER_LABELS.map(
        p =>
            `<option value="${p.id}"${p.id === defaultProvider ? ' selected' : ''}>${escapeHtml(p.label)}</option>`,
    ).join('');
    const modelOptions = buildModelOptionsHtml(defaultProvider);

    return `
        <div class="cg-expand-comments-section cg-expand-comments-section--empty"
             data-cycle-id="${escapeHtml(entry.id)}">
            <div class="cg-expand-comments-header">
                <span class="cg-expand-section-label">Reviews</span>
                <span class="cg-expand-comments-summary cg-expand-comments-empty-note">
                    No reviews yet. Generate simulated user reviews from the protocol's intent + creator philosophy.
                </span>
            </div>
            <div class="cg-expand-comments-generator" role="group" aria-label="Generate reviews">
                <label class="cg-expand-comments-gen-field">
                    <span class="cg-expand-comments-gen-label">Provider</span>
                    <select class="cg-expand-comments-provider">${providerOptions}</select>
                </label>
                <label class="cg-expand-comments-gen-field">
                    <span class="cg-expand-comments-gen-label">Model</span>
                    <select class="cg-expand-comments-model">${modelOptions}</select>
                </label>
                <button type="button" class="cg-expand-comments-generate-btn"
                        data-cycle-id="${escapeHtml(entry.id)}">
                    Generate Comments
                </button>
                <div class="cg-expand-comments-gen-status" role="status" aria-live="polite"></div>
            </div>
        </div>
    `;
}

function buildModelOptionsHtml(provider: ProviderEntry['id']): string {
    const opts = (MODEL_OPTIONS as any)[provider] || [];
    // Bias to mid-tier (tier 1) when available — sonnet/equivalent —
    // since these reviews benefit from a thoughtful model, not haiku.
    const preferredKey =
        opts.find((o: any) => o.tier === 1 && !o.adaptiveOnly)?.key ||
        opts.find((o: any) => o.isProviderDefaultForTier)?.key ||
        opts[0]?.key;
    return opts
        .map(
            (o: any) =>
                `<option value="${o.key}"${o.key === preferredKey ? ' selected' : ''}>${escapeHtml(o.label || o.model)}</option>`,
        )
        .join('');
}

function wireGenerateCommentsControls(panel: HTMLElement, entry: SavedCycleIndexEntry): void {
    const section = panel.querySelector<HTMLElement>('.cg-expand-comments-section--empty');
    if (!section) return;
    const providerSel = section.querySelector<HTMLSelectElement>('.cg-expand-comments-provider');
    const modelSel = section.querySelector<HTMLSelectElement>('.cg-expand-comments-model');
    const btn = section.querySelector<HTMLButtonElement>('.cg-expand-comments-generate-btn');
    const status = section.querySelector<HTMLElement>('.cg-expand-comments-gen-status');
    if (!providerSel || !modelSel || !btn || !status) return;

    // Repopulate model list whenever provider changes.
    providerSel.addEventListener('change', () => {
        modelSel.innerHTML = buildModelOptionsHtml(providerSel.value as ProviderEntry['id']);
    });

    btn.addEventListener('click', async e => {
        e.stopPropagation();
        const provider = providerSel.value as ProviderEntry['id'];
        const modelKey = modelSel.value;
        const opts = (MODEL_OPTIONS as any)[provider] || [];
        const modelEntry = opts.find((o: any) => o.key === modelKey) || opts[0];
        if (!modelEntry) {
            status.textContent = 'No model available for that provider.';
            return;
        }

        btn.disabled = true;
        providerSel.disabled = true;
        modelSel.disabled = true;
        status.textContent = `Generating with ${modelEntry.label || modelEntry.model}…`;

        try {
            const reviews = await generateReviewsForEntry(entry, provider, modelEntry);
            // Persist to the filesystem JSON via the Vite plugin.
            const res = await fetch(`/__stream-comments/${encodeURIComponent(entry.id)}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ reviews }),
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Save failed (${res.status}) ${errText.slice(0, 200)}`);
            }
            // Update the in-memory map and re-render in place.
            setLLMReviewsFor(entry.id, reviews);
            const newComments = generateStreamComments(entry);
            if (newComments && newComments.length > 0) {
                section.outerHTML = buildCommentsSectionHtml(entry, newComments);
                // Edit-mode controls (model selector + per-comment regen)
                // are now part of the rendered section — wire them up.
                wireCommentsEditorControls(panel, entry);
            } else {
                status.textContent = 'Generated, but render failed. Reload to see them.';
            }
        } catch (err: any) {
            console.error('[stream-comments] generate failed', err);
            status.textContent = `Failed: ${err?.message || 'unknown error'}`;
            btn.disabled = false;
            providerSel.disabled = false;
            modelSel.disabled = false;
        }
    });
}

async function generateReviewsForEntry(
    entry: SavedCycleIndexEntry,
    provider: ProviderEntry['id'],
    modelEntry: any,
): Promise<LLMReview[]> {
    const userPrompt = buildStreamCommentsPrompt({
        prompt: entry.prompt || '',
        title: entry.overlayTitle || entry.filename || '',
        hookSentence: entry.hookSentence || '',
        topEffects: entry.topEffects || [],
        substanceClasses: entry.substanceClasses || [],
        creatorName: entry.creatorName || '',
        durationDays: entry.timeHorizon?.durationDays ?? null,
    });

    const apiKey = (AppState.apiKeys as any)?.[provider];
    if (!apiKey) {
        throw new Error(`No API key configured for ${provider}.`);
    }
    const maxTokens = (modelEntry.maxOutput as number | undefined) || 2400;
    const opts: any = {};
    if (modelEntry.supportsEffort) opts.effort = modelEntry.defaultEffort || 'off';

    // callGenericRouted resolves to the parsed JSON object — the providers
    // extract the text content and run parseJSONObjectResponse on it before
    // returning. So `parsed` is already { reviews: [...] } (plus internal
    // _rawResponse / _requestBody metadata fields).
    const parsed: any = await callGenericRouted(
        userPrompt,
        apiKey,
        modelEntry.model,
        modelEntry.type,
        provider,
        '', // no system prompt
        maxTokens,
        opts,
    );
    let reviews = parsed?.reviews;
    // Fallback: if the model wrapped its output in code fences and the
    // internal parser couldn't unwrap it, try the rawResponse text path.
    if (!Array.isArray(reviews) && typeof parsed?._rawResponse === 'string') {
        const fallback = extractAndParseJSON(parsed._rawResponse);
        if (Array.isArray(fallback?.reviews)) reviews = fallback.reviews;
    }
    if (!Array.isArray(reviews) || reviews.length < 3) {
        throw new Error('Model returned malformed reviews array.');
    }
    // Coerce + validate each row.
    const out: LLMReview[] = [];
    for (const r of reviews) {
        if (!r || typeof r !== 'object') continue;
        const stars = Number((r as any).stars);
        const t = String((r as any).text || '').trim();
        if (!Number.isFinite(stars) || stars < 1 || stars > 5) continue;
        if (t.length < 10) continue;
        out.push({ stars, text: t });
    }
    if (out.length < 3) throw new Error('Too few valid reviews after parsing.');
    return out;
}

// ── Edit-mode wiring (for cycles that already have reviews) ────────
//
// Wires up the editor row (provider/model selector + Regenerate All)
// plus the per-comment regenerate buttons. All controls are rendered
// unconditionally; CSS hides them outside edit mode.

function wireCommentsEditorControls(panel: HTMLElement, entry: SavedCycleIndexEntry): void {
    const section = panel.querySelector<HTMLElement>(
        `.cg-expand-comments-section[data-cycle-id="${cssAttr(entry.id)}"]`,
    );
    if (!section) return;

    const editor = section.querySelector<HTMLElement>('.cg-expand-comments-editor');
    const providerSel = editor?.querySelector<HTMLSelectElement>('.cg-expand-comments-provider');
    const modelSel = editor?.querySelector<HTMLSelectElement>('.cg-expand-comments-model');
    const regenAllBtn = editor?.querySelector<HTMLButtonElement>('.cg-expand-comments-regen-all-btn');
    const status = editor?.querySelector<HTMLElement>('.cg-expand-comments-editor-status');

    if (providerSel && modelSel) {
        providerSel.addEventListener('change', () => {
            modelSel.innerHTML = buildModelOptionsHtml(providerSel.value as ProviderEntry['id']);
        });
    }

    if (regenAllBtn && providerSel && modelSel && status) {
        regenAllBtn.addEventListener('click', async e => {
            e.stopPropagation();
            await handleRegenerateAll(entry, providerSel, modelSel, regenAllBtn, status, panel);
        });
    }

    // Per-comment regenerate buttons. Use event delegation on the list so
    // newly re-rendered rows pick up the handler automatically.
    const list = section.querySelector<HTMLElement>('.cg-expand-comments-list');
    if (!list) return;
    list.addEventListener('click', e => {
        const target = e.target as HTMLElement;
        const btn = target?.closest<HTMLButtonElement>('.cg-expand-comment-regen-btn');
        if (!btn) return;
        e.stopPropagation();
        if (btn.disabled) return;
        const indexAttr = btn.getAttribute('data-comment-index');
        const starsAttr = btn.getAttribute('data-comment-stars');
        const idx = indexAttr ? Number(indexAttr) : NaN;
        const stars = starsAttr ? Number(starsAttr) : NaN;
        if (!Number.isFinite(idx) || !Number.isFinite(stars)) return;
        void handleRegenerateOne({
            entry,
            commentIndex: idx,
            targetStars: stars,
            providerSel,
            modelSel,
            status,
            btn,
            panel,
        });
    });
}

/** CSS.escape-equivalent for attribute selectors. */
function cssAttr(value: string): string {
    return value.replace(/"/g, '\\"');
}

async function handleRegenerateAll(
    entry: SavedCycleIndexEntry,
    providerSel: HTMLSelectElement,
    modelSel: HTMLSelectElement,
    btn: HTMLButtonElement,
    status: HTMLElement,
    panel: HTMLElement,
): Promise<void> {
    const provider = providerSel.value as ProviderEntry['id'];
    const modelKey = modelSel.value;
    const opts = (MODEL_OPTIONS as any)[provider] || [];
    const modelEntry = opts.find((o: any) => o.key === modelKey) || opts[0];
    if (!modelEntry) {
        status.textContent = 'No model available for that provider.';
        return;
    }
    btn.disabled = true;
    providerSel.disabled = true;
    modelSel.disabled = true;
    status.textContent = `Regenerating all reviews with ${modelEntry.label || modelEntry.model}…`;
    try {
        const reviews = await generateReviewsForEntry(entry, provider, modelEntry);
        await persistReviewsToServer(entry.id, reviews);
        setLLMReviewsFor(entry.id, reviews);
        // Re-render the comments section in place. Preserve edit mode so
        // the user can keep iterating without re-toggling.
        rerenderCommentsSection(panel, entry);
    } catch (err: any) {
        console.error('[stream-comments] regenerate-all failed', err);
        status.textContent = `Failed: ${err?.message || 'unknown error'}`;
    } finally {
        btn.disabled = false;
        providerSel.disabled = false;
        modelSel.disabled = false;
    }
}

async function handleRegenerateOne(args: {
    entry: SavedCycleIndexEntry;
    commentIndex: number;
    targetStars: number;
    providerSel: HTMLSelectElement | null | undefined;
    modelSel: HTMLSelectElement | null | undefined;
    status: HTMLElement | null | undefined;
    btn: HTMLButtonElement;
    panel: HTMLElement;
}): Promise<void> {
    const { entry, commentIndex, targetStars, providerSel, modelSel, status, btn, panel } = args;
    const provider = (providerSel?.value || AppState.selectedLLM || 'anthropic') as ProviderEntry['id'];
    const opts = (MODEL_OPTIONS as any)[provider] || [];
    const modelKey = modelSel?.value || opts[0]?.key;
    const modelEntry = opts.find((o: any) => o.key === modelKey) || opts[0];
    if (!modelEntry) {
        if (status) status.textContent = 'No model available for that provider.';
        return;
    }

    const currentReviews = getLLMReviewsFor(entry.id);
    if (!currentReviews || commentIndex < 0 || commentIndex >= currentReviews.length) {
        if (status) status.textContent = 'Cannot regenerate — review not found.';
        return;
    }

    btn.disabled = true;
    btn.classList.add('cg-expand-comment-regen-btn--loading');
    const originalLabel = btn.querySelector<HTMLElement>('.cg-expand-comment-regen-label');
    if (originalLabel) originalLabel.textContent = 'Regenerating…';
    if (status) status.textContent = `Regenerating review #${commentIndex + 1}…`;

    try {
        const siblingTexts = currentReviews
            .filter((_, i) => i !== commentIndex)
            .map(r => r.text);
        const newReview = await regenerateSingleReview(
            entry,
            targetStars,
            siblingTexts,
            provider,
            modelEntry,
        );
        const updated = currentReviews.slice();
        updated[commentIndex] = newReview;
        await persistReviewsToServer(entry.id, updated);
        setLLMReviewsFor(entry.id, updated);
        rerenderCommentsSection(panel, entry);
        if (status) status.textContent = `Review #${commentIndex + 1} updated.`;
    } catch (err: any) {
        console.error('[stream-comments] regenerate-one failed', err);
        if (status) status.textContent = `Failed: ${err?.message || 'unknown error'}`;
        btn.disabled = false;
        btn.classList.remove('cg-expand-comment-regen-btn--loading');
        if (originalLabel) originalLabel.textContent = 'Regenerate';
    }
}

async function regenerateSingleReview(
    entry: SavedCycleIndexEntry,
    targetStars: number,
    siblingTexts: string[],
    provider: ProviderEntry['id'],
    modelEntry: any,
): Promise<LLMReview> {
    const userPrompt = buildSingleReviewPrompt(
        {
            prompt: entry.prompt || '',
            title: entry.overlayTitle || entry.filename || '',
            hookSentence: entry.hookSentence || '',
            topEffects: entry.topEffects || [],
            substanceClasses: entry.substanceClasses || [],
            creatorName: entry.creatorName || '',
            durationDays: entry.timeHorizon?.durationDays ?? null,
        },
        targetStars,
        siblingTexts,
    );
    const apiKey = (AppState.apiKeys as any)?.[provider];
    if (!apiKey) throw new Error(`No API key configured for ${provider}.`);
    const maxTokens = (modelEntry.maxOutput as number | undefined) || 800;
    const opts: any = {};
    if (modelEntry.supportsEffort) opts.effort = modelEntry.defaultEffort || 'off';

    const parsed: any = await callGenericRouted(
        userPrompt,
        apiKey,
        modelEntry.model,
        modelEntry.type,
        provider,
        '',
        maxTokens,
        opts,
    );
    let review = parsed?.review;
    if (!review && typeof parsed?._rawResponse === 'string') {
        const fallback = extractAndParseJSON(parsed._rawResponse);
        if (fallback?.review) review = fallback.review;
    }
    if (!review || typeof review !== 'object') {
        throw new Error('Model returned no valid review object.');
    }
    const stars = Number((review as any).stars);
    const text = String((review as any).text || '').trim();
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
        throw new Error('Review missing valid stars value.');
    }
    if (text.length < 10) throw new Error('Review text too short.');
    // Clamp regenerated stars to the requested tier so a misbehaving model
    // can't disrupt the card's overall star mix.
    return { stars: targetStars, text };
}

async function persistReviewsToServer(cycleId: string, reviews: LLMReview[]): Promise<void> {
    const res = await fetch(`/__stream-comments/${encodeURIComponent(cycleId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviews }),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status}) ${errText.slice(0, 200)}`);
    }
}

/**
 * Re-render the comments section in place after a mutation. Preserves
 * scroll position and keeps the edit-mode class on the expanded card so
 * the user can keep iterating without re-toggling.
 */
function rerenderCommentsSection(panel: HTMLElement, entry: SavedCycleIndexEntry): void {
    const existing = panel.querySelector<HTMLElement>(
        `.cg-expand-comments-section[data-cycle-id="${cssAttr(entry.id)}"]`,
    );
    if (!existing) return;
    const scroller = panel as HTMLElement;
    const priorScrollTop = scroller.scrollTop;
    const newComments = generateStreamComments(entry);
    if (!newComments || newComments.length === 0) {
        existing.outerHTML = buildGenerateCommentsHtml(entry);
        wireGenerateCommentsControls(panel, entry);
    } else {
        existing.outerHTML = buildCommentsSectionHtml(entry, newComments);
        wireCommentsEditorControls(panel, entry);
    }
    scroller.scrollTop = priorScrollTop;
}

function renderCommentRowHtml(c: StreamComment, index: number, cycleId: string): string {
    const verifiedBadge = c.verifiedStreamer
        ? '<span class="cg-expand-comment-verified" title="Verified Streamer">✓ verified</span>'
        : '';
    const helpfulHtml =
        c.helpfulCount > 0
            ? `<span class="cg-expand-comment-helpful" aria-label="${c.helpfulCount} found this helpful">▲ ${c.helpfulCount} helpful</span>`
            : '';
    // Regenerate button is rendered always but only made visible by CSS
    // when the expanded card is in edit mode. data-* attrs let the
    // wiring locate the row + target star tier without re-traversing.
    const regenBtn = `<button type="button" class="cg-expand-comment-regen-btn"
            data-cycle-id="${escapeHtml(cycleId)}"
            data-comment-index="${index}"
            data-comment-stars="${c.stars}"
            title="Regenerate this review"
            aria-label="Regenerate this review">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 15.5-6.3"/>
                <path d="M21 4v5h-5"/>
                <path d="M21 12a9 9 0 0 1-15.5 6.3"/>
                <path d="M3 20v-5h5"/>
            </svg>
            <span class="cg-expand-comment-regen-label">Regenerate</span>
        </button>`;
    return `
        <li class="cg-expand-comment" data-comment-index="${index}">
            <div class="cg-expand-comment-head">
                <span class="cg-expand-comment-name">${escapeHtml(c.displayName)}</span>
                <span class="cg-expand-comment-handle">${escapeHtml(c.handle)}</span>
                ${verifiedBadge}
                <span class="cg-expand-comment-stars">${renderStars(c.stars, 'sm')}</span>
                <span class="cg-expand-comment-time">${escapeHtml(formatRelativeDays(c.daysAgo))}</span>
                ${regenBtn}
            </div>
            <p class="cg-expand-comment-text">${escapeHtml(c.text)}</p>
            ${helpfulHtml ? `<div class="cg-expand-comment-foot">${helpfulHtml}</div>` : ''}
        </li>
    `;
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

/**
 * Triple-dot options button. Toggles the `cg-edit-mode` class on the
 * expanded card, which CSS uses to reveal the comments editor row
 * (provider/model selector + Regenerate All) and per-comment regenerate
 * icon buttons. Idempotent; clicking again returns the card to view mode.
 */
function buildOptionsButton(expandedCard: HTMLElement): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'cg-expand-options';
    btn.setAttribute('aria-label', 'Edit reviews');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Edit reviews';
    btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
        '<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const on = expandedCard.classList.toggle('cg-edit-mode');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.classList.toggle('cg-expand-options--active', on);
    });
    return btn;
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
    const credentials = escapeHtml(agent.meta.credentials || '');
    const followerProxy = escapeHtml(agent.meta.followerProxy || '');
    const tagline = escapeHtml(agent.meta.tagline || '');

    const efficacy = typeof agent.efficacyScore === 'number' ? agent.efficacyScore : 0;
    const ratingHtml =
        efficacy > 0
            ? `<div class="cg-expand-agent-rating" title="Efficacy ${formatScore(efficacy)}/5">
                   ${renderStars(efficacy, 'lg')}
                   <span class="cg-expand-agent-rating-score">${formatScore(efficacy)}</span>
                   <span class="cg-expand-agent-rating-label">Efficacy</span>
               </div>`
            : '';

    const credentialsHtml = credentials ? `<div class="cg-expand-agent-credentials">${credentials}</div>` : '';
    const followerHtml = followerProxy
        ? `<div class="cg-expand-agent-followers">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                   <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                   <circle cx="9" cy="7" r="4"/>
                   <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                   <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
               </svg>
               <span>${followerProxy}</span>
           </div>`
        : '';
    const taglineHtml = tagline ? `<div class="cg-expand-agent-tagline">${tagline}</div>` : '';

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
            ${credentialsHtml}
            ${followerHtml}
            ${taglineHtml}
        </div>
        ${ratingHtml}
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
