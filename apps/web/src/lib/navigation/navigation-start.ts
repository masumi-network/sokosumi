type NavigationStartListener = (pathname: string, onScreen: boolean) => void;

let listener: NavigationStartListener | null = null;
let pageOnScreen: string | null = null;

/** One listener at a time: the root layout's `NavigationProgress`. */
export function listenForNavigationStart(
  next: NavigationStartListener,
): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

/**
 * Call from the click that opens a page a cache paints at once, ahead of its
 * route. That navigation has nothing to wait for, so it shows no bar.
 */
export function markPageOnScreen(pathname: string): void {
  pageOnScreen = pathname;
}

/**
 * Next calls `onRouterTransitionStart` inside the navigation's own
 * transition, so optimistic state a listener sets here lasts exactly as long
 * as the navigation. That covers a link, `router.push` and `replace`, and
 * back and forward. A Server Action's `redirect()` does not pass through it.
 */
export function notifyNavigationStart(url: string): void {
  const pathname = new URL(url, window.location.href).pathname;
  listener?.(pathname, pathname === pageOnScreen);
  pageOnScreen = null;
}
