export {};

jest.mock("server-only", () => ({}));

const headersMock = jest.fn();
const createClientMock = jest.fn();
const getEnvPublicConfigMock = jest.fn();

jest.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

jest.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

jest.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe("core.transport.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    headersMock.mockResolvedValue(
      new Headers({
        cookie: "session=abc",
        "x-organization-slug": "my-org",
      }),
    );
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_CORE_API_URL: "https://core.example.com",
      NEXT_PUBLIC_NETWORK: "Mainnet",
    });
  });

  it("creates a generated client with forwarded auth cookies", async () => {
    createClientMock.mockReturnValue({ id: "server-client" });

    const { coreServerTransportAdapter } = await import(
      "../core.transport.server"
    );
    const client = await coreServerTransportAdapter.createGeneratedClient();

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "https://core.example.com/v1",
      headers: {
        cookie: "session=abc",
      },
    });
    expect(client).toEqual({ id: "server-client" });
  });
});
