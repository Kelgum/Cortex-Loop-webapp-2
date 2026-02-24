import { MODEL_OPTIONS, PROVIDER_LABELS, PROVIDER_IDS } from './constants';
import { AppState, switchStageProvider } from './state';

const STAGES = [
    { id: 'fast',              stageClass: 'fast-model',              label: 'Scout' },
    { id: 'curves',            stageClass: 'main-model',              label: 'Strategist' },
    { id: 'intervention',      stageClass: 'intervention-model',      label: 'Chess Player' },
    { id: 'sherlock',          stageClass: 'sherlock-model',           label: 'Sherlock' },
    { id: 'biometric',         stageClass: 'biometric-model',         label: 'Spotter' },
    { id: 'revision',          stageClass: 'revision-model',          label: 'Grandmaster' },
    { id: 'sherlockRevision',  stageClass: 'sherlock-revision-model', label: 'Sherlock (Rev)' },
];

// SVG chevron pointing down (rotates to point right when collapsed)
const CHEVRON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

export const DebugLog = {
    entries: [] as any[],
    _initialized: false,
    _userCollapsed: new Set<string>(),   // stage ids the user has manually collapsed
    _autoCollapseTimers: {} as Record<string, ReturnType<typeof setTimeout>>,
    _prevLoading: {} as Record<string, boolean>, // track loading→done transitions

    clear() {
        this.entries = [];
        // Clear collapse state so cards start fresh on new prompt
        this._userCollapsed.clear();
        for (const id of Object.keys(this._autoCollapseTimers)) {
            clearTimeout(this._autoCollapseTimers[id]);
        }
        this._autoCollapseTimers = {};
        this._prevLoading = {};
        this.render();
    },

    addEntry(entry: any) {
        entry.timestamp = new Date();
        this.entries.push(entry);
        this.render();
        return entry;
    },

    updateEntry(entry: any, updates: any) {
        Object.assign(entry, updates);
        this.render();
    },

    exportToFile() {
        if (this.entries.length === 0) return;
        const payload = this.entries.map((e: any) => ({
            stage:        e.stage,
            stageClass:   e.stageClass,
            model:        e.model || null,
            duration:     e.duration || null,
            timestamp:    e.timestamp,
            systemPrompt: e.systemPrompt || null,
            userPrompt:   e.userPrompt || null,
            response:     e.response || null,
            parsed:       e.parsed || null,
            error:        e.error || null,
        }));
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
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
                AppState.stageModels[stage.id] = select.value;
                localStorage.setItem(`cortex_stage_${stage.id}`, select.value);
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
            providerSelect.value = AppState.stageProviders[stage.id] || AppState.selectedLLM;
            providerSelect.addEventListener('change', () => {
                switchStageProvider(stage.id, providerSelect.value);
                // Re-populate model dropdown for new provider
                this._populateSelect(select, stage.id);
            });
            header.appendChild(providerSelect);

            const status = document.createElement('div');
            status.className = 'agent-card-status';
            header.appendChild(status);

            const chevron = document.createElement('button');
            chevron.className = 'agent-chevron';
            chevron.innerHTML = CHEVRON_SVG;
            chevron.setAttribute('aria-label', 'Toggle');
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!card.classList.contains('expanded')) return; // nothing to collapse
                if (this._userCollapsed.has(stage.id)) {
                    this._userCollapsed.delete(stage.id);
                    card.classList.remove('user-collapsed');
                } else {
                    this._userCollapsed.add(stage.id);
                    card.classList.add('user-collapsed');
                }
            });
            header.appendChild(chevron);

            card.appendChild(header);

            const body = document.createElement('div');
            body.className = 'agent-card-body';
            card.appendChild(body);

            container.appendChild(card);
        }

        this._initialized = true;
    },

    _populateSelect(select: HTMLSelectElement, stageId: string) {
        const provider = AppState.stageProviders[stageId] || AppState.selectedLLM;
        const opts = MODEL_OPTIONS[provider] || [];
        select.innerHTML = '';
        for (const opt of opts) {
            const o = document.createElement('option');
            o.value = opt.key;
            o.textContent = opt.label;
            select.appendChild(o);
        }
        const stored = AppState.stageModels[stageId];
        const resolved = opts.find((o: any) => o.key === stored) ? stored : (opts[0]?.key || '');
        select.value = resolved;

        if (resolved && stored !== resolved) {
            AppState.stageModels[stageId] = resolved;
            localStorage.setItem(`cortex_stage_${stageId}`, resolved);
        }
    },

    refreshSelects() {
        for (const stage of STAGES) {
            const sel = document.querySelector(`.agent-model-select[data-stage="${stage.id}"]`) as HTMLSelectElement;
            if (sel) this._populateSelect(sel, stage.id);
            // Sync provider dropdown value
            const provSel = document.querySelector(`.agent-provider-select[data-stage="${stage.id}"]`) as HTMLSelectElement;
            if (provSel) {
                provSel.value = AppState.stageProviders[stage.id] || AppState.selectedLLM;
            }
        }
    },

    render() {
        if (!this._initialized) return;
        const container = document.getElementById('debug-entries');
        if (!container) return;

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
            const sc = entry.stageClass;
            if (grouped[sc]) grouped[sc].push(entry);
        }

        for (const stage of STAGES) {
            const card = container.querySelector(`.pipeline-agent-card[data-stage="${stage.id}"]`) as HTMLElement;
            if (!card) continue;

            const body = card.querySelector('.agent-card-body') as HTMLElement;
            const status = card.querySelector('.agent-card-status') as HTMLElement;
            const entries = grouped[stage.stageClass];

            if (entries.length > 0) {
                const last = entries[entries.length - 1];
                const isLoading = !!last.loading;
                const wasLoading = !!this._prevLoading[stage.id];

                // If stage just started loading, force-open and cancel any pending auto-collapse
                if (isLoading && !wasLoading) {
                    clearTimeout(this._autoCollapseTimers[stage.id]);
                    this._userCollapsed.delete(stage.id);
                    card.classList.remove('user-collapsed');
                }

                // If stage just finished (loading → done), schedule auto-collapse
                if (!isLoading && wasLoading) {
                    clearTimeout(this._autoCollapseTimers[stage.id]);
                    this._autoCollapseTimers[stage.id] = setTimeout(() => {
                        if (!this._userCollapsed.has(stage.id)) {
                            this._userCollapsed.add(stage.id);
                            card.classList.add('user-collapsed');
                        }
                    }, 1000);
                }

                this._prevLoading[stage.id] = isLoading;

                card.classList.add('expanded');
                body.innerHTML = '';
                status.innerHTML = '';

                if (isLoading) {
                    const spinner = document.createElement('div');
                    spinner.className = 'agent-spinner';
                    status.appendChild(spinner);
                } else {
                    if (last.duration != null) {
                        const dur = document.createElement('span');
                        dur.className = 'agent-duration';
                        dur.textContent = `${last.duration}ms`;
                        status.appendChild(dur);
                    }
                    if (last.error) {
                        const err = document.createElement('span');
                        err.className = 'agent-error-badge';
                        err.textContent = 'ERR';
                        status.appendChild(err);
                    }
                }

                for (const entry of entries) {
                    body.appendChild(this._buildEntryBody(entry));
                }
            } else {
                this._prevLoading[stage.id] = false;
                card.classList.remove('expanded');
                card.classList.remove('user-collapsed');
                body.innerHTML = '';
                status.innerHTML = '';
            }
        }

        container.scrollTop = container.scrollHeight;
    },

    _buildEntryBody(entry: any) {
        const wrap = document.createElement('div');
        wrap.className = 'agent-entry-block';

        if (entry.requestBody) {
            wrap.appendChild(this.buildToggleBlock('Request', JSON.stringify(entry.requestBody, null, 2), null, 'parsed'));
        } else {
            if (entry.systemPrompt) wrap.appendChild(this.buildContentBlock('System Prompt', entry.systemPrompt, true));
            if (entry.userPrompt) wrap.appendChild(this.buildContentBlock('User Input', entry.userPrompt, false));
        }

        if (entry.response || entry.rawResponse) {
            const parsedStr = entry.response
                ? (typeof entry.response === 'string' ? entry.response : JSON.stringify(entry.response, null, 2))
                : null;
            wrap.appendChild(this.buildToggleBlock('Response', parsedStr, entry.rawResponse || null, 'parsed'));
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
            const toggle = document.createElement('button');
            toggle.className = 'debug-toggle-expand';
            toggle.textContent = 'Show more';
            toggle.addEventListener('click', () => {
                const isCollapsed = contentEl.classList.contains('collapsed');
                contentEl.classList.toggle('collapsed');
                toggle.textContent = isCollapsed ? 'Show less' : 'Show more';
            });
            wrapper.appendChild(toggle);
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
            wrapper.appendChild(expandBtn);
        }

        return wrapper;
    },
};
