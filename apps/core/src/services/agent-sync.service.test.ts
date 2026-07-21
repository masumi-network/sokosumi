import { AgentStatus, PaymentType, PricingType } from "@sokosumi/database";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  agentFindManyMock,
  agentUpdateMock,
  agentUpsertMock,
  getAgentsDiffMock,
  openrouterGenerateAgentSummaryMock,
  syncMetadataFindUniqueMock,
  syncMetadataUpsertMock,
  tagUpsertMock,
} = vi.hoisted(() => ({
  agentFindManyMock: vi.fn(),
  agentUpdateMock: vi.fn(),
  agentUpsertMock: vi.fn(),
  getAgentsDiffMock: vi.fn(),
  openrouterGenerateAgentSummaryMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
  syncMetadataUpsertMock: vi.fn(),
  tagUpsertMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    SHOW_AGENTS_BY_DEFAULT: true,
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
      findMany: agentFindManyMock,
      update: agentUpdateMock,
      upsert: agentUpsertMock,
    },
    syncMetadata: {
      findUnique: syncMetadataFindUniqueMock,
      upsert: syncMetadataUpsertMock,
    },
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

describe("agentSyncService.syncRegistryAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncMetadataFindUniqueMock.mockResolvedValue({
      key: "agents-sync-metadata",
      lastSyncedAt: new Date("2026-02-24T00:00:00.000Z"),
      cursorId: null,
    });
    tagUpsertMock.mockResolvedValue(undefined);
    agentUpsertMock.mockResolvedValue(undefined);
    syncMetadataUpsertMock.mockResolvedValue(undefined);
  });

  it("does not update metadata when diff has no entries", async () => {
    const agentSyncService = await getAgentSyncService();
    getAgentsDiffMock.mockResolvedValue(ok([]));

    await agentSyncService.syncRegistryAgents(
      AGENTS_SYNC_METADATA_KEY,
      createSyncExecutionOptions(),
    );

    expect(tagUpsertMock).not.toHaveBeenCalled();
    expect(agentUpsertMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
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
    expect(agentUpsertMock).not.toHaveBeenCalled();
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
    expect(agentUpsertMock).not.toHaveBeenCalled();
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
    expect(agentUpsertMock).not.toHaveBeenCalled();
    expect(syncMetadataUpsertMock).not.toHaveBeenCalled();
  });

  it("upserts agents/tags and persists cursor metadata for valid entries", async () => {
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
    expect(agentUpsertMock).toHaveBeenCalledTimes(3);

    const freeEntryCall = agentUpsertMock.mock.calls[0]?.[0];
    expect(freeEntryCall.create.pricing.create.pricingType).toBe(
      PricingType.FREE,
    );
    expect(freeEntryCall.create.paymentType).toBe(PaymentType.WEB3_CARDANO_V1);
    expect(freeEntryCall.create.status).toBe(AgentStatus.ONLINE);

    const fixedEntryCall = agentUpsertMock.mock.calls[1]?.[0];
    expect(fixedEntryCall.create.pricing.create.pricingType).toBe(
      PricingType.FIXED,
    );
    expect(
      fixedEntryCall.create.pricing.create.fixedPricing.create.amounts
        .createMany.data,
    ).toEqual([{ amount: BigInt(42), unit: "TOKEN" }]);

    const invalidFixedEntryCall = agentUpsertMock.mock.calls[2]?.[0];
    expect(invalidFixedEntryCall.create.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );
    expect(invalidFixedEntryCall.create.paymentType).toBe(PaymentType.UNKNOWN);

    expect(syncMetadataUpsertMock).toHaveBeenCalledWith({
      where: {
        key: "agents-sync-metadata",
      },
      create: {
        key: "agents-sync-metadata",
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

    expect(agentUpsertMock).toHaveBeenCalledTimes(1);
    const emptyFixedCall = agentUpsertMock.mock.calls[0]?.[0];
    expect(emptyFixedCall.create.pricing.create.pricingType).toBe(
      PricingType.UNKNOWN,
    );
    expect(emptyFixedCall.create.pricing.create.fixedPricing).toBeUndefined();
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
