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
