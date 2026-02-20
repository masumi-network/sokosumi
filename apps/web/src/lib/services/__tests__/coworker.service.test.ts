jest.mock("server-only", () => ({}));

const coreClientMock = {
  getCoworkers: jest.fn(),
};

jest.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

describe("coworker.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
