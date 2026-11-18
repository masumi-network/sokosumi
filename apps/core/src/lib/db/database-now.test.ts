import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { databaseNow } from "./database-now";

describe("databaseNow", () => {
  it("returns the time PostgreSQL's clock_timestamp() reads", async () => {
    const at = new Date("2026-11-18T10:00:00.000Z");
    const $queryRaw = vi.fn().mockResolvedValue([{ now: at }]);

    await expect(databaseNow({ $queryRaw })).resolves.toBe(at);
    expect($queryRaw.mock.calls[0]?.[0].join("")).toContain(
      "clock_timestamp()",
    );
  });

  it("fails when the database cannot be read, instead of using the host clock", async () => {
    const $queryRaw = vi.fn().mockRejectedValue(new Error("Connection lost"));

    await expect(databaseNow({ $queryRaw })).rejects.toThrow("Connection lost");
  });
});
