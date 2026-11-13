"use client";

import { isValidTimezone } from "@sokosumi/utils";

import { useMountEffect } from "@/hooks/use-mount-effect";

/**
 * Puts the browser's zone in a calendar URL that has none.
 *
 * The write is shallow when the server already rendered in that zone, so the
 * page is not rendered a second time. Otherwise it asks the server again:
 * its first render was in another zone.
 *
 * `renderedTimezone` is the zone the server computed the page's items and
 * range in.
 */
export function useUrlTimezone(
  urlTimezone: string | null,
  timeZone: string,
  renderedTimezone: string | undefined,
  write: (
    state: { timezone: string },
    options: { shallow: boolean },
  ) => unknown,
) {
  useMountEffect(() => {
    if (!isValidTimezone(urlTimezone)) {
      void write(
        { timezone: timeZone },
        { shallow: timeZone === renderedTimezone },
      );
    }
  });
}
