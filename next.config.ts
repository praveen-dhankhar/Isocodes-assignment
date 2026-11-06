import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The contributor guide already covers this; stop `next dev` from writing an AGENTS.md.
  agentRules: false,
  poweredByHeader: false,
  // ARCHITECTURE §9. The CSP itself is per request (nonce) and set in src/proxy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  // Native modules for page rendering stay outside the bundle (ARCHITECTURE §10).
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],
  // Bundled sample files and recorded extractions are read at runtime ("Load sample set", sample provider).
  outputFileTracingIncludes: { "/**/*": ["./fixtures/samples/**/*", "./fixtures/extractions/**/*"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
