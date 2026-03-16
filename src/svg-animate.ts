// ---- SVG Animation Helpers ----
// rAF-based interpolation for SVG attributes (more reliable than WAAPI on SVG)

import { isTurboActive } from './state';

function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function animateSvgTransform(
    el: any,
    fromTx: any,
    fromTy: any,
    toTx: any,
    toTy: any,
    duration: any,
    easing: any,
) {
    if (isTurboActive()) {
        el.setAttribute('transform', `translate(${Number(toTx).toFixed(1)},${Number(toTy).toFixed(1)})`);
        return Promise.resolve();
    }
    const start = performance.now();
    const ease =
        easing === 'ease-in'
            ? (t: number) => t * t
            : easing === 'ease-out'
              ? (t: number) => 1 - (1 - t) * (1 - t)
              : easeInOut;
    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const rawT = Math.min(1, (now - start) / duration);
            const t = ease(rawT);
            const tx = fromTx + (toTx - fromTx) * t;
            const ty = fromTy + (toTy - fromTy) * t;
            el.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
            if (rawT < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

export function animateSvgOpacity(el: any, from: any, to: any, duration: any) {
    if (isTurboActive()) {
        el.setAttribute('opacity', String(to));
        return Promise.resolve();
    }
    const start = performance.now();
    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const t = Math.min(1, (now - start) / duration);
            const ease = easeInOut(t);
            el.setAttribute('opacity', String(from + (to - from) * ease));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

/** Animate any numeric SVG attribute from one value to another. */
export function animateSvgAttr(el: any, attr: string, from: number, to: number, duration: number) {
    if (isTurboActive()) {
        el.setAttribute(attr, String(to));
        return Promise.resolve();
    }
    const start = performance.now();
    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const t = Math.min(1, (now - start) / duration);
            const ease = easeInOut(t);
            el.setAttribute(attr, String(from + (to - from) * ease));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}

export function animateSvgWidth(el: any, fromW: any, toW: any, duration: any) {
    if (isTurboActive()) {
        el.setAttribute('width', String(toW));
        return Promise.resolve();
    }
    const start = performance.now();
    return new Promise<void>(resolve => {
        (function tick(now: number) {
            const t = Math.min(1, (now - start) / duration);
            const ease = easeInOut(t);
            el.setAttribute('width', String(fromW + (toW - fromW) * ease));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
        })(performance.now());
    });
}
