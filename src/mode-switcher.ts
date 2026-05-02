/**
 * Mode Switcher — Stream / Design tab system.
 *
 * Renders centered text tabs between the logo and prompt form.
 * "Stream" morphs the prompt into a protocol search field with an inline
 * Netflix-style browse page (titled horizontal-scroll sections).
 * "Design" preserves the full LLM pipeline experience.
 *
 * Exports: initModeSwitcher, getCurrentMode, setMode
 * Depends on: cycle-store, cycle-icon, settings-store, biometric-devices
 */

import {
    getCycleIndex,
    getCycleCount,
    loadCycleBundle,
    setLoadedCycleId,
    setLoadedCyclePrompt,
    getLoadedCycleId,
    clearLoadedCycleId,
    patchCycle,
    deleteCycle,
} from './cycle-store';
import type { SavedCycleIndexEntry } from './cycle-store';
import { generateCycleIconFromBundle, generateWideIconFromBundle } from './cycle-icon';
import { LLMCache } from './llm-cache';
import { settingsStore, sessionSettingsStore, STORAGE_KEYS } from './settings-store';
import { BIOMETRIC_DEVICES } from './biometric-devices';
import { BADGE_CATEGORIES, BADGE_CATEGORY_CSS, type BadgeCategory } from './constants';
import { getCustomSections, saveCustomSection, patchCustomSection, deleteCustomSection } from './custom-sections-store';
import {
    getBuiltinForceInclude,
    getBuiltinForceExclude,
    getBuiltinCardOrder,
    setBuiltinCardOrder,
    updateBuiltinForceLists,
    isBuiltinOverridesReady,
    getBuiltinTitleOverride,
    getBuiltinEffectOverride,
    getBuiltinNegativeTagOverride,
    setBuiltinTitleOverride,
    setBuiltinSectionOverrides,
} from './builtin-overrides-store';
import { mountMyStream, refreshMyStream, teardownMyStream } from './my-stream';
import { expandCard, collapseExpandedCard } from './card-expander';
import { isInStream } from './my-stream-store';
import type { CustomSectionEntry } from './custom-sections-store';
import { SUBSTANCE_DB } from './substances';
import { escapeHtml, clamp } from './utils';

// ── Types ──────────────────────────────────────────────────────────────

export type AppMode = 'stream' | 'design';

// ── Section Definitions ────────────────────────────────────────────────

const SECTION_DEFINITIONS: { key: string; title: string; effects: string[] }[] = [
    {
        key: 'recent',
        title: 'Recently Saved',
        effects: [], // special: top 6 by savedAt
    },
    {
        key: 'focus',
        title: 'Focus & Cognition',
        effects: [
            'Focus',
            'Executive Function',
            'Alertness',
            'Attention',
            'Dopaminergic',
            'Wakefulness',
            'Creativity',
            'Neuroplasticity',
            'Resilience',
            'Clarity',
            'Sensory',
            'Sensory Processing',
            'Visual Perception',
            'Immersion',
            'Psychedelic Immersion',
            'Psychedelic Experience',
        ],
    },
    {
        key: 'sleep',
        title: 'Sleep & Recovery',
        effects: [
            'Sleep',
            'REM Sleep',
            'Sleep Architecture',
            'Sleep Onset',
            'Sleep Pressure',
            'Sleep Quality',
            'Circadian Phase',
            'Circadian Rhythm',
            'Continuity',
            'Deep-Sleep',
            'Sleep Duration',
            'Sleep Onset Latency',
        ],
    },
    {
        key: 'metabolic',
        title: 'Metabolic & Nutrition',
        effects: [
            'Glucose',
            'Glycogen Storage',
            'Insulin Sensitivity',
            'Metabolism',
            'Gastric Emptying',
            'Appetite',
            'Appetite Suppression',
            'Energy Expenditure',
            'Energy Metabolism',
            'Ketogenesis',
            'Lipolysis',
            'Glycemia',
            'Satiety',
            'B12 Status',
            'Glucose Stability',
            'Nausea',
        ],
    },
    {
        key: 'mood',
        title: 'Mood & Stress',
        effects: [
            'Stress',
            'Mood Stability',
            'Mood Regulation',
            'Craving',
            'Withdrawal',
            'Nausea',
            'Anxiety',
            'Calm',
            'Relaxation',
            'De-arousal',
            'Presence',
            'Cortisol',
        ],
    },
    {
        key: 'hormonal',
        title: 'Hormonal & Thermal',
        effects: [
            'Estrogen Balance',
            'Vasomotor Stability',
            'Thermoregulation',
            'Cortisol',
            'Androgenicity',
            'Testosterone',
            'Hormonal',
            'Rhythm',
        ],
    },
    {
        key: 'habit',
        title: 'Habit Breaking',
        effects: [
            'Craving',
            'Cravings',
            'Withdrawal',
            'Addiction',
            'Dependence',
            'Nicotine Craving',
            'Headache',
            'Alcohol',
            'Caffeine',
            'Tolerance',
        ],
    },
];

// ── State ──────────────────────────────────────────────────────────────

let _mode: AppMode = 'design';
let _gridEl: HTMLElement | null = null;
let _searchDebounce: number | null = null;
let _editMode = false;

// SVG icons for submit button
const ARROW_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
</svg>`;

const SEARCH_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
</svg>`;

// ── Init ───────────────────────────────────────────────────────────────

export function initModeSwitcher(): void {
    _gridEl = document.getElementById('stream-grid');

    // Read persisted mode (hash > localStorage > default)
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (hash === 'stream' || hash === 'design') {
        _mode = hash;
    } else {
        const stored = settingsStore.getString(STORAGE_KEYS.appMode);
        if (stored === 'stream' || stored === 'design') {
            _mode = stored;
        }
    }

    // Create tabs DOM
    const container = document.querySelector('.prompt-container');
    if (!container) return;
    const logo = container.querySelector('.logo-text');
    if (!logo) return;

    const tabsEl = document.createElement('div');
    tabsEl.className = 'mode-tabs';
    tabsEl.innerHTML = `
        <button class="mode-tab" data-mode="stream">Stream</button>
        <button class="mode-tab" data-mode="design">Studio</button>
        <span class="mode-tab-indicator"></span>
    `;
    logo.insertAdjacentElement('afterend', tabsEl);

    // Tab click handler
    tabsEl.addEventListener('click', (e: Event) => {
        const btn = (e.target as HTMLElement).closest('.mode-tab') as HTMLElement | null;
        if (!btn) return;
        const mode = btn.dataset.mode as AppMode;
        if (mode && mode !== _mode) {
            setMode(mode);
        }
    });

    // Logo click: reset to fresh state (no loaded cycle, no phases)
    (logo as HTMLElement).style.cursor = 'pointer';
    logo.addEventListener('click', () => {
        clearLoadedCycleId();
        LLMCache.clearAll();
        window.location.hash = '';
        window.location.reload();
    });

    // Hash change listener
    window.addEventListener('hashchange', () => {
        const h = window.location.hash.replace('#', '').toLowerCase();
        if ((h === 'stream' || h === 'design') && h !== _mode) {
            setMode(h);
        }
    });

    // Persistent card click handler on grid
    if (_gridEl) {
        _gridEl.addEventListener('click', handleCardClick);

        // Handle "Open in Studio" from expanded cards
        _gridEl.addEventListener('card-open-design', ((e: CustomEvent) => {
            const id = e.detail?.id;
            if (id) {
                collapseExpandedCard();
                void handleStreamLoad(id);
            }
        }) as EventListener);

        // Drag & drop between sections (edit mode only — handlers gate on _editMode)
        _gridEl.addEventListener('dragstart', handleCardDragStart);
        _gridEl.addEventListener('dragend', handleCardDragEnd);
        _gridEl.addEventListener('dragover', handleSectionDragOver);
        _gridEl.addEventListener('dragleave', handleSectionDragLeave);
        _gridEl.addEventListener('drop', handleSectionDrop);
    }

    // Stream edit-mode toggle (3-dot button)
    const editBtn = document.getElementById('stream-edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', toggleEditMode);
    }

    // Apply initial mode
    applyMode(_mode);

    // Cycle store is async — re-render stream content once data arrives
    if (_mode === 'stream') {
        const retryRender = () => {
            if (getCycleCount() > 0 && isBuiltinOverridesReady()) {
                updateStreamHint();
                renderStreamContent('');
                // Reveal with stagger on async load
                const gridContainer = document.querySelector('.stream-grid-container') as HTMLElement | null;
                gridContainer?.classList.add('stream-visible');
                staggerSections();
            } else {
                setTimeout(retryRender, 200);
            }
        };
        setTimeout(retryRender, 100);
    }
}

// ── Public API ─────────────────────────────────────────────────────────

export function getCurrentMode(): AppMode {
    return _mode;
}

export function refreshStreamCardPresentation(): void {
    if (_mode !== 'stream' || !_gridEl) return;

    const activeId = getLoadedCycleId();
    const indexById = new Map(getCycleIndex().map(entry => [entry.id, entry]));
    const cards = Array.from(_gridEl.querySelectorAll<HTMLElement>('.cg-card[data-cycle-id]'));

    for (const card of cards) {
        const id = card.dataset.cycleId;
        if (!id) continue;
        const entry = indexById.get(id);
        if (!entry) continue;
        card.insertAdjacentHTML('afterend', buildCardHtml(entry, activeId));
        const nextCard = card.nextElementSibling as HTMLElement | null;
        card.remove();

        if (nextCard?.classList.contains('cg-card')) {
            nextCard.style.opacity = '1';
            nextCard.style.transform = 'none';
            nextCard.classList.remove('card-enter');
        }
    }
}

export function setMode(mode: AppMode): void {
    if (mode === _mode) return;
    _mode = mode;
    settingsStore.setString(STORAGE_KEYS.appMode, mode);
    window.history.replaceState(null, '', `#${mode}`);
    applyMode(mode, true);
    window.dispatchEvent(new CustomEvent('lx-studio:app-mode-changed', { detail: { mode } }));
}

// ── Apply Mode ─────────────────────────────────────────────────────────

const PILL_SLIDE_MS = 280;
const STREAM_REVEAL_DELAY = 60;
const CARD_STAGGER_MS = 35;
const SECTION_STAGGER_MS = 100;

function applyMode(mode: AppMode, animated = false): void {
    // Step 1: Slide the pill indicator immediately
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(tab => {
        const t = tab as HTMLElement;
        t.classList.toggle('active', t.dataset.mode === mode);
    });
    updateIndicator();

    const gridContainer = document.querySelector('.stream-grid-container') as HTMLElement | null;

    // Step 2: Morph prompt form
    const morphPrompt = () => {
        const input = document.getElementById('prompt-input') as HTMLInputElement | null;
        const submitBtn = document.getElementById('prompt-submit');
        const hint = document.getElementById('prompt-hint');
        const hintExample = document.getElementById('hint-example');

        if (input) {
            input.value = '';
            if (mode === 'stream') {
                input.placeholder = 'Search protocols...';
                input.addEventListener('input', handleStreamSearch);
            } else {
                input.placeholder = 'Describe your desired outcome...';
                input.removeEventListener('input', handleStreamSearch);
            }
        }

        if (submitBtn) {
            submitBtn.innerHTML = mode === 'stream' ? SEARCH_SVG : ARROW_SVG;
        }

        if (mode === 'stream') {
            updateStreamHint();
        } else if (hint && hintExample) {
            hint.style.opacity = '1';
            hintExample.textContent = 'e.g. "4 hours of deep focus, no sleep quality impact"';
            hintExample.setAttribute('href', '#');
            hintExample.style.cursor = '';
        }
    };

    // Step 3: Swap mode — orchestrate exit/enter transitions
    const swapContent = () => {
        if (mode === 'stream') {
            document.body.classList.add('mode-stream');
            document.body.classList.remove('mode-design');

            // Clear stale state left by the Design pipeline / compile-animation
            const ps = document.getElementById('prompt-section');
            if (ps) {
                ps.style.opacity = '';
                ps.style.transition = '';
                ps.classList.remove('phase-top');
                ps.classList.add('phase-centered');
            }
            const promptForm = document.getElementById('prompt-form');
            if (promptForm) promptForm.classList.remove('prompt-loaded');
            const promptInput = document.getElementById('prompt-input') as HTMLInputElement | null;
            if (promptInput) promptInput.readOnly = false;
            const submitBtn = document.getElementById('prompt-submit') as HTMLButtonElement | null;
            if (submitBtn) submitBtn.disabled = false;

            morphPrompt();
            renderStreamContent('');
            ensureMyStreamMounted();

            if (animated) {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        gridContainer?.classList.add('stream-visible');
                        staggerSections();
                    }, STREAM_REVEAL_DELAY);
                });
            } else {
                gridContainer?.classList.add('stream-visible');
                // Immediately reveal all sections and cards
                gridContainer?.querySelectorAll('.stream-section').forEach(s => s.classList.add('section-enter'));
                gridContainer?.querySelectorAll('.cg-card').forEach(c => c.classList.add('card-enter'));
            }
        } else {
            // Leaving Stream → Design — exit edit mode if active
            if (_editMode) toggleEditMode();

            const restoreDesignState = () => {
                document.body.classList.remove('mode-stream');
                document.body.classList.add('mode-design');
                morphPrompt();
                // Restore loaded-cycle prompt state if a cycle is active
                const loadedId = getLoadedCycleId();
                if (loadedId) {
                    const idx = getCycleIndex();
                    const entry = idx.find(e => e.id === loadedId);
                    const psEl = document.getElementById('prompt-section');
                    const formEl = document.getElementById('prompt-form');
                    const inputEl = document.getElementById('prompt-input') as HTMLInputElement | null;
                    if (psEl) {
                        psEl.classList.remove('phase-centered');
                        psEl.classList.add('phase-top');
                    }
                    if (formEl) formEl.classList.add('prompt-loaded');
                    if (inputEl && entry) {
                        inputEl.readOnly = true;
                        inputEl.value = entry.prompt;
                    }
                }
            };

            if (animated && gridContainer) {
                gridContainer.classList.add('stream-exiting');
                gridContainer.classList.remove('stream-visible');

                gridContainer.querySelectorAll('.stream-section').forEach(s => s.classList.remove('section-enter'));
                gridContainer.querySelectorAll('.cg-card').forEach(c => c.classList.remove('card-enter'));

                setTimeout(() => {
                    gridContainer.classList.remove('stream-exiting');
                    restoreDesignState();
                }, 280);
            } else {
                gridContainer?.classList.remove('stream-visible', 'stream-exiting');
                gridContainer?.querySelectorAll('.stream-section').forEach(s => s.classList.remove('section-enter'));
                gridContainer?.querySelectorAll('.cg-card').forEach(c => c.classList.remove('card-enter'));
                restoreDesignState();
            }
        }
    };

    if (animated) {
        setTimeout(swapContent, PILL_SLIDE_MS);
    } else {
        swapContent();
    }
}

// ── Animation ──────────────────────────────────────────────────────────

/** Force-restart CSS animation on an element (works around HMR duplicate stylesheets). */
function restartAnimation(el: HTMLElement): void {
    el.style.animation = 'none';
    void el.offsetHeight; // force reflow
    el.style.animation = '';
}

/** Stagger-reveal sections top-to-bottom, cards left-to-right within each. */
function staggerSections(): void {
    const sections = document.querySelectorAll('.stream-grid .stream-section');
    sections.forEach((section, sIdx) => {
        setTimeout(() => {
            section.classList.add('section-enter');
            restartAnimation(section as HTMLElement);
            const cards = section.querySelectorAll('.cg-card');
            cards.forEach((card, cIdx) => {
                setTimeout(() => {
                    card.classList.add('card-enter');
                    restartAnimation(card as HTMLElement);
                }, cIdx * CARD_STAGGER_MS);
            });
        }, sIdx * SECTION_STAGGER_MS);
    });
}

