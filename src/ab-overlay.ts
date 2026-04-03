/**
 * A/B Test Overlay — Self-destructing UI/UX variant toggle panel.
 *
 * Provides a floating overlay for switching between 2-3 UI variants and a
 * "Keep" button that triggers automatic cleanup of non-selected variants
 * from source code via the Vite dev server endpoint.
 *
 * When no tests are registered, this module creates zero DOM elements.
 *
 * Exports: registerAbTest, destroyAbOverlay
 */

import { sessionSettingsStore, STORAGE_KEYS } from './settings-store';

// ── Types ───────────────────────────────────────────────────────────────

export interface AbVariant {
    id: string;
    label: string;
    activate: () => void;
    deactivate: () => void;
}

interface AbTestEntry {
    name: string;
    variants: AbVariant[];
    activeId: string;
}

// ── State ───────────────────────────────────────────────────────────────

const _registry = new Map<string, AbTestEntry>();
const _pendingDecisions = new Map<string, string>(); // testName → selected variantId
let _panel: HTMLDivElement | null = null;
let _styleEl: HTMLStyleElement | null = null;
let _dragState: { startX: number; startY: number; originX: number; originY: number } | null = null;
let _pendingFetched = false;

// ── CSS (injected once) ─────────────────────────────────────────────────

const AB_STYLES = `
.ab-overlay-panel {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 10000;
    min-width: 240px;
    max-width: 340px;
    background: rgba(14, 21, 32, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(110, 231, 255, 0.2);
    border-radius: 14px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    font-family: var(--font-primary, 'Space Grotesk', sans-serif);
    color: #eef4ff;
    overflow: hidden;
    transition: opacity 0.25s ease, transform 0.25s ease;
    user-select: none;
}
body.light-mode .ab-overlay-panel {
    background: rgba(255, 255, 255, 0.92);
    border-color: rgba(59, 130, 246, 0.25);
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06) inset;
    color: #1e293b;
}
.ab-overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    cursor: grab;
}
.ab-overlay-header:active { cursor: grabbing; }
body.light-mode .ab-overlay-header {
    border-bottom-color: rgba(0, 0, 0, 0.08);
}
.ab-overlay-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #9aa9c0;
}
body.light-mode .ab-overlay-title { color: #64748b; }
.ab-overlay-collapse {
    background: none;
    border: none;
    color: #9aa9c0;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
    transition: transform 0.2s ease;
}
.ab-overlay-collapse.collapsed { transform: rotate(180deg); }
body.light-mode .ab-overlay-collapse { color: #64748b; }
.ab-overlay-body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.ab-overlay-body.hidden { display: none; }
.ab-test-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ab-test-name {
    font-size: 11px;
    font-weight: 500;
    color: #9aa9c0;
    letter-spacing: 0.5px;
}
body.light-mode .ab-test-name { color: #64748b; }
.ab-variant-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}
.ab-variant-btn {
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: #9aa9c0;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
}
.ab-variant-btn:hover {
    border-color: rgba(110, 231, 255, 0.3);
    color: #c8d6e5;
}
.ab-variant-btn.active {
    border-color: rgba(110, 231, 255, 0.5);
    color: #6ee7ff;
    background: rgba(110, 231, 255, 0.08);
    box-shadow: 0 0 12px rgba(110, 231, 255, 0.15);
}
body.light-mode .ab-variant-btn {
    border-color: rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.03);
    color: #64748b;
}
body.light-mode .ab-variant-btn:hover {
    border-color: rgba(59, 130, 246, 0.3);
    color: #334155;
}
body.light-mode .ab-variant-btn.active {
    border-color: rgba(59, 130, 246, 0.5);
    color: #2563eb;
    background: rgba(59, 130, 246, 0.08);
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.12);
}
.ab-destruct-btn {
    width: 100%;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.1);
    color: #4ade80;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
}
.ab-destruct-btn:hover {
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.6);
    box-shadow: 0 0 16px rgba(34, 197, 94, 0.2);
}
.ab-destruct-btn.processing {
    pointer-events: none;
    opacity: 0.6;
}
.ab-destruct-btn.locked {
    border-color: rgba(110, 231, 255, 0.4);
    background: rgba(110, 231, 255, 0.08);
    color: #6ee7ff;
    cursor: pointer;
}
.ab-destruct-btn.locked:hover {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.08);
    color: #f87171;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.12);
}
body.light-mode .ab-destruct-btn {
    border-color: rgba(22, 163, 74, 0.4);
    background: rgba(22, 163, 74, 0.08);
    color: #16a34a;
}
body.light-mode .ab-destruct-btn:hover {
    background: rgba(22, 163, 74, 0.15);
    border-color: rgba(22, 163, 74, 0.6);
}
.ab-overlay-footer {
    padding: 8px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 10px;
    color: #5a6a80;
    text-align: center;
}
body.light-mode .ab-overlay-footer {
    border-top-color: rgba(0, 0, 0, 0.06);
    color: #94a3b8;
}
`;

