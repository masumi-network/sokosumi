import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { NotSetUpLine } from "./not-set-up-line";

const bot = {
  id: "milo",
  name: "Milo",
  avatarImageUrl: null,
  avatarSeed: null,
  status: "IDLE" as const,
  lastActivityAt: null,
};

function member(userId: string, name: string, hasBot: boolean) {
  return {
    userId,
    name,
    image: null,
    role: "member",
    isYou: false,
    bot: hasBot ? bot : null,
  };
}

async function renderLine(
  others: ReturnType<typeof member>[],
  canInvite = false,
) {
  const { container } = render(
    (await NotSetUpLine({ others, canInvite })) ?? <></>,
  );
  return container;
}

describe("NotSetUpLine", () => {
  it("lists only teammates without a bot", async () => {
    await renderLine([
      member("bob", "Bob Keller", true),
      member("zo", "Zara Ortiz", false),
    ]);
    expect(screen.getByText("Zara Ortiz")).toBeInTheDocument();
    expect(screen.queryByText("Bob Keller")).not.toBeInTheDocument();
  });

  it("links owners and admins to the invite links", async () => {
    await renderLine([member("zo", "Zara Ortiz", false)], true);
    expect(screen.getByRole("link", { name: /invitePeople/ })).toHaveAttribute(
      "href",
      "/organization#invite-links",
    );
  });

  it("keeps the invite link from members", async () => {
    await renderLine([member("zo", "Zara Ortiz", false)]);
    expect(
      screen.queryByRole("link", { name: /invitePeople/ }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when everyone has a bot", async () => {
    const container = await renderLine(
      [member("bob", "Bob Keller", true)],
      true,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("asks an organization of one to invite its team, but only an inviter", async () => {
    await renderLine([], true);
    expect(screen.getByText("teamEmpty")).toBeInTheDocument();
    const container = await renderLine([]);
    expect(container).toBeEmptyDOMElement();
  });
});
