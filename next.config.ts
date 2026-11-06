import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent notes live in CLAUDE.md; stop `next dev` from writing AGENTS.md.
  agentRules: false,
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
