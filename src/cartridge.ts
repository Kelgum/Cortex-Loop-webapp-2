import {
    CENTER, FRONT_RADIUS, BACK_RADIUS, LABEL_RADIUS,
    TIMING_ARC_RADIUS, DAYS_IN_CARTRIDGE, MAX_PER_LAYER,
    CartridgeConfig, CATEGORY_COLORS, TIMING_SEGMENTS,
} from './constants';
import { AppState } from './state';
import { svgEl, sanitizeId, polarToXY, sleep } from './utils';
import { resolveSubstance } from './substances';

// ============================================
// 6. 5-DAY CARTRIDGE LAYOUT ENGINE
// ============================================

export function computeCartridgeLayout(stack) {
    const capsuleGroups = [];
    let globalSlot = 0;

    for (const item of stack) {
        const dailyCount = item.count || 1;
        for (let dailyIdx = 0; dailyIdx < dailyCount; dailyIdx++) {
            for (let dayIndex = 0; dayIndex < DAYS_IN_CARTRIDGE; dayIndex++) {
                capsuleGroups.push({
                    key: item.key,
                    dose: item.dose,
                    timing: item.timing,
                    dayIndex,
                    dailyIndex: dailyIdx,
                    globalSlot,
                    isToday: dayIndex === 0,
                });
                globalSlot++;
            }
        }
    }

    const maxTotal = MAX_PER_LAYER * 2;
    if (capsuleGroups.length > maxTotal) {
        capsuleGroups.length = maxTotal;
        console.warn(`Cartridge truncated to ${maxTotal} capsules`);
    }

    const capsulesPerLayer = Math.ceil(capsuleGroups.length / 2);

    return {
        totalCapsules: capsuleGroups.length,
        capsulesPerLayer: Math.max(capsulesPerLayer, 1),
        capsuleGroups,
    };
}

// ============================================
// 7. SVG CARTRIDGE BUILDER
// ============================================

export function buildCartridgeSVG() {
    const svg = document.getElementById('cartridge-svg');
    buildDefs(svg);
    buildTimingArcs();
    buildCapsuleLayer('back-layer', CartridgeConfig.backCapsule, BACK_RADIUS, CartridgeConfig.halfSpacing, 0.3);
    buildCapsuleLayer('front-layer', CartridgeConfig.frontCapsule, FRONT_RADIUS, 0, 1.0);
    buildCenterHub();
}

export function rebuildCapsuleLayers() {
    const frontLayer = document.getElementById('front-layer');
    const backLayer = document.getElementById('back-layer');
    frontLayer.innerHTML = '';
    backLayer.innerHTML = '';
    backLayer.setAttribute('opacity', '0.3');
    backLayer.setAttribute('filter', 'url(#depth-blur)');
    AppState.capsuleElements = { front: [], back: [] };
    AppState.filledSlots.clear();

    buildCapsuleLayer('back-layer', CartridgeConfig.backCapsule, BACK_RADIUS, CartridgeConfig.halfSpacing, 0.3);
    buildCapsuleLayer('front-layer', CartridgeConfig.frontCapsule, FRONT_RADIUS, 0, 1.0);
}

