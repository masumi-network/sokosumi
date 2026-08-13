import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("../use-open-coworker-room", () => ({
  useOpenCoworkerRoom: () => ({
    isPending: false,
    openCoworkerRoom: vi.fn(),
    openingId: null,
  }),
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
    const featured = buildStripCoworker({
      id: "elena",
      name: "Elena",
      title: "Project Manager",
    });
    const others = [
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

    render(<CoworkerStrip featured={featured} others={others} />);

    for (const name of ["Elena", "Hannah", "Alex"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const title of ["Project Manager", "Research", "Data"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("uses a horizontally scrollable overflow container", () => {
    const featured = buildStripCoworker({ id: "elena", name: "Elena" });

    render(
      <CoworkerStrip
        featured={featured}
        others={[
          buildStripCoworker({ id: "hannah", name: "Hannah", title: "Ops" }),
        ]}
      />,
    );

    const scroll = screen.getByTestId("coworker-strip-scroll");
    expect(scroll.className).toMatch(/overflow-x-auto/);
  });
});
