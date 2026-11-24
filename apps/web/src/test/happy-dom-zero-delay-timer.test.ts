import { describe, expect, it } from "vitest";

describe("happy-dom zero-delay timer recovery after abort", () => {
  it("keeps FileReader working after happyDOM.abort() cancels a pending 0ms timer", async () => {
    const aborted = new FileReader();
    aborted.readAsText(new Blob(["pending"]));
    await window.happyDOM.abort();

    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsText(new Blob(["still-works"]));
    });

    expect(text).toBe("still-works");
  });
});
