import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const coreClientMock = {
  getCoworkers: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

describe("coworker.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns coworkers from core client response data", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({
      data: [
        {
          id: "cow-1",
          slug: "hannah",
          name: "Hannah",
        },
      ],
    });

    const { coworkerService } = await import("../coworker.service");
    const result = await coworkerService.listCoworkers();

    expect(coreClientMock.getCoworkers).toHaveBeenCalledTimes(1);
    expect(coreClientMock.getCoworkers).toHaveBeenCalledWith({
      scope: "whitelisted",
    });
    expect(result).toEqual([
      {
        id: "cow-1",
        slug: "hannah",
        name: "Hannah",
      },
    ]);
  });

  it("returns empty list when core client data is missing", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({ data: null });

    const { coworkerService } = await import("../coworker.service");
    const result = await coworkerService.listCoworkers();

    expect(result).toEqual([]);
  });

  it("excludes UI-restricted coworkers", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({
      data: [
        {
          id: "cow-1",
          slug: "hannah",
          name: "Hannah",
        },
        {
          id: "cow-2",
          slug: "Hermes",
          name: "Hermes",
        },
      ],
    });

    const { coworkerService } = await import("../coworker.service");
    const result = await coworkerService.listCoworkers();

    expect(result).toEqual([
      {
        id: "cow-1",
        slug: "hannah",
        name: "Hannah",
      },
    ]);
  });

  it("forwards the capability filter when provided", async () => {
    coreClientMock.getCoworkers.mockResolvedValue({
      data: [],
    });

    const { coworkerService } = await import("../coworker.service");
    await coworkerService.listCoworkers("tasks");

    expect(coreClientMock.getCoworkers).toHaveBeenCalledWith({
      scope: "whitelisted",
      capability: ["tasks"],
    });
  });

  it("returns an empty list when listCoworkersForUi cannot reach Core", async () => {
    coreClientMock.getCoworkers.mockRejectedValue(
      new Error("An unexpected error occurred"),
    );

    const { coworkerService } = await import("../coworker.service");
    const result = await coworkerService.listCoworkersForUi("tasks");

    expect(result).toEqual([]);
  });
});
