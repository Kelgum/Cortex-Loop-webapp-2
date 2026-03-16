import { DebugLog } from './debug-panel';
import { LLMCache } from './llm-cache';
import { STORAGE_KEYS, settingsStore } from './settings-store';

const EXPORT_ROOT_DIR_NAME = '.cortex-debug';
const DEBUG_BUNDLE_API_BASE = '/__debug-bundles';
const AUTO_SAVE_DEBOUNCE_MS = 700;

type DebugBundleRunContext = {
    folderName: string;
    prompt: string;
    startedAt: string;
};

type StageExportMeta = {
    order: number;
    label: string;
    slug: string;
};

type BundleFile = {
    relativePath: string;
    content: string;
};

type BundlePayload = {
    folderName: string;
    files: BundleFile[];
};

const STAGE_EXPORT_META_BY_CLASS: Record<string, StageExportMeta> = {
    'user-input': { order: 0, label: 'User Input', slug: 'user-input' },
    'fast-model': { order: 1, label: 'Scout', slug: 'scout' },
    'main-model': { order: 2, label: 'Strategist', slug: 'strategist' },
    'intervention-model': { order: 3, label: 'Chess Player', slug: 'chess-player' },
    'sherlock-model': { order: 4, label: 'Sherlock', slug: 'sherlock' },
    'biometric-rec-model': { order: 5, label: 'Spotter Device', slug: 'spotter-device' },
    'biometric-profile-model': { order: 6, label: 'Spotter Profile', slug: 'spotter-profile' },
    'biometric-channel-model': { order: 7, label: 'Spotter Channel', slug: 'spotter-channel' },
    'biometric-model': { order: 8, label: 'Spotter Sim', slug: 'spotter-sim' },
    'strategist-bio-model': { order: 9, label: 'Strategist Bio', slug: 'strategist-bio' },
    'revision-model': { order: 10, label: 'Grandmaster', slug: 'grandmaster' },
    'sherlock-revision-model': { order: 11, label: 'Sherlock Revision', slug: 'sherlock-revision' },
    'knight-model': { order: 12, label: 'Knight', slug: 'knight' },
    'spotter-daily-model': { order: 13, label: 'Spotter (7d)', slug: 'spotter-daily' },
    'strategist-bio-daily-model': { order: 14, label: 'Strategist Bio (7d)', slug: 'strategist-bio-daily' },
    'grandmaster-daily-model': { order: 15, label: 'Grandmaster (7d)', slug: 'grandmaster-daily' },
};

function normalizeStageExportClass(stageClass: string) {
    const normalized = String(stageClass || '').trim();
    return normalized;
}

function getStageMeta(stageClass: string, fallbackStage: string) {
    const normalizedStageClass = normalizeStageExportClass(stageClass);
    return (
        STAGE_EXPORT_META_BY_CLASS[normalizedStageClass] || {
            order: 99,
            label: fallbackStage || normalizedStageClass || 'Unknown Stage',
            slug: slugify(fallbackStage || normalizedStageClass || 'unknown-stage', 32),
        }
    );
}

function toIsoString(value: any) {
    if (typeof value === 'string' && value) return value;
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? value.toISOString() : new Date().toISOString();
    }
    if (value) {
        const parsed = new Date(value);
        if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
}

function pad2(value: number) {
    return String(value).padStart(2, '0');
}

function pad3(value: number) {
    return String(value).padStart(3, '0');
}

