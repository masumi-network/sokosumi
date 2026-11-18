import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { YOU_ROW_LIST_PATHS } from "@/app/components/mobile-app-chrome";

export const YOU_ENTRY_SESSION_KEY = "sokosumi.you.entryRoot";

function isInside(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

/** Remembers that the You page opened `href`, when it is a You row list. */
export function rememberYouEntry(href: string): void {
  const root = href.split(/[?#]/)[0] ?? href;
  if (!YOU_ROW_LIST_PATHS.has(root)) {
    return;
  }
  try {
    window.sessionStorage.setItem(YOU_ENTRY_SESSION_KEY, root);
  } catch {
    // Storage blocked: the page keeps its own chrome.
  }
}

function readEntryRoot(): string | null {
  try {
    return window.sessionStorage.getItem(YOU_ENTRY_SESSION_KEY);
  } catch {
    return null;
  }
}

// Same-tab writes fire no event; a navigation re-renders the readers.
const subscribe = () => () => {};

/**
 * True while the reader stays inside the You row list they opened from You
 * (its query, project and nested pages included). Leaving it forgets the
 * entry, so reaching that list from another page keeps that page's chrome.
 * Null on the server, so the first paint of a reload shows the default.
 */
export function useOpenedFromYou(): boolean {
  const pathname = usePathname();
  const root = useSyncExternalStore(subscribe, readEntryRoot, () => null);
  const inside = root !== null && isInside(pathname, root);

  useEffect(() => {
    if (root !== null && !inside) {
      try {
        window.sessionStorage.removeItem(YOU_ENTRY_SESSION_KEY);
      } catch {
        // Nothing stored to clear.
      }
    }
  }, [root, inside]);

  return inside;
}
