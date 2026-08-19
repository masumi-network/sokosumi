import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import en from "../../../../../messages/en.json";

import { AUTH_MARQUEE_LOGOS } from "../auth-customer-logos";

const asideCopy = en.Auth.Aside;

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: keyof typeof asideCopy) => asideCopy[key],
}));

vi.mock("next/image", () => ({
  default: function MockImage({ alt, src }: { alt: string; src: string }) {
    return <img alt={alt} src={src} />;
  },
}));

const publicRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../public",
);

describe("auth aside", () => {
  it("ships every customer logo file", () => {
    expect(AUTH_MARQUEE_LOGOS.length).toBeGreaterThan(0);
    for (const logo of AUTH_MARQUEE_LOGOS) {
      expect(existsSync(join(publicRoot, logo.src.replace(/^\//, "")))).toBe(
        true,
      );
      expect(logo.width).toBeGreaterThan(0);
      expect(logo.height).toBeGreaterThan(0);
    }
    expect(
      existsSync(join(publicRoot, "images/auth/florian-haller.webp")),
    ).toBe(true);
    expect(
      readFileSync(join(publicRoot, "images/logos/customers/bsh.svg"), "utf8"),
    ).not.toMatch(/<text\b/);
  });

  it("renders the headline, proof, logos, and Haller quote", async () => {
    const { default: AuthAside } = await import("../auth-aside");
    render(await AuthAside());

    expect(
      screen.getByRole("heading", {
        name: `${asideCopy.titleLine1} ${asideCopy.titleLine2}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(asideCopy.bullet1, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(asideCopy.bullet2, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(asideCopy.bullet3, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(asideCopy.logosLabel)).toBeInTheDocument();
    expect(screen.getByAltText("Deutsche Telekom")).toBeInTheDocument();
    expect(screen.getByAltText("Samsung")).toBeInTheDocument();
    expect(screen.getAllByAltText("Serviceplan Group").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(asideCopy.quoteAuthor)).toBeInTheDocument();
    expect(
      screen
        .getByTestId("auth-aside")
        .querySelector('img[src="/images/auth/florian-haller.webp"]'),
    ).toHaveAttribute("alt", "");
    expect(screen.getByText(asideCopy.quoteRole)).toBeInTheDocument();
    expect(screen.getByText(asideCopy.quote)).toBeInTheDocument();
  });

  it("renders equal marquee tracks with one accessible copy", async () => {
    const { default: AuthAside } = await import("../auth-aside");
    render(await AuthAside());

    const region = screen.getByRole("region", {
      name: asideCopy.logosLabel,
    });
    expect(region).not.toHaveAttribute("tabindex");
    expect(
      screen.getByRole("button", { name: asideCopy.pauseLogos }),
    ).toBeInTheDocument();

    const tracks = region.querySelectorAll("ul");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.children).toHaveLength(AUTH_MARQUEE_LOGOS.length);
    expect(tracks[1]?.children).toHaveLength(AUTH_MARQUEE_LOGOS.length);
    expect(tracks[1]).toHaveAttribute("aria-hidden", "true");
    const primaryTrack = tracks[0];
    if (!primaryTrack) {
      throw new Error("Primary marquee track is missing");
    }
    expect(within(primaryTrack).getAllByRole("img")).toHaveLength(
      AUTH_MARQUEE_LOGOS.length,
    );
    expect(tracks[1]?.querySelectorAll('img[alt=""]').length).toBe(
      AUTH_MARQUEE_LOGOS.length,
    );

    const marquee = tracks[0]?.parentElement;
    expect(marquee).toHaveClass("animate-auth-logo-marquee");
    expect(marquee).toHaveClass("group-hover:[animation-play-state:paused]");
    expect(marquee).toHaveClass(
      "group-focus-within:[animation-play-state:paused]",
    );
    expect(tracks[0]).toHaveClass("motion-reduce:flex-wrap");

    const globals = readFileSync(join(publicRoot, "../src/app/globals.css"), {
      encoding: "utf8",
    });
    expect(globals).toMatch(
      /@keyframes auth-logo-marquee\s*{[\s\S]*?translate3d\(-50%,\s*0,\s*0\)/,
    );
  });

  it("pins scrims outside the scroll layer", async () => {
    const { default: AuthAside } = await import("../auth-aside");
    render(await AuthAside());

    const root = screen.getByTestId("auth-aside");
    const scroller = screen.getByTestId("auth-aside-scroll");

    expect(root).not.toHaveClass("overflow-y-auto");
    expect(scroller).toHaveClass("overflow-y-auto");
    expect(scroller).toHaveClass("pb-44");
    expect(root.contains(scroller)).toBe(true);
    expect(scroller.querySelector("[class*='bg-gradient']")).toBeNull();
    expect(
      [...root.children].filter((child) => child !== scroller).length,
    ).toBeGreaterThan(0);
  });
});
