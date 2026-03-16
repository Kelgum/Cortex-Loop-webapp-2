import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');
const rootEntry = path.join(srcRoot, 'main.ts');

function walk(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
            continue;
        }
        if (entry.isFile() && fullPath.endsWith('.ts')) {
            files.push(fullPath);
        }
    }
    return files.sort();
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

function extractRuntimeSpecifiers(source) {
    const specifiers = new Set();
    const fromRegex = /(?:^|\n)\s*(import|export)\s+(?!type\b)(?:[\s\S]*?)from\s+['"](.+?)['"]/g;
    const sideEffectRegex = /(?:^|\n)\s*import\s+['"](.+?)['"]/g;
    const dynamicRegex = /import\(\s*['"](.+?)['"]\s*\)/g;

    let match;
    while ((match = fromRegex.exec(source)) !== null) {
        specifiers.add(match[2]);
    }
    while ((match = sideEffectRegex.exec(source)) !== null) {
        specifiers.add(match[1]);
    }
    while ((match = dynamicRegex.exec(source)) !== null) {
        specifiers.add(match[1]);
    }
    return [...specifiers];
}

function extractAllSpecifiers(source) {
    const specifiers = new Set(extractRuntimeSpecifiers(source));
    const typeFromRegex = /(?:^|\n)\s*(?:import|export)\s+type\s+(?:[\s\S]*?)from\s+['"](.+?)['"]/g;

    let match;
    while ((match = typeFromRegex.exec(source)) !== null) {
        specifiers.add(match[1]);
    }

    return [...specifiers];
}

function resolveLocalImport(fromFile, specifier) {
    if (!specifier.startsWith('.')) return null;

    const resolvedBase = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
        resolvedBase,
        `${resolvedBase}.ts`,
        path.join(resolvedBase, 'index.ts'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

function canonicalizeCycle(cycle) {
    const nodes = cycle.slice(0, -1);
    const variants = [];

    const pushVariants = (list) => {
        for (let i = 0; i < list.length; i += 1) {
            const rotated = list.slice(i).concat(list.slice(0, i));
            variants.push(rotated);
        }
    };

    pushVariants(nodes);
    pushVariants([...nodes].reverse());

    variants.sort((a, b) => a.join('>').localeCompare(b.join('>')));
    const best = variants[0];
    return best.concat(best[0]);
}

function collectCycles(graph) {
    const visiting = new Set();
    const visited = new Set();
    const stack = [];
    const cycles = new Map();

    function dfs(file) {
        visiting.add(file);
        stack.push(file);

        for (const dep of graph.get(file) || []) {
            if (!graph.has(dep)) continue;
            if (visiting.has(dep)) {
                const startIdx = stack.indexOf(dep);
                const cycle = stack.slice(startIdx).concat(dep);
                const normalized = canonicalizeCycle(cycle);
                cycles.set(normalized.join(' -> '), normalized);
                continue;
            }
            if (!visited.has(dep)) {
                dfs(dep);
            }
        }

        stack.pop();
        visiting.delete(file);
        visited.add(file);
    }

    for (const file of graph.keys()) {
        if (!visited.has(file)) dfs(file);
    }

    return [...cycles.values()];
}

function collectReachable(graph, root) {
    const reachable = new Set();

    function visit(file) {
        if (reachable.has(file)) return;
        reachable.add(file);
        for (const dep of graph.get(file) || []) {
            if (graph.has(dep)) visit(dep);
        }
    }

    visit(root);
    return reachable;
}

if (!fs.existsSync(rootEntry)) {
    console.error(`Architecture check failed: missing root entry ${toRepoPath(rootEntry)}`);
    process.exit(1);
}

const sourceFiles = walk(srcRoot);
const runtimeGraph = new Map();
const reachabilityGraph = new Map();
const missingImports = [];
const directStorageAccess = [];

for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const strippedSource = stripComments(source);
    const runtimeSpecifiers = extractRuntimeSpecifiers(source);
    const runtimeSpecifierSet = new Set(runtimeSpecifiers);

    if (!file.endsWith('settings-store.ts') && /\b(?:localStorage|sessionStorage)\b/.test(strippedSource)) {
        directStorageAccess.push(toRepoPath(file));
    }

    const runtimeDeps = [];
    const allDeps = [];
    for (const specifier of extractAllSpecifiers(source)) {
        const resolved = resolveLocalImport(file, specifier);
        if (!specifier.startsWith('.')) continue;
        if (!resolved) {
            missingImports.push(`${toRepoPath(file)} -> ${specifier}`);
            continue;
        }
        allDeps.push(resolved);
        if (runtimeSpecifierSet.has(specifier)) {
            runtimeDeps.push(resolved);
        }
    }
    runtimeGraph.set(file, runtimeDeps);
    reachabilityGraph.set(file, allDeps);
}

const cycles = collectCycles(runtimeGraph).map((cycle) => cycle.map(toRepoPath));
const reachable = collectReachable(reachabilityGraph, rootEntry);
const unreachable = sourceFiles
    .filter((file) => !reachable.has(file))
    .map(toRepoPath);

const problems = [];

if (missingImports.length > 0) {
    problems.push({
        title: 'Missing relative imports',
        entries: missingImports,
    });
}

if (cycles.length > 0) {
    problems.push({
        title: 'Import cycles',
        entries: cycles.map((cycle) => cycle.join(' -> ')),
    });
}

if (unreachable.length > 0) {
    problems.push({
        title: 'Unreachable source files from src/main.ts',
        entries: unreachable,
    });
}

if (directStorageAccess.length > 0) {
    problems.push({
        title: 'Direct storage access outside src/settings-store.ts',
        entries: directStorageAccess,
    });
}

if (problems.length > 0) {
    console.error('Architecture check failed.\n');
    for (const problem of problems) {
        console.error(`${problem.title}:`);
        for (const entry of problem.entries) {
            console.error(`  - ${entry}`);
        }
        console.error('');
    }
    process.exit(1);
}

console.log(
    `Architecture check passed: ${sourceFiles.length} source files, `
    + `${cycles.length} cycles, ${unreachable.length} unreachable files.`,
);