/** Stagger-reveal cards in flat grid (search mode). */
function staggerCards(): void {
    const cards = document.querySelectorAll('.stream-grid .cg-card');
    cards.forEach((card, i) => {
        setTimeout(() => {
            card.classList.add('card-enter');
            restartAnimation(card as HTMLElement);
        }, i * CARD_STAGGER_MS);
    });
}

function updateStreamHint(): void {
    const hint = document.getElementById('prompt-hint');
    const hintExample = document.getElementById('hint-example');
    if (!hint || !hintExample) return;
    const count = getCycleCount();
    hint.style.opacity = '1';
    hintExample.textContent =
        count > 0
            ? `Browse ${count} protocol${count !== 1 ? 's' : ''} by effect, substance, or goal`
            : 'No protocols saved yet - switch to Studio to create your first';
    hintExample.removeAttribute('href');
    hintExample.style.cursor = 'default';
}

// ── Tab Indicator Slide ────────────────────────────────────────────────

function updateIndicator(): void {
    const indicator = document.querySelector('.mode-tab-indicator') as HTMLElement | null;
    const activeTab = document.querySelector('.mode-tab.active') as HTMLElement | null;
    if (!indicator || !activeTab) return;

    const tabsContainer = activeTab.parentElement;
    if (!tabsContainer) return;

    const containerRect = tabsContainer.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();

    indicator.style.width = `${tabRect.width}px`;
    indicator.style.transform = `translateX(${tabRect.left - containerRect.left}px)`;
}

// ── Shared Helpers ─────────────────────────────────────────────────────

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

const _deviceMap = new Map(BIOMETRIC_DEVICES.devices.map(d => [d.key, d]));
const _isLight = () => document.body.classList.contains('light-mode');

function renderDeviceIcons(devices: string[] | undefined): string {
    if (!devices || devices.length === 0) return '';
    const light = _isLight();
    const icons = devices
        .map(key => {
            const dev = _deviceMap.get(key);
            if (!dev) return '';
            const src = light ? dev.iconLight : dev.iconDark;
            return `<img class="cg-card-device-icon" src="${src}" data-src-dark="${dev.iconDark}" data-src-light="${dev.iconLight}" alt="${escapeHtml(dev.name)}" title="${escapeHtml(dev.name)}" width="20" height="20" />`;
        })
        .filter(Boolean)
        .join('');
    return icons ? `<div class="cg-card-devices">${icons}</div>` : '';
}

// ── Badge System ───────────────────────────────────────────────────────

interface BadgeInfo {
    label: string;
    cssClass: string;
}

interface BadgePalette {
    bgHex: string;
    bgAlpha: number;
    borderHex: string;
    borderAlpha: number;
    textHex: string;
}

type TitleColorFamily =
    | 'neuro'
    | 'sleep'
    | 'metabolic'
    | 'cardio'
    | 'mood'
    | 'hormonal'
    | 'recovery'
    | 'immune'
    | 'pain'
    | 'performance'
    | 'longevity'
    | 'gut'
    | 'beauty'
    | 'addiction'
    | 'fallback';

const BADGE_EFFECT_MAP: { label: string; cssClass: string; effects: string[] }[] = [
    {
        label: 'NEURO',
        cssClass: 'badge-neuro',
        effects: ['Focus', 'Executive Function', 'Alertness', 'Attention', 'Dopaminergic', 'Wakefulness'],
    },
    {
        label: 'SLEEP',
        cssClass: 'badge-sleep',
        effects: [
            'Sleep',
            'REM Sleep',
            'Sleep Architecture',
            'Sleep Onset',
            'Sleep Pressure',
            'Sleep Quality',
            'Circadian Phase',
            'Circadian Rhythm',
        ],
    },
    {
        label: 'METABOLIC',
        cssClass: 'badge-metabolic',
        effects: [
            'Glucose',
            'Glycogen Storage',
            'Insulin Sensitivity',
            'Metabolism',
            'Energy Expenditure',
            'Energy Metabolism',
            'Appetite',
            'Appetite Suppression',
            'Gastric Emptying',
        ],
    },
    {
        label: 'CARDIO',
        cssClass: 'badge-cardio',
        effects: ['Blood Pressure', 'Heart Rate', 'Circulation', 'Vascular Tone', 'Coagulation'],
    },
    {
        label: 'MOOD',
        cssClass: 'badge-mood',
        effects: ['Stress', 'Mood Stability', 'Mood Regulation', 'Craving', 'Withdrawal', 'Nausea'],
    },
    {
        label: 'HORMONAL',
        cssClass: 'badge-hormonal',
        effects: ['Estrogen Balance', 'Vasomotor Stability', 'Thermoregulation'],
    },
    {
        label: 'RECOVERY',
        cssClass: 'badge-recovery',
        effects: ['Recovery', 'Repair', 'Regeneration'],
    },
    {
        label: 'IMMUNE',
        cssClass: 'badge-immune',
        effects: ['Inflammation', 'Immune', 'Cytokine'],
    },
    {
        label: 'PAIN',
        cssClass: 'badge-pain',
        effects: ['Pain', 'Nociception'],
    },
    {
        label: 'PERFORMANCE',
        cssClass: 'badge-performance',
        effects: ['Endurance', 'Strength', 'Power', 'Performance'],
    },
    {
        label: 'LONGEVITY',
        cssClass: 'badge-longevity',
        effects: ['Longevity', 'Aging', 'Senolytic'],
    },
    {
        label: 'GUT',
        cssClass: 'badge-gut',
        effects: ['Gut', 'Digestion', 'Bloating', 'Microbiome'],
    },
    {
        label: 'BEAUTY',
        cssClass: 'badge-beauty',
        effects: ['Skin', 'Hair', 'Collagen'],
    },
    {
        label: 'ADDICTION',
        cssClass: 'badge-addiction',
        effects: ['Addiction', 'Dependence'],
    },
];

const BADGE_PALETTE_MAP: Record<string, BadgePalette> = {
    'badge-new': { bgHex: '#cee9f7', bgAlpha: 0.95, borderHex: '#ecf7ff', borderAlpha: 0.46, textHex: '#5f95bf' },
    'badge-updated': {
        bgHex: '#f1d185',
        bgAlpha: 0.88,
        borderHex: '#f8e2ab',
        borderAlpha: 0.34,
        textHex: '#a87335',
    },
    'badge-popular': {
        bgHex: '#e9c6fc',
        bgAlpha: 0.9,
        borderHex: '#f5e1ff',
        borderAlpha: 0.34,
        textHex: '#a06dc8',
    },
    'badge-targeted': {
        bgHex: '#f7a7e5',
        bgAlpha: 0.95,
        borderHex: '#ffd4f5',
        borderAlpha: 0.42,
        textHex: '#c154a8',
    },
    'badge-neuro': { bgHex: '#161824', bgAlpha: 0.8, borderHex: '#919cdc', borderAlpha: 0.18, textHex: '#8d98d8' },
    'badge-sleep': { bgHex: '#1c1827', bgAlpha: 0.82, borderHex: '#b097de', borderAlpha: 0.18, textHex: '#b29ae2' },
    'badge-cardio': { bgHex: '#271f1a', bgAlpha: 0.82, borderHex: '#be8f5e', borderAlpha: 0.18, textHex: '#c39561' },
    'badge-metabolic': {
        bgHex: '#272318',
        bgAlpha: 0.82,
        borderHex: '#b9b16c',
        borderAlpha: 0.18,
        textHex: '#bcb36b',
    },
    'badge-mood': { bgHex: '#261c23', bgAlpha: 0.82, borderHex: '#ba7bac', borderAlpha: 0.18, textHex: '#bc7fae' },
    'badge-rx': { bgHex: '#3f2a2e', bgAlpha: 0.82, borderHex: '#d2969f', borderAlpha: 0.18, textHex: '#d197a2' },
    'badge-hormonal': {
        bgHex: '#2a1c24',
        bgAlpha: 0.82,
        borderHex: '#c382a0',
        borderAlpha: 0.18,
        textHex: '#c38aa0',
    },
    'badge-recovery': {
        bgHex: '#18261e',
        bgAlpha: 0.82,
        borderHex: '#6eb98c',
        borderAlpha: 0.18,
        textHex: '#6eb98c',
    },
    'badge-immune': { bgHex: '#182226', bgAlpha: 0.82, borderHex: '#64afb9', borderAlpha: 0.18, textHex: '#64afb9' },
    'badge-pain': { bgHex: '#282218', bgAlpha: 0.82, borderHex: '#c8a564', borderAlpha: 0.18, textHex: '#c8a564' },
    'badge-performance': {
        bgHex: '#181e2a',
        bgAlpha: 0.82,
        borderHex: '#6496d2',
        borderAlpha: 0.18,
        textHex: '#6496d2',
    },
    'badge-longevity': {
        bgHex: '#1e2418',
        bgAlpha: 0.82,
        borderHex: '#91b478',
        borderAlpha: 0.18,
        textHex: '#91b478',
    },
    'badge-gut': { bgHex: '#1c2218', bgAlpha: 0.82, borderHex: '#87aa6e', borderAlpha: 0.18, textHex: '#87aa6e' },
    'badge-beauty': { bgHex: '#261c24', bgAlpha: 0.82, borderHex: '#c391af', borderAlpha: 0.18, textHex: '#c391af' },
    'badge-addiction': {
        bgHex: '#281e1c',
        bgAlpha: 0.82,
        borderHex: '#be8c78',
        borderAlpha: 0.18,
        textHex: '#be8c78',
    },
};

/**
 * Loose keyword → badge-class mapping for effect names not explicitly listed in
 * BADGE_EFFECT_MAP. Lets e.g. "Rhythm" / "Anxiety" / "Inflammation" pick up a
 * sensible color family without requiring the LLM to emit canonical effect names.
 */
const EFFECT_KEYWORD_CLASS: { keywords: string[]; cssClass: string }[] = [
    { keywords: ['sleep', 'rem', 'circadian', 'rhythm', 'insomnia'], cssClass: 'badge-sleep' },
    { keywords: ['focus', 'cogniti', 'attention', 'alert', 'executive', 'dopamine', 'wake'], cssClass: 'badge-neuro' },
    {
        keywords: ['mood', 'anxiety', 'stress', 'depress', 'calm', 'craving', 'withdraw', 'nausea'],
        cssClass: 'badge-mood',
    },
    { keywords: ['glucose', 'insulin', 'metabol', 'glycog', 'energy', 'appet'], cssClass: 'badge-metabolic' },
    { keywords: ['inflamm', 'immune', 'cytokine'], cssClass: 'badge-immune' },
    { keywords: ['cardio', 'heart', 'blood pressure', 'circulation'], cssClass: 'badge-cardio' },
    { keywords: ['hormon', 'estrogen', 'testosterone', 'cortisol', 'thermo', 'vasomotor'], cssClass: 'badge-hormonal' },
    { keywords: ['recover', 'repair', 'regener'], cssClass: 'badge-recovery' },
    { keywords: ['pain', 'ache', 'nocicept'], cssClass: 'badge-pain' },
    { keywords: ['longev', 'aging', 'senolyt'], cssClass: 'badge-longevity' },
    { keywords: ['gut', 'digest', 'bloat', 'microbiome'], cssClass: 'badge-gut' },
    { keywords: ['performance', 'endurance', 'strength', 'power'], cssClass: 'badge-performance' },
    { keywords: ['beauty', 'skin', 'hair', 'collagen'], cssClass: 'badge-beauty' },
    { keywords: ['addict'], cssClass: 'badge-addiction' },
];

/**
 * Pick a display color for an effect name by walking BADGE_EFFECT_MAP, then
 * EFFECT_KEYWORD_CLASS, then the LLM-assigned badgeCategory. Falls back to a
 * neutral color. Used to tint the 7D score pills on wide cards.
 */
function getEffectColor(effectName: string, fallbackBadgeCategory?: string | null): string {
    // 1. Exact match in BADGE_EFFECT_MAP
    for (const def of BADGE_EFFECT_MAP) {
        if (def.effects.includes(effectName)) {
            const pal = BADGE_PALETTE_MAP[def.cssClass];
            if (pal) return pal.textHex;
        }
    }
    // 2. Loose keyword match
    const lc = effectName.toLowerCase();
    for (const entry of EFFECT_KEYWORD_CLASS) {
        if (entry.keywords.some(k => lc.includes(k))) {
            const pal = BADGE_PALETTE_MAP[entry.cssClass];
            if (pal) return pal.textHex;
        }
    }
    // 3. Fall back to the LLM-assigned badge category color
    if (fallbackBadgeCategory) {
        const cssClass = BADGE_CATEGORY_CSS[fallbackBadgeCategory as BadgeCategory];
        const pal = cssClass && BADGE_PALETTE_MAP[cssClass];
        if (pal) return pal.textHex;
    }
    return '#94a3b8';
}

function computeBadges(entry: SavedCycleIndexEntry): BadgeInfo[] {
    // 1. Prefer LLM-assigned badge category (new cycles)
    const cat = entry.badgeCategory?.toUpperCase() as BadgeCategory | undefined;
    if (cat && (BADGE_CATEGORIES as readonly string[]).includes(cat)) {
        return [{ label: cat, cssClass: BADGE_CATEGORY_CSS[cat] }];
    }

    // 2. Legacy fallback: exact effect matching (old saved cycles without badgeCategory)
    const effects = new Set(entry.topEffects || []);
    for (const def of BADGE_EFFECT_MAP) {
        if (def.effects.some(e => effects.has(e))) {
            return [{ label: def.label, cssClass: def.cssClass }];
        }
    }

    return [];
}

/**
 * Pick an editorial title color from the thumbnail artwork itself.
 * We prefer the most visually prominent AUC band in the saved icon SVG,
 * with a small bonus when the hero line reinforces the same hue family.
 * If an icon is missing or unparsable, fall back to a muted semantic palette.
 */
const TITLE_COLOR_PALETTE: Record<TitleColorFamily, string> = {
    neuro: 'rgb(137, 162, 191)',
    sleep: 'rgb(175, 152, 198)',
    metabolic: 'rgb(153, 151, 103)',
    cardio: 'rgb(187, 138, 146)',
    mood: 'rgb(158, 133, 160)',
    hormonal: 'rgb(195, 142, 158)',
    recovery: 'rgb(126, 185, 155)',
    immune: 'rgb(120, 172, 180)',
    pain: 'rgb(195, 163, 112)',
    performance: 'rgb(120, 155, 200)',
    longevity: 'rgb(160, 180, 140)',
    gut: 'rgb(150, 170, 130)',
    beauty: 'rgb(190, 155, 175)',
    addiction: 'rgb(180, 140, 130)',
    fallback: 'rgb(219, 225, 235)',
};

const TITLE_COLOR_PRECEDENCE: { labels: string[]; family: TitleColorFamily }[] = [
    { labels: ['NEURO'], family: 'neuro' },
    { labels: ['SLEEP'], family: 'sleep' },
    { labels: ['METABOLIC'], family: 'metabolic' },
    { labels: ['CARDIO'], family: 'cardio' },
    { labels: ['MOOD'], family: 'mood' },
    { labels: ['HORMONAL'], family: 'hormonal' },
    { labels: ['RECOVERY'], family: 'recovery' },
    { labels: ['IMMUNE'], family: 'immune' },
    { labels: ['PAIN'], family: 'pain' },
    { labels: ['PERFORMANCE'], family: 'performance' },
    { labels: ['LONGEVITY'], family: 'longevity' },
    { labels: ['GUT'], family: 'gut' },
    { labels: ['BEAUTY'], family: 'beauty' },
    { labels: ['ADDICTION'], family: 'addiction' },
];

interface PathBBox {
    minY: number;
    maxY: number;
    area: number;
}

