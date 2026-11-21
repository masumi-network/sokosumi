import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { requestStudioWebsiteDraftOnOpen } from "@/app/projects/components/image-studio/studio-website-intent";
import { useStudioWebsiteDraftRequest } from "./use-studio-website-draft-request";

describe("useStudioWebsiteDraftRequest", () => {
  it("consumes a queued website draft request on mount when websiteUrl is set", () => {
    const onRequested = vi.fn();
    requestStudioWebsiteDraftOnOpen("proj-1");

    const { rerender } = renderHook(
      ({ websiteUrl }: { websiteUrl: string | null }) =>
        useStudioWebsiteDraftRequest("proj-1", websiteUrl, onRequested),
      { initialProps: { websiteUrl: "https://example.com" as string | null } },
    );

    expect(onRequested).toHaveBeenCalledTimes(1);

    // Re-rendering does not fire again.
    rerender({ websiteUrl: "https://example.com" });
    expect(onRequested).toHaveBeenCalledTimes(1);
  });

  it("leaves the queued request untouched when websiteUrl is missing", () => {
    const onRequested = vi.fn();
    requestStudioWebsiteDraftOnOpen("proj-2");

    renderHook(() => useStudioWebsiteDraftRequest("proj-2", null, onRequested));
    expect(onRequested).not.toHaveBeenCalled();

    // Subsequent mount with a websiteUrl consumes it.
    renderHook(() =>
      useStudioWebsiteDraftRequest(
        "proj-2",
        "https://example.com",
        onRequested,
      ),
    );
    expect(onRequested).toHaveBeenCalledTimes(1);
  });

  it("checks again on React Activity reveal and does not throw during SSR", () => {
    const onRequested = vi.fn();

    function Probe() {
      useStudioWebsiteDraftRequest(
        "proj-3",
        "https://example.com",
        onRequested,
      );
      return <span>ok</span>;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(onRequested).not.toHaveBeenCalled();

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    requestStudioWebsiteDraftOnOpen("proj-3");
    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(onRequested).toHaveBeenCalledTimes(1);

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
