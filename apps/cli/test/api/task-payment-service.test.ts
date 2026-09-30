import assert from "node:assert/strict";
import test from "node:test";
import type {
  CoreHttpClient,
  CoreHttpRequestOptions,
} from "../../src/api/http-client.js";
import {
  approveTaskPaymentQuote,
  createTaskPaymentQuote,
  fetchTaskPaymentQuote,
  revokeTaskPaymentQuote,
  validatePaymentDeadline,
} from "../../src/api/services/task-payment-service.js";

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
      sellerVkey: "ab".repeat(28),
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
const creation = {
  idempotencyKey: "request-1",
  payByTime: "2030-01-01T12:00:00Z",
  submitResultTime: "2030-01-01T13:00:00Z",
  unlockTime: "2030-01-01T14:00:00Z",
  externalDisputeUnlockTime: "2030-01-01T15:00:00Z",
};
interface Request {
  method: string;
  path: string;
  body?: unknown;
  signal?: AbortSignal;
  options?: CoreHttpRequestOptions;
}
function fixture(handler: (request: Request) => unknown) {
  const requests: Request[] = [];
  async function request<T>(value: Request): Promise<T> {
    requests.push(value);
    return handler(value) as T;
  }
  const client: CoreHttpClient = {
    get: (path, signal) => request({ method: "GET", path, signal }),
    post: (path, body, signal, options) =>
      request({ method: "POST", path, body, signal, options }),
    put: () => {
      throw new Error("Unexpected PUT");
    },
    patch: () => {
      throw new Error("Unexpected PATCH");
    },
  };
  return { client, requests };
}

test("quote creation sends one guarded request with the recovery key and allowlists all terms", async () => {
  const data = quote();
  const f = fixture(() => ({
    data: {
      ...data,
      apiKey: "private",
      terms: {
        ...data.terms,
        raw: "private",
        Amounts: [{ ...data.terms.Amounts[0], secret: "private" }],
      },
    },
    meta: { token: "private" },
  }));
  assert.deepEqual(
    await createTaskPaymentQuote(f.client, "task-1", creation),
    data,
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.path, "/v1/tasks/task-1/payment-quotes");
  assert.deepEqual(f.requests[0]?.body, creation);
  assert.deepEqual(f.requests[0]?.options, { rejectRedirects: true });
});

test("quote status supports unresolved recovery and both payment rails", async () => {
  const unresolved = {
    ...quote(),
    state: "unresolved",
    terms: null,
    termsHash: null,
    quotedCredits: null,
  };
  const v2 = {
    ...quote(),
    network: "Mainnet",
    terms: {
      ...quote().terms,
      paymentSourceType: "Web3CardanoV2",
      supportedPaymentSourceIndex: 2,
    },
  };
  for (const data of [unresolved, v2]) {
    const f = fixture(() => ({ data }));
    assert.deepEqual(
      await fetchTaskPaymentQuote(f.client, "task-1", "quote-1"),
      data,
    );
    assert.equal(
      f.requests[0]?.path,
      "/v1/tasks/task-1/payment-quotes/quote-1",
    );
    assert.equal(f.requests[0]?.method, "GET");
  }
});

test("quote parser refuses mismatches, malformed terms, and enabled payment responses", async () => {
  const base = quote();
  const invalid: unknown[] = [
    null,
    base,
    { data: { ...base, id: "other" } },
    ...[
      { taskId: "other" },
      { state: "unknown" },
      { network: "unknown" },
      { paymentsEnabled: true },
      { terms: null },
      { termsHash: null },
      { quotedCredits: NaN },
      { maxCredits: -1 },
      { termsHash: "invalid" },
      { expiresAt: "2030-02-30T12:00:00Z" },
      { approvedAt: 1 },
      { billingOrganizationId: undefined },
    ].map((field) => ({ data: { ...base, ...field } })),
    ...[
      { Amounts: [] },
      { Amounts: [{ amount: "0", unit: "" }] },
      { Amounts: [{ amount: "1e6", unit: "" }] },
      { supportedPaymentSourceIndex: -1 },
      { paymentSourceType: "unknown" },
      { inputHash: "c".repeat(64) },
      { sellerVkey: "secret\u001bvalue" },
      { payByTime: "9999999999999999999" },
    ].map((terms) => ({
      data: { ...base, terms: { ...base.terms, ...terms } },
    })),
  ];
  for (const response of invalid)
    await assert.rejects(
      fetchTaskPaymentQuote(
        fixture(() => response).client,
        "task-1",
        "quote-1",
      ),
    );
});

