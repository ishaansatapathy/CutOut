"use client";
/* eslint-disable @next/next/no-img-element */

import { createContext, useContext, useState } from "react";
import { api } from "@/trpc/client";
import { Modal } from "./Modal";

type Ui = { signIn: (reason?: string) => void; buy: (reason?: string) => void };
const UiCtx = createContext<Ui>({ signIn: () => {}, buy: () => {} });
export const useAccountUi = () => useContext(UiCtx);
export const useMe = () => api.me.useQuery(undefined, { staleTime: 5_000 });

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay() {
  return new Promise<void>((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res();
    s.onerror = () => rej(new Error("Couldn't load payment window."));
    document.body.appendChild(s);
  });
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [signIn, setSignIn] = useState<string | null>(null);
  const [buy, setBuy] = useState<string | null>(null);
  return (
    <UiCtx.Provider value={{ signIn: (r) => setSignIn(r ?? ""), buy: (r) => setBuy(r ?? "") }}>
      {children}
      <SignInModal reason={signIn} onClose={() => setSignIn(null)} />
      <BuyModal reason={buy} onClose={() => setBuy(null)} />
    </UiCtx.Provider>
  );
}

function SignInModal({ reason, onClose }: { reason: string | null; onClose: () => void }) {
  const me = useMe();
  const utils = api.useUtils();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const devLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/auth/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    if (!r.ok) return setErr(((await r.json()) as { error?: string }).error ?? "Sign-in failed");
    await utils.invalidate();
    onClose();
  };
  const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/app";
  return (
    <Modal open={reason !== null} onClose={onClose} title="Sign in to CutOut">
      {reason && <p className="modal-note">{reason}</p>}
      <a className="btn btn-k btn-block" href={`/api/auth/google?next=${encodeURIComponent(next)}`} id="google-signin">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>
        Continue with Google
      </a>
      {me.data?.devLogin && (
        <form className="dev-box" onSubmit={devLogin}>
          <span className="dev-tag">Test mode</span>
          <p>Google keys aren&apos;t set yet, so you can sign in locally with any email.</p>
          <div className="inline-form">
            <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <button className="btn btn-y btn-sm" id="dev-signin">Sign in</button>
          </div>
          {err && <p className="form-err">{err}</p>}
        </form>
      )}
      <p className="modal-fine">We only use your Google email and name. No free credits on sign-up — just more free daily uses.</p>
    </Modal>
  );
}

function BuyModal({ reason, onClose }: { reason: string | null; onClose: () => void }) {
  const me = useMe();
  const packs = api.credits.packs.useQuery();
  const utils = api.useUtils();
  const create = api.credits.createOrder.useMutation();
  const verify = api.credits.verify.useMutation();
  const devComplete = api.credits.devComplete.useMutation();
  const [msg, setMsg] = useState<string | null>(null);

  const buy = async (pack: string) => {
    setMsg(null);
    try {
      const o = await create.mutateAsync({ pack });
      if (!o.keyId) {
        await devComplete.mutateAsync({ orderId: o.orderId });
        await utils.me.invalidate();
        setMsg(`Test purchase done: +${o.pack.credits} credits.`);
        return;
      }
      await loadRazorpay();
      new window.Razorpay!({
        key: o.keyId, order_id: o.orderId, amount: o.amount, currency: "INR", name: "CutOut :)",
        description: `${o.pack.credits} credits`, prefill: { email: me.data?.user?.email ?? "" },
        theme: { color: "#FFD60A" }, method: { upi: true, card: true, netbanking: true, wallet: true },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          await verify.mutateAsync({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
          await utils.me.invalidate();
          setMsg(`Payment received: +${o.pack.credits} credits.`);
        },
      }).open();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Modal open={reason !== null} onClose={onClose} title="Buy credits" wide>
      {reason && <p className="modal-note">{reason}</p>}
      {!me.data?.user ? (
        <p className="modal-note">Sign in first so your credits are saved to your account.</p>
      ) : (
        <>
          <div className="packs">
            {packs.data?.map((p) => (
              <button key={p.id} className={`pack ${p.id === "creator" ? "hot" : ""}`} onClick={() => buy(p.id)} disabled={create.isPending} id={`buy-${p.id}`}>
                <b>₹{p.price}</b>
                <span>{p.credits} credits</span>
                <small>₹{(p.price / p.credits).toFixed(2)} / credit</small>
              </button>
            ))}
          </div>
          <p className="modal-fine">
            1 credit = 1 image or generation · video is 1 credit/sec at 720p, 2 at 1080p · paid jobs have no ads.
            {me.data.devPayments && <><br /><span className="dev-tag">Test mode</span> Razorpay keys aren&apos;t set, so purchases are simulated.</>}
          </p>
        </>
      )}
      {msg && <p className="modal-msg" role="status">{msg}</p>}
    </Modal>
  );
}

export function AccountBar() {
  const me = useMe();
  const ui = useAccountUi();
  const utils = api.useUtils();
  if (!me.data) return <div className="acct skeleton-line" />;
  const { user, usage } = me.data;
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await utils.invalidate();
  };
  return (
    <div className="acct">
      <div className="acct-meter" title="Free image uses">
        <div className="cells">
          {Array.from({ length: usage.imageLimit }).map((_, i) => <i key={i} className={i < usage.imageLeft ? "on" : ""} />)}
        </div>
        <span><b>{usage.imageLeft}</b> free {user ? "today" : "left"}</span>
      </div>
      {user ? (
        <>
          <button className="acct-credits" onClick={() => ui.buy()} id="acct-credits">
            <b>{usage.credits}</b> credits <span>+</span>
          </button>
          <details className="acct-menu">
            <summary aria-label="Account menu">
              {user.picture ? <img src={user.picture} alt="" /> : <span>{(user.name ?? user.email)[0].toUpperCase()}</span>}
            </summary>
            <div className="acct-pop">
              <p><b>{user.name ?? "Signed in"}</b><br />{user.email}</p>
              <a href="/account">Account & API keys</a>
              <button onClick={logout} id="logout">Sign out</button>
            </div>
          </details>
        </>
      ) : (
        <button className="btn btn-k btn-sm" onClick={() => ui.signIn()} id="acct-signin">Sign in</button>
      )}
    </div>
  );
}
