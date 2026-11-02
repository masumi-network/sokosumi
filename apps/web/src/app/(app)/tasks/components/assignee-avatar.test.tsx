import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssigneeAvatar } from "./assignee-avatar";

const bot = {
  id: "bot-1",
  name: "Jarvis",
  image: "https://blob/idle.png",
  kind: "sokoBot" as const,
};

describe("AssigneeAvatar", () => {
  it("crops a crafted Soko Bot avatar to its face", () => {
    render(
      <AssigneeAvatar assignee={{ ...bot, avatarStyleId: "crafted-desk" }} />,
    );
    const face = screen.getByRole("img", { name: "Jarvis" });
    expect(face).toHaveAttribute("src", "https://blob/idle.png");
    expect(face.className).toContain("size-[240%]");
  });

  it.each([["mascot"], [null], [undefined]])(
    "leaves a Soko Bot with style %s as it was",
    (avatarStyleId) => {
      render(<AssigneeAvatar assignee={{ ...bot, avatarStyleId }} />);
      expect(
        screen.queryByRole("img", { name: "Jarvis" })?.className ?? "",
      ).not.toContain("size-[240%]");
    },
  );

  it("never crops a user's photo", () => {
    render(
      <AssigneeAvatar
        assignee={{ ...bot, kind: "user", avatarStyleId: "crafted-desk" }}
      />,
    );
    expect(
      screen.queryByRole("img", { name: "Jarvis" })?.className ?? "",
    ).not.toContain("size-[240%]");
  });
});
