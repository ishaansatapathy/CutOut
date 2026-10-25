# CutOut :)

Background removal for images and video, plus erase, upscale, stickers, profile pictures, ID photos,
thumbnails and credit-based image generation. Runs locally (localhost).

```
web/       Next.js site + Studio (/app) + account (/account) + public API (/api/v1)
           login, ads, credits, refunds, SQLite or Neon/Postgres
backend/   FastAPI GPU service — SAM 2, BiRefNet matting, LaMa eraser, Swin2SR upscaler,
           image generation, video jobs
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

`backend/.env` and `web/.env.local` must share the same `JOB_SECRET` (already generated). Needs ffmpeg on PATH.

## Adding your API keys (all optional; everything runs in test mode without them)

Paste keys into `web/.env.local` (web) or `backend/.env` (generation), then restart that server.

| Feature | File | Keys | Without it |
|---|---|---|---|
| Google sign-in | web | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — redirect URI `http://localhost:3001/api/auth/callback/google` | email-only dev sign-in |
| UPI payments | web | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (webhook → `/api/payments/razorpay`) | simulated purchases |
| Rewarded ads | web | `NEXT_PUBLIC_AD_PROVIDER=gpt`, `NEXT_PUBLIC_GPT_REWARDED_UNIT=/network/unit` | 5-second test-ad placeholders |
| Database | web | `DATABASE_URL=postgres://…` (Neon) | local SQLite file |
| Image generation | backend | `GEN_PROVIDER=openai` + `OPENAI_API_KEY`, **or** `GEN_PROVIDER=gemini` + `GEMINI_API_KEY` | runs on this GPU (SD-Turbo) |

The generation provider is chosen only in `backend/.env`; the website just shows "Generate image" and never
names a provider. Generated images carry an "AI-generated" tag in their file metadata.

## Database

Leave `DATABASE_URL` blank to use the bundled SQLite file at `web/data/cutout.db` (what runs now). Set it to a
Neon/Postgres connection string to use that instead — the same code and schema work on both; the adapter in
`web/src/server/db.ts` writes Postgres-style SQL and translates it for SQLite. The credit balance is always the
sum of the `credit_ledger`, so it can't drift. Expired ad sessions and old job rows are cleaned up every 6 hours.

## Rules (edit in one place: `web/src/lib/rules.ts`)

- Image tools (remove, erase, upscale): 2 free without sign-in, then 10/day with Google. 3 ads each, or 1 credit.
- Stickers, profile pictures, ID photos, thumbnails: made in the browser from a cutout, no extra cost.
- Video: 1 free clip/day with Google, 5s at 480p, 5 ads. Otherwise 1 credit/s at 720p, 2 at 1080p, max 30s.
- Image generation: credits only (1 credit).
- API: 50 free images a month, then credits. 10 requests/minute per key.
- Uploads and results are deleted after 24 hours.

## Notes / limits

- For web rewarded ads, the ad network only confirms completion in the browser, so ad rewards are guarded by a
  minimum watch time and the daily caps, not a server-to-server callback.
- Watermark / AI-label removal is intentionally not built.
