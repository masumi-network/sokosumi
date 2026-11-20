import { render } from "@testing-library/react";
import { Activity, useLayoutEffect, useRef } from "react";
import { describe, expect, it } from "vitest";

import {
  buildStudioWall,
  getStudioWallTransform,
  type StudioWallLayout,
} from "@/app/projects/components/image-studio/studio-wall-layout";
import { useStudioWallPaint } from "./use-studio-wall-paint";

interface LayoutSnapshot {
  rowTransform: string | undefined;
  col0Transform: string | undefined;
  wallWidth: number;
}

function Harness({
  wall,
  offset = { x: 0, y: 0 },
  onLayoutProbe,
}: {
  wall: StudioWallLayout;
  offset?: { x: number; y: number };
  onLayoutProbe: (snapshot: LayoutSnapshot) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<(HTMLDivElement | null)[]>([]);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const wallRef = useStudioWallPaint(rowRef, columnsRef, offsetRef, wall);

  // Runs in the same layout phase immediately after `useStudioWallPaint`,
  // proving transforms and `wallRef` are committed before paint (not in a
  // passive `useEffect`).
  useLayoutEffect(() => {
    onLayoutProbe({
      rowTransform: rowRef.current?.style.transform,
      col0Transform: columnsRef.current[0]?.style.transform,
      wallWidth: wallRef.current.width,
    });
  }, [wall, offset.x, offset.y, wallRef, onLayoutProbe]);

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
    const snapshots: LayoutSnapshot[] = [];
    const onLayoutProbe = (snapshot: LayoutSnapshot) => {
      snapshots.push(snapshot);
    };

    const { rerender } = render(
      <Activity mode="visible">
        <Harness
          wall={smallWall}
          offset={{ x: 24, y: 40 }}
          onLayoutProbe={onLayoutProbe}
        />
      </Activity>,
    );

    const smallTransform = getStudioWallTransform(smallWall, { x: 24, y: 40 });
    expect(snapshots.at(-1)).toEqual({
      rowTransform: `translate3d(${smallTransform.x}px, 0, 0)`,
      col0Transform: `translate3d(0, ${smallTransform.columnY[0]}px, 0)`,
      wallWidth: 390,
    });

    rerender(
      <Activity mode="visible">
        <Harness
          wall={wideWall}
          offset={{ x: 24, y: 40 }}
          onLayoutProbe={onLayoutProbe}
        />
      </Activity>,
    );

    const wideTransform = getStudioWallTransform(wideWall, { x: 24, y: 40 });
    expect(snapshots.at(-1)).toEqual({
      rowTransform: `translate3d(${wideTransform.x}px, 0, 0)`,
      col0Transform: `translate3d(0, ${wideTransform.columnY[0]}px, 0)`,
      wallWidth: 1440,
    });

    rerender(
      <Activity mode="hidden">
        <Harness
          wall={wideWall}
          offset={{ x: 24, y: 40 }}
          onLayoutProbe={onLayoutProbe}
        />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Harness
          wall={wideWall}
          offset={{ x: 100, y: 80 }}
          onLayoutProbe={onLayoutProbe}
        />
      </Activity>,
    );

    const revealedTransform = getStudioWallTransform(wideWall, {
      x: 100,
      y: 80,
    });
    expect(snapshots.at(-1)).toEqual({
      rowTransform: `translate3d(${revealedTransform.x}px, 0, 0)`,
      col0Transform: `translate3d(0, ${revealedTransform.columnY[0]}px, 0)`,
      wallWidth: 1440,
    });
  });
});
