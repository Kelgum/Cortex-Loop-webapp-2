/**
 * Cycle UI — Save / Load / Delete / Break-from-cache controls.
 *
 * Save button appears right of the prompt input after a full live cycle completes.
 * Saved cycles are listed in the settings popover; clicking one reloads from cache.
 * Break button lets the user leave cache replay and continue live.
 */

import { LLMCache } from './llm-cache';
import { PhaseState, AppState, MultiDayState } from './state';
import { settingsStore, sessionSettingsStore, STORAGE_KEYS } from './settings-store';
import { generateCycleIconSvg, generateCycleIconFromBundle, generateWideIconFromBundle } from './cycle-icon';
import {
    getCycleIndex,
    saveCycle,
    loadCycleBundle,
    deleteCycle,
    renameCycle,
    patchCycle,
    setLoadedCycleId,
    setLoadedCyclePrompt,
    getLoadedCycleId,
    clearLoadedCycleId,
    initCycleStore,
} from './cycle-store';
import type { SavedCycleRecord } from './cycle-store';
import { SUBSTANCE_DB } from './substances';
import { initCustomSectionsStore } from './custom-sections-store';
import { initSectionOrder } from './mode-switcher';
import { initBuiltinOverridesStore } from './builtin-overrides-store';
import { compute7DEffectScores, computeDesignEffectScores, EFFECT_SCORE_FORMULA_VERSION } from './effect-score';
import { computeProtocolConfidence, CONFIDENCE_FORMULA_VERSION } from './protocol-confidence';
import { getAgentById } from './creator-agents/index';

let _saveBtn: HTMLButtonElement | null = null;
let _cycleList: HTMLElement | null = null;
let _unsubCache: (() => void) | null = null;
let _phaseJumpInited = false;
let _phaseJumpHoverTimer: number | null = null;

function syncReplayMode(): void {
    const isReplay = !!PhaseState.loadedCycleId;
    document.body.classList.toggle('replay-mode', isReplay);
    if (!isReplay) {
        document.body.classList.remove('show-phase-jump');
    }
}

const PHASE_JUMP_PINNED_KEY = 'lx_studio_phase_jump_pinned';

