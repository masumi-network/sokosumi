import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { acquire, release } = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/clients/core.client", () => ({
  createCoreGeneratedClient: () => ({}),
}));
vi.mock("@/lib/clients/generated/core", () => ({
  acquireExportLease: acquire,
  releaseExportLease: release,
}));

import {
  awaitExportStep,
  ExportLimitError,
} from "@/lib/utils/export-operation";
import { withExportOperation } from "./export.service";

function request(signal?: AbortSignal) {
  return new Request("https://app.example/api/export/pdf", {
    method: "POST",
    signal,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  acquire.mockResolvedValue({
    data: { data: { token: "lease-token", durationMs: 100 } },
  });
  release.mockResolvedValue({ data: { data: { released: true } } });
});
afterEach(() => vi.useRealTimers());

describe("export operation", () => {
  it("releases after successful conversion without exposing the token", async () => {
    const response = await withExportOperation(
      request(),
      async () => new Response("document"),
    );
    expect(await response.text()).toBe("document");
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: "lease-token" } }),
    );
  });

  it("returns Core's 429 and Retry-After without starting conversion", async () => {
    acquire.mockResolvedValue({
      error: { message: "limit" },
      response: new Response(null, {
        status: 429,
        headers: { "Retry-After": "42" },
      }),
    });
    const convert = vi.fn();
    const response = await withExportOperation(request(), convert);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(convert).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("fails closed when admission is unavailable", async () => {
    acquire.mockRejectedValue(new Error("offline"));
    const convert = vi.fn();
    expect((await withExportOperation(request(), convert)).status).toBe(503);
    expect(convert).not.toHaveBeenCalled();
  });

  it("aborts an awaited step at the total deadline and releases after cleanup", async () => {
    const cleaned = vi.fn();
    const pending = withExportOperation(request(), async (signal) => {
      try {
        return await awaitExportStep(new Promise<Response>(() => {}), signal);
      } finally {
        expect(release).not.toHaveBeenCalled();
        cleaned();
      }
    });
    await vi.advanceTimersByTimeAsync(100);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(cleaned).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects late completion when CPU work prevents the deadline timer from firing", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      const response = await withExportOperation(request(), async () => {
        clock.mockReturnValue(101);
        return new Response("late document");
      });
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: "Export timed out" });
      expect(release).toHaveBeenCalledOnce();
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps the lease until a noncancelable converter actually settles", async () => {
    let finish: ((response: Response) => void) | undefined;
    const pending = withExportOperation(
      request(),
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(release).not.toHaveBeenCalled();
    finish?.(new Response("late document"));
    expect((await pending).status).toBe(504);
    expect(release).toHaveBeenCalledOnce();
  });

  it("cancels on disconnect and releases the acquired lease", async () => {
    const controller = new AbortController();
    const pending = withExportOperation(request(controller.signal), (signal) =>
      awaitExportStep(new Promise<Response>(() => {}), signal),
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not acquire a lease for an already canceled request", async () => {
    const response = await withExportOperation(
      request(AbortSignal.abort()),
      vi.fn(),
    );
    expect(response.status).toBe(499);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("returns a clean budget error and releases after conversion fails", async () => {
    const response = await withExportOperation(request(), async () => {
      throw new ExportLimitError("Too many images");
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Too many images" });
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves unexpected conversion failures and still releases", async () => {
    await expect(
      withExportOperation(request(), async () => {
        throw new Error("convert failed");
      }),
    ).rejects.toThrow("convert failed");
    expect(release).toHaveBeenCalledOnce();
  });
});
