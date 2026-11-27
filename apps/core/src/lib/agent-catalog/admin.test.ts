import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNetworkScope } from "@/lib/db/network-scope";
import { createRate, pruneEmptyMetadataOverride } from "./admin";

const rates = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {},
  networkPrisma: () => ({ $transaction: rates.transaction }),
}));

const findUniqueMock = vi.fn();
const deleteMock = vi.fn();

const tx = {
  agentMetadataOverride: {
    findUnique: findUniqueMock,
    delete: deleteMock,
  },
};

function emptyOverride(overrides: Record<string, unknown> = {}) {
  return {
    id: "override_1",
    name: null,
    description: null,
    apiBaseUrl: null,
    capabilityName: null,
    capabilityVersion: null,
    authorName: null,
    authorImage: null,
    authorContactEmail: null,
    authorContactOther: null,
    authorOrganization: null,
    legalPrivacyPolicy: null,
    legalDpa: null,
    legalTerms: null,
    legalOther: null,
    image: null,
    tags: [],
    exampleOutputs: [],
    ...overrides,
  };
}

describe("pruneEmptyMetadataOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes when all scalars are null and collections are empty", async () => {
    findUniqueMock.mockResolvedValue(emptyOverride());
    deleteMock.mockResolvedValue({ id: "override_1" });

    await expect(
      pruneEmptyMetadataOverride(tx as never, "override_1"),
    ).resolves.toBe(true);

    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "override_1" } });
  });

  it("keeps the row when a scalar is set", async () => {
    findUniqueMock.mockResolvedValue(emptyOverride({ name: "Display" }));

    await expect(
      pruneEmptyMetadataOverride(tx as never, "override_1"),
    ).resolves.toBe(false);

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("prunes when only capability leftovers remain", async () => {
    findUniqueMock.mockResolvedValue(
      emptyOverride({
        capabilityName: "legacy-cap",
        capabilityVersion: "1.0.0",
      }),
    );
    deleteMock.mockResolvedValue({ id: "override_1" });

    await expect(
      pruneEmptyMetadataOverride(tx as never, "override_1"),
    ).resolves.toBe(true);

    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "override_1" } });
  });

  it("keeps the row when tags remain", async () => {
    findUniqueMock.mockResolvedValue(
      emptyOverride({ tags: [{ id: "tag_1" }] }),
    );

    await expect(
      pruneEmptyMetadataOverride(tx as never, "override_1"),
    ).resolves.toBe(false);

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns false when the override is already gone", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      pruneEmptyMetadataOverride(tx as never, "override_1"),
    ).resolves.toBe(false);

    expect(deleteMock).not.toHaveBeenCalled();
  });
});

// The rate create's transaction is the scope's: a deadlock or serialization
// failure (P2034) runs it again, up to 8 times, then 409.
describe("createRate", () => {
  const conflict = () =>
    Object.assign(new Error("Transaction failed"), { code: "P2034" });
  const created = { id: "rate_1", unit: "lovelace", centsPerUnit: 5n };

  beforeEach(() => {
    vi.clearAllMocks();
    rates.findUnique.mockResolvedValue(null);
    rates.create.mockResolvedValue(created);
    rates.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          creditCost: { findUnique: rates.findUnique, create: rates.create },
        }),
    );
  });

  it("retries a conflicting transaction and returns the created rate", async () => {
    rates.transaction.mockRejectedValueOnce(conflict());

    await expect(
      createRate(createNetworkScope("mainnet"), "lovelace", 5n),
    ).resolves.toEqual(created);
    expect(rates.transaction).toHaveBeenCalledTimes(2);
    expect(rates.create).toHaveBeenCalledTimes(1);
  });

  it("answers 409 when every attempt conflicts", async () => {
    rates.transaction.mockRejectedValue(conflict());

    await expect(
      createRate(createNetworkScope("mainnet"), "lovelace", 5n),
    ).rejects.toMatchObject({ status: 409, message: "Credit cost conflict" });
    expect(rates.transaction).toHaveBeenCalledTimes(8);
  }, 15_000);

  it("refuses a unit that has a rate, without retrying", async () => {
    rates.findUnique.mockResolvedValue(created);

    await expect(
      createRate(createNetworkScope("mainnet"), "lovelace", 5n),
    ).rejects.toMatchObject({ status: 409, message: "Unit already exists" });
    expect(rates.transaction).toHaveBeenCalledTimes(1);
    expect(rates.create).not.toHaveBeenCalled();
  });
});
