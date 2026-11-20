/**
 * Node test loader hook: resolve extensionless relative imports to .ts files.
 *
 * The frontend is bundled by Vite/tsc, so its source imports omit extensions
 * (`import { x } from './service'`). Node's ESM resolver needs a full specifier
 * when a test imports those modules directly. This hook only rewrites relative
 * specifiers that have no extension; everything else goes to the default
 * resolver.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/node-ts-resolve.mjs --test <files>
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];

function hasExtension(specifier) {
  const last = specifier.split('/').pop() || '';
  return last.includes('.');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.') || hasExtension(specifier) || !context.parentURL) {
      return nextResolve(specifier, context);
    }
    const base = new URL(specifier, context.parentURL);
    for (const extension of CANDIDATE_EXTENSIONS) {
      const candidate = pathToFileURL(fileURLToPath(base) + extension);
      if (fs.existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    const asDirectoryIndex = pathToFileURL(path.join(fileURLToPath(base), 'index.ts'));
    if (fs.existsSync(fileURLToPath(asDirectoryIndex))) {
      return nextResolve(asDirectoryIndex.href, context);
    }
    return nextResolve(specifier, context);
  },
});
