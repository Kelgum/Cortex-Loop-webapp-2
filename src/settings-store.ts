export const STORAGE_KEYS = {
    selectedLlm: 'lx_studio_llm',
    maxEffects: 'lx_studio_max_effects',
    sherlockEnabled: 'lx_studio_sherlock_enabled',
    theme: 'lx_studio_theme',
    ribbonCollapsed: 'lx_studio_ribbon_collapsed',
    pipelineCollapsed: 'lx_studio_pipeline_collapsed',
    startAtPhase: 'lx_studio_start_phase',
    lastBioDevices: 'lx_studio_last_bio_devices',
    debugBundleAutoSave: 'lx_studio_debug_bundle_autosave',
    savedCyclesIndex: 'lx_studio_saved_cycles_index',
    loadedCycleId: 'lx_studio_loaded_cycle_id',
    abOverlayPos: 'lx_studio_ab_overlay_pos',
    abOverlayCollapsed: 'lx_studio_ab_overlay_collapsed',
    llmLog: 'lx_studio_llm_log',
    bandBrightness: 'lx_studio_band_brightness',
    presetsCollapsed: 'lx_studio_presets_collapsed',
    appMode: 'lx_studio_app_mode',
    streamCardDensity: 'lx_studio_stream_card_density',
    streamCardChrome: 'lx_studio_stream_card_chrome',
    streamTitleScale: 'lx_studio_stream_title_scale',
    streamTitleColorIntensity: 'lx_studio_stream_title_color_intensity',
    streamBadgeIntensity: 'lx_studio_stream_badge_intensity',
    streamScoreWeight: 'lx_studio_stream_score_weight',
    streamScoreScale: 'lx_studio_stream_score_scale',
    streamShowPrompt: 'lx_studio_stream_show_prompt',
    sectionOrder: 'lx_studio_section_order',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

function getStorage(kind: 'local' | 'session'): Storage | null {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
}

class SettingsStore {
    constructor(private readonly kind: 'local' | 'session') {}

    getString(key: string): string | null {
        try {
            return getStorage(this.kind)?.getItem(key) ?? null;
        } catch {
            return null;
        }
    }

    getBoolean(key: string, fallback: boolean): boolean {
        const raw = this.getString(key);
        if (raw == null) return fallback;
        return raw === 'true';
    }

    getNumber(key: string, fallback: number): number {
        const raw = this.getString(key);
        if (raw == null) return fallback;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    getJson<T>(key: string, fallback: T): T {
        const raw = this.getString(key);
        if (!raw) return fallback;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return fallback;
        }
    }

    setString(key: string, value: string): boolean {
        try {
            getStorage(this.kind)?.setItem(key, value);
            return true;
        } catch {
            // Ignore quota/storage errors. The in-memory state remains authoritative.
            return false;
        }
    }

    setJson(key: string, value: unknown): boolean {
        return this.setString(key, JSON.stringify(value));
    }

    remove(key: string): void {
        try {
            getStorage(this.kind)?.removeItem(key);
        } catch {
            // Ignore storage errors.
        }
    }

    keys(): string[] {
        const storage = getStorage(this.kind);
        if (!storage) return [];
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key) keys.push(key);
        }
        return keys;
    }
}

export const settingsStore = new SettingsStore('local');
export const sessionSettingsStore = new SettingsStore('session');

export function stageModelKey(stage: string): string {
    return `lx_studio_stage_${stage}`;
}

export function stageProviderKey(stage: string): string {
    return `lx_studio_stage_provider_${stage}`;
}

export function providerApiKeyKey(provider: string): string {
    return `lx_studio_key_${provider}`;
}

export function legacyProviderApiKeyKey(provider: string): string {
    return `cortex_key_${provider}`;
}
