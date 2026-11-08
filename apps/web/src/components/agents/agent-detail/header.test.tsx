import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";

import { AgentDetailHeader } from "./header";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("@/components/agents/agent-action-buttons", () => ({
  AgentActionButtons: () => null,
  AgentActionButtonsSkeleton: () => null,
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/components/agents/agent-verified-badge", () => ({
  AgentVerifiedBadge: () => null,
}));

describe("AgentDetailHeader", () => {
  const agent = createMockCoreAgent({ id: "agent-1" });

  it("links to the viewer's jobs with this agent and shows how many", () => {
    render(<AgentDetailHeader agent={agent} myJobsCount={3} />);

    const link = screen.getByRole("link", { name: /yourJobs/ });
    expect(link).toHaveAttribute("href", "/agents/agent-1/jobs");
    expect(link).toHaveTextContent("3");
  });

  it.each([0, undefined])(
    "shows no jobs link when the viewer has %s jobs",
    (myJobsCount) => {
      render(<AgentDetailHeader agent={agent} myJobsCount={myJobsCount} />);

      expect(
        screen.queryByRole("link", { name: /yourJobs/ }),
      ).not.toBeInTheDocument();
    },
  );
});
