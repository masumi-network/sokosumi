import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchDataRoom: vi.fn(),
  fetchDataRoomQuestions: vi.fn(),
  answerDataRoomQuestion: vi.fn(),
  dataRoomRefusal: () => null,
}));
vi.mock("@/lib/utils/data-room.client", () => api);
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { user: { id: "u1" }, session: { activeOrganizationId: null } },
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ relativeTime: () => "now" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The other tabs' panels are not under test; each stands in as its name.
vi.mock("./data-room-activity", () => ({
  rowLabel: (_rows: unknown, path: string) => path,
  DataRoomActivity: () => <p>activity panel</p>,
}));
vi.mock("./data-room-people", () => ({
  DataRoomPeople: () => <p>people panel</p>,
}));
vi.mock("./data-room-colleagues", () => ({ DataRoomColleagues: () => null }));
vi.mock("./data-room-contents", () => ({ DataRoomContents: () => null }));
vi.mock("./data-room-settings", () => ({ DataRoomSettingsPanel: () => null }));
vi.mock("./data-room-company", () => ({ DataRoomCompanyPanel: () => null }));

import { DataRoomClient } from "./data-room-client";

function question(id: string, body: string) {
  return {
    id,
    createdAt: "2026-11-15T10:00:00.000Z",
    path: "Teaser.pdf",
    body,
    answer: null,
    answeredAt: null,
    email: "viewer@example.com",
    name: null,
  };
}

let client: QueryClient;
const onUrlUpdate = vi.fn();

/** The room under one adapter; a new `search` is a same-page link, not a remount. */
function Frame({ search, children }: { search: string; children: ReactNode }) {
  return (
    <NuqsTestingAdapter
      searchParams={search}
      hasMemory
      onUrlUpdate={onUrlUpdate}
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NuqsTestingAdapter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Element.prototype.scrollIntoView = vi.fn();
  api.fetchDataRoom.mockResolvedValue({
    room: {
      id: "room-1",
      folderPath: "Series A",
      title: null,
      storage: "private",
      token: "tok",
      createdByUserId: "u1",
    },
    members: [],
    rows: [],
    colleagues: null,
    canChooseColleagues: false,
  });
  api.fetchDataRoomQuestions.mockResolvedValue([
    question("q1", "First?"),
    question("q2", "Second?"),
  ]);
});

describe("DataRoomClient", () => {
  it("follows a Needs you link into the room already open on another tab", async () => {
    const room = <DataRoomClient roomId="room-1" />;
    const { rerender } = render(<Frame search="?tab=activity">{room}</Frame>);
    expect(await screen.findByText("activity panel")).toBeTruthy();

    // The bell's Answer link changes only the search; the room stays mounted.
    rerender(<Frame search="?tab=questions&question=q2">{room}</Frame>);

    expect(
      (await screen.findByRole("tab", { name: "tabs.questions" })).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    await screen.findByText("Second?");
    const boxes = screen.getAllByRole("textbox", { name: "answerLabel" });
    await vi.waitFor(() => expect(document.activeElement).toBe(boxes[1]));
    expect(api.fetchDataRoom).toHaveBeenCalledTimes(1);
  });

  it("opens the same question again after the reader left its tab", async () => {
    const room = <DataRoomClient roomId="room-1" />;
    const { rerender } = render(
      <Frame search="?tab=questions&question=q1">{room}</Frame>,
    );
    await screen.findByText("First?");

    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "tabs.activity" }));
    expect(await screen.findByText("activity panel")).toBeTruthy();
    expect(onUrlUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ queryString: "?tab=activity" }),
    );

    // The address bar now says what the click wrote; then the bell link again.
    rerender(<Frame search="?tab=activity">{room}</Frame>);
    rerender(<Frame search="?tab=questions&question=q1">{room}</Frame>);

    await screen.findByText("First?");
    const boxes = screen.getAllByRole("textbox", { name: "answerLabel" });
    await vi.waitFor(() => expect(document.activeElement).toBe(boxes[0]));
  });
});
