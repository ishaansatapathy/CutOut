import { creditCost, IMAGE_TOOLS, isImageTool, RULES, type Tool } from "@/lib/rules";
import { id, mintJobToken, type JobLimits } from "./crypto";
import { db, type Exec, now, startOfDay, startOfMonth, tx } from "./db";
import { verifyTurnstile } from "./turnstile";

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

function limitsFor(tool: Tool, paidWith: string, video?: VideoOpts): JobLimits {
  if (tool !== "video") return {};
  if (paidWith === "ads") return { sec: RULES.video.freeSeconds, res: RULES.video.freeRes };
  return { sec: Math.min(RULES.video.maxSeconds, Math.ceil(video?.seconds ?? 5)), res: video?.res ?? 720 };
}

type Grant = { kind: "token"; token: string; jti: string; tool: Tool; limits: JobLimits; charged: number };

/** Pay with credits: charge and mint in one transaction. */
export function payWithCredits(tool: Tool, ctx: Ctx, video?: VideoOpts, source = "web"): Promise<Grant | Blocked> {
  if (!ctx.userId) return Promise.resolve({ kind: "blocked", reason: "login", message: "Sign in to use credits." });
  const cost = creditCost(tool, video);
  return tx(async (x) => {
    if ((await balance(ctx.userId!, x)) < cost) {
      return { kind: "blocked", reason: "credits", message: `This needs ${cost} credits. Top up to continue.` } as Blocked;
    }
    const lim = limitsFor(tool, "credits", video);
    const { token, jti } = mintJobToken(tool, ctx.userId!, lim);
    await addCredits(ctx.userId!, -cost, tool, jti, x);
    await record(tool, ctx, jti, "credits", cost, video?.seconds ?? null, source, x);
    return { kind: "token", token, jti, tool, limits: lim, charged: cost };
  });
}

/** Start the free path: returns an ad session the client must complete. */
export async function startAds(tool: Tool, ctx: Ctx, video?: VideoOpts, turnstileToken?: string) {
  // Only anonymous requests need the human check — signed-in users already cost more to
  // script (a real Google account) and are capped per-day regardless.
  if (!ctx.userId && !(await verifyTurnstile(turnstileToken, ctx.ip))) {
    return { kind: "blocked", reason: "invalid", message: "Please complete the verification and try again." } as Blocked;
  }
  const blocked = await freeEligibility(tool, ctx, video);
  if (blocked) return blocked;
  const required = tool === "video" ? RULES.video.adsPerJob : RULES.image.adsPerJob;
  const sid = id();
  await db.run(
    `INSERT INTO ad_sessions (id, user_id, device_id, ip, tool, opts, required, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [sid, ctx.userId, ctx.deviceId, ctx.ip, tool, JSON.stringify(video ?? {}), required, now()],
  );
  return { kind: "ads" as const, adSession: sid, required };
}

type AdRow = {
  id: string; user_id: string | null; device_id: string; tool: Tool; opts: string; required: number;
  watched: number; current_ad: string | null; ad_started_at: number | null; redeemed: number; created_at: number;
};

async function adSession(sid: string, ctx: Ctx, x: Exec = db) {
  const row = await x.get<AdRow>(`SELECT * FROM ad_sessions WHERE id = $1`, [sid]);
  if (!row || row.device_id !== ctx.deviceId || row.redeemed || now() - row.created_at > 30 * 60_000) return null;
  return row;
}

export async function nextAd(sid: string, ctx: Ctx) {
  const row = await adSession(sid, ctx);
  if (!row) return null;
  const adId = id();
  await db.run(`UPDATE ad_sessions SET current_ad = $1, ad_started_at = $2 WHERE id = $3`, [adId, now(), sid]);
  return { adId, index: row.watched + 1, required: row.required, minMs: RULES.ad.minWatchMs };
}

/** Credit one watched ad. When the last one lands, re-check caps and mint the job token. */
export function rewardAd(sid: string, adId: string, networkTxnId: string | undefined, ctx: Ctx) {
  return tx(async (x) => {
    const row = await adSession(sid, ctx, x);
    if (!row) return { kind: "error" as const, message: "Ad session expired. Start again." };
    if (row.current_ad !== adId || !row.ad_started_at) return { kind: "error" as const, message: "That ad doesn't match this session." };
    if (now() - row.ad_started_at < RULES.ad.minWatchMs) return { kind: "error" as const, message: "Watch the whole ad to unlock." };
    await x.run(
      `INSERT INTO ad_rewards (id, ad_session_id, user_id, device_id, network_txn_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id(), sid, ctx.userId, ctx.deviceId, networkTxnId || adId, now()],
    );
    const watched = row.watched + 1;
    await x.run(`UPDATE ad_sessions SET watched = $1, current_ad = NULL, ad_started_at = NULL WHERE id = $2`, [watched, sid]);
    if (watched < row.required) return { kind: "progress" as const, watched, required: row.required };
    const video = JSON.parse(row.opts) as VideoOpts;
    const blocked = await freeEligibility(row.tool, ctx, row.tool === "video" ? video : undefined, x);
    if (blocked) return { kind: "error" as const, message: blocked.message };
    const lim = limitsFor(row.tool, "ads", video);
    const { token, jti } = mintJobToken(row.tool, ctx.userId ?? ctx.deviceId, lim);
    await record(row.tool, ctx, jti, "ads", 0, row.tool === "video" ? lim.sec ?? null : null, "web", x);
    await x.run(`UPDATE ad_sessions SET redeemed = 1 WHERE id = $1`, [sid]);
    return { kind: "token" as const, token, jti, tool: row.tool, limits: lim, charged: 0 };
  });
}