function formatLocalStamp(dateInput: any) {
    const date = new Date(dateInput || Date.now());
    return (
        [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join('-') +
        '_' +
        [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join('-') +
        '-' +
        pad3(date.getMilliseconds())
    );
}

function slugify(value: string, maxLength = 48) {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength);

    return slug || 'run';
}

function formatDuration(duration: any) {
    const ms = Number(duration);
    if (!Number.isFinite(ms) || ms < 0) return 'n/a';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 1000)}s`;
}

function statusForEntry(entry: any) {
    if (!entry) return 'missing';
    if (entry.loading) return 'loading';
    if (entry.error) return 'error';
    return 'ok';
}

function dynamicStageSlug(stageClass: string, fallbackStage: string) {
    const normalized = String(stageClass || '').trim();
    return '';
}

function stageFileName(stageClass: string, fallbackStage: string) {
    const meta = getStageMeta(stageClass, fallbackStage);
    const dynamicSlug = dynamicStageSlug(stageClass, fallbackStage);
    const slug = dynamicSlug || meta.slug;
    return `stage-${String(meta.order).padStart(2, '0')}-${slug}.json`;
}

function buildRunContextFromEntries(entries: any[]): DebugBundleRunContext {
    const userEntry = entries.find(entry => entry?.stageClass === 'user-input');
    const startedAt = toIsoString(userEntry?.timestamp);
    const prompt = String(userEntry?.userPrompt || '').trim();
    const folderSlug = slugify(prompt || 'untitled-run');

    return {
        folderName: `${formatLocalStamp(startedAt)}_${folderSlug}`,
        prompt,
        startedAt,
    };
}

function groupEntriesByStage(entries: any[]) {
    const grouped = new Map<string, any[]>();
    for (const entry of entries) {
        const stageClass = String(entry?.stageClass || 'unknown');
        const bucket = grouped.get(stageClass);
        if (bucket) {
            bucket.push(entry);
        } else {
            grouped.set(stageClass, [entry]);
        }
    }
    return Array.from(grouped.entries()).sort((a, b) => {
        const metaA = getStageMeta(a[0], a[1][0]?.stage);
        const metaB = getStageMeta(b[0], b[1][0]?.stage);
        return metaA.order - metaB.order;
    });
}

function buildStageExports(entries: any[]) {
    return groupEntriesByStage(entries).map(([stageClass, stageEntries]) => {
        const latest = stageEntries[stageEntries.length - 1] || null;
        const meta = getStageMeta(stageClass, latest?.stage);
        const fileName = stageFileName(stageClass, latest?.stage);
        return {
            fileName,
            payload: {
                stage: latest?.stage || meta.label,
                stageClass,
                label: meta.label,
                status: statusForEntry(latest),
                attempts: stageEntries.length,
                latest,
                entries: stageEntries,
            },
        };
    });
}

function buildSummaryMarkdown(run: DebugBundleRunContext, entries: any[], stageFiles: string[]) {
    const grouped = groupEntriesByStage(entries);
    const lines: string[] = [];

    lines.push('# Cortex Loop Debug Bundle');
    lines.push('');
    lines.push(`- Run folder: \`${run.folderName}\``);
    lines.push(`- Started: \`${run.startedAt}\``);
    lines.push(`- Exported: \`${new Date().toISOString()}\``);
    lines.push(`- Root: \`${EXPORT_ROOT_DIR_NAME}/\``);
    lines.push('');
    lines.push('## Prompt');
    lines.push('');
    lines.push('```text');
    lines.push(run.prompt || '(empty)');
    lines.push('```');
    lines.push('');
    lines.push('## Files');
    lines.push('');
    lines.push(
        '- `pipeline-log.json` contains the full serialized debug log, including request payloads, runtime prompts, parsed responses, raw responses, durations, provider/model info, and errors.',
    );
    for (const fileName of stageFiles) {
        lines.push(`- \`${fileName}\` contains grouped attempts for a single stage.`);
    }
    lines.push(
        '- `screenshots/` is reserved for manually captured chart and debug screenshots that belong to this run.',
    );
    lines.push('');
    lines.push('## Stage Snapshot');
    lines.push('');

    for (const [stageClass, stageEntries] of grouped) {
        const latest = stageEntries[stageEntries.length - 1] || null;
        const meta = getStageMeta(stageClass, latest?.stage);
        const model = latest?.model ? `${latest.model}` : 'n/a';
        const provider = latest?.provider ? `${latest.provider}` : 'n/a';
        lines.push(
            `- ${meta.label}: status=${statusForEntry(latest)}, attempts=${stageEntries.length}, provider=${provider}, model=${model}, duration=${formatDuration(latest?.duration)}`,
        );
    }

    lines.push('');
    lines.push('## Share Workflow');
    lines.push('');
    lines.push('1. Add any relevant curve screenshots to `screenshots/`.');
    lines.push('2. Point the coding agent at this run folder under `.cortex-debug/`.');
    lines.push('3. Ask it to inspect `summary.md`, `pipeline-log.json`, and the stage file(s) that look suspicious.');

    return lines.join('\n');
}

function buildScreenshotsReadme() {
    return [
        '# Screenshots',
        '',
        'Drop screenshots for this run here before asking another coding agent to review it.',
        '',
        'Suggested captures:',
        '- final chart state',
        '- debug card for the suspicious agent',
        '- any intermediate curve state that shows the drift',
        '',
        'Suggested names:',
        '- 01-chart-final.png',
        '- 02-debug-stage-3.png',
        '- 03-biometrics.png',
    ].join('\n');
}

