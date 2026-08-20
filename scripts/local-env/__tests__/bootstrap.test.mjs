import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  bootstrapLocalEnv,
  isPlaceholderValue,
  sanitizeEnvContents,
  syncSigningSecret,
} from "../bootstrap.mjs";

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
        'HERMES_ORCH_BASE_URL="<hermes-orchestrator-base-url>"',
        'RESEND_API_KEY="<your-resend-api-key>"',
        'ABLY_PUBLISH_ONLY_KEY="<your-ably-publish-only-key>"',
        "",
      ].join("\n"),
    );
    assert.match(
      out,
      /^HERMES_ORCH_BASE_URL="https:\/\/local\.dev\.invalid"$/m,
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
        'HERMES_ORCH_BASE_URL="<hermes-orchestrator-base-url>"',
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
    assert.match(
      core,
      /^HERMES_ORCH_BASE_URL="https:\/\/local\.dev\.invalid"$/m,
    );
    assert.match(web, /^APP_SIGNING_SECRET="core-secret"$/m);
    assert.match(web, /^# NEXT_PUBLIC_SENTRY_DSN=/m);
    assert.match(web, /^CORE_APP_BASE_URL="http:\/\/localhost:8787"$/m);
  });
});
