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
      NEXT_PUBLIC_CORE_APP_BASE_URL: "https://api.sokosumi.com/",
      NEXT_PUBLIC_NETWORK: "Mainnet",
    });
    getEnvSecretsMock.mockReturnValue({
      CORE_APP_BASE_URL: "http://localhost:8787",
    });
    withRelatedProjectMock.mockImplementation(
      (options: { defaultHost: string }) => options.defaultHost,
    );
  });

  it("normalizes base urls to a single /v1 suffix", async () => {
    const { normalizeCoreApiBaseUrl } = await import(
      "../utils/core-api-base-url.shared"
    );

    expect(normalizeCoreApiBaseUrl("https://api.sokosumi.com")).toBe(
      "https://api.sokosumi.com/v1",
    );
    expect(normalizeCoreApiBaseUrl("https://api.sokosumi.com/")).toBe(
      "https://api.sokosumi.com/v1",
    );
    expect(normalizeCoreApiBaseUrl("https://api.sokosumi.com/v1")).toBe(
      "https://api.sokosumi.com/v1",
    );
  });

  it("joinCoreApiPath matches OpenAPI client base + path joining", async () => {
    const { joinCoreApiPath } = await import(
      "../utils/core-api-base-url.shared"
    );

    expect(joinCoreApiPath("http://localhost:8787/v1", "/hermes/chat")).toBe(
      "http://localhost:8787/v1/hermes/chat",
    );
    expect(joinCoreApiPath("http://localhost:8787/v1/", "/hermes/chat")).toBe(
      "http://localhost:8787/v1/hermes/chat",
    );
    expect(joinCoreApiPath("http://localhost:8787/v1///", "/hermes/chat")).toBe(
      "http://localhost:8787/v1/hermes/chat",
    );
    expect(joinCoreApiPath("http://localhost:8787/v1", "hermes/chat")).toBe(
      "http://localhost:8787/v1/hermes/chat",
    );
  });

  it("resolves the server core API url from related projects", async () => {
    const { getServerCoreApiBaseUrl } = await import(
      "../utils/core-api-base-url"
    );
    const coreApiBaseUrl = getServerCoreApiBaseUrl();

    expect(withRelatedProjectMock).toHaveBeenCalledWith({
      projectName: "sokosumi-core-mainnet",
      defaultHost: "http://localhost:8787",
    });
    expect(coreApiBaseUrl).toBe("http://localhost:8787/v1");
  });

  it("resolves the server core app url without the /v1 suffix", async () => {
    const { getServerCoreAppBaseUrl } = await import(
      "../utils/core-api-base-url"
    );

    expect(getServerCoreAppBaseUrl()).toBe("http://localhost:8787");
  });

  it("reads the browser core API url from public env", async () => {
    const { getBrowserCoreApiBaseUrl } = await import(
      "../utils/core-api-base-url.browser"
    );

    expect(getBrowserCoreApiBaseUrl()).toBe("https://api.sokosumi.com/v1");
  });

  it("resolves the browser Core auth base url without the /v1 suffix", async () => {
    const { getBrowserCoreAuthBaseUrl } = await import(
      "../utils/core-api-base-url.browser"
    );

    expect(getBrowserCoreAuthBaseUrl()).toBe("https://api.sokosumi.com/auth");
  });
});
