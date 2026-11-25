import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentTile } from "./agent-tile";

describe("AgentTile", () => {
  it("keeps the action outside the card link, so pressing it never opens the card", async () => {
    const onAction = vi.fn();
    const onNavigate = vi.fn((event: MouseEvent) => event.preventDefault());
    render(
      <AgentTile
        href="/agents/coworkers/elena"
        avatar={null}
        name="Elena"
        purpose="Marketing lead"
        meta="Sokosumi"
        action={
          <button type="button" onClick={onAction}>
            Chat
          </button>
        }
      />,
    );

    const link = screen.getByRole("link", { name: "Elena" });
    link.addEventListener("click", onNavigate);
    const action = screen.getByRole("button", { name: "Chat" });
    expect(link).toHaveAttribute("href", "/agents/coworkers/elena");
    expect(link.contains(action)).toBe(false);

    await userEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
