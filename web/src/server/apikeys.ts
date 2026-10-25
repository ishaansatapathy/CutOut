import { randomBytes } from "node:crypto";
import { id, sha256 } from "./crypto";
import { db, now } from "./db";

export async function createKey(userId: string, name: string) {
  const raw = `co_live_${randomBytes(24).toString("base64url")}`;
  const kid = id();
  await db.run(`INSERT INTO api_keys (id, user_id, key_hash, prefix, name, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    kid,
    userId,
    sha256(raw),
    raw.slice(0, 12),
    name.slice(0, 60) || "Untitled key",
    now(),
  ]);
  return { id: kid, key: raw };
}

export function listKeys(userId: string) {
  return db.all<{ id: string; name: string; prefix: string; last_used_at: number | null; created_at: number }>(
    `SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [userId],
  );
}

export function revokeKey(userId: string, kid: string) {
  return db.run(`UPDATE api_keys SET revoked_at = $1 WHERE id = $2 AND user_id = $3`, [now(), kid, userId]);
}

export async function userForKey(authHeader: string | null) {
  const raw = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!raw) return null;
  const row = await db.get<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [sha256(raw)],
  );
  if (!row) return null;
  await db.run(`UPDATE api_keys SET last_used_at = $1 WHERE id = $2`, [now(), row.id]);
  return row.user_id;
}
