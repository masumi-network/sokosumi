import { describe, expect, it, vi } from "vitest";
import { withDeadline } from "./with-deadline";

const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("withDeadline", () => {
  it("rejects with the message when the work outlasts the deadline", async () => {
    await expect(
      withDeadline(after(200, "late"), 10, "Read timed out"),
    ).rejects.toThrow("Read timed out");
  });

  it.each([0, -1, Number.NaN])(
    "rejects at once when no time is left (%s ms), and the late work fails nothing",
    async (ms) => {
      await expect(
        withDeadline(Promise.reject(new Error("refused")), ms, "No time left"),
      ).rejects.toThrow("No time left");
      await expect(
        withDeadline(Promise.resolve("done"), ms, "No time left"),
      ).rejects.toThrow("No time left");
    },
  );

  it("never gives up on work with no deadline, past the longest timer", async () => {
    vi.useFakeTimers();
    try {
      const work = Promise.withResolvers<string>();
      const result = withDeadline(
        work.promise,
        Number.POSITIVE_INFINITY,
        "timed out",
      );
      // Past the longest timer Node can set: a capped timer has fired by now.
      await vi.advanceTimersByTimeAsync(2 ** 31);
      work.resolve("done");
      await expect(result).resolves.toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the work with no deadline", async () => {
    // Node fires a timer past 2^31-1 ms at once: an uncapped Infinity rejects.
    await expect(
      withDeadline(after(20, "done"), Number.POSITIVE_INFINITY, "timed out"),
    ).resolves.toBe("done");
  });
});
