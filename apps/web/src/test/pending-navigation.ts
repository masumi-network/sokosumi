import { act } from "@testing-library/react";
import { startTransition } from "react";
import { notifyNavigationStart } from "@/lib/navigation/navigation-start";

/**
 * Starts a navigation as Next does: the start hook fires inside a transition
 * that stays open until the page arrives. Returns how to make it arrive.
 * Call that before the test ends, in a `finally`: an open transition fails
 * the file.
 */
export async function startNavigation(
  url: string,
): Promise<() => Promise<void>> {
  const arrival = Promise.withResolvers<void>();
  await act(async () => {
    startTransition(async () => {
      notifyNavigationStart(url);
      await arrival.promise;
    });
  });
  return () => act(async () => arrival.resolve());
}
