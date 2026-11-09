import assert from "node:assert/strict";
import test from "node:test";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

const run = {
  id: "run-1",
  createdAt: "2026-11-09T04:00:00.000Z",
  trigger: "MANUAL",
  status: "COMPLETED",
  suites: ["soko-bot"],
  caseIds: [],
  repeats: 2,
  commitSha: "abcdef1234567",
  commitMessage: "feat: evals (#6940)",
  prNumber: 6940,
  environment: "mainnet",
  models: { sokoBotVersionId: "v33" },
};

const report = {
  run,
  baseline: {
    id: "run-0",
    createdAt: "2026-11-08T04:00:00.000Z",
    prNumber: 6931,
  },
  history: [],
  summary: {
    counts: { regressed: 1, fixed: 1, passing: 1 },
    passed: 4,
    scored: 6,
    open: 0,
    costUsd: 1.234,
  },
  cases: [
    {
      caseId: "chat-post",
      suite: "soko-bot",
      area: "Chat",
      title: "Post into a room",
      intent: "",
      outcome: "passing",
      states: ["PASSED", "PASSED"],
      passRate: 1,
      baselinePassRate: 1,
      history: [1],
      results: [],
    },
    {
      caseId: "ambiguous-request",
      suite: "soko-bot",
      area: "Judgment",
      title: "Ambiguous request",
      intent: "",
      outcome: "regressed",
      states: ["FAILED", "FAILED"],
      passRate: 0,
      baselinePassRate: 1,
      history: [1],
      results: [
        {
          repeat: 1,
          status: "FAILED",
          error: null,
          checks: [
            { label: "Completed", pass: true, actual: "COMPLETED" },
            { label: "Asks a question", pass: false, actual: "no question" },
          ],
          judge: null,
        },
      ],
    },
    {
      caseId: "files-review",
      suite: "soko-bot",
      area: "Drive",
      title: "Look through the Drive",
      intent: "",
      outcome: "fixed",
      states: ["PASSED", "PASSED"],
      passRate: 1,
      baselinePassRate: 0,
      history: [0],
      results: [],
    },
  ],
};

function fixture(reports: unknown[] = [report]) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const output: string[] = [];
  const queue = [...reports];
  const deps: CliDependencies = {
    env: { SOKOSUMI_AUTH_TOKEN: "fixture-token" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    stdout: { write: (value) => output.push(value) },
    coreClient: {
      get: async <T>(path: string) => {
        calls.push({ method: "GET", path });
        if (path.startsWith("/v1/admin/evals/runs/"))
          return { data: queue.length > 1 ? queue.shift() : queue[0] } as T;
        if (path.startsWith("/v1/admin/evals/runs?"))
          return {
            data: [
              {
                ...run,
                scores: { "soko-bot": { passed: 4, scored: 6, open: 0 } },
                costUsd: 1.234,
              },
            ],
          } as T;
        if (path === "/v1/admin/evals/cases")
          return {
            data: [
              {
                id: "inbox-summary",
                suite: "soko-bot",
                area: "Mail and calendar",
                title: "Summarise recent mail",
                requires: "mailbox",
              },
            ],
          } as T;
        throw new Error(`Unexpected GET ${path}`);
      },
      post: async <T>(path: string, body: unknown) => {
        calls.push({ method: "POST", path, body });
        if (path === "/v1/admin/evals/runs")
          return { data: { ...run, status: "QUEUED" } } as T;
        if (path === "/v1/admin/evals/tick")
          return {
            data: { runId: "run-1", completed: false, busy: false },
          } as T;
        throw new Error(`Unexpected POST ${path}`);
      },
    } as never,
  };
  return { deps, calls, output: () => output.join("") };
}

test("evals run sends the suite, cases, repeats and versions", async () => {
  const { deps, calls, output } = fixture();
  await runCli(
    [
      "evals",
      "run",
      "--suite",
      "soko-bot",
      "--cases",
      "ambiguous-request, chat-post",
      "--repeats",
      "2",
      "--soko-bot-version",
      "v34",
    ],
    deps,
  );
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: "/v1/admin/evals/runs",
    body: {
      suites: ["soko-bot"],
      caseIds: ["ambiguous-request", "chat-post"],
      repeats: 2,
      sokoBotVersionId: "v34",
    },
  });
  assert.match(output(), /Started eval run run-1 \(queued\), 2 repeats/);
});

test("evals run refuses a repeat count Core would refuse", async () => {
  const { deps } = fixture();
  await assert.rejects(
    runCli(["evals", "run", "--repeats", "4"], deps),
    /--repeats is 1, 2 or 3/,
  );
});

test("evals run --wait --tick moves the run on until it ends, then reports", async () => {
  const running = {
    ...report,
    run: { ...run, status: "RUNNING" },
    summary: { ...report.summary, open: 2 },
  };
  const { deps, calls, output } = fixture([running, report]);
  const sleeps: number[] = [];
  await runCli(["evals", "run", "--wait", "--tick"], {
    ...deps,
    evalsSleep: async (ms: number) => {
      sleeps.push(ms);
    },
  } as CliDependencies);
  assert.equal(
    calls.filter((call) => call.path === "/v1/admin/evals/tick").length,
    2,
  );
  assert.deepEqual(sleeps, [20_000]);
  const text = output();
  assert.match(text, /running: 2 to go/);
  assert.match(text, /67% passed \(4 of 6\)/);
  assert.match(
    text,
    /REGRESSED ambiguous-request 0% \(was 100%\)  Asks a question: no question/,
  );
  assert.doesNotMatch(text, /chat-post/);
});

test("evals show --markdown prints the PR table with what changed", async () => {
  const { deps, output } = fixture();
  await runCli(["evals", "show", "run-1", "--markdown"], deps);
  const text = output();
  assert.match(
    text,
    /\*\*Evals\*\* \(mainnet, #6940, 2 repeats, vs daily run #6931\)/,
  );
  assert.match(text, /\| soko-bot \| 4\/6 \| 1 \| 1 \| 0 \| 0 \|/);
  assert.match(
    text,
    /▼ `ambiguous-request` 100% → 0%: Asks a question: no question/,
  );
  assert.match(text, /▲ `files-review` 0% → 100%/);
  assert.match(text, /Cost \$1\.23/);
});

test("evals list and cases read Core", async () => {
  const { deps, output } = fixture();
  await runCli(["evals", "list", "--limit", "5"], deps);
  assert.match(output(), /#6940 +soko-bot 4\/6 +\$1\.23 +run-1/);
  await runCli(["evals", "cases"], deps);
  assert.match(output(), /inbox-summary \(needs mailbox\)/);
});

test("evals show needs a run id", async () => {
  const { deps } = fixture();
  await assert.rejects(runCli(["evals", "show"], deps), /evals show RUN_ID/);
});
