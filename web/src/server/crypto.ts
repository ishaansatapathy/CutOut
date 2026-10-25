import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";

export const id = () => randomBytes(12).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmacHex = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type JobLimits = { sec?: number; res?: number };

/** One-time token the GPU service accepts for exactly one job of this tool. */
export function mintJobToken(tool: string, sub: string, lim: JobLimits = {}, ttlSec = 600) {
  if (!config.jobSecret) throw new Error("JOB_SECRET is not set");
  const jti = id();
  const body = Buffer.from(
    JSON.stringify({ tool, sub, lim, jti, exp: Math.floor(Date.now() / 1000) + ttlSec }),
  ).toString("base64url");
  return { token: `${body}.${hmacHex(config.jobSecret, body)}`, jti };
}

export function signValue(value: string) {
  return `${value}.${hmacHex(config.authSecret, value)}`;
}

export function unsignValue(signed: string | undefined): string | null {
  if (!signed || !config.authSecret) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  return safeEqual(signed.slice(i + 1), hmacHex(config.authSecret, value)) ? value : null;
}
