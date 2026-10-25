/** Business rules in one place. Every free path must earn more from ads than it costs on the GPU. */

export type Tool = "remove" | "erase" | "upscale" | "video" | "generate";

export const RULES = {
  /** Image tools share one free pool: remove, erase, upscale. */
  image: {
    adsPerJob: 3,
    anonLifetime: 2,
    loggedInPerDay: 10,
    credits: 1,
  },
  /** Free video needs Google login: 1 clip a day, capped, unlocked with ads. Beyond that, credits. */
  video: {
    adsPerJob: 5,
    freePerDay: 1,
    freeSeconds: 5,
    freeRes: 480,
    maxSeconds: 30,
    creditsPerSec: { 720: 1, 1080: 2 } as Record<number, number>,
  },
  /** Generation is credits-only: no free tier and no ad path. */
  generate: { credits: 1 },
  api: { freeImagesPerMonth: 50 },
  ad: { minWatchMs: 5000 },
  ipDailyCap: 60,
} as const;

export const IMAGE_TOOLS: Tool[] = ["remove", "erase", "upscale"];
export const isImageTool = (t: Tool) => IMAGE_TOOLS.includes(t);

export function videoCredits(seconds: number, res: number) {
  return Math.ceil(Math.min(seconds, RULES.video.maxSeconds)) * (RULES.video.creditsPerSec[res] ?? 2);
}

export function creditCost(tool: Tool, video?: { seconds: number; res: number }) {
  if (tool === "generate") return RULES.generate.credits;
  if (tool === "video") return videoCredits(video?.seconds ?? 5, video?.res === 1080 ? 1080 : 720);
  return RULES.image.credits;
}

export const PACKS = [
  { id: "starter", name: "Starter", price: 49, credits: 30 },
  { id: "creator", name: "Creator", price: 99, credits: 70 },
  { id: "pro", name: "Pro", price: 199, credits: 160 },
] as const;
