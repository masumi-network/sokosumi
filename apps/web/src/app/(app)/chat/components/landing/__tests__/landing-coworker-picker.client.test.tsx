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
    }),
    buildCoworker({
      id: "hannah",
      name: "Hannah",
      slug: "hannah",
      caption: "Research",
    }),
  ];

  it("defaults selection to the initial coworker and binds Start chat to them", () => {
    render(
      <LandingCoworkerPicker
        coworkers={coworkers}
        elenaRole="Project Manager - you can give her any task"
        initialSelectedId="elena"
      />,
    );

    expect(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Elena"}',
      }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Project Manager - you can give her any task"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: 'cta.button:{"name":"Elena"}',
      }),
    ).toBeInTheDocument();
  });

  it("updates featured copy and Start chat target when a strip face is tapped", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker
        coworkers={coworkers}
        elenaRole="Project Manager - you can give her any task"
        initialSelectedId="elena"
      />,
    );

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    expect(openCoworkerRoom).not.toHaveBeenCalled();
    expect(screen.getAllByText("Research").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("button", {
        name: 'cta.button:{"name":"Hannah"}',
      }),
    ).toBeInTheDocument();
  });

  it("opens a DM only from Start chat after selection", async () => {
    const user = userEvent.setup();

    render(
      <LandingCoworkerPicker
        coworkers={coworkers}
        elenaRole="Project Manager - you can give her any task"
        initialSelectedId="elena"
      />,
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
