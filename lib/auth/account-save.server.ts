import 'server-only';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyDailyCreditRefill } from '@/lib/game/credit';
import { serializeArenaSave, type ArenaSave, type ArenaSaveInput } from '@/lib/game/save';

interface AccountSavesFile {
  saves: Record<string, ArenaSave>;
}

const DEFAULT_SAVES_PATH = join(process.cwd(), 'data', 'account-saves.json');

async function readSaves(path: string): Promise<AccountSavesFile> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as AccountSavesFile;
    return { saves: parsed && typeof parsed.saves === 'object' && parsed.saves ? parsed.saves : {} };
  } catch {
    return { saves: {} };
  }
}

async function writeSaves(path: string, file: AccountSavesFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2), 'utf8');
}

export function createAccountSaveStore(path: string = DEFAULT_SAVES_PATH) {
  return {
    async get(userId: string, now: Date = new Date()): Promise<ArenaSave | null> {
      const file = await readSaves(path);
      const save = file.saves[userId];
      if (!save) return null;
      const refill = applyDailyCreditRefill({
        credits: save.credits,
        lastRefillAt: save.lastCreditRefillAt,
        now,
      });
      if (refill.credits === save.credits && refill.lastRefillAt === save.lastCreditRefillAt) {
        return save;
      }
      const updated = serializeArenaSave({ ...save, credits: refill.credits, lastCreditRefillAt: refill.lastRefillAt }, now);
      file.saves[userId] = updated;
      await writeSaves(path, file);
      return updated;
    },

    async put(userId: string, input: ArenaSaveInput, now: Date = new Date()): Promise<ArenaSave> {
      const file = await readSaves(path);
      const save = serializeArenaSave(input, now);
      file.saves[userId] = save;
      await writeSaves(path, file);
      return save;
    },
  };
}
