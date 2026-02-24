import re
with open("src/baseline-editor.ts", "r") as f:
    code = f.read()

# I am creating a python script because the replacements are large and multi_replace_file_content might struggle with giant unbroken blocks if there are 1-line discrepancies.
import json

new_interfaces = """
interface OdometerLevel {
    step: number;
    intensity_percent: number;
    slot_1: string;
    slot_2: string;
    slot_3: string;
    changed_slot: string;
    full_context: string;
}

const DRAG_FALLOFF_WEIGHTS = [1, 0.78, 0.48, 0.22, 0.05];

interface ScrubberDrag {
"""

code = code.replace("const DRAG_FALLOFF_WEIGHTS = [1, 0.78, 0.48, 0.22, 0.05];\n\ninterface ScrubberDrag {", new_interfaces)


new_levels_funcs = """
// ============================================
// Odometer Logic
// ============================================

function getLevelData(curve: any, val: number): OdometerLevel {
    const levelVal = nearestLevel(val);
    if (Array.isArray(curve.levels) && curve.levels.length > 0 && typeof curve.levels[0] === 'object') {
        let best = curve.levels[0];
        for(const l of curve.levels) {
            if (Math.abs(l.intensity_percent - val) < Math.abs(best.intensity_percent - val)) best = l;
        }
        return best as OdometerLevel;
    }
    
    // Fallback pseudo-matrix
    const rawString = curve.levels?.[String(levelVal)] || 'Baseline not set';
    const words = rawString.split(' ');
    return {
        step: DESCRIPTOR_LEVELS.indexOf(levelVal) + 1,
        intensity_percent: levelVal,
        slot_1: words[0] || 'Base',
        slot_2: words[1] || 'line',
        slot_3: words.slice(2).join(' ') || 'state',
        changed_slot: 'none',
        full_context: `Maintains ${rawString}.`,
    };
}

function getLevelDataFromStep(curve: any, step: number): OdometerLevel | null {
    if (Array.isArray(curve.levels)) return curve.levels.find((l: any) => l.step === step) || null;
    return null;
}

"""

code = code.replace("function placeInteractivePeakLabels(curvesData: any[]): void {", new_levels_funcs + "function placeInteractivePeakLabels(curvesData: any[]): void {")


# Replace renderPeakLabel and repositionLabelGroup
# using regex to grab the block from `function renderPeakLabel(` to `function setupLabelDrag`
pattern = re.compile(r"function renderPeakLabel\(.*?function setupLabelDrag\(", re.DOTALL)