function getPinnedPhase(): number | null {
    const raw = sessionSettingsStore.getString(PHASE_JUMP_PINNED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function updateActivePhaseTab(): void {
    const tabs = document.querySelectorAll<HTMLButtonElement>('.phase-jump-tab');
    const pinned = getPinnedPhase();
    const current = pinned != null ? pinned : PhaseState.viewingPhase;
    tabs.forEach(tab => {
        const idx = Number(tab.dataset.phase);
        tab.classList.toggle('is-active', idx === current);
    });
}

function initPhaseJumpBand(): void {
    if (_phaseJumpInited) return;
    const wrap = document.querySelector<HTMLElement>('.prompt-form-wrap');
    const band = document.getElementById('phase-jump-band');
    if (!wrap || !band) return;
    _phaseJumpInited = true;

    const show = () => {
        if (!PhaseState.loadedCycleId) return;
        if (_phaseJumpHoverTimer !== null) {
            window.clearTimeout(_phaseJumpHoverTimer);
            _phaseJumpHoverTimer = null;
        }
        document.body.classList.add('show-phase-jump');
        updateActivePhaseTab();
    };
    const hide = () => {
        if (_phaseJumpHoverTimer !== null) {
            window.clearTimeout(_phaseJumpHoverTimer);
        }
        _phaseJumpHoverTimer = window.setTimeout(() => {
            document.body.classList.remove('show-phase-jump');
        }, 400);
    };

    // Single hover zone: .prompt-form-wrap contains the form AND the band
    // (the band is a child of .prompt-form-wrap), so moving the cursor among
    // field / tabs / spaces between never leaves the hover zone.
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('mouseleave', hide);

    band.addEventListener('click', e => {
        const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.phase-jump-tab');
        if (!target) return;
        const phase = Number(target.dataset.phase);
        if (!Number.isFinite(phase)) return;
        // Same mechanism as the settings "Start at phase" dropdown:
        // persist turboTargetPhase and reload — the loaded cycle auto-submits
        // and the pipeline turbo-skips to the selected phase using cached data.
        AppState.turboTargetPhase = phase;
        settingsStore.setString(STORAGE_KEYS.startAtPhase, String(phase));
        sessionSettingsStore.setString(PHASE_JUMP_PINNED_KEY, String(phase));
        updateActivePhaseTab();
        window.location.reload();
    });
}

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

// ── Save Button ──────────────────────────────────────────────────────

function updateSaveButtonVisibility(): void {
    if (!_saveBtn) return;
    const isLiveRun = !PhaseState.loadedCycleId;
    const hasComplete = LLMCache.hasCompleteFlow();
    const isExtended = PhaseState.timeHorizon && PhaseState.timeHorizon.mode !== 'daily';
    const cycleActuallyRan = PhaseState.maxPhaseReached >= 5 || !!isExtended;
    const alreadySaved = _saveBtn.classList.contains('saved');
    if (isLiveRun && hasComplete && cycleActuallyRan && !alreadySaved) {
        _saveBtn.style.display = '';
    } else {
        _saveBtn.style.display = 'none';
    }
}

async function handleSave(): Promise<void> {
    if (!_saveBtn || _saveBtn.classList.contains('saved')) return;
    const bundle = (LLMCache as any)._bundle;
    if (!bundle) return;

    const id = `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filename =
        PhaseState.cycleFilename || (PhaseState.userGoal ? PhaseState.userGoal.slice(0, 40).trim() : 'Untitled Cycle');
    // topEffects feeds SECTION MATCHING in mode-switcher.ts (matchCustomSection
    // filters saved cycles by topEffects/substanceClasses against category tag
    // lists like "Focus", "Alertness"). Keep it sourced from the Scout word cloud
    // so those broader category tags survive into the saved entry — replacing
    // them with Strategist curve names would strip cycles out of their categories.
    const topEffects = (PhaseState.wordCloudEffects || PhaseState.effects || [])
        .slice(0, 3)
        .map((e: any) => (typeof e === 'string' ? e : e.name || ''));

    // curveEffects / curveColors / curvePolarities are three parallel arrays
    // aligned 1:1 with effectScores indices (max 2). Walk curvesData once so
    // they stay in lockstep if any entry is dropped for missing fields.
    //   - curveEffects  → big %-label curve name on the stream card
    //   - curveColors   → per-score color (avoids falling through to a shared
    //                     badge-category color when two curves belong to the
    //                     same category)
    //   - curvePolarities → sign of the %-label (`−` for higher_is_worse, so
    //                     "reduce gastric distress by 63%" doesn't render as
    //                     "+63% GASTRIC DISTRESS" and look like an increase)
    const curveEffects: string[] = [];
    const curveColors: string[] = [];
    const curvePolarities: string[] = [];
    for (const c of (PhaseState.curvesData || []).slice(0, 2)) {
        const effect = c && typeof c.effect === 'string' ? c.effect : '';
        if (!effect) continue;
        curveEffects.push(effect);
        curveColors.push(c && typeof c.color === 'string' ? c.color : '');
        curvePolarities.push(c && c.polarity === 'higher_is_worse' ? 'higher_is_worse' : 'higher_is_better');
    }

    const isExtendedCycle = PhaseState.timeHorizon && PhaseState.timeHorizon.mode !== 'daily';
    // For extended (28-day) cycles, try the panoramic wide icon first
    let iconSvg: string | null = null;
    if (isExtendedCycle) {
        iconSvg = generateWideIconFromBundle(bundle);
    }
    if (!iconSvg) {
        iconSvg = generateCycleIconSvg(MultiDayState.days, PhaseState.curvesData || []);
    }

    // Extract recommended biometric devices from the Spotter stage
    const bioRecPayload = bundle.stages?.['biometric-rec-model']?.payload;
    const recommendedDevices: string[] =
        bioRecPayload && Array.isArray(bioRecPayload.recommended) ? bioRecPayload.recommended : [];

    // Extract unique substance classes from the intervention protocol
    // Fallback to extended intervention stage if daily one is missing
    const ivPayload =
        bundle.stages?.['intervention-model']?.payload || bundle.stages?.['extended-intervention']?.payload;
    const ivList: any[] = ivPayload?.interventions || [];
    const substanceClasses = [
        ...new Set(
            ivList
                .map((iv: any) => {
                    const sub = SUBSTANCE_DB[iv.key];
                    return sub?.class || null;
                })
                .filter(Boolean) as string[],
        ),
    ];

    // Pre-compute effect scores — prefer 7D multi-day pipeline, fall back to 24h design state
    let effectScores: number[] | undefined;
    if (MultiDayState.days && MultiDayState.days.length >= 2 && PhaseState.curvesData) {
        effectScores = compute7DEffectScores(MultiDayState.days, PhaseState.curvesData);
    } else if (PhaseState.lxCurves && PhaseState.curvesData) {
        effectScores = computeDesignEffectScores(PhaseState.lxCurves, PhaseState.curvesData);
    }
    if (effectScores && !effectScores.some(s => s > 0)) effectScores = undefined;

    // Aggregate protocol confidence from per-substance dataConfidence tiers
    const ivKeys = ivList.map((iv: any) => iv.key).filter(Boolean);
    const confidenceResult = computeProtocolConfidence(ivKeys);

    // Headlining KOL agent — pulled from the agent-match-model bundle stage
    // so the Stream gallery can render the creator strip without loading
    // the full bundle.
    let creatorHandle: string | undefined;
    let avatarUrl: string | undefined;
    let creatorName: string | undefined;
    const matchPayload = bundle.stages?.['agent-match-model']?.payload;
    const topAgentId: string | undefined = matchPayload?.ranked?.[0]?.agentId;
    if (topAgentId) {
        const agent = getAgentById(topAgentId);
        if (agent) {
            creatorHandle = agent.meta.creatorHandle;
            avatarUrl = agent.meta.avatarUrl;
            creatorName = agent.meta.creatorName || agent.meta.name;
        }
    }

    const record: SavedCycleRecord = {
        id,
        filename,
        prompt: PhaseState.userGoal || '',
        maxEffects: AppState.maxEffects === 1 ? 1 : 2,
        rxMode: AppState.rxMode || 'off',
        createdAt: bundle.createdAt || new Date().toISOString(),
        savedAt: new Date().toISOString(),
        hookSentence: PhaseState.hookSentence || null,
        topEffects,
        curveEffects: curveEffects.length > 0 ? curveEffects : undefined,
        curveColors: curveColors.length > 0 ? curveColors : undefined,
        curvePolarities: curvePolarities.length > 0 ? curvePolarities : undefined,
        badgeCategory: PhaseState.badgeCategory || null,
        iconSvg,
        recommendedDevices,
        substanceClasses,
        timeHorizon: PhaseState.timeHorizon || undefined,
        effectScores,
        effectScoresVersion: effectScores ? EFFECT_SCORE_FORMULA_VERSION : undefined,
        protocolConfidence: confidenceResult?.score,
        confidenceVersion: confidenceResult ? CONFIDENCE_FORMULA_VERSION : undefined,
        creatorHandle,
        avatarUrl,
        creatorName,
        bundle,
    };

    try {
        await saveCycle(record);
        _saveBtn.classList.add('saved');
        renderCycleList();
    } catch (err) {
        console.error('[CycleUI] Save failed:', err);
    }
}

// Break-from-cache functionality removed — the submit arrow is simply
// dimmed (via body.replay-mode CSS) while a loaded cycle is being replayed.

// ── Cycle List in Settings ───────────────────────────────────────────

function handleUnloadCycle(): void {
    clearLoadedCycleId();
    LLMCache.clearAll();
    window.location.reload();
}

function renderCycleList(): void {
    if (!_cycleList) return;
    const index = getCycleIndex();
    const activeId = getLoadedCycleId();
    _cycleList.innerHTML = '';

    const regenQueue: { entry: (typeof index)[0]; iconWrap: HTMLElement }[] = [];

    for (const entry of index) {
        const isActive = entry.id === activeId;
        const row = document.createElement('div');
        row.className = 'saved-cycle-row' + (isActive ? ' saved-cycle-active' : '');
        row.dataset.cycleId = entry.id;

        const info = document.createElement('div');
        info.className = 'saved-cycle-info';
        info.setAttribute('role', 'button');
        info.tabIndex = 0;

        const name = document.createElement('span');
        name.className = 'saved-cycle-name';
        name.textContent = entry.filename;
        name.contentEditable = 'true';
        name.spellcheck = false;

        // Rename: inline edit on the name span
        name.addEventListener('focus', e => {
            e.stopPropagation();
            const sel = window.getSelection();
            if (sel) {
                const range = document.createRange();
                range.selectNodeContents(name);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });

        name.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                name.blur();
            } else if (e.key === 'Escape') {
                name.textContent = entry.filename;
                name.blur();
            }
            // Stop Space/Enter from triggering the info click handler
            e.stopPropagation();
        });

        name.addEventListener('blur', async () => {
            const trimmed = (name.textContent || '').trim();
            if (!trimmed) {
                name.textContent = entry.filename;
                return;
            }
            if (trimmed !== entry.filename) {
                try {
                    await renameCycle(entry.id, trimmed);
                    entry.filename = trimmed;
                } catch {
                    name.textContent = entry.filename;
                }
            }
        });

        // Prevent clicks on the name from triggering load/unload
        name.addEventListener('click', e => e.stopPropagation());

        const meta = document.createElement('span');
        meta.className = 'saved-cycle-meta';
        const effectStr = entry.maxEffects === 1 ? '1 effect' : '2 effects';
        const dateStr = formatDate(entry.savedAt);
        meta.textContent = isActive ? `${effectStr} · loaded` : `${effectStr} · ${dateStr}`;

        info.appendChild(name);
        info.appendChild(meta);

        const delBtn = document.createElement('button');
        delBtn.className = 'saved-cycle-delete-btn';
        delBtn.setAttribute('aria-label', 'Delete');
        delBtn.textContent = '\u00d7';

        if (isActive) {
            info.addEventListener('click', () => handleUnloadCycle());
            info.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleUnloadCycle();
                }
            });
        } else {
            info.addEventListener('click', () => void handleLoadCycle(entry.id));
            info.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void handleLoadCycle(entry.id);
                }
            });
        }

        let confirmTimeout: ReturnType<typeof setTimeout> | null = null;
        delBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (delBtn.classList.contains('confirming')) {
                if (confirmTimeout) clearTimeout(confirmTimeout);
                void handleDeleteCycle(entry.id, row);
            } else {
                delBtn.classList.add('confirming');
                delBtn.textContent = '?';
                confirmTimeout = setTimeout(() => {
                    delBtn.classList.remove('confirming');
                    delBtn.textContent = '\u00d7';
                }, 2000);
            }
        });

        const iconWrap = document.createElement('div');
        iconWrap.className = 'saved-cycle-icon';
        if (entry.iconSvg && entry.iconSvg.includes('data-v="10"')) {
            iconWrap.innerHTML = entry.iconSvg;
        } else {
            // Fallback — queued for sequential lazy regen below
            iconWrap.innerHTML =
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">` +
                `<rect class="ci-bg" width="200" height="120" rx="8"/>` +
                `<text class="ci-day" x="100" y="65" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.12)">${entry.maxEffects}</text>` +
                `</svg>`;
            regenQueue.push({ entry, iconWrap });
        }

        row.appendChild(iconWrap);
        row.appendChild(info);
        row.appendChild(delBtn);
        _cycleList.appendChild(row);
    }

    // Kick off sequential lazy icon regeneration for entries without icons
    if (regenQueue.length > 0) {
        void regenIconsSequentially(regenQueue);
    }
}

