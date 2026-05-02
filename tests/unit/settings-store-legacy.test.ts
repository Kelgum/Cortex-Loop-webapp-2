import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionSettingsStore, settingsStore } from '../../src/settings-store';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
    const values = new Map(Object.entries(initial));
    return {
        get length() {
            return values.size;
        },
        clear() {
            values.clear();
        },
        getItem(key: string) {
            return values.has(key) ? values.get(key)! : null;
        },
        key(index: number) {
            return Array.from(values.keys())[index] ?? null;
        },
        removeItem(key: string) {
            values.delete(key);
        },
        setItem(key: string, value: string) {
            values.set(key, String(value));
        },
    };
}

describe('settingsStore legacy key compatibility', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reads and migrates old cortex localStorage keys for lx_studio settings', () => {
        const localStorage = createMemoryStorage({ cortex_theme: 'dark' });
        vi.stubGlobal('window', {
            localStorage,
            sessionStorage: createMemoryStorage(),
        });

        expect(settingsStore.getString('lx_studio_theme')).toBe('dark');
        expect(localStorage.getItem('lx_studio_theme')).toBe('dark');
    });

    it('removes both current and old keys when clearing renamed settings', () => {
        const localStorage = createMemoryStorage({
            cortex_loaded_cycle_id: 'legacy-cycle',
            lx_studio_loaded_cycle_id: 'current-cycle',
        });
        vi.stubGlobal('window', {
            localStorage,
            sessionStorage: createMemoryStorage(),
        });

        settingsStore.remove('lx_studio_loaded_cycle_id');

        expect(localStorage.getItem('lx_studio_loaded_cycle_id')).toBeNull();
        expect(localStorage.getItem('cortex_loaded_cycle_id')).toBeNull();
    });

    it('also applies the fallback to sessionStorage pending-flow state', () => {
        const sessionStorage = createMemoryStorage({
            cortex_pending_prompt_after_hard_reset_v1: '{"prompt":"cached","timestamp":1}',
        });
        vi.stubGlobal('window', {
            localStorage: createMemoryStorage(),
            sessionStorage,
        });

        expect(sessionSettingsStore.getJson('lx_studio_pending_prompt_after_hard_reset_v1', null)).toEqual({
            prompt: 'cached',
            timestamp: 1,
        });
        expect(sessionStorage.getItem('lx_studio_pending_prompt_after_hard_reset_v1')).toBe(
            '{"prompt":"cached","timestamp":1}',
        );
    });
});
