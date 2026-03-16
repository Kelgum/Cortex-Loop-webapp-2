// ── Agent Designer — full-page form for encoding a protocol agent ────
import type { AgentConfig, AgentSignatureIntervention } from './creator-agent-types';
import {
    DOMAIN_TAGS,
    SUBSTANCE_CATEGORIES,
    GATED_CATEGORIES,
    DOSING_LABELS,
    DOSING_DESCRIPTIONS,
    MANDATE_PRESETS,
    DEFAULT_GUARDRAILS,
} from './creator-agent-types';
import { SUBSTANCE_DB } from './substances';
import { settingsStore } from './settings-store';
import { escapeHtml } from './utils';

// ── DOM refs (resolved once during init) ─────────────────────────────
let page: HTMLElement;
let content: HTMLElement;
let backBtn: HTMLElement;
let saveBtn: HTMLElement;
let previewBtn: HTMLElement;
let jsonPanel: HTMLElement;
let jsonOutput: HTMLPreElement;
let jsonCopyBtn: HTMLElement;
let jsonCloseBtn: HTMLElement;
let previewOverlay: HTMLElement;
let previewCard: HTMLElement;
let isReadOnly = false;
let onBackCallback: (() => void) | null = null;

// ── Public API ───────────────────────────────────────────────────────

export function initAgentDesigner(): void {
    page = document.getElementById('agent-designer-page')!;
    content = document.getElementById('agent-designer-content')!;
    backBtn = document.getElementById('agent-designer-back')!;
    saveBtn = document.getElementById('agent-save-btn')!;
    previewBtn = document.getElementById('agent-preview-card-btn')!;
    jsonPanel = document.getElementById('agent-json-panel')!;
    jsonOutput = document.getElementById('agent-json-output') as HTMLPreElement;
    jsonCopyBtn = document.getElementById('agent-json-copy-btn')!;
    jsonCloseBtn = document.getElementById('agent-json-close-btn')!;
    previewOverlay = document.getElementById('agent-preview-overlay')!;
    previewCard = document.getElementById('agent-preview-card')!;

    buildForm();

    // Navigation
    const designerBtn = document.getElementById('agent-designer-btn');
    designerBtn?.addEventListener('click', () => openAgentDesigner());

    backBtn.addEventListener('click', () => {
        closeAgentDesigner(onBackCallback ?? undefined);
    });

    // Save
    saveBtn.addEventListener('click', handleSave);

    // Preview
    previewBtn.addEventListener('click', handlePreview);

    // JSON panel
    jsonCloseBtn.addEventListener('click', () => jsonPanel.classList.remove('open'));
    jsonCopyBtn.addEventListener('click', handleCopyJson);

    // Preview overlay close on background click
    previewOverlay.addEventListener('click', e => {
        if (e.target === previewOverlay) previewOverlay.classList.add('hidden');
    });
}

export function openAgentDesigner(prefill?: AgentConfig, readOnly?: boolean, onBack?: () => void): void {
    isReadOnly = readOnly ?? false;
    onBackCallback = onBack ?? null;

    if (prefill) populateForm(prefill);

    // Show/hide readonly banner
    const banner = content.querySelector('.ad-readonly-banner') as HTMLElement | null;
    if (banner) banner.style.display = isReadOnly ? 'flex' : 'none';

    // Disable/enable inputs
    toggleFormDisabled(isReadOnly);

    // Update header buttons
    saveBtn.style.display = isReadOnly ? 'none' : '';
    previewBtn.style.display = isReadOnly ? 'none' : '';

    page.classList.remove('hidden');
    void page.offsetHeight; // force reflow so transition triggers
    page.classList.add('visible');
}

export function closeAgentDesigner(afterClose?: () => void): void {
    page.classList.remove('visible');
    jsonPanel.classList.remove('open');
    setTimeout(() => {
        page.classList.add('hidden');
        if (afterClose) afterClose();
    }, 360);
}

// ── Form builder ─────────────────────────────────────────────────────

