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
const organizationClientMock = jest.fn(() => "organization-plugin");
const oauthProviderClientMock = jest.fn(() => "oauth-plugin");
const stripeClientMock = jest.fn(() => "stripe-plugin");

jest.mock("better-auth/react", () => ({
  createAuthClient: (...args: unknown[]) => createAuthClientMock(...args),
}));

jest.mock("better-auth/client/plugins", () => ({
  adminClient: (...args: unknown[]) => adminClientMock(...args),
  apiKeyClient: (...args: unknown[]) => apiKeyClientMock(...args),
  inferAdditionalFields: (...args: unknown[]) =>
    inferAdditionalFieldsMock(...args),
  inferOrgAdditionalFields: (...args: unknown[]) =>
    inferOrgAdditionalFieldsMock(...args),
  jwtClient: (...args: unknown[]) => jwtClientMock(...args),
  organizationClient: (...args: unknown[]) => organizationClientMock(...args),
}));

jest.mock("@better-auth/oauth-provider/client", () => ({
  oauthProviderClient: (...args: unknown[]) => oauthProviderClientMock(...args),
}));

jest.mock("@better-auth/stripe/client", () => ({
  stripeClient: (...args: unknown[]) => stripeClientMock(...args),
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
