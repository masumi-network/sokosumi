import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const HASHED_ENV = [
  "CI",
  "NODE_ENV",
  "NETWORK",
  "DATABASE_URL",
  "CORE_APP_BASE_URL",
  "MASUMI_DESIGN_MD_API_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_GIT_COMMIT_REF",
  "SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
];

const PASSTHROUGH_ENV = [
  "BETTER_AUTH_SECRET",
  "APP_SIGNING_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "PAYMENT_API_KEY",
  "REGISTRY_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SIGNUP_BONUS_CREDITS",
  "SIGNUP_BONUS_TTL_DAYS",
  "STRIPE_CREDIT_PRODUCT_ID",
  "STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID",
  "STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID",
  "STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID",
  "ABLY_SUBSCRIBE_ONLY_KEY",
  "ABLY_PUBLISH_ONLY_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
  "MASUMI_DESIGN_MD_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "TURBO_TOKEN",
  "TURBO_TEAM",
  "ENABLE_EXPERIMENTAL_COREPACK",
];

async function readRepoFile(...segments) {
  return readFile(path.join(repoRoot, ...segments), "utf8");
}

function jobBlock(yaml, jobId) {
  const match = yaml.match(
    new RegExp(`(?:^|\\n)  ${jobId}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z]|$)`),
  );
  assert.ok(match, `missing job ${jobId}`);
  return match[0];
}

function matrixCommand(yaml, name) {
  const match = yaml.match(
    new RegExp(
      `\\{\\s*name:\\s*${name},\\s*command:\\s*(['"\`])([\\s\\S]*?)\\1`,
    ),
  );
  assert.ok(match, `missing matrix target ${name}`);
  return match[2];
}

describe("turbo.json env contract", () => {
  it("uses default strict envMode and lists hashed plus passthrough env", async () => {
    const turbo = JSON.parse(await readRepoFile("turbo.json"));

    assert.equal("envMode" in turbo, false);
    assert.deepEqual(turbo.globalEnv, HASHED_ENV);
    assert.deepEqual(turbo.globalPassThroughEnv, PASSTHROUGH_ENV);
    assert.equal(
      [...turbo.globalEnv, ...turbo.globalPassThroughEnv].some((name) =>
        name.startsWith("NEXT_PUBLIC_"),
      ),
      false,
    );
  });
});

describe("GitHub OIDC remote cache wiring", () => {
  it("setup action exchanges OIDC when turbo_team is set", async () => {
    const setup = await readRepoFile(
      ".github",
      "actions",
      "setup",
      "action.yml",
    );
    assert.match(setup, /turbo_team:/);
    assert.match(setup, /vercel\/setup-turborepo-remote-cache-action@v1\.0\.0/);
    assert.match(setup, /continue-on-error:\s*true/);
  });

  it("jobs that run setup and turbo grant id-token write", async () => {
    const build = await readRepoFile(".github", "workflows", "build.yml");
    const lint = await readRepoFile(".github", "workflows", "lint.yml");
    const test = await readRepoFile(".github", "workflows", "test.yml");

    assert.match(jobBlock(build, "build"), /id-token:\s*write/);
    assert.match(jobBlock(lint, "typecheck"), /id-token:\s*write/);
    assert.match(jobBlock(test, "test"), /id-token:\s*write/);
  });

  it("test matrix Web/Core/Packages invoke turbo run test:ci", async () => {
    const test = await readRepoFile(".github", "workflows", "test.yml");
    assert.match(matrixCommand(test, "Web"), /turbo run test:ci --filter=web/);
    assert.match(
      matrixCommand(test, "Core"),
      /turbo run test:ci --filter=@sokosumi\/core/,
    );
    assert.match(
      matrixCommand(test, "Packages"),
      /turbo run test:ci --filter=/,
    );
    assert.match(matrixCommand(test, "Packages"), /packages\/\*/);
  });

  it("does not use actions/cache on .turbo", async () => {
    const workflowsDir = path.join(repoRoot, ".github", "workflows");
    const files = await readdir(workflowsDir);
    for (const file of files) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) {
        continue;
      }
      const text = await readFile(path.join(workflowsDir, file), "utf8");
      assert.doesNotMatch(
        text,
        /uses:\s*actions\/cache(?:@\S+)?[\s\S]*?path:\s*['"]?\.turbo/,
        `${file} caches path .turbo`,
      );
    }
  });
});

describe("Vercel web turbo build command", () => {
  it("points web buildCommand at the vercel-build wrapper", async () => {
    const web = JSON.parse(await readRepoFile("apps", "web", "vercel.json"));
    assert.equal(web.buildCommand, "node ./scripts/vercel-build.mjs");
  });

  it("filters web and core Vercel installs to their workspace graphs", async () => {
    const web = JSON.parse(await readRepoFile("apps", "web", "vercel.json"));
    const core = JSON.parse(await readRepoFile("apps", "core", "vercel.json"));
    assert.equal(
      web.installCommand,
      "pnpm install --frozen-lockfile --filter web...",
    );
    assert.equal(
      core.installCommand,
      "pnpm install --frozen-lockfile --filter @sokosumi/core...",
    );
  });

  it("does not auto-install on pnpm run after a filtered Vercel install", async () => {
    const workspace = await readRepoFile("pnpm-workspace.yaml");
    assert.match(workspace, /^verifyDepsBeforeRun:\s*warn\s*$/m);
  });

  it("leaves Core vercel-build as tsup plus migrate", async () => {
    const core = JSON.parse(await readRepoFile("apps", "core", "vercel.json"));
    assert.equal(core.buildCommand, "pnpm vercel-build");
  });

  it("does not generate the Prisma client from database prepare", async () => {
    const database = JSON.parse(
      await readRepoFile("packages", "database", "package.json"),
    );
    assert.doesNotMatch(database.scripts.prepare ?? "", /prisma generate/);
    assert.match(database.scripts["prisma:generate"], /prisma generate/);
  });

  it("generates the Prisma client in Core vercel-build before tsup", async () => {
    const core = JSON.parse(await readRepoFile("apps", "core", "package.json"));
    const script = core.scripts["vercel-build"];
    const generateAt = script.indexOf(
      "pnpm --filter @sokosumi/database prisma:generate",
    );
    const databaseBuildAt = script.indexOf(
      "pnpm --filter @sokosumi/database run build",
    );
    const tsupAt = script.lastIndexOf("pnpm run build");
    const migrateAt = script.indexOf("prisma:migrate:deploy");
    assert.ok(generateAt >= 0, "Core vercel-build must run prisma:generate");
    assert.ok(
      databaseBuildAt > generateAt,
      "database tsc must follow prisma:generate",
    );
    assert.ok(tsupAt > databaseBuildAt, "Core tsup must follow database build");
    assert.ok(migrateAt > tsupAt, "migrate deploy must follow Core tsup");
  });

  it("runs turbo --filter=web and forces production only", async () => {
    const { turboBuildArgs } = await import(
      "../../../apps/web/scripts/vercel-build.mjs"
    );

    assert.deepEqual(turboBuildArgs({ VERCEL_ENV: "preview" }), [
      "run",
      "build",
      "--filter=web",
    ]);
    assert.deepEqual(turboBuildArgs({}), ["run", "build", "--filter=web"]);
    assert.deepEqual(turboBuildArgs({ VERCEL_ENV: "development" }), [
      "run",
      "build",
      "--filter=web",
    ]);
    assert.deepEqual(turboBuildArgs({ VERCEL_ENV: "production" }), [
      "run",
      "build",
      "--filter=web",
      "--force",
    ]);
  });
});
