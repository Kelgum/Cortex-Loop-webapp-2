import { expect, test, type Page } from '@playwright/test';

const CACHE_SCHEMA = 1;
const PROMPT = '4 hours of deep focus, no sleep quality impact';
const STREAM_CARD_ID = 'stream-card-expand-test';
const HOURS = Array.from({ length: 25 }, (_, idx) => 6 + idx);

function buildCurve(effect: string, color: string, baselineBase: number, desiredBase: number) {
    return {
        effect,
        color,
        polarity: 'higher_is_better',
        levels: [
            { step: 0, intensity_percent: 0, label: 'Low', full_context: 'Low intensity' },
            { step: 1, intensity_percent: 25, label: 'Stable', full_context: 'Stable intensity' },
            { step: 2, intensity_percent: 50, label: 'Active', full_context: 'Active intensity' },
            { step: 3, intensity_percent: 75, label: 'High', full_context: 'High intensity' },
            { step: 4, intensity_percent: 100, label: 'Peak', full_context: 'Peak intensity' },
        ],
        baseline: HOURS.map((hour, idx) => ({
            hour,
            value: baselineBase + Math.round(Math.sin(idx / 4) * 6),
        })),
        desired: HOURS.map((hour, idx) => ({
            hour,
            value: desiredBase + Math.round(Math.sin(idx / 4) * 6),
        })),
    };
}

function buildChannelData(base: number, amplitude: number) {
    return HOURS.map((hour, idx) => ({
        hour,
        value: base + Math.round(Math.sin(idx / 3) * amplitude),
    }));
}

function buildCacheEnvelope(stageClass: string, payload: unknown) {
    return JSON.stringify({
        __lxStudioCache: CACHE_SCHEMA,
        payload,
        meta: {
            stageClass,
            cacheKey: `lx_studio_cache_${stageClass}`,
            cachedAt: '2026-03-06T00:00:00.000Z',
        },
    });
}

function buildStreamCardIcon() {
    return (
        `<svg data-v="10" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice">` +
        `<rect class="ci-bg" width="200" height="120" rx="8"/>` +
        `<rect x="18" y="18" width="164" height="84" rx="12" fill="rgba(96,165,250,0.16)"/>` +
        `<circle cx="58" cy="60" r="18" fill="rgba(52,211,153,0.48)"/>` +
        `<path d="M92 42h58v10H92z" fill="rgba(255,255,255,0.22)"/>` +
        `<path d="M92 60h42v8H92z" fill="rgba(255,255,255,0.16)"/>` +
        `<rect class="ci-frame" x="20" y="20" width="160" height="80" rx="10" fill="none"/>` +
        `</svg>`
    );
}

function buildStreamCardRecord() {
    const curves = [
        buildCurve('Focus', '#60a5fa', 32, 70),
        buildCurve('Calm', '#34d399', 38, 60),
    ];

    const indexEntry = {
        id: STREAM_CARD_ID,
        filename: 'Focus Reset',
        overlayTitle: 'Focus Reset',
        prompt: 'Sharper focus with steadier calm across a full work block.',
        maxEffects: 2,
        rxMode: 'none',
        savedAt: '2026-04-10T09:00:00.000Z',
        hookSentence: 'Sharpen the sprint without fraying the edges.',
        topEffects: ['Focus', 'Calm'],
        curveEffects: ['Focus', 'Calm'],
        curveColors: ['#60a5fa', '#34d399'],
        curvePolarities: ['higher_is_better', 'higher_is_better'],
        badgeCategory: 'Neuro',
        iconSvg: buildStreamCardIcon(),
        recommendedDevices: ['watch'],
        substanceClasses: ['Nootropic', 'Adaptogen'],
        timeHorizon: { durationDays: 28, mode: 'program' },
        effectScores: [58, 41],
        effectScoresVersion: 1,
        protocolConfidence: 72,
        confidenceVersion: 1,
    };

    const record = {
        ...indexEntry,
        createdAt: '2026-04-10T09:00:00.000Z',
        bundle: {
            stages: {
                'fast-model': {
                    payload: {
                        hookSentence: 'Sharpen the sprint without fraying the edges.',
                    },
                },
                'main-model': {
                    payload: {
                        curves,
                    },
                },
                'intervention-model': {
                    payload: {
                        interventions: [
                            { key: 'caffeineIR', timeMinutes: 495, dose: '100mg', targetEffect: 'Focus' },
                            { key: 'lTheanine', timeMinutes: 525, dose: '200mg', targetEffect: 'Calm' },
                        ],
                    },
                },
                'sherlock-model': {
                    payload: {
                        beats: [],
                    },
                },
            },
        },
    };

    return { indexEntry, record };
}

