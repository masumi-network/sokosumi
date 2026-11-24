import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, [TSX, script], {
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
  const script = fileURLToPath(
    new URL("../../scripts/check-network-layout.mts", import.meta.url),
  );

  it("fails the deploy on a half-changed layout, naming the rule", async () => {
    const { code, output } = await start(
      { DATABASE_SCHEMA_PREPROD: "preprod" },
      script,
    );

    expect(code).toBe(1);
    expect(output).toContain("all public or all different");
  }, 30_000);

  it("fails the deploy with Preprod on while every name is public", async () => {
    const { code, output } = await start(
      { NETWORK_PREPROD_ENABLED: "true" },
      script,
    );

    expect(code).toBe(1);
    expect(output).toContain("NETWORK_PREPROD_ENABLED");
  }, 30_000);

  it("runs in the Vercel build, before any migration", () => {
    const { scripts } = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    const build = scripts["vercel-build"] ?? "";

    const check = build.indexOf("tsx scripts/check-network-layout.mts");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(build.indexOf("prisma:migrate:deploy"));
  });

  it("passes today's layout without any other variable", async () => {
    const { code } = await start({}, script);

    expect(code).toBe(0);
  }, 30_000);
});
