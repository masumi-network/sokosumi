import { beforeEach, describe, expect, it, vi } from "vitest";
export {};

vi.mock("server-only", () => ({}));

const getEnvPublicConfigMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const withRelatedProjectMock = vi.fn();

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("@vercel/related-projects", () => ({
  withRelatedProject: (...args: unknown[]) => withRelatedProjectMock(...args),
}));

describe("getCoreApiBaseUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_NETWORK: "Mainnet",
    });
    getEnvSecretsMock.mockReturnValue({
      CORE_APP_BASE_URL: "http://localhost:8787",
    });
    withRelatedProjectMock.mockImplementation(
      (options: { defaultHost: string }) => options.defaultHost,
    );
  });

  it("resolves the core API url from the server env via related projects", async () => {
    const { getCoreApiBaseUrl } = await import("../utils/core-api-base-url");
    const coreApiBaseUrl = getCoreApiBaseUrl();

    expect(withRelatedProjectMock).toHaveBeenCalledWith({
      projectName: "sokosumi-core-mainnet",
      defaultHost: "http://localhost:8787",
    });
    expect(coreApiBaseUrl).toBe("http://localhost:8787/v1");
  });
});