// ── Helpers ──────────────────────────────────────────────────────────────

function injectStyles(): void {
    if (_styleEl) return;
    _styleEl = document.createElement('style');
    _styleEl.textContent = AB_STYLES;
    document.head.appendChild(_styleEl);
}

function ensurePanel(): HTMLDivElement {
    if (_panel) return _panel;
    injectStyles();

    const panel = document.createElement('div');
    panel.className = 'ab-overlay-panel';
    document.body.appendChild(panel);

    // Restore position from session settings
    const pos = sessionSettingsStore.getJson<{ x: number; y: number } | null>(STORAGE_KEYS.abOverlayPos, null);
    if (pos) {
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;
    }

    _panel = panel;
    return panel;
}

function savePosition(): void {
    if (!_panel) return;
    const rect = _panel.getBoundingClientRect();
    sessionSettingsStore.setJson(STORAGE_KEYS.abOverlayPos, { x: rect.left, y: rect.top });
}

// ── Drag handling ───────────────────────────────────────────────────────

function onDragStart(e: MouseEvent): void {
    if (!_panel) return;
    const rect = _panel.getBoundingClientRect();
    _dragState = {
        startX: e.clientX,
        startY: e.clientY,
        originX: rect.left,
        originY: rect.top,
    };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    e.preventDefault();
}

function onDragMove(e: MouseEvent): void {
    if (!_dragState || !_panel) return;
    const dx = e.clientX - _dragState.startX;
    const dy = e.clientY - _dragState.startY;
    _panel.style.right = 'auto';
    _panel.style.bottom = 'auto';
    _panel.style.left = `${_dragState.originX + dx}px`;
    _panel.style.top = `${_dragState.originY + dy}px`;
}

function onDragEnd(): void {
    _dragState = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    savePosition();
}

// ── Panel rendering ─────────────────────────────────────────────────────

function renderPanel(): void {
    const panel = ensurePanel();
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'ab-overlay-header';
    header.addEventListener('mousedown', onDragStart);

    const title = document.createElement('span');
    title.className = 'ab-overlay-title';
    title.textContent = 'A/B Tests';
    header.appendChild(title);

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'ab-overlay-collapse';
    collapseBtn.textContent = '\u25B2'; // ▲
    const isCollapsed = sessionSettingsStore.getString(STORAGE_KEYS.abOverlayCollapsed) === '1';
    if (isCollapsed) collapseBtn.classList.add('collapsed');
    header.appendChild(collapseBtn);
    panel.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'ab-overlay-body';
    if (isCollapsed) body.classList.add('hidden');
    panel.appendChild(body);

    collapseBtn.addEventListener('click', () => {
        const nowCollapsed = body.classList.toggle('hidden');
        collapseBtn.classList.toggle('collapsed', nowCollapsed);
        sessionSettingsStore.setString(STORAGE_KEYS.abOverlayCollapsed, nowCollapsed ? '1' : '0');
    });

    // Test groups
    for (const [, entry] of _registry) {
        const group = document.createElement('div');
        group.className = 'ab-test-group';

        const nameEl = document.createElement('span');
        nameEl.className = 'ab-test-name';
        nameEl.textContent = entry.name;
        group.appendChild(nameEl);

        const btnRow = document.createElement('div');
        btnRow.className = 'ab-variant-buttons';

        const isLocked = _pendingDecisions.has(entry.name);
        for (const variant of entry.variants) {
            const btn = document.createElement('button');
            btn.className = 'ab-variant-btn';
            if (variant.id === entry.activeId) btn.classList.add('active');
            btn.textContent = `${variant.id.replace('variant-', '').toUpperCase()}: ${variant.label}`;
            btn.addEventListener('click', () => switchVariant(entry.name, variant.id));
            if (isLocked) {
                btn.style.opacity = '0.4';
                btn.style.pointerEvents = 'none';
            }
            btnRow.appendChild(btn);
        }
        group.appendChild(btnRow);

        // Keep button
        const activeVariant = entry.variants.find(v => v.id === entry.activeId);
        const keepBtn = document.createElement('button');
        keepBtn.className = 'ab-destruct-btn';
        const pending = _pendingDecisions.get(entry.name);
        if (pending) {
            keepBtn.textContent = `\u2714 Locked: ${entry.variants.find(v => v.id === pending)?.label ?? pending} — cleans on restart`;
            keepBtn.classList.add('locked');
        } else {
            keepBtn.textContent = `Self Destruct \u2192 ${activeVariant?.label ?? entry.activeId}`;
        }
        keepBtn.addEventListener('click', () => selfDestruct(entry.name, entry.activeId, keepBtn));
        group.appendChild(keepBtn);

        body.appendChild(group);
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'ab-overlay-footer';
    footer.textContent =
        _pendingDecisions.size > 0 ? 'Cleanup runs on next server restart' : 'git checkout -- . to undo';
    panel.appendChild(footer);
}

// ── Pending state restore ────────────────────────────────────────────────

async function restorePendingDecisions(): Promise<void> {
    if (_pendingFetched) return;
    _pendingFetched = true;
    try {
        const res = await fetch('/__ab/pending');
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && data.decisions) {
            let changed = false;
            for (const [testName, variantId] of Object.entries(data.decisions)) {
                if (_registry.has(testName) && !_pendingDecisions.has(testName)) {
                    _pendingDecisions.set(testName, variantId as string);
                    changed = true;
                }
            }
            if (changed) renderPanel();
        }
    } catch {
        /* dev server may not be available */
    }
}

