import assert from "node:assert/strict";
import test from "node:test";
import type {
  CoreHttpClient,
  CoreHttpRequestOptions,
} from "../../src/api/http-client.js";
import {
  connectMpsSeller,
  fetchMpsSeller,
  revokeMpsSeller,
} from "../../src/api/services/mps-seller-service.js";

function seller() {
  return {
    id: "binding-1",
    coworkerId: "cw-1",
    network: "Preprod",
    apiUrl: "https://mps.example.test",
    agentIdentifier: "ab12",
    walletId: "wallet-1",
    paymentSourceId: "source-1",
    sellerVkey: "ab".repeat(28),
    walletAddress: "addr_test1seller",
    sellerReturnAddress: null,
    paymentSourceType: "Web3CardanoV1",
    smartContractAddress: "addr_test1contract",
    verifiedAt: "2026-09-30T12:00:00.000Z",
    revokedAt: null,
    paymentsEnabled: false,
  };
}

const connection = {
  apiUrl: "https://mps.example.test/",
  apiKey: "mps-seller-secret",
  agentIdentifier: "ab12",
  walletId: "wallet-1",
  paymentSourceId: "source-1",
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

test("MPS connect uses one guarded request and returns only the seller DTO", async () => {
  const f = fixture(() => ({
    data: {
      ...seller(),
      apiKey: connection.apiKey,
      encryptedApiKey: "encrypted-private-value",
      debug: { message: connection.apiKey },
    },
    meta: { private: connection.apiKey },
  }));
  assert.deepEqual(
    await connectMpsSeller(f.client, "cw-1", connection),
    seller(),
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.path, "/v1/coworkers/cw-1/mps-seller");
  assert.equal(f.requests[0]?.method, "POST");
  assert.deepEqual(f.requests[0]?.body, {
    ...connection,
    apiUrl: seller().apiUrl,
  });
  assert.deepEqual(f.requests[0]?.options, {
    sensitiveValues: [connection.apiKey],
    rejectRedirects: true,
  });
  assert.ok(f.requests[0]?.signal instanceof AbortSignal);
});

test("MPS status accepts an absent seller and both networks without forwarding metadata", async () => {
  for (const data of [
    null,
    seller(),
    {
      ...seller(),
      network: "Mainnet",
      paymentSourceType: "Web3CardanoV2",
      sellerReturnAddress: "addr1return",
    },
  ]) {
    const f = fixture(() => ({ data, meta: { token: "private" } }));
    assert.deepEqual(await fetchMpsSeller(f.client, "cw-1"), data);
    assert.equal(f.requests[0]?.method, "GET");
    assert.equal(f.requests[0]?.path, "/v1/coworkers/cw-1/mps-seller");
  }
});

test("MPS connect canonicalizes uppercase identifiers before sending and comparing them", async () => {
  const f = fixture(() => ({ data: seller() }));
  assert.deepEqual(
    await connectMpsSeller(f.client, "cw-1", {
      ...connection,
      agentIdentifier: "AB12",
    }),
    seller(),
  );
  assert.equal(
    (f.requests[0]?.body as { agentIdentifier: string }).agentIdentifier,
    "ab12",
  );
});

test("MPS seller parsing rejects malformed, mismatched, and enabled responses", async () => {
  const responses: unknown[] = [
    undefined,
    seller(),
    { data: [] },
    { data: { ...seller(), coworkerId: "other" } },
    { data: { ...seller(), network: "unknown" } },
    { data: { ...seller(), paymentsEnabled: true } },
    { data: { ...seller(), paymentSourceType: "unknown" } },
    { data: { ...seller(), apiUrl: "https://secret@mps.example.test" } },
    {
      data: { ...seller(), apiUrl: "https://mps.example.test/?apiKey=secret" },
    },
    { data: { ...seller(), verifiedAt: "2026-02-30T12:00:00.000Z" } },
    { data: { ...seller(), revokedAt: "yesterday" } },
    { data: { ...seller(), sellerReturnAddress: 123 } },
  ];
  for (const field of [
    "id",
    "agentIdentifier",
    "walletId",
    "paymentSourceId",
    "sellerVkey",
    "walletAddress",
    "smartContractAddress",
  ]) {
    responses.push({ data: { ...seller(), [field]: "" } });
    responses.push({ data: { ...seller(), [field]: "bad\u001bvalue" } });
  }
  for (const response of responses) {
    const f = fixture(() => response);
    await assert.rejects(fetchMpsSeller(f.client, "cw-1"));
  }
});

test("MPS connect rejects a mismatched or revoked binding", async () => {
  for (const data of [
    null,
    { ...seller(), apiUrl: "https://other.example.test" },
    { ...seller(), agentIdentifier: "abcd" },
    { ...seller(), walletId: "other" },
    { ...seller(), paymentSourceId: "other" },
    { ...seller(), revokedAt: "2026-09-30T12:01:00.000Z" },
  ]) {
    const f = fixture(() => ({ data }));
    await assert.rejects(
      connectMpsSeller(f.client, "cw-1", connection),
      /connected seller does not match/,
    );
    assert.equal(f.requests.length, 1);
  }
});

test("MPS revoke targets the selected binding and confirms revocation", async () => {
  const revoked = { ...seller(), revokedAt: "2026-09-30T12:01:00.000Z" };
  const f = fixture(() => ({ data: revoked }));
  assert.deepEqual(
    await revokeMpsSeller(f.client, "cw-1", "binding-1"),
    revoked,
  );
  assert.equal(f.requests[0]?.path, "/v1/coworkers/cw-1/mps-seller/revoke");
  assert.deepEqual(f.requests[0]?.body, { bindingId: "binding-1" });
  for (const data of [null, seller(), { ...revoked, id: "other" }]) {
    const invalid = fixture(() => ({ data }));
    await assert.rejects(
      revokeMpsSeller(invalid.client, "cw-1", "binding-1"),
      /revocation could not be confirmed/,
    );
  }
});

test("MPS requests reject cancellation and invalid paths or URLs before HTTP", async () => {
  const f = fixture(() => {
    throw new Error("Unexpected request");
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchMpsSeller(f.client, "cw-1", controller.signal));
  await assert.rejects(
    connectMpsSeller(f.client, "cw-1", connection, controller.signal),
  );
  await assert.rejects(
    revokeMpsSeller(f.client, "cw-1", "binding-1", controller.signal),
  );
  for (const id of ["", ".", "..", "bad\nvalue"])
    await assert.rejects(fetchMpsSeller(f.client, id));
  for (const apiUrl of [
    "bad",
    "http://mps.example.test",
    "https://key@mps.example.test",
    "https://mps.example.test/?secret=value",
    "https://mps.example.test/#secret",
    " https://mps.example.test",
  ]) {
    await assert.rejects(
      connectMpsSeller(f.client, "cw-1", { ...connection, apiUrl }),
    );
  }
  assert.equal(f.requests.length, 0);
});
