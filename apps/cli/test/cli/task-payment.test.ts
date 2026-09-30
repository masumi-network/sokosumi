import assert from "node:assert/strict";
import test from "node:test";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

function quote() {
  return {
    id: "quote-1",
    taskId: "task-1",
    coworkerId: "cw-1",
    sellerBindingId: "binding-1",
    billingOwnerId: "owner-1",
    billingOrganizationId: "org-1",
    network: "Preprod",
    state: "quoted",
    inputHash: "a".repeat(64),
    termsHash: "b".repeat(64),
    quotedCredits: 20,
    maxCredits: null,
    expiresAt: "2030-01-01T12:00:00.000Z",
    approvedAt: null,
    revokedAt: null,
    consumedAt: null,
    paymentsEnabled: false,
    terms: {
      paymentId: "payment-1",
      blockchainIdentifier: "blockchain-1",
      identifierFromPurchaser: "aabbccddeeff00",
      agentIdentifier: "ab".repeat(29),
      sellerVkey: "cd".repeat(28),
      inputHash: "a".repeat(64),
      paymentSourceType: "Web3CardanoV1",
      smartContractAddress: "addr_test1contract",
      sellerReturnAddress: "addr_test1return",
      Amounts: [{ amount: "20000000", unit: "" }],
      payByTime: "1893499200000",
      submitResultTime: "1893502800000",
      unlockTime: "1893506400000",
      externalDisputeUnlockTime: "1893510000000",
    },
  };
}
const createArgs = [
  "tasks",
  "payment-quote",
  "task-1",
  "--request-id",
  "request-1",
  "--pay-by",
  "2030-01-01T12:00:00Z",
  "--submit-result-by",
  "2030-01-01T13:00:00Z",
  "--unlock-at",
  "2030-01-01T14:00:00Z",
  "--dispute-unlock-at",
  "2030-01-01T15:00:00Z",
  "--json",
];
const approveArgs = [
  "tasks",
  "payment-approve",
  "task-1",
  "--quote-id",
  "quote-1",
  "--terms-hash",
  "b".repeat(64),
  "--max-credits",
  "25",
  "--confirm-payment",
  "--json",
];
function fixture() {
  const output: string[] = [];
  const dependencies: CliDependencies = {
    env: { SOKOSUMI_AUTH_TOKEN: "developer-secret" },
    authManager: new AuthManager({
      credentialStore: {
        read: () => null,
        write() {
          throw new Error("No credential writes");
        },
        clear() {},
      },
      apiKeyStore: {
        read: () => null,
        write() {
          throw new Error("No credential writes");
        },
        clear() {},
      },
    }),
    stdout: { write: (text) => output.push(text) },
    readStdin: () => {
      throw new Error("No credential input");
    },
  };
  return { output, dependencies };
}

test("Task quote request preserves organization and Core target without funding or retries", async (context) => {
  const f = fixture();
  const requests: { url: string; init?: RequestInit }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Response.json({
        data: {
          ...quote(),
          token: "private",
          terms: { ...quote().terms, private: "internal" },
        },
      });
    },
  );
  await runCli(
    [...createArgs, "--preprod", "--organization-slug", "workspace-1"],
    f.dependencies,
  );
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "https://api.preprod.sokosumi.com/v1/tasks/task-1/payment-quotes",
  );
  assert.equal(requests[0]?.init?.redirect, "error");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer developer-secret");
  assert.equal(headers.get("x-organization-slug"), "workspace-1");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    idempotencyKey: "request-1",
    payByTime: "2030-01-01T12:00:00Z",
    submitResultTime: "2030-01-01T13:00:00Z",
    unlockTime: "2030-01-01T14:00:00Z",
    externalDisputeUnlockTime: "2030-01-01T15:00:00Z",
  });
  assert.equal(f.output.length, 1);
  assert.deepEqual(JSON.parse(f.output.join("")), { quote: quote() });
  assert.doesNotMatch(f.output.join(""), /private|internal|developer-secret/);
});

test("unresolved quote output preserves the recovery request ID without claiming funding", async (context) => {
  const f = fixture();
  const unresolved = {
    ...quote(),
    state: "unresolved",
    terms: null,
    termsHash: null,
    quotedCredits: null,
  };
  let requests = 0;
  context.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ data: unresolved });
  });
  await runCli(createArgs, f.dependencies);
  const result = JSON.parse(f.output.join(""));
  assert.deepEqual(result.quote, unresolved);
  assert.equal(result.recovery.requestId, "request-1");
  assert.match(
    result.recovery.message,
    /same --request-id.*read-only recovery.*Funding is not confirmed/,
  );
  assert.equal(requests, 1);
});

test("payment status renders full terms before customer approval", async (context) => {
  const f = fixture();
  context.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      assert.equal(init?.method, "GET");
      return Response.json({ data: quote() });
    },
  );
  await runCli(
    ["tasks", "payment-status", "task-1", "--quote-id", "quote-1"],
    f.dependencies,
  );
  const output = f.output.join("");
  for (const expected of [
    "owner-1",
    "org-1",
    "binding-1",
    "20",
    "b".repeat(64),
    "20000000 lovelace (ADA)",
    "addr_test1contract",
    "addr_test1return",
    "cd".repeat(28),
    "Pay by:",
    "Submit result by:",
    "Unlock at:",
    "Dispute unlock at:",
  ])
    assert.ok(output.includes(expected), expected);
  assert.match(output, /Payments are disabled.*does not fund or execute/);
});

