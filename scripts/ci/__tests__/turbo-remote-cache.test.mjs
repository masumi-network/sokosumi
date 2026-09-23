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
  "TURNSTILE_SECRET_KEY",
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
    // test.yml anchors the permissions on the first leg and aliases the rest.
    assert.match(
      jobBlock(test, "web"),
      /permissions: &turbo-permissions\n\s+contents: read\n\s+id-token:\s*write/,
    );
    for (const jobId of ["core", "packages", "cli"]) {
      assert.match(jobBlock(test, jobId), /permissions: \*turbo-permissions/);
    }
  });

  it("Web/Core/Packages jobs invoke turbo run test:ci", async () => {
    const test = await readRepoFile(".github", "workflows", "test.yml");
    assert.match(jobBlock(test, "web"), /turbo run test:ci --filter=web\n/);
    assert.match(
      jobBlock(test, "core"),
      /turbo run test:ci --filter=@sokosumi\/core\n/,
    );
    assert.match(
      jobBlock(test, "packages"),
      /turbo run test:ci --filter="\.\/packages\/\*"\n/,
    );
  });

  it("advisory jobs cover local env, CI config, and cloud-agent-db", async () => {
    const test = await readRepoFile(".github", "workflows", "test.yml");
    assert.match(jobBlock(test, "local-env"), /run: pnpm local-env:test\n/);
    assert.match(jobBlock(test, "ci-config"), /run: pnpm ci:test\n/);
    assert.match(
      jobBlock(test, "cloud-agent-db"),
      /run: pnpm cloud-agent-db:test(\n|$)/,
    );
  });

  it("CI config also runs on markdown-only PRs", async () => {
    const test = await readRepoFile(".github", "workflows", "test.yml");
    const filter = await readRepoFile(".github", "js-paths-filter.yml");
    assert.match(filter, /^ci-config:\n  - "\{\*\.md,\*\*\/\*\.md,/m);
    assert.match(
      jobBlock(test, "changes"),
      /ci-config: .*steps\.filter\.outputs\.ci-config/,
    );
  });

  it("pins Neon teardown to trusted default-branch checkout", async () => {
    const workflow = await readRepoFile(
      ".github",
      "workflows",
      "cloud-agent-db-teardown.yml",
    );
    const triggerSection = workflow.split(/^jobs:/m)[0];
    assert.match(triggerSection, /pull_request_target:/);
    assert.doesNotMatch(triggerSection, /^\s+pull_request:\s*$/m);
    assert.match(
      workflow,
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
    );
    assert.match(workflow, /persist-credentials:\s*false/);
    assert.match(workflow, /github\.event\.repository\.default_branch/);
    assert.doesNotMatch(workflow, /pull_request\.base\.sha/);
    assert.doesNotMatch(workflow, /pull_request\.head\.sha/);
    assert.doesNotMatch(workflow, /pull_request\.head\.ref/);
    assert.match(workflow, /secrets\.NEON_API_KEY/);
  });

  it("path-gated jobs skip at job level and fail open", async () => {
    const build = await readRepoFile(".github", "workflows", "build.yml");
    const lint = await readRepoFile(".github", "workflows", "lint.yml");
    const test = await readRepoFile(".github", "workflows", "test.yml");

    // A job skipped by `if:` gets no runner and still reports its check
    // name, which the ruleset accepts. `!= 'false'` runs the job when
    // `changes` fails and leaves its outputs empty.
    for (const [file, yaml, jobId, output] of [
      ["build.yml", build, "build", "js"],
      ["lint.yml", lint, "biome", "js"],
      ["lint.yml", lint, "typecheck", "js"],
      ["test.yml", test, "web", "web"],
      ["test.yml", test, "core", "core"],
      ["test.yml", test, "packages", "packages"],
      ["test.yml", test, "cli", "cli"],
      ["test.yml", test, "local-env", "local-env"],
      ["test.yml", test, "ci-config", "ci-config"],
      ["test.yml", test, "cloud-agent-db", "cloud-agent-db"],
    ]) {
      const header = jobBlock(yaml, jobId).split(/\n    steps:\n/)[0];
      assert.match(
        header,
        new RegExp(
          `\\n    if: \\$\\{\\{ !cancelled\\(\\) && needs\\.changes\\.outputs\\.${output} != 'false' \\}\\}\\n`,
        ),
        `${file} job ${jobId} must gate at job level on outputs.${output}`,
      );
      assert.match(
        jobBlock(yaml, "changes"),
        new RegExp(
          `\\n      ${output}: \\$\\{\\{ github\\.event_name == 'workflow_dispatch' \\|\\| steps\\.filter\\.outputs\\.${output} \\}\\}\\n`,
        ),
        `${file} changes must run ${output} on workflow_dispatch`,
      );
    }
  });

  it("required test jobs keep their ruleset check names", async () => {
    const test = await readRepoFile(".github", "workflows", "test.yml");
    for (const [jobId, name] of [
      ["web", "Test Web"],
      ["core", "Test Core"],
      ["packages", "Test Packages"],
    ]) {
      assert.match(
        jobBlock(test, jobId),
        new RegExp(`\\n    name: ${name}\\n`),
      );
    }
    assert.doesNotMatch(
      test,
      /\n    strategy:\n/,
      "a matrix cannot skip under its name",
    );
  });

  it("per-leg filters only drop what the leg cannot reach", async () => {
    const filter = await readRepoFile(".github", "js-paths-filter.yml");
    assert.match(filter, /^web:\n  - \*js\n  - "!apps\/core\/\*\*"\n\n/m);
    assert.match(filter, /^core:\n  - \*js\n  - "!apps\/web\/\*\*"\n\n/m);
    assert.match(
      filter,
      /^packages:\n  - \*js\n  - "!apps\/web\/\*\*"\n  - "!apps\/core\/\*\*"\n\n/m,
    );
  });

  it("Test CLI runs only when apps/cli changes", async () => {
    const test = await readRepoFile(".github", "workflows", "test.yml");
    const filter = await readRepoFile(".github", "js-paths-filter.yml");

    // A single positive pattern, so `predicate-quantifier: every` at the
    // call site behaves the same as the default `some`.
    assert.match(filter, /^cli:\n  - "apps\/cli\/\*\*"$/m);
    assert.match(jobBlock(test, "changes"), /steps\.filter\.outputs\.cli/);
    assert.match(jobBlock(test, "cli"), /Smoke the built CLI\n/);
  });

  it("CLI-only PRs skip the rest of CI", async () => {
    const filter = await readRepoFile(".github", "js-paths-filter.yml");

    // Build / Biome / Typecheck and the Web/Core/Packages legs all build on
    // `js`, so excluding apps/cli here is what makes a CLI-only PR skip them.
    assert.match(filter, /^js: &js\n(?:  - .*\n)*  - "!apps\/cli\/\*\*"$/m);
  });

  it("Test CLI carries the checks the js-gated jobs no longer run for it", async () => {
    const test = await readRepoFile(".github", "workflows", "test.yml");
    const block = jobBlock(test, "cli");

    // apps/cli is excluded from `js`, so root `pnpm typecheck` and
    // `pnpm check` never see it on a CLI-only PR. tsx strips types rather
    // than checking them, so without these the CLI loses type and lint
    // coverage entirely. Root `pnpm build` is covered by the smoke step.
    for (const [name, command] of [
      ["Typecheck the CLI", /pnpm --filter @sokosumi\/cli typecheck/],
      ["Lint the CLI", /biome check apps\/cli/],
    ]) {
      const step = block.match(
        new RegExp(`- name: ${name}\\n([\\s\\S]*?)(?=\\n      - name:|$)`),
      );
      assert.ok(step, `missing step ${name}`);
      assert.match(step[1], command, `step ${name} runs the wrong command`);
    }
  });

  it("shares one JS path-filter file across test/build/lint", async () => {
    const filter = await readRepoFile(".github", "js-paths-filter.yml");
    assert.match(filter, /^js: &js\s*$/m);
    assert.match(filter, /!\*\*\/\*\.md/);

    for (const file of ["test.yml", "build.yml", "lint.yml"]) {
      const yaml = await readRepoFile(".github", "workflows", file);
      assert.match(
        yaml,
        /filters:\s*\.github\/js-paths-filter\.yml/,
        `${file} must use the shared JS path filter`,
      );
      assert.doesNotMatch(
        yaml,
        /filters:\s*\|/,
        `${file} must not inline a duplicate paths-filter`,
      );
    }
  });

  it("setup action reads Node from .nvmrc", async () => {
    const setup = await readRepoFile(
      ".github",
      "actions",
      "setup",
      "action.yml",
    );
    assert.match(setup, /node-version-file:\s*\.nvmrc/);
    assert.doesNotMatch(setup, /node-version:\s*["']?\d+/);
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
    assert.doesNotMatch(
      database.scripts.prepare ?? "",
      /prisma(?:\s+generate|:generate)/,
    );
    assert.match(database.scripts["prisma:generate"], /prisma generate/);
  });

  it("generates the Prisma client in Core vercel-build before tsup", async () => {
    const core = JSON.parse(await readRepoFile("apps", "core", "package.json"));
    const script = core.scripts["vercel-build"];
    const generateAt = script.indexOf(
      "pnpm --filter @sokosumi/database prisma:generate",
    );
    const tsupAt = script.lastIndexOf("pnpm run build");
    const migrateAt = script.indexOf("prisma:migrate:deploy");
    assert.ok(generateAt >= 0, "Core vercel-build must run prisma:generate");
    assert.ok(tsupAt > generateAt, "Core tsup must follow prisma:generate");
    assert.ok(migrateAt > tsupAt, "migrate deploy must follow Core tsup");
    assert.doesNotMatch(
      script,
      /@sokosumi\/database run build/,
      "the database tsc step is gone (ADR 0035)",
    );
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
