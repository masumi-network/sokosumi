import { beforeEach, describe, expect, it, vi } from "vitest";

import { pruneEmptyMetadataOverride } from "./admin-agent-override";

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
