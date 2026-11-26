import { describe, expect, it } from "vitest";
import { withDeadline } from "./with-deadline";

const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("withDeadline", () => {
  it("rejects with the message when the work outlasts the deadline", async () => {
    await expect(
      withDeadline(after(200, "late"), 10, "Read timed out"),
    ).rejects.toThrow("Read timed out");
  });

  it("waits for the work with no deadline", async () => {
    // Node fires a timer past 2^31-1 ms at once: an uncapped Infinity rejects.
    await expect(
      withDeadline(after(20, "done"), Number.POSITIVE_INFINITY, "timed out"),
    ).resolves.toBe("done");
  });
});
