import type { SharedSokoBotSummary } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageListSearchContext } from "@/components/page-list-search";

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/components/soko-bot/bot-face", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/soko-bot/bot-face")>()),
  BotFace: () => <span />,
}));
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
    cuso: false,
    ...overrides,
  };
}

async function renderSection(
  bots: SharedSokoBotSummary[],
  query = "",
): Promise<void> {
  render(
    <PageListSearchContext.Provider value={{ query, register: () => () => {} }}>
      {
        await SharedBotsSection({
          bots,
          projects: [{ id: "p1", name: "Launch" }],
          canCreatePersonal: false,
          defaultScope: "workspace",
          title: "Shared",
        })
      }
    </PageListSearchContext.Provider>,
  );
}

const archivedAt = new Date("2026-10-01");

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
    await renderSection([bot({ archivedAt })]);
    fireEvent.click(
      screen.getByRole("button", { name: /Shared.archivedGroup/ }),
    );
    expect(screen.getByText("Shared.archived")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^chat$/ }),
    ).not.toBeInTheDocument();
  });

  it("lists live bots first and folds archived ones away until opened", async () => {
    await renderSection([
      bot({ id: "a1", name: "Old", archivedAt }),
      bot({ id: "b2", name: "Live" }),
      bot({ id: "a2", name: "Older", archivedAt }),
    ]);
    expect(
      screen.getByText('Shared.countSplit:{"active":1,"archived":2}'),
    ).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /Shared.archivedGroup/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("Older")).toBeInTheDocument();
  });

  it("says no bot is active when every bot is archived", async () => {
    await renderSection([bot({ archivedAt })]);
    expect(screen.getByText("Shared.noneActive")).toBeInTheDocument();
    expect(screen.queryByText("Shared.empty")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Shared.archivedGroup/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the plain count and no archive row without archived bots", async () => {
    await renderSection([bot({})]);
    expect(screen.getByText('Shared.count:{"count":1}')).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Shared.archivedGroup/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the archive row to show archived matches while filtering", async () => {
    await renderSection(
      [
        bot({ id: "b2", name: "Live" }),
        bot({ id: "a1", name: "Old", archivedAt }),
      ],
      "old",
    );
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Shared.archivedGroup/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the archive row when the filter matches no archived bot", async () => {
    await renderSection(
      [
        bot({ id: "b2", name: "Live" }),
        bot({ id: "a1", name: "Old", archivedAt }),
      ],
      "live",
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Shared.archivedGroup/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty note and still offers to create a bot", async () => {
    await renderSection([]);
    expect(screen.getByText("Shared.empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "create" })).toBeInTheDocument();
  });
});
