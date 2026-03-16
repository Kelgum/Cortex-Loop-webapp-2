/**
 * Debug Panel — Collapsible debug log panel with stage filtering, JSON export, and pipeline model selector grid.
 * Exports: DebugLog
 * Depends on: constants (MODEL_OPTIONS, PROVIDER_LABELS, PROVIDER_IDS), state (AppState, switchStageProvider)
 */
import { MODEL_OPTIONS, PROVIDER_LABELS, PROVIDER_IDS } from './constants';
import { AppState, switchStageProvider } from './state';
import { settingsStore, stageModelKey } from './settings-store';
import { LLMCache } from './llm-cache';
import { PROMPTS } from './prompts';
import {
    describeStageClasses,
    disableStageCacheChain,
    enableStageCacheChain,
    getDependencyDownstreamStageClasses,
    getDependencyUpstreamStageClasses,
} from './cache-policy';
import { reportRuntimeCacheWarning } from './runtime-error-banner';

const STAGES = [
    { id: 'fast', stageClass: 'fast-model', label: 'Scout' },
    { id: 'curves', stageClass: 'main-model', label: 'Strategist' },
    { id: 'intervention', stageClass: 'intervention-model', label: 'Chess Player' },
    { id: 'sherlock', stageClass: 'sherlock-model', label: 'Sherlock' },
    { id: 'biometricRec', stageClass: 'biometric-rec-model', label: 'Spotter (Device)' },
    { id: 'biometricProfile', stageClass: 'biometric-profile-model', label: 'Spotter (Profile)' },
    { id: 'biometricChannel', stageClass: 'biometric-channel-model', label: 'Spotter (Channel)' },
    { id: 'biometric', stageClass: 'biometric-model', label: 'Spotter (Sim)' },
    { id: 'strategistBio', stageClass: 'strategist-bio-model', label: 'Strategist Bio' },
    { id: 'revision', stageClass: 'revision-model', label: 'Grandmaster' },
    { id: 'sherlockRevision', stageClass: 'sherlock-revision-model', label: 'Sherlock (Rev)' },
    { id: 'knight', stageClass: 'knight-model', label: 'Knight' },
    { id: 'spotterDaily', stageClass: 'spotter-daily-model', label: 'Spotter (7d)' },
    { id: 'strategistBioDaily', stageClass: 'strategist-bio-daily-model', label: 'Strategist Bio (7d)' },
    { id: 'grandmasterDaily', stageClass: 'grandmaster-daily-model', label: 'Grandmaster (7d)' },
];

const STAGE_LABEL_BY_CLASS: Record<string, string> = {};
STAGES.forEach(stage => {
    STAGE_LABEL_BY_CLASS[stage.stageClass] = stage.label;
});

const STAGE_PROMPT_TEMPLATE_KEY: Record<string, string> = {
    fast: 'fastModel',
    curves: 'curveModel',
    intervention: 'intervention',
    sherlock: 'sherlock',
    biometricRec: 'spotterDeviceRec',
    biometricProfile: 'spotterProfileDraft',
    biometricChannel: 'spotterChannelPick',
    biometric: 'biometric',
    revision: 'revision',
    biometricRevised: 'biometric',
    sherlockRevision: 'sherlockRevision',
    strategistBio: 'strategistBio',
    knight: 'knight',
    spotterDaily: 'spotterDaily',
    strategistBioDaily: 'strategistBioDaily',
    grandmasterDaily: 'grandmasterDaily',
};

// Some debug cards are sub-passes that reuse an existing runtime stage config.
const STAGE_MODEL_CONFIG_ALIAS: Record<string, string> = {
    // Revised bio sim currently reuses the main biometric runtime stage config.
    biometricRevised: 'biometric',
};

function resolveModelConfigStage(stageId: string): string {
    return STAGE_MODEL_CONFIG_ALIAS[stageId] || stageId;
}

// SVG chevron pointing down (rotates to point right when collapsed)
const CHEVRON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

