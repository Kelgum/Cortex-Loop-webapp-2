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
} from './cycle-store';
import type { SavedCycleIndexEntry } from './cycle-store';
import { generateCycleIconFromBundle } from './cycle-icon';
import { LLMCache } from './llm-cache';
import { settingsStore, sessionSettingsStore, STORAGE_KEYS } from './settings-store';
import { BIOMETRIC_DEVICES } from './biometric-devices';
import { BADGE_CATEGORIES, BADGE_CATEGORY_CSS, type BadgeCategory } from './constants';
import { getCustomSections, saveCustomSection, patchCustomSection, deleteCustomSection } from './custom-sections-store';
import type { CustomSectionEntry } from './custom-sections-store';
import { SUBSTANCE_DB } from './substances';

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
        effects: ['Focus', 'Executive Function', 'Alertness', 'Attention', 'Dopaminergic', 'Wakefulness'],
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
        ],
    },
    {
        key: 'mood',
        title: 'Mood & Stress',
        effects: ['Stress', 'Mood Stability', 'Mood Regulation', 'Craving', 'Withdrawal', 'Nausea'],
    },
    {
        key: 'hormonal',
        title: 'Hormonal & Thermal',
        effects: ['Estrogen Balance', 'Vasomotor Stability', 'Thermoregulation'],
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
        <button class="mode-tab" data-mode="design">Design</button>
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
            if (getCycleCount() > 0) {
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
    window.dispatchEvent(new CustomEvent('cortex:app-mode-changed', { detail: { mode } }));
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
            morphPrompt();
            renderStreamContent('');

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

            if (animated && gridContainer) {
                gridContainer.classList.add('stream-exiting');
                gridContainer.classList.remove('stream-visible');

                gridContainer.querySelectorAll('.stream-section').forEach(s => s.classList.remove('section-enter'));
                gridContainer.querySelectorAll('.cg-card').forEach(c => c.classList.remove('card-enter'));

                setTimeout(() => {
                    document.body.classList.remove('mode-stream');
                    document.body.classList.add('mode-design');
                    gridContainer.classList.remove('stream-exiting');
                    morphPrompt();
                }, 280);
            } else {
                document.body.classList.remove('mode-stream');
                document.body.classList.add('mode-design');
                gridContainer?.classList.remove('stream-visible', 'stream-exiting');
                gridContainer?.querySelectorAll('.stream-section').forEach(s => s.classList.remove('section-enter'));
                gridContainer?.querySelectorAll('.cg-card').forEach(c => c.classList.remove('card-enter'));
                morphPrompt();
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
            : 'No protocols saved yet — switch to Design to create your first';
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

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
            return `<img class="cg-card-device-icon" src="${src}" data-src-dark="${dev.iconDark}" data-src-light="${dev.iconLight}" alt="${escHtml(dev.name)}" title="${escHtml(dev.name)}" width="20" height="20" />`;
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
        ],
    },
    {
        label: 'CARDIO',
        cssClass: 'badge-cardio',
        effects: ['Appetite', 'Appetite Suppression', 'Gastric Emptying'],
    },
    {
        label: 'MOOD',
        cssClass: 'badge-mood',
        effects: ['Stress', 'Mood Stability', 'Mood Regulation', 'Craving', 'Withdrawal', 'Nausea'],
    },
    {
        label: 'HORMONAL',
        cssClass: 'badge-cardio',
        effects: ['Estrogen Balance', 'Vasomotor Stability', 'Thermoregulation'],
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

function getTitleColor(entry: SavedCycleIndexEntry): string {
    const prominentBand = getProminentBandTitleColor(entry.iconSvg);
    if (prominentBand) return prominentBand;

    return getSemanticTitleColor(entry);
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

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
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

function getOverlayTitleClass(overlayTitle: string): string {
    const normalized = overlayTitle.trim();
    const charCount = normalized.length;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;

    if (charCount <= 10 && wordCount <= 2) return ' title-short';
    if (charCount >= 21 || wordCount >= 4) return ' title-xlong';
    if (charCount >= 13 || wordCount >= 3) return ' title-long';
    return '';
}

// ── Card Builder ───────────────────────────────────────────────────────

function buildCardHtml(entry: SavedCycleIndexEntry, activeId: string | null): string {
    const isActive = entry.id === activeId;
    const effectStr = entry.maxEffects === 1 ? '1 effect' : '2 effects';
    const dateStr = formatDate(entry.savedAt);
    const prompt = entry.prompt ? escHtml(entry.prompt.slice(0, 80)) + (entry.prompt.length > 80 ? '...' : '') : '';
    const iconHtml = entry.iconSvg
        ? entry.iconSvg
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">` +
          `<rect class="ci-bg" width="200" height="120" rx="8"/>` +
          `<text class="ci-day" x="100" y="65" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.12)">${entry.maxEffects}</text>` +
          `</svg>`;

    const badges = computeBadges(entry);
    const badgesHtml = buildBadgesHtml(badges);
    const overlayTitleText = formatOverlayTitle(entry.filename);
    const overlayTitleClass = getOverlayTitleClass(overlayTitleText);
    const overlayTitle = escHtml(overlayTitleText);
    const titleColor = getTitleColor(entry);
    const deviceIconsHtml = renderDeviceIcons(entry.recommendedDevices);

    const isRx = entry.rxMode === 'rx' || entry.rxMode === 'rx-only';
    const rxHtml = isRx ? `<span class="cg-card-rx">Rx</span>` : '';

    return (
        `<div class="cg-card${isActive ? ' cg-card-active' : ''}" data-cycle-id="${escHtml(entry.id)}">` +
        `<div class="cg-card-icon">` +
        iconHtml +
        badgesHtml +
        `<div class="cg-card-overlay-title${overlayTitleClass}" style="color:${titleColor}">${overlayTitle}</div>` +
        rxHtml +
        `</div>` +
        `<h3 class="cg-card-name">${escHtml(entry.filename)}</h3>` +
        (prompt ? `<p class="cg-card-prompt">${prompt}</p>` : '') +
        `<div class="cg-card-meta">${effectStr} · ${isActive ? 'loaded' : dateStr}</div>` +
        deviceIconsHtml +
        `</div>`
    );
}

// ── Content Orchestrator ───────────────────────────────────────────────

/** Re-render and immediately reveal all sections/cards (no stagger animation). */
function rerenderStreamImmediate(): void {
    const input = document.getElementById('prompt-input') as HTMLInputElement | null;
    renderStreamContent(input?.value || '');
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
}

// ── Netflix Sections (browse mode) ─────────────────────────────────────

/** Resolve the display title for a built-in section (supports user renames). */
function resolveBuiltInTitle(section: { key: string; title: string }): string {
    const overrides = settingsStore.getJson<Record<string, string>>(STORAGE_KEYS.customSectionTitles, {});
    return overrides?.[section.key] || section.title;
}

/** Resolve effects for a built-in section (supports user overrides via localStorage). */
function resolveBuiltInEffects(section: { key: string; effects: string[] }): string[] {
    const overrides = settingsStore.getJson<Record<string, string[]>>(STORAGE_KEYS.customSectionEffects, {});
    return overrides?.[section.key] || section.effects;
}

/** Resolve negative tags for a built-in section (stored in localStorage). */
function resolveBuiltInNegativeTags(section: { key: string }): string[] {
    const overrides = settingsStore.getJson<Record<string, string[]>>(STORAGE_KEYS.customSectionNegativeTags, {});
    return overrides?.[section.key] || [];
}

/** Match cards to a section via topEffects OR substanceClasses, excluding negative tags. */
function matchCustomSection(
    index: SavedCycleIndexEntry[],
    tags: string[],
    negativeTags?: string[],
): SavedCycleIndexEntry[] {
    if (tags.length === 0) return [];
    const tagSet = new Set(tags);
    const negSet = new Set(negativeTags || []);
    return index.filter(e => {
        const allTags = [...(e.topEffects || []), ...(e.substanceClasses || [])];
        const included = allTags.some(t => tagSet.has(t));
        if (!included) return false;
        if (negSet.size === 0) return true;
        const excluded = allTags.some(t => negSet.has(t));
        return !excluded;
    });
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
        _gridEl.innerHTML = `<div class="stream-empty">No protocols yet. Switch to <strong>Design</strong> to create your first.</div>`;
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

            if (section.key === 'recent') {
                entries = [...index].sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')).slice(0, 6);
            } else {
                const resolvedNeg = resolveBuiltInNegativeTags(section);
                entries = matchCustomSection(index, resolvedEffects, resolvedNeg);
            }

            if (entries.length === 0) continue;
            title = resolveBuiltInTitle(section);
            sectionEditHtml = _editMode && section.key !== 'recent' ? editTagsHtml : '';
        } else {
            const cs = customMap.get(key);
            if (!cs) continue;
            entries = matchCustomSection(index, cs.tags, cs.negativeTags);
            if (entries.length === 0 && !_editMode) continue;
            title = cs.title;
            sectionEditHtml = editTagsHtml;
            sectionDeleteHtml = deleteHtml;
        }

        const cardsHtml = entries.map(e => buildCardHtml(e, activeId)).join('');
        const countLabel = entries.length === 1 ? '1 protocol' : `${entries.length} protocols`;
        const moveHtml = _editMode ? `<span class="stream-section-move-group">${moveUpHtml}${moveDownHtml}</span>` : '';

        sectionsHtml.push(
            `<div class="stream-section" data-section="${escHtml(key)}" data-section-type="${sectionType}">` +
                `<div class="stream-section-header">` +
                `<h2 class="stream-section-title">${escHtml(title)}</h2>` +
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
        _gridEl.innerHTML = `<div class="stream-empty">No protocols yet. Switch to <strong>Design</strong> to create your first.</div>`;
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
        if (!seenForRegen.has(entry.id) && (!entry.iconSvg || !entry.iconSvg.includes('data-v="10"'))) {
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
                ? 'No protocols yet. Switch to <strong>Design</strong> to create your first.'
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

    const card = target.closest('.cg-card') as HTMLElement | null;
    if (!card) return;
    const id = card.dataset.cycleId;
    if (!id) return;

    if (_editMode) {
        e.preventDefault();
        e.stopPropagation();
        enterCardEdit(card, id);
    } else {
        void handleStreamLoad(id);
    }
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

    const newName = nameInput?.value.trim() || nameInput?.dataset.original || '';
    const newPrompt = promptInput?.value.trim() || promptInput?.dataset.original || '';

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

    // Update the overlay title on the thumbnail
    const overlayEl = card.querySelector('.cg-card-overlay-title');
    if (overlayEl) {
        overlayEl.textContent = formatOverlayTitle(entry.filename);
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
        // Built-in section rename — store in localStorage
        const overrides = settingsStore.getJson<Record<string, string>>(STORAGE_KEYS.customSectionTitles, {}) || {};
        overrides[sectionKey] = newTitle;
        settingsStore.setJson(STORAGE_KEYS.customSectionTitles, overrides);
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
            // Built-in section — save overrides to localStorage
            const titleOverrides =
                settingsStore.getJson<Record<string, string>>(STORAGE_KEYS.customSectionTitles, {}) || {};
            titleOverrides[cs.id] = newTitle;
            settingsStore.setJson(STORAGE_KEYS.customSectionTitles, titleOverrides);

            const effectOverrides =
                settingsStore.getJson<Record<string, string[]>>(STORAGE_KEYS.customSectionEffects, {}) || {};
            effectOverrides[cs.id] = newTags;
            settingsStore.setJson(STORAGE_KEYS.customSectionEffects, effectOverrides);

            const negOverrides =
                settingsStore.getJson<Record<string, string[]>>(STORAGE_KEYS.customSectionNegativeTags, {}) || {};
            negOverrides[cs.id] = newNeg;
            settingsStore.setJson(STORAGE_KEYS.customSectionNegativeTags, negOverrides);

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
                `<button class="${chipClass(t, selectedTags, negativeTags)}" data-tag="${escHtml(t)}">${escHtml(t)}</button>`,
        )
        .join('');
    const classChips = substanceClasses
        .map(
            c =>
                `<button class="${chipClass(c, selectedTags, negativeTags)}" data-tag="${escHtml(c)}">${escHtml(c)}</button>`,
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
        sessionSettingsStore.setJson('cortex_pending_prompt_after_hard_reset_v1', payload);

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
            const svg = generateCycleIconFromBundle(bundle);
            if (!svg) continue;
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
