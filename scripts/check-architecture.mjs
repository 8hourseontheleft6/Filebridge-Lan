#!/usr/bin/env node
/**
 * Architecture boundary check for the Filebridge-Lan frontend.
 *
 * The refactor moves transport and business logic out of UI components:
 *
 *   components -> feature hooks/controllers -> feature services
 *     -> api clients -> platform adapters -> Node/Rust Hub
 *
 * Until every file is migrated this script keeps an explicit allowlist of
 * "legacy exceptions". The list must only shrink: a file that no longer
 * violates a rule should be removed from the allowlist so the boundary keeps
 * tightening across refactor stages.
 *
 * Usage:
 *   node scripts/check-architecture.mjs            # fail on violations
 *   node scripts/check-architecture.mjs --suggest  # print a fresh allowlist
 *   node scripts/check-architecture.mjs --list     # print the allowlist
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * Legacy exceptions: file -> rules that are temporarily tolerated.
 * Remove entries in the same commit that migrates the file.
 */
const ALLOWLIST = {
  'src/App.tsx': ['tauri-invoke', 'tauri-core-import'],
  'src/lib/hub.ts': ['http-fetch', 'api-base'],
  'src/components/SettingsPanel.tsx': ['tauri-invoke', 'tauri-core-import'],
  'src/http/ClipboardPanel.tsx': ['tauri-invoke', 'tauri-core-import', 'http-fetch', 'api-base'],
  'src/http/ConnectApproval.tsx': ['api-base'],
  'src/http/ConnectPanel.tsx': ['api-base'],
  'src/http/HostApprovalGate.tsx': ['api-base'],
  'src/http/HttpTransfer.tsx': [
    'tauri-invoke',
    'tauri-core-import',
    'tauri-event-import',
    'http-fetch',
    'api-base',
    'event-source',
  ],
  'src/http/NearbyComputers.tsx': ['tauri-invoke', 'tauri-core-import'],
  'src/http/connect.ts': ['http-fetch', 'api-base'],
};

const RULES = [
  {
    id: 'tauri-invoke',
    description: 'Tauri invoke() is only allowed in src/platform/tauri.ts',
    matches: (line) => /\binvoke\s*(?:<[^>]*>)?\s*\(/.test(line),
    allowedFiles: ['src/platform/tauri.ts'],
    allowedPrefixes: [],
  },
  {
    id: 'tauri-core-import',
    description: 'importing @tauri-apps/api/core is only allowed in src/platform/tauri.ts',
    matches: (line) => /from\s+['"]@tauri-apps\/api\/core['"]/.test(line),
    allowedFiles: ['src/platform/tauri.ts'],
    allowedPrefixes: [],
  },
  {
    id: 'tauri-event-import',
    description: 'importing @tauri-apps/api/event is only allowed in src/platform/tauriEvents.ts',
    matches: (line) => /from\s+['"]@tauri-apps\/api\/event['"]/.test(line),
    allowedFiles: ['src/platform/tauriEvents.ts'],
    allowedPrefixes: [],
  },
  {
    id: 'http-fetch',
    description:
      'fetch() is only allowed in src/api/**, src/features/** and the relay HTTP exit (src/relay/api.ts)',
    matches: (line) => /\bfetch\s*\(/.test(line),
    allowedFiles: ['src/relay/api.ts'],
    allowedPrefixes: ['src/api/', 'src/features/'],
  },
  {
    id: 'api-base',
    description: 'API_BASE is only allowed in src/platform/runtime.ts and src/api/**',
    matches: (line) => /\bAPI_BASE\b/.test(line),
    allowedFiles: ['src/platform/runtime.ts'],
    allowedPrefixes: ['src/api/'],
  },
  {
    id: 'event-source',
    description: 'EventSource is only allowed in src/features/**/events transport modules',
    matches: (line) => /\bnew\s+EventSource\s*\(/.test(line),
    allowedFiles: [],
    allowedPrefixes: ['src/features/'],
  },
];

/** One-way dependency rules for files that already live in the target structure. */
const LAYER_RULES = [
  {
    id: 'api-layer-imports',
    description:
      'src/api/** must not import react, features, components, http or App (one-way dependency)',
    files: (file) => file.startsWith('src/api/'),
    forbidden: /from\s+['"](?:react|\.\.\/features\/|\.\.\/components\/|\.\.\/http\/|\.\.\/App)/,
  },
  {
    id: 'platform-layer-imports',
    description: 'src/platform/** must not import react, features or components',
    files: (file) => file.startsWith('src/platform/'),
    forbidden: /from\s+['"](?:react|\.\.\/features\/|\.\.\/components\/)/,
  },
  {
    id: 'service-layer-imports',
    description: 'feature services/api/types modules must not import react or components',
    files: (file) =>
      /^src\/features\/.*\/(?:[a-zA-Z]+Service|[a-zA-Z]+Api|types)\.ts$/.test(file),
    forbidden: /from\s+['"](?:react|\.\.\/\.\.\/components\/)/,
  },
];

function readFile(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function listSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function toRelative(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function isAllowed(rule, file) {
  if (rule.allowedFiles.includes(file)) return true;
  if (rule.allowedPrefixes.some((prefix) => file.startsWith(prefix))) return true;
  const tolerated = ALLOWLIST[file] || [];
  return tolerated.includes(rule.id);
}

function collectViolations() {
  const violations = [];
  const files = listSourceFiles(SRC).map(toRelative).sort();
  for (const file of files) {
    const contents = readFile(file);
    const lines = contents.split(/\r?\n/);
    for (const rule of RULES) {
      for (let index = 0; index < lines.length; index += 1) {
        if (!rule.matches(lines[index])) continue;
        if (isAllowed(rule, file)) continue;
        violations.push({ file, line: index + 1, rule: rule.id, description: rule.description });
      }
    }
    for (const rule of LAYER_RULES) {
      if (!rule.files(file)) continue;
      if (!rule.forbidden.test(contents)) continue;
      violations.push({ file, line: 0, rule: rule.id, description: rule.description });
    }
  }
  return violations;
}

function suggestAllowlist() {
  const byFile = {};
  for (const violation of collectViolations()) {
    if (!byFile[violation.file]) byFile[violation.file] = [];
    if (!byFile[violation.file].includes(violation.rule)) {
      byFile[violation.file].push(violation.rule);
    }
  }
  return byFile;
}

const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log(JSON.stringify(ALLOWLIST, null, 2));
  process.exit(0);
}

if (args.includes('--suggest')) {
  console.log(JSON.stringify(suggestAllowlist(), null, 2));
  process.exit(0);
}

const violations = collectViolations();
const files = listSourceFiles(SRC).map(toRelative);
const staleAllowlist = Object.entries(ALLOWLIST)
  .filter(([file]) => !files.includes(file))
  .map(([file]) => file);

if (violations.length === 0) {
  console.log(
    `ARCHITECTURE_OK files=${files.length} allowlist=${Object.keys(ALLOWLIST).length}`,
  );
  if (staleAllowlist.length > 0) {
    console.log('note: allowlist entries for missing files: ' + staleAllowlist.join(', '));
  }
  process.exit(0);
}

console.error(`ARCHITECTURE_VIOLATIONS count=${violations.length}`);
for (const violation of violations) {
  const location = violation.line > 0 ? `${violation.file}:${violation.line}` : violation.file;
  console.error(`  ${location}  [${violation.rule}]  ${violation.description}`);
}
console.error('');
console.error('If a file is intentionally legacy, add its rule ids to ALLOWLIST in this script.');
console.error('Migration must remove entries from the allowlist, not add new ones silently.');
process.exit(1);
