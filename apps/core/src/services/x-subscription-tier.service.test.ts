import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { causeMessage, expectCoreLog } from "@/test/core-log";
import { inRequest } from "@/test/in-request";
import {
  resolveProjectXSubscriptionTypes,
  resolveXSubscriptionType,
  X_SUBSCRIPTION_LOOKUP_MAX_ACCOUNTS,
  X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS,
} from "./x-subscription-tier.service";

const LOOKUP_FIX =
  "Nothing to do for one miss: posting uses the stored tier and the next post checks again. If it repeats, check the account's X connection in Composio.";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: { update: mocks.update, findMany: mocks.findMany },
  },
}));
vi.mock("@/clients/composio.client", () => ({
  deleteComposioToolSession: mocks.remove,
}));
vi.mock("@/clients/social-post-providers/tools", () => ({
  createComposioToolSession: mocks.create,
  executeComposioTool: mocks.execute,
}));
vi.mock("@/services/project-social-connections.service", () => ({
  projectExecutorUserId: (id: string) => `sokosumi:project-executor:${id}`,
}));

const connection = {
  id: "connection",
  projectId: "project",
  provider: "x",
  composioConnectedAccountId: "ca_123",
  subscriptionType: null as string | null,
};

describe("resolveXSubscriptionType", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.create.mockResolvedValue("session");
    mocks.execute.mockResolvedValue({ subscription_type: "Premium" });
    mocks.remove.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([null, "None", "Basic"])(
    "looks up and stores Premium for a stored tier of %s",
    async (stored) => {
      expect(
        await resolveXSubscriptionType({
          ...connection,
          subscriptionType: stored,
        }),
      ).toBe("Premium");
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectedAccountId: "ca_123",
          executorUserId: "sokosumi:project-executor:project",
          toolkitSlug: "twitter",
          toolSlugs: ["TWITTER_USER_LOOKUP_ME"],
          signal: expect.any(AbortSignal),
        }),
      );
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          toolSlug: "TWITTER_USER_LOOKUP_ME",
          arguments: { user_fields: ["subscription_type"] },
        }),
      );
      expect(mocks.update).toHaveBeenCalledWith({
        where: { id: connection.id },
        data: { subscriptionType: "Premium" },
      });
      expect(mocks.remove).toHaveBeenCalledWith(
        "session",
        expect.any(String),
        expect.any(AbortSignal),
      );
    },
  );

  it("persists a Premium to None downgrade", async () => {
    mocks.execute.mockResolvedValue({ subscription_type: "None" });
    expect(
      await resolveXSubscriptionType({
        ...connection,
        subscriptionType: "Premium",
      }),
    ).toBe("None");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: connection.id },
      data: { subscriptionType: "None" },
    });
  });

  it("rechecks the tier on consecutive interactions without waiting", async () => {
    await resolveXSubscriptionType(connection);
    mocks.execute.mockResolvedValue({ subscription_type: "None" });
    expect(
      await resolveXSubscriptionType({
        ...connection,
        subscriptionType: "Premium",
      }),
    ).toBe("None");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("does not write an unchanged tier", async () => {
    await resolveXSubscriptionType({
      ...connection,
      subscriptionType: "Premium",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([null, "Premium"])(
    "falls back to %s on failure, logs safely, and does not cache failures",
    async (stored) => {
      const warnings = expectCoreLog(
        "warn",
        "Could not read an X account's subscription tier",
        2,
      );
      mocks.execute.mockRejectedValue(new Error("token=secret"));
      const input = { ...connection, subscriptionType: stored };
      expect(await resolveXSubscriptionType(input)).toBe(stored);
      expect(await resolveXSubscriptionType(input)).toBe(stored);
      expect(mocks.execute).toHaveBeenCalledTimes(2);
      expect(mocks.update).not.toHaveBeenCalled();
      for (const warning of warnings) {
        expect(warning).toMatchObject({
          why: "X's account lookup failed",
          fix: LOOKUP_FIX,
          event: {
            operation: "x_subscription_tier",
            warnings: [
              {
                details: {
                  connection: { id: connection.id },
                  aborted: false,
                  failure: { errorName: "Error" },
                },
              },
            ],
          },
        });
        expect(warning.cause).toBeUndefined();
      }
      expect(JSON.stringify(warnings)).not.toContain("secret");
    },
  );

  it.each([
    null,
    {},
    { subscription_type: "unknown" },
    { subscription_type: null },
  ])(
    "keeps the stored tier for an unparseable response %j",
    async (payload) => {
      const warnings = expectCoreLog(
        "warn",
        "Could not read an X account's subscription tier",
      );
      mocks.execute.mockResolvedValue(payload);
      expect(
        await resolveXSubscriptionType({
          ...connection,
          subscriptionType: "Basic",
        }),
      ).toBe("Basic");
      expect(mocks.update).not.toHaveBeenCalled();
      expect(warnings[0]).toMatchObject({
        why: "X's account lookup returned no known subscription tier",
        fix: LOOKUP_FIX,
        event: {
          warnings: [{ details: { connection: { id: connection.id } } }],
        },
      });
      expect(warnings[0]?.cause).toBeUndefined();
    },
  );

  it("aborts at three seconds and keeps the stored tier", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not read an X account's subscription tier",
    );
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        ms,
      );
      return controller.signal;
    });
    mocks.execute.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const result = resolveXSubscriptionType({
      ...connection,
      subscriptionType: "Premium",
    });
    await vi.advanceTimersByTimeAsync(X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS);
    expect(await result).toBe("Premium");
    expect(AbortSignal.timeout).toHaveBeenCalledWith(3_000);
    expect(warnings[0]).toMatchObject({
      why: "X's account lookup did not answer within 3 seconds",
      fix: LOOKUP_FIX,
      event: {
        warnings: [
          { details: { connection: { id: connection.id }, aborted: true } },
        ],
      },
    });
    expect(warnings[0]?.cause).toBeUndefined();
  });

  it.each([
    [
      "the lookup timeout, then the caller",
      "timeout",
      "X's account lookup did not answer within 3 seconds",
    ],
    [
      "the caller, then the lookup timeout",
      "caller",
      "The caller stopped the lookup before X answered",
    ],
  ])("blames whichever aborted first: %s", async (_order, first, why) => {
    const warnings = expectCoreLog(
      "warn",
      "Could not read an X account's subscription tier",
    );
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        ms,
      );
      return controller.signal;
    });
    // The provider settles only after both signals aborted.
    let release: (() => void) | undefined;
    mocks.execute.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          release = () => reject(signal.reason);
        }),
    );
    const caller = new AbortController();
    const result = resolveXSubscriptionType(
      { ...connection, subscriptionType: "Premium" },
      { signal: caller.signal },
    );
    await vi.advanceTimersByTimeAsync(0);
    const abortCaller = () =>
      caller.abort(
        new DOMException("Publish deadline exceeded", "TimeoutError"),
      );
    if (first === "caller") abortCaller();
    await vi.advanceTimersByTimeAsync(X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS);
    if (first === "timeout") abortCaller();
    release?.();
    expect(await result).toBe("Premium");
    expect(warnings[0]).toMatchObject({
      why,
      fix: LOOKUP_FIX,
      event: {
        warnings: [
          { details: { connection: { id: connection.id }, aborted: true } },
        ],
      },
    });
  });

  it("rechecks the tier for overlapping interactions", async () => {
    expect(
      await Promise.all([
        resolveXSubscriptionType(connection),
        resolveXSubscriptionType(connection),
      ]),
    ).toEqual(["Premium", "Premium"]);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("does not look up non-X accounts", async () => {
    expect(
      await resolveXSubscriptionType({ ...connection, provider: "linkedin" }),
    ).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["Premium", "None"],
    ["None", "Premium"],
  ])(
    "uses a fresh %s to %s change even when storing it fails",
    async (stored, fresh) => {
      const warnings = expectCoreLog(
        "warn",
        "Could not store an X account's subscription tier",
      );
      mocks.execute.mockResolvedValue({ subscription_type: fresh });
      mocks.update.mockRejectedValue(new Error("Database unavailable"));
      expect(
        await resolveXSubscriptionType({
          ...connection,
          subscriptionType: stored,
        }),
      ).toBe(fresh);
      expect(warnings[0]).toMatchObject({
        message: "Could not store an X account's subscription tier",
        why: "Updating the social connection failed",
        fix: "Nothing to do for one miss: this post uses the fresh tier and the next one looks it up again. If it repeats, read the error under warnings[].cause.",
        event: {
          warnings: [{ details: { connection: { id: connection.id } } }],
        },
      });
      expect(causeMessage(warnings[0]?.cause)).toBe("Database unavailable");
    },
  );
});

