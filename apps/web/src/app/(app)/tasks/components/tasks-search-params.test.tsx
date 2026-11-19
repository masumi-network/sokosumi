import { expectConsole } from "@sokosumi/utils/test-console";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveTasksViewMock, routerReplaceMock, searchParamsRef } = vi.hoisted(
  () => ({
    saveTasksViewMock: vi.fn(
      async (_query: string, _organizationId: string | null) => undefined,
    ),
    routerReplaceMock: vi.fn(),
    searchParamsRef: { current: new URLSearchParams() },
  }),
);

vi.mock("@/app/tasks/actions", () => ({
  saveTasksView: (query: string, organizationId: string | null) =>
    saveTasksViewMock(query, organizationId),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const { TasksSearchParamsProvider, replaceTasksQuery, useTasksSearchParams } =
  await import("./tasks-search-params");

function ShowParams() {
  return <output>{useTasksSearchParams().toString()}</output>;
}

function renderAt(search: string, restoredQuery: string | null, org: string) {
  window.history.replaceState(null, "", `/tasks${search}`);
  searchParamsRef.current = new URLSearchParams(search);
  return render(
    <TasksSearchParamsProvider
      restoredQuery={restoredQuery}
      activeOrganizationId={org}
    >
      <ShowParams />
    </TasksSearchParamsProvider>,
  );
}

describe("TasksSearchParamsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the opened view before the address bar has it, then writes it there", () => {
    renderAt("?projectId=p-1", "scope=owned&status=READY", "org-a");

    expect(screen.getByRole("status").textContent).toBe(
      "projectId=p-1&scope=owned&status=READY",
    );
    expect(window.location.search).toBe(
      "?projectId=p-1&scope=owned&status=READY",
    );
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("loads the view this tab saved last over an older visited copy", () => {
    replaceTasksQuery(
      { replace: vi.fn() },
      "/tasks",
      new URLSearchParams("scope=owned&sort=priority"),
      "org-b",
    );

    renderAt("", "scope=owned&status=READY", "org-b");

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/tasks?scope=owned&sort=priority",
    );
  });
});

describe("replaceTasksQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the view part once per change, without the project", () => {
    const router = { replace: vi.fn() };
    const next = new URLSearchParams("projectId=p-1&scope=owned&stuck=1");

    replaceTasksQuery(router, "/tasks", next, "org-c");
    replaceTasksQuery(router, "/tasks", next, "org-c");

    expect(router.replace).toHaveBeenCalledWith(
      "/tasks?projectId=p-1&scope=owned&stuck=1",
    );
    expect(saveTasksViewMock).toHaveBeenCalledExactlyOnceWith(
      "scope=owned&stuck=1",
      "org-c",
    );
  });

  it("sends the save before the navigation, which would hold it back", () => {
    const router = { replace: vi.fn() };

    replaceTasksQuery(
      router,
      "/tasks",
      new URLSearchParams("scope=owned&status=DONE"),
      "org-d",
    );

    expect(saveTasksViewMock.mock.invocationCallOrder[0]).toBeLessThan(
      router.replace.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("saves a view again after its save failed", async () => {
    expectConsole("error", "Failed to save the Tasks view");
    saveTasksViewMock.mockRejectedValueOnce(new Error("Core down"));
    const router = { replace: vi.fn() };
    const next = new URLSearchParams("scope=owned&status=READY");

    replaceTasksQuery(router, "/tasks", next, "org-e");
    await waitFor(() => expect(saveTasksViewMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    replaceTasksQuery(router, "/tasks", next, "org-e");

    expect(saveTasksViewMock).toHaveBeenCalledTimes(2);
  });
});