function sectionHtml(num: number, title: string, intro: string, body: string): string {
    return `
        <div class="ad-section">
            <div class="ad-section-header">
                <span class="ad-section-num">${num}</span>
                <span class="ad-section-title">${title}</span>
            </div>
            ${intro ? `<p class="ad-section-intro">${intro}</p>` : ''}
            <div class="ad-section-body">${body}</div>
        </div>`;
}

function fieldHtml(label: string, input: string): string {
    return `<div class="ad-field"><label class="ad-label">${label}</label>${input}</div>`;
}

function buildForm(): void {
    const s1 = buildIdentitySection();
    const s2 = buildMandateSection();
    const s3 = buildSubstancePaletteSection();
    const s4 = buildWeightsSection();
    const s5 = buildGuardrailsSection();
    const s6 = buildInterventionsSection();

    content.innerHTML = `
        <div class="ad-readonly-banner" style="display:none;">
            <span class="ad-readonly-text">Viewing agent in read-only mode</span>
            <button class="ad-clone-btn" type="button">Edit Clone</button>
        </div>
        ${s1}${s2}${s3}${s4}${s5}${s6}
    `;

    // Wire dynamic behaviors after innerHTML
    wireCharCounter('ad-mandate-textarea', 'ad-mandate-counter', 800);
    wireCharCounter('ad-tagline-input', 'ad-tagline-counter', 80);
    wirePillToggles();
    wireDosingSlider();
    wireWeightSliders();
    wireGuardrails();
    wireInterventions();
    wireAvatarPreview();
    wireMandatePresets();
    wireCloneButton();
}

// ── Section 1: Identity ──────────────────────────────────────────────

function buildIdentitySection(): string {
    return sectionHtml(
        1,
        'Identity',
        '',
        `
        <div class="ad-avatar-hero">
            <div class="ad-avatar-preview" id="ad-avatar-preview"><img src="/assets/agent-human-driven.png" alt="Agent" /></div>
            <input id="ad-avatar-url" class="ad-input ad-avatar-url-input" type="text" placeholder="/avatars/name.jpg" />
        </div>
        <div class="ad-field-row">
            ${fieldHtml('Agent Name', '<input id="ad-name" class="ad-input" type="text" placeholder="e.g. The Longevity Stack" />')}
            ${fieldHtml('Creator Handle', '<input id="ad-creator" class="ad-input" type="text" placeholder="e.g. @hubermanlab" />')}
        </div>
        ${fieldHtml('Speciality Tagline <span id="ad-tagline-counter" class="ad-char-counter" style="float:right;text-transform:none">0 / 80</span>', '<input id="ad-tagline-input" class="ad-input" type="text" maxlength="80" placeholder="e.g. Sleep architecture & morning cortisol optimization for high performers" />')}
        <div class="ad-field">
            <label class="ad-label">Domain Tags</label>
            <div class="ad-pill-group" id="ad-domain-tags">
                ${DOMAIN_TAGS.map(t => `<button type="button" class="ad-pill" data-tag="${t}">${t}</button>`).join('')}
            </div>
        </div>
        ${fieldHtml('Target Population', '<input id="ad-population" class="ad-input" type="text" placeholder="e.g. Knowledge workers 30-50, moderate-high caffeine tolerance, disrupted sleep" />')}
    `,
    );
}

// ── Section 2: Mandate ───────────────────────────────────────────────

function buildMandateSection(): string {
    const presetChips = MANDATE_PRESETS.map(
        (p, i) => `<button type="button" class="ad-pill ad-pill--preset" data-preset-idx="${i}">${p.label}</button>`,
    ).join('');

    return sectionHtml(
        2,
        'Mandate',
        '',
        `
        ${fieldHtml(
            'Agent Mandate <span id="ad-mandate-counter" class="ad-char-counter" style="float:right;text-transform:none">0 / 800</span>',
            `<textarea id="ad-mandate-textarea" class="ad-textarea ad-textarea--large" maxlength="800"
                placeholder="Describe your agent's approach in your own words. What is it optimizing for? What are its hard limits? Who is it for? This becomes the agent's core system prompt."></textarea>`,
        )}
        <div class="ad-field">
            <label class="ad-label">Philosophy Presets</label>
            <div class="ad-pill-group" id="ad-mandate-presets">${presetChips}</div>
        </div>
    `,
    );
}

