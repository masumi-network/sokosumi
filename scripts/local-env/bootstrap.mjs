#!/usr/bin/env node
/**
 * Copy apps/{web,core}/.env.example → .env when missing, then make the
 * files bootable for local / worktree agents (Zod-safe dummies, cookie-domain
 * trap, matching signing secret). Grok/git worktrees reuse the primary
 * checkout .env (BETTER_AUTH_SECRET, DATABASE_URL, …) unless the worktree
 * already has a unique secret. Does not overwrite that unique secret.
 *
 * Usage: node scripts/local-env/bootstrap.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BETTER_AUTH_SECRET =
  "TFVfK91TGv2YVyVYFk0lu87Md5a13E4l7AjEaoZD8dQ=";
const PLACEHOLDER_RE = /^<[^>]+>$/;

/** Keys that must be omitted when the value is not a real URL (optional z.url()). */
const OPTIONAL_URL_KEYS = new Set([
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "AGENT_HIRED_WEBHOOK",
  "WEBHOOK_USER_CREATED",
  "WEBHOOK_USER_UPDATED",
  "WEBHOOK_ACCOUNT_CREATED",
  "JOB_FAILURE_WEBHOOK_URL",
  "VERCEL_BLOB_CALLBACK_URL",
]);

const STRING_DUMMIES = {
  APP_SIGNING_SECRET: DEFAULT_BETTER_AUTH_SECRET,
  GOOGLE_CLIENT_ID: "dummy-google-client-id",
  GOOGLE_CLIENT_SECRET: "dummy-google-client-secret",
  MICROSOFT_CLIENT_ID: "dummy-microsoft-client-id",
  MICROSOFT_CLIENT_SECRET: "dummy-microsoft-client-secret",
  RESEND_API_KEY: "dummy-resend-api-key",
  BLOB_READ_WRITE_TOKEN: "dummy-blob-read-write-token",
  MASUMI_DESIGN_MD_API_KEY: "dummy-masumi-design-md-api-key",
  HERMES_ORCH_TOKEN: "dummy-hermes-orch-token",
  PAYMENT_API_KEY: "dummy-payment-api-key",
  REGISTRY_API_KEY: "dummy-registry-api-key",
  CRON_SECRET: "dummy-cron-secret",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_dummy",
  STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: "prod_dummy_starter",
  STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: "prod_dummy_standard",
  STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: "prod_dummy_pro",
  STRIPE_CREDIT_PRODUCT_ID: "prod_dummy_credit",
  INSTANCE_ID: "local-dev",
  ABLY_PUBLISH_ONLY_KEY: "dummy-ably-publish-only-key",
  ABLY_SUBSCRIBE_ONLY_KEY: "dummy-ably-subscribe-only-key",
};

/**
 * @param {string} value
 */
export function isPlaceholderValue(value) {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  return (
    PLACEHOLDER_RE.test(trimmed) ||
    trimmed.includes("<your-") ||
    trimmed.includes("<replace-") ||
    trimmed.includes("<stripe-") ||
    trimmed.includes("<composio-") ||
    trimmed.includes("<payment-") ||
    trimmed.includes("<registry-") ||
    trimmed.includes("<cron-") ||
    trimmed.includes("<instance-") ||
    trimmed.includes("<app-signing") ||
    trimmed.includes("<hermes-") ||
    trimmed.includes("<ably-") ||
    trimmed.includes("<blob-") ||
    trimmed.includes("<masumi-") ||
    trimmed.startsWith("<")
  );
}

/**
 * @param {string} contents
 */
export function sanitizeEnvContents(contents) {
  const lines = contents.split("\n");
  const out = [];

  for (const line of lines) {
    const assignment = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!assignment) {
      out.push(line);
      continue;
    }

    const key = assignment[1];
    let value = assignment[2];
    const unquoted = value.trim().replace(/^["']|["']$/g, "");

    if (key === "BETTER_AUTH_COOKIE_DOMAIN" && unquoted !== "") {
      out.push(
        `# ${line}  # local/portless: cookies must not be scoped to a production host`,
      );
      continue;
    }

    if (key === "COMPOSIO_API_KEY") {
      if (
        unquoted === "" ||
        isPlaceholderValue(unquoted) ||
        !unquoted.startsWith("ak_")
      ) {
        out.push(`# ${key}=  # omit locally unless you have a real ak_ key`);
        continue;
      }
      out.push(line);
      continue;
    }

    if (key === "DATABASE_URL" && unquoted.includes("@sokosumi:")) {
      out.push(`${key}=${value.replace("@sokosumi:", "@localhost:")}`);
      continue;
    }

    if (
      OPTIONAL_URL_KEYS.has(key) &&
      (isPlaceholderValue(unquoted) || !isUrl(unquoted))
    ) {
      out.push(`# ${key}=  # optional URL; omit rather than a dummy string`);
      continue;
    }

    if (isPlaceholderValue(unquoted)) {
      if (key in STRING_DUMMIES) {
        out.push(`${key}="${STRING_DUMMIES[key]}"`);
        continue;
      }
      if (key.endsWith("_URL") || key.endsWith("_DSN")) {
        out.push(`# ${key}=  # placeholder omitted`);
        continue;
      }
      out.push(`# ${key}=  # placeholder omitted`);
      continue;
    }

    out.push(line);
  }

  return `${out.join("\n").replace(/\n+$/, "\n")}`;
}

/**
 * @param {string} value
 */
function isUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} contents
 * @param {string} key
 */
