import { bech32 } from "@scure/base";
import type { SsrfSafeFetchInit } from "@sokosumi/net";
import LZString from "lz-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: ssrfSafeFetchMock }));

import {
  createMpsSellerClient,
  type SellerQuoteInput,
} from "./masumi-seller.client.js";

const SELLER_KEY = "seller-secret-key";
const CHAIN_KEY = "trusted-chain-secret";
const REGISTRY_KEY = "trusted-registry-secret";
const POLICY = "ab".repeat(28);
const AGENT = `${POLICY}0102`;
const VKEY = "11".repeat(28);

function address(type = 6, network = 0, fill = 0x11): string {
  const bytes = new Uint8Array(type < 4 ? 57 : 29).fill(fill);
  bytes[0] = (type << 4) | network;
  return bech32.encode(
    network === 1 ? "addr" : "addr_test",
    bech32.toWords(bytes),
    false,
  );
}

const WALLET_ADDRESS = address();
const CONTRACT = address(7, 0, 0x22);
const COLLECTION = address(0, 0, 0x33);

// Generated with lz-string 1.5.0 from 100,000 and 2,000,000 repeated "x"
// characters. Their compressed sizes are 446 and 2,502 bytes.
const COMPRESSED_EXPANSION_SAMPLES = [
  "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",
];

function fixtures() {
  const advertised = {
    chain: "Cardano",
    network: "Preprod",
    paymentSourceType: "Web3CardanoV2",
    address: CONTRACT,
    pricing: {
      pricingType: "Fixed",
      fixed: [{ asset: "lovelace", amount: "1000000" }],
    },
  };
  return {
    key: {
      id: "seller-key-id",
      status: "Active",
      canRead: true,
      canPay: true,
      canAdmin: false,
      NetworkLimit: ["Preprod"],
      walletScopeEnabled: true,
      WalletScopes: [{ hotWalletId: "wallet-1" }],
    },
    wallet: {
      id: "wallet-1",
      paymentSourceId: "source-1",
      type: "Selling",
      walletVkey: VKEY,
      walletAddress: WALLET_ADDRESS,
      collectionAddress: COLLECTION,
    },
    source: {
      id: "source-1",
      network: "Preprod",
      paymentSourceType: "Web3CardanoV2",
      policyId: POLICY as string | null,
      smartContractAddress: CONTRACT,
    },
    trustedSource: {
      id: "different-local-id",
      network: "Preprod",
      paymentSourceType: "Web3CardanoV2",
      policyId: POLICY,
      smartContractAddress: CONTRACT,
    },
    registry: {
      agentIdentifier: AGENT,
      paymentType: "Web3CardanoV2",
      status: "Online",
      RegistrySource: { policyId: POLICY },
      sellerWallet: { address: WALLET_ADDRESS, vkey: VKEY },
      AgentPricing: null as unknown,
      SupportedPaymentSources: [
        { ...structuredClone(advertised), sourceIndex: 3 },
      ],
    },
    metadata: {
      agentIdentifier: AGENT,
      policyId: POLICY,
      assetName: "0102",
      Metadata: {
        metadataVersion: 2,
        AgentPricing: null as unknown,
        supportedPaymentSources: [structuredClone(advertised)],
      },
    },
    balance: {
      Balance: [
        { unit: "lovelace", quantity: 5000000 },
        { unit: AGENT, quantity: 1 },
      ],
    },
  };
}

let data = fixtures();
let overrides = new Map<string, unknown>();
let quote: ReturnType<typeof quoteFixture>;

function client(apiUrl = "https://seller.example/api/v1/") {
  return createMpsSellerClient(
    { network: "Preprod", apiUrl, apiKey: SELLER_KEY },
    { apiUrl: "https://chain.example/api/v1", apiKey: CHAIN_KEY },
    { apiUrl: "https://registry.example/api/v1", apiKey: REGISTRY_KEY },
  );
}

const selection = {
  agentIdentifier: AGENT,
  walletId: "wallet-1",
  paymentSourceId: "source-1",
};

