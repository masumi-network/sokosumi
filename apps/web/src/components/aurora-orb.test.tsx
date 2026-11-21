import { render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MountHandle, MountOptions } from "@/lib/aurora-orb";
import { AssistantOrb, AuroraOrb } from "./aurora-orb";

const mountMock = vi.hoisted(() =>
  vi.fn<(canvas: HTMLCanvasElement, opts?: MountOptions) => MountHandle>(),
);

vi.mock("@/lib/aurora-orb", () => ({
  mount: mountMock,
  toDataURL: vi.fn(() => "data:image/png;base64,abc"),
}));

function createHandle(): MountHandle {
  return {
    stop: vi.fn(),
    params: {
      paletteId: "porcelain",
      paint: {
        stops: ["#ffffff", "#f2f2f4", "#e2e2e8"],
        rim: "rgba(10,10,10,0.10)",
        halo: "rgba(130,130,150,0.10)",
        ink: "rgba(10,8,16,0.95)",
      },
      light: 0,
      pulse: 1,
    },
    setExpression: vi.fn(),
    setSpeed: vi.fn(),
    pulse: vi.fn(),
  };
}

describe("AuroraOrb and AssistantOrb", () => {
  beforeEach(() => {
    mountMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drives animated AuroraOrb through live updates, pulse events, and Activity hide/reveal", () => {
    const first = createHandle();
    const second = createHandle();
    mountMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { rerender } = render(
      <Activity mode="visible">
        <AuroraOrb
          seed="orb:pastel-sky"
          animate
          size={64}
          speed={1}
          expression="idle"
          event={{ expr: "wink", nonce: 1, ms: 800 }}
        />
      </Activity>,
    );

    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(first.pulse).toHaveBeenCalledExactlyOnceWith("wink", 800);

    rerender(
      <Activity mode="visible">
        <AuroraOrb
          seed="orb:pastel-sky"
          animate
          size={64}
          speed={1.4}
          expression="happy"
          event={{ expr: "wink", nonce: 1, ms: 800 }}
        />
      </Activity>,
    );

    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(first.setExpression).toHaveBeenLastCalledWith("happy");
    expect(first.setSpeed).toHaveBeenLastCalledWith(1.4);
    expect(first.pulse).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <AuroraOrb
          seed="orb:pastel-sky"
          animate
          size={64}
          speed={1.4}
          expression="happy"
          event={{ expr: "wink", nonce: 1, ms: 800 }}
        />
      </Activity>,
    );
    expect(first.stop).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <AuroraOrb
          seed="orb:pastel-sky"
          animate
          size={64}
          speed={1.4}
          expression="happy"
          event={{ expr: "wink", nonce: 1, ms: 800 }}
        />
      </Activity>,
    );
    expect(mountMock).toHaveBeenCalledTimes(2);
    expect(mountMock).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), {
      seed: "orb:pastel-sky",
      speed: 1.4,
      size: 64,
      expression: "happy",
    });
    expect(second.pulse).not.toHaveBeenCalled();
  });

  it("mounts the placeholder canvas when AssistantOrb has no seed", () => {
    const handle = createHandle();
    mountMock.mockReturnValueOnce(handle);

    const { unmount } = render(
      <AssistantOrb seed={null} size={48} animate={false} />,
    );

    expect(mountMock).toHaveBeenCalledExactlyOnceWith(
      expect.any(HTMLCanvasElement),
      {
        placeholder: true,
        animate: false,
        speed: 1.2,
        size: 48,
        expression: null,
      },
    );

    unmount();
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });
});
