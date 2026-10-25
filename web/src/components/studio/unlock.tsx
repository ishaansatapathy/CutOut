"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { creditCost, type Tool } from "@/lib/rules";
import { api } from "@/trpc/client";
import { useAccountUi, useMe } from "./account";
import { Modal } from "./Modal";

declare global {
  interface Window {
    turnstile?: {
      render: (el: string | HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

let turnstileLoad: Promise<void> | null = null;
function loadTurnstile() {
  turnstileLoad ??= new Promise((res, rej) => {
    if (window.turnstile) return res();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("Couldn't load the verification widget."));
    document.head.appendChild(s);
  });
  return turnstileLoad;
}

/** Cloudflare Turnstile ("prove you're not a bot") for the free tier. Renders nothing when no site key is set. */
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const elId = useId().replace(/:/g, "");
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadTurnstile().then(() => {
      if (cancelled || !window.turnstile) return;
      widgetId.current = window.turnstile.render(`#${elId}`, {
        sitekey: siteKey,
        theme: "light",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, elId]);

  return <div id={elId} className="turnstile-box" />;
}

export type VideoOpts = { seconds: number; res: 480 | 720 | 1080 };
export type Grant = { token: string; jti: string; limits: { sec?: number; res?: number }; charged: number };
type Req = { tool: Tool; video?: VideoOpts; label: string; resolve: (g: Grant | null) => void };

const Ctx = createContext<(tool: Tool, label: string, video?: VideoOpts) => Promise<Grant | null>>(async () => null);
export const useUnlock = () => useContext(Ctx);

/** Returns a function that refunds a paid grant's credits after the job fails on the server. No-op for free (ad) jobs. */
export function useRefund() {
  const refund = api.jobs.refund.useMutation();
  const utils = api.useUtils();
  return async (grant: Grant | null | undefined) => {
    if (!grant || grant.charged <= 0) return;
    try {
      await refund.mutateAsync({ jti: grant.jti });
    } catch {
      /* best effort */
    }
    await utils.me.invalidate();
  };
}

export function UnlockProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Req | null>(null);
  const unlock = useCallback(
    (tool: Tool, label: string, video?: VideoOpts) => new Promise<Grant | null>((resolve) => setReq({ tool, label, video, resolve })),
    [],
  );
  const done = (g: Grant | null) => {
    req?.resolve(g);
    setReq(null);
  };
  return (
    <Ctx.Provider value={unlock}>
      {children}
      {req && <UnlockModal req={req} onDone={done} />}
    </Ctx.Provider>
  );
}

function UnlockModal({ req, onDone }: { req: Req; onDone: (g: Grant | null) => void }) {
  const me = useMe();
  const ui = useAccountUi();
  const utils = api.useUtils();
  const request = api.jobs.request.useMutation();
  const [ads, setAds] = useState<{ adSession: string; required: number } | null>(null);
  const [blocked, setBlocked] = useState<{ reason: string; message: string } | null>(null);
  const [tsToken, setTsToken] = useState<string | null>(null);

  if (!me.data) return null;
  const { user, usage, rules, turnstileSiteKey } = me.data;
  const cost = creditCost(req.tool, req.video);
  const enough = !!user && usage.credits >= cost;
  const freeAllowed = req.tool !== "generate" && !(req.tool === "video" && req.video && req.video.res > rules.video.freeRes);
  const adCount = req.tool === "video" ? rules.video.adsPerJob : rules.image.adsPerJob;
  // Signed-in users already cost more to script (a real Google account) and are capped
  // per-day regardless, so only anonymous requests need the human check.
  const needsTurnstile = !user && !!turnstileSiteKey;

  const go = async (pay: "ads" | "credits") => {
    setBlocked(null);
    try {
      const r = await request.mutateAsync({ tool: req.tool, pay, video: req.video, turnstileToken: tsToken ?? undefined });
      if (r.kind === "blocked") return setBlocked(r);
      if (r.kind === "ads") return setAds(r);
      await utils.me.invalidate();
      onDone({ token: r.token, jti: r.jti, limits: r.limits, charged: r.charged });
    } catch (e) {
      setBlocked({ reason: "invalid", message: (e as Error).message });
    }
  };

  if (ads) {
    return (
      <Modal open title="Unlock with ads" onClose={() => onDone(null)}>
        <AdPlayer
          session={ads}
          onGrant={async (g) => { await utils.me.invalidate(); onDone(g); }}
          onError={(m) => { setAds(null); setBlocked({ reason: "invalid", message: m }); }}
        />
      </Modal>
    );
  }

  return (
    <Modal open title={req.label} onClose={() => onDone(null)}>
      <div className="pay-options">
        {freeAllowed && (
          <div className="pay-opt-wrap">
            <button
              className="pay-opt"
              onClick={() => go("ads")}
              disabled={request.isPending || (needsTurnstile && !tsToken)}
              id="pay-ads"
            >
              <span className="pay-k">Free</span>
              <b>Watch {adCount} short ads</b>
              <small>
                {req.tool === "video"
                  ? `Up to ${rules.video.freeSeconds}s at ${rules.video.freeRes}p · 1 a day · needs sign-in`
                  : user ? `${usage.imageLeft} free left today` : `${usage.imageLeft} free left on this device`}
              </small>
            </button>
            {needsTurnstile && <Turnstile siteKey={turnstileSiteKey} onToken={setTsToken} />}
          </div>
        )}
        <button className={`pay-opt ${enough ? "best" : ""}`} onClick={() => (user ? (enough ? go("credits") : ui.buy(`You need ${cost} credits for this.`)) : ui.signIn("Sign in to use credits."))} disabled={request.isPending} id="pay-credits">
          <span className="pay-k">No ads</span>
          <b>Use {cost} credit{cost === 1 ? "" : "s"}</b>
          <small>{user ? `You have ${usage.credits}` : "Sign in to use credits"}{user && !enough ? " · top up" : ""}</small>
        </button>
      </div>
      {blocked && (
        <div className="blocked" role="alert">
          <p>{blocked.message}</p>
          {blocked.reason === "login" && <button className="btn btn-k btn-sm" onClick={() => ui.signIn(blocked.message)}>Sign in with Google</button>}
          {(blocked.reason === "credits" || blocked.reason === "limit") && user && <button className="btn btn-y btn-sm" onClick={() => ui.buy(blocked.message)}>Buy credits</button>}
        </div>
      )}
    </Modal>
  );
}

type Googletag = {
  cmd: { push: (f: () => void) => void };
  enums: { OutOfPageFormat: { REWARDED: unknown } };
  defineOutOfPageSlot: (unit: string, fmt: unknown) => { addService: (s: unknown) => unknown } | null;
  pubads: () => { addEventListener: (ev: string, cb: (e: { makeRewardedVisible?: () => void }) => void) => void };
  enableServices: () => void;
  display: (slot: unknown) => void;
  destroySlots: (slots: unknown[]) => void;
};

function showGptRewarded(unit: string): Promise<boolean> {
  return new Promise((resolve) => {
    const w = window as unknown as { googletag?: Googletag };
    const start = () => {
      const g = w.googletag!;
      g.cmd.push(() => {
        const slot = g.defineOutOfPageSlot(unit, g.enums.OutOfPageFormat.REWARDED);
        if (!slot) return resolve(false);
        slot.addService(g.pubads());
        let granted = false;
        g.pubads().addEventListener("rewardedSlotReady", (e) => e.makeRewardedVisible?.());
        g.pubads().addEventListener("rewardedSlotGranted", () => { granted = true; });
        g.pubads().addEventListener("rewardedSlotClosed", () => { g.destroySlots([slot]); resolve(granted); });
        g.enableServices();
        g.display(slot);
      });
    };
    if (w.googletag) return start();
    const s = document.createElement("script");
    s.src = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
    s.async = true;
    s.onload = start;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

function AdPlayer({ session, onGrant, onError }: {
  session: { adSession: string; required: number }; onGrant: (g: Grant) => void; onError: (m: string) => void;
}) {
  const next = api.ads.next.useMutation();
  const reward = api.ads.reward.useMutation();
  const provider = process.env.NEXT_PUBLIC_AD_PROVIDER ?? "test";
  const unit = process.env.NEXT_PUBLIC_GPT_REWARDED_UNIT ?? "";
  const [ad, setAd] = useState<{ adId: string; index: number; required: number; minMs: number } | null>(null);
  const [left, setLeft] = useState(0);
  const cbs = useRef({ next, reward, onGrant, onError });
  useEffect(() => {
    cbs.current = { next, reward, onGrant, onError };
  });

  useEffect(() => {
    let cancelled = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      const c = () => cbs.current;
      try {
        while (!cancelled) {
          const a = await c().next.mutateAsync({ adSession: session.adSession });
          if (cancelled) return;
          setAd(a);
          if (provider === "gpt" && unit) {
            const t0 = Date.now();
            if (!(await showGptRewarded(unit))) return c().onError("The ad didn't finish, so nothing was unlocked. Try again.");
            await wait(Math.max(0, a.minMs - (Date.now() - t0)));
          } else {
            for (let s = Math.ceil(a.minMs / 1000); s > 0 && !cancelled; s--) {
              setLeft(s);
              await wait(1000);
            }
            setLeft(0);
          }
          if (cancelled) return;
          const r = await c().reward.mutateAsync({ adSession: session.adSession, adId: a.adId });
          if (r.kind === "error") return c().onError(r.message);
          if (r.kind === "token") return c().onGrant({ token: r.token, jti: r.jti, limits: r.limits, charged: 0 });
        }
      } catch (e) {
        if (!cancelled) c().onError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [session.adSession, provider, unit]);

  const idx = ad?.index ?? 1;
  return (
    <div className="adplayer">
      <div className="ad-dots">
        {Array.from({ length: session.required }).map((_, i) => <i key={i} className={i < idx - 1 ? "done" : i === idx - 1 ? "on" : ""} />)}
      </div>
      {provider === "gpt" && unit ? (
        <p className="ad-wait">Ad {idx} of {session.required} is playing…</p>
      ) : (
        <div className="ad-test" aria-live="polite">
          <span className="dev-tag">Test ad</span>
          <b>Ad {idx} of {session.required}</b>
          <p>A real rewarded ad plays here once an ad network is connected.</p>
          <div className="ad-count">{left > 0 ? `${left}s` : "…"}</div>
        </div>
      )}
      <p className="modal-fine">Ads keep the free tier free. Credits skip them entirely.</p>
    </div>
  );
}
