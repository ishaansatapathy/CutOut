"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { creditCost, type Tool } from "@/lib/rules";
import { api } from "@/trpc/client";
import { useAccountUi, useMe } from "./account";
import { Modal } from "./Modal";

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

  if (!me.data) return null;
  const { user, usage, rules } = me.data;
  const cost = creditCost(req.tool, req.video);
  const enough = !!user && usage.credits >= cost;
  const freeAllowed = req.tool !== "generate" && !(req.tool === "video" && req.video && req.video.res > rules.video.freeRes);
  const adCount = req.tool === "video" ? rules.video.adsPerJob : rules.image.adsPerJob;

  const go = async (pay: "ads" | "credits") => {
    setBlocked(null);
    try {
      const r = await request.mutateAsync({ tool: req.tool, pay, video: req.video });
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
          <button className="pay-opt" onClick={() => go("ads")} disabled={request.isPending} id="pay-ads">
            <span className="pay-k">Free</span>
            <b>Watch {adCount} short ads</b>
            <small>
              {req.tool === "video"
                ? `Up to ${rules.video.freeSeconds}s at ${rules.video.freeRes}p · 1 a day · needs sign-in`
                : user ? `${usage.imageLeft} free left today` : `${usage.imageLeft} free left on this device`}
            </small>
          </button>
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
