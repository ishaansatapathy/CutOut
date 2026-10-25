"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { createZip } from "@/lib/zip";
import { download, errorText, loadImage } from "./SelectStage";
import { useRefund, useUnlock } from "./unlock";

type BatchItem = {
  id: string;
  file: File;
  origUrl: string;
  cutUrl?: string;
  blob?: Blob;
  status: "idle" | "cutting" | "done" | "error";
  error?: string;
};

const BATCH_BGS = [
  { id: "none", label: "Transparent PNG", c: "" },
  { id: "white", label: "Pure White (#FFF)", c: "#ffffff" },
  { id: "gray", label: "Marketplace Gray", c: "#f7f7f8" },
  { id: "yellow", label: "CutOut Yellow", c: "#ffd60a" },
];

export function BatchTool() {
  const unlock = useUnlock();
  const refundIfPaid = useRefund();
  const [items, setItems] = useState<BatchItem[]>([]);
  const [bg, setBg] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (files: FileList | File[]) => {
    setError(null);
    const valid = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!valid.length) return setError("Please select image files.");
    const newItems: BatchItem[] = valid.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      origUrl: URL.createObjectURL(f),
      status: "idle",
    }));
    setItems((prev) => [...prev, ...newItems]);
  };

  const removeItem = (id: string) => {
    if (busy) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const processBatch = async () => {
    if (!items.length || busy) return;
    setError(null);
    setBusy(true);

    const pending = items.filter((it) => it.status !== "done");
    for (let i = 0; i < pending.length; i++) {
      const it = pending[i];
      setCurrentIdx(i + 1);

      setItems((prev) =>
        prev.map((x) => (x.id === it.id ? { ...x, status: "cutting" } : x))
      );

      const grant = await unlock("remove", `Process ${it.file.name}`);
      if (!grant) {
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, status: "idle" } : x))
        );
        break;
      }

      try {
        // Box the central ~70% of the actual image so the subject is selected
        // regardless of the photo's real resolution (phone photos are rarely 1000x1000).
        const img = await loadImage(it.origUrl);
        const w = img.naturalWidth, h = img.naturalHeight;
        const box = [w * 0.15, h * 0.15, w * 0.85, h * 0.85];

        const fd = new FormData();
        fd.append("image", it.file);
        fd.append("prompt", JSON.stringify({ box }));
        if (bg) {
          fd.append("background", bg);
        }

        const r = await fetch("/ai/v1/images/remove-background", {
          method: "POST",
          body: fd,
          headers: { "X-Job-Token": grant.token },
        });

        if (!r.ok) {
          await refundIfPaid(grant);
          const msg = await errorText(r);
          setItems((prev) =>
            prev.map((x) => (x.id === it.id ? { ...x, status: "error", error: msg } : x))
          );
          continue;
        }

        const blob = await r.blob();
        const cutUrl = URL.createObjectURL(blob);
        setItems((prev) =>
          prev.map((x) =>
            x.id === it.id ? { ...x, status: "done", cutUrl, blob } : x
          )
        );
      } catch (err) {
        await refundIfPaid(grant);
        setItems((prev) =>
          prev.map((x) =>
            x.id === it.id ? { ...x, status: "error", error: (err as Error).message } : x
          )
        );
      }
    }

    setBusy(false);
  };

  const downloadAllZip = async () => {
    const finished = items.filter((it) => it.status === "done" && it.blob);
    if (!finished.length) return;

    const filesToZip: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < finished.length; i++) {
      const it = finished[i];
      const baseName = it.file.name.replace(/\.[^/.]+$/, "");
      const name = `${baseName}-cutout.png`;
      const buf = await it.blob!.arrayBuffer();
      filesToZip.push({ name, data: new Uint8Array(buf) });
    }

    const zipBlob = createZip(filesToZip);
    const zipUrl = URL.createObjectURL(zipBlob);
    download(zipUrl, `cutout-batch-${Date.now()}.zip`);
  };

  const doneCount = items.filter((it) => it.status === "done").length;

  return (
    <div className="tool-body">
      {error && (
        <div className="alert" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
          }}
        >
          <span className="ico">📦</span>
          <strong>Drop multiple product photos here</strong>
          <span className="muted">
            Batch mode for sellers & creators · Upload up to 20 images at once
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </label>
      ) : (
        <>
          <div className="toolbar">
            <label className="btn btn-line btn-sm cursor-pointer">
              ＋ Add more images
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={busy}
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </label>

            <span className="tool-note">
              {items.length} photo{items.length > 1 ? "s" : ""} in queue
              {doneCount > 0 && ` · ${doneCount} ready`}
            </span>

            <span className="spacer" />

            <div className="seg">
              {BATCH_BGS.map((b) => (
                <button
                  key={b.id}
                  className={bg === b.c ? "on" : ""}
                  onClick={() => setBg(b.c)}
                  disabled={busy}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <button
              className="btn btn-k btn-sm"
              onClick={processBatch}
              disabled={busy || doneCount === items.length}
              id="batch-start"
            >
              {busy ? `Processing (${currentIdx}/${items.length})…` : "Cut out all images →"}
            </button>

            {doneCount > 0 && (
              <button
                className="btn btn-k btn-sm"
                onClick={downloadAllZip}
                id="batch-download-zip"
              >
                Download ZIP ({doneCount}) ↓
              </button>
            )}

            <button
              className="btn btn-line btn-sm"
              disabled={busy}
              onClick={() => setItems([])}
            >
              Clear all
            </button>
          </div>

          {busy && (
            <div className="vprogress" style={{ margin: "16px 0" }}>
              <b>Processing batch queue…</b>
              <div className="pbar">
                <i style={{ width: `${Math.round((doneCount / items.length) * 100)}%` }} />
              </div>
              <span>
                {doneCount} of {items.length} completed
              </span>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
              marginTop: 18,
            }}
          >
            {items.map((it, idx) => (
              <div
                key={it.id}
                style={{
                  background: "var(--k2)",
                  border: "1px solid var(--y-line)",
                  borderRadius: 16,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                }}
              >
                <div
                  className={it.cutUrl ? (bg ? "" : "checker") : ""}
                  style={{
                    aspectRatio: "1/1",
                    position: "relative",
                    background: it.cutUrl && bg ? bg : undefined,
                  }}
                >
                  <img
                    src={it.cutUrl || it.origUrl}
                    alt={it.file.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                  {it.status === "cutting" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,0.65)",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--y)",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      Cutting out…
                    </div>
                  )}
                  {it.status === "error" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(220,38,38,0.75)",
                        display: "grid",
                        placeItems: "center",
                        color: "#fff",
                        padding: 10,
                        textAlign: "center",
                        fontSize: 12,
                      }}
                    >
                      {it.error || "Failed"}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 130,
                    }}
                    title={it.file.name}
                  >
                    {idx + 1}. {it.file.name}
                  </span>

                  {it.cutUrl ? (
                    <button
                      className="btn btn-k"
                      style={{ padding: "4px 8px", fontSize: 11 }}
                      onClick={() =>
                        download(it.cutUrl!, `${it.file.name.replace(/\.[^/.]+$/, "")}-cutout.png`)
                      }
                    >
                      Save ↓
                    </button>
                  ) : !busy ? (
                    <button
                      className="link"
                      style={{ color: "var(--muted)", fontSize: 12 }}
                      onClick={() => removeItem(it.id)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
