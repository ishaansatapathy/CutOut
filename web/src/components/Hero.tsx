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

