import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@anthropic-ai/claude-agent-sdk"],
  poweredByHeader: false,
  agentRules: false,
};

export default config;
