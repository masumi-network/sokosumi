import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveXSubscriptionType,
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
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
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
      mocks.execute.mockRejectedValue(new Error("token=secret"));
      const input = { ...connection, subscriptionType: stored };
      expect(await resolveXSubscriptionType(input)).toBe(stored);
      expect(await resolveXSubscriptionType(input)).toBe(stored);
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
        await resolveXSubscriptionType({
          ...connection,
          subscriptionType: "Basic",
        }),
      ).toBe("Basic");
      expect(mocks.update).not.toHaveBeenCalled();
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
    const result = resolveXSubscriptionType({
      ...connection,
      subscriptionType: "Premium",
    });
    await vi.advanceTimersByTimeAsync(X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS);
    expect(await result).toBe("Premium");
    expect(AbortSignal.timeout).toHaveBeenCalledWith(3_000);
    expect(console.warn).toHaveBeenCalledWith(
      "[x-subscription-tier] Subscription lookup failed",
      { connectionId: connection.id, aborted: true },
    );
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
      mocks.execute.mockResolvedValue({ subscription_type: fresh });
      mocks.update.mockRejectedValue(new Error("Database unavailable"));
      expect(
        await resolveXSubscriptionType({
          ...connection,
          subscriptionType: stored,
        }),
      ).toBe(fresh);
      expect(console.warn).toHaveBeenCalledWith(
        "[x-subscription-tier] Could not store subscription tier",
        { connectionId: connection.id },
      );
    },
  );
});