interface EditorialTitleTone {
    hue: number;
    saturation: number;
    lightness: number;
}

const EDITORIAL_TITLE_TONES = {
    moss: { hue: 138, saturation: 34, lightness: 77 },
    aqua: { hue: 186, saturation: 36, lightness: 78 },
    blue: { hue: 214, saturation: 46, lightness: 78 },
    lilac: { hue: 284, saturation: 38, lightness: 77 },
    rose: { hue: 344, saturation: 43, lightness: 76 },
    sand: { hue: 40, saturation: 48, lightness: 77 },
} as const satisfies Record<string, EditorialTitleTone>;

/**
 * Darken + saturate a color for light-mode readability. Parses #rrggbb / rgb()
 * and converts through HSL. Returns a dark, vivid version preserving hue.
 */
function darkenForLightMode(color: string): string {
    // Parse to HSL. Accepts hsl(), rgb(), #rrggbb
    let h = 0;
    let s = 0;
    const hslMatch = color.match(/hsl\(\s*([\d.]+)\s*(?:deg)?\s*[,\s]\s*([\d.]+)\s*%?\s*[,\s]\s*([\d.]+)\s*%?\s*\)/i);
    if (hslMatch) {
        h = Number(hslMatch[1]);
        s = Number(hslMatch[2]) / 100;
    } else {
        // Parse rgb(r, g, b) or #rrggbb → RGB → HSL
        let r: number, g: number, b: number;
        const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch) {
            r = Number(rgbMatch[1]);
            g = Number(rgbMatch[2]);
            b = Number(rgbMatch[3]);
        } else {
            const hexMatch = color.match(/^#?([0-9a-fA-F]{6})$/);
            if (hexMatch) {
                const hx = hexMatch[1];
                r = parseInt(hx.slice(0, 2), 16);
                g = parseInt(hx.slice(2, 4), 16);
                b = parseInt(hx.slice(4, 6), 16);
            } else {
                return color;
            }
        }
        const rn = r / 255,
            gn = g / 255,
            bn = b / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case rn:
                    h = (gn - bn) / d + (gn < bn ? 6 : 0);
                    break;
                case gn:
                    h = (bn - rn) / d + 2;
                    break;
                case bn:
                    h = (rn - gn) / d + 4;
                    break;
            }
            h *= 60;
        }
    }
    // Target: vivid and readable on light bg
    const newS = Math.min(100, Math.max(55, s * 100 + 30));
    const newL = 28;
    // HSL → RGB
    const c = (1 - Math.abs((2 * newL) / 100 - 1)) * (newS / 100);
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0,
        g1 = 0,
        b1 = 0;
    if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
    else if (hp < 2) [r1, g1, b1] = [x, c, 0];
    else if (hp < 3) [r1, g1, b1] = [0, c, x];
    else if (hp < 4) [r1, g1, b1] = [0, x, c];
    else if (hp < 5) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const m = newL / 100 - c / 2;
    const rf = Math.round((r1 + m) * 255);
    const gf = Math.round((g1 + m) * 255);
    const bf = Math.round((b1 + m) * 255);
    return `rgb(${rf}, ${gf}, ${bf})`;
}

function isLightModeActive(): boolean {
    return typeof document !== 'undefined' && document.body.classList.contains('light-mode');
}

function getTitleColor(entry: SavedCycleIndexEntry): string {
    const prominentBand = getProminentBandTitleColor(entry.iconSvg);
    const base = prominentBand ?? getSemanticTitleColor(entry);
    return isLightModeActive() ? darkenForLightMode(base) : base;
}

function getSemanticTitleColor(entry: SavedCycleIndexEntry): string {
    // Prefer LLM-assigned badge category
    if (entry.badgeCategory) {
        const family = entry.badgeCategory.toLowerCase() as TitleColorFamily;
        if (family in TITLE_COLOR_PALETTE) return TITLE_COLOR_PALETTE[family];
    }

    // Legacy fallback: effect-based lookup
    const effects = new Set(entry.topEffects || []);
    for (const candidate of TITLE_COLOR_PRECEDENCE) {
        const hasMatch = BADGE_EFFECT_MAP.some(
            def => candidate.labels.includes(def.label) && def.effects.some(effect => effects.has(effect)),
        );
        if (hasMatch) return TITLE_COLOR_PALETTE[candidate.family];
    }

    return TITLE_COLOR_PALETTE.fallback;
}

function getProminentBandTitleColor(iconSvg: string | undefined | null): string | null {
    if (!iconSvg) return null;

    const heroLineHues = extractHeroLineHues(iconSvg);
    const bandRegex = /<path[^>]*d="([^"]+)"[^>]*fill="(#[0-9a-fA-F]{6})"[^>]*opacity="0\.45"/g;

    let bestHex: string | null = null;
    let bestScore = -Infinity;
    for (const match of iconSvg.matchAll(bandRegex)) {
        const [, d, fillHex] = match;
        const bbox = getPathBBox(d);
        if (!bbox) continue;

        const { s, h } = hexToHsl(fillHex);
        if (s < 0.14) continue;

        const titleOverlap = getRangeOverlap(bbox.minY, bbox.maxY, 28, 74);
        const overlapRatio = titleOverlap / Math.max(1, bbox.maxY - bbox.minY);
        const hasHeroReinforcement = heroLineHues.some(lineHue => hueDistance(h, lineHue) <= 26);

        let score = bbox.area;
        score *= 0.88 + overlapRatio * 0.34;
        if (hasHeroReinforcement) score += 3200;

        if (score > bestScore) {
            bestScore = score;
            bestHex = fillHex;
        }
    }

    return bestHex ? muteTitleHex(bestHex) : null;
}

function extractHeroLineHues(iconSvg: string): number[] {
    const hues: number[] = [];
    const lineRegex = /<path[^>]*stroke="(#[0-9a-fA-F]{6})"[^>]*stroke-width="1\.6"/g;

    for (const match of iconSvg.matchAll(lineRegex)) {
        const hex = match[1];
        hues.push(hexToHsl(hex).h);
    }

    return hues;
}

function getPathBBox(d: string): PathBBox | null {
    const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
    if (nums.length < 4) return null;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
        xs.push(nums[i]);
        ys.push(nums[i + 1]);
    }
    if (xs.length === 0 || ys.length === 0) return null;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
        minY,
        maxY,
        area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
    };
}