export function buildDefs(svg) {
    const defs = svg.querySelector('defs');

    for (const [cat, colors] of Object.entries(CATEGORY_COLORS)) {
        const grad = svgEl('linearGradient', {
            id: `grad-${sanitizeId(cat)}`, x1: '0%', y1: '0%', x2: '0%', y2: '100%',
        });
        grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': (colors as any).fill, 'stop-opacity': '1' }));
        grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': (colors as any).fill, 'stop-opacity': '0.55' }));
        defs.appendChild(grad);
    }

    const glow = svgEl('filter', { id: 'capsule-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    glow.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '4', result: 'blur' }));
    const merge = svgEl('feMerge');
    merge.appendChild(svgEl('feMergeNode', { in: 'blur' }));
    merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
    glow.appendChild(merge);
    defs.appendChild(glow);

    const depth = svgEl('filter', { id: 'depth-blur', x: '-10%', y: '-10%', width: '120%', height: '120%' });
    depth.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0.8' }));
    defs.appendChild(depth);
}

export function buildTimingArcs() {
    const arcGroup = document.getElementById('timing-arcs');
    const labelGroup = document.getElementById('timing-labels');

    TIMING_SEGMENTS.forEach(seg => {
        const r = TIMING_ARC_RADIUS;
        const p1 = polarToXY(seg.startAngle, r);
        const p2 = polarToXY(seg.endAngle, r);
        const largeArc = (seg.endAngle - seg.startAngle) > 180 ? 1 : 0;

        const path = svgEl('path', {
            d: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
            fill: 'none',
            stroke: seg.color,
            'stroke-width': '2',
            'stroke-opacity': '0.15',
            'stroke-linecap': 'round',
        });
        arcGroup.appendChild(path);

        const midAngle = (seg.startAngle + seg.endAngle) / 2;
        const lp = polarToXY(midAngle, TIMING_ARC_RADIUS + 20);
        const label = svgEl('text', {
            x: lp.x.toFixed(2),
            y: lp.y.toFixed(2),
            fill: seg.color,
            'font-family': "'JetBrains Mono', monospace",
            'font-size': '8',
            'font-weight': '500',
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            opacity: '0.4',
            'letter-spacing': '0.12em',
        });
        label.textContent = seg.label;
        labelGroup.appendChild(label);
    });
}

export function buildCapsuleLayer(groupId, dims, radius, angularOffset, baseOpacity) {
    const group = document.getElementById(groupId);
    const layerKey = groupId === 'front-layer' ? 'front' : 'back';

    if (layerKey === 'back') {
        group.setAttribute('opacity', String(baseOpacity));
        group.setAttribute('filter', 'url(#depth-blur)');
    }

    for (let i = 0; i < CartridgeConfig.capsulesPerLayer; i++) {
        const angleDeg = -90 + angularOffset + i * CartridgeConfig.angularSpacing;
        const pos = polarToXY(angleDeg, radius);
        const rotAngle = angleDeg + 90;

        const g = svgEl('g', {
            class: 'capsule-group',
            'data-layer': layerKey,
            'data-index': String(i),
            transform: `translate(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}) rotate(${rotAngle.toFixed(2)})`,
        });

        const outline = svgEl('rect', {
            class: 'capsule-outline',
            x: String(-dims.width / 2),
            y: String(-dims.height / 2),
            width: String(dims.width),
            height: String(dims.height),
            rx: String(dims.rx),
            fill: 'none',
            stroke: 'rgba(255,255,255,0.07)',
            'stroke-width': '1.5',
        });

        const fill = svgEl('rect', {
            class: 'capsule-fill',
            x: String(-dims.width / 2),
            y: String(-dims.height / 2),
            width: String(dims.width),
            height: String(dims.height),
            rx: String(dims.rx),
            fill: 'transparent',
            opacity: '0',
        });

        g.appendChild(outline);
        g.appendChild(fill);
        group.appendChild(g);

        AppState.capsuleElements[layerKey].push(g);
    }
}

export function buildCenterHub() {
    const hub = document.getElementById('center-hub');

    hub.appendChild(svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '65',
        fill: 'none', stroke: 'rgba(255,255,255,0.04)', 'stroke-width': '1',
    }));

    hub.appendChild(svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '55',
        fill: '#0d0d15', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': '1',
    }));

    const pulse = svgEl('circle', {
        cx: String(CENTER), cy: String(CENTER), r: '62',
        fill: 'none', stroke: 'rgba(160,160,255,0.3)', 'stroke-width': '2',
        id: 'hub-pulse', opacity: '0',
    });
    hub.appendChild(pulse);

    const text = svgEl('text', {
        x: String(CENTER), y: String(CENTER),
        fill: 'rgba(255,255,255,0.3)',
        'font-family': "'JetBrains Mono', monospace",
        'font-size': '12',
        'font-weight': '500',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        id: 'hub-text',
        'letter-spacing': '0.08em',
    });
    text.textContent = 'READY';
    hub.appendChild(text);
}

