import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { useOrganizationChatRoomsHealthStale } from "./use-organization-chat-rooms-health-stale";

function HealthStaleProbe({
  staleActiveRef,
  healthy,
}: {
  staleActiveRef: { current: { wholeList: boolean } };
  healthy: boolean;
}) {
  useOrganizationChatRoomsHealthStale(staleActiveRef, healthy);
  return null;
}

describe("useOrganizationChatRoomsHealthStale", () => {
  it("marks staleActiveRef.current.wholeList true on mount, every healthy flip, StrictMode replay, and Activity reveal", () => {
    let writeCount = 0;
    let wholeListValue = false;
    const state = {
      get wholeList() {
        return wholeListValue;
      },
      set wholeList(next: boolean) {
        wholeListValue = next;
        writeCount += 1;
      },
    };
    const staleActiveRef = { current: state };

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <HealthStaleProbe staleActiveRef={staleActiveRef} healthy={true} />
        </Activity>
      </StrictMode>,
    );
    expect(wholeListValue).toBe(true);
    expect(writeCount).toBe(2);

    wholeListValue = false;
    writeCount = 0;
    // Same healthy value does not re-trigger.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <HealthStaleProbe staleActiveRef={staleActiveRef} healthy={true} />
        </Activity>
      </StrictMode>,
    );
    expect(wholeListValue).toBe(false);
    expect(writeCount).toBe(0);

    // Flipping healthy to false marks wholeList true.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <HealthStaleProbe staleActiveRef={staleActiveRef} healthy={false} />
        </Activity>
      </StrictMode>,
    );
    expect(wholeListValue).toBe(true);
    expect(writeCount).toBe(1);

    // Activity hide -> reveal re-runs and marks wholeList true again.
    wholeListValue = false;
    writeCount = 0;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <HealthStaleProbe staleActiveRef={staleActiveRef} healthy={false} />
        </Activity>
      </StrictMode>,
    );
    expect(writeCount).toBe(0);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <HealthStaleProbe staleActiveRef={staleActiveRef} healthy={false} />
        </Activity>
      </StrictMode>,
    );
    expect(wholeListValue).toBe(true);
    expect(writeCount).toBe(2);

    unmount();
  });
});
