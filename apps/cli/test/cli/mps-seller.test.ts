import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHttpClient } from "../../src/api/http-client.js";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { runCli } from "../../src/cli/index.js";

const apiKey = "mps-seller-secret";
const token = "developer-oauth-secret";
const args = [
  "coworkers",
  "mps-connect",
  "cw-1",
  "--preprod",
  "--json",
  "--mps-url",
  "https://mps.example.test",
  "--agent-identifier",
  "ab12",
  "--wallet-id",
  "wallet-1",
  "--payment-source-id",
  "source-1",
  "--mps-api-key-stdin",
];
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
function fixture(fetchImpl?: typeof fetch) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const output: string[] = [];
  const authManager = new AuthManager({
    credentialStore: {
      read: () => null,
      write: () => {
        throw new Error("No credential write");
      },
      clear: () => {},
    },
    apiKeyStore: {
      read: () => null,
      write: () => {
        throw new Error("No API key write");
      },
      clear: () => {},
    },
  });
  const environment = { SOKOSUMI_AUTH_TOKEN: token };
  let reads = 0;
  return {
    requests,
    output,
    stdinReads: () => reads,
    dependencies: {
      env: environment,
      authManager,
      stdout: {
        write: (text: string) => {
          output.push(text);
        },
      },
      readStdin: () => {
        reads++;
        return `${apiKey}\n`;
      },
      coreClient: createCoreHttpClient({
        apiUrl: "https://api.preprod.sokosumi.com",
        authManager,
        environment,
        fetchImpl: async (input, init) => {
          requests.push({ url: String(input), init });
          return fetchImpl
            ? fetchImpl(input, init)
            : Response.json({
                data: { ...seller(), apiKey, internal: token },
                meta: { private: apiKey },
              });
        },
      }),
    },
  };
}

test("MPS connect reads stdin once and sends one authenticated guarded Core request", async () => {
  const f = fixture();
  await runCli(args, f.dependencies);
  assert.equal(f.stdinReads(), 1);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(
    request?.url,
    "https://api.preprod.sokosumi.com/v1/coworkers/cw-1/mps-seller",
  );
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.redirect, "error");
  assert.equal(
    new Headers(request?.init?.headers).get("authorization"),
    `Bearer ${token}`,
  );
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    apiUrl: "https://mps.example.test",
    apiKey,
    agentIdentifier: "ab12",
    walletId: "wallet-1",
    paymentSourceId: "source-1",
  });
  assert.equal(f.output.length, 1);
  assert.deepEqual(JSON.parse(f.output.join("")), { seller: seller() });
  assert.doesNotMatch(
    f.output.join(""),
    /mps-seller-secret|developer-oauth-secret|internal|private/,
  );
});

test("MPS status and revoke never read or create runtime credentials", async () => {
  for (const command of ["mps-status", "mps-revoke"]) {
    const revokedAt =
      command === "mps-revoke" ? "2026-09-30T12:01:00.000Z" : null;
    const f = fixture(async () =>
      Response.json({ data: { ...seller(), revokedAt } }),
    );
    f.dependencies.readStdin = () => {
      throw new Error("stdin must not be read");
    };
    await runCli(
      [
        "coworkers",
        command,
        "cw-1",
        "--json",
        ...(command === "mps-revoke" ? ["--binding-id", "binding-1"] : []),
      ],
      f.dependencies,
    );
    assert.equal(f.requests.length, 1);
    assert.equal(
      f.requests[0]?.init?.method,
      command === "mps-status" ? "GET" : "POST",
    );
    assert.equal(JSON.parse(f.output.join("")).seller.revokedAt, revokedAt);
  }
});

test("MPS commands explain that setup does not enable payments", async () => {
  for (const data of [
    seller(),
    null,
    { ...seller(), revokedAt: "2026-09-30T12:01:00.000Z" },
  ]) {
    const f = fixture(async () => Response.json({ data }));
    await runCli(["coworkers", "mps-status", "cw-1"], f.dependencies);
    assert.match(f.output.join(""), /Payments are disabled/);
    assert.match(
      f.output.join(""),
      data === null
        ? /No MPS seller/
        : data.revokedAt
          ? /connection revoked/
          : /setup verified/,
    );
    assert.equal(f.stdinReads(), 0);
  }
});

test("MPS connect accepts the selected Mainnet target", async () => {
  const f = fixture(async () =>
    Response.json({ data: { ...seller(), network: "Mainnet" } }),
  );
  await runCli(
    args.filter((arg) => arg !== "--preprod"),
    f.dependencies,
  );
  assert.equal(JSON.parse(f.output.join("")).seller.network, "Mainnet");
  assert.equal(f.requests.length, 1);
});

