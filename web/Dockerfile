# Next.js site. Env vars (JOB_SECRET, AUTH_SECRET, DATABASE_URL, Google/Razorpay/ad/Turnstile
# keys, APP_URL, AI_URL) are injected at container *run* time by docker-compose's `env_file`,
# not baked into the image — nothing secret lives in this build.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No real secrets needed at build time: Next.js only reads NEXT_PUBLIC_* vars into the client
# bundle, and this app's public vars (ad provider, Turnstile site key) are safe placeholders —
# the real values are injected at container start and only affect server-side behaviour.
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3001
ENV PORT=3001 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
