import { beforeEach, describe, expect, it, vi } from "vitest";
export {};

const createAuthClientMock = vi.fn();
const adminClientMock = vi.fn(() => "admin-plugin");
const apiKeyClientMock = vi.fn(() => "api-key-plugin");
const inferAdditionalFieldsMock = vi.fn(
  () => "infer-additional-fields-plugin",
);
const inferOrgAdditionalFieldsMock = vi.fn(
  () => "infer-org-additional-fields-plugin",
);
const jwtClientMock = vi.fn(() => "jwt-plugin");
const lastLoginMethodClientMock = vi.fn(() => "last-login-method-plugin");
const organizationClientMock = vi.fn(() => "organization-plugin");
const oauthProviderClientMock = vi.fn(() => "oauth-plugin");
const passkeyClientMock = vi.fn(() => "passkey-plugin");
const stripeClientMock = vi.fn(() => "stripe-plugin");
const dashClientMock = vi.fn(() => "dash-plugin");
const sentinelClientMock = vi.fn(() => "sentinel-plugin");

vi.mock("better-auth/react", () => ({
  createAuthClient: createAuthClientMock,
}));

vi.mock("better-auth/client/plugins", () => ({
  adminClient: adminClientMock,
  inferAdditionalFields: inferAdditionalFieldsMock,
  inferOrgAdditionalFields: inferOrgAdditionalFieldsMock,
  jwtClient: jwtClientMock,
  lastLoginMethodClient: lastLoginMethodClientMock,
  organizationClient: organizationClientMock,
}));

vi.mock("@better-auth/api-key/client", () => ({
  apiKeyClient: apiKeyClientMock,
}));

vi.mock("@better-auth/oauth-provider/client", () => ({
  oauthProviderClient: oauthProviderClientMock,
}));

vi.mock("@better-auth/passkey/client", () => ({
  passkeyClient: passkeyClientMock,
}));

vi.mock("@better-auth/stripe/client", () => ({
  stripeClient: stripeClientMock,
}));

vi.mock(
  "@better-auth/infra/client",
  () => ({
    dashClient: dashClientMock,
    sentinelClient: sentinelClientMock,
  }),
  { virtual: true },
);

vi.mock("@/lib/auth/auth", () => ({
  auth: {},
}));

describe("auth client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createAuthClientMock.mockReturnValue({});
  });

  it("registers adminClient in createAuthClient plugins", async () => {
    await import("../auth.client");

    expect(createAuthClientMock).toHaveBeenCalledTimes(1);
    expect(adminClientMock).toHaveBeenCalledWith();

    const [[{ plugins }]] = createAuthClientMock.mock.calls as Array<
      [{ plugins: unknown[] }]
    >;

    expect(plugins).toEqual(expect.arrayContaining(["admin-plugin"]));
  });

  it("registers passkeyClient in createAuthClient plugins", async () => {
    await import("../auth.client");

    expect(passkeyClientMock).toHaveBeenCalledWith();

    const [[{ plugins }]] = createAuthClientMock.mock.calls as Array<
      [{ plugins: unknown[] }]
    >;

    expect(plugins).toEqual(expect.arrayContaining(["passkey-plugin"]));
  });
});