function getRangeOverlap(minA: number, maxA: number, minB: number, maxB: number): number {
    return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function hueDistance(a: number, b: number): number {
    const diff = Math.abs(a - b);
    return Math.min(diff, 360 - diff);
}

function muteTitleHex(hex: string): string {
    const intensity = clamp(settingsStore.getNumber(STORAGE_KEYS.streamTitleColorIntensity, 50), 0, 100);
    const t = (intensity - 50) / 50;
    const { h, s, l } = hexToHsl(hex);
    const tone = getEditorialTitleTone(h);
    const sourceLift = clamp01((s - 0.16) / 0.68);
    const toneHue = mixHue(tone.hue, h, 0.26 + sourceLift * 0.16);
    const toneS = tone.saturation / 100;
    const toneL = tone.lightness / 100;
    const softenedSourceInfluence = sourceLift * 0.14;
    const mutedS = clamp01(
        clamp(toneS * (1 + t * 0.36) + softenedSourceInfluence, toneS * 0.78 + t * 0.04, toneS * 1.36 + t * 0.06),
    );
    const mutedL = clamp01(clamp(toneL + t * 0.04 + (l - 0.5) * 0.03, toneL - 0.03, toneL + 0.06));
    return `hsl(${Math.round(toneHue)}deg ${Math.round(mutedS * 100)}% ${Math.round(mutedL * 100)}%)`;
}

function getEditorialTitleTone(hue: number): EditorialTitleTone {
    if (hue >= 72 && hue < 155) return EDITORIAL_TITLE_TONES.moss;
    if (hue >= 155 && hue < 195) return EDITORIAL_TITLE_TONES.aqua;
    if (hue >= 195 && hue < 250) return EDITORIAL_TITLE_TONES.blue;
    if (hue >= 250 && hue < 310) return EDITORIAL_TITLE_TONES.lilac;
    if (hue >= 310 || hue < 18) return EDITORIAL_TITLE_TONES.rose;
    return EDITORIAL_TITLE_TONES.sand;
}

function mixHue(baseHue: number, sourceHue: number, sourceWeight: number): number {
    const delta = ((sourceHue - baseHue + 540) % 360) - 180;
    return (baseHue + delta * sourceWeight + 360) % 360;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16) / 255;
    const g = parseInt(normalized.slice(2, 4), 16) / 255;
    const b = parseInt(normalized.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const delta = max - min;

    if (delta === 0) return { h: 0, s: 0, l };

    const s = delta / (1 - Math.abs(2 * l - 1));
    let h = 0;
    switch (max) {
        case r:
            h = ((g - b) / delta) % 6;
            break;
        case g:
            h = (b - r) / delta + 2;
            break;
        default:
            h = (r - g) / delta + 4;
            break;
    }

    h *= 60;
    if (h < 0) h += 360;

    return { h, s, l };
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function getBadgeInlineStyle(cssClass: string): string {
    const palette = BADGE_PALETTE_MAP[cssClass];
    if (!palette) return '';

    const intensity = clamp(settingsStore.getNumber(STORAGE_KEYS.streamBadgeIntensity, 50), 0, 100);
    const t = (intensity - 50) / 50;
    const bgHex = tuneBadgeHex(palette.bgHex, 1 + t * 0.24, 1 + t * 0.1);
    const borderHex = tuneBadgeHex(palette.borderHex, 1 + t * 0.3, 1 + t * 0.14);
    const textHex = tuneBadgeHex(palette.textHex, 1 + t * 0.34, 1 + t * 0.16);
    const bgAlpha = clamp(palette.bgAlpha + t * 0.16, 0.12, 1);
    const borderAlpha = clamp(palette.borderAlpha + t * 0.14, 0.08, 0.92);

    return `background:${hexToRgba(bgHex, bgAlpha)};border-color:${hexToRgba(borderHex, borderAlpha)};color:${textHex};`;
}

function tuneBadgeHex(hex: string, saturationMultiplier: number, lightnessMultiplier: number): string {
    const { h, s, l } = hexToHsl(hex);
    return hslToHex(h, clamp01(s * saturationMultiplier), clamp01(l * lightnessMultiplier));
}

function hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function hslToHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hPrime = h / 60;
    const x = c * (1 - Math.abs((hPrime % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hPrime >= 0 && hPrime < 1) {
        r1 = c;
        g1 = x;
    } else if (hPrime < 2) {
        r1 = x;
        g1 = c;
    } else if (hPrime < 3) {
        g1 = c;
        b1 = x;
    } else if (hPrime < 4) {
        g1 = x;
        b1 = c;
    } else if (hPrime < 5) {
        r1 = x;
        b1 = c;
    } else {
        r1 = c;
        b1 = x;
    }

    const m = l - c / 2;
    const toHex = (channel: number) =>
        Math.round((channel + m) * 255)
            .toString(16)
            .padStart(2, '0');

    return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function buildBadgesHtml(badges: BadgeInfo[]): string {
    if (badges.length === 0) return '';
    const inlineStyle = getBadgeInlineStyle(badges[0].cssClass);
    const styleAttr = inlineStyle ? ` style="${inlineStyle}"` : '';
    return (
        `<div class="cg-card-badges">` +
        `<span class="cg-card-badge ${badges[0].cssClass}"${styleAttr}>${badges[0].label}</span>` +
        `</div>`
    );
}

/** Shorten a protocol title for the overlay — keep core words, drop filler. */
const FILLER_WORDS = new Set([
    'protocol',
    'plan',
    'program',
    'routine',
    'stack',
    'regimen',
    'management',
    'maintenance',
    'optimization',
    'enhancement',
    'improvement',
    'support',
]);

const LEADING_DISPLAY_WORDS = new Set([
    'maximize',
    'maximise',
    'improve',
    'optimize',
    'optimise',
    'boost',
    'enhance',
    'increase',
]);

const TITLE_REPLACEMENTS: Record<string, string> = {
    cardiovascular: 'Cardio',
};

function shortenTitle(filename: string): string {
    const words = filename
        .split(/[\s\-–—]+/)
        .filter(Boolean)
        .map(word => TITLE_REPLACEMENTS[word.toLowerCase()] ?? word);
    while (words.length > 2 && LEADING_DISPLAY_WORDS.has(words[0].toLowerCase())) {
        words.shift();
    }
    // Drop trailing filler words
    while (words.length > 2 && FILLER_WORDS.has(words[words.length - 1].toLowerCase())) {
        words.pop();
    }
    // Cap at 4 words max
    const short = words.slice(0, 4).join(' ');
    return short.length > 24 ? short.slice(0, 24).trim() : short;
}

function formatOverlayToken(token: string): string {
    if (/^\d+(?:h|hr|hrs|m|min)$/i.test(token)) {
        return token.toLowerCase();
    }
    if (/^[A-Z0-9/+&.-]+$/.test(token)) {
        return token;
    }
    return token.toUpperCase();
}

function formatOverlayTitle(filename: string): string {
    return shortenTitle(filename).split(/\s+/).filter(Boolean).map(formatOverlayToken).join(' ');
}

/** Resolve the overlay title for an entry, honoring a saved per-cycle override. */
function resolveOverlayTitle(entry: { id: string; filename: string; overlayTitle?: string | null }): string {
    const override = entry.overlayTitle;
    if (override && override.trim()) {
        return override.trim().split(/\s+/).filter(Boolean).map(formatOverlayToken).join(' ');
    }
    return formatOverlayTitle(entry.filename);
}

function getOverlayTitleClass(overlayTitle: string): string {
    const normalized = overlayTitle.trim();
    const charCount = normalized.length;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;

    if (charCount <= 12 && wordCount <= 2) return ' title-short';
    if (charCount >= 21 || wordCount >= 4) return ' title-xlong';
    if (wordCount >= 3) return ' title-long';
    return ' title-long';
}

// ── Wide Card Detection ───────────────────────────────────────────────

function isWideCard(entry: SavedCycleIndexEntry): boolean {
    if (!entry.timeHorizon) return false;
    return (
        entry.timeHorizon.mode === 'program' ||
        entry.timeHorizon.mode === 'cyclical' ||
        (entry.timeHorizon.durationDays ?? 1) >= 14
    );
}

/** Format a duration badge label from timeHorizon. */
function durationBadgeLabel(entry: SavedCycleIndexEntry): string {
    const days = entry.timeHorizon?.durationDays ?? 28;
    return `${days} days`;
}

/** Build phase progress bar HTML from protocolPhases stored in the bundle. */
function buildPhaseBarHtml(entry: SavedCycleIndexEntry): string {
    // Phase colors: loading=teal, maintenance=gold, tapering=muted
    const DEFAULT_PHASE_COLORS: Record<string, string> = {
        loading: 'rgba(56, 178, 172, 0.8)',
        ramp: 'rgba(56, 178, 172, 0.8)',
        'ramp-up': 'rgba(56, 178, 172, 0.8)',
        maintenance: 'rgba(188, 151, 82, 0.8)',
        sustain: 'rgba(188, 151, 82, 0.8)',
        tapering: 'rgba(128, 143, 164, 0.6)',
        taper: 'rgba(128, 143, 164, 0.6)',
        'wind-down': 'rgba(128, 143, 164, 0.6)',
    };
    // Without bundle access here, render a generic 3-phase bar
    const totalDays = entry.timeHorizon?.durationDays ?? 28;
    const loadDays = Math.round(totalDays * 0.25);
    const maintDays = Math.round(totalDays * 0.5);
    const taperDays = totalDays - loadDays - maintDays;
    const phases = [
        { days: loadDays, color: DEFAULT_PHASE_COLORS.loading },
        { days: maintDays, color: DEFAULT_PHASE_COLORS.maintenance },
        { days: taperDays, color: DEFAULT_PHASE_COLORS.tapering },
    ];
    const spans = phases.map(p => `<span style="flex:${p.days};background:${p.color}"></span>`).join('');
    return `<div class="cg-card-phase-bar">${spans}</div>`;
}

/**
 * Build the one-line score row rendered immediately under the card thumbnail.
 * For dual-effect cards, the two entries sit on the same line with one on the
 * left and one on the right. For single-effect cards, the single entry is
 * left-aligned. Applies to every card type (wide + 24h).
 */
function buildScoreLineHtml(entry: SavedCycleIndexEntry): string {
    const scores = entry.effectScores;
    if (!scores || scores.length === 0) return '';
    // Prefer curveEffects (Strategist curve names aligned 1:1 with scores) over
    // topEffects (Scout word-cloud category tags used for section matching).
    // Falling back to topEffects keeps the badge working for legacy saves until
    // the lazy migration repairs them.
    const names = entry.curveEffects && entry.curveEffects.length > 0 ? entry.curveEffects : entry.topEffects || [];
    // Always render every score we have up to 2 — never silently drop the second
    // effect because its score happens to be 0 or because names is shorter than
    // effectScores (stale entries from before curveEffects existed).
    const maxShown = Math.min(scores.length, 2);

    const entries: string[] = [];
    for (let i = 0; i < maxShown; i++) {
        const score = scores[i];
        if (!Number.isFinite(score)) continue;
        const name = names[i] || `Effect ${i + 1}`;
        // Prefer the real curve color stored at save time (one per curve).
        // Fall back to keyword-based lookup for legacy entries where
        // curveColors wasn't written. Without this override, curves without
        // an exact BADGE_EFFECT_MAP hit all fall through to the same
        // badge-category color and both scores render identically.
        const savedColor = entry.curveColors && entry.curveColors[i];
        const color =
            savedColor && savedColor.length > 0 ? savedColor : getEffectColor(name, entry.badgeCategory || null);
        // effectScores are always positive (gap-closure magnitude), so the
        // sign has to come from polarity. A higher_is_worse effect (gastric
        // distress, craving intensity, pain, anxiety) that the protocol is
        // *reducing* should read as `−63%`, not `+63%`. Legacy entries
        // without curvePolarities default to `+` — lazyComputeMissingScores
        // backfills the field from the bundle on first render.
        const polarity = entry.curvePolarities && entry.curvePolarities[i];
        const sign = polarity === 'higher_is_worse' ? '−' : '+';
        entries.push(
            `<span class="cg-card-score-entry" style="--score-color:${color}">` +
                `<span class="cg-card-score-entry-value">${sign}${Math.round(score)}%</span>` +
                `<span class="cg-card-score-entry-name">${escapeHtml(name.toUpperCase())}</span>` +
                `</span>`,
        );
    }
    if (entries.length === 0) return '';
    const countClass = entries.length === 1 ? ' cg-card-score-line-single' : ' cg-card-score-line-dual';
    return `<div class="cg-card-score-line${countClass}">${entries.join('')}</div>`;
}

/**
 * Build the confidence badge: flask SVG + score %, positioned inside the
 * card thumbnail as a bottom-left overlay (like the Rx badge is top-right).
 */
function buildConfidenceHtml(entry: SavedCycleIndexEntry): string {
    const score = entry.protocolConfidence;
    if (score == null) return '';
    const tier = score >= 85 ? 'Clinical' : score >= 60 ? 'Research' : score >= 35 ? 'Exploratory' : 'Open Run';
    const tierClass = tier === 'Open Run' ? ' cg-card-confidence-open' : '';
    // Flask fill height: 4 tiers → 25% / 50% / 75% / 100%
    const fillPct = score >= 85 ? 100 : score >= 60 ? 75 : score >= 35 ? 50 : 25;
    const fillY = 20 - (fillPct / 100) * 17;
    const fillH = (fillPct / 100) * 17;
    const flask =
        `<svg class="cg-card-confidence-flask" width="9" height="14" viewBox="0 0 14 20" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        `<defs><clipPath id="cfc${fillPct}"><rect x="0" y="${fillY}" width="14" height="${fillH}"/></clipPath></defs>` +
        `<path d="M5 1h4v5l4 8.5a2 2 0 0 1-1.8 2.8H2.8A2 2 0 0 1 1 14.5L5 6V1z" stroke="currentColor" stroke-width="1.2" fill="none"/>` +
        `<path d="M5 1h4v5l4 8.5a2 2 0 0 1-1.8 2.8H2.8A2 2 0 0 1 1 14.5L5 6V1z" fill="currentColor" opacity="0.45" clip-path="url(#cfc${fillPct})"/>` +
        `</svg>`;
    return (
        `<span class="cg-card-confidence${tierClass}">` +
        flask +
        `<span class="cg-card-confidence-value">${score}%</span>` +
        `<span class="cg-card-confidence-tier">${escapeHtml(tier.toUpperCase())}</span>` +
        `</span>`
    );
}

// ── Card Builder ───────────────────────────────────────────────────────

function buildCardHtml(entry: SavedCycleIndexEntry, activeId: string | null): string {
    const isActive = entry.id === activeId;
    const wide = isWideCard(entry);
    const prompt = entry.prompt ? escapeHtml(entry.prompt.slice(0, 80)) + (entry.prompt.length > 80 ? '...' : '') : '';

    const fallbackW = wide ? 400 : 200;
    const fallbackH = wide ? 175 : 120;
    const iconHtml = entry.iconSvg
        ? wide && !entry.iconSvg.includes('preserveAspectRatio')
            ? entry.iconSvg.replace('<svg ', '<svg preserveAspectRatio="xMidYMin slice" ')
            : entry.iconSvg
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fallbackW} ${fallbackH}">` +
          `<rect class="ci-bg" width="${fallbackW}" height="${fallbackH}" rx="8"/>` +
          `<text class="ci-day" x="${fallbackW / 2}" y="${fallbackH / 2 + 5}" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.12)">${entry.maxEffects}</text>` +
          `</svg>`;

    const badges = computeBadges(entry);
    const badgesHtml = buildBadgesHtml(badges);
    const overlayTitleText = resolveOverlayTitle(entry);
    const overlayTitleClass = getOverlayTitleClass(overlayTitleText);
    const overlayTitle = escapeHtml(overlayTitleText);
    const titleColor = getTitleColor(entry);

    const isRx = entry.rxMode === 'rx' || entry.rxMode === 'rx-only';
    const rxHtml = isRx ? `<span class="cg-card-rx">Rx</span>` : '';
    const cardDeleteHtml = _editMode
        ? `<button class="cg-card-delete-btn" data-delete-id="${escapeHtml(entry.id)}" aria-label="Delete protocol" title="Delete protocol">&times;</button>`
        : '';
    const cardRemoveHtml = _editMode
        ? `<button class="cg-card-remove-btn" data-remove-id="${escapeHtml(entry.id)}" aria-label="Remove from category" title="Remove from category">&minus;</button>`
        : '';

    // Wide card extras
    const durationBadgeHtml = wide
        ? `<span class="cg-card-duration-badge">${escapeHtml(durationBadgeLabel(entry))}</span>`
        : '';
    const phaseBarHtml = wide ? buildPhaseBarHtml(entry) : '';
    // Score line appears immediately under the thumbnail for ALL card types (wide + 24h)
    const scoreLineHtml = buildScoreLineHtml(entry);
    const wideClass = wide ? ' cg-card-wide' : '';

    // All cards drop effect count + date + device icons from the face; those move
    // into the expand panel (which opens on click for both wide and narrow cards).
    const metaStr = wide
        ? `${entry.timeHorizon?.durationDays ?? 28}-day program${isActive ? ' · loaded' : ''}`
        : isActive
          ? 'loaded'
          : '';

    const inStreamClass = isInStream(entry.id) ? ' cg-card-in-stream' : '';

    const draggableAttr = _editMode ? ' draggable="true"' : '';

    return (
        `<div class="cg-card${isActive ? ' cg-card-active' : ''}${wideClass}${inStreamClass}" data-cycle-id="${escapeHtml(entry.id)}"${draggableAttr}>` +
        cardDeleteHtml +
        cardRemoveHtml +
        `<div class="cg-card-icon">` +
        iconHtml +
        badgesHtml +
        durationBadgeHtml +
        `<div class="cg-card-overlay-title${overlayTitleClass}" style="color:${titleColor}">${overlayTitle}</div>` +
        rxHtml +
        buildConfidenceHtml(entry) +
        phaseBarHtml +
        `</div>` +
        scoreLineHtml +
        (prompt ? `<p class="cg-card-prompt">${prompt}</p>` : '') +
        (metaStr ? `<div class="cg-card-meta">${metaStr}</div>` : '') +
        `</div>`
    );
}

// ── Content Orchestrator ───────────────────────────────────────────────

/** Re-render and immediately reveal all sections/cards (no stagger animation). */
function rerenderStreamImmediate(): void {
    // Always use browse mode (sections) — not search mode from the prompt input,
    // which may contain a loaded cycle's prompt text.
    renderStreamContent('');
    const gc = document.querySelector('.stream-grid-container') as HTMLElement | null;
    gc?.querySelectorAll<HTMLElement>('.stream-section').forEach(s => {
        s.style.opacity = '1';
        s.style.transform = 'none';
    });
    gc?.querySelectorAll<HTMLElement>('.cg-card').forEach(c => {
        c.style.opacity = '1';
        c.style.transform = 'none';
    });
}

// ── My Stream mounting ────────────────────────────────────────────────

let _myStreamMounted = false;

function ensureMyStreamMounted(): void {
    const container = document.getElementById('my-stream-container');
    if (!container || _myStreamMounted) {
        if (_myStreamMounted) refreshMyStream();
        return;
    }
    mountMyStream(container);
    _myStreamMounted = true;
}

// ── Content Orchestrator ─────────────────────────────────────────────

function renderStreamContent(filter: string): void {
    if (!_gridEl) return;
    const query = filter.trim();
    if (query) {
        // Search mode: flat grid
        _gridEl.classList.remove('stream-sections-mode');
        renderStreamGrid(filter);
    } else {
        // Browse mode: Netflix sections
        _gridEl.classList.add('stream-sections-mode');
        renderStreamSections();
    }
    // Fire-and-forget: compute missing 7D scores from stored bundles and re-render those cards
    void lazyComputeMissingScores(getCycleIndex());
}

// ── Lazy 7D score compute for cycles saved before the feature existed ──

let _lazyScoreComputePromise: Promise<void> | null = null;
const _lazyScoreComputed = new Set<string>();

/**
 * Pull the authoritative Strategist curve effect names (max 2) out of a saved bundle.
 * Prefers runtime-replay design curves, then falls back to main-model curves.
 * Populates the `curveEffects` badge field (aligned 1:1 with effectScores).
 */
/**
 * Generic curve-field extractor. Searches runtime-replay-state → extended-strategist
 * → main-model (in priority order) and extracts a field from each curve object.
 */
function deriveCurveFieldFromBundle(bundle: any, mapFn: (c: any) => string): string[] {
    const stages = bundle?.stages || {};
    const sources = [
        stages['runtime-replay-state']?.payload?.design?.curvesData,
        stages['extended-strategist']?.payload?.effectRoster,
        stages['main-model']?.payload?.curves,
    ];
    for (const curves of sources) {
        if (!Array.isArray(curves) || curves.length === 0) continue;
        const result = curves
            .slice(0, 2)
            .map(mapFn)
            .filter((s: string) => s.length > 0);
        if (result.length > 0) return result;
    }
    return [];
}

function deriveCurveEffectNamesFromBundle(bundle: any): string[] {
    return deriveCurveFieldFromBundle(bundle, (c: any) => (c && typeof c.effect === 'string' ? c.effect : ''));
}

function deriveCurveColorsFromBundle(bundle: any): string[] {
    return deriveCurveFieldFromBundle(bundle, (c: any) => (c && typeof c.color === 'string' ? c.color : ''));
}

/**
 * Defaults any missing/unknown polarity to 'higher_is_better'.
 */
function deriveCurvePolaritiesFromBundle(bundle: any): string[] {
    return deriveCurveFieldFromBundle(bundle, (c: any) =>
        c && c.polarity === 'higher_is_worse' ? 'higher_is_worse' : 'higher_is_better',
    );
}

/**
 * Pull the Scout (fast-model) word-cloud effects out of a saved bundle and
 * normalize them to the same [{name, relevance}|string] → string shape that
 * cycle-ui.ts handleSave used to write into topEffects. Used to HEAL entries
 * whose topEffects was overwritten by an earlier buggy migration run.
 */
function deriveWordCloudEffectsFromBundle(bundle: any): string[] {
    const stages = bundle?.stages || {};
    const raw = stages['fast-model']?.payload?.effects;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw
        .slice(0, 3)
        .map((e: any) => (typeof e === 'string' ? e : e?.name || ''))
        .filter((s: string) => s.length > 0);
}

/**
 * Detect entries where a prior buggy migration overwrote topEffects with the
 * Strategist curve names (≤2 entries, exactly matching curveEffects). Section
 * matching in matchCustomSection depends on topEffects containing the broader
 * Scout category tags, so those have to be restored.
 */
function topEffectsWasOverwrittenWithCurveNames(entry: SavedCycleIndexEntry, derivedCurveNames: string[]): boolean {
    if (derivedCurveNames.length === 0) return false;
    const current = entry.topEffects || [];
    if (current.length === 0 || current.length > 2) return false;
    if (current.length !== derivedCurveNames.length) return false;
    for (let i = 0; i < derivedCurveNames.length; i++) {
        if ((current[i] || '').toLowerCase() !== derivedCurveNames[i].toLowerCase()) {
            return false;
        }
    }
    return true;
}

async function lazyComputeMissingScores(entries: SavedCycleIndexEntry[]): Promise<void> {
    if (_lazyScoreComputePromise) return _lazyScoreComputePromise;
    _lazyScoreComputePromise = (async () => {
        try {
            const { compute7DScoresFromBundle, EFFECT_SCORE_FORMULA_VERSION } = await import('./effect-score');
            for (const entry of entries) {
                const hasScores = entry.effectScores && entry.effectScores.length > 0;
                const versionCurrent = entry.effectScoresVersion === EFFECT_SCORE_FORMULA_VERSION;
                const scoresHealthy = hasScores && versionCurrent;
                if (_lazyScoreComputed.has(entry.id)) continue;
                _lazyScoreComputed.add(entry.id);

                try {
                    const bundle = await loadCycleBundle(entry.id);
                    if (!bundle) continue;

                    let patched = false;
                    const patch: Parameters<typeof patchCycle>[1] = {};

                    if (!scoresHealthy) {
                        const scores = compute7DScoresFromBundle(bundle);
                        if (scores && scores.length > 0) {
                            entry.effectScores = scores;
                            entry.effectScoresVersion = EFFECT_SCORE_FORMULA_VERSION;
                            patch.effectScores = scores;
                            patch.effectScoresVersion = EFFECT_SCORE_FORMULA_VERSION;
                            patched = true;
                        }
                    }

                    // Populate curveEffects (badge display) from the bundle's
                    // curvesData if the entry doesn't already have it. This is the
                    // correct replacement for the old mis-feature that overwrote
                    // topEffects with Strategist curve names.
                    const derivedCurveNames = deriveCurveEffectNamesFromBundle(bundle);
                    if (derivedCurveNames.length > 0) {
                        const current = entry.curveEffects || [];
                        const sameLen = current.length === derivedCurveNames.length;
                        const sameItems =
                            sameLen &&
                            derivedCurveNames.every(
                                (name, i) => (current[i] || '').toLowerCase() === name.toLowerCase(),
                            );
                        if (!sameItems) {
                            entry.curveEffects = derivedCurveNames;
                            patch.curveEffects = derivedCurveNames;
                            patched = true;
                        }
                    }

                    const derivedCurveColors = deriveCurveColorsFromBundle(bundle);
                    if (derivedCurveColors.length > 0) {
                        const current = entry.curveColors || [];
                        const sameLen = current.length === derivedCurveColors.length;
                        const sameItems =
                            sameLen &&
                            derivedCurveColors.every((c, i) => (current[i] || '').toLowerCase() === c.toLowerCase());
                        if (!sameItems) {
                            entry.curveColors = derivedCurveColors;
                            patch.curveColors = derivedCurveColors;
                            patched = true;
                        }
                    }

                    // Backfill curvePolarities so the stream-card score label
                    // renders `−X%` for higher_is_worse effects. Legacy saves
                    // were written before this field existed.
                    const derivedPolarities = deriveCurvePolaritiesFromBundle(bundle);
                    if (derivedPolarities.length > 0) {
                        const current = entry.curvePolarities || [];
                        const sameLen = current.length === derivedPolarities.length;
                        const sameItems = sameLen && derivedPolarities.every((p, i) => (current[i] || '') === p);
                        if (!sameItems) {
                            entry.curvePolarities = derivedPolarities;
                            patch.curvePolarities = derivedPolarities;
                            patched = true;
                        }
                    }

                    // Heal entries whose topEffects was overwritten with the
                    // Strategist curve names by an earlier buggy migration run —
                    // restore the Scout word-cloud effects so section matching
                    // works again.
                    if (topEffectsWasOverwrittenWithCurveNames(entry, derivedCurveNames)) {
                        const wordCloud = deriveWordCloudEffectsFromBundle(bundle);
                        if (wordCloud.length > 0) {
                            entry.topEffects = wordCloud;
                            patch.topEffects = wordCloud;
                            patched = true;
                        }
                    }

                    // Backfill protocol confidence from per-substance dataConfidence
                    const { computeProtocolConfidence, CONFIDENCE_FORMULA_VERSION } =
                        await import('./protocol-confidence');
                    const confCurrent =
                        entry.protocolConfidence != null && entry.confidenceVersion === CONFIDENCE_FORMULA_VERSION;
                    if (!confCurrent) {
                        const ivPayload =
                            bundle.stages?.['intervention-model']?.payload ||
                            bundle.stages?.['extended-intervention']?.payload;
                        const ivKeys: string[] = ((ivPayload as any)?.interventions || [])
                            .map((iv: any) => iv.key)
                            .filter(Boolean);
                        const conf = computeProtocolConfidence(ivKeys);
                        if (conf) {
                            entry.protocolConfidence = conf.score;
                            entry.confidenceVersion = CONFIDENCE_FORMULA_VERSION;
                            patch.protocolConfidence = conf.score;
                            patch.confidenceVersion = CONFIDENCE_FORMULA_VERSION;
                            patched = true;
                        }
                    }

                    if (!patched) continue;
                    await patchCycle(entry.id, patch);

                    // Update just this card in place (no full re-render).
                    // Score line lives between the .cg-card-icon and the .cg-card-name.
                    const cardEls = document.querySelectorAll(`[data-cycle-id="${entry.id}"]`);
                    cardEls.forEach(cardEl => {
                        const existingLine = cardEl.querySelector(':scope > .cg-card-score-line');
                        const newHtml = buildScoreLineHtml(entry);
                        if (existingLine) {
                            existingLine.outerHTML = newHtml;
                        } else if (newHtml) {
                            const iconEl = cardEl.querySelector(':scope > .cg-card-icon');
                            if (iconEl) iconEl.insertAdjacentHTML('afterend', newHtml);
                        }
                        // Update confidence badge inside the thumbnail
                        const iconWrap = cardEl.querySelector(':scope > .cg-card-icon');
                        if (iconWrap) {
                            const oldBadge = iconWrap.querySelector('.cg-card-confidence');
                            if (oldBadge) oldBadge.remove();
                            const confHtml = buildConfidenceHtml(entry);
                            if (confHtml) iconWrap.insertAdjacentHTML('beforeend', confHtml);
                        }
                    });
                } catch {
                    // swallow and continue
                }
                await new Promise(r => setTimeout(r, 120));
            }
        } finally {
            _lazyScoreComputePromise = null;
        }
    })();
    return _lazyScoreComputePromise;
}

// ── Netflix Sections (browse mode) ─────────────────────────────────────

/** Resolve the display title for a built-in section (supports user renames). */
function resolveBuiltInTitle(section: { key: string; title: string }): string {
    return getBuiltinTitleOverride(section.key) || section.title;
}

/** Resolve effects for a built-in section (from filesystem-backed overrides). */
function resolveBuiltInEffects(section: { key: string; effects: string[] }): string[] {
    return getBuiltinEffectOverride(section.key) || section.effects;
}

/** Resolve negative tags for a built-in section (from filesystem-backed overrides). */
function resolveBuiltInNegativeTags(section: { key: string }): string[] {
    return getBuiltinNegativeTagOverride(section.key) || [];
}

/** Reorder entries by a persisted cardOrder, if one exists for this section.
 *  Entries present in the order come first (in order); remaining entries follow
 *  in their original position (stable relative order preserved). */
function applySectionCardOrder(
    entries: SavedCycleIndexEntry[],
    sectionKey: string,
    sectionType: 'builtin' | 'custom',
): SavedCycleIndexEntry[] {
    const order =
        sectionType === 'custom'
            ? getCustomSections().find(s => s.id === sectionKey)?.cardOrder
            : getBuiltinCardOrder(sectionKey);
    if (!order || order.length === 0) return entries;

    const posMap = new Map(order.map((id, i) => [id, i]));
    return [...entries].sort((a, b) => {
        const ai = posMap.has(a.id) ? posMap.get(a.id)! : order.length + entries.indexOf(a);
        const bi = posMap.has(b.id) ? posMap.get(b.id)! : order.length + entries.indexOf(b);
        return ai - bi;
    });
}

/** Resolve force-include cycle ids for a built-in section (persisted on disk). */
function resolveBuiltInForceInclude(section: { key: string }): string[] {
    return getBuiltinForceInclude(section.key);
}

/** Resolve force-exclude cycle ids for a built-in section (persisted on disk). */
function resolveBuiltInForceExclude(section: { key: string }): string[] {
    return getBuiltinForceExclude(section.key);
}

/**
 * Match cards to a section via topEffects OR substanceClasses, excluding negative
 * tags. `forceIncludeIds` pins additional cycles regardless of tag match (appended
 * after tag matches, dedup'd). `forceExcludeIds` hides cycles even if tag-matched.
 */
function matchCustomSection(
    index: SavedCycleIndexEntry[],
    tags: string[],
    negativeTags?: string[],
    forceIncludeIds?: string[],
    forceExcludeIds?: string[],
): SavedCycleIndexEntry[] {
    const forceIncSet = new Set(forceIncludeIds || []);
    const forceExcSet = new Set(forceExcludeIds || []);
    const tagSet = new Set(tags);
    const negSet = new Set(negativeTags || []);

    // Base tag-based matches (skip if no tags and no force-includes to honor)
    let base: SavedCycleIndexEntry[] = [];
    if (tags.length > 0) {
        base = index.filter(e => matchByTags(e, tagSet, negSet));
    }

    // Apply force-include (append missing)
    if (forceIncSet.size > 0) {
        const seen = new Set(base.map(e => e.id));
        for (const entry of index) {
            if (forceIncSet.has(entry.id) && !seen.has(entry.id)) {
                base.push(entry);
                seen.add(entry.id);
            }
        }
    }

    // Apply force-exclude
    if (forceExcSet.size > 0) {
        base = base.filter(e => !forceExcSet.has(e.id));
    }

    return base;
}

/**
 * Single-entry tag/negative-tag predicate. Only the PRIMARY (first) topEffect
 * counts for section inclusion — Scout ranks topEffects by dominance, and
 * secondary effects shouldn't pull a cycle into an unrelated bucket (e.g. an
 * Interstellar-movie psychedelic cycle with "Sensory Processing" primary +
 * "Sleep Pressure" secondary must not land in Sleep & Recovery). Negative tags
 * check the FULL topEffects list so a cycle with "Sleep" anywhere in its tags is
 * excluded from a section that negates sleep, even if it's not the primary.
 */
function matchByTags(e: SavedCycleIndexEntry, tagSet: Set<string>, negSet: Set<string>): boolean {
    const primaryEffect = (e.topEffects || [])[0];
    const primaryTags: string[] = primaryEffect ? [primaryEffect] : [];
    const allTags = [...primaryTags, ...(e.substanceClasses || [])];
    const included = allTags.some(t => tagSet.has(t));
    if (!included) return false;
    if (negSet.size === 0) return true;
    const fullTags = [...(e.topEffects || []), ...(e.substanceClasses || [])];
    const excluded = fullTags.some(t => negSet.has(t));
    return !excluded;
}

// ── Section Order (disk-persisted) ─────────────────────────────────────

let _sectionOrder: string[] = [];

/** Fetch stored section order from disk (called once on init). */
export async function initSectionOrder(): Promise<void> {
    try {
        const res = await fetch('/__section-order');
        if (res.ok) {
            const data = await res.json();
            _sectionOrder = Array.isArray(data) ? data : [];
        }
    } catch {
        _sectionOrder = [];
    }
}

/** Build the ordered list of section descriptors (built-in + custom), respecting stored order. */
function buildOrderedSections(): { key: string; type: 'builtin' | 'custom' }[] {
    const allKeys: { key: string; type: 'builtin' | 'custom' }[] = [];
    for (const s of SECTION_DEFINITIONS) allKeys.push({ key: s.key, type: 'builtin' });
    for (const cs of getCustomSections()) allKeys.push({ key: cs.id, type: 'custom' });

    if (_sectionOrder.length === 0) return allKeys;

    // Sort by stored order; keys not in the stored list go to the end in their original order
    const posMap = new Map(_sectionOrder.map((k, i) => [k, i]));
    const ordered = [...allKeys].sort((a, b) => {
        const ai = posMap.has(a.key) ? posMap.get(a.key)! : 9999;
        const bi = posMap.has(b.key) ? posMap.get(b.key)! : 9999;
        if (ai !== bi) return ai - bi;
        return allKeys.indexOf(a) - allKeys.indexOf(b);
    });
    return ordered;
}

async function saveSectionOrderToDisk(keys: string[]): Promise<void> {
    _sectionOrder = keys;
    try {
        await fetch('/__section-order', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keys),
        });
    } catch {
        // Silent
    }
}

function renderStreamSections(): void {
    if (!_gridEl) return;
    const index = getCycleIndex();
    const activeId = getLoadedCycleId();

    if (index.length === 0) {
        _gridEl.innerHTML = `<div class="stream-empty">No protocols yet. Switch to <strong>Studio</strong> to create your first.</div>`;
        return;
    }

    const seenForRegen = new Set<string>();
    const regenQueue: { entry: SavedCycleIndexEntry; el: HTMLElement }[] = [];
    const backfillEntries: SavedCycleIndexEntry[] = [];
    const seenForBackfill = new Set<string>();
    const substanceBackfillEntries: SavedCycleIndexEntry[] = [];
    const seenForSubstanceBackfill = new Set<string>();

    const deleteHtml = _editMode
        ? `<button class="stream-section-delete-btn" aria-label="Delete category" title="Delete category">&times;</button>`
        : '';
    const editTagsHtml = _editMode
        ? `<button class="stream-section-edit-tags-btn" aria-label="Edit tags" title="Edit tags">` +
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
          `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>` +
          `<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>` +
          `</svg></button>`
        : '';
    const moveUpHtml =
        `<button class="stream-section-move-btn stream-section-move-up" aria-label="Move up" title="Move up">` +
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
        `<polyline points="18 15 12 9 6 15"/></svg></button>`;
    const moveDownHtml =
        `<button class="stream-section-move-btn stream-section-move-down" aria-label="Move down" title="Move down">` +
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
        `<polyline points="6 9 12 15 18 9"/></svg></button>`;

    // Build unified ordered section list
    const orderedSections = buildOrderedSections();
    const builtinMap = new Map(SECTION_DEFINITIONS.map(s => [s.key, s]));
    const customMap = new Map(getCustomSections().map(s => [s.id, s]));
    const sectionsHtml: string[] = [];
    const renderedKeys: string[] = []; // track which keys actually rendered (for order persistence)

    for (const { key, type } of orderedSections) {
        let entries: SavedCycleIndexEntry[];
        let title: string;
        let sectionEditHtml = '';
        let sectionDeleteHtml = '';
        let sectionType = type;

        if (type === 'builtin') {
            const section = builtinMap.get(key);
            if (!section) continue;
            const resolvedEffects = resolveBuiltInEffects(section);
            const resolvedForceInc = resolveBuiltInForceInclude(section);
            const resolvedForceExc = resolveBuiltInForceExclude(section);

            if (section.key === 'recent') {
                // Recent is algorithmic (top 6 by savedAt). Apply force-exclude
                // to subtract manually-moved cards, then union force-included
                // cards (appended after the algorithmic picks).
                const excSet = new Set(resolvedForceExc);
                const incSet = new Set(resolvedForceInc);
                const byRecent = [...index]
                    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
                    .filter(e => !excSet.has(e.id))
                    .slice(0, 6);
                const seen = new Set(byRecent.map(e => e.id));
                for (const entry of index) {
                    if (incSet.has(entry.id) && !seen.has(entry.id)) {
                        byRecent.push(entry);
                        seen.add(entry.id);
                    }
                }
                entries = byRecent;
            } else {
                const resolvedNeg = resolveBuiltInNegativeTags(section);
                entries = matchCustomSection(index, resolvedEffects, resolvedNeg, resolvedForceInc, resolvedForceExc);
            }

            if (entries.length === 0 && !_editMode) continue;
            title = resolveBuiltInTitle(section);
            sectionEditHtml = _editMode && section.key !== 'recent' ? editTagsHtml : '';
        } else {
            const cs = customMap.get(key);
            if (!cs) continue;
            entries = matchCustomSection(index, cs.tags, cs.negativeTags, cs.forceIncludeIds, cs.forceExcludeIds);
            if (entries.length === 0 && !_editMode) continue;
            title = cs.title;
            sectionEditHtml = editTagsHtml;
            sectionDeleteHtml = deleteHtml;
        }

        // Apply persisted card order if available
        entries = applySectionCardOrder(entries, key, sectionType);

        const cardsHtml = entries.map(e => buildCardHtml(e, activeId)).join('');
        const countLabel = entries.length === 1 ? '1 protocol' : `${entries.length} protocols`;
        const moveHtml = _editMode ? `<span class="stream-section-move-group">${moveUpHtml}${moveDownHtml}</span>` : '';

        sectionsHtml.push(
            `<div class="stream-section" data-section="${escapeHtml(key)}" data-section-type="${sectionType}">` +
                `<div class="stream-section-header">` +
                `<h2 class="stream-section-title">${escapeHtml(title)}</h2>` +
                `<span class="stream-section-count">${countLabel}</span>` +
                sectionEditHtml +
                moveHtml +
                sectionDeleteHtml +
                `</div>` +
                `<div class="stream-section-row-wrap">` +
                `<div class="stream-section-row">${cardsHtml || '<span class="stream-section-empty">No matching protocols</span>'}</div>` +
                `</div>` +
                `</div>`,
        );
        renderedKeys.push(key);

        for (const entry of entries) {
            if (!seenForBackfill.has(entry.id) && !entry.recommendedDevices) {
                seenForBackfill.add(entry.id);
                backfillEntries.push(entry);
            }
            if (!seenForSubstanceBackfill.has(entry.id) && !entry.substanceClasses) {
                seenForSubstanceBackfill.add(entry.id);
                substanceBackfillEntries.push(entry);
            }
        }
    }

    if (sectionsHtml.length === 0) {
        _gridEl.innerHTML = `<div class="stream-empty">No protocols yet. Switch to <strong>Studio</strong> to create your first.</div>`;
        return;
    }

    // Add Category button (edit mode only — JS will show/hide)
    const addCategoryHtml =
        `<div class="stream-add-category-wrap">` +
        `<button class="stream-add-category-btn" id="stream-add-category-btn">＋ Add Category</button>` +
        `</div>`;

    _gridEl.innerHTML = sectionsHtml.join('') + addCategoryHtml;

    // Wire up section header clicks for editing + delete buttons
    if (_editMode) {
        wireEditModeSectionHandlers();
    }

    // Wire up the "Add Category" button
    const addBtn = document.getElementById('stream-add-category-btn');
    addBtn?.addEventListener('click', showAddCategoryForm);

    // Lazy icon regen (deduplicated across sections)
    for (const entry of index) {
        const needsRegen = !entry.iconSvg || !entry.iconSvg.includes('data-v="10"');
        // Wide cards with a narrow-format icon need regen for panoramic thumbnail
        const needsWideRegen = isWideCard(entry) && entry.iconSvg && !entry.iconSvg.includes('viewBox="0 0 400');
        if (!seenForRegen.has(entry.id) && (needsRegen || needsWideRegen)) {
            const iconEl = _gridEl.querySelector(
                `.cg-card[data-cycle-id="${CSS.escape(entry.id)}"] .cg-card-icon`,
            ) as HTMLElement | null;
            if (iconEl) {
                seenForRegen.add(entry.id);
                regenQueue.push({ entry, el: iconEl });
            }
        }
    }
    if (regenQueue.length > 0) {
        void regenIconsSequentially(regenQueue);
    }

    // Backfill devices
    if (backfillEntries.length > 0) {
        void backfillDevices(backfillEntries);
    }

    // Backfill substance classes
    if (substanceBackfillEntries.length > 0) {
        void backfillSubstanceClasses(substanceBackfillEntries);
    }
}

// ── Flat Grid (search mode) ────────────────────────────────────────────

function renderStreamGrid(filter: string): void {
    if (!_gridEl) return;
    const index = getCycleIndex();
    const activeId = getLoadedCycleId();
    const query = filter.toLowerCase().trim();

    let filtered = index;

    if (query) {
        filtered = filtered.filter(
            e =>
                e.filename.toLowerCase().includes(query) ||
                e.prompt.toLowerCase().includes(query) ||
                (e.topEffects || []).some(t => t.toLowerCase().includes(query)),
        );
    }

    if (filtered.length === 0) {
        const msg =
            index.length === 0
                ? 'No protocols yet. Switch to <strong>Studio</strong> to create your first.'
                : 'No protocols match your search';
        _gridEl.innerHTML = `<div class="stream-empty">${msg}</div>`;
        return;
    }

    const cards = filtered.map(e => buildCardHtml(e, activeId)).join('');
    _gridEl.innerHTML = cards;

    // Lazy icon regen
    const regenQueue: { entry: SavedCycleIndexEntry; el: HTMLElement }[] = [];
    for (const entry of filtered) {
        if (!entry.iconSvg || !entry.iconSvg.includes('data-v="10"')) {
            const iconEl = _gridEl.querySelector(
                `.cg-card[data-cycle-id="${CSS.escape(entry.id)}"] .cg-card-icon`,
            ) as HTMLElement | null;
            if (iconEl) regenQueue.push({ entry, el: iconEl });
        }
    }
    if (regenQueue.length > 0) {
        void regenIconsSequentially(regenQueue);
    }

    // Backfill devices
    const backfillQueue = filtered.filter(e => !e.recommendedDevices);
    if (backfillQueue.length > 0) {
        void backfillDevices(backfillQueue);
    }

    // Stagger-reveal cards
    staggerCards();
}

// ── Card Click Handler ─────────────────────────────────────────────────

function handleCardClick(e: Event): void {
    const target = e.target as HTMLElement;

    // Don't intercept clicks on edit inputs
    if (target.classList.contains('cg-card-edit-input')) return;

    // Card delete button (with confirmation)
    const deleteBtn = target.closest('.cg-card-delete-btn') as HTMLElement | null;
    if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const deleteId = deleteBtn.dataset.deleteId;
        if (deleteId) showDeleteConfirmation(deleteBtn, deleteId);
        return;
    }

    // Card remove-from-section button (minus)
    const removeBtn = target.closest('.cg-card-remove-btn') as HTMLElement | null;
    if (removeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const removeId = removeBtn.dataset.removeId;
        if (removeId) handleRemoveFromSection(removeBtn, removeId);
        return;
    }

    const card = target.closest('.cg-card') as HTMLElement | null;
    if (!card) return;
    const id = card.dataset.cycleId;
    if (!id) return;

    if (_editMode) {
        e.preventDefault();
        e.stopPropagation();
        enterCardEdit(card, id);
    } else {
        // All cards (wide + narrow): expand inline. "Open in Studio" inside the
        // expand panel triggers card-open-design → handleStreamLoad for full load.
        e.preventDefault();
        e.stopPropagation();
        const index = getCycleIndex();
        const entry = index.find(ent => ent.id === id);
        if (entry) expandCard(card, entry);
    }
}

function handleDeleteCard(id: string): void {
    // If this is the currently loaded cycle, unload it
    if (getLoadedCycleId() === id) {
        clearLoadedCycleId();
    }
    void deleteCycle(id).then(() => rerenderStreamImmediate());
}

/** Remove a card from its containing section via force-exclude (does NOT delete the protocol). */
function handleRemoveFromSection(btn: HTMLElement, cycleId: string): void {
    const sectionEl = btn.closest('.stream-section') as HTMLElement | null;
    if (!sectionEl) return;
    const sectionKey = sectionEl.dataset.section || '';
    const sectionType = (sectionEl.dataset.sectionType || 'builtin') as 'builtin' | 'custom';
    if (!sectionKey || sectionKey === 'recent') return; // don't allow removal from Recent

    void updateSectionForceList(sectionKey, sectionType, { addExclude: cycleId }).then(() => rerenderStreamImmediate());
}

/** Show a confirmation popover before permanently deleting a protocol. */
function showDeleteConfirmation(anchor: HTMLElement, cycleId: string): void {
    // Remove any existing confirmation popover
    document.querySelector('.cg-delete-confirm')?.remove();

    const entry = getCycleIndex().find(e => e.id === cycleId);
    const name = entry?.overlayTitle || entry?.filename || 'this protocol';

    const popover = document.createElement('div');
    popover.className = 'cg-delete-confirm';
    popover.innerHTML =
        `<p>Delete <strong>${escapeHtml(name)}</strong>?</p>` +
        `<p class="cg-delete-confirm-sub">This will permanently remove the protocol.</p>` +
        `<div class="cg-delete-confirm-actions">` +
        `<button class="cg-delete-confirm-cancel" type="button">Cancel</button>` +
        `<button class="cg-delete-confirm-yes" type="button">Delete</button>` +
        `</div>`;

    // Position near the anchor button
    const card = anchor.closest('.cg-card') as HTMLElement | null;
    if (card) {
        card.style.position = 'relative';
        card.appendChild(popover);
    } else {
        document.body.appendChild(popover);
    }

    const cancel = () => popover.remove();
    const confirm = () => {
        popover.remove();
        handleDeleteCard(cycleId);
    };

    popover.querySelector('.cg-delete-confirm-cancel')!.addEventListener('click', cancel);
    popover.querySelector('.cg-delete-confirm-yes')!.addEventListener('click', confirm);

    // Dismiss on outside click (after a tick to avoid the current click)
    setTimeout(() => {
        const dismiss = (ev: MouseEvent) => {
            if (!popover.contains(ev.target as Node)) {
                cancel();
                document.removeEventListener('click', dismiss, true);
            }
        };
        document.addEventListener('click', dismiss, true);
    }, 0);
}

// ── Search Handler ─────────────────────────────────────────────────────

function handleStreamSearch(): void {
    if (_searchDebounce) clearTimeout(_searchDebounce);
    _searchDebounce = window.setTimeout(() => {
        const input = document.getElementById('prompt-input') as HTMLInputElement | null;
        renderStreamContent(input?.value || '');
    }, 150) as any;
}

// ── Edit Mode ─────────────────────────────────────────────────────────

function toggleEditMode(): void {
    _editMode = !_editMode;

    const btn = document.getElementById('stream-edit-btn');
    btn?.classList.toggle('stream-edit-active', _editMode);
    document.body.classList.toggle('stream-edit-mode', _editMode);

    // Exit edit mode on any card that's currently being edited
    if (!_editMode) {
        document.querySelectorAll('.cg-card-editing').forEach(card => {
            exitCardEdit(card as HTMLElement);
        });
    }

    // Re-render to show/hide edit UI (skip stagger animation)
    rerenderStreamImmediate();
}

// ── Drag & Drop (edit mode) ────────────────────────────────────────────
//
// In stream edit mode, cards become draggable between sections. On drop, the
// user picks Copy or Move; both target writes and (for move) source writes go
// through force-include / force-exclude lists persisted to disk. Cycle files
// are never touched — positions are a property of the section, not the card.

interface DragState {
    cycleId: string;
    sourceKey: string;
    sourceType: 'builtin' | 'custom';
}

let _dragState: DragState | null = null;

function handleCardDragStart(e: DragEvent): void {
    if (!_editMode || !_gridEl) return;
    const card = (e.target as HTMLElement | null)?.closest('.cg-card') as HTMLElement | null;
    if (!card) return;
    // Don't start a drag on a card that's currently being inline-edited.
    if (card.classList.contains('cg-card-editing')) {
        e.preventDefault();
        return;
    }
    const cycleId = card.dataset.cycleId;
    if (!cycleId) return;
    const section = card.closest('.stream-section') as HTMLElement | null;
    if (!section) return;
    const sourceKey = section.dataset.section || '';
    const sourceType = (section.dataset.sectionType === 'custom' ? 'custom' : 'builtin') as 'builtin' | 'custom';
    if (!sourceKey) return;

    _dragState = { cycleId, sourceKey, sourceType };
    card.classList.add('cg-card-dragging');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copyMove';
        // A value is required on some browsers for drag to initiate.
        try {
            e.dataTransfer.setData('text/plain', cycleId);
        } catch {
            // ignore
        }
    }
}

