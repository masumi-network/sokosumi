import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthClientMock = vi.fn();
const getAuthClientPluginsMock = vi.fn(() => ["plugin-1"]);
const buildAuthHeadersMock = vi.fn();
const getServerCoreAppBaseUrlMock = vi.fn();
const headersMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("better-auth/client", () => ({
  createAuthClient: (...args: unknown[]) => createAuthClientMock(...args),
}));

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  buildAuthHeaders: (...args: unknown[]) => buildAuthHeadersMock(...args),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreAppBaseUrl: (...args: unknown[]) =>
    getServerCoreAppBaseUrlMock(...args),
}));

vi.mock("../auth-client.plugins", () => ({
  getAuthClientPlugins: () => getAuthClientPluginsMock(),
}));

describe("authServerClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    createAuthClientMock.mockReturnValue({
      updateUser: vi.fn(),
    });
    getServerCoreAppBaseUrlMock.mockReturnValue("https://core.example.com");
    headersMock.mockResolvedValue(new Headers({ cookie: "session=test" }));
    buildAuthHeadersMock.mockReturnValue({ cookie: "session=test" });
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("points the client at Core /auth with shared plugins and no browser redirect plugin", async () => {
    const { getAuthServerClient } = await import("../auth.server.client");

    getAuthServerClient();

    expect(createAuthClientMock).toHaveBeenCalledWith({
      baseURL: "https://core.example.com/auth",
      plugins: ["plugin-1"],
      disableDefaultFetchPlugins: true,
      fetchOptions: {
        customFetchImpl: expect.any(Function),
      },
    });
  });

  it("forwards request cookies through customFetchImpl", async () => {
    const { getAuthServerClient } = await import("../auth.server.client");

    getAuthServerClient();

    const [[config]] = createAuthClientMock.mock.calls as Array<
      [
        {
          fetchOptions: {
            customFetchImpl: (
              input: string,
              init?: RequestInit,
            ) => Promise<Response>;
          };
        },
      ]
    >;

    await config.fetchOptions.customFetchImpl(
      "https://core.example.com/auth/update-user",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );

    expect(headersMock).toHaveBeenCalled();
    expect(buildAuthHeadersMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://core.example.com/auth/update-user",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.any(Headers),
      }),
    );

    const [, fetchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((fetchInit.headers as Headers).get("cookie")).toBe("session=test");
    expect((fetchInit.headers as Headers).get("Content-Type")).toBe(
      "application/json",
    );
  });
});

describe("updateCurrentUserViaCore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("delegates to authServerClient.updateUser", async () => {
    const updateUserMock = vi.fn().mockResolvedValue({ data: {}, error: null });

    vi.doMock("../auth.server.client", () => ({
      getAuthServerClient: () => ({
        updateUser: updateUserMock,
      }),
    }));

    const { updateCurrentUserViaCore } = await import(
      "../core-auth-http.server"
    );

    await updateCurrentUserViaCore({ onboardingCompleted: true });

    expect(updateUserMock).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it("throws when authServerClient.updateUser returns an error", async () => {
    const updateUserMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: "bad request",
        status: 400,
      },
    });

    vi.doMock("../auth.server.client", () => ({
      getAuthServerClient: () => ({
        updateUser: updateUserMock,
      }),
    }));

    const { updateCurrentUserViaCore } = await import(
      "../core-auth-http.server"
    );

    await expect(
      updateCurrentUserViaCore({ onboardingCompleted: true }),
    ).rejects.toThrow("bad request");
  });
});

describe("inviteOrganizationMemberViaCore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("delegates to authServerClient.organization.inviteMember", async () => {
    const inviteMemberMock = vi
      .fn()
      .mockResolvedValue({ data: {}, error: null });

    vi.doMock("../auth.server.client", () => ({
      getAuthServerClient: () => ({
        organization: {
          inviteMember: inviteMemberMock,
        },
      }),
    }));

    const { inviteOrganizationMemberViaCore } = await import(
      "../core-auth-http.server"
    );

    await inviteOrganizationMemberViaCore({
      email: "user@example.com",
      organizationId: "org-1",
      resend: true,
      role: MemberRole.MEMBER,
    });

    expect(inviteMemberMock).toHaveBeenCalledWith({
      email: "user@example.com",
      organizationId: "org-1",
      resend: true,
      role: MemberRole.MEMBER,
    });
  });

  it("throws when authServerClient.organization.inviteMember returns an error", async () => {
    const inviteMemberMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: "forbidden",
        status: 403,
      },
    });

    vi.doMock("../auth.server.client", () => ({
      getAuthServerClient: () => ({
        organization: {
          inviteMember: inviteMemberMock,
        },
      }),
    }));

    const { inviteOrganizationMemberViaCore } = await import(
      "../core-auth-http.server"
    );

    await expect(
      inviteOrganizationMemberViaCore({
        email: "user@example.com",
        organizationId: "org-1",
        resend: true,
        role: MemberRole.MEMBER,
      }),
    ).rejects.toThrow("forbidden");
  });
});
