import { PHASE_CHART } from './constants';
import { getAppDom } from './dom';
import { cleanupDivider } from './divider';
import { cleanupBaselineEditor } from './baseline-editor';
import { stopTimelineScanLine, stopBioScanLine } from './chart-scan-lines';
import { PhaseState, CompileState } from './state';

export interface PhaseChartRuntime {
    stopOrbitalRings: () => void;
    setOrbitalRingsState: (value: unknown) => void;
    setWordCloudPositions: (value: unknown[]) => void;
    cleanupMorphDrag: () => void;
    hideBiometricTrigger: () => void;
    hideInterventionPlayButton: () => void;
    hideRevisionPlayButton: () => void;
    resetBiometricState: () => void;
    resetRevisionState: () => void;
    deactivateCurveSculptor: () => void;
    deactivateSubstanceWall: () => void;
}

const phaseChartRuntime: PhaseChartRuntime = {
    stopOrbitalRings: () => {},
    setOrbitalRingsState: () => {},
    setWordCloudPositions: () => {},
    cleanupMorphDrag: () => {},
    hideBiometricTrigger: () => {},
    hideInterventionPlayButton: () => {},
    hideRevisionPlayButton: () => {},
    resetBiometricState: () => {},
    resetRevisionState: () => {},
    deactivateCurveSculptor: () => {},
    deactivateSubstanceWall: () => {},
};

export function configurePhaseChartRuntime(runtime: Partial<PhaseChartRuntime>): void {
    Object.assign(phaseChartRuntime, runtime);
}

function clearPhaseChartGroup(group: SVGGElement): void {
    group.replaceChildren();
    group.classList.remove('revealed');
}

export function showPromptError(message: string): void {
    const { prompt } = getAppDom();
    prompt.hint.textContent = message;
    prompt.hint.classList.add('error');
    prompt.hint.style.opacity = '1';
}

export function clearPromptError(): void {
    const { prompt } = getAppDom();
    prompt.hint.textContent = 'e.g. "4 hours of deep focus, no sleep impact"';
    prompt.hint.classList.remove('error');
    prompt.hint.style.opacity = '';
}

export function resetPhaseChart(): void {
    const { prompt, phaseChart } = getAppDom();

    cleanupBaselineEditor();
    cleanupDivider();

    Object.values(phaseChart.groups).forEach(clearPhaseChartGroup);

    phaseChart.optimizeButton.classList.remove('visible');
    phaseChart.optimizeButton.classList.add('hidden');
    phaseChart.lxButton.classList.remove('visible');
    phaseChart.lxButton.classList.add('hidden');

    PhaseState.interventionPromise = null;
    PhaseState.interventionResult = null;
    PhaseState.lxCurves = null;
    PhaseState.wordCloudEffects = [];
    PhaseState.hookSentence = null;
    PhaseState.incrementalSnapshots = null;
    PhaseState.maxPhaseReached = -1;
    PhaseState.viewingPhase = -1;

    prompt.hookSentence.textContent = '';
    prompt.hookSentence.style.opacity = '0';

    phaseChartRuntime.setWordCloudPositions([]);
    phaseChartRuntime.stopOrbitalRings();
    phaseChartRuntime.setOrbitalRingsState(null);
    phaseChartRuntime.cleanupMorphDrag();

    document.querySelectorAll('.substance-step-label, .sequential-playhead').forEach(el => el.remove());

    [
        phaseChart.groups['phase-desired-curves'],
        phaseChart.groups['phase-mission-arrows'],
        phaseChart.groups['phase-yaxis-indicators'],
        phaseChart.groups['phase-lx-curves'],
        phaseChart.groups['phase-lx-markers'],
    ].forEach(group => {
        group.style.opacity = '';
        group.style.transition = '';
        group.style.filter = '';
    });

    phaseChart.groups['phase-desired-curves']
        .querySelectorAll('.phase-desired-path')
        .forEach(path => path.removeAttribute('stroke-dasharray'));

    phaseChart.svg
        .querySelectorAll(
            'defs [id^="tl-grad-"], defs [id^="tl-clip-"], defs [id^="bio-clip-"], defs [id^="lx-band-clip-"]',
        )
        .forEach(el => el.remove());
    phaseChart.svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${PHASE_CHART.viewH}`);

    stopTimelineScanLine();
    stopBioScanLine();
    phaseChartRuntime.hideBiometricTrigger();
    phaseChart.biometricStripUi.classList.remove('visible');
    phaseChart.biometricStripUi.classList.add('hidden');

    phaseChartRuntime.resetBiometricState();
    phaseChartRuntime.hideInterventionPlayButton();
    phaseChartRuntime.hideRevisionPlayButton();
    phaseChartRuntime.resetRevisionState();
    phaseChartRuntime.deactivateCurveSculptor();
    phaseChartRuntime.deactivateSubstanceWall();

    // Hide demo buttons
    document.getElementById('demo-rx-btn')?.classList.add('hidden');
    document.getElementById('curve-sculptor-btn')?.classList.add('hidden');
    document.getElementById('substance-wall-btn')?.classList.add('hidden');
    document.getElementById('demo-rx-btn')?.classList.remove('active');
    document.getElementById('curve-sculptor-btn')?.classList.remove('active');
    document.getElementById('substance-wall-btn')?.classList.remove('active');

    // Reset compile/stream overlay
    CompileState.cleanup?.();
    CompileState.cleanup = null;
    const compileOverlay = document.getElementById('compile-overlay');
    if (compileOverlay) {
        compileOverlay.classList.remove('visible');
        compileOverlay.classList.add('hidden');
        const compileSvg = compileOverlay.querySelector('#compile-svg');
        if (compileSvg) compileSvg.remove();
        compileOverlay.querySelectorAll('.compile-vcr-clone, .compile-pill-mirror').forEach(el => el.remove());
        compileOverlay
            .querySelectorAll('.compile-delivery, .compile-tagline')
            .forEach(el => el.classList.remove('visible'));
        const barFill = compileOverlay.querySelector('.compile-delivery-bar-fill') as HTMLElement | null;
        if (barFill) barFill.style.width = '0%';
        const strong = compileOverlay.querySelector('.compile-eta-text strong');
        if (strong) strong.textContent = '30 minutes';
        (compileOverlay.querySelector('.compile-delivery') as HTMLElement | null)?.style.removeProperty('top');
    }
    if (CompileState.countdownTimer !== null) {
        clearInterval(CompileState.countdownTimer);
        CompileState.countdownTimer = null;
    }
    CompileState.phase = 'idle';

    // Restore any faded-out page elements
    for (const id of [
        'prompt-section',
        'top-controls',
        'top-controls-right',
        'agent-match-panel',
        'multi-day-ribbon',
        'phase-chart-container',
        'timeline-ribbon',
        'pipeline-timeline',
    ]) {
        const el = document.getElementById(id);
        if (el) {
            el.style.opacity = '';
            el.style.transition = '';
        }
    }
}
