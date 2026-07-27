import {
  AgentEntryType,
  AgentStatus,
  PaymentType,
  PricingType,
} from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  agentCreateMock,
  exampleOutputDeleteManyMock,
  agentFindManyMock,
  agentFindUniqueMock,
  agentFixedPricingDeleteMock,
  agentPaymentSourceDeleteManyMock,
  agentPricingFindUniqueMock,
  agentPricingUpdateMock,
  agentUpdateMock,
  getAgentsDiffMock,
  getEnvEnableCardanoV2Mock,
  openrouterGenerateAgentSummaryMock,
  syncMetadataDeleteManyMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpsertMock,
  tagUpsertMock,
  transactionMock,
  unitValueDeleteManyMock,
} = vi.hoisted(() => ({
  agentCreateMock: vi.fn(),
  exampleOutputDeleteManyMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  agentFindUniqueMock: vi.fn(),
  agentFixedPricingDeleteMock: vi.fn(),
  agentPaymentSourceDeleteManyMock: vi.fn(),
  agentPricingFindUniqueMock: vi.fn(),
  agentPricingUpdateMock: vi.fn(),
  agentUpdateMock: vi.fn(),
  getAgentsDiffMock: vi.fn(),
  getEnvEnableCardanoV2Mock: vi.fn().mockReturnValue(true),
  openrouterGenerateAgentSummaryMock: vi.fn(),
  syncMetadataDeleteManyMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
  syncMetadataUpsertMock: vi.fn(),
  tagUpsertMock: vi.fn(),
  transactionMock: vi.fn(),
  unitValueDeleteManyMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    NETWORK: "Preprod",
    SHOW_AGENTS_BY_DEFAULT: true,
    // Ingestion tests exercise the flag-on behavior; the flag-off rollback
    // fence has its own dedicated tests.
    ENABLE_CARDANO_V2_AGENTS: getEnvEnableCardanoV2Mock(),
  }),
}));

vi.mock("@/clients/masumi-registry.client", () => ({
  registryClient: {
    getAgentsDiff: getAgentsDiffMock,
  },
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateAgentSummary: openrouterGenerateAgentSummaryMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    tag: {
      upsert: tagUpsertMock,
    },
    agent: {
      create: agentCreateMock,
      findMany: agentFindManyMock,
      findUnique: agentFindUniqueMock,
      update: agentUpdateMock,
    },
    agentPricing: {
      findUnique: agentPricingFindUniqueMock,
      update: agentPricingUpdateMock,
    },
    agentFixedPricing: {
      delete: agentFixedPricingDeleteMock,
    },
    unitValue: {
      deleteMany: unitValueDeleteManyMock,
    },
    agentPaymentSource: {
      deleteMany: agentPaymentSourceDeleteManyMock,
    },
    exampleOutput: {
      deleteMany: exampleOutputDeleteManyMock,
    },
    syncMetadata: {
      deleteMany: syncMetadataDeleteManyMock,
      findUnique: syncMetadataFindUniqueMock,
      upsert: syncMetadataUpsertMock,
    },
    $transaction: transactionMock,
  },
}));

async function getAgentSyncService() {
  const module = await import("./agent-sync.service");
  return module.agentSyncService;
}

const AGENTS_SYNC_METADATA_KEY = "agents-sync-metadata";

interface SyncExecutionOptions {
  abortSignal: AbortSignal;
  shouldContinue: () => boolean;
}

function createSyncExecutionOptions(
  overrides: Partial<SyncExecutionOptions> = {},
): SyncExecutionOptions {
  return {
    abortSignal: new AbortController().signal,
    shouldContinue: () => true,
    ...overrides,
  };
}

function createTransactionClientMock() {
  return {
    agent: {
      update: agentUpdateMock,
    },
    agentPricing: {
      findUnique: agentPricingFindUniqueMock,
      update: agentPricingUpdateMock,
    },
    agentFixedPricing: {
      delete: agentFixedPricingDeleteMock,
    },
    unitValue: {
      deleteMany: unitValueDeleteManyMock,
    },
    agentPaymentSource: {
      deleteMany: agentPaymentSourceDeleteManyMock,
    },
    exampleOutput: {
      deleteMany: exampleOutputDeleteManyMock,
    },
  };
}

