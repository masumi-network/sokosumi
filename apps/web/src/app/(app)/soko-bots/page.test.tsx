import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadMock, sectionsMock, notSetUpMock, createMock, refreshMock } =
  vi.hoisted(() => ({
    loadMock: vi.fn(),
    sectionsMock: vi.fn(),
    notSetUpMock: vi.fn(),
    createMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));
// The real Try again button; refresh renders the page again, as Next does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("./managed-bots", () => ({
  loadSokoBotsManagement: () => loadMock(),
}));
vi.mock("./components/managed-bot-sections", () => ({
  ManagedBotSections: (props: { action: React.ReactNode }) => {
    sectionsMock(props);
    return <section data-testid="manage">{props.action}</section>;
  },
}));
vi.mock("./components/not-set-up-section", () => ({
  NotSetUpSection: (props: object) => {
    notSetUpMock(props);
    return <section data-testid="not-set-up" />;
  },
}));
vi.mock("./components/create-soko-bot-dialog.client", () => ({
  CreateSokoBotDialog: (props: object) => {
    createMock(props);
    return <button type="button">create</button>;
  },
}));

import SokoBotsPage from "./page";

type Kind = "organization" | "personal";

function team(kind: Kind, role = "member") {
  return {
    workspace: { id: "ws", kind, name: "Acme", logo: null },
    members: [
      { userId: "me", name: "Me", image: null, role, isYou: true, bot: null },
      {
        userId: "zo",
        name: "Zara",
        image: null,
        role: "member",
        isYou: false,
        bot: null,
      },
    ],
  };
}

const ownBot = { id: "own", owner: { kind: "you" }, archivedAt: null };
const teamBot = { id: "atlas", owner: { kind: "team" }, archivedAt: null };

describe("SokoBotsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists your bot and the shared ones, and offers a personal bot only when you have none", async () => {
    loadMock.mockResolvedValue({
      team: team("organization"),
      bots: [ownBot, teamBot],
      projects: [],
    });
    render(await SokoBotsPage());

    expect(sectionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ bots: [ownBot, teamBot] }),
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ canCreatePersonal: false }),
    );
    expect(screen.getByRole("link", { name: /allAgents/ })).toHaveAttribute(
      "href",
      "/agents",
    );
  });

  it("offers a personal bot in the create dialog when you have none", async () => {
    loadMock.mockResolvedValue({
      team: team("organization"),
      bots: [teamBot],
      projects: [],
    });
    render(await SokoBotsPage());
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ canCreatePersonal: true }),
    );
  });

  it("shows teammates without a bot, with the invite link for owners and admins", async () => {
    loadMock.mockResolvedValue({
      team: team("organization", "owner"),
      bots: [],
      projects: [],
    });
    render(await SokoBotsPage());
    expect(notSetUpMock).toHaveBeenCalledWith({
      others: [expect.objectContaining({ userId: "zo" })],
      canInvite: true,
    });
  });

  it("keeps the invite link from members", async () => {
    loadMock.mockResolvedValue({
      team: team("organization"),
      bots: [],
      projects: [],
    });
    render(await SokoBotsPage());
    expect(notSetUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ canInvite: false }),
    );
  });

  it("links to the assistant setup in a personal workspace without a bot", async () => {
    loadMock.mockResolvedValue({
      team: team("personal"),
      bots: [],
      projects: null,
    });
    render(await SokoBotsPage());
    expect(screen.getByRole("link", { name: "setUpOwn" })).toHaveAttribute(
      "href",
      "/personal-assistant",
    );
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("not-set-up")).not.toBeInTheDocument();
  });

  it("says so with Try again when the team can't be read, and recovers", async () => {
    loadMock
      .mockResolvedValueOnce({ team: null, bots: [], projects: null })
      .mockResolvedValueOnce({
        team: team("organization"),
        bots: [ownBot],
        projects: [],
      });
    const { rerender } = render(await SokoBotsPage());
    expect(screen.getByText("Unavailable.title")).toBeInTheDocument();
    expect(screen.queryByTestId("manage")).not.toBeInTheDocument();

    refreshMock.mockImplementation(async () => {
      rerender(await SokoBotsPage());
    });
    fireEvent.click(screen.getByRole("button", { name: "Unavailable.retry" }));

    await waitFor(() =>
      expect(screen.getByTestId("manage")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Unavailable.title")).not.toBeInTheDocument();
  });
});