// SVG cache/disk icon for local data toggle
const CACHE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`;

// SVG copy-to-clipboard icon
const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function createCopyButton(getContent: () => string, title = 'Copy to clipboard'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'debug-copy-btn';
    btn.title = title;
    btn.innerHTML = COPY_SVG;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const text = getContent();
        if (!text) return;
        navigator.clipboard
            .writeText(text)
            .then(() => {
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 600);
            })
            .catch(() => {});
    });
    return btn;
}

function inferEntryMode(entry: any): 'cached' | 'live' | null {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.cache?.hit === true) return 'cached';
    if (entry.cache?.hit === false) return 'live';
    if (entry.model === 'cached' || entry.provider === 'local') return 'cached';
    if (entry.model || entry.provider) return 'live';
    return null;
}

function formatCacheTimestamp(iso: string): string {
    if (!iso) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString();
}

function formatStageDuration(durationMs: unknown): string {
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms < 0) return '';
    const seconds = ms / 1000;
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    return `${Math.round(seconds)}s`;
}

function normalizeProviderId(provider: unknown): string {
    const raw = String(provider || '')
        .trim()
        .toLowerCase();
    if (!raw) return '';
    if (raw === 'claude') return 'anthropic';
    if (raw === 'chatgpt') return 'openai';
    return raw;
}

function inferProviderId(entry: any): string {
    const direct = normalizeProviderId(entry?.provider);
    if (direct) return direct;
    const model = String(entry?.model || '')
        .trim()
        .toLowerCase();
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gpt') || model.startsWith('o')) return 'openai';
    if (model.startsWith('grok')) return 'grok';
    if (model.startsWith('gemini')) return 'gemini';
    return '';
}

function hasProviderOrModelShift(prev: any, next: any): boolean {
    const prevProvider = inferProviderId(prev);
    const nextProvider = inferProviderId(next);
    const prevModel = String(prev?.model || '')
        .trim()
        .toLowerCase();
    const nextModel = String(next?.model || '')
        .trim()
        .toLowerCase();
    return prevProvider !== nextProvider || prevModel !== nextModel;
}

function findLatestFallbackPair(entries: any[]): { failedEntry: any; fallbackEntry: any } | null {
    if (!Array.isArray(entries) || entries.length < 2) return null;
    for (let i = entries.length - 1; i > 0; i--) {
        const fallbackEntry = entries[i];
        const failedEntry = entries[i - 1];
        if (!failedEntry?.error) continue;
        if (!hasProviderOrModelShift(failedEntry, fallbackEntry)) continue;
        return { failedEntry, fallbackEntry };
    }
    return null;
}

let _selectMeasureCtx: CanvasRenderingContext2D | null | undefined;
function getSelectMeasureContext(): CanvasRenderingContext2D | null {
    if (_selectMeasureCtx !== undefined) return _selectMeasureCtx;
    if (typeof document === 'undefined') {
        _selectMeasureCtx = null;
        return _selectMeasureCtx;
    }
    _selectMeasureCtx = document.createElement('canvas').getContext('2d');
    return _selectMeasureCtx;
}

function fitSelectWidthToLabel(select: HTMLSelectElement, minWidthPx = 78, maxWidthPx = 200): void {
    const option = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    const label = (option?.textContent || select.value || '').trim();
    if (!label || typeof window === 'undefined') return;

    const computed = window.getComputedStyle(select);
    const measureCtx = getSelectMeasureContext();
    let textWidth = label.length * 7;
    if (measureCtx) {
        measureCtx.font = `${computed.fontStyle} ${computed.fontVariant} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
        textWidth = Math.ceil(measureCtx.measureText(label).width);
    }
    const controlWidth = Math.max(minWidthPx, Math.min(maxWidthPx, textWidth + 18));
    select.style.width = `${controlWidth}px`;
}

/** Weekly pipeline cache keys (one per agent, no per-day keys). */
function weeklyPipelineCacheKeys(): string[] {
    return ['knight-model', 'spotter-daily-model', 'strategist-bio-daily-model', 'grandmaster-daily-model'];
}
function isDailySimStage(stageClass: string): boolean {
    return weeklyPipelineCacheKeys().includes(stageClass);
}
function normalizeStageClass(stageClass: string): string {
    return stageClass;
}
function hasAnyCachedDay(): boolean {
    return weeklyPipelineCacheKeys().some(k => LLMCache.hasData(k));
}
function isAnyCachedDayEnabled(): boolean {
    return weeklyPipelineCacheKeys().some(k => LLMCache.isEnabled(k));
}
function setDailySimCacheEnabled(enabled: boolean, clearOnDisable = false): void {
    const keys = weeklyPipelineCacheKeys();
    keys.forEach(k => {
        if (enabled) {
            LLMCache.enable(k);
            return;
        }
        LLMCache.disable(k);
        if (clearOnDisable) LLMCache.clear(k);
    });
}

function findLatestCacheSeedEntry(stageClass: string): {
    payload: any;
    systemPrompt: string;
    userPrompt: string;
    requestBody: any;
} | null {
    const normalized = normalizeStageClass(stageClass);
    const entries = Array.isArray((DebugLog as any)?.entries) ? (DebugLog as any).entries : [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (normalizeStageClass(String(entry?.stageClass || '')) !== normalized) continue;
        if (entry?.loading || entry?.error) continue;
        const payload = entry?.response ?? entry?.parsed ?? null;
        if (payload == null) continue;
        return {
            payload,
            systemPrompt: typeof entry?.systemPrompt === 'string' ? entry.systemPrompt : '',
            userPrompt: typeof entry?.userPrompt === 'string' ? entry.userPrompt : '',
            requestBody: entry?.requestBody ?? null,
        };
    }
    return null;
}

