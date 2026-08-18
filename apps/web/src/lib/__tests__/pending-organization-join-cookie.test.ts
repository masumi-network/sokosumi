import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
const cookieSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: cookieGet,
    set: cookieSet,
  }),
}));

import {
  applyPendingOrganizationJoinCookie,
  clearPendingOrganizationJoinToken,
  getPendingOrganizationJoinToken,
  joinTokenFromJoinPath,
  PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
  setPendingOrganizationJoinToken,
} from "../pending-organization-join-cookie";

describe("pending organization join cookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a usable token", async () => {
    cookieGet.mockReturnValue({ value: "join_token_1" });
    await expect(getPendingOrganizationJoinToken()).resolves.toBe(
      "join_token_1",
    );
    expect(cookieGet).toHaveBeenCalledWith(
      PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
    );
  });

  it("rejects blank or whitespace tokens", async () => {
    cookieGet.mockReturnValue({ value: "  " });
    await expect(getPendingOrganizationJoinToken()).resolves.toBeNull();
  });

  it("does not write unusable tokens", async () => {
    await setPendingOrganizationJoinToken("");
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("writes a usable token as httpOnly", async () => {
    await setPendingOrganizationJoinToken("join_token_1");
    expect(cookieSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
        value: "join_token_1",
        httpOnly: true,
        path: "/",
      }),
    );
  });

  it("clears the cookie", async () => {
    await clearPendingOrganizationJoinToken();
    expect(cookieSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
        value: "",
        maxAge: 0,
      }),
    );
  });

  it("writes a session cookie (no maxAge) onto a response store", () => {
    const set = vi.fn();
    applyPendingOrganizationJoinCookie({ set }, "join_token_1", true);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PENDING_ORGANIZATION_JOIN_COOKIE_NAME,
        value: "join_token_1",
        httpOnly: true,
        secure: true,
      }),
    );
    expect(set.mock.calls[0]?.[0]).not.toHaveProperty("maxAge");
  });

  it("parses a usable token from /join/:token", () => {
    expect(joinTokenFromJoinPath("/join/abc123")).toBe("abc123");
    expect(joinTokenFromJoinPath("/setup")).toBeNull();
    expect(joinTokenFromJoinPath("/join/")).toBeNull();
  });
});
