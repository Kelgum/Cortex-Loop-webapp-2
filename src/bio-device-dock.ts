// ============================================
// Bio Device Dock — Left-side VCR dock animation for biometric devices
// ============================================
// Mirrors the agent dock in creator-agent-matcher.ts but docks to the LEFT
// side of the VCR pill. Supports multiple stacked icon-only capsules.
// Exports: animateBioDeviceDock, undockBioDevice, undockAllBioDevices, getDockedDeviceKeys, isDocked

import type { BiometricDevice } from './biometric-devices';
import { isLightMode, withImageRetry } from './utils';

// ── Timing constants (match agent dock) ─────────────────────────────
const DOCK_STAGE_DURATION = 520;
const DOCK_MORPH_DURATION = 180;
const DOCK_SLIDE_DURATION = 340;
const DOCK_COCK_DURATION = 140;
const DOCK_COCK_DISTANCE = 14;
const DOCK_SHELL_UNDERLAP = 78;
const DOCK_CONTENT_START_GAP = 8;

// ── Capsule sizing ──────────────────────────────────────────────────
const CAPSULE_SIZE = 40;
const STACK_GAP = 6;

// ── DOM refs ────────────────────────────────────────────────────────
const _dockedDevices = new Map<string, { element: HTMLElement; device: BiometricDevice }>();
let _shellElement: HTMLElement | null = null;
let _onDockChange: (() => void) | null = null;

// Per-animation context — each dock animation is self-contained
interface DockAnimContext {
    floatingCard: HTMLElement | null;
    floatingCapsule: HTMLElement | null;
    timers: number[];
}

function ctxQueueTimer(ctx: DockAnimContext, fn: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
        ctx.timers = ctx.timers.filter(id => id !== timer);
        fn();
    }, delay);
    ctx.timers.push(timer);
}

function ctxCleanup(ctx: DockAnimContext): void {
    ctx.timers.forEach(id => window.clearTimeout(id));
    ctx.timers = [];
    ctx.floatingCard?.remove();
    ctx.floatingCapsule?.remove();
    ctx.floatingCard = null;
    ctx.floatingCapsule = null;
}

// ── Geometry ────────────────────────────────────────────────────────

interface BioDockGeometry {
    stageLeft: number;
    stageTop: number;
    capsuleLeft: number;
    capsuleTop: number;
}

function computePillLeftRelative(panel: HTMLElement): number {
    const styles = window.getComputedStyle(panel);
    const pillWidth = parseFloat(styles.getPropertyValue('--pill-w')) || 84;
    const pillOffset = parseFloat(styles.getPropertyValue('--pill-offset')) || 0;
    const panelWidth = panel.clientWidth || panel.getBoundingClientRect().width || 0;
    return panelWidth / 2 + pillOffset - pillWidth / 2;
}

function computeStackOffset(): number {
    return _dockedDevices.size * (CAPSULE_SIZE + STACK_GAP);
}

function computeBioDockGeometry(panel: HTMLElement, cardRect: DOMRect): BioDockGeometry {
    const panelRect = panel.getBoundingClientRect();
    const pillLeftRel = computePillLeftRelative(panel);
    const pillLeftAbs = panelRect.left + pillLeftRel;

    // Capsule docks left of the pill, offset by stack count
    const stackOffset = computeStackOffset();
    const capsuleLeft = pillLeftAbs - DOCK_CONTENT_START_GAP - CAPSULE_SIZE - stackOffset;
    const capsuleTop = panelRect.top + (panelRect.height - CAPSULE_SIZE) / 2;

    const stageLeft = cardRect.left;
    const stageTop = panelRect.top + (panelRect.height - cardRect.height) / 2;

    return { stageLeft, stageTop, capsuleLeft, capsuleTop };
}

function computeShellWidth(): number {
    const count = _dockedDevices.size;
    if (count === 0) return 0;
    return DOCK_SHELL_UNDERLAP + DOCK_CONTENT_START_GAP + count * CAPSULE_SIZE + (count - 1) * STACK_GAP + 8;
}

function getDeviceIconSrc(device: BiometricDevice): string {
    return isLightMode() ? device.iconLight : device.iconDark;
}

