import { z } from "zod";
import { PLANS } from "@/lib/plans";
import { PACKS, RULES } from "@/lib/rules";
import { createKey, listKeys, revokeKey } from "./apikeys";
import { nextAd, payWithCredits, refundJob, rewardAd, startAds, usage } from "./billing";
import { config, devLoginAllowed, devPaymentsAllowed } from "./config";
import { db, now } from "./db";
import { createOrder, fulfil, orderOwner, verifyCheckout } from "./payments";
import { authedProcedure, publicProcedure, router, TRPCError } from "./trpc";

const toolSchema = z.enum(["remove", "erase", "upscale", "video", "generate"]);
const videoSchema = z.object({ seconds: z.number().min(0.1).max(600), res: z.union([z.literal(480), z.literal(720), z.literal(1080)]) });

export const appRouter = router({
  plans: router({ list: publicProcedure.query(() => PLANS) }),

  engine: router({
    status: publicProcedure.query(async () => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${config.aiUrl}/api/info`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
        const j = (await r.json()) as { engine: string; device: string; video: boolean };
        return { online: true, engine: j.engine, device: j.device, video: j.video, latencyMs: Date.now() - t0 };
      } catch {
        return { online: false, engine: null, device: null, video: false, latencyMs: null };
      }
    }),
  }),

  me: publicProcedure.query(async ({ ctx }) => ({
    user: ctx.user,
    usage: await usage(ctx),
    devLogin: devLoginAllowed(),
    devPayments: devPaymentsAllowed(),
    adProvider: config.adProvider,
    turnstileSiteKey: config.turnstile.siteKey || null,
    rules: RULES,
  })),

  jobs: router({
    /** Ask for a job token. pay=credits charges now; pay=ads opens an ad session. */
    request: publicProcedure
      .input(z.object({
        tool: toolSchema, pay: z.enum(["ads", "credits"]), video: videoSchema.optional(),
        turnstileToken: z.string().max(4000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.tool === "video" && !input.video) throw new TRPCError({ code: "BAD_REQUEST", message: "Video details missing." });
        if (input.pay === "credits" || input.tool === "generate") return payWithCredits(input.tool, ctx, input.video);
        return startAds(input.tool, ctx, input.video, input.turnstileToken);
      }),
    /** Return credits for a job that failed. Idempotent. */
    refund: publicProcedure.input(z.object({ jti: z.string() })).mutation(({ ctx, input }) => refundJob(input.jti, ctx)),
  }),

  ads: router({
    next: publicProcedure.input(z.object({ adSession: z.string() })).mutation(async ({ ctx, input }) => {
      const ad = await nextAd(input.adSession, ctx);
      if (!ad) throw new TRPCError({ code: "NOT_FOUND", message: "Ad session expired. Start again." });
      return ad;
    }),
    reward: publicProcedure
      .input(z.object({ adSession: z.string(), adId: z.string(), networkTxnId: z.string().max(200).optional() }))
      .mutation(({ ctx, input }) => rewardAd(input.adSession, input.adId, input.networkTxnId, ctx)),
  }),

  credits: router({
    packs: publicProcedure.query(() => PACKS),
    createOrder: authedProcedure.input(z.object({ pack: z.string() })).mutation(({ ctx, input }) => createOrder(ctx.userId, input.pack)),
    verify: authedProcedure
      .input(z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if ((await orderOwner(input.orderId)) !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your order." });
        if (!verifyCheckout(input.orderId, input.paymentId, input.signature)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Payment couldn't be verified." });
        }
        await fulfil(input.orderId, input.paymentId);
        return { ok: true };
      }),
    devComplete: authedProcedure.input(z.object({ orderId: z.string() })).mutation(async ({ ctx, input }) => {
      if (!devPaymentsAllowed()) throw new TRPCError({ code: "FORBIDDEN", message: "Test payments are off." });
      if ((await orderOwner(input.orderId)) !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your order." });
      await fulfil(input.orderId, `dev_${input.orderId}`);
      return { ok: true };
    }),
    history: authedProcedure.query(({ ctx }) =>
      db.all<{ delta: number; reason: string; created_at: number }>(
        `SELECT delta, reason, created_at FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [ctx.userId],
      ),
    ),
  }),

  apiKeys: router({
    list: authedProcedure.query(({ ctx }) => listKeys(ctx.userId)),
    create: authedProcedure.input(z.object({ name: z.string().max(60) })).mutation(({ ctx, input }) => createKey(ctx.userId, input.name)),
    revoke: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      await revokeKey(ctx.userId, input.id);
      return { ok: true };
    }),
  }),

  report: router({
    submit: publicProcedure
      .input(z.object({ message: z.string().min(5).max(2000), email: z.string().max(200).optional(), url: z.string().max(500).optional() }))
      .mutation(async ({ input }) => {
        await db.run(`INSERT INTO reports (id, email, message, url, created_at) VALUES ($1, $2, $3, $4, $5)`, [
          crypto.randomUUID(),
          input.email ?? null,
          input.message,
          input.url ?? null,
          now(),
        ]);
        return { ok: true };
      }),
  }),

  waitlist: router({
    join: publicProcedure.input(z.object({ email: z.email() })).mutation(async ({ input }) => {
      const changes = await db.run(`INSERT INTO waitlist (email, created_at) VALUES ($1, $2) ON CONFLICT(email) DO NOTHING`, [
        input.email.toLowerCase(),
        now(),
      ]);
      return { ok: true, already: changes === 0 };
    }),
  }),
});

export type AppRouter = typeof appRouter;
