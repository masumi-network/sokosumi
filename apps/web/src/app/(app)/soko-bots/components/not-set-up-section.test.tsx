import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { NotSetUpSection } from "./not-set-up-section";

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

async function renderSection(
  others: ReturnType<typeof member>[],
  canInvite = false,
) {
  const { container } = render(
    (await NotSetUpSection({ others, canInvite })) ?? <></>,
  );
  return container;
}

describe("NotSetUpSection", () => {
  it("lists only teammates without a bot", async () => {
    await renderSection([
      member("bob", "Bob Keller", true),
      member("zo", "Zara Ortiz", false),
    ]);
    expect(screen.getByText("Zara Ortiz")).toBeInTheDocument();
    expect(screen.queryByText("Bob Keller")).not.toBeInTheDocument();
  });

  it("links owners and admins to the invite links", async () => {
    await renderSection([member("zo", "Zara Ortiz", false)], true);
    expect(screen.getByRole("link", { name: /invitePeople/ })).toHaveAttribute(
      "href",
      "/organization#invite-links",
    );
  });

  it("keeps the invite link from members", async () => {
    await renderSection([member("zo", "Zara Ortiz", false)]);
    expect(
      screen.queryByRole("link", { name: /invitePeople/ }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when everyone has a bot", async () => {
    const container = await renderSection([member("bob", "Bob Keller", true)]);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks an organization of one to invite its team", async () => {
    await renderSection([], true);
    expect(screen.getByText("teamEmpty")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /invitePeople/ }),
    ).toBeInTheDocument();
  });
});
