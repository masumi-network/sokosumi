#!/usr/bin/env node
/**
 * Runs Lighthouse on authenticated page(s).
 *
 * 1. Launches Chrome with remote debugging (visible window).
 * 2. Opens the login URL so you can sign in (e.g. Google/Microsoft).
 * 3. After you're logged in and on any app page, press Enter.
 * 4. Lighthouse runs against the audit URL(s) with cookies/session preserved.
 *
 * Usage:
 *   pnpm run perf:report:auth
 *   BASE_URL=... AUDIT_PATH=/tasks pnpm run perf:report:auth
 *   AUDIT_PATHS=/agents,/agents/ID,/tasks,/agents/ID/jobs,/agents/ID/jobs/JOB_ID AGENT_ID=... JOB_ID=... pnpm run perf:report:auth
 */

import * as chromeLauncher from "chrome-launcher";
import { createWriteStream, mkdir } from "fs";
import lighthouse from "lighthouse";
import { dirname, join } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

const DEFAULT_BASE_URL = "https://sokosumi-app-preprod.vercel.app";
const DEFAULT_AUDIT_PATH = "/agents";
const DEBUG_PORT = 9222;
const OUTPUT_DIR = join(ROOT_DIR, ".cursor");
const OUTPUT_BASE = join(OUTPUT_DIR, "sokosumi-perf");

/** DevTools throttling to simulate high-latency (e.g. Canada → US/EU): ~400ms RTT, 1 Mbps down. */
const HIGH_LATENCY_THROTTLING = {
  requestLatencyMs: 200,
  downloadThroughputKbps: 1024,
  uploadThroughputKbps: 512,
  cpuSlowdownMultiplier: 4,
};

/**
 * Path to filename-safe slug: /agents → agents, /agents/xyz/jobs → agents-xyz-jobs.
 */
function pathToSlug(path) {
  return path.replace(/^\/+/, "").replace(/\//g, "-") || "page";
}

/**
 * Resolve audit paths: AUDIT_PATHS (comma-separated) or single AUDIT_PATH.
 * Replaces {{agentId}} and {{jobId}} with AGENT_ID and JOB_ID env.
 */
function getAuditPaths() {
  const agentId = process.env.AGENT_ID || "";
  const jobId = process.env.JOB_ID || "";
  const raw = process.env.AUDIT_PATHS;
  const paths = raw
    ? raw.split(",").map((p) => p.trim().replace(/^\//, ""))
    : [(process.env.AUDIT_PATH || DEFAULT_AUDIT_PATH).replace(/^\//, "")];
  return paths
    .map((p) => "/" + p.replace(/\{\{agentId\}\}/gi, agentId).replace(/\{\{jobId\}\}/gi, jobId))
    .filter((p) => p !== "/");
}

function waitForEnter(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function writeReport(runnerResult, outputPathBase) {
  if (!runnerResult) return;
  const { report, lhr } = runnerResult;
  const reports = Array.isArray(report) ? report : [report];
  const htmlReport = reports.find(
    (r) => typeof r === "string" && r.trim().startsWith("<!"),
  );
  const jsonReport = reports.find(
    (r) => typeof r === "string" && r.trim().startsWith("{"),
  );
  if (htmlReport) {
    await new Promise((resolve, reject) => {
      const out = createWriteStream(outputPathBase + ".html");
      out.on("finish", resolve).on("error", reject);
      out.write(htmlReport);
      out.end();
    });
  }
  const jsonToWrite = jsonReport || JSON.stringify(lhr, null, 2);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(outputPathBase + ".json");
    out.on("finish", resolve).on("error", reject);
    out.write(jsonToWrite);
    out.end();
  });
}

async function main() {
  const baseUrl = (process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const auditPaths = getAuditPaths();
  const loginUrl = `${baseUrl}/signin`;
  const highLatency = process.env.THROTTLE === "high-latency";
  const outputBase = highLatency
    ? join(OUTPUT_DIR, "sokosumi-perf-high-latency")
    : OUTPUT_BASE;

  console.log("Authenticated Lighthouse run");
  console.log("  Login URL:  ", loginUrl);
  console.log(
    "  Audit URL(s):",
    auditPaths.length === 1 ? auditPaths[0] : auditPaths.join(", "),
  );
  if (highLatency) {
    console.log(
      "  Throttling: high-latency (~400ms RTT, 1 Mbps down) — simulates distant user (e.g. Canada)",
    );
  }
  const outputSuffix =
    auditPaths.length === 1 ? ".report" : ".report-<slug>";
  console.log("  Output:     ", `${outputBase}${outputSuffix}.{html,json}`);
  console.log("");

  const chrome = await chromeLauncher.launch({
    port: DEBUG_PORT,
    chromeFlags: ["--no-first-run", "--no-default-browser-check"],
    startingUrl: loginUrl,
  });

  console.log("Chrome launched. Sign in in the browser window.");
  console.log(
    "Then go to any app page (e.g. /agents) and press Enter here.",
  );
  await waitForEnter("Press Enter when you are logged in and ready... ");

  const outputDir = dirname(outputBase);
  await new Promise((resolve, reject) => {
    mkdir(outputDir, { recursive: true }, (err) =>
      err ? reject(err) : resolve(),
    );
  });

  const config = {
    extends: "lighthouse:default",
    onlyCategories: ["performance"],
    settings: {
      disableStorageReset: true,
      output: ["html", "json"],
      ...(highLatency && {
        throttlingMethod: "devtools",
        throttling: HIGH_LATENCY_THROTTLING,
      }),
    },
  };

  const results = [];
  for (let i = 0; i < auditPaths.length; i++) {
    const path = auditPaths[i];
    const auditUrl = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const slug = pathToSlug(path);
    const pathSuffix = auditPaths.length === 1 ? ".report" : `.report-${slug}`;
    const pathBase = outputBase + pathSuffix;

    console.log(`[${i + 1}/${auditPaths.length}] Auditing ${path} ...`);
    const runnerResult = await lighthouse(auditUrl, { port: DEBUG_PORT }, config);
    if (!runnerResult) {
      console.error(`  No result for ${path}`);
      continue;
    }
    await writeReport(runnerResult, pathBase);
    const perf = runnerResult.lhr?.categories?.performance;
    const score = perf?.score != null ? Math.round(perf.score * 100) : null;
    results.push({ path, slug, score });
    console.log(`  Score: ${score != null ? score : "N/A"} → ${pathBase}.html`);
  }

  await chrome.kill();

  console.log("");
  console.log("Done. Reports:");
  for (const { path, slug, score } of results) {
    const pathSuffix = auditPaths.length === 1 ? ".report" : `.report-${slug}`;
    console.log(`  ${score != null ? score : "N/A"}  ${path}  ${outputBase}${pathSuffix}.html`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
