jest.mock("server-only", () => ({}));

const getSessionMock = jest.fn();

jest.mock("flags/next", () => ({
  flag: ({
    decide,
  }: {
    key: string;
    decide: () => boolean | Promise<boolean>;
  }) => decide,
}));

jest.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

describe("taskRailEnabled", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns false when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const { taskRailEnabled } = await import("../task-rail");

    await expect(taskRailEnabled()).resolves.toBe(false);
  });

  it("returns true for nmkr.io emails", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "member@nmkr.io" },
    });

    const { taskRailEnabled } = await import("../task-rail");

    await expect(taskRailEnabled()).resolves.toBe(true);
  });

  it("returns true for allowlisted emails regardless of case", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "S.KUEPERS@HOUSE-OF-COMMUNICATION.COM" },
    });

    const { taskRailEnabled } = await import("../task-rail");

    await expect(taskRailEnabled()).resolves.toBe(true);
  });

  it("returns false for non-allowlisted external emails", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "someone@example.com" },
    });

    const { taskRailEnabled } = await import("../task-rail");

    await expect(taskRailEnabled()).resolves.toBe(false);
  });

  it("returns false for invalid email values", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "invalid-email" },
    });

    const { taskRailEnabled } = await import("../task-rail");

    await expect(taskRailEnabled()).resolves.toBe(false);
  });
});
