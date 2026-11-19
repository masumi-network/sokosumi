import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimilarTasksHint } from "./similar-tasks-hint";

const getTasks = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

function renderHint(brief: string, activeOrganizationId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SimilarTasksHint
        brief={brief}
        activeOrganizationId={activeOrganizationId}
      />
    </QueryClientProvider>,
  );
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
      expect.objectContaining({
        q: "newsle",
        scope: "workspace",
        status: expect.not.arrayContaining(["COMPLETED", "FAILED", "CANCELED"]),
      }),
    );
  });

  it("stays hidden and asks nothing for a brief too short to match", () => {
    renderHint("Fix it", null);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(getTasks).not.toHaveBeenCalled();
  });
});
