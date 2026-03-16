/**
 * Cycle UI — Save / Load / Delete / Break-from-cache controls.
 *
 * Save button appears right of the prompt input after a full live cycle completes.
 * Saved cycles are listed in the settings popover; clicking one reloads from cache.
 * Break button lets the user leave cache replay and continue live.
 */

import { LLMCache } from './llm-cache';
import { PhaseState, AppState, TimelineState } from './state';
import { settingsStore, sessionSettingsStore, STORAGE_KEYS } from './settings-store';
import {
    getCycleIndex,
    saveCycle,
    loadCycleBundle,
    deleteCycle,
    setLoadedCycleId,
    setLoadedCyclePrompt,
    getLoadedCycleId,
    clearLoadedCycleId,
    initCycleStore,
} from './cycle-store';
import type { SavedCycleRecord } from './cycle-store';
import { getCompletedStageClassesForPhase } from './cache-policy';

let _saveBtn: HTMLButtonElement | null = null;
let _breakBtn: HTMLButtonElement | null = null;
let _cycleList: HTMLElement | null = null;
let _unsubCache: (() => void) | null = null;

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
    const cycleActuallyRan = PhaseState.maxPhaseReached >= 5;
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
    const topEffects = (PhaseState.wordCloudEffects || PhaseState.effects || [])
        .slice(0, 3)
        .map((e: any) => (typeof e === 'string' ? e : e.name || ''));

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

// ── Break Button ─────────────────────────────────────────────────────

function updateBreakButtonVisibility(): void {
    if (!_breakBtn) return;
    _breakBtn.style.display = PhaseState.loadedCycleId ? '' : 'none';
    _breakBtn.disabled = !!TimelineState.interactionLocked;
}

function handleBreak(): void {
    if (!_breakBtn || !PhaseState.loadedCycleId) return;

    const allStages = LLMCache.breakFromCache();

    LLMCache.startLiveFlow();
    const completed = getCompletedStageClassesForPhase(PhaseState.maxPhaseReached);
    for (const sc of completed) {
        if (allStages[sc]) {
            LLMCache.set(sc, allStages[sc].payload, allStages[sc].meta);
        }
    }

    PhaseState.loadedCycleId = null;
    clearLoadedCycleId();

    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input') as HTMLInputElement | null;
    if (form) form.classList.remove('prompt-loaded');
    if (input) input.readOnly = false;

    const submit = document.getElementById('prompt-submit') as HTMLButtonElement | null;
    if (submit) submit.style.display = '';
    _breakBtn.style.display = 'none';
}

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

        row.appendChild(info);
        row.appendChild(delBtn);
        _cycleList.appendChild(row);
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

        // Store prompt for auto-submit after reload (sessionStorage for immediate,
        // localStorage via setLoadedCyclePrompt for subsequent refreshes)
        const payload = {
            prompt: entry.prompt,
            rxMode: entry.rxMode,
            timestamp: Date.now(),
        };
        sessionSettingsStore.setJson('cortex_pending_prompt_after_hard_reset_v1', payload);

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

    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input') as HTMLInputElement | null;
    const submit = document.getElementById('prompt-submit') as HTMLButtonElement | null;

    if (form) form.classList.add('prompt-loaded');
    if (input) {
        input.readOnly = true;
        input.value = entry.prompt;
    }
    if (submit) submit.style.display = 'none';
    if (_breakBtn) _breakBtn.style.display = '';
}

// ── Init ─────────────────────────────────────────────────────────────

export async function initCycleUi(): Promise<void> {
    await initCycleStore();

    _saveBtn = document.getElementById('cycle-save-btn') as HTMLButtonElement | null;
    _breakBtn = document.getElementById('cycle-break-btn') as HTMLButtonElement | null;
    _cycleList = document.getElementById('saved-cycles-list');

    if (_saveBtn) {
        _saveBtn.addEventListener('click', () => void handleSave());
    }
    if (_breakBtn) {
        _breakBtn.addEventListener('click', () => handleBreak());
    }

    _unsubCache = LLMCache.subscribe(() => {
        updateSaveButtonVisibility();
        updateBreakButtonVisibility();
    });

    applyLoadedCycleState();
    renderCycleList();
    updateSaveButtonVisibility();
    updateBreakButtonVisibility();
}

export { _unsubCache };
