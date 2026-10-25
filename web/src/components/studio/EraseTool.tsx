"use client";

import { useRef, useState } from "react";
import { type Box, download, Dropzone, errorText, ModeSwitch, type Mode, type Pt, SelectStage } from "./SelectStage";
import { useRefund, useUnlock } from "./unlock";

export function EraseTool() {
  const unlock = useUnlock();
  const refundIfPaid = useRefund();
  const [sid, setSid] = useState<string | null>(null);
  const [src, setSrc] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<Mode>("add");
  const [points, setPoints] = useState<Pt[]>([]);
  const [box, setBox] = useState<Box | null>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const req = useRef(0);

  const start = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    if (file.size > 20 * 1024 * 1024) return setError("Images must be under 20 MB.");
    const grant = await unlock("erase", "Erase objects from a photo");
    if (!grant) return;
    setStatus("Uploading…");
    const fd = new FormData();
    fd.append("image", file);
    const r = await fetch("/ai/v1/images/erase/session", { method: "POST", body: fd, headers: { "X-Job-Token": grant.token } });
    setStatus(null);
    if (!r.ok) { await refundIfPaid(grant); return setError(await errorText(r)); }
    const j = await r.json();
    setSrc(URL.createObjectURL(file));
    setSize({ w: j.width, h: j.height });
    setSid(j.session_id);
    setCount(0);
  };

  const select = async (pts: Pt[], bx: Box | null) => {
    setPoints(pts);
    setBox(bx);
    if (!sid || (!pts.length && !bx)) return setMask(null);
    const id = ++req.current;
    setStatus("Finding the object…");
    const r = await fetch(`/ai/v1/images/session/${sid}/segment`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: pts, box: bx }),
    });
    if (id !== req.current) return;
    setStatus(null);
    if (!r.ok) return setError(await errorText(r));
    setMask(URL.createObjectURL(await r.blob()));
  };

  const erase = async () => {
    setStatus("Erasing…");
    const r = await fetch(`/ai/v1/images/session/${sid}/erase`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points, box }),
    });
    setStatus(null);
    if (!r.ok) return setError(await errorText(r));
    setSrc(URL.createObjectURL(await r.blob()));
    setPoints([]);
    setBox(null);
    setMask(null);
    setCount((c) => c + 1);
  };

  if (!sid) {
    return (
      <div className="tool-body">
        {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
        <Dropzone id="erase-file" accept="image/*" label={status ?? "Drop a photo to clean up"} hint="Remove a photobomber, a bin, a wire, a logo on your own product" onFile={start} />
      </div>
    );
  }

  return (
    <div className="tool-body">
      {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
      <div className="toolbar">
        <ModeSwitch mode={mode} setMode={setMode} keepLabel="Object" removeLabel="Not this" />
        <span className="spacer" />
        <button className="btn btn-line btn-sm" onClick={() => setSid(null)}>New image</button>
        <button className="btn btn-line btn-sm" onClick={() => download(src, "erased.png")} disabled={!count} id="erase-download">Download ↓</button>
        <button className="btn btn-k btn-sm" onClick={erase} disabled={!mask || !!status} id="erase-go">Erase it</button>
      </div>
      <div className="work single">
        <SelectStage src={src} w={size.w} h={size.h} mode={mode} points={points} box={box} onChange={select} status={status}>
          {mask && <div className="layer mask-tint" style={{ WebkitMaskImage: `url(${mask})`, maskImage: `url(${mask})` }} />}
        </SelectStage>
      </div>
      <p className="hint">Click the thing to remove, check the highlight, then press <b>Erase it</b>. You can erase more than one thing.</p>
    </div>
  );
}
