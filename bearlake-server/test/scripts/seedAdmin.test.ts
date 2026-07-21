import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../../src/db/pool.js';
import { resetRateLimits } from '../../src/middleware/rateLimit.js';
import { testApp } from '../helpers/app.js';
import { resetTables } from '../helpers/db.js';

const run = promisify(execFile);

/**
 * Exercises the real script through a real process, because what is being
 * verified is partly its command-line behavior and its output.
 */
async function seedAdmin(args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await run('npx', ['tsx', 'src/scripts/seedAdmin.ts', ...args], {
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { stdout, code: 0 };
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`, code: failure.code ?? 1 };
  }
}

function temporaryPasswordFrom(stdout: string): string {
  const match = /Temporary password:\s+(\S+)/.exec(stdout);
  if (match?.[1] === undefined) {
    throw new Error(`No temporary password in output:\n${stdout}`);
  }
  return match[1];
}

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
});

afterAll(async () => {
  await closePool();
});

describe('seed:admin', () => {
  it('creates a usable admin whose password must be changed', async () => {
    const { stdout, code } = await seedAdmin(['zach@example.com', 'Zach Bagley']);
    expect(code).toBe(0);

    const temporaryPassword = temporaryPasswordFrom(stdout);
    expect(temporaryPassword).toHaveLength(20);
    // Unambiguous alphabet: nothing that gets misread when typed from a text.
    expect(temporaryPassword).not.toMatch(/[0O1lI]/);

    const login = await request(testApp())
      .post('/api/v1/auth/login')
      .send({ email: 'zach@example.com', password: temporaryPassword });

    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({
      email: 'zach@example.com',
      displayName: 'Zach Bagley',
      role: 'admin',
      mustChangePassword: true,
    });
  }, 60_000);

  it('refuses to run once an admin exists', async () => {
    const first = await seedAdmin(['zach@example.com', 'Zach Bagley']);
    expect(first.code).toBe(0);

    const second = await seedAdmin(['intruder@example.com', 'Not Invited']);

    expect(second.code).toBe(1);
    expect(second.stdout).toContain('admin account already exists');
  }, 60_000);

  it('rejects a missing or malformed argument', async () => {
    const noArgs = await seedAdmin([]);
    expect(noArgs.code).toBe(1);
    expect(noArgs.stdout).toContain('Usage');

    const badEmail = await seedAdmin(['not-an-email', 'Someone']);
    expect(badEmail.code).toBe(1);
    expect(badEmail.stdout).toContain('valid email');
  }, 60_000);

  it('normalizes the email to lowercase', async () => {
    const { stdout } = await seedAdmin(['ZACH@Example.COM', 'Zach Bagley']);

    const login = await request(testApp())
      .post('/api/v1/auth/login')
      .send({ email: 'zach@example.com', password: temporaryPasswordFrom(stdout) });

    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('zach@example.com');
  }, 60_000);
});
