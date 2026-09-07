import { createLogger } from "evlog";
import { afterEach, describe, expect, it, vi } from "vitest";

import { coreEvlogDrain, initCoreLogger } from "@/lib/evlog";

const createSentryDrainMock = vi.hoisted(() => vi.fn());

vi.mock("evlog/sentry", () => ({
  createSentryDrain: createSentryDrainMock,
}));

describe("coreEvlogDrain", () => {
  const previousDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (previousDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = previousDsn;
    }
    createSentryDrainMock.mockReset();
  });

  it("omits a drain when SENTRY_DSN is unset", () => {
    delete process.env.SENTRY_DSN;

    expect(coreEvlogDrain()).toBeUndefined();
    expect(createSentryDrainMock).not.toHaveBeenCalled();
  });

  it("creates the Sentry drain when SENTRY_DSN is set", () => {
    const drain = vi.fn();
    createSentryDrainMock.mockReturnValue(drain);
    process.env.SENTRY_DSN = "https://key@o0.ingest.sentry.io/1";

    expect(coreEvlogDrain()).toBe(drain);
    expect(createSentryDrainMock).toHaveBeenCalledTimes(1);
  });

  it("initCoreLogger without a drain option uses the Sentry drain", async () => {
    const drain = vi.fn();
    createSentryDrainMock.mockReturnValue(drain);
    process.env.SENTRY_DSN = "https://key@o0.ingest.sentry.io/1";

    initCoreLogger({ silent: true });
    createLogger({ chat: { kind: "coworker_channel_mention" } }).emit();
    await Promise.resolve();

    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          chat: { kind: "coworker_channel_mention" },
        }),
      }),
    );
  });
});
