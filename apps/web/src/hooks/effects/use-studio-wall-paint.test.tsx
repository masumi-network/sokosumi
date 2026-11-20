import { render } from "@testing-library/react";
import { Activity, useRef } from "react";
import { describe, expect, it } from "vitest";

import {
  buildStudioWall,
  getStudioWallTransform,
  type StudioWallLayout,
} from "@/app/projects/components/image-studio/studio-wall-layout";
import { useStudioWallPaint } from "./use-studio-wall-paint";

function Harness({
  wall,
  offset = { x: 0, y: 0 },
}: {
  wall: StudioWallLayout;
  offset?: { x: number; y: number };
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<(HTMLDivElement | null)[]>([]);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  useStudioWallPaint(rowRef, columnsRef, offsetRef, wall);

  return (
    <div ref={rowRef} data-testid="row">
      {wall.columns.map((_, index) => (
        <div
          key={index}
          data-testid={`col-${index}`}
          ref={(node) => {
            columnsRef.current[index] = node;
          }}
        />
      ))}
    </div>
  );
}

describe("useStudioWallPaint", () => {
  it("applies row and column transforms before paint on mount, layout change, and Activity reveal", () => {
    const smallWall = buildStudioWall({ width: 390, height: 844 });
    const wideWall = buildStudioWall({ width: 1440, height: 900 });

    const { getByTestId, rerender } = render(
      <Activity mode="visible">
        <Harness wall={smallWall} offset={{ x: 24, y: 40 }} />
      </Activity>,
    );

    const smallTransform = getStudioWallTransform(smallWall, { x: 24, y: 40 });
    expect(getByTestId("row").style.transform).toBe(
      `translate3d(${smallTransform.x}px, 0, 0)`,
    );
    expect(getByTestId("col-0").style.transform).toBe(
      `translate3d(0, ${smallTransform.columnY[0]}px, 0)`,
    );

    rerender(
      <Activity mode="visible">
        <Harness wall={wideWall} offset={{ x: 24, y: 40 }} />
      </Activity>,
    );

    const wideTransform = getStudioWallTransform(wideWall, { x: 24, y: 40 });
    expect(getByTestId("row").style.transform).toBe(
      `translate3d(${wideTransform.x}px, 0, 0)`,
    );
    expect(getByTestId("col-0").style.transform).toBe(
      `translate3d(0, ${wideTransform.columnY[0]}px, 0)`,
    );

    rerender(
      <Activity mode="hidden">
        <Harness wall={wideWall} offset={{ x: 24, y: 40 }} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Harness wall={wideWall} offset={{ x: 100, y: 80 }} />
      </Activity>,
    );

    const revealedTransform = getStudioWallTransform(wideWall, {
      x: 100,
      y: 80,
    });
    expect(getByTestId("row").style.transform).toBe(
      `translate3d(${revealedTransform.x}px, 0, 0)`,
    );
    expect(getByTestId("col-0").style.transform).toBe(
      `translate3d(0, ${revealedTransform.columnY[0]}px, 0)`,
    );
  });
});