async function seedCachedPipeline(page: Page) {
    const curves = [
        buildCurve('Focus', '#60a5fa', 36, 68),
        buildCurve('Calm', '#34d399', 42, 58),
    ];

    const enabled = {
        'fast-model': true,
        'main-model': true,
        'intervention-model': true,
        'biometric-rec-model': true,
        'biometric-profile-model': true,
        'biometric-channel-model': true,
        'biometric-model': true,
    };

    const cachedEntries = {
        'fast-model': {
            effects: [
                { name: 'Focus', relevance: 92 },
                { name: 'Calm', relevance: 84 },
                { name: 'Clarity', relevance: 71 },
            ],
            hookSentence: 'Tighten focus without borrowing from sleep.',
        },
        'main-model': { curves },
        'intervention-model': {
            interventions: [
                { key: 'caffeineIR', timeMinutes: 480, dose: '100mg', targetEffect: 'Focus' },
                { key: 'lTheanine', timeMinutes: 510, dose: '200mg', targetEffect: 'Calm' },
            ],
            rationale: 'Front-load clean stimulation, then smooth the edge.',
        },
        'biometric-rec-model': {
            recommended: ['watch'],
            reasoning: [{ device: 'watch', rank: '1', rationale: 'Best overlap for cardio and recovery.' }],
        },
        'biometric-profile-model': {
            profileText: 'Resting HR 62 bpm, HRV 45 ms, sleep score 78.',
            tensionDirectives: ['Midday strain should still appear despite the stack.'],
        },
        'biometric-channel-model': [
            {
                signal: 'hr_bpm',
                displayName: 'Heart Rate',
                device: 'watch',
                deviceName: 'Watch',
                color: '#ff4d4d',
                range: [40, 180],
                unit: 'bpm',
                stripHeight: 18,
            },
            {
                signal: 'hrv_ms',
                displayName: 'HRV',
                device: 'watch',
                deviceName: 'Watch',
                color: '#e03e3e',
                range: [10, 120],
                unit: 'ms',
                stripHeight: 16,
            },
        ],
        'biometric-model': {
            channels: [
                {
                    signal: 'hr_bpm',
                    displayName: 'Heart Rate',
                    device: 'watch',
                    deviceName: 'Watch',
                    color: '#ff4d4d',
                    range: [40, 180],
                    unit: 'bpm',
                    stripHeight: 18,
                    data: buildChannelData(66, 7),
                },
                {
                    signal: 'hrv_ms',
                    displayName: 'HRV',
                    device: 'watch',
                    deviceName: 'Watch',
                    color: '#e03e3e',
                    range: [10, 120],
                    unit: 'ms',
                    stripHeight: 16,
                    data: buildChannelData(48, 6),
                },
            ],
            highlights: [],
        },
    };

    await page.addInitScript(
        ({ enabledMap, entries }) => {
            window.localStorage.clear();
            window.sessionStorage.clear();
            window.localStorage.setItem('lx_studio_sherlock_enabled', 'false');
            window.localStorage.setItem('lx_studio_llm', 'anthropic');
            window.localStorage.setItem('lx_studio_cache_enabled', JSON.stringify(enabledMap));
            window.localStorage.setItem('lx_studio_theme', 'dark');
            window.localStorage.setItem('lx_studio_max_effects', '2');
            for (const [stageClass, payload] of Object.entries(entries)) {
                window.localStorage.setItem(`lx_studio_cache_${stageClass}`, JSON.stringify(payload));
            }
        },
        {
            enabledMap: enabled,
            entries: Object.fromEntries(
                Object.entries(cachedEntries).map(([stageClass, payload]) => [
                    stageClass,
                    JSON.parse(buildCacheEnvelope(stageClass, payload)),
                ]),
            ),
        },
    );
}

