import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { clientIp, DEVICE_COOKIE, parseCookies, SESSION_COOKIE, userFromCookie } from "./auth";
import { touchDevice } from "./billing";
import { id } from "./crypto";

export async function createContext({ req, resHeaders }: { req: Request; resHeaders: Headers }) {
  const cookies = parseCookies(req.headers.get("cookie"));
  let deviceId = cookies[DEVICE_COOKIE];
  if (!deviceId || deviceId.length < 16) {
    deviceId = id() + id();
    resHeaders.append("set-cookie", `${DEVICE_COOKIE}=${deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }
  await touchDevice(deviceId);
  const user = await userFromCookie(cookies[SESSION_COOKIE]);
  return { deviceId, ip: clientIp(req), user, userId: user?.id ?? null };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
  return next({ ctx: { ...ctx, user: ctx.user, userId: ctx.user.id } });
});
export { TRPCError };
