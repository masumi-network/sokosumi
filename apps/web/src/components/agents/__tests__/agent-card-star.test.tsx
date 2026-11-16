import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";

import { AgentCard } from "../agent-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.name ? `${key} ${values.name}` : key,
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

const AGENT: CatalogBrowseAgent = {
  id: "a1",
  kind: "cardano",
  name: "Writer",
  description: null,
  summary: null,
  image: null,
  icon: null,
  categories: [],
  metrics: {
    executions: { count: 0, averageTime: null },
    ratings: { total: 0, average: null },
  },
  author: { name: null, image: null, organization: null, other: null },
  externalUrl: null,
};

describe("AgentCard star", () => {
  it("has no star without a toggle handler", () => {
    render(<AgentCard agent={AGENT} />);
    expect(screen.queryByRole("button", { name: "star Writer" })).toBeNull();
  });

  it("is a pressed toggle beside the card link, never inside it", () => {
    const onToggleStar = vi.fn();
    render(<AgentCard agent={AGENT} starred onToggleStar={onToggleStar} />);

    const star = screen.getByRole("button", { name: "star Writer" });
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(star.closest("a")).toBeNull();
    expect(screen.getByRole("link")).toBeTruthy();

    fireEvent.click(star);
    expect(onToggleStar).toHaveBeenCalledWith("a1");
  });

  it("shows a running save and blocks another click", () => {
    const onToggleStar = vi.fn();
    render(<AgentCard agent={AGENT} starPending onToggleStar={onToggleStar} />);

    const star = screen.getByRole("button", { name: "star Writer" });
    expect(star.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(star);
    expect(onToggleStar).not.toHaveBeenCalled();
  });
});