function quoteInput(): SellerQuoteInput {
  const now = Date.now();
  return {
    ...selection,
    sellerVkey: VKEY,
    inputHash: "12".repeat(32),
    identifierFromPurchaser: "abcdef0123456789",
    metadata: "core-intent-123",
    sellerReturnAddress: COLLECTION,
    paymentSourceType: "Web3CardanoV2",
    smartContractAddress: CONTRACT,
    supportedPaymentSourceIndex: 3,
    amounts: [{ unit: "lovelace", amount: "1000000" }],
    payByTime: String(now + 60 * 60_000),
    submitResultTime: String(now + 2 * 60 * 60_000),
    unlockTime: String(now + 3 * 60 * 60_000),
    externalDisputeUnlockTime: String(now + 4 * 60 * 60_000),
  };
}

function blockchainIdentifier(
  input: SellerQuoteInput,
  purchaser = input.identifierFromPurchaser,
): string {
  const segments = [
    `${"34".repeat(32)}${input.agentIdentifier}`,
    purchaser,
    "56".repeat(128),
    "78".repeat(42),
  ];
  if (input.paymentSourceType === "Web3CardanoV2")
    segments.push(input.smartContractAddress);
  return Buffer.from(
    LZString.compressToUint8Array(segments.join(".")),
  ).toString("hex");
}

function quoteFixture(input = quoteInput()) {
  return {
    id: "payment-1",
    blockchainIdentifier: blockchainIdentifier(input),
    agentIdentifier: input.agentIdentifier,
    pricingType: "Fixed",
    requestedById: "seller-key-id",
    inputHash: input.inputHash,
    metadata: input.metadata,
    sellerReturnAddress: input.sellerReturnAddress,
    forceLayer: null,
    PaymentSource: { ...data.source },
    SmartContractWallet: {
      id: "wallet-1",
      walletVkey: VKEY,
      walletAddress: WALLET_ADDRESS,
    },
    RequestedFunds: [{ unit: "", amount: "1000000" }],
    payByTime: input.payByTime,
    submitResultTime: input.submitResultTime,
    unlockTime: input.unlockTime,
    externalDisputeUnlockTime: input.externalDisputeUnlockTime,
  };
}

function prepareQuote(): SellerQuoteInput {
  const input = quoteInput();
  quote = quoteFixture(input);
  return input;
}

