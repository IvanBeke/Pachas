import { eq, sql } from "drizzle-orm";
import { runtimeDb } from "./client";
import { groupMembers, groups } from "../db/schema";
import type { GroupRole } from "../../shared/group-roles";

export type DbTransaction = Parameters<Parameters<typeof runtimeDb.transaction>[0]>[0];

type GroupRow = typeof groups.$inferSelect;

export function writeTransaction<T>(
  callback: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return runtimeDb.transaction(callback, { behavior: "immediate" });
}

/**
 * Loads the group row for a write and bumps its `version`.
 *
 * Every mutation of a group's data goes through here, so the version is a
 * reliable change marker for the summary ETag: if the write commits, clients
 * see a new version; if it throws, the bump rolls back with it.
 */
export async function lockGroup(
  tx: DbTransaction,
  gid: string,
): Promise<GroupRow> {
  const rows = await tx
    .update(groups)
    .set({ version: sql`${groups.version} + 1` })
    .where(eq(groups.id, gid))
    .returning();
  if (!rows[0]) throw createError({ statusCode: 404, message: "not_found" });
  return rows[0];
}

/** Locks the group and loads its members, for permission checks in a write. */
export async function lockGroupWithMembers(
  tx: DbTransaction,
  gid: string,
): Promise<{ row: GroupRow; members: { userId: string; role: GroupRole }[] }> {
  const row = await lockGroup(tx, gid);
  const members = await tx
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, gid));
  return { row, members };
}
