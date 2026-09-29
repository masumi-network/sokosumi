import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRedisUrlMock } = vi.hoisted(() => ({
  getRedisUrlMock: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  getRedisUrl: getRedisUrlMock,
}));

describe("isUiStreamResumptionConfigured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("is true when getRedisUrl returns a url", async () => {
    getRedisUrlMock.mockReturnValue("redis://primary");
    const { isUiStreamResumptionConfigured } = await import(
      "./resumable-ui-stream-context"
    );
    expect(isUiStreamResumptionConfigured()).toBe(true);
  });

  it("is false when getRedisUrl returns null", async () => {
    getRedisUrlMock.mockReturnValue(null);
    const { isUiStreamResumptionConfigured } = await import(
      "./resumable-ui-stream-context"
    );
    expect(isUiStreamResumptionConfigured()).toBe(false);
  });
});
