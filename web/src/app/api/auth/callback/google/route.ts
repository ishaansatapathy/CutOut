import { parseCookies, sessionCookie, upsertUser } from "@/server/auth";
import { config } from "@/server/config";

const fail = (req: Request, why: string) => Response.redirect(new URL(`/app?login_error=${encodeURIComponent(why)}`, req.url));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = parseCookies(req.headers.get("cookie")).co_oauth;
  let saved: { state: string; verifier: string; next: string };
  try {
    saved = JSON.parse(raw ?? "");
  } catch {
    return fail(req, "Sign-in expired. Try again.");
  }
  if (!url.searchParams.get("code") || url.searchParams.get("state") !== saved.state) return fail(req, "Sign-in was cancelled.");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code")!,
      client_id: config.google.id,
      client_secret: config.google.secret,
      redirect_uri: `${config.appUrl}/api/auth/callback/google`,
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) return fail(req, "Google sign-in failed.");
  const { id_token } = (await tokenRes.json()) as { id_token: string };
  // The id_token came straight from Google's token endpoint over TLS, so its payload can be trusted here.
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString()) as {
    sub: string; email: string; email_verified: boolean; name?: string; picture?: string; aud: string;
  };
  if (!claims.email_verified || claims.aud !== config.google.id) return fail(req, "Google account email isn't verified.");

  const uid = await upsertUser({ email: claims.email, googleId: claims.sub, name: claims.name ?? null, picture: claims.picture ?? null });
  const headers = new Headers({ Location: new URL(saved.next, req.url).toString() });
  headers.append("Set-Cookie", sessionCookie(uid));
  headers.append("Set-Cookie", "co_oauth=; Path=/api/auth; Max-Age=0");
  return new Response(null, { status: 302, headers });
}
