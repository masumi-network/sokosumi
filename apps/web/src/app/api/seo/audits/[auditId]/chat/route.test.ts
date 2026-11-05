import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  list: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.session,
}));
vi.mock("@/lib/services/seo-chat.service", () => ({
  seoChatServiceNoRedirect: { list: mocks.list, send: mocks.send },
}));

import { SEO_VIEWER_HEADER } from "@/lib/seo/owner";
import { GET, POST } from "./route";

const AUDIT = "39d1c2a6-aade-4322-aed5-3f139a34b127";
const question = {
  question: "What should I improve?",
  idempotencyKey: "8dbec725-fda1-49bc-aee8-a3b853ca0a0c",
};

function request(method: "GET" | "POST", expectedViewer = "owner") {
  const input = new Request(`https://web.test/api/seo/audits/${AUDIT}/chat`, {
    method,
    headers: {
      [SEO_VIEWER_HEADER]: expectedViewer,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(question) } : {}),
  });
  return (method === "GET" ? GET : POST)(input, {
    params: Promise.resolve({ auditId: AUDIT }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "owner" } },
  });
  mocks.list.mockResolvedValue({ turns: [] });
  mocks.send.mockResolvedValue({ id: "accepted-turn" });
});

describe("native SEO chat viewer boundary", () => {
  it.each(["GET", "POST"] as const)(
    "rejects a stale %s viewer before reading history or sending a paid question",
    async (method) => {
      mocks.session.mockResolvedValue({
        status: "authenticated",
        session: { user: { id: "another-owner" } },
      });
      const response = await request(method);
      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("reads native Audit history for the expected authenticated viewer", async () => {
    const response = await request("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(AUDIT);
  });

  it("forwards one explicit question after the viewer check", async () => {
    const response = await request("POST");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(AUDIT, question);
  });
});
