import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import type { NextConfig } from "next";

const internalApiUrl = process.env.ONYX_INTERNAL_URL ?? "http://127.0.0.1:4000";

function localNetworkHosts(): string[] {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => entry.address);
  const extra = (process.env.ONYX_DEV_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const name = hostname();
  return [...new Set([...addresses, name, `${name}.local`, "*.local", "*.lan", ...extra])];
}

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(process.cwd(), "../.."),
  transpilePackages: ["@onyx/contracts", "@onyx/ignore-compiler"],
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: localNetworkHosts(),
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
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default config;
