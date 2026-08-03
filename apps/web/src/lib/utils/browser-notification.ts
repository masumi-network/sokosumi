export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

export interface BrowserNotificationGateInput {
  permission: BrowserNotificationPermission;
  documentHidden: boolean;
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
  documentHidden,
  isRead,
}: BrowserNotificationGateInput): boolean {
  if (isRead) {
    return false;
  }

  if (permission !== "granted") {
    return false;
  }

  return documentHidden;
}

export function shouldShowInAppNotificationToast({
  documentHidden,
  isRead,
}: {
  documentHidden: boolean;
  isRead: boolean;
}): boolean {
  if (isRead) {
    return false;
  }

  return !documentHidden;
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
