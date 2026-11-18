import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskMetadataParticipantsRow } from "./task-metadata-participants-row";

const labels = {
  participants: "Participants",
  noParticipants: "No participants",
};

describe("TaskMetadataParticipantsRow", () => {
  it("names the participants", () => {
    render(
      <TaskMetadataParticipantsRow
        participants={["Ada", "Bea"].map((name) => ({
          user: { id: name, name, image: null },
          addedAt: new Date("2026-01-01T00:00:00.000Z"),
        }))}
        labels={labels}
      />,
    );
    expect(screen.getByRole("group")).toHaveAccessibleName(
      "Participants: Ada, Bea",
    );
  });

  it("says so for a Task without participants, as the other properties do", () => {
    render(<TaskMetadataParticipantsRow participants={[]} labels={labels} />);
    expect(screen.getByRole("group")).toHaveAccessibleName(
      "Participants: No participants",
    );
  });
});
