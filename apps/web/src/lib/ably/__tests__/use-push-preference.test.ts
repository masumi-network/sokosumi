import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePushPreference } from "../use-push-preference";

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

vi.mock("../push-activation.client", () => ({
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
    patchMyPreferencesMock.mockResolvedValue({ data: { pushOptIn: true } });
    setAccountOptIn(false);
  });

  it("registers the device, then records the account opt-in", async () => {
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggle).toBe(true));

    await act(async () => {
      await result.current.enable();
    });

    expect(activatePushMock).toHaveBeenCalledWith("user_1");
    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: true });
    expect(activatePushMock.mock.invocationCallOrder[0]).toBeLessThan(
      patchMyPreferencesMock.mock.invocationCallOrder[0] as number,
    );
    expect(result.current.enabled).toBe(true);
  });

  it("opens the permission prompt before anything awaits", async () => {
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggle).toBe(true));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.enable();
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

  it("registers nothing when the reader refuses the prompt", async () => {
    setNotificationPermission("default");
    requestPermissionMock.mockResolvedValue("denied");
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggle).toBe(true));

    await act(async () => {
      await expect(result.current.enable()).rejects.toThrow();
    });

    expect(activatePushMock).not.toHaveBeenCalled();
    expect(patchMyPreferencesMock).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
    expect(result.current.isBlocked).toBe(true);
  });

  it("withdraws the account consent before deregistering, for all devices", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.disable("allDevices");
    });

    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: false });
    // Consent goes first, so a failed deregistration still leaves silence.
    expect(patchMyPreferencesMock.mock.invocationCallOrder[0]).toBeLessThan(
      deactivatePushMock.mock.invocationCallOrder[0] as number,
    );
    expect(result.current.enabled).toBe(false);
  });

  it("leaves the account opted in when only this device is turned off", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.disable("thisDevice");
    });

    expect(deactivatePushMock).toHaveBeenCalledWith("user_1");
    expect(patchMyPreferencesMock).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it("keeps push off in Core when deregistering the device fails", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    deactivatePushMock.mockRejectedValue(new Error("already deactivated"));
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await expect(result.current.disable("allDevices")).rejects.toThrow(
        "already deactivated",
      );
    });

    expect(patchMyPreferencesMock).toHaveBeenCalledWith({ pushOptIn: false });
  });

  it("reverts the switch and records nothing when activation fails", async () => {
    activatePushMock.mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.canToggle).toBe(true));

    await act(async () => {
      await expect(result.current.enable()).rejects.toThrow(
        "permission denied",
      );
    });

    expect(patchMyPreferencesMock).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it("shows the switch off when the account opted out on another device", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(false);

    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggle).toBe(true));
    expect(result.current.enabled).toBe(false);
  });

  it("shows the switch off when the reader revoked the OS permission", async () => {
    setDeviceSubscribed(true);
    setAccountOptIn(true);
    setNotificationPermission("denied");

    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggle).toBe(true));
    expect(result.current.enabled).toBe(false);
  });

  it("reports the block when the browser denies notifications", async () => {
    setNotificationPermission("denied");
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isBlocked).toBe(true));
    expect(result.current.enabled).toBe(false);
  });

  it("reports no block while notifications are allowed", async () => {
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggle).toBe(true));
    expect(result.current.isBlocked).toBe(false);
  });

  it("stays unusable when the account opt-in cannot be read", async () => {
    getMyPreferencesMock.mockRejectedValue(new Error("core down"));
    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.canToggle).toBe(false);
  });

  it("shows the switch off when the browser lost its push subscription", async () => {
    setAccountOptIn(true);
    setDeviceSubscribed(false);

    const { result } = renderHook(() => usePushPreference("user_1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.canToggle).toBe(true));
    expect(result.current.enabled).toBe(false);
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
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await expect(result.current.disable("thisDevice")).rejects.toThrow(
        "deactivate failed",
      );
    });

    expect(result.current.enabled).toBe(false);
  });

  it("cannot be toggled while the session is still loading", async () => {
    const { result } = renderHook(() => usePushPreference(undefined), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.canToggle).toBe(false);

    await act(async () => {
      await expect(result.current.enable()).rejects.toThrow(
        "Cannot change the push preference without a session",
      );
    });
    expect(activatePushMock).not.toHaveBeenCalled();
  });
});
