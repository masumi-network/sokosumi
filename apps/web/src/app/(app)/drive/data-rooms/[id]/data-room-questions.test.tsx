import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchDataRoomQuestions: vi.fn(),
  answerDataRoomQuestion: vi.fn(),
  dataRoomRefusal: () => null,
}));
vi.mock("@/lib/utils/data-room.client", () => api);
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ relativeTime: () => "now" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY } from "@/queries/needs-you-data-room-questions";
import { DataRoomQuestions } from "./data-room-questions";

function question(id: string, body: string) {
  return {
    id,
    createdAt: "2026-11-15T10:00:00.000Z",
    path: "Teaser.pdf",
    body,
    answer: null,
    answeredAt: null,
    sharedAt: null as string | null,
    email: "viewer@example.com",
    name: null,
  };
}

let client: QueryClient;

function renderQuestions(focusQuestionId?: string) {
  return render(
    <QueryClientProvider client={client}>
      <DataRoomQuestions
        store={{ scope: "me" }}
        roomId="room-1"
        rows={[]}
        focusQuestionId={focusQuestionId}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  });
  Element.prototype.scrollIntoView = vi.fn();
  api.fetchDataRoomQuestions.mockResolvedValue([
    question("q1", "First?"),
    question("q2", "Second?"),
  ]);
});

describe("DataRoomQuestions", () => {
  it("opens with the question Needs you linked to ready to answer", async () => {
    renderQuestions("q2");

    await screen.findByText("Second?");
    const boxes = screen.getAllByRole("textbox", { name: "answerLabel" });
    await vi.waitFor(() => expect(document.activeElement).toBe(boxes[1]));
  });

  it("takes an answered question off Needs you", async () => {
    api.answerDataRoomQuestion.mockResolvedValue(undefined);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderQuestions();

    await screen.findByText("First?");
    const user = userEvent.setup();
    await user.type(
      screen.getAllByRole("textbox", { name: "answerLabel" })[0]!,
      "Net.",
    );
    await user.click(screen.getAllByRole("button", { name: "answer" })[0]!);

    expect(api.answerDataRoomQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: "q1", answer: "Net." }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: NEEDS_YOU_DATA_ROOM_QUESTIONS_QUERY_KEY,
    });
  });

  it("shares an answer with everyone in the room when the owner ticks it", async () => {
    api.answerDataRoomQuestion.mockResolvedValue(undefined);
    renderQuestions();

    await screen.findByText("First?");
    const user = userEvent.setup();
    await user.type(
      screen.getAllByRole("textbox", { name: "answerLabel" })[0]!,
      "Churn is 2% a month.",
    );
    await user.click(
      screen.getAllByRole("checkbox", { name: "shareLabel" })[0]!,
    );
    await user.click(screen.getAllByRole("button", { name: "answer" })[0]!);

    expect(api.answerDataRoomQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: "q1", shared: true }),
    );
  });

  it("takes a shared answer back to the asker alone", async () => {
    api.answerDataRoomQuestion.mockResolvedValue(undefined);
    api.fetchDataRoomQuestions.mockResolvedValue([
      {
        ...question("q1", "First?"),
        answer: "Net.",
        answeredAt: "2026-11-15T11:00:00.000Z",
        sharedAt: "2026-11-15T11:00:00.000Z",
      },
    ]);
    renderQuestions();

    const box = await screen.findByRole("checkbox", { name: "shareLabel" });
    expect(box).toBeChecked();
    const user = userEvent.setup();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "updateAnswer" }));

    expect(api.answerDataRoomQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: "q1", shared: false }),
    );
  });
});
