import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PREPROD_API_URL } from "../../src/auth/config.js";
import type { CredentialStore } from "../../src/auth/secure-store.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";
import type { RuntimeCredential } from "../../src/coworker/runtime-credentials.js";

const key = "coworker_runtime_test_secret";
const baseArgs = [
  "--coworker-id",
  "cw-1",
  "--organization-id",
  "org-1",
  "--api-key-stdin",
  "--json",
];
const startArgs = ["runtime", "start", "task-1", ...baseArgs];

// SPEC V78, V81, V19: read a bounded secret pipe without exposing credentials.
for (const mode of [
  "delayed",
  "oversize",
  "invalid-utf8",
  "aborted",
] as const) {
  test(`runtime stdin handles ${mode} input from a real child-process pipe`, async (t) => {
    const source = `
    import assert from 'node:assert/strict';
    import { runRuntimeCommand } from ${JSON.stringify(new URL("../../src/cli/commands/runtime.ts", import.meta.url).href)};
    const completion = runRuntimeCommand({
      positionals: ['runtime', 'key-import'],
      options: { 'coworker-id': 'cw-1', 'api-key-stdin': true, json: true },
      stdout: process.stdout,
      dependencies: {
        fetchImpl: async (_url, init) => {
          assert.equal(new Headers(init.headers).get('authorization'), 'Bearer coworker_delayed_fixture');
          return Response.json({data: {id: 'cw-1', archivedAt: null, capabilities: ['tasks']}});
        },
        credentialStore: {
          isSupported: true,
          read: () => null,
          write: (value) => assert.deepEqual(value, {apiKey: 'coworker_delayed_fixture'}),
          clear: () => {},
        },
      },
    });
    process.stdout.write('ready\\n');
    try { await completion; } catch (error) {
      process.stderr.write(error.message);
      process.exitCode = 1;
    }
  `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", source],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    let firstWrite: ReturnType<typeof setTimeout> | undefined;
    let lastWrite: ReturnType<typeof setTimeout> | undefined;
    let ready = false;
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (ready || !output.includes("ready\n")) return;
      ready = true;
      firstWrite = setTimeout(() => {
        if (mode === "aborted") child.kill("SIGTERM");
        else if (mode === "oversize")
          child.stdin.end("coworker_" + "x".repeat(16_384));
        else if (mode === "invalid-utf8")
          child.stdin.end(Buffer.from([0xff, 0xfe]));
        else {
          child.stdin.write("coworker_");
          lastWrite = setTimeout(
            () => child.stdin.end("delayed_fixture\n"),
            40,
          );
        }
      }, 40);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.stdin.on("error", () => {});
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    t.after(() => {
      clearTimeout(firstWrite);
      clearTimeout(lastWrite);
      clearTimeout(timeout);
      child.kill("SIGKILL");
      child.stdin.destroy();
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (mode === "delayed") {
      assert.equal(code, 0, errors);
      assert.equal(errors, "");
      assert.deepEqual(JSON.parse(output.slice("ready\n".length)), {
        coworkerId: "cw-1",
        stored: true,
      });
      assert.doesNotMatch(output, /coworker_delayed_fixture/);
    } else {
      assert.equal(code, 1, errors);
      assert.equal(output, "ready\n");
      assert.match(
        errors,
        mode === "oversize"
          ? /exceeds the size limit/
          : mode === "invalid-utf8"
            ? /valid UTF-8/
            : /aborted or timed out/,
      );
      assert.doesNotMatch(errors, /coworker_delayed_fixture/);
    }
  });
}

const runArgs = [
  "runtime",
  "run",
  "task-1",
  ...baseArgs,
  "--provider",
  "test",
  "--model",
  "test-model",
  "--hermes-home",
  "/test/hermes",
  "--runtime-directory",
  "/test/work",
];

function fixture() {
  const output: string[] = [];
  const calls: { path: string; method: string; body?: unknown }[] = [];
  let status = "READY";
  const dependencies: CliDependencies = {
    get authManager(): never {
      throw new Error("Developer credentials must not be read");
    },
    get env(): never {
      throw new Error("Developer environment must not be read");
    },
    get coreClient(): never {
      throw new Error("Developer client must not be used");
    },
    stdout: { write: (value) => output.push(value) },
    readStdin: () => key,
    runtime: {
      preflight: async () => {},
      execute: async ({ task }) => {
        assert.equal(task.id, "task-1");
        assert.equal(task.description, "Research the supplied topic.");
        return "Actual Hermes answer";
      },
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, PREPROD_API_URL);
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          `Bearer ${key}`,
        );
        assert.equal(init?.redirect, "error");
        const method = init?.method || "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ path: url.pathname, method, body });
        if (url.pathname === "/v1/coworkers/me")
          return Response.json({
            data: { id: "cw-1", archivedAt: null, capabilities: ["tasks"] },
          });
        if (method === "GET")
          return Response.json({
            data: {
              id: "task-1",
              name: "Research",
              description: "Research the supplied topic.",
              organizationId: "org-1",
              assigneeId: "cw-1",
              status,
              workspace: { id: "ws-1", organizationId: "org-1" },
              assignee: { id: "cw-1", type: "coworker" },
            },
          });
        if (body.status) status = body.status;
        return Response.json(
          {
            data: {
              id: "event-1",
              taskId: "task-1",
              status: body.status ?? null,
            },
          },
          { status: 201 },
        );
      },
    },
  };
  return {
    dependencies,
    calls,
    output,
    setStatus: (value: string) => {
      status = value;
    },
  };
}

