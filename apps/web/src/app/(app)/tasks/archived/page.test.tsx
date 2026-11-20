import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARCHIVED_SEARCH_MAX_LENGTH } from "./archived-search";
import ArchivedTasksPage from "./page";

const { listTasksMock } = vi.hoisted(() => ({ listTasksMock: vi.fn() }));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/form", () => ({
  default: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({ dateTime: () => "Nov 4, 2026" }),
}));
vi.mock("@/app/tasks/components/back-to-tasks-button", () => ({
  BackToTasksButton: () => null,
}));
vi.mock("./archived-tasks-loading", () => ({
  ArchivedTasksLoading: () => null,
}));
vi.mock("./archived-tasks-list", () => ({
  ArchivedTasksList: ({ query, total }: { query?: string; total: number }) => (
    <p data-testid="archived-list" data-total={total}>
      {query ?? ""}
    </p>
  ),
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { listTasks: listTasksMock },
}));

/** Renders the page's content, which streams inside its Suspense boundary. */
async function renderPage(q?: string) {
  const boundary = ArchivedTasksPage({
    searchParams: Promise.resolve(q === undefined ? {} : { q }),
  });
  const content = boundary.props.children;
  render(await content.type(content.props));
}

describe("ArchivedTasksPage search", () => {
  beforeEach(() => {
    listTasksMock.mockReset().mockResolvedValue({ tasks: [] });
  });

  it("sends a search at Core's limit unchanged and caps typing there", async () => {
    const query = "a".repeat(ARCHIVED_SEARCH_MAX_LENGTH);
    await renderPage(query);

    expect(listTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({ archived: true, q: query }),
    );
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "maxLength",
      String(ARCHIVED_SEARCH_MAX_LENGTH),
    );
  });

  it("cuts an overlong link search to Core's limit instead of failing", async () => {
    await renderPage("b".repeat(ARCHIVED_SEARCH_MAX_LENGTH + 50));

    const cut = "b".repeat(ARCHIVED_SEARCH_MAX_LENGTH);
    expect(listTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: cut }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue(cut);
    expect(screen.getByTestId("archived-list")).toHaveTextContent(cut);
  });

  it("lists every archived task without a search", async () => {
    await renderPage();

    expect(listTasksMock.mock.calls[0]?.[0]).not.toHaveProperty("q");
  });
});

describe("ArchivedTasksPage result count", () => {
  it("hands Core's match count to the list", async () => {
    listTasksMock.mockResolvedValue({ tasks: [], pagination: { total: 240 } });
    await renderPage("spring");
    expect(screen.getByTestId("archived-list")).toHaveAttribute(
      "data-total",
      "240",
    );
  });
});
