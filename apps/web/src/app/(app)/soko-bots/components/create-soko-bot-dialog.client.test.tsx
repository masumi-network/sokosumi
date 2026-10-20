import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const createMock = vi.fn();
const toastErrorMock = vi.fn();
const openRoomMock = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastErrorMock(...a) },
}));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  createScopedSokoBotAction: (...a: unknown[]) => createMock(...a),
}));
vi.mock("@/app/personal-assistant/components/open-new-soko-bot-room", () => ({
  openNewSokoBotRoom: (...a: unknown[]) => openRoomMock(...a),
}));
vi.mock("@/lib/schedules/timezones", () => ({
  getDefaultTimezone: () => "Europe/Berlin",
}));

import { CreateSokoBotDialog } from "./create-soko-bot-dialog.client";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function open(
  canCreatePersonal: boolean,
  defaultScope: "workspace" | "project" = "workspace",
): void {
  render(
    <CreateSokoBotDialog
      canCreatePersonal={canCreatePersonal}
      projects={[{ id: "p1", name: "Launch" }]}
      defaultScope={defaultScope}
      defaultProjectId={defaultScope === "project" ? "p1" : null}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "trigger" }));
}

function submit(name: string): void {
  fireEvent.change(screen.getByLabelText("nameLabel"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "submit" }));
}

describe("CreateSokoBotDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers a personal bot only to a member without one", () => {
    open(false);
    expect(screen.queryByText("scopes.personal.label")).not.toBeInTheDocument();
    expect(screen.getByText("scopes.workspace.label")).toBeInTheDocument();
  });

  it("creates a workspace bot and opens its console", async () => {
    createMock.mockResolvedValue({ ok: true, value: { id: BOT_ID } });
    open(true);
    submit(" Ops ");
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/soko-bots/${BOT_ID}`),
    );
    expect(createMock).toHaveBeenCalledWith({
      input: {
        name: "Ops",
        scope: "workspace",
        projectId: null,
        timezone: "Europe/Berlin",
      },
    });
    expect(openRoomMock).not.toHaveBeenCalled();
  });

  it("opens a new personal bot in its direct room, as the assistant page does", async () => {
    createMock.mockResolvedValue({ ok: true, value: { id: BOT_ID } });
    openRoomMock.mockResolvedValue("room-1");
    open(true);
    fireEvent.click(screen.getByText("scopes.personal.label"));
    submit("Atlas");
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/chat/rooms/room-1"),
    );
    expect(openRoomMock).toHaveBeenCalledWith(BOT_ID);
    expect(createMock).toHaveBeenCalledWith({
      input: expect.objectContaining({ scope: "personal", projectId: null }),
    });
  });

  it("falls back to the assistant console when the room does not open", async () => {
    createMock.mockResolvedValue({ ok: true, value: { id: BOT_ID } });
    openRoomMock.mockResolvedValue(null);
    open(true);
    fireEvent.click(screen.getByText("scopes.personal.label"));
    submit("Atlas");
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/personal-assistant"),
    );
  });

  it("creates a project bot for the preselected project", async () => {
    createMock.mockResolvedValue({ ok: true, value: { id: BOT_ID } });
    open(false, "project");
    submit("Launch bot");
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith({
      input: {
        name: "Launch bot",
        scope: "project",
        projectId: "p1",
        timezone: "Europe/Berlin",
      },
    });
  });

  it("keeps the dialog open and reports Core's refusal", async () => {
    createMock.mockResolvedValue({
      ok: false,
      error: { message: "Only admins may create workspace bots" },
    });
    open(true);
    submit("Ops");
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Only admins may create workspace bots",
      ),
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "submit" })).toBeInTheDocument();
  });

  it("does not submit without a name", () => {
    open(true);
    expect(screen.getByRole("button", { name: "submit" })).toBeDisabled();
  });
});