// ============================================
// 11. ANIMATION ENGINE
// ============================================

export async function animateFillSequence(stack) {
    AppState.isAnimating = true;
    const groups = CartridgeConfig.capsuleGroups;

    for (let i = 0; i < groups.length; i++) {
        const capsule = groups[i];
        const substance = resolveSubstance(capsule.key, capsule);
        if (!substance) continue;

        const category = substance.class || 'unknown';

        ensureCategoryGradient(category);

        let layerKey, capsuleIndex;
        if (capsule.globalSlot < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = capsule.globalSlot;
        } else {
            layerKey = 'back';
            capsuleIndex = capsule.globalSlot - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (!capsuleGroup) continue;

        const fillRect = capsuleGroup.querySelector('.capsule-fill');
        const outlineRect = capsuleGroup.querySelector('.capsule-outline');

        fillRect.setAttribute('fill', `url(#grad-${sanitizeId(category)})`);

        const targetOpacity = capsule.isToday ? 1 : 0.25;

        fillRect.animate([
            { opacity: 0, transform: 'scale(0.6) translateY(10px)' },
            { opacity: targetOpacity, transform: 'scale(1.08) translateY(-2px)' },
            { opacity: targetOpacity, transform: 'scale(1) translateY(0)' },
        ], {
            duration: capsule.isToday ? 420 : 250,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            fill: 'forwards',
        });

        if (capsule.isToday) {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-width', '2');
            if (layerKey === 'front') {
                capsuleGroup.setAttribute('filter', 'url(#capsule-glow)');
            }
        } else {
            outlineRect.setAttribute('stroke', substance.color);
            outlineRect.setAttribute('stroke-opacity', '0.2');
            outlineRect.setAttribute('stroke-width', '1');
            capsuleGroup.classList.add('dimmed');
        }

        capsuleGroup.classList.add('filled');
        capsuleGroup.dataset.substance = capsule.key;
        capsuleGroup.dataset.dose = capsule.dose;
        capsuleGroup.dataset.timing = capsule.timing;
        capsuleGroup.dataset.day = String(capsule.dayIndex + 1);

        AppState.filledSlots.set(capsule.globalSlot, capsule.key);
        updateCenterHub(i + 1, groups.length);

        await sleep(capsule.isToday ? 70 : 25);
    }

    await sleep(180);
    animateLabels(stack);

    await sleep(100);
    showStackSummary(stack);

    AppState.isAnimating = false;
}

export function ensureCategoryGradient(category) {
    const safeId = sanitizeId(category);
    if (document.getElementById(`grad-${safeId}`)) return;
    const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.unknown;
    const defs = document.querySelector('#cartridge-svg defs');
    const grad = svgEl('linearGradient', {
        id: `grad-${safeId}`, x1: '0%', y1: '0%', x2: '0%', y2: '100%',
    });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': colors.fill, 'stop-opacity': '1' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': colors.fill, 'stop-opacity': '0.55' }));
    defs.appendChild(grad);
}

