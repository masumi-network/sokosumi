import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createXSubscriptionTierCache,
  resolveXSubscriptionType,
  X_SUBSCRIPTION_CACHE_TTL_MS,
  X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS,
} from "./x-subscription-tier.service";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { projectSocialConnection: { update: mocks.update } },
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
  let cache: ReturnType<typeof createXSubscriptionTierCache>;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    cache = createXSubscriptionTierCache();
    mocks.create.mockResolvedValue("session");
    mocks.execute.mockResolvedValue({ subscription_type: "Premium" });
    mocks.remove.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue({});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([null, "None", "Basic"])(
    "looks up and stores Premium for a stored tier of %s",
    async (stored) => {
      expect(
        await resolveXSubscriptionType(
          { ...connection, subscriptionType: stored },
          { cache },
        ),
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
      await resolveXSubscriptionType(
        { ...connection, subscriptionType: "Premium" },
        { cache },
      ),
    ).toBe("None");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: connection.id },
      data: { subscriptionType: "None" },
    });
  });

  it("does not write an unchanged tier", async () => {
    await resolveXSubscriptionType(
      { ...connection, subscriptionType: "Premium" },
      { cache },
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([null, "Premium"])(
    "falls back to %s on failure, logs safely, and does not cache failures",
    async (stored) => {
      mocks.execute.mockRejectedValue(new Error("token=secret"));
      const input = { ...connection, subscriptionType: stored };
      expect(await resolveXSubscriptionType(input, { cache })).toBe(stored);
      expect(await resolveXSubscriptionType(input, { cache })).toBe(stored);
      expect(mocks.execute).toHaveBeenCalledTimes(2);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        "[x-subscription-tier] Subscription lookup failed",
        { connectionId: connection.id, aborted: false },
      );
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        "secret",
      );
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
      mocks.execute.mockResolvedValue(payload);
      expect(
        await resolveXSubscriptionType(
          { ...connection, subscriptionType: "Basic" },
          { cache },
        ),
      ).toBe("Basic");
      expect(mocks.update).not.toHaveBeenCalled();
      expect(cache.successful.size).toBe(0);
      expect(console.warn).toHaveBeenCalledWith(
        "[x-subscription-tier] Invalid subscription response",
        { connectionId: connection.id },
      );
    },
  );

  it("aborts at three seconds and keeps the stored tier", async () => {
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
    const result = resolveXSubscriptionType(
      { ...connection, subscriptionType: "Premium" },
      { cache },
    );
    await vi.advanceTimersByTimeAsync(X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS);
    expect(await result).toBe("Premium");
    expect(AbortSignal.timeout).toHaveBeenCalledWith(3_000);
    expect(console.warn).toHaveBeenCalledWith(
      "[x-subscription-tier] Subscription lookup failed",
      { connectionId: connection.id, aborted: true },
    );
    expect(cache.successful.size).toBe(0);
  });

  it("deduplicates simultaneous lookups and expires successful entries after 60 seconds", async () => {
    expect(
      await Promise.all([
        resolveXSubscriptionType(connection, { cache }),
        resolveXSubscriptionType(connection, { cache }),
      ]),
    ).toEqual(["Premium", "Premium"]);
    await vi.advanceTimersByTimeAsync(X_SUBSCRIPTION_CACHE_TTL_MS - 1);
    await resolveXSubscriptionType(connection, { cache });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolveXSubscriptionType(connection, { cache });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("forces a fresh lookup when publishing within the cache window", async () => {
    await resolveXSubscriptionType(connection, { cache });
    mocks.execute.mockResolvedValue({ subscription_type: "None" });
    expect(
      await resolveXSubscriptionType(
        { ...connection, subscriptionType: "Premium" },
        { cache, refresh: true },
      ),
    ).toBe("None");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("does not look up non-X accounts", async () => {
    expect(
      await resolveXSubscriptionType(
        { ...connection, provider: "linkedin" },
        { cache },
      ),
    ).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps posting available when storing the refreshed tier fails", async () => {
    mocks.update.mockRejectedValue(new Error("Database unavailable"));
    expect(
      await resolveXSubscriptionType(
        { ...connection, subscriptionType: "Basic" },
        { cache },
      ),
    ).toBe("Basic");
    expect(console.warn).toHaveBeenCalledWith(
      "[x-subscription-tier] Could not store subscription tier",
      { connectionId: connection.id },
    );
  });
});
