import { beforeEach, describe, expect, it, vi } from "vitest";

const { RestMock, getEnvMock } = vi.hoisted(() => ({
  RestMock: vi.fn(),
  getEnvMock: vi.fn(),
}));

vi.mock("ably", () => ({
  Rest: RestMock,
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

describe("ably rest client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    RestMock.mockImplementation(function Rest() {
      return { channels: { get: vi.fn() } };
    });
    getEnvMock.mockReturnValue({
      ABLY_PUBLISH_ONLY_KEY: "publish-key",
      ABLY_SUBSCRIBE_ONLY_KEY: "subscribe-key",
    });
  });

  it("disables msgpack so JSON REST bodies cannot throw trailing-bytes", async () => {
    const { getRestClient, getSubscribeRestClient } = await import("./client");

    getRestClient();
    getSubscribeRestClient();

    expect(RestMock).toHaveBeenNthCalledWith(1, {
      key: "publish-key",
      useBinaryProtocol: false,
    });
    expect(RestMock).toHaveBeenNthCalledWith(2, {
      key: "subscribe-key",
      useBinaryProtocol: false,
    });
  });
});
