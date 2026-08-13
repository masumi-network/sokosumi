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
    avatar: null,
    caption: null,
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
      description: "Hannah digs into sources and briefs.",
    }),
  ];

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
    // 5 coworkers → Elena at exact middle (index 2); nothing dropped.
    expect(optionIds).toEqual(["a", "b", "elena", "c", "d"]);
  });

  it("shows the selected coworker description above Start chat", () => {
    render(
      <LandingCoworkerPicker coworkers={coworkers} initialSelectedId="elena" />,
    );

    expect(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Elena"}',
      }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByTestId("landing-selected-description"),
    ).toHaveTextContent("Elena turns goals into planned work.");
    // Strip chips still show the short caption.
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: 'cta.button:{"name":"Elena"}',
      }),
    ).toBeInTheDocument();
  });

  it("omits the description paragraph when description is empty", () => {
    render(
      <LandingCoworkerPicker
        coworkers={[
          buildCoworker({
            id: "elena",
            name: "Elena",
            slug: "elena",
            caption: "Strategy",
            description: "   ",
          }),
        ]}
        initialSelectedId="elena"
      />,
    );

    expect(
      screen.queryByTestId("landing-selected-description"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Strategy")).toBeInTheDocument();
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
      screen.getByTestId("landing-selected-description"),
    ).toHaveTextContent("Hannah digs into sources and briefs.");
    // Caption remains on the strip chip.
    expect(screen.getByText("Research")).toBeInTheDocument();
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
