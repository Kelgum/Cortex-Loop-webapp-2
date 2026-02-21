import { PHASE_CHART, TIMELINE_ZONE } from './constants';
import { PhaseState, RevisionState, BiometricState } from './state';
import { svgEl, sleep } from './utils';
import { phasePointsToPath, phasePointsToFillPath, smoothPhaseValues } from './curve-utils';
import { placePeakDescriptors, morphToDesiredCurves, renderPhaseLegend } from './phase-chart';
import {
    validateInterventions, transmuteDesiredCurves, animateSequentialLxReveal,
    cleanupMorphDrag, computeLxOverlay, computeIncrementalLxOverlay,
    renderSubstanceTimeline, revealTimelinePillsInstant,
    preserveBiometricStrips,
} from './lx-system';
import {
    hideBiometricTrigger, showBiometricTrigger,
    renderBiometricStrips, animateBiometricReveal,
    hideInterventionPlayButton, showInterventionPlayButton,
    hideRevisionPlayButton, showRevisionPlayButton, setRevisionPlayReady,
    diffInterventions, animateRevisionScan, morphLxCurvesToRevision,
} from './biometric';

// ============================================
// 15a2. PHASE STEP CONTROLS (< > chevrons)
// ============================================

export function showPhaseStepControls() {
    const el = document.getElementById('phase-step-controls');
    if (!el) return;
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('visible'));
}

export function hidePhaseStepControls() {
    const el = document.getElementById('phase-step-controls');
    if (!el) return;
    el.classList.remove('visible');
    el.classList.add('hidden');
}

let _stepAnimating = false;

export function updateStepButtons() {
    const backBtn = document.getElementById('phase-step-back') as HTMLButtonElement;
    const fwdBtn = document.getElementById('phase-step-forward') as HTMLButtonElement;
    if (!backBtn || !fwdBtn) return;
    backBtn.disabled = _stepAnimating || PhaseState.viewingPhase <= 0;
    fwdBtn.disabled = _stepAnimating || PhaseState.viewingPhase >= PhaseState.maxPhaseReached;
}

export function fadeGroup(group, targetOpacity, duration) {
    if (!group) return;
    group.style.transition = `opacity ${duration}ms ease`;
    group.style.opacity = String(targetOpacity);
}

export function staggerFadeChildren(group, targetOpacity, perChildMs, staggerMs) {
    if (!group) return;
    const children = Array.from(group.children);
    children.forEach((child: any, i) => {
        const delay = i * staggerMs;
        child.style.transition = `opacity ${perChildMs}ms ease ${delay}ms`;
        child.style.opacity = String(targetOpacity);
    });
}

export function quickLxClipReveal(durationMs) {
    const group = document.getElementById('phase-lx-curves');
    if (!group || group.children.length === 0) return;

    group.style.opacity = '1';
    for (const child of Array.from(group.children)) {
        (child as HTMLElement).style.opacity = '';
    }

    const svg = document.getElementById('phase-chart-svg');
    const defs = svg.querySelector('defs');
    const clipId = 'lx-step-clip-reveal';

    // Remove any leftover clip from previous step
    const old = defs.querySelector(`#${clipId}`);
    if (old) old.remove();
    group.removeAttribute('clip-path');

    const clipPath = svgEl('clipPath', { id: clipId });
    const clipRect = svgEl('rect', {
        x: String(PHASE_CHART.padL), y: '0',
        width: '0', height: String(PHASE_CHART.viewH),
    });
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    group.setAttribute('clip-path', `url(#${clipId})`);

    const startTime = performance.now();
    (function animate() {
        const t = Math.min(1, (performance.now() - startTime) / durationMs);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        clipRect.setAttribute('width', String(PHASE_CHART.plotW * ease));
        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            group.removeAttribute('clip-path');
            clipPath.remove();
        }
    })();
}