describe("resolveProjectXSubscriptionTypes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.create.mockResolvedValue("session");
    mocks.remove.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it("looks up a bounded set of active X accounts and keeps a stored tier on failure", async () => {
    expectCoreLog("warn", "Could not read an X account's subscription tier");
    mocks.findMany.mockResolvedValue([
      { ...connection, id: "premium", subscriptionType: "None" },
      { ...connection, id: "failing", subscriptionType: "Basic" },
    ]);
    mocks.execute
      .mockResolvedValueOnce({ subscription_type: "Premium" })
      .mockRejectedValueOnce(new Error("Composio down"));

    const tiers = await resolveProjectXSubscriptionTypes("project");

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project",
          provider: "x",
          status: "active",
          composioConnectedAccountId: { not: { startsWith: "eval:" } },
        },
        take: X_SUBSCRIPTION_LOOKUP_MAX_ACCOUNTS,
      }),
    );
    expect(tiers).toEqual(
      new Map([
        ["premium", "Premium"],
        ["failing", "Basic"],
      ]),
    );
  });

  it("keeps each failing account's fields on its own warning in one request", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not read an X account's subscription tier",
      2,
    );
    mocks.findMany.mockResolvedValue([
      { ...connection, id: "failing" },
      { ...connection, id: "invalid" },
    ]);
    mocks.execute
      .mockRejectedValueOnce(new Error("Composio down"))
      .mockResolvedValueOnce({ subscription_type: "unknown" });

    await inRequest(() => resolveProjectXSubscriptionTypes("project"));

    expect(warnings).toHaveLength(2);
    const event = warnings[0]?.event;
    expect(warnings[1]?.event).toBe(event);
    expect(event).not.toHaveProperty("connection");
    expect(event).not.toHaveProperty("aborted");
    expect(event).not.toHaveProperty("failure");
    expect(event?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          why: "X's account lookup failed",
          fix: LOOKUP_FIX,
          details: {
            connection: { id: "failing" },
            aborted: false,
            failure: { errorName: "Error" },
          },
        }),
        expect.objectContaining({
          why: "X's account lookup returned no known subscription tier",
          fix: LOOKUP_FIX,
          details: { connection: { id: "invalid" } },
        }),
      ]),
    );
  });
});
