// tsc emits only JavaScript, so the .sql migration files have to be copied
// into dist/ for `npm start` to find them at runtime.
import { cp } from 'node:fs/promises';

await cp(
  new URL('../src/db/migrations/', import.meta.url),
  new URL('../dist/db/migrations/', import.meta.url),
  { recursive: true },
);
