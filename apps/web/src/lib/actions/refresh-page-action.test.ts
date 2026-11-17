import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
let sessionCookie = true;
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/session-cookie", () => ({
  hasSessionCookie: () => sessionCookie,
}));

import { refreshPage } from "@/lib/actions/refresh-page-action";

describe("refreshPage", () => {
  beforeEach(() => {
    refresh.mockReset();
    sessionCookie = true;
  });

  it("renders the open page again", async () => {
    await expect(refreshPage()).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
  });

  // The proxy redirected this POST to /signin, and a refresh here could
  // render that page under the URL the reader left.
  it("renders nothing without a session cookie", async () => {
    sessionCookie = false;

    await expect(refreshPage()).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
