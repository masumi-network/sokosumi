import type { ChatRoomMessageSkill } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));

import { ComposerSkillChips, MessageSkillChips } from "./skill-chip";

const skill: ChatRoomMessageSkill = {
  id: "mattpocock/skills/grill-me",
  name: "grill-me",
  description: "A relentless interview to sharpen a plan.",
  url: "https://skills.sh/mattpocock/skills/grill-me",
};

describe("MessageSkillChips", () => {
  it("renders nothing without skills", () => {
    const { container } = render(<MessageSkillChips skills={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("previews a skill with a link to skills.sh, never its content", () => {
    render(<MessageSkillChips skills={[skill]} />);

    fireEvent.click(screen.getByRole("button", { name: "chipLabel:grill-me" }));

    expect(screen.getByText(skill.description as string)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "viewOnSkillsSh" }).getAttribute("href"),
    ).toBe(skill.url);
  });
});

describe("ComposerSkillChips", () => {
  it("removes a skill from the next message", () => {
    const onRemove = vi.fn();
    render(<ComposerSkillChips skills={[skill]} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "remove:grill-me" }));

    expect(onRemove).toHaveBeenCalledWith(skill);
  });
});
