import { render } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDesignMdGenerationLifecycle } from "./use-design-md-generation-lifecycle";

describe("useDesignMdGenerationLifecycle", () => {
  it("sets mountedRef true on mount and StrictMode replay, and resets mountedRef + clears timeout on cleanup", () => {
    const clearA = vi.fn();
    const clearB = vi.fn();
    const captured: { ref: { current: boolean } | null } = { ref: null };

    function Probe({ clearPollTimeout }: { clearPollTimeout: () => void }) {
      const mountedRef = useRef(false);
      captured.ref = mountedRef;
      useDesignMdGenerationLifecycle(mountedRef, clearPollTimeout);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Probe clearPollTimeout={clearA} />
      </StrictMode>,
    );
    expect(captured.ref?.current).toBe(true);
    // StrictMode ran one setup -> cleanup -> setup cycle.
    expect(clearA).toHaveBeenCalledTimes(1);

    // Changing clearPollTimeout runs previous cleanup and restores mountedRef.
    rerender(
      <StrictMode>
        <Probe clearPollTimeout={clearB} />
      </StrictMode>,
    );
    expect(clearA).toHaveBeenCalledTimes(2);
    expect(captured.ref?.current).toBe(true);

    unmount();
    expect(captured.ref?.current).toBe(false);
    expect(clearB).toHaveBeenCalledTimes(1);
  });
});
