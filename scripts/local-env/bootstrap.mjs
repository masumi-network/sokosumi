#!/usr/bin/env node
/**
 * Copy apps/{web,core}/.env.example → .env when missing, then make the
 * files bootable for local / worktree agents (Zod-safe dummies, cookie-domain
 * trap, matching signing secret). Does not overwrite existing non-placeholder
 * secrets.
 *
 * Usage: node scripts/local-env/bootstrap.mjs
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BETTER_AUTH_SECRET =
  "TFVfK91TGv2YVyVYFk0lu87Md5a13E4l7AjEaoZD8dQ=";
const DUMMY_URL = "https://local.dev.invalid";
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

/** Required URL keys that get a dummy URL when the example is a placeholder. */
const REQUIRED_URL_DUMMIES = {
  HERMES_ORCH_BASE_URL: DUMMY_URL,
};

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
      if (key in REQUIRED_URL_DUMMIES) {
        out.push(`${key}="${REQUIRED_URL_DUMMIES[key]}"`);
        continue;
      }
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
 * @param {string} repoRoot
 */
export async function bootstrapLocalEnv(repoRoot) {
  const apps = ["core", "web"];
  /** @type {Record<string, string>} */
  const written = {};

  for (const app of apps) {
    const dir = path.join(repoRoot, "apps", app);
    const example = path.join(dir, ".env.example");
    const envPath = path.join(dir, ".env");

    let existing = null;
    try {
      existing = await readFile(envPath, "utf8");
    } catch {
      await copyFile(example, envPath);
      existing = await readFile(envPath, "utf8");
    }

    written[app] = sanitizeEnvContents(existing);
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
}
