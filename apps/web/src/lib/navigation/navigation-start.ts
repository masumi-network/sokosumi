type NavigationStartListener = (pathname: string) => void;

let listener: NavigationStartListener | null = null;

/** One listener at a time: the app shell's `NavigationProgress`. */
export function listenForNavigationStart(
  next: NavigationStartListener,
): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

/**
 * Next calls `onRouterTransitionStart` inside the navigation's own
 * transition, so optimistic state a listener sets here lasts exactly as long
 * as the navigation. That covers a link, `router.push` and `replace`, and
 * back and forward. A Server Action's `redirect()` does not pass through it.
 */
export function notifyNavigationStart(url: string): void {
  listener?.(new URL(url, window.location.href).pathname);
}
