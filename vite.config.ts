import { execSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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

const EXPORT_ROOT_DIR_NAME = '.cortex-debug';
const EXPORT_ROOT_PATH = resolve(process.cwd(), EXPORT_ROOT_DIR_NAME);

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
  const shouldResetRoot = existingEntries.some((entry) => entry !== folderName);
  if (shouldResetRoot) {
    await clearDebugBundleRoot();
  }

  const runDir = resolve(EXPORT_ROOT_PATH, folderName);
  await mkdir(runDir, { recursive: true });

  for (const file of files) {
    const targetPath = resolveSafeChildPath(runDir, file?.relativePath);
    const content = typeof file?.content === 'string'
      ? file.content
      : JSON.stringify(file?.content ?? null, null, 2);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, 'utf8');
  }

  return runDir;
}

async function clearDebugBundleRoot() {
  await mkdir(EXPORT_ROOT_PATH, { recursive: true });
  const entries = await readdir(EXPORT_ROOT_PATH);
  await Promise.all(entries.map((entry) => rm(resolve(EXPORT_ROOT_PATH, entry), { recursive: true, force: true })));
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

const CYCLES_DIR = resolve(process.cwd(), 'saved-cycles');
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

export default defineConfig({
  root: '.',
  plugins: [debugBundlePlugin(), cycleStoragePlugin()],
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
