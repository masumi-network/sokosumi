import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceSwitchSettlers } from "./use-workspace-switch-settlers";

describe("useWorkspaceSwitchSettlers", () => {
  it("resolves queued settlers once isPending transitions back to false", async () => {
    const captured: { whenSettled: (() => Promise<void>) | null } = {
      whenSettled: null,
    };

    function Probe({ isPending }: { isPending: boolean }) {
      const settlersRef = useRef<Array<() => void>>([]);
      useWorkspaceSwitchSettlers(settlersRef, isPending);
      captured.whenSettled = () =>
        new Promise<void>((resolve) => {
          settlersRef.current.push(resolve);
        });
      return null;
    }

    const { rerender, unmount } = render(<Probe isPending={true} />);

    const settledA = vi.fn();
    const settledB = vi.fn();
    const pA = captured.whenSettled?.().then(settledA);
    const pB = captured.whenSettled?.().then(settledB);

    await Promise.resolve();
    expect(settledA).not.toHaveBeenCalled();
    expect(settledB).not.toHaveBeenCalled();

    rerender(<Probe isPending={false} />);
    await Promise.all([pA, pB]);
    expect(settledA).toHaveBeenCalledTimes(1);
    expect(settledB).toHaveBeenCalledTimes(1);

    // Next pending cycle queues fresh settlers independently.
    rerender(<Probe isPending={true} />);
    const settledC = vi.fn();
    const pC = captured.whenSettled?.().then(settledC);
    await Promise.resolve();
    expect(settledC).not.toHaveBeenCalled();

    rerender(<Probe isPending={false} />);
    await pC;
    expect(settledC).toHaveBeenCalledTimes(1);

    unmount();
  });
});
