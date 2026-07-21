import { describe, expect, it } from 'vitest';
import {
  assertPasswordAllowed,
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from '../../src/services/passwordService.js';
import { ValidationError } from '../../src/types/errors.js';

describe('password policy', () => {
  it('accepts a long passphrase with no special characters', () => {
    // No composition rules by design: length is what matters, and a rule that
    // produces "Password1!" on a sticky note is a net loss.
    expect(() => {
      assertPasswordAllowed('the red canoe is behind the shed');
    }).not.toThrow();
  });

  it('rejects anything shorter than twelve characters', () => {
    expect(() => {
      assertPasswordAllowed('elevenchars');
    }).toThrow(ValidationError);
    expect(() => {
      assertPasswordAllowed('twelvechars1');
    }).not.toThrow();
  });

  it('rejects a password longer than the maximum', () => {
    expect(() => {
      assertPasswordAllowed('a'.repeat(129));
    }).toThrow(/128 characters or fewer/);
  });

  it('rejects common passwords case-insensitively and ignoring whitespace', () => {
    for (const candidate of [
      'passwordpassword',
      'PasswordPassword',
      '  correcthorsebatterystaple  ',
      'QwErTyUiOp123',
    ]) {
      expect(() => {
        assertPasswordAllowed(candidate);
      }, candidate).toThrow(ValidationError);
    }
  });

  it('does not reveal the policy internals in the error message', () => {
    try {
      assertPasswordAllowed('passwordpassword');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ValidationError).message).not.toContain('passwordpassword');
    }
  });
});

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('the red canoe is behind the shed');

    expect(await verifyPassword('the red canoe is behind the shed', hash)).toBe(true);
    expect(await verifyPassword('the blue canoe is behind the shed', hash)).toBe(false);
  }, 20_000);

  it('produces a salted bcrypt hash at the configured cost', async () => {
    const first = await hashPassword('the red canoe is behind the shed');
    const second = await hashPassword('the red canoe is behind the shed');

    expect(first).toMatch(/^\$2b\$12\$/);
    // Distinct salts: identical passwords must not produce identical hashes.
    expect(first).not.toBe(second);
  }, 20_000);
});

describe('temporary passwords', () => {
  it('is long and avoids characters that get misread', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(20);
      expect(password).not.toMatch(/[0O1lI]/);
      expect(password).toMatch(/^[A-Za-z2-9]+$/);
    }
  });

  it('always satisfies the password policy it will be checked against', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(() => {
        assertPasswordAllowed(generateTemporaryPassword());
      }).not.toThrow();
    }
  });

  it('does not repeat', () => {
    const generated = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
    expect(generated.size).toBe(200);
  });
});