test("quote approval preserves the chosen hash and ceiling and confirms the returned state", async () => {
  const approved = {
    ...quote(),
    state: "approved",
    maxCredits: 25,
    approvedAt: "2030-01-01T11:00:00Z",
  };
  const f = fixture(() => ({ data: approved }));
  assert.deepEqual(
    await approveTaskPaymentQuote(
      f.client,
      "task-1",
      "quote-1",
      "b".repeat(64),
      25,
    ),
    approved,
  );
  assert.equal(
    f.requests[0]?.path,
    "/v1/tasks/task-1/payment-quotes/quote-1/approve",
  );
  assert.deepEqual(f.requests[0]?.body, {
    termsHash: "b".repeat(64),
    maxCredits: 25,
  });
  assert.deepEqual(f.requests[0]?.options, { rejectRedirects: true });
  for (const patch of [
    { state: "quoted" },
    { maxCredits: 26 },
    { termsHash: "c".repeat(64) },
    { approvedAt: null },
  ]) {
    const invalid = fixture(() => ({ data: { ...approved, ...patch } }));
    await assert.rejects(
      approveTaskPaymentQuote(
        invalid.client,
        "task-1",
        "quote-1",
        "b".repeat(64),
        25,
      ),
      /approval could not be confirmed/,
    );
  }
});

test("quote revocation is guarded and requires a confirmed revoked state", async () => {
  const revoked = {
    ...quote(),
    state: "revoked",
    revokedAt: "2030-01-01T11:00:00Z",
  };
  const f = fixture(() => ({ data: revoked }));
  assert.deepEqual(
    await revokeTaskPaymentQuote(f.client, "task-1", "quote-1"),
    revoked,
  );
  assert.equal(
    f.requests[0]?.path,
    "/v1/tasks/task-1/payment-quotes/quote-1/revoke",
  );
  assert.deepEqual(f.requests[0]?.body, {});
  assert.deepEqual(f.requests[0]?.options, { rejectRedirects: true });
  await assert.rejects(
    revokeTaskPaymentQuote(
      fixture(() => ({ data: quote() })).client,
      "task-1",
      "quote-1",
    ),
    /revocation could not be confirmed/,
  );
});

test("quote approval rejects ceilings that Core would round before any request", async () => {
  for (const maxCredits of [1.00000000001, 1.00000000005, 0.00000000001]) {
    const f = fixture(() => ({
      data: {
        ...quote(),
        state: "approved",
        maxCredits: Number(maxCredits.toFixed(10)),
        approvedAt: "2030-01-01T11:00:00Z",
      },
    }));
    await assert.rejects(
      approveTaskPaymentQuote(
        f.client,
        "task-1",
        "quote-1",
        "b".repeat(64),
        maxCredits,
      ),
      /at most 10 decimal places/,
    );
    assert.equal(f.requests.length, 0);
  }
});

test("quote approval preserves a ceiling with 10 decimal places", async () => {
  const maxCredits = 25.1234567891;
  const approved = {
    ...quote(),
    state: "approved",
    maxCredits,
    approvedAt: "2030-01-01T11:00:00Z",
  };
  const f = fixture(() => ({ data: approved }));
  assert.deepEqual(
    await approveTaskPaymentQuote(
      f.client,
      "task-1",
      "quote-1",
      "b".repeat(64),
      maxCredits,
    ),
    approved,
  );
  assert.deepEqual(f.requests[0]?.body, {
    termsHash: "b".repeat(64),
    maxCredits,
  });
  assert.equal(f.requests.length, 1);
});

test("quote methods reject cancellation and invalid approval values before requests", async () => {
  const f = fixture(() => {
    throw new Error("Unexpected request");
  });
  const signal = AbortSignal.abort();
  await assert.rejects(
    createTaskPaymentQuote(f.client, "task-1", creation, signal),
  );
  await assert.rejects(
    fetchTaskPaymentQuote(f.client, "task-1", "quote-1", signal),
  );
  await assert.rejects(
    approveTaskPaymentQuote(
      f.client,
      "task-1",
      "quote-1",
      "b".repeat(64),
      25,
      signal,
    ),
  );
  await assert.rejects(
    revokeTaskPaymentQuote(f.client, "task-1", "quote-1", signal),
  );
  for (const max of [0, -1, Infinity, NaN, 922_337_204])
    await assert.rejects(
      approveTaskPaymentQuote(
        f.client,
        "task-1",
        "quote-1",
        "b".repeat(64),
        max,
      ),
    );
  await assert.rejects(
    approveTaskPaymentQuote(f.client, "task-1", "quote-1", "bad", 25),
  );
  for (const id of ["", ".", "..", "a/b", "a%2Fb", "bad\nvalue"])
    await assert.rejects(fetchTaskPaymentQuote(f.client, "task-1", id));
  assert.equal(f.requests.length, 0);
});

test("quote deadlines require real calendar values with an explicit timezone", () => {
  for (const value of ["2030-01-01T12:00:00Z", "2030-01-01T12:00:00.123+02:00"])
    assert.equal(validatePaymentDeadline(value, "deadline"), value);
  for (const value of [
    "tomorrow",
    "2030-02-30T12:00:00Z",
    "2030-01-01T25:00:00Z",
    "2030-01-01T12:00:00",
    "2030-01-01T12:00:00+25:00",
  ])
    assert.throws(() => validatePaymentDeadline(value, "deadline"));
});
