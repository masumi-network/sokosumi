import { describe, expect, it, vi } from "vitest";
import { createNotificationReadQueue } from "./notification-read-queue";

describe("notification read writes", () => {
  it("orders writes and invalidates only a superseded row response", async () => {
    const queue = createNotificationReadQueue();
    const gate = Promise.withResolvers<void>();
    const first = queue.enqueue(["a", "b"], async (isCurrent) => {
      await gate.promise;
      expect(isCurrent("a")).toBe(false);
      expect(isCurrent("b")).toBe(true);
    });
    const nextWrite = vi.fn(async (isCurrent: (id: string) => boolean) => {
      expect(isCurrent("a")).toBe(true);
    });
    const second = queue.enqueue(["a"], nextWrite);
    await Promise.resolve();
    expect(nextWrite).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([first, second]);
    expect(nextWrite).toHaveBeenCalledOnce();
  });

  it("mark all read supersedes responses for any row", async () => {
    const queue = createNotificationReadQueue();
    const first = queue.enqueue(["a"], async (isCurrent) => {
      expect(isCurrent("a")).toBe(false);
    });
    const all = queue.enqueue(null, async () => {});
    await Promise.all([first, all]);
  });

  it("continues after failure and preserves the error for its caller", async () => {
    const queue = createNotificationReadQueue();
    const failure = queue.enqueue(["a"], async () => {
      throw new Error("offline");
    });
    const second = queue.enqueue(["a"], async () => "saved");
    await expect(failure).rejects.toThrow("offline");
    await expect(second).resolves.toBe("saved");
  });
});
