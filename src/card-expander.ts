/**
 * card-expander — Inline card expansion UI for 28-day program cards.
 * Shows substance details + "Add to Stream" button when a wide card is clicked.
 *
 * Exports: expandCard, collapseExpandedCard, isCardExpanded
 * Depends on: cycle-store, substances, my-stream-store, my-stream, constants
 */

import { loadCycleBundle, type SavedCycleIndexEntry, type SessionCacheBundle } from './cycle-store';
import { SUBSTANCE_DB } from './substances';
import { addToStream, removeFromStream, isInStream, type SubstanceInput } from './my-stream-store';
import { refreshMyStream, animateStreamFill } from './my-stream';
import { BIOMETRIC_DEVICES } from './biometric-devices';

// ── State ──────────────────────────────────────────────────────────

let _expandedCardEl: HTMLElement | null = null;
let _expandedCycleId: string | null = null;
let _outsideClickHandler: ((e: MouseEvent) => void) | null = null;

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

    _expandedCardEl = cardEl;
    _expandedCycleId = entry.id;
    cardEl.classList.add('cg-card-expanded');

    // Build expand panel
    const panel = document.createElement('div');
    panel.className = 'cg-card-expand-panel';

    // Phase 1: show substance classes immediately (from index)
    const classesHtml = buildSubstanceClassesHtml(entry.substanceClasses || []);
    const effectsHtml = buildEffectsHtml(entry.topEffects || []);
    const durationText = buildDurationText(entry);
    const effectCountText = entry.maxEffects === 2 ? '2 effects' : '1 effect';
    const savedDate = formatDate(entry.savedAt);
    const devicesHtml = buildDeviceIconsHtml(entry.recommendedDevices);

    panel.innerHTML = `
        <div class="cg-expand-effects">${effectsHtml}</div>
        <div class="cg-expand-duration">${escHtml(durationText)}</div>
        <div class="cg-expand-substances">${classesHtml}</div>
        <div class="cg-expand-meta">
            <span class="cg-expand-effect-count">${effectCountText}</span>
            ${savedDate ? `<span class="cg-expand-date">Saved ${escHtml(savedDate)}</span>` : ''}
        </div>
        ${devicesHtml ? `<div class="cg-expand-devices">${devicesHtml}</div>` : ''}
        <div class="cg-expand-actions">
            <button class="cg-expand-add" data-cycle-id="${escHtml(entry.id)}" aria-label="Add to Stream">
                ${isInStream(entry.id) ? checkSvg() : plusSvg()}
            </button>
            <button class="cg-expand-design-link" data-cycle-id="${escHtml(entry.id)}">
                Open in Design
            </button>
        </div>
    `;

    cardEl.appendChild(panel);

    // Wire add button
    const addBtn = panel.querySelector('.cg-expand-add') as HTMLButtonElement;
    addBtn.addEventListener('click', e => {
        e.stopPropagation();
        handleAddToggle(entry, addBtn);
    });

    // Wire design link
    const designLink = panel.querySelector('.cg-expand-design-link') as HTMLButtonElement;
    designLink.addEventListener('click', e => {
        e.stopPropagation();
        // Dispatch a custom event that mode-switcher can listen for
        cardEl.dispatchEvent(new CustomEvent('card-open-design', { bubbles: true, detail: { id: entry.id } }));
    });

    // Update add button state if already in stream
    if (isInStream(entry.id)) {
        addBtn.classList.add('cg-expand-add-active');
        cardEl.classList.add('cg-card-in-stream');
    }

    // Phase 2: async-load full bundle for enriched substance list
    void loadAndEnrich(entry.id, panel);

    // Outside click handler (deferred to avoid immediate trigger)
    setTimeout(() => {
        _outsideClickHandler = (e: MouseEvent) => {
            if (!cardEl.contains(e.target as Node)) {
                collapseExpandedCard();
            }
        };
        document.addEventListener('click', _outsideClickHandler, true);
    }, 50);
}

/** Collapse any expanded card. */
export function collapseExpandedCard(): void {
    if (_expandedCardEl) {
        _expandedCardEl.classList.remove('cg-card-expanded');
        const panel = _expandedCardEl.querySelector('.cg-card-expand-panel');
        if (panel) panel.remove();
        _expandedCardEl = null;
    }
    _expandedCycleId = null;

    if (_outsideClickHandler) {
        document.removeEventListener('click', _outsideClickHandler, true);
        _outsideClickHandler = null;
    }
}

/** Check if a card is currently expanded. */
export function isCardExpanded(cycleId: string): boolean {
    return _expandedCycleId === cycleId;
}

// ── Add/Remove toggle ──────────────────────────────────────────────

async function handleAddToggle(entry: SavedCycleIndexEntry, btn: HTMLButtonElement): Promise<void> {
    const inStream = isInStream(entry.id);

    if (inStream) {
        // Remove from stream
        removeFromStream(entry.id);
        btn.innerHTML = plusSvg();
        btn.classList.remove('cg-expand-add-active');
        _expandedCardEl?.classList.remove('cg-card-in-stream');
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
            _expandedCardEl?.classList.add('cg-card-in-stream');

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
    if (!substancesEl) return;

    try {
        const bundle = await loadCycleBundle(cycleId);
        if (!bundle || _expandedCycleId !== cycleId) return; // card was closed

        const ivPayload =
            (bundle.stages as any)?.['intervention-model']?.payload ||
            (bundle.stages as any)?.['extended-intervention']?.payload;
        const ivList: any[] = ivPayload?.interventions || [];

        if (ivList.length > 0) {
            substancesEl.innerHTML = buildSubstanceListHtml(ivList);
        }
    } catch {
        // Keep the class-level view
    }
}

// ── HTML builders ──────────────────────────────────────────────────

function buildSubstanceClassesHtml(classes: string[]): string {
    if (classes.length === 0) return '<span class="cg-expand-loading">Loading substances...</span>';
    return classes
        .map(cls => {
            const palette = getClassHeroColor(cls);
            return `<span class="cg-expand-class-badge" style="--badge-color:${palette}">
                <span class="cg-expand-class-dot" style="background:${palette}"></span>${escHtml(cls)}
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
                <span class="cg-expand-substance-name">${escHtml(name)}</span>
                ${dose ? `<span class="cg-expand-substance-dose">${escHtml(dose)}</span>` : ''}
            </span>`,
        );
    }
    return items.join('');
}

function buildEffectsHtml(effects: string[]): string {
    return effects
        .slice(0, 4)
        .map(e => `<span class="cg-expand-effect-tag">${escHtml(e)}</span>`)
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
            return `<img class="cg-expand-device-icon" src="${src}" data-src-dark="${dev.iconDark}" data-src-light="${dev.iconLight}" alt="${escHtml(dev.name)}" title="${escHtml(dev.name)}" width="20" height="20" />`;
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

function escHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plusSvg(): string {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}

function checkSvg(): string {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}