export async function animateEjectSequence() {
    if (AppState.filledSlots.size === 0) return;
    AppState.isAnimating = true;

    clearLabels();
    hideStackSummary();
    await sleep(120);

    const slots = Array.from(AppState.filledSlots.keys()).reverse() as number[];

    for (const slotIndex of slots) {
        let layerKey, capsuleIndex;
        if (slotIndex < CartridgeConfig.capsulesPerLayer) {
            layerKey = 'front';
            capsuleIndex = slotIndex;
        } else {
            layerKey = 'back';
            capsuleIndex = slotIndex - CartridgeConfig.capsulesPerLayer;
        }

        const capsuleGroup = AppState.capsuleElements[layerKey][capsuleIndex];
        if (!capsuleGroup) continue;

        const fillRect = capsuleGroup.querySelector('.capsule-fill');
        const outlineRect = capsuleGroup.querySelector('.capsule-outline');

        fillRect.animate([
            { opacity: 1, transform: 'scale(1) translateY(0)' },
            { opacity: 0, transform: 'scale(0.5) translateY(-20px)' },
        ], {
            duration: 250,
            easing: 'ease-in',
            fill: 'forwards',
        });

        outlineRect.setAttribute('stroke', 'rgba(255,255,255,0.07)');
        outlineRect.setAttribute('stroke-width', '1.5');
        outlineRect.removeAttribute('stroke-opacity');
        capsuleGroup.removeAttribute('filter');
        capsuleGroup.classList.remove('filled', 'dimmed');
        delete capsuleGroup.dataset.substance;
        delete capsuleGroup.dataset.dose;
        delete capsuleGroup.dataset.timing;
        delete capsuleGroup.dataset.day;

        await sleep(20);
    }

    AppState.filledSlots.clear();
    updateCenterHub(0, 0);
    await sleep(80);
    AppState.isAnimating = false;
}

// ============================================
// 12. RADIAL LABEL & CONNECTOR SYSTEM
// ============================================

export function getLabelTargets(stack) {
    if (CartridgeConfig.capsuleGroups.length > 0) {
        return CartridgeConfig.capsuleGroups
            .filter(c => c.isToday && c.globalSlot < CartridgeConfig.capsulesPerLayer)
            .map(c => ({
                item: { key: c.key, dose: c.dose, timing: c.timing },
                slotIndex: c.globalSlot,
            }));
    }
    return stack
        .slice(0, CartridgeConfig.capsulesPerLayer)
        .map((item, i) => ({ item, slotIndex: i }));
}

export function animateLabels(stack) {
    const labelGroup = document.getElementById('label-ring');
    const connectorGroup = document.getElementById('connector-lines');
    labelGroup.innerHTML = '';
    connectorGroup.innerHTML = '';

    const targets = getLabelTargets(stack);
    const fontSize = CartridgeConfig.capsulesPerLayer > 18 ? 8 :
                     CartridgeConfig.capsulesPerLayer > 14 ? 9 : 10;

    for (let idx = 0; idx < targets.length; idx++) {
        const { item, slotIndex } = targets[idx];
        const substance = resolveSubstance(item.key, item);
        if (!substance) continue;

        const color = substance.color;
        const angleDeg = -90 + slotIndex * CartridgeConfig.angularSpacing;
        const lp = polarToXY(angleDeg, LABEL_RADIUS);

        const normalizedAngle = ((angleDeg % 360) + 360) % 360;
        const isLeftSide = normalizedAngle > 90 && normalizedAngle < 270;
        const textAngle = isLeftSide ? angleDeg + 180 : angleDeg;

        const isVertical = (normalizedAngle > 80 && normalizedAngle < 100) ||
                          (normalizedAngle > 260 && normalizedAngle < 280);
        const textAnchor = isVertical ? 'middle' : (isLeftSide ? 'end' : 'start');

        const label = svgEl('text', {
            x: lp.x.toFixed(2),
            y: lp.y.toFixed(2),
            fill: color,
            'font-family': "'Inter', sans-serif",
            'font-size': String(fontSize),
            'font-weight': '500',
            'text-anchor': textAnchor,
            'dominant-baseline': 'middle',
            opacity: '0',
            transform: `rotate(${textAngle.toFixed(2)}, ${lp.x.toFixed(2)}, ${lp.y.toFixed(2)})`,
        });
        label.textContent = `${substance.name} ${item.dose}`;
        labelGroup.appendChild(label);

        label.animate([
            { opacity: 0 },
            { opacity: 0.85 },
        ], {
            duration: 200,
            delay: idx * 40,
            fill: 'forwards',
        });

        const innerR = FRONT_RADIUS + 38;
        const outerR = LABEL_RADIUS - 12;
        const ip = polarToXY(angleDeg, innerR);
        const op = polarToXY(angleDeg, outerR);

        const line = svgEl('line', {
            x1: ip.x.toFixed(2), y1: ip.y.toFixed(2),
            x2: op.x.toFixed(2), y2: op.y.toFixed(2),
            stroke: color,
            'stroke-width': '0.75',
            'stroke-opacity': '0',
            'stroke-dasharray': '2,3',
        });
        connectorGroup.appendChild(line);

        line.animate([{ strokeOpacity: 0 }, { strokeOpacity: 0.15 }], {
            duration: 150, delay: idx * 40, fill: 'forwards',
        });
    }
}

