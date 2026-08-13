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
  return ["landing-selected-description", "landing-start-chat"].filter(
    (id) => screen.queryByTestId(id) !== null,
  );
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
      description: "",
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

  it("orders description then Start chat — no name or role in the detail block", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    expect(blockOrder()).toEqual([
      "landing-selected-description",
      "landing-start-chat",
    ]);
    expect(
      screen.queryByTestId("landing-selected-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-selected-caption"),
    ).not.toBeInTheDocument();

    const description = screen.getByTestId("landing-selected-description");
    const cta = screen.getByTestId("landing-start-chat");

    expect(description.compareDocumentPosition(cta)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps strip name + role and does not repeat them below the strip", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const elenaOption = screen.getByRole("option", {
      name: 'team.select:{"name":"Elena"}',
    });
    expect(elenaOption).toHaveTextContent("Elena");
    expect(elenaOption).toHaveTextContent("Strategy");

    expect(
      screen.queryByTestId("landing-selected-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-selected-caption"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("landing-selected-description"),
    ).toHaveTextContent("Elena turns goals into planned work.");
    expect(
      screen.getByTestId("landing-selected-description"),
    ).not.toHaveTextContent("Strategy");
    expect(screen.getByTestId("landing-start-chat")).toBeInTheDocument();
  });

  it("does not repeat identity when selecting another coworker", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    expect(
      screen.queryByTestId("landing-selected-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-selected-caption"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("landing-selected-description").textContent,
    ).toContain("Hannah digs into sources");
    expect(
      screen.getByTestId("landing-selected-description"),
    ).not.toHaveTextContent("Research");
  });

  it("reserves collapsed description height above Start chat including empty", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const description = screen.getByTestId("landing-selected-description");
    const text = screen.getByTestId("landing-selected-description-text");
    const toggleSlot = screen.getByTestId("landing-description-toggle-slot");

    expect(text.className).toMatch(/line-clamp-3/);
    expect(text.className).toMatch(/min-h-\[3lh\]/);
    expect(toggleSlot.className).toMatch(/min-h-\[1\.25rem\]/);
    expect(
      description.compareDocumentPosition(
        screen.getByTestId("landing-start-chat"),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Deckster"}',
      }),
    );

    // Empty description still mounts the reserved slot (nbsp + min-height).
    expect(
      screen.getByTestId("landing-selected-description"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("landing-selected-description-text").textContent,
    ).toBe("\u00a0");
    expect(
      screen.getByTestId("landing-selected-description-text").className,
    ).toMatch(/min-h-\[3lh\]/);
    expect(
      screen.getByTestId("landing-description-toggle-slot").className,
    ).toMatch(/min-h-\[1\.25rem\]/);
    expect(
      screen.queryByTestId("landing-description-toggle"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-start-chat")).toBeInTheDocument();

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    // Long collapsed copy keeps the same reserve classes above the CTA.
    expect(
      screen.getByTestId("landing-selected-description-text").className,
    ).toMatch(/min-h-\[3lh\]/);
    expect(
      screen.getByTestId("landing-description-toggle"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByTestId("landing-selected-description")
        .compareDocumentPosition(screen.getByTestId("landing-start-chat")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("top-aligns the selected stack with description above Start chat", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const selected = screen.getByTestId("landing-selected-block");
    expect(selected.className).toMatch(/justify-start/);
    expect(selected.className).not.toMatch(/justify-center/);

    const stack = screen.getByTestId("landing-selected-cta-stack");
    expect(stack.className).toMatch(/shrink-0/);
    expect(
      stack.contains(screen.getByTestId("landing-selected-description")),
    ).toBe(true);
    expect(stack.contains(screen.getByTestId("landing-start-chat"))).toBe(true);
    expect(
      screen.queryByTestId("landing-selected-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-selected-caption"),
    ).not.toBeInTheDocument();
  });

  it("keeps description above Start chat across selection", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const cta = screen.getByTestId("landing-start-chat");
    const before = screen
      .getByTestId("landing-selected-description")
      .compareDocumentPosition(cta);

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    expect(
      screen
        .getByTestId("landing-selected-description")
        .compareDocumentPosition(screen.getByTestId("landing-start-chat")),
    ).toBe(before);
    expect(before & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.getByTestId("landing-description-toggle"),
    ).toBeInTheDocument();
  });

  it("clamps long description behind a more/less control above Start chat", async () => {
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
    expect(
      screen.getByTestId("landing-selected-description-text").className,
    ).toMatch(/min-h-\[3lh\]/);

    await user.click(toggle);
    expect(toggle).toHaveTextContent("team.showLess");
    expect(
      screen.getByTestId("landing-selected-description").textContent,
    ).toContain(long.trim());
    // Expanded copy drops the collapsed reserve so More can grow downward.
    expect(
      screen.getByTestId("landing-selected-description-text").className,
    ).not.toMatch(/min-h-\[3lh\]/);

    await user.click(toggle);
    expect(toggle).toHaveTextContent("team.showMore");
    expect(
      screen.getByTestId("landing-selected-description-text").className,
    ).toMatch(/min-h-\[3lh\]/);
  });

  it("still mounts the description slot when description is empty", () => {
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
      "landing-selected-description",
      "landing-start-chat",
    ]);
    expect(
      screen.getByTestId("landing-selected-description-text").textContent,
    ).toBe("\u00a0");
  });

  it("updates description and Start chat when a strip face is tapped", async () => {
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
