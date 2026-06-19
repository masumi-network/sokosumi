import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { headersMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

import {
  isUnauthorizedCoreApiError,
  redirectIfUnauthorizedCoreError,
  redirectUnauthorizedPromise,
} from "@/lib/auth/handle-unauthorized-core-error";
import { CoreApiRequestError } from "@/lib/clients/core.client";

describe("isUnauthorizedCoreApiError", () => {
  it("matches Core 401 responses", () => {
    expect(
      isUnauthorizedCoreApiError(
        new CoreApiRequestError("Unauthorized", { status: 401 }),
      ),
    ).toBe(true);
  });

  it("matches expired session messages", () => {
    expect(
      isUnauthorizedCoreApiError(
        new CoreApiRequestError("Invalid, expired or missing session", {
          status: 400,
        }),
      ),
    ).toBe(true);
  });

  it("ignores unrelated Core errors", () => {
    expect(
      isUnauthorizedCoreApiError(
        new CoreApiRequestError("Not found", { status: 404 }),
      ),
    ).toBe(false);
  });
});

describe("redirectIfUnauthorizedCoreError", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    headersMock.mockResolvedValue(
      new Headers({
        "x-pathname": "/tasks",
        "x-search-params": "?scope=owned",
      }),
    );
  });

  it("redirects to signin for unauthorized Core errors", async () => {
    await expect(
      redirectIfUnauthorizedCoreError(
        new CoreApiRequestError("Invalid, expired or missing session", {
          status: 401,
        }),
      ),
    ).rejects.toThrow("REDIRECT:/signin?returnUrl=%2Ftasks%3Fscope%3Downed");

    expect(redirectMock).toHaveBeenCalledWith(
      "/signin?returnUrl=%2Ftasks%3Fscope%3Downed",
    );
  });

  it("rethrows unrelated errors", async () => {
    const error = new Error("boom");

    await expect(redirectIfUnauthorizedCoreError(error)).rejects.toBe(error);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("redirectUnauthorizedPromise", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    headersMock.mockResolvedValue(
      new Headers({
        "x-pathname": "/tasks/example",
        "x-search-params": "",
      }),
    );
  });

  it("redirects when the wrapped promise rejects with unauthorized Core errors", async () => {
    await expect(
      redirectUnauthorizedPromise(
        Promise.reject(
          new CoreApiRequestError("Invalid, expired or missing session", {
            status: 401,
          }),
        ),
      ),
    ).rejects.toThrow("REDIRECT:/signin?returnUrl=%2Ftasks%2Fexample");
  });

  it("returns the resolved value for successful promises", async () => {
    await expect(
      redirectUnauthorizedPromise(Promise.resolve("ok")),
    ).resolves.toBe("ok");
  });
});
