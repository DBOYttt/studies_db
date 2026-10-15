import { type Db, writeAudit } from '@studies/db';

/**
 * Records a Discord-side admin change in admin_audit. A failure is logged and
 * never fails the action that was already applied.
 */
export async function auditDiscord(
  db: Db,
  userId: number,
  action: string,
  target: string | null,
  details: object,
): Promise<void> {
  try {
    await writeAudit(db, {
      userId,
      action,
      target,
      details: { ...details, source: 'discord' },
    });
  } catch (err) {
    console.error('audit write failed', action, err);
  }
}
