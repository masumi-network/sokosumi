import { queryOptions } from "@tanstack/react-query";

import { preferencesBrowserClient } from "@/lib/clients/core.preferences.browser.client";

/**
 * Keyed by the reader, not by the "me" the request path uses.
 *
 * The browser query client is a module singleton and a sign-out is a soft
 * navigation, so the cache outlives the session. A key that said "me" for
 * everyone would hand the next reader on that browser the previous reader's
 * push consent for the whole stale window, and a write from the second reader
 * would land on the first reader's entry.
 */
export const getMyPreferencesQueryKey = (userId: string | undefined) => [
  "preferences",
  userId ?? null,
];

/**
 * Tanstack query options for the session user's preferences.
 *
 * A write returns the same DTO, so callers seed this key with the response
 * rather than refetching. Call from a client component.
 */
export const getMyPreferencesQueryOptions = (userId: string | undefined) =>
  queryOptions({
    queryKey: getMyPreferencesQueryKey(userId),
    queryFn: () => preferencesBrowserClient.getMyPreferences(),
    // Without a session the read is a guaranteed 401.
    enabled: Boolean(userId),
  });
