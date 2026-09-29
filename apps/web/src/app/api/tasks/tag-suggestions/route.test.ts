import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";

const { session, suggest } = vi.hoisted(() => ({
  session: vi.fn(),
  suggest: vi.fn(),
}));
vi.mock("@/lib/auth/route-session", () => ({ readRouteSession: session }));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { suggestTaskTags: suggest },
}));

import { POST } from "./route";

function request(
  body: unknown = { description: "Research the market" },
  origin = "https://app.test",
) {
  return new Request("https://app.test/api/tasks/tag-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "user-1" } },
  });
  suggest.mockResolvedValue({ tags: ["research"], receipt: "receipt-1" });
});

describe("POST draft task tag suggestions", () => {
  it("returns private, uncached suggestions using the session", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      tags: ["research"],
      receipt: "receipt-1",
    });
    expect(suggest).toHaveBeenCalledWith({
      description: "Research the market",
    });
  });
  it.each(["signedOut", "unavailable"])(
    "does not call Core when session is %s",
    async (status) => {
      session.mockResolvedValue({ status });
      expect((await POST(request())).status).toBe(
        status === "signedOut" ? 401 : 503,
      );
      expect(suggest).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-origin and oversized content before classification", async () => {
    expect((await POST(request({}, "https://other.test"))).status).toBe(403);
    expect(
      (await POST(request({ description: "x".repeat(8001) }))).status,
    ).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });
  it.each([429, 503])(
    "preserves retry timing without exposing provider details (%s)",
    async (status) => {
      suggest.mockRejectedValue(
        new CoreApiRequestError("Private provider details", {
          status,
          retryAfterSeconds: 75,
        }),
      );
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(response.headers.get("Retry-After")).toBe("75");
      expect(await response.json()).toEqual({
        error: "Suggestions unavailable",
        retryAfterSeconds: 75,
      });
    },
  );
});
