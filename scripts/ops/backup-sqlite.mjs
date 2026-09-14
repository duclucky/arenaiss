import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';

export async function backupDatabase(sourcePath, destinationPath) {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (!existsSync(source)) throw new Error('source database does not exist');
  if (source === destination) throw new Error('backup destination must differ from source');
  mkdirSync(dirname(destination), { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(database, destination);
  } finally {
    database.close();
  }
  const verification = verifyDatabase(destination);
  if (!verification.ok) throw new Error(`backup integrity check failed: ${verification.integrity}`);
  return { source: realpathSync(source), destination: realpathSync(destination), integrity: verification.integrity };
}

export function verifyDatabase(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error('database does not exist');
  const database = new DatabaseSync(resolved, { readOnly: true });
  try {
    const row = database.prepare('PRAGMA integrity_check').get();
    const integrity = typeof row?.integrity_check === 'string' ? row.integrity_check : 'unknown';
    return { ok: integrity === 'ok', integrity };
  } finally {
    database.close();
  }
}

async function main() {
  const [modeOrSource, maybeSource] = process.argv.slice(2);
  if (modeOrSource === '--verify') {
    const result = verifyDatabase(maybeSource);
    process.stdout.write(`${JSON.stringify({ event: 'database_verify', ...result })}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const source = modeOrSource;
  const destination = maybeSource;
  if (!source || !destination) throw new Error('usage: backup-sqlite.mjs <source> <destination> | --verify <database>');
  const result = await backupDatabase(source, destination);
  process.stdout.write(`${JSON.stringify({ event: 'database_backup', destination: result.destination, integrity: result.integrity })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: 'database_backup_failed', error: error instanceof Error ? error.message : 'unknown error' })}\n`);
    process.exitCode = 1;
  });
}