function ensureStageCacheData(stageClass: string): void {
    if (LLMCache.hasData(stageClass)) return;
    const seed = findLatestCacheSeedEntry(stageClass);
    if (!seed) return;
    LLMCache.set(stageClass, seed.payload, {
        systemPrompt: seed.systemPrompt,
        userPrompt: seed.userPrompt,
        requestBody: seed.requestBody,
    });
}

function updateCacheButtonState(cacheBtn: Element | null, stageClass: string): void {
    if (!(cacheBtn instanceof HTMLButtonElement)) return;

    const hasData = isDailySimStage(stageClass) ? hasAnyCachedDay() : LLMCache.hasData(stageClass);
    const isEnabled = isDailySimStage(stageClass) ? isAnyCachedDayEnabled() : LLMCache.isEnabled(stageClass);

    cacheBtn.classList.toggle('has-data', hasData);
    cacheBtn.classList.toggle('active', isEnabled);

    const upstreamStageClasses = getDependencyUpstreamStageClasses(stageClass);
    const downstreamStageClasses = getDependencyDownstreamStageClasses(stageClass).filter(downstreamStageClass =>
        LLMCache.isEnabled(downstreamStageClass),
    );

    const titleBits = ['Use cached data (skip LLM call).'];
    if (!hasData) {
        titleBits.push('No cached payload yet; the next live run will populate it.');
    }
    if (upstreamStageClasses.length > 0) {
        titleBits.push(`Required upstream caches: ${describeStageClasses(upstreamStageClasses)}.`);
    }
    if (downstreamStageClasses.length > 0) {
        titleBits.push(`Disabling this also disables: ${describeStageClasses(downstreamStageClasses)}.`);
    }
    cacheBtn.title = titleBits.join(' ');
}

const NO_OUTPUT_PLACEHOLDER = 'No output yet.';
const RUNTIME_PROMPT_PLACEHOLDER = 'Not generated for this run yet.';
const NO_TEMPLATE_PLACEHOLDER = 'No code template available for this agent.';

