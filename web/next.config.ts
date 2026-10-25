import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Load single unified .env from root
loadEnvConfig(path.resolve(__dirname, ".."));

const AI_URL = process.env.AI_URL ?? "http://127.0.0.1:8100";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  serverExternalPackages: ["pg"],
  // Binary uploads (images/video) go straight to the Python GPU service.
  async rewrites() {
    return [{ source: "/ai/:path*", destination: `${AI_URL}/:path*` }];
  },
};

export default nextConfig;
