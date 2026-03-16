/**
 * Utils — SVG element helpers, theme detection, time formatting, and coordinate math.
 * Exports: svgEl, isLightMode, chartTheme, phaseChartX, phaseChartY, sleep, interpolatePrompt, formatMsAsTimestamp, escapeHtml, clamp
 * Depends on: constants (SVG_NS, PHASE_CHART)
 */
import { SVG_NS, CENTER, PHASE_CHART } from './constants';
import { isTurboActive } from './state';

export function interpolatePrompt(template: any, vars: any) {
    return template.replace(/\{\{(\w+)\}\}/g, (_: any, key: any) =>
        vars[key] !== undefined ? vars[key] : `{{${key}}}`,
    );
}

export function isLightMode(): boolean {
    return document.body.classList.contains('light-mode');
}

export function chartTheme() {
    const light = isLightMode();
    return light
        ? {
              grid: 'rgba(100, 130, 170, 0.18)',
              axisBoundary: 'rgba(80, 110, 150, 0.30)',
              axisLine: 'rgba(80, 110, 150, 0.45)',
              tickAnchor: 'rgba(50, 80, 130, 0.60)',
              tickNormal: 'rgba(80, 110, 150, 0.35)',
              labelAnchor: 'rgba(20, 35, 65, 0.90)',
              labelNormal: 'rgba(30, 50, 80, 0.65)',
              yTick: 'rgba(80, 110, 150, 0.40)',
              yLabel: 'rgba(30, 50, 80, 0.82)',
              yLabelDefault: 'rgba(20, 40, 70, 0.92)',
              tooltipBg: 'rgba(240, 243, 247, 0.88)',
              scanGlow: 'rgba(80, 100, 180, 0.10)',
              orbitalRing1: 'rgba(50, 100, 200, 0.4)',
              orbitalRing2: 'rgba(120, 70, 200, 0.4)',
              arrowhead: 'rgba(30, 50, 80, 0.7)',
          }
        : {
              grid: 'rgba(145, 175, 214, 0.15)',
              axisBoundary: 'rgba(174, 201, 237, 0.22)',
              axisLine: 'rgba(174, 201, 237, 0.40)',
              tickAnchor: 'rgba(200, 220, 255, 0.65)',
              tickNormal: 'rgba(174, 201, 237, 0.30)',
              labelAnchor: 'rgba(225, 238, 255, 0.95)',
              labelNormal: 'rgba(180, 205, 235, 0.70)',
              yTick: 'rgba(174, 201, 237, 0.35)',
              yLabel: 'rgba(174, 201, 237, 0.78)',
              yLabelDefault: 'rgba(171, 214, 255, 0.92)',
              tooltipBg: 'rgba(13, 17, 23, 0.8)',
              scanGlow: 'rgba(160, 160, 255, 0.08)',
              orbitalRing1: 'rgba(130, 170, 255, 0.4)',
              orbitalRing2: 'rgba(200, 150, 255, 0.4)',
              arrowhead: 'rgba(255, 255, 255, 0.7)',
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
    return (deg * Math.PI) / 180;
}

export function polarToXY(angleDeg: any, radius: any) {
    const rad = degToRad(angleDeg);
    return {
        x: CENTER + radius * Math.cos(rad),
        y: CENTER + radius * Math.sin(rad),
    };
}

export function sleep(ms: any) {
    if (isTurboActive()) return Promise.resolve();
    return new Promise(r => setTimeout(r, ms));
}

/** Format minutes-since-midnight to clock time: 480 → "8am", 870 → "2:30pm" */
export function formatMinutesAsClockTime(min: number): string {
    const h = Math.floor(min / 60) % 24;
    const m = Math.round(min % 60);
    const suffix = h < 12 ? 'am' : 'pm';
    const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const minStr = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
    return `${hour}${minStr}${suffix}`;
}

/** Format milliseconds as mm:ss.t timeline position: 83400 → "01:23.4" */
export function formatMsAsTimestamp(ms: number): string {
    const safe = Math.max(0, isFinite(ms) ? ms : 0);
    const minutes = Math.floor(safe / 60000);
    const seconds = Math.floor((safe % 60000) / 1000);
    const tenths = Math.floor((safe % 1000) / 100);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** Format milliseconds as human-readable duration: 1500 → "1.5s", 200 → "200ms" */
export function formatDuration(ms: number | null): string {
    if (ms == null || !Number.isFinite(ms)) return 'n/a';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/** Clamp a value between min and max */
export function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

/** Escape HTML entities for safe insertion into innerHTML */
export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function phaseChartX(minutes: any) {
    return PHASE_CHART.padL + ((minutes - PHASE_CHART.startMin) / PHASE_CHART.totalMin) * PHASE_CHART.plotW;
}

export function phaseChartY(effectVal: any) {
    const clamped = clamp(effectVal, 0, PHASE_CHART.maxEffect);
    return PHASE_CHART.padT + PHASE_CHART.plotH - (clamped / PHASE_CHART.maxEffect) * PHASE_CHART.plotH;
}
