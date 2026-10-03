import { join } from "node:path";
import type { NextConfig } from "next";

const internalApiUrl = process.env.ONYX_INTERNAL_URL ?? "http://127.0.0.1:4000";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(process.cwd(), "../.."),
  transpilePackages: ["@onyx/contracts"],
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${internalApiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