test("any command-capable agent can start and complete a Task with its stored key", async () => {
  const f = fixture();
  const credentialStore: CredentialStore<RuntimeCredential> = {
    isSupported: true,
    read: () => ({ apiKey: key }),
    write: () => {
      throw new Error("Task commands must not change credentials");
    },
    clear: () => {},
  };
  f.dependencies.readStdin = () => {
    throw new Error("Stored-key commands must not read stdin");
  };
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    credentialStore,
    preflight: async () => {
      throw new Error("Generic Task tools must not require Hermes");
    },
    execute: async () => {
      throw new Error("The existing agent performs this Task");
    },
  };
  const args = baseArgs.filter((arg) => arg !== "--api-key-stdin");
  await runCli(["runtime", "start", "task-1", ...args], f.dependencies);
  assert.equal(JSON.parse(f.output[0]).status, "RUNNING");
  assert.equal(
    JSON.parse(f.output[0]).description,
    "Research the supplied topic.",
  );
  const file = join(
    mkdtempSync(join(tmpdir(), "soko-agent-result-")),
    "result.txt",
  );
  writeFileSync(file, "Answer from the developer's existing agent.");
  await runCli(
    ["runtime", "complete", "task-1", ...args, "--result-file", file],
    f.dependencies,
  );
  assert.equal(JSON.parse(f.output[1]).status, "COMPLETED");
  assert.deepEqual(f.calls.at(-1)?.body, {
    status: "COMPLETED",
    comment: "Answer from the developer's existing agent.",
  });
  assert.equal(f.calls.filter(({ method }) => method === "POST").length, 2);
  assert.ok(!f.output.join("").includes(key));
});

test("runtime key-import verifies identity before writing a Coworker key to the vault", async () => {
  const f = fixture();
  const writes: RuntimeCredential[] = [];
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    credentialStore: {
      isSupported: true,
      read: () => null,
      write: (value) => writes.push(value),
      clear: () => {},
    },
  };
  await runCli(
    [
      "runtime",
      "key-import",
      "--coworker-id",
      "cw-1",
      "--api-key-stdin",
      "--json",
    ],
    f.dependencies,
  );
  assert.deepEqual(writes, [{ apiKey: key }]);
  assert.deepEqual(
    f.calls.map(({ path }) => path),
    ["/v1/coworkers/me"],
  );
  assert.deepEqual(JSON.parse(f.output.join("")), {
    coworkerId: "cw-1",
    stored: true,
  });
  assert.ok(!f.output.join("").includes(key));
});

test("runtime key-import rejects another Coworker before writing to the vault", async () => {
  const f = fixture();
  let writes = 0;
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    credentialStore: {
      isSupported: true,
      read: () => null,
      write: () => {
        writes += 1;
      },
      clear: () => {},
    },
  };
  await assert.rejects(
    runCli(
      [
        "runtime",
        "key-import",
        "--coworker-id",
        "cw-other",
        "--api-key-stdin",
        "--json",
      ],
      f.dependencies,
    ),
    /requested active Coworker/,
  );
  assert.equal(writes, 0);
});

