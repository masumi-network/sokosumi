import { beforeEach, describe, expect, it, vi } from "vitest";

const handleUTMConversionMock = vi.fn();

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      setPassword: vi.fn(),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/services/utm.service", () => ({
  utmService: {
    handleUTMConversion: (...args: unknown[]) =>
      handleUTMConversionMock(...args),
  },
}));

describe("handleUtmConversion", () => {
  beforeEach(() => {
    handleUTMConversionMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("records UTM attribution via utmService", async () => {
    handleUTMConversionMock.mockResolvedValue(undefined);

    const { handleUtmConversion } = await import("../action");

    await handleUtmConversion();

    expect(handleUTMConversionMock).toHaveBeenCalledTimes(1);
  });

  it("swallows utmService failures without throwing", async () => {
    handleUTMConversionMock.mockRejectedValue(new Error("utm failed"));

    const { handleUtmConversion } = await import("../action");

    await expect(handleUtmConversion()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to create utm attribution",
      expect.any(Error),
    );
  });
});
