import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_TARGET_PARAM } from "@/lib/utils/notification-service-worker";

const TARGET = {
  id: "notification-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  createdAt: "2026-01-01T00:00:00.000Z",
  metadata: { messageId: "message-1", workspaceId: "workspace-1" },
};

const openNotificationMock = vi.fn();
let isLoading = false;

vi.mock("@/contexts/notification-provider", () => ({
  useNotifications: () => ({ isLoading }),
}));

vi.mock("@/app/components/use-open-notification", () => ({
  useOpenNotification: () => openNotificationMock,
}));

import { useNotificationUrlTargetOpener } from "./use-notification-url-target-opener";

function setUrl(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

describe("useNotificationUrlTargetOpener", () => {
  const markRead = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    isLoading = false;
  });

  afterEach(() => {
    setUrl("");
  });

  it("holds the URL target while loading and clears and opens once ready", async () => {
    isLoading = true;
    const search = `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(TARGET))}`;
    setUrl(search);

    const { rerender } = renderHook(() =>
      useNotificationUrlTargetOpener(markRead),
    );

    expect(openNotificationMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe(search);

    isLoading = false;
    rerender();

    await waitFor(() => {
      expect(openNotificationMock).toHaveBeenCalledWith(TARGET, false);
    });
    expect(window.location.search).toBe("");
  });

  it("opens once under StrictMode double mount", async () => {
    setUrl(
      `?${NOTIFICATION_TARGET_PARAM}=${encodeURIComponent(JSON.stringify(TARGET))}`,
    );

    renderHook(() => useNotificationUrlTargetOpener(markRead), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(openNotificationMock).toHaveBeenCalledTimes(1);
    });
    expect(window.location.search).toBe("");
  });

  it("leaves unrelated URL parameters untouched when no target is present", () => {
    setUrl("?keep=1");

    renderHook(() => useNotificationUrlTargetOpener(markRead));

    expect(openNotificationMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?keep=1");
  });
});
