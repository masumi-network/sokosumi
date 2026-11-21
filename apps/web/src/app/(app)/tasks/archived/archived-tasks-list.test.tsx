import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isTaskArchived,
  markTaskArchived,
} from "@/app/tasks/utils/archived-task-ids";
import de from "../../../../../messages/de.json";
import es from "../../../../../messages/es.json";

import { ArchivedTasksList } from "./archived-tasks-list";

const { restoreMock, pushMock, refreshMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    restoreMock: vi.fn(),
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

const { localeRef } = vi.hoisted(() => ({
  localeRef: { current: "" as "" | "en" | "de" | "es" },
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const catalogs = {
    en: (await import("../../../../../messages/en.json")).default,
    de: (await import("../../../../../messages/de.json")).default,
    es: (await import("../../../../../messages/es.json")).default,
  };
  return {
    ...actual,
    // Keys by default; a real catalog when a test picks a locale.
    useTranslations: (namespace: "App.Tasks.Archived") =>
      localeRef.current
        ? actual.createTranslator({
            locale: localeRef.current,
            messages: catalogs[localeRef.current],
            namespace,
          })
        : (key: string) => key,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/services/task.client", () => ({
  taskClientService: { restore: restoreMock },
}));

const tasks = [
  {
    id: "t1",
    identifier: "SOK-7",
    name: "Plan launch",
    status: "DRAFT",
    project: "Launch",
    archivedOn: "Nov 4, 2026",
  },
  {
    id: "t2",
    identifier: null,
    name: "Write recap",
    status: "COMPLETED",
    project: null,
    archivedOn: null,
  },
] as const;

describe("ArchivedTasksList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localeRef.current = "";
  });

  it("restores a Task, drops its row and offers to open it", async () => {
    restoreMock.mockResolvedValue(undefined);
    // Archived earlier in this tab, so the board still hides it.
    markTaskArchived("t1");
    render(<ArchivedTasksList tasks={[...tasks]} total={2} />);

    fireEvent.click(screen.getAllByRole("button", { name: "restoreNamed" })[0]);

    await waitFor(() => expect(screen.queryByText("Plan launch")).toBeNull());
    expect(restoreMock).toHaveBeenCalledWith("t1");
    expect(isTaskArchived("t1")).toBe(false);
    expect(screen.getByText("Write recap")).toBeTruthy();
    expect(refreshMock).toHaveBeenCalled();

    const [, options] = toastSuccessMock.mock.calls[0];
    options.action.onClick();
    expect(pushMock).toHaveBeenCalledWith("/tasks/SOK-7-plan-launch");
  });

  it("wraps a long name to two lines so similar rows stay apart on a phone", () => {
    render(<ArchivedTasksList tasks={[...tasks]} total={2} />);

    const name = screen.getByText("Plan launch");
    expect(name).toHaveClass("line-clamp-2", "wrap-anywhere");
    expect(name).not.toHaveClass("truncate");
  });

  it("keeps the row and says so when restore fails", async () => {
    restoreMock.mockRejectedValue(new Error("409"));
    render(<ArchivedTasksList tasks={[...tasks]} total={2} />);

    fireEvent.click(screen.getAllByRole("button", { name: "restoreNamed" })[1]);

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("restoreError"),
    );
    expect(screen.getByText("Write recap")).toBeTruthy();
  });

  it("explains the empty list", () => {
    render(<ArchivedTasksList tasks={[]} total={0} />);
    expect(screen.getByText("empty")).toBeTruthy();
  });

  it("names the search that matched nothing", () => {
    render(<ArchivedTasksList tasks={[]} total={0} query="recap" />);
    expect(screen.getByText("noMatches")).toBeTruthy();
  });

  it("tells same-named rows apart and opens one read-only", () => {
    render(<ArchivedTasksList tasks={[...tasks]} total={2} />);

    expect(screen.getByText("SOK-7")).toBeTruthy();
    expect(screen.getByText("Launch · archivedOn")).toBeTruthy();
    expect(screen.getByText("noProject")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "SOK-7 Plan launch" }),
    ).toHaveAttribute("href", "/tasks/archived/t1");
  });

  it("restores a second Task while the first restore is still open", async () => {
    let finishFirst: () => void = () => {};
    restoreMock
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishFirst = resolve)),
      )
      .mockResolvedValueOnce(undefined);
    render(<ArchivedTasksList tasks={[...tasks]} total={2} />);
    const buttons = screen.getAllByRole("button", { name: "restoreNamed" });

    fireEvent.click(buttons[0]);
    // The first row stays where it is, so the second button did not move.
    expect(screen.getByText("Plan launch")).toBeTruthy();
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(screen.queryByText("Write recap")).toBeNull());
    expect(restoreMock).toHaveBeenCalledWith("t2");

    finishFirst();
    await waitFor(() => expect(screen.queryByText("Plan launch")).toBeNull());
  });
});

