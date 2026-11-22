import type { ProjectListItem } from "@sokosumi/core-client";
import { act, render, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadMoreProjectsMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: loadMoreProjectsMock,
}));

import {
  isCopyDestination,
  useTaskScheduleCopyProjects,
} from "./use-task-schedule-copy-projects";

function makeProject(
  id: string,
  overrides: Partial<ProjectListItem> = {},
): ProjectListItem {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    workspaceId: "ws-1",
    name: `Project ${id}`,
    identifier: null,
    briefing: null,
    briefingUrl: null,
    latestUpdate: null,
    websiteUrl: null,
    logo: null,
    designMd: null,
    postingInstructionsMd: null,
    memoryEnabled: false,
    memoryModel: { id: "m1", label: "Model", region: "eu" },
    contextMd: null,
    contextMdUpdating: false,
    cmo: false,
    closingAt: null,
    closedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    taskCount: 0,
    jobCount: 0,
    lastActivityAt: timestamp,
    starredAt: null,
    ...overrides,
  };
}

describe("useTaskScheduleCopyProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters ineligible destinations, chains open into hidden pages, paginates, and drops stale responses on query change", async () => {
    const first = Promise.withResolvers<{
      projects: ProjectListItem[];
      nextCursor: string | null;
    }>();
    const secondOpen = Promise.withResolvers<{
      projects: ProjectListItem[];
      nextCursor: string | null;
    }>();
    loadMoreProjectsMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(secondOpen.promise)
      .mockResolvedValueOnce({
        projects: [makeProject("hidden-1")],
        nextCursor: "hidden-cursor-2",
      })
      .mockResolvedValueOnce({
        projects: [makeProject("hidden-2")],
        nextCursor: null,
      });

    const captured: {
      latest: ReturnType<typeof useTaskScheduleCopyProjects> | null;
    } = { latest: null };

    function Probe({ search }: { search: string }) {
      captured.latest = useTaskScheduleCopyProjects("current", search);
      return null;
    }

    const { rerender, unmount } = render(<Probe search="" />);
    expect(loadMoreProjectsMock).toHaveBeenCalledWith({
      cursor: null,
      query: undefined,
      state: "open",
    });

    // Change search while first request is still pending (debounces after 250ms).
    rerender(<Probe search="launch" />);
    await waitFor(() =>
      expect(loadMoreProjectsMock).toHaveBeenLastCalledWith({
        cursor: null,
        query: "launch",
        state: "open",
      }),
    );

    // Stale first response is ignored (non-null nextCursor avoids chaining into hidden state).
    await act(async () => {
      first.resolve({
        projects: [makeProject("stale")],
        nextCursor: "stale-next",
      });
      await first.promise;
    });
    expect(captured.latest?.projects).toEqual([]);

    // Open page contains only ineligible projects, so it continues into hidden state.
    await act(async () => {
      secondOpen.resolve({
        projects: [
          makeProject("current"),
          makeProject("cmo-proj", { cmo: true }),
          makeProject("closing-proj", {
            closingAt: new Date("2026-01-01"),
          }),
          makeProject("closed-proj", {
            closedAt: new Date("2026-01-01"),
          }),
        ],
        nextCursor: null,
      });
      await secondOpen.promise;
    });

    await waitFor(() =>
      expect(captured.latest?.projects.map((p) => p.id)).toEqual(["hidden-1"]),
    );
    expect(captured.latest?.hasNext).toBe(true);
    expect(captured.latest?.isLoading).toBe(false);

    await act(async () => {
      captured.latest?.loadMore();
    });
    await waitFor(() =>
      expect(captured.latest?.projects.map((p) => p.id)).toEqual([
        "hidden-1",
        "hidden-2",
      ]),
    );
    expect(captured.latest?.hasNext).toBe(false);

    expect(isCopyDestination(makeProject("ok"), "current")).toBe(true);
    expect(isCopyDestination(makeProject("current"), "current")).toBe(false);

    unmount();
  });

  it("matches StrictMode replay, Activity hide/reveal, and settles cleanly after unmount", async () => {
    const r1 = Promise.withResolvers<{
      projects: ProjectListItem[];
      nextCursor: string | null;
    }>();
    const r2 = Promise.withResolvers<{
      projects: ProjectListItem[];
      nextCursor: string | null;
    }>();
    const r3 = Promise.withResolvers<{
      projects: ProjectListItem[];
      nextCursor: string | null;
    }>();
    const r4 = Promise.withResolvers<{
      projects: ProjectListItem[];
      nextCursor: string | null;
    }>();
    loadMoreProjectsMock
      .mockReturnValueOnce(r1.promise)
      .mockReturnValueOnce(r2.promise)
      .mockResolvedValueOnce({ projects: [], nextCursor: null })
      .mockReturnValueOnce(r3.promise)
      .mockReturnValueOnce(r4.promise);

    const captured: {
      latest: ReturnType<typeof useTaskScheduleCopyProjects> | null;
    } = { latest: null };

    function Probe() {
      captured.latest = useTaskScheduleCopyProjects("current", "");
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(loadMoreProjectsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      r1.resolve({ projects: [makeProject("stale-strict")], nextCursor: "c1" });
      await r1.promise;
    });
    expect(captured.latest?.projects).toEqual([]);

    await act(async () => {
      r2.resolve({ projects: [makeProject("fresh-strict")], nextCursor: null });
      await r2.promise;
    });
    await waitFor(() =>
      expect(captured.latest?.projects.map((p) => p.id)).toEqual([
        "fresh-strict",
      ]),
    );

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(loadMoreProjectsMock).toHaveBeenCalledTimes(5);

    unmount();
    await act(async () => {
      r3.resolve({ projects: [makeProject("after-3")], nextCursor: "c3" });
      r4.resolve({ projects: [makeProject("after-4")], nextCursor: "c4" });
      await Promise.all([r3.promise, r4.promise]);
    });
    expect(loadMoreProjectsMock).toHaveBeenCalledTimes(5);
  });
});
