const PHASE_CHART_GROUP_IDS = [
    'phase-grid',
    'phase-x-axis',
    'phase-y-axis-left',
    'phase-y-axis-right',
    'phase-scan-line',
    'phase-word-cloud',
    'phase-baseline-curves',
    'phase-baseline-editor',
    'phase-desired-curves',
    'phase-lx-bands',
    'phase-lx-curves',
    'phase-lx-markers',
    'phase-substance-timeline',
    'phase-mission-arrows',
    'phase-yaxis-indicators',
    'phase-legend',
    'phase-tooltip-overlay',
    'phase-biometric-strips',
    'phase-spotter-highlights',
    'phase-poi-connectors',
    'phase-sim-scan-line',
] as const;

export type PhaseChartGroupId = (typeof PHASE_CHART_GROUP_IDS)[number];

export interface PromptShellDom {
    section: HTMLElement;
    form: HTMLFormElement;
    input: HTMLInputElement;
    submit: HTMLButtonElement;
    hint: HTMLElement;
    hintExample: HTMLElement | null;
    hookSentence: HTMLElement;
}

export interface PhaseChartDom {
    container: HTMLElement;
    wrapper: HTMLElement;
    svg: SVGSVGElement;
    groups: Record<PhaseChartGroupId, SVGGElement>;
    optimizeButton: HTMLButtonElement;
    lxButton: HTMLButtonElement;
    biometricTriggerWrap: HTMLElement;
    biometricStripUi: HTMLElement;
}

export interface AppDom {
    prompt: PromptShellDom;
    phaseChart: PhaseChartDom;
    themeToggle: HTMLButtonElement;
    debugButton: HTMLButtonElement;
    debugClose: HTMLButtonElement;
    debugPanel: HTMLElement;
    settingsButton: HTMLButtonElement;
    settingsPopover: HTMLElement;
    demoRxButton: HTMLButtonElement | null;
    curveSculptorButton: HTMLButtonElement | null;
    substanceWallButton: HTMLButtonElement | null;
}

let cachedDom: AppDom | null = null;

export function getHtmlEl<T extends HTMLElement = HTMLElement>(
    id: string,
    root: Document | Element = document,
): T | null {
    const node = root.querySelector(`#${id}`) ?? (root instanceof Document ? root.getElementById(id) : null);
    return node instanceof HTMLElement ? (node as T) : null;
}

export function getSvgEl<T extends SVGElement = SVGElement>(id: string, root: Document | Element = document): T | null {
    const node = root.querySelector(`#${id}`) ?? (root instanceof Document ? root.getElementById(id) : null);
    return node instanceof SVGElement ? (node as T) : null;
}

export function mustGetHtmlEl<T extends HTMLElement = HTMLElement>(id: string, root: Document | Element = document): T {
    const el = getHtmlEl<T>(id, root);
    if (!el) throw new Error(`Missing HTML element: #${id}`);
    return el;
}

export function mustGetSvgEl<T extends SVGElement = SVGElement>(id: string, root: Document | Element = document): T {
    const el = getSvgEl<T>(id, root);
    if (!el) throw new Error(`Missing SVG element: #${id}`);
    return el;
}

function buildPhaseChartDom(): PhaseChartDom {
    const container = mustGetHtmlEl('phase-chart-container');
    const svg = mustGetSvgEl<SVGSVGElement>('phase-chart-svg');
    const groups = Object.fromEntries(
        PHASE_CHART_GROUP_IDS.map(id => [id, mustGetSvgEl<SVGGElement>(id, svg)]),
    ) as Record<PhaseChartGroupId, SVGGElement>;

    return {
        container,
        wrapper: mustGetHtmlEl('phase-chart-container').querySelector('.phase-svg-wrapper') as HTMLElement,
        svg,
        groups,
        optimizeButton: mustGetHtmlEl<HTMLButtonElement>('phase-optimize-btn'),
        lxButton: mustGetHtmlEl<HTMLButtonElement>('phase-lx-btn'),
        biometricTriggerWrap: mustGetHtmlEl('biometric-trigger-wrap'),
        biometricStripUi: mustGetHtmlEl('biometric-strip-ui'),
    };
}

export function resetDomRegistry(): void {
    cachedDom = null;
}

export function getAppDom(): AppDom {
    if (cachedDom && document.body.contains(cachedDom.prompt.section)) {
        return cachedDom;
    }

    cachedDom = {
        prompt: {
            section: mustGetHtmlEl('prompt-section'),
            form: mustGetHtmlEl<HTMLFormElement>('prompt-form'),
            input: mustGetHtmlEl<HTMLInputElement>('prompt-input'),
            submit: mustGetHtmlEl<HTMLButtonElement>('prompt-submit'),
            hint: mustGetHtmlEl('prompt-hint'),
            hintExample: getHtmlEl('hint-example'),
            hookSentence: mustGetHtmlEl('hook-sentence'),
        },
        phaseChart: buildPhaseChartDom(),
        themeToggle: mustGetHtmlEl<HTMLButtonElement>('theme-toggle-btn'),
        debugButton: mustGetHtmlEl<HTMLButtonElement>('debug-btn'),
        debugClose: mustGetHtmlEl<HTMLButtonElement>('debug-close'),
        debugPanel: mustGetHtmlEl('debug-panel'),
        settingsButton: mustGetHtmlEl<HTMLButtonElement>('settings-btn'),
        settingsPopover: mustGetHtmlEl('settings-popover'),
        demoRxButton: getHtmlEl<HTMLButtonElement>('demo-rx-btn'),
        curveSculptorButton: getHtmlEl<HTMLButtonElement>('curve-sculptor-btn'),
        substanceWallButton: getHtmlEl<HTMLButtonElement>('substance-wall-btn'),
    };

    return cachedDom;
}

export function getPhaseChartDom(): PhaseChartDom {
    return getAppDom().phaseChart;
}
