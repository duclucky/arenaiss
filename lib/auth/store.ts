import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword, normalizeUsername, validatePassword, verifyPassword } from './credentials';

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

interface UsersFile {
  users: StoredUser[];
}

export interface AuthResult {
  ok: boolean;
  user?: StoredUser;
  error?: 'INVALID_INPUT' | 'USERNAME_TAKEN' | 'INVALID_CREDENTIALS';
}

export interface AuthStore {
  createUser(username: string, password: string): Promise<AuthResult>;
  authenticateUser(username: string, password: string): Promise<AuthResult>;
  findUserById(userId: string): Promise<StoredUser | null>;
}

const DEFAULT_USERS_PATH = join(process.cwd(), 'data', 'users.json');

async function readUsers(path: string): Promise<UsersFile> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as UsersFile;
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch {
    return { users: [] };
  }
}

async function writeUsers(path: string, file: UsersFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2), 'utf8');
}

export function createAuthStore(path: string = DEFAULT_USERS_PATH): AuthStore {
  return {
    async createUser(usernameInput: string, passwordInput: string): Promise<AuthResult> {
      let username: string;
      try {
        username = normalizeUsername(usernameInput);
        validatePassword(passwordInput);
      } catch {
        return { ok: false, error: 'INVALID_INPUT' };
      }

      const file = await readUsers(path);
      if (file.users.some((u) => u.username === username)) {
        return { ok: false, error: 'USERNAME_TAKEN' };
      }
      const user: StoredUser = {
        id: `user_${randomUUID()}`,
        username,
        passwordHash: await hashPassword(passwordInput),
        createdAt: new Date().toISOString(),
      };
      file.users.push(user);
      await writeUsers(path, file);
      return { ok: true, user };
    },

    async authenticateUser(usernameInput: string, passwordInput: string): Promise<AuthResult> {
      let username: string;
      try {
        username = normalizeUsername(usernameInput);
      } catch {
        return { ok: false, error: 'INVALID_CREDENTIALS' };
      }

      const file = await readUsers(path);
      const user = file.users.find((u) => u.username === username);
      if (!user) return { ok: false, error: 'INVALID_CREDENTIALS' };
      const ok = await verifyPassword(passwordInput, user.passwordHash);
      return ok ? { ok: true, user } : { ok: false, error: 'INVALID_CREDENTIALS' };
    },

    async findUserById(userId: string): Promise<StoredUser | null> {
      const file = await readUsers(path);
      return file.users.find((u) => u.id === userId) ?? null;
    },
  };
}
