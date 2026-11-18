import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  replayIntegration: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { listenForNavigationStart } from "@/lib/navigation/navigation-start";
import { onRouterTransitionStart } from "./instrumentation-client";

describe("onRouterTransitionStart", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells Sentry and the navigation progress bar that a navigation started", () => {
    vi.stubGlobal("window", { location: { href: "https://app.test/home" } });
    const listener = vi.fn();
    const stopListening = listenForNavigationStart(listener);

    onRouterTransitionStart("/tasks?view=board", "push");
    stopListening();

    expect(Sentry.captureRouterTransitionStart).toHaveBeenCalledWith(
      "/tasks?view=board",
      "push",
    );
    expect(listener).toHaveBeenCalledWith("/tasks", false);
  });
});