test('persists theme and settings selections', async ({ page }) => {
    await page.goto('/');

    await page.locator('#settings-btn').click();
    await page.locator('#llm-select').selectOption('openai');
    await page.locator('#effects-select').selectOption('1');
    await page.locator('#sherlock-toggle').uncheck();
    await page.locator('#theme-toggle-btn').click();

    await page.reload();

    await expect(page.locator('body')).toHaveClass(/light-mode/);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#llm-select')).toHaveValue('openai');
    await expect(page.locator('#effects-select')).toHaveValue('1');
    await expect(page.locator('#sherlock-toggle')).not.toBeChecked();
});

test('replays the cached prompt-to-biometric flow', async ({ page }) => {
    await seedCachedPipeline(page);
    await page.goto('/');

    await page.locator('#prompt-input').fill(PROMPT);
    await page.locator('#prompt-submit').click();

    const strategistPlay = page.locator('#strategist-play-btn');
    const strategistLeftLabel = page.locator('.strategist-vcr-panel .vcr-step-left');
    const strategistRightLabel = page.locator('.strategist-vcr-panel .vcr-step-right');
    await expect(strategistPlay).toBeVisible({ timeout: 20_000 });
    await expect(strategistRightLabel).toHaveText('Baseline', { timeout: 40_000 });
    await expect(strategistPlay).not.toHaveClass(/loading/, { timeout: 20_000 });
    await expect(strategistLeftLabel).toHaveText('Analysis', { timeout: 10_000 });

    // S0 -> S1: Baseline replaces Analysis on the left, Optimize appears on the right.
    await strategistPlay.click();
    await expect(strategistLeftLabel).toHaveText('Baseline', { timeout: 10_000 });
    await expect(strategistRightLabel).toHaveText('Optimize', { timeout: 10_000 });
    await page.waitForTimeout(600);

    // S1 -> S2: Optimizing left, spinner center, right wing collapsed.
    await strategistPlay.click();
    await expect(strategistPlay).toHaveClass(/loading/, { timeout: 10_000 });
    await expect(strategistLeftLabel).toHaveText(/Optimizing/, { timeout: 10_000 });

    // Canon pre-play: play + enabled next + first substance on right.
    const vcrPanel = page.locator('.vcr-control-panel');
    const interventionPlay = page.locator('#intervention-play-btn');
    const vcrPrev = page.locator('.vcr-control-panel .vcr-prev');
    const vcrNext = page.locator('.vcr-control-panel .vcr-next');
    const vcrLeftLabel = page.locator('.vcr-control-panel .vcr-step-left');
    const vcrRightLabel = page.locator('.vcr-control-panel .vcr-step-right');
    await expect(interventionPlay).toBeVisible({ timeout: 20_000 });
    await expect(interventionPlay).not.toHaveClass(/loading/, { timeout: 20_000 });
    await expect(vcrPanel).toHaveClass(/vcr-preplay/, { timeout: 10_000 });
    await expect(vcrNext).toBeVisible({ timeout: 10_000 });
    await expect(vcrNext).toBeEnabled({ timeout: 10_000 });
    await expect(vcrPrev).toHaveClass(/vcr-btn-hidden/, { timeout: 10_000 });
    await expect(vcrRightLabel).not.toHaveText('', { timeout: 10_000 });
    await page.waitForTimeout(1200);
    await expect(interventionPlay).toHaveAttribute('title', 'Play');

    // Pre-play Next = step once (manual), not autoplay.
    await vcrNext.click();
    await expect(interventionPlay).toHaveAttribute('title', 'Play', { timeout: 10_000 });
    await expect(vcrLeftLabel).not.toHaveText('', { timeout: 20_000 });
    await expect(vcrPrev).toBeVisible({ timeout: 10_000 });
    await expect(vcrPrev).toBeEnabled({ timeout: 10_000 });

    // User play starts autoplay.
    await interventionPlay.click();

    await expect(interventionPlay).toHaveAttribute('title', 'Start biometric loop', { timeout: 30_000 });
    await expect(interventionPlay).toHaveClass(/vcr-play-bio/, { timeout: 30_000 });
    await expect(vcrPrev).toHaveClass(/vcr-btn-hidden/, { timeout: 30_000 });
    await expect(vcrNext).toHaveClass(/vcr-btn-hidden/, { timeout: 30_000 });
    await expect(vcrLeftLabel).toHaveText('', { timeout: 30_000 });
    await interventionPlay.click();

    const goButton = page.locator('#bio-go-btn');
    await expect(goButton).toBeEnabled({ timeout: 15_000 });
    await goButton.click();

    const submitButton = page.locator('#bio-submit-btn');
    await expect(submitButton).toBeVisible({ timeout: 10_000 });
    await submitButton.click();

    await page.waitForFunction(() => {
        const group = document.querySelector('#phase-biometric-strips');
        return (group?.childElementCount ?? 0) > 0;
    }, undefined, { timeout: 20_000 });

    await expect(page.locator('#phase-biometric-strips')).toBeVisible();
});

