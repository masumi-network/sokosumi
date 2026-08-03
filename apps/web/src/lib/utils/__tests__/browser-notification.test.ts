import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  shouldShowBrowserNotification,
  shouldShowInAppNotificationToast,
  showBrowserNotification,
  subscribeBrowserNotificationPermission,
} from "@/lib/utils/browser-notification";

describe("shouldShowBrowserNotification", () => {
  it("shows when granted, unread, and document unfocused (including visible-but-unfocused)", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "granted",
        isDocumentFocused: false,
        isRead: false,
      }),
    ).toBe(true);
  });

  it("hides when permission is default or denied", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "default",
        isDocumentFocused: false,
        isRead: false,
      }),
    ).toBe(false);
    expect(
      shouldShowBrowserNotification({
        permission: "denied",
        isDocumentFocused: false,
        isRead: false,
      }),
    ).toBe(false);
  });

  it("hides when the document is focused or the notification is read", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "granted",
        isDocumentFocused: true,
        isRead: false,
      }),
    ).toBe(false);
    expect(
      shouldShowBrowserNotification({
        permission: "granted",
        isDocumentFocused: false,
        isRead: true,
      }),
    ).toBe(false);
  });

  it("hides when the Notification API is unsupported", () => {
    expect(
      shouldShowBrowserNotification({
        permission: "unsupported",
        isDocumentFocused: false,
        isRead: false,
      }),
    ).toBe(false);
  });
});

describe("shouldShowInAppNotificationToast", () => {
  it("shows unread toasts only while the document is focused", () => {
    expect(
      shouldShowInAppNotificationToast({
        isDocumentFocused: true,
        isRead: false,
      }),
    ).toBe(true);
    expect(
      shouldShowInAppNotificationToast({
        isDocumentFocused: false,
        isRead: false,
      }),
    ).toBe(false);
    expect(
      shouldShowInAppNotificationToast({
        isDocumentFocused: true,
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

describe("subscribeBrowserNotificationPermission", () => {
  const originalNotification = globalThis.Notification;
  const originalPermissions = navigator.permissions;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: originalNotification,
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      writable: true,
      value: originalPermissions,
    });
  });

  it("re-reads permission on window focus", () => {
    const requestPermission = vi.fn();
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: {
        permission: "denied",
        requestPermission,
      },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const onChange = vi.fn();
    const unsubscribe = subscribeBrowserNotificationPermission(onChange);

    window.dispatchEvent(new Event("focus"));

    expect(onChange).toHaveBeenCalledWith("denied");
    expect(requestPermission).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("subscribes to Permissions API change when available", async () => {
    const requestPermission = vi.fn();
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: {
        permission: "denied",
        requestPermission,
      },
    });

    const listeners = new Set<() => void>();
    const status = {
      state: "denied",
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.delete(listener);
      }),
    };
    const query = vi.fn().mockResolvedValue(status);
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      writable: true,
      value: { query },
    });

    const onChange = vi.fn();
    const unsubscribe = subscribeBrowserNotificationPermission(onChange);

    await vi.waitFor(() => {
      expect(status.addEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      );
    });

    Object.defineProperty(globalThis.Notification, "permission", {
      configurable: true,
      value: "granted",
    });
    for (const listener of listeners) {
      listener();
    }

    expect(onChange).toHaveBeenCalledWith("granted");
    expect(requestPermission).not.toHaveBeenCalled();

    unsubscribe();
    expect(status.removeEventListener).toHaveBeenCalled();
  });

  it("cleanup removes the focus listener", () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: {
        permission: "default",
        requestPermission: vi.fn(),
      },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const onChange = vi.fn();
    const unsubscribe = subscribeBrowserNotificationPermission(onChange);
    unsubscribe();

    window.dispatchEvent(new Event("focus"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not throw when Notification and Permissions API are missing", () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const onChange = vi.fn();
    expect(() => {
      const unsubscribe = subscribeBrowserNotificationPermission(onChange);
      window.dispatchEvent(new Event("focus"));
      unsubscribe();
    }).not.toThrow();
    expect(onChange).toHaveBeenCalledWith("unsupported");
  });

  it("ignores Permissions API query failures", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: {
        permission: "denied",
        requestPermission: vi.fn(),
      },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      writable: true,
      value: {
        query: vi.fn().mockRejectedValue(new Error("not supported")),
      },
    });

    const onChange = vi.fn();
    const unsubscribe = subscribeBrowserNotificationPermission(onChange);

    await Promise.resolve();
    window.dispatchEvent(new Event("focus"));
    expect(onChange).toHaveBeenCalledWith("denied");
    unsubscribe();
  });
});
