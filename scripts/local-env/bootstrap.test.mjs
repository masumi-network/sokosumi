import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  bootstrapLocalEnv,
  DEFAULT_BETTER_AUTH_SECRET,
  isPlaceholderValue,
  parsePrimaryWorktreePath,
  resolvePrimaryEnvRoot,
  sanitizeEnvContents,
  shouldReusePrimaryEnv,
  syncSigningSecret,
} from "./bootstrap.mjs";

describe("isPlaceholderValue", () => {
  it("detects angle-bracket examples", () => {
    assert.equal(isPlaceholderValue("<your-resend-api-key>"), true);
    assert.equal(
      isPlaceholderValue('"<replace-with-your-google-client-id>"'),
      true,
    );
    assert.equal(isPlaceholderValue("ak_live_real"), false);
    assert.equal(
      isPlaceholderValue("https://payment.masumi.network/api/v1"),
      false,
    );
  });
});

describe("sanitizeEnvContents", () => {
  it("comments BETTER_AUTH_COOKIE_DOMAIN when set", () => {
    const out = sanitizeEnvContents(
      'BETTER_AUTH_COOKIE_DOMAIN="sokosumi.com"\nPORT="8787"\n',
    );
    assert.match(out, /^# BETTER_AUTH_COOKIE_DOMAIN=/m);
    assert.doesNotMatch(out, /^BETTER_AUTH_COOKIE_DOMAIN=/m);
    assert.match(out, /^PORT="8787"$/m);
  });

  it("omits COMPOSIO_API_KEY unless it starts with ak_", () => {
    const placeholder = sanitizeEnvContents(
      'COMPOSIO_API_KEY="<composio-api-key>"\n',
    );
    assert.match(placeholder, /^# COMPOSIO_API_KEY=/m);

    const dummy = sanitizeEnvContents(
      "COMPOSIO_API_KEY=dummy-composio-api-key\n",
    );
    assert.match(dummy, /^# COMPOSIO_API_KEY=/m);

    const ok = sanitizeEnvContents("COMPOSIO_API_KEY=ak_test_123\n");
    assert.match(ok, /^COMPOSIO_API_KEY=ak_test_123$/m);
  });

  it("rewrites docker DATABASE_URL host to localhost", () => {
    const out = sanitizeEnvContents(
      'DATABASE_URL="postgresql://sokosumi:sokosumi@sokosumi:5432/core?schema=public"\n',
    );
    assert.match(out, /@localhost:5432/);
    assert.doesNotMatch(out, /@sokosumi:5432/);
  });

  it("comments optional URL placeholders instead of dummy strings", () => {
    const out = sanitizeEnvContents(
      "NEXT_PUBLIC_SENTRY_DSN=<your-sentry-dsn>\n",
    );
    assert.match(out, /^# NEXT_PUBLIC_SENTRY_DSN=/m);
    assert.doesNotMatch(out, /^NEXT_PUBLIC_SENTRY_DSN=/m);
  });

  it("keeps empty optional values empty", () => {
    const out = sanitizeEnvContents(
      'JOB_FAILURE_NOTIFICATION_EMAILS=""\nBLOB_WEBHOOK_PUBLIC_KEY=""\n',
    );
    assert.match(out, /^JOB_FAILURE_NOTIFICATION_EMAILS=""$/m);
    assert.match(out, /^BLOB_WEBHOOK_PUBLIC_KEY=""$/m);
  });

  it("fills required placeholders with dummies that pass Zod", () => {
    const out = sanitizeEnvContents(
      [
        'RESEND_API_KEY="<your-resend-api-key>"',
        'ABLY_PUBLISH_ONLY_KEY="<your-ably-publish-only-key>"',
        "",
      ].join("\n"),
    );
    assert.match(out, /^RESEND_API_KEY="dummy-resend-api-key"$/m);
    assert.match(out, /^ABLY_PUBLISH_ONLY_KEY="dummy-ably-publish-only-key"$/m);
  });
});

describe("syncSigningSecret", () => {
  it("copies Core BETTER_AUTH_SECRET onto web APP_SIGNING_SECRET", () => {
    const web = syncSigningSecret(
      'APP_SIGNING_SECRET="<app-signing-secret>"\n',
      'BETTER_AUTH_SECRET="shared-secret"\n',
    );
    assert.match(web, /^APP_SIGNING_SECRET="shared-secret"$/m);
  });
});

describe("bootstrapLocalEnv", () => {
  it("creates .env from examples and sanitizes both apps", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sokosumi-env-"));
    await mkdir(path.join(root, "apps", "core"), { recursive: true });
    await mkdir(path.join(root, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(root, "apps", "core", ".env.example"),
      [
        'BETTER_AUTH_SECRET="core-secret"',
        'BETTER_AUTH_COOKIE_DOMAIN="sokosumi.com"',
        'COMPOSIO_API_KEY="<composio-api-key>"',
        'DATABASE_URL="postgresql://sokosumi:sokosumi@sokosumi:5432/core?schema=public"',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, "apps", "web", ".env.example"),
      [
        'APP_SIGNING_SECRET="<app-signing-secret>"',
        "NEXT_PUBLIC_SENTRY_DSN=<your-sentry-dsn>",
        'CORE_APP_BASE_URL="http://localhost:8787"',
        "",
      ].join("\n"),
      "utf8",
    );

    const paths = await bootstrapLocalEnv(root);
    const core = await readFile(paths.core, "utf8");
    const web = await readFile(paths.web, "utf8");

    assert.match(core, /^BETTER_AUTH_SECRET="core-secret"$/m);
    assert.match(core, /^# BETTER_AUTH_COOKIE_DOMAIN=/m);
    assert.match(core, /^# COMPOSIO_API_KEY=/m);
    assert.match(core, /@localhost:5432/);
    assert.match(web, /^APP_SIGNING_SECRET="core-secret"$/m);
    assert.match(web, /^# NEXT_PUBLIC_SENTRY_DSN=/m);
    assert.match(web, /^CORE_APP_BASE_URL="http:\/\/localhost:8787"$/m);
    assert.equal(paths.reusedFrom, null);
  });
});

describe("shouldReusePrimaryEnv", () => {
  it("reuses when worktree .env is missing, placeholder, or the example secret", () => {
    assert.equal(shouldReusePrimaryEnv(null), true);
    assert.equal(
      shouldReusePrimaryEnv('BETTER_AUTH_SECRET="<replace-me>"\n'),
      true,
    );
    assert.equal(
      shouldReusePrimaryEnv(
        `BETTER_AUTH_SECRET="${DEFAULT_BETTER_AUTH_SECRET}"\n`,
      ),
      true,
    );
  });

  it("leaves a worktree .env that already has a unique secret", () => {
    assert.equal(
      shouldReusePrimaryEnv('BETTER_AUTH_SECRET="machine-local-secret"\n'),
      false,
    );
  });
});

describe("parsePrimaryWorktreePath", () => {
  it("returns the first listed worktree when this checkout is a linked worktree", () => {
    const porcelain = [
      "worktree /Users/x/src/sokosumi",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /Users/x/src/sokosumi/.worktrees/chore-foo",
      "HEAD def",
      "branch refs/heads/chore-foo",
      "",
    ].join("\n");
    assert.equal(
      parsePrimaryWorktreePath(
        porcelain,
        "/Users/x/src/sokosumi/.worktrees/chore-foo",
      ),
      "/Users/x/src/sokosumi",
    );
  });

  it("returns null on the primary checkout or a single worktree", () => {
    assert.equal(
      parsePrimaryWorktreePath(
        "worktree /Users/x/src/sokosumi\nHEAD abc\n",
        "/Users/x/src/sokosumi",
      ),
      null,
    );
    assert.equal(
      parsePrimaryWorktreePath(
        [
          "worktree /Users/x/src/sokosumi",
          "worktree /Users/x/src/sokosumi/.worktrees/chore-foo",
        ].join("\n"),
        "/Users/x/src/sokosumi",
      ),
      null,
    );
  });
});

describe("resolvePrimaryEnvRoot", () => {
  it("reads .git/grok-worktree-source when the primary has core .env", async () => {
    const primary = await mkdtemp(path.join(tmpdir(), "sokosumi-primary-"));
    const worktree = await mkdtemp(path.join(tmpdir(), "sokosumi-wt-"));
    await mkdir(path.join(primary, "apps", "core"), { recursive: true });
    await mkdir(path.join(worktree, ".git"), { recursive: true });
    await writeFile(
      path.join(primary, "apps", "core", ".env"),
      'BETTER_AUTH_SECRET="from-primary"\n',
      "utf8",
    );
    await writeFile(
      path.join(worktree, ".git", "grok-worktree-source"),
      `${primary}\n`,
      "utf8",
    );

    assert.equal(await resolvePrimaryEnvRoot(worktree), primary);
  });
});

describe("bootstrapLocalEnv primary reuse", () => {
  async function seedExampleApps(root) {
    await mkdir(path.join(root, "apps", "core"), { recursive: true });
    await mkdir(path.join(root, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(root, "apps", "core", ".env.example"),
      `BETTER_AUTH_SECRET="${DEFAULT_BETTER_AUTH_SECRET}"\nDATABASE_URL="postgresql://sokosumi:sokosumi@sokosumi:5432/core"\n`,
      "utf8",
    );
    await writeFile(
      path.join(root, "apps", "web", ".env.example"),
      'APP_SIGNING_SECRET="<app-signing-secret>"\n',
      "utf8",
    );
  }

  it("copies primary .env when the worktree has no .env", async () => {
    const primary = await mkdtemp(path.join(tmpdir(), "sokosumi-primary-"));
    const worktree = await mkdtemp(path.join(tmpdir(), "sokosumi-wt-"));
    await seedExampleApps(worktree);
    await mkdir(path.join(primary, "apps", "core"), { recursive: true });
    await mkdir(path.join(primary, "apps", "web"), { recursive: true });
    await mkdir(path.join(worktree, ".git"), { recursive: true });
    await writeFile(
      path.join(primary, "apps", "core", ".env"),
      [
        'BETTER_AUTH_SECRET="primary-secret"',
        'DATABASE_URL="postgresql://neondb_owner@db.example/neondb"',
        'BETTER_AUTH_COOKIE_DOMAIN="sokosumi.com"',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(primary, "apps", "web", ".env"),
      'APP_SIGNING_SECRET="stale-web-secret"\n',
      "utf8",
    );
    await writeFile(
      path.join(worktree, ".git", "grok-worktree-source"),
      `${primary}\n`,
      "utf8",
    );

    const paths = await bootstrapLocalEnv(worktree);
    const core = await readFile(paths.core, "utf8");
    const web = await readFile(paths.web, "utf8");

    assert.equal(paths.reusedFrom, primary);
    assert.match(core, /^BETTER_AUTH_SECRET="primary-secret"$/m);
    assert.match(core, /neondb_owner@db.example/);
    assert.match(core, /^# BETTER_AUTH_COOKIE_DOMAIN=/m);
    assert.match(web, /^APP_SIGNING_SECRET="primary-secret"$/m);
  });

  it("replaces a worktree .env that still has the example secret", async () => {
    const primary = await mkdtemp(path.join(tmpdir(), "sokosumi-primary-"));
    const worktree = await mkdtemp(path.join(tmpdir(), "sokosumi-wt-"));
    await seedExampleApps(worktree);
    await mkdir(path.join(primary, "apps", "core"), { recursive: true });
    await mkdir(path.join(primary, "apps", "web"), { recursive: true });
    await mkdir(path.join(worktree, ".git"), { recursive: true });
    await writeFile(
      path.join(primary, "apps", "core", ".env"),
      'BETTER_AUTH_SECRET="primary-secret"\n',
      "utf8",
    );
    await writeFile(
      path.join(primary, "apps", "web", ".env"),
      'APP_SIGNING_SECRET="primary-secret"\n',
      "utf8",
    );
    await writeFile(
      path.join(worktree, "apps", "core", ".env"),
      `BETTER_AUTH_SECRET="${DEFAULT_BETTER_AUTH_SECRET}"\n`,
      "utf8",
    );
    await writeFile(
      path.join(worktree, ".git", "grok-worktree-source"),
      `${primary}\n`,
      "utf8",
    );

    const paths = await bootstrapLocalEnv(worktree);
    const core = await readFile(paths.core, "utf8");

    assert.equal(paths.reusedFrom, primary);
    assert.match(core, /^BETTER_AUTH_SECRET="primary-secret"$/m);
  });

  it("does not clobber a worktree .env that already has a unique secret", async () => {
    const primary = await mkdtemp(path.join(tmpdir(), "sokosumi-primary-"));
    const worktree = await mkdtemp(path.join(tmpdir(), "sokosumi-wt-"));
    await seedExampleApps(worktree);
    await mkdir(path.join(primary, "apps", "core"), { recursive: true });
    await mkdir(path.join(worktree, ".git"), { recursive: true });
    await writeFile(
      path.join(primary, "apps", "core", ".env"),
      'BETTER_AUTH_SECRET="primary-secret"\n',
      "utf8",
    );
    await writeFile(
      path.join(worktree, "apps", "core", ".env"),
      'BETTER_AUTH_SECRET="worktree-own-secret"\n',
      "utf8",
    );
    await writeFile(
      path.join(worktree, "apps", "web", ".env"),
      'APP_SIGNING_SECRET="worktree-own-secret"\n',
      "utf8",
    );
    await writeFile(
      path.join(worktree, ".git", "grok-worktree-source"),
      `${primary}\n`,
      "utf8",
    );

    const paths = await bootstrapLocalEnv(worktree);
    const core = await readFile(paths.core, "utf8");

    assert.equal(paths.reusedFrom, null);
    assert.match(core, /^BETTER_AUTH_SECRET="worktree-own-secret"$/m);
  });
});
