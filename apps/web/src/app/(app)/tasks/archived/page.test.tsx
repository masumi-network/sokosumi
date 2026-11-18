import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "../../../../../messages/de.json";
import en from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";

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
  getTranslations: async (namespace: "App.Tasks.Archived") =>
    createTranslator({ locale: "en", messages: en, namespace }),
  getFormatter: async () => ({ dateTime: () => "Nov 4, 2026" }),
}));
vi.mock("@/app/tasks/components/back-to-tasks-button", () => ({
  BackToTasksButton: () => null,
}));
vi.mock("./archived-tasks-list", () => ({
  ArchivedTasksList: ({ query }: { query?: string }) => (
    <p data-testid="archived-list">{query ?? ""}</p>
  ),
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { listTasks: listTasksMock },
}));

async function renderPage(q?: string) {
  render(
    await ArchivedTasksPage({
      searchParams: Promise.resolve(q === undefined ? {} : { q }),
    }),
  );
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

describe("ArchivedTasksPage result summary", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `t${i}`,
      identifier: null,
      name: `Task ${i}`,
      status: "DRAFT",
      project: null,
      archivedAt: null,
    }));

  it.each([
    [0, "No archived tasks match \u201cspring\u201d."],
    [1, "1 archived task matches \u201cspring\u201d."],
    [2, "2 archived tasks match \u201cspring\u201d."],
  ])("reads %i results of the applied search aloud", async (count, text) => {
    listTasksMock.mockResolvedValue({
      tasks: rows(count),
      pagination: { total: count },
    });
    await renderPage("spring");

    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("says when only the latest page of matches shows", async () => {
    listTasksMock.mockResolvedValue({
      tasks: rows(100),
      pagination: { total: 240 },
    });
    await renderPage("spring");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the latest 100 of 240 archived tasks that match \u201cspring\u201d.",
    );
  });

  it("keeps an empty live region without a search, so the first one is read", async () => {
    await renderPage();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each([
    ["de", de],
    ["es", es],
  ])("has %s wording for every count", (locale, messages) => {
    const t = createTranslator({
      locale,
      messages,
      namespace: "App.Tasks.Archived",
    });
    for (const count of [0, 1, 2]) {
      expect(t("searchResults", { count, query: "x" })).toContain("x");
    }
    expect(
      t("searchResultsLimited", { shown: 100, total: 240, query: "x" }),
    ).toMatch(/100.*240/);
  });
});