// ── Section 3: Substance Palette ─────────────────────────────────────

function buildSubstancePaletteSection(): string {
    const catPills = SUBSTANCE_CATEGORIES.map(
        c => `<button type="button" class="ad-pill" data-category="${c}">${c}</button>`,
    ).join('');

    const gatedPills = GATED_CATEGORIES.map(
        g => `<button type="button" class="ad-pill ad-pill--gated" data-gated="${g}">${g}</button>`,
    ).join('');

    return sectionHtml(
        3,
        'Substance Palette',
        'Define which substances your agent is permitted to prescribe',
        `
        <div class="ad-field">
            <label class="ad-label">Categories</label>
            <div class="ad-pill-group" id="ad-substance-cats">${catPills}</div>
        </div>
        <div class="ad-field">
            <label class="ad-label">Gated</label>
            <div class="ad-pill-group" id="ad-substance-gated">${gatedPills}</div>
        </div>
        <div class="ad-field">
            <label class="ad-label">Dosing Philosophy</label>
            <div class="ad-slider-row">
                <span class="ad-slider-label" style="min-width:100px">Microdose-First</span>
                <div class="ad-slider-wrap">
                    <input id="ad-dosing-slider" class="ad-slider" type="range" min="0" max="4" step="1" value="2" />
                </div>
                <span class="ad-slider-label" style="min-width:auto;text-align:right">Clinical-Range</span>
            </div>
            <div id="ad-dosing-label" class="ad-dosing-desc">${DOSING_DESCRIPTIONS[2]}</div>
        </div>
    `,
    );
}

// ── Section 4: Optimization Weights ──────────────────────────────────

const WEIGHT_KEYS: { key: string; label: string }[] = [
    { key: 'acutePerformance', label: 'Acute Performance' },
    { key: 'recoverySleep', label: 'Recovery & Sleep Quality' },
    { key: 'longTermNeuroplasticity', label: 'Long-term Neuroplasticity' },
    { key: 'minimalSideEffects', label: 'Minimal Side Effect Profile' },
    { key: 'costEfficiency', label: 'Cost Efficiency' },
];

function buildWeightsSection(): string {
    const sliders = WEIGHT_KEYS.map(
        w => `
        <div class="ad-slider-row">
            <span class="ad-slider-label">${w.label}</span>
            <div class="ad-slider-wrap">
                <input class="ad-slider ad-weight-slider" data-weight="${w.key}" type="range" min="0" max="100" step="1" value="50" />
            </div>
            <span class="ad-slider-value ad-weight-value" data-weight-val="${w.key}">50</span>
        </div>`,
    ).join('');

    return sectionHtml(
        4,
        'Optimization Weights',
        "Set your agent's multi-objective priorities. These weights shape how the Chess Player balances competing pharmacodynamic goals.",
        `${sliders}<p class="ad-note">Weights are normalized at runtime. They do not need to sum to 100.</p>`,
    );
}

// ── Section 5: Guardrails ────────────────────────────────────────────

function buildGuardrailsSection(): string {
    const tags = DEFAULT_GUARDRAILS.map(g => guardrailTagHtml(g)).join('');

    return sectionHtml(
        5,
        'Guardrails',
        'Define hard rules your agent will never violate, regardless of pharmacodynamic optimization pressure',
        `
        <div class="ad-guardrail-list" id="ad-guardrail-list">${tags}</div>
        <button type="button" class="ad-add-btn" id="ad-add-guardrail">+ Add Guardrail</button>
        <p class="ad-note">These rules are enforced as hard constraints before the agent's output is returned to the user.</p>
    `,
    );
}

function guardrailTagHtml(value: string): string {
    return `
        <div class="ad-guardrail-tag">
            <input class="ad-guardrail-input" type="text" value="${escapeHtml(value)}" placeholder="Enter a guardrail rule..." />
            <button type="button" class="ad-guardrail-remove">&times;</button>
        </div>`;
}

// ── Section 6: Signature Interventions ───────────────────────────────

