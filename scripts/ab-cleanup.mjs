/**
 * A/B Test Cleanup Script
 *
 * Parses @ab-test comment markers in source files, keeps the selected variant,
 * and removes all other variants + setup scaffolding.
 *
 * Usage:
 *   node scripts/ab-cleanup.mjs --list
 *   node scripts/ab-cleanup.mjs --test <testName> --keep <variant-id>
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();
const srcRoot = resolve(repoRoot, 'src');

// ── CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const isListMode = args.includes('--list');
const testName = getArg('--test');
const keepVariant = getArg('--keep');

if (!isListMode && (!testName || !keepVariant)) {
    console.error(JSON.stringify({
        ok: false,
        error: 'Usage: --list  OR  --test <name> --keep <variant-id>',
    }));
    process.exit(1);
}

// ── File collection ─────────────────────────────────────────────────────

function walk(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
        } else if (entry.isFile() && fullPath.endsWith('.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}

function collectFiles() {
    const files = walk(srcRoot);
    const stylesPath = resolve(repoRoot, 'styles.css');
    try {
        statSync(stylesPath);
        files.push(stylesPath);
    } catch {
        // styles.css may not exist
    }
    return files;
}

// ── Marker parsing ──────────────────────────────────────────────────────

// Support three marker formats:
//   /* @ab-test:...:start */   (CSS+TS — may be stripped by Prettier)
//   /*! @ab-test:...:start */  (CSS+TS — preserved by Prettier)
//   // @ab-test:...:start      (TS only — preserved by Prettier)
const MARKER_RE = /^\s*(?:\/\*!?\s*@ab-test:([a-z0-9-]+):([a-z0-9-]+):(start|end)\s*\*\/|\/\/\s*@ab-test:([a-z0-9-]+):([a-z0-9-]+):(start|end))\s*$/;

/**
 * Scan a file for @ab-test markers and return parsed blocks.
 * Each block: { testName, variantId, startLine, endLine }
 */
function parseMarkers(filePath) {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const blocks = [];
    const openStack = [];

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(MARKER_RE);
        if (!match) continue;

        // Groups 1-3 from /* */ format, groups 4-6 from // format
        const tName = match[1] || match[4];
        const variantId = match[2] || match[5];
        const startEnd = match[3] || match[6];

        if (startEnd === 'start') {
            openStack.push({ testName: tName, variantId, startLine: i });
        } else {
            if (openStack.length === 0) {
                console.error(JSON.stringify({
                    ok: false,
                    error: `Unmatched end marker at ${relative(repoRoot, filePath)}:${i + 1} for @ab-test:${tName}:${variantId}`,
                }));
                process.exit(1);
            }

            const open = openStack.pop();
            if (open.testName !== tName || open.variantId !== variantId) {
                console.error(JSON.stringify({
                    ok: false,
                    error: `Mismatched markers: opened @ab-test:${open.testName}:${open.variantId} at line ${open.startLine + 1}, closed @ab-test:${tName}:${variantId} at line ${i + 1} in ${relative(repoRoot, filePath)}`,
                }));
                process.exit(1);
            }

            blocks.push({
                testName: tName,
                variantId,
                startLine: open.startLine,
                endLine: i,
            });
        }
    }

    if (openStack.length > 0) {
        const open = openStack[0];
        console.error(JSON.stringify({
            ok: false,
            error: `Unclosed marker @ab-test:${open.testName}:${open.variantId} at ${relative(repoRoot, filePath)}:${open.startLine + 1}`,
        }));
        process.exit(1);
    }

    return blocks;
}

// ── Main ────────────────────────────────────────────────────────────────

const files = collectFiles();

// Build global map: testName → [{ file, variantId, startLine, endLine }]
const testMap = new Map();

for (const filePath of files) {
    const blocks = parseMarkers(filePath);
    for (const block of blocks) {
        if (!testMap.has(block.testName)) testMap.set(block.testName, []);
        testMap.get(block.testName).push({ ...block, file: filePath });
    }
}

// ── LIST mode ───────────────────────────────────────────────────────────

if (isListMode) {
    const tests = {};
    for (const [name, blocks] of testMap) {
        const variants = [...new Set(blocks.filter((b) => b.variantId !== 'setup').map((b) => b.variantId))];
        const fileCount = new Set(blocks.map((b) => b.file)).size;
        tests[name] = { variants, fileCount };
    }
    console.log(JSON.stringify({ ok: true, tests }));
    process.exit(0);
}

// ── DECIDE mode ─────────────────────────────────────────────────────────

if (!testMap.has(testName)) {
    console.error(JSON.stringify({
        ok: false,
        error: `No A/B test found with name "${testName}". Active tests: ${[...testMap.keys()].join(', ') || '(none)'}`,
    }));
    process.exit(1);
}

const testBlocks = testMap.get(testName);
const allVariants = [...new Set(testBlocks.filter((b) => b.variantId !== 'setup').map((b) => b.variantId))];

if (!allVariants.includes(keepVariant)) {
    console.error(JSON.stringify({
        ok: false,
        error: `Variant "${keepVariant}" not found in test "${testName}". Available: ${allVariants.join(', ')}`,
    }));
    process.exit(1);
}

// Group blocks by file
const blocksByFile = new Map();
for (const block of testBlocks) {
    if (!blocksByFile.has(block.file)) blocksByFile.set(block.file, []);
    blocksByFile.get(block.file).push(block);
}

const filesModified = [];

for (const [filePath, fileBlocks] of blocksByFile) {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Sort blocks by startLine descending so we can splice bottom-to-top
    const sorted = [...fileBlocks].sort((a, b) => b.startLine - a.startLine);

    for (const block of sorted) {
        if (block.variantId === 'setup') {
            // Remove setup block entirely (markers + content)
            lines.splice(block.startLine, block.endLine - block.startLine + 1);
        } else if (block.variantId === keepVariant) {
            // Keep content, remove only the marker lines
            lines.splice(block.endLine, 1);
            lines.splice(block.startLine, 1);
        } else {
            // Remove non-selected variant entirely (markers + content)
            lines.splice(block.startLine, block.endLine - block.startLine + 1);
        }
    }

    // Collapse runs of 3+ blank lines down to 2
    const collapsed = [];
    let blankRun = 0;
    for (const line of lines) {
        if (line.trim() === '') {
            blankRun++;
            if (blankRun <= 2) collapsed.push(line);
        } else {
            blankRun = 0;
            collapsed.push(line);
        }
    }

    const newContent = collapsed.join('\n');
    if (newContent !== content) {
        writeFileSync(filePath, newContent, 'utf8');
        filesModified.push(relative(repoRoot, filePath));
    }
}

// Run prettier on modified files (non-fatal)
if (filesModified.length > 0) {
    try {
        const fileArgs = filesModified.map((f) => `"${f}"`).join(' ');
        execSync(`npx prettier --write ${fileArgs}`, {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
        });
    } catch {
        // Prettier failure is non-fatal
    }
}

console.log(JSON.stringify({ ok: true, filesModified }));