function handleCardDragEnd(_e: DragEvent): void {
    _dragState = null;
    if (_gridEl) {
        _gridEl.querySelectorAll('.cg-card-dragging').forEach(el => el.classList.remove('cg-card-dragging'));
        _gridEl
            .querySelectorAll('.stream-section-drop-target')
            .forEach(el => el.classList.remove('stream-section-drop-target'));
    }
    removeDropIndicator();
}

function handleSectionDragOver(e: DragEvent): void {
    if (!_dragState || !_gridEl) return;
    const section = (e.target as HTMLElement | null)?.closest('.stream-section') as HTMLElement | null;
    if (!section) return;
    // preventDefault is required to permit a drop
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    // Highlight this section only
    _gridEl.querySelectorAll('.stream-section-drop-target').forEach(el => {
        if (el !== section) el.classList.remove('stream-section-drop-target');
    });
    section.classList.add('stream-section-drop-target');

    // Show intra-section drop indicator
    updateDropIndicator(section, e);
}

function handleSectionDragLeave(e: DragEvent): void {
    const section = (e.target as HTMLElement | null)?.closest('.stream-section') as HTMLElement | null;
    if (!section) return;
    // Only remove highlight when leaving the section boundary (relatedTarget
    // outside the section). Without this, dragleave fires for every child.
    const next = (e.relatedTarget as HTMLElement | null) || null;
    if (next && section.contains(next)) return;
    section.classList.remove('stream-section-drop-target');
    removeDropIndicator();
}