const row = (id: string) => ({
  id,
  identifier: null,
  name: `Task ${id}`,
  status: "DRAFT" as const,
  project: null,
  archivedOn: null,
});
const rows = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => row(`r${from + i}`));

describe("ArchivedTasksList result summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localeRef.current = "en";
  });

  it.each([
    [0, "No archived tasks match \u201cspring\u201d."],
    [1, "1 archived task matches \u201cspring\u201d."],
    [2, "2 archived tasks match \u201cspring\u201d."],
  ])("reads %i results of the applied search aloud", (count, text) => {
    render(
      <ArchivedTasksList tasks={rows(count)} total={count} query="spring" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("says when only the latest page of matches shows", () => {
    render(<ArchivedTasksList tasks={rows(100)} total={240} query="spring" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the latest 100 of 240 archived tasks that match \u201cspring\u201d.",
    );
  });

  it("never counts fewer matches than rows it shows", () => {
    // Core reads rows and count apart; a restore in between can leave a row
    // beside a lower count.
    render(<ArchivedTasksList tasks={rows(1)} total={0} query="spring" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 archived task matches \u201cspring\u201d.",
    );
  });

  it("keeps count and rows together through a restore and the refresh", async () => {
    restoreMock.mockResolvedValue(undefined);
    const { rerender } = render(
      <ArchivedTasksList tasks={rows(100)} total={102} query="spring" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore Task r0" }));

    await waitFor(() => expect(screen.queryByText("Task r0")).toBeNull());
    expect(screen.getAllByRole("listitem")).toHaveLength(99);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the latest 99 of 101",
    );

    // The refresh backfills the page from the next match.
    rerender(
      <ArchivedTasksList
        tasks={[...rows(99, 1), row("r100")]}
        total={101}
        query="spring"
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the latest 100 of 101",
    );
  });

  it("shows a restored Task again once it is archived again", async () => {
    restoreMock.mockResolvedValue(undefined);
    const { rerender } = render(
      <ArchivedTasksList tasks={[row("r0")]} total={1} query="spring" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore Task r0" }));
    await waitFor(() => expect(screen.queryByText("Task r0")).toBeNull());

    // The refresh confirms the restore.
    rerender(<ArchivedTasksList tasks={[]} total={0} query="spring" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No archived tasks match",
    );

    // Archived again elsewhere; the next refresh of the same search has it.
    rerender(
      <ArchivedTasksList tasks={[row("r0")]} total={1} query="spring" />,
    );
    expect(screen.getByText("Task r0")).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 archived task matches \u201cspring\u201d.",
    );
  });

  it("keeps one live region across searches", () => {
    const { rerender } = render(
      <ArchivedTasksList tasks={rows(3)} total={3} />,
    );
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    rerender(<ArchivedTasksList tasks={rows(1)} total={1} query="a" />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("1 archived task matches");

    rerender(<ArchivedTasksList tasks={[]} total={0} query="b" />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("No archived tasks match");
  });

  it.each([
    ["en", "Showing the latest 100 of 12,400"],
    ["de", "Die neuesten 100 von 12.400"],
    ["es", "Se muestran las 100 m\u00e1s recientes de 12.400"],
  ] as const)("groups a large %s total", (locale, text) => {
    localeRef.current = locale;
    render(<ArchivedTasksList tasks={rows(100)} total={12400} query="x" />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it.each(["de", "es"] as const)("has %s wording for 0, 1 and 2", (locale) => {
    const t = createTranslator({
      locale,
      messages: { de, es }[locale],
      namespace: "App.Tasks.Archived",
    });
    const texts = [0, 1, 2].map((count) =>
      t("searchResults", { count, query: "x" }),
    );
    expect(new Set(texts).size).toBe(3);
  });
});
