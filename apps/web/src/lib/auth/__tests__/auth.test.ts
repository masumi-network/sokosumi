import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  cookieSetMock,
  createAuthClientMock,
  getSessionMock,
  listAccountsMock,
  signInEmailMock,
} = vi.hoisted(() => ({
  cookieSetMock: vi.fn(),
  createAuthClientMock: vi.fn(),
  getSessionMock: vi.fn(),
  listAccountsMock: vi.fn(),
  signInEmailMock: vi.fn(),
}));

vi.mock("better-auth/client", () => ({
  createAuthClient: (...args: unknown[]) => createAuthClientMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (...args: unknown[]) => cookieSetMock(...args),
  }),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreAuthBaseUrl: () => "https://api.example.com/auth",
}));

function buildClientStub() {
  return {
    getSession: getSessionMock,
    listAccounts: listAccountsMock,
    signIn: {
      email: signInEmailMock,
    },
  };
}

describe("auth facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    createAuthClientMock.mockReturnValue(buildClientStub());
  });

  it("forwards only allow-listed headers and revives session dates", async () => {
    const expiresAt = "2026-06-19T12:00:00.000Z";
    getSessionMock.mockResolvedValue({
      data: {
        session: { id: "ses_1", expiresAt, createdAt: expiresAt },
        user: { id: "user_1", createdAt: expiresAt, updatedAt: expiresAt },
      },
      error: null,
    });

    const { auth } = await import("../auth");
    const requestHeaders = new Headers({
      authorization: "Bearer should-not-forward",
      cookie: "sokosumi.session_token=abc",
      "accept-language": "de-DE",
      "x-internal-header": "nope",
    });

    const session = await auth.api.getSession({ headers: requestHeaders });

    expect(session?.session.expiresAt).toBeInstanceOf(Date);
    expect(session?.user.createdAt).toBeInstanceOf(Date);

    const fetchOptions = getSessionMock.mock.calls[0]?.[0]?.fetchOptions as {
      headers: Headers;
    };
    expect(fetchOptions.headers.get("cookie")).toBe(
      "sokosumi.session_token=abc",
    );
    expect(fetchOptions.headers.get("accept-language")).toBe("de-DE");
    expect(fetchOptions.headers.get("authorization")).toBeNull();
    expect(fetchOptions.headers.get("x-internal-header")).toBeNull();
  });

  it("returns null from getSession when core responds 401", async () => {
    getSessionMock.mockResolvedValue({
      data: null,
      error: { status: 401, statusText: "Unauthorized" },
    });

    const { auth } = await import("../auth");
    const session = await auth.api.getSession({ headers: new Headers() });

    expect(session).toBeNull();
  });

  it("throws an APIError carrying core's code and message", async () => {
    listAccountsMock.mockResolvedValue({
      data: null,
      error: {
        code: "TERMS_NOT_ACCEPTED",
        message: "Terms not accepted",
        status: 400,
        statusText: "Bad Request",
      },
    });

    const { auth } = await import("../auth");

    await expect(
      auth.api.listUserAccounts({ headers: new Headers() }),
    ).rejects.toMatchObject({
      body: {
        code: "TERMS_NOT_ACCEPTED",
        message: "Terms not accepted",
      },
      statusCode: 400,
    });
  });

  it("relays multiple Set-Cookie headers onto the Next.js response", async () => {
    signInEmailMock.mockImplementation(
      async (
        _body: unknown,
        fetchOptions: {
          onResponse?: (context: { response: Response }) => Promise<void>;
        },
      ) => {
        const response = new Response("{}");
        response.headers.append(
          "set-cookie",
          "sokosumi.session_token=tok; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
        );
        response.headers.append(
          "set-cookie",
          "__Secure-sokosumi.session_data=data; Domain=.sokosumi.com; Path=/; Secure; SameSite=Lax; Expires=Thu, 18 Jun 2026 12:00:00 GMT",
        );
        await fetchOptions.onResponse?.({ response });
        return { data: { redirect: false }, error: null };
      },
    );

    const { auth } = await import("../auth");
    await auth.api.signInEmail({
      body: { email: "jane@example.com", password: "pw-123456" },
      headers: new Headers(),
    });

    expect(cookieSetMock).toHaveBeenCalledTimes(2);
    expect(cookieSetMock).toHaveBeenCalledWith(
      "sokosumi.session_token",
      "tok",
      {
        httpOnly: true,
        maxAge: 604800,
        path: "/",
        sameSite: "lax",
      },
    );
    expect(cookieSetMock).toHaveBeenCalledWith(
      "__Secure-sokosumi.session_data",
      "data",
      {
        domain: ".sokosumi.com",
        expires: new Date("2026-06-18T12:00:00.000Z"),
        path: "/",
        sameSite: "lax",
        secure: true,
      },
    );
  });
});