function handleSectionDrop(e: DragEvent): void {
    if (!_dragState || !_gridEl) return;
    const section = (e.target as HTMLElement | null)?.closest('.stream-section') as HTMLElement | null;
    if (!section) return;
    e.preventDefault();
    const targetKey = section.dataset.section || '';
    const targetType = (section.dataset.sectionType === 'custom' ? 'custom' : 'builtin') as 'builtin' | 'custom';
    if (!targetKey) return;

    const drag = _dragState;

    // Clear visual state up front (dragend also runs, but this makes the
    // modal render over a clean grid).
    _gridEl.querySelectorAll('.cg-card-dragging').forEach(el => el.classList.remove('cg-card-dragging'));
    _gridEl
        .querySelectorAll('.stream-section-drop-target')
        .forEach(el => el.classList.remove('stream-section-drop-target'));
    removeDropIndicator();

    // Same-section drop → intra-section reorder
    if (targetKey === drag.sourceKey && targetType === drag.sourceType) {
        const dropIdx = computeDropIndex(section, e);
        void applyIntraSectionReorder(drag, targetKey, targetType, section, dropIdx);
        _dragState = null;
        return;
    }

    const targetTitle = resolveSectionTitle(targetKey, targetType);
    const cardTitle = resolveCycleTitle(drag.cycleId);
    showCopyMoveChoice(drag, { key: targetKey, type: targetType, title: targetTitle }, cardTitle);
    _dragState = null;
}

function resolveSectionTitle(key: string, type: 'builtin' | 'custom'): string {
    if (type === 'custom') {
        return getCustomSections().find(s => s.id === key)?.title || 'category';
    }
    const def = SECTION_DEFINITIONS.find(s => s.key === key);
    return def ? resolveBuiltInTitle(def) : 'category';
}

function resolveCycleTitle(cycleId: string): string {
    return getCycleIndex().find(e => e.id === cycleId)?.filename || 'protocol';
}

/** Read a custom section's current force lists from the in-memory cache. */
function readCustomForceLists(sectionId: string): { inc: string[]; exc: string[] } {
    const cs = getCustomSections().find(s => s.id === sectionId);
    return {
        inc: cs?.forceIncludeIds ? [...cs.forceIncludeIds] : [],
        exc: cs?.forceExcludeIds ? [...cs.forceExcludeIds] : [],
    };
}

/** Apply add/remove ops to a string list and return the new list. */
function mutateList(list: string[], ops: { add?: string; remove?: string }): string[] {
    let next = list.slice();
    if (ops.remove) next = next.filter(id => id !== ops.remove);
    if (ops.add && !next.includes(ops.add)) next.push(ops.add);
    return next;
}

/**
 * Update a section's force-include / force-exclude lists. Branches on type:
 * built-in sections go through builtin-overrides-store (file-backed single
 * blob); custom sections go through patchCustomSection (per-section JSON file).
 */
async function updateSectionForceList(
    key: string,
    type: 'builtin' | 'custom',
    patch: {
        addInclude?: string;
        removeInclude?: string;
        addExclude?: string;
        removeExclude?: string;
    },
): Promise<void> {
    if (type === 'builtin') {
        await updateBuiltinForceLists(key, patch);
        return;
    }
    const current = readCustomForceLists(key);
    const nextInc = mutateList(current.inc, {
        add: patch.addInclude,
        remove: patch.removeInclude,
    });
    const nextExc = mutateList(current.exc, {
        add: patch.addExclude,
        remove: patch.removeExclude,
    });
    await patchCustomSection(key, {
        forceIncludeIds: nextInc,
        forceExcludeIds: nextExc,
    });
}

async function applyCopy(drag: DragState, target: { key: string; type: 'builtin' | 'custom' }): Promise<void> {
    await updateSectionForceList(target.key, target.type, {
        addInclude: drag.cycleId,
        removeExclude: drag.cycleId,
    });
    rerenderStreamImmediate();
}