export const DebugLog = {
    entries: [] as any[],
    _initialized: false,
    _nextEntryId: 1,
    _listeners: new Set<(event: 'add' | 'update' | 'clear', payload?: any) => void>(),
    _userCollapsed: new Set<string>(STAGES.map(stage => stage.id)), // stage ids collapsed in the side panel

    subscribe(listener: (event: 'add' | 'update' | 'clear', payload?: any) => void) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    },

    _emit(event: 'add' | 'update' | 'clear', payload?: any) {
        this._listeners.forEach((listener: any) => {
            try {
                listener(event, payload);
            } catch (err) {
                console.warn('[DebugLog] listener error:', err);
            }
        });
    },

    clear() {
        const previousEntries = this.serializeEntries();
        this.entries = [];
        this._nextEntryId = 1;
        this._emit('clear', { previousEntries });
        this.render();
    },

    addEntry(entry: any) {
        entry.timestamp = new Date();
        if (!entry._debugId) {
            entry._debugId = this._nextEntryId++;
        }
        this.entries.push(entry);
        this._emit('add', { entry });
        this.render();
        return entry;
    },

    updateEntry(entry: any, updates: any) {
        Object.assign(entry, updates);
        this._emit('update', { entry, updates });
        this.render();
    },

    serializeEntry(entry: any) {
        const timestamp =
            entry?.timestamp instanceof Date
                ? entry.timestamp.toISOString()
                : entry?.timestamp
                  ? new Date(entry.timestamp).toISOString()
                  : null;

        return {
            debugId: entry?._debugId ?? null,
            stage: entry?.stage ?? null,
            stageClass: entry?.stageClass ?? null,
            model: entry?.model ?? null,
            provider: entry?.provider ?? null,
            duration: entry?.duration ?? null,
            timestamp,
            cache: entry?.cache ?? null,
            systemPrompt: entry?.systemPrompt ?? null,
            userPrompt: entry?.userPrompt ?? null,
            requestBody: entry?.requestBody ?? null,
            response: entry?.response ?? null,
            parsed: entry?.parsed ?? null,
            rawResponse: entry?.rawResponse ?? null,
            error: entry?.error ?? null,
            loading: entry?.loading ?? false,
        };
    },

    serializeEntries(entries = this.entries) {
        return (entries || []).map((entry: any) => this.serializeEntry(entry));
    },

    exportToFile() {
        if (this.entries.length === 0) return;
        const payload = this.serializeEntries();
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cortex_loop_debug_log.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('[DebugLog] Exported', this.entries.length, 'entries to cortex_loop_debug_log.json');
    },

    initCards() {
        const container = document.getElementById('debug-entries');
        if (!container || this._initialized) return;
        container.innerHTML = '';

        // Prompt banner (hidden until pipeline runs)
        const promptBanner = document.createElement('div');
        promptBanner.className = 'pipeline-prompt-banner';
        promptBanner.style.display = 'none';
        const promptBadge = document.createElement('span');
        promptBadge.className = 'debug-entry-stage user-input';
        promptBadge.textContent = 'Prompt';
        promptBanner.appendChild(promptBadge);
        const promptText = document.createElement('span');
        promptText.className = 'pipeline-prompt-text';
        promptBanner.appendChild(promptText);
        container.appendChild(promptBanner);

        for (const stage of STAGES) {
            const card = document.createElement('div');
            card.className = 'pipeline-agent-card';
            card.dataset.stage = stage.id;
            card.dataset.stageClass = stage.stageClass;

            const header = document.createElement('div');
            header.className = 'agent-card-header';

            const badge = document.createElement('span');
            badge.className = `debug-entry-stage ${stage.stageClass}`;
            badge.textContent = stage.label;
            header.appendChild(badge);

            // Model selector (shows full model name with version)
            const select = document.createElement('select');
            select.className = 'agent-model-select';
            select.dataset.stage = stage.id;
            this._populateSelect(select, stage.id);
            select.addEventListener('change', () => {
                const configStage = resolveModelConfigStage(stage.id);
                AppState.stageModels[configStage] = select.value;
                settingsStore.setString(stageModelKey(configStage), select.value);
                fitSelectWidthToLabel(select);
            });
            header.appendChild(select);

            // Provider selector (dropdown: Claude / ChatGPT / Gemini / Grok)
            const providerSelect = document.createElement('select');
            providerSelect.className = 'agent-provider-select';
            providerSelect.dataset.stage = stage.id;
            for (const pid of PROVIDER_IDS) {
                const o = document.createElement('option');
                o.value = pid;
                o.textContent = PROVIDER_LABELS[pid] || pid;
                providerSelect.appendChild(o);
            }
            const configStage = resolveModelConfigStage(stage.id);
            providerSelect.value = AppState.stageProviders[configStage] || AppState.selectedLLM;
            providerSelect.addEventListener('change', () => {
                switchStageProvider(configStage, providerSelect.value);
                // Re-populate model dropdown for new provider
                this._populateSelect(select, stage.id);
            });
            header.appendChild(providerSelect);

            const status = document.createElement('div');
            status.className = 'agent-card-status';
            const idleBadge = document.createElement('span');
            idleBadge.className = 'agent-idle-badge';
            idleBadge.textContent = 'Ready';
            status.appendChild(idleBadge);
            header.appendChild(status);

            const actions = document.createElement('div');
            actions.className = 'agent-row-actions';

            const chevron = document.createElement('button');
            chevron.className = 'agent-chevron';
            chevron.innerHTML = CHEVRON_SVG;
            chevron.setAttribute('aria-label', 'Toggle');
            chevron.setAttribute('aria-expanded', 'false');
            chevron.addEventListener('click', e => {
                e.stopPropagation();
                if (this._userCollapsed.has(stage.id)) {
                    this._userCollapsed.delete(stage.id);
                    card.classList.remove('user-collapsed');
                } else {
                    this._userCollapsed.add(stage.id);
                    card.classList.add('user-collapsed');
                }
                chevron.setAttribute('aria-expanded', String(!this._userCollapsed.has(stage.id)));
            });
            actions.appendChild(chevron);
            header.appendChild(actions);

            card.appendChild(header);

            const fallbackRows = document.createElement('div');
            fallbackRows.className = 'agent-fallback-rows';
            card.appendChild(fallbackRows);

            const body = document.createElement('div');
            body.className = 'agent-card-body';
            card.appendChild(body);

            container.appendChild(card);
        }

        this._initialized = true;
        this.render();
    },

    _populateSelect(select: HTMLSelectElement, stageId: string) {
        const configStage = resolveModelConfigStage(stageId);
        const provider = AppState.stageProviders[configStage] || AppState.selectedLLM;
        const opts = MODEL_OPTIONS[provider] || [];
        select.innerHTML = '';
        for (const opt of opts) {
            const o = document.createElement('option');
            o.value = opt.key;
            o.textContent = opt.label;
            select.appendChild(o);
        }
        const stored = AppState.stageModels[configStage];
        const resolved = opts.find((o: any) => o.key === stored) ? stored : opts[0]?.key || '';
        select.value = resolved;

        if (resolved && stored !== resolved) {
            AppState.stageModels[configStage] = resolved;
            settingsStore.setString(stageModelKey(configStage), resolved);
        }
        fitSelectWidthToLabel(select);
    },

    refreshSelects() {
        for (const stage of STAGES) {
            const sel = document.querySelector(`.agent-model-select[data-stage="${stage.id}"]`) as HTMLSelectElement;
            if (sel) this._populateSelect(sel, stage.id);
            // Sync provider dropdown value
            const provSel = document.querySelector(
                `.agent-provider-select[data-stage="${stage.id}"]`,
            ) as HTMLSelectElement;
            if (provSel) {
                const configStage = resolveModelConfigStage(stage.id);
                provSel.value = AppState.stageProviders[configStage] || AppState.selectedLLM;
            }
        }
    },

    render() {
        if (!this._initialized) return;
        const container = document.getElementById('debug-entries');
        if (!container) return;
        const wasNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 60;

        // Prompt banner
        const promptBanner = container.querySelector('.pipeline-prompt-banner') as HTMLElement;
        const userEntry = this.entries.find((e: any) => e.stageClass === 'user-input');
        if (promptBanner) {
            if (userEntry) {
                promptBanner.style.display = '';
                const textEl = promptBanner.querySelector('.pipeline-prompt-text');
                if (textEl) textEl.textContent = userEntry.userPrompt || '';
            } else {
                promptBanner.style.display = 'none';
            }
        }

        // Group entries by stageClass
        const grouped: Record<string, any[]> = {};
        for (const stage of STAGES) grouped[stage.stageClass] = [];
        for (const entry of this.entries) {
            const sc = normalizeStageClass(String(entry.stageClass || ''));
            if (grouped[sc]) grouped[sc].push(entry);
        }
        const latestByStageClass: Record<string, any | null> = {};
        for (const stage of STAGES) {
            const list = grouped[stage.stageClass];
            latestByStageClass[stage.stageClass] = list.length > 0 ? list[list.length - 1] : null;
        }

        for (const stage of STAGES) {
            const card = container.querySelector(`.pipeline-agent-card[data-stage="${stage.id}"]`) as HTMLElement;
            if (!card) continue;

            const body = card.querySelector('.agent-card-body') as HTMLElement;
            const status = card.querySelector('.agent-card-status') as HTMLElement;
            const chevron = card.querySelector('.agent-chevron') as HTMLButtonElement | null;
            const fallbackRows = card.querySelector('.agent-fallback-rows') as HTMLElement | null;
            const entries = grouped[stage.stageClass];

            const isCollapsed = this._userCollapsed.has(stage.id);

            card.classList.add('expanded');
            card.classList.toggle('user-collapsed', isCollapsed);
            if (chevron) chevron.setAttribute('aria-expanded', String(!isCollapsed));
            body.innerHTML = '';
            status.innerHTML = '';
            if (fallbackRows) fallbackRows.innerHTML = '';

            const fallbackPair = findLatestFallbackPair(entries);
            card.classList.toggle('has-fallback-attempt', !!fallbackPair);
            if (fallbackRows && fallbackPair) {
                fallbackRows.appendChild(this._buildFallbackAttemptRow(fallbackPair.failedEntry, 'original'));
                fallbackRows.appendChild(this._buildFallbackAttemptRow(fallbackPair.fallbackEntry, 'fallback'));
            }

            if (entries.length > 0) {
                const last = entries[entries.length - 1];
                const isLoading = !!last.loading;
                if (isLoading) {
                    const spinner = document.createElement('div');
                    spinner.className = 'agent-spinner';
                    status.appendChild(spinner);
                } else {
                    const mode = inferEntryMode(last);
                    if (mode) {
                        const source = document.createElement('span');
                        source.className = `agent-source-badge ${mode}`;
                        source.textContent = mode === 'cached' ? 'Cached' : 'Live';
                        status.appendChild(source);
                    }
                    if (last.duration != null) {
                        const durationLabel = formatStageDuration(last.duration);
                        if (durationLabel) {
                            const dur = document.createElement('span');
                            dur.className = 'agent-duration';
                            dur.textContent = durationLabel;
                            status.appendChild(dur);
                        }
                    }
                    if (last.error) {
                        const err = document.createElement('span');
                        err.className = 'agent-error-badge';
                        err.textContent = 'ERR';
                        status.appendChild(err);
                    }
                }

                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    const mixedWarning =
                        i === entries.length - 1
                            ? this._computeMixedDependencyWarning(stage.stageClass, entry, latestByStageClass)
                            : null;
                    body.appendChild(
                        this._buildEntryBody(entry, {
                            showPlaceholders: true,
                            stageId: stage.id,
                            mixedWarning,
                        }),
                    );
                }
            } else {
                // Keep card expandable even before the stage has any logs.
                const idle = document.createElement('span');
                idle.className = 'agent-idle-badge';
                idle.textContent = 'Ready';
                status.appendChild(idle);

                body.appendChild(this._buildEntryBody({}, { showPlaceholders: true, stageId: stage.id }));
            }
        }

        if (wasNearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    },

    _payloadToText(value: any) {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    },

    _getStageTemplatePrompt(stageId: string) {
        const templateKey = STAGE_PROMPT_TEMPLATE_KEY[stageId];
        const template = templateKey ? this._payloadToText((PROMPTS as any)[templateKey]) : '';
        return template.trim().length > 0 ? template : NO_TEMPLATE_PLACEHOLDER;
    },

    _computeMixedDependencyWarning(
        stageClass: string,
        entry: any,
        latestByStageClass: Record<string, any | null>,
    ): string | null {
        if (inferEntryMode(entry) !== 'cached') return null;
        if (entry?.cache?.inputMismatch) {
            return 'Mixed dependency state: this cached stage was generated from different prompt inputs than the current run. Cached output may be stale versus upstream state.';
        }
        const upstream = getDependencyUpstreamStageClasses(stageClass);
        if (upstream.length === 0) return null;

        const liveUpstream: string[] = [];
        for (const upstreamStageClass of upstream) {
            const upstreamEntry = latestByStageClass[upstreamStageClass];
            if (!upstreamEntry) continue;
            if (inferEntryMode(upstreamEntry) === 'live') {
                liveUpstream.push(STAGE_LABEL_BY_CLASS[upstreamStageClass] || upstreamStageClass);
            }
        }
        if (liveUpstream.length === 0) return null;

        return `Mixed dependency state: this stage is cached while upstream ${liveUpstream.join(', ')} ran live in this run. Cached output may not reflect current upstream inputs.`;
    },

    _buildFallbackAttemptRow(entry: any, variant: 'original' | 'fallback') {
        const row = document.createElement('div');
        row.className = `agent-fallback-row ${variant}`;

        const kind = document.createElement('span');
        kind.className = 'agent-fallback-kind';
        kind.textContent = variant === 'fallback' ? 'Fallback' : 'Original';
        row.appendChild(kind);

        const providerId = inferProviderId(entry);
        const providerLabel = PROVIDER_LABELS[providerId] || providerId || 'Unknown';
        const model = String(entry?.model || 'unknown');
        const modelText = document.createElement('span');
        modelText.className = 'agent-fallback-model';
        modelText.textContent = `${providerLabel} · ${model}`;
        row.appendChild(modelText);

        const durationText = document.createElement('span');
        durationText.className = 'agent-fallback-duration';
        durationText.textContent = formatStageDuration(entry?.duration) || '—';
        row.appendChild(durationText);

        const isLoading = !!entry?.loading;
        const hasError = typeof entry?.error === 'string' && entry.error.length > 0;
        const statusText = isLoading ? 'RUNNING' : hasError ? 'ERR' : 'DONE';
        const status = document.createElement('span');
        status.className = `agent-fallback-status ${statusText.toLowerCase()}`;
        status.textContent = statusText;
        row.appendChild(status);

        if (hasError) {
            row.title = String(entry.error);
        }

        return row;
    },

    _buildEntryBody(entry: any, opts: any = {}) {
        const showPlaceholders = !!opts.showPlaceholders;
        const stageId = typeof opts.stageId === 'string' ? opts.stageId : '';
        const mixedWarning = typeof opts.mixedWarning === 'string' ? opts.mixedWarning : '';
        const wrap = document.createElement('div');
        wrap.className = 'agent-entry-block';

        const mode = inferEntryMode(entry);
        if (mode) {
            const provenance = document.createElement('div');
            provenance.className = 'debug-entry-provenance';

            const modeBadge = document.createElement('span');
            modeBadge.className = `debug-cache-badge mode ${mode}`;
            modeBadge.textContent = mode === 'cached' ? 'Cached' : 'Live';
            provenance.appendChild(modeBadge);

            if (mode === 'cached') {
                const cacheKey = String(entry?.cache?.key || '');
                if (cacheKey) {
                    const keyBadge = document.createElement('span');
                    keyBadge.className = 'debug-cache-badge key';
                    keyBadge.textContent = cacheKey;
                    provenance.appendChild(keyBadge);
                }

                const cachedAt = String(entry?.cache?.cachedAt || '');
                if (cachedAt) {
                    const timeBadge = document.createElement('span');
                    timeBadge.className = 'debug-cache-badge time';
                    timeBadge.textContent = formatCacheTimestamp(cachedAt);
                    provenance.appendChild(timeBadge);
                }
            }

            wrap.appendChild(provenance);
        }

        if (mixedWarning) {
            const warning = document.createElement('div');
            warning.className = 'debug-cache-warning';
            warning.textContent = mixedWarning;
            wrap.appendChild(warning);
        }

        const systemPrompt = this._payloadToText(entry.systemPrompt);
        const hasSystemPrompt = systemPrompt.trim().length > 0;
        const templatePrompt = this._getStageTemplatePrompt(stageId);
        if (hasSystemPrompt || showPlaceholders) {
            wrap.appendChild(
                this.buildSystemPromptBlock(
                    hasSystemPrompt ? systemPrompt : RUNTIME_PROMPT_PLACEHOLDER,
                    templatePrompt,
                    hasSystemPrompt ? 'runtime' : 'template',
                ),
            );
        }

        const userPrompt = this._payloadToText(entry.userPrompt);
        const hasUserPrompt = userPrompt.trim().length > 0;
        if (hasUserPrompt || showPlaceholders) {
            wrap.appendChild(
                this.buildContentBlock('User Input', hasUserPrompt ? userPrompt : NO_OUTPUT_PLACEHOLDER, false),
            );
        }

        const requestPayload = this._payloadToText(entry.requestBody);
        const hasRequestPayload = requestPayload.trim().length > 0;
        if (hasRequestPayload || showPlaceholders) {
            wrap.appendChild(
                this.buildToggleBlock(
                    'Request',
                    hasRequestPayload ? requestPayload : NO_OUTPUT_PLACEHOLDER,
                    null,
                    'parsed',
                ),
            );
        }

        const parsedResponse = this._payloadToText(entry.response ?? entry.parsed);
        const rawResponse = this._payloadToText(entry.rawResponse);
        const hasParsedResponse = parsedResponse.trim().length > 0;
        const hasRawResponse = rawResponse.trim().length > 0;
        if (hasParsedResponse || hasRawResponse || showPlaceholders) {
            wrap.appendChild(
                this.buildToggleBlock(
                    'Response',
                    hasParsedResponse ? parsedResponse : NO_OUTPUT_PLACEHOLDER,
                    hasRawResponse ? rawResponse : null,
                    'parsed',
                ),
            );
        }

        if (entry.error) wrap.appendChild(this.buildContentBlock('Error', entry.error, false));

        if (entry.loading) {
            const ld = document.createElement('div');
            ld.className = 'debug-entry-loading';
            ld.innerHTML = '<div class="debug-spinner"></div><span>Waiting for response...</span>';
            wrap.appendChild(ld);
        }

        return wrap;
    },

    buildSystemPromptBlock(runtimeContent: any, templateContent: any, defaultMode: 'runtime' | 'template') {
        const wrapper = document.createElement('div');

        const headerRow = document.createElement('div');
        headerRow.className = 'debug-entry-label debug-toggle-header';

        const labelEl = document.createElement('span');
        labelEl.textContent = 'System Prompt';
        headerRow.appendChild(labelEl);

        const tabsEl = document.createElement('div');
        tabsEl.className = 'debug-mode-tabs';

        const runtimeBtn = document.createElement('button');
        runtimeBtn.className = 'debug-mode-toggle';
        runtimeBtn.textContent = 'Runtime';
        tabsEl.appendChild(runtimeBtn);

        const templateBtn = document.createElement('button');
        templateBtn.className = 'debug-mode-toggle';
        templateBtn.textContent = 'Code Template';
        tabsEl.appendChild(templateBtn);

        headerRow.appendChild(tabsEl);
        wrapper.appendChild(headerRow);

        const runtimeText = this._payloadToText(runtimeContent || RUNTIME_PROMPT_PLACEHOLDER);
        const templateText = this._payloadToText(templateContent || NO_TEMPLATE_PLACEHOLDER);
        const runtimeNeedsExpand = runtimeText.length > 200;
        const templateNeedsExpand = templateText.length > 200;
        let mode: 'runtime' | 'template' = defaultMode === 'runtime' ? 'runtime' : 'template';

        const runtimeEl = document.createElement('div');
        runtimeEl.className = 'debug-entry-content';
        runtimeEl.textContent = runtimeText;

        const templateEl = document.createElement('div');
        templateEl.className = 'debug-entry-content';
        templateEl.textContent = templateText;

        if (runtimeNeedsExpand) runtimeEl.classList.add('collapsed');
        if (templateNeedsExpand) templateEl.classList.add('collapsed');

        wrapper.appendChild(runtimeEl);
        wrapper.appendChild(templateEl);

        let expandBtn: HTMLButtonElement | null = null;
        if (runtimeNeedsExpand || templateNeedsExpand) {
            const expandRow = document.createElement('div');
            expandRow.className = 'debug-expand-row';
            expandBtn = document.createElement('button');
            expandBtn.className = 'debug-toggle-expand';
            expandBtn.textContent = 'Show more';
            expandBtn.addEventListener('click', () => {
                const visible = mode === 'runtime' ? runtimeEl : templateEl;
                const isCollapsed = visible.classList.contains('collapsed');
                runtimeEl.classList.toggle('collapsed');
                templateEl.classList.toggle('collapsed');
                expandBtn!.textContent = isCollapsed ? 'Show less' : 'Show more';
            });
            expandRow.appendChild(expandBtn);
            const copyBtn = createCopyButton(() => (mode === 'runtime' ? runtimeText : templateText));
            expandRow.appendChild(copyBtn);
            wrapper.appendChild(expandRow);
        }

        const setMode = (nextMode: 'runtime' | 'template') => {
            mode = nextMode;
            runtimeEl.style.display = mode === 'runtime' ? '' : 'none';
            templateEl.style.display = mode === 'template' ? '' : 'none';
            runtimeBtn.classList.toggle('active', mode === 'runtime');
            templateBtn.classList.toggle('active', mode === 'template');
            if (expandBtn) {
                const visible = mode === 'runtime' ? runtimeEl : templateEl;
                const needsExpand = mode === 'runtime' ? runtimeNeedsExpand : templateNeedsExpand;
                expandBtn.style.display = needsExpand ? '' : 'none';
                expandBtn.textContent = visible.classList.contains('collapsed') ? 'Show more' : 'Show less';
            }
        };

        runtimeBtn.addEventListener('click', () => setMode('runtime'));
        templateBtn.addEventListener('click', () => setMode('template'));
        setMode(mode);

        return wrapper;
    },

    buildContentBlock(label: any, content: any, collapsible: any) {
        const wrapper = document.createElement('div');

        const labelEl = document.createElement('div');
        labelEl.className = 'debug-entry-label';
        labelEl.textContent = label;
        wrapper.appendChild(labelEl);

        const contentEl = document.createElement('div');
        contentEl.className = 'debug-entry-content' + (collapsible && content.length > 200 ? ' collapsed' : '');
        contentEl.textContent = content;
        wrapper.appendChild(contentEl);

        if (collapsible && content.length > 200) {
            const expandRow = document.createElement('div');
            expandRow.className = 'debug-expand-row';
            const toggle = document.createElement('button');
            toggle.className = 'debug-toggle-expand';
            toggle.textContent = 'Show more';
            toggle.addEventListener('click', () => {
                const isCollapsed = contentEl.classList.contains('collapsed');
                contentEl.classList.toggle('collapsed');
                toggle.textContent = isCollapsed ? 'Show less' : 'Show more';
            });
            expandRow.appendChild(toggle);
            expandRow.appendChild(createCopyButton(() => content));
            wrapper.appendChild(expandRow);
        }

        return wrapper;
    },

    buildToggleBlock(label: any, parsedContent: any, rawContent: any, defaultMode: any) {
        const wrapper = document.createElement('div');

        const headerRow = document.createElement('div');
        headerRow.className = 'debug-entry-label debug-toggle-header';

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        headerRow.appendChild(labelEl);

        const hasBoth = parsedContent && rawContent;
        let mode = defaultMode || 'parsed';

        const parsedEl = document.createElement('div');
        parsedEl.className = 'debug-entry-content';
        parsedEl.textContent = parsedContent || '';

        const rawEl = document.createElement('div');
        rawEl.className = 'debug-entry-content';
        rawEl.textContent = rawContent || '';

        const activeContent = mode === 'parsed' ? parsedContent : rawContent;
        if (activeContent && activeContent.length > 200) {
            parsedEl.classList.add('collapsed');
            rawEl.classList.add('collapsed');
        }

        let expandBtn: any = null;

        if (hasBoth) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'debug-mode-toggle';
            toggleBtn.textContent = mode === 'parsed' ? 'raw' : 'parsed';
            toggleBtn.addEventListener('click', () => {
                mode = mode === 'parsed' ? 'raw' : 'parsed';
                toggleBtn.textContent = mode === 'parsed' ? 'raw' : 'parsed';
                parsedEl.style.display = mode === 'parsed' ? '' : 'none';
                rawEl.style.display = mode === 'raw' ? '' : 'none';
                if (expandBtn) {
                    const visible = mode === 'parsed' ? parsedEl : rawEl;
                    expandBtn.style.display = visible.scrollHeight > 60 ? '' : 'none';
                }
            });
            headerRow.appendChild(toggleBtn);
        }

        wrapper.appendChild(headerRow);

        rawEl.style.display = mode === 'raw' ? '' : 'none';
        parsedEl.style.display = mode === 'parsed' ? '' : 'none';
        wrapper.appendChild(parsedEl);
        wrapper.appendChild(rawEl);

        const longestContent = Math.max((parsedContent || '').length, (rawContent || '').length);
        if (longestContent > 200) {
            const expandRow = document.createElement('div');
            expandRow.className = 'debug-expand-row';
            expandBtn = document.createElement('button');
            expandBtn.className = 'debug-toggle-expand';
            expandBtn.textContent = 'Show more';
            expandBtn.addEventListener('click', () => {
                const visible = mode === 'parsed' ? parsedEl : rawEl;
                const isCollapsed = visible.classList.contains('collapsed');
                parsedEl.classList.toggle('collapsed');
                rawEl.classList.toggle('collapsed');
                expandBtn.textContent = isCollapsed ? 'Show less' : 'Show more';
            });
            expandRow.appendChild(expandBtn);
            expandRow.appendChild(createCopyButton(() => (mode === 'parsed' ? parsedContent : rawContent) || ''));
            wrapper.appendChild(expandRow);
        }

        return wrapper;
    },
};
