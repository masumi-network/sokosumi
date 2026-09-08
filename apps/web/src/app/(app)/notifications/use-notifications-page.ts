"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useNotifications } from "@/contexts/notification-provider";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import type { NotificationItem } from "@/lib/clients/generated/core";

const PAGE_SIZE = 20;

interface PageState {
  notifications: NotificationItem[];
  cursor: string | null;
  hasMore: boolean;
}

interface PendingDeletion {
  kind: "delete" | "clear";
  ids: Set<string>;
}

export function removeNotificationLocally(
  notifications: NotificationItem[],
  notificationId: string,
): NotificationItem[] {
  const next = notifications.filter((item) => item.id !== notificationId);
  return next.length === notifications.length ? notifications : next;
}

export function mergeProviderNotifications(
  current: NotificationItem[],
  provider: NotificationItem[],
): NotificationItem[] {
  if (provider.length === 0) return current;
  const providerIds = new Set(provider.map((item) => item.id));
  return [...provider, ...current.filter((item) => !providerIds.has(item.id))];
}

/** Own the paginated list, including deletions started from the bell. */
export function useNotificationsPage() {
  const { notifications: providerNotifications, subscribeToDeletion } =
    useNotifications();
  const confirmed = useRef<PageState>({
    notifications: [],
    cursor: null,
    hasMore: false,
  });
  const pending = useRef(new Map<number, PendingDeletion>());
  const deletedIds = useRef(new Set<string>());
  const [page, setPage] = useState({ ...confirmed.current, isMutating: false });
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetchError, setHasFetchError] = useState(false);
  const fetchGeneration = useRef(0);
  const fetchInFlight = useRef(false);
  const hasLoaded = useRef(false);

  const publish = useCallback(() => {
    const hiddenIds = new Set(deletedIds.current);
    let isClearing = false;
    for (const deletion of pending.current.values()) {
      isClearing ||= deletion.kind === "clear";
      for (const id of deletion.ids) hiddenIds.add(id);
    }
    setPage({
      ...confirmed.current,
      notifications: confirmed.current.notifications.filter(
        (item) => !hiddenIds.has(item.id),
      ),
      hasMore: !isClearing && confirmed.current.hasMore,
      isMutating: pending.current.size > 0,
    });
  }, []);

  const setNotifications = useCallback(
    (update: (rows: NotificationItem[]) => NotificationItem[]) => {
      confirmed.current.notifications = update(
        confirmed.current.notifications,
      ).filter((item) => !deletedIds.current.has(item.id));
      publish();
    },
    [publish],
  );

  const fetchNotifications = useCallback(
    async (nextCursor?: string | null) => {
      if (fetchInFlight.current || pending.current.size > 0) return;
      fetchInFlight.current = true;
      const generation = ++fetchGeneration.current;
      setIsLoading(true);
      try {
        const response = await notificationsBrowserClient.getNotifications({
          limit: PAGE_SIZE,
          cursor: nextCursor ?? undefined,
        });
        if (generation !== fetchGeneration.current) return;
        const rows = response.data.filter(
          (item) => !deletedIds.current.has(item.id),
        );
        const existingIds = new Set(
          confirmed.current.notifications.map((item) => item.id),
        );
        confirmed.current = {
          notifications: nextCursor
            ? [
                ...confirmed.current.notifications,
                ...rows.filter((item) => !existingIds.has(item.id)),
              ]
            : rows,
          cursor: response.meta.pagination.nextCursor,
          hasMore: response.meta.pagination.nextCursor !== null,
        };
        hasLoaded.current = true;
        setHasFetchError(false);
        publish();
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
        if (generation === fetchGeneration.current && nextCursor == null)
          setHasFetchError(true);
      } finally {
        if (generation === fetchGeneration.current) {
          fetchInFlight.current = false;
          setIsLoading(false);
        }
      }
    },
    [publish],
  );

  useEffect(
    () =>
      subscribeToDeletion((event) => {
        // Release the canceled request's lock; its response and finally are stale.
        fetchGeneration.current += 1;
        fetchInFlight.current = false;
        setIsLoading(false);

        if (event.phase === "start") {
          pending.current.set(event.operationId, {
            kind: event.kind,
            ids: new Set(
              event.kind === "delete"
                ? [event.id]
                : confirmed.current.notifications.map((item) => item.id),
            ),
          });
        } else {
          const deletion = pending.current.get(event.operationId);
          pending.current.delete(event.operationId);
          if (event.phase === "success" && deletion) {
            for (const id of deletion.ids) deletedIds.current.add(id);
            const rows = confirmed.current.notifications.filter(
              (item) => !deletedIds.current.has(item.id),
            );
            const cursorDeleted =
              confirmed.current.cursor !== null &&
              deletion.ids.has(confirmed.current.cursor);
            confirmed.current = {
              notifications: rows,
              cursor:
                deletion.kind === "clear"
                  ? null
                  : cursorDeleted
                    ? (rows.at(-1)?.id ?? null)
                    : confirmed.current.cursor,
              hasMore:
                deletion.kind === "clear" ? false : confirmed.current.hasMore,
            };
            if (deletion.kind === "clear") {
              // Rows arriving during clear may also have been deleted by Core.
              hasLoaded.current = false;
              setHasFetchError(false);
            }
          }
        }
        publish();
        if (
          event.phase !== "start" &&
          pending.current.size === 0 &&
          (!hasLoaded.current ||
            (confirmed.current.hasMore && confirmed.current.cursor === null))
        ) {
          void fetchNotifications();
        }
      }),
    [fetchNotifications, publish, subscribeToDeletion],
  );

  useEffect(() => {
    void fetchNotifications();
    return () => {
      fetchGeneration.current += 1;
      fetchInFlight.current = false;
    };
  }, [fetchNotifications]);

  useEffect(() => {
    setNotifications((current) =>
      mergeProviderNotifications(current, providerNotifications),
    );
  }, [providerNotifications, setNotifications]);

  return {
    ...page,
    isLoading,
    hasFetchError,
    setNotifications,
    fetchNotifications,
  };
}
