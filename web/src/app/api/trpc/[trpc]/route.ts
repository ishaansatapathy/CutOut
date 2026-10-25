import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { cleanup } from "@/server/billing";
import { appRouter } from "@/server/root";
import { createContext } from "@/server/trpc";

const g = globalThis as unknown as { __coCleanup?: boolean };
if (!g.__coCleanup) {
  g.__coCleanup = true;
  const tick = () => cleanup().catch(() => {});
  tick();
  setInterval(tick, 6 * 3600_000).unref?.();
}

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: ({ req, resHeaders }) => createContext({ req, resHeaders }),
  });

export { handler as GET, handler as POST };
