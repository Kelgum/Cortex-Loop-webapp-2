import { SVG_NS, CENTER, PHASE_CHART } from './constants';

export function interpolatePrompt(template: any, vars: any) {
    return template.replace(/\{\{(\w+)\}\}/g, (_: any, key: any) =>
        vars[key] !== undefined ? vars[key] : `{{${key}}}`
    );
}

export function chartTheme() {
    const light = document.body.classList.contains('light-mode');
    return light ? {
        grid:           'rgba(100, 130, 170, 0.18)',
        axisBoundary:   'rgba(80, 110, 150, 0.30)',
        axisLine:       'rgba(80, 110, 150, 0.45)',
        tickAnchor:     'rgba(50, 80, 130, 0.60)',
        tickNormal:     'rgba(80, 110, 150, 0.35)',
        labelAnchor:    'rgba(20, 35, 65, 0.90)',
        labelNormal:    'rgba(30, 50, 80, 0.65)',
        yTick:          'rgba(80, 110, 150, 0.40)',
        yLabel:         'rgba(30, 50, 80, 0.82)',
        yLabelDefault:  'rgba(20, 40, 70, 0.92)',
        tooltipBg:      'rgba(240, 243, 247, 0.88)',
        scanGlow:       'rgba(80, 100, 180, 0.10)',
        orbitalRing1:   'rgba(50, 100, 200, 0.4)',
        orbitalRing2:   'rgba(120, 70, 200, 0.4)',
        arrowhead:      'rgba(30, 50, 80, 0.7)',
    } : {
        grid:           'rgba(145, 175, 214, 0.15)',
        axisBoundary:   'rgba(174, 201, 237, 0.22)',
        axisLine:       'rgba(174, 201, 237, 0.40)',
        tickAnchor:     'rgba(200, 220, 255, 0.65)',
        tickNormal:     'rgba(174, 201, 237, 0.30)',
        labelAnchor:    'rgba(225, 238, 255, 0.95)',
        labelNormal:    'rgba(180, 205, 235, 0.70)',
        yTick:          'rgba(174, 201, 237, 0.35)',
        yLabel:         'rgba(174, 201, 237, 0.78)',
        yLabelDefault:  'rgba(171, 214, 255, 0.92)',
        tooltipBg:      'rgba(13, 17, 23, 0.8)',
        scanGlow:       'rgba(160, 160, 255, 0.08)',
        orbitalRing1:   'rgba(130, 170, 255, 0.4)',
        orbitalRing2:   'rgba(200, 150, 255, 0.4)',
        arrowhead:      'rgba(255, 255, 255, 0.7)',
    };
}

/** Sanitize a class/category name for use as an SVG ID fragment (no slashes, spaces) */
export function sanitizeId(name: any) {
    return (name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function svgEl(tag: any, attrs: any = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v as string);
    }
    return el;
}

export function degToRad(deg: any) {
    return deg * Math.PI / 180;
}

export function polarToXY(angleDeg: any, radius: any) {
    const rad = degToRad(angleDeg);
    return {
        x: CENTER + radius * Math.cos(rad),
        y: CENTER + radius * Math.sin(rad),
    };
}

export function sleep(ms: any) {
    return new Promise(r => setTimeout(r, ms));
}

export function phaseChartX(minutes: any) {
    return PHASE_CHART.padL + ((minutes - PHASE_CHART.startMin) / PHASE_CHART.totalMin) * PHASE_CHART.plotW;
}

export function phaseChartY(effectVal: any) {
    const clamped = Math.max(0, Math.min(PHASE_CHART.maxEffect, effectVal));
    return PHASE_CHART.padT + PHASE_CHART.plotH - (clamped / PHASE_CHART.maxEffect) * PHASE_CHART.plotH;
}