function serve(rawUrl: string, init: SsrfSafeFetchInit): Promise<Response> {
  const url = new URL(rawUrl);
  const path = `${url.hostname}${url.pathname}`;
  const bodies: Record<string, unknown> = {
    "seller.example/api/v1/api-key-status": data.key,
    "seller.example/api/v1/wallet/list": { Wallets: [data.wallet] },
    "seller.example/api/v1/payment-source": { PaymentSources: [data.source] },
    "chain.example/api/v1/payment-source": {
      PaymentSources: [data.trustedSource],
    },
    "registry.example/api/v1/payment-information/": data.registry,
    "chain.example/api/v1/registry/agent-identifier": data.metadata,
    "chain.example/api/v1/balance": data.balance,
    "seller.example/api/v1/payment":
      init.method === "POST" ? quote : { Payments: [quote] },
  };
  const body = overrides.has(path) ? overrides.get(path) : bodies[path];
  if (body === undefined) throw new Error(`Unexpected request ${path}`);
  const text = JSON.stringify({ status: "success", data: body });
  const bytes = Buffer.byteLength(text);
  if (bytes > init.maxResponseBytes)
    throw new Error("Response exceeded byte limit");
  init.onResponseBytes?.(bytes);
  return Promise.resolve(
    new Response(text, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  data = fixtures();
  quote = quoteFixture();
  overrides = new Map();
  ssrfSafeFetchMock.mockReset();
  ssrfSafeFetchMock.mockImplementation(serve);
});

afterEach(() => vi.useRealTimers());

describe("createMpsSellerClient", () => {
  it("uses the registry's explicit index and confirms exact-address NFT ownership through the trusted node", async () => {
    const result = await client().verifySeller(selection);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual({
      apiUrl: "https://seller.example/api/v1",
      apiKeyId: "seller-key-id",
      network: "Preprod",
      agentIdentifier: AGENT,
      walletId: "wallet-1",
      paymentSourceId: "source-1",
      paymentSourceType: "Web3CardanoV2",
      policyId: POLICY,
      smartContractAddress: CONTRACT,
      sellerVkey: VKEY,
      walletAddress: WALLET_ADDRESS,
      collectionAddress: COLLECTION,
      amounts: [{ unit: "lovelace", amount: "1000000" }],
      supportedPaymentSourceIndex: 3,
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(7);
    for (const [rawUrl, init] of ssrfSafeFetchMock.mock.calls) {
      const url = new URL(rawUrl);
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(init.maxResponseBytes).toBe(512 * 1024);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers.token).toBe(
        url.hostname === "seller.example"
          ? SELLER_KEY
          : url.hostname === "chain.example"
            ? CHAIN_KEY
            : REGISTRY_KEY,
      );
      expect(rawUrl).not.toContain(init.headers.token);
      if (url.pathname.endsWith("/balance"))
        expect(url.searchParams.get("address")).toBe(WALLET_ADDRESS);
    }
    expect(JSON.stringify(result.value)).not.toContain(SELLER_KEY);
  });

  it("supports V1 fixed pricing without fabricating a source index", async () => {
    data.source.paymentSourceType = "Web3CardanoV1";
    data.trustedSource.paymentSourceType = "Web3CardanoV1";
    data.registry.paymentType = "Web3CardanoV1";
    data.registry.SupportedPaymentSources = [];
    data.registry.AgentPricing = {
      pricingType: "Fixed",
      FixedPricing: { Amounts: [{ unit: "", amount: "1000000" }] },
    };
    data.metadata.Metadata.metadataVersion = 1;
    data.metadata.Metadata.AgentPricing = {
      pricingType: "Fixed",
      Pricing: [{ unit: "lovelace", amount: "1000000" }],
    };
    const result = await client().verifySeller(selection);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).not.toHaveProperty("supportedPaymentSourceIndex");
      expect(result.value.amounts).toEqual([
        { unit: "lovelace", amount: "1000000" },
      ]);
    }
  });

  it("accepts a key scoped to several wallets and networks when the selected ones are allowed", async () => {
    data.key.NetworkLimit.push("Mainnet");
    data.key.WalletScopes.push({ hotWalletId: "wallet-2" });
    expect((await client().verifySeller(selection)).isOk()).toBe(true);
  });

  it.each([
    [
      "revoked",
      (fixture: typeof data) => {
        fixture.key.status = "Revoked";
      },
    ],
    [
      "no read",
      (fixture: typeof data) => {
        fixture.key.canRead = false;
      },
    ],
    [
      "no pay",
      (fixture: typeof data) => {
        fixture.key.canPay = false;
      },
    ],
    [
      "admin",
      (fixture: typeof data) => {
        fixture.key.canAdmin = true;
      },
    ],
    [
      "unscoped",
      (fixture: typeof data) => {
        fixture.key.walletScopeEnabled = false;
      },
    ],
    [
      "wrong wallet scope",
      (fixture: typeof data) => {
        fixture.key.WalletScopes = [];
      },
    ],
    [
      "wrong network",
      (fixture: typeof data) => {
        fixture.key.NetworkLimit = ["Mainnet"];
      },
    ],
  ])("rejects %s seller credentials", async (_name, change) => {
    change(data);
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("permission_denied");
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "Purchasing wallet",
      (fixture: typeof data) => {
        fixture.wallet.type = "Purchasing";
      },
    ],
    [
      "wallet source",
      (fixture: typeof data) => {
        fixture.wallet.paymentSourceId = "other";
      },
    ],
    [
      "wallet key hash",
      (fixture: typeof data) => {
        fixture.wallet.walletVkey = "22".repeat(28);
      },
    ],
    [
      "invalid checksum",
      (fixture: typeof data) => {
        fixture.wallet.walletAddress = `${WALLET_ADDRESS.slice(0, -1)}q`;
      },
    ],
    [
      "wallet network",
      (fixture: typeof data) => {
        fixture.wallet.walletAddress = address(6, 1);
      },
    ],
    [
      "script payout",
      (fixture: typeof data) => {
        fixture.wallet.collectionAddress = CONTRACT;
      },
    ],
    [
      "payout network",
      (fixture: typeof data) => {
        fixture.wallet.collectionAddress = address(0, 1);
      },
    ],
    [
      "source network",
      (fixture: typeof data) => {
        fixture.source.network = "Mainnet";
      },
    ],
    [
      "V1 source policy",
      (fixture: typeof data) => {
        fixture.source.paymentSourceType = "Web3CardanoV1";
        fixture.source.policyId = "22".repeat(28);
      },
    ],
    [
      "untrusted contract",
      (fixture: typeof data) => {
        fixture.source.smartContractAddress = address(7, 0, 0x44);
      },
    ],
    [
      "registry wallet",
      (fixture: typeof data) => {
        fixture.registry.sellerWallet.address = COLLECTION;
      },
    ],
    [
      "registry key",
      (fixture: typeof data) => {
        fixture.registry.sellerWallet.vkey = "22".repeat(28);
      },
    ],
    [
      "registry revision",
      (fixture: typeof data) => {
        fixture.registry.agentIdentifier = `${POLICY}0304`;
      },
    ],
    [
      "deregistered agent",
      (fixture: typeof data) => {
        fixture.registry.status = "Deregistered";
      },
    ],
    [
      "live agent",
      (fixture: typeof data) => {
        fixture.metadata.agentIdentifier = `${POLICY}0304`;
      },
    ],
    [
      "live asset name",
      (fixture: typeof data) => {
        fixture.metadata.assetName = "0304";
      },
    ],
    [
      "missing NFT",
      (fixture: typeof data) => {
        fixture.balance.Balance = [];
      },
    ],
    [
      "wrong NFT quantity",
      (fixture: typeof data) => {
        fixture.balance.Balance[1].quantity = 2;
      },
    ],
  ])("rejects mismatched %s", async (_name, change) => {
    change(data);
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("identity_mismatch");
  });

  it.each([
    [
      "changed live price",
      (fixture: typeof data) => {
        fixture.metadata.Metadata.supportedPaymentSources[0].pricing.fixed[0].amount =
          "2000000";
      },
    ],
    [
      "zero price",
      (fixture: typeof data) => {
        fixture.registry.SupportedPaymentSources[0].pricing.fixed[0].amount =
          "0";
      },
    ],
    [
      "dynamic price",
      (fixture: typeof data) => {
        fixture.registry.SupportedPaymentSources[0].pricing.pricingType =
          "Dynamic";
      },
    ],
    [
      "wrong source address",
      (fixture: typeof data) => {
        fixture.registry.SupportedPaymentSources[0].address = COLLECTION;
      },
    ],
    [
      "missing live source",
      (fixture: typeof data) => {
        fixture.metadata.Metadata.supportedPaymentSources = [];
      },
    ],
  ])("rejects %s", async (_name, change) => {
    change(data);
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("unsupported_pricing");
  });

  it("rejects duplicate explicit source indexes", async () => {
    data.registry.SupportedPaymentSources.push(
      structuredClone(data.registry.SupportedPaymentSources[0]),
    );
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("invalid_response");
  });

  it.each([
    "http://seller.example/api",
    "https://user:password@seller.example",
    "https://seller.example/?token=x",
    "https://seller.example/#x",
    "https://seller.example/?",
    "not-a-url",
  ])("rejects unsafe base URL %s before a request", async (url) => {
    const result = await client(url).verifySeller(selection);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("invalid_configuration");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 302, 500])(
    "returns static errors for HTTP %s without exposing any response",
    async (status) => {
      ssrfSafeFetchMock.mockResolvedValueOnce(
        new Response(`${SELLER_KEY} ${CHAIN_KEY} ${REGISTRY_KEY}`, {
          status,
          headers: { location: "https://attacker.example" },
        }),
      );
      const result = await client().verifySeller(selection);
      expect(result.isErr()).toBe(true);
      expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
      for (const secret of [SELLER_KEY, CHAIN_KEY, REGISTRY_KEY])
        expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.each([{}, { id: SELLER_KEY }, null])(
    "rejects malformed successful key responses",
    async (body) => {
      overrides.set("seller.example/api/v1/api-key-status", body);
      const result = await client().verifySeller(selection);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe("invalid_response");
    },
  );

  it("rejects malformed JSON without returning its content", async () => {
    ssrfSafeFetchMock.mockResolvedValueOnce(
      new Response(`${SELLER_KEY}{`, {
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SELLER_KEY);
  });

  it("never returns a credential echoed in a snapshot field", async () => {
    data.key.id = SELLER_KEY;
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SELLER_KEY);
  });

  it("returns static errors when the SSRF guard rejects the destination", async () => {
    ssrfSafeFetchMock.mockRejectedValueOnce(
      new Error(`Blocked private address with token ${SELLER_KEY}`),
    );
    const result = await client("https://127.0.0.1/api").verifySeller(
      selection,
    );
    expect(result.isErr()).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SELLER_KEY);
    if (result.isErr())
      expect(result.error.code).toBe("verification_unavailable");
  });

  it("caps the full verification deadline and aborts outstanding requests", async () => {
    vi.useFakeTimers();
    ssrfSafeFetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const pending = client().verifySeller(selection);
    await vi.advanceTimersByTimeAsync(15000);
    const result = await pending;
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("timeout");
    expect(ssrfSafeFetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("bounds inclusive pagination and rejects a stalled cursor", async () => {
    overrides.set("seller.example/api/v1/wallet/list", {
      Wallets: Array.from({ length: 100 }, (_, index) => ({
        ...data.wallet,
        id: `other-${index}`,
      })),
    });
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error.code).toBe("verification_unavailable");
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(3);
    expect(
      new URL(ssrfSafeFetchMock.mock.calls[2][0]).searchParams.get("cursorId"),
    ).toBe("other-99");
  });

  it("finds a wallet on a later inclusive page", async () => {
    ssrfSafeFetchMock.mockImplementation(
      (rawUrl: string, init: SsrfSafeFetchInit) => {
        const url = new URL(rawUrl);
        if (
          url.pathname.endsWith("/wallet/list") &&
          !url.searchParams.has("cursorId")
        ) {
          return Promise.resolve(
            Response.json({
              status: "success",
              data: {
                Wallets: Array.from({ length: 100 }, (_, index) => ({
                  ...data.wallet,
                  id: `other-${index}`,
                })),
              },
            }),
          );
        }
        return serve(rawUrl, init);
      },
    );
    expect((await client().verifySeller(selection)).isOk()).toBe(true);
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(8);
  });

  it("limits total buffered bytes across requests", async () => {
    ssrfSafeFetchMock.mockImplementation(
      (rawUrl: string, init: SsrfSafeFetchInit) => {
        init.onResponseBytes?.(512 * 1024);
        return serve(rawUrl, init);
      },
    );
    const result = await client().verifySeller(selection);
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error.code).toBe("verification_unavailable");
    expect(ssrfSafeFetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe("seller quotes", () => {
  it("creates a V1 quote without a source index or fifth identifier segment", async () => {
    data.source.paymentSourceType = "Web3CardanoV1";
    data.trustedSource.paymentSourceType = "Web3CardanoV1";
    data.registry.paymentType = "Web3CardanoV1";
    data.registry.AgentPricing = {
      pricingType: "Fixed",
      FixedPricing: { Amounts: [{ unit: "", amount: "1000000" }] },
    };
    data.metadata.Metadata.metadataVersion = 1;
    data.metadata.Metadata.AgentPricing = {
      pricingType: "Fixed",
      Pricing: [{ unit: "lovelace", amount: "1000000" }],
    };
    const input = {
      ...quoteInput(),
      paymentSourceType: "Web3CardanoV1" as const,
      supportedPaymentSourceIndex: undefined,
    };
    quote = quoteFixture(input);
    const result = await client().createQuote(input);
    expect(result.isOk()).toBe(true);
    if (result.isOk())
      expect(result.value).not.toHaveProperty("supportedPaymentSourceIndex");
    const post = ssrfSafeFetchMock.mock.calls.find(
      ([, init]) => init.method === "POST",
    );
    expect(JSON.parse(post?.[1].body)).not.toHaveProperty(
      "supportedPaymentSourceIndex",
    );
  });

  it.each([null, "cd".repeat(28)])(
    "supports a V2 settlement source with policy %s while preserving the registration policy",
    async (policyId) => {
      data.source.policyId = policyId;
      const input = prepareQuote();
      const verification = await client().verifySeller(selection);
      expect(verification.isOk()).toBe(true);
      if (verification.isOk()) expect(verification.value.policyId).toBe(POLICY);
      expect((await client().createQuote(input)).isOk()).toBe(true);
      quote.PaymentSource.smartContractAddress = address(7, 0, 0x44);
      const recovery = await client().recoverQuote(input);
      expect(recovery.isErr()).toBe(true);
      if (recovery.isErr()) expect(recovery.error.kind).toBe("ambiguous");
    },
  );

  it("posts one fixed-price quote with explicit deadlines and returns only validated terms", async () => {
    const input = prepareQuote();
    const result = await client().createQuote(input);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      paymentId: quote.id,
      blockchainIdentifier: quote.blockchainIdentifier,
      agentIdentifier: AGENT,
      sellerVkey: VKEY,
      inputHash: input.inputHash,
      identifierFromPurchaser: input.identifierFromPurchaser,
      Amounts: input.amounts,
      payByTime: input.payByTime,
      submitResultTime: input.submitResultTime,
      unlockTime: input.unlockTime,
      externalDisputeUnlockTime: input.externalDisputeUnlockTime,
      paymentSourceType: input.paymentSourceType,
      smartContractAddress: CONTRACT,
      sellerReturnAddress: COLLECTION,
      supportedPaymentSourceIndex: 3,
    });
    const posts = ssrfSafeFetchMock.mock.calls.filter(
      ([, init]) => init.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe("https://seller.example/api/v1/payment");
    expect(posts[0][1].redirect).toBe("error");
    expect(JSON.parse(posts[0][1].body)).toEqual({
      network: "Preprod",
      agentIdentifier: AGENT,
      inputHash: input.inputHash,
      identifierFromPurchaser: input.identifierFromPurchaser,
      metadata: input.metadata,
      paymentSourceType: "Web3CardanoV2",
      supportedPaymentSourceIndex: 3,
      sellerReturnAddress: COLLECTION,
      payByTime: new Date(Number(input.payByTime)).toISOString(),
      submitResultTime: new Date(Number(input.submitResultTime)).toISOString(),
      unlockTime: new Date(Number(input.unlockTime)).toISOString(),
      externalDisputeUnlockTime: new Date(
        Number(input.externalDisputeUnlockTime),
      ).toISOString(),
    });
    expect(JSON.stringify(result.value)).not.toContain(SELLER_KEY);
    expect(result.value).not.toHaveProperty("metadata");
  });

  it.each([
    [
      "seller key",
      (input: SellerQuoteInput) => {
        input.sellerVkey = "22".repeat(28);
      },
    ],
    [
      "price",
      (input: SellerQuoteInput) => {
        input.amounts[0].amount = "2000000";
      },
    ],
    [
      "payout",
      (input: SellerQuoteInput) => {
        input.sellerReturnAddress = WALLET_ADDRESS;
      },
    ],
    [
      "index",
      (input: SellerQuoteInput) => {
        input.supportedPaymentSourceIndex = 0;
      },
    ],
    [
      "contract",
      (input: SellerQuoteInput) => {
        input.smartContractAddress = address(7, 0, 0x44);
      },
    ],
    [
      "expired deadline",
      (input: SellerQuoteInput) => {
        input.payByTime = String(Date.now() - 1);
      },
    ],
    [
      "deadline order",
      (input: SellerQuoteInput) => {
        input.unlockTime = input.submitResultTime;
      },
    ],
    [
      "input hash",
      (input: SellerQuoteInput) => {
        input.inputHash = "bad";
      },
    ],
  ])("rejects changed %s before POST", async (_name, mutate) => {
    const input = prepareQuote();
    mutate(input);
    const result = await client().createQuote(input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe("rejected");
    expect(
      ssrfSafeFetchMock.mock.calls.filter(([, init]) => init.method === "POST"),
    ).toHaveLength(0);
  });

  it.each([
    [
      "agent",
      () => {
        quote.agentIdentifier = `${POLICY}0304`;
      },
    ],
    [
      "input hash",
      () => {
        quote.inputHash = "33".repeat(32);
      },
    ],
    [
      "intent",
      () => {
        quote.metadata = "other-intent";
      },
    ],
    [
      "key",
      () => {
        quote.requestedById = "other-key";
      },
    ],
    [
      "wallet",
      () => {
        quote.SmartContractWallet.id = "other-wallet";
      },
    ],
    [
      "seller hash",
      () => {
        quote.SmartContractWallet.walletVkey = "33".repeat(28);
      },
    ],
    [
      "source",
      () => {
        quote.PaymentSource.id = "other-source";
      },
    ],
    [
      "network",
      () => {
        quote.PaymentSource.network = "Mainnet";
      },
    ],
    [
      "contract",
      () => {
        quote.PaymentSource.smartContractAddress = address(7, 0, 0x44);
      },
    ],
    [
      "payout",
      () => {
        quote.sellerReturnAddress = WALLET_ADDRESS;
      },
    ],
    [
      "price",
      () => {
        quote.RequestedFunds[0].amount = "2000000";
      },
    ],
    [
      "deadline",
      () => {
        quote.unlockTime = String(Number(quote.unlockTime) + 1);
      },
    ],
    [
      "purchaser",
      () => {
        quote.blockchainIdentifier = blockchainIdentifier(
          quoteInput(),
          "11".repeat(8),
        );
      },
    ],
    [
      "identifier",
      () => {
        quote.blockchainIdentifier = "0000";
      },
    ],
    [
      "echoed credential",
      () => {
        quote.id = SELLER_KEY;
      },
    ],
  ])(
    "keeps a mismatched %s response ambiguous without another POST",
    async (_name, mutate) => {
      const input = prepareQuote();
      mutate();
      const result = await client().createQuote(input);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
      expect(
        ssrfSafeFetchMock.mock.calls.filter(
          ([, init]) => init.method === "POST",
        ),
      ).toHaveLength(1);
    },
  );

  it("fails closed on a compressed expansion bomb and oversized identities", async () => {
    const input = prepareQuote();
    const decode = vi.spyOn(LZString, "decompressFromUint8Array");
    try {
      for (const [index, sample] of COMPRESSED_EXPANSION_SAMPLES.entries()) {
        decode.mockClear();
        const compressed = Buffer.from(sample, "base64");
        expect(compressed).toHaveLength(index === 0 ? 446 : 2502);
        quote.blockchainIdentifier = compressed.toString("hex");
        const result = await client().recoverQuote(input);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
        if (index === 0) {
          expect(decode).toHaveBeenCalledTimes(1);
          expect(decode.mock.results[0]?.value).toHaveLength(100_000);
        } else {
          expect(decode).not.toHaveBeenCalled();
        }
      }
    } finally {
      decode.mockRestore();
    }
    expect(
      ssrfSafeFetchMock.mock.calls.every(([, init]) => init.method === "GET"),
    ).toBe(true);
  });

  it.each([302, 408, 409, 429, 500])(
    "keeps HTTP %s ambiguous and never retries creation",
    async (status) => {
      const input = prepareQuote();
      ssrfSafeFetchMock.mockImplementation(
        (url: string, init: SsrfSafeFetchInit) =>
          init.method === "POST"
            ? Promise.resolve(new Response(SELLER_KEY, { status }))
            : serve(url, init),
      );
      const result = await client().createQuote(input);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
      expect(JSON.stringify(result)).not.toContain(SELLER_KEY);
      expect(
        ssrfSafeFetchMock.mock.calls.filter(
          ([, init]) => init.method === "POST",
        ),
      ).toHaveLength(1);
    },
  );

  it("reports a lost POST response as ambiguous and recovers the exact quote with GET only", async () => {
    const input = prepareQuote();
    ssrfSafeFetchMock.mockImplementation(
      (url: string, init: SsrfSafeFetchInit) =>
        init.method === "POST"
          ? Promise.reject(new Error(SELLER_KEY))
          : serve(url, init),
    );
    const creation = await client().createQuote(input);
    expect(creation.isErr()).toBe(true);
    if (creation.isErr()) expect(creation.error.kind).toBe("ambiguous");
    ssrfSafeFetchMock.mockClear();
    const recovery = await client().recoverQuote(input);
    expect(recovery.isOk()).toBe(true);
    if (recovery.isOk()) expect(recovery.value.paymentId).toBe(quote.id);
    expect(
      ssrfSafeFetchMock.mock.calls.every(([, init]) => init.method === "GET"),
    ).toBe(true);
    const url = new URL(ssrfSafeFetchMock.mock.calls.at(-1)?.[0]);
    expect(url.searchParams.get("searchQuery")).toBe(input.inputHash);
    expect(url.searchParams.get("filterAgentIdentifier")).toBe(AGENT);
    expect(url.searchParams.get("filterPaymentSourceType")).toBe(
      "Web3CardanoV2",
    );
    expect(url.searchParams.get("filterSmartContractAddress")).toBe(CONTRACT);
  });

  it("reports an exhausted empty scan without granting permission to recreate", async () => {
    const input = prepareQuote();
    overrides.set("seller.example/api/v1/payment", { Payments: [] });
    const result = await client().recoverQuote(input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toContain("must not be retried");
    }
  });

  it("rejects two matching intent quotes", async () => {
    const input = prepareQuote();
    overrides.set("seller.example/api/v1/payment", {
      Payments: [quote, { ...quote, id: "payment-2" }],
    });
    const result = await client().recoverQuote(input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
  });

  it("finishes pagination before accepting a match and skips the inclusive cursor row", async () => {
    const input = prepareQuote();
    const first = Array.from({ length: 99 }, (_, index) => ({
      id: `unrelated-${index}`,
      metadata: "other",
      inputHash: input.inputHash,
    }));
    let pages = 0;
    ssrfSafeFetchMock.mockImplementation(
      (url: string, init: SsrfSafeFetchInit) => {
        if (new URL(url).pathname.endsWith("/payment")) {
          pages++;
          overrides.set("seller.example/api/v1/payment", {
            Payments: pages === 1 ? [...first, quote] : [quote],
          });
        }
        return serve(url, init);
      },
    );
    const result = await client().recoverQuote(input);
    expect(result.isOk()).toBe(true);
    expect(pages).toBe(2);
  });

  it("keeps a stalled scan ambiguous even if one matching quote was found", async () => {
    const input = prepareQuote();
    const rows = Array.from({ length: 99 }, (_, index) => ({
      id: `unrelated-${index}`,
      metadata: "other",
      inputHash: input.inputHash,
    }));
    overrides.set("seller.example/api/v1/payment", {
      Payments: [...rows, quote],
    });
    const result = await client().recoverQuote(input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(9);
  });

  it("stops a progressing scan at ten full pages and keeps its outcome unknown", async () => {
    const input = prepareQuote();
    let pages = 0;
    ssrfSafeFetchMock.mockImplementation(
      (url: string, init: SsrfSafeFetchInit) => {
        if (new URL(url).pathname.endsWith("/payment")) {
          pages++;
          overrides.set("seller.example/api/v1/payment", {
            Payments: Array.from({ length: 100 }, (_, index) => ({
              id: `other-${pages}-${index}`,
              metadata: "other",
              inputHash: input.inputHash,
            })),
          });
        }
        return serve(url, init);
      },
    );
    const result = await client().recoverQuote(input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
    expect(pages).toBe(10);
  });

  it("reports an explicit bad request rejection without exposing its body", async () => {
    const input = prepareQuote();
    ssrfSafeFetchMock.mockImplementation(
      (url: string, init: SsrfSafeFetchInit) =>
        init.method === "POST"
          ? Promise.resolve(new Response(SELLER_KEY, { status: 400 }))
          : serve(url, init),
    );
    const result = await client().createQuote(input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe("rejected");
    expect(JSON.stringify(result)).not.toContain(SELLER_KEY);
  });

  it("aborts a stalled POST and returns an ambiguous outcome", async () => {
    vi.useFakeTimers();
    const input = prepareQuote();
    ssrfSafeFetchMock.mockImplementation(
      (url: string, init: SsrfSafeFetchInit) =>
        init.method === "POST" ? new Promise(() => {}) : serve(url, init),
    );
    const resultPromise = client().createQuote(input);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await resultPromise;
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe("ambiguous");
    const posts = ssrfSafeFetchMock.mock.calls.filter(
      ([, init]) => init.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(posts[0][1].signal.aborted).toBe(true);
  });
});
