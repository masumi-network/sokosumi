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
  withUnauthorizedCoreRedirect,
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

  it("does not treat business 403 permission errors as unauthorized", () => {
    expect(
      isUnauthorizedCoreApiError(
        new CoreApiRequestError(
          "Only the channel creator or an organization owner/admin can update members",
          { status: 403 },
        ),
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

describe("withUnauthorizedCoreRedirect", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    headersMock.mockResolvedValue(
      new Headers({
        "x-pathname": "/tasks/example",
        "x-search-params": "",
      }),
    );
  });

  it("redirects when a wrapped client method rejects with unauthorized Core errors", async () => {
    const client = withUnauthorizedCoreRedirect({
      getTask: (_taskId: string) =>
        Promise.reject(
          new CoreApiRequestError("Invalid, expired or missing session", {
            status: 401,
          }),
        ),
    });

    await expect(client.getTask("task-id")).rejects.toThrow(
      "REDIRECT:/signin?returnUrl=%2Ftasks%2Fexample",
    );
  });

  it("returns resolved values from wrapped client methods", async () => {
    const client = withUnauthorizedCoreRedirect({
      getTask: (_taskId: string) => Promise.resolve({ id: "task-id" }),
    });

    await expect(client.getTask("task-id")).resolves.toEqual({ id: "task-id" });
  });

  it("rethrows unrelated errors from wrapped client methods", async () => {
    const boom = new Error("boom");
    const client = withUnauthorizedCoreRedirect({
      getTask: (_taskId: string) => Promise.reject(boom),
    });

    await expect(client.getTask("task-id")).rejects.toBe(boom);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("rethrows business 403 errors without redirecting", async () => {
    const forbidden = new CoreApiRequestError(
      "Only the channel creator or an organization owner/admin can update members",
      { status: 403 },
    );
    const client = withUnauthorizedCoreRedirect({
      updateRoom: (_roomId: string) => Promise.reject(forbidden),
    });

    await expect(client.updateRoom("room-id")).rejects.toBe(forbidden);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
