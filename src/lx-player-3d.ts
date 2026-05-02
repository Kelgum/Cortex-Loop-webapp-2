/**
 * lx-player-3d — Three.js 3D renderer for the Lx.Player device.
 *
 * Self-contained module: only imports from `three`, no Lx.Studio internals.
 * Used by eject-animation.ts to replace the 2D square placeholder with a
 * cinematic 3D view of the device that tilts from front → top.
 */

import * as THREE from 'three';

/* ── Types ─────────────────────────────────────────────────── */

interface RawPart {
    id: string;
    name: string;
    color: string;
    shininess: number;
    opacity: number;
    visible: boolean;
    vertices: number[];
    faces: number[];
    kind?: string;
    sourcePartId?: string;
    pillIndex?: number;
    pillCount?: number;
}

interface TabletChamber {
    sourcePartId: string;
    pills: THREE.Mesh[]; // sorted by pillIndex (1=bottom)
    capsule: THREE.Mesh | null; // CirPattern capsule mesh paired with this chamber
    angle: number;
    radialDir: THREE.Vector3; // unit vector from center outward (in spinGroup local space)
}

/* ── Model variants ────────────────────────────────────────── */

export type ModelVariant = 'v1' | 'v2';

/* ── Part classification ───────────────────────────────────── */

const STATIC_IDS = new Set(['part_3', 'part_4', 'part_5', 'part_6', 'part_7']);
const TABLET_IDS_V1 = new Set([
    'part_1',
    'part_20',
    'part_21',
    'part_22',
    'part_23',
    'part_24',
    'part_25',
    'part_26',
    'part_27',
    'part_28',
    'part_29',
    'part_30',
    'part_31',
]);
const TABLET_IDS_V2 = new Set([
    'part_1',
    'part_20',
    'part_21',
    'part_22',
    'part_23',
    'part_24',
    'part_25',
    'part_26',
    'part_27',
    'part_28',
    'part_29',
    'part_30',
    'part_32',
    'part_33',
    'part_34',
    'part_35',
    'part_36',
]);
const LED_IDS = new Set(['part_7']);
const SHARK_IDS = new Set(['part_5']);
const CAROUSEL_IDS = new Set(['part_19']);

/* ── Camera presets (from device-profile.json) ─────────────── */

const FRONT_POS = new THREE.Vector3(157.5, 0, 0);
const FRONT_UP = new THREE.Vector3(0, 1, 0);
const TOP_POS = new THREE.Vector3(0, 157.5, 0);
const TOP_UP = new THREE.Vector3(0, 0, 1);
const TARGET = new THREE.Vector3(0, 0, 0);

/* ── Model preloader ───────────────────────────────────────── */

const VARIANT_PATHS: Record<ModelVariant, string> = {
    v1: '/assets/lx-player-parts.json',
    v2: '/assets/lx-player-parts-v2.json',
};

const _cache: Partial<Record<ModelVariant, RawPart[]>> = {};
const _loading: Partial<Record<ModelVariant, Promise<RawPart[]>>> = {};

export function preloadLxPlayerModel(variant: ModelVariant = 'v1'): Promise<RawPart[]> {
    if (_cache[variant]) return Promise.resolve(_cache[variant]!);
    if (_loading[variant]) return _loading[variant]!;

    _loading[variant] = fetch(VARIANT_PATHS[variant])
        .then(r => r.json())
        .then((parts: RawPart[]) => {
            _cache[variant] = parts;
            return parts;
        });

    return _loading[variant]!;
}

/* ── Tablet animation record ──────────────────────────────── */

interface TabletAnim {
    mesh: THREE.Mesh;
    startTime: number;
    duration: number;
    homeX: number;
    homeY: number;
    homeZ: number; // final resting position
    startX: number;
    startY: number;
    startZ: number; // starting position (outside device)
    targetColor: THREE.Color;
    finalScaleY: number;
    pureSlide?: boolean; // if true, skip scale animation (capsules)
}

/* ── Easing ────────────────────────────────────────────────── */

function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
}

/* ── LxPlayer3D class ──────────────────────────────────────── */

export class LxPlayer3D {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private group: THREE.Group;
    private spinGroup: THREE.Group;

    private _animId = 0;
    private _needsRender = false;
    private _spinning = false;
    private _spinSpeed = 0.3;
    private _spinUntil = 0;
    private _lastTime = 0;
    private _running = false;
    private _variant: ModelVariant = 'v1';

    /* ── Per-tablet animation state ── */
    private _chambers: TabletChamber[] = []; // 13 chambers sorted by angle from 6 o'clock
    private _tabletAnims: TabletAnim[] = [];
    private _isNewFormat = false; // true when model has kind:'tablet' parts

    /* ── Indexed rotation: load at front, rotate to next slot ── */
    private _indexedRotation = false; // when true, revealTablet rotates chamber to front
    private _rotAnim: { startTime: number; duration: number; fromY: number; toY: number } | null = null;

