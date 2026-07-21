import bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ValidationError } from '../types/errors.js';

/**
 * Password hashing, policy, and temporary-password generation (plan D3, D10).
 *
 * Nothing here logs, and nothing here returns a password or a hash in an error
 * message.
 */

const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Unambiguous alphabet: no 0/O, 1/l/I. These get read aloud over the phone and
 * typed by hand from a text message, so shapes that look alike are removed.
 */
const TEMP_PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEMP_PASSWORD_LENGTH = 20;

/**
 * A cost-12 bcrypt hash of 32 random bytes that were never recorded, compared
 * against when an unknown email is submitted so that login costs the same
 * whether or not the account exists (plan D12). Without it, a fast "no such
 * user" reply distinguishes real accounts from imaginary ones by timing alone.
 *
 * The cost must match BCRYPT_COST — a cheaper dummy hash would reintroduce the
 * very timing difference it exists to remove.
 */
const DUMMY_HASH = '$2b$12$zZK93oE47mDIhehfDoWn1edbm2zB9BApTHm3TFBqSzNqTNidWmfci';

let commonPasswords: Set<string> | undefined;

function loadCommonPasswords(): Set<string> {
  if (commonPasswords === undefined) {
    const raw = readFileSync(new URL('../data/common-passwords.txt', import.meta.url), 'utf8');
    commonPasswords = new Set(
      raw
        .split('\n')
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line !== '' && !line.startsWith('#')),
    );
  }
  return commonPasswords;
}

/**
 * Loads the common-password list at boot.
 *
 * Called from the server's startup sequence so that a build which failed to
 * copy the list into dist/ crashes immediately and visibly, rather than
 * lazily — on the first family member who tries to change their password.
 */
export function warmPasswordPolicy(): number {
  return loadCommonPasswords().size;
}

/**
 * Enforces the password policy: length only, plus a common-password check.
 *
 * No composition requirements by design — forcing symbols and mixed case on a
 * family of varying technical comfort produces `Password1!` on a sticky note,
 * which is worse than a long simple passphrase.
 */
export function assertPasswordAllowed(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Your password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Your password must be ${String(MAX_PASSWORD_LENGTH)} characters or fewer.`,
    );
  }
  if (loadCommonPasswords().has(password.trim().toLowerCase())) {
    throw new ValidationError('That password is too common. Please choose a different one.');
  }
}

/**
 * bcrypt considers only the first 72 bytes of a password. Longer passphrases
 * are accepted and work correctly; the bytes past 72 simply do not contribute.
 * This is inherent to bcrypt and is not worth working around at this scale.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Burns the same time a real comparison would, for unknown accounts. */
export async function verifyDummyPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_HASH);
}

export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    // randomInt is uniform over the range — no modulo bias.
    password += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}
