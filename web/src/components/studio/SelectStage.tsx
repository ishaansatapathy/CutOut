"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";

export type Pt = { x: number; y: number; label: 0 | 1 };
export type Box = [number, number, number, number];
export type Mode = "add" | "remove" | "box";

export function ModeSwitch({ mode, setMode, keepLabel = "Keep", removeLabel = "Remove" }: {
  mode: Mode; setMode: (m: Mode) => void; keepLabel?: string; removeLabel?: string;
}) {
  const items: [Mode, string][] = [["add", `＋ ${keepLabel}`], ["remove", `－ ${removeLabel}`], ["box", "▭ Box"]];
  return (
    <div className="seg" role="radiogroup" aria-label="Selection mode">
      {items.map(([m, l]) => (
        <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)} id={`mode-${m}`}>{l}</button>
      ))}
    </div>
  );
}

export function SelectStage({ src, w, h, mode, points, box, onChange, busy, status, children, className = "", style, hideBase = false }: {
  src: string; w: number; h: number; mode: Mode; points: Pt[]; box: Box | null;
  onChange: (points: Pt[], box: Box | null) => void; busy?: boolean; status?: string | null;
  children?: React.ReactNode; className?: string; style?: React.CSSProperties; hideBase?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Box | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * w),
      y: Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * h),
    };
  };

  const down = (e: React.PointerEvent) => {
    drag.current = pos(e);
    ref.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current || mode !== "box") return;
    const p = pos(e), d = drag.current;
    setLive([Math.min(d.x, p.x), Math.min(d.y, p.y), Math.max(d.x, p.x), Math.max(d.y, p.y)]);
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setLive(null);
    if (!d) return;
    const p = pos(e);
    if (mode === "box") {
      if (Math.hypot(p.x - d.x, p.y - d.y) < Math.max(w, h) * 0.01) return;
      onChange(points, [Math.min(d.x, p.x), Math.min(d.y, p.y), Math.max(d.x, p.x), Math.max(d.y, p.y)]);
    } else {
      onChange([...points, { ...p, label: mode === "add" ? 1 : 0 }], box);
    }
  };

  const b = live ?? box;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div className={`sstage ${className}`} style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(72vh * ${w / h}))`, ...style }}>
      <img className="layer contain" src={src} alt="Your upload" draggable={false} style={hideBase ? { visibility: "hidden" } : undefined} />
      {children}
      <div
        ref={ref}
        className={`sstage-hit ${mode === "box" ? "boxing" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        role="application"
        aria-label="Click to select. Use Box mode to drag a rectangle."
      >
        {b && <span className="sbox" style={{ left: pct(b[0], w), top: pct(b[1], h), width: pct(b[2] - b[0], w), height: pct(b[3] - b[1], h) }} />}
        {points.map((p, i) => <span key={i} className={`spt ${p.label ? "add" : "rem"}`} style={{ left: pct(p.x, w), top: pct(p.y, h) }} />)}
      </div>
      <span className={`sstatus ${busy || status ? "" : "off"}`}>{status ?? "Working…"}</span>
    </div>
  );
}

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

export function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

export async function errorText(r: Response) {
  try {
    const j = await r.json();
    return (j as { detail?: string; error?: string }).detail ?? (j as { error?: string }).error ?? `Error ${r.status}`;
  } catch {
    return `Error ${r.status}`;
  }
}

export function Dropzone({ accept, label, hint, onFile, id }: {
  accept: string; label: string; hint: string; onFile: (f: File) => void; id: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`dropzone ${over ? "over" : ""}`}
      htmlFor={id}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    >
      <span className="ico" aria-hidden>↑</span>
      <strong>{label}</strong>
      <span className="muted">{hint}</span>
      <input id={id} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}