new_render = """function renderPeakLabel(
    parent: Element, curve: any, curveIdx: number,
    descriptor: string, px: number, py: number, peakDotIdx: number, curvesData: any[],
): void {
    const sub = (DividerState.active && curvesData.length >= 2)
        ? getEffectSubGroup(parent, curveIdx) : parent;

    const labelGroup = svgEl('g', {
        class: 'baseline-peak-label',
        'data-curve-idx': String(curveIdx),
        cursor: 'grab'
    }) as SVGGElement;

    const cyOffset = 22;
    const pyLabel = py - cyOffset;

    const backdrop = svgEl('rect', {
        x: (px - 25).toFixed(1), y: (pyLabel - 25).toFixed(1),
        width: '50', height: '50', fill: 'transparent',
        class: 'baseline-label-backdrop',
    });
    labelGroup.appendChild(backdrop);

    const upChevron = svgEl('path', {
        d: `M${px - 4},${pyLabel - 24} L${px},${pyLabel - 29} L${px + 4},${pyLabel - 24}`,
        fill: 'none', stroke: curve.color, 'stroke-width': '2.5',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-opacity': '0.3', cursor: 'pointer', class: 'baseline-chevron-up'
    }) as SVGElement;
    labelGroup.appendChild(upChevron);

    // Replace static text with Odometer ForeignObject
    const foreign = svgEl('foreignObject', {
        x: (px - 150).toFixed(1),
        y: (pyLabel - 15).toFixed(1),
        width: '300', height: '140',
        class: 'odometer-foreign-container'
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'odometer-wrapper';

    const flexters = document.createElement('div');
    flexters.className = 'odometer-flexters';

    const createSlot = (id: string) => {
        const slot = document.createElement('div');
        slot.className = 'odometer-slot';
        const track = document.createElement('div');
        track.className = 'odometer-track';
        track.id = id;
        slot.appendChild(track);
        return { slot, track };
    };

    const s1 = createSlot(`odm-s1-${curveIdx}`);
    const s2 = createSlot(`odm-s2-${curveIdx}`);
    const s3 = createSlot(`odm-s3-${curveIdx}`);
    const dot1 = document.createElement('div'); dot1.className = 'odometer-dot'; dot1.textContent = '•';
    const dot2 = document.createElement('div'); dot2.className = 'odometer-dot'; dot2.textContent = '•';

    flexters.appendChild(s1.slot); flexters.appendChild(dot1);
    flexters.appendChild(s2.slot); flexters.appendChild(dot2);
    flexters.appendChild(s3.slot);
    wrapper.appendChild(flexters);

    const bubble = document.createElement('div');
    bubble.className = 'odometer-context-bubble visible';
    bubble.id = `odm-bubble-${curveIdx}`;
    wrapper.appendChild(bubble);

    foreign.appendChild(wrapper);
    labelGroup.appendChild(foreign);

    const downChevron = svgEl('path', {
        d: `M${px - 4},${pyLabel + 24} L${px},${pyLabel + 29} L${px + 4},${pyLabel + 24}`,
        fill: 'none', stroke: curve.color, 'stroke-width': '2.5',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-opacity': '0.3', cursor: 'pointer', class: 'baseline-chevron-down'
    }) as SVGElement;
    labelGroup.appendChild(downChevron);

    sub.appendChild(labelGroup);

    setupChevronClick(upChevron, curveIdx, 1, curvesData);
    setupChevronClick(downChevron, curveIdx, -1, curvesData);
    setupLabelDrag(labelGroup, backdrop, curveIdx, peakDotIdx, curvesData);

    labelGroup.style.transition = 'opacity 0.4s ease-out, transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
    labelGroup.setAttribute('opacity', '0');
    requestAnimationFrame(() => {
        labelGroup.setAttribute('opacity', '1');
        updateOdometerLogic(labelGroup, px, py, curve, curve.baseline[peakDotIdx].value);
    });
}

function setupChevronClick(chevron: SVGElement, curveIdx: number, direction: 1 | -1, curvesData: any[]): void {
    chevron.addEventListener('mouseenter', () => chevron.setAttribute('stroke-opacity', '1'));
    chevron.addEventListener('mouseleave', () => chevron.setAttribute('stroke-opacity', '0.3'));
    chevron.addEventListener('mousedown', (e) => e.stopPropagation());
    chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        shiftBaselineCurve(curveIdx, direction, curvesData);
    });
}

function shiftBaselineCurve(curveIdx: number, direction: 1 | -1, curvesData: any[]): void {
    const curve = curvesData[curveIdx];
    if (!curve) return;
    const step = DESCRIPTOR_LEVELS[1] - DESCRIPTOR_LEVELS[0];
    const shift = direction * step;
    curve.baseline = curve.baseline.map((pt: any) => ({
        ...pt,
        value: Math.max(0, Math.min(100, pt.value + shift)),
    }));
    rerenderBaselineCurve(curveIdx, curvesData);
    placeInteractivePeakLabels(curvesData);
    
    // Snaps actively grabbed scrubber to layout correctly
    if (state.activeScrubberCurveIdx === curveIdx && state.activeScrubberDotIdx !== null) {
        updateScrubberPosition(curveIdx, state.activeScrubberDotIdx, curvesData);
    }
}

function updateOdometerLogic(
    labelGroup: Element, px: number, pyTarget: number, curve: any, targetVal: number
): void {
    const foreign = labelGroup.querySelector('.odometer-foreign-container');
    if (!foreign) return;
    
    const pyLabel = pyTarget - 22;
    foreign.setAttribute('x', (px - 150).toFixed(1));
    foreign.setAttribute('y', (pyLabel - 15).toFixed(1));

    const s1 = foreign.querySelector(`[id^='odm-s1-']`) as HTMLElement;
    const s2 = foreign.querySelector(`[id^='odm-s2-']`) as HTMLElement;
    const s3 = foreign.querySelector(`[id^='odm-s3-']`) as HTMLElement;
    const bubble = foreign.querySelector('.odometer-context-bubble') as HTMLElement;

    let odState = (labelGroup as any).__odometerState;
    if (!odState) {
        odState = { activeStep: null, lastVal: targetVal, debounceTimer: null };
        (labelGroup as any).__odometerState = odState;
    }

    const velocityY = targetVal - odState.lastVal;
    const speed = Math.abs(velocityY);

    // --- Boundary Hysteresis (Anti-Jitter Lock) ---
    let stepObj = getLevelData(curve, targetVal);
    if (odState.activeStep !== null && odState.activeStep !== stepObj.step) {
        let prevObj = getLevelDataFromStep(curve, odState.activeStep);
        if (prevObj) {
            // Apply a sticky buffer zone of ~1.5 map values to prevent jitter
            const diffFromPrevBoundary = Math.abs(targetVal - prevObj.intensity_percent);
            const boundaryEdge = Math.abs(prevObj.intensity_percent - stepObj.intensity_percent) / 2;
            if (diffFromPrevBoundary < boundaryEdge + 1.5) {
                stepObj = prevObj; // Stay glued down!
            }
        }
    }

    const isRolling = stepObj.step !== odState.activeStep;
    if (isRolling) {
        // --- The Vertical Odometer Roll ---
        const changed = stepObj.changed_slot;
        const targetTrack = changed === 'slot_1' ? s1 : changed === 'slot_2' ? s2 : changed === 'slot_3' ? s3 : null;

        const writeSlot = (trk: HTMLElement, w: string, wt: number=400) => { 
            trk.innerHTML = ''; 
            const dw = document.createElement('div'); 
            dw.className='odometer-word'; dw.textContent=w; dw.style.color=curve.color; dw.style.fontWeight = String(wt);
            trk.appendChild(dw); 
        };

        if (targetTrack && odState.activeStep !== null) {
            const oldWord = targetTrack.children[0]?.textContent || '';
            const newWord = stepObj[changed as keyof OdometerLevel] as string;
            
            targetTrack.innerHTML = '';
            const isUp = velocityY > 0;
            
            const w1 = document.createElement('div'); w1.className='odometer-word'; w1.textContent = oldWord; w1.style.color = curve.color;
            const w2 = document.createElement('div'); w2.className='odometer-word'; w2.textContent = newWord; w2.style.color = curve.color;
            
            targetTrack.style.transition = 'none';
            if (isUp) {
                targetTrack.appendChild(w2);
                targetTrack.appendChild(w1);
                targetTrack.style.transform = `translateY(-18px)`;
            } else {
                targetTrack.appendChild(w1);
                targetTrack.appendChild(w2);
                targetTrack.style.transform = `translateY(0px)`;
            }

            void targetTrack.offsetHeight; // force reflow

            targetTrack.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
            targetTrack.style.transform = isUp ? `translateY(0px)` : `translateY(-18px)`;
            
            setTimeout(() => {
                targetTrack.style.transition = 'none';
                targetTrack.style.transform = 'translateY(0px)';
                writeSlot(targetTrack, newWord);
            }, 300);

            // Snapshot unchanged statically
            if(changed !== 'slot_1') writeSlot(s1, stepObj.slot_1);
            if(changed !== 'slot_2') writeSlot(s2, stepObj.slot_2);
            if(changed !== 'slot_3') writeSlot(s3, stepObj.slot_3);

        } else {
            writeSlot(s1, stepObj.slot_1);
            writeSlot(s2, stepObj.slot_2);
            writeSlot(s3, stepObj.slot_3);
        }

        odState.activeStep = stepObj.step;
        bubble.textContent = stepObj.full_context;
    }

    // --- Variable Font Interpolation (Look-Ahead Math) ---
    // If moving, we calculate tension towards the NEXT boundary
    // reset weights to 400 first
    const resetW = (trk: HTMLElement) => { if (trk?.children[0]) (trk.children[0] as HTMLElement).style.fontWeight = '400'; };
    resetW(s1); resetW(s2); resetW(s3);

    if (velocityY !== 0) {
         let nextVal = targetVal + (velocityY > 0 ? 11 : -11);
         let nextStepLvl = getLevelData(curve, nextVal);
         
         if (nextStepLvl.step !== stepObj.step) {
             const boundary = (stepObj.intensity_percent + nextStepLvl.intensity_percent) / 2;
             const dist = Math.abs(targetVal - boundary);
             const tension = Math.max(0, Math.min(1, 1 - (dist / 5.5))); 
             const fontWeight = Math.round(400 + (400 * tension));
             
             const futureChange = nextStepLvl.changed_slot;
             const styleTarget = futureChange === 'slot_1' ? s1 : futureChange === 'slot_2' ? s2 : futureChange === 'slot_3' ? s3 : null;
             
             if (styleTarget && styleTarget.children[0]) {
                 (styleTarget.children[0] as HTMLElement).style.fontWeight = String(fontWeight);
             }
         }
    }

    // --- Progressive Reveal (Velocity Debounce) ---
    if (speed > 0 || state.dragCurveIdx !== null) {
        bubble.classList.remove('visible');
        if (odState.debounceTimer) clearTimeout(odState.debounceTimer);
        
        odState.debounceTimer = setTimeout(() => {
            if (state.dragCurveIdx === null) {
                bubble.classList.add('visible');
            }
        }, 400);
    }

    odState.lastVal = targetVal;
    
    // Position Chevrons
    const upChevron = labelGroup.querySelector('.baseline-chevron-up');
    if (upChevron) upChevron.setAttribute('d', `M${px - 4},${pyLabel - 24} L${px},${pyLabel - 29} L${px + 4},${pyLabel - 24}`);
    const backdrop = labelGroup.querySelector('.baseline-label-backdrop');
    if (backdrop) { backdrop.setAttribute('x', (px - 25).toFixed(1)); backdrop.setAttribute('y', (pyLabel - 25).toFixed(1)); }
    const downChevron = labelGroup.querySelector('.baseline-chevron-down');
    if (downChevron) downChevron.setAttribute('d', `M${px - 4},${pyLabel + 24} L${px},${pyLabel + 29} L${px + 4},${pyLabel + 24}`);
}

function repositionLabelGroup(labelGroup: Element, px: number, py: number, curve: any, descriptorValue?: number): void {
    // Forward to new logic
    let targetVal = descriptorValue;
    if (typeof targetVal !== 'number') {
        const smoothed = smoothPhaseValues(curve.baseline, PHASE_SMOOTH_PASSES);
        const isHigherBetter = curve.polarity !== 'higher_is_worse';
        let peakVal = smoothed[0].value;
        for (const p of smoothed) {
            if (isHigherBetter ? p.value > peakVal : p.value < peakVal) peakVal = p.value;
        }
        targetVal = peakVal;
    }
    updateOdometerLogic(labelGroup, px, py, curve, targetVal);
}

function setupLabelDrag("""

code = pattern.sub(new_render + "function setupLabelDrag(", code)

# Ensure no syntax error in substitution
with open("src/baseline-editor.ts", "w") as f:
    f.write(code)

print("Done")
