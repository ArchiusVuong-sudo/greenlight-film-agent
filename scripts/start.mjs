// Starts the web app (production build) and the worker together: npm start
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const port = process.env.PORT || "4105";
const host = process.env.HOST || "127.0.0.1";
const bin = (name) => `node_modules/.bin/${name}`;

const children = [
  spawn(bin("next"), ["start", "-p", port, "-H", host], { stdio: "inherit", env: process.env }),
  spawn(bin("tsx"), ["src/worker/index.ts"], { stdio: "inherit", env: process.env }),
];
console.log(`[start] web on http://${host}:${port}, worker running`);

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
};
for (const c of children) c.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
