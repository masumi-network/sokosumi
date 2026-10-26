import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
const finalizeMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: async () => ({}),
}));

vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    finalizeIntegration: (...args: unknown[]) => finalizeMock(...args),
  },
}));

async function visit(searchParams: Record<string, string>) {
  const { default: IntegrationReturnPage } = await import("./page");
  await expect(
    IntegrationReturnPage({ searchParams: Promise.resolve(searchParams) }),
  ).rejects.toThrow("NEXT_REDIRECT");
}

describe("IntegrationReturnPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    finalizeMock.mockResolvedValue("ACTIVE");
  });

  it("settles the connection and shows the console", async () => {
    await visit({ provider: "gmail" });

    expect(finalizeMock).toHaveBeenCalledWith("gmail");
    expect(redirectMock).toHaveBeenCalledWith(
      "/personal-assistant?integration=active",
    );
  });

  it("settles the connection and continues where setup asked", async () => {
    await visit({ provider: "gmail", next: "/chat/rooms/room-1" });

    expect(finalizeMock).toHaveBeenCalledWith("gmail");
    expect(redirectMock).toHaveBeenCalledWith("/chat/rooms/room-1");
  });

  it("never leaves the origin", async () => {
    await visit({ provider: "gmail", next: "https://evil.example" });

    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
