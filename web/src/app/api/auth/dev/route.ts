import { sessionCookie, upsertUser } from "@/server/auth";
import { devLoginAllowed } from "@/server/config";

/** Local-only sign-in while Google keys aren't configured. Disabled in production. */
export async function POST(req: Request) {
  if (!devLoginAllowed()) return new Response("Not available", { status: 404 });
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email." }, { status: 400 });
  const uid = await upsertUser({ email, googleId: null, name: email.split("@")[0], picture: null });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(uid) },
  });
}
