export {};

jest.mock("server-only", () => ({}));

const getEnvPublicConfigMock = jest.fn();
const getEnvSecretsMock = jest.fn();
const withRelatedProjectMock = jest.fn();

jest.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

jest.mock("@vercel/related-projects", () => ({
  withRelatedProject: (...args: unknown[]) => withRelatedProjectMock(...args),
}));

describe("getCoreApiBaseUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_NETWORK: "Mainnet",
    });
    getEnvSecretsMock.mockReturnValue({
      CORE_BASE_URL: "http://localhost:8787",
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
