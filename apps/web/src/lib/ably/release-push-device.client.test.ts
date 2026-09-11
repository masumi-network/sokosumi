import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { countPushTeardowns, queuePushWork } from "./push-work-queue.client";
import {
  dropBrowserPushSubscriptionOnAccountDeletion,
  notePushTeardownStarted,
  releasePushDeviceOnSignOut,
} from "./release-push-device.client";

const deactivatePushMock = vi.fn();
const dropBrowserPushSubscriptionMock = vi.fn();
const hasWebPushSubscriptionMock = vi.fn();
const isPushSupportedMock = vi.fn();

vi.mock("./push-activation.client", () => ({
  deactivatePush: (...args: unknown[]) => deactivatePushMock(...args),
  dropBrowserPushSubscription: () => dropBrowserPushSubscriptionMock(),
}));

vi.mock("@/lib/utils/notification-service-worker", () => ({
  hasWebPushSubscription: () => hasWebPushSubscriptionMock(),
  isPushSupported: () => isPushSupportedMock(),
}));

describe("releasePushDeviceOnSignOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    isPushSupportedMock.mockReturnValue(true);
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    deactivatePushMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // The console spy below is installed inside one test. A failed assertion
    // leaves it in place, and every later test in the file then reports into a
    // stub instead of the console. Same for the fake timers.
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Web Push needs no session, so a registration left behind keeps rendering
   * the previous reader's chat mentions to whoever uses the browser next.
   */
  it("drops the registration this browser holds", async () => {
    await releasePushDeviceOnSignOut("user_1");

    expect(deactivatePushMock).toHaveBeenCalledWith("user_1");
  });

  /**
   * Both registration reads are local. A reader who never turned push on must
   * not pay for the Ably SDK on their way out.
   */
  it("loads nothing for a browser that never subscribed", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);

    await releasePushDeviceOnSignOut("user_1");

    expect(deactivatePushMock).not.toHaveBeenCalled();
  });

  /**
   * Turning push on clears the subscription and the token halfway through, so
   * both reads say this browser never had push while a run is busy giving it
   * one. A sign-out that believed them would leave that run to finish behind
   * the reader and subscribe the browser they just signed out of.
   */
  it("releases a browser whose push state is being changed right now", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);
    let finishActivation = () => {};
    const activation = queuePushWork(
      () =>
        new Promise<void>((resolve) => {
          finishActivation = resolve;
        }),
    );

    await releasePushDeviceOnSignOut("user_1");

    expect(deactivatePushMock).toHaveBeenCalledWith("user_1");

    // Left running, the queue would report work pending for every test after
    // this one, and the read above would never be reached again.
    finishActivation();
    await activation;
  });

  /**
   * The browser subscription and Ably's registration come apart: a
   * subscription dies on its own while the registration stays. That device is
   * still subscribed to this reader's notifications channel, and the next
   * reader's activation reuses the same id and adds their channel beside it.
   *
   * The value is written the way Ably really writes it: the token is a bare
   * string (`ably/build/push.js:839`), JSON-encoded once on persist (`:412`),
   * then wrapped in `{ value }` by the storage adapter
   * (`ably/build/ably.js:9616-9620`).
   */
  it("releases a device Ably still holds after the subscription died", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );

    await releasePushDeviceOnSignOut("user_1");

    expect(deactivatePushMock).toHaveBeenCalledWith("user_1");
  });

  /**
   * `deactivate()` removes the identity token but mints a fresh
   * `ably.push.deviceId` on its way out (`ably/build/push.js:419-423`). Gating
   * on the id would make every later sign-out build a client and mint a token
   * only to fail without the token.
   */
  it("loads nothing for a browser Ably has already deregistered", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);
    localStorage.setItem(
      "ably.push.deviceId",
      JSON.stringify({ value: "device_1" }),
    );

    await releasePushDeviceOnSignOut("user_1");

    expect(deactivatePushMock).not.toHaveBeenCalled();
  });

  /**
   * The token is what the repair on open reads to decide that a browser with
   * no subscription once had one. A release the cap cut short, or one Ably
   * refused, would otherwise leave the token behind and the next open would
   * subscribe this browser again, for whoever signs in next.
   */
  it("forgets the registration even when the release never landed", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );
    deactivatePushMock.mockRejectedValue(new Error("Ably unreachable"));

    await releasePushDeviceOnSignOut("user_1");

    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });

  it("reads nothing on a browser that cannot push at all", async () => {
    isPushSupportedMock.mockReturnValue(false);

    await releasePushDeviceOnSignOut("user_1");

    expect(hasWebPushSubscriptionMock).not.toHaveBeenCalled();
    expect(deactivatePushMock).not.toHaveBeenCalled();
  });

  it("does nothing without a session user", async () => {
    await releasePushDeviceOnSignOut(undefined);

    expect(isPushSupportedMock).not.toHaveBeenCalled();
    expect(deactivatePushMock).not.toHaveBeenCalled();
  });

  /**
   * Ably gives each of its two REST calls a 10s timeout on top of 15s of
   * fallback-host retries, so a captive portal or an Ably incident would hold
   * the reader on a disabled Log out button for about half a minute.
   */
  it("lets the sign-out go when the release hangs", async () => {
    vi.useFakeTimers();
    deactivatePushMock.mockReturnValue(new Promise(() => {}));

    const released = releasePushDeviceOnSignOut("user_1");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(released).resolves.toBeUndefined();
  });

  /**
   * The cap can let the sign-out go first, so the rejection lands with the
   * race already settled. Without its own handler it would be unhandled.
   */
  it("logs a rejection that lands after the cap", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("ably said no");
    let failRelease: (error: unknown) => void = () => {};
    deactivatePushMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        failRelease = reject;
      }),
    );

    const released = releasePushDeviceOnSignOut("user_1");
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(released).resolves.toBeUndefined();

    failRelease(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(logged).toHaveBeenCalledWith(
      "Failed to release the push device on sign out",
      reason,
    );
  });

  /**
   * Signing out must not fail because Ably did. The reader still leaves; the
   * registration stays, and the settings switch can still clear it.
   */
  it("lets the sign-out continue when deactivation fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("ably said no");
    deactivatePushMock.mockRejectedValue(reason);

    await expect(releasePushDeviceOnSignOut("user_1")).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      "Failed to release the push device on sign out",
      reason,
    );
  });
});

