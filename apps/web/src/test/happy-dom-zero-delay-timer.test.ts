import { describe, expect, it } from "vitest";

describe("happy-dom zero-delay timer recovery after abort", () => {
  it("keeps FileReader working after happyDOM.abort() cancels a pending 0ms timer", async () => {
    let abortedLoaded = false;
    const aborted = new FileReader();
    aborted.onload = () => {
      abortedLoaded = true;
    };
    aborted.readAsText(new Blob(["pending"]));
    await window.happyDOM.abort();

    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsText(new Blob(["still-works"]));
    });

    expect(abortedLoaded).toBe(false);
    expect(text).toBe("still-works");
  });

  it("preserves zero-delay batching so a microtask queued by the first postMessage runs after the second", async () => {
    const order: string[] = [];

    await new Promise<void>((resolve) => {
      const done = () => {
        if (order.length === 3) {
          window.removeEventListener("message", handleMessage);
          resolve();
        }
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.data === "A") {
          order.push("A");
          queueMicrotask(() => {
            order.push("A:microtask");
            done();
          });
        } else if (event.data === "B") {
          order.push("B");
          done();
        }
      };

      window.addEventListener("message", handleMessage);
      window.postMessage("A", "*");
      window.postMessage("B", "*");
    });

    expect(order).toEqual(["A", "B", "A:microtask"]);
  });

  it("preserves zero-delay batch ordering ahead of a 1ms timer (0a, 0b, 1ms)", async () => {
    const order: string[] = [];

    await new Promise<void>((resolve) => {
      const push = (label: string) => {
        order.push(label);
        if (order.length === 3) {
          resolve();
        }
      };

      window.frames.setTimeout(() => push("0a"), 0);
      window.frames.setTimeout(() => push("1ms"), 1);
      window.frames.setTimeout(() => push("0b"), 0);
    });

    expect(order).toEqual(["0a", "0b", "1ms"]);
  });
});
