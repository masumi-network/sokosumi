import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

import { startImpersonation, stopImpersonation } from "./admin-impersonation";

const TARGET_USER = {
  id: "user_target",
  name: "Target User",
  email: "target@example.com",
};

describe("admin-impersonation client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts user and reason to the impersonation route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: true, value: TARGET_USER }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startImpersonation({
      userId: TARGET_USER.id,
      reason: "SOK-1080: x",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/impersonation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id, reason: "SOK-1080: x" }),
    });
    expect(result).toEqual({ ok: true, value: TARGET_USER });
  });

  it("passes route error DTOs through untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: CommonErrorCode.BAD_INPUT,
            message: "Already impersonating a user",
          },
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await startImpersonation({
      userId: TARGET_USER.id,
      reason: "SOK-1: x",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Already impersonating a user",
      },
    });
  });

  it("maps transport failures to an internal error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const result = await startImpersonation({
      userId: TARGET_USER.id,
      reason: "SOK-1: x",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR },
    });
  });

  it("maps non-JSON responses to an internal error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 500 })),
    );

    const result = await stopImpersonation();

    expect(result).toEqual({
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR },
    });
  });

  it("sends a bodyless DELETE to stop", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        value: { id: "user_admin", name: "A", email: "a@example.com" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await stopImpersonation();

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/impersonation", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: undefined,
    });
    expect(result.ok).toBe(true);
  });
});
