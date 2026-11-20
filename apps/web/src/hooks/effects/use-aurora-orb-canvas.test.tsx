import { render } from "@testing-library/react";
import { Activity, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MountHandle,
  MountOptions,
  OrbExpression,
} from "@/lib/aurora-orb";
import {
  type AuroraOrbEvent,
  useAuroraOrbCanvas,
} from "./use-aurora-orb-canvas";

const mountMock = vi.hoisted(() =>
  vi.fn<(canvas: HTMLCanvasElement, opts?: MountOptions) => MountHandle>(),
);

vi.mock("@/lib/aurora-orb", () => ({
  mount: mountMock,
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

interface HarnessProps {
  seed?: string;
  placeholder?: boolean;
  animate?: boolean;
  size?: number;
  speed?: number;
  expression?: OrbExpression | null;
  event?: AuroraOrbEvent | null;
}

function Harness({
  seed,
  placeholder = false,
  animate = true,
  size = 64,
  speed = 1,
  expression = null,
  event = null,
}: HarnessProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useAuroraOrbCanvas(canvasRef, {
    seed,
    placeholder,
    animate,
    size,
    speed,
    expression,
    event,
  });
  return <canvas ref={canvasRef} />;
}

describe("useAuroraOrbCanvas", () => {
  beforeEach(() => {
    mountMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts a seeded orb, updates expression and speed without remounting, and stops on unmount", () => {
    const firstHandle = createHandle();
    const secondHandle = createHandle();
    mountMock
      .mockReturnValueOnce(firstHandle)
      .mockReturnValueOnce(secondHandle);

    const { rerender, unmount } = render(
      <Harness seed="orb:pastel-sky" size={64} speed={1} expression="idle" />,
    );

    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(mountMock).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), {
      seed: "orb:pastel-sky",
      speed: 1,
      size: 64,
      expression: "idle",
    });

    rerender(
      <Harness
        seed="orb:pastel-sky"
        size={64}
        speed={1.5}
        expression="thinking"
      />,
    );

    expect(mountMock).toHaveBeenCalledTimes(1);
    expect(firstHandle.setExpression).toHaveBeenLastCalledWith("thinking");
    expect(firstHandle.setSpeed).toHaveBeenLastCalledWith(1.5);

    rerender(
      <Harness
        seed="orb:jewel-rose"
        size={64}
        speed={1.5}
        expression="thinking"
      />,
    );

    expect(firstHandle.stop).toHaveBeenCalledTimes(1);
    expect(mountMock).toHaveBeenCalledTimes(2);
    expect(mountMock).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), {
      seed: "orb:jewel-rose",
      speed: 1.5,
      size: 64,
      expression: "thinking",
    });

    unmount();
    expect(secondHandle.stop).toHaveBeenCalledTimes(1);
  });

  it("mounts a placeholder orb with its animate flag and remounts when animate or size changes", () => {
    const firstHandle = createHandle();
    const secondHandle = createHandle();
    mountMock
      .mockReturnValueOnce(firstHandle)
      .mockReturnValueOnce(secondHandle);

    const { rerender, unmount } = render(
      <Harness placeholder animate={false} size={48} speed={1.2} />,
    );

    expect(mountMock).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), {
      placeholder: true,
      animate: false,
      speed: 1.2,
      size: 48,
      expression: null,
    });

    rerender(<Harness placeholder animate size={48} speed={1.2} />);

    expect(firstHandle.stop).toHaveBeenCalledTimes(1);
    expect(mountMock).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), {
      placeholder: true,
      animate: true,
      speed: 1.2,
      size: 48,
      expression: null,
    });

    unmount();
    expect(secondHandle.stop).toHaveBeenCalledTimes(1);
  });

  it("pulses once per event nonce and preserves nonce history across Activity hide and reveal", () => {
    const firstHandle = createHandle();
    const secondHandle = createHandle();
    mountMock
      .mockReturnValueOnce(firstHandle)
      .mockReturnValueOnce(secondHandle);

    const event1: AuroraOrbEvent = { expr: "wink", nonce: 1, ms: 900 };
    const { rerender } = render(
      <Activity mode="visible">
        <Harness
          seed="orb:porcelain"
          size={64}
          speed={1}
          expression="happy"
          event={event1}
        />
      </Activity>,
    );

    expect(firstHandle.pulse).toHaveBeenCalledExactlyOnceWith("wink", 900);

    // Same nonce object replacement does not re-pulse.
    rerender(
      <Activity mode="visible">
        <Harness
          seed="orb:porcelain"
          size={64}
          speed={1}
          expression="happy"
          event={{ expr: "wink", nonce: 1, ms: 900 }}
        />
      </Activity>,
    );
    expect(firstHandle.pulse).toHaveBeenCalledTimes(1);

    // Hide stops the canvas handle.
    rerender(
      <Activity mode="hidden">
        <Harness
          seed="orb:porcelain"
          size={64}
          speed={1}
          expression="happy"
          event={event1}
        />
      </Activity>,
    );
    expect(firstHandle.stop).toHaveBeenCalledTimes(1);

    // Reveal remounts cleanly without replaying the already-fired nonce.
    rerender(
      <Activity mode="visible">
        <Harness
          seed="orb:porcelain"
          size={64}
          speed={1}
          expression="happy"
          event={event1}
        />
      </Activity>,
    );
    expect(mountMock).toHaveBeenCalledTimes(2);
    expect(secondHandle.pulse).not.toHaveBeenCalled();

    // A new nonce fires on the revealed handle.
    rerender(
      <Activity mode="visible">
        <Harness
          seed="orb:porcelain"
          size={64}
          speed={1}
          expression="happy"
          event={{ expr: "surprised", nonce: 2, ms: 700 }}
        />
      </Activity>,
    );
    expect(secondHandle.pulse).toHaveBeenCalledExactlyOnceWith(
      "surprised",
      700,
    );
  });
});
