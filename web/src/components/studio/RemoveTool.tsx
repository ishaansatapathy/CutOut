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
  const [idBg, setIdBg] = useState("#ffffff");
  const [thumbText, setThumbText] = useState("Street food, ranked");
  const [thumbBg, setThumbBg] = useState("#ffd60a");
  const [busy, setBusy] = useState(false);

  const fullCut = async () => {
    const r = await fetch(`/ai/v1/images/session/${sid}/export`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ background: null }),
    });
    return loadImage(URL.createObjectURL(await r.blob()));
  };

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (make === "png") return setPreview(null);
      setBusy(true);
      const img = await fullCut();
      if (cancel) return;
      if (make === "sticker") {
        const s = await sticker(img);
        setPreview({ url: s.url, blob: s.webp, name: "sticker.webp", alt: { blob: s.png, name: "sticker.png", label: "PNG" } });
      } else if (make === "profile") {
        const p = await profile(img, pColor, shape);
        setPreview({ url: p.url, blob: p.png, name: "profile.png" });
      } else if (make === "id") {
        const one = await idPhoto(img, preset, idBg);
        const sheet = await printSheet(one.canvas);
        setPreview({ url: one.url, blob: one.png, name: `${preset.id}.jpg`, alt: { blob: sheet.png, name: `${preset.id}-sheet-4x6.jpg`, label: `4×6 sheet (${sheet.copies})` } });
      } else if (make === "thumb") {
        const t = await thumbnail(img, thumbText || " ", thumbBg);
        setPreview({ url: t.url, blob: t.png, name: "thumbnail.jpg" });
      }
      setBusy(false);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [make, shape, pColor, preset, idBg, thumbText, thumbBg, cutUrl]);

  const downloadPng = async () => {
    const r = await fetch(`/ai/v1/images/session/${sid}/export`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ background: bg || null }),
    });
    download(URL.createObjectURL(await r.blob()), "cutout.png");
  };

  return (
    <div className="make">
      <div className="make-tabs" role="tablist" aria-label="What to make">
        {MAKES.map((m) => (
          <button key={m.id} role="tab" aria-selected={make === m.id} className={make === m.id ? "on" : ""} onClick={() => setMake(m.id)} id={`make-${m.id}`}>
            <b>{m.label}</b><small>{m.hint}</small>
          </button>
        ))}
      </div>

      {make === "png" && (
        <div className="make-opts">
          <span className="opt-label">Background</span>
          <div className="swatch-row">
            {BGS.map((b) => (
              <button key={b.id} className={`swatch ${bg === b.c ? "on" : ""}`} onClick={() => setBg(b.c)} aria-label={b.label} title={b.label}>
                <i className={b.c ? "" : "sw-checker"} style={b.c ? { background: b.c } : undefined} />
              </button>
            ))}
            <label className="swatch pick" title="Any colour">
              <i style={{ background: bg && !BGS.some((b) => b.c === bg) ? bg : "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" }} />
              <input type="color" aria-label="Pick a background colour" onChange={(e) => setBg(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-k btn-block" onClick={downloadPng} id="download">Download PNG <span className="arrow">↓</span></button>
          <p className="fine-left">Full resolution. Files are deleted from our servers after 24 hours.</p>
        </div>
      )}

      {make === "profile" && (
        <div className="make-opts">
          <div className="seg">
            {(["circle", "square"] as const).map((s) => <button key={s} className={shape === s ? "on" : ""} onClick={() => setShape(s)}>{s === "circle" ? "Circle" : "Square"}</button>)}
          </div>
          <ColorRow value={pColor} onChange={setPColor} />
        </div>
      )}

      {make === "id" && (
        <div className="make-opts">
          <select className="select" value={preset.id} onChange={(e) => setPreset(ID_PRESETS.find((p) => p.id === e.target.value)!)} aria-label="Document type">
            {ID_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.mm[0]}×{p.mm[1]} mm</option>)}
          </select>
          <ColorRow value={idBg} onChange={setIdBg} options={["#ffffff", "#f1f1f1", "#dbe9f7"]} />
          <p className="fine-left">Check the official rules before submitting: expression, glasses and lighting still matter.</p>
        </div>
      )}

      {make === "thumb" && (
        <div className="make-opts">
          <input className="text-in" value={thumbText} maxLength={40} onChange={(e) => setThumbText(e.target.value)} aria-label="Thumbnail text" placeholder="Your title" />
          <ColorRow value={thumbBg} onChange={setThumbBg} />
        </div>
      )}

      {make !== "png" && (
        <div className="make-out">
          <div className={`make-preview ${make}`}>
            {busy || !preview ? <span className="spin" aria-label="Rendering" /> : <img src={preview.url} alt={`${make} preview`} />}
          </div>
          {preview && (
            <div className="make-dl">
              <button className="btn btn-k btn-sm" onClick={() => download(URL.createObjectURL(preview.blob), preview.name)} id="make-download">
                Download {preview.name.split(".").pop()?.toUpperCase()} ↓
              </button>
              {preview.alt && (
                <button className="btn btn-line btn-sm" onClick={() => download(URL.createObjectURL(preview.alt!.blob), preview.alt!.name)}>
                  {preview.alt.label} ↓
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColorRow({ value, onChange, options = ["#ffd60a", "#ffffff", "#0b0b0b", "#ff4d6d", "#4d7cff"] }: {
  value: string; onChange: (c: string) => void; options?: string[];
}) {
  return (
    <div className="swatch-row">
      {options.map((c) => (
        <button key={c} className={`swatch ${value === c ? "on" : ""}`} onClick={() => onChange(c)} aria-label={c}><i style={{ background: c }} /></button>
      ))}
      <label className="swatch pick" title="Any colour">
        <i style={{ background: options.includes(value) ? "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" : value }} />
        <input type="color" value={value} aria-label="Pick a colour" onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
