import { render } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { readVisitCounts } from "@/lib/navigation/likely-pages";

import { useRecordPageVisit } from "./use-record-page-visit";

function Probe({ pathname }: { pathname: string }) {
  useRecordPageVisit(pathname);
  return null;
}

describe("useRecordPageVisit", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records once on mount and only records again on a keyed remount", () => {
    const { rerender } = render(<Probe key="/tasks" pathname="/tasks" />);

    expect(readVisitCounts()).toEqual({ "/tasks": 1 });

    // Same key: passive mount effect does not re-run on prop change.
    rerender(<Probe key="/tasks" pathname="/agents" />);
    expect(readVisitCounts()).toEqual({ "/tasks": 1 });

    // Keyed remount: records the new pathname.
    rerender(<Probe key="/agents" pathname="/agents" />);
    expect(readVisitCounts()).toEqual({ "/tasks": 1, "/agents": 1 });
  });

  it("records a new visit when revealed again under React Activity", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <Probe pathname="/tasks" />
      </Activity>,
    );

    expect(readVisitCounts()).toEqual({ "/tasks": 1 });

    rerender(
      <Activity mode="hidden">
        <Probe pathname="/tasks" />
      </Activity>,
    );
    expect(readVisitCounts()).toEqual({ "/tasks": 1 });

    rerender(
      <Activity mode="visible">
        <Probe pathname="/tasks" />
      </Activity>,
    );
    expect(readVisitCounts()).toEqual({ "/tasks": 2 });
  });
});
