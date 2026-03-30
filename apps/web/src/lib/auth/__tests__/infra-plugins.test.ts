import { beforeEach, describe, expect, it, vi } from "vitest";

const dashMock = vi.fn(() => "dash-plugin");
const sentinelMock = vi.fn(() => "sentinel-plugin");

vi.mock("@better-auth/infra", () => ({
  dash: dashMock,
  sentinel: sentinelMock,
}));

describe("getInfraAuthPlugins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no infra plugins when the api key is missing", async () => {
    const { getInfraAuthPlugins } = await import("../infra-plugins");

    expect(getInfraAuthPlugins()).toEqual([]);
    expect(dashMock).not.toHaveBeenCalled();
    expect(sentinelMock).not.toHaveBeenCalled();
  });

  it("returns no infra plugins when the api key is blank", async () => {
    const { getInfraAuthPlugins } = await import("../infra-plugins");

    expect(getInfraAuthPlugins("   ")).toEqual([]);
    expect(dashMock).not.toHaveBeenCalled();
    expect(sentinelMock).not.toHaveBeenCalled();
  });

  it("configures dash and sentinel with the api key", async () => {
    const { getInfraAuthPlugins } = await import("../infra-plugins");

    expect(getInfraAuthPlugins("test-api-key")).toEqual([
      "dash-plugin",
      "sentinel-plugin",
    ]);
    expect(dashMock).toHaveBeenCalledWith({
      apiKey: "test-api-key",
    });
    expect(sentinelMock).toHaveBeenCalledWith({
      apiKey: "test-api-key",
    });
  });
});
