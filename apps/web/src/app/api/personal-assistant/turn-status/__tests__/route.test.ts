import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getTurnStatusesMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));
vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class extends Error {
    status?: number;
  },
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getTurnStatuses: (...args: unknown[]) => getTurnStatusesMock(...args),
  },
}));

import { GET } from "../route";

function request(query: string) {
  return new NextRequest(
    `http://localhost/api/personal-assistant/turn-status${query}`,
  );
}

describe("GET /api/personal-assistant/turn-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects anonymous callers", async () => {
    getSessionMock.mockResolvedValue(null);
    const response = await GET(request("?id=t1"));
    expect(response.status).toBe(401);
  });

  it("returns snapshots for comma or repeated ids", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    getTurnStatusesMock.mockResolvedValue([
      { turnId: "t1", status: "RUNNING", fingerprint: "a" },
      { turnId: "t2", status: "COMPLETED", fingerprint: "b" },
    ]);
    const response = await GET(request("?id=t1,t2"));
    expect(response.status).toBe(200);
    expect(getTurnStatusesMock).toHaveBeenCalledWith(["t1", "t2"]);
    expect(await response.json()).toEqual({
      snapshots: [
        { turnId: "t1", status: "RUNNING", fingerprint: "a" },
        { turnId: "t2", status: "COMPLETED", fingerprint: "b" },
      ],
    });
  });

  it("rejects missing ids", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const response = await GET(request(""));
    expect(response.status).toBe(400);
  });
});
