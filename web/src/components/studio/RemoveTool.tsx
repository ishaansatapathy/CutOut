"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { ID_PRESETS, idPhoto, printSheet, profile, sticker, thumbnail, type IdPreset } from "./compose";
import { type Box, download, Dropzone, errorText, loadImage, ModeSwitch, type Mode, type Pt, SelectStage } from "./SelectStage";
import { useRefund, useUnlock } from "./unlock";

const BGS = [
  { id: "none", c: "", label: "Transparent" },
  { id: "white", c: "#ffffff", label: "White" },
  { id: "yellow", c: "#ffd60a", label: "Yellow" },
  { id: "black", c: "#0b0b0b", label: "Black" },
];
type Make = "png" | "sticker" | "profile" | "id" | "thumb";
const MAKES: { id: Make; label: string; hint: string }[] = [
  { id: "png", label: "Cutout PNG", hint: "Transparent or on a colour" },
  { id: "sticker", label: "Sticker", hint: "WhatsApp & Instagram, 512×512" },
  { id: "profile", label: "Profile picture", hint: "Head & shoulders, circle or square" },
  { id: "id", label: "ID / passport photo", hint: "Sized to common specs, print sheet" },
  { id: "thumb", label: "YouTube thumbnail", hint: "1280×720 with big text" },
];

export function RemoveTool({ initialFile, onConsumed }: { initialFile?: File | null; onConsumed?: () => void }) {
  const unlock = useUnlock();
  const refundIfPaid = useRefund();
  const [sid, setSid] = useState<string | null>(null);
  const [src, setSrc] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<Mode>("add");
  const [points, setPoints] = useState<Pt[]>([]);
  const [box, setBox] = useState<Box | null>(null);
  const [cut, setCut] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bg, setBg] = useState("");
  const [make, setMake] = useState<Make>("png");
  const req = useRef(0);
  const handoffUrl = useMemo(() => (initialFile ? URL.createObjectURL(initialFile) : ""), [initialFile]);

  const start = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    if (file.size > 20 * 1024 * 1024) return setError("Images must be under 20 MB.");
    const grant = await unlock("remove", "Remove a background");
    if (!grant) return;
    setStatus("Uploading…");
    const fd = new FormData();
    fd.append("image", file);
    const r = await fetch("/ai/v1/images/remove/session", { method: "POST", body: fd, headers: { "X-Job-Token": grant.token } });
    setStatus(null);
    if (!r.ok) { await refundIfPaid(grant); return setError(await errorText(r)); }
    const j = await r.json();
    setSrc(URL.createObjectURL(file));
    setSize({ w: j.width, h: j.height });
    setSid(j.session_id);
    setPoints([]);
    setBox(null);
    setCut(null);
  };

  const segment = async (pts: Pt[], bx: Box | null) => {
    setPoints(pts);
    setBox(bx);
    if (!sid) return;
    if (!pts.length && !bx) return setCut(null);
    const id = ++req.current;
    setStatus("Cutting out…");
    const r = await fetch(`/ai/v1/images/session/${sid}/segment`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: pts, box: bx }),
    });
    if (id !== req.current) return;
    setStatus(null);
    if (!r.ok) return setError(await errorText(r));
    setCut(URL.createObjectURL(await r.blob()));
  };

  const undo = () => (box && !points.length ? segment(points, null) : segment(points.slice(0, -1), box));

  if (!sid) {
    return (
      <div className="tool-body">
        {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
        {initialFile && !status ? (
          <div className="handoff">
            <img src={handoffUrl} alt="Generated image" />
            <div>
              <b>Your generated image is ready</b>
              <p>Remove its background to use it as a sticker, product shot or thumbnail.</p>
              <div className="toolbar">
                <button className="btn btn-k btn-sm" onClick={() => { onConsumed?.(); void start(initialFile); }} id="handoff-go">Remove background</button>
                <button className="btn btn-line btn-sm" onClick={() => onConsumed?.()}>Use another image</button>
              </div>
            </div>
          </div>
        ) : (
          <Dropzone id="remove-file" accept="image/*" label={status ?? "Drop an image here"} hint="or click to browse · PNG, JPG, WEBP · up to 20 MB" onFile={start} />
        )}
      </div>
    );
  }

  return (
    <div className="tool-body">
      {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
      <div className="toolbar">
        <ModeSwitch mode={mode} setMode={setMode} />
        <span className="spacer" />
        <button className="btn btn-line btn-sm" onClick={undo} disabled={!points.length && !box} id="undo">Undo</button>
        <button className="btn btn-line btn-sm" onClick={() => { setSid(null); setCut(null); }} id="new-image">New image</button>
      </div>
      <div className="work">
        <SelectStage
          src={src} w={size.w} h={size.h} mode={mode} points={points} box={box} onChange={segment} status={status} hideBase={!!cut}
          className={cut ? (bg ? "" : "checker") : ""} style={bg && cut ? { background: bg } : undefined}
        >
          {cut && <img className="layer contain over" src={cut} alt="Cutout preview" />}
        </SelectStage>
        <aside className="side">
          {!cut ? (
            <div className="side-empty">
              <b>Click the subject</b>
              <p>Yellow dots keep, black dots remove. Use Box to drag around it.</p>
            </div>
          ) : (
            <MakePanel sid={sid} cutUrl={cut} make={make} setMake={setMake} bg={bg} setBg={setBg} />
          )}
        </aside>
      </div>
    </div>
  );
}

function MakePanel({ sid, cutUrl, make, setMake, bg, setBg }: {
  sid: string; cutUrl: string; make: Make; setMake: (m: Make) => void; bg: string; setBg: (c: string) => void;
}) {
  const [preview, setPreview] = useState<{ url: string; blob: Blob; name: string; alt?: { blob: Blob; name: string; label: string } } | null>(null);
  const [preset, setPreset] = useState<IdPreset>(ID_PRESETS[0]);
  const [shape, setShape] = useState<"circle" | "square">("circle");
  const [pColor, setPColor] = useState("#ffd60a");
