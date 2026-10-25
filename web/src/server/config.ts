const env = (k: string, d = "") => process.env[k] ?? d;

export const config = {
  jobSecret: env("JOB_SECRET"),
  authSecret: env("AUTH_SECRET"),
  aiUrl: env("AI_URL", "http://127.0.0.1:8100"),
  appUrl: env("APP_URL", "http://localhost:3001"),
  google: { id: env("GOOGLE_CLIENT_ID"), secret: env("GOOGLE_CLIENT_SECRET") },
  razorpay: { id: env("RAZORPAY_KEY_ID"), secret: env("RAZORPAY_KEY_SECRET"), webhook: env("RAZORPAY_WEBHOOK_SECRET") },
  adProvider: env("NEXT_PUBLIC_AD_PROVIDER", "test"),
  dev: process.env.NODE_ENV !== "production",
  dbPath: env("DB_PATH", "data/cutout.db"),
  databaseUrl: env("DATABASE_URL"),
};

export const devLoginAllowed = () => config.dev && !config.google.id;
export const devPaymentsAllowed = () => config.dev && !config.razorpay.id;