/** Refund the credits for a job that failed. Idempotent via the unique (reason, ref) ledger index. */
export function refundJob(jti: string, ctx: Ctx) {
  return tx(async (x) => {
    const job = await x.get<{ user_id: string | null; credits_charged: number; paid_with: string; refunded: number }>(
      `SELECT user_id, credits_charged, paid_with, refunded FROM jobs WHERE id = $1`,
      [jti],
    );
    if (!job || !job.user_id || job.user_id !== ctx.userId) return { ok: false };
    if (job.paid_with !== "credits" || job.credits_charged <= 0 || job.refunded) return { ok: false };
    await x.run(`UPDATE jobs SET refunded = 1 WHERE id = $1`, [jti]);
    await addCredits(job.user_id, job.credits_charged, "refund", jti, x);
    return { ok: true, credits: job.credits_charged };
  });
}

/** API billing: monthly free images, then prepaid credits. No ads on the API. */
export async function payForApi(tool: Tool, ctx: Ctx & { userId: string }, video?: VideoOpts) {
  if (tool === "remove") {
    const used = await count(
      db,
      `SELECT COUNT(*) c FROM jobs WHERE user_id = $1 AND source = 'api' AND tool = 'remove' AND paid_with = 'api_free' AND created_at >= $2`,
      [ctx.userId, startOfMonth()],
    );
    if (used < RULES.api.freeImagesPerMonth) {
      const { token, jti } = mintJobToken(tool, ctx.userId);
      await record(tool, ctx, jti, "api_free", 0, null, "api");
      return { kind: "token" as const, token, jti, tool, limits: {}, charged: 0 };
    }
  }
  return payWithCredits(tool, ctx, video, "api");
}

/** Housekeeping: drop expired ad sessions/rewards and very old job rows. Never touches ledger or orders. */
export async function cleanup() {
  await db.run(`DELETE FROM ad_sessions WHERE created_at < $1`, [now() - 3600_000]);
  await db.run(`DELETE FROM ad_rewards WHERE created_at < $1`, [now() - 2 * 86_400_000]);
  await db.run(`DELETE FROM jobs WHERE created_at < $1`, [now() - 60 * 86_400_000]);
}
