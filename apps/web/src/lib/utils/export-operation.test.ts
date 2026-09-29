import { describe, expect, it } from "vitest";
import { awaitExportStep } from "./export-operation";

describe("awaitExportStep", () => {
  it("returns normal results and preserves failures", async () => {
    const signal = new AbortController().signal;
    await expect(awaitExportStep(Promise.resolve(7), signal)).resolves.toBe(7);
    await expect(
      awaitExportStep(Promise.reject(new Error("step")), signal),
    ).rejects.toThrow("step");
  });
  it("rejects already aborted work while consuming late rejection", async () => {
    await expect(
      awaitExportStep(
        Promise.reject(new Error("late")),
        AbortSignal.abort(new Error("deadline")),
      ),
    ).rejects.toThrow("deadline");
  });
  it("stops waiting when aborted", async () => {
    const controller = new AbortController();
    const pending = awaitExportStep(new Promise(() => {}), controller.signal);
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
  });
});
