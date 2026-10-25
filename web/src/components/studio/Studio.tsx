"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/trpc/client";
import { AccountBar, useAccountUi } from "./account";
import { BatchTool } from "./BatchTool";
import { EraseTool } from "./EraseTool";
import { GenerateTool } from "./GenerateTool";
import { RemoveTool } from "./RemoveTool";
import { UnlockProvider } from "./unlock";
import { UpscaleTool } from "./UpscaleTool";
import { VideoTool } from "./VideoTool";

export const TOOLS = [
  { id: "remove", label: "Remove background", short: "Background", h: "Click what you want to", em: "keep." },
  { id: "batch", label: "Batch removal", short: "Batch", h: "Drop multiple photos.", em: "Cut out all." },
  { id: "erase", label: "Erase object", short: "Erase", h: "Click what you want", em: "gone." },
  { id: "video", label: "Video background", short: "Video", h: "Select once,", em: "tracked everywhere." },
  { id: "upscale", label: "Upscale 2×", short: "Upscale", h: "Small photo?", em: "Make it sharp." },
  { id: "generate", label: "Generate image", short: "Generate", h: "Describe it.", em: "We'll make it." },
] as const;
type ToolId = (typeof TOOLS)[number]["id"];

export function Studio() {
  return (
    <UnlockProvider>
      <StudioInner />
    </UnlockProvider>
  );
}

function StudioInner() {
  const params = useSearchParams();
  const router = useRouter();
  const ui = useAccountUi();
  const engine = api.engine.status.useQuery(undefined, { refetchInterval: 20_000 });
  const initial = (TOOLS.find((t) => t.id === params.get("tool"))?.id ?? "remove") as ToolId;
  const [tool, setTool] = useState<ToolId>(initial);
  const [handoff, setHandoff] = useState<File | null>(null);
  const t = TOOLS.find((x) => x.id === tool)!;
  const loginError = params.get("login_error");
  const devLoginHint = params.get("login") === "dev";

  useEffect(() => {
    const buyParam = params.get("buy");
    if (buyParam) {
      ui.buy(buyParam);
      const next = new URLSearchParams(params.toString());
      next.delete("buy");
      const qs = next.toString();
      router.replace(qs ? `/app?${qs}` : "/app", { scroll: false });
    }
  }, [params, router, ui]);

  const choose = (id: ToolId) => {
    setTool(id);
    router.replace(`/app?tool=${id}`, { scroll: false });
  };

  return (
    <main className="app-shell wrap">
      <div className="app-top">
        <div>
          <span className="eyebrow">{t.label}</span>
          <h1>{t.h} <em>{t.em}</em></h1>
          <span className={`engine-note ${engine.data?.online ? "on" : ""}`}>
            <i />{engine.isLoading ? "Checking engine…" : engine.data?.online ? `Engine ready · ${engine.data.engine}${engine.data.device === "cuda" ? " · GPU" : ""}` : "Engine offline"}
          </span>
        </div>
        <AccountBar />
      </div>

      {(loginError || devLoginHint) && (
        <div className="alert" role="alert">
          {loginError ?? "Google sign-in isn't configured yet."}{" "}
          <button className="link" onClick={() => ui.signIn()}>Sign in</button>
        </div>
      )}

      <nav className="tool-tabs" aria-label="Tools">
        {TOOLS.map((x) => (
          <button key={x.id} className={tool === x.id ? "on" : ""} onClick={() => choose(x.id)} id={`tool-${x.id}`} aria-current={tool === x.id ? "page" : undefined}>
            <span className={`tico ${x.id}`} aria-hidden />{x.short}
          </button>
        ))}
      </nav>

      <section className="tool-card">
        {tool === "remove" && <RemoveTool initialFile={handoff} onConsumed={() => setHandoff(null)} />}
        {tool === "batch" && <BatchTool />}
        {tool === "erase" && <EraseTool />}
        {tool === "video" && <VideoTool />}
        {tool === "upscale" && <UpscaleTool />}
        {tool === "generate" && <GenerateTool onSendToRemove={(f) => { setHandoff(f); choose("remove"); }} />}
      </section>
    </main>
  );
}