function buildInterventionsSection(): string {
    return sectionHtml(
        6,
        'Signature Interventions',
        'Define anchor interventions your agent will prefer unless pharmacodynamic curves specifically argue against them. Your fingerprint on every protocol.',
        `
        <div id="ad-interventions-list"></div>
        <button type="button" class="ad-add-btn" id="ad-add-intervention">+ Add Signature Intervention</button>
    `,
    );
}

function interventionRowHtml(sub?: string, subKey?: string, timing?: string, rationale?: string): string {
    return `
        <div class="ad-intervention-row">
            <div class="ad-intervention-field">
                <input class="ad-input ad-iv-substance" type="text"
                    placeholder="Substance name..." value="${escapeHtml(sub ?? '')}"
                    ${subKey ? `data-substance-key="${escapeHtml(subKey)}"` : ''} />
            </div>
            <div class="ad-intervention-field">
                <input class="ad-input ad-iv-timing" type="text"
                    placeholder="Timing..." value="${escapeHtml(timing ?? '')}" />
            </div>
            <div class="ad-intervention-field">
                <input class="ad-input ad-iv-rationale" type="text" maxlength="100"
                    placeholder="Rationale (max 100 chars)" value="${escapeHtml(rationale ?? '')}" />
            </div>
            <button type="button" class="ad-guardrail-remove ad-iv-remove">&times;</button>
        </div>`;
}

// ── Wiring helpers ───────────────────────────────────────────────────

function wireCharCounter(inputId: string, counterId: string, max: number): void {
    const input = document.getElementById(inputId) as HTMLInputElement | HTMLTextAreaElement | null;
    const counter = document.getElementById(counterId);
    if (!input || !counter) return;

    const update = () => {
        const len = input.value.length;
        counter.textContent = `${len} / ${max}`;
        counter.classList.toggle('over', len > max);
    };
    input.addEventListener('input', update);
    update();
}

function wirePillToggles(): void {
    // Domain tags
    const domainGroup = document.getElementById('ad-domain-tags');
    domainGroup?.addEventListener('click', e => {
        const pill = (e.target as HTMLElement).closest('.ad-pill') as HTMLElement | null;
        if (pill && !isReadOnly) pill.classList.toggle('active');
    });

    // Substance categories
    const catGroup = document.getElementById('ad-substance-cats');
    catGroup?.addEventListener('click', e => {
        const pill = (e.target as HTMLElement).closest('.ad-pill') as HTMLElement | null;
        if (pill && !isReadOnly) pill.classList.toggle('active');
    });

    // Gated
    const gatedGroup = document.getElementById('ad-substance-gated');
    gatedGroup?.addEventListener('click', e => {
        const pill = (e.target as HTMLElement).closest('.ad-pill') as HTMLElement | null;
        if (pill && !isReadOnly) pill.classList.toggle('active');
    });
}

function wireDosingSlider(): void {
    const slider = document.getElementById('ad-dosing-slider') as HTMLInputElement | null;
    const label = document.getElementById('ad-dosing-label');
    if (!slider || !label) return;

    slider.addEventListener('input', () => {
        const idx = parseInt(slider.value, 10);
        label.textContent = DOSING_DESCRIPTIONS[idx] ?? '';
    });
}

function wireWeightSliders(): void {
    content.querySelectorAll('.ad-weight-slider').forEach(slider => {
        const input = slider as HTMLInputElement;
        const key = input.dataset.weight!;
        const valEl = content.querySelector(`[data-weight-val="${key}"]`);

        input.addEventListener('input', () => {
            if (valEl) valEl.textContent = input.value;
        });
    });
}

function wireGuardrails(): void {
    const list = document.getElementById('ad-guardrail-list')!;
    const addBtn = document.getElementById('ad-add-guardrail')!;

    // Delegate remove clicks
    list.addEventListener('click', e => {
        const removeBtn = (e.target as HTMLElement).closest('.ad-guardrail-remove');
        if (removeBtn && !isReadOnly) {
            removeBtn.closest('.ad-guardrail-tag')?.remove();
        }
    });

    addBtn.addEventListener('click', () => {
        if (isReadOnly) return;
        list.insertAdjacentHTML('beforeend', guardrailTagHtml(''));
        const inputs = list.querySelectorAll('.ad-guardrail-input');
        (inputs[inputs.length - 1] as HTMLInputElement)?.focus();
    });
}

