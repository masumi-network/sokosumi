import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isExpectedAblyChannelLifecycleError,
  safeDetachChannel,
  safeSubscribeChannel,
} from "./safe-detach-channel";

describe("isExpectedAblyChannelLifecycleError", () => {
  it("matches attach/detach supersede messages", () => {
    expect(
      isExpectedAblyChannelLifecycleError(
        new Error("Attach request superseded by a subsequent detach request"),
      ),
    ).toBe(true);
    expect(
      isExpectedAblyChannelLifecycleError(
        new Error("Detach request superseded by a subsequent attach request"),
      ),
    ).toBe(true);
  });

  it("matches channel detached, timeout, and failed state", () => {
    expect(
      isExpectedAblyChannelLifecycleError(new Error("Channel detached")),
    ).toBe(true);
    expect(
      isExpectedAblyChannelLifecycleError(
        new Error("Channel detach timed out"),
      ),
    ).toBe(true);
    expect(
      isExpectedAblyChannelLifecycleError(
        new Error("Channel operation failed as channel state is failed"),
      ),
    ).toBe(true);
  });

  it("matches Ably ErrorInfo 90000/409 without relying on message", () => {
    expect(
      isExpectedAblyChannelLifecycleError({
        message: "something else",
        code: 90000,
        statusCode: 409,
      }),
    ).toBe(true);
  });

  it("matches connection-unavailable and network-unreachable give-up", () => {
    expect(
      isExpectedAblyChannelLifecycleError(
        new Error("Connection to server unavailable"),
      ),
    ).toBe(true);
    expect(
      isExpectedAblyChannelLifecycleError(
        new Error("Unable to connect (network unreachable)"),
      ),
    ).toBe(true);
    expect(
      isExpectedAblyChannelLifecycleError({
        message: "something else",
        code: 80003,
        statusCode: 404,
      }),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(
      isExpectedAblyChannelLifecycleError(new Error("Failed to parse payload")),
    ).toBe(false);
    expect(isExpectedAblyChannelLifecycleError(new Error("Unauthorized"))).toBe(
      false,
    );
  });
});

describe("safeDetachChannel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows expected lifecycle rejections without logging", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const channel = {
      detach: vi
        .fn()
        .mockRejectedValue(
          new Error("Attach request superseded by a subsequent detach request"),
        ),
    };

    safeDetachChannel(channel);
    await vi.waitFor(() => {
      expect(channel.detach).toHaveBeenCalledTimes(1);
    });
    // Allow microtask queue to flush the catch handler.
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs unexpected detach failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unexpected = new Error("network ACL misconfigured");
    const channel = {
      detach: vi.fn().mockRejectedValue(unexpected),
    };

    safeDetachChannel(channel);
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Ably channel detach failed",
        unexpected,
      );
    });
  });

  it("handles synchronous detach throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const channel = {
      detach: vi.fn(() => {
        throw new Error("Channel detached");
      }),
    };

    expect(() => safeDetachChannel(channel)).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("safeSubscribeChannel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows network-unreachable subscribe rejections without logging", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const networkError = Object.assign(
      new Error("Unable to connect (network unreachable)"),
      { code: 80003, statusCode: 404 },
    );
    const listener = vi.fn();
    const channel = {
      subscribe: vi.fn().mockRejectedValue(networkError),
    };

    safeSubscribeChannel(channel, "chat_membership_revoked", listener);
    await vi.waitFor(() => {
      expect(channel.subscribe).toHaveBeenCalledWith(
        "chat_membership_revoked",
        listener,
      );
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs unexpected subscribe failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unexpected = new Error("Unauthorized to subscribe");
    const listener = vi.fn();
    const channel = {
      subscribe: vi.fn().mockRejectedValue(unexpected),
    };

    safeSubscribeChannel(channel, "chat_membership_revoked", listener);
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Ably channel subscribe failed",
        unexpected,
      );
    });
  });

  it("handles synchronous subscribe throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const channel = {
      subscribe: vi.fn(() => {
        throw new Error("Unable to connect (network unreachable)");
      }),
    };

    expect(() =>
      safeSubscribeChannel(channel, "chat_membership_revoked", vi.fn()),
    ).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
