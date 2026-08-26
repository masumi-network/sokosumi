import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const getMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/lib/clients/utils/core-api-base-url.browser", () => ({
  getBrowserCoreApiBaseUrl: () => "https://api.sokosumi.com/v1",
}));

// Partial mock: `client.gen` calls `createConfig` at import time, and the
// generated SDK function imports it.
vi.mock("@/lib/clients/generated/core/client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/clients/generated/core/client")
  >()),
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const PREFERENCES_DTO = {
  data: {
    marketingOptIn: false,
    notificationsOptIn: true,
    pushOptIn: true,
  },
  meta: {
    timestamp: "2026-08-26T10:00:00.000Z",
    requestId: "req_1",
  },
};

describe("core.preferences.browser.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    createClientMock.mockReturnValue({ get: getMock, patch: patchMock });
    getMock.mockImplementation(
      async (options: {
        responseTransformer?: (data: unknown) => Promise<unknown>;
      }) => ({
        data: options.responseTransformer
          ? await options.responseTransformer(structuredClone(PREFERENCES_DTO))
          : PREFERENCES_DTO,
        response: new Response("{}", { status: 200 }),
      }),
    );
    patchMock.mockImplementation(
      async (options: {
        responseTransformer?: (data: unknown) => Promise<unknown>;
      }) => ({
        data: options.responseTransformer
          ? await options.responseTransformer(structuredClone(PREFERENCES_DTO))
          : PREFERENCES_DTO,
        response: new Response("{}", { status: 200 }),
      }),
    );
  });

  it("patches the session user's preferences and returns the DTO", async () => {
    const { preferencesBrowserClient } = await import(
      "../core.preferences.browser.client"
    );

    const result = await preferencesBrowserClient.patchMyPreferences({
      pushOptIn: true,
    });

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "https://api.sokosumi.com/v1",
      credentials: "include",
    });
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/users/{id}/preferences",
        path: { id: "me" },
        body: { pushOptIn: true },
      }),
    );
    expect(result.data.pushOptIn).toBe(true);
    expect(result.meta.timestamp).toEqual(new Date("2026-08-26T10:00:00.000Z"));
  });

  it("sends only the keys the caller passed, leaving email preferences alone", async () => {
    const { preferencesBrowserClient } = await import(
      "../core.preferences.browser.client"
    );

    await preferencesBrowserClient.patchMyPreferences({ pushOptIn: false });

    const body = patchMock.mock.calls[0]?.[0]?.body;
    expect(Object.keys(body)).toEqual(["pushOptIn"]);
  });

  it("reads the session user's preferences", async () => {
    const { preferencesBrowserClient } = await import(
      "../core.preferences.browser.client"
    );

    const result = await preferencesBrowserClient.getMyPreferences();

    // No-store like the sibling browser clients: a cached read would show a
    // stale switch after another device changed the account preference.
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/users/{id}/preferences",
        path: { id: "me" },
        cache: "no-store",
      }),
    );
    expect(result.data.pushOptIn).toBe(true);
  });

  it("wraps a failed patch in a Core API error", async () => {
    patchMock.mockResolvedValue({
      error: { message: "nope" },
      response: new Response("{}", { status: 500 }),
    });
    const { preferencesBrowserClient } = await import(
      "../core.preferences.browser.client"
    );

    await expect(
      preferencesBrowserClient.patchMyPreferences({ pushOptIn: true }),
    ).rejects.toThrow();
  });
});
