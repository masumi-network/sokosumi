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

describe("taskManagerMenuEnabled", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns false when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const { taskManagerMenuEnabled } = await import("../task-manager");

    await expect(taskManagerMenuEnabled()).resolves.toBe(false);
  });

  it("returns true for nmkr.io domain emails", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "member@nmkr.io" },
    });

    const { taskManagerMenuEnabled } = await import("../task-manager");

    await expect(taskManagerMenuEnabled()).resolves.toBe(true);
  });

  it("returns true for house-of-communication.com domain emails", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "member@house-of-communication.com" },
    });

    const { taskManagerMenuEnabled } = await import("../task-manager");

    await expect(taskManagerMenuEnabled()).resolves.toBe(true);
  });

  it("returns true for allowlisted emails regardless of case", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "THINKNGROWCRYPTO@GMAIL.COM" },
    });

    const { taskManagerMenuEnabled } = await import("../task-manager");

    await expect(taskManagerMenuEnabled()).resolves.toBe(true);
  });

  it("returns false for non-allowlisted external emails", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "someone@example.com" },
    });

    const { taskManagerMenuEnabled } = await import("../task-manager");

    await expect(taskManagerMenuEnabled()).resolves.toBe(false);
  });

  it("returns false for invalid email values", async () => {
    getSessionMock.mockResolvedValue({
      user: { email: "invalid-email" },
    });

    const { taskManagerMenuEnabled } = await import("../task-manager");

    await expect(taskManagerMenuEnabled()).resolves.toBe(false);
  });
});
