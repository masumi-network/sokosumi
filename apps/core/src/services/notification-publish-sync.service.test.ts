import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, dispatch } = vi.hoisted(() => ({
  findMany: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: { notification: { findMany } } }));
vi.mock("@/helpers/notification-publish", () => ({
  dispatchNotificationPublish: dispatch,
}));

import { retryNotificationPublishes } from "./notification-publish-sync.service";

beforeEach(() => {
  vi.resetAllMocks();
  findMany.mockResolvedValue([]);
  dispatch.mockResolvedValue("pending");
});

describe("notification publish retry scan", () => {
  it("continues past a full page without relying on its last row still existing", async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ id: `row${n}` }));
    findMany
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ id: "tail" }]);
    dispatch
      .mockResolvedValueOnce("published")
      .mockResolvedValueOnce("skipped");
    expect(await retryNotificationPublishes()).toEqual({
      examined: 101,
      published: 1,
      skipped: 1,
    });
    expect(findMany.mock.calls[1][0].where.id).toEqual({ gt: "row99" });
    expect(findMany.mock.calls[1][0]).not.toHaveProperty("cursor");
  });
  it("uses a fresh clock for each claim during a long scan", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-09-21T10:00:00Z");
      vi.setSystemTime(now);
      findMany.mockResolvedValue([{ id: "first" }, { id: "second" }]);
      dispatch.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date(now.getTime() + 90_000));
        return "published";
      });
      await retryNotificationPublishes();
      expect(dispatch.mock.calls[0][1]).toEqual(now);
      expect(dispatch.mock.calls[1][1]).toEqual(
        new Date(now.getTime() + 90_000),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops before another row when the deadline expires", async () => {
    let remaining = true;
    findMany.mockResolvedValue([{ id: "first" }, { id: "second" }]);
    dispatch.mockImplementationOnce(async () => {
      remaining = false;
      return "published";
    });
    expect(
      await retryNotificationPublishes({ shouldContinue: () => remaining }),
    ).toEqual({ examined: 1, published: 1, skipped: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it("does not query after cancellation", async () => {
    await retryNotificationPublishes({ abortSignal: AbortSignal.abort() });
    expect(findMany).not.toHaveBeenCalled();
  });
});