test("runtime tools stop when the scoped key is missing without developer fallback", async () => {
  const f = fixture();
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    credentialStore: {
      isSupported: true,
      read: () => null,
      write: () => {},
      clear: () => {},
    },
  };
  await assert.rejects(
    runCli(
      [
        "runtime",
        "start",
        "task-1",
        ...baseArgs.filter((arg) => arg !== "--api-key-stdin"),
      ],
      f.dependencies,
    ),
    /key|credential/i,
  );
  assert.equal(f.calls.length, 0);
});

test("runtime complete validates the result file before credential or network access", async () => {
  for (const content of [Buffer.from(" \n"), Buffer.from([0xff, 0xfe])]) {
    const f = fixture();
    f.dependencies.readStdin = () => {
      throw new Error("No key read before result validation");
    };
    const file = join(
      mkdtempSync(join(tmpdir(), "soko-invalid-result-")),
      "result.txt",
    );
    writeFileSync(file, content);
    await assert.rejects(
      runCli(
        ["runtime", "complete", "task-1", ...baseArgs, "--result-file", file],
        f.dependencies,
      ),
      /Result file/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("runtime complete never stores its credential in a Task result", async () => {
  const f = fixture();
  f.setStatus("RUNNING");
  const file = join(
    mkdtempSync(join(tmpdir(), "soko-secret-result-")),
    "result.txt",
  );
  writeFileSync(file, `Accidental credential: ${key}`);
  await assert.rejects(
    runCli(
      ["runtime", "complete", "task-1", ...baseArgs, "--result-file", file],
      f.dependencies,
    ),
    /contains the runtime credential/,
  );
  assert.equal(f.calls.length, 0);
  assert.ok(!f.output.join("").includes(key));
});

test("runtime accepts matching Coworker api-key JSON through stdin", async () => {
  const f = fixture();
  f.dependencies.readStdin = () =>
    JSON.stringify({ coworkerId: "cw-1", apiKey: { token: key } });
  await runCli(startArgs, f.dependencies);
  assert.equal(f.calls.length, 3);
});

test("runtime redacts a reflected credential from text output", async () => {
  const f = fixture();
  const fetchImpl = f.dependencies.runtime?.fetchImpl;
  assert.ok(fetchImpl);
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    fetchImpl: async (input, init) => {
      const response = await fetchImpl(input, init);
      const payload = await response.json();
      if (String(input).endsWith("/tasks/task-1"))
        payload.data.description = key;
      return Response.json(payload);
    },
  };
  await runCli(
    startArgs.filter((arg) => arg !== "--json"),
    f.dependencies,
  );
  assert.ok(!f.output.join("").includes(key));
  assert.match(f.output.join(""), /REDACTED/);
});

test("runtime rejects unsupported targets and options before reading credentials", async () => {
  for (const extra of [
    ["--api-url", "https://api.sokosumi.com"],
    ["--auth-url", "https://auth.test"],
    ["--workspace-id", "org-2"],
    ["--organization-slug", "developer-workspace"],
  ]) {
    const f = fixture();
    f.dependencies.readStdin = () => {
      throw new Error("stdin must not be read");
    };
    await assert.rejects(
      runCli([...startArgs, ...extra], f.dependencies),
      /does not accept/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("runtime rejects developer keys and mismatched Coworker JSON without network calls", async () => {
  for (const input of [
    "soko_preprod_secret",
    "oauth-secret",
    JSON.stringify({ coworkerId: "cw-other", apiKey: { token: key } }),
  ]) {
    const f = fixture();
    f.dependencies.readStdin = () => input;
    await assert.rejects(
      runCli(startArgs, f.dependencies),
      /Coworker|coworker/,
    );
    assert.equal(f.calls.length, 0);
    assert.ok(!f.output.join("").includes(input));
  }
});

test("unavailable runtime commands reject before credentials or network access", async () => {
  for (const command of ["pay"]) {
    const f = fixture();
    f.dependencies.readStdin = () => {
      throw new Error("stdin must not be read");
    };
    await assert.rejects(
      runCli(["runtime", command, "task-1", ...baseArgs], f.dependencies),
      /Use runtime start, complete, run, or receipt/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.output.length, 1);
    assert.match(
      JSON.parse(f.output[0]).error,
      /Use runtime start, complete, run, or receipt/,
    );
  }
});

test("runtime help works without bootstrap or runtime credentials", async () => {
  const f = fixture();
  f.dependencies.readStdin = () => {
    throw new Error("stdin must not be read");
  };
  await runCli(["runtime", "--help"], f.dependencies);
  assert.match(f.output.join(""), /runtime key-import/);
  assert.match(f.output.join(""), /runtime start TASK_ID/);
  assert.match(f.output.join(""), /runtime complete TASK_ID/);
  assert.match(f.output.join(""), /runtime run TASK_ID/);
  assert.doesNotMatch(f.output.join(""), /runtime pay TASK_ID/);
  assert.equal(f.calls.length, 0);
});

test("runtime runs one assigned Task without developer credentials or config", async () => {
  const f = fixture();
  await runCli(runArgs, f.dependencies);
  assert.deepEqual(
    f.calls.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /v1/coworkers/me",
      "GET /v1/tasks/task-1",
      "POST /v1/tasks/task-1/events",
      "GET /v1/tasks/task-1",
      "POST /v1/tasks/task-1/events",
    ],
  );
  assert.deepEqual(f.calls.at(-1)?.body, {
    status: "COMPLETED",
    comment: "Actual Hermes answer",
  });
  assert.equal(JSON.parse(f.output.join("")).status, "COMPLETED");
  assert.doesNotMatch(f.output.join(""), /coworker_runtime_test_secret/);
});

test("runtime rejects a Hermes result that reflects its credential", async () => {
  const f = fixture();
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    execute: async () => `Accidental credential: ${key}`,
  };
  await assert.rejects(
    runCli(runArgs, f.dependencies),
    /No completion was submitted/,
  );
  assert.deepEqual(
    f.calls.filter(({ method }) => method === "POST").map(({ body }) => body),
    [{ status: "RUNNING" }],
  );
  assert.ok(!f.output.join("").includes(key));
});

test("runtime keeps a reflected Core credential out of the Hermes Task input", async () => {
  const f = fixture();
  const fetchImpl = f.dependencies.runtime?.fetchImpl;
  assert.ok(fetchImpl);
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    fetchImpl: async (input, init) => {
      const response = await fetchImpl(input, init);
      const payload = await response.json();
      if (String(input).endsWith("/tasks/task-1"))
        payload.data.description = `Server reflection: ${key}`;
      return Response.json(payload);
    },
    execute: async ({ task }) => {
      assert.ok(!task.name.includes(key));
      assert.ok(!task.description?.includes(key));
      assert.match(task.description ?? "", /REDACTED/);
      return "Completed without the reflected credential.";
    },
  };
  await runCli(runArgs, f.dependencies);
  assert.equal(JSON.parse(f.output.join("")).status, "COMPLETED");
});

test("CLI runs the existing Hermes profile without model or tool overrides", {
  skip: process.platform === "win32",
}, async () => {
  const f = fixture();
  const directory = mkdtempSync(join(tmpdir(), "soko-runtime-pilot-"));
  const executable = join(directory, "hermes-fixture");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("Hermes fixture 1.0\\n");
} else if (args.includes("--help")) {
  process.stdout.write("--query-file --oneshot --format stream-json --source --max-turns --provider --model\\n");
} else {
  if (args.includes("${key}") || Object.keys(process.env).some((name) => name.startsWith("SOKOSUMI_"))) process.exit(1);
  if (args.some((arg) => ["--safe-mode", "--toolsets", "--provider", "--model"].includes(arg))) process.exit(2);
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const task = JSON.parse(input.trim().split("\\n").at(-1));
    if (Object.keys(task).sort().join(",") !== "description,name") process.exit(1);
    process.stdout.write(JSON.stringify({type: "result", exit_code: 0, text: "Finished: " + task.name}) + "\\n");
  });
}
`,
  );
  chmodSync(executable, 0o700);
  f.dependencies.runtime = { fetchImpl: f.dependencies.runtime?.fetchImpl };
  await runCli(
    [
      "runtime",
      "run",
      "task-1",
      ...baseArgs,
      "--hermes-home",
      directory,
      "--runtime-directory",
      directory,
      "--hermes-path",
      executable,
      "--timeout-ms",
      "5000",
    ],
    f.dependencies,
  );
  assert.deepEqual(f.calls.at(-1)?.body, {
    status: "COMPLETED",
    comment: "Finished: Research",
  });
  assert.equal(JSON.parse(f.output.join("")).result, "Finished: Research");
});

test("Hermes preflight failure occurs before key input or any Task state write", async () => {
  const f = fixture();
  f.dependencies.readStdin = () => {
    throw new Error("stdin must not be read");
  };
  f.dependencies.runtime = {
    ...f.dependencies.runtime,
    preflight: async () => {
      throw new Error("Hermes executable is unavailable");
    },
  };
  await assert.rejects(
    runCli(runArgs, f.dependencies),
    /Hermes executable is unavailable/,
  );
  assert.equal(f.calls.length, 0);
});

function receiptDependencies(receipt: unknown): {
  dependencies: CliDependencies;
  paths: string[];
  output: string[];
} {
  const output: string[] = [];
  const paths: string[] = [];
  const dependencies: CliDependencies = {
    stdout: { write: (value) => output.push(value) },
    readStdin: () => key,
    runtime: {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          `Bearer ${key}`,
        );
        paths.push(url.pathname);
        return Response.json({ data: receipt });
      },
    },
  };
  return { dependencies, paths, output };
}

test("runtime receipt reports a proven seller settlement", async () => {
  const { dependencies, paths, output } = receiptDependencies({
    blockchainIdentifier: "bc_1",
    claimStatus: "PURCHASED",
    onChainState: "Withdrawn",
    settled: true,
    txHash: "tx_withdrawn",
    withdrawnForSeller: [{ unit: "lovelace", amount: "500000" }],
  });
  await runCli(
    [
      "runtime",
      "receipt",
      "task-1",
      "--coworker-id",
      "cw-1",
      "--api-key-stdin",
      "--json",
    ],
    dependencies,
  );
  assert.ok(paths.includes("/v1/tasks/task-1/receipt"));
  const result = JSON.parse(output.join("")) as {
    settled: boolean;
    txHash: string;
  };
  assert.equal(result.settled, true);
  assert.equal(result.txHash, "tx_withdrawn");
});

test("runtime receipt reports an unsettled payment as not proven", async () => {
  const { dependencies, output } = receiptDependencies({
    blockchainIdentifier: "bc_1",
    claimStatus: "PURCHASED",
    onChainState: "FundsLocked",
    settled: false,
    txHash: null,
    withdrawnForSeller: [],
  });
  await runCli(
    [
      "runtime",
      "receipt",
      "task-1",
      "--coworker-id",
      "cw-1",
      "--api-key-stdin",
      "--json",
    ],
    dependencies,
  );
  const result = JSON.parse(output.join("")) as { settled: boolean };
  assert.equal(result.settled, false);
});

test("runtime receipt text mode confirms a settled seller receipt", async () => {
  const { dependencies, output } = receiptDependencies({
    blockchainIdentifier: "bc_1",
    claimStatus: "PURCHASED",
    onChainState: "Withdrawn",
    settled: true,
    txHash: "tx_withdrawn",
    withdrawnForSeller: [],
  });
  await runCli(
    [
      "runtime",
      "receipt",
      "task-1",
      "--coworker-id",
      "cw-1",
      "--api-key-stdin",
    ],
    dependencies,
  );
  const text = output.join("");
  assert.match(text, /Seller receipt confirmed/);
  assert.match(text, /tx_withdrawn/);
});

test("runtime receipt text mode reports an unsettled payment as not settled", async () => {
  const { dependencies, output } = receiptDependencies({
    blockchainIdentifier: "bc_1",
    claimStatus: "PURCHASED",
    onChainState: "FundsLocked",
    settled: false,
    txHash: null,
    withdrawnForSeller: [],
  });
  await runCli(
    [
      "runtime",
      "receipt",
      "task-1",
      "--coworker-id",
      "cw-1",
      "--api-key-stdin",
    ],
    dependencies,
  );
  const text = output.join("");
  assert.match(text, /Seller receipt not settled/);
  assert.match(text, /FundsLocked/);
});

test("runtime receipt rejects --organization-id like key-import", async () => {
  const { dependencies } = receiptDependencies({});
  await assert.rejects(
    runCli(
      [
        "runtime",
        "receipt",
        "task-1",
        "--coworker-id",
        "cw-1",
        "--organization-id",
        "org-1",
        "--api-key-stdin",
      ],
      dependencies,
    ),
    /does not accept --organization-id/,
  );
});