test("MPS connect validates options before reading a key or making a request", async () => {
  const invalidArgs = [
    args.filter((arg) => arg !== "--mps-api-key-stdin"),
    args.filter((arg) => arg !== "cw-1"),
    [...args, "--create-api-key"],
    [...args, "--api-key-stdin"],
    [...args, "--mps-url", "http://mps.example.test"],
    [...args, "--mps-url", "https://private-secret@mps.example.test"],
    [...args, "--agent-identifier", "not-hex"],
    [...args, "--wallet-id", "bad\nvalue"],
    [...args, "--mps-api-key", apiKey],
    [...args, `--mps-api-key-stdin=${apiKey}`],
    [...args, apiKey],
    ["coworkers", "mps-revoke", "cw-1", "--json"],
    ["coworkers", "mps-status", "cw-1", "--json", "--mps-api-key-stdin"],
  ];
  for (const values of invalidArgs) {
    const f = fixture();
    await assert.rejects(runCli(values, f.dependencies), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /mps-seller-secret|private-secret/);
      return true;
    });
    assert.equal(f.stdinReads(), 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.output.length, 1);
    assert.doesNotMatch(f.output.join(""), /mps-seller-secret|private-secret/);
    JSON.parse(f.output.join(""));
  }
});

test("MPS connect rejects invalid keys without outputting them or sending a request", async () => {
  for (const key of [
    "",
    "coworker_runtime-secret",
    "soko_preprod_developer-secret",
    "mps secret",
    "mps\nsecret",
    "mps\u0000secret",
    "x".repeat(4097),
    "é".repeat(2049),
  ]) {
    const f = fixture();
    f.dependencies.readStdin = () => key;
    await assert.rejects(
      runCli(args, f.dependencies),
      /stdin must contain one MPS API key/,
    );
    assert.equal(f.requests.length, 0);
    assert.equal(f.output.length, 1);
    if (key) assert.ok(!f.output.join("").includes(key));
  }
});

test("MPS connect requires developer authentication before reading stdin", async () => {
  const f = fixture();
  f.dependencies.env = { SOKOSUMI_AUTH_TOKEN: "" };
  await assert.rejects(runCli(args, f.dependencies), /Authentication required/);
  assert.equal(f.stdinReads(), 0);
  assert.equal(f.requests.length, 0);
});

test("MPS connect redacts failures and does not retry the mutation", async () => {
  for (const mode of ["network", "api", "redirect", "read"]) {
    const f = fixture(async () => {
      if (mode === "network")
        throw new Error(`fetch failed ${apiKey} ${token}`);
      if (mode === "redirect")
        return new Response(null, {
          status: 307,
          headers: { location: `https://other.example/${apiKey}` },
        });
      return Response.json(
        {
          message: `Denied ${apiKey} ${token}`,
          detail: { diagnostic: apiKey },
        },
        { status: 403 },
      );
    });
    if (mode === "read")
      f.dependencies.readStdin = () => {
        throw new Error(apiKey);
      };
    await assert.rejects(runCli(args, f.dependencies), (error: unknown) => {
      assert.ok(error instanceof Error);
      if (mode === "network")
        assert.match(error.message, /change may have succeeded.*mps-status/);
      if (mode === "api") {
        assert.equal("status" in error && error.status, 403);
        assert.doesNotMatch(error.message, /change may have succeeded/);
      }
      assert.doesNotMatch(
        error.message,
        /mps-seller-secret|developer-oauth-secret/,
      );
      assert.doesNotMatch(
        JSON.stringify(error),
        /mps-seller-secret|developer-oauth-secret/,
      );
      return true;
    });
    assert.equal(f.requests.length, mode === "read" ? 0 : 1);
    assert.equal(f.output.length, 1);
    assert.doesNotMatch(
      f.output.join(""),
      /mps-seller-secret|developer-oauth-secret/,
    );
  }
});

test("CLI help includes MPS setup, status, and revoke requirements", async () => {
  const f = fixture();
  await runCli(["--help"], f.dependencies);
  assert.match(
    f.output.join(""),
    /coworkers mps-connect COWORKER_ID .*--mps-api-key-stdin/,
  );
  assert.match(f.output.join(""), /coworkers mps-status COWORKER_ID/);
  assert.match(
    f.output.join(""),
    /coworkers mps-revoke COWORKER_ID --binding-id ID/,
  );
  assert.match(f.output.join(""), /Payments remain disabled/);
  assert.equal(f.stdinReads(), 0);
  assert.equal(f.requests.length, 0);
});
