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
    vi.clearAllMocks();
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
    activatePushMock.mockResolvedValue(undefined);
    deactivatePushMock.mockResolvedValue(undefined);
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
    // activating again (ADR-0019).
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

  it("reverts the switch and records nothing when activation fails", async () => {
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
    expect(result.current.isDeviceEnabled).toBe(false);
    expect(result.current.isAccountEnabled).toBe(true);
  });

  it("re-reads the subscription after a half-failed disable", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    deactivatePushMock.mockImplementation(async () => {
      // Ably removed the subscription, then failed before reporting success.
      setDeviceSubscribed(false);
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

    expect(result.current.isDeviceEnabled).toBe(false);
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
