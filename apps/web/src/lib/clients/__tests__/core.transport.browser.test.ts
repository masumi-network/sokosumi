export {};

const createClientMock = jest.fn();
const getEnvPublicConfigMock = jest.fn();

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
      NEXT_PUBLIC_CORE_API_URL: "https://core-browser.example.com/",
      NEXT_PUBLIC_NETWORK: "Mainnet",
    });
  });

  it("creates a generated client with the resolved public base url", async () => {
    createClientMock.mockReturnValue({ id: "browser-client" });

    const { coreBrowserTransportAdapter } = await import(
      "../core.transport.browser"
    );
    const client = await coreBrowserTransportAdapter.createGeneratedClient();

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "https://core-browser.example.com/v1",
      credentials: "include",
    });
    expect(client).toEqual({ id: "browser-client" });
  });
});
