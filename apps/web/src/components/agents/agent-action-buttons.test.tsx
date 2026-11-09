import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockCoreAgent } from "@/lib/helpers/__tests__/fixtures/core-agent";

import { AgentActionButtons } from "./agent-action-buttons";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: true }),
}));

vi.mock("@/components/share-button", () => ({
  ShareButton: () => null,
}));

describe("AgentActionButtons mobile Back from a job", () => {
  const agent = createMockCoreAgent({ id: "agent-1" });

  beforeEach(() => {
    push.mockClear();
    window.history.replaceState(null, "", "/agents/agent-1/jobs/job-1");
  });

  it("returns to the agent's page", () => {
    render(<AgentActionButtons agent={agent} showShareButton={false} />);
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(push).toHaveBeenCalledWith("/agents/agent-1");
  });

  it("returns to the catalog when the agent is unavailable", () => {
    render(
      <AgentActionButtons
        agent={agent}
        showShareButton={false}
        agentUnavailable
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(push).toHaveBeenCalledWith("/agents");
  });
});
