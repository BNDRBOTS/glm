import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // TS errors now surface at build time. Previously this was set to
  // `true` to mask the broken `@/* -> ./src/*` tsconfig path mapping.
  // With tsconfig.json paths fixed to `./*`, type-checking works and
  // should not be bypassed.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Allow preview origins (sandbox / Railway preview / local network)
  // without the dev-time CORS warning.
  allowedDevOrigins: [
    "*.space-z.ai",
    "*.up.railway.app",
    "127.0.0.1",
    "localhost",
    "*.preview.app",
  ],
  // Headers for production-grade PWA + streaming
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