describe("dropBrowserPushSubscriptionOnAccountDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPushSupportedMock.mockReturnValue(true);
    hasWebPushSubscriptionMock.mockResolvedValue(true);
    dropBrowserPushSubscriptionMock.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * The account row is gone, but the browser keeps the subscription the
   * account page reads. The next reader to sign in here would find the Push
   * cell on over a subscription that belongs to a deleted account.
   */
  it("drops the subscription this browser holds", async () => {
    await dropBrowserPushSubscriptionOnAccountDeletion();

    expect(dropBrowserPushSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  /**
   * A token beside a browser with no subscription is the one shape
   * `healPushSubscription` reads as a subscription that died by itself, and it
   * answers that by subscribing again. Left behind by a deletion, the next
   * page this browser opens would turn push back on for an account that no
   * longer exists.
   */
  it("forgets the registration, which the repair would otherwise act on", async () => {
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );

    await dropBrowserPushSubscriptionOnAccountDeletion();

    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });

  /**
   * Deactivation mints an Ably token, and the session died with the account.
   * Only the half that needs no session is left, and that is the half that
   * stops delivery.
   */
  it("does not try the Ably half, which has no session left", async () => {
    await dropBrowserPushSubscriptionOnAccountDeletion();

    expect(deactivatePushMock).not.toHaveBeenCalled();
  });

  /**
   * The repair reads the token, then awaits twice before it activates: the
   * subscription read and the chunk fetch its import needs. A deletion landing
   * inside either window is past the read the repair already did, so the
   * counter is the only thing left that can stop it activating over an account
   * that is gone.
   */
  it("counts the teardown, which a repair already past its read reads", async () => {
    const before = countPushTeardowns();

    await dropBrowserPushSubscriptionOnAccountDeletion();

    expect(countPushTeardowns()).toBe(before + 1);
  });

  /**
   * The reader's subscription had already died on its own, so the deletion
   * reads a browser with nothing to unsubscribe. That is not a browser to
   * skip: it is the exact shape the repair acts on, token and all. Whoever
   * signs in on it next would have push turned on for them over a device
   * record belonging to an account that no longer exists.
   */
  it("forgets the registration of a browser whose subscription already died", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );

    await dropBrowserPushSubscriptionOnAccountDeletion();

    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });

  it("loads nothing for a browser that never subscribed", async () => {
    hasWebPushSubscriptionMock.mockResolvedValue(false);

    await dropBrowserPushSubscriptionOnAccountDeletion();

    expect(dropBrowserPushSubscriptionMock).not.toHaveBeenCalled();
  });

  it("reads nothing on a browser that cannot push at all", async () => {
    isPushSupportedMock.mockReturnValue(false);

    await dropBrowserPushSubscriptionOnAccountDeletion();

    expect(hasWebPushSubscriptionMock).not.toHaveBeenCalled();
    expect(dropBrowserPushSubscriptionMock).not.toHaveBeenCalled();
  });

  /**
   * The dynamic import has to fetch the chunk that carries the Ably SDK. The
   * account is already deleted, so a reader held on that fetch would sit on
   * the account page of an account that no longer exists.
   */
  it("lets the reader go when the release hangs", async () => {
    vi.useFakeTimers();
    dropBrowserPushSubscriptionMock.mockReturnValue(new Promise(() => {}));

    const released = dropBrowserPushSubscriptionOnAccountDeletion();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(released).resolves.toBeUndefined();
  });

  /**
   * The cap lets the reader go first, so the rejection lands with the outer
   * `try` already over. Without a handler on the release itself it would be
   * unhandled. A chunk fetch that 404s after a deploy rotated its hash is the
   * way to get one.
   */
  it("logs a rejection that lands after the cap", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("the chunk is gone");
    let failRelease: (error: unknown) => void = () => {};
    dropBrowserPushSubscriptionMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        failRelease = reject;
      }),
    );

    const released = dropBrowserPushSubscriptionOnAccountDeletion();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(released).resolves.toBeUndefined();

    failRelease(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(logged).toHaveBeenCalledWith(
      "Failed to release the push device after account deletion",
      reason,
    );
  });

  /**
   * The account is already deleted, so there is nothing to fail back to. The
   * reader still has to reach the success toast and leave the page.
   */
  it("returns when the unsubscribe fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new Error("the browser said no");
    dropBrowserPushSubscriptionMock.mockRejectedValue(reason);

    await expect(
      dropBrowserPushSubscriptionOnAccountDeletion(),
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      "Failed to release the push device after account deletion",
      reason,
    );
  });
});

describe("notePushTeardownStarted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  /**
   * A full storage refuses the write and still answers every read, so the
   * token would sit there with nothing to say it is on its way out, and the
   * repair on the next page would read it as a subscription to restore.
   */
  it("drops the registration when the note cannot be written", () => {
    localStorage.setItem(
      "ably.push.deviceIdentityToken",
      JSON.stringify({ value: JSON.stringify("tok_1") }),
    );
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    notePushTeardownStarted();

    expect(localStorage.getItem("ably.push.deviceIdentityToken")).toBeNull();
  });
});
