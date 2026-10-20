import type { SharedSokoBotSummary } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("./bot-face", () => ({ BotFace: () => <span /> }));
vi.mock("./create-soko-bot-dialog.client", () => ({
  CreateSokoBotDialog: () => <button type="button">create</button>,
}));

import { SharedBotsSection } from "./shared-bots-section";

function bot(overrides: Partial<SharedSokoBotSummary>): SharedSokoBotSummary {
  return {
    id: "b1",
    name: "Ops",
    scope: "workspace",
    projectId: null,
    avatarSeed: null,
    avatarImageUrl: null,
    status: "IDLE",
    archivedAt: null,
    sharedRoomId: "room-1",
    viewerCanManage: false,
    ...overrides,
  };
}

async function renderSection(bots: SharedSokoBotSummary[]): Promise<void> {
  render(
    await SharedBotsSection({
      bots,
      projects: [{ id: "p1", name: "Launch" }],
      canCreatePersonal: false,
      defaultScope: "workspace",
      title: "Shared",
    }),
  );
}

describe("SharedBotsSection", () => {
  it("lists a workspace bot and a project bot with its project name", async () => {
    await renderSection([
      bot({}),
      bot({ id: "b2", name: "Launch bot", scope: "project", projectId: "p1" }),
    ]);
    expect(screen.getByText("Shared.scopeWorkspace")).toBeInTheDocument();
    expect(
      screen.getByText('Shared.scopeProjectNamed:{"project":"Launch"}'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /chat/ })[0]).toHaveAttribute(
      "href",
      "/chat/rooms/room-1",
    );
  });

  it("marks an archived bot and drops its room link", async () => {
    await renderSection([bot({ archivedAt: new Date("2026-10-01") })]);
    expect(screen.getByText("Shared.archived")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^chat$/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty note and still offers to create a bot", async () => {
    await renderSection([]);
    expect(screen.getByText("Shared.empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "create" })).toBeInTheDocument();
  });
});
