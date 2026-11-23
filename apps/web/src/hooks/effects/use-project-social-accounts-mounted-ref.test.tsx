import { render } from "@testing-library/react";
import { Activity, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import { useProjectSocialAccountsMountedRef } from "./use-project-social-accounts-mounted-ref";

function MountedProbe({ isMountedRef }: { isMountedRef: RefObject<boolean> }) {
  useProjectSocialAccountsMountedRef(isMountedRef);
  return null;
}

describe("useProjectSocialAccountsMountedRef", () => {
  it("tracks mount, unmount, and Activity hide/reveal", () => {
    const isMountedRef = { current: false };
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <MountedProbe isMountedRef={isMountedRef} />
      </Activity>,
    );

    expect(isMountedRef.current).toBe(true);

    rerender(
      <Activity mode="hidden">
        <MountedProbe isMountedRef={isMountedRef} />
      </Activity>,
    );
    expect(isMountedRef.current).toBe(false);

    rerender(
      <Activity mode="visible">
        <MountedProbe isMountedRef={isMountedRef} />
      </Activity>,
    );
    expect(isMountedRef.current).toBe(true);

    unmount();
    expect(isMountedRef.current).toBe(false);
  });
});
