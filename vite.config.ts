import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { defineConfig } from 'vite';

function getGitHash(): string {
    try {
        return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

function getGitBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

/**
 * Resolve the main repo root (NOT the worktree root).
 * `--git-common-dir` returns the shared .git directory; its parent is the
 * main checkout.  This ensures gitignored data directories (saved-cycles/,
 * .cortex-debug/, etc.) are always shared across all worktrees.
 */
function getGitRoot(): string {
    try {
        const commonDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim();
        // commonDir is <main-repo>/.git (or <main-repo>/.git for worktrees too)
        return resolve(commonDir, '..');
    } catch {
        return process.cwd();
    }
}

const GIT_ROOT = getGitRoot();

const EXPORT_ROOT_DIR_NAME = '.cortex-debug';
const EXPORT_ROOT_PATH = resolve(GIT_ROOT, EXPORT_ROOT_DIR_NAME);

function sendJson(res: any, statusCode: number, payload: unknown) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
}

function sanitizeFolderName(value: unknown) {
    const cleaned = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 140);

    return cleaned || 'run';
}

function resolveSafeChildPath(baseDir: string, relativePath: unknown) {
    const raw = String(relativePath || '').trim();
    if (!raw) throw new Error('Bundle file path is missing.');

    const segments = raw.split('/').filter(Boolean);
    if (segments.length === 0) throw new Error('Bundle file path is missing.');
    for (const segment of segments) {
        if (segment === '.' || segment === '..') {
            throw new Error(`Unsafe bundle file path: ${raw}`);
        }
    }

    const resolved = resolve(baseDir, ...segments);
    const expectedPrefix = `${baseDir}/`;
    if (resolved !== baseDir && !resolved.startsWith(expectedPrefix)) {
        throw new Error(`Bundle file path escaped export directory: ${raw}`);
    }
    return resolved;
}

function readJsonBody(req: any) {
    return new Promise<any>((resolveBody, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolveBody(text ? JSON.parse(text) : {});
            } catch (err) {
                reject(new Error('Invalid JSON body.'));
            }
        });
        req.on('error', (err: Error) => reject(err));
    });
}

async function writeDebugBundle(body: any) {
    const folderName = sanitizeFolderName(body?.folderName);
    const files = Array.isArray(body?.files) ? body.files : [];
    if (files.length === 0) throw new Error('No debug bundle files were provided.');

    await mkdir(EXPORT_ROOT_PATH, { recursive: true });
    const existingEntries = await readdir(EXPORT_ROOT_PATH);
    const shouldResetRoot = existingEntries.some(entry => entry !== folderName);
    if (shouldResetRoot) {
        await clearDebugBundleRoot();
    }

    const runDir = resolve(EXPORT_ROOT_PATH, folderName);
    await mkdir(runDir, { recursive: true });

    for (const file of files) {
        const targetPath = resolveSafeChildPath(runDir, file?.relativePath);
        const content =
            typeof file?.content === 'string' ? file.content : JSON.stringify(file?.content ?? null, null, 2);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, 'utf8');
    }

    return runDir;
}

async function clearDebugBundleRoot() {
    await mkdir(EXPORT_ROOT_PATH, { recursive: true });
    const entries = await readdir(EXPORT_ROOT_PATH);
    await Promise.all(entries.map(entry => rm(resolve(EXPORT_ROOT_PATH, entry), { recursive: true, force: true })));
}

function debugBundlePlugin() {
    const handleRequest = async (req: any, res: any, next: () => void) => {
        const url = String(req.url || '').split('?')[0];

        if (req.method === 'GET' && url === '/__debug-bundles/health') {
            sendJson(res, 200, {
                ok: true,
                exportRoot: EXPORT_ROOT_PATH,
            });
            return;
        }

        if (req.method === 'POST' && url === '/__debug-bundles/write') {
            try {
                const body = await readJsonBody(req);
                const runDir = await writeDebugBundle(body);
                sendJson(res, 200, {
                    ok: true,
                    exportRoot: EXPORT_ROOT_PATH,
                    runDir,
                });
            } catch (err: any) {
                sendJson(res, 500, {
                    ok: false,
                    error: err?.message || 'Failed to write debug bundle.',
                });
            }
            return;
        }

        if (req.method === 'POST' && url === '/__debug-bundles/clear') {
            try {
                await clearDebugBundleRoot();
                sendJson(res, 200, {
                    ok: true,
                    exportRoot: EXPORT_ROOT_PATH,
                });
            } catch (err: any) {
                sendJson(res, 500, {
                    ok: false,
                    error: err?.message || 'Failed to clear debug bundles.',
                });
            }
            return;
        }

        next();
    };

    return {
        name: 'cortex-debug-bundles',
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
        configurePreviewServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
    };
}

