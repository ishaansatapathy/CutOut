import { creditCost, IMAGE_TOOLS, isImageTool, RULES, type Tool } from "@/lib/rules";
import { id, mintJobToken, type JobLimits } from "./crypto";
import { db, type Exec, now, startOfDay, startOfMonth, tx } from "./db";

export type Ctx = { deviceId: string; ip: string; userId: string | null };
export type VideoOpts = { seconds: number; res: 480 | 720 | 1080 };
export type Blocked = { kind: "blocked"; reason: "login" | "limit" | "credits" | "invalid"; message: string };

const IMG_IN = `(${IMAGE_TOOLS.map((t) => `'${t}'`).join(",")})`;
const count = async (x: Exec, sql: string, params: unknown[]) =>
  Number(((await x.get<{ c: number }>(sql, params))?.c) ?? 0);

export function touchDevice(deviceId: string) {
  return db.run(
    `INSERT INTO devices (id, first_seen, last_seen) VALUES ($1, $2, $3)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`,
    [deviceId, now(), now()],
  );
}

export function balance(userId: string, x: Exec = db) {
  return count(x, `SELECT COALESCE(SUM(delta), 0) c FROM credit_ledger WHERE user_id = $1`, [userId]);
}

export function addCredits(userId: string, delta: number, reason: string, ref: string | null, x: Exec = db) {
  return x.run(`INSERT INTO credit_ledger (id, user_id, delta, reason, ref, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    id(),
    userId,
    delta,
    reason,
    ref,
    now(),
  ]);
}

export async function usage(ctx: Ctx, x: Exec = db) {
  const anonUsed = await count(
    x,
    `SELECT COUNT(*) c FROM jobs WHERE device_id = $1 AND user_id IS NULL AND tool IN ${IMG_IN} AND paid_with = 'ads'`,
    [ctx.deviceId],
  );
  const dayUsed = ctx.userId
    ? await count(
        x,
        `SELECT COUNT(*) c FROM jobs WHERE user_id = $1 AND tool IN ${IMG_IN} AND paid_with = 'ads' AND created_at >= $2`,
        [ctx.userId, startOfDay()],
      )
    : 0;
  const videoToday = ctx.userId
    ? await count(
        x,
        `SELECT COUNT(*) c FROM jobs WHERE user_id = $1 AND tool = 'video' AND paid_with = 'ads' AND created_at >= $2`,
        [ctx.userId, startOfDay()],
      )
    : 0;
  return {
    imageLeft: ctx.userId
      ? Math.max(0, RULES.image.loggedInPerDay - dayUsed)
      : Math.max(0, RULES.image.anonLifetime - anonUsed),
    imageLimit: ctx.userId ? RULES.image.loggedInPerDay : RULES.image.anonLifetime,
    videoFreeLeft: ctx.userId ? Math.max(0, RULES.video.freePerDay - videoToday) : 0,
    credits: ctx.userId ? await balance(ctx.userId, x) : 0,
  };
}

async function ipCapHit(ip: string, x: Exec) {
  const n = await count(x, `SELECT COUNT(*) c FROM jobs WHERE ip = $1 AND paid_with = 'ads' AND created_at >= $2`, [
    ip,
    startOfDay(),
  ]);
  return n >= RULES.ipDailyCap;
}

/** Can this request take the free (ad-supported) path right now? Pass the tx executor when inside a transaction. */
async function freeEligibility(tool: Tool, ctx: Ctx, video?: VideoOpts, x: Exec = db): Promise<Blocked | null> {
  if (tool === "generate") return { kind: "blocked", reason: "credits", message: "Image generation uses credits." };
  if (await ipCapHit(ctx.ip, x))
    return { kind: "blocked", reason: "limit", message: "Daily free limit reached on this network. Try again tomorrow or use credits." };
  const u = await usage(ctx, x);
  if (isImageTool(tool)) {
    if (u.imageLeft > 0) return null;
    return ctx.userId
      ? { kind: "blocked", reason: "limit", message: `You've used today's ${RULES.image.loggedInPerDay} free images. Use credits or come back tomorrow.` }
      : { kind: "blocked", reason: "login", message: `Your ${RULES.image.anonLifetime} free cutouts are used. Sign in with Google for ${RULES.image.loggedInPerDay} more a day.` };
  }
  if (!ctx.userId) return { kind: "blocked", reason: "login", message: "Sign in with Google to get 1 free video a day." };
  if (u.videoFreeLeft <= 0) return { kind: "blocked", reason: "limit", message: "Today's free video is used. Use credits for more clips." };
  if (video && (video.res > RULES.video.freeRes || video.seconds > RULES.video.freeSeconds + 0.5)) {
    return { kind: "blocked", reason: "credits", message: `Free videos are up to ${RULES.video.freeSeconds}s at ${RULES.video.freeRes}p.` };
  }
  return null;
}

function record(
  tool: Tool,
  ctx: Ctx,
  jti: string,
  paidWith: string,
  credits: number,
  seconds: number | null,
  source: string,
  x: Exec = db,
) {
  return x
    .run(
      `INSERT INTO jobs (id, user_id, device_id, ip, tool, source, paid_with, seconds, credits_charged, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [jti, ctx.userId, ctx.deviceId, ctx.ip, tool, source, paidWith, seconds, credits, now()],
    )
    .then(() =>
      paidWith === "ads"
        ? x.run(`UPDATE devices SET uses_count = uses_count + 1, video_uses = video_uses + $1 WHERE id = $2`, [
            tool === "video" ? 1 : 0,
            ctx.deviceId,
          ])
        : 0,
    );
}

