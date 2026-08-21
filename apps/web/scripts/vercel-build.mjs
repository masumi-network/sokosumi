#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function turboBuildArgs(env = process.env) {
  const args = ["run", "build", "--filter=web"];
  if (env.VERCEL_ENV === "production") {
    args.push("--force");
  }
  return args;
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  const result = spawnSync("turbo", turboBuildArgs(), {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
