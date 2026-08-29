import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePushPreference } from "./use-push-preference";

let queryClient: QueryClient;

/** Fresh per test, and no retries so a rejected read settles at once. */
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

const activatePushMock = vi.fn();
const deactivatePushMock = vi.fn();
const patchMyPreferencesMock = vi.fn();
const getMyPreferencesMock = vi.fn();
const getSubscriptionMock = vi.fn();
const requestPermissionMock = vi.fn();

vi.mock("./push-activation.client", () => ({
  activatePush: (...args: unknown[]) => activatePushMock(...args),
  deactivatePush: (...args: unknown[]) => deactivatePushMock(...args),
}));

vi.mock("@/lib/clients/core.preferences.browser.client", () => ({
  preferencesBrowserClient: {
    getMyPreferences: (...args: unknown[]) => getMyPreferencesMock(...args),
    patchMyPreferences: (...args: unknown[]) => patchMyPreferencesMock(...args),
  },
}));

function setNotificationPermission(permission: NotificationPermission): void {
  vi.stubGlobal(
    "Notification",
    Object.assign(function Notification() {}, {
      permission,
      // Matches the browser: a granted permission resolves without a prompt.
      requestPermission: requestPermissionMock.mockResolvedValue(permission),
    }),
  );
}

function setAccountOptIn(pushOptIn: boolean): void {
  getMyPreferencesMock.mockResolvedValue({ data: { pushOptIn } });
}

/** The DTO the write returns seeds the cache, so it drives the account row. */
function setAccountWriteResult(pushOptIn: boolean): void {
  patchMyPreferencesMock.mockResolvedValue({ data: { pushOptIn } });
}

/** Stand in for this browser holding, or not holding, a Web Push subscription. */
function setDeviceSubscribed(subscribed: boolean): void {
  getSubscriptionMock.mockResolvedValue(subscribed ? { endpoint: "e" } : null);
}

