/**
 * lx-player-3d — Three.js 3D renderer for the Lx.Player device.
 *
 * Self-contained module: only imports from `three`, no Cortex Loop internals.
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

/* ── Easing ────────────────────────────────────────────────── */

function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ── LxPlayer3D class ──────────────────────────────────────── */

export class LxPlayer3D {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private group: THREE.Group;
    private spinGroup: THREE.Group;

    private _animId = 0;
    private _spinning = false;
    private _spinSpeed = 0.3;
    private _lastTime = 0;
    private _running = false;
    private _variant: ModelVariant = 'v1';

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
    }

    /** Load model parts and build meshes */
    loadModel(parts: RawPart[], variant: ModelVariant = 'v1') {
        this._variant = variant;
        this.group.clear();
        this.spinGroup = new THREE.Group();
        this.group.add(this.spinGroup);

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
            mesh.visible = part.visible !== false;

            if (STATIC_IDS.has(part.id)) {
                this.group.add(mesh);
            } else {
                this.spinGroup.add(mesh);
            }
        }

        this._fitToView();
    }

    /** Set camera to front or top preset (no animation) */
    setCameraPreset(preset: 'front' | 'top') {
        const pos = preset === 'front' ? FRONT_POS : TOP_POS;
        const up = preset === 'front' ? FRONT_UP : TOP_UP;
        this.camera.position.copy(pos);
        this.camera.up.copy(up);
        this.camera.lookAt(TARGET);
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
    startSpin(speed = 0.3) {
        this._spinning = true;
        this._spinSpeed = speed;
    }

    stopSpin() {
        this._spinning = false;
    }

    /** Start the render loop */
    startRenderLoop() {
        if (this._running) return;
        this._running = true;
        this._lastTime = 0;
        this._tick();
    }

    /** Stop the render loop */
    stopRenderLoop() {
        this._running = false;
        cancelAnimationFrame(this._animId);
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
        this._animId = requestAnimationFrame(() => this._tick());

        const now = performance.now() / 1000;
        const dt = this._lastTime ? now - this._lastTime : 0;
        this._lastTime = now;

        if (this._spinning) {
            this.spinGroup.rotation.y -= this._spinSpeed * dt;
        }

        this.renderer.render(this.scene, this.camera);
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

    /** Build materials — ported from Virtualizer viewer.ts (Perry's tuned settings) */
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

        // Tablets — dark opaque jewel tones (preserve source hue + saturation)
        const tabletIds = this._variant === 'v2' ? TABLET_IDS_V2 : TABLET_IDS_V1;
        if (tabletIds.has(id)) {
            const gem = baseColor.clone();
            const hsl = { h: 0, s: 0, l: 0 };
            gem.getHSL(hsl);
            gem.setHSL(hsl.h, Math.max(hsl.s * 0.85, 0.25), hsl.l * 0.18 + 0.04);

            return new THREE.MeshPhongMaterial({
                color: gem,
                shininess: 70,
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
