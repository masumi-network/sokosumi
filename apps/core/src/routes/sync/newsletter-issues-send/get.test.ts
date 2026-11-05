import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { SyncExecutionContext } from "../handler";
import mount from "./get";

const m = vi.hoisted(() => ({
  sendDue: vi.fn(),
  handler: vi.fn(),
  shouldContinue: () => true,
}));
vi.mock("@/services/newsletter-send.service", () => ({
  sendDueNewsletterIssues: m.sendDue,
}));
vi.mock("../handler.js", () => ({ handleSyncRequest: m.handler }));

describe("GET /sync/newsletter-issues-send", () => {
  it("runs the newsletter scheduler under the cron lock and deadline", async () => {
    const controller = new AbortController();
    m.handler.mockImplementation(
      async (
        _c: unknown,
        _lockKey: string,
        operation: (context: SyncExecutionContext) => Promise<void>,
      ) => {
        await operation({
          shouldContinue: m.shouldContinue,
          abortSignal: controller.signal,
          deadlineMs: Date.now() + 60_000,
          msRemaining: () => 60_000,
        });
        return new Response("Syncing started");
      },
    );
    const app = new Hono();
    mount(app);
    expect(
      (await app.request("http://localhost/newsletter-issues-send")).status,
    ).toBe(200);
    expect(m.handler).toHaveBeenCalledWith(
      expect.anything(),
      "newsletter-issues-send-sync",
      expect.any(Function),
    );
    expect(m.sendDue).toHaveBeenCalledExactlyOnceWith({
      shouldContinue: m.shouldContinue,
    });
  });
});