test("approval checks the selected quote before sending explicit terms and ceiling", async (context) => {
  const f = fixture();
  const requests: { path: string; method: string }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      requests.push({ path, method: init?.method ?? "GET" });
      assert.equal(
        new Headers(init?.headers).get("x-organization-slug"),
        "workspace-1",
      );
      if (init?.method === "POST") {
        assert.equal(init.redirect, "error");
        assert.deepEqual(JSON.parse(String(init.body)), {
          termsHash: "b".repeat(64),
          maxCredits: 25,
        });
        return Response.json({
          data: {
            ...quote(),
            state: "approved",
            maxCredits: 25,
            approvedAt: "2030-01-01T11:00:00Z",
          },
        });
      }
      return Response.json({ data: quote() });
    },
  );
  await runCli(
    [...approveArgs, "--organization-slug", "workspace-1"],
    f.dependencies,
  );
  assert.deepEqual(requests, [
    { path: "/v1/tasks/task-1/payment-quotes/quote-1", method: "GET" },
    { path: "/v1/tasks/task-1/payment-quotes/quote-1/approve", method: "POST" },
  ]);
  assert.equal(f.output.length, 1);
  assert.equal(JSON.parse(f.output.join("")).quote.state, "approved");
});

test("text approval displays the reviewed terms before its POST", async (context) => {
  const f = fixture();
  context.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        assert.match(f.output.join(""), /Amount: 20000000 lovelace/);
        assert.match(f.output.join(""), /Terms hash:/);
        return Response.json({
          data: {
            ...quote(),
            state: "approved",
            maxCredits: 25,
            approvedAt: "2030-01-01T11:00:00Z",
          },
        });
      }
      return Response.json({ data: quote() });
    },
  );
  await runCli(
    approveArgs.filter((arg) => arg !== "--json"),
    f.dependencies,
  );
  assert.match(
    f.output.join(""),
    /Payment quote approved. Payments remain disabled/,
  );
});

test("approval rejects missing confirmation and invalid values before HTTP", async (context) => {
  let requests = 0;
  context.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw new Error("Unexpected request");
  });
  for (const args of [
    approveArgs.filter((arg) => arg !== "--confirm-payment"),
    [...approveArgs, "--max-credits", "0"],
    [...approveArgs, "--max-credits", "Infinity"],
    [...approveArgs, "--max-credits", "1e4"],
    [...approveArgs, "--terms-hash", "changed"],
    [...approveArgs, "--api-key-stdin"],
    [...createArgs, "--pay-by", "2030-02-30T12:00:00Z"],
    [...createArgs, "--request-id", "bad/key"],
    ["tasks", "payment-revoke", "task-1", "--json"],
  ]) {
    const f = fixture();
    await assert.rejects(runCli(args, f.dependencies));
    assert.equal(f.output.length, 1);
  }
  assert.equal(requests, 0);
});

test("approval refuses changed terms, insufficient ceilings, and unavailable quotes", async (context) => {
  for (const patch of [
    { termsHash: "c".repeat(64) },
    { quotedCredits: 26 },
    { state: "revoked" },
    { state: "expired" },
    { state: "consumed" },
    { state: "unresolved", terms: null, termsHash: null, quotedCredits: null },
  ]) {
    const f = fixture();
    let requests = 0;
    const mock = context.mock.method(
      globalThis,
      "fetch",
      async (_input: unknown, init?: RequestInit) => {
        requests++;
        assert.equal(init?.method, "GET");
        return Response.json({ data: { ...quote(), ...patch } });
      },
    );
    await assert.rejects(
      runCli(approveArgs, f.dependencies),
      /cannot be approved/,
    );
    assert.equal(requests, 1);
    mock.mock.restore();
  }
});

test("payment revoke sends only the selected quote and reports revoked state", async (context) => {
  const f = fixture();
  let requests = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      requests++;
      assert.equal(
        new URL(String(input)).pathname,
        "/v1/tasks/task-1/payment-quotes/quote-1/revoke",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, "{}");
      return Response.json({
        data: {
          ...quote(),
          state: "revoked",
          revokedAt: "2030-01-01T11:00:00Z",
        },
      });
    },
  );
  await runCli(
    ["tasks", "payment-revoke", "task-1", "--quote-id", "quote-1", "--json"],
    f.dependencies,
  );
  assert.equal(requests, 1);
  assert.equal(JSON.parse(f.output.join("")).quote.state, "revoked");
});

test("quote creation and approval do not retry failed or redirected requests", async (context) => {
  for (const command of [createArgs, approveArgs]) {
    for (const mode of ["network", "redirect", "api"]) {
      const f = fixture();
      let mutations = 0;
      const mock = context.mock.method(
        globalThis,
        "fetch",
        async (_input: unknown, init?: RequestInit) => {
          if (init?.method === "GET") return Response.json({ data: quote() });
          mutations++;
          if (mode === "network")
            throw new Error("fetch failed developer-secret");
          if (mode === "redirect")
            return new Response(null, {
              status: 307,
              headers: { location: "https://other.example" },
            });
          return Response.json(
            { message: "Denied developer-secret" },
            { status: 403 },
          );
        },
      );
      await assert.rejects(
        runCli(command, f.dependencies),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          if (command === createArgs && mode === "network") {
            assert.match(
              error.message,
              /same --request-id.*read-only recovery/,
            );
          }
          return true;
        },
      );
      assert.equal(mutations, 1);
      assert.equal(f.output.length, 1);
      assert.doesNotMatch(f.output.join(""), /developer-secret/);
      mock.mock.restore();
    }
  }
});
