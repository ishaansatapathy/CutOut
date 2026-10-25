/** Client-side outputs made from a transparent cutout. No GPU, no extra cost. */

type Bounds = { x0: number; y0: number; x1: number; y1: number };
type Head = { top: number; chin: number; cx: number };

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function alphaGrid(img: HTMLImageElement, max = 400) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const [, ctx] = canvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, s };
}

export function bounds(img: HTMLImageElement): Bounds {
  const { data, w, h, s } = alphaGrid(img);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < x0) return { x0: 0, y0: 0, x1: img.naturalWidth, y1: img.naturalHeight };
  return { x0: x0 / s, y0: y0 / s, x1: (x1 + 1) / s, y1: (y1 + 1) / s };
}

/** Estimate crown-to-chin from the silhouette: widest point of the head, then the narrowest row (neck). */
export function head(img: HTMLImageElement): Head {
  const { data, w, h, s } = alphaGrid(img);
  const widths: number[] = [], centers: number[] = [];
  let top = -1;
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 80) { if (a < 0) a = x; b = x; }
    widths.push(a < 0 ? 0 : b - a + 1);
    centers.push(a < 0 ? w / 2 : (a + b) / 2);
    if (top < 0 && a >= 0) top = y;
  }
  if (top < 0) return { top: 0, chin: img.naturalHeight, cx: img.naturalWidth / 2 };
  let bottom = h - 1;
  while (bottom > top && widths[bottom] === 0) bottom--;
  const span = bottom - top;
  const sm = widths.map((_, i) => {
    let t = 0, n = 0;
    for (let k = -3; k <= 3; k++) if (widths[i + k] !== undefined) { t += widths[i + k]; n++; }
    return t / n;
  });
  let headMax = top;
  for (let y = top; y < top + span * 0.4; y++) if (sm[y] > sm[headMax]) headMax = y;
  let neck = headMax;
  for (let y = headMax; y < top + span * 0.75; y++) if (sm[y] < sm[neck]) neck = y;
  if (neck - top < span * 0.12) neck = Math.round(top + span * 0.35);
  return { top: top / s, chin: (neck - (neck - top) * 0.04) / s, cx: centers[headMax] / s };
}

const toBlob = (c: HTMLCanvasElement, type = "image/png", q?: number) =>
  new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, q));

/** WhatsApp/Instagram-style sticker: white die-cut border and a soft shadow, 512×512. */
export async function sticker(img: HTMLImageElement, border = 14) {
  const S = 512, pad = border + 10;
  const b = bounds(img);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const k = Math.min((S - pad * 2) / bw, (S - pad * 2) / bh);
  const dw = bw * k, dh = bh * k, dx = (S - dw) / 2, dy = (S - dh) / 2;
  const [sil, sctx] = canvas(S, S);
  sctx.drawImage(img, b.x0, b.y0, bw, bh, dx, dy, dw, dh);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, S, S);
  const [c, ctx] = canvas(S, S);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.28)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  for (let a = 0; a < 360; a += 12) {
    const r = (a * Math.PI) / 180;
    ctx.drawImage(sil, Math.cos(r) * border, Math.sin(r) * border);
    if (a === 0) { ctx.shadowColor = "transparent"; }
  }
  ctx.restore();
  ctx.drawImage(img, b.x0, b.y0, bw, bh, dx, dy, dw, dh);
  return { png: await toBlob(c), webp: await toBlob(c, "image/webp", 0.9), url: c.toDataURL() };
}

/** Profile picture: head and shoulders centred, on a colour, circle or square. */
export async function profile(img: HTMLImageElement, bg: string, shape: "circle" | "square") {
  const S = 1024;
  const hd = head(img);
  const k = (S * 0.42) / Math.max(1, hd.chin - hd.top);
  const [c, ctx] = canvas(S, S);
  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.fillStyle = bg;
