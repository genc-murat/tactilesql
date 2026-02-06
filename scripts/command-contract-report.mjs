#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const FRONTEND_ROOT = path.join(ROOT_DIR, 'src');
const BACKEND_LIB_PATH = path.join(ROOT_DIR, 'src-tauri', 'src', 'lib.rs');
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'src', 'generated', 'command-contract.json');

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has('--write');
const shouldCheck = args.has('--check');
const enforceZero = args.has('--enforce-zero');

const normalizeCommands = (commands) => Array.from(new Set((commands || []).map(c => String(c).trim()).filter(Boolean))).sort();

const collectFiles = (dir, files = []) => {
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectFiles(fullPath, files);
            continue;
        }
        files.push(fullPath);
    }
    return files;
};

const extractFrontendCommands = () => {
    const files = collectFiles(FRONTEND_ROOT).filter(file => file.endsWith('.js'));
    const commandSet = new Set();
    const invokeRegex = /(?:\binvoke|\bwindow\.__TAURI__\.core\.invoke)\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;

    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        let match;
        while ((match = invokeRegex.exec(content)) !== null) {
            commandSet.add(match[1]);
        }
    }

    return normalizeCommands(Array.from(commandSet));
};

const extractGenerateHandlerBody = (source) => {
    const marker = 'tauri::generate_handler![';
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error('Unable to find generate_handler block in lib.rs');
    }

    let index = markerIndex + marker.length;
    let depth = 1;
    let body = '';

    while (index < source.length && depth > 0) {
        const ch = source[index];
        if (ch === '[') {
            depth += 1;
            body += ch;
        } else if (ch === ']') {
            depth -= 1;
            if (depth > 0) {
                body += ch;
            }
        } else {
            body += ch;
        }
        index += 1;
    }

    if (depth !== 0) {
        throw new Error('Unbalanced generate_handler block in lib.rs');
    }

    return body;
};

const extractBackendCommands = () => {
    const source = fs.readFileSync(BACKEND_LIB_PATH, 'utf8');
    const body = extractGenerateHandlerBody(source)
        .replace(/\/\/.*$/gm, '');

    const commandSet = new Set();
    const commandRegex = /([a-zA-Z_][a-zA-Z0-9_:]*)\s*,/g;
    let match;
    while ((match = commandRegex.exec(body)) !== null) {
        const fullPath = match[1];
        const command = fullPath.split('::').pop();
        if (command) {
            commandSet.add(command);
        }
    }

    return normalizeCommands(Array.from(commandSet));
};

const buildReport = (frontendCommands, backendCommands) => {
    const frontend = normalizeCommands(frontendCommands);
    const backend = normalizeCommands(backendCommands);
    const backendSet = new Set(backend);
    const frontendSet = new Set(frontend);

    return {
        generatedAt: new Date().toISOString(),
        frontendCommands: frontend,
        backendCommands: backend,
        missingInBackend: frontend.filter(command => !backendSet.has(command)),
        unusedInFrontend: backend.filter(command => !frontendSet.has(command)),
    };
};

const ensureParentDir = (filePath) => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

const formatList = (list) => (list.length > 0 ? list.join(', ') : 'none');

const frontendCommands = extractFrontendCommands();
const backendCommands = extractBackendCommands();
const report = buildReport(frontendCommands, backendCommands);

if (shouldWrite) {
    ensureParentDir(SNAPSHOT_PATH);
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(`Frontend commands: ${report.frontendCommands.length}`);
console.log(`Backend commands: ${report.backendCommands.length}`);
console.log(`Missing in backend (${report.missingInBackend.length}): ${formatList(report.missingInBackend)}`);
console.log(`Unused in frontend (${report.unusedInFrontend.length}): ${formatList(report.unusedInFrontend)}`);
if (shouldWrite) {
    console.log(`Snapshot written: ${path.relative(ROOT_DIR, SNAPSHOT_PATH)}`);
}

if (shouldCheck) {
    let hasError = false;
    if (enforceZero) {
        if (report.missingInBackend.length > 0) {
            console.error(`Command contract check failed. Missing in backend: ${formatList(report.missingInBackend)}`);
            hasError = true;
        }
    } else if (fs.existsSync(SNAPSHOT_PATH)) {
        const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
        const baselineMissing = normalizeCommands(snapshot.missingInBackend || []);
        const currentMissing = normalizeCommands(report.missingInBackend || []);
        const baselineSet = new Set(baselineMissing);
        const newlyIntroduced = currentMissing.filter(command => !baselineSet.has(command));

        if (newlyIntroduced.length > 0) {
            console.error(`Command contract check failed. Newly introduced missing commands: ${formatList(newlyIntroduced)}`);
            hasError = true;
        }
    } else if (report.missingInBackend.length > 0) {
        console.error(`Command contract check failed. Missing in backend: ${formatList(report.missingInBackend)}`);
        hasError = true;
    }

    if (hasError) {
        process.exit(1);
    }
}
