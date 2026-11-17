import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskMetadataParticipantsRow } from "./task-metadata-participants-row";

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: () => <div data-testid="assistant-orb" />,
}));

const labels = {
  participants: "Participants",
  noParticipants: "No participants",
  followsWithSokoBot: "follows with Soko Bot",
};

function participant(id: string, name: string, followsWithSokoBot = false) {
  return {
    user: { id, name, image: null },
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
    subscribedAt: followsWithSokoBot ? new Date() : null,
    followsWithSokoBot,
  };
}

describe("TaskMetadataParticipantsRow", () => {
  it("names who follows with their Soko Bot", () => {
    render(
      <TaskMetadataParticipantsRow
        participants={[
          participant("u1", "Ada", true),
          participant("u2", "Bea"),
        ]}
        labels={labels}
      />,
    );
    expect(screen.getByRole("group")).toHaveAccessibleName(
      "Participants: Ada (follows with Soko Bot), Bea",
    );
    expect(screen.getByTestId("task-participant-bot-mark-u1")).toBeVisible();
    expect(screen.queryByTestId("task-participant-bot-mark-u2")).toBeNull();
  });

  it("says so for a Task without participants, as the other properties do", () => {
    render(<TaskMetadataParticipantsRow participants={[]} labels={labels} />);
    expect(screen.getByRole("group")).toHaveAccessibleName(
      "Participants: No participants",
    );
  });
});
