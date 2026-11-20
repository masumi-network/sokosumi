import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type FormEvent, type Ref, useImperativeHandle, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureRoom = vi.fn();
const sendMessage = vi.fn();
const push = vi.fn();
/** The composer's text at the moment the caret was put at its end. */
const focusedAtEnd = vi.fn();

function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => translate,
  getFormatter: async () => ({
    // Without `now` the real formatter reads the clock itself.
    relativeTime: (_at: Date, options?: { now?: Date }) => {
      if (!options?.now) throw new Error("relativeTime without now");
      return "2h";
    },
    dateTime: () => "Oct 23, 2026",
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: (...args: unknown[]) => ensureRoom(...args),
  sendRoomMessageAction: (...args: unknown[]) => sendMessage(...args),
}));
vi.mock("@/components/soko-bot/bot-face", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/soko-bot/bot-face")>()),
  BotFace: () => <span data-testid="bot-face" />,
}));
// The real composer is a rich editor; a plain textarea keeps the contract.
vi.mock("@/app/chat/components/room-composer", () => ({
  RoomComposer: function RoomComposer(props: {
    ref?: Ref<{ focus: () => void; focusAtEnd: () => void }>;
    value: string;
    onValueChange: (value: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    placeholder: string;
    sendDisabled: boolean;
  }) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(props.ref, () => ({
      focus: () => {},
      focusAtEnd: () => focusedAtEnd(textareaRef.current?.value),
    }));
    return (
      <form onSubmit={props.onSubmit}>
        <textarea
          ref={textareaRef}
          aria-label="composer"
          placeholder={props.placeholder}
          value={props.value}
          onChange={(event) => props.onValueChange(event.target.value)}
        />
        <button type="submit" disabled={props.sendDisabled}>
          send
        </button>
      </form>
    );
  },
}));

import { SokoBotHome } from "./soko-bot-home";

const bot = {
  id: "bot-1",
  name: "Joseph",
  avatarSeed: null,
  avatarImageUrl: null,
};

function homeProps(
  overrides: Partial<Parameters<typeof SokoBotHome>[0]> = {},
): Parameters<typeof SokoBotHome>[0] {
  return {
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
    now: new Date("2026-10-24T10:00:00Z"),
    ...overrides,
  };
}

