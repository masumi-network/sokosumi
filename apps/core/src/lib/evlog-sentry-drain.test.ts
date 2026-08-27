import { afterEach, describe, expect, it, vi } from "vitest";

import { coreEvlogDrain } from "@/lib/evlog";

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
});
