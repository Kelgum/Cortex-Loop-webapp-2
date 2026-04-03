export const STORAGE_KEYS = {
    selectedLlm: 'cortex_llm',
    maxEffects: 'cortex_max_effects',
    sherlockEnabled: 'cortex_sherlock_enabled',
    theme: 'cortex_theme',
    ribbonCollapsed: 'cortex_ribbon_collapsed',
    pipelineCollapsed: 'cortex_pipeline_collapsed',
    startAtPhase: 'cortex_start_phase',
    lastBioDevices: 'cortex_last_bio_devices',
    debugBundleAutoSave: 'cortex_debug_bundle_autosave',
    savedCyclesIndex: 'cortex_saved_cycles_index',
    loadedCycleId: 'cortex_loaded_cycle_id',
    abOverlayPos: 'cortex_ab_overlay_pos',
    abOverlayCollapsed: 'cortex_ab_overlay_collapsed',
    llmLog: 'cortex_llm_log',
    bandBrightness: 'cortex_band_brightness',
    presetsCollapsed: 'cortex_presets_collapsed',
    appMode: 'cortex_app_mode',
    streamCardDensity: 'cortex_stream_card_density',
    streamCardChrome: 'cortex_stream_card_chrome',
    streamTitleScale: 'cortex_stream_title_scale',
    streamTitleColorIntensity: 'cortex_stream_title_color_intensity',
    streamBadgeIntensity: 'cortex_stream_badge_intensity',
    customSectionTitles: 'cortex_custom_section_titles',
    customSectionEffects: 'cortex_custom_section_effects',
    customSectionNegativeTags: 'cortex_custom_section_negative_tags',
    sectionOrder: 'cortex_section_order',
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
    return `cortex_stage_${stage}`;
}

export function stageProviderKey(stage: string): string {
    return `cortex_stage_provider_${stage}`;
}

export function providerApiKeyKey(provider: string): string {
    return `cortex_key_${provider}`;
}
