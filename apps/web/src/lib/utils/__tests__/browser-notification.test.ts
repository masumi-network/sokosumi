import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  shouldShowBrowserNotification,
  shouldShowInAppNotificationToast,
  showBrowserNotification,
} from "@/lib/utils/browser-notification";

describe("shouldShowBrowserNotification", () => {
  it("shows only when granted, document hidden, and unread", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "granted",
        documentHidden: true,
        isRead: false,
      }),
    ).toBe(true);
  });

  it("hides when permission is default or denied", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "default",
        documentHidden: true,
        isRead: false,
      }),
    ).toBe(false);
    expect(
      shouldShowBrowserNotification({
        permission: "denied",
        documentHidden: true,
        isRead: false,
      }),
    ).toBe(false);
  });

  it("hides when the tab is visible or the notification is read", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "granted",
        documentHidden: false,
        isRead: false,
      }),
    ).toBe(false);
    expect(
      shouldShowBrowserNotification({
        permission: "granted",
        documentHidden: true,
        isRead: true,
      }),
    ).toBe(false);
  });

  it("hides when the Notification API is unsupported", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "unsupported",
        documentHidden: true,
        isRead: false,
      }),
    ).toBe(false);
  });
});

describe("shouldShowInAppNotificationToast", () => {
  it("shows unread toasts only while the tab is visible", () => {
    expect(
      shouldShowInAppNotificationToast({
        documentHidden: false,
        isRead: false,
      }),
    ).toBe(true);
    expect(
      shouldShowInAppNotificationToast({
        documentHidden: true,
        isRead: false,
      }),
    ).toBe(false);
    expect(
      shouldShowInAppNotificationToast({
        documentHidden: false,
        isRead: true,
      }),
    ).toBe(false);
  });
});

describe("browser notification API helpers", () => {
  const originalNotification = globalThis.Notification;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: originalNotification,
    });
  });

  it("reports unsupported when Notification is missing", () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    expect(getBrowserNotificationPermission()).toBe("unsupported");
  });

  it("requests permission through the browser API", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: {
        permission: "default",
        requestPermission,
      },
    });

    await expect(requestBrowserNotificationPermission()).resolves.toBe(
      "granted",
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("shows a notification when permission is granted", () => {
    class NotificationMock {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn().mockResolvedValue("granted");
      onclick: ((this: Notification, ev: Event) => void) | null = null;
      close = vi.fn();
      options: NotificationOptions | undefined;

      constructor(
        public title: string,
        options?: NotificationOptions,
      ) {
        this.options = options;
      }
    }

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: NotificationMock,
    });

    const onClick = vi.fn();
    const focusSpy = vi
      .spyOn(window, "focus")
      .mockImplementation((() => undefined) as typeof window.focus);
    const notification = showBrowserNotification({
      id: "notif_1",
      title: "Sokosumi",
      body: "Job completed",
      onClick,
    }) as NotificationMock | null;

    expect(notification).toBeInstanceOf(NotificationMock);
    expect(notification?.title).toBe("Sokosumi");
    expect(notification?.options).toEqual({
      body: "Job completed",
      tag: "notif_1",
      icon: undefined,
    });

    notification?.onclick?.call(
      notification as unknown as Notification,
      {
        type: "click",
      } as Event,
    );
    expect(focusSpy).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(notification?.close).toHaveBeenCalledTimes(1);
  });

  it("returns null when permission is not granted", () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: {
        permission: "denied",
        requestPermission: vi.fn(),
      },
    });

    expect(
      showBrowserNotification({
        id: "notif_1",
        title: "Sokosumi",
        body: "Job completed",
      }),
    ).toBeNull();
  });
});
