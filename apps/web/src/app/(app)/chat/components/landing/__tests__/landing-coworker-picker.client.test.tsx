import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";

const openCoworkerRoom = vi.fn();

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("../use-open-coworker-room", () => ({
  useOpenCoworkerRoom: () => ({
    isPending: false,
    openCoworkerRoom,
    openingId: null,
  }),
}));

import { LandingCoworkerPicker } from "../landing-coworker-picker.client";

function buildCoworker(overrides: Partial<Coworker> & { id: string }) {
  return {
    avatar: undefined,
    caption: undefined,
    description: "",
    name: overrides.id,
    slug: overrides.id,
    useCase: "",
    ...overrides,
  } as Coworker;
}

function blockOrder(): string[] {
  return [
    "landing-selected-name",
    "landing-selected-caption",
    "landing-start-chat",
    "landing-selected-description",
  ].filter((id) => {
    const node = screen.queryByTestId(id);
    if (!node) {
      return false;
    }
    // Caption slot is always mounted; treat empty nbsp as "present".
    return true;
  });
}

describe("LandingCoworkerPicker", () => {
  afterEach(() => {
    cleanup();
    openCoworkerRoom.mockClear();
  });

  const coworkers = [
    buildCoworker({
      id: "elena",
      name: "Elena",
      slug: "elena",
      caption: "Strategy",
      description: "Elena turns goals into planned work.",
    }),
    buildCoworker({
      id: "hannah",
      name: "Hannah",
      slug: "hannah",
      caption: "Research",
      description: `Hannah digs into sources and briefs. ${"detail ".repeat(40)}`,
    }),
    buildCoworker({
      id: "deckster",
      name: "Deckster",
      slug: "deckster",
      caption: undefined,
      description: "Deckster builds decks.",
    }),
  ];

  it("bounds the picker and featured CTA so the strip cannot widen them", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const picker = screen.getByTestId("landing-coworker-picker");
    expect(picker.className).toMatch(/w-full/);
    expect(picker.className).toMatch(/min-w-0/);
    expect(picker.className).toMatch(/max-w-full/);

    const selected = screen.getByTestId("landing-selected-block");
    expect(selected.className).toMatch(/max-w-xs/);
    expect(selected.className).toMatch(/w-full/);
    expect(selected.className).toMatch(/min-w-0/);

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(scroll.className).toMatch(/min-w-0/);
    expect(scroll.className).toMatch(/overflow-x-auto/);
  });

  it("renders Elena in the middle of the full strip order", () => {
    const catalog = [
      buildCoworker({ id: "a", name: "A", slug: "a" }),
      buildCoworker({ id: "b", name: "B", slug: "b" }),
      buildCoworker({
        id: "elena",
        name: "Elena",
        slug: "elena",
        caption: "Strategy",
      }),
      buildCoworker({ id: "c", name: "C", slug: "c" }),
      buildCoworker({ id: "d", name: "D", slug: "d" }),
    ];

    render(
      <LandingCoworkerPicker coworkers={catalog} initialSelectedId="elena" />,
    );

    const optionIds = screen
      .getAllByRole("option")
      .map((node) => node.getAttribute("data-coworker-id"));
    expect(optionIds).toEqual(["a", "b", "elena", "c", "d"]);
  });

  it("orders name, caption slot, Start chat, then description", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    expect(blockOrder()).toEqual([
      "landing-selected-name",
      "landing-selected-caption",
      "landing-start-chat",
      "landing-selected-description",
    ]);

    const name = screen.getByTestId("landing-selected-name");
    const caption = screen.getByTestId("landing-selected-caption");
    const cta = screen.getByTestId("landing-start-chat");
    const description = screen.getByTestId("landing-selected-description");

    expect(name.compareDocumentPosition(caption)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(caption.compareDocumentPosition(cta)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(cta.compareDocumentPosition(description)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps a reserved caption slot so omitting caption cannot remove CTA spacing", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const caption = screen.getByTestId("landing-selected-caption");
    expect(caption.className).toMatch(/min-h-/);
    expect(caption).toHaveTextContent("Strategy");

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Deckster"}',
      }),
    );

    // Slot stays mounted with reserved height; empty caption is nbsp only.
    expect(screen.getByTestId("landing-selected-caption").className).toMatch(
      /min-h-/,
    );
    expect(screen.getByTestId("landing-start-chat")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("landing-selected-caption")
        .compareDocumentPosition(screen.getByTestId("landing-start-chat")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps Start chat above description so long copy cannot shift the CTA", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const cta = screen.getByTestId("landing-start-chat");
    const before = cta.compareDocumentPosition(
      screen.getByTestId("landing-selected-description"),
    );

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    const description = screen.getByTestId("landing-selected-description");
    expect(cta.compareDocumentPosition(description)).toBe(before);
    expect(before & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.getByTestId("landing-description-toggle"),
    ).toBeInTheDocument();
  });

  it("clamps long description behind a more/less control", async () => {
    const user = userEvent.setup();
    const long =
      "Hannah researches deeply across many sources and produces concise briefs for the team. ".repeat(
        4,
      );

    render(
      <LandingCoworkerPicker
        coworkers={[
          buildCoworker({
            id: "hannah",
            name: "Hannah",
            slug: "hannah",
            caption: "Research",
            description: long,
          }),
        ]}
        initialSelectedId="hannah"
      />,
    );

    const toggle = screen.getByTestId("landing-description-toggle");
    expect(toggle).toHaveTextContent("team.showMore");
    const collapsed = screen.getByTestId(
      "landing-selected-description",
    ).textContent;
    expect(collapsed?.includes("…")).toBe(true);

    await user.click(toggle);
    expect(toggle).toHaveTextContent("team.showLess");
    expect(
      screen.getByTestId("landing-selected-description").textContent,
    ).toContain(long.trim());
  });

  it("omits the description block when description is empty", () => {
    render(
      <LandingCoworkerPicker
        coworkers={[
          buildCoworker({
            id: "elena",
            name: "Elena",
            slug: "elena",
            caption: "Strategy",
            description: "",
          }),
        ]}
        initialSelectedId="elena"
      />,
    );

    expect(blockOrder()).toEqual([
      "landing-selected-name",
      "landing-selected-caption",
      "landing-start-chat",
    ]);
    expect(
      screen.queryByTestId("landing-selected-description"),
    ).not.toBeInTheDocument();
  });

  it("updates caption, description, and Start chat when a strip face is tapped", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    expect(openCoworkerRoom).not.toHaveBeenCalled();
    expect(screen.getByTestId("landing-selected-caption")).toHaveTextContent(
      "Research",
    );
    expect(
      screen.getByTestId("landing-selected-description").textContent,
    ).toContain("Hannah digs into sources");
    expect(
      screen.getByRole("button", {
        name: 'cta.button:{"name":"Hannah"}',
      }),
    ).toBeInTheDocument();
  });

  it("opens a DM only from Start chat after selection", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );
    expect(openCoworkerRoom).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: 'cta.button:{"name":"Hannah"}',
      }),
    );

    expect(openCoworkerRoom).toHaveBeenCalledTimes(1);
    expect(openCoworkerRoom).toHaveBeenCalledWith("hannah");
  });
});