test('stages stream card expansion before revealing expanded content', async ({ page }) => {
    const { indexEntry, record } = buildStreamCardRecord();

    await page.route('**/__cycles/index', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([indexEntry]),
        });
    });

    await page.route(`**/__cycles/${STREAM_CARD_ID}`, async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(record),
        });
    });

    await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem('lx_studio_theme', 'dark');
    });

    await page.goto('/#stream');

    await expect(page.locator('body')).toHaveClass(/mode-stream/);

    const card = page.locator(`.stream-section .cg-card[data-cycle-id="${STREAM_CARD_ID}"]`).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const clone = page.locator('.cg-card.cg-card-expanded');
    await expect(clone).toHaveCount(1);
    await expect(card).toHaveCSS('visibility', 'hidden');

    await page.waitForTimeout(120);
    await expect(clone).toHaveAttribute('data-expand-stage', 'shell-open');
    await expect(clone.locator(':scope > .cg-card-expand-panel')).toHaveCount(0);
    await expect(clone.locator('.cg-card-overlay-title-ghost')).toBeVisible();
    await expect(clone.locator('.cg-card-overlay-title-live')).toHaveCSS('opacity', '0');

    await expect(clone).toHaveAttribute('data-expand-stage', 'open', { timeout: 2_000 });
    await expect(clone.locator(':scope > .cg-card-expand-panel')).toBeVisible();
    await expect(clone.locator(':scope > .cg-expand-close')).toBeVisible();
    await expect(clone.locator('.cg-card-overlay-title-live')).toHaveCSS('opacity', '0');
    await expect(clone.locator('.cg-card-overlay-title-ghost')).toBeVisible();
    await expect(clone.locator('.cg-trailer-hero-svg')).toHaveCount(1);

    const rightCol = clone.locator('.cg-expand-col-right');
    const rightColBefore = await rightCol.boundingBox();

    await expect(clone).toHaveAttribute('data-trailer-title', 'expanded', { timeout: 5_000 });
    await page.waitForTimeout(300);

    await expect(clone.locator('.cg-card-overlay-title-live')).toBeVisible();
    await expect(clone.locator('.cg-trailer-hero-svg')).toHaveClass(/cg-trailer-hero-svg--visible/);
    const rightColAfter = await rightCol.boundingBox();
    expect(rightColBefore?.x).toBeDefined();
    expect(rightColAfter?.x).toBeDefined();
    expect(Math.abs((rightColAfter?.x ?? 0) - (rightColBefore?.x ?? 0))).toBeLessThan(2);

    await page.mouse.click(10, 10);

    await expect(page.locator('.cg-card.cg-card-expanded')).toHaveCount(0, { timeout: 2_000 });
    await expect(card).toHaveCSS('visibility', 'visible');
});
