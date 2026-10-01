import { eq } from "drizzle-orm";
import { runtimeDb } from "./client";
import { groups } from "../db/schema";

export type DbTransaction = Parameters<Parameters<typeof runtimeDb.transaction>[0]>[0];

type GroupRow = typeof groups.$inferSelect;

export function writeTransaction<T>(
  callback: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return runtimeDb.transaction(callback, { behavior: "immediate" });
}

export async function lockGroup(
  tx: DbTransaction,
  gid: string,
): Promise<GroupRow> {
  const rows = await tx
    .select()
    .from(groups)
    .where(eq(groups.id, gid))
    .limit(1);
  if (!rows[0]) throw createError({ statusCode: 404, message: "not_found" });
  return rows[0];
}
