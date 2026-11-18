import type { TaskFollower } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskMetadataFollowersRow } from "./task-metadata-followers-row";

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: () => <div data-testid="orb" />,
  AssistantOrb: () => <div data-testid="orb" />,
}));

const labels = {
  followedBy: "Followed by",
  followerBot: (name: string) => `${name}'s Soko Bot`,
};

function follower(id: string, imageUrl: string): TaskFollower {
  return {
    user: { id, name: id, image: null },
    followedAt: new Date("2026-01-02T00:00:00.000Z"),
    sokoBot: {
      id: `bot-${id}`,
      avatarSeed: null,
      avatarImageUrl: imageUrl,
      avatarCode: null,
    },
  };
}

describe("TaskMetadataFollowersRow", () => {
  it("shows other people's Soko Bots, and not the viewer's own", () => {
    const { container } = render(
      <TaskMetadataFollowersRow
        followers={[
          follower("viewer", "/mine.png"),
          follower("Ada", "/ada.png"),
        ]}
        viewerId="viewer"
        labels={labels}
      />,
    );
    expect(screen.getByRole("group")).toHaveAccessibleName(
      "Followed by: Ada's Soko Bot",
    );
    expect(container.querySelector('img[src="/ada.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/mine.png"]')).toBeNull();
  });

  it("shows nothing when only the viewer follows", () => {
    const { container } = render(
      <TaskMetadataFollowersRow
        followers={[follower("viewer", "/mine.png")]}
        viewerId="viewer"
        labels={labels}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