// ── Shell management ────────────────────────────────────────────────

function ensureShell(vcrPanel: HTMLElement): HTMLElement {
    if (_shellElement && _shellElement.parentElement === vcrPanel) return _shellElement;
    _shellElement?.remove();
    const shell = document.createElement('div');
    shell.className = 'vcr-shell-bio-dock';
    vcrPanel.appendChild(shell);
    _shellElement = shell;
    return shell;
}

function updateShellGeometry(vcrPanel: HTMLElement): void {
    const shell = ensureShell(vcrPanel);
    const pillLeftRel = computePillLeftRelative(vcrPanel);
    const shellWidth = computeShellWidth();

    // Shell right edge = pillLeft + underlap; shellLeft = rightEdge - width
    const shellLeft = pillLeftRel + DOCK_SHELL_UNDERLAP - shellWidth;

    vcrPanel.style.setProperty('--vcr-pill-left', `${pillLeftRel.toFixed(1)}px`);
    vcrPanel.style.setProperty('--vcr-bio-dock-shell-width', `${shellWidth.toFixed(1)}px`);
    vcrPanel.style.setProperty('--vcr-bio-dock-shell-left', `${shellLeft.toFixed(1)}px`);

    if (_dockedDevices.size > 0) {
        vcrPanel.classList.add('vcr-bio-dock-visible');
        shell.classList.add('visible');
    } else {
        vcrPanel.classList.remove('vcr-bio-dock-visible');
        shell.classList.remove('visible');
    }
}

// ── Reposition docked items after add/remove ────────────────────────

function repositionDockedItems(vcrPanel: HTMLElement): void {
    const panelRect = vcrPanel.getBoundingClientRect();
    const pillLeftRel = computePillLeftRelative(vcrPanel);
    const pillLeftAbs = panelRect.left + pillLeftRel;
    const baseLeft = pillLeftAbs - DOCK_CONTENT_START_GAP - CAPSULE_SIZE;

    let idx = 0;
    for (const [, entry] of _dockedDevices) {
        const offset = idx * (CAPSULE_SIZE + STACK_GAP);
        // Position relative to panel (items are inside panel, use panel-relative coords)
        const absLeft = baseLeft - offset;
        const relLeft = absLeft - panelRect.left;
        entry.element.style.left = `${relLeft.toFixed(1)}px`;
        idx++;
    }

    updateShellGeometry(vcrPanel);
}

// ── Create permanent docked item ────────────────────────────────────

function createDockedItem(device: BiometricDevice, vcrPanel: HTMLElement): HTMLElement {
    const item = document.createElement('div');
    item.className = 'vcr-wing-bio-dock-item';
    item.dataset.deviceKey = device.key;
    item.title = device.name;

    const icon = withImageRetry(document.createElement('img'));
    icon.className = 'vcr-bio-dock-icon';
    icon.src = getDeviceIconSrc(device);
    icon.alt = device.name;
    icon.draggable = false;
    icon.dataset.srcDark = device.iconDark;
    icon.dataset.srcLight = device.iconLight;
    item.appendChild(icon);

    // Click to un-dock
    item.addEventListener('click', () => {
        undockBioDevice(device.key);
    });

    vcrPanel.appendChild(item);
    return item;
}

// ── Floating capsule for morph animation ────────────────────────────

function createFloatingCapsule(device: BiometricDevice): HTMLElement {
    const capsule = document.createElement('div');
    capsule.className = 'bio-morph-capsule';

    const icon = withImageRetry(document.createElement('img'));
    icon.className = 'bio-morph-icon';
    icon.src = getDeviceIconSrc(device);
    icon.alt = device.name;
    icon.draggable = false;
    capsule.appendChild(icon);

    return capsule;
}

// ── Public API ──────────────────────────────────────────────────────

/** Register a callback that fires after any dock/un-dock change */
export function setDockChangeCallback(fn: (() => void) | null): void {
    _onDockChange = fn;
}

/** Check if a device is currently docked */
export function isDocked(deviceKey: string): boolean {
    return _dockedDevices.has(deviceKey);
}

/** Get all currently docked device keys */
export function getDockedDeviceKeys(): string[] {
    return [..._dockedDevices.keys()];
}

