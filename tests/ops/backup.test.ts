import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { backupDatabase, verifyDatabase } from '../../scripts/ops/backup-sqlite.mjs';
import { SqliteRuntimeStore } from '../../packages/persistence/src/sqlite-runtime.ts';

test('SQLite backup is transactionally readable and passes integrity verification', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arena-backup-'));
  const source = join(directory, 'arena.sqlite');
  const destination = join(directory, 'backups', 'arena.sqlite');
  try {
    const runtime = new SqliteRuntimeStore(source);
    runtime.put('probe', 'one', { value: 'preserved' });
    runtime.close();

    await backupDatabase(source, destination);
    assert.deepEqual(verifyDatabase(destination), { ok: true, integrity: 'ok' });

    const restored = new SqliteRuntimeStore(destination);
    assert.deepEqual(restored.get('probe', 'one'), { value: 'preserved' });
    restored.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
