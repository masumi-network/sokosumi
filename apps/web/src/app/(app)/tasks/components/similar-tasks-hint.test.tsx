import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimilarTasksHint } from "./similar-tasks-hint";

const getTasks = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("use-debounce", () => ({ useDebounce: (value: unknown) => [value] }));
vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTasks: (query: unknown) => getTasks(query) },
}));

const task = (id: string, name: string, identifier: string | null = null) => ({
  id,
  name,
  identifier,
  status: "READY",
});

function hint(
  queryClient: QueryClient,
  brief: string,
  activeOrganizationId: string | null,
) {
  return (
    <QueryClientProvider client={queryClient}>
      <SimilarTasksHint
        brief={brief}
        activeOrganizationId={activeOrganizationId}
      />
    </QueryClientProvider>
  );
}

function renderHint(brief: string, activeOrganizationId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(hint(queryClient, brief, activeOrganizationId));
  return {
    ...view,
    rerenderHint: (nextBrief: string, nextOrganizationId: string | null) =>
      view.rerender(hint(queryClient, nextBrief, nextOrganizationId)),
  };
}

beforeEach(() => {
  getTasks.mockReset();
});

describe("SimilarTasksHint", () => {
  it("lists open workspace Tasks that share words with the brief, opening each in a new tab", async () => {
    getTasks.mockResolvedValue({
      data: [
        task("a", "Launch newsletter", "MKT-4"),
        task("b", "Unrelated newsletter footer"),
      ],
    });

    renderHint("Write the launch newsletter", "org-1");

    const link = await screen.findByRole("link", {
      name: /Launch newsletter/,
    });
    expect(link).toHaveAttribute("href", "/tasks/MKT-4-launch-newsletter");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ q: "newsle", scope: "workspace" }),
    );
    const { status } = getTasks.mock.calls[0][0] as { status: string[] };
    expect(status).toContain("READY");
    for (const closed of ["COMPLETED", "FAILED", "CANCELED"]) {
      expect(status).not.toContain(closed);
    }
  });

  it("announces how many matches it found without moving focus", async () => {
    getTasks.mockResolvedValue({
      data: [task("a", "Launch newsletter", "MKT-4")],
    });

    renderHint("Write the launch newsletter", "org-1");

    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(status).toHaveTextContent('announcement {"count":1}'),
    );
  });

  it("drops the previous workspace's matches while the new workspace loads", async () => {
    getTasks.mockResolvedValue({
      data: [task("a", "Launch newsletter", "ORG1-4")],
    });
    const { rerenderHint } = renderHint("Write the launch newsletter", "org-1");
    await screen.findByRole("link", { name: /ORG1-4/ });

    const callsBefore = getTasks.mock.calls.length;
    getTasks.mockReturnValue(new Promise(() => {}));
    rerenderHint("Write the launch newsletter", "org-2");

    // The new workspace's reads are in flight and never answer.
    await waitFor(() =>
      expect(getTasks.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    expect(screen.queryByRole("link", { name: /ORG1-4/ })).toBeNull();
  });

  it("keeps the matches on screen while the same workspace reads a longer brief", async () => {
    getTasks.mockResolvedValue({
      data: [task("a", "Launch newsletter", "MKT-4")],
    });
    const { rerenderHint } = renderHint("Write the launch newsletter", "org-1");
    await screen.findByRole("link", { name: /MKT-4/ });

    getTasks.mockReturnValue(new Promise(() => {}));
    rerenderHint("Write the launch newsletter for pricing", "org-1");

    expect(screen.getByRole("link", { name: /MKT-4/ })).toBeInTheDocument();
  });

  it("stays hidden and asks nothing for a brief too short to match", () => {
    renderHint("Fix it", null);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(getTasks).not.toHaveBeenCalled();
  });
});
