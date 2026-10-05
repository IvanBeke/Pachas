import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../db/schema";

export const DEFAULT_DATABASE_PATH = "/data/pachas.sqlite";

function createRuntimeDatabase() {
  const configuredPath = process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  const databasePath = resolve(configuredPath);
  mkdirSync(dirname(databasePath), { recursive: true });

  const client = createClient({
    url: pathToFileURL(databasePath).href,
    timeout: 5_000,
    concurrency: 1,
  });

  return drizzle({ client, schema, casing: "snake_case" });
}

type RuntimeDatabase = ReturnType<typeof createRuntimeDatabase>;
let _db: RuntimeDatabase | null = null;
let _initialized: Promise<void> | null = null;

export function getDb(): RuntimeDatabase {
  if (!_db) _db = createRuntimeDatabase();
  return _db;
}

export async function initializeRuntimeDb(): Promise<void> {
  const client = getDb().$client;
  if (!_initialized) {
    _initialized = (async () => {
      await client.execute("PRAGMA foreign_keys = ON");
      await client.execute("PRAGMA journal_mode = WAL");
      await client.execute("PRAGMA synchronous = NORMAL");
      await client.execute("PRAGMA busy_timeout = 5000");
      await client.execute("PRAGMA temp_store = MEMORY");
    })();
  }
  await _initialized;
}

/**
 * Checkpoints the WAL and closes the connection, so a stopped container leaves
 * a self-contained `.sqlite` file behind.
 */
export async function closeRuntimeDb(): Promise<void> {
  if (!_db) return;
  try {
    await _db.$client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    _db.$client.close();
    _db = null;
    _initialized = null;
  }
}

// Keep this distinct from NuxtHub's generated `db` auto-import. The runtime
// connection uses DATABASE_PATH and is opened lazily after the image starts.
export const runtimeDb: RuntimeDatabase = new Proxy({} as RuntimeDatabase, {
  get(_target, property) {
    return getDb()[property as keyof RuntimeDatabase];
  },
});