// ── Lazy Icon Regeneration (sequential to avoid index race conditions) ──

async function regenIconsSequentially(
    queue: { entry: { id: string; iconSvg?: string | null }; iconWrap: HTMLElement }[],
): Promise<void> {
    for (const { entry, iconWrap } of queue) {
        try {
            const bundle = await loadCycleBundle(entry.id);
            if (!bundle) continue;
            const svg = generateCycleIconFromBundle(bundle);
            if (!svg) continue;
            iconWrap.innerHTML = svg;
            entry.iconSvg = svg;
            // Persist sequentially — each PATCH completes before the next starts
            await patchCycle(entry.id, { iconSvg: svg });
        } catch {
            // Silent — fallback icon remains for this entry
        }
    }
}

async function handleLoadCycle(id: string): Promise<void> {
    const index = getCycleIndex();
    const entry = index.find(e => e.id === id);
    if (!entry) return;

    try {
        const bundle = await loadCycleBundle(id);
        if (!bundle) {
            console.warn('[CycleUI] Bundle not found on server for', id);
            return;
        }

        settingsStore.setString(STORAGE_KEYS.maxEffects, String(entry.maxEffects));
        setLoadedCycleId(id);
        setLoadedCyclePrompt(entry.prompt, entry.rxMode);
        LLMCache.loadBundle(bundle);

        // Persist timeHorizon so extended cycles route correctly on reload
        if (entry.timeHorizon) {
            sessionSettingsStore.setJson('lx_studio_loaded_time_horizon', entry.timeHorizon);
        } else {
            sessionSettingsStore.remove('lx_studio_loaded_time_horizon');
        }

        // Store prompt for auto-submit after reload (sessionStorage for immediate,
        // localStorage via setLoadedCyclePrompt for subsequent refreshes)
        const payload = {
            prompt: entry.prompt,
            rxMode: entry.rxMode,
            timestamp: Date.now(),
        };
        sessionSettingsStore.setJson('lx_studio_pending_prompt_after_hard_reset_v1', payload);

        window.location.reload();
    } catch (err) {
        console.error('[CycleUI] Load failed:', err);
    }
}

