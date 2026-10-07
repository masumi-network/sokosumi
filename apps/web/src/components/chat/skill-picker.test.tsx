import type { ChatSkillCatalogItem } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchChatSkillsMock } = vi.hoisted(() => ({
  fetchChatSkillsMock: vi.fn(),
}));

vi.mock("./fetch-chat-skills", () => ({
  fetchChatSkills: fetchChatSkillsMock,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
  useFormatter: () => ({ number: (value: number) => String(value) }),
}));

import { MAX_SKILLS_PER_MESSAGE, SkillPicker } from "./skill-picker";

const react: ChatSkillCatalogItem = {
  id: "vercel-labs/agent-skills/react",
  name: "react",
  source: "vercel-labs/agent-skills",
  description: "React rules",
  installs: 1200,
};
const grill: ChatSkillCatalogItem = {
  id: "mattpocock/skills/grill-me",
  name: "grill-me",
  source: "mattpocock/skills",
  description: null,
  installs: 900,
};

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  fetchChatSkillsMock.mockReset();
  fetchChatSkillsMock.mockResolvedValue([react, grill]);
});

describe("SkillPicker", () => {
  it("lists the top skills and attaches the one picked", async () => {
    const onPick = vi.fn();
    render(wrap(<SkillPicker selected={[]} onPick={onPick} />));

    fireEvent.click(screen.getByRole("button", { name: "add" }));
    fireEvent.click(await screen.findByText("grill-me"));

    expect(fetchChatSkillsMock).toHaveBeenCalledWith("");
    expect(onPick).toHaveBeenCalledWith({
      id: grill.id,
      name: "grill-me",
      description: null,
      url: "https://skills.sh/mattpocock/skills/grill-me",
    });
  });

  it("shows the source when a skill has no description", async () => {
    render(wrap(<SkillPicker selected={[]} onPick={vi.fn()} />));

    fireEvent.click(screen.getByRole("button", { name: "add" }));

    expect(await screen.findByText("mattpocock/skills")).toBeDefined();
    expect(screen.getByText("React rules")).toBeDefined();
  });

  it("picks the first skill not yet attached on Enter", async () => {
    const onPick = vi.fn();
    render(
      wrap(
        <SkillPicker
          selected={[
            {
              id: react.id,
              name: react.name,
              description: react.description,
              url: "https://skills.sh/vercel-labs/agent-skills/react",
            },
          ]}
          onPick={onPick}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "add" }));
    await screen.findByText("grill-me");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: grill.id }),
    );
  });

  it("is disabled once a message has the maximum number of skills", () => {
    const selected = Array.from({ length: MAX_SKILLS_PER_MESSAGE }, (_, i) => ({
      id: `a/b/${i}`,
      name: `skill-${i}`,
      description: null,
      url: `https://skills.sh/a/b/${i}`,
    }));
    render(wrap(<SkillPicker selected={selected} onPick={vi.fn()} />));

    expect(
      (screen.getByRole("button", { name: "add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("says so when the skills cannot be loaded", async () => {
    fetchChatSkillsMock.mockResolvedValue(null);
    render(wrap(<SkillPicker selected={[]} onPick={vi.fn()} />));

    fireEvent.click(screen.getByRole("button", { name: "add" }));

    expect(await screen.findByText("unavailable")).toBeDefined();
  });
});
