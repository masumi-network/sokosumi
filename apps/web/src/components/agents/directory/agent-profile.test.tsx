import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentProfile } from "./agent-profile";

vi.mock("@/components/back-link", () => ({
  BackLink: ({ children }: { children: React.ReactNode }) => (
    <a href="/agents">{children}</a>
  ),
}));

describe("AgentProfile", () => {
  it("keeps one section order and leaves out sections that do not apply", () => {
    render(
      <AgentProfile
        backLabel="Agents"
        avatar={null}
        name="Elena"
        byline="by Serviceplan"
        tag="External"
        actions={<button type="button">Give a task</button>}
        sections={[
          { id: "about", title: "About", content: "facts" },
          false,
          { id: "what", title: "What it does", content: "plans" },
          null,
          { id: "settings", title: "Settings", content: "tools" },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Elena" }),
    ).toBeInTheDocument();
    expect(screen.getByText("External")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["What it does", "Settings", "About"]);
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/agents",
    );
  });
});