function wireInterventions(): void {
    const list = document.getElementById('ad-interventions-list')!;
    const addBtn = document.getElementById('ad-add-intervention')!;

    list.addEventListener('click', e => {
        const removeBtn = (e.target as HTMLElement).closest('.ad-iv-remove');
        if (removeBtn && !isReadOnly) {
            removeBtn.closest('.ad-intervention-row')?.remove();
        }
    });

    // Delegate autocomplete on substance inputs
    list.addEventListener('input', e => {
        const input = e.target as HTMLInputElement;
        if (!input.classList.contains('ad-iv-substance')) return;
        showSubstanceAutocomplete(input);
    });

    addBtn.addEventListener('click', () => {
        if (isReadOnly) return;
        const rows = list.querySelectorAll('.ad-intervention-row');
        if (rows.length >= 5) return;
        list.insertAdjacentHTML('beforeend', interventionRowHtml());
        setupAutocompleteForRow(list.lastElementChild as HTMLElement);
    });
}

const DEFAULT_AVATAR_IMG = '/assets/agent-human-driven.png';

function wireAvatarPreview(): void {
    const input = document.getElementById('ad-avatar-url') as HTMLInputElement | null;
    const preview = document.getElementById('ad-avatar-preview');
    if (!input || !preview) return;

    const setDefaultImg = () => {
        preview.innerHTML = '';
        const img = document.createElement('img');
        img.src = DEFAULT_AVATAR_IMG;
        img.alt = 'Agent';
        preview.appendChild(img);
    };

    const update = () => {
        const url = input.value.trim();
        preview.innerHTML = '';
        const img = document.createElement('img');
        img.src = url || DEFAULT_AVATAR_IMG;
        img.alt = 'Agent';
        img.onerror = setDefaultImg;
        preview.appendChild(img);
    };

    input.addEventListener('blur', update);
    input.addEventListener('change', update);
}

function wireMandatePresets(): void {
    const group = document.getElementById('ad-mandate-presets');
    const textarea = document.getElementById('ad-mandate-textarea') as HTMLTextAreaElement | null;
    if (!group || !textarea) return;

    group.addEventListener('click', e => {
        const pill = (e.target as HTMLElement).closest('.ad-pill') as HTMLElement | null;
        if (!pill || isReadOnly) return;
        const idx = parseInt(pill.dataset.presetIdx ?? '', 10);
        if (MANDATE_PRESETS[idx]) {
            textarea.value = MANDATE_PRESETS[idx].text;
            textarea.dispatchEvent(new Event('input'));
        }
    });
}

function wireCloneButton(): void {
    content.querySelector('.ad-clone-btn')?.addEventListener('click', () => {
        isReadOnly = false;
        const banner = content.querySelector('.ad-readonly-banner') as HTMLElement | null;
        if (banner) banner.style.display = 'none';
        toggleFormDisabled(false);
        saveBtn.style.display = '';
        previewBtn.style.display = '';
    });
}

// ── Substance Autocomplete ───────────────────────────────────────────

function showSubstanceAutocomplete(input: HTMLInputElement): void {
    let dropdown = input.parentElement?.querySelector('.ad-autocomplete-dropdown') as HTMLElement | null;
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'ad-autocomplete-dropdown hidden';
        input.parentElement!.appendChild(dropdown);

        dropdown.addEventListener('click', e => {
            const item = (e.target as HTMLElement).closest('.ad-autocomplete-item') as HTMLElement | null;
            if (!item) return;
            const key = item.dataset.key!;
            input.value = SUBSTANCE_DB[key]?.name ?? key;
            input.dataset.substanceKey = key;
            dropdown!.classList.add('hidden');
        });

        document.addEventListener(
            'click',
            e => {
                if (!input.contains(e.target as Node) && !dropdown!.contains(e.target as Node)) {
                    dropdown!.classList.add('hidden');
                }
            },
            true,
        );
    }

    const query = input.value.toLowerCase().trim();
    if (query.length < 2) {
        dropdown.classList.add('hidden');
        return;
    }

    const matches = Object.entries(SUBSTANCE_DB)
        .filter(([key, sub]) => key.toLowerCase().includes(query) || (sub.name as string).toLowerCase().includes(query))
        .slice(0, 8);

    if (matches.length === 0) {
        dropdown.classList.add('hidden');
        return;
    }

    dropdown.innerHTML = matches
        .map(
            ([key, sub]) =>
                `<div class="ad-autocomplete-item" data-key="${key}">
                    <span class="ad-ac-name">${escapeHtml(sub.name)}</span>
                    <span class="ad-ac-class">${escapeHtml(sub.class)}</span>
                </div>`,
        )
        .join('');

    dropdown.classList.remove('hidden');
}

