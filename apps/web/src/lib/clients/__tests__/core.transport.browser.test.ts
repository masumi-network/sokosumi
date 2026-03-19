export {};

const createClientMock = jest.fn();
const getEnvPublicConfigMock = jest.fn();
const withRelatedProjectMock = jest.fn();

jest.mock("@vercel/related-projects", () => ({
  withRelatedProject: (...args: unknown[]) => withRelatedProjectMock(...args),
}));

jest.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

jest.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe("core.transport.browser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_CORE_API_URL: "http://localhost:8787/",
      NEXT_PUBLIC_NETWORK: "Mainnet",
    });
    withRelatedProjectMock.mockImplementation(
      ({ defaultHost }: { defaultHost: string }) => defaultHost,
    );
  });

  it("creates a generated client with the related-project base url", async () => {
    createClientMock.mockReturnValue({ id: "browser-client" });
    withRelatedProjectMock.mockReturnValue("https://core-browser.example.com/");

    const { coreBrowserTransportAdapter } = await import(
      "../core.transport.browser"
    );
    const client = await coreBrowserTransportAdapter.createGeneratedClient();

    expect(withRelatedProjectMock).toHaveBeenCalledWith({
      defaultHost: "http://localhost:8787/",
      projectName: "sokosumi-core-mainnet",
    });
    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "https://core-browser.example.com/v1",
      credentials: "include",
    });
    expect(client).toEqual({ id: "browser-client" });
  });
});
