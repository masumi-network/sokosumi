import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssigneeAvatar } from "./assignee-avatar";

const bot = {
  id: "bot-1",
  name: "Jarvis",
  image: null,
  kind: "sokoBot" as const,
};

describe("AssigneeAvatar", () => {
  it("draws the orb for a Soko Bot with no picture", () => {
    render(<AssigneeAvatar assignee={bot} />);
    expect(screen.getByRole("img", { name: "Jarvis" })).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });

  it("shows a Soko Bot's picture like any other assignee's, never a loop", () => {
    render(
      <AssigneeAvatar assignee={{ ...bot, image: "https://blob/m.webp" }} />,
    );
    expect(document.querySelector("video")).toBeNull();
    expect(
      screen.queryByRole("img", { name: "Jarvis" })?.className ?? "",
    ).not.toContain("size-[240%]");
  });
});
