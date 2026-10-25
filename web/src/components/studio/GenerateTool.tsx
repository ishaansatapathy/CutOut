"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { download, errorText } from "./SelectStage";
import { useRefund, useUnlock } from "./unlock";

const SIZES = [
  { id: "square", label: "Square", r: "1 / 1" },
  { id: "portrait", label: "Portrait", r: "2 / 3" },
  { id: "landscape", label: "Landscape", r: "3 / 2" },
] as const;
const IDEAS = ["a ceramic coffee mug on a marble counter, soft morning light", "a red sneaker floating on a plain studio background", "a cosy reading corner with plants, illustration"];

export function GenerateTool({ onSendToRemove }: { onSendToRemove: (f: File) => void }) {
  const unlock = useUnlock();
  const refundIfPaid = useRefund();
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<(typeof SIZES)[number]["id"]>("square");
  const [out, setOut] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (prompt.trim().length < 3) return setError("Describe the image you want.");
    const grant = await unlock("generate", "Generate an image");
    if (!grant) return;
    setBusy(true);
    const r = await fetch("/ai/v1/images/generate", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Job-Token": grant.token },
      body: JSON.stringify({ prompt, size }),
    });
    setBusy(false);
    if (!r.ok) { await refundIfPaid(grant); return setError(await errorText(r)); }
    const blob = await r.blob();
    setOut({ url: URL.createObjectURL(blob), blob });
  };

  return (
    <div className="tool-body">
      {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
      <div className="gen">
        <form className="gen-form" onSubmit={go}>
          <label className="opt-label" htmlFor="gen-prompt">Describe the image</label>
          <textarea id="gen-prompt" className="text-in" rows={4} maxLength={300} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="a yellow vintage scooter on a quiet street, product photo" />
          <div className="ideas">
            {IDEAS.map((i) => <button type="button" key={i} onClick={() => setPrompt(i)}>{i.split(",")[0]}</button>)}
          </div>
          <span className="opt-label">Shape</span>
          <div className="seg">
            {SIZES.map((s) => <button type="button" key={s.id} className={size === s.id ? "on" : ""} onClick={() => setSize(s.id)}>{s.label}</button>)}
          </div>
          <button className="btn btn-k btn-block" disabled={busy} id="gen-go">{busy ? "Generating…" : "Generate · 1 credit"}</button>
          <p className="fine-left">Credits only, no ads. Every image is saved with an &quot;AI-generated&quot; label in its file data.</p>
        </form>
        <div className="gen-out" style={{ aspectRatio: SIZES.find((s) => s.id === size)!.r }}>
          {busy ? <span className="spin" aria-label="Generating" /> : out ? (
            <>
              <img src={out.url} alt={`Generated: ${prompt}`} />
              <span className="ai-badge">AI-generated</span>
            </>
          ) : <p className="muted">Your image appears here.</p>}
        </div>
      </div>
      {out && !busy && (
        <div className="toolbar end">
          <button className="btn btn-line btn-sm" onClick={() => onSendToRemove(new File([out.blob], "generated.png", { type: "image/png" }))} id="gen-to-remove">
            Remove its background →
          </button>
          <button className="btn btn-k btn-sm" onClick={() => download(out.url, "generated.png")} id="gen-download">Download PNG ↓</button>
        </div>
      )}
    </div>
  );
}
