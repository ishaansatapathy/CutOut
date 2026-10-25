"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PLANS } from "@/lib/plans";
import { api } from "@/trpc/client";
import { Logo } from "./Logo";
import { Eyebrow, Reveal, spot } from "./ui";

const cssVar = (k: string, v: string | number) => ({ [k]: v }) as React.CSSProperties;

/* ------------------------------ marquee ------------------------------ */
export function Marquee() {
  const items = ["Product photos", "Reels", "YouTube thumbnails", "Marketplace listings", "Stickers", "Pet videos", "Ads", "Portfolios"];
  return (
    <div className="marquee" aria-label="Made for product photos, reels, thumbnails, listings, stickers, pet videos, ads and portfolios">
      <div className="marquee-track" aria-hidden>
        {[...items, ...items].map((t, i) => <span key={i}>{t}</span>)}
      </div>
    </div>
  );
}

/* ------------------------------- tools ------------------------------- */
type ToolCard = { id: string; href: string; title: string; text: string; tag: string; tagKind: "ads" | "free" | "credits" | "beta"; cls: string };
const TOOL_CARDS: ToolCard[] = [
  { id: "bg", href: "/app?tool=remove", title: "Remove background", text: "Click the subject. Get a clean cutout with soft hair edges, at full resolution.", tag: "Free with ads", tagKind: "ads", cls: "t-bg" },
  { id: "erase", href: "/app?tool=erase", title: "Erase objects", text: "Click a photobomber, a bin or a wire and it's gone, filled in to match.", tag: "Free with ads", tagKind: "ads", cls: "t-erase" },
  { id: "sticker", href: "/app?tool=remove", title: "Stickers", text: "Die-cut border and shadow, sized for WhatsApp and Instagram.", tag: "Included with any cutout", tagKind: "free", cls: "t-sticker" },
  { id: "profile", href: "/app?tool=remove", title: "Profile pictures", text: "Head and shoulders, centred on a colour. Circle or square.", tag: "Included with any cutout", tagKind: "free", cls: "t-profile" },
  { id: "video", href: "/app?tool=video", title: "Video background", text: "Click once on any frame. Tracked through the clip, fixable with one click.", tag: "1 free clip a day · beta", tagKind: "beta", cls: "t-video" },
  { id: "id", href: "/app?tool=remove", title: "ID & passport photos", text: "India, US, UK, Schengen and PAN sizes, plus a 4×6 print sheet.", tag: "Included with any cutout", tagKind: "free", cls: "t-id" },
  { id: "thumb", href: "/app?tool=remove", title: "YouTube thumbnails", text: "Your cutout, a bold title and a colour. 1280×720, ready to upload.", tag: "Included with any cutout", tagKind: "free", cls: "t-thumb" },
  { id: "upscale", href: "/app?tool=upscale", title: "Upscale 2×", text: "Double the size of small or soft photos with an AI upscaler.", tag: "Free with ads", tagKind: "ads", cls: "t-upscale" },
  { id: "gen", href: "/app?tool=generate", title: "Generate images", text: "Describe it and get an image, labelled as AI-made. Send it straight to cutout.", tag: "Credits only", tagKind: "credits", cls: "t-gen" },
  { id: "api", href: "/#developers", title: "Developer API", text: "One REST call per image. Prepaid, no ads, 50 free images a month.", tag: "50 free a month", tagKind: "free", cls: "t-api" },
];

