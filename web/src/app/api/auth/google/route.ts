import { createHash, randomBytes } from "node:crypto";
import { config } from "@/server/config";

export async function GET(req: Request) {
  if (!config.google.id) return Response.redirect(new URL("/app?login=dev", req.url));
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const next = new URL(req.url).searchParams.get("next") ?? "/app";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.google.id,
    redirect_uri: `${config.appUrl}/api/auth/callback/google`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  const cookie = `co_oauth=${encodeURIComponent(JSON.stringify({ state, verifier, next: safeNext }))}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600`;
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": cookie } });
}
