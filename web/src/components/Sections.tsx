"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PLANS } from "@/lib/plans";
import { api } from "@/trpc/client";
import { Logo } from "./Logo";
import { useAccountUi } from "./studio/account";
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
        ))}
      </div>
      <div className="sv-formats"><span>cutout.png</span><span>clip.webm</span><span>clip.mp4</span></div>
      <span className="sv-tag" key={step}>{STEPS[step].tag}</span>
    </div>
  );
}

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section className="sec dark panel" id="how">
      <div className="wrap">
        <Reveal className="sec-head">
          <Eyebrow>How it works</Eyebrow>
          <h2>Point. Click. <em>Done.</em></h2>
          <p>No brushes, no lasso, no layers. You show CutOut what to keep and it does the tracing.</p>
        </Reveal>
        <div className="story">
          <div className="story-steps">
            {STEPS.map((s, i) => (
              <div
                key={i}
                data-i={i}
                ref={(el) => { refs.current[i] = el; }}
                className={`story-step ${active === i ? "on" : ""}`}
              >
                <span className="n">0{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
                <ul className="chips">{s.chips.map((c) => <li key={c}>{c}</li>)}</ul>
                <div className="story-inline"><StoryVisual step={i} /></div>
              </div>
            ))}
          </div>
          <div className="story-sticky"><StoryVisual step={active} /></div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- edges ------------------------------- */
const BACKDROPS = [
  { id: "checker", label: "Transparent" },
  { id: "white", label: "White" },
  { id: "yellow", label: "Yellow" },
  { id: "black", label: "Black" },
];

export function Edges() {
  const [bg, setBg] = useState("checker");
  const [custom, setCustom] = useState("#ff4d6d");
  const [idle, setIdle] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const pos = useRef(50);

  const setPos = (v: number) => {
    pos.current = Math.min(100, Math.max(0, v));
    ref.current!.style.setProperty("--pos", `${pos.current}%`);
    ref.current!.setAttribute("aria-valuenow", String(Math.round(pos.current)));
  };
  const move = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    setPos(((x - r.left) / r.width) * 100);
  };

  return (
    <section className="sec" id="edges">
      <div className="wrap edges">
        <Reveal className="edges-copy">
          <Eyebrow>Clean edges</Eyebrow>
          <h2>Hair and fur <em>stay soft.</em></h2>
          <p className="sub">
            After the subject is selected, a matting pass refines the edge so curls and stray strands don&apos;t look
            pasted on. Move across the photo to compare.
          </p>
          <ul className="ticks">
            <li>Returned at your original resolution</li>
            <li>Correction clicks to add or remove areas</li>
            <li>Transparent PNG, or flattened onto a colour</li>
          </ul>
          <div className="swatches" role="radiogroup" aria-label="Backdrop">
            {BACKDROPS.map((b) => (
              <button
                key={b.id}
                id={`edge-bg-${b.id}`}
                role="radio"
                aria-checked={bg === b.id}
                className={bg === b.id ? "on" : ""}
                onClick={() => setBg(b.id)}
              >
                <i className={`sw-${b.id}`} />{b.label}
              </button>
            ))}
            <label className={`sw-pick ${bg === "custom" ? "on" : ""}`} role="radio" aria-checked={bg === "custom"}>
              <i style={{ background: custom }} />Any colour
              <input
                type="color"
                value={custom}
                aria-label="Pick a backdrop colour"
                onChange={(e) => { setCustom(e.target.value); setBg("custom"); }}
                onClick={() => setBg("custom")}
              />
            </label>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div
            ref={ref}
            className={`cmp ${idle ? "idle" : ""}`}
            id="compare"
            role="slider"
            tabIndex={0}
            aria-label="Compare original and cutout"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={50}
            onPointerDown={(e) => {
              drag.current = true;
              setIdle(false);
              e.currentTarget.setPointerCapture(e.pointerId);
              move(e.clientX);
            }}
            onPointerMove={(e) => {
              if (drag.current || e.pointerType === "mouse") { setIdle(false); move(e.clientX); }
            }}
            onPointerUp={() => (drag.current = false)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 3;
              if (e.key === "ArrowLeft") { setIdle(false); setPos(pos.current - step); e.preventDefault(); }
              if (e.key === "ArrowRight") { setIdle(false); setPos(pos.current + step); e.preventDefault(); }
            }}
          >
            <img className="layer" src="/demo/before.webp" alt="Original photo in a busy market" loading="lazy" width={1200} height={896} />
            <div className={`layer cmp-after bg-${bg}`} style={bg === "custom" ? { background: custom } : undefined}>
              <img className="layer" src="/demo/cutout.webp" alt="The same person with the background removed" loading="lazy" width={1200} height={896} />
            </div>
            <span className="cmp-handle" />
            <span className="cmp-tag l">Original</span>
            <span className="cmp-tag r">CutOut</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------- video ------------------------------- */
const TOTAL_FRAMES = 360;

export function Video() {
  const frames = Array.from({ length: 12 });
  const stack = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const posRef = useRef(0);
  const isHovered = useRef(false);
  const lastTime = useRef<number | null>(null);

  useEffect(() => {
    let reqId: number;
    const DURATION = 7000; // 7s for full sweep

    const tick = (now: number) => {
      if (lastTime.current === null) lastTime.current = now;
      const dt = now - lastTime.current;
      lastTime.current = now;

      if (!isHovered.current && stack.current) {
        posRef.current = (posRef.current + dt / DURATION) % 1;
        const f = posRef.current;
        stack.current.style.setProperty("--ph", `${(f * 100).toFixed(2)}%`);
        if (counter.current) {
          const frame = Math.round(f * (TOTAL_FRAMES - 1)) + 1;
          const sec = (f * 12).toFixed(1).padStart(4, "0");
          counter.current.textContent = `Frame ${frame} / ${TOTAL_FRAMES} · 00:${sec}`;
        }
      }
      reqId = requestAnimationFrame(tick);
    };

    reqId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(reqId);
  }, []);

  const scrub = (e: React.PointerEvent) => {
    if (!stack.current) return;
    isHovered.current = true;
    stack.current.classList.add("is-scrubbing");
    const r = stack.current.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    posRef.current = f;
    stack.current.style.setProperty("--ph", `${(f * 100).toFixed(2)}%`);
    if (counter.current) {
      const frame = Math.round(f * (TOTAL_FRAMES - 1)) + 1;
      const sec = (f * 12).toFixed(1).padStart(4, "0");
      counter.current.textContent = `Frame ${frame} / ${TOTAL_FRAMES} · 00:${sec}`;
    }
  };

  const release = () => {
    if (!stack.current) return;
    isHovered.current = false;
    stack.current.classList.remove("is-scrubbing");
    lastTime.current = null; // Smoothly continue from current position
  };

  const strip = (tinted: boolean) => (
    <div className={`tl-frames ${tinted ? "tinted" : ""}`} aria-hidden>
      {frames.map((_, i) => (
        <span key={i} className={`tf ${i === 8 ? "lost" : ""}`} style={cssVar("--i", i)}>
          <span className="tf-in">
            <img src="/demo/before.webp" alt="" loading="lazy" />
            {tinted && <i />}
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <section className="sec yellow panel" id="video">
      <div className="wrap">
        <div className="video-head">
          <Reveal>
            <span className="eyebrow k">Video · beta</span>
            <h2>One click. <em>Every frame.</em></h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="sub">
              Click your subject on any frame and CutOut tracks it through the clip. If it loses the subject somewhere,
              scrub to that frame, add one correction click, and it re-runs from there instead of starting over.
            </p>
          </Reveal>
        </div>
        <Reveal delay={150}>
          <div className="tl">
            <div className="tl-top">
              <span className="tl-file">market_walk.mp4</span>
              <span className="tl-time" ref={counter}>Frame 1 / 360 · 00:00.0</span>
            </div>
            <div
              className="tl-stack"
              ref={stack}
              onPointerEnter={scrub}
              onPointerMove={scrub}
              onPointerDown={scrub}
              onPointerLeave={release}
              onPointerCancel={release}
            >
              {strip(false)}
              {strip(true)}
              <span className="tl-head" />
              <span className="tl-fix" style={cssVar("--i", 8)}>1 correction click</span>
            </div>
          </div>
        </Reveal>
        <div className="specs">
          {[
            ["30s", "max clip length while in beta"],
            ["1080p", "max resolution, 30 fps"],
            ["WebM", "with real transparency"],
            ["MP4", "over a solid colour"],
          ].map(([b, s], i) => (
            <Reveal key={b} delay={i * 70}>
              <div className="spec spotlight" onPointerMove={spot}><b>{b}</b><span>{s}</span></div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ for who ------------------------------ */
const SNIPPETS: Record<string, string> = {
  curl: `curl -X POST http://localhost:3001/api/v1/images/remove-background \\
  -H "Authorization: Bearer $CUTOUT_KEY" \\
  -F image=@product.jpg \\
  -F 'prompt={"points":[{"x":420,"y":310,"label":1}]}' \\
  -o cutout.png`,
  python: `import json, requests

r = requests.post(
    "http://localhost:3001/api/v1/videos/remove-background",
    headers={"Authorization": f"Bearer {KEY}"},
    files={"video": open("clip.mp4", "rb")},
    data={"prompt": json.dumps({"time": 0.5, "norm": True,
        "points": [{"x": 0.57, "y": 0.6, "label": 1}]}),
        "seconds": 10, "res": 720},
)
job_id = r.json()["id"]  # poll GET /api/v1/jobs/{id}`,
  node: `const form = new FormData();
form.append("image", file);
form.append("prompt", JSON.stringify({ box: [380, 200, 640, 700] }));

const res = await fetch("http://localhost:3001/api/v1/images/remove-background", {
  method: "POST",
  headers: { Authorization: \`Bearer \${KEY}\` },
  body: form,
});
const png = await res.blob();`,
};

function Code() {
  const [tab, setTab] = useState("curl");
  return (
    <div className="code">
      <div className="code-tabs" role="tablist">
        {Object.keys(SNIPPETS).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} id={`api-tab-${k}`} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k}</button>
        ))}
      </div>
      <pre key={tab}>{SNIPPETS[tab]}</pre>
    </div>
  );
}

const AUDIENCES = [
  {
    id: "sellers",
    label: "Sellers",
    h: "Listing photos on clean white.",
    d: "Shoot on your table, click the product, export on white. Same look across every listing without a studio.",
    points: ["Flatten onto white or any colour", "Full-resolution PNG", "Batch upload is on the roadmap"],
  },
  {
    id: "creators",
    label: "Creators",
    h: "Thumbnails and reels, faster.",
    d: "Pull yourself out of any shot for thumbnails, stickers or intros. For video, select once and export WebM with transparency.",
    points: ["Cutouts for thumbnails and stickers", "Video tracking with correction clicks", "WebM with alpha for editors"],
  },
  {
    id: "developers",
    label: "Developers",
    h: "One REST call. Prepaid, no ads.",
    d: "Send an image or video with a click point or box. Images return a PNG; video returns a job id you poll.",
    points: ["50 free images every month", "Then billed per image or per second", "Results deleted after 24 hours"],
  },
];

export function ForWho() {
  const [tab, setTab] = useState("sellers");

  useEffect(() => {
    const on = () => window.location.hash === "#developers" && setTab("developers");
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const a = AUDIENCES.find((x) => x.id === tab)!;

  return (
    <section className="sec white" id="for">
      <span id="developers" className="anchor" />
      <div className="wrap">
        <Reveal className="sec-head center">
          <Eyebrow>Who it&apos;s for</Eyebrow>
          <h2>Made for people who <em>ship daily.</em></h2>
        </Reveal>
        <div className="tabs" role="tablist" aria-label="Audience">
          {AUDIENCES.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} id={`for-${x.id}`} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="for-panel" key={tab}>
          <div className="for-copy">
            <h3>{a.h}</h3>
            <p>{a.d}</p>
            <ul className="ticks">{a.points.map((p) => <li key={p}>{p}</li>)}</ul>
            {tab === "developers" ? (
              <>
                <ul className="endpoints">
                  <li><code>POST</code>/api/v1/images/remove-background</li>
                  <li><code>POST</code>/api/v1/videos/remove-background</li>
                  <li><code>GET</code>/api/v1/jobs/{"{id}"}</li>
                  <li><code>GET</code>/api/v1/usage</li>
                </ul>
                <Link href="/account" className="btn btn-k">Get an API key <span className="arrow">→</span></Link>
              </>
            ) : (
              <Link href="/app" className="btn btn-k">Try it on your photo <span className="arrow">→</span></Link>
            )}
          </div>
          <div className="for-visual">
            {tab === "sellers" && (
              <div className="mock-listing">
                <div className="ml-img"><img src="/demo/cutout.webp" alt="Cutout on a white listing background" loading="lazy" /></div>
                <div className="ml-lines"><i /><i /><i className="short" /></div>
                <span className="ml-badge">On white · 2048 × 2048</span>
              </div>
            )}
            {tab === "creators" && (
              <div className="mock-thumb">
                <b>Street food,<br />ranked.</b>
                <img src="/demo/cutout.webp" alt="Cutout used in a video thumbnail" loading="lazy" />
                <span className="mt-time">12:04</span>
              </div>
            )}
            {tab === "developers" && <Code />}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ pricing ------------------------------ */
export function Pricing() {
  const ui = useAccountUi();
  return (
    <section className="sec" id="pricing">
      <div className="wrap">
        <Reveal className="sec-head center">
          <Eyebrow>Pricing</Eyebrow>
          <h2>Pay per cutout. <em>Not per month.</em></h2>
          <p>Free jobs unlock after short ads. Credit packs are paid once with any UPI app, paid jobs never show ads, and image generation is credits-only.</p>
        </Reveal>
        <div className="plans">
          {PLANS.map((p, i) => {
            const popular = "popular" in p && p.popular;
            return (
              <Reveal key={p.id} delay={i * 70} className={`plan ${popular ? "popular" : ""}`}>
                <div id={`plan-${p.id}`} className="plan-in spotlight" onPointerMove={spot}>
                  {popular && <span className="pill">Most picked</span>}
                  <h3>{p.name}</h3>
                  <p className="tagline">{p.tagline}</p>
                  <div className="price">₹{p.price}<small>{p.credits ? ` / ${p.credits} credits` : " / always"}</small></div>
                  <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                  {p.id === "free" ? (
                    <Link href="/app" className="btn btn-line" id={`plan-cta-${p.id}`}>{p.cta}</Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => ui.buy(p.id)}
                      className={`btn ${popular ? "btn-y" : "btn-k"}`}
                      id={`plan-cta-${p.id}`}
                      style={{ cursor: "pointer", width: "100%", textAlign: "center" }}
                    >
                      {p.cta}
                    </button>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
        <Reveal className="credit-row">
          <div><b>1 credit</b><span>per image or generation</span></div>
          <div><b>1 credit / sec</b><span>video at 720p</span></div>
          <div><b>2 credits / sec</b><span>video at 1080p</span></div>
        </Reveal>
        <p className="fine">Prices in INR. Launch pricing, which may change once we&apos;ve measured real costs in beta.</p>
      </div>
    </section>
  );
}

/* ------------------------------- trust ------------------------------- */
const TRUST = [
  { h: "Deleted after 24 hours", d: "Uploads and results are removed automatically a day after you make them." },
  { h: "No watermark removal", d: "CutOut won't strip watermarks or AI labels. They exist to tell people what's real." },
  { h: "Ads you can see coming", d: "Free jobs unlock after short rewarded ads: 3 per image, 5 per video. That's what keeps the free tier free." },
  { h: "No subscription", d: "Buy a credit pack when you need one. Nothing renews in the background." },
];

export function Trust() {
  return (
    <section className="sec dark panel" id="trust">
      <div className="wrap">
        <Reveal className="sec-head">
          <Eyebrow>Straight answers</Eyebrow>
          <h2>What we do, <em>and what we don&apos;t.</em></h2>
        </Reveal>
        <div className="trust">
          {TRUST.map((t, i) => (
            <Reveal key={t.h} delay={i * 80}>
              <div className="trust-card spotlight" onPointerMove={spot}>
                <span className="n">0{i + 1}</span>
                <h3>{t.h}</h3>
                <p>{t.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- faq -------------------------------- */
const FAQS = [
  ["Is it really free?", "Yes. You get 2 free image jobs without signing in, then 10 a day with Google, plus 1 free video clip a day (5 seconds, 480p). Each free job unlocks after short rewarded ads. Stickers, profile pictures, ID photos and thumbnails made from a cutout don't cost anything extra."],
  ["Is image generation free?", "No. Generating images uses credits only, 1 credit per image, with no ad option. Every generated image is labelled as AI-made in its file data."],
  ["Are the ID photos accepted?", "They're sized and framed to each document's published rules, on a plain background. Officials still check expression, glasses and lighting, so read the requirements before you submit."],
  ["How good is the video tracking?", "It works well on a clear subject, and it's still in beta. Fast motion, heavy blur, or two very similar people can make it slip. When it does, one correction click on that frame re-runs tracking from there."],
  ["What can I export?", "Images: transparent PNG, or flattened onto a colour. Video: WebM with transparency, or MP4 over a solid colour."],
  ["Do you keep my files?", "No. Uploads and results are deleted automatically after 24 hours."],
  ["Can it remove watermarks?", "No, and it won't. CutOut only removes backgrounds."],
  ["Is there an API?", "Yes. It's a small REST API with prepaid billing and no ads. You get 50 free images a month, then pay per image or per second of video."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="sec" id="faq">
      <div className="wrap faq-grid">
        <Reveal className="faq-head">
          <Eyebrow>FAQ</Eyebrow>
          <h2>Questions, <em>answered.</em></h2>
          <p className="sub">Something missing? Use the report link in the footer and we&apos;ll get back to you.</p>
        </Reveal>
        <div className="faq">
          {FAQS.map(([q, a], i) => (
            <div key={i} className={`qa ${open === i ? "open" : ""}`}>
              <button id={`faq-${i + 1}`} aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}<span className="pm" aria-hidden>+</span>
              </button>
              <div className="ans"><div>{a}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- cta -------------------------------- */
export function Cta() {
  const [email, setEmail] = useState("");
  const join = api.waitlist.join.useMutation();
  return (
    <section className="sec cta-sec">
      <div className="wrap">
        <Reveal className="cta">
          <img src="/mark.png" alt="" className="cta-mark" aria-hidden />
          <h2>Try it on <em>your own</em> photo.</h2>
          <p>2 free cutouts, no sign-up. Want news when new tools land? Leave your email.</p>
          <div className="cta-row">
            <Link href="/app" className="btn btn-k" id="cta-try">Open CutOut <span className="arrow">→</span></Link>
            <form onSubmit={(e) => { e.preventDefault(); join.mutate({ email }); }}>
              <input id="cta-email" type="email" required placeholder="you@studio.in" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button id="cta-submit" className="btn btn-y btn-sm" disabled={join.isPending}>{join.isPending ? "Joining…" : "Get early access"}</button>
            </form>
          </div>
          <div className="msg" aria-live="polite">
            {join.data && (join.data.already ? "You're already on the list :)" : "You're on the list :)")}
            {join.error && "Please enter a valid email."}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------- footer ------------------------------- */
export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="foot">
          <div>
            <Logo dark size={72} />
            <p className="foot-note">Background removal for images and video. Made in India.</p>
          </div>
          <div className="foot-cols">
            <div><h4>Product</h4><Link href="/app">Studio</Link><a href="#tools">Tools</a><a href="#pricing">Pricing</a></div>
            <div><h4>Account</h4><Link href="/account">Credits</Link><Link href="/account">API keys</Link><a href="#developers">Developers</a></div>
            <div><h4>Legal</h4><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/report">Report misuse</Link></div>
          </div>
        </div>
        <div className="foot-bottom"><span>© 2026 CutOut</span><span>Uploads auto-delete after 24 hours</span></div>
        <div className="giant" aria-hidden>CutOut :)</div>
      </div>
    </footer>
  );
}