function setupAutocompleteForRow(_row: HTMLElement): void {
    // Autocomplete is handled via event delegation in wireInterventions
}

// ── Serialize form → AgentConfig ─────────────────────────────────────

function serializeAgentForm(): AgentConfig {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value?.trim() ?? '';

    // Domain tags
    const domainTags: string[] = [];
    document.querySelectorAll('#ad-domain-tags .ad-pill.active').forEach(el => {
        domainTags.push((el as HTMLElement).dataset.tag ?? '');
    });

    // Substance categories
    const categories: string[] = [];
    document.querySelectorAll('#ad-substance-cats .ad-pill.active').forEach(el => {
        categories.push((el as HTMLElement).dataset.category ?? '');
    });

    // Gated
    const gatedPills = document.querySelectorAll('#ad-substance-gated .ad-pill.active');
    let rx = false;
    let controlled = false;
    gatedPills.forEach(el => {
        const g = (el as HTMLElement).dataset.gated ?? '';
        if (g === 'Rx Pharmaceuticals') rx = true;
        if (g === 'Controlled Substances') controlled = true;
    });

    // Dosing
    const dosingSlider = document.getElementById('ad-dosing-slider') as HTMLInputElement;
    const dosingVal = dosingSlider ? parseInt(dosingSlider.value, 10) / 4 : 0.5;

    // Weights
    const weights: Record<string, number> = {};
    document.querySelectorAll('.ad-weight-slider').forEach(el => {
        const input = el as HTMLInputElement;
        weights[input.dataset.weight!] = parseInt(input.value, 10);
    });

    // Guardrails
    const guardrails: string[] = [];
    document.querySelectorAll('.ad-guardrail-input').forEach(el => {
        const v = (el as HTMLInputElement).value.trim();
        if (v) guardrails.push(v);
    });

    // Signature interventions
    const interventions: AgentSignatureIntervention[] = [];
    document.querySelectorAll('.ad-intervention-row').forEach(row => {
        const subInput = row.querySelector('.ad-iv-substance') as HTMLInputElement;
        const timingInput = row.querySelector('.ad-iv-timing') as HTMLInputElement;
        const rationaleInput = row.querySelector('.ad-iv-rationale') as HTMLInputElement;
        const subKey = subInput?.dataset.substanceKey ?? subInput?.value?.trim() ?? '';
        if (subKey) {
            interventions.push({
                substanceKey: subKey,
                timing: timingInput?.value?.trim() ?? '',
                rationale: rationaleInput?.value?.trim() ?? '',
            });
        }
    });

    return {
        id: crypto.randomUUID?.() ?? `agent-${Date.now()}`,
        meta: {
            name: val('ad-name'),
            creatorHandle: val('ad-creator'),
            avatarUrl: val('ad-avatar-url'),
            tagline: val('ad-tagline-input'),
            domainTags,
            targetPopulation: val('ad-population'),
            createdAt: new Date().toISOString(),
        },
        mandate: val('ad-mandate-textarea'),
        substancePalette: {
            categories,
            gated: { rx, controlled },
            dosingPhilosophy: dosingVal,
        },
        optimizationWeights: {
            acutePerformance: weights.acutePerformance ?? 50,
            recoverySleep: weights.recoverySleep ?? 50,
            longTermNeuroplasticity: weights.longTermNeuroplasticity ?? 50,
            minimalSideEffects: weights.minimalSideEffects ?? 50,
            costEfficiency: weights.costEfficiency ?? 50,
        },
        guardrails,
        signatureInterventions: interventions,
    };
}

