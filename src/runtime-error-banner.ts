type RuntimeBugPayload = {
    stage: string;
    provider?: string;
    message: string;
    retryProvider?: string | null;
};

type RuntimeFallbackPayload = {
    stage: string;
    failedProvider: string;
    failedMessage?: string;
    failedModel?: string | null;
    activeProvider: string;
    activeModel?: string | null;
};

type RuntimeWarningPayload = {
    title: string;
    body: string;
    detail?: string;
};

const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
    grok: 'Grok',
};

function providerLabel(provider: string): string {
    return PROVIDER_LABELS[provider] || provider;
}

/** Full untruncated error text for the copy button. */
let _fullErrorText = '';

function getEls() {
    if (typeof document === 'undefined') {
        return {
            root: null,
            collapsedLabel: null,
            title: null,
            body: null,
            retry: null,
            toggleBtn: null,
            hideBtn: null,
            copyBtn: null,
        };
    }
    const root = document.getElementById('runtime-error-banner');
    const collapsedLabel = document.getElementById('runtime-error-collapsed-label');
    const title = document.getElementById('runtime-error-title');
    const body = document.getElementById('runtime-error-body');
    const retry = document.getElementById('runtime-error-retry');
    const toggleBtn = document.getElementById('runtime-error-toggle-btn');
    const hideBtn = document.getElementById('runtime-error-hide-btn');
    const copyBtn = document.getElementById('runtime-error-copy-btn');
    return {
        root: root as HTMLDivElement | null,
        collapsedLabel: collapsedLabel as HTMLDivElement | null,
        title: title as HTMLDivElement | null,
        body: body as HTMLDivElement | null,
        retry: retry as HTMLDivElement | null,
        toggleBtn: toggleBtn as HTMLButtonElement | null,
        hideBtn: hideBtn as HTMLButtonElement | null,
        copyBtn: copyBtn as HTMLButtonElement | null,
    };
}