function createRegistryEntry(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    statusUpdatedAt: "2026-02-24T12:00:00.000Z",
    agentIdentifier: `identifier-${id}`,
    name: `Agent ${id}`,
    description: "Base description",
    apiBaseUrl: "https://example.com",
    type: "Standard",
    openApiSpecUrl: null,
    x402ResourcesUrl: null,
    supersededByAgentIdentifier: null,
    metadataVersion: 1,
    lastUptimeCheck: "2026-02-24T10:00:00.000Z",
    uptimeCount: 10,
    uptimeCheckCount: 12,
    Capability: {
      name: "Capability",
      version: "1.0.0",
    },
    authorName: "Author",
    authorContactEmail: "author@example.com",
    authorContactOther: "",
    image: "",
    tags: ["tag-a", "tag-b"],
    authorOrganization: "",
    status: "Online",
    otherLegal: "",
    termsAndCondition: "",
    privacyPolicy: "",
    paymentType: "Web3CardanoV1",
    AgentPricing: {
      pricingType: "Free",
    },
    SupportedPaymentSources: [],
    ExampleOutput: [
      {
        mimeType: "text/plain",
        name: "Example",
        url: "https://example.com/output.txt",
      },
    ],
    ...overrides,
  };
}

function createCardanoV2PaymentSource(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceIndex: 0,
    chain: "Cardano",
    network: "Preprod",
    paymentSourceType: "Web3CardanoV2",
    address: "addr_test1_contract",
    payTo: "addr_test1_seller",
    scheme: null,
    resource: null,
    pricing: {
      pricingType: "Fixed",
      fixed: [{ asset: "lovelace", amount: "1000000", decimals: 6 }],
    },
    ...overrides,
  };
}

const V2_AGENT_ROOT = "ab".repeat(57);

function createV2AgentIdentifier(version: number): string {
  return `${V2_AGENT_ROOT}${version.toString(16).padStart(6, "0")}`;
}

