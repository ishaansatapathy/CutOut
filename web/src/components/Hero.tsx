"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useInView } from "./ui";

const PHASES = [
  { label: "Click the subject", chip: "Click her to try it, or just watch", ms: 2600 },
  { label: "Check the mask", chip: "Mask preview", ms: 2200 },
  { label: "Background gone", chip: "Edges refined", ms: 2400 },
  { label: "Pick a backdrop", chip: "Transparent, white or any colour", ms: 3800 },
];

let alphaCache: Promise<ImageData> | null = null;
function loadAlpha() {
  alphaCache ??= new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      res(ctx.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = rej;
    img.src = "/demo/cutout.webp";
  });
  return alphaCache;
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  return (
    <section
      className="hero"
      ref={ref}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        ref.current!.style.setProperty("--mx", `${e.clientX - r.left}px`);
        ref.current!.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      <div className="hero-glow" aria-hidden />
      <div className="wrap hero-copy">
        <Link href="#tools" className="hero-pill">
          <span className="tag">New</span> Erase objects, ID photos, stickers &amp; more <span aria-hidden>→</span>
        </Link>
        <h1 className="hero-title">
          <span className="line"><span>Keep the subject.</span></span>
          <span className="line"><span>Lose the <em className="mark">background.</em></span></span>
        </h1>
        <p className="lead">
          Click once on a person, product or pet. CutOut removes everything else, keeps soft edges around hair,
          and follows your subject through every frame of a video.
        </p>
        <div className="hero-cta">
          <Link href="/app" className="btn btn-k" id="hero-try">Remove a background <span className="arrow">→</span></Link>
          <a href="#how" className="btn btn-line" id="hero-how">See how it works</a>
        </div>
        <p className="micro">2 free cutouts without signing up · 10 a day with Google · files deleted after 24 hours</p>
      </div>
      <HeroDemo />
    </section>
  );
}

function HeroDemo() {
  const [p, setP] = useState(0);
  const [hover, setHover] = useState(false);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  const [miss, setMiss] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const visible = useInView(wrap);

  const tilt = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const r = card.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.current!.style.transform = `perspective(1600px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`;
  };

  const alpha = useRef<ImageData | null>(null);
  const preload = () => { loadAlpha().then((a) => (alpha.current = a), () => {}); };
  useEffect(() => { if (visible) preload(); }, [visible]);

  const tryClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const a = alpha.current;
    const onSubject = !a || a.data[(Math.floor(fy * a.height) * a.width + Math.floor(fx * a.width)) * 4 + 3] > 100;
    setPt({ x: fx * 100, y: fy * 100 });
    setMiss(!onSubject);
    setP(onSubject ? 1 : 0);
  };

  const paused = hover || !visible || miss;
  const chip = miss ? "That's background. Click the person to keep her." : PHASES[p].chip;
  const style = pt ? ({ "--cx": `${pt.x}%`, "--cy": `${pt.y}%` } as React.CSSProperties) : undefined;

  return (
    <div className={`wrap demo-wrap ${paused ? "paused" : ""}`} ref={wrap}>
      <div
        ref={card}
        className={`demo phase-${p} ${pt ? "user" : ""} ${miss ? "miss" : ""}`}
        style={style}
        onMouseEnter={() => { setHover(true); preload(); }}
        onTouchStart={preload}
        onMouseLeave={() => { setHover(false); card.current!.style.transform = ""; }}
        onPointerMove={tilt}
      >
        <div className="demo-bar" aria-hidden>
          <span className="demo-dots"><i /><i /><i /></span>
          <span className="demo-tools">
            <span className="on">＋ Keep</span><span>－ Remove</span><span className="hide-sm">▭ Box</span>
          </span>
          <span className="demo-export">Download PNG ↓</span>
        </div>
        <div
          className="demo-canvas"
          onClick={tryClick}
          role="button"
          tabIndex={0}
          aria-label="Demo photo. Click the person to see the background removed."
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMiss(false); setP(1); } }}
        >
          <img className="layer" src="/demo/before.webp" alt="" width={1200} height={896} fetchPriority="high" />
          <div className="layer d-mask" />
          <div className="layer d-reveal">
            <div className="layer checker" />
            <div className="layer d-solid" />
            <img className="layer" src="/demo/cutout.webp" alt="" width={1200} height={896} />
          </div>
          <span className="d-point" />
          <svg className="d-cursor" viewBox="0 0 24 24" width="30" height="30" aria-hidden>
            <path d="M4 2.5l15.5 7.2-6.6 2.1-2.3 6.7z" fill="#0B0B0B" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span className="d-chip" key={chip}>{chip}</span>
        </div>
      </div>
      <div className="demo-steps">
        {PHASES.map((ph, i) => (
          <button
            key={i}
            id={`demo-step-${i + 1}`}
            className={i === p && !miss ? "on" : i < p ? "done" : ""}
            onClick={() => { setMiss(false); setP(i); }}
          >
            <span className="n">{i + 1}</span>
            <span className="t">{ph.label}</span>
            <span
              className="bar"
              key={i === p ? `run-${p}-${pt?.x ?? ""}` : "idle"}
              style={{ ["--d" as string]: `${ph.ms}ms` }}
              onAnimationEnd={() => {
                if (i !== p || miss) return;
                if (i === PHASES.length - 1) setPt(null);
                setP((cur) => (cur === i ? (i + 1) % PHASES.length : cur));
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
