import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    // Selected copy/CTA stay inset; strip itself must not inherit this pad.
    expect(selected.className).toMatch(/px-4/);

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(scroll.className).toMatch(/min-w-0/);
    expect(scroll.className).toMatch(/overflow-x-auto/);
  });

  it("keeps the coworker strip full-bleed (no page px / max-w inset on the track)", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const strip = screen.getByTestId("landing-coworker-strip");
    expect(strip.className).toMatch(/w-full/);
    expect(strip.className).toMatch(/min-w-0/);
    expect(strip.className).toMatch(/max-w-full/);
    expect(strip.className).not.toMatch(/px-\d/);
    expect(strip.className).not.toMatch(/max-w-xs/);

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(strip.contains(scroll)).toBe(true);
    expect(scroll.className).toMatch(/w-full/);
    expect(scroll.className).toMatch(/overflow-x-auto/);

    // Selected block is a sibling, not a padded ancestor of the strip.
    const selected = screen.getByTestId("landing-selected-block");
    expect(strip.contains(selected)).toBe(false);
    expect(selected.contains(strip)).toBe(false);
  });

  it("renders the featured coworker in the middle of a popularity-ordered strip", () => {
    const catalog = [
      buildCoworker({ id: "a", name: "A", slug: "a", priority: 4 }),
      buildCoworker({ id: "b", name: "B", slug: "b", priority: 3 }),
      buildCoworker({
        id: "elena",
        name: "Elena",
        slug: "elena",
        caption: "Strategy",
        priority: 10,
      }),
      buildCoworker({ id: "c", name: "C", slug: "c", priority: 2 }),
      buildCoworker({ id: "d", name: "D", slug: "d", priority: 1 }),
    ];

    render(
      <LandingCoworkerPicker coworkers={catalog} initialSelectedId="elena" />,
    );

    const optionIds = screen
      .getAllByRole("option")
      .map((node) => node.getAttribute("data-coworker-id"));
    expect(optionIds).toEqual(["a", "b", "elena", "c", "d"]);
  });

  it("renders Start chat only in the detail block — no description or identity", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    expect(screen.getByTestId("landing-start-chat")).toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-selected-description"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-selected-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("landing-selected-caption"),
    ).not.toBeInTheDocument();
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
    expect(screen.getByTestId("landing-start-chat")).toBeInTheDocument();
  });

  it("top-aligns the selected stack with Start chat only", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const selected = screen.getByTestId("landing-selected-block");
    expect(selected.className).toMatch(/justify-start/);
    expect(selected.className).not.toMatch(/justify-center/);

    const stack = screen.getByTestId("landing-selected-cta-stack");
    expect(stack.className).toMatch(/shrink-0/);
    expect(stack.contains(screen.getByTestId("landing-start-chat"))).toBe(true);
    expect(
      screen.queryByTestId("landing-selected-description"),
    ).not.toBeInTheDocument();
  });

  it("updates Start chat when a strip face is tapped", async () => {
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
      screen.getByRole("button", {
        name: 'cta.button:{"name":"Hannah"}',
      }),
    ).toBeInTheDocument();
  });

  it("updates Start chat when scroll centers another coworker", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();

    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    scroll.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 300,
        top: 0,
        height: 80,
        right: 300,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    function place(id: string, left: number, width: number): void {
      const node = scroll.querySelector(
        `[data-coworker-id="${id}"]`,
      ) as HTMLElement;
      node.getBoundingClientRect = () =>
        ({
          left,
          width,
          top: 0,
          height: 80,
          right: left + width,
          bottom: 80,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    // Strip order is [hannah, elena, deckster] with Elena featured.
    place("hannah", 110, 80);
    place("elena", 260, 80);
    place("deckster", 410, 80);

    fireEvent.scroll(scroll);

    expect(openCoworkerRoom).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: 'cta.button:{"name":"Hannah"}',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    ).toHaveAttribute("aria-selected", "true");
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
