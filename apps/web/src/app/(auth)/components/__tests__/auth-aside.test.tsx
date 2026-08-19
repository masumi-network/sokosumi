import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
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
  });

  it("renders the headline, proof, logos, and Haller quote", async () => {
    const { default: AuthAside } = await import("../auth-aside");
    render(await AuthAside());

    expect(
      screen.getByRole("heading", { name: /AI Coworkers/i }),
    ).toHaveTextContent("for Marketing");
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
    expect(screen.getByAltText(asideCopy.quoteAuthor)).toHaveAttribute(
      "src",
      "/images/auth/florian-haller.webp",
    );
    expect(screen.getByText(asideCopy.quoteRole)).toBeInTheDocument();
    expect(screen.getByText(asideCopy.quote)).toBeInTheDocument();
  });
});
