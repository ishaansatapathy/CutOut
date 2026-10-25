"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { creditCost, RULES } from "@/lib/rules";
import { useAccountUi, useMe } from "./account";
import { download, Dropzone, errorText } from "./SelectStage";
import { type Grant, useRefund, useUnlock, type VideoOpts } from "./unlock";

type NPt = { x: number; y: number; label: 0 | 1 };
type Job = { id: string; status: string; progress: number; frames: number; fps: number; width: number; height: number; seconds: number; error: string | null; outputs: string[] };
type Res = 480 | 720 | 1080;

export function VideoTool() {
  const me = useMe();
  const ui = useAccountUi();
  const unlock = useUnlock();
  const refundIfPaid = useRefund();
  const grantRef = useRef<Grant | null>(null);
  const refunded = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<{ dur: number; w: number; h: number } | null>(null);
  const [points, setPoints] = useState<NPt[]>([]);
  const [time, setTime] = useState(0);
  const [keep, setKeep] = useState(true);
  const [res, setRes] = useState<Res>(480);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);

  const free = res === 480;
  const seconds = Math.min(meta?.dur ?? 0, free ? RULES.video.freeSeconds : RULES.video.maxSeconds);
  const cost = creditCost("video", { seconds: Math.max(0.1, seconds), res });

  const pick = (f: File) => {
    setError(null);
    if (!f.type.startsWith("video/")) return setError("Please choose a video file.");
    if (f.size > 100 * 1024 * 1024) return setError("Videos must be under 100 MB.");
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setPoints([]);
    setJob(null);
  };

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = vid.current!;
    v.pause();
    setPlaying(false);
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const sameFrame = Math.abs(v.currentTime - time) < 0.05;
    setTime(v.currentTime);
    setPoints((p) => [...(sameFrame ? p : []), { x, y, label: keep ? 1 : 0 }]);
  };

  const run = async () => {
    setError(null);
    if (!file || !meta) return;
    if (!points.length) return setError("Pause on a frame and click the subject first.");
    if (time > seconds) return setError(`Pick a frame in the first ${Math.floor(seconds)} seconds — that's the part we'll process.`);
    if (!me.data?.user) return ui.signIn("Sign in to process video (1 free clip a day).");
    const opts: VideoOpts = { seconds: Math.max(0.5, seconds), res };
    const grant = await unlock("video", free ? "Process a free clip" : `Process at ${res}p`, opts);
    if (!grant) return;
    grantRef.current = grant;
    refunded.current = false;
    setUploading(true);
    const fd = new FormData();
    fd.append("video", file);
    fd.append("prompt", JSON.stringify({ time, norm: true, points }));
    const r = await fetch("/ai/v1/videos", { method: "POST", body: fd, headers: { "X-Job-Token": grant.token } });
    setUploading(false);
    if (!r.ok) { await refundIfPaid(grant); return setError(await errorText(r)); }
    setJob(await r.json());
  };

  useEffect(() => {
    if (!job) return;
    if (job.status === "failed" && !refunded.current) {
      refunded.current = true;
      void refundIfPaid(grantRef.current);
    }
    if (job.status === "done" || job.status === "failed") return;
    const t = setTimeout(async () => {
      const r = await fetch(`/ai/v1/jobs/${job.id}`);
      if (r.ok) setJob(await r.json());
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  if (!file) {
    return (
      <div className="tool-body">
        {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
        <Dropzone id="video-file" accept="video/*" label="Drop a short video" hint={`MP4, MOV or WebM · up to 100 MB · free clips are ${RULES.video.freeSeconds}s at ${RULES.video.freeRes}p`} onFile={pick} />
      </div>
    );
  }

  if (job) return <VideoResult job={job} setJob={setJob} onNew={() => { setFile(null); setJob(null); }} />;

  return (
    <div className="tool-body">
      {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
      <div className="toolbar">
        <div className="seg">
          <button className={keep ? "on" : ""} onClick={() => setKeep(true)}>＋ Keep</button>
          <button className={!keep ? "on" : ""} onClick={() => setKeep(false)}>－ Remove</button>
        </div>
        <span className="tool-note">{points.length ? `${points.length} click${points.length > 1 ? "s" : ""} at ${time.toFixed(2)}s` : "Pause on any frame, then click your subject"}</span>
        <span className="spacer" />
        <button className="btn btn-line btn-sm" onClick={() => setPoints([])} disabled={!points.length}>Clear</button>
        <button className="btn btn-line btn-sm" onClick={() => setFile(null)}>New video</button>
      </div>
      <div className="work">
        <div className="vcol">
          <div className="vstage" style={meta ? { aspectRatio: `${meta.w} / ${meta.h}`, width: `min(100%, calc(66vh * ${meta.w / meta.h}))` } : undefined}>
            <video
              ref={vid} src={url} playsInline muted
              onLoadedMetadata={(e) => setMeta({ dur: e.currentTarget.duration, w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
              onEnded={() => setPlaying(false)}
            />
            <div className="vhit" onClick={click} aria-label="Click the subject on this frame" role="application">
              {points.map((p, i) => (
                <span key={i} className={`spt ${p.label ? "add" : "rem"}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
              ))}
            </div>
          </div>
          <div className="scrub">
            <button
              className="play" aria-label={playing ? "Pause" : "Play"}
              onClick={() => { const v = vid.current!; if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } }}
            >{playing ? "❚❚" : "▶"}</button>
            <input
              type="range" min={0} max={meta?.dur ?? 0} step={0.01} value={now} aria-label="Scrub video"
              onChange={(e) => { const v = vid.current!; v.currentTime = Number(e.target.value); setNow(v.currentTime); }}
            />
            <span className="t">{now.toFixed(1)}s</span>
          </div>
        </div>
        <aside className="side">
          <span className="opt-label">Quality</span>
          <div className="res-opts">
            {([480, 720, 1080] as Res[]).map((r) => (
              <button key={r} className={`res ${res === r ? "on" : ""}`} onClick={() => setRes(r)} id={`res-${r}`}>
                <b>{r}p</b>
                <small>{r === 480 ? `Free · ${RULES.video.freeSeconds}s · ads` : `${RULES.video.creditsPerSec[r]} credit/sec`}</small>
              </button>
            ))}
          </div>
          {meta && (
            <p className="fine-left">
              Clip is {meta.dur.toFixed(1)}s. We&apos;ll process {seconds.toFixed(1)}s{seconds < meta.dur ? " from the start" : ""}.
              {!free && <> Cost: <b>{cost} credits</b>.</>}
            </p>
          )}
          <button className="btn btn-k btn-block" onClick={run} disabled={uploading || !points.length} id="video-go">
            {uploading ? "Uploading…" : "Cut out this video"}
          </button>
          <p className="fine-left">Exports WebM with real transparency, or MP4 on a colour. Keeps the original audio.</p>
        </aside>
      </div>
    </div>
  );
}

function VideoResult({ job, setJob, onNew }: { job: Job; setJob: (j: Job) => void; onNew: () => void }) {
  const [fix, setFix] = useState<number | null>(null);
  const [fixPts, setFixPts] = useState<NPt[]>([]);
  const [keep, setKeep] = useState(false);
  const [color, setColor] = useState("#ffffff");
  const [error, setError] = useState<string | null>(null);
  const done = job.status === "done";
  const samples = Array.from({ length: 8 }, (_, i) => Math.round((i * (job.frames - 1)) / 7));
  const bust = `${job.status}-${job.progress}`;

  const correct = async () => {
    if (fix === null || !fixPts.length) return;
    setError(null);
    const r = await fetch(`/ai/v1/videos/${job.id}/correct`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: fix / job.fps, norm: true, points: fixPts }),
    });
    if (!r.ok) return setError(await errorText(r));
    setJob(await r.json());
    setFix(null);
    setFixPts([]);
  };

  if (job.status === "failed") {
    return (
      <div className="tool-body">
        <div className="alert">Processing failed: {job.error ?? "unknown error"}</div>
        <button className="btn btn-k" onClick={onNew}>Try another video</button>
      </div>
    );
  }

  return (
    <div className="tool-body">
      {error && <div className="alert" role="alert" onClick={() => setError(null)}>{error}</div>}
      {!done ? (
        <div className="vprogress">
          <b>{job.status === "queued" ? "Waiting for the GPU…" : job.progress < 0.9 ? "Tracking your subject…" : "Refining edges and encoding…"}</b>
          <div className="pbar"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
          <span>{Math.round(job.progress * 100)}% · {job.frames} frames at {job.height}p</span>
        </div>
      ) : (
        <div className="work">
          <div className="vout checker">
            <video src={`/ai/v1/jobs/${job.id}/result?format=webm&v=${bust}`} autoPlay loop muted playsInline controls />
          </div>
          <aside className="side">
            <span className="opt-label">Download</span>
            <button className="btn btn-k btn-block" onClick={() => download(`/ai/v1/jobs/${job.id}/result?format=webm`, "cutout.webm")} id="video-webm">WebM · transparent ↓</button>
            <div className="mp4-row">
              <label className="swatch pick big" title="MP4 background colour">
                <i style={{ background: color }} />
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="MP4 background colour" />
              </label>
              <button className="btn btn-line btn-block" onClick={() => download(`/ai/v1/jobs/${job.id}/result?format=mp4&color=${encodeURIComponent(color)}`, "cutout.mp4")} id="video-mp4">MP4 on this colour ↓</button>
            </div>
            <button className="btn btn-line btn-block" onClick={onNew}>New video</button>
            <p className="fine-left">Spot a bad frame below? Click it, add a correction click, and only that part re-runs.</p>
          </aside>
        </div>
      )}
      {done && (
        <>
          <span className="opt-label">Check frames</span>
          <div className="vsamples">
            {samples.map((f) => (
              <button key={f} className={fix === f ? "on" : ""} onClick={() => { setFix(f); setFixPts([]); }} aria-label={`Frame ${f + 1}`}>
                <img src={`/ai/v1/jobs/${job.id}/frame/${f}?v=${bust}`} alt="" loading="lazy" />
                <small>{(f / job.fps).toFixed(1)}s</small>
              </button>
            ))}
          </div>
        </>
      )}
      {fix !== null && done && (
        <div className="vfix">
          <div className="toolbar">
            <div className="seg">
              <button className={keep ? "on" : ""} onClick={() => setKeep(true)}>＋ Add missed part</button>
              <button className={!keep ? "on" : ""} onClick={() => setKeep(false)}>－ Remove wrong part</button>
            </div>
            <span className="spacer" />
            <button className="btn btn-line btn-sm" onClick={() => setFix(null)}>Cancel</button>
            <button className="btn btn-k btn-sm" disabled={!fixPts.length} onClick={correct} id="video-correct">Re-run from {(fix / job.fps).toFixed(1)}s</button>
          </div>
          <div
            className="vfix-stage" style={{ aspectRatio: `${job.width} / ${job.height}`, width: `min(100%, calc(60vh * ${job.width / job.height}))` }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setFixPts((p) => [...p, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, label: keep ? 1 : 0 }]);
            }}
          >
            <img src={`/ai/v1/jobs/${job.id}/frame/${fix}?v=${bust}`} alt={`Frame ${fix + 1}`} />
            {fixPts.map((p, i) => <span key={i} className={`spt ${p.label ? "add" : "rem"}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />)}
          </div>
        </div>
      )}
    </div>
  );
}