async function renderHome(
  overrides: Partial<Parameters<typeof SokoBotHome>[0]> = {},
) {
  render(await SokoBotHome(homeProps(overrides)));
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

  // Home renders this outside Suspense. A clock read here, outside the
  // page's prefetch cache, would cut a link prefetch of Home short.
  it("reads no clock of its own", async () => {
    const RealDate = Date;
    class ClockFreeDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date> | []) {
        if (args.length === 0) throw new Error("Home read the clock");
        super(...(args as ConstructorParameters<typeof Date>));
      }

      static override now(): number {
        throw new Error("Home read the clock");
      }
    }
    vi.stubGlobal("Date", ClockFreeDate);
    try {
      await expect(SokoBotHome(homeProps())).resolves.toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
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
    // The caret goes after the prompt once it is in, so typing extends it.
    expect(focusedAtEnd).toHaveBeenCalledWith("suggestions.catchUp");
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

  it("puts what needs the user above the team's day", async () => {
    await renderHome({ needsYou: <section>needs you</section> });
    const needsYou = screen.getByText("needs you");
    const day = screen.getByRole("heading", { level: 2 });
    expect(
      needsYou.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("lists an important message among the Tasks by time, with who wrote it", async () => {
    await renderHome({
      chats: [
        {
          roomId: "room-1",
          messageId: "msg-9",
          title: "Can you approve the bakery posts?",
          from: "Maya",
          at: new Date("2026-10-24T09:00:00Z"),
        },
      ],
    });
    const links = screen
      .getAllByRole("link")
      .filter((link) => link.closest("section[aria-labelledby]"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/chat/rooms/room-1?message=msg-9",
      "/tasks/task-1",
    ]);
    expect(links[0]?.textContent).toContain(
      "Can you approve the bakery posts?",
    );
    expect(links[0]?.textContent).toContain("Maya");
    expect(links[0]?.textContent).toContain("open");
    // Who wrote it shows on a phone too: no ancestor in the row hides it.
    let node: HTMLElement | null = screen.getByText("Maya");
    while (node && node !== links[0]) {
      expect(node.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      node = node.parentElement;
    }
    expect(screen.queryByText(/quietDay/)).toBeNull();
  });

  it("wraps a chat's message on a phone instead of cutting it beside the time", async () => {
    await renderHome({
      chats: [
        {
          roomId: "room-1",
          messageId: "msg-9",
          title: "What should I set up first?",
          from: "Juno",
          at: new Date("2026-10-24T09:00:00Z"),
        },
      ],
    });
    const title = screen.getByText("What should I set up first?");
    // Two lines on a phone, one with an ellipsis from `sm` up; never a
    // single phone line beside the time, which left it "What sho…".
    expect(title).toHaveClass("line-clamp-2", "sm:line-clamp-1");
    expect(title.className).not.toMatch(/(^|\s)truncate(\s|$)/);
    // On a phone the time rides on the sender's line, under the message.
    const senderLine = screen.getByText("Juno").parentElement;
    expect(senderLine?.querySelector("time")).not.toBeNull();
  });

  it("keeps a chat's time on a phone when a long sender name is cut", async () => {
    const from = "Professor Juniper Montgomery-Okonkwo";
    await renderHome({
      chats: [
        {
          roomId: "room-1",
          messageId: "msg-9",
          title: "Can you help me plan the November newsletter?",
          from,
          at: new Date("2026-10-24T09:00:00Z"),
        },
      ],
    });
    // The name truncates alone; the phone time sits beside it in a slot
    // that never shrinks, so a long name cannot push the time out of view.
    const name = screen.getByText(from);
    expect(name).toHaveClass("min-w-0", "truncate");
    const phoneTime = name.parentElement?.querySelector(".sm\\:hidden");
    expect(phoneTime?.querySelector("time")).not.toBeNull();
    expect(phoneTime).toHaveClass("shrink-0");
    expect(name.contains(phoneTime ?? null)).toBe(false);
    expect(name.parentElement).toHaveClass("flex", "min-w-0");
  });

  it("lists a schedule the bot just got among the Tasks, linked to its row", async () => {
    await renderHome({
      schedules: [
        {
          id: "sched-1",
          name: "Monday invoices",
          createdAt: new Date("2026-10-24T09:00:00Z"),
        },
      ],
    });
    const links = screen
      .getAllByRole("link")
      .filter((link) => link.closest("section[aria-labelledby]"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/personal-assistant?schedule=sched-1",
      "/tasks/task-1",
    ]);
    expect(links[0]?.textContent).toContain('newSchedule:{"name":"Joseph"}');
    expect(links[0]?.textContent).toContain("Monday invoices");
    expect(links[0]?.textContent).toContain("2h");
  });

  it("drops the quiet line once the bot set up a schedule, with no Tasks", async () => {
    await renderHome({
      teamTasks: [],
      schedules: [
        {
          id: "sched-1",
          name: "Monday invoices",
          createdAt: new Date("2026-10-24T09:00:00Z"),
        },
      ],
    });
    expect(screen.queryByText(/quietDay/)).toBeNull();
  });

  it("drops the quiet line once a chat happened, with no Tasks", async () => {
    await renderHome({
      teamTasks: [],
      chats: [
        {
          roomId: "room-1",
          messageId: "msg-9",
          title: "Hi",
          from: "Maya",
          at: new Date("2026-10-24T09:00:00Z"),
        },
      ],
    });
    expect(screen.queryByText(/quietDay/)).toBeNull();
  });

  it("draws a failed Task's icon in its page colour, not white on nothing", async () => {
    await renderHome({
      teamTasks: [
        {
          id: "task-2",
          name: "Feature lab",
          status: "FAILED",
          updatedAt: new Date("2026-10-24T08:00:00Z"),
          who: "CodePat",
        },
      ],
    });
    const icon = screen.getByRole("img", { name: "FAILED" });
    const glyph = icon.querySelector("svg");
    expect(glyph?.getAttribute("class")).toContain("text-semantic-destructive");
    expect(glyph?.getAttribute("class")).not.toContain(
      "text-semantic-destructive-foreground",
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
    ).toBe("/tasks?view=board&scope=workspace#input-required");
    cleanup();
    await renderHome({ summary: { ...summary, awaitingInput: 0 } });
    expect(screen.queryByText(/awaiting/)).toBeNull();
  });

  describe("in an org", () => {
    const summary = {
      since: new Date(),
      completed: 0,
      awaitingInput: 9,
      createdByOtherHumans: 0,
      workedMinutes: 0,
      previous: { completed: 0, createdByOtherHumans: 0, workedMinutes: 0 },
    };

    it("names the team's waiting Tasks and Needs you's requests apart", async () => {
      await renderHome({ summary, inOrganization: true, needsYouCount: 2 });
      expect(
        screen
          .getByRole("link", { name: 'awaitingTeam:{"count":9}' })
          .getAttribute("href"),
      ).toBe("/tasks?view=board&scope=workspace#input-required");
      expect(
        screen
          .getByRole("link", { name: 'needsYou:{"count":2}' })
          .getAttribute("href"),
      ).toBe("#soko-bot-home-needs-you");
      expect(document.getElementById("soko-bot-home-needs-you")).toBeTruthy();
    });

    // Needs you holds Job, grant and access asks and other workspaces' asks,
    // so it can be larger than the workspace's waiting Tasks, even with none.
    it("shows Needs you's requests with no Task waiting in the workspace", async () => {
      await renderHome({
        summary: { ...summary, awaitingInput: 0 },
        inOrganization: true,
        needsYouCount: 3,
      });
      expect(screen.getByRole("link", { name: 'needsYou:{"count":3}' }));
      expect(screen.queryByText(/awaiting/)).toBeNull();
    });

    // A Task waiting in another status (approval, credits) asks nobody in
    // Needs you: the team count stands alone.
    it("shows the team's count alone when nothing is in Needs you", async () => {
      await renderHome({ summary, inOrganization: true, needsYouCount: 0 });
      expect(screen.getByRole("link", { name: 'awaitingTeam:{"count":9}' }));
      expect(screen.queryByText(/needsYou/)).toBeNull();
    });
  });

  it("keeps a personal workspace's own copy and no requests pill", async () => {
    const summary = {
      since: new Date(),
      completed: 0,
      awaitingInput: 2,
      createdByOtherHumans: 0,
      workedMinutes: 0,
      previous: { completed: 0, createdByOtherHumans: 0, workedMinutes: 0 },
    };
    await renderHome({ summary, needsYouCount: 4 });
    expect(screen.getByRole("link", { name: 'awaiting:{"count":2}' }));
    expect(screen.queryByText(/needsYou/)).toBeNull();
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