async function handleDeleteCycle(id: string, row: HTMLElement): Promise<void> {
    try {
        row.style.transition = 'opacity 0.2s, transform 0.2s';
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';
        await deleteCycle(id);
        setTimeout(() => row.remove(), 200);
    } catch (err) {
        console.error('[CycleUI] Delete failed:', err);
        row.style.opacity = '';
        row.style.transform = '';
    }
}

// ── Loaded Cycle Boot Detection ──────────────────────────────────────

function applyLoadedCycleState(): void {
    const loadedId = getLoadedCycleId();
    if (!loadedId) return;

    // Verify the cycle still exists on disk (user may have deleted it)
    const index = getCycleIndex();
    const entry = index.find(e => e.id === loadedId);
    if (!entry) {
        clearLoadedCycleId();
        return;
    }

    PhaseState.loadedCycleId = loadedId;
    syncReplayMode();

    // Restore timeHorizon for extended cycles so pipeline routes correctly
    const savedHorizon = sessionSettingsStore.getJson<any>('lx_studio_loaded_time_horizon', null);
    if (savedHorizon && savedHorizon.mode && savedHorizon.mode !== 'daily') {
        PhaseState.timeHorizon = savedHorizon;
    }

    // In Stream mode the prompt input is a search bar — don't lock it
    const isStream = document.body.classList.contains('mode-stream');
    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input') as HTMLInputElement | null;
    const submit = document.getElementById('prompt-submit') as HTMLButtonElement | null;

    if (!isStream) {
        if (form) form.classList.add('prompt-loaded');
        if (input) {
            input.readOnly = true;
            input.value = entry.prompt;
        }
    }
    if (submit) submit.style.display = '';
}

// ── Init ─────────────────────────────────────────────────────────────

export async function initCycleUi(): Promise<void> {
    await Promise.all([initCycleStore(), initCustomSectionsStore(), initSectionOrder(), initBuiltinOverridesStore()]);

    // Background-fill creator metadata onto any pre-schema cycle entries so
    // the Stream view can show creator avatars/handles/stars without a manual
    // resave. Fire-and-forget — the mode-switcher listens for the update
    // event and re-renders as each batch lands.
    void import('./cycle-creator-backfill').then(m => m.backfillCreatorMetadata()).catch(() => {});

    _saveBtn = document.getElementById('cycle-save-btn') as HTMLButtonElement | null;
    _cycleList = document.getElementById('saved-cycles-list');

    if (_saveBtn) {
        _saveBtn.addEventListener('click', () => void handleSave());
    }

    _unsubCache = LLMCache.subscribe(() => {
        updateSaveButtonVisibility();
    });

    applyLoadedCycleState();
    renderCycleList();
    updateSaveButtonVisibility();
    initPhaseJumpBand();
    syncReplayMode();
}

export { _unsubCache };
