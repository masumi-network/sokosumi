import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getProjectsByIdMock } = vi.hoisted(() => ({
  getProjectsByIdMock: vi.fn(),
}));

vi.mock("@sokosumi/core-client", () => ({
  getProjectsById: (...args: unknown[]) => getProjectsByIdMock(...args),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => ({}),
}));

import { useDriveTasksFilterSelectedProjectName } from "./use-drive-tasks-filter-selected-project-name";

describe("useDriveTasksFilterSelectedProjectName", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns noProjectLabel for 'null', skips fetching when present in projects, and fetches missing projects", async () => {
    getProjectsByIdMock.mockResolvedValueOnce({
      data: { data: { id: "proj-2", name: "Launch" } },
    });

    const { result, rerender } = renderHook(
      ({
        projectId,
        projects,
      }: {
        projectId: string | null;
        projects: { id: string }[];
      }) =>
        useDriveTasksFilterSelectedProjectName(
          projectId,
          projects,
          "No project",
        ),
      {
        initialProps: {
          projectId: "null" as string | null,
          projects: [] as { id: string }[],
        },
      },
    );

    expect(result.current).toBe("No project");
    expect(getProjectsByIdMock).not.toHaveBeenCalled();

    rerender({ projectId: "proj-1", projects: [{ id: "proj-1" }] });
    expect(result.current).toBeNull();
    expect(getProjectsByIdMock).not.toHaveBeenCalled();

    rerender({ projectId: "proj-2", projects: [{ id: "proj-1" }] });
    await waitFor(() => expect(result.current).toBe("Launch"));
    expect(getProjectsByIdMock).toHaveBeenCalledTimes(1);
  });

  it("clears selectedProjectName when the lookup fails", async () => {
    getProjectsByIdMock.mockRejectedValueOnce(new Error("not found"));

    const { result } = renderHook(() =>
      useDriveTasksFilterSelectedProjectName("proj-missing", [], "No project"),
    );

    await waitFor(() => expect(getProjectsByIdMock).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });
});