function summarizeMessage(message: string): string {
    const text = String(message || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return 'Unknown runtime error.';
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function providerWithModel(provider: string, model?: string | null): string {
    const base = providerLabel(provider);
    const trimmedModel = String(model || '').trim();
    if (!trimmedModel) return base;
    return `${base} (${trimmedModel})`;
}

function setBannerVariant(variant: 'error' | 'warning'): void {
    const { root } = getEls();
    if (!root) return;
    root.classList.toggle('warning', variant === 'warning');
}

export function initRuntimeErrorBanner(): void {
    const { hideBtn, copyBtn, toggleBtn } = getEls();
    if (!hideBtn || hideBtn.dataset.bound === '1') return;
    hideBtn.dataset.bound = '1';
    hideBtn.addEventListener('click', () => {
        hideRuntimeBug();
    });
    if (toggleBtn && toggleBtn.dataset.bound !== '1') {
        toggleBtn.dataset.bound = '1';
        toggleBtn.addEventListener('click', () => {
            const { root } = getEls();
            if (!root) return;
            const isCollapsed = root.classList.contains('collapsed');
            root.classList.toggle('collapsed', !isCollapsed);
            toggleBtn.textContent = isCollapsed ? 'Collapse' : 'Details';
        });
    }
    if (copyBtn && copyBtn.dataset.bound !== '1') {
        copyBtn.dataset.bound = '1';
        copyBtn.addEventListener('click', () => {
            if (!_fullErrorText) return;
            navigator.clipboard.writeText(_fullErrorText).then(
                () => {
                    copyBtn.textContent = 'Copied';
                    setTimeout(() => {
                        copyBtn.textContent = 'Copy';
                    }, 1500);
                },
                () => {
                    /* clipboard write failed — silently ignore */
                },
            );
        });
    }
}

export function reportRuntimeBug(payload: RuntimeBugPayload): void {
    const { root, collapsedLabel, title, body, retry, toggleBtn } = getEls();
    if (!root || !title || !body || !retry) return;
    setBannerVariant('error');

    const failedProvider = payload.provider ? providerLabel(payload.provider) : null;
    const retryProvider = payload.retryProvider ? providerLabel(payload.retryProvider) : null;
    const stage = String(payload.stage || 'Agent');
    const rawMessage = String(payload.message || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (collapsedLabel) collapsedLabel.textContent = 'System notice';
    title.textContent = `${stage} bug detected`;
    body.textContent = failedProvider
        ? `${failedProvider} failed: ${summarizeMessage(payload.message)}`
        : summarizeMessage(payload.message);

    // Store full untruncated text for the copy button
    const retryLine = retryProvider ? `Retrying with ${retryProvider}...` : 'No fallback providers left.';
    _fullErrorText = `${stage} bug detected\n${failedProvider ? `${failedProvider} failed: ` : ''}${rawMessage}\n${retryLine}`;

    if (retryProvider) {
        retry.textContent = `Retrying with ${retryProvider}...`;
        retry.style.display = '';
    } else {
        retry.textContent = 'No fallback providers left.';
        retry.style.display = '';
    }

    root.classList.add('collapsed');
    if (toggleBtn) toggleBtn.textContent = 'Details';
    root.classList.remove('hidden');
}

export function reportRuntimeFallback(payload: RuntimeFallbackPayload): void {
    const { root, collapsedLabel, title, body, retry, toggleBtn } = getEls();
    if (!root || !title || !body || !retry) return;
    setBannerVariant('error');

    const stage = String(payload.stage || 'Agent');
    const failed = providerWithModel(payload.failedProvider, payload.failedModel);
    const active = providerWithModel(payload.activeProvider, payload.activeModel);
    const rawMessage = String(payload.failedMessage || 'Request failed.')
        .replace(/\s+/g, ' ')
        .trim();
    const message = summarizeMessage(rawMessage);

    if (collapsedLabel) collapsedLabel.textContent = 'Pipeline adapted';
    title.textContent = `${stage} fallback applied`;
    body.textContent = `${failed} failed: ${message}`;
    retry.textContent = `Fell back to ${active}.`;
    retry.style.display = '';

    // Store full untruncated text for the copy button
    _fullErrorText = `${stage} fallback applied\n${failed} failed: ${rawMessage}\nFell back to ${active}.`;

    root.classList.add('collapsed');
    if (toggleBtn) toggleBtn.textContent = 'Details';
    root.classList.remove('hidden');
}

export function reportRuntimeCacheWarning(payload: RuntimeWarningPayload): void {
    const { root, collapsedLabel, title, body, retry, toggleBtn } = getEls();
    if (!root || !title || !body || !retry) return;
    setBannerVariant('warning');

    const titleText = String(payload.title || 'Cache warning');
    const rawBody = String(payload.body || 'Cache state needs attention.')
        .replace(/\s+/g, ' ')
        .trim();
    const detail = String(payload.detail || '').trim();

    if (collapsedLabel) collapsedLabel.textContent = 'System notice';
    title.textContent = titleText;
    body.textContent = summarizeMessage(rawBody);
    retry.textContent = detail;
    retry.style.display = detail ? '' : 'none';

    // Store full untruncated text for the copy button
    _fullErrorText = `${titleText}\n${rawBody}${detail ? `\n${detail}` : ''}`;

    root.classList.add('collapsed');
    if (toggleBtn) toggleBtn.textContent = 'Details';
    root.classList.remove('hidden');
}

export function hideRuntimeBug(): void {
    const { root } = getEls();
    if (!root) return;
    root.classList.add('hidden');
    root.classList.remove('warning');
}

export function clearRuntimeBug(): void {
    const { root, title, body, retry, toggleBtn } = getEls();
    if (!root || !title || !body || !retry) return;
    title.textContent = 'Agent bug detected';
    body.textContent = '';
    retry.textContent = '';
    retry.style.display = 'none';
    root.classList.add('hidden', 'collapsed');
    root.classList.remove('warning');
    if (toggleBtn) toggleBtn.textContent = 'Details';
}