function ToolVisual({ cls }: { cls: string }) {
  switch (cls) {
    case "t-bg":
      return (
        <div className="tv tv-bg">
          <img src="/demo/before.webp" alt="" loading="lazy" />
          <div className="tv-cut checker"><img src="/demo/cutout.webp" alt="" loading="lazy" /></div>
        </div>
      );
    case "t-erase":
      return (
        <div className="tv tv-erase">
          <img src="/demo/before.webp" alt="" loading="lazy" />
          <i className="tv-mask" />
          <img className="tv-after" src="/demo/erased.webp" alt="" loading="lazy" />
        </div>
      );
    case "t-sticker":
      return <div className="tv tv-sticker"><img src="/demo/cutout.webp" alt="" loading="lazy" /></div>;
    case "t-profile":
      return <div className="tv tv-profile"><span><img src="/demo/cutout.webp" alt="" loading="lazy" /></span></div>;
    case "t-video":
      return (
        <div className="tv tv-video">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} style={cssVar("--i", i)}><img src="/demo/before.webp" alt="" loading="lazy" /><i /></span>
          ))}
        </div>
      );
    case "t-id":
      return (
        <div className="tv tv-id">
          <span className="id-photo"><img src="/demo/cutout.webp" alt="" loading="lazy" /></span>
          <span className="id-size">35 × 45 mm</span>
        </div>
      );
    case "t-thumb":
      return (
        <div className="tv tv-thumb">
          <b>Street food,<br />ranked.</b>
          <img src="/demo/cutout.webp" alt="" loading="lazy" />
        </div>
      );
    case "t-upscale":
      return (
        <div className="tv tv-upscale">
          <img className="lo" src="/demo/face-small.webp" alt="" loading="lazy" />
          <img className="hi" src="/demo/before.webp" alt="" loading="lazy" />
          <span className="tv-l">1×</span><span className="tv-r">2×</span>
        </div>
      );
    case "t-gen":
      return (
        <div className="tv tv-gen">
          <img src="/demo/generated.webp" alt="" loading="lazy" />
          <span className="ai-badge">AI-generated</span>
          <span className="tv-prompt">“a yellow vintage scooter on a quiet street”</span>
        </div>
      );
    default:
      return (
        <pre className="tv tv-api">{`curl -X POST /api/v1/images/remove-background \\
  -H "Authorization: Bearer co_live_…" \\
  -F image=@shoe.jpg -F prompt='{"points":[…]}'`}</pre>
      );
  }
}

export function Tools() {
  return (
    <section className="sec" id="tools">
      <div className="wrap">
        <Reveal className="sec-head">
          <Eyebrow>Tools</Eyebrow>
          <h2>One click, <em>ten things to make.</em></h2>
          <p>Every tool starts the same way: you click what matters. Cutout extras like stickers and ID photos cost nothing more once you&apos;ve made a cutout.</p>
        </Reveal>
        <div className="tools">
          {TOOL_CARDS.map((t, i) => (
            <Reveal key={t.id} delay={(i % 4) * 60} className={`tool ${t.cls}`}>
              <Link href={t.href} className="tool-in spotlight" onPointerMove={spot} id={`tool-card-${t.id}`}>
                <ToolVisual cls={t.cls} />
                <div className="tool-txt">
                  <span className={`ttag ${t.tagKind}`}>{t.tag}</span>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                  <span className="tool-go">Open <span aria-hidden>→</span></span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- how it works ---------------------------- */
const STEPS = [
  {
    t: "Click what you want to keep",
    d: "Tap the person, product or pet, or drag a box around it. A mask preview shows up almost instantly.",
    chips: ["Click or box", "Live preview"],
    tag: "1 click",
  },
  {
    t: "Fix misses with one more click",
    d: "Missed a hand? Click it with Keep. Grabbed part of the wall? Click it with Remove. The mask updates each time.",
    chips: ["Keep clicks", "Remove clicks", "Undo"],
    tag: "+1 keep · −1 remove",
  },
  {
    t: "For video, it follows along",
    d: "Select on any frame and CutOut tracks the subject forward and backward. If it slips, click once on that frame and it re-runs from there.",
    chips: ["Forward + backward", "Correction click"],
    tag: "Tracking every frame",
  },
  {
    t: "Download a clean file",
    d: "Transparent PNG for images. WebM with transparency, or MP4 over a solid colour, for video.",
    chips: ["PNG", "WebM · alpha", "MP4"],
    tag: "Ready to export",
  },
];

function StoryVisual({ step }: { step: number }) {
  return (
    <div className="sv" data-step={step} aria-hidden>
      <img className="layer sv-photo" src="/demo/before.webp" alt="" loading="lazy" width={1200} height={896} />
      <div className="layer sv-mask" />
      <div className="layer sv-reveal">
        <div className="layer checker" />
        <img className="layer" src="/demo/cutout.webp" alt="" loading="lazy" width={1200} height={896} />
      </div>
      <span className="pt add p1" />
      <span className="pt add p2" />
      <span className="pt rem p3" />
      <div className="sv-strip">
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} className={`fr ${i === 6 ? "lost" : ""}`} style={cssVar("--i", i)}>
            <img src="/demo/before.webp" alt="" loading="lazy" />
            <i />
          </span>
