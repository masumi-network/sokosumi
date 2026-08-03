export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

export interface BrowserNotificationGateInput {
  permission: BrowserNotificationPermission;
  isDocumentFocused: boolean;
  isRead: boolean;
}

export interface ShowBrowserNotificationInput {
  id: string;
  title: string;
  body: string;
  icon?: string;
  onClick?: () => void;
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

/**
 * Creates an OS notification. Callers must gate with
 * `shouldShowBrowserNotification` first.
 */
export function showBrowserNotification({
  id,
  title,
  body,
  icon,
  onClick,
}: ShowBrowserNotificationInput): Notification | null {
  if (getBrowserNotificationPermission() !== "granted") {
    return null;
  }

  try {
    const notification = new Notification(title, {
      body,
      tag: id,
      icon,
    });

    if (onClick) {
      notification.onclick = () => {
        window.focus();
        notification.close();
        onClick();
      };
    }

    return notification;
  } catch (error) {
    console.error("Failed to show browser notification:", error);
    return null;
  }
}
