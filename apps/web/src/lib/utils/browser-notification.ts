export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

export interface BrowserNotificationGateInput {
  permission: BrowserNotificationPermission;
  isDocumentFocused: boolean;
  isRead: boolean;
}

function isNotificationApiAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Notification !== "undefined" &&
    typeof Notification.requestPermission === "function"
  );
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!isNotificationApiAvailable()) {
    return "unsupported";
  }

  return Notification.permission;
}

export function shouldShowBrowserNotification({
  permission,
  isDocumentFocused,
  isRead,
}: BrowserNotificationGateInput): boolean {
  if (isRead) {
    return false;
  }

  if (permission !== "granted") {
    return false;
  }

  return !isDocumentFocused;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!isNotificationApiAvailable()) {
    return "unsupported";
  }

  try {
    return await Notification.requestPermission();
  } catch {
    return getBrowserNotificationPermission();
  }
}

/**
 * Re-reads `Notification.permission` when the Permissions API reports a
 * change (if available) and whenever the window gains focus. Never calls
 * `requestPermission`.
 */
export function subscribeBrowserNotificationPermission(
  onChange: (permission: BrowserNotificationPermission) => void,
): () => void {
  const notify = () => {
    onChange(getBrowserNotificationPermission());
  };

  const handleFocus = () => {
    notify();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("focus", handleFocus);
  }

  let permissionStatus: PermissionStatus | null = null;
  let cancelled = false;

  const handlePermissionChange = () => {
    notify();
  };

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.permissions?.query === "function"
  ) {
    void navigator.permissions
      .query({ name: "notifications" as PermissionName })
      .then((status) => {
        if (cancelled) {
          return;
        }
        permissionStatus = status;
        status.addEventListener("change", handlePermissionChange);
      })
      .catch(() => {
        // Permissions API missing/throws → focus re-read only.
      });
  }

  return () => {
    cancelled = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", handleFocus);
    }
    permissionStatus?.removeEventListener("change", handlePermissionChange);
  };
}
