import { config } from "./config";

/**
 * Anonymous-abuse guard for the free (ad-unlocked) path only — signed-in users already pay
 * with a Google account + daily caps, which is a much higher cost to script than a bare
 * device cookie. No-op (always passes) until TURNSTILE_SECRET_KEY is set, same test-mode
 * pattern as every other optional integration in this app.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!config.turnstile.secret) return true;
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.turnstile.secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { success: boolean };
    return !!j.success;
  } catch {
    return false;
  }
}
