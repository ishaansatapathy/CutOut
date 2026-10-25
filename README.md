# CutOut :)

Background removal for images and video, plus erase, batch removal, upscale, stickers, profile
pictures, ID photos, thumbnails and credit-based image generation.

```
web/       Next.js site + Studio (/app) + account (/account) + public API (/api/v1)
           login, ads, credits, refunds, bot protection, SQLite or Postgres/Neon
backend/   FastAPI GPU service — SAM 2, BiRefNet matting, LaMa eraser, Swin2SR upscaler,
           image generation, video jobs (with optional webhook delivery)
frontend/  old single-page prototype (unused)
```

The browser never gets free GPU access: the web server decides whether a job is paid for (ads watched,
credits charged, or the API's monthly allowance) and mints a one-time **job token** signed with `JOB_SECRET`.
The GPU service rejects any costly call without a valid, unused token for that exact tool. If a job then
fails on the server, the charged credits are refunded automatically.

## Run locally

```powershell
# 1. GPU service (port 8100). First run downloads ~3 GB of models.
cd backend
python -m venv .venv
.\.venv\Scripts\pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\pip install -r requirements.txt
$env:SAM2_BUILD_CUDA="0"; .\.venv\Scripts\pip install --no-build-isolation git+https://github.com/facebookresearch/sam2.git
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8100

# 2. Website (port 3001)
cd web
npm install
npx next dev -p 3001
```

Copy `.env.example` to `.env` at the repo root and fill in `JOB_SECRET`/`AUTH_SECRET` (random hex strings) —
both the web server and the GPU service read this one file. Needs ffmpeg on PATH.

## Adding your keys (all optional; everything runs in test mode without them)

Paste keys into the root `.env`, then restart that server.

| Feature | Keys | Without it |
|---|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — redirect URI `{APP_URL}/api/auth/callback/google` | email-only dev sign-in |
| UPI payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (webhook → `/api/payments/razorpay`) | simulated purchases |
| Rewarded ads | `NEXT_PUBLIC_AD_PROVIDER=gpt`, `NEXT_PUBLIC_GPT_REWARDED_UNIT=/network/unit` | 5-second test-ad placeholders |
| Bot protection | `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Cloudflare Turnstile, free) | no human check on the anonymous free tier |
| Database | `DATABASE_URL=postgres://…` (Neon or any Postgres) | local SQLite file |
| Image generation | `GEN_PROVIDER=openai` + `OPENAI_API_KEY`, **or** `GEN_PROVIDER=gemini` + `GEMINI_API_KEY` | runs on this GPU (SD-Turbo) |

The generation provider is chosen only in `.env`; the website just shows "Generate image" and never names a
provider. Generated images carry an "AI-generated" tag in their file metadata.

## Database

Leave `DATABASE_URL` blank to use a local SQLite file. Set it to a Postgres connection string (Neon works well)
to use that instead — the same code and schema run on both; the adapter in `web/src/server/db.ts` writes
Postgres-style SQL and translates it for SQLite. The credit balance is always the sum of the `credit_ledger`,
so it can't drift. Expired ad sessions and old job rows are cleaned up every 6 hours.

## Rules (edit in one place: `web/src/lib/rules.ts`)

- Image tools (remove, erase, batch, upscale): 2 free without sign-in, then 10/day with Google. 3 ads each, or 1 credit.
- Stickers, profile pictures, ID photos, thumbnails: made in the browser from a cutout, no extra cost.
- Video: 1 free clip/day with Google, 5s at 480p, 5 ads. Otherwise 1 credit/s at 720p, 2 at 1080p, max 30s.
- Image generation: credits only (1 credit).
- API: 50 free images a month, then credits. 10 requests/minute per key (per server process — see Known limits).
- Uploads and results are deleted after 24 hours.

## Security notes

- **Anonymous free tier**: gated by a device cookie + a daily cap per IP, and (once `TURNSTILE_SECRET_KEY` is
  set) a Cloudflare Turnstile check before each ad-unlock. Signed-in users aren't shown Turnstile — a real
  Google account plus the daily cap is already a much higher bar to script.
- **Video webhooks**: `webhook_url` (set via the Studio or the public API) is validated before the job is even
  accepted, and re-validated right before delivery — both times resolving the hostname and rejecting private,
  loopback, link-local or reserved addresses (this blocks pointing it at the GPU box's own internal services or
  a cloud metadata endpoint). Redirects on the outbound delivery request are not followed.
- **Job tokens**: single-use, HMAC-signed, scoped to one tool, short-lived. The GPU service refuses any
  `/v1/*` call without one.

## Known limits

- The public API's 10-req/min limiter and the video job queue are in-memory per process — correct for a
  single `web` / single `backend` instance (what the Docker Compose setup here runs). Scaling either to
  multiple replicas needs a shared store (Redis) for the limiter and a real job queue for video.
- Rewarded ads only confirm completion in the browser (no server-to-server callback from most networks), so
  ad rewards are guarded by a minimum watch time and the daily caps, not a verified network callback.
- Watermark / AI-label removal is intentionally not built.

## Deploying

A Docker Compose setup is included (`docker-compose.yml`, `backend/Dockerfile`, `web/Dockerfile`):

```bash
cp .env.example .env   # fill in real values — APP_URL/AI_URL especially (see below)
docker compose up --build -d
```

- The `backend` container is **not published to the host** — only `web` can reach it, at `http://backend:8100`
  over the compose network. Keep it that way; it has no auth of its own beyond job tokens, and job tokens are
  minted by `web`, not meant to be requested by anyone who can reach port 8100 directly.
- `backend` needs an NVIDIA GPU + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
  on the host. Match `backend/Dockerfile`'s CUDA base image and `torch` index URL (`cu128`) to your GPU driver
  if it differs.
- Set `APP_URL` in `.env` to your real public URL (not `localhost`) — it's used for the Google OAuth redirect
  and cookie behaviour. `NODE_ENV=production` (set by the compose file) turns on `Secure` cookies, so you need
  real HTTPS in front of `web` — a reverse proxy (Caddy, Nginx, or your platform's own TLS) isn't included here.
- Point `DATABASE_URL` at Postgres (Neon or otherwise) rather than leaving it blank — SQLite's file would live
  only inside the container's ephemeral filesystem unless you add a volume for it.
- `backend`'s `DATA_DIR` (uploads/jobs, auto-deleted after 24h anyway) is mounted to a named volume
  (`backend_data`) so a container restart doesn't drop in-flight jobs.
