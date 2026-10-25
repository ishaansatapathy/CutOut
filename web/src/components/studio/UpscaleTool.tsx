"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import { download, Dropzone, errorText } from "./SelectStage";
import { useRefund, useUnlock } from "./unlock";

export function UpscaleTool() {
  const unlock = useUnlock();
  const refundIfPaid = useRefund();
  const [orig, setOrig] = useState<string | null>(null);
  const [out, setOut] = useState<{ url: string; w: number; h: number; method: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cmp = useRef<HTMLDivElement>(null);

  const start = async (file: File) => {
    setError(null);
    setOut(null);
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    const url = URL.createObjectURL(file);
    const dims = await new Promise<{ w: number; h: number }>((res) => {
      const i = new Image();
      i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
      i.src = url;
    });
    if (Math.max(dims.w, dims.h) > 2048) return setError("Upscale is for images up to 2048 px on the long side.");
    const grant = await unlock("upscale", "Upscale an image 2×");
    if (!grant) return;
    setOrig(url);
    setStatus("Uploading…");
    const fd = new FormData();
    fd.append("image", file);
    let r = await fetch("/ai/v1/images/upscale/session", { method: "POST", body: fd, headers: { "X-Job-Token": grant.token } });
    if (!r.ok) { setStatus(null); await refundIfPaid(grant); return setError(await errorText(r)); }
    const { session_id } = await r.json();
    setStatus("Upscaling 2×…");
    r = await fetch(`/ai/v1/images/session/${session_id}/upscale`, { method: "POST" });
    setStatus(null);
    if (!r.ok) { await refundIfPaid(grant); return setError(await errorText(r)); }
    setOut({ url: URL.createObjectURL(await r.blob()), w: dims.w * 2, h: dims.h * 2, method: r.headers.get("X-Upscale-Method") ?? "" });
  };

  const move = (e: React.PointerEvent) => {
    const r = cmp.current!.getBoundingClientRect();
    cmp.current!.style.setProperty("--pos", `${Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))}%`);
  };

  return (
    <div className="tool-body">
      {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
      {!orig ? (
        <Dropzone id="upscale-file" accept="image/*" label="Drop a small or blurry image" hint="Doubles the width and height · up to 2048 px input" onFile={start} />
      ) : (
        <>
          <div className="toolbar">
            <span className="tool-note">{out ? `${out.w} × ${out.h} px${out.method === "lanczos" ? " · basic resize (AI model not loaded)" : ""}` : status}</span>
            <span className="spacer" />
            <button className="btn btn-line btn-sm" onClick={() => { setOrig(null); setOut(null); }}>New image</button>
            <button className="btn btn-k btn-sm" disabled={!out} onClick={() => out && download(out.url, "upscaled.png")} id="upscale-download">Download PNG ↓</button>
          </div>
          <div className="up-cmp" ref={cmp} onPointerMove={move} onPointerDown={move}>
            <img src={orig} alt="Original" className="up-img pix" />
            {out ? <img src={out.url} alt="Upscaled" className="up-img after" /> : <span className="spin center" aria-label="Working" />}
            {out && <><span className="up-handle" /><span className="cmp-tag l">Original</span><span className="cmp-tag r">2× AI</span></>}
          </div>
          <p className="hint">Move across the image to compare. Zoomed in so the difference is visible.</p>
        </>
      )}
    </div>
  );
}
