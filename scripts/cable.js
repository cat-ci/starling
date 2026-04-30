#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveScriptForPlatform(platform) {
  if (platform === "darwin") {
    return path.join(__dirname, "mac-audio.js");
  }

  if (platform === "linux") {
    return path.join(__dirname, "linux-audio.js");
  }

  return null;
}

function main() {
  const script = resolveScriptForPlatform(process.platform);

  if (!script) {
    console.error(`Unsupported platform: ${process.platform}`);
    console.error("This project currently supports macOS and Linux.");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
    stdio: "inherit"
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  process.exit(1);
}

main();
