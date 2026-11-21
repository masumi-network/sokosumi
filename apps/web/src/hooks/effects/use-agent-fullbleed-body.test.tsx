import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useAgentFullbleedBody } from "./use-agent-fullbleed-body";

function FullbleedProbe() {
  useAgentFullbleedBody();
  return null;
}

describe("useAgentFullbleedBody", () => {
  afterEach(() => {
    delete document.body.dataset.agentFullbleed;
  });

  it("sets data-agent-fullbleed on mount and deletes it on unmount", () => {
    expect(document.body.dataset.agentFullbleed).toBeUndefined();

    const { unmount } = renderHook(() => useAgentFullbleedBody());

    expect(document.body.dataset.agentFullbleed).toBe("true");
    expect(document.body.getAttribute("data-agent-fullbleed")).toBe("true");

    unmount();

    expect(document.body.dataset.agentFullbleed).toBeUndefined();
    expect(document.body.hasAttribute("data-agent-fullbleed")).toBe(false);
  });

  it("clears data-agent-fullbleed when hidden under React Activity and restores it on reveal", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <FullbleedProbe />
      </Activity>,
    );

    expect(document.body.dataset.agentFullbleed).toBe("true");

    rerender(
      <Activity mode="hidden">
        <FullbleedProbe />
      </Activity>,
    );
    expect(document.body.dataset.agentFullbleed).toBeUndefined();

    rerender(
      <Activity mode="visible">
        <FullbleedProbe />
      </Activity>,
    );
    expect(document.body.dataset.agentFullbleed).toBe("true");
  });
});