/** Animate a device card docking to the LEFT side of the VCR pill */
export function animateBioDeviceDock(card: HTMLElement, device: BiometricDevice): void {
    if (_dockedDevices.has(device.key)) return;

    const vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement | null;
    if (!vcrPanel) {
        dockDeviceImmediate(device, vcrPanel!);
        return;
    }

    // Each animation gets its own isolated context — no shared globals
    const ctx: DockAnimContext = { floatingCard: null, floatingCapsule: null, timers: [] };

    const cardRect = card.getBoundingClientRect();
    const geometry = computeBioDockGeometry(vcrPanel, cardRect);

    // Stage A: Clone the card and float it to VCR vertical alignment
    const floatingCard = card.cloneNode(true) as HTMLElement;
    floatingCard.classList.add('bio-dock-card-clone');
    floatingCard.style.left = `${cardRect.left.toFixed(1)}px`;
    floatingCard.style.top = `${cardRect.top.toFixed(1)}px`;
    floatingCard.style.width = `${cardRect.width.toFixed(1)}px`;
    floatingCard.style.height = `${cardRect.height.toFixed(1)}px`;
    document.body.appendChild(floatingCard);
    ctx.floatingCard = floatingCard;

    requestAnimationFrame(() => {
        floatingCard.style.transition = [
            `top ${DOCK_STAGE_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            `box-shadow ${DOCK_STAGE_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            `border-color ${DOCK_STAGE_DURATION}ms ease`,
        ].join(', ');
        floatingCard.style.top = `${geometry.stageTop.toFixed(1)}px`;
        floatingCard.style.boxShadow = '0 24px 48px rgba(2, 8, 20, 0.34)';
        floatingCard.style.borderColor = 'rgba(110, 200, 255, 0.28)';
    });

    // Stage B: Morph card → icon capsule
    ctxQueueTimer(
        ctx,
        () => {
            if (!ctx.floatingCard) return;
            const landedRect = ctx.floatingCard.getBoundingClientRect();
            const capsule = createFloatingCapsule(device);

            const morphStartLeft = landedRect.left + (landedRect.width - CAPSULE_SIZE) / 2;
            const morphStartTop = landedRect.top + (landedRect.height - CAPSULE_SIZE) / 2;

            const glideTargetX = geometry.capsuleLeft + DOCK_COCK_DISTANCE - morphStartLeft;
            const dockTargetX = geometry.capsuleLeft - morphStartLeft;
            const dockTargetY = geometry.capsuleTop - morphStartTop;

            capsule.style.left = `${morphStartLeft.toFixed(1)}px`;
            capsule.style.top = `${morphStartTop.toFixed(1)}px`;
            document.body.appendChild(capsule);
            ctx.floatingCapsule = capsule;

            requestAnimationFrame(() => {
                ctx.floatingCard?.classList.add('bio-dock-card-clone-fading');
                capsule.classList.add('visible');
            });

            // Remove card clone
            ctxQueueTimer(
                ctx,
                () => {
                    ctx.floatingCard?.remove();
                    ctx.floatingCard = null;
                },
                DOCK_MORPH_DURATION,
            );

            // Stage C: Glide capsule to near-dock (14px short)
            ctxQueueTimer(
                ctx,
                () => {
                    if (!ctx.floatingCapsule) return;
                    ctx.floatingCapsule.style.transition = [
                        `transform ${DOCK_SLIDE_DURATION}ms cubic-bezier(0.18, 0.96, 0.32, 1)`,
                        'opacity 140ms ease',
                        'filter 180ms ease',
                        'box-shadow 220ms ease',
                    ].join(', ');
                    ctx.floatingCapsule.style.transform = `translate3d(${glideTargetX.toFixed(1)}px, ${dockTargetY.toFixed(1)}px, 0) scale(1)`;
                },
                DOCK_MORPH_DURATION + 12,
            );

            // Stage D: Spring "cock" final 14px into place
            ctxQueueTimer(
                ctx,
                () => {
                    if (!ctx.floatingCapsule) return;
                    ctx.floatingCapsule.style.transition = [
                        `transform ${DOCK_COCK_DURATION}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
                        'opacity 120ms ease',
                        'filter 140ms ease',
                        'box-shadow 180ms ease',
                    ].join(', ');
                    ctx.floatingCapsule.style.transform = `translate3d(${dockTargetX.toFixed(1)}px, ${dockTargetY.toFixed(1)}px, 0) scale(0.985)`;
                    ctx.floatingCapsule.style.boxShadow = '0 9px 20px rgba(2, 8, 20, 0.16)';
                },
                DOCK_MORPH_DURATION + DOCK_SLIDE_DURATION + 12,
            );

            // Stage E: Swap to permanent docked widget
            ctxQueueTimer(
                ctx,
                () => {
                    dockDeviceImmediate(device, vcrPanel);
                    if (ctx.floatingCapsule) {
                        ctx.floatingCapsule.style.transition = 'opacity 90ms ease, filter 110ms ease';
                        ctx.floatingCapsule.style.opacity = '0';
                        ctx.floatingCapsule.style.filter = 'blur(1.5px)';
                    }
                },
                DOCK_MORPH_DURATION + DOCK_SLIDE_DURATION + DOCK_COCK_DURATION,
            );

            // Cleanup this animation's artifacts only
            ctxQueueTimer(
                ctx,
                () => {
                    ctxCleanup(ctx);
                },
                DOCK_MORPH_DURATION + DOCK_SLIDE_DURATION + DOCK_COCK_DURATION + 100,
            );
        },
        DOCK_STAGE_DURATION,
    );
}

export function dockDeviceImmediate(device: BiometricDevice, vcrPanel: HTMLElement): void {
    if (_dockedDevices.has(device.key)) return;
    if (!vcrPanel) {
        vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement;
        if (!vcrPanel) return;
    }

    const item = createDockedItem(device, vcrPanel);
    _dockedDevices.set(device.key, { element: item, device });

    repositionDockedItems(vcrPanel);

    // Animate item in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            item.classList.add('visible');
        });
    });

    _onDockChange?.();
}

/** Un-dock a device with a slide-out animation */
export function undockBioDevice(deviceKey: string): void {
    const entry = _dockedDevices.get(deviceKey);
    if (!entry) return;

    const el = entry.element;
    el.style.transition = 'opacity 180ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 180ms ease';
    el.style.opacity = '0';
    el.style.filter = 'blur(2px)';
    el.style.transform = 'translateY(-50%) translateX(-12px) scale(0.85)';

    _dockedDevices.delete(deviceKey);

    const vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement | null;

    setTimeout(() => {
        el.remove();
        if (vcrPanel) repositionDockedItems(vcrPanel);
    }, 240);

    if (vcrPanel) updateShellGeometry(vcrPanel);
    _onDockChange?.();
}

/** Remove all docked devices */
/** Reposition all docked device capsules after pill geometry changes */
export function resyncDockedDevices(): void {
    if (_dockedDevices.size === 0) return;
    const vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement | null;
    if (vcrPanel) repositionDockedItems(vcrPanel);
}

export function undockAllBioDevices(): void {
    for (const [, entry] of _dockedDevices) {
        entry.element.remove();
    }
    _dockedDevices.clear();

    const vcrPanel = document.querySelector('.vcr-control-panel') as HTMLElement | null;
    if (vcrPanel) {
        updateShellGeometry(vcrPanel);
        vcrPanel.classList.remove('vcr-bio-dock-visible');
        vcrPanel.style.removeProperty('--vcr-bio-dock-shell-width');
        vcrPanel.style.removeProperty('--vcr-pill-left');
    }

    _shellElement?.remove();
    _shellElement = null;

    // Clean up any in-flight animation artifacts
    document.querySelectorAll('.bio-dock-card-clone, .bio-morph-capsule').forEach(el => el.remove());

    _onDockChange?.();
}

// ── A/B test: dock visual treatment ─────────────────────────────────
// Variant A (Glass Pill) = default CSS, no body class needed.
// Variants B & C add a body class that scopes their CSS overrides.

function activateDockVisA() {
    document.body.classList.remove('dock-vis-b', 'dock-vis-c');
}
function deactivateDockVisA() {
    /* noop — other variant's activate handles class swap */
}
