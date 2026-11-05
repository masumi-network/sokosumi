import type { Member } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParticipantCheckboxes } from "./participant-checkboxes";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function member(id: string, name: string): Member {
  return {
    id: `member-${id}`,
    organizationId: "org-1",
    role: "member",
    seatAssignedAt: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    lastSeenAt: null,
    user: {
      id,
      name,
      email: `${id}@example.com`,
      image: null,
    },
  };
}

function checkboxFor(name: string) {
  const label = screen.getByText(name).closest("label");
  expect(label).toBeTruthy();
  return within(label as HTMLElement).getByRole("checkbox");
}

describe("ParticipantCheckboxes Soko Bots", () => {
  function renderWithBot(avatarStyleId: string) {
    render(
      <ParticipantCheckboxes
        members={[]}
        coworkers={[]}
        sokoBots={[
          {
            id: "bot-1",
            name: "Jarvis",
            image: "https://blob/idle.png",
            avatarSeed: null,
            avatarStyleId,
          },
        ]}
        memberIds={[]}
        coworkerIds={[]}
        sokoBotIds={[]}
        onMemberIdsChange={vi.fn()}
        onCoworkerIdsChange={vi.fn()}
        onSokoBotIdsChange={vi.fn()}
        membersLoadFailed={false}
      />,
    );
    return document.querySelector('img[src="https://blob/idle.png"]');
  }

  it("crops a crafted avatar to the bot's face", () => {
    expect(renderWithBot("crafted-desk")?.className).toContain("size-[240%]");
  });

  it("leaves a mascot uncropped", () => {
    expect(renderWithBot("mascot")?.className ?? "").not.toContain(
      "size-[240%]",
    );
  });
});

describe("ParticipantCheckboxes locked self", () => {
  it("keeps the locked member checked and ignores uncheck", async () => {
    const user = userEvent.setup();
    const onMemberIdsChange = vi.fn();

    render(
      <ParticipantCheckboxes
        members={[member("user-self", "Ada"), member("user-2", "Francis")]}
        coworkers={[]}
        memberIds={["user-self"]}
        coworkerIds={[]}
        onMemberIdsChange={onMemberIdsChange}
        onCoworkerIdsChange={vi.fn()}
        membersLoadFailed={false}
        lockedUserId="user-self"
      />,
    );

    const self = checkboxFor("Ada");
    const other = checkboxFor("Francis");

    expect(self).toBeChecked();
    expect(self).toBeDisabled();
    expect(self).toHaveAccessibleDescription("Dialog.cannotRemoveSelf");
    expect(other).not.toBeChecked();
    expect(other).not.toBeDisabled();

    await user.click(self);
    expect(onMemberIdsChange).not.toHaveBeenCalled();

    await user.click(other);
    expect(onMemberIdsChange).toHaveBeenCalledWith(["user-self", "user-2"]);
  });

  it("counts a locked member as selected even if memberIds omitted them", () => {
    render(
      <ParticipantCheckboxes
        members={[member("user-self", "Ada")]}
        coworkers={[]}
        memberIds={[]}
        coworkerIds={[]}
        onMemberIdsChange={vi.fn()}
        onCoworkerIdsChange={vi.fn()}
        membersLoadFailed={false}
        lockedUserId="user-self"
      />,
    );

    expect(screen.getByText("Dialog.selectedParticipants")).toBeTruthy();
    expect(checkboxFor("Ada")).toBeChecked();
  });
});
