import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureRoom = vi.fn();
const sendMessage = vi.fn();
const push = vi.fn();

function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => translate,
  getFormatter: async () => ({
    relativeTime: () => "2h",
    dateTime: () => "Oct 23, 2026",
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: (...args: unknown[]) => ensureRoom(...args),
  sendRoomMessageAction: (...args: unknown[]) => sendMessage(...args),
}));
vi.mock("@/app/soko-bots/components/bot-face", () => ({
  BotFace: () => <span data-testid="bot-face" />,
}));
// The real composer is a rich editor; a plain textarea keeps the contract.
vi.mock("@/app/chat/components/room-composer", () => ({
  RoomComposer: (props: {
    value: string;
    onValueChange: (value: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    placeholder: string;
    sendDisabled: boolean;
  }) => (
    <form onSubmit={props.onSubmit}>
      <textarea
        aria-label="composer"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
      />
      <button type="submit" disabled={props.sendDisabled}>
        send
      </button>
    </form>
  ),
}));

import { SokoBotHome } from "./soko-bot-home";

const bot = {
  id: "bot-1",
  name: "Joseph",
  avatarSeed: null,
  avatarImageUrl: null,
};

async function renderHome(
  overrides: Partial<Parameters<typeof SokoBotHome>[0]> = {},
) {
  render(
    await SokoBotHome({
      bot,
      ownerId: "user-1",
      roomId: "room-1",
      userName: "Alice",
      summary: {
        since: new Date("2026-10-23T08:00:00Z"),
        completed: 3,
        awaitingInput: 0,
        createdByOtherHumans: 0,
        workedMinutes: 45,
        previous: { completed: 0, createdByOtherHumans: 0, workedMinutes: 0 },
      },
      teamTasks: [
        {
          id: "task-1",
          name: "Research EU marketplaces",
          status: "COMPLETED",
          updatedAt: new Date("2026-10-24T08:00:00Z"),
          who: "Hannah",
        },
      ],
      ...overrides,
    }),
  );
}

describe("SokoBotHome", () => {
  beforeEach(() => {
    sendMessage.mockResolvedValue({ ok: true, value: { id: "msg-2" } });
    ensureRoom.mockResolvedValue({ ok: true, value: { id: "room-new" } });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks the bot by name", async () => {
    await renderHome();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: 'headingWithName:{"name":"Alice"}',
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("bot-face")).toBeTruthy();
    expect(
      screen.getByPlaceholderText('placeholder:{"name":"Joseph"}'),
    ).toBeTruthy();
  });

  it("puts a suggested prompt in the composer to edit or send", async () => {
    await renderHome();
    fireEvent.click(
      screen.getByRole("button", { name: "suggestions.catchUp" }),
    );
    expect(
      (screen.getByLabelText("composer") as HTMLTextAreaElement).value,
    ).toBe("suggestions.catchUp");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("greets without a name when the account has none", async () => {
    await renderHome({ userName: null });
    expect(
      screen.getByRole("heading", { level: 1, name: "heading" }),
    ).toBeTruthy();
  });

  it("shows what the team did in the last day, each Task linked", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      'completed:{"count":3} · worked:{"minutes":45}',
    );
    const row = screen.getByRole("link", { name: /Research EU marketplaces/ });
    expect(row.getAttribute("href")).toBe("/tasks/task-1");
    expect(row.textContent).toContain("Hannah");
    expect(row.textContent).toContain("2h");
  });

  it("counts long work in hours", async () => {
    await renderHome({
      summary: {
        since: new Date(),
        completed: 0,
        awaitingInput: 0,
        createdByOtherHumans: 0,
        workedMinutes: 7200,
        previous: { completed: 0, createdByOtherHumans: 0, workedMinutes: 0 },
      },
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      'workedHours:{"hours":120}',
    );
  });

  it("says so when nothing moved", async () => {
    await renderHome({ teamTasks: [], summary: null });
    expect(screen.getByText('quietDay:{"name":"Joseph"}')).toBeTruthy();
  });

  it("links to tasks only when some need the user", async () => {
    const summary = {
      since: new Date(),
      completed: 0,
      awaitingInput: 3,
      createdByOtherHumans: 0,
      workedMinutes: 0,
      previous: { completed: 0, createdByOtherHumans: 0, workedMinutes: 0 },
    };
    await renderHome({ summary });
    expect(
      screen
        .getByRole("link", { name: 'awaiting:{"count":3}' })
        .getAttribute("href"),
    ).toBe("/tasks");
    cleanup();
    await renderHome({ summary: { ...summary, awaitingInput: 0 } });
    expect(screen.queryByText(/awaiting/)).toBeNull();
  });

  it("sends into the bot's room and opens it", async () => {
    await renderHome();
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "What needs me today?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/chat/rooms/room-1"),
    );
    expect(ensureRoom).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      "room-1",
      "What needs me today?",
      [],
      expect.objectContaining({ clientMessageId: expect.any(String) }),
    );
  });

  it("opens the bot's Direct first when it has none yet", async () => {
    await renderHome({ roomId: null });
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/chat/rooms/room-new"),
    );
    expect(ensureRoom).toHaveBeenCalledWith("bot-1");
    expect(sendMessage).toHaveBeenCalledWith(
      "room-new",
      "Hello",
      [],
      expect.any(Object),
    );
  });

  it("stays put when the send fails", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: { message: "no" } });
    await renderHome();
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});