// ── Actions ─────────────────────────────────────────────────────────────

function switchVariant(testName: string, newVariantId: string): void {
    const entry = _registry.get(testName);
    if (!entry || entry.activeId === newVariantId) return;
    if (_pendingDecisions.has(testName)) return;

    // Deactivate current
    const current = entry.variants.find(v => v.id === entry.activeId);
    if (current) current.deactivate();

    // Activate new
    const next = entry.variants.find(v => v.id === newVariantId);
    if (next) next.activate();

    entry.activeId = newVariantId;
    renderPanel();
}

async function selfDestruct(testName: string, selectedVariant: string, btn: HTMLButtonElement): Promise<void> {
    // Dev-only guard
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        // eslint-disable-next-line no-console
        console.warn('[ab-overlay] Self-destruct only works on dev server');
        return;
    }

    // If already locked on this variant, unlock (cancel the decision)
    if (_pendingDecisions.get(testName) === selectedVariant) {
        try {
            await fetch('/__ab/decide', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ testName }),
            });
            _pendingDecisions.delete(testName);
        } catch {
            /* best-effort */
        }
        renderPanel();
        return;
    }

    btn.classList.add('processing');
    btn.textContent = 'Locking\u2026';

    try {
        const res = await fetch('/__ab/decide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testName, selectedVariant }),
        });
        const data = await res.json();

        if (data.ok) {
            _pendingDecisions.set(testName, selectedVariant);
            renderPanel();
        } else {
            btn.textContent = `Error: ${data.error}`;
            btn.classList.remove('processing');
        }
    } catch (err: any) {
        btn.textContent = `Failed: ${err?.message ?? 'network error'}`;
        btn.classList.remove('processing');
    }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Register an A/B test with 2-3 variants. The first variant is activated by default.
 * Idempotent — re-registering the same testName updates the entry (HMR-safe).
 */
export function registerAbTest(name: string, variants: AbVariant[]): void {
    if (typeof document === 'undefined') return;
    if (variants.length < 2) {
        // eslint-disable-next-line no-console
        console.warn(`[ab-overlay] Test "${name}" needs at least 2 variants, got ${variants.length}`);
        return;
    }

    const existing = _registry.get(name);
    const activeId = existing?.activeId ?? variants[0].id;

    // Deactivate all, then activate the current one
    for (const v of variants) {
        if (v.id === activeId) {
            v.activate();
        } else {
            v.deactivate();
        }
    }

    _registry.set(name, { name, variants, activeId });
    renderPanel();

    // Restore locked state from server (non-blocking)
    void restorePendingDecisions();
}

/**
 * Remove the overlay and clean up all DOM elements.
 */
export function destroyAbOverlay(): void {
    if (_panel) {
        _panel.remove();
        _panel = null;
    }
    if (_styleEl) {
        _styleEl.remove();
        _styleEl = null;
    }
    _registry.clear();
}
