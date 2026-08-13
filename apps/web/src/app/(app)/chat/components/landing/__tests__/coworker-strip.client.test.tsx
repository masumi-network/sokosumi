import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StripCoworker } from "../coworker-strip.client";

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

import { CoworkerStrip } from "../coworker-strip.client";

function buildStripCoworker(
  overrides: Partial<StripCoworker> & Pick<StripCoworker, "id" | "name">,
): StripCoworker {
  return {
    imageUrl: null,
    title: null,
    ...overrides,
  };
}

describe("CoworkerStrip", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows every coworker name and specialty in the DOM", () => {
    const coworkers = [
      buildStripCoworker({
        id: "elena",
        name: "Elena",
        title: "Project Manager",
      }),
      buildStripCoworker({
        id: "hannah",
        name: "Hannah",
        title: "Research",
      }),
      buildStripCoworker({
        id: "alex",
        name: "Alex",
        title: "Data",
      }),
    ];

    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={coworkers}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    for (const name of ["Elena", "Hannah", "Alex"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const title of ["Project Manager", "Research", "Data"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("uses a horizontally scrollable overflow container", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "hannah", name: "Hannah", title: "Ops" }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(scroll.className).toMatch(/overflow-x-auto/);
  });

  it("keeps a data hook for the centered coworker", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "a", name: "A" }),
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "b", name: "B" }),
        ]}
        onSelect={vi.fn()}
        selectedId="elena"
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(scroll.querySelector('[data-coworker-id="elena"]')).toBeTruthy();
  });

  it("selects a coworker on tap without opening a room", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "hannah", name: "Hannah", title: "Ops" }),
        ]}
        onSelect={onSelect}
        selectedId="elena"
      />,
    );

    await user.click(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("hannah");
  });

  it("marks the selected coworker as aria-selected", () => {
    render(
      <CoworkerStrip
        centerOnId="elena"
        coworkers={[
          buildStripCoworker({ id: "elena", name: "Elena" }),
          buildStripCoworker({ id: "hannah", name: "Hannah" }),
        ]}
        onSelect={vi.fn()}
        selectedId="hannah"
      />,
    );

    expect(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Hannah"}',
      }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("option", {
        name: 'team.select:{"name":"Elena"}',
      }),
    ).toHaveAttribute("aria-selected", "false");
  });
});
