import type { WaitingDataRoomQuestions } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function renderRows() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationDataRoomQuestions />
    </QueryClientProvider>,
  );
}

const waiting: WaitingDataRoomQuestions = {
  count: 2,
  questions: [
    {
      id: "q1",
      createdAt: "2026-11-15T10:00:00.000Z",
      path: "Finance/Model.xlsx",
      body: "Is the 2027 revenue gross or net?",
      answer: null,
      answeredAt: null,
      email: "viewer@example.com",
      name: null,
      roomId: "room-1",
      roomName: "Series A",
    },
  ],
};

beforeEach(() => {
  fetchWaiting.mockReset();
});

describe("NotificationDataRoomQuestions", () => {
  it("reads the active organization's rooms", async () => {
    fetchWaiting.mockResolvedValue({ count: 0, questions: [] });
    renderRows();

    await vi.waitFor(() =>
      expect(fetchWaiting).toHaveBeenCalledWith({
        scope: "org",
        organizationId: "org_1",
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
    fetchWaiting.mockResolvedValue({ count: 0, questions: [] });
    const { container } = renderRows();

    await vi.waitFor(() => expect(fetchWaiting).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
