import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverClientMock } = vi.hoisted(() => ({
  serverClientMock: vi.fn(),
}));

vi.mock("postmark", () => ({
  ServerClient: function ServerClient(...args: unknown[]) {
    serverClientMock(...args);
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    POSTMARK_SERVER_ID: "postmark-server-id",
  }),
}));

describe("postmarkClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a Postmark server client with the configured server id", async () => {
    await import("./postmark.client");

    expect(serverClientMock).toHaveBeenCalledWith("postmark-server-id");
  });
});
