import { randomUUID } from 'node:crypto';
import type { Scope } from '../../../packages/contracts/src/index.js';
import { assertBalanced, type PostingLine } from '../../../packages/domain/src/index.js';
import { ownership, type Transaction, assertOpenPeriod } from './database.js';
export async function postJournal(
  tx: Transaction,
  s: Scope,
  sourceType: string,
  sourceId: string,
  lines: PostingLine[],
): Promise<void> {
  assertBalanced(lines);
  await assertOpenPeriod(tx, s);
  const id = randomUUID();
  await tx.journal.create({
    data: { id, ...ownership(s), sourceType, sourceId },
  });
  await tx.journalLine.createMany({
    data: lines.map((l) => ({
      id: randomUUID(),
      ...ownership(s),
      journalId: id,
      ...l,
    })),
  });
}
