import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UTM_COOKIE_NAME } from "@/lib/utils/utm";

vi.mock("server-only", () => ({}));
const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  delete: vi.fn(),
  toString: () => "better-auth.session_token=owned-fixture",
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "https://owned-core.example.test/v1",
}));

import { utmService } from "./utm.service";

describe("social conversion through the generated Core client", () => {
  const requests: Request[] = [];
  let status = 200;
  let provider: "google" | null = "google";

  beforeEach(() => {
    vi.clearAllMocks();
    requests.length = 0;
    status = 200;
    provider = "google";
    cookieStore.get.mockReturnValue({
      value: JSON.stringify({
        utm_source: "owned-ad",
        utm_campaign: "fixture",
        capturedAt: "2026-10-01T12:00:00.000Z",
      }),
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json(
          {
            data: { provider },
            meta: {
              timestamp: "2026-10-01T12:00:01.000Z",
              requestId: "owned-request",
            },
          },
          { status },
        );
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends attribution and session in the same authenticated claim", async () => {
    await expect(utmService.claimSignUpConversion()).resolves.toBe("google");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      "https://owned-core.example.test/v1/users/me/sign-up-conversion",
    );
    expect(requests[0].headers.get("cookie")).toBe(
      "better-auth.session_token=owned-fixture",
    );
    expect(await requests[0].json()).toEqual({
      utmAttribution: {
        utm_source: "owned-ad",
        utm_campaign: "fixture",
        capturedAt: "2026-10-01T12:00:00.000Z",
      },
    });
    expect(cookieStore.delete).toHaveBeenCalledWith(UTM_COOKIE_NAME);
  });

  it("retains attribution on a server error so a later claim can retry", async () => {
    status = 500;
    await expect(utmService.claimSignUpConversion()).rejects.toBeDefined();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    status = 200;
    await expect(utmService.claimSignUpConversion()).resolves.toBe("google");
    expect(cookieStore.delete).toHaveBeenCalledOnce();
  });

  it("retains the cookie when this session has no pending conversion", async () => {
    provider = null;
    await expect(utmService.claimSignUpConversion()).resolves.toBeNull();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("ignores invalid UTM cookies while still claiming the signup", async () => {
    cookieStore.get.mockReturnValue({ value: "invalid-json" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(utmService.claimSignUpConversion()).resolves.toBe("google");
    expect(await requests[0].json()).toEqual({});
  });

  it("bounds an unresponsive Core request", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(5_000);
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("owned timeout")), 5);
      return controller.signal;
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return new Promise((_resolve, reject) =>
        request.signal.addEventListener(
          "abort",
          () => reject(request.signal.reason),
          { once: true },
        ),
      );
    });
    await expect(utmService.claimSignUpConversion()).rejects.toThrow(
      "owned timeout",
    );
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });
});
