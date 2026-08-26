import { queryOptions } from "@tanstack/react-query";

import { preferencesBrowserClient } from "@/lib/clients/core.preferences.browser.client";

export const getMyPreferencesQueryKey = () => ["preferences", "me"];

/**
 * Tanstack query options for the session user's preferences.
 *
 * A write returns the same DTO, so callers seed this key with the response
 * rather than refetching. Call from a client component.
 */
export const getMyPreferencesQueryOptions = () =>
  queryOptions({
    queryKey: getMyPreferencesQueryKey(),
    queryFn: () => preferencesBrowserClient.getMyPreferences(),
  });