export function clearLabels() {
    const labelGroup = document.getElementById('label-ring');
    const connectorGroup = document.getElementById('connector-lines');

    labelGroup.querySelectorAll('text').forEach(el => {
        el.animate([{ opacity: 0.85 }, { opacity: 0 }], {
            duration: 120, fill: 'forwards',
        });
    });
    connectorGroup.querySelectorAll('line').forEach(el => {
        el.animate([{ strokeOpacity: 0.15 }, { strokeOpacity: 0 }], {
            duration: 120, fill: 'forwards',
        });
    });

    setTimeout(() => {
        labelGroup.innerHTML = '';
        connectorGroup.innerHTML = '';
    }, 140);
}

// ============================================
// 13. CENTER HUB & LOADING STATE
// ============================================

export function updateCenterHub(filled, total) {
    const text = document.getElementById('hub-text');
    if (!text) return;

    if (total === 0) {
        text.textContent = 'READY';
        text.setAttribute('fill', 'rgba(255,255,255,0.3)');
        text.setAttribute('font-size', '12');
    } else {
        text.textContent = `${filled}/${total}`;
        text.setAttribute('fill', 'rgba(160,160,255,0.7)');
        text.setAttribute('font-size', '14');
    }
}

export function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = true;

    const pulse = document.getElementById('hub-pulse');
    if (pulse) {
        pulse.setAttribute('opacity', '1');
        const anim = (pulse as any).animate([
            { opacity: 0.2, r: 62 },
            { opacity: 0.6, r: 68 },
            { opacity: 0.2, r: 62 },
        ], { duration: 1200, iterations: Infinity });
        (pulse as any)._anim = anim;
    }
}

export function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
    (document.getElementById('prompt-submit') as HTMLButtonElement).disabled = false;

    const pulse = document.getElementById('hub-pulse');
    if (pulse) {
        if ((pulse as any)._anim) (pulse as any)._anim.cancel();
        pulse.setAttribute('opacity', '0');
    }
}

// ============================================
// 14. STACK SUMMARY FOOTER
// ============================================

export function showStackSummary(stack) {
    const footer = document.getElementById('stack-summary');
    const container = document.getElementById('summary-pills');
    container.innerHTML = '';

    stack.forEach((item, i) => {
        const substance = resolveSubstance(item.key, item);
        if (!substance) return;

        const color = substance.color;
        const count = item.count || 1;
        const pill = document.createElement('span');
        pill.className = 'summary-pill';
        pill.style.borderColor = color;
        pill.style.color = color;
        pill.style.animationDelay = `${i * 30}ms`;
        pill.textContent = count > 1
            ? `${substance.name} ${item.dose} x${count}`
            : `${substance.name} ${item.dose}`;
        container.appendChild(pill);
    });

    footer.classList.remove('hidden');
}

export function hideStackSummary() {
    document.getElementById('stack-summary').classList.add('hidden');
}
