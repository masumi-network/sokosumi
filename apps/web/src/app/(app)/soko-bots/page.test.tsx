import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTeamMock = vi.fn();
const loadSharedMock = vi.fn();
const sectionMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));
vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class extends Error {},
}));
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getTeam: () => getTeamMock(),
    getStats: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("./shared-bots", () => ({ loadSharedBots: () => loadSharedMock() }));
vi.mock("./components/roster", () => ({
  SokoBotsHero: () => null,
  YourAssistantSection: () => null,
  TeamSection: () => null,
}));
vi.mock("./components/shared-bots-section", () => ({
  SharedBotsSection: (props: { canCreatePersonal: boolean }) => {
    sectionMock(props);
    return <section data-testid="shared-bots-section" />;
  },
}));

import SokoBotsPage from "./page";

function team(kind: "organization" | "personal", hasBot: boolean) {
  return {
    workspace: { id: "ws", kind, name: "NMKR", logo: null },
    members: [{ userId: "u", isYou: true, bot: hasBot ? { id: "b" } : null }],
  };
}

async function renderPage(): Promise<void> {
  render(await SokoBotsPage());
}

describe("SokoBotsPage shared bots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the section when Core sends no sharedBots", async () => {
    getTeamMock.mockResolvedValue(team("organization", true));
    loadSharedMock.mockResolvedValue(null);
    await renderPage();
    expect(screen.queryByTestId("shared-bots-section")).not.toBeInTheDocument();
  });

  it("hides the section in a personal workspace", async () => {
    getTeamMock.mockResolvedValue(team("personal", true));
    loadSharedMock.mockResolvedValue({ bots: [], projects: [] });
    await renderPage();
    expect(screen.queryByTestId("shared-bots-section")).not.toBeInTheDocument();
  });

  it("shows the section in an organization and offers a personal bot only to members without one", async () => {
    getTeamMock.mockResolvedValue(team("organization", false));
    loadSharedMock.mockResolvedValue({ bots: [], projects: [] });
    await renderPage();
    expect(screen.getByTestId("shared-bots-section")).toBeInTheDocument();
    expect(sectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ canCreatePersonal: true }),
    );
  });
});
