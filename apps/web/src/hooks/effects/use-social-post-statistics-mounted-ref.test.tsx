import { render } from "@testing-library/react";
import { Activity, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import { useSocialPostStatisticsMountedRef } from "./use-social-post-statistics-mounted-ref";

function MountedProbe({ mountedRef }: { mountedRef: RefObject<boolean> }) {
  useSocialPostStatisticsMountedRef(mountedRef);
  return null;
}

describe("useSocialPostStatisticsMountedRef", () => {
  it("tracks mount, unmount, and Activity hide/reveal", () => {
    const mountedRef = { current: false };
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <MountedProbe mountedRef={mountedRef} />
      </Activity>,
    );

    expect(mountedRef.current).toBe(true);

    rerender(
      <Activity mode="hidden">
        <MountedProbe mountedRef={mountedRef} />
      </Activity>,
    );
    expect(mountedRef.current).toBe(false);

    rerender(
      <Activity mode="visible">
        <MountedProbe mountedRef={mountedRef} />
      </Activity>,
    );
    expect(mountedRef.current).toBe(true);

    unmount();
    expect(mountedRef.current).toBe(false);
  });
});
