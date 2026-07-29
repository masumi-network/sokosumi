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
  captureExceptionMock,
  captureMessageMock,
  creditCostFindManyMock,
  exampleOutputDeleteManyMock,
  agentFindFirstMock,
  ratingFindManyMock,
  ratingUpdateMock,
  ratingDeleteMock,
  overrideFindUniqueMock,
  overrideUpdateMock,
  executeRawMock,
  agentFindManyMock,
  agentFindUniqueMock,
  agentFixedPricingDeleteMock,
  agentPaymentSourceDeleteManyMock,
  agentPricingFindUniqueMock,
  agentPricingUpdateMock,
  agentUpdateMock,
  getAgentsDiffMock,
  getCardanoV2RailReadinessMock,
  getEnvEnableCardanoV2Mock,
  jobUpdateManyMock,
  openrouterGenerateAgentSummaryMock,
  syncMetadataDeleteManyMock,
  syncMetadataCreateManyMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpsertMock,
  tagUpsertMock,
  transactionMock,
  unitValueDeleteManyMock,
} = vi.hoisted(() => ({
  agentCreateMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
  creditCostFindManyMock: vi.fn(),
  exampleOutputDeleteManyMock: vi.fn(),
  agentFindFirstMock: vi.fn(),
  ratingFindManyMock: vi.fn(),
  ratingUpdateMock: vi.fn(),
  ratingDeleteMock: vi.fn(),
  overrideFindUniqueMock: vi.fn(),
  overrideUpdateMock: vi.fn(),
  executeRawMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  agentFindUniqueMock: vi.fn(),
  agentFixedPricingDeleteMock: vi.fn(),
  agentPaymentSourceDeleteManyMock: vi.fn(),
  agentPricingFindUniqueMock: vi.fn(),
  agentPricingUpdateMock: vi.fn(),
  agentUpdateMock: vi.fn(),
  getAgentsDiffMock: vi.fn(),
  getCardanoV2RailReadinessMock: vi.fn(),
  getEnvEnableCardanoV2Mock: vi.fn().mockReturnValue(true),
  jobUpdateManyMock: vi.fn(),
  openrouterGenerateAgentSummaryMock: vi.fn(),
  syncMetadataDeleteManyMock: vi.fn(),
  syncMetadataCreateManyMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
  syncMetadataUpsertMock: vi.fn(),
  tagUpsertMock: vi.fn(),
  transactionMock: vi.fn(),
  unitValueDeleteManyMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
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

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    getCardanoV2RailReadiness: getCardanoV2RailReadinessMock,
  }),
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
      findFirst: agentFindFirstMock,
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
    creditCost: {
      findMany: creditCostFindManyMock,
    },
    syncMetadata: {
      createMany: syncMetadataCreateManyMock,
      deleteMany: syncMetadataDeleteManyMock,
      findUnique: syncMetadataFindUniqueMock,
      upsert: syncMetadataUpsertMock,
    },
    $transaction: transactionMock,
    $executeRaw: executeRawMock,
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
      findUnique: agentFindUniqueMock,
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
    job: {
      updateMany: jobUpdateManyMock,
    },
    userAgentRating: {
      findMany: ratingFindManyMock,
      update: ratingUpdateMock,
      delete: ratingDeleteMock,
    },
    agentMetadataOverride: {
      findUnique: overrideFindUniqueMock,
      update: overrideUpdateMock,
    },
    $executeRaw: executeRawMock,
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

// Root = real V2 registry policy prefix + 29-byte asset root: version
// detection keys on the policy prefix, not the entry's payment type.
const V2_AGENT_ROOT = `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b${"ab".repeat(29)}`;

function createV2AgentIdentifier(version: number): string {
  return `${V2_AGENT_ROOT}${version.toString(16).padStart(6, "0")}`;
}

describe("agentSyncService.syncRegistryAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvEnableCardanoV2Mock.mockReturnValue(true);
    creditCostFindManyMock.mockResolvedValue([{ unit: "lovelace" }]);
    syncMetadataFindUniqueMock.mockResolvedValue({
      key: "agents-sync-metadata",
      lastSyncedAt: new Date("2026-02-24T00:00:00.000Z"),
      cursorId: null,
    });
    syncMetadataDeleteManyMock.mockResolvedValue({ count: 0 });
    tagUpsertMock.mockResolvedValue(undefined);
    agentFindFirstMock.mockResolvedValue(null);
    // Curated-twin lookup for newly discovered registry entries.
    agentFindManyMock.mockResolvedValue([]);
    ratingFindManyMock.mockResolvedValue([]);
    ratingUpdateMock.mockResolvedValue(undefined);
    ratingDeleteMock.mockResolvedValue(undefined);
    overrideFindUniqueMock.mockResolvedValue(null);
    overrideUpdateMock.mockResolvedValue(undefined);
    executeRawMock.mockResolvedValue(0);
    agentFindUniqueMock.mockResolvedValue(null);
    agentCreateMock.mockResolvedValue(undefined);
    agentUpdateMock.mockResolvedValue(undefined);
    agentPricingFindUniqueMock.mockResolvedValue({ agentFixedPricingId: null });
    agentPricingUpdateMock.mockResolvedValue(undefined);
    unitValueDeleteManyMock.mockResolvedValue({ count: 0 });
    agentFixedPricingDeleteMock.mockResolvedValue(undefined);
    agentPaymentSourceDeleteManyMock.mockResolvedValue({ count: 0 });
    exampleOutputDeleteManyMock.mockResolvedValue({ count: 0 });
    jobUpdateManyMock.mockResolvedValue({ count: 0 });
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

  it("continues to the next batch when the diff returns a full page", async () => {
    const batchOne = Array.from({ length: 50 }, (_, index) =>
      createRegistryEntry(`page1-${index}`),
    );
    const batchTwo = [
      createRegistryEntry("page2-0", {
        statusUpdatedAt: "2026-02-24T13:00:00.000Z",
      }),
    ];
    getAgentsDiffMock
      .mockResolvedValueOnce(ok(batchOne))
      .mockResolvedValueOnce(ok(batchTwo));

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(getAgentsDiffMock).toHaveBeenCalledTimes(2);
    // The second request resumes from the last entry of the first page.
    expect(getAgentsDiffMock).toHaveBeenNthCalledWith(
      2,
      new Date("2026-02-24T12:00:00.000Z"),
      "page1-49",
      50,
      expect.anything(),
    );
    // The cursor advanced after each batch, ending on the short page.
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(2);
    expect(syncMetadataUpsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ cursorId: "page2-0" }),
      }),
    );
    expect(agentCreateMock).toHaveBeenCalledTimes(51);
  });

  it("parks a rollback-created duplicate before the canonical row adopts its identifier", async () => {
    const rollbackDuplicateIdentifier =
      createV2AgentIdentifier(2).toUpperCase();
    const entries = [
      createRegistryEntry("entry-v2-promote", {
        agentIdentifier: createV2AgentIdentifier(2),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [createCardanoV2PaymentSource()],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    // Canonical row resolves via registryIdentity while a rollback-era row
    // already holds the new revision's full identifier.
    agentFindUniqueMock.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where.registryIdentity) {
          return {
            id: "agent-canonical",
            pricingId: "pricing-canonical",
            registryVersion: 1,
            blockchainIdentifier: createV2AgentIdentifier(1),
            metadataVersion: 1,
          };
        }
        return null;
      },
    );
    agentFindFirstMock.mockResolvedValue({
      id: "agent-rollback-dup",
      blockchainIdentifier: rollbackDuplicateIdentifier,
      apiBaseUrl: "https://rollback-agent.example.com",
      metadataOverride: null,
    });

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          blockchainIdentifier: {
            equals: createV2AgentIdentifier(2),
            mode: "insensitive",
          },
        },
      }),
    );
    const parkedIdentifier = `legacy-v2:agent-rollback-dup:${rollbackDuplicateIdentifier}`;
    expect(jobUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        agentId: "agent-rollback-dup",
        agentBlockchainIdentifier: null,
      },
      data: {
        agentBlockchainIdentifier: rollbackDuplicateIdentifier,
      },
    });
    expect(jobUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        agentId: "agent-rollback-dup",
        agentApiBaseUrl: null,
      },
      data: { agentApiBaseUrl: "https://rollback-agent.example.com" },
    });
    expect(jobUpdateManyMock).toHaveBeenNthCalledWith(3, {
      where: { agentId: "agent-rollback-dup" },
      data: { agentId: "agent-canonical" },
    });
    expect(agentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-rollback-dup" },
        data: expect.objectContaining({
          blockchainIdentifier: parkedIdentifier,
          registryIdentity: parkedIdentifier,
          isShown: false,
        }),
      }),
    );
    // The canonical promotion still lands after the duplicate is parked.
    expect(agentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-canonical" },
        data: expect.objectContaining({
          blockchainIdentifier: createV2AgentIdentifier(2),
        }),
      }),
    );
  });

  it("consolidates ratings, categories and the override onto the canonical row", async () => {
    const entries = [
      createRegistryEntry("entry-v2-consolidate", {
        agentIdentifier: createV2AgentIdentifier(2),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [createCardanoV2PaymentSource()],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    agentFindUniqueMock.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where.registryIdentity) {
          return {
            id: "agent-canonical",
            pricingId: "pricing-canonical",
            registryVersion: 1,
            blockchainIdentifier: createV2AgentIdentifier(1),
            metadataVersion: 1,
          };
        }
        if (where.id === "agent-rollback-dup") {
          return {
            categories: [{ id: "cat-1" }, { id: "cat-2" }],
            metadataOverride: { id: "override-dup" },
          };
        }
        return null;
      },
    );
    agentFindFirstMock.mockResolvedValue({
      id: "agent-rollback-dup",
      blockchainIdentifier: createV2AgentIdentifier(2),
      apiBaseUrl: "https://rollback-agent.example.com",
      metadataOverride: null,
    });
    ratingFindManyMock.mockImplementation(
      async ({ where }: { where: { agentId: string } }) =>
        where.agentId === "agent-rollback-dup"
          ? [
              // moves (canonical has none for u2)
              {
                id: "rating-dup-u2",
                userId: "u2",
                updatedAt: new Date("2026-01-02"),
              },
              // newer than canonical's → replaces it
              {
                id: "rating-dup-u1",
                userId: "u1",
                updatedAt: new Date("2026-02-01"),
              },
            ]
          : [
              {
                id: "rating-canon-u1",
                userId: "u1",
                updatedAt: new Date("2026-01-01"),
              },
            ],
    );
    overrideFindUniqueMock.mockResolvedValue(null);

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    // The user's newer duplicate rating wins; the canonical loser is removed.
    expect(ratingDeleteMock).toHaveBeenCalledWith({
      where: { id: "rating-canon-u1" },
    });
    expect(ratingUpdateMock).toHaveBeenCalledWith({
      where: { id: "rating-dup-u1" },
      data: { agentId: "agent-canonical" },
    });
    // The unheld rating simply moves.
    expect(ratingUpdateMock).toHaveBeenCalledWith({
      where: { id: "rating-dup-u2" },
      data: { agentId: "agent-canonical" },
    });
    // Categories follow the stable row.
    expect(agentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-canonical" },
        data: expect.objectContaining({
          categories: { connect: [{ id: "cat-1" }, { id: "cat-2" }] },
        }),
      }),
    );
    // The override moves only because the canonical row has none.
    expect(overrideUpdateMock).toHaveBeenCalledWith({
      where: { id: "override-dup" },
      data: { agentId: "agent-canonical" },
    });
    // Deep links are retargeted OUTSIDE the park transaction.
    expect(executeRawMock).toHaveBeenCalled();
  });

  it("keeps an existing canonical override instead of moving the duplicate's", async () => {
    const entries = [
      createRegistryEntry("entry-v2-override", {
        agentIdentifier: createV2AgentIdentifier(2),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [createCardanoV2PaymentSource()],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    agentFindUniqueMock.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where.registryIdentity) {
          return {
            id: "agent-canonical",
            pricingId: "pricing-canonical",
            registryVersion: 1,
            blockchainIdentifier: createV2AgentIdentifier(1),
            metadataVersion: 1,
          };
        }
        if (where.id === "agent-rollback-dup") {
          return { categories: [], metadataOverride: { id: "override-dup" } };
        }
        return null;
      },
    );
    agentFindFirstMock.mockResolvedValue({
      id: "agent-rollback-dup",
      blockchainIdentifier: createV2AgentIdentifier(2),
      apiBaseUrl: "https://rollback-agent.example.com",
      metadataOverride: null,
    });
    // AgentMetadataOverride.agentId is unique — the slot is taken.
    overrideFindUniqueMock.mockResolvedValue({ id: "override-canonical" });

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(overrideUpdateMock).not.toHaveBeenCalled();
  });

  it("inherits suppression and risk rating from an existing twin under another policy", async () => {
    const entries = [
      createRegistryEntry("entry-v2-twin", {
        agentIdentifier: createV2AgentIdentifier(0),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [createCardanoV2PaymentSource()],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    // Same name + endpoint under the V1 policy, hidden by an admin.
    agentFindManyMock.mockResolvedValue([
      {
        isShown: false,
        riskClassification: "HIGH",
        updatedAt: new Date("2026-05-01"),
        categories: [{ id: "cat-legal" }],
      },
    ]);

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(agentCreateMock).toHaveBeenCalledTimes(1);
    const created = agentCreateMock.mock.calls[0]?.[0];
    // An admin's suppression must not be undone by a V2 re-registration.
    expect(created.data.isShown).toBe(false);
    expect(created.data.riskClassification).toBe("HIGH");
    expect(created.data.categories).toEqual({
      connect: [{ id: "cat-legal" }],
    });
  });

  it("ignores parked duplicates when inheriting curation", async () => {
    const entries = [
      createRegistryEntry("entry-after-park", {
        agentIdentifier: createV2AgentIdentifier(0),
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [createCardanoV2PaymentSource()],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    // A parked row keeps its name/apiBaseUrl but is hidden as bookkeeping —
    // the query must exclude it, so the lookup returns no twin at all.
    agentFindManyMock.mockResolvedValue([]);

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    const where = agentFindManyMock.mock.calls[0]?.[0]?.where;
    // The parked prefix alone identifies bookkeeping rows; filtering on
    // INVALID as well would discard genuinely invalid but curated twins.
    expect(where.status).toBeUndefined();
    expect(where.NOT).toEqual({
      blockchainIdentifier: { startsWith: "legacy-v2:" },
    });
  });

  it("defers a free V2-policy entry while the rollout flag is off", async () => {
    getEnvEnableCardanoV2Mock.mockReturnValue(false);
    getAgentsDiffMock.mockResolvedValue(
      ok([
        createRegistryEntry("entry-free-v2", {
          agentIdentifier: createV2AgentIdentifier(0),
          // Free/EVM-only V2 entries report "None", which used to slip past
          // the rollback fence and onto the marketplace before the flag.
          paymentType: "None",
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
    expect(agentUpdateMock).not.toHaveBeenCalled();
  });

  it("uses defaults when a newly discovered entry has no twin", async () => {
    const entries = [createRegistryEntry("entry-no-twin")];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    agentFindManyMock.mockResolvedValue([]);

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    const created = agentCreateMock.mock.calls[0]?.[0];
    expect(created.data.riskClassification).toBe("MINIMAL");
    expect(created.data.categories).toBeUndefined();
  });

  it("skips a malformed V2 entry whose full-string identity collides with a canonical row", async () => {
    // 114 hex chars: V2 policy prefix but no version suffix, so parsing fails
    // and the FULL string doubles as the (colliding) registryIdentity.
    const malformedIdentifier = V2_AGENT_ROOT;
    const entries = [
      createRegistryEntry("entry-malformed-collision", {
        agentIdentifier: malformedIdentifier,
        paymentType: "Web3CardanoV2",
        AgentPricing: null,
        SupportedPaymentSources: [createCardanoV2PaymentSource()],
      }),
    ];
    getAgentsDiffMock.mockResolvedValue(ok(entries));
    agentFindUniqueMock.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) =>
        where.registryIdentity === malformedIdentifier
          ? {
              id: "agent-canonical",
              pricingId: "pricing-canonical",
              registryVersion: 0,
              blockchainIdentifier: createV2AgentIdentifier(0),
              metadataVersion: 1,
            }
          : null,
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    // The canonical row is never overwritten with malformed data…
    expect(agentCreateMock).not.toHaveBeenCalled();
    expect(agentUpdateMock).not.toHaveBeenCalled();
    // …and the cursor still advances past the skipped entry.
    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("replaces collections and summary when metadataVersion moves without a promotion", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-v1-existing",
      pricingId: "pricing-1",
      registryVersion: 0,
      blockchainIdentifier: "identifier-entry-meta",
      metadataVersion: 1,
    });
    getAgentsDiffMock.mockResolvedValue(
      ok([createRegistryEntry("entry-meta", { metadataVersion: 2 })]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(exampleOutputDeleteManyMock).toHaveBeenCalledWith({
      where: { agentId: "agent-v1-existing" },
    });
    expect(agentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-v1-existing" },
        data: expect.objectContaining({
          summary: null,
          tags: { set: [{ name: "tag-a" }, { name: "tag-b" }] },
        }),
      }),
    );
  });

  it("keeps collections but still sets tags when nothing changed", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-v1-existing",
      pricingId: "pricing-1",
      registryVersion: 0,
      blockchainIdentifier: "identifier-entry-same",
      metadataVersion: 1,
    });
    getAgentsDiffMock.mockResolvedValue(
      ok([createRegistryEntry("entry-same", { metadataVersion: 1 })]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(exampleOutputDeleteManyMock).not.toHaveBeenCalled();
    const updateCall = agentUpdateMock.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // Tags are registry-owned: SET on every update (heals repair-era unions).
    expect(updateCall.data.tags).toEqual({
      set: [{ name: "tag-a" }, { name: "tag-b" }],
    });
    expect(updateCall.data.summary).toBeUndefined();
    expect(updateCall.data.exampleOutput).toBeUndefined();
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
      select: {
        id: true,
        pricingId: true,
        registryVersion: true,
        blockchainIdentifier: true,
        metadataVersion: true,
      },
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

  it("projects pricing only from a source ready for the agent policy", async () => {
    const policyId = V2_AGENT_ROOT.slice(0, 56);
    const wrongPolicyId = "ff".repeat(28);
    syncMetadataFindUniqueMock.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        where.key === "cardano-v2-rail-readiness"
          ? {
              cursorId: JSON.stringify([
                {
                  policyId: wrongPolicyId,
                  smartContractAddress: "addr_test1_shared_contract",
                },
                {
                  policyId,
                  smartContractAddress: "addr_test1_exact_contract",
                },
              ]),
              lastSyncedAt: new Date(),
            }
          : {
              key: "agents-sync-metadata",
              lastSyncedAt: new Date("2026-02-24T00:00:00.000Z"),
              cursorId: null,
            },
    );
    getAgentsDiffMock.mockResolvedValue(
      ok([
        createRegistryEntry("entry-v2-policy-source", {
          agentIdentifier: createV2AgentIdentifier(1),
          paymentType: "Web3CardanoV2",
          AgentPricing: null,
          SupportedPaymentSources: [
            createCardanoV2PaymentSource({
              address: "addr_test1_shared_contract",
              pricing: {
                pricingType: "Fixed",
                fixed: [{ asset: "lovelace", amount: "1000000" }],
              },
            }),
            createCardanoV2PaymentSource({
              sourceIndex: 1,
              address: "addr_test1_exact_contract",
              pricing: {
                pricingType: "Fixed",
                fixed: [{ asset: "lovelace", amount: "2000000" }],
              },
            }),
          ],
        }),
      ]),
    );

    const agentSyncService = await getAgentSyncService();
    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(
      createCall.data.pricing.create.fixedPricing.create.amounts.createMany
        .data,
    ).toEqual([{ unit: "lovelace", amount: BigInt(2_000_000) }]);
  });

  it("canonicalizes uppercase V2 identifiers before persistence", async () => {
    const uppercaseIdentifier = createV2AgentIdentifier(1).toUpperCase();
    getAgentsDiffMock.mockResolvedValue(
      ok([
        createRegistryEntry("entry-v2-uppercase", {
          agentIdentifier: uppercaseIdentifier,
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

    expect(agentFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { registryIdentity: V2_AGENT_ROOT },
      }),
    );
    expect(agentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blockchainIdentifier: createV2AgentIdentifier(1),
          registryIdentity: V2_AGENT_ROOT,
        }),
      }),
    );
  });

  it("promotes a newer V2 revision on the existing stable Agent row", async () => {
    agentFindUniqueMock.mockResolvedValue({
      id: "agent-stable-1",
      pricingId: "pricing-1",
      registryVersion: 1,
      blockchainIdentifier: createV2AgentIdentifier(1),
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
      select: {
        id: true,
        pricingId: true,
        registryVersion: true,
        blockchainIdentifier: true,
        metadataVersion: true,
      },
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
      blockchainIdentifier: "identifier-entry-rollback-v1",
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
      select: {
        id: true,
        pricingId: true,
        registryVersion: true,
        blockchainIdentifier: true,
        metadataVersion: true,
      },
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

  it("keeps one identity for V2-policy entries whose paymentType is None", async () => {
    // Free and EVM-only V2 agents are versioned like paid ones — the registry
    // maps them to paymentType "None", which must not disable stripping.
    const entries = [
      createRegistryEntry("entry-free-v2", {
        agentIdentifier: createV2AgentIdentifier(3),
        paymentType: "None",
        AgentPricing: null,
        apiBaseUrl: "https://free-v2.example.com",
        SupportedPaymentSources: [
          createCardanoV2PaymentSource({
            pricing: { pricingType: "Free" },
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

    expect(agentFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { registryIdentity: V2_AGENT_ROOT },
      }),
    );
    const createCall = agentCreateMock.mock.calls[0]?.[0];
    expect(createCall.data.registryIdentity).toBe(V2_AGENT_ROOT);
    expect(createCall.data.registryVersion).toBe(3);
    expect(createCall.data.pricing.create.pricingType).toBe(PricingType.FREE);
  });

  it("stores a malformed V2 identifier as unavailable", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    // V2 policy prefix with a non-hex version suffix: policy membership is
    // what triggers version parsing now, not the payment type.
    const malformedIdentifier = `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b${"ab".repeat(26)}nothex`;
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

  it("normalizes the registry's empty-string ADA unit in projected V2 pricing", async () => {
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
    ).toEqual([{ unit: "lovelace", amount: BigInt(2000000) }]);
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

describe("agentSyncService.syncCardanoV2RailReadiness", () => {
  it("skips the node round-trip entirely while the rollout flag is off", async () => {
    getEnvEnableCardanoV2Mock.mockReturnValue(false);

    const agentSyncService = await getAgentSyncService();
    await expect(agentSyncService.syncCardanoV2RailReadiness()).resolves.toBe(
      false,
    );

    expect(getCardanoV2RailReadinessMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });

  const readySources = [
    {
      policyId: "ab".repeat(28),
      smartContractAddress: "addr_test1_v2_contract",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    getEnvEnableCardanoV2Mock.mockReturnValue(true);
    syncMetadataCreateManyMock.mockResolvedValue({ count: 1 });
    syncMetadataDeleteManyMock.mockResolvedValue({ count: 0 });
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    syncMetadataUpsertMock.mockResolvedValue(undefined);
  });

  it("caches exact purchase-ready sources under the readiness key", async () => {
    const agentSyncService = await getAgentSyncService();
    getCardanoV2RailReadinessMock.mockResolvedValue(ok(readySources));

    await expect(agentSyncService.syncCardanoV2RailReadiness()).resolves.toBe(
      true,
    );

    expect(syncMetadataUpsertMock).toHaveBeenCalledTimes(1);
    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: { key: "cardano-v2-rail-readiness" },
      create: {
        key: "cardano-v2-rail-readiness",
        cursorId: JSON.stringify(readySources),
        lastSyncedAt: expect.any(Date),
      },
      update: {
        cursorId: JSON.stringify(readySources),
        lastSyncedAt: expect.any(Date),
      },
    });
    expect(syncMetadataDeleteManyMock).toHaveBeenCalledWith({
      where: { key: "cardano-v2-rail-readiness-failure" },
    });
  });

  it("reports no change when a FRESH cache holds the same source set", async () => {
    const agentSyncService = await getAgentSyncService();
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: JSON.stringify(readySources),
      lastSyncedAt: new Date(),
    });
    getCardanoV2RailReadinessMock.mockResolvedValue(ok(readySources));

    await expect(agentSyncService.syncCardanoV2RailReadiness()).resolves.toBe(
      false,
    );
  });

  it("reports a change when a STALE cache returns the same source set", async () => {
    // While the cache was stale, readiness read as [] — so entries synced in
    // that window were priced from the fallback source rather than a
    // purchase-ready one. Recovering must replay them even though the source
    // set is byte-identical.
    const agentSyncService = await getAgentSyncService();
    syncMetadataFindUniqueMock.mockResolvedValue({
      cursorId: JSON.stringify(readySources),
      lastSyncedAt: new Date(Date.now() - 31 * 60 * 1000),
    });
    getCardanoV2RailReadinessMock.mockResolvedValue(ok(readySources));

    await expect(agentSyncService.syncCardanoV2RailReadiness()).resolves.toBe(
      true,
    );
  });

  it("caches an empty list when no source is purchase-ready", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const agentSyncService = await getAgentSyncService();
    getCardanoV2RailReadinessMock.mockResolvedValue(ok([]));

    await agentSyncService.syncCardanoV2RailReadiness();

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "cardano-v2-rail-readiness" },
        update: expect.objectContaining({ cursorId: "[]" }),
      }),
    );

    consoleWarnSpy.mockRestore();
  });

  it("keeps the last cached value when the readiness check fails", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const agentSyncService = await getAgentSyncService();
    getCardanoV2RailReadinessMock.mockResolvedValue(
      err("payment node unavailable"),
    );

    await agentSyncService.syncCardanoV2RailReadiness();

    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
    expect(syncMetadataCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          key: "cardano-v2-rail-readiness-failure",
          cursorId: "failed",
          lastSyncedAt: expect.any(Date),
        },
      ],
      skipDuplicates: true,
    });

    consoleWarnSpy.mockRestore();
  });

  it("does not crash registry sync when the failure marker cannot be stored", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const agentSyncService = await getAgentSyncService();
    getCardanoV2RailReadinessMock.mockResolvedValue(
      err("payment node unavailable"),
    );
    syncMetadataCreateManyMock.mockRejectedValue(new Error("database down"));

    await expect(agentSyncService.syncCardanoV2RailReadiness()).resolves.toBe(
      false,
    );

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[sync/agents] Failed to persist Cardano V2 readiness failure marker:",
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it("forwards the abort signal to the readiness check", async () => {
    const agentSyncService = await getAgentSyncService();
    getCardanoV2RailReadinessMock.mockResolvedValue(ok(readySources));
    const signal = new AbortController().signal;

    await agentSyncService.syncCardanoV2RailReadiness({ signal });

    expect(getCardanoV2RailReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
  });

  it("reports a readiness failure to Sentry once per failure streak", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const agentSyncService = await getAgentSyncService();

    getCardanoV2RailReadinessMock.mockResolvedValue(
      err("payment node unavailable"),
    );
    await agentSyncService.syncCardanoV2RailReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Cardano V2 rail readiness check failed: payment node unavailable",
      }),
    );

    // A different process loses the atomic insert race and also dedupes.
    syncMetadataCreateManyMock.mockResolvedValue({ count: 0 });
    await agentSyncService.syncCardanoV2RailReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
  });

  it("re-arms the Sentry report after a successful check", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const agentSyncService = await getAgentSyncService();

    getCardanoV2RailReadinessMock.mockResolvedValue(
      err("payment node unavailable"),
    );
    await agentSyncService.syncCardanoV2RailReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    getCardanoV2RailReadinessMock.mockResolvedValue(ok(readySources));
    await agentSyncService.syncCardanoV2RailReadiness();
    expect(syncMetadataDeleteManyMock).toHaveBeenCalledWith({
      where: { key: "cardano-v2-rail-readiness-failure" },
    });

    syncMetadataCreateManyMock.mockResolvedValue({ count: 1 });
    getCardanoV2RailReadinessMock.mockResolvedValue(
      err("payment node unavailable"),
    );
    await agentSyncService.syncCardanoV2RailReadiness();
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);

    consoleWarnSpy.mockRestore();
  });

  it("does not report to Sentry when the V2 flag is off", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const agentSyncService = await getAgentSyncService();

    getEnvEnableCardanoV2Mock.mockReturnValue(false);
    getCardanoV2RailReadinessMock.mockResolvedValue(
      err("payment node unavailable"),
    );
    await agentSyncService.syncCardanoV2RailReadiness();

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(syncMetadataFindUniqueMock).not.toHaveBeenCalled();
    expect(syncMetadataCreateManyMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});
