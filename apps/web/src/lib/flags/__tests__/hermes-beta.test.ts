import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const flagMock = vi.fn((declaration: unknown) => declaration);
const vercelAdapterMock = vi.fn(() => ({ decide: vi.fn() }));

vi.mock("flags/next", () => ({
  flag: (declaration: unknown) => flagMock(declaration),
}));

vi.mock("@flags-sdk/vercel", () => ({
  vercelAdapter: () => vercelAdapterMock(),
}));

vi.mock("@/lib/flags/identify", () => ({
  identify: vi.fn(),
}));

describe("hermesBetaEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("declares a Vercel-backed boolean flag with identify", async () => {
    const { identify } = await import("@/lib/flags/identify");
    const { hermesBetaEnabled } = await import("../hermes-beta");

    expect(flagMock).toHaveBeenCalledTimes(1);
    expect(hermesBetaEnabled).toMatchObject({
      key: "hermes-beta-enabled",
      defaultValue: false,
      identify,
    });
    expect(vercelAdapterMock).toHaveBeenCalledTimes(1);
    expect(hermesBetaEnabled).toHaveProperty("adapter");
  });
});
