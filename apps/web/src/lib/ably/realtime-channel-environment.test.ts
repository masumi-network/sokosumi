import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getRealtimeChannelEnvironment", () => {
  it("reads the deployment from the public env", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "Mainnet");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF", "fix/x");
    const { getRealtimeChannelEnvironment } = await import(
      "./realtime-channel-environment"
    );

    expect(getRealtimeChannelEnvironment()).toEqual({
      network: "Mainnet",
      vercelEnv: "preview",
      vercelGitCommitRef: "fix/x",
    });
  });
});
