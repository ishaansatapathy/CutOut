"use client";

import { useState } from "react";
import { RULES } from "@/lib/rules";
import { api } from "@/trpc/client";
import { AccountBar, useAccountUi, useMe } from "./account";

export function AccountPage() {
  return <Inner />;
}

const REASONS: Record<string, string> = {
  purchase: "Credit pack", remove: "Background removal", erase: "Erase object", upscale: "Upscale",
  video: "Video", generate: "Image generation",
};

function Inner() {
  const me = useMe();
  const ui = useAccountUi();
  const user = me.data?.user;
  const history = api.credits.history.useQuery(undefined, { enabled: !!user });
  const keys = api.apiKeys.list.useQuery(undefined, { enabled: !!user });
  const utils = api.useUtils();
  const create = api.apiKeys.create.useMutation({ onSuccess: () => utils.apiKeys.list.invalidate() });
  const revoke = api.apiKeys.revoke.useMutation({ onSuccess: () => utils.apiKeys.list.invalidate() });
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <main className="app-shell wrap">
      <div className="app-top">
        <div>
          <span className="eyebrow">Account</span>
          <h1>Credits & <em>API keys.</em></h1>
        </div>
        <AccountBar />
      </div>

      {!user ? (
        <section className="tool-card pad center-col">
          <p>Sign in to see your credits and create API keys.</p>
          <button className="btn btn-k" onClick={() => ui.signIn()}>Sign in</button>
        </section>
      ) : (
        <div className="acct-grid">
          <section className="tool-card pad">
            <h3>Credits</h3>
            <p className="big-num">{me.data?.usage.credits ?? 0}</p>
            <button className="btn btn-y" onClick={() => ui.buy()} id="acct-buy">Buy credits</button>
            <ul className="ledger">
              {history.data?.length ? history.data.map((h, i) => (
                <li key={i}>
                  <span>{REASONS[h.reason] ?? h.reason}</span>
                  <span className="when">{new Date(h.created_at).toLocaleDateString()}</span>
                  <b className={h.delta > 0 ? "plus" : ""}>{h.delta > 0 ? `+${h.delta}` : h.delta}</b>
                </li>
              )) : <li className="muted">No credit activity yet.</li>}
            </ul>
          </section>

          <section className="tool-card pad">
            <h3>API keys</h3>
            <p className="muted">
              {RULES.api.freeImagesPerMonth} free images a month, then billed from your credits. No ads on the API.
              Send <code>Authorization: Bearer &lt;key&gt;</code>.
            </p>
            <form className="inline-form" onSubmit={async (e) => {
              e.preventDefault();
              const k = await create.mutateAsync({ name: name || "My key" });
              setFresh(k.key);
              setCopied(false);
              setName("");
            }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Shopify sync" aria-label="Key name" />
              <button className="btn btn-k btn-sm" disabled={create.isPending} id="key-create">Create key</button>
            </form>
            {fresh && (
              <div className="fresh-key" role="status">
                <p><b>Copy this key now.</b> We only store a hash, so it won&apos;t be shown again.</p>
                <code>{fresh}</code>
                <button className="btn btn-line btn-sm" onClick={async () => { await navigator.clipboard.writeText(fresh); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
              </div>
            )}
            <ul className="keys">
              {keys.data?.map((k) => (
                <li key={k.id}>
                  <div><b>{k.name}</b><code>{k.prefix}…</code></div>
                  <span className="when">{k.last_used_at ? `Used ${new Date(k.last_used_at).toLocaleDateString()}` : "Never used"}</span>
                  <button className="link danger" onClick={() => revoke.mutate({ id: k.id })}>Revoke</button>
                </li>
              ))}
            </ul>
            <details className="api-ref">
              <summary>Endpoints</summary>
              <pre>{`POST /api/v1/images/remove-background   image, prompt={"points":[{"x":420,"y":310,"label":1}]}
POST /api/v1/images/generate            {"prompt": "...", "size": "square"}
POST /api/v1/videos/remove-background   video, prompt, seconds, res=720|1080
GET  /api/v1/jobs/{id}                  status and progress
GET  /api/v1/jobs/{id}/result?format=webm|mp4&color=%23ffffff
GET  /api/v1/usage`}</pre>
            </details>
          </section>
        </div>
      )}
    </main>
  );
}
