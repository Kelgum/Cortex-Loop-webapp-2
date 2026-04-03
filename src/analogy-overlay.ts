/**
 * Analogy Overlay — Investor-facing highlight layer that maps UI regions
 * to consumer-tech analogies (Google PageRank, Waze, Streaming Shopping Cart).
 * Pure visual overlay — no state or pipeline coupling.
 */

let _overlayEl: HTMLDivElement | null = null;
let _active = false;
let _rafId: number | null = null;

/* ── Google logo as inline SVG (official 4-color wordmark, simplified) ─── */

const GOOGLE_LOGO_SVG = `<svg viewBox="0 0 272 92" xmlns="http://www.w3.org/2000/svg" class="analogy-google-logo">
  <path d="M115.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18C71.25 34.32 81.24 25 93.5 25s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44S80.99 39.2 80.99 47.18c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z" fill="#EA4335"/>
  <path d="M163.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18c0-12.86 9.99-22.18 22.25-22.18s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44s-12.51 5.46-12.51 13.44c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z" fill="#FBBC05"/>
  <path d="M209.75 26.34v39.82c0 16.38-9.66 23.07-21.08 23.07-10.75 0-17.22-7.19-19.66-13.07l8.48-3.53c1.51 3.61 5.21 7.87 11.17 7.87 7.31 0 11.84-4.51 11.84-13v-3.19h-.34c-2.18 2.69-6.38 5.04-11.68 5.04-11.09 0-21.25-9.66-21.25-22.09 0-12.52 10.16-22.26 21.25-22.26 5.29 0 9.49 2.35 11.68 4.96h.34v-3.61h9.25zm-8.56 20.92c0-7.81-5.21-13.52-11.84-13.52-6.72 0-12.35 5.71-12.35 13.52 0 7.73 5.63 13.36 12.35 13.36 6.63 0 11.84-5.63 11.84-13.36z" fill="#4285F4"/>
  <path d="M225 3v65h-9.5V3h9.5z" fill="#34A853"/>
  <path d="M262.02 54.48l7.56 5.04c-2.44 3.61-8.32 9.83-18.48 9.83-12.6 0-22.01-9.74-22.01-22.18 0-13.19 9.49-22.18 20.92-22.18 11.51 0 17.14 9.16 18.98 14.11l1.01 2.52-29.65 12.28c2.27 4.45 5.8 6.72 10.75 6.72 4.96 0 8.4-2.44 10.92-6.14zm-23.27-7.98l19.82-8.23c-1.09-2.77-4.37-4.7-8.23-4.7-4.95 0-11.84 4.37-11.59 12.93z" fill="#EA4335"/>
  <path d="M35.29 41.19V32H67c.31 1.64.47 3.58.47 5.68 0 7.06-1.93 15.79-8.15 22.01-6.05 6.3-13.78 9.66-24.02 9.66C16.32 69.35.36 53.89.36 34.91.36 15.93 16.32.47 35.3.47c10.5 0 17.98 4.12 23.6 9.49l-6.64 6.64c-4.03-3.78-9.49-6.72-16.97-6.72-13.86 0-24.7 11.17-24.7 25.03 0 13.86 10.84 25.03 24.7 25.03 8.99 0 14.11-3.61 17.39-6.89 2.66-2.66 4.41-6.46 5.1-11.65l-22.49-.01z" fill="#4285F4"/>
</svg>`;

/* ── Waze logo (actual PNG image) ─────────────────────────────────────── */

const WAZE_LOGO_SVG = `<img src="/assets/waze-logo.png" alt="Waze" class="analogy-waze-logo"/>`;

/* ── Shopping cart icon ──────────────────────────────────────────────── */

const CART_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="analogy-cart-icon">
  <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