export async function stepToPhase(targetIdx) {
    const current = PhaseState.viewingPhase;
    if (targetIdx === current) return;
    if (targetIdx < 0 || targetIdx > PhaseState.maxPhaseReached) return;
    if (_stepAnimating) return;

    const desiredGroup = document.getElementById('phase-desired-curves');
    const arrowGroup = document.getElementById('phase-mission-arrows');
    const lxGroup = document.getElementById('phase-lx-curves');
    const lxMarkers = document.getElementById('phase-lx-markers');
    const timelineGroup = document.getElementById('phase-substance-timeline');
    const baseGroup = document.getElementById('phase-baseline-curves');

    if (targetIdx < current) {
        // ---- Stepping BACKWARD — fast rewind via fades/morphs ----
        _stepAnimating = true;
        const dur = 250;

        if (targetIdx < 4 && current >= 4) {
            // Phase 4→3: undo revision — restore old Lx curves + timeline
            hideRevisionPlayButton();
            if (RevisionState.oldInterventions && PhaseState.curvesData) {
                const oldLx = computeLxOverlay(RevisionState.oldInterventions, PhaseState.curvesData);
                PhaseState.lxCurves = oldLx;
                PhaseState.interventionResult = { interventions: RevisionState.oldInterventions.map(iv => ({
                    key: iv.key, dose: iv.dose, doseMultiplier: iv.doseMultiplier,
                    timeMinutes: iv.timeMinutes, impacts: iv.impacts, rationale: iv.rationale,
                })) };
                PhaseState.incrementalSnapshots = computeIncrementalLxOverlay(RevisionState.oldInterventions, PhaseState.curvesData);
                // Re-render timeline with original interventions
                renderSubstanceTimeline(RevisionState.oldInterventions, oldLx, PhaseState.curvesData);
                revealTimelinePillsInstant();
                preserveBiometricStrips();
                // Restore Lx curves
                const lxStrokes = lxGroup.querySelectorAll('.phase-lx-path');
                const lxFills = lxGroup.querySelectorAll('.phase-lx-fill');
                for (let ci = 0; ci < PhaseState.curvesData.length; ci++) {
                    if (oldLx[ci] && oldLx[ci].points) {
                        if (lxStrokes[ci]) lxStrokes[ci].setAttribute('d', phasePointsToPath(oldLx[ci].points, true));
                        if (lxFills[ci]) lxFills[ci].setAttribute('d', phasePointsToFillPath(oldLx[ci].points, true));
                    }
                }
            }
        }

        if (targetIdx < 3 && current >= 3) {
            // Remove biometric strips
            const bioGroup = document.getElementById('phase-biometric-strips');
            if (bioGroup) {
                fadeGroup(bioGroup, 0, dur);
                await sleep(dur);
                bioGroup.innerHTML = '';
                bioGroup.style.opacity = '';
            }
            // Hide trigger + strip UI
            hideBiometricTrigger();
            const svg = document.getElementById('phase-chart-svg');
            if (svg) {
                svg.querySelectorAll('defs [id^="bio-clip-"]').forEach(el => el.remove());
                // Recalculate viewBox based on timeline
                const tlGroup = document.getElementById('phase-substance-timeline');
                if (tlGroup && tlGroup.children.length > 0) {
                    const tlBox = (tlGroup as unknown as SVGGraphicsElement).getBBox();
                    const neededH = Math.ceil(tlBox.y + tlBox.height + TIMELINE_ZONE.bottomPad);
                    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${Math.max(PHASE_CHART.viewH, neededH)}`);
                } else {
                    svg.setAttribute('viewBox', `0 0 ${PHASE_CHART.viewW} ${PHASE_CHART.viewH}`);
                }
            }
            // Hide the strip UI
            const bioStripUI = document.getElementById('biometric-strip-ui');
            if (bioStripUI) {
                bioStripUI.classList.remove('visible');
                bioStripUI.classList.add('hidden');
            }
        }

        if (targetIdx < 2 && current >= 2) {
            // Remove Lx layer: clear ghost AUC fills, timeline, markers, playhead
            hideInterventionPlayButton();
            lxGroup.innerHTML = '';
            const bandsGroup = document.getElementById('phase-lx-bands');
            if (bandsGroup) bandsGroup.innerHTML = '';
            fadeGroup(lxMarkers, 0, dur);
            timelineGroup.innerHTML = '';
            document.querySelectorAll('.substance-step-label, .sequential-playhead').forEach(el => el.remove());
            // Restore desired curves from ghost back to solid
            transmuteDesiredCurves(false);
            // Restore arrows
            arrowGroup.style.opacity = '1';
            arrowGroup.style.filter = '';
            Array.from(arrowGroup.children).forEach((ch: any) => {
                ch.style.opacity = '';
                ch.getAnimations().forEach(a => a.cancel());
            });
            // Restore Y-axis indicators
            const yaxisInd = document.getElementById('phase-yaxis-indicators');
            if (yaxisInd) { yaxisInd.style.opacity = '1'; yaxisInd.style.filter = ''; }
            // Restore baseline curves to their original shape (scans morphed them)
            const cd = PhaseState.curvesData;
            if (cd) {
                const bStrokes = baseGroup.querySelectorAll('.phase-baseline-path');
                const bFills = baseGroup.querySelectorAll('path:not(.phase-baseline-path):not(.peak-descriptor)');
                for (let ci = 0; ci < cd.length; ci++) {
                    const origD = phasePointsToPath(cd[ci].baseline);
                    const origFillD = phasePointsToFillPath(cd[ci].baseline);
                    if (bStrokes[ci]) {
                        bStrokes[ci].setAttribute('d', origD);
                        bStrokes[ci].setAttribute('stroke-dasharray', '6 4');
                        bStrokes[ci].setAttribute('stroke-opacity', '0.54');
                        bStrokes[ci].setAttribute('stroke-width', '1.7');
                    }
                    if (bFills[ci] && origFillD) bFills[ci].setAttribute('d', origFillD);
                }
                // Restore baseline peak descriptors
                baseGroup.querySelectorAll('.peak-descriptor').forEach(el => el.remove());
                placePeakDescriptors(baseGroup, cd, 'baseline', 0);
            }
        }
        if (targetIdx < 1 && current >= 1) {
            fadeGroup(desiredGroup, 0, dur);
            fadeGroup(arrowGroup, 0, dur);
            const indicatorGroup = document.getElementById('phase-yaxis-indicators');
            if (indicatorGroup) fadeGroup(indicatorGroup, 0, dur);
        }

        if (targetIdx === 0) {
            baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                el.style.transition = `opacity ${dur}ms ease`;
                el.style.opacity = '0.8';
            });
        }

        await sleep(dur + 50);
        _stepAnimating = false;
        PhaseState.viewingPhase = targetIdx;
        updateStepButtons();

    } else {
        // ---- Stepping FORWARD — replay the actual animations from cached data ----
        _stepAnimating = true;
        updateStepButtons();

        const curvesData = PhaseState.curvesData;
        if (!curvesData) { _stepAnimating = false; return; }

        if (targetIdx >= 1 && current < 1) {
            // Phase 0→1: Replay the real morphToDesiredCurves animation
            baseGroup.querySelectorAll('.peak-descriptor').forEach((el: any) => {
                el.style.transition = 'opacity 300ms ease';
                el.style.opacity = '0';
            });

            await morphToDesiredCurves(curvesData);
            renderPhaseLegend(curvesData, 'full');

            PhaseState.viewingPhase = 1;
            updateStepButtons();
        }

        if (targetIdx >= 2 && PhaseState.viewingPhase < 2) {
            // Phase 1→2: Show play button then replay sequential substance animation
            const snapshots = PhaseState.incrementalSnapshots;
            const interventionData = PhaseState.interventionResult;
            if (snapshots && interventionData) {
                const interventions = validateInterventions(interventionData.interventions || [], curvesData);

                // Show amber play button and wait for click
                showInterventionPlayButton();
                _stepAnimating = false; // Allow UI interaction while waiting
                await new Promise<void>(resolve => {
                    const btn = document.getElementById('intervention-play-btn');
                    if (!btn) { resolve(); return; }
                    btn.addEventListener('click', () => {
                        hideInterventionPlayButton();
                        resolve();
                    }, { once: true });
                });
                _stepAnimating = true;

                await animateSequentialLxReveal(snapshots, interventions, curvesData);
            }

            PhaseState.viewingPhase = 2;
            updateStepButtons();
        }

        if (targetIdx >= 3 && PhaseState.viewingPhase < 3) {
            // Phase 2→3: Re-render biometric strips from cache or show trigger
            if (BiometricState.biometricResult) {
                renderBiometricStrips(BiometricState.channels);
                await animateBiometricReveal(600);
                PhaseState.viewingPhase = 3;
            } else {
                showBiometricTrigger();
                PhaseState.viewingPhase = 2; // stay at 2 until user completes flow
            }
            updateStepButtons();
        }

        if (targetIdx >= 4 && PhaseState.viewingPhase < 4) {
            // Phase 3→4: Replay revision from cache or show play button
            if (RevisionState.phase === 'rendered' && RevisionState.newLxCurves) {
                const oldLx = computeLxOverlay(RevisionState.oldInterventions, curvesData);
                const diff = RevisionState.diff || diffInterventions(RevisionState.oldInterventions, RevisionState.newInterventions);
                await animateRevisionScan(diff, RevisionState.newInterventions, RevisionState.newLxCurves, curvesData);
                await morphLxCurvesToRevision(oldLx, RevisionState.newLxCurves, curvesData);
                PhaseState.lxCurves = RevisionState.newLxCurves;
                PhaseState.viewingPhase = 4;
            } else if (RevisionState.revisionResult) {
                showRevisionPlayButton();
                setRevisionPlayReady();
            } else {
                showRevisionPlayButton();
            }
            updateStepButtons();
        }

        _stepAnimating = false;
        updateStepButtons();
    }
}

export function initPhaseStepControls() {
    const backBtn = document.getElementById('phase-step-back');
    const fwdBtn = document.getElementById('phase-step-forward');
    if (!backBtn || !fwdBtn) return;

    backBtn.addEventListener('click', () => {
        if (PhaseState.viewingPhase > 0) {
            stepToPhase(PhaseState.viewingPhase - 1);
        }
    });

    fwdBtn.addEventListener('click', () => {
        if (PhaseState.viewingPhase < PhaseState.maxPhaseReached) {
            stepToPhase(PhaseState.viewingPhase + 1);
        }
    });
}
