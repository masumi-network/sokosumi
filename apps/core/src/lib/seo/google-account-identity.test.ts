import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetch: vi.fn(), capture: vi.fn() }));
vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  projectComposioFetch: m.fetch,
}));
vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: m.capture,
}));

import { readGoogleAccountIdentity } from "@/lib/seo/google-account-identity";

const account = { connectedAccountId: "ca-google", executorUserId: "entity" };
const picture = "https://lh3.googleusercontent.com/a/photo";
function proxied(status: number, data: unknown) {
  m.fetch.mockResolvedValue(
    new Response(JSON.stringify({ status, data }), { status: 200 }),
  );
}

beforeEach(() => vi.resetAllMocks());

describe("readGoogleAccountIdentity", () => {
  it("reads userinfo through the proxy as the executor", async () => {
    proxied(200, { email: "a@example.com", name: "  Ann  ", picture });
    expect(await readGoogleAccountIdentity(account)).toEqual({
      email: "a@example.com",
      name: "Ann",
      pictureUrl: picture,
    });
    expect(m.fetch.mock.calls[0]![1].jsonBody).toEqual({
      connected_account_id: "ca-google",
      user_id: "entity",
      endpoint: "https://www.googleapis.com/oauth2/v3/userinfo",
      method: "GET",
    });
  });

  it.each([
    "https://evil.example/photo",
    "https://googleusercontent.com.evil.example/photo",
    "http://lh3.googleusercontent.com/a/photo",
    "javascript:alert(1)",
  ])("drops a picture outside Google's https image host: %s", async (url) => {
    proxied(200, { email: "a@example.com", picture: url });
    expect(await readGoogleAccountIdentity(account)).toEqual({
      email: "a@example.com",
      name: null,
      pictureUrl: null,
    });
  });

  it.each([
    { name: "Ann", picture },
    { email: "not-an-email", picture },
    { email: `${"a".repeat(320)}@example.com` },
  ])(
    "returns null without a report when there is no valid email: %o",
    async (data) => {
      proxied(200, data);
      expect(await readGoogleAccountIdentity(account)).toBeNull();
      // A consent without the email scope is not a fault.
      expect(m.capture).not.toHaveBeenCalled();
    },
  );

  it.each([401, 403])(
    "returns null without a report when Google refuses the scope (%i)",
    async (status) => {
      proxied(status, { error: "insufficient_scope" });
      expect(await readGoogleAccountIdentity(account)).toBeNull();
      expect(m.capture).not.toHaveBeenCalled();
    },
  );

  it("reports and swallows a provider error or a failed proxy call", async () => {
    proxied(500, {});
    expect(await readGoogleAccountIdentity(account)).toBeNull();
    m.fetch.mockRejectedValue(new Error("network"));
    expect(await readGoogleAccountIdentity(account)).toBeNull();
    expect(m.capture).toHaveBeenCalledTimes(2);
  });
});
