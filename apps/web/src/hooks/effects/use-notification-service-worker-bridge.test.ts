import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationTarget } from "@/lib/utils/notification-service-worker";

const {
  getPermissionMock,
  getWorkerMock,
  unsubscribeClicksMock,
  stopAnsweringMock,
} = vi.hoisted(() => ({
  getPermissionMock: vi.fn<() => NotificationPermission>(),
  getWorkerMock: vi.fn(),
  unsubscribeClicksMock: vi.fn(),
  stopAnsweringMock: vi.fn(),
}));

let clickHandler: ((target: NotificationTarget) => void) | null = null;
let showsQueryHandler: (() => boolean) | null = null;

vi.mock("@/lib/utils/browser-notification", () => ({
  getBrowserNotificationPermission: () => getPermissionMock(),
}));

vi.mock("@/lib/utils/notification-service-worker", () => ({
  getNotificationServiceWorker: () => getWorkerMock(),
  subscribeNotificationClicks: (
    onClick: (target: NotificationTarget) => void,
  ) => {
    clickHandler = onClick;
    return unsubscribeClicksMock;
  },
  answerShowsNotificationsQuery: (shows: () => boolean) => {
    showsQueryHandler = shows;
    return stopAnsweringMock;
  },
}));

import { useNotificationServiceWorkerBridge } from "./use-notification-service-worker-bridge";

const TARGET: NotificationTarget = {
  id: "notif-1",
  kind: "CHAT",
  referenceId: "room-1",
  messageKey: "Notifications.Chat.mentioned",
  createdAt: "2026-01-01T00:00:00.000Z",
  metadata: null,
};

describe("useNotificationServiceWorkerBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clickHandler = null;
    showsQueryHandler = null;
    getPermissionMock.mockReturnValue("granted");
    getWorkerMock.mockResolvedValue({});
  });

  it("warms the service worker when granted, uses latest callbacks, and cleans up on unmount", () => {
    const firstClick = vi.fn();
    const secondClick = vi.fn();
    let receiving = true;

    const { rerender, unmount } = renderHook(
      ({ onClick }: { onClick: (target: NotificationTarget) => void }) =>
        useNotificationServiceWorkerBridge({
          onNotificationClick: onClick,
          isReceivingNotifications: () => receiving,
        }),
      { initialProps: { onClick: firstClick } },
    );

    expect(getWorkerMock).toHaveBeenCalledTimes(1);
    expect(showsQueryHandler?.()).toBe(true);

    receiving = false;
    rerender({ onClick: secondClick });

    clickHandler?.(TARGET);
    expect(firstClick).not.toHaveBeenCalled();
    expect(secondClick).toHaveBeenCalledWith(TARGET);
    expect(showsQueryHandler?.()).toBe(false);

    unmount();
    expect(unsubscribeClicksMock).toHaveBeenCalledTimes(1);
    expect(stopAnsweringMock).toHaveBeenCalledTimes(1);
  });

  it("skips installing the service worker when notification permission is not granted", () => {
    getPermissionMock.mockReturnValue("default");

    renderHook(() =>
      useNotificationServiceWorkerBridge({
        onNotificationClick: vi.fn(),
        isReceivingNotifications: () => true,
      }),
    );

    expect(getWorkerMock).not.toHaveBeenCalled();
  });
});