async function applyMove(drag: DragState, target: { key: string; type: 'builtin' | 'custom' }): Promise<void> {
    // Target: pin the cycle, clear any stale exclusion from a prior move-out.
    await updateSectionForceList(target.key, target.type, {
        addInclude: drag.cycleId,
        removeExclude: drag.cycleId,
    });

    // Source: if the cycle was pinned via force-include, unpin it (undo).
    // Otherwise add it to force-exclude so the tag-matched card disappears
    // from the source section.
    const sourceInc =
        drag.sourceType === 'custom'
            ? readCustomForceLists(drag.sourceKey).inc
            : getBuiltinForceInclude(drag.sourceKey);

    if (sourceInc.includes(drag.cycleId)) {
        await updateSectionForceList(drag.sourceKey, drag.sourceType, {
            removeInclude: drag.cycleId,
        });
    } else {
        await updateSectionForceList(drag.sourceKey, drag.sourceType, {
            addExclude: drag.cycleId,
        });
    }

    rerenderStreamImmediate();
}

function showCopyMoveChoice(
    drag: DragState,
    target: { key: string; type: 'builtin' | 'custom'; title: string },
    cardTitle: string,
): void {
    // Remove any existing modal (defensive)
    document.querySelector('.stream-dnd-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'stream-dnd-modal';
    overlay.innerHTML =
        `<div class="stream-dnd-modal-card" role="dialog" aria-modal="true">` +
        `<h3>Drop "${escapeHtml(cardTitle)}"</h3>` +
        `<p>Copy or move this protocol into <strong>${escapeHtml(target.title)}</strong>?</p>` +
        `<div class="stream-dnd-modal-actions">` +
        `<button class="stream-dnd-cancel" type="button">Cancel</button>` +
        `<button class="stream-dnd-copy" type="button">Copy</button>` +
        `<button class="stream-dnd-move primary" type="button">Move</button>` +
        `</div>` +
        `</div>`;

    const cleanup = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
            ev.preventDefault();
            cleanup();
        }
    };

    overlay.addEventListener('click', ev => {
        // Click on backdrop cancels
        if (ev.target === overlay) cleanup();
    });
    overlay.querySelector('.stream-dnd-cancel')?.addEventListener('click', () => cleanup());
    overlay.querySelector('.stream-dnd-copy')?.addEventListener('click', () => {
        cleanup();
        void applyCopy(drag, target);
    });
    overlay.querySelector('.stream-dnd-move')?.addEventListener('click', () => {
        cleanup();
        void applyMove(drag, target);
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);

    // Focus the primary action so Enter confirms Move.
    (overlay.querySelector('.stream-dnd-move') as HTMLElement | null)?.focus();
}

// ── Intra-section reorder helpers ────────────────────────────────────

/** Singleton drop-indicator element. Created once, reused across drags. */
let _dropIndicator: HTMLElement | null = null;

function getDropIndicator(): HTMLElement {
    if (!_dropIndicator) {
        _dropIndicator = document.createElement('div');
        _dropIndicator.className = 'stream-drop-indicator';
    }
    return _dropIndicator;
}

function removeDropIndicator(): void {
    _dropIndicator?.remove();
}

/**
 * Given a section and a dragover event, find the card the cursor is nearest to
 * and show a vertical drop indicator at the left or right edge of that card.
 * Returns nothing — purely visual. The actual position is computed again on drop.
 */
function updateDropIndicator(section: HTMLElement, e: DragEvent): void {
    const row = section.querySelector('.stream-section-row') as HTMLElement | null;
    if (!row) return;
    const cards = Array.from(row.querySelectorAll<HTMLElement>('.cg-card'));
    if (cards.length < 2) {
        removeDropIndicator();
        return;
    }

    const indicator = getDropIndicator();
    const mouseX = e.clientX;

    // Find insertion point: scan cards left-to-right, first card whose
    // horizontal center is AFTER the mouse gets the indicator placed to its left.
    let insertBefore: HTMLElement | null = null;
    for (const card of cards) {
        if (card.classList.contains('cg-card-dragging')) continue;
        const rect = card.getBoundingClientRect();
        if (mouseX < rect.left + rect.width / 2) {
            insertBefore = card;
            break;
        }
    }

    if (insertBefore) {
        row.insertBefore(indicator, insertBefore);
    } else {
        row.appendChild(indicator);
    }
}

/**
 * Compute the numeric insertion index for a drop event inside a section row.
 * Returns the index within the card list (0 = before first, N = after last).
 */
function computeDropIndex(section: HTMLElement, e: DragEvent): number {
    const row = section.querySelector('.stream-section-row') as HTMLElement | null;
    if (!row) return 0;
    const cards = Array.from(row.querySelectorAll<HTMLElement>('.cg-card'));
    if (cards.length === 0) return 0;
    const mouseX = e.clientX;

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (card.classList.contains('cg-card-dragging')) continue;
        const rect = card.getBoundingClientRect();
        if (mouseX < rect.left + rect.width / 2) {
            return i;
        }
    }
    return cards.length;
}

/**
 * Compute the new card order for a section after dragging cycleId to position
 * `dropIdx`, persist it, and re-render.
 */
async function applyIntraSectionReorder(
    drag: DragState,
    sectionKey: string,
    sectionType: 'builtin' | 'custom',
    section: HTMLElement,
    dropIdx: number,
): Promise<void> {
    const row = section.querySelector('.stream-section-row');
    if (!row) return;
    // Read the current visual order from the DOM (already sorted by cardOrder)
    const currentIds = Array.from(row.querySelectorAll<HTMLElement>('.cg-card'))
        .map(c => c.dataset.cycleId || '')
        .filter(Boolean);

    // Remove dragged card from current position
    const filtered = currentIds.filter(id => id !== drag.cycleId);
    // Clamp dropIdx
    const clampedIdx = Math.min(dropIdx, filtered.length);
    // Insert at new position
    filtered.splice(clampedIdx, 0, drag.cycleId);

    // Persist
    if (sectionType === 'builtin') {
        await setBuiltinCardOrder(sectionKey, filtered);
    } else {
        await patchCustomSection(sectionKey, { cardOrder: filtered });
    }

    rerenderStreamImmediate();
}

function enterCardEdit(card: HTMLElement, id: string): void {
    // Already editing this card
    if (card.classList.contains('cg-card-editing')) return;

    // Exit any other card currently being edited
    document.querySelectorAll('.cg-card-editing').forEach(c => {
        exitCardEdit(c as HTMLElement);
    });

    const index = getCycleIndex();
    const entry = index.find(e => e.id === id);
    if (!entry) return;

    card.classList.add('cg-card-editing');

    // Replace name text with input
    const nameEl = card.querySelector('.cg-card-name') as HTMLElement | null;
    if (nameEl) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cg-card-edit-input cg-card-edit-name';
        input.value = entry.filename;
        input.dataset.field = 'filename';
        input.dataset.original = entry.filename;
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                commitCardEdit(card, id);
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                exitCardEdit(card);
            }
        });
    }

    // Replace prompt text with textarea
    const promptEl = card.querySelector('.cg-card-prompt') as HTMLElement | null;
    if (promptEl) {
        const textarea = document.createElement('textarea');
        textarea.className = 'cg-card-edit-input cg-card-edit-prompt';
        textarea.value = entry.prompt || '';
        textarea.dataset.field = 'prompt';
        textarea.dataset.original = entry.prompt || '';
        textarea.rows = 2;
        promptEl.replaceWith(textarea);

        textarea.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                commitCardEdit(card, id);
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                exitCardEdit(card);
            }
        });
    }

    // Replace thumbnail overlay title with input
    const overlayEl = card.querySelector('.cg-card-overlay-title') as HTMLElement | null;
    if (overlayEl) {
        const currentOverlay = overlayEl.textContent || '';
        const overlayInput = document.createElement('input');
        overlayInput.type = 'text';
        overlayInput.className = 'cg-card-edit-input cg-card-edit-overlay';
        overlayInput.value = currentOverlay;
        overlayInput.dataset.field = 'overlay';
        overlayInput.dataset.original = currentOverlay;
        // Preserve the original color styling
        const color = (overlayEl as HTMLElement).style.color;
        if (color) overlayInput.style.color = color;
        overlayEl.replaceWith(overlayInput);

        overlayInput.addEventListener('click', ev => ev.stopPropagation());
        overlayInput.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                commitCardEdit(card, id);
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                exitCardEdit(card);
            }
        });
    }

    // Click outside to commit
    const outsideHandler = (ev: MouseEvent) => {
        if (!card.contains(ev.target as Node)) {
            document.removeEventListener('click', outsideHandler, true);
            commitCardEdit(card, id);
        }
    };
    // Delay to avoid catching the current click
    setTimeout(() => document.addEventListener('click', outsideHandler, true), 0);
    (card as any)._editOutsideHandler = outsideHandler;
}

async function commitCardEdit(card: HTMLElement, id: string): Promise<void> {
    if (!card.classList.contains('cg-card-editing')) return;

    const nameInput = card.querySelector('.cg-card-edit-name') as HTMLInputElement | null;
    const promptInput = card.querySelector('.cg-card-edit-prompt') as HTMLTextAreaElement | null;
    const overlayInput = card.querySelector('.cg-card-edit-overlay') as HTMLInputElement | null;

    const newName = nameInput?.value.trim() || nameInput?.dataset.original || '';
    const newPrompt = promptInput?.value.trim() || promptInput?.dataset.original || '';
    const newOverlay = overlayInput?.value.trim() || '';
    const overlayChanged = overlayInput && newOverlay !== (overlayInput.dataset.original || '');

    const nameChanged = nameInput && newName !== nameInput.dataset.original;
    const promptChanged = promptInput && newPrompt !== promptInput.dataset.original;

    // Update in-memory index
    const index = getCycleIndex();
    const entry = index.find(e => e.id === id);

    if (nameChanged && entry) {
        entry.filename = newName;
        try {
            await patchCycle(id, { filename: newName });
        } catch {
            // Revert on failure
            entry.filename = nameInput!.dataset.original!;
        }
    }

    if (promptChanged && entry) {
        entry.prompt = newPrompt;
        // prompt is not patchable via the current API, but update in-memory for display
    }

    if (overlayChanged && entry) {
        // Empty string clears override → falls back to filename-derived title
        const nextOverlay = newOverlay || null;
        const prevOverlay = entry.overlayTitle ?? null;
        entry.overlayTitle = nextOverlay;
        try {
            await patchCycle(id, { overlayTitle: nextOverlay });
        } catch {
            entry.overlayTitle = prevOverlay;
        }
    }

    // Restore static DOM
    restoreCardStatic(card, id);
}

function exitCardEdit(card: HTMLElement): void {
    if (!card.classList.contains('cg-card-editing')) return;

    // Remove outside click handler
    const handler = (card as any)._editOutsideHandler;
    if (handler) {
        document.removeEventListener('click', handler, true);
        delete (card as any)._editOutsideHandler;
    }

    const id = card.dataset.cycleId;
    if (id) restoreCardStatic(card, id);
}

function restoreCardStatic(card: HTMLElement, id: string): void {
    card.classList.remove('cg-card-editing');

    const index = getCycleIndex();
    const entry = index.find(e => e.id === id);
    if (!entry) return;

    // Restore name
    const nameInput = card.querySelector('.cg-card-edit-name');
    if (nameInput) {
        const h3 = document.createElement('h3');
        h3.className = 'cg-card-name';
        h3.textContent = entry.filename;
        nameInput.replaceWith(h3);
    }

    // Restore prompt
    const promptInput = card.querySelector('.cg-card-edit-prompt');
    if (promptInput) {
        const p = document.createElement('p');
        p.className = 'cg-card-prompt';
        const text = entry.prompt || '';
        p.textContent = text.length > 80 ? text.slice(0, 80) + '...' : text;
        promptInput.replaceWith(p);
    }

    // Restore overlay title — if an edit input is present, replace it with a div
    const overlayInput = card.querySelector('.cg-card-edit-overlay') as HTMLInputElement | null;
    if (overlayInput) {
        const div = document.createElement('div');
        // Preserve classes from original render by re-computing
        const text = resolveOverlayTitle(entry);
        div.className = 'cg-card-overlay-title' + getOverlayTitleClass(text);
        const color = overlayInput.style.color;
        if (color) div.style.color = color;
        div.textContent = text;
        overlayInput.replaceWith(div);
    } else {
        const overlayEl = card.querySelector('.cg-card-overlay-title');
        if (overlayEl) {
            overlayEl.textContent = resolveOverlayTitle(entry);
        }
    }
}

// ── Section Edit Mode Handlers ─────────────────────────────────────────

function wireEditModeSectionHandlers(): void {
    if (!_gridEl) return;

    // Section title click → inline edit
    _gridEl.querySelectorAll<HTMLElement>('.stream-section-title').forEach(h2 => {
        h2.style.cursor = 'text';
        h2.addEventListener('click', handleSectionTitleClick);
    });

    // Delete buttons on custom sections
    _gridEl.querySelectorAll<HTMLElement>('.stream-section-delete-btn').forEach(btn => {
        btn.addEventListener('click', handleDeleteCustomSection);
    });

    // Edit-tags buttons on custom sections
    _gridEl.querySelectorAll<HTMLElement>('.stream-section-edit-tags-btn').forEach(btn => {
        btn.addEventListener('click', handleEditCustomSectionTags);
    });

    // Move up/down buttons
    _gridEl.querySelectorAll<HTMLElement>('.stream-section-move-up').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            handleMoveSection(btn, -1);
        });
    });
    _gridEl.querySelectorAll<HTMLElement>('.stream-section-move-down').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            handleMoveSection(btn, 1);
        });
    });
}

function handleSectionTitleClick(e: Event): void {
    if (!_editMode) return;
    const h2 = e.currentTarget as HTMLElement;
    const section = h2.closest('.stream-section') as HTMLElement | null;
    if (!section) return;

    const sectionKey = section.dataset.section || '';
    const sectionType = section.dataset.sectionType || 'builtin';
    const currentTitle = h2.textContent || '';

    // Replace h2 with input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'stream-section-title-edit';
    input.value = currentTitle;
    input.dataset.sectionKey = sectionKey;
    input.dataset.sectionType = sectionType;
    input.dataset.original = currentTitle;
    h2.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
        const newTitle = input.value.trim() || input.dataset.original || '';
        commitSectionTitle(sectionKey, sectionType, newTitle);
    };

    input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            commit();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            revertSectionTitleInput(input);
        }
    });

    input.addEventListener('blur', () => {
        // Small delay to avoid race with keydown
        setTimeout(() => {
            if (input.parentElement) commit();
        }, 50);
    });
}

function commitSectionTitle(sectionKey: string, sectionType: string, newTitle: string): void {
    if (sectionType === 'custom') {
        const cs = getCustomSections().find(s => s.id === sectionKey);
        if (cs && newTitle !== cs.title) {
            void patchCustomSection(sectionKey, { title: newTitle }).then(() => rerenderStreamImmediate());
        } else {
            rerenderStreamImmediate();
        }
    } else {
        // Built-in section rename — persist to filesystem
        void setBuiltinTitleOverride(sectionKey, newTitle);
        rerenderStreamImmediate();
    }
}

function revertSectionTitleInput(input: HTMLInputElement): void {
    const h2 = document.createElement('h2');
    h2.className = 'stream-section-title';
    h2.textContent = input.dataset.original || '';
    h2.style.cursor = 'text';
    h2.addEventListener('click', handleSectionTitleClick);
    input.replaceWith(h2);
}

function handleDeleteCustomSection(e: Event): void {
    const btn = e.currentTarget as HTMLElement;
    const section = btn.closest('.stream-section') as HTMLElement | null;
    if (!section) return;
    const sectionId = section.dataset.section || '';
    if (!sectionId) return;

    void deleteCustomSection(sectionId).then(() => rerenderStreamImmediate());
}

