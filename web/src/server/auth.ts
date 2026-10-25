import { id, signValue, unsignValue } from "./crypto";
import { db, now } from "./db";

export const SESSION_COOKIE = "co_session";
export const DEVICE_COOKIE = "co_device";
const SESSION_DAYS = 30;

export type User = { id: string; email: string; name: string | null; picture: string | null };

export function parseCookies(header: string | null) {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function userFromCookie(value: string | undefined): Promise<User | null> {
  const v = unsignValue(value);
  if (!v) return null;
  const [uid, exp] = v.split(":");
  if (!uid || Number(exp) < Date.now()) return null;
  return (await db.get<User>(`SELECT id, email, name, picture FROM users WHERE id = $1`, [uid])) ?? null;
}

export function sessionCookie(userId: string) {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(signValue(`${userId}:${exp}`))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function upsertUser(p: { email: string; googleId: string | null; name: string | null; picture: string | null }) {
  const email = p.email.toLowerCase();
  const existing = await db.get<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing) {
    await db.run(
      `UPDATE users SET google_id = COALESCE($1, google_id), name = COALESCE($2, name), picture = COALESCE($3, picture) WHERE id = $4`,
      [p.googleId, p.name, p.picture, existing.id],
    );
    return existing.id;
  }
  const uid = id();
  await db.run(`INSERT INTO users (id, email, google_id, name, picture, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    uid,
    email,
    p.googleId,
    p.name,
    p.picture,
    now(),
  ]);
  return uid;
}

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
