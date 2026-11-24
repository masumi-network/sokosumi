import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./__fixtures__/${name}.ts`, import.meta.url));
const TSX = fileURLToPath(
  new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
);

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** A Sentry stand-in that records every envelope it receives. */
async function sentryServer() {
  const envelopes: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      envelopes.push(body);
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  return { dsn: `http://public@127.0.0.1:${port}/1`, envelopes };
}

/** Core's startup check in its own process, with only `env`. */
function start(env: Record<string, string>, script = fixture("validate-env")) {
  return run(process.execPath, [TSX, script], env);
}

/** `command` in Core's folder, with only `env`. */
function run(command: string, args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(command, args, {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("a start that fails the environment check", () => {
  it("reaches Sentry before it exits with code 1", async () => {
    const sentry = await sentryServer();

    const { code, output } = await start({
      SENTRY_DSN: sentry.dsn,
      OAUTH_PROXY_SECRET: "short-private-value",
    });

    expect(code).toBe(1);
    expect(output).toContain(
      "Core cannot start, because environment variables are invalid",
    );
    const delivered = sentry.envelopes.join("\n");
    expect(delivered).toContain(
      "Core cannot start, because environment variables are invalid",
    );
    expect(delivered).toContain("OAUTH_PROXY_SECRET");
    expect(delivered).not.toContain("short-private-value");
    expect(output).not.toContain("short-private-value");
  }, 30_000);

  it("still exits with code 1 when Sentry does not answer", async () => {
    const { code } = await start({
      // Nothing listens on port 9: delivery fails, the exit does not wait.
      SENTRY_DSN: "http://public@127.0.0.1:9/1",
    });

    expect(code).toBe(1);
  }, 30_000);
});

describe("importing the environment module", () => {
  it("starts Core's logger, so an early event is redacted", async () => {
    const secret = "probe-secret-value-7f3k9q";

    const { code, output } = await start(
      { PROBE_SECRET: secret },
      fixture("log-after-env"),
    );

    expect(code).toBe(0);
    expect(output).toContain("Startup probe");
    expect(output).toContain("[redacted:env-secret]");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("without initLogger()");
  }, 30_000);
});

describe("the deploy step that checks the schema layout", () => {
  const core = fileURLToPath(new URL("../..", import.meta.url));
  const script = path.join(core, "scripts/check-network-layout.mts");

  it("fails the deploy on a half-changed layout, naming the rule", async () => {
    const { code, output } = await start(
      { DATABASE_SCHEMA_PREPROD: "preprod" },
      script,
    );

    expect(code).toBe(1);
    expect(output).toContain(
      "DATABASE_SCHEMA_SHARED, DATABASE_SCHEMA_MAINNET and DATABASE_SCHEMA_PREPROD must be all public, or all different and none public",
    );
  }, 30_000);

  it.each([
    ["every name public", {}],
    [
      "Preprod's name left unset",
      { DATABASE_SCHEMA_SHARED: "shared", DATABASE_SCHEMA_MAINNET: "mainnet" },
    ],
  ])(
    "fails the deploy with Preprod on and %s",
    async (_, layout) => {
      const { code, output } = await start(
        { ...layout, NETWORK_PREPROD_ENABLED: "true" },
        script,
      );

      expect(code).toBe(1);
      expect(output).toContain(
        "Preprod can be on only while the three DATABASE_SCHEMA_* names are all different and none is public",
      );
    },
    30_000,
  );

  it("passes today's layout without any other variable", async () => {
    const { code } = await start({}, script);

    expect(code).toBe(0);
  }, 30_000);

  it("loads no Core module beyond the layout rule, no package but zod and no builtin but node:process", async () => {
    const recorder = fileURLToPath(
      new URL("./__fixtures__/record-loads.mjs", import.meta.url),
    );
    const { code, output } = await run(
      process.execPath,
      ["--import", "tsx", "--import", recorder, script],
      { NETWORK_PREPROD_ENABLED: "true" },
    );
    const urls = [...output.matchAll(/^LOADED (\S+)$/gm)].map(
      ([, url = ""]) => url,
    );
    const builtins = urls.filter((url) => url.startsWith("node:"));
    const loaded = urls
      .filter((url) => url.startsWith("file:"))
      .map((url) => fileURLToPath(url));
    const source = path.join(core, "src") + path.sep;
    const packages = new Set(
      loaded
        .filter((file) => file.includes(`${path.sep}node_modules${path.sep}`))
        .map((file) => file.split(`${path.sep}node_modules${path.sep}`).at(-1))
        .map((rest) => rest?.split(path.sep)[0]),
    );

    expect(code).toBe(1);
    expect(
      loaded
        .filter((file) => file.startsWith(source))
        .map((file) => file.slice(source.length))
        .sort(),
    ).toEqual(["config/invalid-variables.ts", "config/network-layout.ts"]);
    expect([...packages]).toEqual(["zod"]);
    expect([...new Set(builtins)]).toEqual(["node:process"]);
  }, 30_000);

  /**
   * The real `vercel-build` line, with stubs for every step but the layout
   * check: `pnpm` and the bundle check only record that they ran.
   */
  async function vercelBuild(env: Record<string, string>) {
    const { scripts } = JSON.parse(
      readFileSync(path.join(core, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const stubs = mkdtempSync(path.join(tmpdir(), "core-vercel-build-"));
    closers.push(() => rmSync(stubs, { recursive: true, force: true }));
    const log = path.join(stubs, "steps.log");
    writeFileSync(log, "");
    const stub = (name: string, body: string) =>
      writeFileSync(path.join(stubs, name), `#!/bin/sh\n${body}\n`, {
        mode: 0o755,
      });
    stub("pnpm", `echo "pnpm $*" >> "${log}"`);
    stub(
      "node",
      [
        `if [ "$1" = scripts/check-bundle-includes.mjs ]; then echo "node $*" >> "${log}"; exit 0; fi`,
        `exec "${process.execPath}" "$@"`,
      ].join("\n"),
    );
    const { code } = await run(
      "/bin/sh",
      ["-c", scripts["vercel-build"] ?? ""],
      {
        ...env,
        PATH: [
          stubs,
          path.join(core, "node_modules/.bin"),
          "/usr/bin",
          "/bin",
        ].join(path.delimiter),
      },
    );
    return { code, steps: readFileSync(log, "utf8") };
  }

  it("stops the Vercel build before any migration when the check fails", async () => {
    const { code, steps } = await vercelBuild({
      NETWORK_PREPROD_ENABLED: "true",
    });

    expect(code).not.toBe(0);
    expect(steps).toContain("node scripts/check-bundle-includes.mjs");
    expect(steps).not.toContain("prisma:migrate:deploy");
  }, 30_000);

  it("reaches the migration on today's layout", async () => {
    const { code, steps } = await vercelBuild({});

    expect(code).toBe(0);
    expect(steps.trim().split("\n").at(-1)).toBe(
      "pnpm --filter @sokosumi/database prisma:migrate:deploy",
    );
  }, 30_000);
});
