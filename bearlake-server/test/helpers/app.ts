import type { Express } from 'express';
import { createApp } from '../../src/app.js';

let app: Express | undefined;

/** The app under test, built once per test process. */
export function testApp(): Express {
  app ??= createApp();
  return app;
}
