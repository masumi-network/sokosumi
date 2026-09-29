import { beforeEach, describe, expect, it, vi } from "vitest";

import { organizationRepository } from "./organization.repository.js";

const findUniqueMock = vi.fn();
const tx = {
  organization: {
    findUnique: findUniqueMock,
  },
} as never;

describe("organizationRepository.getOrganizationLimitedInfoBySlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
    });
  });

  it("looks up a single organization by slug with limited fields", async () => {
    const result =
      await organizationRepository.getOrganizationLimitedInfoBySlug("acme", tx);

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { slug: "acme" },
      select: { id: true, name: true, slug: true },
    });
    expect(result).toEqual({ id: "org_1", name: "Acme", slug: "acme" });
  });
});
