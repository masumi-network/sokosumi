#!/usr/bin/env node
/**
 * Portless helpers for local / worktree stacks.
 *
 * Commands:
 *   node scripts/local-env/portless-dev.mjs bootstrap
 *   node scripts/local-env/portless-dev.mjs proxy
 *   node scripts/local-env/portless-dev.mjs url web|core
 *   node scripts/local-env/portless-dev.mjs run
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapLocalEnv } from "./bootstrap.mjs";

export const PORTLESS_WEB_NAME = "web.sokosumi";
export const PORTLESS_CORE_NAME = "core.sokosumi";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * @param {string} [root]
 */
export function resolvePortlessBin(root = repoRoot) {
  const local = path.join(root, "node_modules", ".bin", "portless");
  if (fs.existsSync(local)) {
    return local;
  }
  return "portless";
}

/**
 * @param {string[]} args
 * @param {{ encoding?: string, stdio?: import("node:child_process").StdioOptions }} [opts]
 */
export function runPortless(args, opts = {}) {
  const bin = resolvePortlessBin();
  const result = spawnSync(bin, args, {
    cwd: repoRoot,
    encoding: opts.encoding ?? "utf8",
    stdio: opts.stdio ?? "pipe",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    const stdout = String(result.stdout ?? "").trim();
    const detail = stderr || stdout || `exit ${result.status}`;
    const error = new Error(`portless ${args.join(" ")} failed: ${detail}`);
    error.stderr = stderr;
    error.stdout = stdout;
    error.status = result.status;
    throw error;
  }
  return String(result.stdout ?? "").trim();
}

/**
 * @param {"web" | "core"} app
 */
export function portlessNameFor(app) {
  return app === "core" ? PORTLESS_CORE_NAME : PORTLESS_WEB_NAME;
}

/**
 * Grok/Cursor copies are full checkouts (not `git worktree add`), so portless
 * does not add a branch prefix. Prefix by directory basename so they cannot
 * steal `web.sokosumi` / `core.sokosumi` from the primary checkout.
 *
 * @param {string} [root]
 */
export function portlessInstancePrefix(root = repoRoot) {
  const normalized = root.replaceAll("\\", "/");
  for (const marker of ["/.grok/worktrees/", "/.worktrees/"]) {
    if (normalized.includes(marker)) {
      return path
        .basename(normalized)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }
  }
  return "";
}

/**
 * @param {"web" | "core"} app
 * @param {string} [root]
 */
export function portlessAppName(app, root = repoRoot) {
  const prefix = portlessInstancePrefix(root);
  const base = portlessNameFor(app);
  return prefix ? `${prefix}.${base}` : base;
}

/**
 * @param {string} name
 * @param {string} filter
 */
export function portlessSpawnArgs(name, filter) {
  return [
    "run",
    "--name",
    name,
    "--force",
    "--",
    "pnpm",
    "--filter",
    filter,
    "dev",
  ];
}

/**
 * @param {string} [selector]
 * @returns {Array<"web" | "core">}
 */
export function parseRunApps(selector) {
  if (selector == null || selector === "") {
    return ["core", "web"];
  }
  if (selector === "web" || selector === "core") {
    return [selector];
  }
  throw new Error("usage: portless-dev.mjs run [web|core]");
}

/**
 * @param {"web" | "core"} app
 * @param {{ webUrl: string, coreUrl: string }} urls
 */
export function envForDevApp(app, urls) {
  const shared = {
    WEB_APP_BASE_URL: urls.webUrl,
    BETTER_AUTH_COOKIE_DOMAIN: "sokosumi.localhost",
  };
  if (app === "core") {
    return {
      ...shared,
      BETTER_AUTH_URL: urls.coreUrl,
    };
  }
  return {
    ...shared,
    CORE_APP_BASE_URL: urls.coreUrl,
  };
}

/**
 * @param {string} [selector]
 * @param {{ webUrl: string, coreUrl: string }} urls
 * @param {string} [root]
 */
export function spawnPlan(selector, urls, root = repoRoot) {
  return parseRunApps(selector).map((app) => ({
    app,
    name: portlessAppName(app, root),
    filter: app === "core" ? "@sokosumi/core" : "web",
    env: envForDevApp(app, urls),
  }));
}

/**
 * @param {"web" | "core"} app
 */
export function getPortlessUrl(app) {
  return runPortless(["get", portlessAppName(app)]);
}

/**
 * Named URLs must be https on implicit 443. A :1355 (or other) URL means
 * the proxy fell back because sudo/TTY was missing.
 *
 * @param {string} url
 */
export function assertHttps443(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`portless returned an invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `portless URL is ${url}; expected https on port 443. Run: pnpm exec portless proxy start`,
    );
  }
  if (parsed.port && parsed.port !== "443") {
    throw new Error(
      `portless proxy is on :${parsed.port}, not 443 (${url}). Stop it and run: pnpm exec portless proxy start`,
    );
  }
}

export function ensureProxy() {
  try {
    runPortless(["proxy", "start"], { stdio: "inherit" });
  } catch (error) {
    const text = `${error.stderr ?? ""} ${error.stdout ?? ""} ${error.message}`;
    if (!/already/i.test(text)) {
      throw new Error(
        `Could not start the portless HTTPS proxy on 443 (sudo may be required).\nRun: pnpm exec portless proxy start\n${error.message}`,
      );
    }
  }

  const probe = getPortlessUrl("web");
  assertHttps443(probe);
  return probe;
}

function spawnDev({ name, filter, env }) {
  const bin = resolvePortlessBin();
  const wrapped = fs.existsSync(
    path.join(repoRoot, ".cursor", "cloud-agent-db.env"),
  )
    ? [
        process.execPath,
        path.join(repoRoot, "scripts", "cloud-agent-db", "with-db.mjs"),
        "--",
        bin,
        ...portlessSpawnArgs(name, filter),
      ]
    : [bin, ...portlessSpawnArgs(name, filter)];

  const [cmd, ...args] = wrapped;
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  return child;
}

async function runStack(selector) {
  const apps = parseRunApps(selector);
  await bootstrapLocalEnv(repoRoot);
  ensureProxy();
  const webUrl = getPortlessUrl("web");
  const coreUrl = getPortlessUrl("core");
  assertHttps443(webUrl);
  assertHttps443(coreUrl);

  console.log(`web  ${webUrl}`);
  console.log(`core ${coreUrl}`);
  if (apps.length === 1) {
    console.log(`starting ${apps[0]} only`);
  }

  const children = spawnPlan(selector, { webUrl, coreUrl }).map((item) =>
    spawnDev({
      name: item.name,
      filter: item.filter,
      env: item.env,
    }),
  );

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const codes = await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          child.on("exit", (code, signal) => {
            const exitCode = code ?? (signal ? 1 : 0);
            if (exitCode !== 0) {
              shutdown("SIGTERM");
            }
            resolve(exitCode);
          });
        }),
    ),
  );
  const failed = codes.find((code) => code !== 0);
  process.exit(failed ?? 0);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const command = process.argv[2] ?? "run";
  if (command === "bootstrap") {
    const paths = await bootstrapLocalEnv(repoRoot);
    console.log(`env bootstrap ok\n  core ${paths.core}\n  web  ${paths.web}`);
  } else if (command === "proxy") {
    ensureProxy();
    console.log("portless proxy ok");
  } else if (command === "url") {
    const app = process.argv[3];
    if (app !== "web" && app !== "core") {
      console.error("usage: portless-dev.mjs url web|core");
      process.exit(1);
    }
    console.log(getPortlessUrl(app));
  } else if (command === "run") {
    try {
      parseRunApps(process.argv[3]);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    await runStack(process.argv[3]);
  } else {
    console.error(
      "usage: portless-dev.mjs [run [web|core]|bootstrap|proxy|url web|url core]",
    );
    process.exit(1);
  }
}