// ── Cycle Storage Plugin ─────────────────────────────────────────────
// Persists saved cycles as JSON files in saved-cycles/ so every Vite
// instance (any port) reads from the same source of truth on disk.

const CYCLES_DIR = resolve(GIT_ROOT, 'saved-cycles');
const CYCLES_INDEX_PATH = resolve(CYCLES_DIR, 'index.json');

function sanitizeCycleId(raw: unknown): string {
    const cleaned = String(raw || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!cleaned) throw new Error('Invalid cycle ID');
    return cleaned;
}

async function readCyclesIndex(): Promise<any[]> {
    try {
        const raw = await readFile(CYCLES_INDEX_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// Simple in-process mutex to prevent concurrent read-modify-write on index.json
let _indexLock: Promise<void> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = _indexLock;
    let resolve: () => void;
    _indexLock = new Promise<void>(r => {
        resolve = r;
    });
    return prev.then(fn).finally(() => resolve!());
}

async function writeCyclesIndex(entries: any[]): Promise<void> {
    await mkdir(CYCLES_DIR, { recursive: true });
    await writeFile(CYCLES_INDEX_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

function toSavedCycleIndexEntry(record: any) {
    return {
        id: record.id,
        filename: record.filename,
        prompt: record.prompt,
        maxEffects: record.maxEffects,
        rxMode: record.rxMode,
        savedAt: record.savedAt,
        hookSentence: record.hookSentence,
        topEffects: record.topEffects,
        iconSvg: record.iconSvg ?? null,
    };
}

function cycleStoragePlugin() {
    const handleRequest = async (req: any, res: any, next: () => void) => {
        const url = String(req.url || '').split('?')[0];
        if (!url.startsWith('/__cycles')) return next();

        // GET /__cycles/index — lightweight metadata list
        if (req.method === 'GET' && url === '/__cycles/index') {
            try {
                sendJson(res, 200, await readCyclesIndex());
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // GET /__cycles/:id — full cycle record (includes bundle)
        if (req.method === 'GET' && url.startsWith('/__cycles/')) {
            try {
                const id = sanitizeCycleId(url.slice('/__cycles/'.length));
                const filePath = resolve(CYCLES_DIR, `${id}.json`);
                const raw = await readFile(filePath, 'utf8');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(raw);
            } catch {
                sendJson(res, 404, { ok: false, error: 'Cycle not found' });
            }
            return;
        }

        // POST /__cycles — save a new cycle (body = full SavedCycleRecord)
        if (req.method === 'POST' && url === '/__cycles') {
            try {
                const body = await readJsonBody(req);
                const id = sanitizeCycleId(body?.id);
                await mkdir(CYCLES_DIR, { recursive: true });

                const filePath = resolve(CYCLES_DIR, `${id}.json`);
                await writeFile(filePath, JSON.stringify(body), 'utf8');

                const index = await readCyclesIndex();
                const entry = toSavedCycleIndexEntry(body);
                const pos = index.findIndex((e: any) => e.id === id);
                if (pos >= 0) {
                    index[pos] = entry;
                } else {
                    index.unshift(entry);
                }
                await writeCyclesIndex(index);
                sendJson(res, 200, { ok: true, index });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // PATCH /__cycles/:id — update cycle metadata (body = { filename?, iconSvg? })
        // Wrapped in index lock to prevent concurrent read-modify-write corruption
        if (req.method === 'PATCH' && url.startsWith('/__cycles/')) {
            try {
                const id = sanitizeCycleId(url.slice('/__cycles/'.length));
                const body = await readJsonBody(req);

                const resultIndex = await withIndexLock(async () => {
                    const filePath = resolve(CYCLES_DIR, `${id}.json`);
                    const raw = await readFile(filePath, 'utf8');
                    const record = JSON.parse(raw);

                    if (body?.filename && String(body.filename).trim()) {
                        record.filename = String(body.filename).trim();
                    }
                    if (typeof body?.iconSvg === 'string' || body?.iconSvg === null) {
                        record.iconSvg = body.iconSvg;
                    }
                    if (Array.isArray(body?.substanceClasses)) {
                        record.substanceClasses = body.substanceClasses;
                    }
                    if (Array.isArray(body?.recommendedDevices)) {
                        record.recommendedDevices = body.recommendedDevices;
                    }

                    await writeFile(filePath, JSON.stringify(record), 'utf8');

                    const index = await readCyclesIndex();
                    const entry = index.find((e: any) => e.id === id);
                    if (entry) {
                        if (record.filename) entry.filename = record.filename;
                        if (typeof record.iconSvg !== 'undefined') entry.iconSvg = record.iconSvg;
                        if (record.substanceClasses) entry.substanceClasses = record.substanceClasses;
                        if (record.recommendedDevices) entry.recommendedDevices = record.recommendedDevices;
                    }
                    await writeCyclesIndex(index);
                    return index;
                });
                sendJson(res, 200, { ok: true, index: resultIndex });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // DELETE /__cycles/:id — remove a saved cycle
        if (req.method === 'DELETE' && url.startsWith('/__cycles/')) {
            try {
                const id = sanitizeCycleId(url.slice('/__cycles/'.length));
                await rm(resolve(CYCLES_DIR, `${id}.json`), { force: true });
                const index = (await readCyclesIndex()).filter((e: any) => e.id !== id);
                await writeCyclesIndex(index);
                sendJson(res, 200, { ok: true, index });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        next();
    };

    return {
        name: 'cortex-cycle-storage',
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
        configurePreviewServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
    };
}

// ── Custom Sections Plugin ──────────────────────────────────────────
// Persists user-created stream categories as JSON files in custom-sections/
// so they survive across Vite instances and browsers.

const CUSTOM_SECTIONS_DIR = resolve(process.cwd(), 'custom-sections');
const CUSTOM_SECTIONS_INDEX_PATH = resolve(CUSTOM_SECTIONS_DIR, 'index.json');

function sanitizeCustomSectionId(raw: unknown): string {
    const cleaned = String(raw || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!cleaned) throw new Error('Invalid custom section ID');
    return cleaned;
}

async function readCustomSectionsIndex(): Promise<any[]> {
    try {
        const raw = await readFile(CUSTOM_SECTIONS_INDEX_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

let _csIndexLock: Promise<void> = Promise.resolve();
function withCsIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = _csIndexLock;
    let resolve: () => void;
    _csIndexLock = new Promise<void>(r => {
        resolve = r;
    });
    return prev.then(fn).finally(() => resolve!());
}

async function writeCustomSectionsIndex(entries: any[]): Promise<void> {
    await mkdir(CUSTOM_SECTIONS_DIR, { recursive: true });
    await writeFile(CUSTOM_SECTIONS_INDEX_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

function customSectionsPlugin() {
    const handleRequest = async (req: any, res: any, next: () => void) => {
        const url = String(req.url || '').split('?')[0];
        if (!url.startsWith('/__custom-sections')) return next();

        // GET /__custom-sections/index
        if (req.method === 'GET' && url === '/__custom-sections/index') {
            try {
                sendJson(res, 200, await readCustomSectionsIndex());
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // POST /__custom-sections — save new section
        if (req.method === 'POST' && url === '/__custom-sections') {
            try {
                const body = await readJsonBody(req);
                const id = sanitizeCustomSectionId(body?.id);
                await mkdir(CUSTOM_SECTIONS_DIR, { recursive: true });

                const record = { id, title: String(body?.title || '').trim(), tags: body?.tags || [] };
                const filePath = resolve(CUSTOM_SECTIONS_DIR, `${id}.json`);
                await writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');

                const index = await readCustomSectionsIndex();
                const pos = index.findIndex((e: any) => e.id === id);
                if (pos >= 0) {
                    index[pos] = record;
                } else {
                    index.push(record);
                }
                await writeCustomSectionsIndex(index);
                sendJson(res, 200, { ok: true, index });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // PATCH /__custom-sections/:id
        if (req.method === 'PATCH' && url.startsWith('/__custom-sections/')) {
            try {
                const id = sanitizeCustomSectionId(url.slice('/__custom-sections/'.length));
                const body = await readJsonBody(req);

                const resultIndex = await withCsIndexLock(async () => {
                    const filePath = resolve(CUSTOM_SECTIONS_DIR, `${id}.json`);
                    const raw = await readFile(filePath, 'utf8');
                    const record = JSON.parse(raw);

                    if (body?.title && String(body.title).trim()) {
                        record.title = String(body.title).trim();
                    }
                    if (Array.isArray(body?.tags)) {
                        record.tags = body.tags;
                    }
                    if (Array.isArray(body?.negativeTags)) {
                        record.negativeTags = body.negativeTags;
                    }

                    await writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');

                    const index = await readCustomSectionsIndex();
                    const entry = index.find((e: any) => e.id === id);
                    if (entry) {
                        if (record.title) entry.title = record.title;
                        if (record.tags) entry.tags = record.tags;
                        if (record.negativeTags) entry.negativeTags = record.negativeTags;
                    }
                    await writeCustomSectionsIndex(index);
                    return index;
                });
                sendJson(res, 200, { ok: true, index: resultIndex });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // DELETE /__custom-sections/:id
        if (req.method === 'DELETE' && url.startsWith('/__custom-sections/')) {
            try {
                const id = sanitizeCustomSectionId(url.slice('/__custom-sections/'.length));
                await rm(resolve(CUSTOM_SECTIONS_DIR, `${id}.json`), { force: true });
                const index = (await readCustomSectionsIndex()).filter((e: any) => e.id !== id);
                await writeCustomSectionsIndex(index);
                sendJson(res, 200, { ok: true, index });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        next();
    };

    return {
        name: 'cortex-custom-sections',
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
        configurePreviewServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
    };
}

// ── Preset Storage Plugin ────────────────────────────────────────────
// Persists pipeline model/provider presets as a single JSON file so
// they survive across sessions and browsers.

const PRESETS_PATH = resolve(GIT_ROOT, 'pipeline-presets.json');

async function readPresetsFile(): Promise<any[]> {
    try {
        const raw = await readFile(PRESETS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writePresetsFile(presets: any[]): Promise<void> {
    await writeFile(PRESETS_PATH, JSON.stringify(presets, null, 2), 'utf8');
}

function presetStoragePlugin() {
    const handleRequest = async (req: any, res: any, next: () => void) => {
        const url = String(req.url || '').split('?')[0];
        if (!url.startsWith('/__presets')) return next();

        // GET /__presets — read all presets
        if (req.method === 'GET' && url === '/__presets') {
            try {
                sendJson(res, 200, await readPresetsFile());
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // PUT /__presets — overwrite all presets
        if (req.method === 'PUT' && url === '/__presets') {
            try {
                const body = await readJsonBody(req);
                const presets = Array.isArray(body) ? body : [];
                await writePresetsFile(presets);
                sendJson(res, 200, { ok: true });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        next();
    };

    return {
        name: 'cortex-preset-storage',
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
        configurePreviewServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
    };
}

// ── Section Order Plugin ────────────────────────────────────────────
// Persists stream section ordering as a single JSON file on disk.

const SECTION_ORDER_PATH = resolve(process.cwd(), 'section-order.json');

async function readSectionOrder(): Promise<string[]> {
    try {
        const raw = await readFile(SECTION_ORDER_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function sectionOrderPlugin() {
    const handleRequest = async (req: any, res: any, next: () => void) => {
        const url = String(req.url || '').split('?')[0];
        if (!url.startsWith('/__section-order')) return next();

        if (req.method === 'GET' && url === '/__section-order') {
            try {
                sendJson(res, 200, await readSectionOrder());
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        if (req.method === 'PUT' && url === '/__section-order') {
            try {
                const body = await readJsonBody(req);
                const order = Array.isArray(body) ? body : [];
                await writeFile(SECTION_ORDER_PATH, JSON.stringify(order, null, 2), 'utf8');
                sendJson(res, 200, { ok: true });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        next();
    };

    return {
        name: 'cortex-section-order',
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
        configurePreviewServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
    };
}

// ── A/B Test Plugin ──────────────────────────────────────────────────
// Dev-only endpoints for the self-destructing A/B testing overlay.
// POST /__ab/decide  →  writes a decision file (cleanup runs on next server start)
// GET  /__ab/status  →  lists all active A/B tests in source
// GET  /__ab/pending →  returns any pending decisions awaiting cleanup

const AB_DECISIONS_PATH = resolve(GIT_ROOT, '.ab-decisions.json');

function sanitizeAbArg(raw: unknown): string {
    return String(raw || '')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 80);
}

async function readAbDecisions(): Promise<Record<string, string>> {
    try {
        const raw = await readFile(AB_DECISIONS_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

async function writeAbDecisions(decisions: Record<string, string>): Promise<void> {
    if (Object.keys(decisions).length === 0) {
        await rm(AB_DECISIONS_PATH, { force: true });
    } else {
        await writeFile(AB_DECISIONS_PATH, JSON.stringify(decisions, null, 2), 'utf8');
    }
}

function runAbCleanup(testName: string, keepVariant: string): string {
    return execSync(`node scripts/ab-cleanup.mjs --test "${testName}" --keep "${keepVariant}"`, {
        encoding: 'utf8',
        cwd: process.cwd(),
    });
}

function abTestPlugin() {
    const handleRequest = async (req: any, res: any, next: () => void) => {
        const url = String(req.url || '').split('?')[0];
        if (!url.startsWith('/__ab')) return next();

        // POST /__ab/decide — record decision (deferred cleanup on next restart)
        if (req.method === 'POST' && url === '/__ab/decide') {
            try {
                const body = await readJsonBody(req);
                const testName = sanitizeAbArg(body?.testName);
                const selectedVariant = sanitizeAbArg(body?.selectedVariant);
                if (!testName || !selectedVariant) {
                    sendJson(res, 400, { ok: false, error: 'Missing testName or selectedVariant' });
                    return;
                }
                const decisions = await readAbDecisions();
                decisions[testName] = selectedVariant;
                await writeAbDecisions(decisions);
                sendJson(res, 200, { ok: true, deferred: true, testName, selectedVariant });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message || 'Failed to save decision' });
            }
            return;
        }

        // DELETE /__ab/decide — cancel a pending decision
        if (req.method === 'DELETE' && url === '/__ab/decide') {
            try {
                const body = await readJsonBody(req);
                const testName = sanitizeAbArg(body?.testName);
                if (!testName) {
                    sendJson(res, 400, { ok: false, error: 'Missing testName' });
                    return;
                }
                const decisions = await readAbDecisions();
                delete decisions[testName];
                await writeAbDecisions(decisions);
                sendJson(res, 200, { ok: true });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // GET /__ab/status — list all active A/B tests
        if (req.method === 'GET' && url === '/__ab/status') {
            try {
                const result = execSync('node scripts/ab-cleanup.mjs --list', { encoding: 'utf8', cwd: process.cwd() });
                sendJson(res, 200, JSON.parse(result));
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // GET /__ab/pending — return pending decisions
        if (req.method === 'GET' && url === '/__ab/pending') {
            try {
                sendJson(res, 200, { ok: true, decisions: await readAbDecisions() });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        // POST /__ab/flush — run all pending cleanups now (called on page load)
        if (req.method === 'POST' && url === '/__ab/flush') {
            try {
                const decisions = await readAbDecisions();
                const entries = Object.entries(decisions);
                if (entries.length === 0) {
                    sendJson(res, 200, { ok: true, cleaned: [] });
                    return;
                }
                const cleaned: string[] = [];
                for (const [testName, keepVariant] of entries) {
                    try {
                        const result = JSON.parse(runAbCleanup(testName, keepVariant));
                        if (result.ok) {
                            cleaned.push(testName);
                            // eslint-disable-next-line no-console
                            console.log(
                                `  [ab-test] ✓ ${testName} → kept ${keepVariant} (${result.filesModified?.length ?? 0} files)`,
                            );
                        }
                    } catch (err: any) {
                        // eslint-disable-next-line no-console
                        console.error(`  [ab-test] ✗ ${testName}: ${err?.message}`);
                    }
                }
                for (const name of cleaned) delete decisions[name];
                await writeAbDecisions(decisions);
                sendJson(res, 200, { ok: true, cleaned });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message });
            }
            return;
        }

        next();
    };

    // Shared cleanup runner — used by transformIndexHtml
    let _flushedThisServe = false;

    function flushPendingDecisions() {
        if (_flushedThisServe) return;
        _flushedThisServe = true;
        // Reset after a short window so the next refresh can flush again
        setTimeout(() => {
            _flushedThisServe = false;
        }, 5000);

        let decisions: Record<string, string>;
        try {
            const raw = readFileSync(AB_DECISIONS_PATH, 'utf8');
            decisions = JSON.parse(raw);
        } catch {
            return; // no pending decisions
        }

        const entries = Object.entries(decisions);
        if (entries.length === 0) return;

        // eslint-disable-next-line no-console
        console.log(`\n  [ab-test] Found ${entries.length} pending decision(s), cleaning up…`);
        const resolved: string[] = [];
        for (const [testName, keepVariant] of entries) {
            try {
                const result = JSON.parse(runAbCleanup(testName, keepVariant));
                if (result.ok) {
                    resolved.push(testName);
                    if (result.filesModified?.length === 0) {
                        // eslint-disable-next-line no-console
                        console.warn(
                            `  [ab-test] ⚠ ${testName}: cleanup succeeded but modified 0 files — check markers`,
                        );
                    }
                    // eslint-disable-next-line no-console
                    console.log(
                        `  [ab-test] ✓ ${testName} → kept ${keepVariant} (${result.filesModified?.length ?? 0} files)`,
                    );
                }
            } catch (err: any) {
                // eslint-disable-next-line no-console
                console.error(`  [ab-test] ✗ ${testName}: ${err?.message}`);
            }
        }
        for (const name of resolved) delete decisions[name];
        if (Object.keys(decisions).length === 0) {
            try {
                rmSync(AB_DECISIONS_PATH, { force: true });
            } catch {
                /* ignore */
            }
        } else {
            writeFileSync(AB_DECISIONS_PATH, JSON.stringify(decisions, null, 2), 'utf8');
        }
        if (resolved.length > 0) {
            // eslint-disable-next-line no-console
            console.log('  [ab-test] Done.\n');
        }
    }

    return {
        name: 'cortex-ab-test',
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
        // Runs synchronously before HTML is sent to browser on each page load.
        // Cleanup happens here so file changes are visible before JS loads —
        // no HMR cascade, no multiple reloads.
        transformIndexHtml() {
            flushPendingDecisions();
        },
    };
}

// ── LLM Log Plugin ─────────────────────────────────────────────────
// Persists LLM call logs to disk so Claude Code can read and triage
// failures without manual export.  Writes:
//   .cortex-logs/llm-log.json   — full log snapshot (overwritten)
//   .cortex-logs/failures.jsonl — append-only failure audit trail

const LOGS_DIR = resolve(GIT_ROOT, '.cortex-logs');

async function readExistingFailureCids(filePath: string): Promise<Set<string>> {
    const cids = new Set<string>();
    try {
        const text = await readFile(filePath, 'utf-8');
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                cids.add(`${entry.cid}:${entry.seq}`);
            } catch {
                /* skip malformed lines */
            }
        }
    } catch {
        /* file doesn't exist yet */
    }
    return cids;
}

function llmLogPlugin() {
    const handleRequest = async (req: any, res: any, next: () => void) => {
        const url = String(req.url || '').split('?')[0];

        if (req.method === 'POST' && url === '/__llm-log/write') {
            try {
                await mkdir(LOGS_DIR, { recursive: true });
                const body = await readJsonBody(req);

                // Write full log snapshot
                await writeFile(resolve(LOGS_DIR, 'llm-log.json'), JSON.stringify(body, null, 2));

                // Append new failures to audit trail
                const entries: any[] = body?.entries || [];
                const failures = entries.filter((e: any) => !e.ok);
                if (failures.length > 0) {
                    const existing = await readExistingFailureCids(resolve(LOGS_DIR, 'failures.jsonl'));
                    const fresh = failures.filter((f: any) => !existing.has(`${f.cid}:${f.seq}`));
                    if (fresh.length > 0) {
                        const lines = fresh.map((f: any) => JSON.stringify(f)).join('\n') + '\n';
                        await appendFile(resolve(LOGS_DIR, 'failures.jsonl'), lines);
                    }
                }

                sendJson(res, 200, { ok: true });
            } catch (err: any) {
                sendJson(res, 500, { ok: false, error: err?.message || 'Failed to write LLM log.' });
            }
            return;
        }

        next();
    };

    return {
        name: 'cortex-llm-log',
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
        configurePreviewServer(server: any) {
            server.middlewares.use((req: any, res: any, next: () => void) => {
                void handleRequest(req, res, next);
            });
        },
    };
}

// ── Cam Tracker Plugin ──────────────────────────────────────────────
// Auto-launches the Cam Tracker Python backend alongside the Vite dev
// server so `npm run dev` is all that's needed for camera tracking.

const TRACKER_DIR = resolve('/Users/perry/Documents/GitHub/Cam_tracker/backend');
const TRACKER_PYTHON = resolve(TRACKER_DIR, 'venv', 'bin', 'python3');
const TRACKER_PORT = 8000;

function isPortInUse(port: number): Promise<boolean> {
    return new Promise(ok => {
        const srv = net.createServer();
        srv.once('error', () => ok(true));
        srv.once('listening', () => srv.close(() => ok(false)));
        srv.listen(port, '127.0.0.1');
    });
}

function camTrackerPlugin() {
    let trackerProcess: ChildProcess | null = null;

    function killTracker() {
        const proc = trackerProcess;
        if (!proc || proc.exitCode !== null) return;
        trackerProcess = null;
        // eslint-disable-next-line no-console
        console.log('  [cam-tracker] Shutting down tracker backend…');
        try {
            proc.kill('SIGTERM');
        } catch {
            /* already dead */
        }
        setTimeout(() => {
            try {
                if (proc.exitCode === null) proc.kill('SIGKILL');
            } catch {
                /* already dead */
            }
        }, 3000);
    }

    async function launchTracker() {
        if (!existsSync(TRACKER_DIR)) {
            // eslint-disable-next-line no-console
            console.warn(`  [cam-tracker] Backend directory not found at ${TRACKER_DIR}, skipping.`);
            return;
        }
        if (!existsSync(TRACKER_PYTHON)) {
            // eslint-disable-next-line no-console
            console.warn(
                `  [cam-tracker] Python venv not found. Run:\n` +
                    `    cd ${TRACKER_DIR} && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`,
            );
            return;
        }
        if (await isPortInUse(TRACKER_PORT)) {
            // eslint-disable-next-line no-console
            console.log(`  [cam-tracker] Port ${TRACKER_PORT} already in use — assuming tracker is already running.`);
            return;
        }

        trackerProcess = spawn(TRACKER_PYTHON, ['run.py'], {
            cwd: TRACKER_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // eslint-disable-next-line no-console
        console.log(`  [cam-tracker] Starting tracker backend on port ${TRACKER_PORT} (PID: ${trackerProcess.pid})`);

        // Attach stream readers with error handlers so a broken pipe
        // (e.g. tracker crash / restart) doesn't kill the Vite process.
        const prefixLine = (stream: NodeJS.ReadableStream | null, isErr: boolean) => {
            if (!stream) return;
            stream.on('error', () => {
                /* swallow broken-pipe errors */
            });
            const rl = createInterface({ input: stream });
            rl.on('line', line => {
                // eslint-disable-next-line no-console
                (isErr ? console.error : console.log)(`  [cam-tracker] ${line}`);
            });
            rl.on('error', () => {
                /* swallow readline errors */
            });
        };
        prefixLine(trackerProcess.stdout, false);
        prefixLine(trackerProcess.stderr, true);

        trackerProcess.on('error', err => {
            // eslint-disable-next-line no-console
            console.error(`  [cam-tracker] Failed to start: ${err.message}`);
            trackerProcess = null;
        });
        trackerProcess.on('exit', (code, signal) => {
            // eslint-disable-next-line no-console
            console.log(`  [cam-tracker] Exited (code=${code}, signal=${signal})`);
            trackerProcess = null;
        });
    }

    return {
        name: 'cortex-cam-tracker',
        configureServer(server: any) {
            void launchTracker();
            server.httpServer?.on('close', killTracker);
            // Use 'once' so we don't interfere with Vite's own signal handling.
            // Call killTracker but let the default/Vite handler proceed afterward.
            const graceful = () => {
                killTracker();
            };
            process.once('SIGINT', graceful);
            process.once('SIGTERM', graceful);
        },
    };
}

export default defineConfig({
    root: '.',
    plugins: [
        debugBundlePlugin(),
        cycleStoragePlugin(),
        customSectionsPlugin(),
        sectionOrderPlugin(),
        presetStoragePlugin(),
        abTestPlugin(),
        llmLogPlugin(),
        camTrackerPlugin(),
    ],
    server: {
        watch: {
            ignored: [
                '**/.cortex-debug/**',
                '**/saved-cycles/**',
                '**/custom-sections/**',
                '**/pipeline-presets.json',
                '**/section-order.json',
                '**/.cortex-logs/**',
            ],
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0'),
        __GIT_HASH__: JSON.stringify(getGitHash()),
        __GIT_BRANCH__: JSON.stringify(getGitBranch()),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