function buildBundlePayload(entries: any[], run: DebugBundleRunContext): BundlePayload {
    const stageExports = buildStageExports(entries);
    const pipelinePayload = {
        run,
        exportedAt: new Date().toISOString(),
        exportRoot: EXPORT_ROOT_DIR_NAME,
        entries,
    };

    const files: BundleFile[] = [
        {
            relativePath: 'pipeline-log.json',
            content: JSON.stringify(pipelinePayload, null, 2),
        },
        {
            relativePath: 'summary.md',
            content: buildSummaryMarkdown(
                run,
                entries,
                stageExports.map(stage => stage.fileName),
            ),
        },
        {
            relativePath: 'screenshots/README.md',
            content: buildScreenshotsReadme(),
        },
    ];

    for (const stageExport of stageExports) {
        files.push({
            relativePath: stageExport.fileName,
            content: JSON.stringify(stageExport.payload, null, 2),
        });
    }

    return {
        folderName: run.folderName,
        files,
    };
}

async function parseJsonResponse(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { error: text };
    }
}

async function fetchBundleApi(path: string, init?: RequestInit) {
    const response = await fetch(`${DEBUG_BUNDLE_API_BASE}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
        },
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
        const message = payload?.error || payload?.message || `${response.status} ${response.statusText}`.trim();
        throw new Error(message || 'Debug bundle request failed.');
    }
    return payload;
}

export async function clearDebugBundleExport() {
    return await fetchBundleApi('/clear', {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

const DebugBundleExport = {
    initialized: false,
    supported: false,
    busy: false,
    exportRootPath: EXPORT_ROOT_DIR_NAME,
    currentRun: null as DebugBundleRunContext | null,
    autoSaveEnabled: settingsStore.getBoolean(STORAGE_KEYS.debugBundleAutoSave, false),
    autoSaveTimer: 0 as number | undefined,
    writeQueue: Promise.resolve(),
    exportBtn: null as HTMLButtonElement | null,
    autoSaveCheckbox: null as HTMLInputElement | null,
    statusEl: null as HTMLElement | null,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        this.exportBtn = document.getElementById('debug-export-run-btn') as HTMLButtonElement | null;
        this.autoSaveCheckbox = document.getElementById('debug-export-autosave') as HTMLInputElement | null;
        this.statusEl = document.getElementById('debug-export-status');

        this.exportBtn?.addEventListener('click', () => {
            void this.handleExportClick();
        });
        this.autoSaveCheckbox?.addEventListener('change', () => {
            void this.handleAutoSaveToggle();
        });

        if (this.autoSaveCheckbox) {
            this.autoSaveCheckbox.checked = this.autoSaveEnabled;
        }

        DebugLog.subscribe((event, payload) => {
            this.handleDebugLogEvent(event, payload);
        });
        LLMCache.subscribe(() => {
            this.refreshControlState();
            this.updateIdleStatus();
            if (!this.supported || !this.autoSaveEnabled || !LLMCache.hasCompleteFlow()) return;
            const entries = DebugLog.serializeEntries();
            const run = this.currentRun || buildRunContextFromEntries(entries);
            if (entries.length === 0 || !run) return;
            this.queueWrite(entries, run, false);
        });

        this.refreshControlState();
        this.updateRunContextFromEntries(DebugLog.serializeEntries());
        this.setStatus('Checking fixed debug export path…', '');
        void this.checkServerSupport();
    },

    refreshControlState() {
        if (this.exportBtn) {
            this.exportBtn.disabled = this.busy || !this.supported || !LLMCache.hasCompleteFlow();
        }
        if (this.autoSaveCheckbox) {
            this.autoSaveCheckbox.disabled = this.busy || !this.supported;
        }
    },

    setBusy(isBusy: boolean) {
        this.busy = isBusy;
        this.refreshControlState();
    },

    setStatus(message: string, tone: '' | 'success' | 'error' | 'warning' = '') {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        this.statusEl.classList.remove('success', 'error', 'warning');
        if (tone) this.statusEl.classList.add(tone);
    },

    async checkServerSupport() {
        try {
            const payload = await fetchBundleApi('/health', { method: 'GET' });
            this.supported = payload?.ok === true;
            this.exportRootPath = payload?.exportRoot || EXPORT_ROOT_DIR_NAME;
            this.refreshControlState();
            this.updateIdleStatus();
        } catch (err: any) {
            this.supported = false;
            this.refreshControlState();
            this.setStatus(err?.message || 'Debug bundle export is unavailable in this runtime.', 'warning');
        }
    },

    updateIdleStatus() {
        if (!this.supported) return;
        if (!LLMCache.hasCompleteFlow()) {
            this.setStatus('', '');
            return;
        }
        this.setStatus('', '');
    },

    handleDebugLogEvent(event: 'add' | 'update' | 'clear', payload?: any) {
        if (event === 'clear') {
            const previousEntries = Array.isArray(payload?.previousEntries) ? payload.previousEntries : [];
            const previousRun = this.currentRun;
            this.clearAutoSaveTimer();
            if (
                this.supported &&
                this.autoSaveEnabled &&
                LLMCache.hasCompleteFlow() &&
                previousRun &&
                previousEntries.length > 0
            ) {
                this.queueWrite(previousEntries, previousRun, false);
            }
            this.currentRun = null;
            this.updateIdleStatus();
            return;
        }

        const entries = DebugLog.serializeEntries();
        this.updateRunContextFromEntries(entries);
        if (this.supported && this.autoSaveEnabled && LLMCache.hasCompleteFlow() && entries.length > 0) {
            this.scheduleAutoSave();
        }
    },

    updateRunContextFromEntries(entries: any[]) {
        const userEntry = entries.find(entry => entry?.stageClass === 'user-input');
        if (!userEntry) return;
        const startedAt = toIsoString(userEntry.timestamp);
        if (this.currentRun?.startedAt === startedAt) return;
        this.currentRun = buildRunContextFromEntries(entries);
    },

    clearAutoSaveTimer() {
        if (this.autoSaveTimer != null) {
            window.clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = undefined;
        }
    },

    scheduleAutoSave() {
        this.clearAutoSaveTimer();
        this.autoSaveTimer = window.setTimeout(() => {
            this.autoSaveTimer = undefined;
            const entries = DebugLog.serializeEntries();
            const run = this.currentRun || buildRunContextFromEntries(entries);
            if (entries.length === 0 || !run) return;
            this.queueWrite(entries, run, false);
        }, AUTO_SAVE_DEBOUNCE_MS);
    },

    async handleAutoSaveToggle() {
        if (!this.supported) {
            if (this.autoSaveCheckbox) this.autoSaveCheckbox.checked = false;
            this.setStatus('Fixed-path debug bundle export is unavailable in this runtime.', 'warning');
            return;
        }

        const enabled = !!this.autoSaveCheckbox?.checked;
        this.autoSaveEnabled = enabled;
        settingsStore.setString(STORAGE_KEYS.debugBundleAutoSave, String(enabled));

        if (enabled) {
            const entries = DebugLog.serializeEntries();
            if (entries.length > 0) {
                this.updateRunContextFromEntries(entries);
                this.scheduleAutoSave();
            }
            this.setStatus(`Auto-save enabled. New bundles will be written into ${this.exportRootPath}.`, 'success');
        } else {
            this.clearAutoSaveTimer();
            this.setStatus(`Auto-save disabled. Use Export current run to write into ${this.exportRootPath}.`, '');
        }
    },

    async handleExportClick() {
        if (!this.supported) {
            await this.checkServerSupport();
            if (!this.supported) return;
        }
        if (!LLMCache.hasCompleteFlow()) {
            this.setStatus('Bundle export is locked until the current run reaches the full cycle.', 'warning');
            return;
        }

        const entries = DebugLog.serializeEntries();
        if (entries.length === 0) {
            this.setStatus('Nothing to export yet. Run the pipeline first.', 'warning');
            return;
        }

        this.updateRunContextFromEntries(entries);
        const run = this.currentRun || buildRunContextFromEntries(entries);
        this.setBusy(true);
        try {
            const result = await this.writeBundle(entries, run);
            const runDir = result?.runDir || `${EXPORT_ROOT_DIR_NAME}/${run.folderName}/`;
            this.setStatus(`Exported current run to ${runDir}.`, 'success');
        } catch (err: any) {
            this.setStatus(err?.message || 'Failed to export the current debug run.', 'error');
        } finally {
            this.setBusy(false);
        }
    },

    queueWrite(entries: any[], run: DebugBundleRunContext, interactive: boolean) {
        this.writeQueue = this.writeQueue
            .then(async () => {
                const result = await this.writeBundle(entries, run);
                if (interactive && result?.runDir) {
                    this.setStatus(`Exported current run to ${result.runDir}.`, 'success');
                }
            })
            .catch((err: any) => {
                const message = interactive
                    ? err?.message || 'Debug bundle export failed.'
                    : err?.message || 'Auto-save could not write the debug bundle.';
                this.setStatus(message, 'warning');
            });
    },

    async writeBundle(entries: any[], run: DebugBundleRunContext) {
        const payload = buildBundlePayload(entries, run);
        return await fetchBundleApi('/write', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
};

export function initDebugBundleExport() {
    DebugBundleExport.init();
}