export function readEnvValue(contents, key) {
  const matches = [...contents.matchAll(new RegExp(`^${key}=(.*)$`, "gm"))];
  if (matches.length === 0) {
    return undefined;
  }
  const raw = matches[matches.length - 1][1].trim();
  return raw.replace(/^["']|["']$/g, "");
}

/**
 * @param {string} webContents
 * @param {string} coreContents
 */
export function syncSigningSecret(webContents, coreContents) {
  const secret =
    readEnvValue(coreContents, "BETTER_AUTH_SECRET") ||
    DEFAULT_BETTER_AUTH_SECRET;
  if (readEnvValue(webContents, "APP_SIGNING_SECRET") === secret) {
    return webContents;
  }
  if (/^APP_SIGNING_SECRET=/m.test(webContents)) {
    return webContents.replace(
      /^APP_SIGNING_SECRET=.*$/m,
      `APP_SIGNING_SECRET="${secret}"`,
    );
  }
  return `${webContents.trimEnd()}\nAPP_SIGNING_SECRET="${secret}"\n`;
}

/**
 * @param {string | null} contents
 */
async function tryRead(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Worktree .env is missing, still a placeholder, or still the committed
 * example secret — safe to replace from the primary checkout.
 *
 * @param {string | null} existingCoreContents
 */
export function shouldReusePrimaryEnv(existingCoreContents) {
  if (existingCoreContents == null) {
    return true;
  }
  const secret = readEnvValue(existingCoreContents, "BETTER_AUTH_SECRET");
  return (
    !secret ||
    isPlaceholderValue(secret) ||
    secret === DEFAULT_BETTER_AUTH_SECRET
  );
}

/**
 * First `git worktree list --porcelain` path, when this checkout is not it.
 *
 * @param {string} porcelain
 * @param {string} repoRoot
 */
export function parsePrimaryWorktreePath(porcelain, repoRoot) {
  const paths = [...porcelain.matchAll(/^worktree (.+)$/gm)].map(
    (match) => match[1],
  );
  if (paths.length <= 1) {
    return null;
  }
  const primary = paths[0];
  if (path.resolve(primary) === path.resolve(repoRoot)) {
    return null;
  }
  return primary;
}

/**
 * @param {string} repoRoot
 * @returns {Promise<string | null>}
 */
export async function resolvePrimaryEnvRoot(repoRoot) {
  const grokSource = await tryRead(
    path.join(repoRoot, ".git", "grok-worktree-source"),
  );
  if (grokSource) {
    const src = grokSource.trim();
    if (src && path.resolve(src) !== path.resolve(repoRoot)) {
      const envFile = await tryRead(path.join(src, "apps", "core", ".env"));
      if (envFile !== null) {
        return src;
      }
    }
  }

  try {
    const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const primary = parsePrimaryWorktreePath(porcelain, repoRoot);
    if (primary) {
      const envFile = await tryRead(path.join(primary, "apps", "core", ".env"));
      if (envFile !== null) {
        return primary;
      }
    }
  } catch {
    // not a git checkout, or git is unavailable
  }

  return null;
}

/**
 * @param {string} repoRoot
 */
export async function bootstrapLocalEnv(repoRoot) {
  const primaryRoot = await resolvePrimaryEnvRoot(repoRoot);
  const existingCore = await tryRead(
    path.join(repoRoot, "apps", "core", ".env"),
  );
  const reuse = primaryRoot !== null && shouldReusePrimaryEnv(existingCore);

  const apps = ["core", "web"];
  /** @type {Record<string, string>} */
  const written = {};

  for (const app of apps) {
    const dir = path.join(repoRoot, "apps", app);
    const example = path.join(dir, ".env.example");
    const envPath = path.join(dir, ".env");

    let source = await tryRead(envPath);
    if (reuse && primaryRoot) {
      const fromPrimary = await tryRead(
        path.join(primaryRoot, "apps", app, ".env"),
      );
      if (fromPrimary !== null) {
        source = fromPrimary;
      }
    }
    if (source === null) {
      await copyFile(example, envPath);
      source = await readFile(envPath, "utf8");
    }

    written[app] = sanitizeEnvContents(source);
  }

  written.web = syncSigningSecret(written.web, written.core);

  await writeFile(
    path.join(repoRoot, "apps", "core", ".env"),
    written.core,
    "utf8",
  );
  await writeFile(
    path.join(repoRoot, "apps", "web", ".env"),
    written.web,
    "utf8",
  );

  return {
    core: path.join(repoRoot, "apps", "core", ".env"),
    web: path.join(repoRoot, "apps", "web", ".env"),
    reusedFrom: reuse ? primaryRoot : null,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const paths = await bootstrapLocalEnv(repoRoot);
  console.log(`env bootstrap ok\n  core ${paths.core}\n  web  ${paths.web}`);
  if (paths.reusedFrom) {
    console.log(`env bootstrap: reused ${paths.reusedFrom}`);
  }
}