</svg>`;

interface OverlayTarget {
    id: string;
    label: string;
    logo: string;
    borderColor: string;
    bgColor: string;
    getRect: () => DOMRect | null;
}

function getTargets(): OverlayTarget[] {
    return [
        {
            id: 'analogy-pagerank',
            label: 'PageRank',
            logo: GOOGLE_LOGO_SVG,
            borderColor: 'rgba(66, 133, 244, 0.8)',
            bgColor: 'rgba(66, 133, 244, 0.08)',
            getRect: () => document.getElementById('agent-match-panel')?.getBoundingClientRect() ?? null,
        },
        {
            id: 'analogy-waze-route',
            label: 'Route',
            logo: WAZE_LOGO_SVG,
            borderColor: 'rgba(51, 204, 255, 0.8)',
            bgColor: 'rgba(51, 204, 255, 0.08)',
            getRect: () => document.querySelector('.sherlock-narration-panel')?.getBoundingClientRect() ?? null,
        },
        {
            id: 'analogy-waze-map',
            label: 'Map',
            logo: WAZE_LOGO_SVG,
            borderColor: 'rgba(51, 204, 255, 0.8)',
            bgColor: 'rgba(51, 204, 255, 0.08)',
            getRect: () => {
                const svg = document.getElementById('phase-chart-svg');
                return svg?.getBoundingClientRect() ?? null;
            },
        },
        {
            id: 'analogy-cart',
            label: 'Streaming Shopping Cart',
            logo: CART_SVG,
            borderColor: 'rgba(245, 200, 80, 0.8)',
            bgColor: 'rgba(245, 200, 80, 0.08)',
            getRect: () => {
                const g = document.getElementById('phase-substance-timeline');
                if (!g || !g.childElementCount) return null;
                // Use separator + pill bars only — connector lines / curve dots extend
                // into the chart area and would inflate the bounding box.
                const els = g.querySelectorAll('.timeline-separator, .timeline-bar');
                if (!els.length) return null;
                let minX = Infinity,
                    minY = Infinity,
                    maxX = -Infinity,
                    maxY = -Infinity;
                els.forEach(el => {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 && r.height === 0) return;
                    minX = Math.min(minX, r.left);
                    minY = Math.min(minY, r.top);
                    maxX = Math.max(maxX, r.right);
                    maxY = Math.max(maxY, r.bottom);
                });
                if (!isFinite(minX)) return null;
                return new DOMRect(minX, minY, maxX - minX, maxY - minY);
            },
        },
    ];
}

function ensureOverlay(): HTMLDivElement {
    if (_overlayEl && document.body.contains(_overlayEl)) return _overlayEl;
    const el = document.createElement('div');
    el.className = 'analogy-overlay';
    document.body.appendChild(el);
    _overlayEl = el;
    return el;
}

function positionHighlights() {
    const overlay = ensureOverlay();
    const targets = getTargets();

    for (const t of targets) {
        let box = overlay.querySelector<HTMLDivElement>(`#${t.id}`);
        const rect = t.getRect();

        if (!rect || rect.width === 0 || rect.height === 0) {
            if (box) box.style.display = 'none';
            continue;
        }

        if (!box) {
            box = document.createElement('div');
            box.id = t.id;
            box.className = 'analogy-highlight';
            box.style.borderColor = t.borderColor;
            box.style.background = t.bgColor;
            box.innerHTML = `
                <div class="analogy-highlight-badge">
                    <span class="analogy-highlight-logo">${t.logo}</span>
                    <span class="analogy-highlight-label">${t.label}</span>
                </div>
            `;
            overlay.appendChild(box);
        }

        box.style.display = '';
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
    }
}

function tickReposition() {
    if (!_active) return;
    positionHighlights();
    _rafId = requestAnimationFrame(tickReposition);
}

/* ── Inline Waze badges injected into actual UI elements ────────────── */

const WAZE_BADGE_CLASS = 'analogy-waze-inline-badge';

function injectWazeBadges(): void {
    // Narration panel — top-right corner
    const panel = document.querySelector('.sherlock-narration-panel') as HTMLElement | null;
    if (panel && !panel.querySelector(`.${WAZE_BADGE_CLASS}`)) {
        const badge = document.createElement('div');
        badge.className = WAZE_BADGE_CLASS;
        badge.innerHTML = `${WAZE_LOGO_SVG}<span class="analogy-waze-inline-label">Route</span>`;
        panel.appendChild(badge);
    }

    // Phase chart container — top-left corner
    const chartContainer = document.getElementById('phase-chart-container');
    if (chartContainer && !chartContainer.querySelector(`.${WAZE_BADGE_CLASS}`)) {
        const badge = document.createElement('div');
        badge.className = `${WAZE_BADGE_CLASS} analogy-waze-inline-badge--chart`;
        badge.innerHTML = `${WAZE_LOGO_SVG}<span class="analogy-waze-inline-label">Map</span>`;
        chartContainer.appendChild(badge);
    }
}

function removeWazeBadges(): void {
    document.querySelectorAll(`.${WAZE_BADGE_CLASS}`).forEach(el => el.remove());
}

export function toggleAnalogyOverlay(): void {
    _active = !_active;
    const btn = document.getElementById('analogy-overlay-btn');

    if (_active) {
        btn?.classList.add('active');
        const overlay = ensureOverlay();
        overlay.classList.add('visible');
        positionHighlights();
        injectWazeBadges();
        _rafId = requestAnimationFrame(tickReposition);
    } else {
        btn?.classList.remove('active');
        if (_overlayEl) _overlayEl.classList.remove('visible');
        removeWazeBadges();
        if (_rafId !== null) {
            cancelAnimationFrame(_rafId);
            _rafId = null;
        }
    }
}

export function initAnalogyOverlay(): void {
    const btn = document.getElementById('analogy-overlay-btn');
    if (!btn) return;
    btn.addEventListener('click', () => toggleAnalogyOverlay());
}