    // Old-format fallback (v2 model)
    private _tabletMeshes: THREE.Mesh[] = [];
    private _tabletHomeY: number[] = [];
    private _tabletHomeScaleY: number[] = [];
    private _fullGeometries: THREE.BufferGeometry[] = [];
    private _singleGeometries: THREE.BufferGeometry[] = [];

    constructor(opts: { width: number; height: number }) {
        // Renderer — transparent background for compositing over eject-square-bg
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.renderer.setSize(opts.width, opts.height);

        // Scene
        this.scene = new THREE.Scene();

        // Camera
        this.camera = new THREE.PerspectiveCamera(35, opts.width / opts.height, 0.1, 10000);

        // ── Lighting (Perry's tuned setup) ──

        const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.1);
        keyLight.position.set(-15.5, 12, 6);
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xb0c4ff, 0.45);
        fillLight.position.set(6, 3, -1);
        this.scene.add(fillLight);

        // Rim light off by default
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.0);
        rimLight.position.set(13.5, 20, 7);
        this.scene.add(rimLight);

        const topLight = new THREE.DirectionalLight(0xe0e8ff, 0.25);
        topLight.position.set(-4, 8.5, -0.5);
        this.scene.add(topLight);

        const ambient = new THREE.AmbientLight(0x1a1a2e, 0.5);
        this.scene.add(ambient);

        const hemi = new THREE.HemisphereLight(0x2a2a40, 0x0a0a0f, 0.3);
        this.scene.add(hemi);

        // Model groups
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.spinGroup = new THREE.Group();
        this.group.add(this.spinGroup);
    }

    getCanvas(): HTMLCanvasElement {
        return this.renderer.domElement;
    }

    setSize(width: number, height: number) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this._requestRender();
    }

    /** Load model parts and build meshes */
    loadModel(parts: RawPart[], variant: ModelVariant = 'v1') {
        this._variant = variant;
        this.group.clear();
        this.spinGroup = new THREE.Group();
        this.group.add(this.spinGroup);

        // Detect new split-pill format vs old combined-cluster format
        this._isNewFormat = parts.some(p => p.kind === 'tablet');

        for (const part of parts) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(part.vertices), 3));
            geom.setIndex(new THREE.BufferAttribute(new Uint32Array(part.faces), 1));
            geom.computeVertexNormals();

            const mat = this._buildMaterial(part);
            const mesh = new THREE.Mesh(geom, mat);

            const isTransparent = part.opacity < 1 || part.id === 'part_4';
            if (isTransparent) mesh.renderOrder = 1;

            mesh.name = part.id;
            // Tablets and capsules start hidden — revealed per-step by revealTablet()
            const isCapsuleMesh = part.name?.includes('CirPattern');
            mesh.visible = part.visible !== false && part.kind !== 'tablet' && !isCapsuleMesh;
            mesh.userData = {
                kind: part.kind,
                sourcePartId: part.sourcePartId,
                pillIndex: part.pillIndex,
                partName: part.name,
            };

            if (STATIC_IDS.has(part.id)) {
                this.group.add(mesh);
            } else {
                this.spinGroup.add(mesh);
            }
        }

        this._tabletAnims = [];

        // Push the shark backward (toward center) so it doesn't penetrate tablets
        if (this._isNewFormat) {
            const shark = this.group.getObjectByName('part_5') as THREE.Mesh | undefined;
            if (shark) shark.position.x -= 4;
        }

        if (this._isNewFormat) {
            this._collectChambersNewFormat();
        } else {
            this._collectTabletsOldFormat();
        }

        this._fitToView();
        this._requestRender();
    }

    /** Set camera to front, top, or isometric preset (no animation) */
    setCameraPreset(preset: 'front' | 'top' | 'isometric') {
        if (preset === 'isometric') {
            // ~35° tilt from front — between front and top, creates a 3/4 view
            const radius = FRONT_POS.length(); // 157.5
            const angle = Math.PI * 0.19; // ~34° from horizontal
            this.camera.position.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
            this.camera.up.set(-Math.sin(angle), Math.cos(angle), 0);
            this.camera.lookAt(TARGET);
            this._requestRender();
            return;
        }
        const pos = preset === 'front' ? FRONT_POS : TOP_POS;
        const up = preset === 'front' ? FRONT_UP : TOP_UP;
        this.camera.position.copy(pos);
        this.camera.up.copy(up);
        this.camera.lookAt(TARGET);
        this._requestRender();
    }

    /** Animate camera tilt from front → top. Returns Promise when done. */
    animateTilt(duration: number): Promise<void> {
        return new Promise(resolve => {
            const radius = FRONT_POS.length(); // 157.5
            const startTime = performance.now();

            const step = () => {
                const elapsed = performance.now() - startTime;
                const raw = Math.min(elapsed / duration, 1);
                const t = easeInOutCubic(raw);

                // Pure single-axis rotation around Z — no twist
                // Up vector co-rotates with position so "right" stays (0,0,-1) throughout
                const angle = (Math.PI / 2) * t; // 0 → π/2
                this.camera.position.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
                this.camera.up.set(-Math.sin(angle), Math.cos(angle), 0);
                this.camera.lookAt(TARGET);
                this._requestRender();

                if (raw < 1) {
                    requestAnimationFrame(step);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }

    /** Start carousel spin (clockwise from top = negative Y rotation) */
    startSpin(speed = 0.3, durationMs?: number) {
        const wasAnimating = this._spinning || this._tabletAnims.length > 0;
        this._spinning = true;
        this._spinSpeed = speed;
        this._spinUntil = durationMs != null ? performance.now() + durationMs : 0;
        if (!wasAnimating) {
            this._lastTime = 0;
        }
        this._requestRender();
    }

    stopSpin() {
        this._spinning = false;
        this._spinUntil = 0;
        this._requestRender();
    }

    /** Start the render loop */
    startRenderLoop() {
        if (this._running) return;
        this._running = true;
        this._lastTime = 0;
        this._requestRender();
    }

    /** Stop the render loop */
    stopRenderLoop() {
        this._running = false;
        cancelAnimationFrame(this._animId);
        this._animId = 0;
    }

    /** Hide all tablets — cartridge starts empty. Call after loadModel(). */
    prepareTabletsHidden(): void {
        this._tabletAnims = [];
        if (this._isNewFormat) {
            for (const chamber of this._chambers) {
                for (const pill of chamber.pills) {
                    pill.visible = false;
                    const mat = pill.material as THREE.MeshPhongMaterial;
                    mat.opacity = 0;
                    mat.transparent = true;
                    mat.emissiveIntensity = 0;
                }
                if (chamber.capsule) {
                    chamber.capsule.visible = false;
                    const mat = chamber.capsule.material as THREE.MeshPhongMaterial;
                    mat.opacity = 0;
                    mat.transparent = true;
                    mat.emissiveIntensity = 0;
                }
            }
        } else {
            for (let i = 0; i < this._tabletMeshes.length; i++) {
                const mesh = this._tabletMeshes[i];
                if (!mesh) continue;
                mesh.visible = false;
                const mat = mesh.material as THREE.MeshPhongMaterial;
                mat.opacity = 0;
                mat.transparent = true;
                mat.emissiveIntensity = 0;
                mesh.position.y = this._tabletHomeY[i];
                mesh.scale.set(1, this._tabletHomeScaleY[i], 1);
            }
        }
        this._requestRender();
    }

    /**
     * Animate one tablet/capsule into the cartridge with a substance color.
     * isCapsule: true = capsule mesh (>300mg), false = single tablet (≤300mg).
     *            false = single tablet (≤300mg, show only pill_1 / bottom pill).
     */
    revealTablet(index: number, hexColor: string, isCapsule: boolean, durationMs = 500): void {
        const wasAnimating = this._spinning || this._tabletAnims.length > 0;

        // Compute jewel-tone color
        const baseColor = new THREE.Color(hexColor);
        const hsl = { h: 0, s: 0, l: 0 };
        baseColor.getHSL(hsl);
        const gem = baseColor.clone();
        gem.setHSL(hsl.h, Math.max(hsl.s * 0.85, 0.25), hsl.l * 0.18 + 0.04);

        if (this._isNewFormat) {
            if (index < 0 || index >= this._chambers.length) return;
            const chamber = this._chambers[index];

            // ── Indexed rotation: rotate the carousel so the loading slot faces the camera ──
            // Camera faces from +X → front-facing angle in atan2(x,z) space = π/2.
            // For capsules, rotate to the capsule's own geometry angle so it lands exactly at 6 o'clock.
            const FRONT_ANGLE = Math.PI / 2;
            let loadAngle = chamber.angle;
            if (isCapsule && chamber.capsule) {
                chamber.capsule.geometry.computeBoundingBox();
                const cc = chamber.capsule.geometry.boundingBox!.getCenter(new THREE.Vector3());
                loadAngle = Math.atan2(cc.x, cc.z);
            }
            const targetRotY = FRONT_ANGLE - loadAngle;
            // Normalize to shortest rotation path
            const curRotY = this.spinGroup.rotation.y;
            let delta = targetRotY - curRotY;
            // Wrap delta into [-π, π] for shortest path
            delta = ((((delta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
            const finalRotY = curRotY + delta;

            const ROTATE_MS = 350;
            if (Math.abs(delta) > 0.01) {
                // Stop free-spinning; start indexed rotation to front
                this._spinning = false;
                this._spinUntil = 0;
                this._indexedRotation = true;
                this._rotAnim = {
                    startTime: performance.now(),
                    duration: ROTATE_MS,
                    fromY: curRotY,
                    toY: finalRotY,
                };
            }

            // Delay pill slide until rotation completes so the chamber is at front
            const dropDelay = Math.abs(delta) > 0.01 ? ROTATE_MS : 0;
            const dropStart = performance.now() + dropDelay;

            // Radial offset distance for starting position (outside the device)
            const TABLET_RADIAL_OFFSET = 15;
            const CAPSULE_RADIAL_OFFSET = 30; // capsules are longer (~22 units), need bigger offset
            const dir = chamber.radialDir;

            if (isCapsule) {
                // If this chamber has no paired capsule mesh (13 chambers vs 12 CirPattern parts),
                // clone one from a donor chamber and position it at this chamber's angle/radius.
                if (!chamber.capsule) {
                    const donor = this._chambers.find(c => c.capsule !== null);
                    if (donor && donor.capsule) {
                        const clone = donor.capsule.clone();
                        // Donor geometry is baked at its angle. Rotate clone to this chamber's angle.
                        donor.capsule.geometry.computeBoundingBox();
                        const donorCenter = donor.capsule.geometry.boundingBox!.getCenter(new THREE.Vector3());
                        const donorAngle = Math.atan2(donorCenter.x, donorCenter.z);
                        const rotDelta = chamber.angle - donorAngle;
                        clone.rotateY(-rotDelta); // rotate geometry to new angular position
                        // Clone material so coloring is independent
                        clone.material = (donor.capsule.material as THREE.MeshPhongMaterial).clone();
                        clone.visible = false;
                        this.spinGroup.add(clone);
                        chamber.capsule = clone;
                    }
                }
                // ── Capsule: slide in along its radial length axis from outside ──
                const cap = chamber.capsule!;
                // Capsule meshes have position=(0,0,0) — geometry is baked at offset.
                // Use GEOMETRY bounding box (local space, unaffected by spinGroup rotation).
                cap.geometry.computeBoundingBox();
                const geoBB = cap.geometry.boundingBox!;
                const geoCenter = geoBB.getCenter(new THREE.Vector3());
                const homeX = cap.position.x,
                    homeY = cap.position.y,
                    homeZ = cap.position.z;
                // Capsule's radial direction from geometry center (local space)
                const capDir = new THREE.Vector3(geoCenter.x, 0, geoCenter.z).normalize();
                const mat = cap.material as THREE.MeshPhongMaterial;
                cap.visible = true;
                cap.position.x = homeX + capDir.x * CAPSULE_RADIAL_OFFSET;
                cap.position.y = homeY;
                cap.position.z = homeZ + capDir.z * CAPSULE_RADIAL_OFFSET;
                mat.opacity = 0;
                mat.transparent = true;
                mat.emissiveIntensity = 0;
                // Pure slide for capsules — no scale animation
                this._tabletAnims.push({
                    mesh: cap,
                    startTime: dropStart,
                    duration: durationMs,
                    homeX,
                    homeY,
                    homeZ,
                    startX: cap.position.x,
                    startY: homeY,
                    startZ: cap.position.z,
                    targetColor: gem,
                    finalScaleY: cap.scale.y,
                    pureSlide: true,
                });
            } else {
                // ── Single tablet: reveal bottom pill only ──
                const pill = chamber.pills[0];
                const homeX = pill.position.x,
                    homeY = pill.position.y,
                    homeZ = pill.position.z;
                const mat = pill.material as THREE.MeshPhongMaterial;
                pill.visible = true;
                pill.position.x = homeX + dir.x * TABLET_RADIAL_OFFSET;
                pill.position.y = homeY;
                pill.position.z = homeZ + dir.z * TABLET_RADIAL_OFFSET;
                mat.opacity = 0;
                mat.transparent = true;
                mat.emissiveIntensity = 0;
                this._tabletAnims.push({
                    mesh: pill,
                    startTime: dropStart,
                    duration: durationMs,
                    homeX,
                    homeY,
                    homeZ,
                    startX: pill.position.x,
                    startY: homeY,
                    startZ: pill.position.z,
                    targetColor: gem,
                    finalScaleY: pill.scale.y,
                });
            }
        } else {
            // Old format fallback
            if (index < 0 || index >= this._tabletMeshes.length) return;
            const mesh = this._tabletMeshes[index];
            if (!mesh) return;

            const homeX = mesh.position.x;
            const homeY = this._tabletHomeY[index];
            const homeZ = mesh.position.z;
            const dropY = homeY + 8;
            const baseScaleY = this._tabletHomeScaleY[index];

            const mat = mesh.material as THREE.MeshPhongMaterial;
            if (!isCapsule && this._singleGeometries[index]) {
                mesh.geometry = this._singleGeometries[index];
            } else if (this._fullGeometries[index]) {
                mesh.geometry = this._fullGeometries[index];
            }

            mesh.visible = true;
            mesh.position.y = dropY;
            mat.opacity = 0;
            mat.transparent = true;
            mat.emissiveIntensity = 0;
            const startScale = 0.7;
            mesh.scale.set(startScale, baseScaleY * startScale, startScale);

            this._tabletAnims.push({
                mesh,
                startTime: performance.now(),
                duration: durationMs,
                homeX,
                homeY,
                homeZ,
                startX: homeX,
                startY: dropY,
                startZ: homeZ,
                targetColor: gem,
                finalScaleY: baseScaleY,
            });
        }

        if (!wasAnimating) {
            this._lastTime = 0;
        }
        this._requestRender();
    }

    /** Reset all tablets to hidden — used at loop boundary. */
    resetTablets(): void {
        this._tabletAnims = [];
        this._rotAnim = null;
        this._indexedRotation = false;
        this.spinGroup.rotation.y = 0;
        if (this._isNewFormat) {
            for (const chamber of this._chambers) {
                for (const pill of chamber.pills) {
                    pill.visible = false;
                    const mat = pill.material as THREE.MeshPhongMaterial;
                    mat.opacity = 0;
                    mat.emissiveIntensity = 0;
                    mat.emissive.setHex(0x000000);
                }
                if (chamber.capsule) {
                    chamber.capsule.visible = false;
                    const mat = chamber.capsule.material as THREE.MeshPhongMaterial;
                    mat.opacity = 0;
                    mat.emissiveIntensity = 0;
                    mat.emissive.setHex(0x000000);
                }
            }
        } else {
            for (let i = 0; i < this._tabletMeshes.length; i++) {
                const mesh = this._tabletMeshes[i];
                if (!mesh) continue;
                mesh.visible = false;
                mesh.position.y = this._tabletHomeY[i];
                mesh.scale.set(1, this._tabletHomeScaleY[i], 1);
                if (this._fullGeometries[i]) mesh.geometry = this._fullGeometries[i];
                const mat = mesh.material as THREE.MeshPhongMaterial;
                mat.opacity = 0;
                mat.emissiveIntensity = 0;
                mat.emissive.setHex(0x000000);
            }
        }
        this._requestRender();
    }

    /** Clean up all GPU resources */
    dispose() {
        this.stopRenderLoop();
        this.renderer.dispose();

        this.scene.traverse(obj => {
            if ((obj as THREE.Mesh).isMesh) {
                const mesh = obj as THREE.Mesh;
                mesh.geometry?.dispose();
                if (mesh.material) {
                    const mat = mesh.material as THREE.Material;
                    mat.dispose();
                }
            }
        });
    }

    /* ── Private ────────────────────────────────────────────── */

    private _tick() {
        if (!this._running) return;
        this._animId = 0;

        const now = performance.now() / 1000;
        const dt = this._lastTime ? now - this._lastTime : 0;
        this._lastTime = now;

        if (this._spinUntil > 0 && performance.now() >= this._spinUntil) {
            this._spinning = false;
            this._spinUntil = 0;
        }

        if (this._spinning) {
            this.spinGroup.rotation.y -= this._spinSpeed * dt;
        }

        // Indexed rotation animation (smooth rotate chamber to front)
        if (this._rotAnim) {
            const elapsed = performance.now() - this._rotAnim.startTime;
            const t = Math.min(elapsed / this._rotAnim.duration, 1);
            const eased = easeInOutCubic(t);
            this.spinGroup.rotation.y = this._rotAnim.fromY + (this._rotAnim.toY - this._rotAnim.fromY) * eased;
            if (t >= 1) this._rotAnim = null;
        }

        if (this._tabletAnims.length > 0) {
            this._updateTabletAnims();
        }

        const shouldRender =
            this._needsRender || this._spinning || this._tabletAnims.length > 0 || this._rotAnim != null;
        if (shouldRender) {
            this._needsRender = false;
            this.renderer.render(this.scene, this.camera);
        }

        if (
            this._running &&
            (this._needsRender || this._spinning || this._tabletAnims.length > 0 || this._rotAnim != null)
        ) {
            this._scheduleFrame();
        }
    }

    private _requestRender() {
        this._needsRender = true;
        if (!this._running) return;
        this._scheduleFrame();
    }

    private _scheduleFrame() {
        if (this._animId !== 0) return;
        this._animId = requestAnimationFrame(() => this._tick());
    }

    private _updateTabletAnims() {
        const now = performance.now();
        for (let i = this._tabletAnims.length - 1; i >= 0; i--) {
            const a = this._tabletAnims[i];
            const elapsed = now - a.startTime;
            if (elapsed < 0) continue; // delayed start — not yet
            const raw = Math.min(1, elapsed / a.duration);
            const mat = a.mesh.material as THREE.MeshPhongMaterial;

            if (raw < 0.6) {
                // ── Slide-in phase: 0–60% ──
                const t = easeOutCubic(raw / 0.6);
                a.mesh.position.x = a.startX + (a.homeX - a.startX) * t;
                a.mesh.position.y = a.startY + (a.homeY - a.startY) * t;
                a.mesh.position.z = a.startZ + (a.homeZ - a.startZ) * t;
                mat.opacity = t;
                if (a.pureSlide) {
                    a.mesh.scale.set(1, a.finalScaleY, 1);
                } else {
                    const s = 0.7 + 0.3 * t;
                    a.mesh.scale.set(s, a.finalScaleY * s, s);
                }
                mat.color.copy(a.targetColor);
            } else {
                // ── Glow phase: 60–100% ──
                a.mesh.position.x = a.homeX;
                a.mesh.position.y = a.homeY;
                a.mesh.position.z = a.homeZ;
                mat.opacity = 1;
                a.mesh.scale.set(1, a.finalScaleY, 1);
                mat.color.copy(a.targetColor);

                const glowT = (raw - 0.6) / 0.4; // 0→1 within glow phase
                // Ramp up then down: peak at glowT=0.3
                const glowIntensity =
                    glowT < 0.3 ? easeOutCubic(glowT / 0.3) * 0.6 : 0.6 * (1 - easeOutCubic((glowT - 0.3) / 0.7));
                mat.emissive.copy(a.targetColor);
                mat.emissiveIntensity = glowIntensity;
            }

            if (raw >= 1) {
                // Animation complete — settle at final state
                mat.emissiveIntensity = 0;
                mat.emissive.setHex(0x000000);
                this._tabletAnims.splice(i, 1);
            }
        }
    }

    /**
     * Create a new geometry containing only the bottom tablet from a 5-tablet stack.
     * Keeps triangles whose centroid Y is in the bottom ~25% of the geometry's Y range.
     */
    private _trimToBottomTablet(geom: THREE.BufferGeometry): THREE.BufferGeometry {
        const pos = geom.getAttribute('position') as THREE.BufferAttribute;
        const idx = geom.getIndex();
        if (!idx) return geom.clone();

        // Find Y range in local geometry space
        let minY = Infinity,
            maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        // The 5 tablets are stacked evenly; keep the bottom ~22% (slightly above 1/5 = 20%)
        // Bottom tablet of the 5-stack spans ~31% of the total Y range.
        // Use 35% cutoff to include it fully with a small margin above.
        const cutoffY = minY + (maxY - minY) * 0.35;

        // Collect triangles whose centroid is below the cutoff
        const keptIndices: number[] = [];
        for (let f = 0; f < idx.count; f += 3) {
            const i0 = idx.getX(f);
            const i1 = idx.getX(f + 1);
            const i2 = idx.getX(f + 2);
            const centroidY = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
            if (centroidY <= cutoffY) {
                keptIndices.push(i0, i1, i2);
            }
        }

        // Build new geometry sharing the same position buffer but with filtered indices
        const trimmed = new THREE.BufferGeometry();
        trimmed.setAttribute('position', pos);
        // Copy normals if present
        const nrm = geom.getAttribute('normal');
        if (nrm) trimmed.setAttribute('normal', nrm);
        trimmed.setIndex(new THREE.BufferAttribute(new Uint32Array(keptIndices), 1));
        return trimmed;
    }

    /** Collect individual pill meshes into chambers (new split-pill model format). */
    private _collectChambersNewFormat() {
        // Group pill meshes by sourcePartId
        const chamberMap = new Map<string, THREE.Mesh[]>();
        // Collect capsule meshes (CirPattern parts)
        const capsuleMeshes: THREE.Mesh[] = [];
        this.spinGroup.children.forEach(child => {
            if (!(child instanceof THREE.Mesh)) return;
            if (child.userData?.kind === 'tablet') {
                const src = child.userData.sourcePartId as string;
                if (!chamberMap.has(src)) chamberMap.set(src, []);
                chamberMap.get(src)!.push(child);
            } else if (child.userData?.partName?.includes('CirPattern')) {
                capsuleMeshes.push(child);
            }
        });

        // Sort pills within each chamber by pillIndex (1=bottom)
        const chambers: TabletChamber[] = [];
        for (const [src, pills] of chamberMap) {
            pills.sort((a, b) => (a.userData.pillIndex ?? 0) - (b.userData.pillIndex ?? 0));
            // Compute angular position from pill_1's bounding box center
            const refPill = pills[0];
            const box = new THREE.Box3().setFromObject(refPill);
            const center = box.getCenter(new THREE.Vector3());
            const angle = Math.atan2(center.x, center.z);
            const radialDir = new THREE.Vector3(center.x, 0, center.z).normalize();
            chambers.push({ sourcePartId: src, pills, capsule: null, angle, radialDir });
        }

        // Pair capsule meshes with chambers by sorted angular proximity.
        // Sort both arrays by angle so sequential pairing gives near-optimal matches
        // (12 capsules at ~30° spacing vs 13 chambers at ~27.7° spacing, offset ~14°).
        const capsulesWithAngles = capsuleMeshes.map(cap => {
            cap.geometry.computeBoundingBox();
            const capCenter = cap.geometry.boundingBox!.getCenter(new THREE.Vector3());
            return { cap, angle: Math.atan2(capCenter.x, capCenter.z) };
        });
        capsulesWithAngles.sort((a, b) => a.angle - b.angle);
        const chambersByAngle = [...chambers].sort((a, b) => a.angle - b.angle);
        // For each capsule, find the nearest chamber (globally optimal for evenly-spaced rings)
        const usedChambers = new Set<TabletChamber>();
        for (const { cap, angle: capAngle } of capsulesWithAngles) {
            let best: TabletChamber | null = null;
            let bestDist = Infinity;
            for (const ch of chambersByAngle) {
                if (usedChambers.has(ch)) continue;
                let d = Math.abs(ch.angle - capAngle);
                if (d > Math.PI) d = 2 * Math.PI - d;
                if (d < bestDist) { bestDist = d; best = ch; }
            }
            if (best) {
                best.capsule = cap;
                usedChambers.add(best);
            }
        }

        // Sort chambers by angle from 6 o'clock
        chambers.sort((a, b) => {
            const normA = (a.angle - Math.PI + 2 * Math.PI) % (2 * Math.PI);
            const normB = (b.angle - Math.PI + 2 * Math.PI) % (2 * Math.PI);
            return normA - normB;
        });

        this._chambers = chambers;
    }

    /** Collect tablet meshes using hardcoded IDs (old combined-cluster model format). */
    private _collectTabletsOldFormat() {
        const tabletIds = this._variant === 'v2' ? TABLET_IDS_V2 : TABLET_IDS_V1;
        const allTablets: THREE.Mesh[] = [];
        this.spinGroup.children.forEach(child => {
            if (!(child instanceof THREE.Mesh)) return;
            if (tabletIds.has(child.name)) allTablets.push(child);
        });

        const centerCache = new Map<THREE.Mesh, THREE.Vector3>();
        for (const m of allTablets) {
            const box = new THREE.Box3().setFromObject(m);
            centerCache.set(m, box.getCenter(new THREE.Vector3()));
        }
        allTablets.sort((a, b) => {
            const ca = centerCache.get(a)!;
            const cb = centerCache.get(b)!;
            const angleA = Math.atan2(ca.x, ca.z);
            const angleB = Math.atan2(cb.x, cb.z);
            const normA = (angleA - Math.PI + 2 * Math.PI) % (2 * Math.PI);
            const normB = (angleB - Math.PI + 2 * Math.PI) % (2 * Math.PI);
            return normA - normB;
        });

        this._tabletMeshes = allTablets;
        this._tabletHomeY = allTablets.map(m => m.position.y);
        this._tabletHomeScaleY = allTablets.map(m => m.scale.y);

        this._fullGeometries = [];
        this._singleGeometries = [];
        for (const mesh of allTablets) {
            this._fullGeometries.push(mesh.geometry);
            this._singleGeometries.push(this._trimToBottomTablet(mesh.geometry));
        }
    }

    private _fitToView() {
        const box = new THREE.Box3().setFromObject(this.group);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        this.group.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
            const fov = this.camera.fov * (Math.PI / 180);
            const dist = (maxDim / 2 / Math.tan(fov / 2)) * 2.14;
            this.camera.position.set(dist, 0, 0); // start at front
            this.camera.up.set(0, 1, 0);
            this.camera.lookAt(0, 0, 0);
            this.camera.near = dist / 100;
            this.camera.far = dist * 100;
            this.camera.updateProjectionMatrix();

            // Update preset distances to match actual model size
            FRONT_POS.set(dist, 0, 0);
            TOP_POS.set(0, dist, 0);
        }
    }

    /**
     * Dynamically recolor tablet capsules to match protocol substance colors.
     * Accepts an array of hex color strings (e.g. ['#ff4757', '#1e90ff', ...]).
     * Colors are cycled across the 13 tablet parts (V1) or 16 (V2).
     * Each tablet mesh material gets the darkened jewel-tone treatment matching
     * the original _buildMaterial() tablet branch.
     */
    recolorTablets(colors: string[]): void {
        if (!colors || colors.length === 0) return;
        if (this._isNewFormat) {
            for (let ci = 0; ci < this._chambers.length; ci++) {
                const hexColor = colors[ci % colors.length];
                const baseColor = new THREE.Color(hexColor);
                const hsl = { h: 0, s: 0, l: 0 };
                baseColor.getHSL(hsl);
                const gem = baseColor.clone();
                gem.setHSL(hsl.h, Math.max(hsl.s * 0.85, 0.25), hsl.l * 0.18 + 0.04);
                for (const pill of this._chambers[ci].pills) {
                    const mat = pill.material as THREE.MeshPhongMaterial;
                    mat.color.copy(gem);
                    mat.needsUpdate = true;
                }
            }
        } else {
            const tabletIds = this._variant === 'v2' ? TABLET_IDS_V2 : TABLET_IDS_V1;
            const tabletList = Array.from(tabletIds);
            const traverse = (g: THREE.Group) => {
                g.children.forEach(child => {
                    if (child instanceof THREE.Group) {
                        traverse(child);
                        return;
                    }
                    if (!(child instanceof THREE.Mesh)) return;
                    const idx = tabletList.indexOf(child.name);
                    if (idx < 0) return;
                    const hexColor = colors[idx % colors.length];
                    const baseColor = new THREE.Color(hexColor);
                    const hsl = { h: 0, s: 0, l: 0 };
                    baseColor.getHSL(hsl);
                    const gem = baseColor.clone();
                    gem.setHSL(hsl.h, Math.max(hsl.s * 0.85, 0.25), hsl.l * 0.18 + 0.04);
                    const mat = child.material as THREE.MeshPhongMaterial;
                    mat.color.copy(gem);
                    mat.needsUpdate = true;
                });
            };
            traverse(this.group);
            traverse(this.spinGroup);
        }
        this._requestRender();
    }

    /** Build materials — ported from Lx.Player viewer.ts (Perry's tuned settings) */
    private _buildMaterial(part: RawPart): THREE.MeshPhongMaterial {
        const baseColor = new THREE.Color(part.color);
        const id = part.id;

        // Shell Cover — invisible
        if (id === 'part_4') {
            return new THREE.MeshPhongMaterial({
                color: 0xd0d8e8,
                shininess: 120,
                transparent: true,
                opacity: 0.0,
                side: THREE.DoubleSide,
                depthWrite: false,
                specular: new THREE.Color(0xffffff),
            });
        }

        // Shell Bottom — near-black
        if (id === 'part_3') {
            return new THREE.MeshPhongMaterial({
                color: new THREE.Color().setHSL(0, 0, 0.01),
                shininess: 90,
                specular: new THREE.Color(0x333344),
                side: THREE.DoubleSide,
            });
        }

        // LED strips — vivid green glow
        if (LED_IDS.has(id)) {
            return new THREE.MeshPhongMaterial({
                color: 0x10ff70,
                emissive: new THREE.Color(0x10ff70),
                emissiveIntensity: 0.8,
                shininess: 100,
                side: THREE.DoubleSide,
            });
        }

        // Shark — dramatic red
        if (SHARK_IDS.has(id)) {
            return new THREE.MeshPhongMaterial({
                color: 0xff2020,
                emissive: new THREE.Color(0xff1010),
                emissiveIntensity: 0.15,
                shininess: 60,
                specular: new THREE.Color(0xff4444),
                side: THREE.DoubleSide,
            });
        }

        // Carousel — semi-transparent scaffold
        if (CAROUSEL_IDS.has(id)) {
            return new THREE.MeshPhongMaterial({
                color: 0x181b22,
                shininess: 70,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                depthWrite: false,
                specular: new THREE.Color(0x334455),
            });
        }

        // Tablets & capsules — dark opaque jewel tones (preserve source hue + saturation)
        const tabletIds = this._variant === 'v2' ? TABLET_IDS_V2 : TABLET_IDS_V1;
        const isCapsulePart = part.name?.includes('CirPattern');
        if (part.kind === 'tablet' || isCapsulePart || tabletIds.has(id)) {
            const gem = baseColor.clone();
            const hsl = { h: 0, s: 0, l: 0 };
            gem.getHSL(hsl);
            gem.setHSL(hsl.h, Math.max(hsl.s * 0.85, 0.25), hsl.l * 0.18 + 0.04);

            return new THREE.MeshPhongMaterial({
                color: gem,
                shininess: 70,
                transparent: true,
                opacity: 1,
                emissive: new THREE.Color(0x000000),
                emissiveIntensity: 0,
                side: THREE.DoubleSide,
                specular: new THREE.Color(0x444444),
            });
        }

        // CirPattern slots — glowing colored accents (preserve source hue + saturation)
        if (part.name.includes('CirPattern')) {
            const hsl = { h: 0, s: 0, l: 0 };
            baseColor.getHSL(hsl);
            const slotColor = baseColor.clone();
            slotColor.setHSL(hsl.h, Math.max(hsl.s * 0.85, 0.2), hsl.l * 0.15 + 0.03);

            const glowColor = slotColor.clone();
            glowColor.setHSL(hsl.h, Math.max(hsl.s * 0.85, 0.2), hsl.l * 0.22 + 0.08);

            return new THREE.MeshPhongMaterial({
                color: slotColor,
                emissive: glowColor,
                emissiveIntensity: 1.3,
                shininess: 50,
                transparent: true,
                opacity: 0.95,
                depthWrite: false,
                side: THREE.DoubleSide,
                specular: new THREE.Color(0x333333),
            });
        }

        // Default — dark metallic
        const isTransparent = part.opacity < 1;
        return new THREE.MeshPhongMaterial({
            color: baseColor,
            shininess: 60,
            transparent: isTransparent,
            opacity: part.opacity ?? 1,
            side: THREE.DoubleSide,
            depthWrite: !isTransparent,
            specular: new THREE.Color(0x444444),
        });
    }
}
