"use client";

import { useEffect, useState } from "react";

/**
 * Defers portaling the `RoomsClient` mobile header into the app header slot
 * until after first paint so the room title lands in-column with the composer.
 */
export function useRoomsClientMobileHeaderPortaled(
  isMobile: boolean | undefined,
  host: HTMLElement | null,
): boolean {
  // Defer portal until after first paint so getRoom title lands in-column with
  // the composer (useLayoutEffect host + isMobile would portal before paint and
  // leave the app header blank on the first real chrome frame).
  const [mobileHeaderPortaled, setMobileHeaderPortaled] = useState(false);
  useEffect(() => {
    setMobileHeaderPortaled(isMobile === true && host != null);
  }, [isMobile, host]);
  return mobileHeaderPortaled;
}
