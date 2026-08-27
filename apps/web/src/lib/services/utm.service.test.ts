import { beforeEach, describe, expect, it, vi } from "vitest";

import { UTM_COOKIE_NAME } from "@/lib/utils/utm";

vi.mock("server-only", () => ({}));

const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

const postUsersByIdUtmAttributionMock = vi.fn();
vi.mock("@/lib/clients/generated/core", () => ({
  postUsersByIdUtmAttribution: (...args: unknown[]) =>
    postUsersByIdUtmAttributionMock(...args),
}));

const createClientMock = vi.fn();
vi.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "http://localhost:8787/v1",
}));

import { utmService } from "./utm.service";

const CAPTURED_AT = "2026-02-20T08:00:00.000Z";
const COOKIE_HEADER = "better-auth.session_token=sess_abc; other=1";
const MOCK_CLIENT = { id: "core-client" };

function validUtmData() {
  return {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring_launch",
    capturedAt: CAPTURED_AT,
  };
}

function createCookieStore(utmCookieValue: string | undefined) {
  const deleteMock = vi.fn();
  const store = {
    get: vi.fn((name: string) =>
      name === UTM_COOKIE_NAME && utmCookieValue !== undefined
        ? { value: utmCookieValue }
        : undefined,
    ),
    delete: deleteMock,
    toString: () => COOKIE_HEADER,
  };
  return { store, deleteMock };
}

describe("utmService.handleUTMConversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockReturnValue(MOCK_CLIENT);
    postUsersByIdUtmAttributionMock.mockResolvedValue({
      data: { id: "utm_1" },
    });
  });

  it("records the attribution via core using the cookie-store session", async () => {
    const { store, deleteMock } = createCookieStore(
      JSON.stringify(validUtmData()),
    );
    cookiesMock.mockResolvedValue(store);

    await utmService.handleUTMConversion();

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "http://localhost:8787/v1",
      headers: { cookie: COOKIE_HEADER },
    });
    expect(postUsersByIdUtmAttributionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client: MOCK_CLIENT,
        path: { id: "me" },
        body: expect.objectContaining({
          utm_source: "google",
          capturedAt: new Date(CAPTURED_AT),
        }),
        throwOnError: true,
      }),
    );
    expect(deleteMock).toHaveBeenCalledWith(UTM_COOKIE_NAME);
  });

  it("skips the core call when no UTM cookie is present", async () => {
    const { store, deleteMock } = createCookieStore(undefined);
    cookiesMock.mockResolvedValue(store);

    await utmService.handleUTMConversion();

    expect(postUsersByIdUtmAttributionMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith(UTM_COOKIE_NAME);
  });

  it("swallows core errors and still clears the cookie", async () => {
    const { store, deleteMock } = createCookieStore(
      JSON.stringify(validUtmData()),
    );
    cookiesMock.mockResolvedValue(store);
    postUsersByIdUtmAttributionMock.mockRejectedValue(new Error("boom"));

    await expect(utmService.handleUTMConversion()).resolves.toBeUndefined();

    expect(deleteMock).toHaveBeenCalledWith(UTM_COOKIE_NAME);
  });

  it("does not call core when the cookie is malformed", async () => {
    const { store, deleteMock } = createCookieStore("not-json");
    cookiesMock.mockResolvedValue(store);

    await utmService.handleUTMConversion();

    expect(postUsersByIdUtmAttributionMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith(UTM_COOKIE_NAME);
  });
});