// ── Save handler ─────────────────────────────────────────────────────

function handleSave(): void {
    const config = serializeAgentForm();
    const json = JSON.stringify(config, null, 2);

    // Syntax-highlight the JSON
    jsonOutput.innerHTML = syntaxHighlight(json);

    // Save to localStorage
    const saved = settingsStore.getJson<AgentConfig[]>('cortex_saved_agents', []);
    saved.push(config);
    settingsStore.setJson('cortex_saved_agents', saved);

    jsonPanel.classList.add('open');
}

function handleCopyJson(): void {
    const config = serializeAgentForm();
    const json = JSON.stringify(config, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        const orig = jsonCopyBtn.textContent;
        jsonCopyBtn.textContent = 'Copied!';
        setTimeout(() => {
            jsonCopyBtn.textContent = orig;
        }, 1500);
    });
}

function syntaxHighlight(json: string): string {
    return json.replace(
        /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
        match => {
            let cls = 'ad-json-number';
            if (match.startsWith('"')) {
                cls = match.endsWith(':') ? 'ad-json-key' : 'ad-json-string';
            } else if (/true|false/.test(match)) {
                cls = 'ad-json-bool';
            } else if (match === 'null') {
                cls = 'ad-json-null';
            }
            return `<span class="${cls}">${match}</span>`;
        },
    );
}

// ── Preview card handler ─────────────────────────────────────────────

function handlePreview(): void {
    const config = serializeAgentForm();
    previewCard.innerHTML = renderAgentCard(config);
    previewOverlay.classList.remove('hidden');
}

export function renderAgentCard(config: AgentConfig): string {
    const initial =
        config.meta.creatorName?.charAt(0)?.toUpperCase() || config.meta.name?.charAt(0)?.toUpperCase() || '?';
    const avatarInner = config.meta.avatarUrl
        ? `<img src="${escapeHtml(config.meta.avatarUrl)}" onerror="this.parentElement.innerHTML='${initial}'" />`
        : initial;

    const displayName = config.meta.creatorName || config.meta.name;
    const dosingPct = Math.round(config.substancePalette.dosingPhilosophy * 100);
    const dosingIdx = Math.min(4, Math.round(config.substancePalette.dosingPhilosophy * 4));
    const dosingLabel = DOSING_LABELS[dosingIdx] ?? 'Moderate';

    const tags = (config.meta.domainTags ?? []).map(t => `<span class="ad-pc-tag">${escapeHtml(t)}</span>`).join('');

    return `
        <div class="ad-pc-header">
            <div class="ad-pc-avatar">${avatarInner}</div>
            <div class="ad-pc-identity">
                <div class="ad-pc-creator-name">${escapeHtml(displayName)}</div>
                <div class="ad-pc-handle">${escapeHtml(config.meta.creatorHandle)}</div>
            </div>
        </div>
        <h3 class="ad-pc-name">${escapeHtml(config.meta.name || 'Untitled Agent')}</h3>
        <p class="ad-pc-tagline">${escapeHtml(config.meta.tagline || 'No tagline')}</p>
        <div class="ad-pc-tags">${tags || '<span class="ad-pc-tag">No tags</span>'}</div>
        <div class="ad-pc-meta">
            <div class="ad-pc-meta-row">
                <span class="ad-pc-meta-label">Dosing Philosophy</span>
                <span class="ad-pc-meta-label">${escapeHtml(dosingLabel)}</span>
            </div>
            <div class="ad-pc-dosing-bar">
                <div class="ad-pc-dosing-fill" style="width:${dosingPct}%"></div>
            </div>
            <div class="ad-pc-meta-row">
                <span class="ad-pc-meta-label">Domain Match</span>
                <div class="ad-pc-dosing-bar"><div class="ad-pc-dosing-fill" style="width:72%"></div></div>
            </div>
            <div class="ad-pc-meta-row">
                <span class="ad-pc-meta-label">Efficacy Score</span>
                <span class="ad-pc-stars">&#9733;&#9733;&#9733;&#9734;&#9734;</span>
            </div>
        </div>
        <button type="button" class="ad-pc-cta">Select This Agent &rarr;</button>
    `;
}

