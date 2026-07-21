import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * Guards a bug class that has bitten twice: a non-TypeScript file that the
 * runtime reads at runtime, which `tsc` does not emit and which therefore does
 * not exist in the deployed build.
 *
 * The suite itself runs from src/ through tsx, so it cannot catch this on its
 * own — migrations went missing once, and the common-password list broke every
 * password change in the built artifact while every test still passed.
 */

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, resolve(entry.parentPath, entry.name)));
}

describe('build assets', () => {
  it('copies every non-TypeScript source file into dist', async () => {
    // Fast: this is the copy step alone, without tsc.
    await run('node', ['scripts/copy-assets.mjs']);

    const sourceAssets = (await filesUnder('src')).filter((file) => !file.endsWith('.ts'));
    const distFiles = new Set(await filesUnder('dist'));

    // Fails when someone adds a data file the build does not know to copy.
    expect(sourceAssets.length).toBeGreaterThan(0);
    for (const asset of sourceAssets) {
      expect(distFiles.has(asset), `${asset} is missing from dist/`).toBe(true);
    }
  }, 30_000);
});
