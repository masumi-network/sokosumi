import { render, screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { WritingSkillsView } from "./writing-skills-view";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages: en, namespace } as never),
}));

const skill = (id: string, name: string) => ({
  id,
  name,
  description: `Read before any ${name} post.`,
  channels: [id],
  content: `# ${name}\n\nShort paragraphs.`,
  checklist: [
    { rule: `${name} rule one.` },
    { rule: `${name} rule two.`, formats: ["post"], counted: true },
  ],
});

const GROUPS = [
  {
    key: "foundations",
    name: "Foundations",
    skills: [skill("brand-voice", "Brand voice")],
  },
  {
    key: "social",
    name: "Social networks",
    skills: [skill("x", "X"), skill("linkedin", "LinkedIn")],
  },
];

describe("WritingSkillsView", () => {
  it("lists every skill under its group and shows the selected one in full", async () => {
    render(await WritingSkillsView({ groups: GROUPS, selectedId: "linkedin" }));

    const list = screen.getByRole("navigation", { name: "Writing skills" });
    expect(within(list).getByText("Foundations")).toBeTruthy();
    expect(within(list).getByText("Social networks")).toBeTruthy();
    const current = within(list).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("LinkedIn");
    expect(current.getAttribute("href")).toBe("?skill=linkedin");

    expect(
      screen.getByRole("heading", { level: 1, name: "LinkedIn" }),
    ).toBeTruthy();
    expect(screen.getByText("Read before any LinkedIn post.")).toBeTruthy();
    expect(screen.getByText("Before you save")).toBeTruthy();
    expect(screen.getByText("LinkedIn rule two.")).toBeTruthy();
    expect(screen.getByText("Only for post · Counted in code")).toBeTruthy();
    expect(screen.queryByText("X rule one.")).toBeNull();
  });

  it("opens the first skill when none or an unknown one is asked for", async () => {
    render(await WritingSkillsView({ groups: GROUPS, selectedId: "nope" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Brand voice" }),
    ).toBeTruthy();
  });
});