// ── Populate form from AgentConfig ───────────────────────────────────

function populateForm(config: AgentConfig): void {
    setVal('ad-name', config.meta.name);
    setVal('ad-creator', config.meta.creatorHandle);
    setVal('ad-avatar-url', config.meta.avatarUrl);
    setVal('ad-tagline-input', config.meta.tagline);
    setVal('ad-population', config.meta.targetPopulation);
    setVal('ad-mandate-textarea', config.mandate);

    // Trigger char counters
    triggerInput('ad-tagline-input');
    triggerInput('ad-mandate-textarea');

    // Trigger avatar preview
    const avatarInput = document.getElementById('ad-avatar-url') as HTMLInputElement;
    avatarInput?.dispatchEvent(new Event('blur'));

    // Domain tags
    document.querySelectorAll('#ad-domain-tags .ad-pill').forEach(el => {
        const tag = (el as HTMLElement).dataset.tag ?? '';
        el.classList.toggle('active', config.meta.domainTags.includes(tag));
    });

    // Substance categories
    document.querySelectorAll('#ad-substance-cats .ad-pill').forEach(el => {
        const cat = (el as HTMLElement).dataset.category ?? '';
        el.classList.toggle('active', config.substancePalette.categories.includes(cat));
    });

    // Gated
    document.querySelectorAll('#ad-substance-gated .ad-pill').forEach(el => {
        const g = (el as HTMLElement).dataset.gated ?? '';
        if (g === 'Rx Pharmaceuticals') el.classList.toggle('active', config.substancePalette.gated.rx);
        if (g === 'Controlled Substances') el.classList.toggle('active', config.substancePalette.gated.controlled);
    });

    // Dosing slider
    const dosingSlider = document.getElementById('ad-dosing-slider') as HTMLInputElement;
    if (dosingSlider) {
        dosingSlider.value = String(Math.round(config.substancePalette.dosingPhilosophy * 4));
        dosingSlider.dispatchEvent(new Event('input'));
    }

    // Weights
    const w = config.optimizationWeights;
    const weightMap: Record<string, number> = {
        acutePerformance: w.acutePerformance,
        recoverySleep: w.recoverySleep,
        longTermNeuroplasticity: w.longTermNeuroplasticity,
        minimalSideEffects: w.minimalSideEffects,
        costEfficiency: w.costEfficiency,
    };
    for (const [key, val] of Object.entries(weightMap)) {
        const slider = content.querySelector(`[data-weight="${key}"]`) as HTMLInputElement | null;
        if (slider) {
            slider.value = String(val);
            slider.dispatchEvent(new Event('input'));
        }
    }

    // Guardrails
    const guardrailList = document.getElementById('ad-guardrail-list')!;
    guardrailList.innerHTML = config.guardrails.map(g => guardrailTagHtml(g)).join('');

    // Signature interventions
    const ivList = document.getElementById('ad-interventions-list')!;
    ivList.innerHTML = config.signatureInterventions
        .map(iv => {
            const key = iv.substanceKey ?? iv.substance ?? '';
            const sub = SUBSTANCE_DB[key];
            const subName = sub?.name ?? key;
            return interventionRowHtml(subName, key, iv.timing, iv.rationale);
        })
        .join('');
}

// ── Utilities ────────────────────────────────────────────────────────

function setVal(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = value ?? '';
}

function triggerInput(id: string): void {
    document.getElementById(id)?.dispatchEvent(new Event('input'));
}

function toggleFormDisabled(disabled: boolean): void {
    content.querySelectorAll('input, textarea, select').forEach(el => {
        (el as HTMLInputElement).disabled = disabled;
    });
    content.querySelectorAll('.ad-pill').forEach(el => {
        (el as HTMLElement).style.pointerEvents = disabled ? 'none' : '';
        (el as HTMLElement).style.opacity = disabled ? '0.5' : '';
    });
    content.querySelectorAll('.ad-add-btn, .ad-guardrail-remove, .ad-iv-remove').forEach(el => {
        (el as HTMLElement).style.display = disabled ? 'none' : '';
    });
}
