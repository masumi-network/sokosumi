import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";
import { getAgentName } from "@/lib/helpers/agent";

import { JobsListHeader } from "./jobs-list-header";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => null,
}));

describe("JobsListHeader", () => {
  const agent = createMockCoreAgent({ id: "agent-1" });
  const name = getAgentName(agent);

  it("names the agent and counts all of the viewer's jobs", () => {
    render(<JobsListHeader agent={agent} total={42} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(name);
    expect(screen.getByText("yourJobsCount:42")).toBeInTheDocument();
  });

  it("goes back to the agent's page, not the catalog", () => {
    render(<JobsListHeader agent={agent} total={1} />);

    const back = screen.getByRole("link", { name: `backToAgent:${name}` });
    expect(back).toHaveAttribute("href", "/agents/agent-1");
  });

  it("falls back to the catalog when the agent is unavailable", () => {
    render(<JobsListHeader agent={agent} total={3} disabled />);

    const back = screen.getByRole("link", { name: "back" });
    expect(back).toHaveAttribute("href", "/agents");
    expect(screen.getByText("yourJobsCount:3")).toBeInTheDocument();
  });
});
