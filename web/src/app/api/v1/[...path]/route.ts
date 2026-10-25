import { RULES } from "@/lib/rules";
import { userForKey } from "@/server/apikeys";
import { clientIp } from "@/server/auth";
import { balance, payForApi } from "@/server/billing";
import { config } from "@/server/config";
import { db, startOfMonth } from "@/server/db";

export const maxDuration = 300;

const err = (status: number, message: string) => Response.json({ error: message }, { status });

/** Fixed-window limiter: 10 requests per minute per key. */
const hits = new Map<string, { t: number; n: number }>();
function limited(userId: string) {
  const now = Date.now();
  const h = hits.get(userId);
  if (!h || now - h.t > 60_000) {
    hits.set(userId, { t: now, n: 1 });
    return false;
  }
  return ++h.n > 10;
}

async function forward(path: string, token: string, init: RequestInit) {
  const r = await fetch(`${config.aiUrl}${path}`, { ...init, headers: { ...init.headers, "X-Job-Token": token } });
  return r;
}

const passthrough = async (r: Response) =>
  new Response(r.body, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") ?? "application/octet-stream" } });

async function ownsJob(userId: string, extId: string) {
  return !!(await db.get(`SELECT 1 x FROM jobs WHERE user_id = $1 AND (ext_id = $2 OR id = $2)`, [userId, extId]));
}

async function handle(req: Request, path: string[]) {
  const userId = await userForKey(req.headers.get("authorization"));
  if (!userId) return err(401, "Missing or invalid API key. Use: Authorization: Bearer <key>");
  if (limited(userId)) return err(429, "Rate limit: 10 requests per minute per key.");
  const ctx = { userId, deviceId: `api:${userId}`, ip: clientIp(req) };
  const route = `${req.method} ${path.join("/")}`;

  if (route === "GET usage") {
    const used = await db.all(
      `SELECT tool, COUNT(*) n, SUM(credits_charged) credits FROM jobs WHERE user_id = $1 AND source = 'api' AND created_at >= $2 GROUP BY tool`,
      [userId, startOfMonth()],
    );
    return Response.json({ credits: await balance(userId), free_images_per_month: RULES.api.freeImagesPerMonth, this_month: used });
  }

  if (route === "POST images/remove-background") {
    const form = await req.formData();
    const bill = await payForApi("remove", ctx);
    if (bill.kind !== "token") return err(402, bill.message);
    return passthrough(await forward("/v1/images/remove-background", bill.token, { method: "POST", body: form }));
  }

  if (route === "POST images/generate") {
    const body = await req.text();
    const bill = await payForApi("generate", ctx);
    if (bill.kind !== "token") return err(402, bill.message);
    return passthrough(await forward("/v1/images/generate", bill.token, {
      method: "POST", body, headers: { "Content-Type": "application/json" },
    }));
  }

  if (route === "POST videos/remove-background") {
    const form = await req.formData();
    const seconds = Math.min(RULES.video.maxSeconds, Math.max(1, Number(form.get("seconds") ?? 10)));
    const res = Number(form.get("res") ?? 720) === 1080 ? 1080 : 720;
    const webhookUrl = (form.get("webhook_url") as string | null) || (form.get("webhook") as string | null);
    form.delete("seconds");
    form.delete("res");
    if (webhookUrl) {
      form.delete("webhook_url");
      form.delete("webhook");
      let promptObj: Record<string, unknown> = {};
      try {
        promptObj = JSON.parse((form.get("prompt") as string) || "{}");
      } catch {}
      promptObj.webhook_url = webhookUrl;
      form.set("prompt", JSON.stringify(promptObj));
    }
    const bill = await payForApi("video", ctx, { seconds, res });
    if (bill.kind !== "token") return err(402, bill.message);
    const r = await forward("/v1/videos", bill.token, { method: "POST", body: form });
    const j = await r.json();
    if (r.ok) await db.run(`UPDATE jobs SET ext_id = $1 WHERE id = $2`, [j.id, bill.jti]);
    return Response.json(j, { status: r.status });
  }

  if (req.method === "GET" && path[0] === "jobs" && path[1]) {
    if (!(await ownsJob(userId, path[1]))) return err(404, "Job not found.");
    const rest = path.slice(2).join("/");
    const qs = new URL(req.url).search;
    const r = await fetch(`${config.aiUrl}/v1/jobs/${path[1]}${rest ? `/${rest}` : ""}${qs}`);
    return passthrough(r);
  }

  return err(404, `Unknown endpoint: ${route}`);
}

export async function GET(req: Request, ctx: RouteContext<"/api/v1/[...path]">) {
  return handle(req, (await ctx.params).path);
}

export async function POST(req: Request, ctx: RouteContext<"/api/v1/[...path]">) {
  return handle(req, (await ctx.params).path);
}
