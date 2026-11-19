#!/usr/bin/env node
// explore.mjs — let Bombadil click around a signed-in Sokosumi at random and report
// crashes, unhandled rejections, console errors and failed page loads.
//
//   node explore.mjs [--path /studio] [--time 3m] [--keep-going] [--headed]
//   node explore.mjs --path /studio --reproduce <evidence dir>   # replay a run
//
// Needs the local stack (`local-stack up`) and `bombadil` on PATH. Signs in through
// drive.mjs first and hands its session cookies to Bombadil. Evidence goes to
// .cursor/verify-sokosumi-artifacts/explore/<timestamp>/ (trace, screenshots, log).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const WEB = (
  process.env.VERIFY_SOKOSUMI_WEB_URL || "http://localhost:3100"
).replace(/\/$/, "");
const EMAIL = process.env.VERIFY_SOKOSUMI_EMAIL || "alice@sokosumi.test";
const START = flag("--path", "/studio");
const TIME = flag("--time", "3m");
const REPRODUCE = flag("--reproduce");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const ARTIFACTS = path.join(REPO, ".cursor/verify-sokosumi-artifacts");
const OUT = path.join(ARTIFACTS, "explore", STAMP);

if (spawnSync("bombadil", ["--version"]).status !== 0) {
  console.error(
    "bombadil is not on PATH. Install it (macOS arm64):\n" +
      "  curl -L -o ~/.local/bin/bombadil https://github.com/antithesishq/bombadil/releases/download/v0.7.10/bombadil-aarch64-darwin && chmod +x ~/.local/bin/bombadil",
  );
  process.exit(2);
}

// Sign in the same way every journey does; drive.mjs saves the session to AUTH_STATE.
const signIn = spawnSync(
  process.execPath,
  [path.join(HERE, "drive.mjs"), "route", "--path", START],
  { stdio: "inherit" },
);
if (signIn.status !== 0) process.exit(signIn.status ?? 1);
const AUTH_STATE = path.join(
  ARTIFACTS,
  "state",
  `auth-${new URL(WEB).port || "443"}-${EMAIL.replace(/[^a-z0-9]/gi, "_")}.json`,
);
if (!existsSync(AUTH_STATE)) {
  console.error(`no saved session at ${AUTH_STATE}`);
  process.exit(1);
}
const cookies = JSON.parse(readFileSync(AUTH_STATE, "utf8")).cookies.filter(
  (c) => c.domain.replace(/^\./, "") === new URL(WEB).hostname,
);

mkdirSync(OUT, { recursive: true });
const bombadilArgs = [
  "browser",
  "test",
  `${WEB}${START}`,
  path.join(HERE, "../bombadil/sokosumi.spec.ts"),
  "--width",
  "1440",
  "--height",
  "900",
  "--output-path",
  OUT,
  "--output-path-overwrite",
  ...(args.includes("--headed") ? [] : ["--headless"]),
  ...(REPRODUCE
    ? ["--reproduce", path.resolve(REPRODUCE)]
    : [
        "--time-limit",
        TIME,
        ...(args.includes("--keep-going") ? [] : ["--exit-on-violation"]),
      ]),
  ...cookies.flatMap((c) => [
    "--cookie",
    `${c.name}=${c.value}; Path=${c.path}${c.httpOnly ? "; HttpOnly" : ""}`,
  ]),
];
console.log(`exploring ${WEB}${START} for up to ${TIME}`);
const run = spawnSync("bombadil", bombadilArgs, { encoding: "utf8" });
// Bombadil's reproduce hint echoes the session cookies; keep them out of logs.
const log = `${run.stdout}${run.stderr}`
  .split("\n")
  .filter(
    (line) =>
      !line.includes("--cookie") && line !== "Reproduce this test using:",
  )
  .join("\n");
writeFileSync(path.join(OUT, "log.txt"), log);
process.stdout.write(log.split("\n").slice(-30).join("\n"));
const rel = path.relative(process.cwd(), OUT);
console.log(
  `\nevidence ${OUT}\ninspect:   bombadil browser inspect ${rel}\nreproduce: node ${path.relative(process.cwd(), path.join(HERE, "explore.mjs"))} --path ${START} --reproduce ${rel}`,
);
process.exit(run.status ?? 1);
