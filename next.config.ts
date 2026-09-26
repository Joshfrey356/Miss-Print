import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["postgres", "bcryptjs", "@electric-sql/pglite"],
  // Preview mode (no DATABASE_URL) loads the demo data + PGlite's WASM files at runtime.
  outputFileTracingIncludes: {
    "/**": ["./preview/**/*", "./node_modules/@electric-sql/pglite/dist/**/*"],
    "/*": ["./preview/**/*", "./node_modules/@electric-sql/pglite/dist/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