describe("agentSyncService.syncRegistryAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvEnableCardanoV2Mock.mockReturnValue(true);
    syncMetadataFindUniqueMock.mockResolvedValue({
      key: "agents-sync-metadata",
      lastSyncedAt: new Date("2026-02-24T00:00:00.000Z"),
      cursorId: null,
    });
    syncMetadataDeleteManyMock.mockResolvedValue({ count: 0 });
    tagUpsertMock.mockResolvedValue(undefined);
    agentFindUniqueMock.mockResolvedValue(null);
    agentCreateMock.mockResolvedValue(undefined);
    agentUpdateMock.mockResolvedValue(undefined);
    agentPricingFindUniqueMock.mockResolvedValue({ agentFixedPricingId: null });
    agentPricingUpdateMock.mockResolvedValue(undefined);
    unitValueDeleteManyMock.mockResolvedValue({ count: 0 });
    agentFixedPricingDeleteMock.mockResolvedValue(undefined);
    agentPaymentSourceDeleteManyMock.mockResolvedValue({ count: 0 });
    exampleOutputDeleteManyMock.mockResolvedValue({ count: 0 });
    syncMetadataUpsertMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(createTransactionClientMock()),
    );
  });

  it("does not update metadata when diff has no entries", async () => {
    const agentSyncService = await getAgentSyncService();
    getAgentsDiffMock.mockResolvedValue(ok([]));

    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(syncMetadataDeleteManyMock).not.toHaveBeenCalled();
    expect(tagUpsertMock).not.toHaveBeenCalled();
    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });

  it("starts a full replay from the independent V2 cursor when enabled", async () => {
    const agentSyncService = await getAgentSyncService();
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    getAgentsDiffMock.mockResolvedValue(ok([]));

    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(syncMetadataFindUniqueMock).toHaveBeenCalledWith({
      where: { key: "agents-sync-metadata-cardano-v2" },
    });
    expect(getAgentsDiffMock).toHaveBeenCalledWith(
      new Date(0),
      null,
      50,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("stops registry sync immediately when shouldContinue returns false", async () => {
    const agentSyncService = await getAgentSyncService();
    const shouldContinue = vi.fn().mockReturnValue(false);

    await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
      abortSignal: new AbortController().signal,
      shouldContinue,
    });

    expect(syncMetadataFindUniqueMock).not.toHaveBeenCalled();
    expect(getAgentsDiffMock).not.toHaveBeenCalled();
    expect(tagUpsertMock).not.toHaveBeenCalled();
    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });

  it("passes abort signal to registry diff request", async () => {
    const agentSyncService = await getAgentSyncService();
    const abortController = new AbortController();
    getAgentsDiffMock.mockResolvedValue(ok([]));

    await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
      abortSignal: abortController.signal,
      shouldContinue: () => true,
    });

    expect(getAgentsDiffMock).toHaveBeenCalledWith(expect.any(Date), null, 50, {
      signal: abortController.signal,
    });
  });

  it("does not write data when registry diff fails", async () => {
    const agentSyncService = await getAgentSyncService();
    getAgentsDiffMock.mockResolvedValue(err("registry unavailable"));

    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(tagUpsertMock).not.toHaveBeenCalled();
    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });

  it("stops downstream writes when cancellation is requested mid-run", async () => {
    const agentSyncService = await getAgentSyncService();
    const entries = [
      createRegistryEntry("entry-stop", {
        tags: ["tag-stop"],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    let continueChecks = 0;
    const shouldContinue = vi.fn(() => {
      continueChecks += 1;
      return continueChecks < 3;
    });

    await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
      abortSignal: new AbortController().signal,
      shouldContinue,
    });

    expect(tagUpsertMock).not.toHaveBeenCalled();
    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });

  it("clears the cursor before reading it when resetCursor is set", async () => {
    const agentSyncService = await getAgentSyncService();
    getAgentsDiffMock.mockResolvedValue(ok([]));

    await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
      ...createSyncExecutionOptions(),
      resetCursor: true,
    });

    expect(syncMetadataDeleteManyMock).toHaveBeenCalledWith({
      where: { key: "agents-sync-metadata-cardano-v2" },
    });
    expect(syncMetadataDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      syncMetadataFindUniqueMock.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("creates agents/tags for every entry and persists cursor metadata", async () => {
    const agentSyncService = await getAgentSyncService();
    const lastStatusUpdatedAt = "2026-02-24T16:00:00.000Z";
    const entries = [
      createRegistryEntry("entry-1", {
        AgentPricing: {
          pricingType: "Free",
        },
      }),
      createRegistryEntry("entry-2", {
        AgentPricing: {
          pricingType: "Fixed",
          FixedPricing: {
            Amounts: [{ amount: "42", unit: "TOKEN" }],
          },
        },
      }),
      createRegistryEntry("entry-3", {
        statusUpdatedAt: lastStatusUpdatedAt,
        paymentType: "Unexpected",
        AgentPricing: {
          pricingType: "Fixed",
          FixedPricing: {
            Amounts: [{ amount: "-1", unit: "TOKEN" }],
          },
        },
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(tagUpsertMock).toHaveBeenCalled();
    expect(agentFindUniqueMock).toHaveBeenCalledWith({
      where: { registryIdentity: "identifier-entry-1" },
      select: { id: true, pricingId: true, registryVersion: true },
    });
    expect(agentCreateMock).toHaveBeenCalledTimes(3);

    const freeEntryCall = agentCreateMock.mock.calls[0]?.[0];
    expect(freeEntryCall.data.blockchainIdentifier).toBe("identifier-entry-1");
    expect(freeEntryCall.data.registryIdentity).toBe("identifier-entry-1");
    expect(freeEntryCall.data.registryVersion).toBe(0);
    expect(freeEntryCall.data.pricing.create.pricingType).toBe(
      PricingType.FREE,
    );
    expect(freeEntryCall.data.paymentType).toBe(PaymentType.WEB3_CARDANO_V1);
    expect(freeEntryCall.data.status).toBe(AgentStatus.ONLINE);
    expect(freeEntryCall.data.type).toBe(AgentEntryType.STANDARD);
    expect(freeEntryCall.data.metadataVersion).toBe(1);
    expect(freeEntryCall.data.supersededByAgentIdentifier).toBeNull();
    expect(freeEntryCall.data.isShown).toBe(true);
    expect(freeEntryCall.data.tags).toEqual({
      connect: [{ name: "tag-a" }, { name: "tag-b" }],
    });
    expect(freeEntryCall.data.paymentSources).toEqual({ create: [] });
    expect(freeEntryCall.data.exampleOutput).toEqual({
      createMany: {
        data: [
          {
            mimeType: "text/plain",
            name: "Example",
            url: "https://example.com/output.txt",
          },
        ],
      },
    });

    const fixedEntryCall = agentCreateMock.mock.calls[1]?.[0];
    expect(fixedEntryCall.data.pricing.create.pricingType).toBe(
      PricingType.FIXED,
    );
    expect(
      fixedEntryCall.data.pricing.create.fixedPricing.create.amounts.createMany
        .data,
    ).toEqual([{ amount: BigInt(42), unit: "TOKEN" }]);

    // entry-3 has an unexpected payment type: it is still ingested (nothing is
    // skipped anymore), stored as UNKNOWN payment type and UNKNOWN pricing.
    const unknownEntryCall = agentCreateMock.mock.calls[2]?.[0];
    expect(unknownEntryCall.data.blockchainIdentifier).toBe(
      "identifier-entry-3",
    );
    expect(unknownEntryCall.data.paymentType).toBe(PaymentType.UNKNOWN);
    expect(unknownEntryCall.data.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: {
        key: "agents-sync-metadata-cardano-v2",
      },
      create: {
        key: "agents-sync-metadata-cardano-v2",
        cursorId: "entry-3",
        lastSyncedAt: new Date(lastStatusUpdatedAt),
      },
      update: {
        cursorId: "entry-3",
        lastSyncedAt: new Date(lastStatusUpdatedAt),
      },
    });
  });

  it("maps fixed pricing with empty amounts to UNKNOWN", async () => {
    const entries = [
      createRegistryEntry("entry-empty-fixed", {
        AgentPricing: {
          pricingType: "Fixed",
          FixedPricing: {
            Amounts: [],
          },
        },
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const emptyFixedCall = agentCreateMock.mock.calls[0]?.[0];
    expect(emptyFixedCall.data.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );
    expect(emptyFixedCall.data.pricing.create.fixedPricing).toBeUndefined();
  });

  it("ingests V2 entries with pricing projected from the matching Cardano V2 source", async () => {
    const entries = [
      createRegistryEntry("entry-v2", {
        agentIdentifier: createV2AgentIdentifier(1),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        statusUpdatedAt: "2026-02-24T13:00:00.000Z",
        SupportedPaymentSources: [
          createCardanoV2PaymentSource({
            pricing: {
              pricingType: "Fixed",
              fixed: [
                { asset: "lovelace", amount: "1000000", decimals: 6 },
                { asset: "policyid.usdm", amount: "5" },
              ],
            },
          }),
        ],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.registryIdentity).toBe(V2_AGENT_ROOT);
    expect(createCall.data.registryVersion).toBe(1);
    expect(createCall.data.paymentType).toBe(PaymentType.WEB3_CARDANO_V2);
    expect(createCall.data.pricing.create.pricingType).toBe(PricingType.FIXED);
    expect(
      createCall.data.pricing.create.fixedPricing.create.amounts.createMany
        .data,
    ).toEqual([
      { unit: "lovelace", amount: BigInt(1000000) },
      { unit: "policyid.usdm", amount: BigInt(5) },
    ]);
    expect(createCall.data.paymentSources).toEqual({
      create: [
        {
          sourceIndex: 0,
          chain: "Cardano",
          network: "Preprod",
          paymentSourceType: "Web3CardanoV2",
          address: "addr_test1_contract",
          payTo: "addr_test1_seller",
          scheme: null,
          resource: null,
          pricingType: PricingType.FIXED,
          amounts: {
            createMany: {
              data: [
                { unit: "lovelace", amount: BigInt(1000000), decimals: 6 },
                { unit: "policyid.usdm", amount: BigInt(5), decimals: null },
              ],
            },
          },
        },
      ],
    });
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          cursorId: "entry-v2",
          lastSyncedAt: new Date("2026-02-24T13:00:00.000Z"),
        },
      }),
    );
  });

  it("promotes a newer V2 revision on the existing stable Agent row", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-stable-1",
      pricingId: "pricing-1",
      registryVersion: 1,
    });
    const newerIdentifier = createV2AgentIdentifier(2);
    getAgentsDiffMock.mockResolvedValue(
      ok([
        createRegistryEntry("entry-v2-newer", {
          agentIdentifier: newerIdentifier,
          paymentType: "Web3CardanoV2",
          AgentPricing: null,
          SupportedPaymentSources: [createCardanoV2PaymentSource()],
        }),
      ]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(agentFindUniqueMock).toHaveBeenCalledWith({
      where: { registryIdentity: V2_AGENT_ROOT },
      select: { id: true, pricingId: true, registryVersion: true },
    });
    expect(agentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-stable-1" },
        data: expect.objectContaining({
          blockchainIdentifier: newerIdentifier,
          registryIdentity: V2_AGENT_ROOT,
          registryVersion: 2,
          summary: null,
          tags: {
            set: [{ name: "tag-a" }, { name: "tag-b" }],
          },
          exampleOutput: {
            createMany: {
              data: [
                {
                  mimeType: "text/plain",
                  name: "Example",
                  url: "https://example.com/output.txt",
                },
              ],
            },
          },
        }),
      }),
    );
    expect(exampleOutputDeleteManyMock).toHaveBeenCalledWith({
      where: { agentId: "agent-stable-1" },
    });
  });

  it("adopts a rollback-created V1 row whose registry identity is null", async () => {
    agentFindUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "agent-legacy-rollback",
      pricingId: "pricing-1",
      registryVersion: 0,
    });
    getAgentsDiffMock.mockResolvedValue(
      ok([createRegistryEntry("entry-rollback-v1")]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentFindUniqueMock).toHaveBeenNthCalledWith(2, {
      where: { blockchainIdentifier: "identifier-entry-rollback-v1" },
      select: { id: true, pricingId: true, registryVersion: true },
    });
    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(agentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-legacy-rollback" },
        data: expect.objectContaining({
          registryIdentity: "identifier-entry-rollback-v1",
        }),
      }),
    );
  });

  it("does not let an older V2 revision overwrite the stable Agent row", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-stable-1",
      pricingId: "pricing-1",
      registryVersion: 2,
    });
    getAgentsDiffMock.mockResolvedValue(
      ok([
        createRegistryEntry("entry-v2-older", {
          agentIdentifier: createV2AgentIdentifier(1),
          paymentType: "Web3CardanoV2",
          AgentPricing: null,
          SupportedPaymentSources: [createCardanoV2PaymentSource()],
        }),
      ]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(agentUpdateMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("stores unknown registry status and entry type as unavailable", async () => {
    getAgentsDiffMock.mockResolvedValue(
      ok([
        createRegistryEntry("entry-future-enums", {
          status: "FutureStatus",
          type: "FutureType",
        }),
      ]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.status).toBe(AgentStatus.INVALID);
    expect(createCall.data.type).toBe(AgentEntryType.UNKNOWN);
  });

  it("stores a malformed V2 identifier as unavailable", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const malformedIdentifier = "not-a-versioned-v2-identifier";
    getAgentsDiffMock.mockResolvedValue(
      ok([
        createRegistryEntry("entry-malformed-v2", {
          agentIdentifier: malformedIdentifier,
          paymentType: "Web3CardanoV2",
          AgentPricing: null,
          SupportedPaymentSources: [createCardanoV2PaymentSource()],
        }),
      ]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.registryIdentity).toBe(malformedIdentifier);
    expect(createCall.data.registryVersion).toBe(0);
    expect(createCall.data.status).toBe(AgentStatus.INVALID);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid V2 version suffix"),
    );

    consoleWarnSpy.mockRestore();
  });

  it("stores V2 entries without a matching-network source with UNKNOWN pricing", async () => {
    const entries = [
      createRegistryEntry("entry-v2-mainnet", {
        agentIdentifier: createV2AgentIdentifier(1),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [
          createCardanoV2PaymentSource({ network: "Mainnet" }),
        ],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.paymentType).toBe(PaymentType.WEB3_CARDANO_V2);
    expect(createCall.data.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );
    expect(createCall.data.pricing.create.fixedPricing).toBeUndefined();
    // The mismatched source is still mirrored for later reconciliation.
    expect(createCall.data.paymentSources.create).toHaveLength(1);
    expect(createCall.data.paymentSources.create[0]).toMatchObject({
      network: "Mainnet",
      pricingType: PricingType.FIXED,
    });
  });

  it("ingests X402 pointer entries with a null apiBaseUrl and EVM payment sources", async () => {
    const entries = [
      createRegistryEntry("entry-x402", {
        type: "X402",
        apiBaseUrl: null,
        paymentType: "None",
        AgentPricing: null,
        x402ResourcesUrl: "https://example.com/x402-resources",
        SupportedPaymentSources: [
          {
            sourceIndex: 0,
            chain: "Base",
            network: "eip155:8453",
            paymentSourceType: null,
            address: "0x1111111111111111111111111111111111111111",
            payTo: "0x2222222222222222222222222222222222222222",
            scheme: "exact",
            resource: "https://example.com/resource",
            pricing: {
              pricingType: "Fixed",
              fixed: [
                {
                  asset: "0x3333333333333333333333333333333333333333",
                  amount: "250000",
                  decimals: 6,
                },
              ],
            },
          },
        ],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.type).toBe(AgentEntryType.X402);
    expect(createCall.data.apiBaseUrl).toBeNull();
    expect(createCall.data.x402ResourcesUrl).toBe(
      "https://example.com/x402-resources",
    );
    expect(createCall.data.paymentType).toBe(PaymentType.NONE);
    expect(createCall.data.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );
    expect(createCall.data.paymentSources).toEqual({
      create: [
        {
          sourceIndex: 0,
          chain: "Base",
          network: "eip155:8453",
          paymentSourceType: null,
          address: "0x1111111111111111111111111111111111111111",
          payTo: "0x2222222222222222222222222222222222222222",
          scheme: "exact",
          resource: "https://example.com/resource",
          pricingType: PricingType.FIXED,
          amounts: {
            createMany: {
              data: [
                {
                  unit: "0x3333333333333333333333333333333333333333",
                  amount: BigInt(250000),
                  decimals: 6,
                },
              ],
            },
          },
        },
      ],
    });
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("ingests entries without an apiBaseUrl storing a null apiBaseUrl", async () => {
    const entries = [
      createRegistryEntry("entry-no-url", {
        apiBaseUrl: null,
      }),
      createRegistryEntry("entry-valid", {
        statusUpdatedAt: "2026-02-24T14:00:00.000Z",
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(2);
    const noUrlCall = agentCreateMock.mock.calls[0]?.[0];
    expect(noUrlCall.data.blockchainIdentifier).toBe("identifier-entry-no-url");
    expect(noUrlCall.data.apiBaseUrl).toBeNull();
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          cursorId: "entry-valid",
          lastSyncedAt: new Date("2026-02-24T14:00:00.000Z"),
        },
      }),
    );
  });

  it("stores entries with null AgentPricing as UNKNOWN pricing without warning", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const entries = [
      createRegistryEntry("entry-null-pricing", {
        AgentPricing: null,
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );
    expect(createCall.data.paymentType).toBe(PaymentType.WEB3_CARDANO_V1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
    // Null pricing is legitimate for V2/pointer entries — no warning.
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it("stores fixed-pricing entries with non-numeric amounts as UNKNOWN pricing", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const entries = [
      createRegistryEntry("entry-bad-amount", {
        AgentPricing: {
          pricingType: "Fixed",
          FixedPricing: {
            Amounts: [{ amount: "abc", unit: "TOKEN" }],
          },
        },
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );
    expect(createCall.data.pricing.create.fixedPricing).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
  });

  it("replaces pricing and payment sources in a transaction when the agent already exists", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-db-1",
      pricingId: "pricing-1",
      registryVersion: 0,
    });
    agentPricingFindUniqueMock.mockResolvedValue({
      agentFixedPricingId: "fixed-pricing-old",
    });
    const entries = [
      createRegistryEntry("entry-existing", {
        name: "Renamed Agent",
        type: "OpenApi",
        openApiSpecUrl: "https://example.com/spec.yaml",
        AgentPricing: {
          pricingType: "Fixed",
          FixedPricing: {
            Amounts: [{ amount: "42", unit: "TOKEN" }],
          },
        },
        SupportedPaymentSources: [
          {
            sourceIndex: 0,
            chain: "Cardano",
            network: "Preprod",
            paymentSourceType: "Web3CardanoV1",
            address: "addr_test1_v1_contract",
            payTo: null,
            scheme: null,
            resource: null,
            pricing: { pricingType: "Free" },
          },
        ],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalledTimes(1);

    // Pricing is replaced in place: old fixed pricing rows are removed and the
    // new fixed pricing is attached to the same AgentPricing row.
    expect(agentPricingFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "pricing-1" },
      select: {
        pricingType: true,
        agentFixedPricingId: true,
        fixedPricing: {
          select: { amounts: { select: { unit: true, amount: true } } },
        },
      },
    });
    expect(agentPricingUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: "pricing-1" },
      data: {
        pricingType: PricingType.FIXED,
        fixedPricing: { disconnect: true },
      },
    });
    expect(unitValueDeleteManyMock).toHaveBeenCalledWith({
      where: { agentFixedPricingId: "fixed-pricing-old" },
    });
    expect(agentFixedPricingDeleteMock).toHaveBeenCalledWith({
      where: { id: "fixed-pricing-old" },
    });
    expect(agentPricingUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: "pricing-1" },
      data: {
        fixedPricing: {
          create: {
            amounts: {
              createMany: {
                data: [{ amount: BigInt(42), unit: "TOKEN" }],
              },
            },
          },
        },
      },
    });

    // Payment sources are fully replaced.
    expect(agentPaymentSourceDeleteManyMock).toHaveBeenCalledWith({
      where: { agentId: "agent-db-1" },
    });

    // Registry-derived fields are refreshed on the existing row.
    expect(agentUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = agentUpdateMock.mock.calls[0]?.[0];
    expect(updateCall.where).toEqual({ id: "agent-db-1" });
    expect(updateCall.data.name).toBe("Renamed Agent");
    expect(updateCall.data.type).toBe(AgentEntryType.OPEN_API);
    expect(updateCall.data.openApiSpecUrl).toBe(
      "https://example.com/spec.yaml",
    );
    expect(updateCall.data.paymentType).toBe(PaymentType.WEB3_CARDANO_V1);
    expect(updateCall.data.status).toBe(AgentStatus.ONLINE);
    expect(updateCall.data.paymentSources).toEqual({
      create: [
        {
          sourceIndex: 0,
          chain: "Cardano",
          network: "Preprod",
          paymentSourceType: "Web3CardanoV1",
          address: "addr_test1_v1_contract",
          payTo: null,
          scheme: null,
          resource: null,
          pricingType: PricingType.FREE,
        },
      ],
    });
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("does not recreate fixed pricing rows when the existing pricing was not fixed", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-db-1",
      pricingId: "pricing-1",
      registryVersion: 0,
    });
    agentPricingFindUniqueMock.mockResolvedValue({
      agentFixedPricingId: null,
    });
    const entries = [
      createRegistryEntry("entry-existing-free", {
        AgentPricing: { pricingType: "Free" },
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentPricingUpdateMock).toHaveBeenCalledTimes(1);
    expect(agentPricingUpdateMock).toHaveBeenCalledWith({
      where: { id: "pricing-1" },
      data: { pricingType: PricingType.FREE },
    });
    expect(unitValueDeleteManyMock).not.toHaveBeenCalled();
    expect(agentFixedPricingDeleteMock).not.toHaveBeenCalled();
    expect(agentUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("skips the pricing replacement entirely when the pricing is unchanged", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-db-1",
      pricingId: "pricing-1",
      registryVersion: 0,
    });
    agentPricingFindUniqueMock.mockResolvedValue({
      pricingType: PricingType.FREE,
      agentFixedPricingId: null,
      fixedPricing: null,
    });
    const entries = [
      createRegistryEntry("entry-unchanged", {
        AgentPricing: { pricingType: "Free" },
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentPricingUpdateMock).not.toHaveBeenCalled();
    expect(unitValueDeleteManyMock).not.toHaveBeenCalled();
    expect(agentFixedPricingDeleteMock).not.toHaveBeenCalled();
    // The rest of the refresh still runs.
    expect(agentUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("removes old fixed pricing rows without recreating them on a FIXED to FREE transition", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-db-1",
      pricingId: "pricing-1",
      registryVersion: 0,
    });
    agentPricingFindUniqueMock.mockResolvedValue({
      agentFixedPricingId: "fixed-pricing-old",
    });
    const entries = [
      createRegistryEntry("entry-now-free", {
        AgentPricing: { pricingType: "Free" },
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentPricingUpdateMock).toHaveBeenCalledTimes(1);
    expect(agentPricingUpdateMock).toHaveBeenCalledWith({
      where: { id: "pricing-1" },
      data: {
        pricingType: PricingType.FREE,
        fixedPricing: { disconnect: true },
      },
    });
    expect(unitValueDeleteManyMock).toHaveBeenCalledWith({
      where: { agentFixedPricingId: "fixed-pricing-old" },
    });
    expect(agentFixedPricingDeleteMock).toHaveBeenCalledWith({
      where: { id: "fixed-pricing-old" },
    });
  });

  it("keeps the registry's empty-string ADA unit verbatim in projected V2 pricing", async () => {
    const entries = [
      createRegistryEntry("entry-v2-ada", {
        agentIdentifier: createV2AgentIdentifier(1),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [
          createCardanoV2PaymentSource({
            pricing: {
              pricingType: "Fixed",
              fixed: [{ asset: "", amount: "2000000" }],
            },
          }),
        ],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.pricing.create.pricingType).toBe(PricingType.FIXED);
    expect(
      createCall.data.pricing.create.fixedPricing.create.amounts.createMany
        .data,
    ).toEqual([{ unit: "", amount: BigInt(2000000) }]);
  });

  it("defers rollback-unsafe entries while the rollout flag is off but advances the cursor", async () => {
    getEnvEnableCardanoV2Mock.mockReturnValue(false);
    const entries = [
      createRegistryEntry("entry-v2-deferred", {
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [createCardanoV2PaymentSource()],
        statusUpdatedAt: "2026-02-24T13:00:00.000Z",
      }),
      createRegistryEntry("entry-x402-deferred", {
        type: "X402",
        apiBaseUrl: null,
        x402ResourcesUrl: "https://example.com/x402.json",
        paymentType: "None",
        statusUpdatedAt: "2026-02-24T14:00:00.000Z",
      }),
      createRegistryEntry("entry-v1-kept", {
        statusUpdatedAt: "2026-02-24T15:00:00.000Z",
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    // Only the V1 entry is written; the deferred entries advance the V1
    // cursor. Flag-on sync uses a separate empty cursor and replays them.
    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.blockchainIdentifier).toBe(
      "identifier-entry-v1-kept",
    );
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          key: "agents-sync-metadata",
        },
        update: {
          cursorId: "entry-v1-kept",
          lastSyncedAt: new Date("2026-02-24T15:00:00.000Z"),
        },
      }),
    );
  });

  it("keeps only the first payment source when the registry serves duplicate source indexes", async () => {
    const entries = [
      createRegistryEntry("entry-dup-source", {
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        agentIdentifier: createV2AgentIdentifier(1),
        SupportedPaymentSources: [
          createCardanoV2PaymentSource(),
          createCardanoV2PaymentSource({
            address: "addr_test1_other_contract",
          }),
        ],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.paymentSources.create).toHaveLength(1);
    expect(createCall.data.paymentSources.create[0].address).toBe(
      "addr_test1_contract",
    );
  });

  it("stops the batch without advancing the cursor when the first create fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const entries = [
      createRegistryEntry("entry-1"),
      createRegistryEntry("entry-2"),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    agentCreateMock.mockRejectedValueOnce(new Error("db down"));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.blockchainIdentifier).toBe("identifier-entry-1");
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("advances the cursor only past the last successful entry when a later create fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const entries = [
      createRegistryEntry("entry-1", {
        statusUpdatedAt: "2026-02-24T15:00:00.000Z",
      }),
      createRegistryEntry("entry-2", {
        statusUpdatedAt: "2026-02-24T16:00:00.000Z",
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    agentCreateMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("db down"));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(2);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: {
        key: "agents-sync-metadata-cardano-v2",
      },
      create: {
        key: "agents-sync-metadata-cardano-v2",
        cursorId: "entry-1",
        lastSyncedAt: new Date("2026-02-24T15:00:00.000Z"),
      },
      update: {
        cursorId: "entry-1",
        lastSyncedAt: new Date("2026-02-24T15:00:00.000Z"),
      },
    });

    consoleErrorSpy.mockRestore();
  });
});

describe("agentSyncService.syncAgentSummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentUpdateMock.mockResolvedValue(undefined);
  });

  it("loads online visible agents without summary and stores generated summaries", async () => {
    const agentSyncService = await getAgentSyncService();
    const options = createSyncExecutionOptions();
    agentFindManyMock.mockResolvedValue([
      {
        id: "agent-1",
        description: "Base description",
        metadataOverride: null,
      },
      {
        id: "agent-2",
        description: "Old description",
        metadataOverride: { description: "Override description" },
      },
      {
        id: "agent-3",
        description: null,
        metadataOverride: null,
      },
    ]);
    openrouterGenerateAgentSummaryMock
      .mockResolvedValueOnce("Summary one")
      .mockResolvedValueOnce(null);

    await agentSyncService.syncAgentSummaries(options);

    expect(agentFindManyMock).toHaveBeenCalledWith({
      where: {
        status: AgentStatus.ONLINE,
        isShown: true,
        summary: null,
        OR: [
          { description: { not: null } },
          { metadataOverride: { description: { not: null } } },
        ],
      },
      include: {
        metadataOverride: true,
      },
      take: 20,
    });

    expect(openrouterGenerateAgentSummaryMock).toHaveBeenNthCalledWith(
      1,
      "Base description",
      {
        abortSignal: options.abortSignal,
      },
    );
    expect(openrouterGenerateAgentSummaryMock).toHaveBeenNthCalledWith(
      2,
      "Override description",
      {
        abortSignal: options.abortSignal,
      },
    );
    expect(agentUpdateMock).toHaveBeenCalledTimes(1);
    expect(agentUpdateMock).toHaveBeenCalledWith({
      where: {
        id: "agent-1",
      },
      data: {
        summary: "Summary one",
      },
    });
  });

  it("passes abort signal to summary generation", async () => {
    const agentSyncService = await getAgentSyncService();
    const abortController = new AbortController();
    agentFindManyMock.mockResolvedValue([
      {
        id: "agent-1",
        description: "Base description",
        metadataOverride: null,
      },
    ]);
    openrouterGenerateAgentSummaryMock.mockResolvedValue(null);

    await agentSyncService.syncAgentSummaries({
      abortSignal: abortController.signal,
      shouldContinue: () => true,
    });

    expect(openrouterGenerateAgentSummaryMock).toHaveBeenCalledWith(
      "Base description",
      {
        abortSignal: abortController.signal,
      },
    );
  });

  it("skips summary write when cancellation is requested before persistence", async () => {
    const agentSyncService = await getAgentSyncService();
    agentFindManyMock.mockResolvedValue([
      {
        id: "agent-1",
        description: "Base description",
        metadataOverride: null,
      },
    ]);
    openrouterGenerateAgentSummaryMock.mockResolvedValue("Summary one");

    let continueChecks = 0;
    const shouldContinue = vi.fn(() => {
      continueChecks += 1;
      return continueChecks < 3;
    });

    await agentSyncService.syncAgentSummaries({
      abortSignal: new AbortController().signal,
      shouldContinue,
    });

    expect(openrouterGenerateAgentSummaryMock).toHaveBeenCalledTimes(1);
    expect(agentUpdateMock).not.toHaveBeenCalled();
  });

  it("stops summary sync immediately when shouldContinue returns false", async () => {
    const agentSyncService = await getAgentSyncService();
    const shouldContinue = vi.fn().mockReturnValue(false);

    await agentSyncService.syncAgentSummaries({
      abortSignal: new AbortController().signal,
      shouldContinue,
    });

    expect(agentFindManyMock).not.toHaveBeenCalled();
    expect(openrouterGenerateAgentSummaryMock).not.toHaveBeenCalled();
    expect(agentUpdateMock).not.toHaveBeenCalled();
  });

  it("continues summary processing when one generation fails", async () => {
    const agentSyncService = await getAgentSyncService();
    const options = createSyncExecutionOptions();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    agentFindManyMock.mockResolvedValue([
      {
        id: "agent-1",
        description: "Description one",
        metadataOverride: null,
      },
      {
        id: "agent-2",
        description: "Description two",
        metadataOverride: null,
      },
    ]);
    openrouterGenerateAgentSummaryMock
      .mockRejectedValueOnce(new Error("OpenRouter down"))
      .mockResolvedValueOnce("Summary two");

    await agentSyncService.syncAgentSummaries(options);

    expect(agentUpdateMock).toHaveBeenCalledTimes(1);
    expect(agentUpdateMock).toHaveBeenCalledWith({
      where: { id: "agent-2" },
      data: { summary: "Summary two" },
    });

    consoleErrorSpy.mockRestore();
  });
});
