import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent notes live in CLAUDE.md; stop `next dev` from writing AGENTS.md.
  agentRules: false,
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
