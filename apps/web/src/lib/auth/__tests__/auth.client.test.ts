export {};

const createAuthClientMock = jest.fn();
const adminClientMock = jest.fn(() => "admin-plugin");
const apiKeyClientMock = jest.fn(() => "api-key-plugin");
const inferAdditionalFieldsMock = jest.fn(
  () => "infer-additional-fields-plugin",
);
const inferOrgAdditionalFieldsMock = jest.fn(
  () => "infer-org-additional-fields-plugin",
);
const jwtClientMock = jest.fn(() => "jwt-plugin");
const lastLoginMethodClientMock = jest.fn(() => "last-login-method-plugin");
const organizationClientMock = jest.fn(() => "organization-plugin");
const oauthProviderClientMock = jest.fn(() => "oauth-plugin");
const stripeClientMock = jest.fn(() => "stripe-plugin");

jest.mock("better-auth/react", () => ({
  createAuthClient: createAuthClientMock,
}));

jest.mock("better-auth/client/plugins", () => ({
  adminClient: adminClientMock,
  inferAdditionalFields: inferAdditionalFieldsMock,
  inferOrgAdditionalFields: inferOrgAdditionalFieldsMock,
  jwtClient: jwtClientMock,
  lastLoginMethodClient: lastLoginMethodClientMock,
  organizationClient: organizationClientMock,
}));

jest.mock("@better-auth/api-key/client", () => ({
  apiKeyClient: apiKeyClientMock,
}));

jest.mock("@better-auth/oauth-provider/client", () => ({
  oauthProviderClient: oauthProviderClientMock,
}));

jest.mock("@better-auth/stripe/client", () => ({
  stripeClient: stripeClientMock,
}));

jest.mock("@/lib/auth/auth", () => ({
  auth: {},
}));

describe("auth client", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
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
});
