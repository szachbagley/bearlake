// tsc emits only JavaScript, so non-TypeScript files the runtime reads have to
// be copied into dist/ explicitly. Anything added under a directory listed here
// ships with the build; anything else silently will not exist in production.
import { cp } from 'node:fs/promises';

const ASSET_DIRECTORIES = ['db/migrations', 'data'];

for (const directory of ASSET_DIRECTORIES) {
  await cp(
    new URL(`../src/${directory}/`, import.meta.url),
    new URL(`../dist/${directory}/`, import.meta.url),
    { recursive: true },
  );
}
