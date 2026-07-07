import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export function normalizeUsername(input: string): string {
  const username = input.trim().toLowerCase();
  if (username.length < 3 || username.length > 24) {
    throw new Error('Username must be 3-24 characters.');
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    throw new Error('Username may contain only letters, numbers, underscore.');
  }
  return username;
}

export function validatePassword(input: string): string {
  if (input.length < 8 || input.length > 128) {
    throw new Error('Password must be 8-128 characters.');
  }
  return input;
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16).toString('base64url');
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, encoded] = parts;
  const expected = Buffer.from(encoded, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return timingSafeEqual(actual, expected);
}
