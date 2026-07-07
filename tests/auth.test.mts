import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, verifyPassword, normalizeUsername } from '../lib/auth/credentials';
import { signSession, verifySession } from '../lib/auth/session';
import { createAuthStore } from '../lib/auth/store';

const password = 'correct horse battery staple';

{
  const stored = await hashPassword(password);
  assert.notEqual(stored, password);
  assert.equal(stored.includes(password), false);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
}

{
  assert.equal(normalizeUsername('  Alice_01  '), 'alice_01');
  assert.throws(() => normalizeUsername('ab'), /3-24/);
  assert.throws(() => normalizeUsername('bad name'), /letters, numbers, underscore/);
}

{
  const root = await mkdtemp(join(tmpdir(), 'renaiss-auth-test-'));
  try {
    const store = createAuthStore(join(root, 'users.json'));
    const created = await store.createUser('Alice_01', password);
    assert.equal(created.ok, true);
    assert.equal(created.user?.username, 'alice_01');
    assert.equal(created.user?.passwordHash.includes(password), false);

    const duplicate = await store.createUser(' alice_01 ', password);
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error, 'USERNAME_TAKEN');

    const login = await store.authenticateUser('ALICE_01', password);
    assert.equal(login.ok, true);
    assert.equal(login.user?.id, created.user?.id);

    const badLogin = await store.authenticateUser('alice_01', 'wrong password');
    assert.equal(badLogin.ok, false);
    assert.equal(badLogin.error, 'INVALID_CREDENTIALS');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const secret = 'test-secret-with-enough-length';
  const now = new Date('2026-07-07T12:00:00.000Z');
  const token = signSession({ userId: 'user_123', username: 'alice_01' }, secret, now);
  assert.deepEqual(verifySession(token, secret, now), { userId: 'user_123', username: 'alice_01' });
  assert.equal(verifySession(token + 'x', secret, now), null);
  assert.equal(verifySession(token, secret, new Date('2026-07-15T12:00:01.000Z')), null);
}

console.log('auth tests passed');