function handleMoveSection(btn: HTMLElement, direction: -1 | 1): void {
    const sectionEl = btn.closest('.stream-section') as HTMLElement | null;
    if (!sectionEl || !_gridEl) return;
    const sectionKey = sectionEl.dataset.section || '';
    if (!sectionKey) return;

    // Get current rendered order from DOM
    const allSections = Array.from(_gridEl.querySelectorAll<HTMLElement>('.stream-section[data-section]'));
    const keys = allSections.map(s => s.dataset.section!);
    const idx = keys.indexOf(sectionKey);
    if (idx < 0) return;

    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= keys.length) return;

    // Swap
    [keys[idx], keys[newIdx]] = [keys[newIdx], keys[idx]];

    // Persist and re-render
    void saveSectionOrderToDisk(keys).then(() => rerenderStreamImmediate());
}

function handleEditCustomSectionTags(e: Event): void {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const sectionEl = btn.closest('.stream-section') as HTMLElement | null;
    if (!sectionEl) return;
    const sectionId = sectionEl.dataset.section || '';
    const sectionType = sectionEl.dataset.sectionType || 'builtin';
    if (!sectionId) return;

    if (sectionType === 'custom') {
        const cs = getCustomSections().find(s => s.id === sectionId);
        if (!cs) return;
        showEditTagsForSection(sectionEl, {
            id: cs.id,
            title: cs.title,
            tags: cs.tags,
            negativeTags: cs.negativeTags || [],
            type: 'custom',
        });
    } else {
        // Built-in section — resolve current title + effects + negative tags
        const def = SECTION_DEFINITIONS.find(s => s.key === sectionId);
        if (!def) return;
        const title = resolveBuiltInTitle(def);
        const effects = resolveBuiltInEffects(def);
        const neg = resolveBuiltInNegativeTags(def);
        showEditTagsForSection(sectionEl, {
            id: sectionId,
            title,
            tags: effects,
            negativeTags: neg,
            type: 'builtin',
        });
    }
}

/** Show inline tag picker for an existing section, pre-populated with its current tags. */
function showEditTagsForSection(
    sectionEl: HTMLElement,
    cs: { id: string; title: string; tags: string[]; negativeTags: string[]; type: 'builtin' | 'custom' },
): void {
    // Remove any existing picker in this section
    sectionEl.querySelector('.stream-tag-picker-inline')?.remove();

    const { effects, substanceClasses } = collectAvailableTags();
    const selectedTags = new Set<string>(cs.tags);
    const negTags = new Set<string>(cs.negativeTags);

    const pickerEl = document.createElement('div');
    pickerEl.className = 'stream-tag-picker-inline';

    // Editable title
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'stream-section-title-edit stream-inline-edit-name';
    titleInput.value = cs.title;

    const matchLabel = document.createElement('span');
    matchLabel.className = 'stream-tag-match-count';
    matchLabel.textContent = `${countMatchingProtocols([...selectedTags], [...negTags])} protocols match`;

    const headerRow = document.createElement('div');
    headerRow.className = 'stream-section-header';
    headerRow.appendChild(titleInput);
    headerRow.appendChild(matchLabel);

    pickerEl.appendChild(headerRow);

    // Tag chips (3-state)
    const tagsDiv = document.createElement('div');
    tagsDiv.innerHTML = buildTagPickerHtml(effects, substanceClasses, selectedTags, negTags);
    pickerEl.appendChild(tagsDiv.firstElementChild!);

    // Action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'stream-tag-actions';
    actionsDiv.innerHTML =
        `<button class="stream-tag-done-btn">Save</button>` + `<button class="stream-tag-cancel-btn">Cancel</button>`;
    pickerEl.appendChild(actionsDiv);

    // Insert after the section header
    const header = sectionEl.querySelector('.stream-section-header');
    if (header) {
        header.after(pickerEl);
    } else {
        sectionEl.prepend(pickerEl);
    }

    // Hide the cards row while editing
    const rowWrap = sectionEl.querySelector('.stream-section-row-wrap') as HTMLElement | null;
    if (rowWrap) rowWrap.style.display = 'none';

    // Hide the original header
    if (header) (header as HTMLElement).style.display = 'none';

    titleInput.focus();

    // Wire 3-state tag chips
    const updateLabel = () => {
        const count = countMatchingProtocols([...selectedTags], [...negTags]);
        matchLabel.textContent = count === 1 ? '1 protocol matches' : `${count} protocols match`;
    };
    wireTagChips(pickerEl, selectedTags, negTags, updateLabel);

    // Save
    actionsDiv.querySelector('.stream-tag-done-btn')?.addEventListener('click', () => {
        const newTitle = titleInput.value.trim() || cs.title;
        const newTags = [...selectedTags];
        const newNeg = [...negTags];

        if (cs.type === 'custom') {
            void patchCustomSection(cs.id, {
                title: newTitle,
                tags: newTags,
                negativeTags: newNeg.length > 0 ? newNeg : undefined,
            }).then(() => rerenderStreamImmediate());
        } else {
            // Built-in section — persist overrides to filesystem
            void setBuiltinSectionOverrides(cs.id, {
                title: newTitle,
                effects: newTags,
                negativeTags: newNeg,
            });
            rerenderStreamImmediate();
        }
    });

    // Cancel
    actionsDiv.querySelector('.stream-tag-cancel-btn')?.addEventListener('click', () => {
        pickerEl.remove();
        if (rowWrap) rowWrap.style.display = '';
        if (header) (header as HTMLElement).style.display = '';
    });

    // Scroll into view
    requestAnimationFrame(() => {
        pickerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

// ── Tag Picker & Add Category ─────────────────────────────────────────

/** Collect all available tags for the category tag picker. */
function collectAvailableTags(): { effects: string[]; substanceClasses: string[] } {
    const effectSet = new Set<string>();
    const classSet = new Set<string>();

    // From saved cycles
    for (const entry of getCycleIndex()) {
        for (const t of entry.topEffects || []) effectSet.add(t);
        for (const c of entry.substanceClasses || []) classSet.add(c);
    }

    // From BADGE_EFFECT_MAP (static curated effects)
    for (const def of BADGE_EFFECT_MAP) {
        for (const e of def.effects) effectSet.add(e);
    }

    // From SUBSTANCE_DB (all substance classes)
    for (const key of Object.keys(SUBSTANCE_DB)) {
        const sub = SUBSTANCE_DB[key];
        if (sub?.class) classSet.add(sub.class);
    }

    const effects = [...effectSet].sort((a, b) => a.localeCompare(b));
    const substanceClasses = [...classSet].sort((a, b) => a.localeCompare(b));
    return { effects, substanceClasses };
}

/** Count how many protocols match a given set of tags (with optional exclusions). */
function countMatchingProtocols(tags: string[], negativeTags?: string[]): number {
    return matchCustomSection(getCycleIndex(), tags, negativeTags).length;
}

function showAddCategoryForm(): void {
    if (!_gridEl) return;

    // Remove any existing form
    _gridEl.querySelector('.stream-add-category-form')?.remove();

    const { effects, substanceClasses } = collectAvailableTags();
    const selectedTags = new Set<string>();
    const negativeTags = new Set<string>();

    const formEl = document.createElement('div');
    formEl.className = 'stream-add-category-form stream-section';

    formEl.innerHTML =
        `<div class="stream-section-header">` +
        `<input type="text" class="stream-section-title-edit stream-new-category-name" placeholder="Category name..." autofocus />` +
        `<span class="stream-tag-match-count">0 protocols match</span>` +
        `</div>` +
        buildTagPickerHtml(effects, substanceClasses, selectedTags, negativeTags) +
        `<div class="stream-tag-actions">` +
        `<button class="stream-tag-done-btn">Done</button>` +
        `<button class="stream-tag-cancel-btn">Cancel</button>` +
        `</div>`;

    // Insert before the "Add Category" button wrapper
    const addWrap = _gridEl.querySelector('.stream-add-category-wrap');
    if (addWrap) {
        addWrap.before(formEl);
    } else {
        _gridEl.appendChild(formEl);
    }

    // Make the form visible (it's a .stream-section which starts at opacity 0)
    formEl.style.opacity = '1';
    formEl.style.transform = 'none';

    // Scroll to the form and focus the name input
    requestAnimationFrame(() => {
        formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const nameInput = formEl.querySelector('.stream-new-category-name') as HTMLInputElement;
    nameInput?.focus();

    // Wire up 3-state tag chips
    wireTagChips(formEl, selectedTags, negativeTags, () => updateMatchCount(formEl, selectedTags, negativeTags));

    // Done button
    formEl.querySelector('.stream-tag-done-btn')?.addEventListener('click', () => {
        const title = nameInput?.value.trim();
        if (!title) {
            nameInput?.focus();
            return;
        }
        if (selectedTags.size === 0) return;

        const id = `cs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const negArray = negativeTags.size > 0 ? [...negativeTags] : undefined;
        void saveCustomSection({ id, title, tags: [...selectedTags], negativeTags: negArray }).then(() => {
            formEl.remove();
            rerenderStreamImmediate();
        });
    });

    // Cancel button
    formEl.querySelector('.stream-tag-cancel-btn')?.addEventListener('click', () => {
        formEl.remove();
    });

    // Enter on name input → move focus to tag area
    nameInput?.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            formEl.querySelector<HTMLElement>('.stream-tag-chip')?.focus();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            formEl.remove();
        }
    });
}

function chipClass(tag: string, selected: Set<string>, negative: Set<string>): string {
    if (negative.has(tag)) return 'stream-tag-chip negative';
    if (selected.has(tag)) return 'stream-tag-chip selected';
    return 'stream-tag-chip';
}

function buildTagPickerHtml(
    effects: string[],
    substanceClasses: string[],
    selectedTags: Set<string>,
    negativeTags: Set<string>,
): string {
    const effectChips = effects
        .map(
            t =>
                `<button class="${chipClass(t, selectedTags, negativeTags)}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`,
        )
        .join('');
    const classChips = substanceClasses
        .map(
            c =>
                `<button class="${chipClass(c, selectedTags, negativeTags)}" data-tag="${escapeHtml(c)}">${escapeHtml(c)}</button>`,
        )
        .join('');

    return (
        `<div class="stream-tag-picker">` +
        `<div class="stream-tag-group">` +
        `<span class="stream-tag-group-label">Effects</span>` +
        `<div class="stream-tag-chips">${effectChips}</div>` +
        `</div>` +
        `<div class="stream-tag-group">` +
        `<span class="stream-tag-group-label">Substance Class</span>` +
        `<div class="stream-tag-chips">${classChips}</div>` +
        `</div>` +
        `</div>`
    );
}

/** Wire 3-state toggle on all tag chips inside a container: none → selected → negative → none. */
function wireTagChips(
    container: HTMLElement,
    selectedTags: Set<string>,
    negativeTags: Set<string>,
    onUpdate: () => void,
): void {
    container.querySelectorAll<HTMLElement>('.stream-tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const tag = chip.dataset.tag || '';
            if (negativeTags.has(tag)) {
                // negative → none
                negativeTags.delete(tag);
                chip.classList.remove('negative');
            } else if (selectedTags.has(tag)) {
                // selected → negative
                selectedTags.delete(tag);
                negativeTags.add(tag);
                chip.classList.remove('selected');
                chip.classList.add('negative');
            } else {
                // none → selected
                selectedTags.add(tag);
                chip.classList.add('selected');
            }
            onUpdate();
        });
    });
}

function updateMatchCount(formEl: HTMLElement, selectedTags: Set<string>, negativeTags: Set<string>): void {
    const count = countMatchingProtocols([...selectedTags], [...negativeTags]);
    const label = formEl.querySelector('.stream-tag-match-count');
    if (label) {
        label.textContent = count === 1 ? '1 protocol matches' : `${count} protocols match`;
    }
}

// ── Substance Class Backfill ──────────────────────────────────────────

async function backfillSubstanceClasses(entries: SavedCycleIndexEntry[]): Promise<void> {
    for (const entry of entries) {
        try {
            const bundle = await loadCycleBundle(entry.id);
            if (!bundle) continue;
            const ivPayload = (bundle.stages as any)?.['intervention-model']?.payload;
            const ivList: any[] = ivPayload?.interventions || [];
            const classes = [...new Set(ivList.map((iv: any) => SUBSTANCE_DB[iv.key]?.class).filter(Boolean))];
            if (classes.length === 0) continue;

            entry.substanceClasses = classes;
            await patchCycle(entry.id, { substanceClasses: classes });
        } catch {
            // Silent
        }
    }
}

// ── Load Cycle ─────────────────────────────────────────────────────────

async function handleStreamLoad(id: string): Promise<void> {
    const index = getCycleIndex();
    const entry = index.find(e => e.id === id);
    if (!entry) return;

    try {
        const bundle = await loadCycleBundle(id);
        if (!bundle) return;

        settingsStore.setString(STORAGE_KEYS.maxEffects, String(entry.maxEffects));
        setLoadedCycleId(id);
        setLoadedCyclePrompt(entry.prompt, entry.rxMode);
        LLMCache.loadBundle(bundle);

        const payload = {
            prompt: entry.prompt,
            rxMode: entry.rxMode,
            timestamp: Date.now(),
            openAtLxReady: true,
        };
        sessionSettingsStore.setJson('lx_studio_pending_prompt_after_hard_reset_v1', payload);

        // Switch to design mode so the loaded cycle lands at the Lx gate
        settingsStore.setString(STORAGE_KEYS.appMode, 'design');
        window.location.hash = 'design';
        window.location.reload();
    } catch {
        // Silent
    }
}

// ── Lazy Icon Regen ────────────────────────────────────────────────────

async function regenIconsSequentially(queue: { entry: SavedCycleIndexEntry; el: HTMLElement }[]): Promise<void> {
    for (const { entry, el } of queue) {
        try {
            const bundle = await loadCycleBundle(entry.id);
            if (!bundle) continue;
            const wide = isWideCard(entry);
            const svg = wide ? generateWideIconFromBundle(bundle) : generateCycleIconFromBundle(bundle);
            if (!svg) {
                // Fallback for wide: try narrow generator
                if (wide) {
                    const fallback = generateCycleIconFromBundle(bundle);
                    if (fallback) {
                        el.innerHTML = fallback;
                        entry.iconSvg = fallback;
                        await patchCycle(entry.id, { iconSvg: fallback });
                    }
                }
                continue;
            }
            el.innerHTML = svg;
            entry.iconSvg = svg;
            await patchCycle(entry.id, { iconSvg: svg });
        } catch {
            // Silent
        }
    }
}

// ── Device Backfill ────────────────────────────────────────────────────

async function backfillDevices(entries: SavedCycleIndexEntry[]): Promise<void> {
    for (const entry of entries) {
        try {
            const bundle = await loadCycleBundle(entry.id);
            if (!bundle) continue;
            const bioRecPayload = (bundle.stages as any)?.['biometric-rec-model']?.payload;
            const devices: string[] =
                bioRecPayload && Array.isArray(bioRecPayload.recommended) ? bioRecPayload.recommended : [];
            if (devices.length === 0) continue;

            entry.recommendedDevices = devices;
            await patchCycle(entry.id, { recommendedDevices: devices } as any);

            // Update all cards for this entry in the DOM (could be in multiple sections)
            if (!_gridEl) continue;
            const cards = _gridEl.querySelectorAll(`.cg-card[data-cycle-id="${CSS.escape(entry.id)}"]`);
            cards.forEach(card => {
                if (card.querySelector('.cg-card-devices')) return; // Already has icons
                const html = renderDeviceIcons(devices);
                if (html) card.insertAdjacentHTML('beforeend', html);
            });
        } catch {
            // Silent
        }
    }
}