describe("usePushPreference", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Reset, not clear: `mockClear` keeps a queued `mockReturnValueOnce`
    // (`@vitest/spy` clears that queue in `mockReset` only). One test queues a
    // read that never resolves, and a failure before it is consumed would hang
    // the next test's mount read on it and report the wrong test as broken.
    vi.resetAllMocks();
    setNotificationPermission("granted");
    vi.stubGlobal("PushManager", function PushManager() {});
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        // `hasWebPushSubscription` reads the registration; it never creates one.
        getRegistration: async () => ({
          pushManager: { getSubscription: getSubscriptionMock },
        }),
      },
    });
    setDeviceSubscribed(false);
    // Both calls really move what the browser holds, and `activatePush` throws
    // rather than resolve over a browser that created no subscription. The
    // device row ends every save on a read, so the fixtures have to move the
    // thing being read.
    activatePushMock.mockImplementation(async () => {
      setDeviceSubscribed(true);
    });
    deactivatePushMock.mockImplementation(async () => {
      setDeviceSubscribed(false);
    });
    setAccountWriteResult(true);
    setAccountOptIn(false);
  });

  it("registers the device, then records the account opt-in", async () => {
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));

    let subscribedHere: boolean | undefined;
    await act(async () => {
      subscribedHere = await result.current.setAccountEnabled(true);
    });

    // The view reports the write by this value, so pin it on the path that
    // does subscribe as well as on the ones that do not.
    expect(subscribedHere).toBe(true);
    expect(activatePushMock).toHaveBeenCalledWith("user_1");
    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: true });
    expect(activatePushMock.mock.invocationCallOrder[0]).toBeLessThan(
      patchMyPreferencesMock.mock.invocationCallOrder[0] as number,
    );
    expect(result.current.isAccountEnabled).toBe(true);
    // Turning consent on subscribes this browser too, so the common case
    // stays one gesture.
    expect(result.current.isDeviceEnabled).toBe(true);
  });

  it("opens the permission prompt before anything awaits", async () => {
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.setAccountEnabled(true);
    });

    // Asserted without awaiting: the prompt has to open in the click that
    // asked for it. Ably requests it only after `loadPushActivation` fetches
    // its chunk, and a prompt one await later is no longer the reader's own
    // interaction.
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await pending;
    });
  });

  /**
   * The account row cannot move until its write lands, so a device row that
   * moved first would sit checked beside its own "push is off for your
   * account" for as long as the reader leaves the prompt open.
   *
   * Both edges of that window are asserted, and neither on the end state: the
   * read that ends the save reaches the same end state on its own. What is
   * pinned here is that the row moves on the answer. Not before it, and not
   * as late as the consent write.
   */
  it("holds the device row until the reader answers the prompt", async () => {
    setNotificationPermission("default");
    let answerPrompt!: (permission: NotificationPermission) => void;
    requestPermissionMock.mockReturnValue(
      new Promise((resolve) => {
        answerPrompt = resolve;
      }),
    );
    // Held open, so the row can be read after the subscription exists and
    // before the save ends. Core is a round trip away; the answer is not.
    let landAccountWrite!: () => void;
    patchMyPreferencesMock.mockReturnValue(
      new Promise((resolve) => {
        landAccountWrite = () => resolve({ data: { pushOptIn: true } });
      }),
    );
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.setAccountEnabled(true);
    });

    expect(result.current.isDeviceEnabled).toBe(false);
    expect(result.current.isAccountEnabled).toBe(false);

    // The browser records the answer before it resolves the request.
    setNotificationPermission("granted");
    act(() => {
      answerPrompt("granted");
    });

    // The consent write starting means the subscription landed, so the row is
    // painted from that and not from the read the held write is still holding.
    await waitFor(() => expect(patchMyPreferencesMock).toHaveBeenCalled());
    expect(result.current.isDeviceEnabled).toBe(true);
    expect(result.current.isAccountEnabled).toBe(false);

    await act(async () => {
      landAccountWrite();
      await pending;
    });
  });

  /**
   * Granting the permission fires a permission change, and that refresh reads
   * the browser while the activation that asked for the permission is still
   * running. It finds no subscription yet.
   *
   * Asserted while the activation is still open, not only after it. The end
   * state was already right; what the reader saw was the switch they had just
   * clicked turning itself back off for the length of the activation, beside a
   * toast saying push was on.
   */
  it("keeps the device row on while the save that owns it runs", async () => {
    setAccountOptIn(true);
    setNotificationPermission("default");
    let finishActivation: () => void = () => {};
    const activation = new Promise<void>((resolve) => {
      finishActivation = resolve;
    });
    requestPermissionMock.mockImplementation(async () => {
      // The reader allows, and the browser fires the permission change while
      // the activation that asked for it has not subscribed anything yet.
      setNotificationPermission("granted");
      window.dispatchEvent(new Event("focus"));
      return "granted";
    });
    activatePushMock.mockImplementation(async () => {
      await activation;
      setDeviceSubscribed(true);
    });
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleDevice).toBe(true));

    let save: Promise<unknown> | undefined;
    await act(async () => {
      save = result.current.setDeviceEnabled(true);
      // Long enough for the refresh to have read the browser and painted, if
      // the save did not hold the row.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.isDeviceEnabled).toBe(true);

    await act(async () => {
      finishActivation();
      await save;
    });

    expect(activatePushMock).toHaveBeenCalledWith("user_1");
    expect(result.current.isDeviceEnabled).toBe(true);
  });

  /**
   * The refresh's read is issued first and can still answer last. It carries
   * the browser as it stood before the activation subscribed it, so letting it
   * write would undo the read the save ended on, whichever order they land in.
   */
  it("ignores a browser read a newer one has already answered", async () => {
    setAccountOptIn(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleDevice).toBe(true));

    // Two refreshes overlap, with no save in sight. The first is held open, so
    // it answers with the browser as it stood before the second one looked.
    let landStaleRead: () => void = () => {};
    const staleRead = new Promise((resolve) => {
      landStaleRead = () => resolve(null);
    });
    getSubscriptionMock.mockReturnValueOnce(staleRead);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    setDeviceSubscribed(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.isDeviceEnabled).toBe(true));

    await act(async () => {
      landStaleRead();
      await staleRead;
    });

    expect(result.current.isDeviceEnabled).toBe(true);
  });

  /**
   * An account save holds the device row too, and a refresh it suppresses is
   * deferred, not dropped. Nothing in the account path paints the row itself
   * when consent goes off, so without a read at the end the row would sit
   * checked beside its own "not available in this browser" until the reader
   * left the window and came back a second time.
   */
  it("re-reads the device row after an account save that suppressed one", async () => {
    setAccountOptIn(true);
    setDeviceSubscribed(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isDeviceEnabled).toBe(true));

    patchMyPreferencesMock.mockImplementation(async () => {
      // The reader revokes the permission in browser settings and comes back
      // while the consent write is still in flight. Revoking takes the
      // subscription with it.
      setNotificationPermission("denied");
      setDeviceSubscribed(false);
      window.dispatchEvent(new Event("focus"));
      return { data: { pushOptIn: false } };
    });

    await act(async () => {
      await result.current.setAccountEnabled(false);
    });

    expect(result.current.isBlocked).toBe(true);
    expect(result.current.isDeviceEnabled).toBe(false);
  });

  /**
   * The device-row mirror of the account case below. `subscribeThisBrowser`
   * reports success as soon as `activatePush` resolves, without reading the
   * browser again, so the row would otherwise keep the value the click asked
   * for over a browser that holds no subscription.
   */
  it("ends a device save on a read, not on what it asked for", async () => {
    setAccountOptIn(true);
    // Unlike the default fixture, this activation leaves nothing behind.
    activatePushMock.mockResolvedValue(undefined);
    setDeviceSubscribed(false);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleDevice).toBe(true));

    await act(async () => {
      await result.current.setDeviceEnabled(true);
    });

    expect(activatePushMock).toHaveBeenCalledWith("user_1");
    expect(result.current.isDeviceEnabled).toBe(false);
  });

  /**
   * A half-failed activation: Ably reported success, the browser holds no
   * subscription. Assuming the value the write asked for would leave the row
   * claiming a device that gets nothing.
   */
  it("re-reads this browser when the account write fails after it", async () => {
    // Unlike the default fixture, this activation leaves no subscription
    // behind: the browser can drop one between the activation and the read.
    activatePushMock.mockResolvedValue(undefined);
    setDeviceSubscribed(false);
    patchMyPreferencesMock.mockRejectedValue(new Error("core said no"));
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));

    await act(async () => {
      await expect(result.current.setAccountEnabled(true)).rejects.toThrow(
        "core said no",
      );
    });

    expect(activatePushMock).toHaveBeenCalledWith("user_1");
    expect(result.current.isDeviceEnabled).toBe(false);
    expect(result.current.isAccountEnabled).toBe(false);
  });

  /**
   * The reader clicked the account row, so the prompt answers for this browser
   * and nothing else. Losing their consent write with it would leave the phone
   * in their pocket silent because a laptop said no.
   */
  it("records consent anyway when the reader refuses the prompt", async () => {
    setNotificationPermission("default");
    requestPermissionMock.mockResolvedValue("denied");
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));

    let subscribedHere: boolean | undefined;
    await act(async () => {
      subscribedHere = await result.current.setAccountEnabled(true);
    });

    expect(subscribedHere).toBe(false);
    expect(activatePushMock).not.toHaveBeenCalled();
    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: true });
    expect(result.current.isAccountEnabled).toBe(true);
    expect(result.current.isDeviceEnabled).toBe(false);
    expect(result.current.isBlocked).toBe(true);
  });

  /** The device row asks for one thing, so the same refusal fails it. */
  it("fails the device row when the reader refuses the prompt", async () => {
    setNotificationPermission("default");
    requestPermissionMock.mockResolvedValue("denied");
    setAccountOptIn(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleDevice).toBe(true));

    await act(async () => {
      await expect(result.current.setDeviceEnabled(true)).rejects.toThrow(
        "The browser refused the notification permission",
      );
    });

    expect(activatePushMock).not.toHaveBeenCalled();
    expect(patchMyPreferencesMock).not.toHaveBeenCalled();
    expect(result.current.isDeviceEnabled).toBe(false);
  });

  it("withdraws consent without deregistering this browser", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    setAccountWriteResult(false);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isDeviceEnabled).toBe(true));

    await act(async () => {
      await result.current.setAccountEnabled(false);
    });

    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: false });
    expect(result.current.isAccountEnabled).toBe(false);
    // Registrations stay, so consent can come back without every browser
    // activating again (ADR-0022).
    expect(deactivatePushMock).not.toHaveBeenCalled();
    expect(result.current.isDeviceEnabled).toBe(true);
  });

  it("withdraws consent from a browser that never subscribed", async () => {
    // The state one switch could not reach: the row read as off, so the
    // disable path never opened, and consent stood on every other device.
    setDeviceSubscribed(false);
    setAccountOptIn(true);
    setAccountWriteResult(false);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));
    expect(result.current.isDeviceEnabled).toBe(false);

    await act(async () => {
      await result.current.setAccountEnabled(false);
    });

    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: false });
    expect(result.current.isAccountEnabled).toBe(false);
  });

  it("leaves the account opted in when only this device is turned off", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isDeviceEnabled).toBe(true));

    await act(async () => {
      await result.current.setDeviceEnabled(false);
    });

    expect(deactivatePushMock).toHaveBeenCalledWith("user_1");
    expect(patchMyPreferencesMock).not.toHaveBeenCalled();
    expect(result.current.isDeviceEnabled).toBe(false);
    expect(result.current.isAccountEnabled).toBe(true);
  });

  it("subscribes only this browser when the device row goes on", async () => {
    setDeviceSubscribed(false);
    setAccountOptIn(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleDevice).toBe(true));

    await act(async () => {
      await result.current.setDeviceEnabled(true);
    });

    expect(activatePushMock).toHaveBeenCalledWith("user_1");
    // Consent already stands, so the device row never writes to Core.
    expect(patchMyPreferencesMock).not.toHaveBeenCalled();
    expect(result.current.isDeviceEnabled).toBe(true);
  });

  it("records nothing when activation fails", async () => {
    activatePushMock.mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));

    await act(async () => {
      await expect(result.current.setAccountEnabled(true)).rejects.toThrow(
        "permission denied",
      );
    });

    expect(patchMyPreferencesMock).not.toHaveBeenCalled();
    expect(result.current.isDeviceEnabled).toBe(false);
  });

  it("locks the device row while the account is off, even when subscribed", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(false);

    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));
    expect(result.current.isAccountEnabled).toBe(false);
    // Reported honestly: this browser would wake up if consent came back.
    expect(result.current.isDeviceEnabled).toBe(true);
    // The account row is the master switch. With consent withdrawn, no device
    // receives anything, so changing this one alters nothing the reader hears.
    expect(result.current.canToggleDevice).toBe(false);
  });

  it("records consent from a browser that blocks notifications", async () => {
    // Same hole as the unsupported browser: subscribing first threw, and the
    // consent write went with it, so a blocked laptop could not wake a phone.
    setNotificationPermission("denied");
    setAccountOptIn(false);
    setAccountWriteResult(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isBlocked).toBe(true));

    let subscribedHere: boolean | undefined;
    await act(async () => {
      subscribedHere = await result.current.setAccountEnabled(true);
    });

    expect(subscribedHere).toBe(false);
    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: true });
    expect(activatePushMock).not.toHaveBeenCalled();
    expect(result.current.isAccountEnabled).toBe(true);
    // Nothing here to subscribe, so the device row stays locked.
    expect(result.current.canToggleDevice).toBe(false);
  });

  /**
   * A browser with no push API: an iOS Safari tab outside the installed web
   * app, say. The account axis is a Core write, so the reader still owns the
   * switch that silences or wakes the devices that can push. Gating it on
   * support left the reader unable to silence their phone from here.
   */
  it("silences every device from a browser that cannot push", async () => {
    Reflect.deleteProperty(globalThis, "PushManager");
    setAccountOptIn(true);
    setAccountWriteResult(false);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));
    expect(result.current.isSupported).toBe(false);
    // Nothing to subscribe here, so the device row stays locked.
    expect(result.current.canToggleDevice).toBe(false);

    await act(async () => {
      await result.current.setAccountEnabled(false);
    });

    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: false });
    expect(result.current.isAccountEnabled).toBe(false);
  });

  it("wakes the other devices from a browser that cannot push", async () => {
    Reflect.deleteProperty(globalThis, "PushManager");
    setAccountOptIn(false);
    setAccountWriteResult(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));

    await act(async () => {
      await result.current.setAccountEnabled(true);
    });

    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: true });
    // No prompt and no registration: this browser has nothing to register.
    expect(requestPermissionMock).not.toHaveBeenCalled();
    expect(activatePushMock).not.toHaveBeenCalled();
    expect(result.current.isAccountEnabled).toBe(true);
  });

  it("shows the device row off when the reader revoked the OS permission", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    setNotificationPermission("denied");

    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));
    expect(result.current.isDeviceEnabled).toBe(false);
  });

  /**
   * The reader revokes the permission in browser settings while the card is
   * open. Reading only the permission back left the row checked and disabled
   * beside its own "not available in this browser".
   */
  it("drops the device row when the reader revokes the permission live", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isDeviceEnabled).toBe(true));

    setNotificationPermission("denied");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(result.current.isDeviceEnabled).toBe(false));
    expect(result.current.isBlocked).toBe(true);
  });

  it("reports the block when the browser denies notifications", async () => {
    setNotificationPermission("denied");
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isBlocked).toBe(true));
    expect(result.current.isDeviceEnabled).toBe(false);
  });

  it("reports no block while notifications are allowed", async () => {
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));
    expect(result.current.isBlocked).toBe(false);
  });

  it("stays unusable when the account opt-in cannot be read", async () => {
    getMyPreferencesMock.mockRejectedValue(new Error("core down"));
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.canToggleAccount).toBe(false);
    expect(result.current.canToggleDevice).toBe(false);
  });

  it("shows the device row off when the browser lost its subscription", async () => {
    setAccountOptIn(true);
    setDeviceSubscribed(false);

    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggleAccount).toBe(true));
    // That the row is off says nothing on its own: it starts off. What is
    // pinned here is that the mount consulted the browser and found nothing,
    // so a subscription lost while the reader was away reads as lost.
    expect(getSubscriptionMock).toHaveBeenCalled();
    expect(result.current.isDeviceEnabled).toBe(false);
    expect(result.current.isAccountEnabled).toBe(true);
  });

  /**
   * The device row paints its own click before the work runs, so a disable
   * that removed nothing has to be taken back. Left alone, the row would say
   * this browser is out while it still holds a subscription and still shows
   * the banners.
   *
   * Asserted on the browser, not on the click: the earlier version of this
   * test had the failing disable remove the subscription too, so the value it
   * checked was the one the click had already painted.
   */
  it("re-reads the subscription after a disable that removed nothing", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    deactivatePushMock.mockImplementation(async () => {
      // Ably failed before removing anything, so the browser still holds one.
      throw new Error("deactivate failed");
    });
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isDeviceEnabled).toBe(true));

    await act(async () => {
      await expect(result.current.setDeviceEnabled(false)).rejects.toThrow(
        "deactivate failed",
      );
    });

    expect(result.current.isDeviceEnabled).toBe(true);
  });

  it("cannot be toggled while the session is still loading", async () => {
    const { result } = renderHook(() => usePushPreference(undefined), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.canToggleAccount).toBe(false);

    await act(async () => {
      await expect(result.current.setAccountEnabled(true)).rejects.toThrow(
        "Cannot change the push preference without a session",
      );
    });
    expect(activatePushMock).not.toHaveBeenCalled();
  });
});
