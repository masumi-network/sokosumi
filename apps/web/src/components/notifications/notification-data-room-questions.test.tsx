import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchablePageContent } from "@/components/searchable-page-content";
import { dataRoomQuestionHref } from "@/queries/needs-you-data-room-questions";

const fetchWaiting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/data-room.client", () => ({
  fetchWaitingDataRoomQuestions: fetchWaiting,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "u1" },
      session: { activeOrganizationId: "org_1" },
    },
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/utils/notification-time", () => ({
  useNotificationTimeFormatter: () => () => "now",
}));

import { NotificationDataRoomQuestions } from "./notification-data-room-questions";

function renderRows(search = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {search ? (
        <SearchablePageContent>
          <NotificationDataRoomQuestions />
        </SearchablePageContent>
      ) : (
        <NotificationDataRoomQuestions />
      )}
    </QueryClientProvider>,
  );
}

function question(id: string, body: string, roomName = "Series A") {
  return {
    id,
    createdAt: "2026-11-15T10:00:00.000Z",
    path: "Finance/Model.xlsx",
    body,
    answer: null,
    answeredAt: null,
    email: "viewer@example.com",
    name: null,
    roomId: "room-1",
    roomName,
  };
}

const waiting = {
  total: 2,
  nextCursor: null,
  questions: [question("q1", "Is the 2027 revenue gross or net?")],
};

beforeEach(() => {
  fetchWaiting.mockReset();
});

describe("NotificationDataRoomQuestions", () => {
  it("searches older questions by body or room without an extra click", async () => {
    fetchWaiting.mockImplementation(async ({ cursor }) =>
      cursor
        ? {
            total: 3,
            nextCursor: null,
            questions: [question("later", "Launch plans?")],
          }
        : {
            total: 3,
            nextCursor: "old",
            questions: [
              question("room", "Forecast?", "Launch"),
              question("other", "Shipment?"),
            ],
          },
    );
    renderRows(true);
    await screen.findByText("Shipment?");
    await userEvent.type(screen.getByRole("searchbox"), "launch");
    expect(await screen.findByText("Launch plans?")).toBeVisible();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual([
      dataRoomQuestionHref({ id: "later", roomId: "room-1" }),
      dataRoomQuestionHref({ id: "room", roomId: "room-1" }),
    ]);
  });

  it("reads the active organization's rooms", async () => {
    fetchWaiting.mockResolvedValue({
      total: 0,
      nextCursor: null,
      questions: [],
    });
    renderRows();

    await vi.waitFor(() =>
      expect(fetchWaiting).toHaveBeenCalledWith({
        store: { scope: "org", organizationId: "org_1" },
        cursor: undefined,
        limit: 20,
      }),
    );
  });

  it("links each question to its room, opened on that question", async () => {
    fetchWaiting.mockResolvedValue(waiting);
    renderRows();

    const link = await screen.findByRole("link", {
      name: /Is the 2027 revenue gross or net\?/,
    });
    expect(link.getAttribute("href")).toBe(
      "/drive/data-rooms/room-1?tab=questions&question=q1",
    );
    // The total, not just the rows listed, and who asked about which document.
    expect(screen.getByRole("heading").textContent).toBe('heading {"count":2}');
    expect(link.textContent).toContain(
      'byline {"who":"viewer@example.com","document":"Model.xlsx","room":"Series A"}',
    );
  });

  it("says nothing when every question has an answer", async () => {
    fetchWaiting.mockResolvedValue({
      total: 0,
      nextCursor: null,
      questions: [],
    });
    const { container } = renderRows();

    await vi.waitFor(() => expect(fetchWaiting).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("reaches questions past the first page without answering any", async () => {
    const newest = Array.from({ length: 20 }, (_, index) =>
      question(`n${index}`, `Newer ${index}?`),
    );
    fetchWaiting.mockImplementation(async ({ cursor }: { cursor?: string }) =>
      cursor
        ? {
            total: 21,
            nextCursor: null,
            questions: [question("old", "Oldest one?", "Sale")],
          }
        : { total: 21, nextCursor: "n19", questions: newest },
    );
    renderRows();

    await screen.findByText("Newer 0?");
    expect(screen.getByRole("heading").textContent).toBe(
      'heading {"count":21}',
    );
    expect(screen.queryByText("Oldest one?")).toBeNull();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "showOlder" }));

    const oldest = await screen.findByRole("link", { name: /Oldest one\?/ });
    expect(oldest.getAttribute("href")).toBe(
      "/drive/data-rooms/room-1?tab=questions&question=old",
    );
    expect(fetchWaiting).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "n19" }),
    );
    expect(screen.queryByRole("button", { name: "showOlder" })).toBeNull();
  });
});
