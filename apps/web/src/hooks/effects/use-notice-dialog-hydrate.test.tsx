import type { Notice } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydrateNoticesRef } = vi.hoisted(() => ({
  hydrateNoticesRef: {
    current: vi.fn(),
  },
}));

vi.mock("@/app/components/notice-dialog-context", () => ({
  useNoticeDialogHydration: () => hydrateNoticesRef.current,
}));

import { useNoticeDialogHydrate } from "./use-notice-dialog-hydrate";

function makeNotice(id: string, kind: Notice["kind"]): Notice {
  return {
    id,
    kind,
    bodyMarkdown: `Notice ${id}`,
    effectiveAt: new Date("2026-10-01T00:00:00.000Z"),
    isActive: true,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

describe("useNoticeDialogHydrate", () => {
  beforeEach(() => {
    hydrateNoticesRef.current = vi.fn();
  });

  it("hydrates announcement and legal notices in passive effect phase and only re-runs when array or handler identity changes", () => {
    const firstHydrate = hydrateNoticesRef.current;
    const layoutCalls: number[] = [];
    const announcementsA = [makeNotice("a-1", "ANNOUNCEMENT")];
    const legalA = [makeNotice("l-1", "LEGAL_TERMS")];
    const legalB = [makeNotice("l-2", "LEGAL_TERMS")];

    function Probe({
      announcementNotices,
      legalNotices,
      tick: _tick,
    }: {
      announcementNotices: Notice[];
      legalNotices: Notice[];
      tick?: number;
    }) {
      useNoticeDialogHydrate({ announcementNotices, legalNotices });
      useLayoutEffect(() => {
        layoutCalls.push(firstHydrate.mock.calls.length);
      }, []);
      return null;
    }

    const { rerender } = render(
      <Probe
        announcementNotices={announcementsA}
        legalNotices={legalA}
        tick={1}
      />,
    );

    // Passive effect runs after mount layout effects.
    expect(layoutCalls).toEqual([0]);
    expect(firstHydrate).toHaveBeenCalledTimes(1);
    expect(firstHydrate).toHaveBeenLastCalledWith({
      announcementNotices: announcementsA,
      legalNotices: legalA,
    });

    // Re-rendering with a fresh wrapper object holding the same array references does not re-hydrate.
    rerender(
      <Probe
        announcementNotices={announcementsA}
        legalNotices={legalA}
        tick={2}
      />,
    );
    expect(firstHydrate).toHaveBeenCalledTimes(1);

    // Updating either notice array triggers hydration again.
    rerender(
      <Probe
        announcementNotices={announcementsA}
        legalNotices={legalB}
        tick={3}
      />,
    );
    expect(firstHydrate).toHaveBeenCalledTimes(2);
    expect(firstHydrate).toHaveBeenLastCalledWith({
      announcementNotices: announcementsA,
      legalNotices: legalB,
    });

    // Updating the context hydrate callback identity triggers hydration with the new function.
    const secondHydrate = vi.fn();
    hydrateNoticesRef.current = secondHydrate;
    rerender(
      <Probe
        announcementNotices={announcementsA}
        legalNotices={legalB}
        tick={4}
      />,
    );
    expect(secondHydrate).toHaveBeenCalledTimes(1);
    expect(secondHydrate).toHaveBeenLastCalledWith({
      announcementNotices: announcementsA,
      legalNotices: legalB,
    });
  });
});
